import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.WANEES_ERROR_MONITORING_DSN) {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DATABASE_URL) {
    await warmDatabasePools();
    startPushDispatcher();
  }
}

// تنبيهات شاشة القفل داخل نفس العملية (لنشر بخادم واحد): WANEES_PUSH_DISPATCH_INTERVAL_SECONDS=60.
// مع عدة نسخ أو استضافة بلا خادم دائم استخدم POST /api/v1/internal/push/dispatch من مجدول خارجي؛
// تشغيلهما معًا آمن لأن كل تنبيه يُحجز قبل إرساله.
function startPushDispatcher() {
  const seconds = Number(process.env.WANEES_PUSH_DISPATCH_INTERVAL_SECONDS);
  if (!Number.isFinite(seconds) || seconds < 15) return;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      // The literal NEXT_RUNTIME check lets webpack drop this Node-only import from the edge bundle.
      if (process.env.NEXT_RUNTIME === "nodejs") {
        const { dispatchPushNudges } = await import("@/lib/push-dispatch");
        const summary = await dispatchPushNudges();
        if (summary.sent || summary.removed || summary.failed) console.info(JSON.stringify({ event: "wanees.push.dispatch", ...summary }));
      }
    } catch {
      // Next tick retries; a failed pass never affects visitor requests.
    } finally {
      running = false;
    }
  }, seconds * 1000);
  timer.unref?.();
}

// تسخين تجمّع اتصالات Prisma عند إقلاع الخادم: تأسيس الاتصالات مسبقًا حتى لا يدفع
// الاندفاع الأول كلفة تأسيس الاتصال (المصافحة) لكل طلب — سبب حجب رأس الطابور المقاس.
async function warmDatabasePools() {
  try {
    const [{ prisma: appPrisma }, { loadPublishedEventCatalog }, { databasePoolMax }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/db-catalog"),
      import("../packages/contracts/src/database.ts"),
    ]);
    // The engine shares this client (one pool per process), so warm part of the pool and leave room for requests.
    const queries = [
      ...Array.from({ length: Math.min(8, databasePoolMax()) }, () => appPrisma.$queryRaw`SELECT 1`.catch(() => undefined)),
      // تسخين كتالوج الحدث التجريبي حتى لا يدفع أول طلب /live كلفة الاستعلام الثقيل + التعيين.
      loadPublishedEventCatalog("boulevard-world-demo").catch(() => null),
      // تسخين نمط استعلام /live (event + snapshots + updates) لإزالة كلفة أول تنفيذ وخطة الاستعلام.
      warmLivePattern(appPrisma),
    ];
    await Promise.race([
      Promise.all(queries),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    // تسخين اختياري — لا يمنع الإقلاع عند غياب قاعدة البيانات.
  }
}

async function warmLivePattern(prisma: any) {
  try {
    const event = await prisma.event.findFirst({
      where: { slug: "boulevard-world-demo", status: { in: ["PUBLISHED", "LIVE"] as any } },
      select: { id: true },
    });
    if (!event) return;
    await Promise.all([
      prisma.crowdSnapshot.findMany({
        where: { eventId: event.id },
        orderBy: [{ eventUpdateId: { sort: "desc", nulls: "last" } }, { observedAt: "desc" }],
        take: 200,
        include: { zone: true },
      }),
      prisma.eventUpdate.findMany({
        where: { eventId: event.id, revokedAt: null },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
  } catch {
    // تسخين اختياري.
  }
}

export const onRequestError = Sentry.captureRequestError;
