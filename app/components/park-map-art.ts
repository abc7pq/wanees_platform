/** رسم الخريطة المصوّرة للموقع (فن متجهي أصلي مبني على الإحداثيات المعايرة، لا صور منشورة محفوظة الحقوق).
 *  كل الأشكال بوحدات الموقع (x شرقًا، y جنوبًا، الوحدة = 0.62م) لتنطبق على صور القمر الصناعي بالضبط. */

import { BOULEVARD_CABLE_CAR, BOULEVARD_LAGOON, pointInPolygon } from "../../packages/engine/src/venue-geometry.ts";

export type ZoneTheme = { color: string; icon: string; short: string };
export type ArtZone = { id: string; name: string; x: number; y: number };
export type Pt = [number, number];

/** حدود لوحة الرسم بوحدات الموقع */
export const ART_BOUNDS = { minX: -720, minY: -700, maxX: 900, maxY: 800 };

const THEMES: Record<string, ZoneTheme> = {
  lagoon: { color: "#1f8fc4", icon: "🛶", short: "رصيف البحيرة" },
  planet: { color: "#6a5acd", icon: "🪐", short: "الكوكب" },
  italy: { color: "#2e9d5b", icon: "🍝", short: "إيطاليا" },
  vampire: { color: "#7a2140", icon: "🦇", short: "الفامباير" },
  egypt: { color: "#d4a017", icon: "🏺", short: "مصر" },
  saudi: { color: "#1b7f3b", icon: "🌴", short: "السعودية" },
  iran: { color: "#0f8b8d", icon: "🕌", short: "إيران" },
  africa: { color: "#c8742c", icon: "🦒", short: "أفريقيا" },
  courchevel: { color: "#5aa9e6", icon: "⛷️", short: "كورشوفيل" },
  usa: { color: "#2b59c3", icon: "🎬", short: "أمريكا" },
  warzone: { color: "#4b5320", icon: "🎯", short: "وار زون" },
  mexico: { color: "#e4572e", icon: "🌮", short: "المكسيك" },
  spain: { color: "#d7263d", icon: "💃", short: "إسبانيا" },
  morocco: { color: "#b5452a", icon: "🫖", short: "المغرب" },
  france: { color: "#3f6fd8", icon: "🗼", short: "فرنسا" },
  greece: { color: "#2a7fd4", icon: "🏛️", short: "اليونان" },
  turkiye: { color: "#c81d25", icon: "☕", short: "تركيا" },
  japan: { color: "#e05780", icon: "⛩️", short: "اليابان" },
  asia: { color: "#e07a1f", icon: "🥢", short: "آسيا" },
  india: { color: "#f08a24", icon: "🐘", short: "الهند" },
  levant: { color: "#6b8e23", icon: "🫒", short: "الشام" },
  china: { color: "#c0392b", icon: "🏮", short: "الصين" },
  funzone: { color: "#ff7f50", icon: "🎡", short: "فن زون" },
  skills: { color: "#9b59b6", icon: "🎪", short: "ألعاب المهارة" },
};

const FALLBACK_COLORS = ["#8e2bff", "#00806f", "#d4a017", "#c8742c", "#2b59c3", "#2e9d5b", "#e05780", "#6a5acd"];

