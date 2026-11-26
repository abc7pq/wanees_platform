// Builds data/sources/boulevard_world_2026_corrected.csv from the team CSV, applying the
// corrections checked against the official BLVD World 2026-27 booklet (page refs inline).
// Usage: node scripts/correct-boulevard-2026-csv.mjs data/sources/boulevard_world_team_activities.csv data/sources/boulevard_world_2026_corrected.csv
import { readFileSync, writeFileSync } from "node:fs";
const [src, out] = process.argv.slice(2);
const text = readFileSync(src, "utf8").replace(/^﻿/, "").replace(/\r/g, "");
function parse(line) { const cells = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === "," && !q) { cells.push(cur); cur = ""; } else cur += c; } cells.push(cur); return cells; }
const lines = text.split("\n").filter(Boolean);
const header = parse(lines[0]);
let rows = lines.slice(1).map((l) => Object.fromEntries(parse(l).map((v, i) => [header[i], v])));
const set = (id, patch) => { const r = rows.find((x) => x.id === id); if (!r) throw new Error(`missing ${id}`); Object.assign(r, patch); };

// Zones: booklet sections (p78 Italy, p91 Mexico, p99-101 Egypt, p128-134 War Zone, p65 Japan, p46 Türkiye).
set("pinocchio", { zone: "إيطاليا" });
set("abandoned_village", { zone: "المكسيك" });
for (const id of ["pubg_outbreak", "black_tomb", "miraq_escape"]) set(id, { zone: "مصر" });
for (const id of ["battle_kart", "battle_dome", "line_of_fire", "shotgun_range", "top_shot", "war_castle", "war_zone"]) set(id, { zone: "أرض الحرب" });
set("grendizer", { zone: "اليابان" });
set("black_museum", { zone: "تركيا" });
set("dolphinarium", { zone: "منطقة الدلافين" });
set("fun_zone", { zone: "فن زون" });
set("skill_games", { zone: "ألعاب المهارة" });
set("cable_car", { zone: "محطة التلفريك", category: "transport", note: "تلفريك يربط بوليفارد سيتي ببوليفارد وورلد" });
set("water_taxi", { name_ar: "ووتر تاكسي" });

// Official names from the booklet cards.
set("amazonia", { name_ar: "أمازونيا أويكنز" });
set("africa_slide", { name_ar: "أفريقيا سلايد", min_age: "0", audience: "all", note: "زحليقة حلزونية لكل الأعمار" });
set("giraffe", { name_ar: "تجربة الزرافات" });
set("lion", { name_ar: "تجربة الأسود" });
set("birds_nest", { name_ar: "تجربة الطيور" });
set("blvd_forest", { name_en: "Forest", name_ar: "الغابة" });
set("dolphinarium", { name_ar: "منطقة الدلافين" });
set("black_museum", { name_ar: "المتحف الغامض" });
set("jumble", { name_ar: "جامبل" });
set("vuz_dome", { name_ar: "ڤيوز دوم سينما" });
set("lagoon_tour", { name_en: "BLVD Lagoon", name_ar: "بوليفارد لاجون" });
set("gondola", { name_en: "Little Venice (Gondola)", name_ar: "ليتل ڤينس (الجندول)" });
set("amphicar", { name_ar: "أمفي كار" });
set("felucca", { name_ar: "قارب الفلوكا" });
set("pinocchio", { name_ar: "بينوكيو الأسرار الداكنة" });
set("grendizer", { name_ar: "غرندايزر" });
set("black_tomb", { name_ar: "المغارة السوداء" });
set("miraq_escape", { name_en: "Miraq Escape Room Adventure", name_ar: "مغامرة سر غرفة الهروب" });
set("war_zone", { name_ar: "أرض الحرب" });
set("shotgun_range", { name_ar: "ميدان الرماية" });
set("war_castle", { name_ar: "وور كاسل" });
set("indonesia_stage", { name_ar: "حفلات وعروض المسرح الإندونيسي" });
set("ksa_retail", { name_ar: "الأسواق الشعبية السعودية" });

// BLVD Pier is an area with three rides (p127), and Taxi Mania is on the 2026 USA card (p102).
const pier = rows.find((r) => r.id === "blvd_pier");
const pierRides = [
  ["star_flyer", "Star Flyer", "ستار فلاير", "لعبة طيران دوّارة على رصيف البوليفارد"],
  ["sky_loop", "Sky Loop", "سكاي لوب", "أفعوانية بسرعات عالية للشجعان"],
  ["turbo_360", "Turbo 360", "تيربو 360", "بندول يدور 360 درجة"],
].map(([id, en, ar, note]) => ({ ...pier, id, name_en: en, name_ar: ar, zone: "بوليفارد بير", note }));
rows.splice(rows.indexOf(pier), 1, ...pierRides);
rows.push({ ...rows.find((r) => r.id === "africa_slide"), id: "taxi_mania", name_en: "Taxi Mania", name_ar: "تاكسي مانيا", zone: "أمريكا", category: "ride", audience: "family,youth", min_age: "0", capacity_per_hour: "300", duration_min: "5", price_sar: "35", indoor: "False", note: "أفعوانية عائلية", new_2026: "False" });

// Indonesia has Concerts & Stage Shows (p120), not a roaming-shows card.
rows = rows.filter((r) => r.id !== "indonesia_show");

// Readable English titles for the generic country cards.
const adjective = { ksa: "Saudi", yemen: "Yemeni", portugal: "Portuguese", uzbekistan: "Uzbek", netherlands: "Dutch", kuwait: "Kuwaiti", africa: "African", turkiye: "Turkish", iran: "Iranian", japan: "Japanese", china: "Chinese", france: "French", italy: "Italian", morocco: "Moroccan", greece: "Greek", mexico: "Mexican", spain: "Spanish", egypt: "Egyptian", usa: "American", india: "Indian", asia: "Asian", korea: "Korean", indonesia: "Indonesian", levant: "Levantine" };
for (const r of rows) {
  const m = r.id.match(/^([a-z]+)_(food|retail|show)$/);
  if (!m || !adjective[m[1]]) continue;
  r.name_en = `${adjective[m[1]]} ${m[2] === "food" ? "Cuisine" : m[2] === "retail" ? (m[1] === "ksa" ? "Traditional Markets" : "Retail") : "Roaming Shows"}`;
}

const esc = (v) => (/[",\n]/.test(v ?? "") ? `"${String(v).replace(/"/g, '""')}"` : (v ?? ""));
writeFileSync(out, [header.join(","), ...rows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n") + "\n");
console.log(`${rows.length} rows written`);
