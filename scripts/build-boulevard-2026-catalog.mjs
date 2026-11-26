// Builds the 2026-27 Boulevard World catalog that the seed publishes (app/data/boulevard_world_2026.json).
//
// Inputs, all in this repository:
//   data/sources/boulevard_world_2026_corrected.csv      team records corrected against the official 2026-27 booklet
//   data/sources/boulevard_world_2026_zone_positions.json zone coordinates traced from satellite imagery and the official park map
//   app/data/boulevard_world.json                          the 2024 fixture: planning fields (interests, moods, show times) for activities it shares
//
// Rules:
//   - A record is published only when its zone has a map position. Records in zones that are not on any map we have
//     (the seven zones new in 2026) stay in the source CSV and are counted by `npm run claims:audit`, never invented.
//   - Prices are the team's estimates from the corrected CSV.
//   - Show times and popularity weights are planning assumptions, as in the 2024 fixture; the venue publishes neither.
//   - Every activity gets a description (the booklet note, or a factual sentence built from its category, zone and
//     audience) and at least ${MIN_ACTIVITY_TAGS} controlled tags (category tags plus tags named in its name or note).
//     The build fails if any published activity misses either (audit item 1.3).
//
// Usage: node scripts/build-boulevard-2026-catalog.mjs [--check]
//   --check fails if the committed JSON differs from a fresh build (used in CI).
import { readFileSync, writeFileSync } from "node:fs";
import { tagsInText } from "../packages/engine/src/tags.ts";
import { activityContentIssues, MIN_ACTIVITY_TAGS } from "../packages/engine/src/content-rules.ts";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const OUT = "app/data/boulevard_world_2026.json";

function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").replace(/\r/g, "").split("\n").filter(Boolean);
  const parse = (line) => {
    const cells = []; let cur = ""; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
      else if (c === "," && !quoted) { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    return cells;
  };
  const header = parse(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(parse(line).map((value, index) => [header[index], value])));
}

const records = parseCsv(read("data/sources/boulevard_world_2026_corrected.csv"));
const positions = JSON.parse(read("data/sources/boulevard_world_2026_zone_positions.json"));
const fixture = JSON.parse(read("app/data/boulevard_world.json"));
const fixtureActivities = new Map(fixture.activities.map((activity) => [activity.id, activity]));
const fixtureZones = new Map(fixture.zones.map((zone) => [zone.id, zone]));

// Zone names as visitors read them. Coordinates come only from the positions file.
const ZONE_NAMES = {
  lagoon: "البحيرة المركزية", pier: "بوليفارد بير", planet: "منطقة الكوكب", warzone: "وار زون", saudi: "منطقة المملكة العربية السعودية",
  africa: "منطقة أفريقيا", turkiye: "منطقة تركيا", italy: "منطقة إيطاليا والبندقية", japan: "منطقة اليابان", mexico: "منطقة المكسيك",
  egypt: "منطقة مصر", iran: "منطقة إيران", china: "منطقة الصين", france: "منطقة فرنسا", morocco: "منطقة المغرب", greece: "منطقة اليونان",
  spain: "منطقة إسبانيا", usa: "منطقة أمريكا وهوليوود", india: "الحي الهندي", asia: "قرية آسيا", levant: "منطقة الشام",
  skills: "ساحة ألعاب المهارة", funzone: "منطقة المرح والألعاب",
};
// The cable car station is a transport stop, not a visitor zone: its ride belongs to the nearest zone.
const NOT_A_ZONE = new Set(["cable_car"]);

const zoneByArabicName = new Map();
const zoneById = new Map();
for (const zone of positions.zones) {
  if (zone.x == null || zone.y == null) continue;
  zoneByArabicName.set(zone.name_ar, zone);
  if (NOT_A_ZONE.has(zone.id) || zoneById.has(zone.id)) continue;
  zoneById.set(zone.id, { id: zone.id, name: ZONE_NAMES[zone.id] ?? zone.name_ar, x: zone.x, y: zone.y, popularity: fixtureZones.get(zone.id)?.popularity ?? 0.75 });
}
const nearestZone = (point) => [...zoneById.values()].sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))[0];

