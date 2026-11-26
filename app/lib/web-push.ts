// Web Push for lock-screen nudges, built on node:crypto only (no extra dependency in the shared install).
//   - VAPID (RFC 8292): an ES256 JWT proves the push request comes from this server.
//   - Message encryption (RFC 8291 + RFC 8188 "aes128gcm"): only the visitor's browser can read the
//     payload. The push service (Google, Apple, Mozilla, Microsoft) sees ciphertext and an opaque endpoint.
//   - The server only POSTs to known push-service hosts, so a forged subscription cannot make it call
//     arbitrary URLs (SSRF).
import { createECDH, createCipheriv, createHash, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";

export type PushKeys = { p256dh: string; auth: string };
export type PushSubscriptionInput = { endpoint: string; keys: PushKeys };
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

const RECORD_SIZE = 4096;

export function b64url(value: Buffer | Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

export function fromB64url(value: string) {
  return Buffer.from(value, "base64url");
}

/** A fresh VAPID key pair: public = 65-byte uncompressed P-256 point, private = 32-byte scalar. */
/** getPrivateKey() drops leading zero bytes (1 key in 256); a P-256 private key is always 32 bytes. */
export function padPrivateKey(key: Buffer) {
  return key.length >= 32 ? key : Buffer.concat([Buffer.alloc(32 - key.length), key]);
}

export function generateVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(padPrivateKey(ecdh.getPrivateKey())) };
}

export function vapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = env.WANEES_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.WANEES_VAPID_PRIVATE_KEY?.trim();
  const subject = env.WANEES_VAPID_SUBJECT?.trim() || "mailto:push@wanees.invalid";
  if (!publicKey || !privateKey) return null;
  if (fromB64url(publicKey).length !== 65 || fromB64url(privateKey).length !== 32) return null;
  return { publicKey, privateKey, subject };
}

function signingKey(vapid: VapidConfig) {
  const point = fromB64url(vapid.publicKey);
  return createPrivateKey({
    format: "jwk",
    key: { kty: "EC", crv: "P-256", d: vapid.privateKey, x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33, 65)) },
  });
}

/** `Authorization: vapid t=<jwt>, k=<public key>` for one push-service origin. */
export function vapidAuthorization(endpoint: string, vapid: VapidConfig, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // RFC 8292: exp no more than 24 h ahead; 12 h leaves room for clock skew.
  const claims = b64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: vapid.subject })));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: signingKey(vapid), dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
}

function hmac(key: Buffer, data: Buffer) {
  return createHmac("sha256", key).update(data).digest();
}

/**
 * RFC 8291 payload encryption. `salt` and `serverKey` are injectable only so the RFC test vector can be
 * checked; production calls always use fresh random values.
 */
export function encryptPushPayload(plaintext: Buffer | string, keys: PushKeys, options: { salt?: Buffer; serverPrivateKey?: Buffer } = {}) {
  const uaPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error("invalid p256dh key");
  if (authSecret.length !== 16) throw new Error("invalid auth secret");
  const server = createECDH("prime256v1");
  if (options.serverPrivateKey) server.setPrivateKey(options.serverPrivateKey);
  else server.generateKeys();
  const asPublic = server.getPublicKey();
  const ecdhSecret = server.computeSecret(uaPublic);
  const salt = options.salt ?? randomBytes(16);

  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);

  const body = Buffer.concat([Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, "utf8"), Buffer.from([2])]);
  if (body.length + 16 > RECORD_SIZE) throw new Error("push payload too large");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, sealed]);
}

// ————— Which hosts the server may POST to —————

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
];

/**
 * True for an https endpoint on a known browser push service. `WANEES_PUSH_EXTRA_HOSTS`
 * (comma-separated host[:port]) adds hosts for a self-hosted or test push service; plain http is
 * accepted only for those extra hosts on loopback, never in production.
 */
export function isAllowedPushEndpoint(endpoint: string, env: Record<string, string | undefined> = process.env) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.username || url.password || endpoint.length > 1024) return false;
  const extra = (env.WANEES_PUSH_EXTRA_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (extra.includes(url.host.toLowerCase())) {
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }
  return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((pattern) => pattern.test(url.hostname.toLowerCase()));
}

export function endpointHash(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

// ————— Sending —————

export type PushResult = { ok: boolean; status: number; gone: boolean };

export async function sendWebPush(input: {
  subscription: PushSubscriptionInput;
  payload: string;
  vapid: VapidConfig;
  ttlSeconds: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  /** Same topic replaces an undelivered older message on the push service (≤32 URL-safe chars). */
  topic?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PushResult> {
  if (!isAllowedPushEndpoint(input.subscription.endpoint)) return { ok: false, status: 0, gone: true };
  const body = encryptPushPayload(input.payload, input.subscription.keys);
  const headers: Record<string, string> = {
    Authorization: vapidAuthorization(input.subscription.endpoint, input.vapid),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(Math.max(0, Math.round(input.ttlSeconds))),
    Urgency: input.urgency ?? "normal",
  };
  if (input.topic) headers.Topic = input.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  try {
    const response = await (input.fetchImpl ?? fetch)(input.subscription.endpoint, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs ?? 8_000),
    });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, gone: response.status === 404 || response.status === 410 };
  } catch {
    return { ok: false, status: 0, gone: false };
  }
}
