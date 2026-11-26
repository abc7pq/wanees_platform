// Scheduler hook for lock-screen nudges: an external cron (every minute) calls this with
// `Authorization: Bearer $WANEES_PUSH_DISPATCH_TOKEN`. Without a configured token the route does not exist.
import { timingSafeEqual } from "node:crypto";
import { jsonData, jsonError } from "@/lib/api-response";
import { dispatchPushNudges } from "@/lib/push-dispatch";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.WANEES_PUSH_DISPATCH_TOKEN?.trim();
  if (!expected || expected.length < 24) return null;
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const allowed = authorized(request);
  if (allowed === null) return jsonError(request, "NOT_FOUND", "Not found.", 404);
  if (!allowed) return jsonError(request, "UNAUTHORIZED", "Invalid dispatch token.", 401);
  const summary = await dispatchPushNudges();
  const response = jsonData(request, summary, { persistence: "postgresql" });
  response.headers.set("cache-control", "no-store");
  return response;
}
