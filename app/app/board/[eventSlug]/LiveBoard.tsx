"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Catalog } from "@/engine/types";
import { boardClock, buildBoard, type CrowdReading, type LiveUpdate } from "@/lib/live-board";
import styles from "./board.module.css";
import { BrandLogo } from "@/components/Brand";

const POLL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 8_000;
/** A failed refresh retries sooner (2s, 4s, 8s…) up to the normal poll, so a gate screen never waits a full poll after a blip. */
const RETRY_BASE_MS = 2_000;
/** After this long without a successful refresh, the screen says it is showing old data. */
const STALE_AFTER_MS = 60_000;

type Clock = { nowMinute: number; actualMinute?: number; isOpen: boolean; isWithinEvent?: boolean };
type CrowdPayload = { clock: Clock; threshold: number; zones: CrowdReading[]; nextPollAfterMs?: number };
type LivePayload = { clock: Clock; updates: LiveUpdate[] };

const num = (value: number) => value.toLocaleString("en-US", { useGrouping: false });

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status}`);
  const body = await response.json();
  return (body?.data ?? body) as T;
}

function withTimeout(parent: AbortSignal) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  parent.addEventListener("abort", () => controller.abort(), { once: true });
  return { signal: controller.signal, done: () => window.clearTimeout(timer) };
}

function isCatalog(value: unknown): value is Catalog {
  const catalog = value as Catalog | null;
  return Boolean(catalog && Array.isArray(catalog.zones) && Array.isArray(catalog.activities) && catalog.site);
}

export function LiveBoard({ eventSlug }: { eventSlug: string }) {
  const [eventName, setEventName] = useState<string>("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [crowd, setCrowd] = useState<CrowdPayload | null>(null);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [receivedAt, setReceivedAt] = useState<number>(0);
  const [now, setNow] = useState<number>(0);
  const [tv, setTv] = useState(false);
  const [origin, setOrigin] = useState("");
  const [weather, setWeather] = useState<{ summaryAr: string; live: boolean } | null>(null);
  const pollRef = useRef<number | null>(null);
  const catalogRef = useRef<Catalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/weather`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (!cancelled && payload?.data?.weather) setWeather(payload.data.weather); })
      .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 10 * 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [eventSlug]);

  useEffect(() => {
    setTv(new URLSearchParams(window.location.search).get("tv") === "1");
    setOrigin(window.location.origin);
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(tick);
  }, []);

  /** Resolves true when the next refresh can wait a normal poll, false when it should retry sooner. */
  const refresh = useCallback(async (signal: AbortSignal): Promise<boolean> => {
    const slug = encodeURIComponent(eventSlug);
    const request = withTimeout(signal);
    try {
      const needsCatalog = !catalogRef.current;
      const [eventPayload, crowdPayload, livePayload] = await Promise.all([
        needsCatalog ? getJson<{ eventName?: string; catalog?: unknown }>(`/api/events/${slug}`, request.signal) : Promise.resolve(null),
        getJson<CrowdPayload>(`/api/v1/events/${slug}/crowd`, request.signal),
        getJson<LivePayload>(`/api/v1/events/${slug}/live`, request.signal),
      ]);
      if (needsCatalog) {
        if (!eventPayload || !isCatalog(eventPayload.catalog)) throw new Error("catalog incomplete");
        catalogRef.current = eventPayload.catalog;
        setCatalog(eventPayload.catalog);
        setEventName(typeof eventPayload.eventName === "string" ? eventPayload.eventName : eventPayload.catalog.site.name);
      }
      setCrowd(crowdPayload);
      setLive(livePayload);
      setReceivedAt(Date.now());
      setLastOkAt(Date.now());
      setStatus("ready");
      return true;
    } catch (error) {
      if (signal.aborted) return true;
      // Re-read the clock now, so a failure past the stale limit says so at once rather than at the next tick.
      setNow(Date.now());
      // Keep showing the last good reading; only an unknown event replaces the screen.
      const missing = String((error as Error).message) === "404";
      setStatus((current) => (current === "ready" ? "ready" : missing ? "missing" : "error"));
      return missing;
    } finally {
      request.done();
    }
  }, [eventSlug]);

  useEffect(() => {
    const controller = new AbortController();
    let failures = 0;
    const schedule = (ok: boolean) => {
      failures = ok ? 0 : failures + 1;
      const delay = ok ? POLL_MS : Math.min(POLL_MS, RETRY_BASE_MS * 2 ** (failures - 1));
      if (pollRef.current) window.clearTimeout(pollRef.current);
      pollRef.current = window.setTimeout(async () => {
        schedule(document.hidden ? true : await refresh(controller.signal));
      }, delay);
    };
    void refresh(controller.signal).then(schedule);
    const onVisible = () => {
      if (!document.hidden) void refresh(controller.signal);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      if (pollRef.current) window.clearTimeout(pollRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const clock = crowd?.clock ?? live?.clock ?? null;
  // The server clock plus the minutes since we received it, so the screen keeps time between polls.
  const elapsedMinutes = receivedAt ? Math.max(0, Math.floor((now - receivedAt) / 60_000)) : 0;
  // Planning minute: while closed the server pins it to opening time, so tonight's shows still list.
  const nowMinute = clock ? clock.nowMinute + (clock.isOpen ? elapsedMinutes : 0) : 0;
  // What the wall clock shows: the real local time, never the pinned opening time.
  const displayMinute = clock ? (clock.isOpen ? nowMinute : (clock.actualMinute ?? clock.nowMinute) + elapsedMinutes) : 0;
  const board = useMemo(() => (catalog && crowd ? buildBoard({
    catalog,
    crowd: crowd.zones,
    threshold: crowd.threshold ?? catalog.site.crowd_threshold,
    updates: live?.updates ?? [],
    nowMinute,
  }) : null), [catalog, crowd, live, nowMinute]);
  const stale = lastOkAt != null && now - lastOkAt > STALE_AFTER_MS;
  const openingMinute = catalog ? (catalog.site.opening.from < 100 ? catalog.site.opening.from * 60 : catalog.site.opening.from) : null;
  const planUrl = `${origin}/events/${eventSlug}`;

  if (status === "missing") {
    return (
      <main className={`container ${styles.page}`}>
        <h1>لوحة الموقع</h1>
        <p className={styles.empty} role="alert">ما لقينا فعالية منشورة بهذا الرابط.</p>
      </main>
    );
  }
  if (!board || !clock) {
    return (
      <main className={`container ${styles.page}`} aria-busy={status === "loading"}>
        <h1>لوحة الموقع</h1>
        <p className={styles.empty} role="status">{status === "error" ? "تعذّر تحميل حالة الموقع. نعيد المحاولة تلقائيًا." : "جارٍ تحميل حالة الموقع…"}</p>
      </main>
    );
  }

  return (
    <main className={`container ${styles.page} ${tv ? styles.tv : ""}`}>
      <header className={styles.header}>
        <div>
          <p className={`${styles.eyebrow} brand-eyebrow`}><BrandLogo height={30} label="ونيس" /><span>لوحة الموقع</span></p>
          <h1>{eventName}</h1>
        </div>
        <div className={styles.clockBox}>
          <span className={styles.clock}>{boardClock(displayMinute)}</span>
          {clock.isOpen
            ? <span className={styles.livePill}><i aria-hidden="true" />مباشر</span>
            : <span className={styles.closedPill}>مغلق الحين{openingMinute != null ? ` · يفتح ${boardClock(openingMinute)}` : ""}</span>}
        </div>
      </header>

      <p className={stale ? styles.staleNote : styles.freshness} role="status">
        {stale
          ? `تعذّر التحديث. نعرض آخر قراءة (${lastOkAt ? new Date(lastOkAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : ""}).`
          : `يتحدّث كل ${num(POLL_MS / 1000)} ثانية${board.anyMeasured ? "" : " · قراءات الزحام تقديرية، ليست من حساسات"}.`}
      </p>
      {weather && <p className={styles.freshness}>الطقس في الموقع: {weather.summaryAr}{weather.live ? " (Open-Meteo)" : ""}</p>}

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="board-quiet">
          <h2 id="board-quiet">الأهدأ الحين</h2>
          {board.quietest.length ? (
            <ol className={styles.quietList}>
              {board.quietest.map((zone) => (
                <li key={zone.id}>
                  <strong>{zone.name}</strong>
                  <span className={styles.meter} aria-hidden="true"><i className={styles[zone.band]} style={{ width: `${Math.max(6, Math.round(zone.level * 100))}%` }} /></span>
                  <small>{zone.band === "calm" ? "زحام خفيف" : "زحام متوسط"} · {num(zone.activityCount)} {zone.activityCount === 1 ? "نشاط" : "أنشطة"} · {zone.sourceLabel}</small>
                </li>
              ))}
            </ol>
          ) : <p className={styles.empty}>كل المناطق مزدحمة الحين. جرّب بعد شوي.</p>}
        </section>

        <section className={styles.card} aria-labelledby="board-shows">
          <h2 id="board-shows">{clock.isOpen ? "العروض الجاية" : "عروض الليلة"}</h2>
          {board.shows.length ? (
            <ul className={styles.shows}>
              {board.shows.map((show) => {
                const running = clock.isOpen && !show.cancelled && show.startsMinute <= nowMinute;
                return (
                  <li key={`${show.activityId}-${show.scheduledMinute}`} className={show.cancelled ? styles.cancelled : undefined}>
                    <span className={styles.showTime}>
                      {show.delayMinutes > 0 && <s aria-label={`الموعد المعلن ${boardClock(show.scheduledMinute)}`}>{boardClock(show.scheduledMinute)}</s>}
                      {boardClock(show.startsMinute)}
                    </span>
                    <span className={styles.showName}>{show.name}<small>{show.zoneName}</small></span>
                    {show.cancelled ? <span className={styles.badgeOff}>ملغي</span>
                      : show.delayMinutes > 0 ? <span className={styles.badgeLate}>متأخر {num(show.delayMinutes)} د</span>
                        : running ? <span className={styles.badgeNow}>يعرض الحين</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : <p className={styles.empty}>ما في عروض باقية الليلة.</p>}
        </section>

        <section className={styles.card} aria-labelledby="board-notices">
          <h2 id="board-notices">تنبيهات إدارة الموقع</h2>
          {board.notices.length ? (
            <ul className={styles.notices}>
              {board.notices.map((notice, index) => (
                <li key={`${notice.kind}-${index}`} className={styles[`notice_${notice.kind}`]}>
                  <strong>{notice.title}</strong>
                  {notice.reason && <span>{notice.reason}</span>}
                </li>
              ))}
            </ul>
          ) : <p className={styles.empty}>ما في تنبيهات الحين.</p>}
        </section>

        <section className={`${styles.card} ${styles.wide}`} aria-labelledby="board-zones">
          <h2 id="board-zones">زحام المناطق</h2>
          <ul className={styles.zones}>
            {board.zones.map((zone) => (
              <li key={zone.id} className={zone.closed ? styles.closedZone : undefined}>
                <span className={styles.zoneName}>{zone.name}</span>
                <span className={styles.meter} role="img" aria-label={zone.closed ? `${zone.name}: مغلقة` : `${zone.name}: ${num(Math.round(zone.level * 100))}% (${zone.sourceLabel})`}>
                  <i className={styles[zone.band]} style={{ width: `${zone.closed ? 100 : Math.max(4, Math.round(zone.level * 100))}%` }} />
                </span>
                <small>
                  {zone.closed ? "مغلقة مؤقتًا" : `${num(Math.round(zone.level * 100))}% · ${zone.sourceLabel}`}
                  {!zone.closed && zone.band === "packed" && zone.quietestUpcomingHour != null ? ` · أهدأ الساعة ${num(zone.quietestUpcomingHour % 24)}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className={styles.footer}>
        <p>خطّط زيارتك مع ونيس: <a href={`/events/${eventSlug}`} dir="ltr">{planUrl}</a></p>
        <p className={styles.privacy}>بيانات مجمعة بلا أي معلومات شخصية. مصدر كل قراءة مذكور بجانبها.</p>
      </footer>
    </main>
  );
}