const TYPE_BY_CATEGORY = {
  food: "food", shopping: "shopping", show: "show", animals: "wildlife", show_animals: "show", water: "water", thrill_water: "water",
  transport_water: "water", horror: "horror", shooting: "game", action: "game", skill: "game", puzzle: "game", vr: "experience",
  immersive: "experience", cinema: "experience", family_active: "experience", kids: "ride", ride: "ride", thrill: "ride",
  transport: "experience", landmark: "culture",
};
const INTERESTS_BY_TYPE = {
  food: ["طعام"], shopping: ["تسوق", "ثقافة"], show: ["عروض", "ثقافة"], wildlife: ["طبيعة", "عائلة"], water: ["استرخاء", "مغامرة"],
  horror: ["مغامرة"], game: ["ألعاب", "مغامرة"], experience: ["ألعاب", "عائلة"], ride: ["مغامرة", "عائلة"], culture: ["ثقافة"],
};
const MOODS_BY_TYPE = {
  food: ["هادئ", "مرح"], shopping: ["هادئ"], show: ["مرح", "هادئ"], wildlife: ["مرح", "هادئ"], water: ["هادئ", "مرح"],
  horror: ["متحمس"], game: ["متحمس"], experience: ["متحمس", "مرح"], ride: ["متحمس", "مرح"], culture: ["هادئ"],
};
// Controlled tags (packages/engine/src/tags.ts) every activity of a category carries.
const TAGS_BY_CATEGORY = {
  food: ["أكل", "هدوء", "ثقافة"], shopping: ["تسوق", "ثقافة", "هدوء"], show: ["عروض", "ثقافة", "موسيقى"],
  animals: ["حيوانات", "أطفال", "تصوير"], show_animals: ["حيوانات", "عروض", "أطفال"], water: ["ماء", "هدوء", "تصوير"],
  thrill_water: ["ماء", "إثارة", "تصوير"], transport_water: ["ماء", "هدوء", "تصوير"], horror: ["رعب", "إثارة", "ألعاب"],
  shooting: ["رماية", "ألعاب", "إثارة"], action: ["إثارة", "ألعاب", "رياضة"], skill: ["ألعاب", "أطفال", "رياضة"],
  puzzle: ["ألعاب", "أطفال", "هدوء"], vr: ["واقع افتراضي", "ألعاب", "إثارة"], immersive: ["واقع افتراضي", "ألعاب", "تصوير"],
  cinema: ["عروض", "هدوء", "واقع افتراضي"], family_active: ["أطفال", "ألعاب", "رياضة"], kids: ["أطفال", "ألعاب", "هدوء"],
  ride: ["إثارة", "أطفال", "ألعاب"], thrill: ["إثارة", "ألعاب", "تصوير"], transport: ["تصوير", "هدوء", "طيران"],
  landmark: ["تصوير", "ثقافة", "تاريخ"],
};
// What an activity of a category is, for the description when the booklet gives none.
const CATEGORY_PHRASE = {
  food: "مطعم ومأكولات", shopping: "محل تسوق", show: "عرض حي", animals: "تجربة حيوانات", show_animals: "عرض حيوانات",
  water: "تجربة مائية", thrill_water: "تجربة مائية مثيرة", transport_water: "جولة بالقارب", horror: "تجربة رعب",
  shooting: "لعبة رماية وتصويب", action: "تجربة حركة وأكشن", skill: "ألعاب مهارة", puzzle: "ألعاب ألغاز", vr: "تجربة واقع افتراضي",
  immersive: "تجربة تفاعلية غامرة", cinema: "عرض سينمائي", family_active: "نشاط حركي للعائلة", kids: "ألعاب للأطفال",
  ride: "لعبة", thrill: "لعبة إثارة", transport: "رحلة معلّقة", landmark: "معلم للتصوير",
};

function activityTagsFor(record, type) {
  const fromText = tagsInText([record.name_ar, record.name_en, record.note].filter(Boolean).join(" "));
  const base = TAGS_BY_CATEGORY[record.category] ?? TAGS_BY_CATEGORY[type] ?? ["ثقافة", "تصوير", "هدوء"];
  const minAge = Number(record.min_age) || 0;
  const audience = record.audience.split(",").map((value) => value.trim());
  // «أطفال» marks what is made for children, not everything a child may enter.
  const kids = minAge < 6 && audience.includes("kids") ? ["أطفال"] : [];
  // A horror tag on a children's activity would hide it from families; only horror categories carry it.
  const tags = [...new Set([...fromText, ...base, ...kids])].filter((tag) => tag !== "رعب" || record.category === "horror");
  return tags.slice(0, 8);
}

function descriptionFor(record, zoneName) {
  const note = record.note?.trim();
  if (note) return note.endsWith(".") ? note : `${note}.`;
  const minAge = Number(record.min_age) || 0;
  const audience = record.audience.split(",").map((value) => value.trim());
  const who = minAge >= 12 ? `من عمر ${minAge} سنة` : audience.includes("kids") ? "مناسب للأطفال" : audience.includes("family") || audience.includes("all") ? "مناسب للعائلة" : "";
  return [`${CATEGORY_PHRASE[record.category] ?? "تجربة"} في ${zoneName}`, who].filter(Boolean).join("، ") + ".";
}

function highlightsFor(record) {
  return [
    record.new_2026 === "True" ? "جديد موسم 2026-27" : null,
    record.indoor === "True" ? "داخلي" : null,
  ].filter(Boolean);
}

const OPEN = { type: "continuous", from: 1020, to: 1400 };
const FOOD_HOURS = { type: "continuous", from: 1020, to: 1420 };
// Roaming and stage shows: the venue publishes no timetable, so shows run on a fixed planning grid.
const SHOW_SLOTS = [[1080, 1170, 1260, 1350], [1110, 1200, 1290], [1140, 1230, 1320]];

