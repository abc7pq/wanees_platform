> **Current implementation direction (2026-11-20):** The complete Web App is now the active target. PostgreSQL is required in Phase 1 for organizer, event, catalog, session, itinerary, live-update, audit, and aggregated analytics data. JSON remains an import/export and seed format. The canonical build sequence is in [docs/MASTER_BUILD_PLAN.md](MASTER_BUILD_PLAN.md), and the database design is in [docs/DATABASE_SCHEMA.md](DATABASE_SCHEMA.md). This document remains the product/platform baseline.

# WANEES Platform Plan
## Reusable event and festival guide — Boulevard World is the first demo

**Status:** Product direction approved by the project owner on 2026-11-20. This is a phased target, not a claim that every capability exists today.

## 1. Product goal

Build one Arabic-first visitor guide that can be configured for different events and festivals. Each event supplies its own validated activities, zones, schedules, prices, and operating context; the shared route engine and assistant adapt to that catalog. Boulevard World remains the first demonstration dataset and must continue working during the migration.

The visitor can use text and voice. Voice (2026-11-26 status) is a live OpenAI Realtime call over WebRTC, available whenever `OPENAI_API_KEY` is set and `WANEES_FEATURE_LLM_ADAPTER` is on (`realtimeAvailable()` in `app/lib/realtime-session.ts`), with a browser speech fallback. The route engine remains deterministic; an LLM may interpret and explain requests but must not invent venue facts or compute schedules.

## 2. Verified baseline and limits

- Visitor app and organizer app are separate Next.js applications; the route engine is TypeScript and PostgreSQL is the durable Phase 1 source of truth. JSON remains seed/import/export material, and the legacy JSON-file organizer editor is retired.
- Visitor sessions select an explicit event route, pin the published catalog version, and enforce organization/event scope. Boulevard World and the seeded sample festival are exercised as separate events; `/demo` retains a compatibility fallback only for the historical showcase route.
- The full Web App now persists organizer, event, catalog, itinerary, live-update, audit, and aggregated analytics records in PostgreSQL. Visitor identity remains pseudonymous and event-scoped, with cookie/Bearer auth, expiry, cleanup, and deletion.
- Typed chat now supports grounded location/search, itinerary build/add/remove/swap/shorten, explanation, and human-help handoff paths. It remains deliberately bounded rather than unrestricted question-answering; unsupported or ambiguous requests must not alter a route.
- The LLM key is optional. Without it the assistant answers deterministically from the catalog and voice is unavailable. With it, text chat uses the OpenAI Responses API and voice uses OpenAI Realtime (see `docs/privacy/llm-data-flow.md`).
- Crowd values are simulated. Operational “impact” figures are not field measurements; do not present generated reductions as observed results.
- Weather is live from Open-Meteo (`app/lib/live-weather.ts`, refreshed every 10 minutes in the visitor UI). The `WeatherSource` port and deterministic stub (`app/engine/weather.ts`) remain the fallback; when the feed is unreachable the UI labels the value as an estimate.

## 3. Target domain model

Use explicit, stable identifiers and keep catalog versions immutable once published:

- **Tenant/Organizer** — the operator that owns event configurations.
- **Venue** — the physical site and its stable zones/layout.
- **Event occurrence** — a dated event at a venue, with timezone, opening hours, status, and its own published catalog version.
- **Catalog version** — validated activities, zones, schedules, prices, routing constraints, and clearly labelled simulated operational inputs.
- **Visitor session** — cryptographically random pseudonymous ID, event ID, pinned catalog-version ID, profile needed for this visit, expiry, and consent state.
- **Preference profile** — optional, structured and pseudonymous; saved only after opt-in, scoped to one event/organizer by default, and deletable.
- **Catalog change record** — operator, event, version, validation/publish result, and timestamp; never include visitor profile or conversation content.
- **Aggregated session metrics** — event-scoped counts needed for operations; do not put session IDs or profile fields in analytics labels/logs.

Every session lookup, event API, catalog read, and operator write must resolve within the authorized tenant/event scope. Never accept a client-provided filesystem path or catalog filename.

## 4. Customer-data decision and privacy boundary

The project owner selected: *opt-in pseudonymous preferences plus minimal event/session metrics, with deletion; no raw voice audio or full transcript retention by default.* Cross-event identity was not selected, so isolate memory by organizer/event and do not join visitors across unrelated events.

The current implementation defines session expiry/deletion, scheduled cleanup, redacted expiring conversation turns, safe structured logs, encrypted backup/restore rehearsal, and optional required off-host replication. Visitor records remain minimal and event-scoped; raw audio and full transcripts remain off by default. Do not collect phone numbers, names, precise location, accessibility/health details, raw audio, or full transcripts by default.

