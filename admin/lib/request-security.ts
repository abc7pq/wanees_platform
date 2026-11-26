import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { parseTrustedProxyHops, resolveClientAddress } from "@wanees/engine/client-address";

type Bucket = { count: number; resetAt: number };
const memory = new Map<string, Bucket>();

let warnedDirect = false;

// Keyed on the resolved client address only: cookies and Authorization headers
// are client-chosen, so including them let a caller (e.g. on /api/login) rotate
// them to get a fresh bucket per attempt.
function keyFor(request: Request, scope: string, windowStart: number) {
  const hops = parseTrustedProxyHops(process.env.WANEES_TRUSTED_PROXY_HOPS);
  if (hops === 0 && process.env.NODE_ENV === "production" && !warnedDirect) {
    warnedDirect = true;
    console.warn(JSON.stringify({ level: "warn", logger: "wanees.rate-limit", event: "trusted_proxy_hops_unset" }));
  }
  const address = resolveClientAddress(request.headers, hops);
  const salt = process.env.WANEES_RATE_LIMIT_SALT ?? "wanees-development-rate-salt";
  const identity = createHash("sha256").update(`${salt}:${address}`).digest("hex").slice(0, 32);
  return `admin:${scope}:${identity}:${windowStart}`;
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || process.env.WANEES_ALLOW_CROSS_ORIGIN_ADMIN === "true") return true;
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return origin === `${forwardedProto}://${host}`;
}

export async function enforceAdminRateLimit(request: Request, scope: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const bucketKey = keyFor(request, scope, windowStart);
  if (!process.env.DATABASE_URL) {
    const bucket = memory.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      memory.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    }
    bucket.count += 1;
    return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  try {
    let row = await prisma.rateLimitBucket.findUnique({ where: { bucketKey } });
    if (!row) {
      try {
        row = await prisma.rateLimitBucket.create({ data: { bucketKey, windowStart: new Date(windowStart), expiresAt: new Date(windowStart + windowMs * 2), count: 1 } });
        // The insert already counted this request; incrementing again made the effective limit `limit - 1`.
        return { allowed: true, retryAfterSeconds: Math.max(1, Math.ceil((row.expiresAt.getTime() - now) / 1000)) };
      } catch {
        row = await prisma.rateLimitBucket.findUnique({ where: { bucketKey } });
      }
    }
    if (!row) return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    if (row.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((row.expiresAt.getTime() - now) / 1000)) };
    const updated = await prisma.rateLimitBucket.update({ where: { bucketKey }, data: { count: { increment: 1 } } });
    return { allowed: updated.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((updated.expiresAt.getTime() - now) / 1000)) };
  } catch {
    return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
}