// Display names where the booklet's section title is not what visitors call the activity.
const NAME_OVERRIDES = { dolphinarium: "عرض الدولفيناريوم" };
// Planning assumption: the dolphin show runs hourly from 18:30 (the venue publishes no timetable).
const SCHEDULE_OVERRIDES = { dolphinarium: { type: "slots", slots: [1110, 1170, 1230, 1290, 1350] } };

const activities = [];
const unpublished = [];
let showIndex = 0;
for (const record of records) {
  const position = zoneByArabicName.get(record.zone);
  if (!position) { unpublished.push({ id: record.id, zone: record.zone, reason: "zone not on any available map" }); continue; }
  const zone = NOT_A_ZONE.has(position.id) ? nearestZone(position) : zoneById.get(position.id);
  const shared = fixtureActivities.get(record.id);
  const type = shared?.type ?? TYPE_BY_CATEGORY[record.category] ?? (record.type === "retail" ? "shopping" : record.type === "show" ? "show" : "experience");
  const minAge = Number(record.min_age) || 0;
  const audience = record.audience.split(",").map((value) => value.trim());
  const family = minAge < 12 && (audience.includes("all") || audience.includes("family") || audience.includes("kids"));
  const schedule = SCHEDULE_OVERRIDES[record.id] ?? shared?.schedule
    ?? (type === "show" ? { type: "slots", slots: SHOW_SLOTS[showIndex++ % SHOW_SLOTS.length] } : type === "food" ? FOOD_HOURS : OPEN);
  const highlights = highlightsFor(record);
  activities.push({
    id: record.id,
    name: NAME_OVERRIDES[record.id] ?? record.name_ar,
    name_en: record.name_en,
    description: descriptionFor(record, zone.name),
    zone: zone.id,
    type,
    duration_min: Number(record.duration_min),
    price: Number(record.price_sar),
    family,
    ...(minAge > 0 ? { min_age: minAge } : {}),
    tags: activityTagsFor(record, type),
    ...(highlights.length ? { highlights } : {}),
    interests: shared?.interests ?? INTERESTS_BY_TYPE[type] ?? ["عائلة"],
    moods: shared?.moods ?? MOODS_BY_TYPE[type] ?? ["مرح"],
    popularity: shared?.popularity ?? (record.new_2026 === "True" ? 0.75 : 0.65),
    schedule,
  });
}

// Places renamed between the 2024 fixture and the 2026 booklet. They are the same place, so the
// published catalog may carry only one of each pair; two entries would mean two prices for one place.
// The 2024 planning fields are deliberately not copied across: 2026 values come from the corrected CSV.
const RENAMED_SINCE_2024 = { tante: "tant", metaworld: "meta_world", lions: "lion", topshot: "top_shot", spain_roaming: "spain_show" };
const publishedIds = new Set(activities.map((activity) => activity.id));
for (const [oldId, newId] of Object.entries(RENAMED_SINCE_2024)) {
  if (publishedIds.has(oldId) && publishedIds.has(newId)) {
    throw new Error(`Duplicate place: ${oldId} (2024 id) and ${newId} (2026 id) are both published. Keep one record in the CSV.`);
  }
}
const normalizedName = (name) => name.replace(/\s*[—–-].*$/, "").replace(/\s+/g, " ").trim();
const seenNames = new Map();
for (const activity of activities) {
  const key = `${activity.zone}:${normalizedName(activity.name)}`;
  if (seenNames.has(key)) throw new Error(`Duplicate place in ${activity.zone}: ${seenNames.get(key)} and ${activity.id} share the name «${activity.name}».`);
  seenNames.set(key, activity.id);
}

// Audit item 1.3: no published activity without a description or with fewer than ${MIN_ACTIVITY_TAGS} tags.
const contentIssues = activities.flatMap((activity) => activityContentIssues({ stableKey: activity.id, descriptionAr: activity.description, tags: activity.tags }));
if (contentIssues.length) {
  for (const issue of contentIssues) console.error(`${issue.entity}: ${issue.message}`);
  throw new Error(`${contentIssues.length} content issue(s): every published activity needs a description and ${MIN_ACTIVITY_TAGS}+ tags.`);
}

const usedZones = new Set(activities.map((activity) => activity.zone));
const zones = [...zoneById.values()].filter((zone) => usedZones.has(zone.id));
const catalog = {
  meta: {
    source: "دليل بوليفارد وورلد 2026-27 الرسمي + بيانات فريق ونيس",
    note: "الأسعار تقديرية من بيانات الفريق. مواعيد العروض والإقبال افتراضات تخطيط.",
    currency: "SAR",
    season: "2026-27",
    collected_records: records.length,
    published_records: activities.length,
    unpublished,
  },
  site: fixture.site,
  zones,
  activities,
};

const text = `${JSON.stringify(catalog, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = read(OUT);
  if (current !== text) { console.error(`${OUT} is out of date: run node scripts/build-boulevard-2026-catalog.mjs`); process.exit(1); }
  console.log(`${OUT} is up to date.`);
} else {
  writeFileSync(new URL(OUT, root), text);
}
console.log(`collected ${records.length} · published ${activities.length} in ${zones.length} zones · ${unpublished.length} waiting for a map position`);
