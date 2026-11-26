// جلسات الزوار في الذاكرة — تكفي للعرض (كل جلسة = زائر)
import { randomUUID } from "node:crypto";
import { Site, defaultProfile } from "../engine/site.ts";
import { loadActiveCatalog } from "./venues.ts";
import { buildRoute, replan } from "../engine/route.ts";
import type { Itinerary, Profile, CrowdEvent } from "../engine/types.ts";

export interface Session {
  id: string;
  site: Site;
  profile: Profile;
  itinerary: Itinerary | null;
  createdAt: number;
  lastActivity: number;
  demoMode: boolean;
}

const globalStore = globalThis as unknown as { __sessions?: Map<string, Session> };
const sessions: Map<string, Session> = globalStore.__sessions ?? new Map();
globalStore.__sessions = sessions;

// تنظيف الجلسات الأقدم من 12 ساعة
setInterval(() => {
  const cutoff = Date.now() - 12 * 3600 * 1000;
  for (const [id, s] of sessions) {
    if (s.lastActivity < cutoff) {
      sessions.delete(id);
      demoOffsets.delete(id);
    }
  }
}, 3600 * 1000);

// demoOffsets معرف بعد الجلسات — نصرّحه هنا لأن التنظيف أعلاه يحذف مفاتيحه
const demoOffsets = new Map<string, number>();

export function createSession(): Session {
  const id = randomUUID();
  const s: Session = {
    id,
    site: new Site(loadActiveCatalog()),
    profile: defaultProfile(),
    itinerary: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    demoMode: false,
  };
  sessions.set(id, s);
  return s;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function deleteSession(id: string): boolean {
  demoOffsets.delete(id);
  return sessions.delete(id);
}

export function allSessions(): Session[] {
  return [...sessions.values()];
}

/** الساعة الافتراضية للجلسة: تبدأ من بداية الزيارة وتمشي مع الوقت الحقيقي (+ ديمو) */
export function sessionNow(s: Session): number {
  const elapsedRealMin = (Date.now() - s.createdAt) / 60000;
  let now = s.profile.start_min + Math.floor(elapsedRealMin);
  if (s.demoMode) {
    const demoOffset = demoOffsets.get(s.id) ?? 0;
    now = Math.max(now, s.profile.start_min + demoOffset);
  }
  return now;
}

export function advanceDemoClock(s: Session, minutes: number) {
  demoOffsets.set(s.id, (demoOffsets.get(s.id) ?? 0) + minutes);
  s.lastActivity = Date.now();
}

export function rebuild(s: Session): Itinerary {
  s.itinerary = buildRoute(s.site, s.profile);
  s.lastActivity = Date.now();
  return s.itinerary;
}

export function applyEvents(s: Session, events: CrowdEvent[], nowMin: number): Itinerary {
  if (!s.itinerary) s.itinerary = buildRoute(s.site, s.profile);
  s.itinerary = replan(s.site, s.profile, s.itinerary, nowMin, events);
  s.lastActivity = Date.now();
  return s.itinerary;
}
