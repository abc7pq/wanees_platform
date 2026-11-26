"use client";

/** خريطة الموقع:
 *  - الافتراضي: «مخطط» مصوّر أصلي للموقع (بحيرة، مناطق بألوانها وأيقوناتها، ممرات المشي) فوق الإحداثيات الجغرافية المعايرة.
 *  - «قمر صناعي»: صور Esri الحقيقية بنفس العلامات والمسارات (تنطبق لأن الإحداثيات معايرة على الصور).
 *  - طبقة الزحام بنمط Google: تلوين الممرات والمناطق حسب القراءات الحية (أجهزة الزوار المجهولة + المشغل + المحاكاة).
 *  - «موقعي»: نقطة زرقاء حية من GPS الجهاز، ومشاركة مجهولة اختيارية للمنطقة فقط لقياس الزحام.
 *  - NEXT_PUBLIC_GOOGLE_MAPS_KEY موجود → Google Maps؛ فشل البيانات → مخطط SVG المحلي (VenueMap2D). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";
import { fromLatLng, toLatLng, planarDistanceMeters, useVenueMapData, type VenueMapData } from "./useVenueMapData";
import { ART_BOUNDS, buildParkSvg, zoneTheme } from "./park-map-art";
import { BOULEVARD_CABLE_CAR } from "../../packages/engine/src/venue-geometry.ts";

const VenueGoogleMap = dynamic(() => import("./VenueGoogleMap").then((m) => ({ default: m.VenueGoogleMap })), { ssr: false });
const VenueMap2DFallback = dynamic(() => import("@/components/VenueMap2D").then((m) => ({ default: m.VenueMap2D })), {
  ssr: false,
  loading: () => <div className="map-card">جارٍ تجهيز الخريطة…</div>,
});

type Stop = { zone: string };
type Point = { x: number; y: number };
export type MapCrowdRow = {
  zone: string;
  level: number;
  source?: string;
  hourly?: Array<{ hour: number; level: number; live: boolean }>;
  quietestUpcomingHour?: number | null;
};
export type MapMe = Point & { target?: Point; heading?: number | null; accuracyM?: number | null };
type VenueGeoMapProps = {
  stops: Stop[];
  eventSlug: string;
  focusId?: string | null;
  path?: Point[] | null;
  me?: MapMe | null;
  crowd?: MapCrowdRow[];
  crowdThreshold?: number;
  onNavigate?: (placeId: string) => void;
};

const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
const PRESENCE_CONSENT_KEY = "wanees:presence-consent";
const PRESENCE_INTERVAL_MS = 20_000;

export function VenueGeoMap(props: VenueGeoMapProps) {
  const { eventSlug, stops, focusId, path } = props;
  if (eventSlug !== "boulevard-world-demo" && eventSlug !== "boulevard_world") {
    return <VenueMap2DFallback stops={stops} eventSlug={eventSlug} focusId={focusId} path={path} />;
  }
  return <BoulevardWorldMap key={eventSlug} {...props} />;
}

function BoulevardWorldMap(props: VenueGeoMapProps) {
  const { stops, eventSlug, focusId, path, me } = props;
  const [failed, setFailed] = useState(false);
  const [googleLoadFailed, setGoogleLoadFailed] = useState(false);
  const data = useVenueMapData(eventSlug, useCallback(() => setFailed(true), []));
  const onGoogleLoadFailed = useCallback(() => setGoogleLoadFailed(true), []);
  const onParkFailed = useCallback(() => setFailed(true), []);

  if (failed) return <VenueMap2DFallback stops={stops} eventSlug={eventSlug} focusId={focusId} path={path} />;
  if (GOOGLE_MAPS_KEY && !googleLoadFailed) {
    return (
      <div className="map-card geo-map-card" aria-label="خريطة مسار الزيارة على Google Maps">
        <VenueGoogleMap data={data} stops={stops} focusId={focusId} path={path} me={me} apiKey={GOOGLE_MAPS_KEY} loadErrorFallback={onGoogleLoadFailed} />
      </div>
    );
  }
  return <ParkMap {...props} data={data} onError={onParkFailed} />;
}

/* ---------------- أدوات ---------------- */

export function crowdTone(level: number | undefined, threshold = 0.75): "calm" | "busy" | "packed" | "unknown" {
  if (level == null || !Number.isFinite(level)) return "unknown";
  if (level >= threshold) return "packed";
  if (level >= threshold * 0.65) return "busy";
  return "calm";
}
const TONE_COLOR = { calm: "#1e9e5a", busy: "#f29d12", packed: "#e0402f", unknown: "#9a8fb0" } as const;
const TONE_TEXT = { calm: "هادئ الآن", busy: "حركة متوسطة", packed: "مزدحم الآن", unknown: "لا توجد قراءة" } as const;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

