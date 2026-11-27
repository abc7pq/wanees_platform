"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { PITCH_EVENT_SLUG } from "../../../packages/contracts/src/index.ts";

type Stop = { act_id: string; zone: string; start: number; end: number; walk_min: number; wait_min: number; price: number; name: string; note: string };
type Itinerary = { stops: Stop[]; unfulfilled: string[]; explanations: string[]; total_cost: number };
type State = { sessionId: string; itineraryId?: string; itinerary: Itinerary | null; now: number; nowText: string; demoMode: boolean };
type Msg = { role: "agent"; text: string };
type AssistantSource = { id: string; name: string; zone?: string; zoneName?: string; durationMin?: number; priceSar?: number; eligibilityKnown?: boolean; sourceRef: string; kind?: "activity" | "location" | "zone"; x?: number; y?: number; type?: string; description?: string; reasons?: string[] };
type ChatDirections = { targetId: string; targetName: string; totalWalkMin: number; avoided: string[]; crowdedOnRoute: string[] };
type ChatMsg = { role: "agent" | "user" | "typing"; text: string; options?: AssistantSource[]; ui?: A2uiMessage[] | null; handoff?: boolean; directions?: ChatDirections | null };
type Alert = { stop_act: string; stop_name: string; zone: string; level: number; text: string; suggestion: { id: string; name: string } };
type PlanDiff = { removed?: { name: string }[]; added?: { name: string; start?: number }[]; moved?: { name: string; from?: { start: number }; to?: { start: number } }[] };
type ReplanProposal = { id: string; kind?: "assistant" | "live"; candidate: Itinerary; baseItineraryId?: string; baseLiveRevision?: string; proposalExpiresAt?: string | null; diff: PlanDiff; reason?: string; announcedAt?: string; incentive?: IncentiveDisplay | null };
type CurrentCrowd = { zone: string; observedAt: string; level: number; source: string; observation?: { measurement?: string; waitMinutes?: number } | null };
type VisitorOffer = { incentive: IncentiveDisplay; claimed: boolean };
type EventCatalog = {
  site: { name: string };
  zones: { id: string; name: string }[];
  activities: { id: string; name: string; zone?: string; interests: string[]; moods: string[] }[];
  locations?: { id: string; label: string; status: string; type: string; description?: string; zone?: string; aliases?: string[] }[];
  routeGraph?: { nodes: GpsRouteNode[] };
};
type DirectionsStep = { id: string; label: string; type: string; zoneName?: string | null; walkMinFromPrev: number; crowdLevel?: number | null; crowded?: boolean };
type DirectionsPayload = { origin: { id: string; name: string }; target: { id: string; name: string; kind: string }; arrival: "destination_node" | "zone"; demoRoute: boolean; totalWalkMin: number; mode: string; steps: DirectionsStep[]; pathNodes: { x: number; y: number }[] };

import { firstFutureDemoStop } from "@/lib/demo-event-target";
import type { IncentiveDisplay } from "@/lib/incentives/types";
import { ItineraryTimeRange } from "@/lib/quiz-progress";
import { applyReplanOutcome, sendReplanDecision, STALE_PROPOSAL_MESSAGE } from "@/lib/replan-decision";
import { preferencesFromSnapshot as savedPreferences } from "@/lib/visitor-preferences";
import { understandMessage } from "@/lib/visitor-understanding";
import type { GuideState } from "@/components/PrecisionGuide";
import { TURN_ICON, bearingDegrees, buildManeuvers, describeManeuver, distanceAlongPath, distanceFromPath, nextManeuver } from "@/lib/maneuvers";
import { VisitorDialog } from "@/components/VisitorDialog";
import { VisitRating } from "@/components/VisitRating";
import { LockScreenNudges } from "@/components/LockScreenNudges";
import { useWideVisitorLayout } from "@/components/VisitorTabs";
import { BottomNav } from "@/components/BottomNav";
import { NearbyPanel, type NearbyPosition } from "@/components/NearbyPanel";
import { MePanel, type MePreferences } from "@/components/MePanel";
import { LinkScreen } from "@/components/LinkScreen";
import { ToastHost, useToasts } from "@/components/Toast";
import { VISITOR_TABS, parseVisitorPath, tabPath, type VisitorTabId } from "@/lib/visitor-routes";
import { acceptGpsSample, freshPosition, gpsRetryDelays, simulatedPosition, type GpsSample } from "@/lib/visitor-position-client";
import { createVenueGeo, hasGeoCalibration, snapVenuePosition, type GpsRouteNode, type VenueNavigation, type VenuePoint } from "@/lib/venue-gps";
import { createVoiceCall, type VoiceCallState, type VoiceRecognition, type VoiceReply } from "@/lib/voice-call";
import type { RealtimeCallHandle } from "@/lib/realtime-call";
import type { A2uiActionMessage, A2uiMessage } from "@/lib/a2ui";
import { surfaceProposalId } from "@/lib/a2ui-proposal";
import { BrandLogo, Mascot } from "@/components/Brand";
import { VisitorRegistration } from "@/components/VisitorRegistration";
import { forParty, stopPriceLabel } from "@/lib/price-label";
import { AR_MINUTE, arCount, minutesCount } from "@/lib/ar-count";

// Loaded on demand so /demo does not ship them in its first bundle: the map (Leaflet and the park art),
// the compass guide, and the assistant's card renderer (A2UI and its validator). The live voice call
// module is imported when a call starts.
const VenueGeoMap = dynamic(() => import("@/components/VenueGeoMap").then((m) => ({ default: m.VenueGeoMap })), {
  ssr: false,
  loading: () => <div className="map-card map-loading" role="status">جارٍ تجهيز الخريطة…</div>,
});
const PrecisionGuide = dynamic(() => import("@/components/PrecisionGuide").then((m) => ({ default: m.PrecisionGuide })), { ssr: false });
const A2uiSurface = dynamic(() => import("@/components/A2uiSurface").then((m) => ({ default: m.A2uiSurface })), {
  loading: () => <div className="a2ui-loading" role="status">جارٍ تجهيز البطاقة…</div>,
});

type GpsFix = Extract<ReturnType<typeof snapVenuePosition>, { status: "ready" }>;

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;


/** Party size the plan was built for (engine prices are per person); null when the server did not say. */
function planPartySize(...candidates: unknown[]) {
  for (const value of candidates) {
    const size = Number(value);
    if (Number.isInteger(size) && size >= 1 && size <= 50) return size;
  }
  return null;
}

/** «دقيقة / دقيقتين / ٣ دقائق / ١١ دقيقة» — Arabic counted-noun agreement for minutes. */
function arabicMinutes(n: number) {
  return arCount(n, AR_MINUTE);
}

function venueTimeLabel(value: string, timeZone: string) {
  // 24-hour Western digits, matching every other time in the visitor app (17:00, 18:30…).
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Date(value).toLocaleTimeString("ar-SA-u-nu-latn", { ...options, timeZone });
  } catch {
    return new Date(value).toLocaleTimeString("ar-SA-u-nu-latn", { ...options, timeZone: "Asia/Riyadh" });
  }
}

// A full page load that lands on `target` (or the current URL) and survives a same-document
// navigation racing it: Chromium drops a pending load when history.pushState/replaceState commits
// (the tab-path sync or a nudge cleanup can do that), which left «زيارة جديدة» on the old plan.
// The watchdog re-issues the load until the page actually unloads.
function hardRestart(target?: string) {
  const here = window.location.pathname + window.location.search;
  const url = target ?? here;
  let attempts = 0;
  let unloading = false;
  window.addEventListener("pagehide", () => { unloading = true; }, { once: true });
  const go = () => {
    attempts += 1;
    if (url === here) location.reload();
    else location.replace(url);
  };
  go();
  const timer = window.setInterval(() => {
    if (unloading || attempts >= 4) { window.clearInterval(timer); return; }
    go();
  }, 1200);
}

// جلسة المتصفح تعتمد على HttpOnly cookie؛ يبقى الرمز في الذاكرة فقط عند
// تعطيل cookie session كمسار توافق مؤقت.
let durableToken = "";
let durableSessionActive = false;
const DEFAULT_EVENT_SLUG = "boulevard-world-demo";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"/></>,
    bolt: <path d="m13 2-3 9h7l-8 11 2-9H6l7-11Z"/>,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/></>,
    walk: <><circle cx="13" cy="4" r="2"/><path d="m7 21 3-6 2-3 3 2 2 4m-6-6-3-1-3 4m6-4 2-5 4 2"/></>,
    price: <><path d="M20 13 11 22l-9-9V2h11l9 9a1.4 1.4 0 0 1-2 2Z"/><circle cx="7" cy="7" r="1"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    crowd: <><circle cx="12" cy="8" r="3"/><path d="M5 20v-1a7 7 0 0 1 14 0v1M4 9a2.5 2.5 0 0 0 0 5m16-5a2.5 2.5 0 0 1 0 5"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/></>,
    phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>,
    mic: <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></>,
    micOff: <><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5 2.2M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.4 2.3M12 18v4M8 22h8M3 3l18 18"/></>,
    gift: <><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5h4Zm0 0s1.5-5 4-5a2.5 2.5 0 0 1 0 5h-4Z"/></>,
    chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>,
    play: <><path d="m8 5 12 7-12 7V5Z"/></>,
    rotate: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3"/></>,
    shuffle: <><path d="m18 14 4 4-4 4m0-20 4 4-4 4M2 18h2.5a6 6 0 0 0 4.2-1.7l6.6-6.6A6 6 0 0 1 19.5 8H22M2 6h2.5a6 6 0 0 1 4.2 1.7l1.2 1.2m4.2 4.2 1.2 1.2a6 6 0 0 0 4.2 1.7H22"/></>,
    question: <><circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.3 1.7c-1.1 1.1-1.9 1.5-1.9 3m0 3h.01"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    more: <><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></>,
    share: <><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4m-7.6 6.8 7.6 4.4"/></>,
    trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></>,
    close: <path d="m18 6-12 12M6 6l12 12"/>,
    clockAdd: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2m4-10v4m-2-2h4"/></>,
    back: <><path d="m15 18-6-6 6-6"/><path d="M9 12h11"/></>,
    sparkles: <><path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7L12 3Z"/><path d="m18.5 14.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></>,
    heart: <path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7 7-7Z"/>,
    family: <><circle cx="7" cy="6" r="2.5"/><circle cx="17" cy="6" r="2.5"/><circle cx="12" cy="13" r="2"/><path d="M3 21v-4a4 4 0 0 1 4-4m14 8v-4a4 4 0 0 0-4-4M9 21v-1.5a3 3 0 0 1 6 0V21"/></>,
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>,
    smile: <><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></>,
    wallet: <><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 11h-5a2 2 0 0 0 0 4h5v-4Z"/></>,
    coins: <><circle cx="9" cy="9" r="6"/><path d="M18.1 10.4a6 6 0 1 1-7.7 7.7M8 7h1.5v4"/></>,
    gem: <><path d="M6 3h12l4 6-10 12L2 9l4-6Z"/><path d="M2 9h20M12 21 8 9l4-6 4 6-4 12"/></>,
    infinity: <path d="M12 12c-2-2.7-4-4-6-4a4 4 0 0 0 0 8c2 0 4-1.3 6-4Zm0 0c2 2.7 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.3-6 4Z"/>,
    ticket: <><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8Z"/><path d="M13 6v2m0 3v2m0 3v2"/></>,
    mountain: <><path d="m3 20 6-11 4 6 3-4 5 9H3Z"/><path d="m7.5 12 1.5 1.5L11 12"/></>,
    utensils: <path d="M4 3v7a3 3 0 0 0 3 3v8M7 3v6m3-6v7a3 3 0 0 1-3 3m10 8V3c-2 1-3 3.5-3 7 0 2 1 3 3 3"/>,
    landmark: <path d="M3 21h18M5 21V11m4 10V11m6 10V11m4 10V11M2 11l10-7 10 7H2Z"/>,
    gamepad: <><rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4M8 10v4m7-2h.01M18 10h.01"/></>,
    bag: <><path d="M6 7h12l1 14H5L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></>,
    coffee: <path d="M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8ZM6 2v2m4-2v2m4-2v2"/>,
    leaf: <><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/></>,
    timer: <><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M10 2h4"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.compass}</svg>;
}
async function api(op: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, ...payload }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// Called once when a request of an active visit answers 401/404: the cookie is gone or the session
// expired (24 h) while the page stayed open. The page restarts the visit instead of saying «تعذر الاتصال».
let durableSessionLost: (() => void) | null = null;

async function durableRequest(path: string, options: RequestInit = {}) {
  const token = durableToken;
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("x-wanees-session-token", token);
  const res = await fetch(path, { ...options, headers, credentials: "include" });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(data?.error?.code ?? `HTTP ${res.status}`) as Error & { status?: number; code?: string };
    error.status = res.status;
    error.code = data?.error?.code;
    if (durableSessionActive && (error.code === "SESSION_TOKEN_REQUIRED" || error.code === "SESSION_NOT_FOUND")) {
      durableSessionActive = false;
      durableSessionLost?.();
    }
    throw error;
  }
  return data;
}

// The visitor cookie is HttpOnly, so the page cannot see it. This flag only records that this
// browser started a session for the event, so a first visit skips the restore GET (which answers
// 401 SESSION_TOKEN_REQUIRED without a cookie). It holds no token or identity.
const durableHintKey = (eventSlug: string) => `wanees_durable_hint:${eventSlug}`;
function setDurableHint(eventSlug: string, on: boolean) {
  try {
    if (on) localStorage.setItem(durableHintKey(eventSlug), "1");
    else localStorage.removeItem(durableHintKey(eventSlug));
  } catch {}
}
function hasDurableHint(eventSlug: string) {
  try { return localStorage.getItem(durableHintKey(eventSlug)) === "1"; } catch { return false; }
}