export function zoneTheme(zone: { id: string; name: string }): ZoneTheme {
  const known = THEMES[zone.id];
  if (known) return known;
  let hash = 0;
  for (const char of zone.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { color: FALLBACK_COLORS[hash % FALLBACK_COLORS.length], icon: "📍", short: zone.name.replace(/^منطقة\s+/, "") };
}

/** شاطئ البحيرة (مُتتبَّع من صور القمر الصناعي) — المصدر المشترك في packages/engine/src/venue-geometry.ts */
export const LAGOON: Pt[] = BOULEVARD_LAGOON;

/** سور الموقع (الحلقة الخارجية) */
export const SITE: Pt[] = [[-300,-470],[-90,-545],[140,-585],[255,-600],[430,-515],[585,-340],[740,-140],[790,60],[770,315],[680,415],[350,570],[30,600],[-225,590],[-385,475],[-585,355],[-612,100],[-592,-195],[-485,-320]];

/** جزيرة إيطاليا ورصيف البحيرة */
const ISLAND = { cx: 280, cy: 55, rx: 62, ry: 56 };
const PIER = { from: [-28, -262] as Pt, head: [0, -140] as Pt };

/** منحنى ناعم مغلق (Catmull-Rom → Bézier) */
export function smoothClosedPath(points: Pt[], tension = 0.5): string {
  const n = points.length;
  if (n < 3) return "";
  const p = (i: number) => points[(i + n) % n];
  let d = `M${p(0)[0]},${p(0)[1]}`;
  for (let i = 0; i < n; i += 1) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1: Pt = [p1[0] + ((p2[0] - p0[0]) * tension) / 3, p1[1] + ((p2[1] - p0[1]) * tension) / 3];
    const c2: Pt = [p2[0] - ((p3[0] - p1[0]) * tension) / 3, p2[1] - ((p3[1] - p1[1]) * tension) / 3];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return `${d} Z`;
}

/** مولد عشوائي حتمي — نفس المنطقة ترسم بنفس الشكل دائمًا */
function seeded(seedText: string) {
  let a = 0;
  for (const char of seedText) a = (a * 131 + char.charCodeAt(0)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function insideLagoon(x: number, y: number) {
  return pointInPolygon(x, y, LAGOON);
}

function districtArt(zone: ArtZone, theme: ZoneTheme): string {
  if (zone.id === "lagoon") return "";
  const rand = seeded(zone.id);
  let out = `<circle cx="${zone.x}" cy="${zone.y}" r="74" fill="${theme.color}" fill-opacity=".13"/>`;
  out += `<circle cx="${zone.x}" cy="${zone.y}" r="74" fill="none" stroke="${theme.color}" stroke-opacity=".35" stroke-width="3" stroke-dasharray="10 8"/>`;
  // مبانٍ صغيرة بسقوف بلون المنطقة
  for (let i = 0; i < 6; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = 22 + rand() * 40;
    const x = zone.x + Math.cos(angle) * radius;
    const y = zone.y + Math.sin(angle) * radius;
    if (insideLagoon(x, y)) continue;
    const w = 16 + rand() * 16;
    const h = 12 + rand() * 12;
    out += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(rand() * 40 - 20).toFixed(0)})">`
      + `<rect x="${(-w / 2).toFixed(1)}" y="${(-h / 2 + 3).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="#000" opacity=".12"/>`
      + `<rect x="${(-w / 2).toFixed(1)}" y="${(-h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="#fffaf0" stroke="${theme.color}" stroke-width="2"/>`
      + `<rect x="${(-w / 2).toFixed(1)}" y="${(-h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${(h * 0.42).toFixed(1)}" rx="3" fill="${theme.color}" opacity=".85"/></g>`;
  }
  return out;
}

function trees(): string {
  const rand = seeded("trees");
  let out = "";
  const ring = SITE;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.floor(length / 46);
    for (let s = 0; s < steps; s += 1) {
      const t = (s + 0.5) / steps;
      // داخل السور قليلًا نحو المركز
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const ix = x + (140 - x) * 0.05 + (rand() - 0.5) * 10;
      const iy = y + (40 - y) * 0.05 + (rand() - 0.5) * 10;
      const r = 9 + rand() * 5;
      out += `<circle cx="${ix.toFixed(1)}" cy="${(iy + 3).toFixed(1)}" r="${r.toFixed(1)}" fill="#000" opacity=".1"/><circle cx="${ix.toFixed(1)}" cy="${iy.toFixed(1)}" r="${r.toFixed(1)}" fill="${rand() > 0.5 ? "#5fa85a" : "#4c9a4f"}"/>`;
    }
  }
  return out;
}

