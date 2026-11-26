import { createHash, randomBytes } from "node:crypto";

export const VISITOR_COOKIE = "wanees_visitor_session";
export const VISITOR_SESSION_TTL_SECONDS = 24 * 60 * 60;

export function createVisitorToken() {
  return randomBytes(32).toString("base64url");
}

export function hashVisitorToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readVisitorToken(request: Request) {
  const header = request.headers.get("x-wanees-session-token");
  if (header?.trim()) return header.trim();
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function setVisitorCookie(response: Response, token: string, expiresAt: Date) {
  response.headers.append(
    "Set-Cookie",
    `${VISITOR_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return response;
}

export function clearVisitorCookie(response: Response) {
  response.headers.append(
    "Set-Cookie",
    `${VISITOR_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return response;
}
