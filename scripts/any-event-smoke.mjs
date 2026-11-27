// Audit 6.4: the visitor flow on ANY published event, driven only by that event's catalog.
// Nothing here names a Boulevard World zone, ride or gate: the event's own calibration, content, tags,
// walkways and services decide what to expect. Run it on every seeded event:
//   node --experimental-strip-types scripts/any-event-smoke.mjs [baseUrl] [eventSlug …]
// defaults: $WANEES_BASE_URL (http://127.0.0.1:3100), boulevard-world-demo and sample-festival.
import assert from "node:assert/strict";
import { isKnownTag } from "../packages/engine/src/tags.ts";

const positional = process.argv.slice(2);
const baseUrl = (positional[0] ?? process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const slugs = positional.length > 1 ? positional.slice(1) : ["boulevard-world-demo", "sample-festival"];

function visitor(slug) {
  let cookie = "";
  return async function call(path, init = {}, expected = 200) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${baseUrl}/api/v1/events/${encodeURIComponent(slug)}${path}`, { ...init, headers });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith("wanees_visitor_session="));
    if (setCookie) cookie = setCookie.split(";")[0];
    const body = await response.json().catch(() => null);
    assert.equal(response.status, expected, `${init.method ?? "GET"} ${slug}${path}: ${JSON.stringify(body?.error ?? body)}`);
    return body?.data;
  };
}

const position = (nodeId) => ({ nodeId, source: "gps", accuracyM: 15, capturedAt: new Date().toISOString() });
const positionQuery = (nodeId) => `nodeId=${encodeURIComponent(nodeId)}&source=gps&accuracyM=15&capturedAt=${encodeURIComponent(new Date().toISOString())}`;

async function checkEvent(slug) {
  const eventResponse = await fetch(`${baseUrl}/api/events/${encodeURIComponent(slug)}`);
  assert.equal(eventResponse.status, 200, `${slug} has no published catalog`);
  const event = (await eventResponse.json()).data;
  const { catalog } = event;
  assert.equal(event.eventSlug, slug);

  // The event's own content: every activity is described, tagged from the controlled list and scheduled.
  assert.ok(catalog.activities.length >= 10, `${slug}: too few activities to plan with`);
  for (const activity of catalog.activities) {
    assert.ok(activity.description?.trim(), `${slug}/${activity.id} has no description`);
    assert.ok(activity.tags?.length, `${slug}/${activity.id} has no tags`);
    for (const tag of activity.tags) assert.ok(isKnownTag(tag), `${slug}/${activity.id}: «${tag}» is not a controlled tag`);
    assert.ok(catalog.zones.some((zone) => zone.id === activity.zone), `${slug}/${activity.id} is in an unknown zone`);
  }
  // Its own calibration and walkways.
  assert.ok(event.navigation?.liveGuidance, `${slug}: live guidance is off`);
  const calibration = event.navigation.calibration;
  assert.ok(calibration && Number.isFinite(calibration.anchorLat) && Number.isFinite(calibration.anchorLng) && calibration.metersPerUnit > 0, `${slug}: no GPS calibration`);
  const nodes = catalog.routeGraph.nodes.filter((node) => node.status === "open");
  const gate = nodes.find((node) => node.type === "ENTRANCE");
  const toilets = nodes.filter((node) => node.type === "SERVICE" && /دورات? المياه|دورة مياه/.test(node.label));
  assert.ok(gate, `${slug}: no open entrance`);
  assert.ok(toilets.length, `${slug}: no toilets on the walkway graph`);
  assert.ok(catalog.routeGraph.edges.length >= nodes.length - 1, `${slug}: the walkway graph is not connected`);

  const call = visitor(slug);
  const session = await call("/session", { method: "POST", body: JSON.stringify({ clientType: "web", locale: "ar-SA", entryPoint: "any-event-smoke", preferences: { companions: "family", partySize: 3, youngestChildAge: 7, mood: "هادئ", interests: ["عائلة"], availableMinutes: 150, startPointId: gate.id } }) }, 201);
  assert.equal(session.eventSlug, slug);

  // A plan from this event's catalog only.
  const planned = await call("/itinerary", { method: "POST", body: JSON.stringify({ generatedReason: "any-event-smoke" }) }, 201);
  const stops = planned.itinerary.stops;
  assert.ok(stops.length > 0, `${slug}: the plan is empty`);
  const activityIds = new Set(catalog.activities.map((activity) => activity.id));
  for (const stop of stops) assert.ok(activityIds.has(stop.act_id), `${slug}: the plan has «${stop.act_id}» from another catalog`);

  // The agent: a grounded price, a location on this event's graph, and nothing changed without consent.
  const priced = catalog.activities.find((activity) => activity.price > 0 && !stops.some((stop) => stop.act_id === activity.id));
  const price = await call("/assistant", { method: "POST", body: JSON.stringify({ message: `كم سعر ${priced.name}؟` }) });
  assert.match(price.message, new RegExp(String(priced.price)), `${slug}: the price must come from the catalog`);
  assert.equal(price.proposal ?? null, null, `${slug}: a price question must not propose a change`);
  const where = await call("/assistant", { method: "POST", body: JSON.stringify({ message: "وين أقرب دورة مياه؟", position: position(gate.id) }) });
  assert.equal(where.intent, "location");
  assert.ok(where.sources.some((source) => toilets.some((node) => node.id === source.id)), `${slug}: the toilets answer must point at this event's toilets`);
  assert.equal(where.position?.source, "gps", `${slug}: the answer must count from the visitor's spot`);

  // «حولي» and walking directions on this event's walkways.
  const nearby = await call(`/nearby?category=toilets&${positionQuery(gate.id)}`);
  assert.equal(nearby.origin.source, "gps");
  assert.ok(nearby.results.length > 0 && nearby.results.every((place) => typeof place.walkMin === "number"), `${slug}: «حولي» found nothing`);
  const directions = await call(`/directions?to=${encodeURIComponent(toilets[0].id)}&from=${encodeURIComponent(gate.id)}`);
  assert.equal(directions.mode, "graph");
  assert.equal(directions.steps.at(0)?.id, gate.id);
  assert.equal(directions.steps.at(-1)?.id, toilets[0].id);
  assert.ok(directions.totalWalkMin >= 0);

  // Live state and a replan preview against this event's live revision.
  const live = await call("/live");
  assert.ok(live.revision && live.clock, `${slug}: no live revision or clock`);
  const replan = await call("/itinerary/replan", { method: "POST", body: JSON.stringify({ decision: "preview", baseItineraryId: planned.itineraryId, baseLiveRevision: live.revision }) });
  assert.ok(replan.mode, `${slug}: the replan preview has no mode`);

  await call("/session", { method: "DELETE" });
  return { slug, activities: catalog.activities.length, nodes: nodes.length, stops: stops.length, walkMin: directions.totalWalkMin };
}

const results = [];
for (const slug of slugs) results.push(await checkEvent(slug));
console.log(`any-event flow passed: ${results.map((result) => `${result.slug} (${result.activities} activities, ${result.nodes} nodes, ${result.stops} stops)`).join("; ")}`);
