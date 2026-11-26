import assert from "node:assert/strict";
import {
  buildHourBreakdown,
  buildPartyBreakdown,
  buildZoneBreakdown,
  DEFAULT_TIMEZONE,
  localHour,
  partyTypeOf,
  resolveTimeZone,
  SMALL_COUNT_THRESHOLD,
  suppressColumn,
  suppressCount,
  HIDDEN_DISPLAY,
} from "../lib/analytics-breakdowns.ts";

assert.equal(SMALL_COUNT_THRESHOLD, 5);

// Small-count suppression: 1–4 hidden, 0 and 5+ shown.
assert.deepEqual(suppressCount(0), { count: 0, display: "0", suppressed: false });
for (const n of [1, 2, 3, 4]) assert.deepEqual(suppressCount(n), { count: null, display: "<5", suppressed: true });
assert.deepEqual(suppressCount(5), { count: 5, display: "5", suppressed: false });
assert.deepEqual(suppressCount(120), { count: 120, display: "120", suppressed: false });
assert.deepEqual(suppressCount(-3), { count: 0, display: "0", suppressed: false });
assert.deepEqual(suppressCount(Number.NaN), { count: 0, display: "0", suppressed: false });
assert.deepEqual(suppressCount(2, 3), { count: null, display: "<3", suppressed: true });

// Timezone: venue zone when valid, Asia/Riyadh otherwise.
assert.equal(resolveTimeZone("Europe/London"), "Europe/London");
assert.equal(resolveTimeZone(null), DEFAULT_TIMEZONE);
assert.equal(resolveTimeZone("Not/AZone"), DEFAULT_TIMEZONE);

// Riyadh is UTC+3 with no daylight saving.
assert.equal(localHour(new Date("2026-11-26T13:30:00Z"), "Asia/Riyadh"), 16);
assert.equal(localHour(new Date("2026-11-26T21:05:00Z"), "Asia/Riyadh"), 0);
assert.equal(localHour(new Date("2026-11-26T21:05:00Z"), "UTC"), 21);

// Hour buckets: 24 rows starting at the window's local hour, suppression per cell.
const at = (iso) => new Date(iso);
const sessions = [
  ...Array.from({ length: 6 }, () => at("2026-11-26T13:10:00Z")), // 16:00 Riyadh
  at("2026-11-26T14:10:00Z"), at("2026-11-26T14:40:00Z"), // 17:00 Riyadh, 2 sessions
  ...Array.from({ length: 7 }, () => at("2026-11-26T21:15:00Z")), // 00:00 Riyadh
];
const hours = buildHourBreakdown({ sessions, itineraries: [], interactions: [at("2026-11-26T13:00:00Z")] }, "Asia/Riyadh", 16);
assert.equal(hours.length, 24);
assert.deepEqual(hours.slice(0, 3).map((row) => row.hour), [16, 17, 18]);
assert.equal(hours[0].label, "16:00");
// 17:00 has 2 sessions (hidden). Alone it could be recovered as total - visible, so the smallest
// visible hour (16:00, 6) is hidden with it; 00:00 (7) stays visible.
assert.equal(hours[1].sessions.display, HIDDEN_DISPLAY);
assert.equal(hours[1].sessions.count, null);
assert.equal(hours[0].sessions.count, null, "complementary cell is hidden");
assert.equal(hours[0].sessions.display, HIDDEN_DISPLAY, "and labelled like the small one");
assert.equal(hours.find((row) => row.hour === 0).sessions.count, 7);
assert.equal(hours[0].interactions.display, HIDDEN_DISPLAY);
assert.equal(hours[2].sessions.count, 0);
assert.deepEqual(new Set(hours.map((row) => row.hour)).size, 24);
assert.equal(buildHourBreakdown({ sessions: [], itineraries: [], interactions: [] }, "UTC", -1)[0].hour, 23);

// Party types from the companions answer, never echoing the text.
assert.equal(partyTypeOf("لحالي"), "solo");
assert.equal(partyTypeOf("شريكي"), "couple");
assert.equal(partyTypeOf("عائلة وأطفال"), "family");
assert.equal(partyTypeOf("أصدقاء"), "friends");
assert.equal(partyTypeOf(null), "unspecified");
assert.equal(partyTypeOf("   "), "unspecified");
assert.equal(partyTypeOf("فريق العمل"), "other");
assert.equal(partyTypeOf(null, 6), "family");

