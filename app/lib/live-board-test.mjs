// Live board: honest crowd labels, operator updates in plain Arabic, delayed and cancelled shows.
// node --experimental-strip-types lib/live-board-test.mjs
import assert from "node:assert/strict";
import { bandFor, boardClock, buildBoard } from "./live-board.ts";

const catalog = {
  meta: { source: "test", note: "", currency: "SAR" },
  site: { name: "Test venue", walking_speed_m_per_min: 65, min_walk_min: 1, opening: { from: 17, to: 24 }, crowd_threshold: 0.75, base_crowd_curve: {} },
  zones: [
    { id: "lagoon", name: "البحيرة", x: 0, y: 0, popularity: 0.9 },
    { id: "planet", name: "الكوكب", x: 100, y: 0, popularity: 0.85 },
    { id: "garden", name: "الحديقة", x: 0, y: 100, popularity: 0.6 },
    { id: "market", name: "السوق", x: 100, y: 100, popularity: 0.7 },
    { id: "empty", name: "منطقة بلا أنشطة", x: 50, y: 50, popularity: 0.5 },
  ],
  activities: [
    { id: "dolphins", name: "عرض الدلافين", zone: "planet", type: "show", duration_min: 40, popularity: 0.9, schedule: { type: "slots", slots: [1110, 1230, 1350] } },
    { id: "parade", name: "الموكب", zone: "lagoon", type: "show", duration_min: 20, popularity: 0.8, schedule: { type: "slots", slots: [1080, 1170] } },
    { id: "boat", name: "قارب البحيرة", zone: "lagoon", type: "ride", duration_min: 15, popularity: 0.7, schedule: { type: "window", from: 1020, to: 1440 } },
    { id: "flowers", name: "ممر الزهور", zone: "garden", type: "walk", duration_min: 20, popularity: 0.5, schedule: { type: "window", from: 1020, to: 1440 } },
    { id: "souq", name: "السوق الشعبي", zone: "market", type: "shop", duration_min: 30, popularity: 0.6, schedule: { type: "window", from: 1020, to: 1440 } },
    { id: "night-show", name: "عرض الليل", zone: "market", type: "show", duration_min: 30, popularity: 0.5, schedule: { type: "window", from: 1200, to: 1440 } },
  ],
};

const crowd = [
  { zone: "lagoon", level: 0.82, source: "sensor", quietestUpcomingHour: 22 },
  { zone: "planet", level: 0.5, source: "simulation" },
  { zone: "garden", level: 0.2, source: "estimate" },
  { zone: "market", level: 0.3, source: "operator" },
  { zone: "empty", level: 0.05, source: "estimate" },
];

const base = { catalog, crowd, threshold: 0.75, updates: [], nowMinute: 1100 };

// Bands
assert.equal(bandFor(0.2, 0.75), "calm");
assert.equal(bandFor(0.5, 0.75), "busy");
assert.equal(bandFor(0.75, 0.75), "packed");

// Zones: busiest first, honest source labels, only sensors count as measured.
{
  const board = buildBoard(base);
  assert.deepEqual(board.zones.map((zone) => zone.id), ["lagoon", "planet", "market", "garden", "empty"]);
  assert.deepEqual(board.zones.map((zone) => zone.sourceLabel), ["مقاس", "محاكاة", "من المشغّل", "تقدير", "تقدير"]);
  assert.equal(board.zones[0].band, "packed");
  assert.equal(board.zones[0].quietestUpcomingHour, 22);
  assert.equal(board.anyMeasured, true);
  assert.equal(buildBoard({ ...base, crowd: crowd.map((row) => ({ ...row, source: "estimate" })) }).anyMeasured, false);
  // Quietest: never packed, never an empty zone, lowest level first.
  assert.deepEqual(board.quietest.map((zone) => zone.id), ["garden", "market", "planet"]);
  // A zone with no reading is treated as an estimate at zero, not as measured.
  const missing = buildBoard({ ...base, crowd: [] });
  assert.ok(missing.zones.every((zone) => zone.sourceLabel === "تقدير" && !zone.measured));
}

// Shows: upcoming slots only, sorted, slots-based shows only.
{
  const board = buildBoard(base);
  assert.deepEqual(board.shows.map((show) => `${show.activityId}@${show.startsMinute}`), [
    "dolphins@1110", "parade@1170", "dolphins@1230", "dolphins@1350",
  ]);
  assert.ok(board.shows.every((show) => show.delayMinutes === 0 && !show.cancelled));
  // A running show stays listed until it ends (1110 + 40 > 1140).
  assert.equal(buildBoard({ ...base, nowMinute: 1140 }).shows[0].activityId, "dolphins");
  assert.ok(buildBoard({ ...base, nowMinute: 1145 }).shows.every((show) => show.scheduledMinute !== 1080));
}

