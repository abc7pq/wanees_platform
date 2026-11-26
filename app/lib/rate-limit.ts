import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { parseTrustedProxyHops, resolveClientAddress } from "@wanees/engine/client-address";

type RateLimitOptions = { scope: string; limit: number; windowMs?: number };
type MemoryBucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, MemoryBucket>();
let memoryCleanupAt = 0;

let warnedDirect = false;

/**
 * Bucket identity is the resolved client address only. Values the client picks
 * (forwarded entries beyond the trusted proxies, session tokens, cookies) must
 * not reach the key, or rotating them yields a fresh bucket per request. Routes
 * that need per-visitor limits put the verified session id in `scope`.
 */
function identity(request: Request) {
  const hops = parseTrustedProxyHops(process.env.WANEES_TRUSTED_PROXY_HOPS);
  if (hops === 0 && process.env.NODE_ENV === "production" && !warnedDirect) {
    warnedDirect = true;
    console.warn(JSON.stringify({ level: "warn", logger: "wanees.rate-limit", event: "trusted_proxy_hops_unset" }));
  }
  const address = resolveClientAddress(request.headers, hops);
  const salt = process.env.WANEES_RATE_LIMIT_SALT ?? "wanees-development-rate-salt";
  return createHash("sha256").update(`${salt}:${address}`).digest("hex").slice(0, 32);
}

function memoryCheck(key: string, limit: number, windowMs: number, now: number) {
  if (now > memoryCleanupAt) {
    memoryCleanupAt = now + 60_000;
    for (const [bucketKey, bucket] of memoryBuckets) if (bucket.resetAt <= now) memoryBuckets.delete(bucketKey);
  }
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}

export async function enforceRateLimit(request: Request, options: RateLimitOptions) {
  const windowMs = options.windowMs ?? 60_000;
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${options.scope}:${identity(request)}:${windowStart}`;

  if (!process.env.DATABASE_URL) return memoryCheck(key, options.limit, windowMs, now);

  try {
    const expiresAt = new Date(windowStart + windowMs * 2);
    let row = await prisma.rateLimitBucket.findUnique({ where: { bucketKey: key } });
    if (!row) {
      try {
        row = await prisma.rateLimitBucket.create({ data: { bucketKey: key, windowStart: new Date(windowStart), expiresAt, count: 1 } });
        // The insert already counted this request; incrementing again made the effective limit `limit - 1`.
        return { allowed: true, retryAfterSeconds: Math.max(1, Math.ceil((row.expiresAt.getTime() - now) / 1000)) };
      } catch {
        row = await prisma.rateLimitBucket.findUnique({ where: { bucketKey: key } });
      }
    }
    if (!row) return memoryCheck(key, options.limit, windowMs, now);
    if (row.count >= options.limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((row.expiresAt.getTime() - now) / 1000)) };
    }
    const updated = await prisma.rateLimitBucket.update({ where: { bucketKey: key }, data: { count: { increment: 1 } } });
    return { allowed: updated.count <= options.limit, retryAfterSeconds: Math.max(1, Math.ceil((updated.expiresAt.getTime() - now) / 1000)) };
  } catch {
    return memoryCheck(key, options.limit, windowMs, now);
  }
}
