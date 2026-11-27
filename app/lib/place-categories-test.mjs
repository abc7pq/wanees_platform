import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Site } from "../engine/site.ts";
import { categoryMembers, detectCategory, isRestRequest, nearestCalm, nearestInCategory, splitOriginTarget, zoneFromText } from "./place-categories.ts";

// Audit item 1.5: a 40-phrase test. Each phrase names a category (Arabic, Saudi dialect, English);
// the category is a hard filter, and an origin said in the same message is split from the target.
const PHRASES = [
  ["ابي مطعم", "food"], ["وين المطاعم", "food"], ["جوعان وش فيه اكل", "food"], ["أبغى قهوة", "food"], ["وين نتعشى؟ نبي عشاء", "food"],
  ["where can we eat", "food"], ["any restaurants nearby?", "food"], ["I'm hungry", "food"], ["وين الكافيه", "food"], ["ابي حلا", "food"],
  ["وين أقرب دورة مياه؟", "toilets"], ["وين الحمام", "toilets"], ["ابي توليت", "toilets"], ["where is the toilet", "toilets"], ["restroom please", "toilets"],
  ["وين المصلى", "prayer"], ["ابي اصلي", "prayer"], ["فيه مسجد؟", "prayer"], ["where can I pray", "prayer"], ["prayer room", "prayer"],
  ["وين الإسعاف", "first_aid"], ["ابي ممرض", "first_aid"], ["first aid please", "first_aid"],
  ["وين مكتب المعلومات", "info"], ["ابي استعلامات", "info"], ["information desk", "info"],
  ["وين البوابة", "gate"], ["وين المخرج", "gate"], ["where is the exit", "gate"],
  ["وين المواقف", "parking"], ["where is the parking", "parking"],
  ["ابي محلات هدايا", "shopping"], ["وين التسوق", "shopping"], ["souvenir shops", "shopping"],
  ["وش العروض", "shows"], ["any shows tonight", "shows"],
  ["تعبت ابي مكان اجلس", "seating"],
  ["انا عند جناح افريقيا، دلني على المطاعم", "food", "africa"],
  ["احنا في منطقة مصر وين أقرب حمام", "toilets", "egypt"],
  ["I'm at the japan zone, where is the nearest restaurant?", "food", "japan"],
];
assert.equal(PHRASES.length, 40);

const catalog = JSON.parse(readFileSync(new URL("../data/boulevard_world_2026.json", import.meta.url), "utf8"));
const services = JSON.parse(readFileSync(new URL("../../data/sources/boulevard_world_2026_services.json", import.meta.url), "utf8")).services;
const zones = new Map(catalog.zones.map((zone) => [zone.id, zone]));
// Toilets and prayer rooms as the seed publishes them (one route node per zone on the official map).
catalog.locations = services.filter((service) => zones.has(service.zone)).map((service, index) => ({
  id: `${service.kind}-${service.zone}`, type: "SERVICE", zone: service.zone, x: zones.get(service.zone).x, y: zones.get(service.zone).y,
  label: service.kind === "toilets" ? "دورات المياه" : "المصلى", aliases: service.kind === "toilets" ? ["دورة مياه", "حمام"] : ["مصلى", "مسجد"],
  accessible: true, status: "open", sourceRef: `test:${index}`,
}));
const site = new Site(catalog);

for (const [phrase, category, originZone] of PHRASES) {
  const split = splitOriginTarget(phrase);
  const target = split?.targetText ?? phrase;
  assert.equal(detectCategory(target), category, `${phrase}: category`);
  if (originZone) {
    assert.ok(split, `${phrase}: origin split`);
    assert.equal(zoneFromText(site, split.originText), originZone, `${phrase}: origin zone`);
  }
  // Never another category: every result belongs to the asked category.
  const allowed = new Set(categoryMembers(site, category).map((member) => member.kind === "activity" ? member.activity.id : member.location.id));
  for (const place of nearestInCategory(site, category, originZone ?? null, 3)) assert.ok(allowed.has(place.id), `${phrase}: ${place.id} is not ${category}`);
}

// Food is food: no giraffes and no prayer rooms.
const food = categoryMembers(site, "food");
assert.ok(food.length > 5);
assert.ok(food.every((member) => member.kind === "location" || member.activity.type === "food"));
// From Africa, the nearest food is ranked by walking minutes, nearest first.
const fromAfrica = nearestInCategory(site, "food", "africa", 3);
assert.equal(fromAfrica.length, 3);
assert.ok(fromAfrica[0].walkMin <= fromAfrica[1].walkMin && fromAfrica[1].walkMin <= fromAfrica[2].walkMin);
// The nearest toilet from a zone that has one is that zone's own.
const ownToilet = services.find((service) => service.kind === "toilets" && zones.has(service.zone)).zone;
assert.equal(nearestInCategory(site, "toilets", ownToilet, 1)[0].zone, ownToilet);
// A message with no category and no origin.
assert.equal(detectCategory("كم سعر التلفريك"), null);
assert.equal(splitOriginTarget("ابي مطعم"), null);
// Rest (audit 1.6): «تعبت ابي اقعد» is a rest request; with no published seating, calm activities nearby.
for (const phrase of ["تعبت ابي اقعد", "تعبنا نبي نرتاح", "I'm tired", "رجولي تعبت"]) assert.ok(isRestRequest(phrase), phrase);
for (const phrase of ["ابي مطعم", "وش العروض", "كم سعر التلفريك"]) assert.ok(!isRestRequest(phrase), phrase);
const calm = nearestCalm(site, "africa", 3);
assert.equal(calm.length, 3);
assert.ok(calm.every((place) => place.member.kind === "activity" && (place.member.activity.moods.includes("هادئ") || place.member.activity.tags?.includes("هدوء"))));
assert.ok(calm[0].walkMin <= calm[2].walkMin);
console.log("place categories: 40-phrase test passed");
