// Live check that forged client headers cannot get around the session-creation
// rate limit (20 per minute). Run against a visitor app started with
// WANEES_TRUSTED_PROXY_HOPS=<hops> on a throwaway database.
//   node scripts/rate-limit-spoof-smoke.mjs <baseUrl> <eventSlug> <hops> [expect=blocked|bypassed]
import { randomUUID } from "node:crypto";

const [baseUrl = "http://127.0.0.1:3100", eventSlug = "sample-festival", hopsArg = "0", expect = "blocked"] = process.argv.slice(2);
const hops = Number(hopsArg);
const realClient = `198.51.100.${10 + Math.floor(Math.random() * 200)}`;
const body = JSON.stringify({ clientType: "web", locale: "ar-SA", entryPoint: "rate-limit-spoof-smoke", preferences: { mood: "هادئ", interests: ["طعام"], availableMinutes: 120, startPointId: "main-entrance" } });

async function attempt(i, client = realClient) {
  // Client-forged prefix; trusted proxies append the address they saw.
  const appended = hops >= 1 ? [client, ...Array.from({ length: hops - 1 }, (_, n) => `10.0.0.${n + 2}`)] : [];
  const xff = [`10.${i % 250}.${(i * 7) % 250}.${(i * 13) % 250}`, ...appended].join(", ");
  const response = await fetch(`${baseUrl}/api/v1/events/${eventSlug}/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": xff,
      "x-real-ip": `192.0.2.${i % 250}`,
      "x-wanees-session-token": `forged-${randomUUID()}`,
      "idempotency-key": randomUUID(),
    },
    body,
  });
  await response.arrayBuffer();
  return response.status;
}

const statuses = [];
for (let i = 0; i < 25; i += 1) statuses.push(await attempt(i));
const allowed = statuses.filter((s) => s === 201).length;
const limited = statuses.filter((s) => s === 429).length;
const summary = { hops, attempts: statuses.length, allowed, limited, other: statuses.filter((s) => s !== 201 && s !== 429) };

if (expect === "bypassed") {
  console.log(JSON.stringify({ ...summary, result: limited === 0 ? "BYPASS_REPRODUCED" : "NOT_REPRODUCED" }));
  process.exit(limited === 0 ? 0 : 1);
}

if (allowed !== 20 || limited !== 5) throw new Error(`spoofed headers got past the limit: ${JSON.stringify(summary)}`);
if (hops >= 1) {
  const other = await attempt(999, `198.51.100.${Number(realClient.split(".")[3]) + 1}`);
  if (other !== 201) throw new Error(`a different real client was blocked (${other}); buckets are not per-address`);
  summary.differentClient = other;
}
console.log(JSON.stringify({ ...summary, result: "PASS" }));
