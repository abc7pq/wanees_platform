// Request hardening shared by the visitor and organizer apps (audit 6.3). Pure: no framework, no env.

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type HeaderReader = { get(name: string): string | null };

/** The origin this request was sent to, as the browser saw it (behind Caddy: X-Forwarded-Proto/Host). */
export function requestOrigin(headers: HeaderReader, requestUrl: string) {
  const url = new URL(requestUrl);
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host") || url.host;
  return `${proto}://${host}`.toLowerCase();
}

/**
 * A browser request that changes state from another site. Native apps, kiosks, phone webhooks and
 * server-to-server calls send no Origin and pass; a browser always sends Origin on these methods.
 * `allowedOrigins` lists extra origins a deployment trusts (WANEES_ALLOWED_ORIGINS).
 */
export function isForeignStateChange(method: string, headers: HeaderReader, requestUrl: string, allowedOrigins: readonly string[] = []) {
  if (!STATE_CHANGING.has(method.toUpperCase())) return false;
  if (headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return true;
  const origin = headers.get("origin")?.trim().toLowerCase();
  if (!origin) return false;
  if (origin === requestOrigin(headers, requestUrl)) return false;
  return !allowedOrigins.some((allowed) => allowed.trim().toLowerCase().replace(/\/+$/, "") === origin);
}

export function parseAllowedOrigins(value: string | undefined) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

/** A fresh base64 nonce for one response. */
export function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Scripts run only when they carry this response's nonce (Next adds it to its own scripts) or were
 * loaded by such a script ('strict-dynamic'). Development needs 'unsafe-eval' for fast refresh.
 */
export function contentSecurityPolicy(nonce: string, options: { development?: boolean } = {}) {
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.development ? " 'unsafe-eval'" : ""}`,
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
