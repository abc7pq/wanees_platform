import { NextResponse } from "next/server";
import { checkAuthAsync } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await checkAuthAsync(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.VISITOR_API || !process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: "إعداد VISITOR_API غير مضبوط" }, { status: 500 });
  }
  let events: unknown;
  try {
    ({ events } = await req.json());
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }
  if (!Array.isArray(events)) {
    return NextResponse.json({ error: "events يجب أن يكون مصفوفة" }, { status: 400 });
  }
  try {
    const res = await fetch(`${process.env.VISITOR_API}/api/admin/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": process.env.ADMIN_TOKEN },
      body: JSON.stringify({ events }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "خدمة الزوار غير متاحة" }, { status: 502 });
  }
}
