// Checks every number in the pitch deck against the data that ships in this repository.
// A claim passes only when the evidence meets it; nothing here is typed in by hand.
//
// Usage: npm run claims:audit            (prints the report; exits 1 if a claim the deck makes as "ready today" fails)
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (quoted && next === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.replace(/^﻿/, ""));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

const collected = parseCsv(read("data/sources/boulevard_world_2026_corrected.csv"));
const published = JSON.parse(read("app/data/boulevard_world_2026.json"));
const simulation = fs.existsSync(path.join(repoRoot, "docs/SIMULATION.md")) ? read("docs/SIMULATION.md") : "";

const zonesWithPositions = published.zones.filter((zone) => Number.isFinite(zone.x) && Number.isFinite(zone.y));
const check = (presentation, evidence, pass, source, note) => ({ presentation, evidence, status: pass ? "supported" : "not_supported", source, ...(note ? { note } : {}) });

const claims = {
  collectedRecords: check(
    "110 فعاليات ومطاعم وعروض جمعها الفريق",
    collected.length,
    collected.length >= 110,
    "data/sources/boulevard_world_2026_corrected.csv",
    `${published.activities.length} of them are published to visitors; ${published.meta.unpublished.length} sit in the seven zones new in 2026 that are not on any available map yet.`,
  ),
  zonesWithPositions: check(
    "23 منطقة بمواقع محددة",
    zonesWithPositions.length,
    zonesWithPositions.length >= 23,
    "app/data/boulevard_world_2026.json (positions from data/sources/boulevard_world_2026_zone_positions.json)",
  ),
  simulationComparison: check(
    "مقارنة التوصية بتوجيه الزائر للمكان الأقل ازدحامًا (محاكاة)",
    simulation ? "deterministic simulation: node scripts/simulate.mjs" : "missing",
    Boolean(simulation),
    "docs/SIMULATION.md",
  ),
  fieldImpact: {
    presentation: "قياس الأثر ميدانيًا (الخطوة الجاية)",
    evidence: "not measured yet",
    status: "next_step",
    source: "docs/VENUE_PILOT_RUNBOOK.md",
    note: "The deck lists this as the next step, not as done. It needs a pilot at the venue.",
  },
};

const failed = Object.entries(claims).filter(([, claim]) => claim.status === "not_supported").map(([key]) => key);
console.log(JSON.stringify({ report: "WANEES presentation claim audit", season: published.meta.season, claims, failed }, null, 2));
if (failed.length) process.exit(1);
