# WANEES API contract

OpenAPI 3.1 contract and conformance suite for the visitor API. The contract is maintained
in this repository and is verified against the running local stack on port 3100.

## Contents

| File | What it is |
|---|---|
| `openapi.yaml` | OpenAPI 3.1 contract for all 19 operations across 14 paths. |
| `validate.js` | Structural validator: parses the YAML, resolves every `$ref`, checks required/property consistency. |
| `contract-test.ps1` | Live conformance suite: envelope, auth failures, validation failures, every v1 endpoint, and `Idempotency-Key` replay. Cross-platform (Windows PowerShell or `pwsh` on Linux/macOS). |
| `../../scripts/http-smoke.mjs` | Wider end-to-end flow (visitor + admin) used by CI. |

Both checks run in GitHub Actions: `validate.js` in the `contract` job, `contract-test.ps1` in
`visitor-integration` against the seeded stack. A route change that breaks a documented field now
fails the build.

## Verification

* `npm run test:contract` → 14 paths, 19 operations, 39 schemas,
  48 refs, **0 unresolved refs, 0 consistency problems**.
* On 2026-11-23 (Asia/Riyadh), `contract-test.ps1` against `http://127.0.0.1:3100` passed
  all 36 checks, including:
  * success envelope `{data, meta}` with `contractVersion: v1` and an echoed `requestId`
  * `401 SESSION_TOKEN_REQUIRED` with no token
  * `400 INVALID_REQUEST` for an out-of-enum `clientType`
  * `201` + full `ItineraryResponse` / `Itinerary` / `Stop` field coverage
  * idempotent `POST /itinerary`: two calls with the same key and body return the same
    `itineraryId`, the second sets `Idempotent-Replay: true`, and a different body under the
    same key returns `409 IDEMPOTENCY_KEY_REUSED`
  * `LiveState`, `MapResponse`, `AssistantResponse`, `ReplanResponse` (mode inside the declared enum)
  * idempotent `POST /itinerary/replan`: the same key replays the same mode and proposal
  * `202` analytics acknowledgement
  * session deletion, and reuse of the deleted token rejected
* `npm run test:idempotency` → replay returned the original result and created no duplicate rows.

## Idempotency

`POST /itinerary` and `POST /itinerary/replan` accept an optional `Idempotency-Key` header
(1–200 printable ASCII characters, no spaces).

* The first request reserves `(sessionId, key)` under a unique index, performs the write, and
  stores the full `{data, meta}` response for 24 hours.
* A retry with the same key and the same body replays that response with
  `Idempotent-Replay: true` and the original status code; no second itinerary, proposal or
  decision is written.
* The same key with a different body returns `409 IDEMPOTENCY_KEY_REUSED`.
* A retry while the first request is still running returns `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`
  with `retry-after`; a reservation older than 30 seconds is treated as abandoned and taken over.
* Errors raised before any write release the reservation, so a corrected retry can reuse the key.

Implementation: `app/lib/idempotency.ts`, table `IdempotencyRecord`
(migration `20261121140000_idempotency_keys`).

### Idempotency coverage

The visitor itinerary/replan mutations, visitor session creation, and organizer
update/incentive mutations now use event-scoped idempotency records. Retries with
the same request hash replay the original result; a different body under the same
key returns `409 IDEMPOTENCY_KEY_REUSED`. This is covered by the idempotency smoke
flow and the organizer mutation tests. The request key is optional for backwards
compatibility, so clients should send one for every network-retryable mutation.

The legacy JSON demo mutations are intentionally outside this contract. They are
compatibility-only and are not used by `/events/:eventSlug`.

## Measured latency baseline

Environment: localhost, `next dev` on 127.0.0.1:3100, PostgreSQL on 127.0.0.1:5432, single
sequential client via curl (no concurrency, no TLS, warm process). Timings are wall-clock from
the client and include local HTTP overhead of roughly 1–3 ms.

Full run, 15 iterations per endpoint:

| endpoint | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| POST /session | 15 | 24.8 | 34.3 | 34.3 |
| GET /map | 15 | 18.3 | 27.6 | 27.6 |
| GET /live | 15 | 22.0 | 38.2 | 38.2 |
| POST /itinerary | 15 | 45.0 | 60.7 | 60.7 |
| GET /itinerary | 15 | 23.2 | 39.6 | 39.6 |
| POST /assistant | 15 | 30.9 | 55.2 | 55.2 |
| POST /itinerary/replan | 15 | 28.2 | 39.8 | 39.8 |

Read paths, 50 samples each:

