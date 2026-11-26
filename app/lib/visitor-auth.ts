import { prisma } from "@/lib/db";
import { hashVisitorToken, readVisitorToken } from "@/lib/public-session";
import { kioskSessionIdle } from "@/lib/kiosk";

export function getVisitorToken(request: Request) {
  return readVisitorToken(request);
}

export async function resolveVisitorSession(eventSlug: string, request: Request) {
  const token = getVisitorToken(request);
  if (!token || !process.env.DATABASE_URL) return null;

  const session = await prisma.visitorSession.findFirst({
    where: {
      publicTokenHash: hashVisitorToken(token),
      deletedAt: null,
      expiresAt: { gt: new Date() },
      event: { slug: eventSlug },
    },
    include: {
      event: true,
      preferences: true,
      guestProfile: { select: { id: true, visitedKeys: true, visitCount: true } },
      visitor: { select: { id: true, visitedKeys: true } },
      kioskDevice: { select: { id: true, nodeKey: true, revokedAt: true } },
    },
  });
  if (!session || session.channel !== "kiosk") return session;
  // Audit 5.2: a kiosk visit ends after a minute idle or when its screen is revoked, and is never
  // picked up again by the next person at the screen.
  const now = new Date();
  if (!session.kioskDevice || session.kioskDevice.revokedAt || kioskSessionIdle(session.lastSeenAt, now)) {
    await prisma.visitorSession.updateMany({ where: { id: session.id, deletedAt: null }, data: { deletedAt: now } });
    return null;
  }
  await prisma.$transaction([
    prisma.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: now } }),
    prisma.kioskDevice.update({ where: { id: session.kioskDevice.id }, data: { lastSeenAt: now } }),
  ]);
  return { ...session, lastSeenAt: now };
}
