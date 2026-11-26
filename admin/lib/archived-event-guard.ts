// An ARCHIVED event is read-only. Every organizer write under /api/v1/events/{slug}/ is refused
// until the event is restored to DRAFT, except the status change that restores it and the
// read-only previews (dry-run, impact) that never store anything.

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_WRITE_SUFFIXES = new Set(["status", "updates/dry-run", "updates/impact"]);

/** The event slug this request would write to, or null when the archive rule does not apply. */
export function archivedWriteTarget(method: string, pathname: string): string | null {
  if (READ_METHODS.has(method.toUpperCase())) return null;
  const match = pathname.match(/^\/api\/v1\/events\/([^/]+)\/(.+?)\/?$/);
  if (!match) return null;
  const [, rawSlug, suffix] = match;
  if (ALLOWED_WRITE_SUFFIXES.has(suffix)) return null;
  try {
    return decodeURIComponent(rawSlug);
  } catch {
    return null;
  }
}

/** True when the event is archived. Slugs are unique across organizations (Event_slug_key). */
export async function isArchivedEvent(slug: string): Promise<boolean> {
  const { prisma } = await import("./db.ts");
  const event = await prisma.event.findUnique({ where: { slug }, select: { status: true } });
  return event?.status === "ARCHIVED";
}