// Operator updates become plain-Arabic notices and change the shows.
{
  const board = buildBoard({
    ...base,
    updates: [
      { updateType: "DELAY", targetType: "activity", targetId: "dolphins", payload: { minutes: 25, reason: "  صيانة سريعة للمسرح  " } },
      { updateType: "CLOSURE", targetType: "zone", targetId: "market", payload: {} },
      { updateType: "SCHEDULE_CHANGE", targetType: "activity", targetId: "parade", payload: { cancelled: true } },
      { updateType: "CROWD_OVERRIDE", targetType: "zone", targetId: "garden", payload: { level: 0.9 } },
      { updateType: "CROWD_OVERRIDE", targetType: "zone", targetId: "planet", payload: { level: 0.2 } },
      { updateType: "DELAY", targetType: "activity", targetId: "no-such-activity", payload: { minutes: 10 } },
      { updateType: "CONTENT_CORRECTION", targetType: "activity", targetId: "boat", payload: { reason: "تصحيح سعر" } },
      { updateType: "SCHEDULE_CHANGE", targetType: "event", payload: { reason: "البوابة ٣ مغلقة، استخدموا البوابة ١" } },
    ],
  });
  assert.deepEqual(board.notices.map((notice) => notice.kind), ["delay", "closure", "cancelled", "crowd", "info"]);
  assert.equal(board.notices[0].title, "تأخير ٢٥ دقيقة: عرض الدلافين");
  assert.equal(board.notices[0].reason, "صيانة سريعة للمسرح");
  assert.equal(board.notices[1].title, "إغلاق مؤقت: السوق");
  assert.equal(board.notices[4].reason, "البوابة ٣ مغلقة، استخدموا البوابة ١");
  assert.ok(board.notices.every((notice) => !notice.title.includes("no-such-activity")), "unknown ids never reach the screen");
  // Only the next dolphin show moves; later ones keep their published time.
  const dolphins = board.shows.filter((show) => show.activityId === "dolphins");
  assert.deepEqual(dolphins.map((show) => [show.scheduledMinute, show.startsMinute, show.delayMinutes]), [[1110, 1135, 25], [1230, 1230, 0], [1350, 1350, 0]]);
  assert.ok(board.shows.filter((show) => show.activityId === "parade").every((show) => show.cancelled));
  // A closed zone is listed last and never suggested.
  assert.equal(board.zones.at(-1).id, "market");
  assert.ok(board.zones.at(-1).closed);
  assert.ok(!board.quietest.some((zone) => zone.id === "market"));
}

// Delay bounds match the planner: missing → 15, clamped to 1..240.
{
  const minutes = (payload) => buildBoard({ ...base, updates: [{ updateType: "DELAY", targetType: "activity", targetId: "dolphins", payload }] })
    .shows.find((show) => show.activityId === "dolphins" && show.scheduledMinute === 1110).delayMinutes;
  assert.equal(minutes({}), 15);
  assert.equal(minutes({ minutes: 999 }), 240);
  assert.equal(minutes({ minutes: -4 }), 1);
}

// Long reasons are cut to 200 characters.
{
  const long = "س".repeat(300);
  const board = buildBoard({ ...base, updates: [{ updateType: "CLOSURE", targetType: "zone", targetId: "garden", payload: { reason: long } }] });
  assert.equal(board.notices[0].reason.length, 200);
}

assert.equal(boardClock(1110), "١٨:٣٠");
assert.equal(boardClock(1440 + 65), "١:٠٥");

console.log("live board: all assertions passed");

// A delayed show stays on the board even when six other performances start sooner.
{
  const crowded = {
    ...catalog,
    activities: [
      ...catalog.activities,
      ...Array.from({ length: 8 }, (_, index) => ({ id: `early-${index}`, name: `عرض مبكر ${index}`, zone: "garden", type: "show", duration_min: 20, popularity: 0.5, schedule: { type: "slots", slots: [1085 + index] } })),
    ],
  };
  const board = buildBoard({ ...base, catalog: crowded, updates: [{ updateType: "DELAY", targetType: "activity", targetId: "dolphins", payload: { minutes: 25 } }] });
  assert.equal(board.shows.length, 6, "the board still shows six performances");
  assert.ok(board.shows.some((show) => show.activityId === "dolphins" && show.delayMinutes === 25), "the delayed show is on the board");
  assert.deepEqual(board.shows.map((show) => show.startsMinute), [...board.shows.map((show) => show.startsMinute)].sort((a, b) => a - b), "shows stay in time order");
  console.log("live board keeps delayed shows visible ✓");
}
