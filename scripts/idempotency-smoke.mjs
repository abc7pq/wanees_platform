import { randomUUID } from "node:crypto";
import { Client } from "pg";

const baseUrl = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://wanees:wanees_dev@localhost:5432/wanees?schema=public";
const eventSlug = "boulevard-world-demo";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function call(path, { method = "GET", token, key, body } = {}) {
  const headers = {};
  if (token) headers["x-wanees-session-token"] = token;
  if (key) headers["idempotency-key"] = key;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, headers: response.headers, json };
}

for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    const health = await fetch(`${baseUrl}/api/health`);
    if (health.ok) break;
  } catch {
    // keep waiting for the app
  }
  if (attempt === 29) throw new Error(`visitor app at ${baseUrl} did not become ready`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const session = await call(`/api/v1/events/${eventSlug}/session`, {
  method: "POST",
  body: { clientType: "native", locale: "ar-SA" },
});
assert(session.status === 201, `POST /session returned ${session.status}`);
const token = session.json.data.token;
const sessionId = session.json.data.sessionId;

const schema = new URL(databaseUrl).searchParams.get("schema");
const db = new Client({ connectionString: databaseUrl, ...(schema && schema !== "public" ? { options: `-c search_path=${schema}` } : {}) });
await db.connect();

async function countItineraries() {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM "Itinerary" WHERE "sessionId" = $1', [sessionId]);
  return rows[0].n;
}

try {
  // POST /itinerary: same key + same body must create one row and replay the first response.
  const itineraryKey = randomUUID();
  const itineraryBody = { preferences: { mood: "family", availableMinutes: 90 } };
  const firstPlan = await call(`/api/v1/events/${eventSlug}/itinerary`, {
    method: "POST",
    token,
    key: itineraryKey,
    body: itineraryBody,
  });
  assert(firstPlan.status === 201, `first POST /itinerary returned ${firstPlan.status}`);
  const rowsAfterFirst = await countItineraries();
  assert(rowsAfterFirst === 1, `first POST /itinerary created ${rowsAfterFirst} rows, expected 1`);

  const replayPlan = await call(`/api/v1/events/${eventSlug}/itinerary`, {
    method: "POST",
    token,
    key: itineraryKey,
    body: itineraryBody,
  });
  assert(replayPlan.status === 201, `replayed POST /itinerary returned ${replayPlan.status}`);
  assert(
    replayPlan.json.data.itineraryId === firstPlan.json.data.itineraryId,
    "replay did not return the original itineraryId",
  );
  assert(replayPlan.headers.get("idempotent-replay") === "true", "replay is missing Idempotent-Replay: true");
  const rowsAfterRetry = await countItineraries();
  assert(rowsAfterRetry === 1, `retried POST /itinerary created ${rowsAfterRetry} rows, expected 1`);

  // POST /itinerary/replan: same key + same body must replay and add no proposal/decision rows.
  const replanKey = randomUUID();
  const replanBody = { decision: "preview" };
  const firstReplan = await call(`/api/v1/events/${eventSlug}/itinerary/replan`, {
    method: "POST",
    token,
    key: replanKey,
    body: replanBody,
  });
  assert(firstReplan.status === 200, `first POST /itinerary/replan returned ${firstReplan.status}`);
  const rowsAfterFirstReplan = await countItineraries();

  const replayReplan = await call(`/api/v1/events/${eventSlug}/itinerary/replan`, {
    method: "POST",
    token,
    key: replanKey,
    body: replanBody,
  });
  assert(replayReplan.status === 200, `replayed POST /itinerary/replan returned ${replayReplan.status}`);
  assert(replayReplan.headers.get("idempotent-replay") === "true", "replan replay is missing Idempotent-Replay: true");
  assert(
    firstReplan.json.data.mode === replayReplan.json.data.mode &&
      firstReplan.json.data.proposalId === replayReplan.json.data.proposalId,
    "replan replay did not return the original mode/proposalId",
  );
  const rowsAfterReplanRetry = await countItineraries();
  assert(
    rowsAfterReplanRetry === rowsAfterFirstReplan,
    `retried POST /itinerary/replan created rows: ${rowsAfterFirstReplan} -> ${rowsAfterReplanRetry}`,
  );

  console.log("idempotency smoke: replay returned the original result and created no duplicate rows");
} finally {
  await call(`/api/v1/events/${eventSlug}/session`, { method: "DELETE", token }).catch(() => {});
  await db.end();
}
