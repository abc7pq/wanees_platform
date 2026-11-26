# AGENTS.md — WANEES project operating guide

This file is the operating contract for AI coding agents and human contributors working on WANEES.

## 1. Read this first

Before changing code, read these documents in this order:

1. README.md
2. docs/AI_AGENT_CONTEXT.md
3. docs/MASTER_BUILD_PLAN.md
4. docs/DATABASE_SCHEMA.md
5. docs/PRODUCT_PLATFORM_PLAN.md
6. The relevant source files and tests


The master build plan is the canonical plan for the current product direction. Older hackathon-only plans are historical context unless the master plan explicitly refers to them. If the repository state and a document disagree, inspect the latest commit and update the document before making a risky architectural change.

## 2. Product direction

WANEES is being built as a complete, multi-event web application first.

Phase 1 is the web product:

- Arabic-first responsive visitor web app.
- Organizer web dashboard.
- PostgreSQL database.
- Shared API contracts in `packages/contracts/` consumed by both web surfaces.
- Event and catalog management.
- Versioned content publishing.
- Deterministic itinerary and replanning engine.
- Grounded AI assistant.
- Live crowd and event updates.
- Server-authoritative event clock and event-local time display.
- Temporary, expiring assistant context with no raw-message memory.
- Browser visitor sessions use an HttpOnly cookie; Bearer tokens remain available for native clients.
- Hybrid replanning: urgent closures apply immediately; crowd/delay changes require visitor choice.
- RouteNode-backed services/locations and graph-aware walking.
- Proposal concurrency uses live revisions, expiry, and transaction-checked acceptance.
- Sensitive visitor and operator endpoints use rate limits; expired session data is cleaned by `npm run db:cleanup`.
- Operational analytics.
- Authentication, roles, tenant isolation, audit history, tests, and deployment.

Phase 2 is a native mobile application that reuses the Phase 1 backend and APIs. Do not design Phase 1 around browser-only state or browser-only business logic. The web app is the first client, not the whole product architecture.

Boulevard World is the first event configuration and demo. It must remain working while the platform becomes reusable.

## 3. Core product rule

The computer calculates. The agent understands and explains. The visitor decides.

The LLM must never be the authority for:

- Event facts.
- Prices.
- Opening hours.
- Availability.
- Route geometry.
- Walking time.
- Crowd values.
- Itinerary feasibility.

Those values come from the selected event catalog, live event state, and deterministic domain services.

## 4. Repository baseline

The repository currently contains:

- app/ — visitor Next.js application.
- admin/ — organizer Next.js application.
- app/engine/ — deterministic TypeScript itinerary engine (`route.ts`, the planner).
- packages/engine/ — shared domain code: catalog loading, season coordinator, simulation, movement theater.
- app/data/ — existing Boulevard World catalog and venue data.
- data/ — source and normalized event material.
- docs/ — product, challenge, design, demo, and delivery documentation.
- .github/ — CI workflows.
- packages/contracts/ — shared response metadata, error codes, feature flags, and proposal types.

PostgreSQL is the system of record (docs/DATABASE_SCHEMA.md). Two things remain demo-only: the legacy in-memory `/api/session` fallback used by `/demo`, and crowd data from gates and counters, which is simulated and labelled as such until a venue provides real sensors.

Keep the existing demo route and current Boulevard World experience compatible until the new web flow is verified.

## 5. Target architecture decisions

The default target architecture is:

- Next.js and React for the web clients.
- TypeScript for the API, domain services, and shared contracts.
- PostgreSQL as the system of record.
- Prisma migrations and a typed database access layer unless a documented decision changes this.
- Zod or an equivalent runtime schema validator for every external input.
- A shared domain package used by both visitor and admin applications.
- Database-backed organizer authentication and role-based access control.
- Anonymous visitor sessions by default; no visitor account is required for the first visit.
- Object storage for maps and media; do not store large binary files in PostgreSQL.
- Polling or Server-Sent Events before introducing WebSockets.
- An LLM provider adapter with server-side credentials and deterministic fallbacks.
- Feature flags for staged rollout; new behavior must be reversible without a destructive migration.
- JSON import/export for event catalogs, not JSON as the long-term system of record.

Do not introduce a separate microservice, message broker, vector database, or native app before the master plan calls for it.

