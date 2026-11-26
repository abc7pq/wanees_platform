import { isIP } from "node:net";

/**
 * Client address resolution for rate limiting.
 *
 * Next.js (`next start`) only fills `x-forwarded-for` from the socket when the
 * header is absent (`??=`), so any value a client sends reaches the route
 * handler untouched. A header is therefore trusted only as far as operators
 * declare reverse proxies in front of the app:
 *
 * - `trustedHops = 0` (default): forwarded headers are ignored entirely and every
 *   caller shares the `direct` address. Safe, but coarse: use only for local runs
 *   or when the app is not reachable through a proxy.
 * - `trustedHops = N`: each trusted proxy appends the peer it saw, so the client
 *   is the N-th entry from the right. Entries further left were written by the
 *   client and are never used. The app must not be reachable except through
 *   those proxies.
 *
 * `x-real-ip` is never read: a proxy that does not overwrite it passes the
 * client's value through unchanged.
 */

export const MAX_TRUSTED_PROXY_HOPS = 5;

export const DIRECT_ADDRESS = "direct";
export const SHORT_CHAIN_ADDRESS = "unverified-chain";
export const INVALID_ADDRESS = "invalid-address";

export function parseTrustedProxyHops(raw: string | undefined | null): number {
  if (raw == null || raw.trim() === "") return 0;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0 || value > MAX_TRUSTED_PROXY_HOPS) return 0;
  return value;
}

function normalizeAddress(candidate: string): string | null {
  let value = candidate.trim();
  // "[2001:db8::1]:443" or "203.0.113.7:51234" forms written by some proxies.
  const bracketed = value.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) value = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  if (!isIP(value)) return null;
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return (mapped ? mapped[1] : value).toLowerCase();
}

export function resolveClientAddress(headers: Headers, trustedHops: number): string {
  if (!Number.isInteger(trustedHops) || trustedHops <= 0) return DIRECT_ADDRESS;
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (chain.length < trustedHops) return SHORT_CHAIN_ADDRESS;
  return normalizeAddress(chain[chain.length - trustedHops]) ?? INVALID_ADDRESS;
}
