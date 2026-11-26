// اختبار حمل متزامن لواجهة ونيس — يقيس p50/p90/p95/p99 زمن الاستجابة تحت تزامن متصاعد.
// الاستخدام: node scripts/load-test.mjs <baseUrl> [requests] [concurrency] [p95BudgetMs]
// مثال:     node scripts/load-test.mjs http://127.0.0.1:3100 200 20
//
// يقيس الأثر على «سرعة الاستجابة» (أحد مقاييس النجاح الأربعة، ص11) ويغذّي حزمة التقييم
// app/engine/eval.ts عبر responseSpeed({p50Ms, p95Ms}).
import process from "node:process";

const base = process.argv[2] ?? "http://127.0.0.1:3100";
const total = Number(process.argv[3] ?? 200);
const concurrency = Number(process.argv[4] ?? 20);
const p95BudgetMs = Number(process.argv[5] ?? process.env.WANEES_LOAD_P95_BUDGET_MS ?? 1000);

if (!/^https?:\/\//.test(base) || !Number.isInteger(total) || total < 1 || !Number.isInteger(concurrency) || concurrency < 1 || !Number.isFinite(p95BudgetMs) || p95BudgetMs < 1) {
  console.error("usage: node scripts/load-test.mjs <baseUrl> [requests] [concurrency] [p95BudgetMs]");
  process.exit(2);
}

const paths = ["/api/health", "/api/v1/events/boulevard-world-demo/live", "/demo"];
let next = 0;
const latencies = [];
const errors = [];
const started = Date.now();

async function worker() {
  for (;;) {
    const i = next++;
    if (i >= total) break;
    const path = paths[i % paths.length];
    const t0 = Date.now();
    try {
      const res = await fetch(base + path);
      await res.arrayBuffer();
      latencies.push(Date.now() - t0);
      if (!res.ok) errors.push(`${path} -> ${res.status}`);
    } catch (e) {
      errors.push(`${path} -> ${e?.message ?? e}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

const sorted = [...latencies].sort((a, b) => a - b);
const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))] ?? 0;
const elapsedMs = Date.now() - started;

console.log(
  JSON.stringify(
    {
      base,
      total,
      concurrency,
      ok: latencies.length,
      errors: errors.length,
      p50Ms: p(50),
      p90Ms: p(90),
      p95Ms: p(95),
      p99Ms: p(99),
      maxMs: sorted[sorted.length - 1] ?? 0,
      p95BudgetMs,
      p95WithinBudget: p(95) <= p95BudgetMs,
      rps: +(latencies.length / Math.max(1, elapsedMs / 1000)).toFixed(1),
      elapsedMs,
      firstErrors: errors.slice(0, 5),
    },
    null,
    2
  )
);

if (errors.length > 0 || p(95) > p95BudgetMs) process.exitCode = 1;