See `docs/decisions/ADR-001-event-scoped-customer-data-and-multi-event-catalog-model.md` for the decision record.

## 5. Assistant and voice contract

### Text

Keep the current text path working without a provider. Expand it in small tested slices: intent parsing → validated tool call → deterministic route change → truthful Arabic explanation. Unsupported or ambiguous requests must ask a clarifying question, not silently alter the first future stop. Add an activity only when the event catalog contains a valid matching activity and the scheduler can place it.

### Voice (implemented 2026-11; original plan kept below for reference)

Shipped: OpenAI Realtime over WebRTC with a two-minute ephemeral key; the voice model reaches event facts only through the `ask_wanees_engine` tool, and a proposal is accepted only after explicit spoken consent. Raw audio is streamed to OpenAI and is not stored by WANEES servers.

The browser call mode shipped separately from a dedicated audio provider. It requires an explicit start with a notice about automatic turn submission. The browser sends the finalized transcript through existing chat, and visitors can hang up or switch to typing any time.

Use a same-origin server adapter. Request microphone access only after user action and notice; transcribe to Arabic text; show an editable transcript; only explicit submit calls the existing chat path. Keep provider credentials server-side. Typed chat must remain available if permission is denied, audio is unsupported, or the API fails. Do not store raw audio or transcripts by default.

Before integration, obtain the API documentation: endpoint/method, auth mechanism (never send secret values in chat), Arabic/Saudi support, audio MIME/codecs/sample rate/max duration, request and response schemas, error/rate limits, streaming/token support, transcript and audio retention/training policy, and TTS requirements if spoken replies are wanted.

## 6. Incremental roadmap and acceptance tests

### Stage 0 — Boulevard demo reliability

- Fix UI/UX and accessibility defects; retain Arabic RTL and the five-question quick-start.
- Add API-contract tests for session creation, profile validation, chat actions, unknown intents, and failed requests.
- Remove inaccurate claims (for example, unsupported “add” commands or unmeasured impact).
- Acceptance: onboarding → route → text modification works on mobile and desktop; unknown target never changes a different stop; engine/API tests and production build pass.

### Stage 1 — Event-aware catalogs with PostgreSQL and JSON import/export

- Add catalog schema/version and validate unique IDs, zone references, schedules, ranges, and required metadata.
- Replace global `active` lookup with explicit event selection resolved from a safe event link/QR or selector; pin each session to the selected catalog version.
- Admin can draft, validate, preview, publish, and roll back a catalog version. Existing sessions remain pinned to their original version.
- Acceptance: two events can run concurrently with different catalogs; cross-event session/catalog access fails closed; invalid catalogs never replace the published version; current Boulevard links remain compatible.

### Stage 2 — Operator and event administration

- Scope every admin operation to an authenticated tenant and event; the current single-token demo is not multi-tenant authorization.
- Record catalog publish history and support rollback/export.
- Acceptance: unauthorized and wrong-tenant writes fail; stale edits are rejected; published version is reproducible from its source.

### Stage 3 — Opt-in pseudonymous preferences

- Decide retention first; then add explicit consent, view/delete controls, expiry jobs, and event-scoped storage.
- Keep raw conversation/audio storage off. Any future transcript retention requires a separate decision and opt-in.
- Acceptance: consent is recorded, no profile persists without opt-in, deletion removes primary records, and logs/exports contain no session ID or transcript.

### Stage 4 — Voice after API handoff (done: OpenAI Realtime)

- Implement provider adapter and mocked contract tests before connecting real credentials.
- Acceptance: microphone starts only by user action; editable transcript is shown; only submit invokes chat; provider failure preserves typed chat; no provider secrets reach the browser.

### Stage 5 — Broader specialist agent

- Add grounded tools for event information, route construction, schedule lookup, and catalog-safe activity insertion.
- Use only the selected event’s catalog as evidence; return an explicit “not found”/clarification when information is absent.
- Acceptance: supported questions cite the event catalog record; unsupported and near-match questions abstain; route-affecting actions are validated by the deterministic engine.

## 7. Delivery discipline

Each vertical slice is isolated on a branch, tested first, reviewed, committed, pushed, and verified from GitHub before it is called complete. Do not stage another worker’s or another task’s dirty files. A PR stays open until its CI checks pass; do not merge failing or unverified changes.

## 8. Open decisions

- Durable retention duration for opted-in pseudonymous preferences and session metrics.
- Whether visitors may opt into preference sharing across events operated by the same organizer; cross-organizer sharing remains off by default.
- ~~Voice/STT/TTS provider~~ — resolved: OpenAI Realtime (2026-11).
- ~~Weather provider~~ — resolved: Open-Meteo (2026-11).
- When measured concurrency justifies adding Redis or a separate search service; PostgreSQL is required for the full Web App from Phase 1.
