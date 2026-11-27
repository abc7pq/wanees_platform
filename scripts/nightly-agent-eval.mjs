// Audit 6.1: the nightly agent eval with the real model, on every event.
// For each event: register a kiosk through the organizer API (when an organizer URL and token are set),
// run scripts/agent-eval.mjs --model --runs=3 --min-pass=95, revoke the kiosk, and fail if any event fails.
//   node scripts/nightly-agent-eval.mjs [baseUrl] [eventSlug …]
// env: WANEES_ADMIN_BASE_URL + ADMIN_TOKEN (optional, for the kiosk persona), WANEES_EVAL_RUNS (3),
//      WANEES_EVAL_MIN_PASS (95), WANEES_EVAL_REPORT_DIR (reports as JSON).
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const positional = process.argv.slice(2);
const baseUrl = (positional[0] ?? process.env.WANEES_EVAL_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const slugs = positional.length > 1 ? positional.slice(1) : ["boulevard-world-demo", "sample-festival"];
const adminUrl = process.env.WANEES_ADMIN_BASE_URL?.replace(/\/$/, "");
const adminToken = process.env.ADMIN_TOKEN?.trim();
const runs = process.env.WANEES_EVAL_RUNS ?? "3";
const minPass = process.env.WANEES_EVAL_MIN_PASS ?? "95";
const reportDir = process.env.WANEES_EVAL_REPORT_DIR ?? "agent-eval-reports";
mkdirSync(reportDir, { recursive: true });

async function registerKiosk(slug) {
  if (!adminUrl || !adminToken) return null;
  const headers = { "content-type": "application/json", origin: adminUrl, "x-admin-token": adminToken };
  const event = await (await fetch(`${baseUrl}/api/events/${encodeURIComponent(slug)}`)).json();
  const node = event?.data?.catalog?.routeGraph?.nodes?.find((item) => item.status === "open" && item.type === "ZONE");
  if (!node) return null;
  const response = await fetch(`${adminUrl}/api/v1/events/${encodeURIComponent(slug)}/kiosks`, { method: "POST", headers, body: JSON.stringify({ name: "شاشة التقييم الليلي", nodeKey: node.id }) });
  if (response.status !== 201) {
    console.log(`(kiosk for ${slug} not registered: HTTP ${response.status}; the kiosk persona is skipped)`);
    return null;
  }
  const body = await response.json();
  return { id: body.data.id, token: body.data.token, revoke: () => fetch(`${adminUrl}/api/v1/events/${encodeURIComponent(slug)}/kiosks/${body.data.id}`, { method: "DELETE", headers }) };
}

let failed = false;
for (const slug of slugs) {
  console.log(`\n=== agent eval: ${slug} (${runs} runs, floor ${minPass}%) ===`);
  const kiosk = await registerKiosk(slug);
  try {
    const run = spawnSync(process.execPath, [
      "--experimental-strip-types", "scripts/agent-eval.mjs", baseUrl, slug,
      "--model", `--runs=${runs}`, `--min-pass=${minPass}`, `--json=${join(reportDir, `${slug}.json`)}`,
    ], { stdio: "inherit", env: { ...process.env, ...(kiosk ? { WANEES_EVAL_KIOSK_TOKEN: kiosk.token } : {}) } });
    if (run.status !== 0) failed = true;
  } finally {
    await kiosk?.revoke();
  }
}
if (failed) {
  console.log("\nnightly agent eval failed");
  process.exitCode = 1;
}