## 6. Data and privacy rules

Collect the minimum data needed for the event experience.

Default visitor policy:

- No name, phone number, or cross-event identity.
- Anonymous pseudonymous session identifier.
- Event-scoped preferences.
- Configurable retention.
- No raw audio retention.
- No full transcript retention by default.
- Do not persist new visitor chat text in browser storage; server-side turns remain redacted and expire after 24 hours.
- Aggregated operational metrics without session identifiers.
- Explicit consent before storing optional preferences beyond the active session.
- A deletion path for stored visitor data.

Optional exception: an organizer may turn on `WANEES_FEATURE_VISITOR_REGISTRATION` (off by default).
Then a visit requires a name, an SMS-verified mobile and explicit consent to a versioned notice. The record
is scoped to one organization, phone numbers are only shown masked, OTP codes are never stored, and
inactive visitors are deleted by `db:cleanup` (see docs/DATABASE_SCHEMA.md). Never make it the default.

Organizer and catalog data is durable product data and belongs in PostgreSQL. Every durable record must have the correct organization and event scope.

Never commit:

- Environment files.
- API keys.
- Passwords.
- Tokens.
- Private URLs that contain secrets.
- Raw customer exports.
- Unapproved copyrighted event assets.

## 7. AI agent behavior

A production assistant follows this sequence:

1. Resolve the event and published catalog version from the server-side session.
2. Detect the visitor intent.
3. Retrieve only relevant records from that event.
4. Call a typed domain tool when an action is required.
5. Validate the tool input.
6. Execute the deterministic domain operation.
7. Return a concise Arabic response with cards, reasons, and source references.
8. Abstain or hand off when the information is missing or outside scope.

Supported intents should be explicit:

- Build an itinerary.
- Ask about an activity, zone, service, or schedule.
- Find a location.
- Add a valid activity.
- Remove an itinerary item.
- Swap an item.
- Shorten the plan.
- Request a calmer, cheaper, closer, or less crowded option.
- Explain a recommendation.
- Report a problem or request human help.

Unknown or ambiguous intents must not silently change an itinerary.

Location questions must resolve against published `RouteNode` records and return a source-backed map card. They must not be answered from a model guess.

## 8. Coding workflow

For every vertical slice:

1. Inspect the current code and tests.
2. Create a focused branch.
3. Update schemas and migrations before using new fields.
4. Implement the domain logic before the UI integration.
5. Add unit and API contract tests.
6. Run formatting, tests, and production builds.
7. Verify mobile and RTL behavior.
8. Update the relevant documentation when a decision changes.
9. Commit with a clear message.
10. Push and verify CI before calling the slice complete.

The integration verification path is `npm run db:smoke` for the seeded PostgreSQL schema and `npm run test:http` for the running visitor HTTP flow. The latter verifies the browser cookie session, itinerary, assistant, live revision, replan, and deletion path.

Prefer small, reviewable changes. Do not rewrite the visitor app, admin app, or planner wholesale without a migration path.

## 9. Release workflow

Develop on a branch, run the checks in README.md ("Verify everything") locally,
and open a pull request. `main` is protected by CI: it runs the unit suites,
both production builds, the PostgreSQL schema, seed, backup and restore checks,
the HTTP and presentation-story flows, and the browser suite. Secrets live only
in ignored `.env` / `.env.local` files and in the hosting provider's secret
store; they never travel through Git.

## 10. Database workflow

Database changes require:

- A migration.
- Updated seed data.
- Updated runtime validation.
- Tests for the new constraint.
- A rollback or recovery note when the change is operationally significant.
- No direct production schema edits.
- No destructive migration without an explicit recovery plan.

Local development should work with a documented PostgreSQL setup. Seed data must create a Boulevard World event and a small second event used to prove multi-event isolation.

## 11. Definition of done

A feature is not complete because it renders.

It is complete only when:

- The API validates input.
- Authorization and event scope are enforced.
- The domain behavior is deterministic and tested.
- The UI has loading, empty, error, and offline-safe states.
- Arabic RTL is correct.
- The feature works on a narrow mobile viewport.
- Metrics do not expose private visitor data.
- The feature is documented.
- CI passes.
- The production build passes.
- Existing demo behavior has not regressed.

