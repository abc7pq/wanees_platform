import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const organizer = process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200";
assert.ok(process.env.ADMIN_TOKEN, "Use the organizer token for a disposable verification stack");
for (const origin of [visitor, organizer]) {
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname), "Run this check on the local integration stack");
}

async function request(origin, path, { method = "GET", data, status = 200, cookie } = {}) {
  const headers = { origin, "content-type": "application/json" };
  if (origin === organizer) headers["x-admin-token"] = process.env.ADMIN_TOKEN;
  if (cookie) headers.cookie = cookie;
  const response = await fetch(origin + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result?.error ?? result?.data?.report?.errors ?? "")}`);
  return { data: result.data, error: result.error, cookie: response.headers.getSetCookie()[0]?.split(";")[0] };
}

// The crosswalk review is recorded out of band by the guarded script, the only
// path that sets VERIFIED. It runs against the same disposable database.
const artifactDir = mkdtempSync(join(tmpdir(), "wanees-crosswalk-"));
const artifact = join(artifactDir, "crosswalk.csv");
const artifactText = `id,match\nsample-activity,verification-${randomUUID()}\n`;
writeFileSync(artifact, artifactText);
const artifactSha = createHash("sha256").update(artifactText).digest("hex");
function verifyCrosswalk(slug, sha256, { confirm = true, version = 1 } = {}) {
  const args = ["--experimental-strip-types", "scripts/catalog-crosswalk-verify.ts", "--event", slug, "--version", String(version),
    "--artifact", artifact, "--sha256", sha256, "--reviewer", "publication smoke", ...(confirm ? ["--confirm"] : [])];
  const run = spawnSync(process.execPath, args, { encoding: "utf8" });
  const line = (run.status === 0 ? run.stdout : run.stderr).trim().split("\n").at(-1) ?? "{}";
  return { status: run.status, body: JSON.parse(line) };
}

const slug = `verification-catalog-${randomUUID().slice(0, 8)}`;
const { data: event } = await request(organizer, "/api/v1/events", {
  method: "POST", status: 201,
  data: { slug, name: "فعالية للتحقق الآلي", venueName: `موقع التحقق ${slug}`, venueSlug: slug, startsAt: new Date(Date.now() - 86400_000).toISOString(), endsAt: new Date(Date.now() + 86400_000).toISOString() },
});
const visitorPath = `/api/events/${slug}`;
const base = `/api/v1/events/${slug}`;
const catalog = `${base}/catalog`;
const versionId = event.catalogVersionId;
const walkedOn = new Date().toISOString().slice(0, 10);
const admin = (endpoint, method, data, status = 200) => request(organizer, `${catalog}/${endpoint}`, { method, data, status });

await request(visitor, visitorPath, { status: 404 });
// Live GPS guidance is a venue setting: refused without a calibration, then on once calibrated (audit 0.2).
const navigation = `${base}/navigation`;
assert.equal((await request(organizer, navigation)).data.settings.liveGuidance, false);
assert.equal((await request(organizer, navigation, { method: "PATCH", data: { liveGuidance: true }, status: 400 })).error.details.field, "liveGuidance");
const calibrated = await request(organizer, navigation, {
  method: "PATCH", data: { geoAnchorLat: 24.7766539, geoAnchorLng: 46.6003677, metersPerUnit: 0.62, liveGuidance: true, reason: "اختبار التكامل" },
});
assert.deepEqual([calibrated.data.settings.liveGuidance, calibrated.data.settings.navigationAccuracy], [true, "APPROXIMATE"]);
await admin("zones", "POST", { versionId, stableKey: "test-zone", nameAr: "منطقة الاختبار" }, 201);
// Tags come from the controlled vocabulary only, and publishing needs a description and 3+ tags (audit 1.3).
assert.equal((await admin("items", "POST", { versionId, stableKey: "bad-tags", nameAr: "وسم مجهول", zoneStableKey: "test-zone", tags: ["عروض", "شي غريب"] }, 400)).error.code, "INVALID_TAGS");
const content = { descriptionAr: "نشاط تجريبي للتحقق من النشر.", tags: ["ألعاب", "أطفال", "هدوء"] };
await admin("items", "POST", { versionId, stableKey: "sample-activity", nameAr: "نشاط تجريبي", zoneStableKey: "test-zone", priceSar: 10, durationMin: 25 }, 201);
await admin("items", "POST", { versionId, stableKey: "unknown-price", nameAr: "سعر غير معروف", zoneStableKey: "test-zone", durationMin: 25, factsSource: "مرجع الملاءمة لا يذكر السعر", ...content }, 201);
const schedule = { scheduleStartsAt: walkedOn + "T17:00:00+03:00", scheduleEndsAt: walkedOn + "T23:59:00+03:00" };
await admin("items/sample-activity", "PATCH", { versionId, ...schedule, factsSource: "مرجع اعتماد السعر والملاءمة والمواعيد" });
const incomplete = await admin("validate", "POST", { versionId });
assert.ok(incomplete.data.report.errors.some((error) => error.code === "ACTIVITY_DESCRIPTION_REQUIRED" && error.entity === "sample-activity"));
await admin("items/sample-activity", "PATCH", { versionId, ...content });
const node = (stableKey, label, type, x) => admin("nodes", "POST", {
  versionId, stableKey, label, type, zoneStableKey: "test-zone", x, y: 100, accessible: true,
}, 201);
const { data: gate } = await node("gate", "بوابة الاختبار", "ENTRANCE", 10);
const { data: restrooms } = await node("restrooms", "دورة المياه", "SERVICE", 100);
const segment = { versionId, fromNodeId: gate.id, toNodeId: restrooms.id, distanceM: 130, walkMin: 3, status: "open", accessible: true, source: "معاينة اختبار التكامل", walkedOn };

await admin("edges", "POST", { ...segment, toNodeId: gate.id }, 400);
await admin("edges", "POST", { ...segment, toNodeId: randomUUID() }, 404);
const { data: saved } = await admin("edges", "POST", segment);
assert.ok(saved.sourceId);
assert.equal((await admin("edges", "POST", segment)).data.sourceId, saved.sourceId);
await admin("zones", "PATCH", { versionId, zoneKey: "test-zone", capacity: 50, source: "مرجع سعة اختبار التكامل" });
// Audit 3.4: an activity's entrance is an open walkway node of its own zone; «دلّني» ends there.
assert.equal((await admin("items/sample-activity", "PATCH", { versionId, entranceNodeKey: "nowhere" }, 400)).error.code, "INVALID_ENTRANCE");
await admin("items/sample-activity", "PATCH", { versionId, entranceNodeKey: "restrooms" });
// Crosswalk gate: a new draft is on HOLD, so validation flags it and publish refuses it.
const crosswalk = async () => (await request(organizer, `${catalog}?versionId=${versionId}`)).data.selectedVersion;
assert.equal((await crosswalk()).crosswalkStatus, "HOLD");
assert.equal((await admin("publish", "POST", { versionId }, 409)).error.code, "CROSSWALK_HOLD");
const held = await admin("validate", "POST", { versionId });
assert.deepEqual(held.data.report.errors.map((error) => error.code), ["CROSSWALK_HOLD"]);
assert.equal(held.data.status, "REJECTED");

// The review script refuses an artifact that does not hash to the approved SHA-256.
const wrongSha = createHash("sha256").update("a different artifact").digest("hex");
const mismatch = verifyCrosswalk(slug, wrongSha);
assert.equal(mismatch.status, 1);
assert.equal(mismatch.body.code, "CROSSWALK_CHECKSUM_MISMATCH");
assert.equal((await crosswalk()).crosswalkStatus, "HOLD");
assert.equal(verifyCrosswalk(slug, artifactSha).body.ok, true);
assert.deepEqual(await crosswalk().then(({ crosswalkStatus, crosswalkChecksum }) => ({ crosswalkStatus, crosswalkChecksum })), { crosswalkStatus: "VERIFIED", crosswalkChecksum: artifactSha });

const { data: validated } = await admin("validate", "POST", { versionId });
assert.equal(validated.report.valid, true, JSON.stringify(validated.report.errors));
// Editing a verified draft drops it back to HOLD (database trigger), so publish refuses it.
await admin("edges", "POST", { ...segment, walkMin: 4 });
assert.equal((await crosswalk()).crosswalkStatus, "HOLD");
assert.equal((await admin("publish", "POST", { versionId, crosswalkChecksum: artifactSha }, 409)).error.code, "CROSSWALK_HOLD");
assert.equal(verifyCrosswalk(slug, artifactSha).body.ok, true);
assert.equal((await admin("validate", "POST", { versionId })).data.report.valid, true);
// A VERIFIED draft still needs the publisher to present the checksum that was approved.
assert.equal((await admin("publish", "POST", { versionId }, 409)).error.code, "CROSSWALK_CHECKSUM_REQUIRED");
assert.equal((await admin("publish", "POST", { versionId, crosswalkChecksum: wrongSha }, 409)).error.code, "CROSSWALK_CHECKSUM_MISMATCH");
await admin("publish", "POST", { versionId, crosswalkChecksum: artifactSha });
await admin("edges", "POST", segment, 409);
assert.equal((await request(visitor, visitorPath)).data.catalogVersionId, versionId);

const guest = await request(visitor, `${base}/session`, { method: "POST", data: { clientType: "web", locale: "ar-SA" }, status: 201 });
const { data: plan } = await request(visitor, `${base}/itinerary`, { method: "POST", data: {}, cookie: guest.cookie, status: 201 });
assert.deepEqual(plan.itinerary.stops.map((stop) => stop.act_id), ["sample-activity"]);
assert.equal(plan.itinerary.total_cost, 10);
const { data: path } = await request(visitor, `${base}/directions?from=gate&to=restrooms`, { cookie: guest.cookie });
assert.equal(path.mode, "graph");
assert.equal(path.totalWalkMin, 4);
assert.equal(path.demoRoute, false);
await request(visitor, `${base}/directions?from=restrooms&to=gate`, { cookie: guest.cookie, status: 409 });
const { data: toDoor } = await request(visitor, `${base}/directions?from=gate&to=sample-activity`, { cookie: guest.cookie });
assert.equal(toDoor.arrival, "destination_node", "directions to an activity end at its entrance");
assert.equal(toDoor.steps.at(-1).id, "restrooms");
await request(visitor, `${base}/session`, { method: "DELETE", cookie: guest.cookie });

// Rollback goes through the same gate: publish a verified v2, then restore v1,
// which needs the checksum v1 was verified with.
const { data: second } = await request(organizer, catalog, { method: "POST", data: { fromVersionId: versionId }, status: 201 });
assert.equal(second.versionNumber, 2);
const copied = (await request(organizer, `${catalog}?versionId=${second.id}`)).data.selectedVersion.activities.find((item) => item.stableKey === "sample-activity");
assert.equal(copied.entranceNodeKey, "restrooms", "a new version keeps the entrance");
assert.equal((await admin("publish", "POST", { versionId: second.id, crosswalkChecksum: artifactSha }, 409)).error.code, "CROSSWALK_HOLD");
assert.equal(verifyCrosswalk(slug, artifactSha, { version: 2 }).body.ok, true);
assert.equal((await admin("validate", "POST", { versionId: second.id })).data.report.valid, true);
await admin("publish", "POST", { versionId: second.id, crosswalkChecksum: artifactSha });
assert.equal((await admin("rollback", "POST", { versionId }, 409)).error.code, "CROSSWALK_CHECKSUM_REQUIRED");
assert.equal((await admin("rollback", "POST", { versionId, crosswalkChecksum: wrongSha }, 409)).error.code, "CROSSWALK_CHECKSUM_MISMATCH");
await admin("rollback", "POST", { versionId, crosswalkChecksum: artifactSha });
assert.equal((await request(visitor, visitorPath)).data.catalogVersionId, versionId);
rmSync(artifactDir, { recursive: true, force: true });
console.log("Catalog sources, itinerary eligibility, crosswalk gate on publish and rollback, publication, and measured one-way walking route passed.");
