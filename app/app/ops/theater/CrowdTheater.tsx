"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { catalogData } from "@/data/catalog";
import type { Catalog } from "@/engine/types";
import { adoptionCurve, catalogShows, runCrowdTheater, slopePerTenPoints, THEATER_STATE } from "../../../../packages/engine/src/theater.ts";
import type { AdoptionCurve, TheaterMetrics, TheaterRun, TheaterWorld } from "../../../../packages/engine/src/theater.ts";
import styles from "./theater.module.css";
import { BrandLogo } from "@/components/Brand";
import { AR_MINUTE, arCount } from "@/lib/ar-count";

const bundledCatalog = catalogData as unknown as Catalog;
const SHOW_START = 90;
const SHOW_LENGTH = 20;
const DELAY_CHOICES = [10, 25, 45] as const;
const DEFAULT_DELAY_MIN = 25;
const HORIZON = 180;
/** Real seconds per simulated minute at 1× speed. */
const SECONDS_PER_MINUTE = 0.4;
/** Story mode: the operator publishes the delay here, and the story pauses here to compare. */
const STORY_DELAY_AT = 62;
const STORY_PAUSE_AT = 106;
const STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

const openingHourOf = (catalog: Catalog) => {
  const from = catalog.site.opening.from;
  return from < 100 ? from : Math.floor(from / 60);
};
const num = (value: number, digits = 0) => value.toLocaleString("ar-SA", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const formatClock = (minute: number, openingHour: number) => {
  const total = openingHour * 60 + Math.floor(minute);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${num(h)}:${m.toLocaleString("ar-SA", { minimumIntegerDigits: 2 })}`;
};
/** A percentage from the URL, snapped to the slider steps. */
const pctParam = (params: URLSearchParams, key: string): number | null => {
  const raw = params.get(key);
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return STEPS.reduce((best, step) => (Math.abs(step - value) < Math.abs(best - value) ? step : best), 0);
};

type CatalogSource =
  | { status: "bundled"; slug: null; name: string; catalog: Catalog }
  | { status: "loading" | "error"; slug: string; name: string; catalog: Catalog }
  | { status: "ready"; slug: string; name: string; catalog: Catalog };

function isUsableCatalog(value: unknown): value is Catalog {
  const catalog = value as Catalog | null;
  return Boolean(
    catalog
    && Array.isArray(catalog.zones) && catalog.zones.length > 0
    && Array.isArray(catalog.activities)
    && catalog.site && typeof catalog.site.opening?.from === "number"
    && catalog.zones.every((zone) => typeof zone.id === "string" && Number.isFinite(zone.x) && Number.isFinite(zone.y) && Number.isFinite(zone.popularity)),
  );
}

type Palette = { walking: string; queueing: string; show: string; enjoying: string; ink: string; muted: string; surface: string; line: string; calm: string; busy: string; packed: string; font: string };

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    walking: token("--purple", "#8e2bff"),
    queueing: token("--orange", "#ff8c00"),
    show: token("--pink", "#ff1e8d"),
    enjoying: token("--teal", "#007766"),
    ink: token("--ink", "#2d1b4f"),
    muted: token("--ink-3", "#8b8fa6"),
    surface: token("--surface", "#ffffff"),
    line: token("--line-strong", "rgba(45,27,79,.18)"),
    calm: "rgba(23,138,90,0.16)",
    busy: "rgba(255,140,0,0.30)",
    packed: "rgba(194,65,12,0.42)",
    font: getComputedStyle(document.body).fontFamily || "sans-serif",
  };
}

type Geometry = { minX: number; minY: number; spanX: number; aspect: number };

function geometryFor(run: TheaterRun): Geometry {
  const xs = [...run.zones.map((zone) => zone.x), run.options.entrance.x];
  const ys = [...run.zones.map((zone) => zone.y), run.options.entrance.y];
  const pad = 110; // room for a long queue ring around an edge zone
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  return { minX, minY, spanX: maxX - minX, aspect: (maxY - minY) / (maxX - minX) };
}

function drawWorld(canvas: HTMLCanvasElement, run: TheaterRun, world: TheaterWorld, minute: number, palette: Palette, base: Geometry, showLabel: string | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  // Fit the venue box into the canvas, preserving its aspect ratio.
  const spanX = base.spanX;
  const spanY = spanX * base.aspect;
  const k = Math.min(cssWidth / spanX, cssHeight / spanY);
  const ox = (cssWidth - spanX * k) / 2;
  const oy = (cssHeight - spanY * k) / 2;
  const px = (x: number) => ox + (x - base.minX) * k;
  const py = (y: number) => oy + (y - base.minY) * k;

  const m0 = Math.max(0, Math.min(HORIZON, Math.floor(minute)));
  const m1 = Math.min(HORIZON, m0 + 1);
  const f = Math.min(1, Math.max(0, minute - m0));
  const zoneCount = run.zones.length;
  const showZone = run.options.show?.zone;

  // Zones: tinted by how many people stand there.
  ctx.lineWidth = 1;
  run.zones.forEach((zone, index) => {
    const standing = world.queues[m0 * zoneCount + index];
    const minutesOfQueue = standing / Math.max(0.1, zone.admitsPerMin);
    ctx.beginPath();
    ctx.arc(px(zone.x), py(zone.y), Math.max(10, 26 * k), 0, Math.PI * 2);
    ctx.fillStyle = minutesOfQueue >= 20 ? palette.packed : minutesOfQueue >= 8 ? palette.busy : palette.calm;
    ctx.fill();
    ctx.strokeStyle = zone.id === showZone ? palette.show : palette.line;
    ctx.lineWidth = zone.id === showZone ? 2 : 1;
    ctx.stroke();
  });

  // Entrance.
  const entrance = run.options.entrance;
  ctx.fillStyle = palette.ink;
  ctx.beginPath();
  ctx.moveTo(px(entrance.x), py(entrance.y) - 7);
  ctx.lineTo(px(entrance.x) + 6, py(entrance.y) + 4);
  ctx.lineTo(px(entrance.x) - 6, py(entrance.y) + 4);
  ctx.closePath();
  ctx.fill();

  // Visitors: one path per colour, drawn once.
  const n = run.options.visitors;
  const paths = { walking: new Path2D(), queueing: new Path2D(), show: new Path2D(), enjoying: new Path2D() };
  const r = Math.max(1.8, Math.min(2.8, 4.5 * k));
  for (let i = 0; i < n; i += 1) {
    const s0 = world.states[m0 * n + i];
    const s1 = world.states[m1 * n + i];
    const hidden = (state: number) => state === THEATER_STATE.notArrived || state === THEATER_STATE.left;
    if (hidden(s0) && hidden(s1)) continue;
    const from = hidden(s0) ? m1 : m0;
    const to = hidden(s1) ? m0 : m1;
    const x0 = world.positions[(from * n + i) * 2];
    const y0 = world.positions[(from * n + i) * 2 + 1];
    const x1 = world.positions[(to * n + i) * 2];
    const y1 = world.positions[(to * n + i) * 2 + 1];
    const x = px(x0 + (x1 - x0) * f);
    const y = py(y0 + (y1 - y0) * f);
    const state = f < 0.5 || hidden(s1) ? s0 : s1;
    const path = state === THEATER_STATE.walking ? paths.walking
      : state === THEATER_STATE.queueing ? paths.queueing
        : state === THEATER_STATE.waitingShow ? paths.show
          : paths.enjoying;
    path.moveTo(x + r, y);
    path.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = palette.enjoying;
  ctx.fill(paths.enjoying);
  ctx.fillStyle = palette.walking;
  ctx.fill(paths.walking);
  ctx.fillStyle = palette.queueing;
  ctx.fill(paths.queueing);
  ctx.fillStyle = palette.show;
  ctx.fill(paths.show);

  // Labels: the show zone always; the others when there is room.
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const roomy = cssWidth >= 560;
  run.zones.forEach((zone) => {
    const isShow = zone.id === showZone;
    if (!isShow && !roomy) return;
    ctx.font = `${isShow ? 700 : 500} ${isShow ? 12 : 10}px ${palette.font}`;
    ctx.fillStyle = isShow ? palette.ink : palette.muted;
    const label = isShow && showLabel ? showLabel : zone.name.replace(/^منطقة\s+/, "");
    ctx.fillText(label, px(zone.x), py(zone.y) + Math.max(10, 26 * k) + 4);
  });
}

function Chart({ run, minute, clock }: { run: TheaterRun; minute: number; clock: (minute: number) => string }) {
  const width = 360;
  const height = 120;
  const max = Math.max(10, ...run.without.standingSeries, ...run.with.standingSeries);
  const x = (m: number) => (m / HORIZON) * width;
  const y = (v: number) => height - 8 - (v / max) * (height - 18);
  // The SVG is mirrored for RTL so time flows right to left like the rest of the page.
  const line = (series: number[]) => series.map((v, m) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const delayAt = run.options.delay?.atMin;
  return (
    <figure className={styles.chart}>
      <figcaption>عدد الواقفين في طوابير أو بانتظار العرض، دقيقة بدقيقة</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`أعلى عدد واقفين: بدون ونيس ${num(Math.max(...run.without.standingSeries))}، مع ونيس ${num(Math.max(...run.with.standingSeries))}`} style={{ transform: "scaleX(-1)" }}>
        <line x1="0" x2={width} y1={height - 8} y2={height - 8} className={styles.axis} />
        {run.options.show && <line x1={x(run.showActualStart ?? SHOW_START)} x2={x(run.showActualStart ?? SHOW_START)} y1="6" y2={height - 8} className={styles.showMark} />}
        {delayAt != null && <line x1={x(delayAt)} x2={x(delayAt)} y1="6" y2={height - 8} className={styles.delayMark} />}
        <polyline points={line(run.without.standingSeries)} className={styles.lineWithout} />
        <polyline points={line(run.with.standingSeries)} className={styles.lineWith} />
        <line x1={x(minute)} x2={x(minute)} y1="2" y2={height - 8} className={styles.playhead} />
      </svg>
      <div className={styles.legend}>
        <span><i className={styles.swWithout} />بدون ونيس</span>
        <span><i className={styles.swWith} />مع ونيس</span>
        {delayAt != null && <span><i className={styles.swDelay} />نشر التأخير {clock(delayAt)}</span>}
        <span><i className={styles.swShow} />بداية العرض {clock(run.showActualStart ?? SHOW_START)}</span>
      </div>
    </figure>
  );
}

function AdoptionImpact({ curve, currentPct, delayed, showName }: { curve: AdoptionCurve | null; currentPct: number; delayed: boolean; showName: string }) {
  if (!curve) {
    return (
      <section className={styles.summary} aria-busy="true">
        <h2>لو زاد مستخدمو ونيس؟</h2>
        <p className={styles.note}>نعيد الليلة بنسب استخدام من ٠٪ إلى ١٠٠٪…</p>
      </section>
    );
  }
  // With a delay, the show crowd is the story; without one, the whole venue's average wait.
  const metric = delayed ? (m: TheaterMetrics) => m.showWaitMin : (m: TheaterMetrics) => m.avgWaitMin;
  const label = delayed ? `متوسط وقوف جمهور ${showName} (دقيقة)` : "متوسط الانتظار لكل زيارة (دقيقة)";
  const values = curve.points.map((point) => metric(point.metrics));
  const max = Math.max(...values, metric(curve.baseline)) * 1.1 || 1;
  const width = 360;
  const height = 140;
  const x = (pct: number) => 12 + (pct / 100) * (width - 24);
  const y = (value: number) => height - 14 - (value / max) * (height - 28);
  const line = curve.points.map((point) => `${x(point.adoptionPct).toFixed(1)},${y(metric(point.metrics)).toFixed(1)}`).join(" ");
  const slope = slopePerTenPoints(curve.points, metric);
  const standingSlope = slopePerTenPoints(curve.points, (m) => m.standingMinutes);
  const best = curve.points.reduce((a, b) => (metric(b.metrics) < metric(a.metrics) ? b : a));
  const last = curve.points[curve.points.length - 1];
  // Honest caveat: if the curve turns back up after its best point, say where.
  const fadesAt = last && best.adoptionPct < last.adoptionPct && metric(last.metrics) > metric(best.metrics) * 1.03 ? best.adoptionPct : null;
  const current = curve.points.find((point) => point.adoptionPct === currentPct);
  const subject = delayed ? "وقوف جمهور العرض" : "الانتظار";
  return (
    <section className={styles.summary} aria-labelledby="adoption-impact-title">
      <h2 id="adoption-impact-title">لو زاد مستخدمو ونيس؟</h2>
      <p className={styles.headline}>
        {slope < 0
          ? <>كل ١٠٪ زيادة في المستخدمين تقلّل {subject} نحو <strong>{num(-slope, 1)} دقيقة</strong> للشخص، وتوفّر نحو <strong>{num(Math.max(0, -standingSlope))} دقيقة وقوف</strong> على مستوى الموقع.</>
          : <>في هذا السيناريو لا يتحسّن {subject} بزيادة المستخدمين.</>}
      </p>
      <figure className={styles.chart}>
        <figcaption>{label} حسب نسبة الزوار اللي معهم ونيس. الخط المتقطّع: بدون ونيس.</figcaption>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          style={{ transform: "scaleX(-1)" }}
          aria-label={curve.points.map((point) => `${num(point.adoptionPct)}٪: ${num(metric(point.metrics), 1)}`).join("، ")}
        >
          <line x1="12" x2={width - 12} y1={y(metric(curve.baseline))} y2={y(metric(curve.baseline))} className={styles.baseline} />
          <polyline points={line} className={styles.lineWith} />
          {curve.points.map((point) => (
            <circle
              key={point.adoptionPct}
              cx={x(point.adoptionPct)}
              cy={y(metric(point.metrics))}
              r={point.adoptionPct === currentPct ? 5 : 3}
              className={point.adoptionPct === currentPct ? styles.pointCurrent : styles.point}
            />
          ))}
        </svg>
        <div className={styles.axis} aria-hidden="true"><span>٠٪</span><span>٥٠٪</span><span>١٠٠٪</span></div>
      </figure>
      {current && <p className={styles.note}>عند {num(currentPct)}٪ (اختيارك الحالي): {num(metric(current.metrics), 1)} دقيقة، مقابل {num(metric(curve.baseline), 1)} بدون ونيس.</p>}
      {fadesAt != null && <p className={styles.note}>فوق {num(fadesAt)}٪ يقلّ الأثر: لما يشوف الكل نفس الأماكن الهادئة يتجهون لها سوا. لهذا يوزّع ونيس اقتراحاته بدل ما يرسل الكل لنفس المكان.</p>}
    </section>
  );
}

export function CrowdTheater() {
  const [adoptionPct, setAdoptionPct] = useState(40);
  const [acceptPct, setAcceptPct] = useState(60);
  const [delayAt, setDelayAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [displayMinute, setDisplayMinute] = useState(0);
  const minuteRef = useRef(0);
  const withoutRef = useRef<HTMLCanvasElement>(null);
  const withRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<Palette | null>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [source, setSource] = useState<CatalogSource>({ status: "bundled", slug: null, name: bundledCatalog.site.name, catalog: bundledCatalog });
  const [paramsRead, setParamsRead] = useState(false);
  const [showId, setShowId] = useState<string | null>(null);
  const [delayLength, setDelayLength] = useState<number>(DEFAULT_DELAY_MIN);
  const [curve, setCurve] = useState<AdoptionCurve | null>(null);
  /** Story mode: plays at 2×, publishes the delay itself, then pauses to compare. */
  const storyRef = useRef<"off" | "running" | "finishing">("off");
  const [storyPaused, setStoryPaused] = useState(false);

  // Settings and the event come from the URL, so a demo link opens exactly as shared.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const adoption = pctParam(params, "adoption");
    const accept = pctParam(params, "accept");
    if (adoption != null) setAdoptionPct(adoption);
    if (accept != null) setAcceptPct(accept);
    const requestedSpeed = Number(params.get("speed"));
    if ([1, 2, 4].includes(requestedSpeed)) setSpeed(requestedSpeed);
    const requestedDelay = Number(params.get("delay"));
    if ((DELAY_CHOICES as readonly number[]).includes(requestedDelay)) setDelayLength(requestedDelay);
    const requestedShow = params.get("show");
    if (requestedShow && /^[a-z0-9_-]{1,80}$/i.test(requestedShow)) setShowId(requestedShow);
    setParamsRead(true);
    const slug = params.get("event");
    if (!slug || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(slug)) return;
    const controller = new AbortController();
    let unmounted = false;
    // Never leave the page on "loading": after 8 s fall back to the bundled catalog and say so.
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setSource({ status: "loading", slug, name: bundledCatalog.site.name, catalog: bundledCatalog });
    fetch(`/api/events/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("event unavailable");
        return response.json();
      })
      .then((payload) => {
        const catalog = payload?.data?.catalog;
        if (!isUsableCatalog(catalog)) throw new Error("catalog incomplete");
        const name = typeof payload?.data?.eventName === "string" ? payload.data.eventName : catalog.site.name;
        setSource({ status: "ready", slug, name, catalog });
      })
      .catch(() => {
        if (!unmounted) setSource({ status: "error", slug, name: bundledCatalog.site.name, catalog: bundledCatalog });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      unmounted = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!paramsRead) return;
    const params = new URLSearchParams(window.location.search);
    params.set("adoption", String(adoptionPct));
    params.set("accept", String(acceptPct));
    params.set("delay", String(delayLength));
    if (showId) params.set("show", showId);
    else params.delete("show");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [adoptionPct, acceptPct, delayLength, showId, paramsRead]);

  const catalog = source.catalog;
  const shows = useMemo(() => catalogShows(catalog), [catalog]);
  // The chosen show, or the most popular one when none is chosen or the choice is not in this catalog.
  const headline = useMemo(() => shows.find((show) => show.activityId === showId) ?? shows[0] ?? null, [shows, showId]);
  const openingHour = useMemo(() => openingHourOf(catalog), [catalog]);
  const clock = useCallback((minute: number) => formatClock(minute, openingHour), [openingHour]);

  const run = useMemo(() => runCrowdTheater(catalog, {
    horizonMin: HORIZON,
    adoptionPct,
    acceptPct,
    show: headline ? { zone: headline.zone, startMin: SHOW_START, durationMin: SHOW_LENGTH, audiencePct: 30 } : null,
    delay: delayAt == null ? null : { atMin: delayAt, durationMin: delayLength },
  }), [catalog, headline, adoptionPct, acceptPct, delayAt, delayLength]);
  const base = useMemo(() => geometryFor(run), [run]);
  const runRef = useRef(run);
  runRef.current = run;
  const delayRef = useRef(delayAt);
  delayRef.current = delayAt;
  const headlineRef = useRef(headline);
  headlineRef.current = headline;

  // A new catalog is a new night: start over.
  useEffect(() => {
    setPlaying(false);
    setDelayAt(null);
    storyRef.current = "off";
    setStoryPaused(false);
    minuteRef.current = 0;
    setDisplayMinute(0);
  }, [catalog]);

  const draw = useCallback(() => {
    paletteRef.current ??= readPalette();
    const palette = paletteRef.current;
    const current = runRef.current;
    const label = headlineRef.current?.name ?? null;
    if (withoutRef.current) drawWorld(withoutRef.current, current, current.without, minuteRef.current, palette, base, label);
    if (withRef.current) drawWorld(withRef.current, current, current.with, minuteRef.current, palette, base, label);
  }, [base]);

  // Redraw when the run changes (sliders, delay) or the canvases resize.
  useEffect(() => {
    draw();
    const observer = new ResizeObserver(() => draw());
    if (withoutRef.current) observer.observe(withoutRef.current);
    if (withRef.current) observer.observe(withRef.current);
    return () => observer.disconnect();
  }, [draw, run]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // Cap one frame at 0.25 s: slow machines stay near real time, a hidden tab does not jump ahead.
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      minuteRef.current = Math.min(HORIZON, minuteRef.current + (dt * speed) / SECONDS_PER_MINUTE);
      if (storyRef.current === "running") {
        if (delayRef.current == null && headlineRef.current && minuteRef.current >= STORY_DELAY_AT) {
          delayRef.current = STORY_DELAY_AT;
          setDelayAt(STORY_DELAY_AT);
        }
        if (minuteRef.current >= STORY_PAUSE_AT) {
          minuteRef.current = STORY_PAUSE_AT;
          storyRef.current = "finishing";
          setStoryPaused(true);
          setDisplayMinute(STORY_PAUSE_AT);
          draw();
          setPlaying(false);
          return;
        }
      }
      draw();
      const whole = Math.floor(minuteRef.current);
      setDisplayMinute((previous) => (previous === whole ? previous : whole));
      if (minuteRef.current >= HORIZON) {
        setPlaying(false);
        if (storyRef.current === "finishing") {
          storyRef.current = "off";
          summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, draw]);

  const seek = (minute: number) => {
    minuteRef.current = minute;
    setDisplayMinute(Math.floor(minute));
    draw();
  };
  const restart = () => {
    setPlaying(false);
    setDelayAt(null);
    storyRef.current = "off";
    setStoryPaused(false);
    seek(0);
  };
  const playStory = () => {
    setDelayAt(null);
    delayRef.current = null;
    setStoryPaused(false);
    storyRef.current = "running";
    setSpeed((current) => Math.max(current, 2));
    seek(0);
    setPlaying(true);
  };
  const togglePlay = () => {
    if (storyPaused) setStoryPaused(false);
    if (displayMinute >= HORIZON) {
      storyRef.current = "off";
      seek(0);
      setPlaying(true);
      return;
    }
    setPlaying((value) => !value);
  };
  const showStarted = displayMinute >= SHOW_START;
  const canPublish = Boolean(headline) && delayAt == null && !showStarted;
  const publishDelay = () => {
    if (!canPublish) return;
    setDelayAt(Math.floor(minuteRef.current));
    if (!playing && minuteRef.current < HORIZON) setPlaying(true);
  };
  const finished = displayMinute >= HORIZON;

  // The adoption curve reruns the night 12 times (totals only, ~0.2 s), so it waits for the result
  // and runs after paint instead of during a frame.
  useEffect(() => {
    if (!finished) {
      setCurve(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const next = adoptionCurve(catalog, {
        horizonMin: HORIZON,
        acceptPct,
        show: headline ? { zone: headline.zone, startMin: SHOW_START, durationMin: SHOW_LENGTH, audiencePct: 30 } : null,
        delay: delayAt == null ? null : { atMin: delayAt, durationMin: delayLength },
      });
      if (!cancelled) setCurve(next);
    }, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [finished, catalog, headline, acceptPct, delayAt, delayLength]);
  const m = Math.min(HORIZON, displayMinute);

  const worldStats = (world: TheaterWorld) => ({
    standing: world.standingSeries[m] ?? 0,
    showCrowd: world.showCrowdSeries[m] ?? 0,
  });
  const live = { without: worldStats(run.without), with: worldStats(run.with) };
  const showName = headline?.name ?? "العرض الرئيسي";
  const status = !headline
    ? "ما في عرض في كتالوج هذه الفعالية، فالمقارنة هنا لتوزيع الحركة بدون تأخير."
    : storyPaused
      ? `شوف الفرق: بدون ونيس ${num(live.without.showCrowd)} واقف ينتظر ${showName}، ومع ونيس ${num(live.with.showCrowd)}. اضغط «كمّل» لنتيجة الليلة.`
      : delayAt != null
    ? `${clock(delayAt)} نشر المشغّل: ${showName} متأخر ${arCount(delayLength, AR_MINUTE, num)}. يبدأ ${clock(run.showActualStart ?? SHOW_START)}.`
    : showStarted
      ? `بدأ ${showName} في موعده ${clock(SHOW_START)}.`
      : `${showName} مجدول ${clock(SHOW_START)}. انشر التأخير قبل موعده وشوف الفرق.`;

  const allRows: { label: string; without: string; with: string; better: "lower" | "higher" | null; a: number; b: number; show?: boolean }[] = [
    { label: "أكبر تجمّع واقف بانتظار العرض", without: num(run.without.metrics.peakShowCrowd), with: num(run.with.metrics.peakShowCrowd), better: "lower", a: run.without.metrics.peakShowCrowd, b: run.with.metrics.peakShowCrowd, show: true },
    { label: "متوسط وقوف جمهور العرض (دقيقة)", without: num(run.without.metrics.showWaitMin, 1), with: num(run.with.metrics.showWaitMin, 1), better: "lower", a: run.without.metrics.showWaitMin, b: run.with.metrics.showWaitMin, show: true },
    { label: "زوار وقفوا ٢٠ دقيقة أو أكثر في مكان واحد", without: `${num(run.without.metrics.longWaitPct, 1)}٪`, with: `${num(run.with.metrics.longWaitPct, 1)}٪`, better: "lower", a: run.without.metrics.longWaitPct, b: run.with.metrics.longWaitPct },
    { label: "إجمالي دقائق الوقوف لكل الزوار", without: num(run.without.metrics.standingMinutes), with: num(run.with.metrics.standingMinutes), better: "lower", a: run.without.metrics.standingMinutes, b: run.with.metrics.standingMinutes },
    { label: "زيارات وأنشطة تمت", without: num(run.without.metrics.visits), with: num(run.with.metrics.visits), better: "higher", a: run.without.metrics.visits, b: run.with.metrics.visits },
    { label: `حضروا ${showName}`, without: num(run.without.metrics.showAttendance), with: num(run.with.metrics.showAttendance), better: "higher", a: run.without.metrics.showAttendance, b: run.with.metrics.showAttendance, show: true },
  ];
  const rows = headline ? allRows : allRows.filter((row) => !row.show);

  return (
    <main className={`container ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <p className={`${styles.eyebrow} brand-eyebrow`}><BrandLogo height={28} label="ونيس" /><span>محاكاة حتمية، ليست بيانات حية</span></p>
          <h1>مسرح الحركة</h1>
          <p className={styles.source} role="status">
            {source.status === "loading" ? "جارٍ تحميل كتالوج الفعالية…"
              : source.status === "error" ? `تعذّر تحميل الفعالية «${source.slug}»، نعرض كتالوج العرض المحلي.`
                : source.status === "ready" ? `الكتالوج المنشور: ${source.name}`
                  : `كتالوج العرض: ${source.name}`}
          </p>
          <p className={styles.lede}>نفس {num(run.options.visitors)} زائر، نفس الليلة، نفس التأخير. الفرق الوحيد: {num(adoptionPct)}٪ منهم معهم ونيس.</p>
        </div>
        <a className={styles.back} href="/ops">لوحة المشغّل <span aria-hidden="true">←</span></a>
      </header>

      <section className={styles.controls} aria-label="التحكم بالمحاكاة">
        <div className={styles.buttons}>
          <button type="button" className={styles.primary} onClick={togglePlay}>
            {playing ? "إيقاف مؤقت" : finished ? "أعد الليلة" : displayMinute > 0 ? "كمّل" : "شغّل الليلة"}
          </button>
          <button type="button" className={styles.story} onClick={playStory} disabled={!headline || source.status === "loading"}>
            القصة كاملة بضغطة
          </button>
          <button type="button" className={styles.delay} onClick={publishDelay} disabled={!canPublish}>
            {delayAt != null ? `نُشر التأخير ${clock(delayAt)}` : showStarted ? "بدأ العرض — أعد التشغيل لتجرب" : `انشر: تأخير ${showName} ${arCount(delayLength, AR_MINUTE, num)}`}
          </button>
          <button type="button" className={styles.ghost} onClick={restart}>من البداية</button>
          <button type="button" className={styles.ghost} onClick={() => { setPlaying(false); seek(HORIZON); }}>النتيجة</button>
          <label className={styles.speed}>
            السرعة
            <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
              <option value={1}>١×</option>
              <option value={2}>٢×</option>
              <option value={4}>٤×</option>
            </select>
          </label>
        </div>
        {shows.length > 0 && (
          <div className={styles.pickers}>
            <label className={styles.speed}>
              العرض
              <select
                value={headline?.activityId ?? ""}
                disabled={delayAt != null}
                onChange={(event) => { setShowId(event.target.value); setDelayAt(null); }}
              >
                {shows.map((show) => <option key={show.activityId} value={show.activityId}>{show.name}</option>)}
              </select>
            </label>
            <label className={styles.speed}>
              مدة التأخير
              <select value={delayLength} disabled={delayAt != null} onChange={(event) => setDelayLength(Number(event.target.value))}>
                {DELAY_CHOICES.map((minutes) => <option key={minutes} value={minutes}>{arCount(minutes, AR_MINUTE, num)}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className={styles.sliders}>
          {/* htmlFor ties each label to its slider; inside a label the <output> would otherwise take the name. */}
          <div className={styles.slider}>
            <label htmlFor="theater-adoption">زوار معهم ونيس <output aria-hidden="true">{num(adoptionPct)}٪</output></label>
            <input id="theater-adoption" type="range" min={0} max={100} step={10} value={adoptionPct} aria-valuetext={`${num(adoptionPct)}٪`} onChange={(event) => setAdoptionPct(Number(event.target.value))} />
          </div>
          <div className={styles.slider}>
            <label htmlFor="theater-accept">يقبلون اقتراح البديل <output aria-hidden="true">{num(acceptPct)}٪</output></label>
            <input id="theater-accept" type="range" min={0} max={100} step={10} value={acceptPct} aria-valuetext={`${num(acceptPct)}٪`} onChange={(event) => setAcceptPct(Number(event.target.value))} />
          </div>
        </div>
        <label className={styles.timeline}>
          <span className={styles.srOnly}>الوقت في الليلة</span>
          <input
            type="range"
            min={0}
            max={HORIZON}
            step={1}
            value={m}
            aria-valuetext={clock(m)}
            onChange={(event) => { setPlaying(false); seek(Number(event.target.value)); }}
          />
          <span aria-hidden="true">{clock(HORIZON)}</span>
        </label>
        <p className={styles.status} role="status" aria-live="polite"><strong>{clock(m)}</strong> · {status}</p>
      </section>

      <section className={styles.worlds}>
        {([
          ["without", "بدون ونيس", "الزوار يمشون حسب الشهرة، ويعرفون بالتأخير لما يوصلون.", withoutRef],
          ["with", "مع ونيس", `${num(adoptionPct)}٪ يشوفون الزحام الحي، ويوصلهم الموعد الجديد مع بديل قريب.`, withRef],
        ] as const).map(([key, title, note, ref]) => (
          <article key={key} className={`${styles.world} ${key === "with" ? styles.withWorld : ""}`}>
            <header>
              <h2>{title}</h2>
              <p>{note}</p>
            </header>
            <canvas ref={ref} className={styles.canvas} style={{ aspectRatio: `1 / ${base.aspect}` }} role="img" aria-label={`${title}: ${num(live[key].standing)} واقفين الآن، منهم ${num(live[key].showCrowd)} بانتظار العرض`} />
            <dl className={styles.live}>
              <div><dt>واقفين الآن</dt><dd>{num(live[key].standing)}</dd></div>
              <div><dt>بانتظار العرض</dt><dd>{num(live[key].showCrowd)}</dd></div>
              {key === "with" && <div><dt>وصلهم الموعد الجديد</dt><dd>{delayAt != null && m >= delayAt ? num(run.with.metrics.notified + run.with.metrics.proposalsSent) : "—"}</dd></div>}
            </dl>
          </article>
        ))}
      </section>

      <ul className={styles.key} aria-label="دليل الألوان">
        <li><i className={styles.dotEnjoy} />يستمتع بنشاط</li>
        <li><i className={styles.dotWalk} />يمشي</li>
        <li><i className={styles.dotQueue} />في طابور</li>
        <li><i className={styles.dotShow} />واقف بانتظار العرض</li>
      </ul>

      <Chart run={run} minute={displayMinute} clock={clock} />

      <section ref={summaryRef} className={styles.summary} aria-label="نتيجة الليلة">
        <h2>نتيجة الليلة كاملة</h2>
        {finished ? (
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th scope="col">المؤشر</th><th scope="col">بدون ونيس</th><th scope="col">مع ونيس</th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const improved = row.better === "lower" ? row.b < row.a : row.better === "higher" ? row.b > row.a : false;
                  const worse = row.better === "lower" ? row.b > row.a : row.better === "higher" ? row.b < row.a : false;
                  return (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td>{row.without}</td>
                      <td className={improved ? styles.better : worse ? styles.worse : undefined}>{row.with}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {delayAt != null && (
              <p className={styles.note}>
                وصل الموعد الجديد لـ {num(run.with.metrics.notified + run.with.metrics.proposalsSent)} من مستخدمي ونيس.{" "}
                {run.with.metrics.proposalsSent > 0
                  ? `${num(run.with.metrics.proposalsSent)} منهم كانوا واقفين أو في طريقهم للعرض، وقبل ${num(run.with.metrics.proposalsAccepted)} بديلًا قريبًا من منسّق الحركة ورجعوا قبل العرض.`
                  : "وصلهم قبل ما يتجهون للعرض، فكمّلوا جولتهم بدل الوقوف وجوا في الموعد الجديد."}
              </p>
            )}
            {delayAt == null && <p className={styles.note}>شغّلت الليلة بدون تأخير. أعدها وانشر التأخير قبل {clock(SHOW_START)} لترى أثر ونيس وقت التغيير.</p>}
          </div>
        ) : (
          <p className={styles.note}>تظهر المقارنة كاملة نهاية الليلة ({clock(HORIZON)})، أو اضغط «النتيجة».</p>
        )}
      </section>

      {finished && <AdoptionImpact curve={curve} currentPct={adoptionPct} delayed={delayAt != null && Boolean(headline)} showName={headline?.name ?? ""} />}

      <details className={styles.assumptions}>
        <summary>كيف تشتغل المحاكاة؟</summary>
        <ul>
          <li>نفس الزوار في العالمين: وقت الدخول والاهتمامات والقرارات العشوائية من نفس البذرة. لو نسبة ونيس ٠٪ يطلع العالمان متطابقين دقيقة بدقيقة.</li>
          <li>بدون ونيس: كل زائر يختار المنطقة التالية حسب شهرتها وقربها، ويشوف الطابور بس لما يوصل. نصفهم يتركون الطابور لو فوق {num(25)} دقيقة.</li>
          <li>مع ونيس: مستخدمو ونيس يوزنون الاختيار بالانتظار الحي. ولما ينشر المشغّل التأخير يوصلهم الموعد الجديد، واللي واقف أو ماشي للعرض يجيه بديل قريب من منسّق الحركة نفسه (<code>diversionTargets</code>) يرجّعه قبل العرض.</li>
          <li>مناطق وزوايا بوليفارد وورلد من الكتالوج المنشور؛ طاقة كل منطقة تقديرية حسب عدد أنشطتها، وليست أرقام تشغيل حقيقية.</li>
          <li>{num(30)}٪ من الزوار يبون {showName}. مدة العرض {num(SHOW_LENGTH)} دقيقة، والتأخير {arCount(delayLength, AR_MINUTE, num)}.</li>
        </ul>
      </details>
    </main>
  );
}