| endpoint | n | p50 ms | p90 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|
| GET /map | 50 | 21.3 | 28.7 | 29.7 | 35.6 |
| GET /live | 50 | 24.9 | 36.5 | 40.4 | 43.5 |
| GET /health | 50 | 4.9 | 6.5 | 6.8 | 21.5 |

All requests returned 2xx; there were no error responses outside the deliberate negative-path
assertions.

**Variance worth knowing.** An earlier 15-sample run against a different server instance showed
p95 of 202 ms (`session.create`), 233 ms (`live.get`) and 241 ms (`replan.post`) driven by single
outliers. Those figures did not reproduce on a freshly started server. 15 sequential samples
cannot characterise a tail.

Against the stated targets: **API p95 under 200 ms is met for every endpoint in this measurement,
sequentially, on loopback.** The bounded concurrent smoke passes its 1.5-second regression
budget, but behavior at 10× load or with production-size data is not demonstrated. Treat these
figures as floors/regression signals, not guarantees.

Production-build concurrency smoke on 2026-11-23: 120 mixed requests at concurrency 12,
0 errors, p50 39 ms, p95 213 ms, p99 334 ms, max 372 ms. This passes the CI regression budget
of 1.5 seconds at p95; it is still a bounded smoke test, not a capacity or field-performance
claim.

## Contract decisions encoded in the spec

* One envelope: `{data, meta}` / `{error, meta}`; `meta.contractVersion` is always `v1`.
* Path versioning (`/api/v1/...`); additive fields allowed inside `data`, breaking changes need a
  new path version plus a deprecation window.
* Visitor identity: `x-wanees-session-token` header, `Authorization: Bearer`, or the
  `wanees_visitor_session` HttpOnly cookie — all three are accepted by the same resolver.
* Replan is a three-step optimistic flow: `preview` → `PROPOSED` with `proposalId` +
  `baseLiveRevision`, then `accept` or `keep_current`. Both return 409 `PROPOSAL_STALE` if the
  proposal was already accepted, dismissed or expired; `accept` also returns it if live state or
  the active itinerary moved. Another session's `proposalId` gets 404 `PROPOSAL_NOT_FOUND`.
  Proposals expire in 15 minutes; urgent closures apply immediately.
* `/live` is an explicit polling contract: `nextPollAfterMs` 10 s, `staleAfterMs` 45 s, `revision`
  as a content hash usable for cache validation and staleness detection.
* Rate limits are documented per operation and exposed via `retry-after`.

## Operational verification and boundaries

* `scripts/load-test.mjs` runs a concurrent production-build smoke test across
  health, live state, and the visitor shell. It fails when requests error or p95
  exceeds the configured budget; CI currently uses 120 requests, concurrency 12,
  and a 1.5-second p95 budget. This is a regression gate, not a capacity claim.
* Visitor contract routes and canonical organizer v1 requests emit safe structured
  start/complete lines with request ID, method, path, status, and latency.
  Tokens, cookies, bodies, and raw visitor text are not logged.
* Health checks verify both PostgreSQL reachability and the existence of at least
  one published event/catalog pointer. A missing catalog returns degraded/503.
* Rate limiting uses PostgreSQL-backed windows when the database is available;
  the in-memory fallback is a development/degraded-mode guard only. Horizontal
  production deployments must keep a shared PostgreSQL rate-limit store (and
  should add gateway limits) rather than relying on per-process memory.
* `/api/events/{slug}`, `/api/zones`, `/api/ops`, and `/api/tick` remain
  deprecated compatibility routes for `/demo`. The strict event route disables
  that fallback, and these routes can be removed in a later breaking release
  after downstream demo links have migrated.
* The former admin JSON-file `/venues` pages and `/api/venues` mutations are
  retired with HTTP 410; the canonical organizer surface is `/events` backed by
  PostgreSQL catalog versions.
* Encrypted backups can replicate to S3-compatible object storage when the
  `WANEES_BACKUP_S3_*` settings are configured. Production must set
  `WANEES_BACKUP_OFFSITE_REQUIRED=true`; the backup command fails if replication
  is unavailable. A real bucket and secret still require deployment-operator
  configuration and are never committed to Git.

## Reproduce

```powershell
# validate the document
npm run test:contract

# conformance against a running visitor app
powershell.exe -NoProfile -ExecutionPolicy Bypass -File docs/api/contract-test.ps1 -Base http://127.0.0.1:3100
# PowerShell 7 on Windows, Linux, or macOS: use pwsh instead
# pwsh -NoProfile -File docs/api/contract-test.ps1 -Base http://127.0.0.1:3100
```