/** التلفريك: كابل رفيع بعربات حمراء ومحطتان */
function cableCarArt(): string {
  const [[ax, ay], [bx, by]] = BOULEVARD_CABLE_CAR.line;
  let out = `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#2d2a3a" stroke-width="3" stroke-linecap="round" opacity=".75"/>`;
  const length = Math.hypot(bx - ax, by - ay);
  const cabins = Math.floor(length / 140);
  for (let index = 1; index < cabins; index += 1) {
    const t = index / cabins;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    out += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + 9).toFixed(1)}" stroke="#2d2a3a" stroke-width="2"/><rect x="${(x - 9).toFixed(1)}" y="${(y + 9).toFixed(1)}" width="18" height="15" rx="4" fill="#e0402f" stroke="#fff" stroke-width="2"/>`;
  }
  for (const station of BOULEVARD_CABLE_CAR.stations) {
    out += `<rect x="${station.x - 22}" y="${station.y - 16}" width="44" height="32" rx="8" fill="#4a3b6b" stroke="#fff" stroke-width="4"/><rect x="${station.x - 12}" y="${station.y - 6}" width="24" height="12" rx="3" fill="#e0402f"/>`;
  }
  return out;
}

/** لوحة SVG كاملة للخريطة المصوّرة (تُغلف بـ L.svgOverlay) */
export function buildParkSvg(zones: ArtZone[]): string {
  const { minX, minY, maxX, maxY } = ART_BOUNDS;
  const lagoonPath = smoothClosedPath(LAGOON);
  const sitePath = smoothClosedPath(SITE, 0.35);
  const districts = zones.map((zone) => districtArt(zone, zoneTheme(zone))).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" preserveAspectRatio="none">
<defs>
  <radialGradient id="pm-water" cx="45%" cy="40%" r="70%"><stop offset="0" stop-color="#6fd0f2"/><stop offset=".65" stop-color="#3aa6dc"/><stop offset="1" stop-color="#2386c2"/></radialGradient>
  <pattern id="pm-waves" width="60" height="36" patternUnits="userSpaceOnUse"><path d="M4 18c8-7 14-7 22 0s14 7 22 0" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width="2.4" stroke-linecap="round"/></pattern>
  <pattern id="pm-sand" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="8" cy="10" r="1.6" fill="#d9c49c" opacity=".55"/><circle cx="28" cy="26" r="1.3" fill="#d9c49c" opacity=".5"/></pattern>
</defs>
<rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="#ece7fd"/>
<path d="${sitePath}" fill="#000" opacity=".08" transform="translate(0 10)"/>
<path d="${sitePath}" fill="#f6ecd8" stroke="#d8c3a0" stroke-width="7"/>
<path d="${sitePath}" fill="url(#pm-sand)"/>
${trees()}
${districts}
<path d="${lagoonPath}" fill="none" stroke="#fffaf0" stroke-width="44" stroke-linejoin="round"/>
<path d="${lagoonPath}" fill="none" stroke="#e3cfa9" stroke-width="46" stroke-linejoin="round" stroke-opacity=".35" stroke-dasharray="2 18"/>
<path d="${lagoonPath}" fill="url(#pm-water)" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/>
<path d="${lagoonPath}" fill="url(#pm-waves)"/>
<line x1="${PIER.from[0]}" y1="${PIER.from[1]}" x2="${PIER.head[0]}" y2="${PIER.head[1]}" stroke="#fffaf0" stroke-width="16" stroke-linecap="round"/>
<circle cx="${PIER.head[0]}" cy="${PIER.head[1]}" r="26" fill="#fffaf0" stroke="#e3cfa9" stroke-width="4"/>
<ellipse cx="${ISLAND.cx}" cy="${ISLAND.cy + 6}" rx="${ISLAND.rx}" ry="${ISLAND.ry}" fill="#000" opacity=".12"/>
<ellipse cx="${ISLAND.cx}" cy="${ISLAND.cy}" rx="${ISLAND.rx}" ry="${ISLAND.ry}" fill="#f6ecd8" stroke="#ffffff" stroke-width="5"/>
${cableCarArt()}
</svg>`;
}
