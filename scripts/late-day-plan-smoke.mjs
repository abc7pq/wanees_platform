// Defines what a family plan looks like late in the evening, instead of leaving it to the
// time CI happens to run. Two visitor servers run the same build: the main one with its
// clock pinned at 18:00 (1080) and a second one pinned at 21:30 (1290). The late plan must
// still be a valid plan (at least one stop, within budget, explained) and must not be
// longer than the 18:00 plan. Each server's reported clock is checked first, so the test
// cannot pass by accident on the real clock.
const eventSlug = "boulevard-world-demo";
const budgetSar = 300;
const servers = [
  { label: "18:00", baseUrl: process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100", minute: 1080 },
  { label: "21:30", baseUrl: process.env.WANEES_LATE_BASE_URL ?? "http://127.0.0.1:3101", minute: 1290 },
];

function check(condition, message) {
  if (!condition) throw new Error(`late-day plan failed: ${message}`);
  console.log(`✓ ${message}`);
}

async function planAt({ baseUrl }) {
  let cookie = "";
  async function call(path, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${baseUrl}${path} returned ${response.status}: ${JSON.stringify(body)}`);
    return body.data;
  }
  await call(`/api/v1/events/${eventSlug}/session`, {
    method: "POST",
    body: JSON.stringify({
      clientType: "web", locale: "ar-SA", entryPoint: "late-day-smoke",
      preferences: { companions: "عائلة وأطفال", interests: ["عائلة", "طبيعة", "عروض"], budgetMaxCents: budgetSar * 100, availableMinutes: 180, startPointId: "main-entrance" },
    }),
  });
  return call(`/api/v1/events/${eventSlug}/itinerary`, { method: "POST", body: JSON.stringify({ generatedReason: "late-day-smoke" }) });
}

const results = [];
for (const server of servers) {
  const created = await planAt(server);
  const plan = created.itinerary;
  const clockMinute = created.clock?.actualMinute;
  console.log(`${server.label}: ${plan.stops.map((stop) => stop.name).join(" → ") || "(no stops)"} (${plan.total_cost} SAR), clock=${clockMinute}`);
  check(clockMinute === server.minute, `the ${server.label} server plans at minute ${server.minute}`);
  check(plan.stops.length >= 1, `the ${server.label} plan has at least one stop`);
  check(plan.total_cost <= budgetSar, `the ${server.label} plan stays within ${budgetSar} SAR`);
  check(plan.explanations.length > 0, `the ${server.label} plan explains its stops`);
  results.push(plan);
}
check(results[1].stops.length <= results[0].stops.length, `the 21:30 plan (${results[1].stops.length} stops) is no longer than the 18:00 plan (${results[0].stops.length} stops)`);