/** «أوقات الذروة»: عمود لكل ساعة تشغيل، والساعة الحالية بالقراءة الحية */
function PopularTimes({ row, threshold }: { row: MapCrowdRow; threshold: number }) {
  const label = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  return (
    <div className="pm-times" aria-label="أوقات الذروة المتوقعة">
      <span className="pm-times-title">أوقات الذروة</span>
      <div className="pm-bars">
        {(row.hourly ?? []).map((entry) => {
          const tone = crowdTone(entry.level, threshold);
          return (
            <span key={entry.hour} className={`pm-bar${entry.live ? " is-now" : ""}`} style={{ ["--h" as string]: `${Math.max(8, Math.round(entry.level * 100))}%`, ["--c" as string]: TONE_COLOR[tone] }} title={`${label(entry.hour)} · ${TONE_TEXT[tone]}`}>
              <i /><small>{entry.hour % 2 === 1 ? entry.hour : ""}</small>
            </span>
          );
        })}
      </div>
      {row.quietestUpcomingHour != null && <span className="pm-quiet">🌙 أهدأ وقت قادم: <b dir="ltr">{label(row.quietestUpcomingHour)}</b></span>}
    </div>
  );
}

function serviceIcon(location: { type: string; label: string }) {
  if (location.type === "ENTRANCE") return "🚪";
  if (/مياه|حمام/.test(location.label)) return "🚻";
  if (/إسعاف|طبي/.test(location.label)) return "⛑️";
  if (/معلومات|استعلام/.test(location.label)) return "ℹ️";
  if (/صلاة|مصلى/.test(location.label)) return "🕌";
  return "📍";
}

type Graph = { adjacency: Map<string, Array<{ to: string; cost: number }>>; nodes: Map<string, { id: string; x: number; y: number; zone?: string }> };

function buildGraph(data: VenueMapData): Graph {
  const nodes = new Map<string, { id: string; x: number; y: number; zone?: string }>();
  for (const node of data.routeGraph?.nodes ?? []) if (node.status === "open") nodes.set(node.id, { ...node });
  for (const location of data.locations) {
    const node = nodes.get(location.id);
    if (node && location.zone) node.zone = location.zone;
  }
  const adjacency = new Map<string, Array<{ to: string; cost: number }>>();
  for (const edge of data.routeGraph?.edges ?? []) {
    if (edge.status !== "open") continue;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const list = adjacency.get(edge.from) ?? [];
    list.push({ to: edge.to, cost: Math.hypot(from.x - to.x, from.y - to.y) });
    adjacency.set(edge.from, list);
  }
  return { adjacency, nodes };
}

