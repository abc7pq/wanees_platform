import { prisma } from "@/lib/db";
import { hashVisitorToken, readVisitorToken } from "@/lib/public-session";

export function getVisitorToken(request: Request) {
  return readVisitorToken(request);
}

export async function resolveVisitorSession(eventSlug: string, request: Request) {
  const token = getVisitorToken(request);
  if (!token || !process.env.DATABASE_URL) return null;

  return prisma.visitorSession.findFirst({
    where: {
      publicTokenHash: hashVisitorToken(token),
      deletedAt: null,
      expiresAt: { gt: new Date() },
      event: { slug: eventSlug },
    },
    include: { event: true, preferences: true, guestProfile: { select: { id: true, visitedKeys: true } } },
  });
}
