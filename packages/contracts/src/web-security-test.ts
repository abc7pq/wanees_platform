import assert from "node:assert/strict";
import { contentSecurityPolicy, createNonce, isForeignStateChange, parseAllowedOrigins, requestOrigin } from "./web-security.ts";

const h = (values: Record<string, string>) => new Headers(values);
const url = "http://127.0.0.1:3100/api/v1/events/x/assistant";

assert.equal(requestOrigin(h({ host: "127.0.0.1:3100" }), url), "http://127.0.0.1:3100");
assert.equal(requestOrigin(h({ host: "127.0.0.1:3100", "x-forwarded-proto": "https", "x-forwarded-host": "wanees.win" }), url), "https://wanees.win");

// Same origin, no origin (native, kiosk, webhook) and reads pass.
assert.equal(isForeignStateChange("POST", h({ host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }), url), false);
assert.equal(isForeignStateChange("POST", h({ host: "127.0.0.1:3100" }), url), false);
assert.equal(isForeignStateChange("GET", h({ host: "127.0.0.1:3100", origin: "https://attacker.example" }), url), false);
assert.equal(isForeignStateChange("POST", h({ host: "localhost:3100", origin: "http://LOCALHOST:3100" }), "http://localhost:3100/api"), false);
// Behind Caddy.
assert.equal(isForeignStateChange("PATCH", h({ host: "127.0.0.1:3100", "x-forwarded-proto": "https", "x-forwarded-host": "wanees.win", origin: "https://wanees.win" }), url), false);

// Foreign origins, "null" and cross-site fetch metadata are refused.
for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
  assert.equal(isForeignStateChange(method, h({ host: "127.0.0.1:3100", origin: "https://attacker.example" }), url), true, method);
}
assert.equal(isForeignStateChange("POST", h({ host: "127.0.0.1:3100", origin: "null" }), url), true);
assert.equal(isForeignStateChange("POST", h({ host: "127.0.0.1:3100", "sec-fetch-site": "cross-site" }), url), true);
assert.equal(isForeignStateChange("POST", h({ host: "127.0.0.1:3100", origin: "http://127.0.0.1:3101" }), url), true, "another port is another origin");

// A deployment can trust extra origins.
const allowed = parseAllowedOrigins(" https://app.wanees.win/ , https://partner.example ");
assert.deepEqual(allowed, ["https://app.wanees.win/", "https://partner.example"]);
assert.equal(isForeignStateChange("POST", h({ host: "127.0.0.1:3100", origin: "https://app.wanees.win" }), url, allowed), false);

const nonce = createNonce();
assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
assert.notEqual(nonce, createNonce());
const csp = contentSecurityPolicy(nonce);
// A plain substring: a base64 nonce can hold "+" and "/", which a regex built from it would misread.
assert.ok(csp.startsWith(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic';`), csp);
assert.ok(!csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"));
assert.match(csp, /frame-ancestors 'none'/);
assert.match(contentSecurityPolicy(nonce, { development: true }), /'unsafe-eval'/);

console.log("web security ok");
