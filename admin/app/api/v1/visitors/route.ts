import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeOrganizationRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { enforceAdminRateLimit, isSameOriginRead } from "@/lib/request-security";
import { canSeeVisitorPii, maskPhone, VISITOR_PII_ROLES, wantsPhoneReveal } from "@/lib/visitor-access";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 10_000;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Keeps spreadsheet apps from treating a visitor-typed value as a formula. */
function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const GET = withAdminApiContract(async function GET(request: Request) {
  const access = await authorizeOrganizationRequest(request, [...VISITOR_PII_ROLES]);
  if (!access.authorized) {
    return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "عرض بيانات الزوار للمالك والمدير فقط." : "غير مصرح.", access.userId ? 403 : 401);
  }
  const rate = await enforceAdminRateLimit(request, "visitors:list", 60);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "طلبات كثيرة. حاول بعد قليل.", 429);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 60) ?? "";
  const eventSlug = url.searchParams.get("eventSlug")?.trim() || undefined;
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  // Phone numbers are masked unless an Owner/Admin explicitly asks to reveal them (audited below).
  const reveal = wantsPhoneReveal(request);
  if (reveal && !canSeeVisitorPii(access.role)) return errorResponse("FORBIDDEN", "إظهار أرقام الجوال للمالك والمدير فقط.", 403);
  if ((format === "csv" || reveal) && !isSameOriginRead(request)) return errorResponse("FORBIDDEN", "تعذر التحقق من مصدر الطلب.", 403);
  if (format === "csv") {
    const exportRate = await enforceAdminRateLimit(request, "visitors:export", 10);
    if (!exportRate.allowed) return errorResponse("RATE_LIMITED", "طلبات تصدير كثيرة. حاول بعد قليل.", 429);
  }
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1));
  const digits = q.replace(/[^0-9]/g, "");

  const where = {
    organizationId: access.organizationId,
    ...(q ? { OR: [
      { name: { contains: q, mode: "insensitive" as const } },
      ...(digits.length >= 3 ? [{ phoneE164: { contains: digits.replace(/^0/, "") } }] : []),
    ] } : {}),
    ...(eventSlug ? { visits: { some: { event: { slug: eventSlug, organizationId: access.organizationId } } } } : {}),
  };

  const [total, visitors] = await Promise.all([
    prisma.visitor.count({ where }),
    prisma.visitor.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      skip: format === "csv" ? 0 : (page - 1) * PAGE_SIZE,
      take: format === "csv" ? EXPORT_LIMIT : PAGE_SIZE,
      select: {
        id: true, name: true, phoneE164: true, createdAt: true, lastSeenAt: true, consentVersion: true,
        visits: { select: { rating: true, startedAt: true, event: { select: { slug: true, name: true } } }, orderBy: { startedAt: "desc" } },
      },
    }),
  ]);

  const rows = visitors.map((visitor) => {
    const ratings = visitor.visits.map((visit) => visit.rating).filter((rating): rating is number => typeof rating === "number");
    return {
      id: visitor.id,
      name: visitor.name,
      phone: reveal ? visitor.phoneE164 : maskPhone(visitor.phoneE164),
      firstSeenAt: visitor.createdAt.toISOString(),
      lastSeenAt: visitor.lastSeenAt.toISOString(),
      visitCount: visitor.visits.length,
      events: [...new Map(visitor.visits.map((visit) => [visit.event.slug, visit.event.name])).values()],
      averageRating: ratings.length ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10 : null,
      consentVersion: visitor.consentVersion,
    };
  });

  await prisma.auditLog.create({
    data: {
      organizationId: access.organizationId,
      actorUserId: access.userId,
      action: format === "csv" ? (reveal ? "visitor.export_unmasked" : "visitor.export") : (reveal ? "visitor.list_unmasked" : "visitor.list"),
      entityType: "Visitor",
      afterSummary: { count: rows.length, total, page: format === "csv" ? null : page, filtered: Boolean(q || eventSlug), phonesRevealed: reveal },
    },
  });

  if (format === "csv") {
    const header = ["الاسم", "الجوال", "أول زيارة", "آخر زيارة", "عدد الزيارات", "الفعاليات", "متوسط التقييم"];
    const lines = rows.map((row) => [row.name, row.phone, row.firstSeenAt, row.lastSeenAt, row.visitCount, row.events.join(" | "), row.averageRating ?? ""].map(csvCell).join(","));
    const body = `﻿${[header.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`;
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="wanees-visitors${reveal ? "" : "-masked"}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  return NextResponse.json({ data: { visitors: rows, total, page, pageSize: PAGE_SIZE, phonesMasked: !reveal } }, { headers: { "cache-control": "no-store" } });
});