const party = buildPartyBreakdown([
  ...Array.from({ length: 6 }, (_, i) => ({ companions: "عائلة وأطفال", partySize: i % 2 ? 4 : 5, youngestChildAge: 7 })),
  ...Array.from({ length: 2 }, () => ({ companions: "لحالي", partySize: 1, youngestChildAge: null })),
  { companions: "Ahmed's group 0501234567", partySize: 3, youngestChildAge: null },
  ...Array.from({ length: 5 }, () => ({ companions: "أصدقاء", partySize: 3, youngestChildAge: null })),
]);
assert.deepEqual(party.map((row) => row.type), ["solo", "couple", "family", "friends", "other", "unspecified"]);
const family = party.find((row) => row.type === "family");
assert.equal(family.sessions.count, 6);
assert.equal(family.avgPartySize, 4.5);
assert.equal(family.label, "عائلة مع أطفال");
const solo = party.find((row) => row.type === "solo");
assert.equal(solo.sessions.display, HIDDEN_DISPLAY);
// solo (2) + other (1) = 3 < 5, so the smallest visible bucket (friends, 5) is hidden too;
// family (6) stays visible with its average.
assert.equal(party.find((row) => row.type === "friends").sessions.count, null);
assert.equal(party.find((row) => row.type === "other").sessions.count, null);
assert.equal(solo.avgPartySize, null, "averages are withheld for suppressed buckets");
assert.equal(party.find((row) => row.type === "couple").sessions.count, 0);
assert.ok(!JSON.stringify(party).includes("Ahmed"), "free text never reaches the output");
assert.ok(!JSON.stringify(party).includes("0501234567"));

// Zones: published zones always listed, stray keys appended, busiest first, crowd clamped.
const zones = buildZoneBreakdown(
  [{ id: "lagoon", name: "البحيرة" }, { id: "africa", name: "أفريقيا" }, { id: "asia", name: "آسيا" }],
  {
    plannedStops: new Map([["africa", 12], ["lagoon", 3], ["old-zone", 9]]),
    presentNow: new Map([["africa", 4], ["lagoon", 8]]),
    interactions: new Map([["lagoon", 5]]),
    crowdLevel: new Map([["africa", 0.734], ["asia", 1.4]]),
  },
  new Map([["old-zone", "منطقة سابقة"]]),
);
// lagoon (3) is hidden and old-zone (9) is hidden with it; hidden rows sort together by name.
assert.deepEqual(zones.map((row) => row.id), ["africa", "lagoon", "old-zone", "asia"]);
const africa = zones[0];
assert.equal(africa.plannedStops.count, 12);
assert.equal(africa.presentNow.display, HIDDEN_DISPLAY);
assert.equal(zones.find((row) => row.id === "lagoon").presentNow.count, null, "lagoon (8) hides africa's 4");
assert.equal(africa.avgCrowdLevel, 0.73);
assert.equal(zones.find((row) => row.id === "old-zone").name, "منطقة سابقة");
assert.equal(zones.find((row) => row.id === "lagoon").plannedStops.display, HIDDEN_DISPLAY);
assert.equal(zones.find((row) => row.id === "old-zone").plannedStops.count, null);
assert.equal(zones.find((row) => row.id === "lagoon").interactions.count, 5);
assert.equal(zones.find((row) => row.id === "asia").avgCrowdLevel, 1);
assert.equal(zones.find((row) => row.id === "asia").plannedStops.count, 0);

// Complementary suppression: subtracting visible cells from the total never yields a small count.
const sum = (cells) => cells.reduce((acc, cell) => acc + (cell.count ?? 0), 0);
for (const column of [[2, 6, 7], [1, 0, 0, 40], [3, 3, 50], [4, 5, 5, 100], [0, 0, 9], [1, 1, 1, 1, 1, 1]]) {
  const cells = suppressColumn(column);
  const total = column.reduce((a, b) => a + b, 0);
  const residual = total - sum(cells);
  const hiddenCells = cells.filter((cell) => cell.suppressed).length;
  if (hiddenCells === 0) assert.equal(residual, 0);
  else if (residual > 0 && column.filter((n) => n > 0).length > 1) {
    assert.ok(hiddenCells >= 2 && residual >= SMALL_COUNT_THRESHOLD, `column ${column} exposes ${residual}`);
  }
  for (const [index, cell] of cells.entries()) if (!cell.suppressed) assert.equal(cell.count, column[index]);
}
assert.deepEqual(suppressColumn([0, 12, 30]).map((cell) => cell.count), [0, 12, 30], "nothing small, nothing hidden");

// Nothing in the output looks like a session identifier.
const serialized = JSON.stringify({ hours, party, zones });
assert.ok(!/session|sessionId|visitorId|deviceKey/i.test(serialized.replace(/"sessions"/g, "")));

console.log("analytics breakdowns: bucketing and small-count suppression ok");