/** هندسة الرسم فقط: يتبع الخط الممرات المنشورة بدل القفز فوق البحيرة (الأزمنة تأتي من الخادم) */
function graphPath(graph: Graph, fromId: string, toId: string): string[] | null {
  if (fromId === toId) return [fromId];
  const dist = new Map<string, number>([[fromId, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  while (true) {
    let current: string | undefined;
    let best = Infinity;
    for (const [id, d] of dist) if (!done.has(id) && d < best) { best = d; current = id; }
    if (!current) return null;
    if (current === toId) {
      const out = [toId];
      while (prev.has(out[0])) out.unshift(prev.get(out[0])!);
      return out;
    }
    done.add(current);
    for (const edge of graph.adjacency.get(current) ?? []) {
      const next = best + edge.cost;
      if (next < (dist.get(edge.to) ?? Infinity)) { dist.set(edge.to, next); prev.set(edge.to, current); }
    }
  }
}

function zoneNodeId(graph: Graph, zoneId: string) {
  if (graph.nodes.has(`zone-${zoneId}`)) return `zone-${zoneId}`;
  for (const node of graph.nodes.values()) if (node.zone === zoneId) return node.id;
  return null;
}

type CrowdFeed = { threshold: number; zones: MapCrowdRow[] };

/** تغذية الزحام لكل المناطق (قياس الأجهزة ← المشغل ← تقدير) كل 15 ثانية والصفحة ظاهرة */
function useCrowdFeed(eventSlug: string) {
  const [feed, setFeed] = useState<CrowdFeed | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = window.setTimeout(load, 15_000);
        return;
      }
      try {
        const response = await fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/crowd`, { credentials: "include" });
        if (response.ok) {
          const payload = await response.json();
          if (!cancelled && Array.isArray(payload.data?.zones)) setFeed({ threshold: Number(payload.data.threshold) || 0.75, zones: payload.data.zones });
        }
      } catch {
        // بلا اتصال: تبقى آخر قراءة معروضة
      }
      if (!cancelled) timer = window.setTimeout(load, 15_000);
    };
    void load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [eventSlug]);
  return feed;
}

/* ---------------- الخريطة ---------------- */

type ParkMapProps = VenueGeoMapProps & { data: VenueMapData; onError: () => void };

function ParkMap({ data, stops, eventSlug, focusId, path, me, crowd, crowdThreshold = 0.75, onNavigate, onError }: ParkMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const layersRef = useRef<{ satellite?: import("leaflet").TileLayer; art?: import("leaflet").SVGOverlay; main?: import("leaflet").LayerGroup; me?: import("leaflet").LayerGroup }>({});
  const fitZoomRef = useRef(15);
  const fittedRef = useRef(false);
  const lastPathKey = useRef("");
  const lastFocus = useRef<string | null>(null);
  const [selected, setSelected] = useState<{ kind: "zone" | "place" | "landmark"; id: string } | null>(null);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;

  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"art" | "satellite">("art");
  const [crowdLayer, setCrowdLayer] = useState(true);
  const [zoomTier, setZoomTier] = useState(0);
  const [localFix, setLocalFix] = useState<(MapMe & { lat: number; lng: number }) | null>(null);
  const [locating, setLocating] = useState(false);
  const [consentAsk, setConsentAsk] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState("");
  const watchRef = useRef<number | null>(null);
  const lastPresenceAt = useRef(0);

  const feed = useCrowdFeed(eventSlug);
  const crowdRows = useMemo(() => {
    // التغذية الحية لكل المناطق، مع تقديم أي قراءة مقاسة أحدث وصلت عبر /live
    const merged = new Map((feed?.zones ?? []).map((row) => [row.zone, row]));
    for (const row of crowd ?? []) {
      const current = merged.get(row.zone);
      if (!current || current.source === "estimate" || row.source === "sensor") merged.set(row.zone, { ...current, ...row, hourly: current?.hourly, quietestUpcomingHour: current?.quietestUpcomingHour });
    }
    return [...merged.values()];
  }, [crowd, feed]);
  const crowdByZone = useMemo(() => new Map(crowdRows.map((row) => [row.zone, row])), [crowdRows]);
  const measuredLive = crowdRows.some((row) => row.source === "sensor" || row.source === "integration");
  const threshold = feed?.threshold ?? crowdThreshold;
  const graph = useMemo(() => buildGraph(data), [data]);

  // ---- تهيئة Leaflet مرة واحدة ----
  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | null = null;
    let resizeObserver: ResizeObserver | undefined;
    (async () => {
      try {
        if (!containerRef.current || mapRef.current) return;
        const L = (await import("leaflet")).default;
        if (cancelled || !containerRef.current) return;
        leafletRef.current = L;
        const artBounds = L.latLngBounds(toLatLng(ART_BOUNDS.minX, ART_BOUNDS.maxY), toLatLng(ART_BOUNDS.maxX, ART_BOUNDS.minY));
        map = L.map(containerRef.current, {
          zoomControl: false,
          attributionControl: false,
          zoomSnap: 0.25,
          zoomDelta: 0.5,
          wheelPxPerZoomLevel: 90,
          maxBounds: artBounds.pad(0.15),
          maxBoundsViscosity: 0.9,
          maxZoom: 20,
        });
        L.control.attribution({ prefix: false, position: "bottomleft" }).addTo(map);
        map.createPane("pm-streets").style.zIndex = "405";
        map.createPane("pm-route").style.zIndex = "420";
        layersRef.current.satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 20,
          maxNativeZoom: 19,
          attribution: "Imagery © Esri",
        });
        layersRef.current.main = L.layerGroup().addTo(map);
        layersRef.current.me = L.layerGroup().addTo(map);
        const siteBounds = L.latLngBounds(toLatLng(-630, 610), toLatLng(800, -600));
        map.fitBounds(siteBounds, { padding: [8, 8] });
        fitZoomRef.current = map.getZoom();
        map.setMinZoom(fitZoomRef.current - 0.75);
        const updateTier = () => {
          const relative = (map?.getZoom() ?? 0) - fitZoomRef.current;
          setZoomTier(relative < 0.7 ? 0 : relative < 1.6 ? 1 : 2);
        };
        map.on("zoomend", updateTier);
        map.on("click", () => setSelected(null));
        updateTier();
        mapRef.current = map;
        resizeObserver = new ResizeObserver(([entry]) => {
          if (!cancelled && entry.contentRect.width > 0 && entry.contentRect.height > 0) map?.invalidateSize();
        });
        resizeObserver.observe(containerRef.current);
        if (!cancelled) setReady(true);
      } catch {
        onError();
      }
    })();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      map?.remove();
      mapRef.current = null;
      layersRef.current = {};
    };
  }, [onError]);

  // ---- اللوحة المصوّرة (تُبنى عند وصول المناطق) ----
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map || !data.zones.length) return;
    const holder = document.createElement("div");
    holder.innerHTML = buildParkSvg(data.zones);
    const svg = holder.firstElementChild as SVGSVGElement;
    const bounds = L.latLngBounds(toLatLng(ART_BOUNDS.minX, ART_BOUNDS.maxY), toLatLng(ART_BOUNDS.maxX, ART_BOUNDS.minY));
    const overlay = L.svgOverlay(svg, bounds, { interactive: false, className: "pm-art" });
    layersRef.current.art?.remove();
    layersRef.current.art = overlay;
    if (mode === "art") overlay.addTo(map);
    return () => { overlay.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data.zones]);

  // ---- تبديل النمط ----
  useEffect(() => {
    const map = mapRef.current;
    const { satellite, art } = layersRef.current;
    if (!ready || !map) return;
    if (mode === "satellite") {
      art?.remove();
      satellite?.addTo(map);
      satellite?.bringToBack();
    } else {
      satellite?.remove();
      art?.addTo(map);
      art?.bringToBack();
    }
  }, [mode, ready]);

  // ---- الممرات + المناطق + المسارات ----
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const group = layersRef.current.main;
    if (!ready || !L || !map || !group || !data.zones.length) return;
    group.clearLayers();
    const routeZones = [...new Set(stops.map((stop) => stop.zone))];
    const zoneLevel = (zoneId?: string) => (zoneId ? crowdByZone.get(zoneId)?.level : undefined);

    // ممرات المشي (مثل شوارع Google؛ تتلون بالزحام)
    const drawn = new Set<string>();
    for (const edge of data.routeGraph?.edges ?? []) {
      if (edge.status !== "open") continue;
      const key = [edge.from, edge.to].sort().join("|");
      if (drawn.has(key)) continue;
      drawn.add(key);
      const from = graph.nodes.get(edge.from);
      const to = graph.nodes.get(edge.to);
      if (!from || !to) continue;
      const levels = [zoneLevel(from.zone), zoneLevel(to.zone)].filter((value): value is number => value != null);
      // زحمة الممر = متوسط زحمة طرفيه (مثل سرعة الطريق في خرائط Google)
      const level = levels.length ? levels.reduce((sum, value) => sum + value, 0) / levels.length : undefined;
      const tone = crowdTone(level, threshold);
      const line = [toLatLng(from.x, from.y), toLatLng(to.x, to.y)];
      // الممرات الهادئة تبقى بلون الممر؛ نلوّن فقط المتوسطة والمزدحمة حتى تبرز الزحمة
      const showTraffic = crowdLayer && (tone === "busy" || tone === "packed");
      L.polyline(line, { pane: "pm-streets", color: mode === "art" ? "#e2d0ae" : "#ffffff", weight: 7, opacity: mode === "art" ? 0.95 : 0.7, lineCap: "round", interactive: false }).addTo(group);
      L.polyline(line, {
        pane: "pm-streets",
        color: showTraffic ? TONE_COLOR[tone] : mode === "art" ? "#fffaf0" : "#ffffff",
        weight: 4,
        opacity: showTraffic ? 0.95 : mode === "art" ? 1 : 0.5,
        dashArray: edge.accessible ? undefined : "6 7",
        lineCap: "round",
        interactive: false,
      }).addTo(group);
    }

    // هالة الزحام حول المناطق
    if (crowdLayer) {
      for (const zone of data.zones) {
        const tone = crowdTone(zoneLevel(zone.id), threshold);
        if (tone === "unknown" || tone === "calm") continue;
        L.circle(toLatLng(zone.x, zone.y), {
          radius: tone === "packed" ? 58 : 48,
          color: TONE_COLOR[tone],
          weight: 2,
          fillColor: TONE_COLOR[tone],
          fillOpacity: tone === "packed" ? 0.28 : 0.18,
          className: tone === "packed" ? "pm-hot-halo" : "",
          interactive: false,
        }).addTo(group);
      }
    }

    // لافتات المناطق (أيقونة + اسم) — تفتح بطاقة مع زر الاتجاهات
    for (const zone of data.zones) {
      const theme = zoneTheme(zone);
      const level = zoneLevel(zone.id);
      const tone = crowdTone(level, threshold);
      const key = routeZones.includes(zone.id) || focusId === zone.id;
      const badge = crowdLayer && tone === "packed" ? `<span class="pm-badge">زحمة</span>` : "";
      const icon = L.divIcon({
        className: "pm-label-wrap",
        html: `<span class="pm-label${key ? " pm-key" : ""}${tone === "packed" && crowdLayer ? " pm-packed" : ""}" style="--zc:${theme.color}"><span class="pm-ico" aria-hidden="true">${theme.icon}</span><span class="pm-name">${escapeHtml(theme.short)}</span>${badge}</span>`,
        iconSize: [0, 0],
      });
      const marker = L.marker(toLatLng(zone.x, zone.y), { icon, keyboard: true, title: zone.name, riseOnHover: true, zIndexOffset: key ? 300 : 0 });
      marker.on("click", () => setSelected({ kind: "zone", id: zone.id }));
      marker.addTo(group);
    }

    // الخدمات والبوابات
    for (const location of data.locations) {
      if (location.status !== "open" || location.type === "ZONE") continue;
      const gateName = location.type === "ENTRANCE" ? location.label.replace(/^بوابة\s+/, "").replace(/\s*\(.*\)\s*$/, "") || location.label : null;
      const icon = L.divIcon({
        className: "pm-label-wrap",
        html: gateName
          ? `<span class="pm-gate" title="${escapeHtml(location.label)}"><b aria-hidden="true">🚪</b>${escapeHtml(gateName)}</span>`
          : `<span class="pm-svc" title="${escapeHtml(location.label)}">${serviceIcon(location)}</span>`,
        iconSize: [0, 0],
      });
      L.marker(toLatLng(location.x, location.y), { icon, title: location.label })
        .on("click", () => setSelected({ kind: "place", id: location.id }))
        .addTo(group);
    }

    // محطات التلفريك (معالم من الخريطة الرسمية)
    for (const station of BOULEVARD_CABLE_CAR.stations) {
      const icon = L.divIcon({ className: "pm-label-wrap", html: `<span class="pm-svc pm-cable" title="${escapeHtml(station.name)}">🚡</span>`, iconSize: [0, 0] });
      L.marker(toLatLng(station.x, station.y), { icon, title: station.name })
        .on("click", () => setSelected({ kind: "landmark", id: station.id }))
        .addTo(group);
    }

    // مسار الزيارة على الممرات + دبابيس مرقمة
    const stopZones = routeZones.map((zoneId) => data.zones.find((zone) => zone.id === zoneId)).filter((zone): zone is NonNullable<typeof zone> => Boolean(zone));
    if (stopZones.length > 1) {
      const routeLine: [number, number][] = [];
      for (let index = 0; index < stopZones.length - 1; index += 1) {
        const a = zoneNodeId(graph, stopZones[index].id);
        const b = zoneNodeId(graph, stopZones[index + 1].id);
        const nodePath = a && b ? graphPath(graph, a, b) : null;
        const points = nodePath?.map((id) => graph.nodes.get(id)!).filter(Boolean) ?? [stopZones[index], stopZones[index + 1]];
        for (const point of points) routeLine.push(toLatLng(point.x, point.y));
      }
      L.polyline(routeLine, { pane: "pm-route", color: "#ffffff", weight: 9, opacity: 0.9, lineJoin: "round", interactive: false }).addTo(group);
      L.polyline(routeLine, { pane: "pm-route", color: "#007d83", weight: 5, opacity: 1, dashArray: "1 10", lineCap: "round", lineJoin: "round", interactive: false, className: "pm-route-flow" }).addTo(group);
    }
    stopZones.forEach((zone, index) => {
      L.marker(toLatLng(zone.x, zone.y), {
        icon: L.divIcon({ className: "pm-label-wrap", html: `<span class="pm-stop">${index + 1}</span>`, iconSize: [0, 0] }),
        zIndexOffset: 600,
        interactive: false,
      }).addTo(group);
    });

    // مسار الاتجاهات المطلوب
    const pathKey = path?.length ? path.map((point) => `${point.x},${point.y}`).join(";") : "";
    if (path?.length) {
      const pathLatLngs = path.map((point) => toLatLng(point.x, point.y));
      L.polyline(pathLatLngs, { pane: "pm-route", color: "#ffffff", weight: 11, opacity: 1, lineJoin: "round", lineCap: "round", interactive: false }).addTo(group);
      L.polyline(pathLatLngs, { pane: "pm-route", color: "#1a73e8", weight: 7, opacity: 1, lineJoin: "round", lineCap: "round", interactive: false }).addTo(group);
      L.marker(pathLatLngs[0], { icon: L.divIcon({ className: "pm-label-wrap", html: `<span class="pm-endpoint pm-start" title="البداية"></span>`, iconSize: [0, 0] }), zIndexOffset: 700, interactive: false }).addTo(group);
      L.marker(pathLatLngs[pathLatLngs.length - 1], { icon: L.divIcon({ className: "pm-label-wrap", html: `<span class="pm-dest">🏁</span>`, iconSize: [0, 0] }), zIndexOffset: 800, interactive: false }).addTo(group);
      if (pathKey !== lastPathKey.current) {
        map.fitBounds(L.latLngBounds(pathLatLngs).pad(0.3), { animate: true, maxZoom: fitZoomRef.current + 2 });
        fittedRef.current = true;
      }
    }
    lastPathKey.current = pathKey;

    // هدف التركيز
    const focusedZone = focusId ? data.zones.find((zone) => zone.id === focusId) : null;
    const focusedLocation = focusId ? data.locations.find((location) => location.id === focusId) : null;
    const focusPoint = focusedZone ?? focusedLocation ?? null;
    if (focusPoint) {
      const ll = toLatLng(focusPoint.x, focusPoint.y);
      L.marker(ll, { icon: L.divIcon({ className: "pm-label-wrap", html: `<span class="pm-focus"></span>`, iconSize: [0, 0] }), zIndexOffset: 900, interactive: false }).addTo(group);
      if (focusId !== lastFocus.current && !path?.length) map.setView(ll, Math.max(map.getZoom(), fitZoomRef.current + 1.5), { animate: true });
    }
    lastFocus.current = focusId ?? null;
  }, [ready, data, graph, stops, focusId, path, crowdByZone, crowdLayer, threshold, mode]);

  // ---- نقطة «موقعي» الزرقاء ----
  const shownMe: MapMe | null = me ?? localFix;
  const meKey = shownMe ? `${Math.round(shownMe.x)}:${Math.round(shownMe.y)}:${shownMe.target ? `${Math.round(shownMe.target.x)}:${Math.round(shownMe.target.y)}` : ""}:${Math.round(shownMe.heading ?? -1)}` : "";
  const followed = useRef(false);
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const group = layersRef.current.me;
    if (!ready || !L || !map || !group) return;
    group.clearLayers();
    if (!shownMe) { followed.current = false; return; }
    const ll = toLatLng(shownMe.x, shownMe.y);
    if (shownMe.accuracyM && shownMe.accuracyM > 4) {
      L.circle(ll, { radius: Math.min(shownMe.accuracyM, 80), color: "#1a73e8", weight: 1, fillColor: "#1a73e8", fillOpacity: 0.12, interactive: false }).addTo(group);
    }
    if (shownMe.target) {
      L.polyline([ll, toLatLng(shownMe.target.x, shownMe.target.y)], { pane: "pm-route", color: "#1a73e8", weight: 3, dashArray: "4 8", opacity: 0.9, interactive: false }).addTo(group);
      const meters = Math.round(planarDistanceMeters(shownMe, shownMe.target));
      L.marker(toLatLng(shownMe.target.x, shownMe.target.y), {
        icon: L.divIcon({ className: "pm-label-wrap", html: `<span class="geo-target-chip">${meters >= 1000 ? `${(meters / 1000).toFixed(1)} كم` : `${meters} م`}</span>`, iconSize: [0, 0] }),
        zIndexOffset: 950,
        interactive: false,
      }).addTo(group);
    }
    const heading = shownMe.heading != null && Number.isFinite(shownMe.heading) ? shownMe.heading : null;
    L.marker(ll, {
      icon: L.divIcon({
        className: "pm-label-wrap",
        html: `<span class="pm-me">${heading != null ? `<i class="pm-me-cone" style="--rot:${heading}deg"></i>` : ""}<b></b></span>`,
        iconSize: [0, 0],
      }),
      zIndexOffset: 1000,
      title: "موقعك",
      interactive: false,
    }).addTo(group);
    if (!followed.current || !map.getBounds().pad(-0.15).contains(ll)) {
      map.setView(ll, Math.max(map.getZoom(), fitZoomRef.current + 1.5), { animate: true });
      followed.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, meKey]);

  // ---- تحديد الموقع + المشاركة المجهولة للزحام ----
  const stopWatching = useCallback(() => {
    if (watchRef.current !== null && typeof navigator !== "undefined") navigator.geolocation?.clearWatch(watchRef.current);
    watchRef.current = null;
    setLocating(false);
    setLocalFix(null);
  }, []);
  useEffect(() => stopWatching, [stopWatching]);

  const sendPresence = useCallback((position: GeolocationPosition) => {
    const now = Date.now();
    if (now - lastPresenceAt.current < PRESENCE_INTERVAL_MS) return;
    lastPresenceAt.current = now;
    void fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/presence`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
    }).catch(() => undefined);
  }, [eventSlug]);

  const startWatching = useCallback((share: boolean) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNotice("تحديد الموقع غير متاح في هذا المتصفح.");
      return;
    }
    setSharing(share);
    setLocating(true);
    setNotice("");
    lastPresenceAt.current = 0;
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const point = fromLatLng(position.coords.latitude, position.coords.longitude);
        const nearest = Math.min(...data.zones.map((zone) => planarDistanceMeters(point, zone)));
        if (!Number.isFinite(nearest) || nearest > 250) {
          setNotice("موقعك الحالي خارج حدود الفعالية — النقطة الزرقاء تظهر لما توصل.");
          setLocalFix(null);
          return;
        }
        setNotice("");
        setLocalFix({ ...point, lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: position.coords.accuracy, heading: position.coords.heading });
        if (share) sendPresence(position);
      },
      (error) => {
        setNotice(error.code === 1 ? "إذن الموقع مقفول. فعّله من إعدادات المتصفح ثم جرّب مرة ثانية." : "ما قدرنا نحدد موقعك الآن. جرّب في مكان مفتوح.");
        setLocating(false);
        watchRef.current = null;
      },
      { enableHighAccuracy: true, maximumAge: 3_000, timeout: 15_000 },
    );
  }, [data.zones, sendPresence]);

  const onLocate = () => {
    if (locating) {
      if (localFix) mapRef.current?.setView(toLatLng(localFix.x, localFix.y), Math.max(mapRef.current.getZoom(), fitZoomRef.current + 1.5), { animate: true });
      else stopWatching();
      return;
    }
    let stored: string | null = null;
    try { stored = window.sessionStorage.getItem(PRESENCE_CONSENT_KEY); } catch { stored = null; }
    if (stored === "yes" || stored === "no") startWatching(stored === "yes");
    else setConsentAsk(true);
  };

  const answerConsent = (share: boolean) => {
    try { window.sessionStorage.setItem(PRESENCE_CONSENT_KEY, share ? "yes" : "no"); } catch { /* per-viewer convenience only */ }
    setConsentAsk(false);
    startWatching(share);
  };

  const zoomBy = (delta: number) => mapRef.current?.setZoom((mapRef.current?.getZoom() ?? 15) + delta);
  const fitAll = () => {
    const L = leafletRef.current;
    if (!L || !mapRef.current) return;
    mapRef.current.fitBounds(L.latLngBounds(toLatLng(-630, 610), toLatLng(800, -600)), { padding: [8, 8], animate: true });
  };

  return (
    <div className={`map-card geo-map-card pm-card pm-mode-${mode} pm-tier-${zoomTier}`} aria-label="خريطة بوليفارد وورلد">
      <div ref={containerRef} className="geo-map-container pm-map" role="application" aria-label="خريطة تفاعلية للمناطق والممرات ومسار زيارتك. اضغط على أي منطقة لعرض الزحام والاتجاهات." />

      <div className="pm-segment" role="group" aria-label="نمط الخريطة">
        <button type="button" aria-pressed={mode === "art"} onClick={() => setMode("art")}>مخطط</button>
        <button type="button" aria-pressed={mode === "satellite"} onClick={() => setMode("satellite")}>قمر صناعي</button>
      </div>

      <div className="pm-tools">
        <button type="button" className="pm-tool" aria-label="تكبير" onClick={() => zoomBy(1)}>+</button>
        <button type="button" className="pm-tool" aria-label="تصغير" onClick={() => zoomBy(-1)}>−</button>
        <button type="button" className="pm-tool" aria-label="عرض الموقع كاملًا" onClick={fitAll}>⤢</button>
        <button type="button" className={`pm-tool pm-locate${locating ? " is-on" : ""}`} aria-pressed={locating} aria-label={locating ? "توسيط موقعي" : "أظهر موقعي"} onClick={onLocate}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3" stroke="currentColor" strokeWidth="2"/></svg>
        </button>
      </div>

      <button type="button" className={`pm-traffic${crowdLayer ? " is-on" : ""}`} aria-pressed={crowdLayer} onClick={() => setCrowdLayer((value) => !value)}>
        <span className="pm-traffic-dots" aria-hidden="true"><i/><i/><i/></span> الزحام
      </button>

      {consentAsk && (
        <div className="pm-consent" role="dialog" aria-label="مشاركة الموقع">
          <strong>نعرض موقعك على الخريطة</strong>
          <p>تبي تساعد ونيس يقيس الزحام؟ نرسل <b>المنطقة اللي أنت فيها فقط</b> بدون اسم أو هوية، وتنحذف تلقائيًا بعد ٥ دقائق.</p>
          <div>
            <button type="button" className="yes" onClick={() => answerConsent(true)}>نعم، شارك مجهولًا</button>
            <button type="button" className="ghost" onClick={() => answerConsent(false)}>موقعي فقط</button>
          </div>
        </div>
      )}
      {notice && <div className="pm-notice" role="status">{notice}</div>}
      {locating && sharing && !notice && <div className="pm-sharing" role="status"><i aria-hidden="true" /> تساهم مجهولًا في قياس الزحام</div>}

      {selected && (() => {
        const zone = selected.kind === "zone" ? data.zones.find((entry) => entry.id === selected.id) : null;
        const place = selected.kind === "place" ? data.locations.find((entry) => entry.id === selected.id) : null;
        const landmark = selected.kind === "landmark" ? BOULEVARD_CABLE_CAR.stations.find((entry) => entry.id === selected.id) : null;
        if (!zone && !place && !landmark) return null;
        // أقرب منطقة للمعلم: التوجيه إليها لأن المعالم ليست عقدًا في رسم الممرات
        const nearestZone = landmark
          ? [...data.zones].sort((a, b) => Math.hypot(a.x - landmark.x, a.y - landmark.y) - Math.hypot(b.x - landmark.x, b.y - landmark.y))[0]
          : null;
        const row = zone ? crowdByZone.get(zone.id) : undefined;
        const tone = crowdTone(row?.level, threshold);
        const name = zone?.name ?? place?.label ?? landmark?.name ?? "";
        const icon = zone ? zoneTheme(zone).icon : place ? serviceIcon(place) : landmark ? "🚡" : "📍";
        const placeZone = place?.zone
          ? data.zones.find((entry) => entry.id === place.zone)?.name
          : landmark ? `يربط بوليفارد سيتي ببوليفارد وورلد فوق البحيرة${nearestZone && landmark.y < 600 ? ` · قرب ${nearestZone.name}` : ""}` : null;
        return (
          <div className="pm-sheet" role="dialog" aria-label={name}>
            <button type="button" className="pm-sheet-close" aria-label="إغلاق" onClick={() => setSelected(null)}>×</button>
            <div className="pm-pop-title"><span aria-hidden="true">{icon}</span><strong>{name}</strong></div>
            {placeZone && <span className="pm-sheet-sub">{placeZone}</span>}
            {zone && (
              <span className={`pm-pop-crowd pm-tone-${tone}`}>
                <i />{TONE_TEXT[tone]}{row?.level != null ? ` · ${Math.round(row.level * 100)}٪` : ""}
                <small>{row?.source === "sensor" ? "قياس حي من أجهزة الزوار" : row?.source === "operator" ? "من فريق التشغيل" : "تقدير"}</small>
              </span>
            )}
            {zone && row?.hourly?.length ? <PopularTimes row={row} threshold={threshold} /> : null}
            {onNavigate && !landmark && (
              <button type="button" className="pm-pop-go" onClick={() => { setSelected(null); onNavigate(selected.id); }}>🧭 دلّني عليها</button>
            )}
            {onNavigate && landmark && nearestZone && landmark.y < 600 && (
              <button type="button" className="pm-pop-go" onClick={() => { setSelected(null); onNavigate(nearestZone.id); }}>🧭 دلّني للمحطة (عبر {nearestZone.name})</button>
            )}
          </div>
        );
      })()}

      <div className="pm-legend" aria-label="مفتاح الخريطة">
        <span><i style={{ background: TONE_COLOR.calm }} />هادئ</span>
        <span><i style={{ background: TONE_COLOR.busy }} />متوسط</span>
        <span><i style={{ background: TONE_COLOR.packed }} />مزدحم</span>
        <span><i className="pm-leg-line" style={{ background: "#007d83" }} />مسارك</span>
        <span><i className="pm-leg-line" style={{ background: "#1a73e8" }} />الاتجاهات</span>
        <small>{measuredLive
          ? "الزحام: قياس حي من أجهزة الزوار"
          : crowdRows.some((row) => row.source === "operator") ? "الزحام: بلاغات فريق التشغيل + تقدير" : "الزحام: تقدير تشغيلي"}</small>
      </div>
    </div>
  );
}