function trackDurable(eventSlug: string, metricName: string, extra: Record<string, unknown> = {}) {
  if (!durableSessionActive) return;
  void durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/analytics`, {
    method: "POST",
    body: JSON.stringify({ metricName, ...extra }),
  }).catch(() => {});
}

// Not exported: a page module may only export Next.js page fields, or `next build` fails.
// /events/[slug] renders this page's default export; the slug and the legacy fallback come from the URL.
function VisitorGuide({ eventSlug: suppliedEventSlug, allowLegacyFallback: suppliedFallback }: { eventSlug?: string; allowLegacyFallback?: boolean } = {}) {
  const pathname = usePathname();
  // The entry URL decides the event and the opening tab (audit 2.1): /e/{slug}[/plan|/map|/nearby|/me].
  // /demo stays as the rehearsal alias of the default event; /events/{slug} redirects to /e/{slug}.
  const [entryPath] = useState(() => pathname ?? "");
  const entryRoute = parseVisitorPath(entryPath);
  const onEventsPath = entryPath.startsWith("/events/");
  const eventSlug = suppliedEventSlug ?? entryRoute?.slug ?? (onEventsPath
    ? decodeURIComponent(entryPath.split("/")[2] ?? DEFAULT_EVENT_SLUG)
    : DEFAULT_EVENT_SLUG);
  const isPitch = eventSlug === PITCH_EVENT_SLUG;
  const isFixture = isPitch || eventSlug === DEFAULT_EVENT_SLUG;
  // The in-memory fallback and the operator link exist only for the rehearsal events.
  const allowLegacyFallback = suppliedFallback ?? (onEventsPath ? false : entryRoute ? isFixture : true);
  const showOperatorLink = allowLegacyFallback && !onEventsPath;
  const urlSynced = Boolean(entryRoute);
  const [showPlaces, setShowPlaces] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeMapId, setPlaceMapId] = useState<string | null>(null);
  const placesDialogRef = useRef<HTMLDialogElement | null>(null);
  const placeMapRef = useRef<HTMLDivElement | null>(null);
  const proposalDialogRef = useRef<HTMLDialogElement | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalError, setProposalError] = useState("");
  const [planNotice, setPlanNotice] = useState("");
  const [liveCrowd, setLiveCrowd] = useState<CurrentCrowd[]>([]);
  const [visitorOffers, setVisitorOffers] = useState<VisitorOffer[] | null>(null);
  const [offerMessage, setOfferMessage] = useState("");
  const [claimingOffer, setClaimingOffer] = useState(false);
  const [lastLiveCheck, setLastLiveCheck] = useState<string | null>(null);
  const [eventName, setEventName] = useState("");
  const [eventTimezone, setEventTimezone] = useState("Asia/Riyadh");
  const [eventCatalog, setEventCatalog] = useState<EventCatalog | null>(null);
  // Venue navigation settings (Venue.liveGuidance, calibration…) published with the catalog.
  const [eventNavigation, setEventNavigation] = useState<VenueNavigation | null>(null);
  const venueGeo = useMemo(() => (eventNavigation && hasGeoCalibration(eventNavigation) ? createVenueGeo(eventNavigation.calibration) : null), [eventNavigation]);
  const [eventLoadState, setEventLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [eventLoadError, setEventLoadError] = useState("");
  // A link to an event that does not exist: retrying cannot help, so the page offers the home page instead.
  const [eventMissing, setEventMissing] = useState(false);
  const [map2dEnabled, setMap2dEnabled] = useState(true);
  const [selectedStartPoint, setSelectedStartPoint] = useState("");
  // Group size and youngest child's age: prices are per head, the budget is for the group,
  // and age limits are checked against the youngest child.
  const [partyCount, setPartyCount] = useState(1);
  const [youngestChildAge, setYoungestChildAge] = useState<number | null>(null);
  const [phase, setPhase] = useState<"welcome" | "plan">("welcome");
  const [state, setState] = useState<State | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const chatInFlightRef = useRef(false);
  // Latest itinerary for long-lived effects (the live poll) that must not read a stale closure.
  const itineraryRef = useRef<Itinerary | null>(null);
  itineraryRef.current = state?.itinerary ?? null;
  const [confirmNewVisit, setConfirmNewVisit] = useState(false);
  const newVisitOpener = useRef<HTMLButtonElement | null>(null);
  // The venue closed after being open (or the clock is past closing): the night is over.
  const [closedForNight, setClosedForNight] = useState(false);
  const sawVenueOpenRef = useRef(false);
  const [showWhy, setShowWhy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [visitResetError, setVisitResetError] = useState("");
  const [replanProposal, setReplanProposal] = useState<ReplanProposal | null>(null);
  const [collapsedProposalId, setCollapsedProposalId] = useState<string | null>(null);
  const [replanBusy, setReplanBusy] = useState(false);
  // Synchronous in-flight guard: replanBusy is state, so two taps in the same frame both still read `false`.
  const replanInFlightRef = useRef(false);
  const [replanFeedback, setReplanFeedback] = useState("");
  const [mapFocus, setMapFocus] = useState<string | null>(null);
  const [dirSheet, setDirSheet] = useState(false);
  // The ⋯ menu of one itinerary stop (by act_id), and the button that opened it for focus return.
  const [stopMenuId, setStopMenuId] = useState<string | null>(null);
  const stopMenuOpener = useRef<HTMLButtonElement | null>(null);
  const [dirFrom, setDirFrom] = useState("");
  const [dirTo, setDirTo] = useState("");
  const [dirResult, setDirResult] = useState<DirectionsPayload | null>(null);
  const [dirBusy, setDirBusy] = useState(false);
  const [dirError, setDirError] = useState("");
  const [dirGpsFix, setDirGpsFix] = useState<GpsFix | null>(null);
  const directionsRequestRef = useRef(0);
  const [mapPath, setMapPath] = useState<{ x: number; y: number }[] | null>(null);
  const [airGuide, setAirGuide] = useState<GuideState | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const airGuideWatchRef = useRef<number | null>(null);
  const guideSimRef = useRef<number | null>(null);
  const directionsOpener = useRef<HTMLButtonElement>(null);
  const reasonsOpener = useRef<HTMLButtonElement>(null);
  const [liveStatus, setLiveStatus] = useState<"checking" | "live" | "stale">("checking");
  // The server clock reports whether the venue is open; when closed the plan is for tonight, not live.
  const [venueOpen, setVenueOpen] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceCallState>("idle");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceReply, setVoiceReply] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const voiceCallRef = useRef<ReturnType<typeof createVoiceCall> | null>(null);
  // Live two-way call (OpenAI Realtime). Its tools reach the engine through callBridgeRef so they
  // always see this render's state, never a stale closure from when the call started.
  const realtimeCallRef = useRef<RealtimeCallHandle | null>(null);
  const [voiceMode, setVoiceMode] = useState<"realtime" | "browser" | null>(null);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const callBridgeRef = useRef<{ ask: (request: string) => Promise<unknown>; decide: (decision: "accept" | "keep_current") => Promise<unknown>; feedback: (args: { activity: string; rating: number }) => Promise<unknown> } | null>(null);
  const callOptionsRef = useRef<AssistantSource[] | undefined>(undefined);
  const callUiRef = useRef<A2uiMessage[] | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const initialTab: VisitorTabId = entryRoute?.screen === "tab" ? entryRoute.tab : entryRoute ? "map" : "itinerary";
  const [activeTab, setActiveTab] = useState<VisitorTabId>(() => initialTab);
  const [mapVisited, setMapVisited] = useState(false);
  const wideLayout = useWideVisitorLayout();
  const { toasts, show: showToast, dismiss: dismissToast } = useToasts();
  const [mePrefs, setMePrefs] = useState<MePreferences | null>(null);
  // Audit 4.1: «تذكّرني» is unticked until the visitor ticks it; a returning guest is greeted by taste, not name.
  const [remembered, setRemembered] = useState<{ on: boolean; visitCount: number } | null>(null);
  // Bumped on every local «تذكّرني» change: a server reading that started earlier must not undo it.
  const rememberChanges = useRef(0);
  const rememberSaving = useRef(false);
  const [rememberBusy, setRememberBusy] = useState(false);
  const [rememberAsked, setRememberAsked] = useState(false);
  const [returningGuest, setReturningGuest] = useState<{ visitCount: number; preferences: Record<string, unknown> | null } | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [languageBusy, setLanguageBusy] = useState(false);
  const lastPositionRef = useRef<NearbyPosition | null>(null);
  // Each tab has its own URL on /e/*: switching pushes a history entry, so Back returns to the last tab.
  const selectTab = useCallback((tab: VisitorTabId) => {
    // Audit 2.5: a short cross-fade between screens like a native tab bar, where the browser supports
    // View Transitions and the visitor has not asked for reduced motion. The bars stay put (CSS).
    const doc = typeof document === "undefined" ? null : document as Document & { startViewTransition?: (update: () => void) => unknown };
    if (doc?.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      doc.startViewTransition(() => flushSync(() => setActiveTab(tab)));
    } else {
      setActiveTab(tab);
    }
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0 });
    // A light tap on phones that support it, like a native tab bar.
    if ("vibrate" in navigator) navigator.vibrate?.(8);
    if (!urlSynced) return;
    const path = tabPath(eventSlug, tab);
    if (window.location.pathname !== path) window.history.pushState(null, "", path + window.location.search);
  }, [urlSynced, eventSlug]);
  useEffect(() => {
    if (!urlSynced) return;
    const onPop = () => {
      const route = parseVisitorPath(window.location.pathname);
      if (route?.screen === "tab") setActiveTab(route.tab);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [urlSynced]);
  const chatLog = useRef<HTMLDivElement>(null);
  const planTitle = useRef<HTMLHeadingElement>(null);
  const voiceOpener = useRef<HTMLButtonElement>(null);
  const sessionRef = useRef<string>("");
  const modeRef = useRef<"legacy" | "durable">("legacy");
  const liveFingerprintRef = useRef("");
  const visitorEnteredAt = useRef(Date.now());
  const itineraryIdRef = useRef<string | undefined>(undefined);
  // GPS works for any venue the organizer has calibrated; no event slug is special.
  const gpsAvailable = !isPitch && Boolean(venueGeo) && Boolean(eventCatalog?.routeGraph?.nodes.length);
  const metersPerUnit = venueGeo?.calibration.metersPerUnit ?? 1;
  const distanceM = (a: VenuePoint, b: VenuePoint) => Math.hypot(a.x - b.x, a.y - b.y) * metersPerUnit;
  // Services, gates and landmarks only: zone nodes are already listed as zones, so they would show twice.
  const directionsPlaces = [...new Map(
    [...(eventCatalog?.locations ?? []), ...(eventCatalog?.routeGraph?.nodes ?? [])]
      .filter((place) => place.status === "open" && /SERVICE|ENTRANCE|LANDMARK/i.test(place.type ?? "")).map((place) => [place.id, place]),
  ).values()];

  const [weather, setWeather] = useState<{ temperatureCelsius: number; summaryAr: string; live: boolean } | null>(null);
  useEffect(() => {
    if (isPitch) return;
    let cancelled = false;
    const load = () => fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/weather`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (!cancelled && payload?.data?.weather) setWeather(payload.data.weather); })
      .catch(() => undefined);
    void load();
    const timer = setInterval(load, 10 * 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [eventSlug, isPitch]);
  const catalogInterests = [...new Set(eventCatalog?.activities.flatMap((activity) => activity.interests) ?? [])];

  // Start points a visitor can recognise: the open gates, then zones that actually have activities.
  const startGates = useMemo(() => {
    const zoneIds = new Set(eventCatalog?.zones.map((zone) => zone.id) ?? []);
    return (eventCatalog?.routeGraph?.nodes ?? [])
      .map((node) => ({ ...node, zone: (node as { zone?: string }).zone ?? "" }))
      .filter((node) => node.type === "ENTRANCE" && node.status === "open" && zoneIds.has(node.zone))
      .sort((a, b) => a.label.localeCompare(b.label, "ar"));
  }, [eventCatalog]);
  const startZones = useMemo(() => {
    const withActivities = new Set((eventCatalog?.activities ?? []).map((activity) => activity.zone));
    return (eventCatalog?.zones ?? [])
      .filter((zone) => withActivities.has(zone.id))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [eventCatalog]);
  const [isBuildingPlan, setIsBuildingPlan] = useState(false);
  // Audit 1.1: the first screen is a conversation; the plan's assumptions come back as chips.
  const [openingText, setOpeningText] = useState("");
  const [openingError, setOpeningError] = useState("");
  const [openingListening, setOpeningListening] = useState(false);
  const [openingReply, setOpeningReply] = useState("");
  const [assumptions, setAssumptions] = useState<Array<{ key: string; label: string; message: string }>>([]);
  type GuestInfo = { exists: boolean; displayName: string | null; preferences: Record<string, unknown> | null; visitedCount: number };
  const [guest, setGuest] = useState<GuestInfo | null>(null);
  // Registered-visitor mode (server flag): name + verified phone before the first question.
  const [registrationRequired, setRegistrationRequired] = useState(false);
  // «ابدأ مساري» waits for the visitor/me check, so a visitor is never sent back after the whole quiz.
  const [visitorCheck, setVisitorCheck] = useState<"checking" | "done">(isPitch ? "done" : "checking");
  // POST /session answered VISITOR_REGISTRATION_REQUIRED: keep the visitor's sentence and build the plan right after registering.
  const [resumeAfterRegistration, setResumeAfterRegistration] = useState<{ text: string; saved: Record<string, unknown> | null; call?: boolean } | null>(null);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusStartRef = useRef(false);
  const [confirmDeleteGuest, setConfirmDeleteGuest] = useState(false);
  const deleteGuestOpener = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEventLoadState("loading");
    setEventLoadError("");
    setEventName("");
    setEventCatalog(null);
    setEventNavigation(null);
    setSelectedStartPoint("");
    setPhase("welcome");
    setState(null);
    setMessages([]);
    directionsRequestRef.current += 1;
    setDirSheet(false);
    setDirBusy(false);
    setDirGpsFix(null);
    setDirResult(null);
    setMapPath(null);
    setActiveTab(initialTab);
    setMapVisited(false);
    setEventMissing(false);
    fetch(`/api/events/${encodeURIComponent(eventSlug)}`)
      .then(async (response) => {
        if (response.status === 404) {
          if (!cancelled) setEventMissing(true);
          throw new Error("event not found");
        }
        if (!response.ok) throw new Error("event unavailable");
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const catalog = payload?.data?.catalog;
        const name = payload?.data?.eventName ?? catalog?.site?.name;
        if (typeof name !== "string" || !catalog || !Array.isArray(catalog.zones) || !Array.isArray(catalog.activities)) throw new Error("event catalog incomplete");
        setEventName(name);
        setEventTimezone(payload?.data?.venueTimezone ?? "Asia/Riyadh");
        setEventNavigation(payload?.data?.navigation ?? null);
        setEventCatalog(catalog);
        setMap2dEnabled(payload?.meta?.features?.map2dV2 !== false);
        setEventLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setEventLoadState("error");
        setEventLoadError("تعذر تحميل معلومات الفعالية. تحقق من اتصالك وجرّب مرة ثانية.");
      });
    return () => { cancelled = true; };
  }, [eventSlug]);

  const revealMap = () => {
    selectTab("map");
    requestAnimationFrame(() => document.getElementById("visitor-tab-map")?.focus());
  };

  // الزائر المسجّل: من يتذكره هذا الجهاز، وهل التسجيل مطلوب قبل بدء الزيارة
  useEffect(() => {
    if (isPitch) { setVisitorCheck("done"); return; }
    let cancelled = false;
    setVisitorCheck("checking");
    fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/visitor/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        const data = payload?.data;
        if (cancelled || !data) return;
        setRegistrationRequired(Boolean(data.registrationRequired));
        if (data.visitor) {
          setGuest({ exists: true, displayName: data.visitor.name, preferences: data.preferences ?? null, visitedCount: data.visitor.visitCount ?? 0 });
        } else if (!data.registrationRequired) {
          // A guest who ticked «تذكّرني» last time: offer the same mood in one tap.
          return fetch(`/api/v1/guest?eventSlug=${encodeURIComponent(eventSlug)}`, { credentials: "include" })
            .then((res) => (res.ok ? res.json() : null))
            .then((guestPayload) => {
              const profile = guestPayload?.data;
              if (!cancelled && profile?.exists && profile.visitCount > 0) {
                setReturningGuest({ visitCount: profile.visitCount, preferences: profile.preferences ?? null });
              }
            });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setVisitorCheck("done"); });
    return () => { cancelled = true; };
  }, [isPitch, eventSlug]);

  // After registering, move focus to «ابدأ مساري» once it renders.
  useEffect(() => {
    if (!focusStartRef.current || !startButtonRef.current) return;
    focusStartRef.current = false;
    startButtonRef.current.focus();
  });

  const deleteGuestData = useCallback(async () => {
    setConfirmDeleteGuest(false);
    setVisitResetError("");
    try {
      const res = await fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/visitor/me`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGuest(null);
    } catch {
      setVisitResetError("تعذر حذف البيانات. حاول مرة ثانية.");
    }
  }, [eventSlug]);

  // «لست أنا»: ينسى هذا الجهاز فقط، ويبقى سجل الزائر عند المنظّم
  const forgetThisDevice = useCallback(async () => {
    setVisitResetError("");
    try {
      const res = await fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/visitor/logout`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGuest(null);
    } catch {
      setVisitResetError("تعذر تسجيل الخروج. حاول مرة ثانية.");
    }
  }, [eventSlug]);

  // Audit 1.1/1.2: the visit starts with a sentence, not a quiz. The first message opens a session,
  // the assistant understands it (party, ages, likes, time, budget) and builds a plan at once with
  // safe defaults; if the message was about something else («وين الحمام؟») the plan is still built.
  // «اتصل بونيس»: once the plan screen is up, the ونيس tab with the call ready. The call waits for «ابدأ المكالمة»
  // (the browser needs that tap before it may play sound). It opens one render later, after the phase change
  // (whose cleanup closes any call) and with the chat's «مكالمة» button mounted to take focus back on close.
  const [pendingCall, setPendingCall] = useState(false);
  const voiceCallButtonRef = useRef<HTMLButtonElement | null>(null);
  const openCallAfterStart = () => { selectTab("assistant"); setPendingCall(true); };
  useEffect(() => {
    if (!pendingCall || phase !== "plan") return;
    setPendingCall(false);
    voiceOpener.current = voiceCallButtonRef.current;
    setVoiceTranscript(""); setVoiceReply(""); setVoiceError("");
    setVoiceOpen(true);
  }, [pendingCall, phase]);

  const startFromConversation = async (raw: string, saved?: Record<string, unknown> | null, options: { call?: boolean } = {}) => {
    const text = raw.trim();
    if ((!text && !saved && !options.call) || isBuildingPlan) return;
    setIsBuildingPlan(true);
    setOpeningError("");
    try {
      const preferences = { interests: [], ...(saved ? savedPreferences(saved) : {}), optInPersist: false, ...(selectedStartPoint ? { startPointId: selectedStartPoint } : {}) };
      const session = await fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientType: "web", locale: "ar-SA", entryPoint: isPitch ? "pitch_qr" : "web", preferences }),
      }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.code ?? `HTTP ${res.status}`);
        return data;
      });
      durableToken = typeof session.data.token === "string" ? session.data.token : "";
      durableSessionActive = true;
      sessionRef.current = session.data.sessionId;
      modeRef.current = "durable";
      setDurableHint(eventSlug, true);
      trackDurable(eventSlug, "session_started");
      if (text) trackDurable(eventSlug, "assistant_message");
      const reply = text
        ? (await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/assistant`, {
          method: "POST",
          body: JSON.stringify({ message: text, channel: "text" }),
        })).data
        : saved
          ? { message: "رتبت لك جولة على نفس جوّك المرة الماضية، وخليت الأماكن اللي مريتها لمرة ثانية. قل لي إذا تبي تغيّر شي.", itinerary: null, itineraryId: null }
          : { message: "ابدأ المكالمة وونيس يسولف معك ويرتّب لك جولتك من كلامك. وإذا تحب الكتابة بدل الكلام، اكتب لي هنا.", itinerary: null, itineraryId: null };
      let itinerary = reply.itinerary as Itinerary | null;
      let itineraryId = reply.itineraryId as string | null;
      let nowMinute = reply.clock?.nowMinute as number | undefined;
      // v7: a call with nothing typed starts WITHOUT a plan. ونيس welcomes the visitor, chats like a guide
      // beside them, and the engine builds the plan from what they say; a plan imposed first would turn
      // every change into a proposal to approve. «كمّل بالكتابة» or ending the call builds the safe plan.
      const conversationFirst = Boolean(options.call) && !text && !saved;
      if (!itinerary && !conversationFirst) {
        const plan = (await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/itinerary`, {
          method: "POST",
          body: JSON.stringify({ generatedReason: text ? "visitor_conversation" : saved ? "returning_visitor" : "voice_call" }),
        })).data;
        itinerary = plan.itinerary;
        itineraryId = plan.itineraryId;
        nowMinute = plan.clock?.nowMinute ?? nowMinute;
      }
      const current = (await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/session`).catch(() => null))?.data;
      setPartyCount(planPartySize(current?.preferences?.partySize, 1) ?? 1);
      itineraryIdRef.current = itineraryId ?? "";
      const minute = nowMinute ?? current?.clock?.nowMinute ?? 1080;
      setState({ sessionId: session.data.sessionId, itineraryId: itineraryId ?? undefined, itinerary, now: minute, nowText: fmt(minute), demoMode: false });
      setAssumptions(Array.isArray(reply.understanding?.assumptions) ? reply.understanding.assumptions : []);
      setOpeningReply(typeof reply.message === "string" ? reply.message : "");
      setRemembered(session.data.remembered ? { on: true, visitCount: session.data.visitCount ?? 1 } : null);
      setRememberAsked(Boolean(session.data.remembered) || Boolean(session.data.registered) || isPitch);
      setMessages(text ? [
        { role: "user", text },
        { role: "agent", text: reply.message, ui: Array.isArray(reply.ui) ? reply.ui : null, directions: reply.directions ?? null },
        ...(reply.itinerary ? [] : [{ role: "agent" as const, text: "وجهزت لك جولة مبدئية بافتراضات آمنة، وكل ما قلت لي أكثر عدّلتها." }]),
      ] : [{ role: "agent", text: reply.message }]);
      setOpeningText("");
      setPhase("plan");
      if (options.call) openCallAfterStart();
      else selectTab("itinerary");
      if (itinerary) {
        trackDurable(eventSlug, "itinerary_created");
        trackDurable(eventSlug, "time_to_plan_seconds", { metricValue: Math.round((Date.now() - visitorEnteredAt.current) / 1000) });
      }
    } catch (error) {
      durableToken = "";
      durableSessionActive = false;
      if (error instanceof Error && error.message === "VISITOR_REGISTRATION_REQUIRED") {
        setGuest(null);
        setRegistrationRequired(true);
        setResumeAfterRegistration({ text, saved: saved ?? null, call: Boolean(options.call) });
        return;
      }
      if (allowLegacyFallback) {
        // No database here (the legacy /demo): understand the same sentence on the device and build
        // the in-memory demo plan from it. Still no questionnaire.
        modeRef.current = "legacy";
        await startLegacyFromText(text, saved ?? null);
        if (options.call) openCallAfterStart();
        return;
      }
      setOpeningError("تعذر بدء زيارتك الآن. تحقّق من الاتصال وحاول مرة ثانية.");
    } finally {
      setIsBuildingPlan(false);
    }
  };

  // The mic on the first screen fills the message box; the visitor still sends it.
  const listenForOpening = () => {
    const browserWindow = window as typeof window & { SpeechRecognition?: new () => VoiceRecognition; webkitSpeechRecognition?: new () => VoiceRecognition };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setOpeningError("المتصفح ما يدعم الإدخال الصوتي. اكتب لي وأنا أفهمك.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "ar-SA";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const heard = Array.from(event.results).map((result) => result[0].transcript).join(" ").trim();
      if (heard) setOpeningText(heard);
    };
    recognition.onerror = () => setOpeningListening(false);
    recognition.onend = () => setOpeningListening(false);
    setOpeningListening(true);
    recognition.start();
  };

  // «زيارة جديدة» (after the visitor confirms): end this visit on the server and start over.
  const startNewVisit = async () => {
    setVisitResetError("");
    try {
      if (modeRef.current === "durable") {
        const res = await fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/session`, {
          method: "DELETE",
          headers: durableToken ? { "x-wanees-session-token": durableToken } : undefined,
          credentials: "include",
        });
        if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
        setDurableHint(eventSlug, false);
      } else if (sessionRef.current) {
        const res = await fetch(`/api/session?session=${encodeURIComponent(sessionRef.current)}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      }
      durableToken = "";
      durableSessionActive = false;
      sessionRef.current = "";
      modeRef.current = "legacy";
      // Back to the event's start screen on its entry path, not a /plan or /map URL with no plan.
      hardRestart(urlSynced ? `/e/${encodeURIComponent(eventSlug)}${window.location.search}` : undefined);
    } catch {
      setVisitResetError("تعذر بدء زيارة جديدة. حاول مرة ثانية.");
    }
  };

  // The legacy in-memory demo (/demo without PostgreSQL): the visitor's sentence is read by the same
  // deterministic understanding the server uses, and the demo planner builds from it.
  const startLegacyFromText = async (text: string, saved: Record<string, unknown> | null) => {
    const understood = understandMessage(text);
    const savedBudget = typeof saved?.budgetMaxCents === "number" ? Math.round(saved.budgetMaxCents / 100) : null;
    const levelBudget = understood.budgetLevel === "low" ? 100 : understood.budgetLevel === "mid" ? 300 : understood.budgetLevel === "high" ? 800 : null;
    const said = text.toLowerCase();
    const interests = catalogInterests.filter((interest) => said.includes(interest) || (Array.isArray(saved?.interests) && saved.interests.includes(interest)));
    try {
      if (!sessionRef.current) {
        const created = await api("new");
        sessionRef.current = created.sessionId;
      }
      const st = await api("profile", {
        sessionId: sessionRef.current,
        profile: {
          mood: understood.mood ?? (typeof saved?.mood === "string" ? saved.mood : ""),
          budget: understood.budgetSar ?? levelBudget ?? savedBudget,
          companions_kids: understood.hasChildren || understood.childAges.length > 0 || understood.party === "family",
          companions_adults: 2,
          interests,
          start_min: 1080,
          duration_min: understood.availableMinutes ?? (typeof saved?.availableMinutes === "number" ? saved.availableMinutes : 180),
          start_zone: selectedStartPoint || eventCatalog?.zones[0]?.id || "",
          must_include: [],
          avoid: [],
        },
      });
      setState(st);
      setMessages([...(text ? [{ role: "user" as const, text }] : []), ...(st.messages ?? [])]);
      setOpeningText("");
      setPhase("plan");
    } catch {
      setOpeningError("تعذّر بناء مسارك الآن. تحقّق من الاتصال وحاول مرة ثانية.");
    }
  };

  const stopGuide = useCallback(() => {
    if (airGuideWatchRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(airGuideWatchRef.current);
      airGuideWatchRef.current = null;
    }
    if (guideSimRef.current !== null) {
      window.clearInterval(guideSimRef.current);
      guideSimRef.current = null;
    }
    setAirGuide(null);
    setGuideOpen(false);
  }, []);

  useEffect(() => {
    if (phase !== "plan") stopGuide();
    return () => { stopGuide(); };
  }, [eventSlug, phase, stopGuide]);

  // Where the visitor most likely is: the current stop's zone, else the last stop already passed;
  // the chosen start point only before the first stop.
  const visitOrigin = () => {
    const stops = state?.itinerary?.stops ?? [];
    const nowMinute = state?.now ?? 0;
    const here = stops.find((stop) => stop.start <= nowMinute && stop.end > nowMinute)
      ?? [...stops].reverse().find((stop) => stop.end <= nowMinute);
    return here?.zone || selectedStartPoint || eventCatalog?.zones[0]?.id || "";
  };

  const openDirections = (targetId?: string, opener?: HTMLButtonElement) => {
    directionsOpener.current = opener ?? null;
    const upcoming = state?.itinerary?.stops.find((stop) => stop.end > state.now);
    const target = targetId || upcoming?.act_id || eventCatalog?.zones[0]?.id || "";
    setDirFrom(visitOrigin());
    setDirTo(target);
    setDirResult(null);
    setDirGpsFix(null);
    setDirError("");
    setDirSheet(true);
    return target;
  };

  const openReasons = (opener: HTMLButtonElement) => {
    reasonsOpener.current = opener;
    setShowWhy(true);
  };

  const closeDirections = () => {
    directionsRequestRef.current += 1;
    setDirBusy(false);
    setDirGpsFix(null);
    setDirResult(null);
    setDirSheet(false);
  };

  const fetchDirections = async (from: string, to: string, useGps = false): Promise<{ result: DirectionsPayload; fix: GpsFix | null } | null> => {
    if (!to || dirBusy) return null;
    const requestId = ++directionsRequestRef.current;
    setDirBusy(true);
    setDirError("");
    setDirResult(null);
    setDirGpsFix(null);
    stopGuide();
    try {
      if (modeRef.current !== "durable") throw new Error("DIRECTIONS_OFFLINE");
      let origin = from;
      let fix: GpsFix | null = null;
      if (useGps) {
        if (!gpsAvailable || !navigator.geolocation) throw new Error("GPS_UNAVAILABLE");
        const position = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 }),
        );
        if (directionsRequestRef.current !== requestId) return null;
        if (!venueGeo) throw new Error("GPS_UNAVAILABLE");
        const snapped = snapVenuePosition(venueGeo, position.coords, eventCatalog?.routeGraph?.nodes ?? []);
        if (snapped.status !== "ready") throw new Error(snapped.status === "outside" ? "GPS_OUTSIDE" : "GPS_INACCURATE");
        fix = snapped;
        origin = snapped.node.id;
      }
      const query = new URLSearchParams({ to });
      if (origin) query.set("from", origin);
      const response = await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/directions?${query.toString()}`);
      if (directionsRequestRef.current !== requestId) return null;
      setDirResult(response.data as DirectionsPayload);
      setDirGpsFix(fix);
      return { result: response.data as DirectionsPayload, fix };
    } catch (error) {
      if (directionsRequestRef.current !== requestId) return null;
      const kind = error as { code?: number | string; message?: string };
      const messages: Record<string, string> = {
        "1": "إذن الموقع مقفول. فعّله من إعدادات المتصفح، أو اختر نقطة الانطلاق يدويًا.",
        "2": "ما قدر الجهاز يحدد موقعك الآن. اختر نقطة الانطلاق يدويًا.",
        "3": "انتهت مهلة تحديد الموقع. جرّب مرة ثانية أو اختر نقطة الانطلاق.",
        GPS_UNAVAILABLE: "تحديد الموقع غير متاح هنا. اختر نقطة الانطلاق يدويًا.",
        GPS_INACCURATE: "قراءة الموقع غير دقيقة. جرّب في مكان مفتوح أو اختر نقطة الانطلاق.",
        GPS_OUTSIDE: "موقعك بعيد عن شبكة المشي داخل الفعالية. اختر بوابة أو نقطة انطلاق.",
        DIRECTIONS_OFFLINE: "الاتجاهات تحتاج اتصالًا ببيانات الفعالية. حاول بعد الاتصال.",
        TARGET_NOT_FOUND: "اختر وجهة من أماكن الفعالية.",
        CONFLICT: "نقطة الانطلاق أو الوجهة غير مفتوحة الآن. اختر نقطة أخرى.",
      };
      setDirError(messages[String(kind.code ?? kind.message)] ?? "تعذر حساب الاتجاهات الآن. جرّب مرة ثانية.");
      return null;
    } finally {
      if (directionsRequestRef.current === requestId) setDirBusy(false);
    }
  };

  /** «دلّني»: يطلب إذن الموقع، يحسب المسار من موقعك الحقيقي، ويفتح شاشة البحث الدقيق مباشرة.
   *  إذا تعذر GPS يبقى لوح الاتجاهات مفتوحًا لاختيار نقطة الانطلاق يدويًا. */
  const startAirGuide = async (opener?: HTMLButtonElement, targetId?: string) => {
    const target = openDirections(targetId, opener);
    if (!gpsAvailable || !target) return;
    const outcome = await fetchDirections("", target, true);
    if (outcome?.fix && !outcome.result.demoRoute && outcome.result.pathNodes.length) {
      showDirectionsOnMap(outcome.result, { fix: outcome.fix });
      return;
    }
    if (!outcome) {
      // GPS غير متاح أو خارج الموقع: نحسب الطريق من نقطة الانطلاق ونعرض خيار المحاكاة بدل طريق مسدود
      const fallback = await fetchDirections(visitOrigin(), target);
      if (fallback) setDirError("ما قدرنا نحدد موقعك داخل الفعالية، فحسبنا الطريق من آخر محطة في مسارك أو من نقطة انطلاقك. تقدر تجرّب التوجيه بالمحاكاة.");
    }
  };

  // Where the visitor is, for «حولي» and the chat (audit 3.1): only the snapped walkway node leaves the phone.
  const currentPosition = () => (typeof window !== "undefined" ? simulatedPosition(window.location.search) : null) ?? freshPosition(lastPositionRef.current);
  const locateOnVenue = async (): Promise<NearbyPosition | null> => {
    const simulated = simulatedPosition(window.location.search);
    if (simulated) return simulated;
    if (!gpsAvailable || !venueGeo || !navigator.geolocation) return freshPosition(lastPositionRef.current);
    // One quick retry when the fix times out in a crowd; a refusal is final.
    for (const delay of [0, ...gpsRetryDelays().slice(0, 1)]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 6_000, maximumAge: 15_000 }),
        );
        const snapped = snapVenuePosition(venueGeo, position.coords, eventCatalog?.routeGraph?.nodes ?? []);
        if (snapped.status !== "ready") return null;
        const fix = { nodeId: snapped.node.id, accuracyM: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() };
        lastPositionRef.current = fix;
        return fix;
      } catch (error) {
        if ((error as GeolocationPositionError | undefined)?.code === 1) return null;
      }
    }
    return freshPosition(lastPositionRef.current);
  };
  // undoTo is the language to go back to; null when this change is itself the undo.
  const changeLanguage = async (language: string, undoTo: string | null = mePrefs?.replyLanguage ?? "ar") => {
    if (language === undoTo || modeRef.current !== "durable") return;
    setLanguageBusy(true);
    try {
      await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/session`, { method: "PATCH", body: JSON.stringify({ replyLanguage: language }) });
      setMePrefs((current) => ({ ...(current ?? {}), replyLanguage: language }));
      showToast(language === "ar" ? "صار ونيس يرد بالعربي" : "Wanees will reply in your language", undoTo ? { label: "تراجع", run: () => void changeLanguage(undoTo, null) } : undefined);
    } catch {
      showToast("تعذر تغيير اللغة الآن. حاول مرة ثانية.");
    } finally {
      setLanguageBusy(false);
    }
  };

  const changeRemember = async (on: boolean) => {
    if (modeRef.current !== "durable") return;
    const before = remembered;
    rememberChanges.current += 1;
    rememberSaving.current = true;
    // The switch moves at once; a failed save puts it back.
    setRemembered((current) => ({ on, visitCount: on ? Math.max(1, current?.visitCount ?? 1) : 0 }));
    setRememberBusy(true);
    setRememberAsked(true);
    try {
      await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/session`, { method: "PATCH", body: JSON.stringify({ rememberMe: on }) });
      showToast(on ? "تمام، أتذكرك المرة الجاية. تقدر توقفها من «أنا»." : "ما عاد أتذكرك. حذفت ذوقك والأماكن اللي مريتها.");
    } catch {
      setRemembered(before);
      showToast("تعذر الحفظ الآن. حاول مرة ثانية.");
    } finally {
      rememberSaving.current = false;
      setRememberBusy(false);
    }
  };

  const showDirectionsOnMap = (result: DirectionsPayload, options: { fix?: GpsFix | null; simulate?: boolean } = {}) => {
    setMapPath(result.pathNodes);
    setMapFocus(null);
    const fix = options.fix !== undefined ? options.fix : dirGpsFix;
    closeDirections();
    revealMap();
    const points = result.pathNodes;
    const live = Boolean(fix && gpsAvailable && !result.demoRoute);
    if ((!live && !options.simulate) || points.length < 1) return;
    const lastStep = result.steps[result.steps.length - 1];
    const destCrowded = Boolean(lastStep?.crowded);
    const crowdedZones = [...new Set(result.steps.slice(0, -1).filter((step) => step.crowded && step.zoneName && step.zoneName !== lastStep?.zoneName).map((step) => step.zoneName as string))];
    // تعليمات خطوة بخطوة من هندسة المسار؛ أسماء العقد من خطوات الاتجاهات إذا تطابق عددها
    const maneuvers = buildManeuvers(points, result.steps.length === points.length ? result.steps.map((step) => step.label) : [], metersPerUnit);
    let waypoint = 0;
    const updateGuide = (point: VenuePoint, extra: { accuracyM?: number | null; heading?: number | null } = {}) => {
      while (waypoint < points.length - 1 && distanceM(point, points[waypoint]) <= 18) waypoint += 1;
      let remaining = distanceM(point, points[waypoint]);
      for (let index = waypoint; index < points.length - 1; index += 1) remaining += distanceM(points[index], points[index + 1]);
      const arrived = waypoint === points.length - 1 && distanceM(point, points[points.length - 1]) <= 15;
      const upcoming = nextManeuver(maneuvers, waypoint);
      const toTurn = upcoming ? distanceAlongPath(points, point, waypoint, upcoming.nodeIndex, metersPerUnit) : 0;
      setAirGuide({
        nextInstruction: upcoming ? describeManeuver(upcoming, arrived ? 0 : toTurn, result.target.name) : null,
        nextIcon: upcoming ? TURN_ICON[upcoming.kind] : null,
        nextKey: upcoming ? `${upcoming.nodeIndex}:${upcoming.kind}:${toTurn <= 20 ? "now" : "soon"}` : null,
        ...point,
        target: points[waypoint],
        destName: result.target.name,
        remainingM: remaining,
        totalWalkMin: result.totalWalkMin,
        arrived,
        simulated: !live,
        planRotationDeg: venueGeo?.calibration.rotationDeg ?? 0,
        approximate: live && eventNavigation?.accuracy === "approximate",
        crowdedZones,
        destCrowded,
        accuracyM: extra.accuracyM ?? null,
        heading: extra.heading ?? null,
      });
      return arrived;
    };
    setGuideOpen(true);
    if (live && fix) {
      updateGuide(fix.point);
      // إعادة الحساب تلقائيًا إذا ابتعد الزائر عن المسار (قراءتان متتاليتان > 35م، ومرة كل 20ث كحد أقصى)
      let offRouteReadings = 0;
      let lastSample: GpsSample | null = null;
      let lastReroute = 0;
      let gpsWeakShown = false;
      airGuideWatchRef.current = navigator.geolocation.watchPosition(
        (position) => {
          if (!venueGeo) return;
          const current = snapVenuePosition(venueGeo, position.coords, eventCatalog?.routeGraph?.nodes ?? []);
          if (current.status !== "ready") return;
          // A crowd bounces GPS off buildings: a fix that would mean running is ignored (audit 3.3).
          const sample: GpsSample = { nodeId: current.node.id, accuracyM: position.coords.accuracy, at: position.timestamp, x: current.point.x, y: current.point.y };
          if (!acceptGpsSample(lastSample, sample, metersPerUnit).accept) return;
          lastSample = sample;
          lastPositionRef.current = { nodeId: sample.nodeId, accuracyM: sample.accuracyM, capturedAt: new Date(sample.at).toISOString() };
          updateGuide(current.point, { accuracyM: position.coords.accuracy, heading: position.coords.heading });
          offRouteReadings = distanceFromPath(points, current.point, metersPerUnit) > Math.max(35, position.coords.accuracy) ? offRouteReadings + 1 : 0;
          if (offRouteReadings >= 2 && Date.now() - lastReroute > 20_000 && modeRef.current === "durable") {
            lastReroute = Date.now();
            offRouteReadings = 0;
            const query = new URLSearchParams({ to: result.target.id, from: current.node.id });
            void durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/directions?${query.toString()}`)
              .then((response) => {
                if (airGuideWatchRef.current !== null) navigator.geolocation.clearWatch(airGuideWatchRef.current);
                airGuideWatchRef.current = null;
                showDirectionsOnMap(response.data as DirectionsPayload, { fix: current });
              })
              .catch(() => undefined);
          }
        },
        (error) => {
          // Audit 3.3: one lost fix in a crowd is not the end of the walk. watchPosition keeps trying
          // after a timeout or a lost signal, so the guide stays on the last good position; only a
          // revoked location permission closes it.
          if (error.code === error.PERMISSION_DENIED) {
            stopGuide();
            showToast("وقفت الإرشاد لأن إذن الموقع انسحب. تقدر تكمل بالخريطة.");
            return;
          }
          if (!gpsWeakShown) {
            gpsWeakShown = true;
            showToast("إشارة الموقع ضعيفة هنا. أكمل على آخر مكان أعرفه لين ترجع.");
          }
        },
        { enableHighAccuracy: true, maximumAge: 2_000 },
      );
      return;
    }
    // محاكاة مشي على نفس المسار (للعرض التجريبي خارج الموقع): ~4 م لكل خطوة كل 0.6 ث
    let walker: VenuePoint = { ...points[0] };
    let leg = 1;
    updateGuide(walker);
    guideSimRef.current = window.setInterval(() => {
      const next = points[Math.min(leg, points.length - 1)];
      const gap = distanceM(walker, next);
      const stepM = 4;
      // في المحاكاة نفترض أن الجوال متجه باتجاه المشي، فيظهر السهم يمين/يسار قبل كل انعطاف
      const travelHeading = gap > 0.5 ? bearingDegrees(walker, next) : null;
      if (gap <= stepM) {
        walker = { ...next };
        leg += 1;
      } else {
        const ratio = stepM / gap;
        walker = { x: walker.x + (next.x - walker.x) * ratio, y: walker.y + (next.y - walker.y) * ratio };
      }
      if (updateGuide(walker, { heading: travelHeading }) && guideSimRef.current !== null) {
        window.clearInterval(guideSimRef.current);
        guideSimRef.current = null;
      }
    }, 600);
  };

  const sendChat = async (text: string, fromCall = false, a2uiAction?: A2uiActionMessage): Promise<VoiceReply | null> => {
    if (!text.trim() || !state) return null;
    const sessionId = sessionRef.current;
    if (/ضعت|ضايعت|ضايع|وين أنا/.test(text)) {
      if (fromCall) closeVoice();
      if (isPitch) setShowPlaces(true);
      else startAirGuide();
      return null;
    }
    // One reply at a time: a second send while waiting would interleave typing bubbles and replies.
    if (chatInFlightRef.current) return null;
    chatInFlightRef.current = true;
    setChatPending(true);
    // Only text typed in the composer is cleared (and restored on failure); chips keep the visitor's draft.
    const fromComposer = !fromCall && !a2uiAction && text === chatInput;
    setMessages((m) => [...m, { role: "user", text }, { role: "typing", text: "" }]);
    if (fromComposer) setChatInput("");
    try {
      if (modeRef.current === "durable") {
        trackDurable(eventSlug, "assistant_message");
        const response = await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/assistant`, {
          method: "POST",
          body: JSON.stringify(a2uiAction
            ? { action: a2uiAction, channel: fromCall ? "voice" : "text" }
            : { message: text, channel: fromCall ? "voice" : "text", ...(currentPosition() ? { position: currentPosition() } : {}) }),
        });
        if (sessionRef.current !== sessionId) return null;
        const data = response.data;
        if (data.proposal?.id && data.proposal?.candidate) {
          setReplanFeedback("");
          setReplanProposal({ ...data.proposal, kind: "assistant" });
          trackDurable(eventSlug, "replan_proposed");
        }
        setState((previous) => previous ? {
          ...previous,
          ...(data.itinerary ? { itinerary: data.itinerary } : {}),
          ...(data.clock?.nowMinute != null ? { now: data.clock.nowMinute, nowText: fmt(data.clock.nowMinute) } : {}),
        } : previous);
        const options = (data.intent === "search" || data.intent === "location") && Array.isArray(data.sources)
          ? data.sources.filter((source: AssistantSource) => source?.id && source?.name).slice(0, 5)
          : undefined;
        setMessages((m) => [...m.filter((x) => x.role !== "typing"), { role: "agent", text: data.message, options, ui: Array.isArray(data.ui) ? data.ui : null, handoff: Boolean(data.handoff), directions: data.directions ?? null }]);
        if (data.itinerary) trackDurable(eventSlug, "replan_applied");
        return { text: data.message, needsReview: Boolean(data.proposal) };
      }
      const st = await api("chat", { sessionId, text });
      if (sessionRef.current !== sessionId) return null;
      setState(st);
      setMessages((m) => [...m.filter((x) => x.role !== "typing"), ...(st.messages ?? [])]);
      const message = [...(st.messages ?? [])].reverse().find((item: Msg) => item.role === "agent");
      return message?.text ? { text: message.text } : null;
    } catch {
      if (sessionRef.current !== sessionId) return null;
      setMessages((m) => [...m.filter((x) => x.role !== "typing"), { role: "agent", text: "تعذر الاتصال، جرّب مرة ثانية 🙏" }]);
      // Give the visitor their message back so they can resend it without retyping.
      if (fromComposer) setChatInput((current) => current || text);
      return null;
    } finally {
      chatInFlightRef.current = false;
      setChatPending(false);
    }
  };

  const closeVoice = useCallback(() => {
    voiceCallRef.current?.stop();
    voiceCallRef.current = null;
    const live = realtimeCallRef.current;
    realtimeCallRef.current = null;
    live?.stop();
    setVoiceMode(null);
    setVoiceMuted(false);
    setVoiceState("idle");
    setVoiceOpen(false);
  }, []);

  // A live-call tool turn: the engine decides, the realtime voice only phrases the returned facts.
  // v7: the plan the engine built or replaced during a call or a chat is the one later replans build on.
  const adoptPlanFromReply = (data: { itinerary?: Itinerary | null; itineraryId?: string | null; clock?: { nowMinute?: number } }) => {
    const hadPlan = Boolean(itineraryRef.current);
    if (data.itinerary && data.itineraryId) itineraryIdRef.current = data.itineraryId;
    setState((previous) => previous ? {
      ...previous,
      ...(data.itinerary ? { itinerary: data.itinerary, ...(data.itineraryId ? { itineraryId: data.itineraryId } : {}) } : {}),
      ...(data.clock?.nowMinute != null ? { now: data.clock.nowMinute, nowText: fmt(data.clock.nowMinute) } : {}),
    } : previous);
    if (data.itinerary && !hadPlan) {
      trackDurable(eventSlug, "itinerary_created");
      trackDurable(eventSlug, "time_to_plan_seconds", { metricValue: Math.round((Date.now() - visitorEnteredAt.current) / 1000) });
    } else if (data.itinerary) trackDurable(eventSlug, "replan_applied");
  };

  // Ending a call that built no plan yet: the safe starter plan, so the screen is never empty.
  const ensureStarterPlan = async () => {
    if (modeRef.current !== "durable" || !state || state.itinerary || isBuildingPlan) return;
    setIsBuildingPlan(true);
    try {
      const plan = (await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/itinerary`, { method: "POST", body: JSON.stringify({ generatedReason: "voice_call" }) })).data;
      adoptPlanFromReply(plan);
      setOpeningReply("");
      setMessages((m) => [...m, { role: "agent", text: "جهزت لك جولة مبدئية بافتراضات آمنة، وكل ما قلت لي أكثر عدّلتها." }]);
    } catch {
      // The visitor can still ask for a plan in the chat.
    } finally {
      setIsBuildingPlan(false);
    }
  };

  const noteStopFeedbackForCall = async ({ activity, rating }: { activity: string; rating: number }) => {
    const response = await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/assistant/feedback`, {
      method: "POST",
      body: JSON.stringify({ activity, rating }),
    });
    return { recorded: true, activity: response.data?.activity ?? activity, rating };
  };

  const askEngineForCall = async (request: string) => {
    if (/ضعت|ضايعت|ضايع|وين أنا/.test(request)) {
      if (isPitch) setShowPlaces(true);
      else startAirGuide();
      return { message: "فتحت للزائر دليل الموقع على الشاشة.", intent: "location" };
    }
    trackDurable(eventSlug, "assistant_message");
    const response = await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/assistant`, {
      method: "POST",
      // The device position (a walkway node) travels with every engine request in the call too (v7).
      body: JSON.stringify({ message: request, channel: "call", ...(currentPosition() ? { position: currentPosition() } : {}) }),
    });
    const data = response.data;
    if (data.proposal?.id && data.proposal?.candidate) {
      setReplanFeedback("");
      setReplanProposal({ ...data.proposal, kind: "assistant" });
      trackDurable(eventSlug, "replan_proposed");
    }
    adoptPlanFromReply(data);
    callUiRef.current = Array.isArray(data.ui) ? data.ui : null;
    callOptionsRef.current = (data.intent === "search" || data.intent === "location") && Array.isArray(data.sources)
      ? data.sources.filter((source: AssistantSource) => source?.id && source?.name).slice(0, 5)
      : undefined;
    return {
      draft: data.message,
      intent: data.intent,
      facts: data.facts ?? null,
      proposal: data.proposal ? { pending: true, note: "الاقتراح ظاهر للزائر وينتظر موافقته الصريحة في المكالمة" } : null,
      handoff: Boolean(data.handoff),
    };
  };

  useEffect(() => {
    const stopIfHidden = () => { if (document.hidden) closeVoice(); };
    document.addEventListener("visibilitychange", stopIfHidden);
    if (phase !== "plan") closeVoice();
    return () => {
      document.removeEventListener("visibilitychange", stopIfHidden);
      closeVoice();
    };
  }, [closeVoice, eventSlug, phase]);

  const startVoice = async () => {
    voiceCallRef.current?.stop();
    voiceCallRef.current = null;
    realtimeCallRef.current?.stop();
    realtimeCallRef.current = null;
    setVoiceTranscript("");
    setVoiceReply("");
    setVoiceError("");
    setVoiceMuted(false);
    const canRealtime = modeRef.current === "durable" && !isPitch
      && typeof RTCPeerConnection !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    if (canRealtime) {
      setVoiceState("thinking");
      try {
        // v7: the call starts knowing where the visitor is (a walkway node id, never coordinates).
        const token = await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/assistant/call`, {
          method: "POST",
          body: JSON.stringify(currentPosition() ? { position: currentPosition() } : {}),
        });
        let handle: RealtimeCallHandle | null = null;
        const { startRealtimeCall } = await import("@/lib/realtime-call");
        handle = await startRealtimeCall({
          clientSecret: token.data.clientSecret,
          tools: {
            ask_wanees_engine: ({ request }) => callBridgeRef.current?.ask(request) ?? Promise.resolve({ error: "unavailable" }),
            respond_to_proposal: ({ decision }) => callBridgeRef.current?.decide(decision) ?? Promise.resolve({ error: "unavailable" }),
            note_stop_feedback: (args) => callBridgeRef.current?.feedback(args) ?? Promise.resolve({ error: "unavailable" }),
            end_call: () => undefined,
          },
          onState: setVoiceState,
          onHeard: setVoiceTranscript,
          onReply: setVoiceReply,
          onTurn: (turn) => {
            const options = turn.role === "assistant" ? callOptionsRef.current : undefined;
            const ui = turn.role === "assistant" ? callUiRef.current : null;
            if (turn.role === "assistant") { callOptionsRef.current = undefined; callUiRef.current = null; }
            setMessages((m) => [...m, turn.role === "visitor" ? { role: "user", text: turn.text } : { role: "agent", text: turn.text, options, ui }]);
          },
          onEnd: (reason) => {
            if (!handle || realtimeCallRef.current !== handle) return;
            realtimeCallRef.current = null;
            setVoiceMode(null);
            if (reason === "error") {
              setVoiceState("error");
              setVoiceError("انقطعت المكالمة. تقدر تعيد الاتصال أو تكمل بالكتابة.");
            } else {
              setVoiceState("idle");
              setVoiceOpen(false);
              // A call that ended (goodbye) before any plan was built leaves the visitor a starter plan.
              void ensureStarterPlan();
            }
          },
        });
        realtimeCallRef.current = handle;
        setVoiceMode("realtime");
        // A nudge from the last few minutes is still worth saying once the greeting is done.
        const recent = lastNudgeRef.current;
        if (recent && Date.now() - recent.at < 180_000) handle.notify(recent.text);
        return;
      } catch (error) {
        const typed = error as Error & { code?: string };
        if (typed?.name === "NotAllowedError") {
          setVoiceState("error");
          setVoiceError("اسمح للمتصفح يستخدم الميكروفون عشان نقدر نتكلم، أو كمل بالكتابة.");
          return;
        }
        if (typed?.code === "RATE_LIMITED") {
          setVoiceState("error");
          setVoiceError("بدأت مكالمات كثيرة. انتظر شوي أو كمل بالكتابة.");
          return;
        }
        // Live voice unavailable (no key, provider down, network): fall back to the browser call.
      }
    }
    startBrowserVoice();
  };

  const startBrowserVoice = () => {
    const browserWindow = window as typeof window & {
      SpeechRecognition?: new () => VoiceRecognition;
      webkitSpeechRecognition?: new () => VoiceRecognition;
    };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setVoiceState("error");
      setVoiceError("المتصفح لا يدعم المكالمة الصوتية. تقدر تكمل بالكتابة.");
      return;
    }
    voiceCallRef.current?.stop();
    setVoiceTranscript("");
    setVoiceReply("");
    setVoiceError("");
    const call = createVoiceCall({
      createRecognition: () => new Recognition(),
      requestReply: (text) => sendChat(text, true),
      speak(text, done, failed) {
        const utterance = new SpeechSynthesisUtterance(text.replace(/[«»]/g, ""));
        utterance.lang = "ar-SA";
        utterance.rate = 0.96;
        const clearHandlers = () => { utterance.onend = null; utterance.onerror = null; };
        utterance.onend = () => { clearHandlers(); done(); };
        utterance.onerror = () => { clearHandlers(); failed(); };
        window.speechSynthesis.speak(utterance);
        return () => { clearHandlers(); window.speechSynthesis.cancel(); };
      },
      onState: setVoiceState,
      onHeard: setVoiceTranscript,
      onReply: setVoiceReply,
      onReview: closeVoice,
    });
    voiceCallRef.current = call;
    setVoiceMode("browser");
    call.start();
  };

  const fireDemo = async (events: unknown[], minutes?: number) => {
    if (!state) return;
    try {
      if (modeRef.current === "durable") {
        setMessages((m) => [...m, { role: "agent", text: "التحديث التشغيلي يُرسل من لوحة الإدارة؛ بعدها أتحقق من المسار وأعيد ترتيبه تلقائيًا إذا تأثر." }]);
        return;
      }
      if (minutes) await api("demo_clock", { sessionId: sessionRef.current, minutes });
      const st = await api("events", { sessionId: sessionRef.current, events });
      setState(st);
      setMessages((m) => [...m, ...(st.messages ?? [])]);
    } catch {
      setMessages((m) => [...m, { role: "agent", text: "صار خطأ أثناء التحديث، جرّب مرة ثانية 🙏" }]);
    }
  };

  const refreshOffers = async () => {
    setOfferMessage("");
    try {
      const response = await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/incentives`);
      setVisitorOffers(response.data ?? []);
    } catch {
      setOfferMessage("تعذر جلب الحوافز. تحقق من الاتصال وحاول مرة ثانية.");
    }
  };

  const claimOffer = async (incentiveId: string) => {
    if (claimingOffer) return;
    setClaimingOffer(true);
    setOfferMessage("");
    try {
      await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/incentives`, {
        method: "POST", body: JSON.stringify({ incentiveId }),
      });
      setVisitorOffers((offers) => offers?.map((offer) => offer.incentive.incentiveId === incentiveId ? { ...offer, claimed: true } : offer) ?? []);
      setOfferMessage("سُجّل طلب الاستفادة لهذه الزيارة. اعرض الحافز في المكان المذكور.");
    } catch {
      setOfferMessage("تعذر تسجيل الاستفادة. قد يكون الحافز انتهى، أو انقطع الاتصال.");
    } finally { setClaimingOffer(false); }
  };

  const resolveReplanProposal = async (decision: "accept" | "keep_current"): Promise<"applied" | "kept" | "stale" | "failed"> => {
    if (!replanProposal || modeRef.current !== "durable" || replanBusy || replanInFlightRef.current) return "failed";
    // sendReplanDecision sets replanInFlightRef before its first await: a same-frame second tap returns "busy" and sends nothing.
    const pending = sendReplanDecision<Itinerary>(replanInFlightRef, durableRequest, eventSlug, replanProposal, decision);
    setReplanBusy(true);
    setReplanFeedback("");
    const outcome = await pending;
    setReplanBusy(false);
    if (outcome.kind === "busy") return "failed";
    if (outcome.kind === "applied" || outcome.kind === "kept") {
      if (outcome.nowMinute != null) {
        const nowMinute = outcome.nowMinute;
        setState((previous) => previous ? { ...previous, now: nowMinute, nowText: fmt(nowMinute) } : previous);
      }
      if (outcome.kind === "applied") {
        itineraryIdRef.current = outcome.plan.itineraryId;
        setState((previous) => previous ? applyReplanOutcome(previous, outcome) : previous);
        trackDurable(eventSlug, "replan_applied");
        setReplanFeedback("تم تطبيق الاقتراح وتحديث مسارك.");
        if (replanProposal.incentive || visitorOffers) void refreshOffers();
        setMessages((messages) => [...messages, { role: "agent", text: "تم تطبيق الاقتراح وتحديث مسارك." }]);
      } else {
        trackDurable(eventSlug, "replan_dismissed");
        setReplanFeedback("أبقيت مسارك الحالي كما هو.");
        setMessages((messages) => [...messages, { role: "agent", text: "أبقيت مسارك الحالي كما هو." }]);
      }
      proposalDialogRef.current?.close();
      setReplanProposal(null);
      return outcome.kind;
    }
    if (outcome.kind === "stale") {
      setReplanProposal(null);
      proposalDialogRef.current?.close();
      // Show the server's itinerary (it may have been applied in another tab or by a retry), not the stale one.
      if (outcome.serverPlan) {
        itineraryIdRef.current = outcome.serverPlan.itineraryId;
        setState((previous) => previous ? applyReplanOutcome(previous, outcome) : previous);
      }
      setReplanFeedback("انتهت صلاحية الاقتراح أو تغيّرت الحالة الحية. مسارك الحالي محفوظ.");
      setMessages((messages) => [...messages, { role: "agent", text: STALE_PROPOSAL_MESSAGE }]);
      liveFingerprintRef.current = "";
      return "stale";
    }
    setReplanFeedback("تعذر حفظ اختيارك. حاول مرة أخرى.");
    setMessages((messages) => [...messages, { role: "agent", text: "تعذر حفظ اختيارك، جرّب مرة ثانية." }]);
    return "failed";
  };

  // A2UI buttons: directions/map/proposal run here in the app; add/choose go to the engine as A2UI actions.
  const handleA2uiAction = (message: A2uiActionMessage, opener: HTMLButtonElement) => {
    const { name, context, userMessage } = message.action;
    const targetId = typeof context.targetId === "string" ? context.targetId : undefined;
    if (name === "get_directions" && !isPitch) { openDirections(targetId, opener); return; }
    if (name === "get_directions") { setMapFocus(targetId ?? null); revealMap(); return; }
    if (name === "show_on_map") { setMapFocus(targetId ?? null); revealMap(); return; }
    if (name === "respond_to_proposal") {
      const decision = context.decision === "accept" ? "accept" : "keep_current";
      if (!replanProposal || replanProposal.id !== context.proposalId) {
        setMessages((m) => [...m, { role: "agent", text: "ما عاد هذا الاقتراح متاحًا. مسارك الحالي محفوظ." }]);
        return;
      }
      void resolveReplanProposal(decision);
      return;
    }
    void sendChat(userMessage ?? "", false, message);
  };

  callBridgeRef.current = {
    ask: askEngineForCall,
    feedback: noteStopFeedbackForCall,
    decide: async (decision) => {
      if (!replanProposal) return { error: "no_pending_proposal" };
      const outcome = await resolveReplanProposal(decision);
      return {
        outcome,
        note: outcome === "applied" ? "تم اعتماد الاقتراح وتحديث المسار"
          : outcome === "kept" ? "بقي المسار الحالي كما هو"
          : outcome === "stale" ? "انتهت صلاحية الاقتراح؛ المسار الحالي محفوظ. اعرض عليه نطلب اقتراحًا جديدًا"
          : "تعذر حفظ القرار؛ اطلب منه يحاول من الشاشة",
      };
    },
  };

  // Wanees speaks first: deterministic nudges (time to walk, show starting, visit ending), each shown once.
  const seenNudgesRef = useRef<Set<string>>(new Set());
  const lastNudgeRef = useRef<{ text: string; at: number } | null>(null);
  const nudgeCheckRef = useRef<(() => void) | null>(null);
  const nudgeLinkRef = useRef<((path: string) => void) | null>(null);
  const hasPlan = Boolean(state?.itinerary);
  useEffect(() => {
    if (phase !== "plan" || !hasPlan || modeRef.current !== "durable" || isPitch || !venueOpen) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (!document.hidden) {
        try {
          const response = await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/assistant/nudges`);
          if (disposed) return;
          const fresh = ((response.data?.nudges ?? []) as Array<{ id: string; text: string; ui?: A2uiMessage[] }>)
            .filter((nudge) => nudge?.id && nudge.text && !seenNudgesRef.current.has(nudge.id));
          for (const nudge of fresh) {
            seenNudgesRef.current.add(nudge.id);
            lastNudgeRef.current = { text: nudge.text, at: Date.now() };
            setMessages((messages) => [...messages, { role: "agent", text: nudge.text, ui: Array.isArray(nudge.ui) ? nudge.ui : null }]);
            realtimeCallRef.current?.notify(nudge.text);
          }
        } catch {
          // A missed nudge is retried on the next tick; nothing to show the visitor.
        }
      }
      if (!disposed) timer = setTimeout(check, 60_000);
    };
    timer = setTimeout(check, 4_000);
    // A lock-screen push or a tapped notification means a nudge is due now: check without waiting.
    nudgeCheckRef.current = () => { clearTimeout(timer); timer = setTimeout(check, 300); };
    return () => { disposed = true; clearTimeout(timer); nudgeCheckRef.current = null; };
  }, [eventSlug, hasPlan, isPitch, phase, venueOpen]);

  // Tapping a lock-screen notification opens /demo?nudge=<id>[&do=get_directions|show_on_map|shorten_plan].
  nudgeLinkRef.current = (path: string) => {
    const url = new URL(path, window.location.origin);
    const nudgeId = url.searchParams.get("nudge");
    if (!nudgeId) return;
    const action = url.searchParams.get("do");
    const [kind, targetId] = nudgeId.split(":");
    const stopTarget = kind === "leave_now" || kind === "show_soon" ? targetId : undefined;
    if (action === "get_directions" && stopTarget && !isPitch) openDirections(stopTarget);
    else if ((action === "get_directions" || action === "show_on_map") && stopTarget) { setMapFocus(stopTarget); revealMap(); }
    else if (action === "shorten_plan") void sendChat("قصّر الجولة");
    nudgeCheckRef.current?.();
    if (window.location.search.includes("nudge=")) window.history.replaceState(null, "", window.location.pathname);
  };
  useEffect(() => {
    if (phase !== "plan" || !hasPlan) return;
    if (window.location.search.includes("nudge=")) nudgeLinkRef.current?.(window.location.pathname + window.location.search);
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; path?: string } | null;
      if (data?.type === "wanees:nudge") nudgeCheckRef.current?.();
      if (data?.type === "wanees:open-nudge" && typeof data.path === "string") nudgeLinkRef.current?.(data.path);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [hasPlan, phase]);

  useEffect(() => {
    if (phase !== "plan" || !state?.itinerary) return;
    if (modeRef.current === "durable") {
      liveFingerprintRef.current = "";
      let disposed = false;
      let nextPoll = 10_000;
      let failureCount = 0;
      const checkLiveState = async () => {
        try {
          const response = await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/live`);
          const data = response.data ?? {};
          if (disposed) return;
          failureCount = 0;
          setLiveStatus("live");
          const isOpen = data.clock?.isOpen !== false;
          if (isOpen) sawVenueOpenRef.current = true;
          setVenueOpen(isOpen);
          // Closed after we saw it open, or the real clock is past the (clamped) closing minute.
          setClosedForNight(!isOpen && (sawVenueOpenRef.current
            || (typeof data.clock?.actualMinute === "number" && typeof data.clock?.nowMinute === "number" && data.clock.actualMinute > data.clock.nowMinute)));
          setLastLiveCheck(data.capturedAt ?? null);
          setLiveCrowd(data.crowd ?? []);
          nextPoll = Math.max(10_000, Number(data.nextPollAfterMs) || 10_000);
          if (data.clock?.nowMinute != null) {
            setState((previous) => previous ? { ...previous, now: data.clock.nowMinute, nowText: fmt(data.clock.nowMinute) } : previous);
          }
          const fingerprint = data.revision ?? JSON.stringify({
            updates: (data.updates ?? []).map((update: { id: string }) => update.id),
            crowd: (data.crowd ?? []).map((row: { zone: string; level: number; observedAt: string }) => `${row.zone}:${row.level}:${row.observedAt}`),
          });
          if (disposed) return;
          if (liveFingerprintRef.current === fingerprint) return;
          // A stop still marked as delayed after the delay was revoked needs a replan even with no live update left.
          const staleDelay = itineraryRef.current?.stops.some((stop) => /^تأخّر \d+ دقيقة$/.test(stop.note ?? "") && stop.start >= (data.clock?.nowMinute ?? 0));
          if (!liveFingerprintRef.current && !data.updates?.length && !data.crowd?.length && !staleDelay) {
            liveFingerprintRef.current = fingerprint;
            return;
          }
          if (data.crowd?.length) trackDurable(eventSlug, "crowd_warning_seen");
          trackDurable(eventSlug, "replan_requested");
          const replanned = await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/itinerary/replan`, {
            method: "POST",
            body: JSON.stringify({ reason: "live_update", decision: "preview", baseItineraryId: itineraryIdRef.current, baseLiveRevision: fingerprint }),
          });
          if (disposed) return;
          liveFingerprintRef.current = fingerprint;
          setReplanProposal((existing) => existing?.baseLiveRevision !== fingerprint ? null : existing);
          if (!replanned.data?.diff?.changed) return;
          if (replanned.data?.clock?.nowMinute != null) {
            setState((previous) => previous ? { ...previous, now: replanned.data.clock.nowMinute, nowText: fmt(replanned.data.clock.nowMinute) } : previous);
          }
          const diff = replanned.data.diff as PlanDiff;
          const related = (data.updates ?? []).find((update: { targetId: string; targetType: string; updateType: string }) =>
            itineraryRef.current?.stops.some((stop) => update.targetId === (update.targetType === "zone" ? stop.zone : stop.act_id))
            && (replanned.data.mode !== "APPLIED" || update.updateType === "CLOSURE"),
          );
          const reason = typeof related?.payload?.reason === "string" ? related.payload.reason : "";
          const removed = (diff.removed ?? []).map((item) => item.name).join("، ");
          const added = (diff.added ?? []).map((item) => item.name).join("، ");
          const explanation = [removed && `شلت ${removed}`, added && `وضفت ${added}`].filter(Boolean).join("، ");
          if (replanned.data.mode === "PROPOSED" && replanned.data.candidateItinerary && replanned.data.proposalId) {
            setReplanFeedback("");
            setReplanProposal({
              id: replanned.data.proposalId,
              reason: reason || replanned.data.candidateItinerary.explanations?.find((line: string) => line.startsWith("انتهى تأخير")) || replanned.data.candidateItinerary.explanations?.at(-1),
              announcedAt: related?.createdAt,
              incentive: replanned.data.incentive,
              candidate: replanned.data.candidateItinerary,
              baseItineraryId: replanned.data.proposal?.baseItineraryId,
              baseLiveRevision: replanned.data.proposal?.baseLiveRevision ?? fingerprint,
              proposalExpiresAt: replanned.data.proposal?.proposalExpiresAt,
              diff,
            });
            setMessages((messages) => [...messages, { role: "agent", text: `وصل تحديث حي. عندي اقتراح لتعديل مسارك${explanation ? `: ${explanation}` : " بما يناسب الوضع الجديد"}. راجعه قبل التطبيق.` }]);
            trackDurable(eventSlug, "replan_proposed");
            // v7: a live call hears the operator's update too, as a one-line nudge; the decision stays the visitor's.
            realtimeCallRef.current?.notify(`وصل تحديث حي من المشغّل${reason ? `: ${reason}` : ""}. عندي اقتراح لتعديل مسارك${explanation ? ` (${explanation})` : ""}، تبي أعرضه عليك؟`);
            if (related?.createdAt) trackDurable(eventSlug, "update_delivery_seconds", {
              metricValue: Math.max(0, Math.round((Date.now() - Date.parse(related.createdAt)) / 1000)),
            });
          } else if (replanned.data.mode === "APPLIED" && replanned.data.itinerary) {
            itineraryIdRef.current = replanned.data.itineraryId;
            setPlanNotice(removed ? `أُغلق «${removed}» وأزيل من مسارك. ${reason}` : "حدّث المشغّل حالة الفعالية وعُدّل مسارك.");
            liveFingerprintRef.current = "";
            setState((previous) => previous ? { ...previous, itinerary: replanned.data.itinerary } : previous);
            setReplanFeedback("وصل تحديث حي من المشغّل وتغيّر مسارك.");
            realtimeCallRef.current?.notify(`وصل تحديث حي من المشغّل وتعدّل مسارك تلقائيًا${explanation ? `: ${explanation}` : ""}.`);
            setMessages((messages) => [...messages, { role: "agent", text: `وصل تحديث حي من المشغّل وعدّلت مسارك تلقائيًا${explanation ? `: ${explanation}` : " بما يناسب الوضع الجديد"}.` }]);
            trackDurable(eventSlug, "replan_applied");
          }
        } catch {
          if (disposed) return;
          failureCount += 1;
          setLiveStatus("stale");
          nextPoll = Math.min(60_000, 10_000 * 2 ** Math.min(3, failureCount));
        }
      };
      let timer: ReturnType<typeof setTimeout> | null = null;
      const schedule = () => {
        if (disposed) return;
        timer = setTimeout(async () => {
          if (document.visibilityState !== "hidden") await checkLiveState();
          schedule();
        }, nextPoll);
      };
      void checkLiveState().finally(schedule);
      const onVisibility = () => {
        if (document.visibilityState === "visible") {
          if (timer) clearTimeout(timer);
          void checkLiveState().finally(schedule);
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => { disposed = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
    }
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/tick?session=${sessionRef.current}`);
        const data = await res.json();
        setAlert(data.alert);
      } catch {}
    }, 7000);
    return () => clearInterval(iv);
  }, [eventSlug, phase, state?.sessionId]);

  useEffect(() => {
    // Clear legacy client-side state from pre-cookie builds without reading it.
    localStorage.removeItem("wanees_sid");
    localStorage.removeItem("wanees_msgs");
    localStorage.removeItem("wanees_v1_token");
  }, []);

  // استرجاع جلسة المتصفح من HttpOnly cookie بعد refresh؛ لا نستخدم localStorage
  // كهوية للزائر ولا نخزن transcript محليًا.
  useEffect(() => {
    let cancelled = false;
    const restoreDurable = async () => {
      if (!hasDurableHint(eventSlug)) throw new Error("no durable session in this browser");
      const session = await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/session`);
      // v7: a visit started by a call may have no plan yet; the session alone is enough to come back to.
      const plan = await durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/itinerary`)
        .catch((error: { status?: number }) => { if (error?.status === 404) return null; throw error; });
      if (cancelled) return;
      durableToken = typeof session.data.token === "string" ? session.data.token : "";
      durableSessionActive = true;
      sessionRef.current = session.data.sessionId;
      modeRef.current = "durable";
      itineraryIdRef.current = plan?.data?.itineraryId ?? "";
      // Engine prices are per person: the group total needs the party size the plan was built for.
      setPartyCount(planPartySize(plan?.data?.profile?.party_size, session.data.preferences?.partySize) ?? 1);
      setState({
        sessionId: session.data.sessionId,
        itineraryId: plan?.data?.itineraryId ?? undefined,
        itinerary: plan?.data?.itinerary ?? null,
        now: plan?.data?.clock?.nowMinute ?? plan?.data?.profile?.start_min ?? session.data.clock?.nowMinute ?? 1080,
        nowText: plan?.data?.nowText ?? fmt(plan?.data?.clock?.nowMinute ?? session.data.clock?.nowMinute ?? 1080),
        demoMode: false,
      });
      setPhase("plan");
      // The conversation so far, from the server (redacted, 24 h): no transcript is kept on the device.
      durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/assistant`).then((history) => {
        if (cancelled || !Array.isArray(history?.data)) return;
        const turns = history.data
          .filter((turn: { role?: string; redactedContent?: string | null }) => typeof turn.redactedContent === "string" && turn.redactedContent.trim())
          .slice(-16)
          .map((turn: { role?: string; redactedContent?: string | null }): ChatMsg => turn.role === "assistant"
            ? { role: "agent", text: turn.redactedContent! }
            : { role: "user", text: turn.redactedContent! });
        if (turns.length) setMessages((m) => m.length ? m : turns);
      }).catch(() => undefined);
    };
    restoreDurable().catch((error: { status?: number }) => {
      // Cookie gone or session expired: stop probing on later loads.
      if (error?.status === 401 || error?.status === 404) setDurableHint(eventSlug, false);
      durableToken = "";
      durableSessionActive = false;
      modeRef.current = "legacy";
    });
    // The visit ended under an open page (cookie expired or cleared): say so once and start over,
    // so the visitor lands on the start screen instead of a plan that no longer answers.
    durableSessionLost = () => {
      setDurableHint(eventSlug, false);
      durableToken = "";
      modeRef.current = "legacy";
      setMessages((m) => [...m.filter((x) => x.role !== "typing"), { role: "agent", text: "انتهت جلسة زيارتك، نبدأ لك من جديد…" }]);
      window.setTimeout(() => hardRestart(urlSynced ? `/e/${encodeURIComponent(eventSlug)}${window.location.search}` : undefined), 2500);
    };
    return () => { cancelled = true; durableSessionLost = null; };
  }, [eventSlug]);

  useEffect(() => {
    if (phase === "plan") planTitle.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (activeTab === "assistant" && chatLog.current) {
      chatLog.current.scrollTop = chatLog.current.scrollHeight;
    }
  }, [messages, activeTab]);

  const selectedTab = wideLayout && activeTab === "itinerary" ? "map" : activeTab;
  useEffect(() => {
    if (phase === "plan" && selectedTab === "map") setMapVisited(true);
  }, [phase, selectedTab]);
  // «أنا» reads what the server understood, fresh each time the tab opens or the chat moves on.
  useEffect(() => {
    if (phase !== "plan" || selectedTab !== "me" || modeRef.current !== "durable") return;
    let cancelled = false;
    const changesAtStart = rememberChanges.current;
    setMeLoading(true);
    durableRequest(`/api/v1/events/${encodeURIComponent(eventSlug)}/session`)
      .then((response) => {
        if (cancelled) return;
        setMePrefs(response?.data?.preferences ?? null);
        const stale = rememberSaving.current || rememberChanges.current !== changesAtStart;
        if (!stale && typeof response?.data?.remembered === "boolean") setRemembered({ on: response.data.remembered, visitCount: response.data.visitCount ?? 0 });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMeLoading(false); });
    return () => { cancelled = true; };
  }, [phase, selectedTab, eventSlug, messages.length]);

  useEffect(() => {
    const dialog = placesDialogRef.current;
    if (showPlaces && dialog && !dialog.open) dialog.showModal();
  }, [showPlaces]);
  useEffect(() => {
    if (!placeMapId) return;
    const frame = requestAnimationFrame(() => placeMapRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [placeMapId]);
  const stopMenuStop = stopMenuId ? state?.itinerary?.stops.find((stop) => stop.act_id === stopMenuId) ?? null : null;
  // Share one stop: the event page and the stop's time, never the visitor's session or plan id.
  const shareStop = async (stop: { name: string; start: number }) => {
    setStopMenuId(null);
    const url = `${window.location.origin}${urlSynced ? `/e/${encodeURIComponent(eventSlug)}` : window.location.pathname}`;
    const text = `${stop.name} الساعة ${fmt(stop.start)}${eventName ? ` في ${eventName}` : ""}. رتّب جولتك مع ونيس:`;
    try {
      if (navigator.share) { await navigator.share({ title: stop.name, text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      showToast("نسخت لك رابط المحطة.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      showToast("ما قدرت أشارك المحطة من هذا المتصفح.");
    }
  };
  const showMap = (id?: string) => {
    setMapFocus(id ?? null);
    revealMap();
  };
  const placeTerm = placeQuery.trim();
  const places = (eventCatalog?.locations ?? [])
    .filter((place) => place.status === "open" && /SERVICE|ENTRANCE|LANDMARK/i.test(place.type))
    .filter((place) => !placeTerm || [place.label, place.description, ...(place.aliases ?? [])].some((value) => value?.includes(placeTerm)));
  const placesDialog = showPlaces && (
    <dialog ref={placesDialogRef} className="visitor-dialog" aria-labelledby="visitor-places-title" onClose={() => { setShowPlaces(false); setPlaceQuery(""); setPlaceMapId(null); }}>
      <div className="sheet-heading">
        <h2 id="visitor-places-title">اعثر على مكان</h2>
        <button className="btn-icon" type="button" aria-label="إغلاق الأماكن" onClick={() => placesDialogRef.current?.close()}><Icon name="close" /></button>
      </div>
      {isFixture && <p className="visitor-note">مواقع توضيحية للعرض. للتوجيه الميداني، اتبع لوحات الموقع واسأل الموظفين.</p>}
      <label className="place-search">بحث في الأماكن<input type="search" value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} placeholder="مثل دورة مياه أو بوابة" /></label>
      <ul className="visitor-places">
        {places.map((place) => {
          const selected = placeMapId === place.id;
          return (
            <li key={place.id} className={selected ? "selected" : undefined}>
              <div><strong>{place.label}</strong>{place.description && <small>{place.description}</small>}</div>
              {map2dEnabled && (
                <button className="link-btn" type="button" aria-pressed={selected} aria-expanded={selected} onClick={() => {
                  if (selected) { setPlaceMapId(null); return; }
                  setPlaceMapId(place.id);
                  trackDurable(eventSlug, "activity_viewed");
                }}><Icon name={selected ? "close" : "map"} size={16} /> {selected ? "إخفاء الخريطة" : "عرض الموقع"}</button>
              )}
              {/* The map sits right under the tapped place and scrolls into view, so a phone shows the change at once. */}
              {selected && <div className="place-map" ref={placeMapRef}><VenueGeoMap stops={[]} eventSlug={eventSlug} focusId={place.id} /></div>}
            </li>
          );
        })}
      </ul>
      {!places.length && <p role="status">ما لقينا موقع بهذا الاسم. جرّب اسمًا أقصر أو اسأل موظفي الموقع.</p>}
    </dialog>
  );

  if (phase === "welcome")
    return (
      <main className="container visitor-flow welcome-flow">
        <header className="app-topbar">
          <a className="brand" href="/" aria-label="ونيس — الرئيسية"><BrandLogo height={34} label="ونيس" priority /></a>
        </header>
        <div className="hero">
          {eventName && <div className="hero-badge">{eventName}</div>}
          <h1 className="logo-word"><BrandLogo height={132} wordmark label="ونيس" priority /></h1>
          <p className="tagline"><b>هلا والله! قل لي وش بالك الليلة</b><br />مين معك، وش تحبون، وكم عندكم وقت. أفهمك من كلامك وأرتّب لك جولتك على طول.</p>
          {isFixture && <p className="visitor-note">{isPitch ? "عرض تجريبي · الأسعار والمواعيد للشرح" : "موسم 2026-27"}</p>}
          {isBuildingPlan && (
            <div className="chat-preview" aria-live="polite">
              {openingText.trim() && <p className="chat-bubble mine"><bdi>{openingText.trim()}</bdi></p>}
              <p className="chat-bubble typing" role="status"><span className="sr-only">ونيس يرتّب جولتك…</span><i /><i /><i /></p>
            </div>
          )}
        </div>
        <div className="welcome-actions">
          <Mascot mood="wave" height={150} className="welcome-mascot" priority />
          {eventLoadError && (
            <div className="welcome-recovery">
              {eventMissing ? (
                <>
                  <p className="guide" role="alert">ما لقينا هذي الفعالية. تأكد من الرابط أو امسح رمز QR من جديد.</p>
                  <a className="cta" href="/">الرئيسية</a>
                </>
              ) : (
                <>
                  <p className="guide" role="alert">{eventLoadError}</p>
                  <button type="button" className="cta" onClick={() => location.reload()}>إعادة المحاولة</button>
                  <a className="ghost-link" href="/">الرئيسية</a>
                </>
              )}
            </div>
          )}
          {guest?.exists && (
            <p className="guide guest-return-chip" role="status">
              أهلًا {guest.displayName ? <bdi>{guest.displayName}</bdi> : null} 👋{guest.preferences ? " ذوقك السابق محفوظ عندنا." : ""}
            </p>
          )}
          {returningGuest && !guest?.exists && !registrationRequired && eventLoadState === "ready" && (
            <div className="guest-return" role="group" aria-labelledby="guest-return-title">
              <p id="guest-return-title" className="guide"><b>هلا فيك من جديد!</b> نفس جوّ المرة الماضية؟</p>
              <div className="opening-actions">
                <button type="button" className="cta" disabled={isBuildingPlan || visitorCheck !== "done"} onClick={() => void startFromConversation("", returningGuest.preferences ?? {})}>
                  {isBuildingPlan ? "أجهز جولتك…" : "إيه، نفس الجو"}
                </button>
                <button type="button" className="cta secondary" disabled={isBuildingPlan} onClick={() => { setReturningGuest(null); document.getElementById("opening-message")?.focus(); }}>لا، شي جديد</button>
              </div>
            </div>
          )}
          {resumeAfterRegistration && registrationRequired && !guest?.exists && (
            <p className="guide" role="status">سجّل اسمك ورقم جوالك عشان نكمل. كلامك محفوظ وأبني جولتك أول ما تخلص.</p>
          )}
          {eventLoadState === "ready" && visitorCheck === "done" && registrationRequired && !guest?.exists && (
            <VisitorRegistration
              eventSlug={eventSlug}
              onRegistered={(visitor) => {
                setGuest({ exists: true, displayName: visitor.name, preferences: null, visitedCount: visitor.visitCount });
                const resume = resumeAfterRegistration;
                setResumeAfterRegistration(null);
                if (resume) {
                  // The visitor already told us what they want: build the plan now instead of asking again
                  // (and a visitor who tapped «اتصل بونيس» still gets the call).
                  void startFromConversation(resume.text, resume.saved, { call: resume.call });
                  return;
                }
                focusStartRef.current = true;
              }}
            />
          )}
          {eventLoadState !== "error" && !(registrationRequired && !guest?.exists) && (
            <form className="opening-composer" aria-label="ابدأ الكلام مع ونيس" onSubmit={(event) => { event.preventDefault(); void startFromConversation(openingText); }}>
              <div className="opening-suggestions">
                {(startGates.length > 0 || startZones.length > 0) && <>
                  <label className="sr-only" htmlFor="start-point">من وين تبدأ؟ (اختياري)</label>
                  <select id="start-point" className="chip start-chip" value={selectedStartPoint} disabled={isBuildingPlan} onChange={(event) => setSelectedStartPoint(event.target.value)}>
                    <option value="">البداية: ونيس يختار</option>
                    {startGates.length > 0 && (
                      <optgroup label="أدخل من البوابة">
                        {startGates.map((gate) => <option key={gate.id} value={gate.zone}>{gate.label}</option>)}
                      </optgroup>
                    )}
                    <optgroup label="أنا داخل الموقع عند">
                      {startZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                    </optgroup>
                  </select>
                </>}
                <div className="chips opening-examples" role="group" aria-label="أمثلة تكتبها لك">
                  {["معي عيالي","طلعة شباب","عندي ساعتين بس","أبي شي هادي"].map((example) => (
                    <button key={example} type="button" className="chip" disabled={isBuildingPlan} onClick={() => setOpeningText((current) => current.trim() ? `${current.trim()}، ${example}` : example)}>{example}</button>
                  ))}
                </div>
              </div>
              <div className="opening-input">
                <label className="sr-only" htmlFor="opening-message">قل لي وش بالك</label>
                <textarea id="opening-message" dir="auto" rows={2} maxLength={500} value={openingText} placeholder="مثلًا: معي زوجتي وولدي عمره 6 ويحب الطيارات"
                  disabled={eventLoadState !== "ready" || visitorCheck !== "done" || isBuildingPlan}
                  onChange={(event) => setOpeningText(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void startFromConversation(openingText); } }} />
                <div className="opening-actions">
                  <button type="button" className="btn-icon opening-mic" aria-label={openingListening ? "أسمعك…" : "تكلّم بدل الكتابة"} aria-pressed={openingListening} disabled={eventLoadState !== "ready" || isBuildingPlan} onClick={listenForOpening}><Icon name="mic" size={20}/></button>
                  <button ref={startButtonRef} type="submit" className="cta opening-send" disabled={eventLoadState !== "ready" || visitorCheck !== "done" || isBuildingPlan || !openingText.trim()}>
                    {eventLoadState === "loading" ? "جارٍ تحميل الفعالية…" : visitorCheck !== "done" ? "لحظة…" : isBuildingPlan ? "أجهز جولتك…" : "يلا"} <Icon name="send" size={18}/>
                  </button>
                </div>
              </div>
              {openingError && <p className="guide" role="alert">{openingError}</p>}
            </form>
          )}
          {eventLoadState !== "error" && !isPitch && !(registrationRequired && !guest?.exists) && <button className="quiet-action call-action" type="button" disabled={eventLoadState !== "ready" || visitorCheck !== "done" || isBuildingPlan} onClick={() => void startFromConversation(openingText, null, { call: true })}><Icon name="phone" size={18}/> اتصل بونيس وكلّمه بصوتك</button>}
          {eventLoadState !== "error" && <button className="quiet-action" type="button" disabled={eventLoadState !== "ready"} onClick={() => setShowPlaces(true)}><Icon name="map" size={18}/> اعثر على مكان: حمام، بوابة، إسعاف</button>}
          {visitResetError && <p role="alert">{visitResetError}</p>}
          {guest?.exists && guest.preferences && (
            <button className="cta secondary" disabled={eventLoadState !== "ready" || isBuildingPlan} onClick={() => void startFromConversation("", guest.preferences as Record<string, unknown>)}>ابدأ بذوقك السابق <Icon name="rotate" size={16}/></button>
          )}
          {(guest?.exists || showOperatorLink) && <p className="q-step welcome-operator">
            {guest?.exists && (
              <>
                <button className="ghost-link" onClick={forgetThisDevice}>لست أنا</button>
                <span aria-hidden="true"> · </span>
                <button className="ghost-link" onClick={(event) => { deleteGuestOpener.current = event.currentTarget; setConfirmDeleteGuest(true); }}>احذف بياناتي</button>
                {showOperatorLink && <span aria-hidden="true"> · </span>}
              </>
            )}
            {showOperatorLink && <a className="ghost-link" href="/ops">لوحة المشغّل <span aria-hidden="true">←</span></a>}
          </p>}
        </div>
        {confirmDeleteGuest && (
          <VisitorDialog label="حذف بياناتك المحفوظة؟" className="crowd-sheet" opener={deleteGuestOpener.current} onClose={() => setConfirmDeleteGuest(false)}>
            <p>نحذف اسمك ورقم جوالك وكل زياراتك المحفوظة عند المنظّم. ما نقدر نرجعها بعد الحذف.</p>
            <div className="acts">
              <button className="yes" type="button" onClick={() => void deleteGuestData()}><Icon name="check" size={16}/> احذف بياناتي</button>
              <button className="no" type="button" onClick={() => setConfirmDeleteGuest(false)}><Icon name="close" size={16}/> تراجع</button>
            </div>
          </VisitorDialog>
        )}
        {placesDialog}
      </main>
    );

  const it = state?.itinerary;
  const now = state?.now ?? 0;
  const current = it?.stops.find((s) => s.start <= now && s.end > now);
  const next = it?.stops.find((s) => s.start > now);
  const upcoming = current ?? next;
  const reading = liveStatus === "live" ? liveCrowd.find((item) => item.zone === upcoming?.zone &&
    (item.observation?.measurement === "counted" || item.source === "sensor" || item.source === "integration")) : undefined;
  // Outside opening hours the server clock is pinned to opening time; the plan is a preview, not "now".
  const closedPreview = modeRef.current === "durable" && !venueOpen && !isPitch;
  const firstStop = it?.stops[0];
  const headline = closedPreview ? firstStop : upcoming;
  const headlineZone = headline ? eventCatalog?.zones.find((zone) => zone.id === headline.zone)?.name ?? "" : "";
  // «باقي 12 د» while a stop runs, «بعد 8 د» before it starts; nothing far ahead or before opening.
  const minutesLeft = headline && !closedPreview ? (current && headline.act_id === current.act_id ? headline.end - now : headline.start - now) : null;
  const timeLeftLabel = closedPreview && firstStop ? `الموقع يفتح ${fmt(now)}` : minutesLeft == null || minutesLeft <= 0 || minutesLeft > 90 ? ""
    : current && headline?.act_id === current.act_id ? `باقي ${minutesLeft} د` : `تبدأ بعد ${minutesLeft} د`;
  let guide = it?.stops.length ? "انتهت جولتك. نتمنى أنك استمتعت!" : "ما لقينا نشاطًا يناسب الوقت والميزانية الآن. تقدر تستكشف الأماكن أو تبدأ زيارة جديدة.";
  if (closedPreview && firstStop) guide = `الموقع يفتح ${fmt(now)} · أول محطة ${fmt(firstStop.start)} «${firstStop.name}»`;
  else if (current) guide = `الآن: ${current.name} — استمتع! 🎉`;
  else if (next) guide = `الآن: توجه إلى «${next.name}» — يبدأ بعد ${arabicMinutes(next.start - now)}${next.walk_min ? ` (${next.walk_min} د مشي)` : ""} 🧭`;

  const itineraryVisible = wideLayout || selectedTab === "itinerary";
  // Ask «كيف كانت ليلتك» only once the night is over: the last stop has ended on the event clock,
  // or the venue has closed for the night. Not right after the plan is built, and not after each replan.
  const lastStop = it?.stops.at(-1);
  const visitOver = closedForNight || (!closedPreview && Boolean(lastStop && lastStop.end <= now));
  const proposalVisible = !voiceOpen && replanProposal && replanProposal.id !== collapsedProposalId && !dirSheet && !showWhy && !alert && !confirmNewVisit;

  return (
    <main className="container visitor-plan" data-wide={wideLayout}>
      <header className="topbar">
        <div className="plan-brand"><a className="brand" href="/" aria-label="ونيس — الرئيسية"><BrandLogo height={32} label="ونيس" /></a><h1 className="event-context" ref={planTitle} tabIndex={-1}>{eventName}</h1></div>
        <div className="topbar-actions">
          <span className="pill"><Icon name="clock" size={16}/> {closedPreview && <small>يفتح</small>}<b>{state?.nowText ?? "--:--"}</b>{isPitch && <small>وقت العرض</small>}</span>
          {weather && !isPitch && <span className="pill weather-pill" title={weather.summaryAr} aria-label={`الطقس في الموقع: ${weather.summaryAr}`}><small>الجو</small><b>{Math.round(weather.temperatureCelsius)}°</b>{!weather.live && <small>تقدير</small>}</span>}
          {modeRef.current === "durable" && <span className={`live-status ${liveStatus}`} aria-live="polite">{liveStatus === "live" ? (venueOpen || isPitch ? "مباشر" : "مسار مقترح · الموقع مغلق الآن") : liveStatus === "checking" ? "يتحقق…" : "آخر تحديث محفوظ"}</span>}
          {allowLegacyFallback && modeRef.current === "legacy" && <button className="btn-icon" aria-label="وضع العرض" title="وضع العرض" onClick={() => setShowDemo(!showDemo)}><Icon name="play" size={17}/></button>}
          <button className="btn-icon" aria-label="زيارة جديدة" title="زيارة جديدة" onClick={(event) => { newVisitOpener.current = event.currentTarget; setConfirmNewVisit(true); }}><Icon name="rotate" size={17}/></button>
        </div>
      </header>
      {confirmNewVisit && (
        <VisitorDialog label="إنهاء الزيارة وحذف بياناتها؟" className="crowd-sheet" opener={newVisitOpener.current} onClose={() => setConfirmNewVisit(false)}>
          <p>نحذف مسارك ومحادثة هذه الزيارة ونرجع لأول خطوة. ما نقدر نرجعها بعد الحذف.</p>
          <div className="acts">
            <button className="yes" type="button" onClick={() => { setConfirmNewVisit(false); void startNewVisit(); }}><Icon name="check" size={16}/> إنهاء الزيارة</button>
            <button className="no" type="button" onClick={() => setConfirmNewVisit(false)}><Icon name="close" size={16}/> كمّل زيارتي</button>
          </div>
        </VisitorDialog>
      )}

      {visitResetError && <div className="guide" role="alert">{visitResetError}</div>}

      {it && itineraryVisible && <>
          <section className="next-stop" aria-labelledby="next-stop-title">
            <div className="next-stop-head">
              <h2 id="next-stop-title">{closedPreview ? "أول محطة بعد الافتتاح" : current ? "محطتك الآن" : "خطوتك الجاية"}</h2>
              {headline && timeLeftLabel && <span className="next-stop-left">{timeLeftLabel}</span>}
            </div>
            {headline ? <>
              <strong>{headline.name}</strong>
              <p className="next-stop-when"><ItineraryTimeRange start={fmt(headline.start)} end={fmt(headline.end)} />{headlineZone && <> · {headlineZone}</>}{!(current && headline.act_id === current.act_id) && headline.walk_min > 0 && <> · {headline.walk_min} د مشي</>}{headline.note && <> · {headline.note}</>}</p>
            </> : <p>{guide}</p>}
            {headline && !isPitch && (
              <button type="button" className="cta next-stop-go" onClick={(event) => openDirections(headline.act_id, event.currentTarget)}>
                <Icon name="walk" size={18}/> {current ? "دلّني داخل المحطة" : "دلّني عليها"}
              </button>
            )}
            <div className="visit-quick-actions">
              {headline && <button type="button" className="link-btn" onClick={() => showMap(headline.zone)}><Icon name="map" size={18}/> على الخريطة</button>}
              <button type="button" className="link-btn" onClick={() => setShowPlaces(true)}><Icon name="compass" size={18}/> اعثر على مكان</button>
              <button type="button" className="link-btn" onClick={() => {
                selectTab("assistant");
                void sendChat("أحتاج مساعدة من موظف");
              }}><Icon name="people" size={18}/> اطلب مساعدة</button>
            </div>
            {reading && <small className="visitor-note">الإشغال المرصود {Math.round(reading.level * 100)}%{reading.observation?.waitMinutes != null && ` · انتظار ${reading.observation.waitMinutes} د`} · {reading.source === "operator" ? "من المشغّل" : "من نظام الموقع"}</small>}
            {(isFixture || lastLiveCheck) && <small className="visitor-note next-stop-foot">
              {isFixture && (isPitch ? "عرض تجريبي، الأسعار والمواعيد توضيحية" : "الأسعار والمواعيد تقريبية")}
              {isFixture && lastLiveCheck && <span aria-hidden="true"> · </span>}
              {lastLiveCheck && <>آخر تحديث {venueTimeLabel(lastLiveCheck, eventTimezone)}</>}
            </small>}
          </section>
      </>}
      {/* The «now / next» card above says which stop, when, and how far: no second banner for the same thing. */}
      {replanFeedback && <p className="guide" role="status">{replanFeedback}</p>}
      {replanProposal && !proposalVisible && (
        <button type="button" className="cta proposal-reminder" onClick={() => { setReplanFeedback(""); setCollapsedProposalId(null); }}>
          راجع اقتراح تعديل المسار
        </button>
      )}
      {planNotice && <p className="guide" role="status">{planNotice}</p>}

      <div className="visitor-workspace">
        <BottomNav tabs={wideLayout ? VISITOR_TABS.filter((tab) => tab !== "itinerary") : VISITOR_TABS} active={selectedTab} onSelect={selectTab}
          hidden={voiceOpen || Boolean(airGuide && guideOpen)}
          badges={{ itinerary: replanProposal ? "1" : null }}
          icon={(tab) => <Icon name={tab === "itinerary" ? "clock" : tab === "map" ? "compass" : tab === "nearby" ? "landmark" : tab === "me" ? "user" : "chat"} />} />
        <section id="visitor-panel-itinerary" className="visitor-itinerary"
          role="region" aria-labelledby={wideLayout ? "visitor-itinerary-title" : "visitor-tab-itinerary"}
          tabIndex={wideLayout ? undefined : 0} hidden={!itineraryVisible}>
          {!it && modeRef.current === "durable" && (
            <div className="opening-understood" role="status">
              <p className="opening-reply"><Icon name="mic" size={15}/> مسارك يتكوّن مع المكالمة: قل لونيس مين معك ووش تحبون، ويرتّبها لك. أو اكتب له جملة في تبويب «ونيس».</p>
            </div>
          )}
          {it && <>
          {modeRef.current === "durable" && <details className="visitor-offers" onToggle={(event) => { if (event.currentTarget.open) void refreshOffers(); }}>
            <summary>حوافز متاحة لزيارتك</summary>
            {offerMessage && <p role="status">{offerMessage}</p>}
            {visitorOffers === null && !offerMessage && <p role="status">جارٍ التحقق من الحوافز…</p>}
            {visitorOffers?.length === 0 && <p>لا توجد حوافز متاحة الآن.</p>}
            {visitorOffers?.map(({ incentive, claimed }) => <article key={incentive.incentiveId}>
              <strong>{incentive.titleAr} · {incentive.valueLabelAr}</strong>
              <p>{incentive.reasonAr}</p>
              {incentive.locationLabelAr && <p>{incentive.locationLabelAr}</p>}
              {incentive.expiresAt && <small>ينتهي {venueTimeLabel(incentive.expiresAt, eventTimezone)}</small>}
              <button type="button" className="link-btn" disabled={claimed || claimingOffer} onClick={() => claimOffer(incentive.incentiveId)}>{claimed ? "طُلبت الاستفادة" : "اطلب الاستفادة"}</button>
            </article>)}
          </details>}
          {(openingReply || assumptions.length > 0) && <div className="opening-understood" role="status">
            {openingReply && <p className="opening-reply"><Icon name="chat" size={15}/> {openingReply}</p>}
            {assumptions.length > 0 && <div className="chips assumption-chips" role="group" aria-label="افتراضات الجولة، اضغط عشان تصححها">
              <span>افترضت:</span>
              {assumptions.map((assumption) => (
                <button key={assumption.key} type="button" className="chip" title={assumption.message} onClick={() => {
                  setAssumptions((list) => list.filter((item) => item.key !== assumption.key));
                  setOpeningReply("");
                  setActiveTab("assistant");
                  void sendChat(assumption.message);
                }}>{assumption.label}</button>
              ))}
            </div>}
          </div>}
          <div className="sec"><h2 id="visitor-itinerary-title">مسارك الليلة</h2><span className="total"><Icon name="price" size={15}/>{partyCount > 1 ? `${it.total_cost * partyCount} ريال ${forParty(partyCount)}` : `${it.total_cost} ريال للأنشطة`}</span></div>
          <div className="rail">
            {it.stops.map((s, i) => {
              const past = s.end <= now;
              const cur = !closedPreview && s.start <= now && s.end > now;
              // Engine prices are per person; a group also sees what this stop costs them all.
              const price = stopPriceLabel(s.price, partyCount);
              return (
                <div key={i} className={`stop${past ? " past" : ""}${cur ? " current" : ""}`}>
                  <span className="node" />
                  {i > 0 && it.stops[i - 1].zone !== s.zone && (
                    <div className="walk"><Icon name="walk" size={15}/> {s.walk_min} د مشي{s.wait_min >= 5 ? <> · <Icon name="clock" size={14}/> انتظار {s.wait_min} د</> : ""}</div>
                  )}
                  <div className="stop-card">
                    <div className="s-time"><Icon name="clock" size={14}/><ItineraryTimeRange start={fmt(s.start)} end={fmt(s.end)} /></div>
                    <div className="s-name">{s.name}</div>
                    <div className="s-meta">
                      <span className="price"><Icon name="price" size={14}/>{price.perPerson}</span>
                      {price.group && <span className="price-group">{price.group}</span>}
                      <span><Icon name="clock" size={14}/>{s.end - s.start} د</span>
                    </div>
                    {s.note && <div className="s-note">↳ {s.note}</div>}
                    <div className="stop-actions">
                      {!isPitch && <button type="button" className="directions-link" onClick={(event) => openDirections(s.act_id, event.currentTarget)}>اتجاهات المشي</button>}
                      <button type="button" className="btn-icon stop-more" aria-haspopup="dialog" aria-label={`خيارات ${s.name}`} title="خيارات" onClick={(event) => { stopMenuOpener.current = event.currentTarget; setStopMenuId(s.act_id); }}><Icon name="more" size={18}/></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {modeRef.current === "durable" && !isPitch && (
            <LockScreenNudges eventSlug={eventSlug} openPath={urlSynced ? `/e/${encodeURIComponent(eventSlug)}` : onEventsPath ? `/events/${encodeURIComponent(eventSlug)}` : "/demo"}
              seenNudgeIds={() => [...seenNudgesRef.current]} />
          )}
          <div className="sec">
            <span>ليش هذا المسار؟</span>
            <button className="link-btn" onClick={(event) => openReasons(event.currentTarget)}>عرض</button>
          </div>
          {modeRef.current === "durable" && !isPitch && visitOver && (
            <VisitRating visitKey={`${eventSlug}:${state?.sessionId ?? "visit"}`} onRate={(value) => trackDurable(eventSlug, "visit_rating", { metricValue: value })} />
          )}
          </>}
        </section>
        {showWhy && !dirSheet && (
            <VisitorDialog label="ليش هذا المسار؟" opener={reasonsOpener.current} onClose={() => setShowWhy(false)}>
                <div className="why-card">
                  {it?.explanations.map((e, i) => <div key={i}>{e}</div>)}
                  {!it?.explanations.length && <div>رتبنا المحطات حسب مواعيدها ووقتك المتاح وتفضيلاتك.</div>}
                </div>
            </VisitorDialog>
        )}

        <section id="visitor-panel-map" className="visitor-map" role="region" aria-labelledby="visitor-tab-map" tabIndex={0} hidden={selectedTab !== "map"}>
          {airGuide && <div className="guide-bar"><button type="button" className="yes" onClick={() => setGuideOpen(true)}><Icon name="compass" size={16}/> البوصلة · {Math.round(airGuide.remainingM)} م إلى {airGuide.destName}</button><button type="button" className="directions-link" onClick={stopGuide}>إنهاء التوجيه</button></div>}
          {it && (selectedTab === "map" || mapVisited) && (map2dEnabled
            ? <VenueGeoMap stops={it.stops} eventSlug={eventSlug} focusId={mapFocus} path={mapPath} me={airGuide ? { x: airGuide.x, y: airGuide.y, target: airGuide.target, heading: airGuide.heading ?? null, accuracyM: airGuide.accuracyM ?? null } : null} crowd={liveCrowd} onNavigate={isPitch ? undefined : (placeId) => startAirGuide(undefined, placeId)} />
            : <div className="map-card" aria-label="مناطق المسار"><strong>مناطق مسارك</strong><div className="route-zone-list">{[...new Set(it.stops.map((stop) => stop.zone))].map((zoneId) => <span key={zoneId}>{eventCatalog?.zones.find((zone) => zone.id === zoneId)?.name ?? zoneId}</span>)}</div></div>)}
          <button type="button" className="directions-link map-directions" onClick={(event) => openDirections(undefined, event.currentTarget)}>اتجاهات المشي</button>
        </section>

      <section id="visitor-panel-assistant" className="chat-dock" role="region" aria-labelledby="visitor-tab-assistant" tabIndex={0} hidden={selectedTab !== "assistant"}>
        <div className="chat-header"><span className="chat-avatar" aria-hidden="true"><img src="/brand/mascot-head.webp" alt="" width={36} height={36} /></span><div><h2>مساعد ونيس</h2><small>اسأل عن الأنشطة والاتجاهات أو عدّل مسارك</small></div>{!isPitch && <button ref={voiceCallButtonRef} className="voice-call-btn" type="button" onClick={(event) => { voiceOpener.current = event.currentTarget; setVoiceTranscript(""); setVoiceReply(""); setVoiceError(""); setVoiceOpen(true); }} aria-label="ابدأ محادثة صوتية مع ونيس"><Icon name="mic" size={16}/> مكالمة</button>}</div>
        <div className="chat-log" ref={chatLog} role="log" aria-label="المحادثة" tabIndex={0}>
          {messages.map((m, i) => m.role === "typing" ? (
            <div key={i} className="bubble agent typing" aria-label="ونيس يكتب"><i/><i/><i/></div>
          ) : <div key={i} className={`bubble ${m.role}`}>
            <div>{m.text}</div>
            {m.ui?.length ? <A2uiSurface messages={m.ui} onAction={handleA2uiAction} disabled={Boolean(surfaceProposalId(m.ui)) && (replanBusy || surfaceProposalId(m.ui) !== replanProposal?.id)} /> : m.options?.length ? <div className="chat-options">
              {m.options.map((option) => { const isActivity = option.kind !== "zone" && option.kind !== "location"; const inRoute = isActivity && Boolean(it?.stops.some((stop) => stop.act_id === option.id)); const canAdd = isActivity && !inRoute && option.priceSar != null && option.eligibilityKnown !== false; return <div key={option.id} className="chat-option-actions">
                <button type="button" aria-label={canAdd ? `أضف ${option.name} لمساري` : undefined} onClick={(event) => { if (option.kind === "zone") openDirections(option.id, event.currentTarget); else if (option.kind === "location") { setMapFocus(option.id); revealMap(); } else if (canAdd) void sendChat(`أضف ${option.name} لمساري`); else { setMapFocus(option.zone ?? null); revealMap(); } }}>
                  <span>{option.name}</span><small>{option.kind === "zone" ? "منطقة داخل الفعالية" : option.kind === "location" ? `${option.zoneName ?? "داخل الموقع"} · عرض على الخريطة` : `${option.priceSar == null ? "السعر غير مؤكد" : option.priceSar ? `${option.priceSar} ريال تقريبًا` : "مجانًا"}${option.eligibilityKnown === false ? " · شروط المشاركة غير مؤكدة" : ""} · ${option.durationMin ?? 0} د`}</small>
                  {option.reasons?.length ? <em className="opt-reasons">{option.reasons.slice(0, 2).join(" · ")}</em> : null}
                  {inRoute ? <em className="opt-cta opt-cta-done">✓ في مسارك</em> : canAdd ? <em className="opt-cta">＋ أضف لمساري</em> : null}
                </button>
                {!isPitch && <button type="button" className="directions-link" aria-label={`اتجاهات المشي إلى ${option.name}`} onClick={(event) => openDirections(option.id, event.currentTarget)}>اتجاهات</button>}
              </div>; })}
            </div> : null}
            {m.directions && !isPitch && (
              <div className="chat-guide">
                <span><Icon name="walk" size={14}/> {m.directions.totalWalkMin} د مشي{m.directions.avoided.length ? ` · تجنبنا زحمة ${m.directions.avoided.join("، ")}` : ""}</span>
                <button type="button" className="yes" onClick={(event) => void startAirGuide(event.currentTarget, m.directions!.targetId)}><Icon name="compass" size={16}/> دلّني الآن</button>
                <button type="button" className="directions-link" onClick={() => { setMapFocus(m.directions!.targetId); revealMap(); }}>على الخريطة</button>
              </div>
            )}
            {m.handoff && <div className="chat-handoff">تم فتح طلب متابعة للمشغّل</div>}
          </div>)}
          {!rememberAsked && modeRef.current === "durable" && !guest?.exists && it && (
            <div className="bubble agent remember-ask">
              <div>تبيني أتذكرك للزيارة الجاية؟ بدون اسم أو جوال، بس ذوقك والأماكن اللي مريتها عشان ما أكررها.</div>
              <div className="chat-guide">
                <button type="button" className="yes" disabled={rememberBusy} onClick={() => void changeRemember(true)}>إيه، تذكّرني</button>
                <button type="button" className="directions-link" onClick={() => setRememberAsked(true)}>لا، شكرًا</button>
              </div>
            </div>
          )}
        </div>
        <div className="chips">
          {!isPitch && <button onClick={(event) => startAirGuide(event.currentTarget)}><Icon name="compass" size={16}/> ضعت! دلّني</button>}
          {!isPitch && <button onClick={(event) => openDirections(undefined, event.currentTarget)}><Icon name="walk" size={14}/> اتجاهات المشي</button>}
          <button disabled={chatPending} onClick={() => sendChat("رشّح لي نشاط يناسب ذوقي")}><Icon name="sparkles" size={14}/> رشّح لي</button>
          <button disabled={chatPending} onClick={() => sendChat("تعبت، قلّل الجولة")}><Icon name="rotate" size={14}/> قلّل الجولة</button>
          <button disabled={chatPending} onClick={() => sendChat("بدّل النشاط القادم ببديل")}><Icon name="shuffle" size={14}/> بدّل القادم</button>
          <button onClick={(event) => openReasons(event.currentTarget)}><Icon name="question" size={14}/> ليش كذا؟</button>
        </div>
        <form className="composer" onSubmit={(event) => { event.preventDefault(); void sendChat(chatInput); }}>
          <input ref={chatInputRef} aria-label="اكتب طلبك" dir="auto" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
            placeholder="مثال: بدّل العجلة الدوارة" />
          <button type="submit" aria-label="إرسال" disabled={!chatInput.trim() || chatPending}><Icon name="send" size={18}/></button>
        </form>
      </section>
      <section id="visitor-panel-nearby" className="visitor-nearby" role="region" aria-labelledby="visitor-tab-nearby" tabIndex={0} hidden={selectedTab !== "nearby"}>
        {modeRef.current === "durable"
          ? <NearbyPanel eventSlug={eventSlug} request={durableRequest} locate={locateOnVenue} stopZone={(current ?? next)?.zone}
              onGuide={(targetId, opener) => { if (isPitch) showMap(targetId); else void startAirGuide(opener, targetId); }}
              onShowOnMap={(id) => showMap(id)} />
          : <p className="guide">الأماكن القريبة تحتاج اتصال بالخادم. جرّب «اعثر على مكان» من مسارك.</p>}
      </section>
      <section id="visitor-panel-me" className="visitor-me" role="region" aria-labelledby="visitor-tab-me" tabIndex={0} hidden={selectedTab !== "me"}>
        <MePanel preferences={mePrefs} loading={meLoading} languageBusy={languageBusy || modeRef.current !== "durable"}
          onLanguage={(language) => void changeLanguage(language)}
          onForget={(opener) => { newVisitOpener.current = opener; setConfirmNewVisit(true); }}
          remember={!isPitch && !guest?.exists && modeRef.current === "durable" && remembered
            ? { on: remembered.on, busy: rememberBusy, visitCount: remembered.visitCount, onChange: (on) => void changeRemember(on) }
            : undefined}>
          {!isPitch && modeRef.current === "durable" && <LinkScreen eventSlug={eventSlug} request={durableRequest} />}
        </MePanel>
      </section>
      </div>
      <ToastHost toasts={toasts} dismiss={dismissToast} />

      {voiceOpen && !dirSheet && !showWhy && (
        <VisitorDialog label="محادثة صوتية مع ونيس" className="voice-agent" opener={voiceOpener.current} onClose={closeVoice}>
            <div className={`voice-orb is-${voiceState}`} aria-hidden="true"><span>و</span><i/><i/><i/></div>
            <p role="status">{voiceState === "listening" ? "أسمعك… تكلم براحتك" : voiceState === "thinking" ? "ثواني، أجهّز ردّي…" : voiceState === "speaking" ? "ونيس يرد عليك…" : voiceState === "paused" ? "توقفت المكالمة. اضغط استئناف إذا تبي تكمل." : voiceState === "error" ? voiceError || "تعذر تشغيل الصوت. تأكد من إذن الميكروفون أو كمل بالكتابة." : "ونيس يرد بالصوت، ثم يرجع يسمعك إلى أن تنهي المكالمة."}</p>
            {voiceTranscript && <div className="voice-transcript"><strong>أنت</strong> {voiceTranscript}</div>}
            {voiceReply && <div className="voice-transcript" aria-live="polite"><strong>ونيس</strong> {voiceReply}</div>}
            <div className="voice-agent-actions">
              {voiceState === "listening" || voiceState === "thinking" || voiceState === "speaking"
                ? <>
                    {voiceMode === "realtime" && <button type="button" className="voice-mute" aria-pressed={voiceMuted} onClick={() => {
                      const next = !voiceMuted;
                      realtimeCallRef.current?.setMuted(next);
                      setVoiceMuted(next);
                    }}>{voiceMuted ? <><Icon name="mic" size={16}/> إلغاء الكتم</> : <><Icon name="micOff" size={16}/> كتم</>}</button>}
                    <button type="button" className="voice-stop" onClick={closeVoice}>إنهاء المكالمة</button>
                  </>
                : <button type="button" className="voice-start" onClick={() => void startVoice()}><Icon name="mic" size={18}/> {voiceState === "paused" || voiceState === "error" ? "استئناف المكالمة" : "ابدأ المكالمة"}</button>}
            </div>
            <button type="button" className="link-btn voice-text-link" onClick={() => {
              closeVoice();
              setActiveTab("assistant");
              // Chose typing before the call built anything: the safe starter plan, as the text path promises.
              void ensureStarterPlan();
              requestAnimationFrame(() => chatInputRef.current?.focus());
            }}>كمّل بالكتابة</button>
            <small>{voiceMode === "realtime"
              ? "مكالمة حية: تقدر تقاطع ونيس وتتكلم براحتك. صوتك يمر لمزوّد الذكاء الاصطناعي ولا نحفظه، وأي تعديل على المسار يحتاج موافقتك."
              : "أثناء المكالمة يرسل المتصفح كلامك كنص إلى ونيس بعد كل مرة تتكلم فيها. أي تعديل على المسار يحتاج موافقتك."}</small>
        </VisitorDialog>
      )}

      {stopMenuStop && (
        <VisitorDialog label={stopMenuStop.name} className="action-sheet" opener={stopMenuOpener.current} onClose={() => setStopMenuId(null)}>
          <p className="action-sheet-meta"><Icon name="clock" size={14}/> <ItineraryTimeRange start={fmt(stopMenuStop.start)} end={fmt(stopMenuStop.end)} /></p>
          <ul className="action-list" role="list">
            {!isPitch && <li><button type="button" onClick={() => { const opener = stopMenuOpener.current ?? undefined; setStopMenuId(null); openDirections(stopMenuStop.act_id, opener); }}><Icon name="walk" size={18}/> اتجاهات المشي</button></li>}
            <li><button type="button" onClick={() => { setStopMenuId(null); showMap(stopMenuStop.zone); }}><Icon name="map" size={18}/> اعرضها على الخريطة</button></li>
            <li><button type="button" onClick={() => { setStopMenuId(null); selectTab("assistant"); void sendChat(`ليش اخترت ${stopMenuStop.name}؟`); }}><Icon name="question" size={18}/> ليش هذي المحطة؟</button></li>
            {stopMenuStop.start > (state?.now ?? 0) && <>
              <li><button type="button" onClick={() => { setStopMenuId(null); selectTab("assistant"); void sendChat(`بدّل ${stopMenuStop.name} بشي ثاني`); }}><Icon name="shuffle" size={18}/> بدّلها بشي ثاني</button></li>
              <li><button type="button" className="danger" onClick={() => { setStopMenuId(null); selectTab("assistant"); void sendChat(`شيل ${stopMenuStop.name} من مساري`); }}><Icon name="trash" size={18}/> شيلها من مساري</button></li>
            </>}
            <li><button type="button" onClick={() => void shareStop(stopMenuStop)}><Icon name="share" size={18}/> شارك المحطة</button></li>
          </ul>
          <p className="action-sheet-note">أي تعديل على مسارك يرجع لك ونيس فيه قبل ما يطبّقه.</p>
        </VisitorDialog>
      )}

      {dirSheet && (
          <VisitorDialog label="اتجاهات المشي" className="dir-sheet" opener={directionsOpener.current} onClose={closeDirections}>
            <div className="dir-pickers">
              <label>
                أنا عند
                <select value={dirFrom} disabled={dirBusy} onChange={(e) => { setDirFrom(e.target.value); setDirResult(null); setDirGpsFix(null); }}>
                  {eventCatalog?.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                  {directionsPlaces.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
                </select>
              </label>
              <label>
                أبي أروح
                <select value={dirTo} disabled={dirBusy} onChange={(e) => { setDirTo(e.target.value); setDirResult(null); setDirGpsFix(null); }}>
                  <optgroup label="المناطق">{eventCatalog?.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</optgroup>
                  <optgroup label="الأنشطة">{eventCatalog?.activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}</optgroup>
                  <optgroup label="الخدمات والبوابات">{directionsPlaces.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}</optgroup>
                </select>
              </label>
              {gpsAvailable && <button type="button" className="yes" onClick={() => fetchDirections("", dirTo, true)} disabled={dirBusy || !dirTo}>استخدم موقعي للاتجاهات</button>}
              <button type="button" className={gpsAvailable ? "directions-link" : "yes"} onClick={() => fetchDirections(dirFrom, dirTo)} disabled={dirBusy || !dirTo}>احسب من نقطة الانطلاق المختارة</button>
            </div>
            {dirBusy && <p role="status">جارٍ تحديد نقطة الانطلاق وحساب الطريق…</p>}
            {dirError && <div className="dir-error" role="alert">{dirError}</div>}
            {dirResult && (
              <>
                {dirGpsFix && <p>نقطة الانطلاق الأقرب لموقعك: {dirGpsFix.node.label}</p>}
                {dirResult.demoRoute && <p className="dir-error" role="note">هذه اتجاهات تجريبية. اتبع لوحات الموقع للتوجيه الميداني.</p>}
                {!dirResult.demoRoute && eventNavigation?.accuracy === "approximate" && <p className="dir-note" role="note">المسار تقريبي، اتبع لوحات الموقع أيضًا.</p>}
                {dirResult.mode === "estimate" && <p>المسار التفصيلي غير متوفر بين النقطتين.</p>}
                {dirResult.mode !== "estimate" && dirResult.arrival === "zone" && dirResult.target.kind !== "zone" && <p>الاتجاهات توصلك إلى منطقة «{dirResult.target.name}». بيانات الفعالية ما تحدد نقطة أدق.</p>}
                <ol className="dir-steps">
                  {dirResult.steps.map((step, index) => (
                    <li key={`${step.id}-${index}`}>
                      <span>{index + 1}. {step.label}</span>
                      <small>{index === 0 ? "نقطة البداية" : `+${step.walkMinFromPrev} د مشي`}{step.zoneName && step.zoneName !== step.label ? ` · ${step.zoneName}` : ""}{step.crowded ? " · 🔴 مزدحم الآن" : ""}</small>
                    </li>
                  ))}
                </ol>
                <div className="dir-foot">
                  <strong>الإجمالي: {minutesCount(dirResult.totalWalkMin)} مشي{dirResult.mode === "estimate" ? " (تقديري)" : ""}</strong>
                  {dirResult.pathNodes.length > 0 && map2dEnabled && <button onClick={() => showDirectionsOnMap(dirResult)}>{dirGpsFix && !dirResult.demoRoute ? <><Icon name="compass" size={16}/> ابدأ التوجيه الحي</> : <><Icon name="map" size={16}/> عرض المسار على الخريطة</>}</button>}
                  {dirResult.pathNodes.length > 1 && map2dEnabled && !(dirGpsFix && !dirResult.demoRoute) && <button type="button" className="directions-link" onClick={() => showDirectionsOnMap(dirResult, { fix: null, simulate: true })}><Icon name="walk" size={16}/> جرّب التوجيه (محاكاة مشي)</button>}
                </div>
              </>
            )}
          </VisitorDialog>
      )}

      {alert && !voiceOpen && !dirSheet && !showWhy && (
          <VisitorDialog label="تنبيه الازدحام" className="crowd-sheet" onClose={() => setAlert(null)}>
            <div className="toast-body">{alert.text}</div>
            <div className="acts">
            <button className="yes" onClick={async () => {
              // استبدال موضعي للنشاط الموعود بالبديل المقترح — لا إعادة جدولة كاملة
              await fireDemo([{ type: "swap", activity: alert.stop_act, replacement: alert.suggestion.id }]);
              setAlert(null);
            }}><Icon name="check" size={16}/> بدّل</button>
            <button className="no" onClick={() => setAlert(null)}><Icon name="close" size={16}/> لا، أبيه</button>
            </div>
          </VisitorDialog>
      )}

      {placesDialog}
      {airGuide && guideOpen && <PrecisionGuide guide={airGuide} onClose={stopGuide} onShowMap={() => { setGuideOpen(false); revealMap(); }} />}
      {proposalVisible && replanProposal && (
          <VisitorDialog label="اقتراح تعديل المسار" className="crowd-sheet" onClose={() => { if (!replanBusy) setCollapsedProposalId(replanProposal.id); }}>
            <p>{replanProposal.kind === "assistant" ? "هذا التعديل اللي طلبته." : replanProposal.reason || "تغيّر برنامج الفعالية."}</p>
            {replanProposal.announcedAt && <p className="visitor-note">تحديث من المشغّل · {venueTimeLabel(replanProposal.announcedAt, eventTimezone)}</p>}
            <ul className="proposal-changes">
              {replanProposal.diff.removed?.map((item, index) => <li key={`removed-${index}`}>يُزال · {item.name}</li>)}
              {replanProposal.diff.added?.map((item, index) => <li key={`added-${index}`}>يُضاف · {item.name}{item.start != null && ` · ${fmt(item.start)}`}</li>)}
              {replanProposal.diff.moved?.map((item, index) => <li key={`moved-${index}`}>{item.name}{item.from && item.to ? ` · من ${fmt(item.from.start)} إلى ${fmt(item.to.start)}` : " · تغيّر موعده"}</li>)}
            </ul>
            {!replanProposal.candidate.stops.length && <p>ما توفر بديل يناسب وقتك وميزانيتك.</p>}
            {it && <dl className="proposal-totals">
              <div><dt>سعر الأنشطة{partyCount > 1 ? ` ${forParty(partyCount)}` : ""}</dt><dd>قبل {it.total_cost * partyCount} · بعد {replanProposal.candidate.total_cost * partyCount} ريال</dd></div>
              <div><dt>نهاية الجولة</dt><dd dir="ltr">{it.stops.at(-1) ? fmt(it.stops.at(-1)!.end) : "—"} → {replanProposal.candidate.stops.at(-1) ? fmt(replanProposal.candidate.stops.at(-1)!.end) : "—"}</dd></div>
            </dl>}
            {replanProposal.incentive && <p className="proposal-incentive" role="note"><Icon name="gift" size={16}/> <strong>{replanProposal.incentive.valueLabelAr}</strong> · {replanProposal.incentive.titleAr}</p>}
            {replanFeedback && <p role="alert">{replanFeedback}</p>}
            <div className="acts">
              <button className="yes" disabled={replanBusy} onClick={() => resolveReplanProposal("accept")}><Icon name="check" size={16}/> اعتمد البديل</button>
              <button className="no" disabled={replanBusy} onClick={() => resolveReplanProposal("keep_current")}><Icon name="close" size={16}/> أبقي مساري</button>
            </div>
          </VisitorDialog>
      )}

      {showDemo && (
        <div className="demo-bar">
          <b>وضع العرض:</b>
          {(() => {
            const delayTarget = state ? firstFutureDemoStop(it?.stops ?? [], state.now, 30) : undefined;
            const crowdTarget = state ? firstFutureDemoStop(it?.stops ?? [], state.now, 20) : undefined;
            const cancelTarget = state ? firstFutureDemoStop(it?.stops ?? [], state.now, 15) : undefined;
            return <>
              <button disabled={!delayTarget} onClick={() => delayTarget && fireDemo([{ type: "delay", activity: delayTarget.act_id, minutes: 30 }], 30)}><Icon name="clockAdd" size={14}/> قدّم الوقت + تأخير</button>
              <button disabled={!crowdTarget} onClick={() => crowdTarget && fireDemo([{ type: "crowd_spike", zone: crowdTarget.zone, level: 0.95, until_hour: 23 }], 20)}><Icon name="crowd" size={14}/> موجة زحام</button>
              <button disabled={!cancelTarget} onClick={() => cancelTarget && fireDemo([{ type: "cancel", activity: cancelTarget.act_id }], 15)}><Icon name="close" size={14}/> إلغاء</button>
            </>;
          })()}
          <button aria-label="إغلاق" onClick={() => setShowDemo(false)}><Icon name="close" size={14}/></button>
        </div>
      )}
    </main>
  );
}

export default function DemoPage() {
  return <VisitorGuide />;
}
