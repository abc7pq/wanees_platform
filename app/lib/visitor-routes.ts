// Real, linkable visitor screens (audit 2.1). Each tab has its own URL under /e/{eventSlug}, so a
// deep link opens the right screen and the browser's Back button moves between screens instead of
// leaving the app. Pure functions: the page and the tests share them.

export const VISITOR_TABS = ["assistant", "itinerary", "map", "nearby", "me"] as const;
export type VisitorTabId = (typeof VISITOR_TABS)[number];

const SEGMENT: Record<VisitorTabId, string> = { assistant: "", itinerary: "plan", map: "map", nearby: "nearby", me: "me" };
const BY_SEGMENT = new Map(Object.entries(SEGMENT).map(([tab, segment]) => [segment, tab as VisitorTabId]));

export const TAB_LABELS: Record<VisitorTabId, string> = { assistant: "ونيس", itinerary: "مساري", map: "الخريطة", nearby: "حولي", me: "أنا" };

export type VisitorRoute = {
  slug: string;
  tab: VisitorTabId;
  /** Full-screen screens that hide the bottom navigation. */
  screen: "tab" | "guide" | "call";
  targetId?: string;
};

const SLUG = /^[A-Za-z0-9_-]{1,120}$/;

export function visitorBasePath(slug: string) {
  return `/e/${encodeURIComponent(slug)}`;
}

export function tabPath(slug: string, tab: VisitorTabId) {
  const segment = SEGMENT[tab];
  return segment ? `${visitorBasePath(slug)}/${segment}` : visitorBasePath(slug);
}

export function guidePath(slug: string, targetId: string) {
  return `${visitorBasePath(slug)}/guide/${encodeURIComponent(targetId)}`;
}

/** Reads /e/{slug}[/plan|/map|/nearby|/me|/guide/{id}|/call]; null for any other path. */
export function parseVisitorPath(pathname: string | null | undefined): VisitorRoute | null {
  if (!pathname) return null;
  const parts = pathname.split("?")[0].split("/").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  if (parts[0] !== "e" || !parts[1] || !SLUG.test(parts[1])) return null;
  const slug = parts[1];
  const [segment, id] = parts.slice(2);
  if (!segment) return { slug, tab: "assistant", screen: "tab" };
  if (segment === "guide" && id) return { slug, tab: "map", screen: "guide", targetId: id.slice(0, 200) };
  if (segment === "call") return { slug, tab: "assistant", screen: "call" };
  const tab = BY_SEGMENT.get(segment);
  return tab ? { slug, tab, screen: "tab" } : { slug, tab: "assistant", screen: "tab" };
}
