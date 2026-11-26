# WANEES master build plan

## Status

This is the canonical build plan for the complete WANEES web application.

Owner direction:

- Build a complete web application first.
- Include the database, backend, admin dashboard, AI assistant, live operations, authentication, deployment, and tests.
- Use Boulevard World as the first event configuration and demo.
- Build a native mobile application only after the web product and API are stable.
- Keep all decisions and progress in GitHub.

The existing hackathon demo remains a valuable starting point. It is not the final product architecture.

## Latest implementation status — 2026-11-23

- Responsive visitor and organizer UI fixes are pushed to `main`; the visitor
  welcome/quiz flow uses desktop space while admin tables become labelled cards
  on narrow screens.
- Candidate CSV catalog import is available through
  `npm run catalog:import -- --csv <path> [--apply]`. It creates a draft-only,
  source-linked catalog and never changes the published catalog pointer.
- Catalog source review metadata is persisted for zones and activities. The
  validator blocks unreviewed/rejected imported content, missing route graph
  data, and activities without schedules.
- Owner/admin catalog rollback is implemented with an atomic event-pointer
  change and an audit log. Draft cloning remaps source references to the new
  source rows.
- Visitor and organizer API responses use the shared contract envelope and
  request metadata; organizer v1 routes are normalized through the same
  `packages/contracts` version as visitor routes. Safe structured request logs,
  concurrent load regression checks, and database-plus-published-catalog health
  probes are now part of the runtime verification path.
- Backups are encrypted locally and can be required to replicate to an
  S3-compatible off-host destination. Production still needs an operator to
  provision the bucket, lifecycle policy, and secret values; those deployment
  credentials are intentionally not part of this repository.
- The supplied Boulevard World CSV was applied locally as candidate draft v2;
  its 109 records and 33 raw zone labels remain review data, not verified live
  facts.

## Latest implementation status — 2026-11-20

The current hardening slice advances the product across visitor, operator, and
operations paths:

- Visitor onboarding uses the selected event catalog for name, moods, interests,
  and an optional start zone; the Boulevard-specific lagoon default is removed.
- The 2D map honors the public feature flag and falls back to an event-derived
  route-zone summary.
- Operators can read active and historical updates, revoke an update with an
  optional reason, and review the audit-preserved history. Revocation is
  idempotent and event-scoped; linked crowd snapshots stop affecting live state
  and replanning.
- Health routes are unauthenticated, sanitized readiness probes and report
  degraded state when PostgreSQL is missing/unreachable or no published catalog
  pointer exists.
- `db:backup` creates encrypted, owner-only PostgreSQL dumps with configurable
  retention (seven days by default). `db:restore-smoke` restores to a temporary
  database and verifies event/catalog rows. CI runs both on disposable data.
- Optional server-side Sentry setup strips request, user, extra, breadcrumb,
  tag, and exception-message data before sending stack frames. No browser replay
  or source-map upload is enabled.
- CI covers the seeded `sample-festival` catalog and visitor/admin update,
  revoke, history, live revision, crowd snapshot, and replan behavior.

The backup command supports required off-host encrypted replication through
S3-compatible object storage. The deployment must set
`WANEES_BACKUP_OFFSITE_REQUIRED=true` and provide the destination secrets before
the service is treated as protected from VPS/disk loss.

## Current implementation status — 2026-11-20

The current branch has completed the first improvement slice on top of the PostgreSQL foundation:

- Shared API metadata, error vocabulary, public feature flags, and PostgreSQL smoke coverage.
- Browser visitor sessions use an HttpOnly cookie while native clients may use Bearer tokens.
- Visitor/organizer sensitive mutation paths have bounded rate limits and same-origin protection for admin writes.
- Visitor chat is no longer newly persisted in `localStorage`; server turns remain redacted and expire after 24 hours.
- Live state has a stable revision; replan proposals carry a base itinerary, expiry, and stale-proposal protection.
- The visitor map is a reusable 2D component that renders open route graph edges and location accessibility cues.
- CI runs database smoke checks and a full visitor HTTP integration flow in addition to unit/build jobs.

Boulevard World remains the only product UAT event for this slice. The existing small isolation event remains a CI fixture. External crowd/ticket integrations and 3D maps are intentionally later phases.

## 1. Product definition

WANEES is a configurable event-experience platform.

For a visitor, WANEES:

- Understands a short conversation.
- Learns the needs of the current visit.
- Builds a practical itinerary.
- Explains why each stop was selected.
- Shows the route on a map.
- Answers event questions from trusted event content.
- Replans when time, crowd, availability, or preferences change.
- Suggests alternatives without forcing them.

For an organizer, WANEES:

- Provides an event catalog and map.
- Publishes approved event information.
- Receives visitor questions and operational signals.
- Sees demand by zone and activity.
- Finds missing or outdated information.
- Controls live event updates.
- Measures the visitor experience without collecting unnecessary personal data.

## 2. Product boundaries

### Phase 1: complete web application

The web application includes:

- Public event pages.
- Anonymous visitor sessions.
- Arabic-first RTL interface.
- English-ready content model.
- Organizer account and organization workspace.
- Role-based access control.
- Event, venue, zone, activity, schedule, map, and source management.
- Draft, validate, preview, publish, and rollback.
- Versioned catalogs.
- Deterministic itinerary engine.
- Grounded AI assistant.
- Map and route view.
- Crowd and event update model.
- Replanning.
- Operator dashboard.
- Aggregated analytics.
- Audit logs.
- PostgreSQL.
- Migrations and seed data.
- CI, deployment, health checks, and observability.

### Phase 2: native mobile application

The mobile application reuses:

- The same authentication model.
- The same event and catalog APIs.
- The same itinerary API.
- The same assistant tools.
- The same live event stream.
- The same database and privacy boundary.

The native app must not duplicate business logic or create a second source of truth.

## 3. Design principles

1. Web first, API first.
2. One event catalog powers the assistant, route engine, map, public pages, and analytics.
3. Published catalog versions are immutable.
4. The planner is deterministic and testable.
5. The LLM interprets and explains; domain services decide.
6. Every factual answer is grounded or explicitly unknown.
7. The visitor can use the product without creating an account.
8. Operator actions are authenticated, authorized, and audited.
9. Simulated operational data is labelled as simulated.
10. The experience should be useful before it is impressive.
11. The same user action must work through buttons and typed language.
12. Every feature must work on mobile and in Arabic RTL.

## 4. Users and roles

### Visitor

- Opens from a link, QR code, or public event page.
- Creates an anonymous event-scoped session.
- Gives temporary preferences.
- Receives and adjusts a plan.
- Can request human help.
- Can delete the active session.

### Organizer owner

- Manages the organization.
- Invites staff.
- Controls roles and settings.
- Manages events and billing-ready metadata later.

### Event admin

- Manages the event catalog.
- Publishes versions.
- Controls event state and public pages.

### Operator

- Updates live crowd, closures, and delays.
- Sees the operations dashboard.
- Cannot change organization security settings.

### Editor

- Edits catalog content and sources.
- Creates drafts.
- Cannot publish unless granted permission.

### Analyst

- Reads aggregated reports.
- Cannot access raw visitor content.

## 5. Target architecture

    Visitor browser
          |
          | HTTPS
          v
    Web application
      - Public event pages
      - Visitor itinerary UI
      - Assistant UI
      - Organizer dashboard
          |
          v
    Versioned API layer
      - Sessions
      - Catalog
      - Itineraries
      - Assistant tools
      - Live events
      - Operations
      - Auth
          |
          +------------------+
          |                  |
          v                  v
    Domain services       PostgreSQL
      - Planner             - Organizations
      - Replanner           - Users and memberships
      - Catalog validator   - Events and catalogs
      - Source resolver     - Sessions and itineraries
      - Crowd policy        - Analytics and audit
          |                  |
          v                  v
    LLM provider         Object storage
    adapter              - Maps
                          - Event media
                          - Source documents

Recommended implementation:

- Keep app/ and admin/ as separate web clients during the first migration.
- Create a shared packages/domain module for types, validation, planner, and route logic.
  (Not built as planned: shared domain services live in `packages/engine/`, and
  the planner itself is still `app/engine/route.ts`.)
- Create a shared packages/contracts module for API schemas. (Built:
  `packages/contracts/`.)
- Move durable records to PostgreSQL.
- Keep JSON import/export adapters for event onboarding and local fallback.
- Keep the current VPS deployment during migration, then introduce managed PostgreSQL and object storage.

## 6. Repository target structure

This is the original target, not the current tree. As of 2026-11-26 there is no
`STATE.md` (progress lives in Git history, `CHANGELOG.md` and this plan), and
`packages/domain` and `packages/ui` were not built; the repository has
`packages/engine/` (shared domain services) and `packages/contracts/` instead.
See the repository map in `README.md` for what exists.

    /AGENTS.md
    /README.md
    /STATE.md

    /app
      /app
        /api
        /events/[slug]
        /plan/[sessionId]
        /ops
      /components
      /lib
      /public

    /admin
      /app
        /login
        /dashboard
        /events
        /venues
        /catalog
        /operations
        /settings
      /lib

    /packages
      /domain
        catalog.ts
        planner.ts
        replan.ts
        crowd.ts
        validation.ts
        types.ts
      /contracts
        api-schemas.ts
        events.ts
        itineraries.ts
        auth.ts
      /ui
        shared RTL primitives

    /prisma
      schema.prisma
      /migrations
      seed.ts

    /data
      /imports
      /fixtures
      /exports

    /docs
      MASTER_BUILD_PLAN.md
      DATABASE_SCHEMA.md
      PRODUCT_PLATFORM_PLAN.md
      /decisions
      /runbooks
      /qa

The migration should be incremental. Do not move every file in one commit.

## 7. Event onboarding lifecycle

The event lifecycle is:

    collect sources
        |
        v
    import or enter data
        |
        v
    validate catalog
        |
        v
    preview visitor experience
        |
        v
    publish catalog version
        |
        v
    operate live event
        |
        v
    patch content and publish correction
        |
        v
    close event and export report

Accepted initial sources:

- CSV or XLSX activity lists.
- PDF event guides.
- Operator-entered data.
- Map images or map files.
- Official websites.
- Manual live updates.

The ingestion pipeline must not automatically treat an unverified document as truth. Every imported item needs a source reference and a review state.

## 8. Visitor experience

### Entry

- Public URL includes an event slug.
- QR code opens the same event URL.
- No visitor registration required.
- Server resolves the event and published catalog version.
- Session token is opaque and stored securely.

### Quick profile

Ask only what changes the plan:

- Companions.
- Available time.
- Mood.
- Interests.
- Budget.
- Walking tolerance.
- Optional must-visit or avoid choices.

Use buttons first and free text second.

### Plan

Each itinerary item shows:

- Name.
- Zone.
- Start and end time.
- Duration.
- Cost.
- Walking time.
- Waiting estimate.
- Why it was selected.
- Source or confidence note.
- Alternative action.

### Conversation

The assistant supports:

- Questions about the selected event.
- Plan changes.
- Nearby alternatives.
- Shorter or cheaper routes.
- Less crowded choices.
- Explanations.
- Human handoff.

### Live change

A live change creates:

- A visible alert.
- A proposed diff.
- A clear explanation.
- An accept action.
- A keep-current action where possible.

## 9. Organizer experience

### Event workspace

- Event overview.
- Status.
- Public link.
- QR code.
- Published catalog version.
- Draft version.
- Validation issues.
- Last update.

### Catalog editor

- Zones.
- Activities.
- Schedules.
- Services.
- Prices.
- Age and family rules.
- Tags.
- Sources.
- Map positions.
- Route graph.

### Operations dashboard

- Sessions.
- Questions per time bucket.
- Top activities.
- Top zones.
- Unanswered questions.
- Active closures and delays.
- Crowd state.
- Replanned routes.
- Recommendation acceptance.
- Simulated versus observed data label.

### Reports

- Visitor questions.
- Popular activities.
- Unanswered content gaps.
- Route changes.
- Zone demand.
- Event-level conversion metrics.
- Exportable CSV or JSON.
- No raw transcript export by default.

## 10. Deterministic planner

The planner pipeline:

1. Resolve current event and catalog version.
2. Resolve visitor profile.
3. Apply hard constraints.
4. Score remaining activities.
5. Build a time-feasible itinerary.
6. Optimize walking and waiting.
7. Add buffers.
8. Attach reason codes and source references.
9. Return a typed itinerary.

Hard constraints:

- Closed activity.
- Outside schedule.
- Age mismatch.
- Budget overflow.
- Impossible duration.
- Invalid route.
- Duplicate activity.
- Unreachable node.

Soft preferences:

- Interest match.
- Mood match.
- Companion match.
- Cost preference.
- Walking preference.
- Crowd preference.
- Novelty.
- Operator distribution policy.

The objective is:

    visitor value - walking cost - wait cost - crowd penalty

Operator distribution is a soft penalty. It must not silently override an explicit visitor priority.

## 11. Replanning rules

When the event changes:

- Freeze completed items.
- Freeze the current item.
- Preserve visitor-locked items.
- Recalculate only future items.
- Respect the remaining time.
- Recalculate price and walking.
- Return an explicit diff.
- Explain every removal, addition, and move.

Supported triggers:

- Crowd update.
- Closure.
- Delay.
- Schedule change.
- Visitor skips an item.
- Visitor reduces available time.
- Visitor asks for a different mood or walking level.

## 12. AI assistant architecture

The assistant has four layers:

### Intent layer

Recognizes a typed visitor request.

### Retrieval layer

Searches only the selected event catalog, sources, schedules, services, and live state.

### Tool layer

Uses typed domain tools.

### Response layer

Writes a concise Arabic answer with cards, reasons, and sources.

Required safeguards:

- No direct database access from the model.
- No unvalidated JSON actions.
- No cross-event retrieval.
- No unsupported factual answer.
- No route calculation in the prompt.
- No hidden destructive action.
- No raw secret values in model context.

Tool examples:

- search_event_content
- get_activity
- get_schedule
- build_itinerary
- modify_itinerary
- list_alternatives
- get_crowd
- get_route
- handoff_to_operator

## 13. API contract

Visitor API:

    POST /api/session
    GET  /api/events/:slug
    POST /api/profile
    POST /api/itineraries
    POST /api/chat
    POST /api/itineraries/:id/replan
    GET  /api/events/:id/live
    GET  /api/events/:id/map

Implemented first versioned slice:

    GET  /api/health
    GET  /api/events/:eventSlug
    POST /api/v1/events/:eventSlug/session
    GET  /api/v1/events/:eventSlug/session
    POST /api/v1/events/:eventSlug/itinerary
    GET  /api/v1/events/:eventSlug/itinerary
    POST /api/v1/events/:eventSlug/assistant
    GET  /api/v1/events/:eventSlug/assistant
    GET  /api/v1/events/:eventSlug/live
    GET  /api/v1/events/:eventSlug/map
    POST /api/v1/events/:eventSlug/itinerary/replan

The versioned session and itinerary endpoints require PostgreSQL and an event-scoped anonymous session token. The legacy demo endpoints remain available during migration; they are not the final persistence boundary.

The visitor experience is available at `/events/:eventSlug`. The same client renders each event slug, resolves its published catalog and map, and keeps Boulevard World as the explicit JSON fallback when PostgreSQL is not configured.

The assistant endpoint is grounded in the selected catalog version and the visitor session. Its tools are `build_itinerary`, `search_event_content`, `find_location`, `get_itinerary_status`, `get_crowd`, `modify_itinerary`, `explain_recommendation`, and `handoff_to_operator`. Modification requests validate the target against the published catalog and never choose a hidden default when the visitor is ambiguous. Search ranking responds to mood, price, proximity, and crowd wording; results carry catalog source references. Location answers resolve against RouteNode services/landmarks and return map coordinates/source references. User and assistant turns are redacted and retained for 24 hours by default; the separate assistant context stores only recent catalog IDs for 24 hours. Every request records an `AssistantEvent` with intent, tool, source count, and latency. Human handoffs store only redacted visitor text in `VisitorHandoff`, are scoped to the event, audited on status changes, and are available through `GET/PATCH /api/v1/events/:eventSlug/handoffs`.

The first admin persistence slice is also implemented:

    GET /api/v1/events
    POST /api/v1/events
    POST /api/v1/events/:eventSlug/updates
    GET /api/v1/events/:eventSlug/catalog
    POST /api/v1/events/:eventSlug/catalog
    POST /api/v1/events/:eventSlug/catalog/zones
    POST /api/v1/events/:eventSlug/catalog/items
    POST /api/v1/events/:eventSlug/catalog/validate
    POST /api/v1/events/:eventSlug/catalog/publish
    PATCH /api/v1/events/:eventSlug/catalog/items/:stableKey
    POST /api/v1/events/:eventSlug/catalog/nodes

It reads the organization-scoped event inventory, venue, published catalog version, and operational counts from PostgreSQL. The current admin token guard is deliberately transitional; durable organizer authentication and membership enforcement remain in the next phase.

`POST /api/v1/events/:eventSlug/updates` validates and stores operator closures, delays, schedule changes, and crowd overrides. The visitor live endpoint exposes active updates, the latest zone snapshots, and the server-derived event clock. The replan endpoint translates them into the deterministic engine and returns an explicit diff. Replanning is hybrid: urgent closures/cancelled schedules apply immediately; crowd and delay changes create an `Itinerary.status = proposed` candidate, which the visitor can accept or keep current.

Organizer API:

    GET    /api/admin/events
    POST   /api/admin/events
    GET    /api/admin/events/:id
    POST   /api/admin/events/:id/catalog/import
    POST   /api/admin/catalog/:id/validate
    POST   /api/admin/catalog/:id/publish
    POST   /api/admin/catalog/:id/rollback
    PATCH  /api/admin/catalog/items/:id
    POST   /api/admin/events/:id/live-updates
    GET    /api/admin/events/:id/operations
    GET    /api/admin/events/:id/reports
    POST   /api/v1/events/:eventSlug/updates
    GET    /api/v1/events/:eventSlug/catalog
    POST   /api/v1/events/:eventSlug/catalog
    POST   /api/v1/events/:eventSlug/catalog/validate
    POST   /api/v1/events/:eventSlug/catalog/publish
    PATCH  /api/v1/events/:eventSlug/catalog/items/:stableKey
    POST   /api/v1/events/:eventSlug/catalog/nodes
    GET    /api/v1/events/:eventSlug/analytics
    GET    /api/v1/events/:eventSlug/handoffs
    PATCH  /api/v1/events/:eventSlug/handoffs

Auth API:

    POST /api/auth/login
    POST /api/auth/logout
    GET  /api/auth/session
    POST /api/admin/memberships
    DELETE /api/admin/memberships/:id

The first durable organizer-auth slice is implemented in the admin app: `User.passwordHash` uses salted scrypt, `OrganizerSession` stores a hashed random token with expiry/revocation, and `/api/auth/login`, `/api/auth/logout`, and `/api/auth/session` support account sessions. The legacy `ADMIN_TOKEN` remains a compatibility path during migration.

The catalog lifecycle is now backed by versioned endpoints: editors copy a published version into a draft, update activities, validate the draft, and authorized owners/admins publish it. Published versions are immutable in the API path and the visitor loader follows only the event's published pointer.

The admin web workspace is available at `/events` and `/events/:eventSlug`; it exposes the durable event inventory, catalog versions, draft creation, validation, publishing, activity editing, and RouteNode service/location editing through the versioned API.

Visitor analytics events are accepted only inside the event-scoped session and store metric names, bucketed timestamps, and optional catalog foreign keys—never raw chat text. Administration receives aggregated metrics and assistant intent latency through `/api/v1/events/:eventSlug/analytics`.

Every endpoint must validate:

- Authentication where required.
- Organization membership.
- Event scope.
- Catalog version.
- Input schema.
- Rate limits.
- Audit requirement.

## 14. Real-time strategy

Phase 1:

- Operator creates live updates.
- Updates are stored in PostgreSQL.
- Visitor polls a lightweight live endpoint.
- The frontend compares event state and requests replanning.
- Operations dashboard refreshes on a short interval.

Phase 1.5:

- Server-Sent Events for faster updates.
- Cache current event state.

Later:

- Redis or another broker only when measured concurrency needs it.
- WebSockets for mobile live guidance if required.

The simulator must implement the same live update interface as a real integration. Replacing the simulator must not require rewriting the planner.

## 15. Security and privacy

Required:

- Secure HTTP-only cookies.
- Password hashing or a trusted authentication provider.
- CSRF protection where applicable.
- Rate limits on login, chat, and public endpoints.
- Organization and event authorization.
- Audit logs for publish, rollback, live updates, and membership changes.
- Redacted logs.
- No secrets in the client bundle.
- No client-provided filesystem paths.
- Object storage access through signed URLs.
- Catalog version checks on every read.
- Automated dependency and secret scanning.
- Backup and restore test for PostgreSQL.

Visitor privacy:

- Anonymous by default.
- Event-scoped session.
- Minimal preference data.
- Configurable retention.
- No raw audio by default.
- No full transcript by default.
- Deletion endpoint and cleanup job.
- Clear consent before optional persistence.

## 16. Testing strategy

### Unit tests

- Catalog validation.
- Schedule matching.
- Budget constraints.
- Age and companion rules.
- Route graph.
- Walking calculation.
- Crowd penalty.
- Replanning diff.
- Reason generation.

### API tests

- Session creation.
- Event isolation.
- Auth and role checks.
- Catalog publish.
- Rollback.
- Live update.
- Chat tool validation.
- Rate limiting.
- Delete behavior.

### End-to-end tests

- Public event link to itinerary.
- Visitor modifies a plan.
- Operator publishes a catalog.
- Operator creates a crowd update.
- Visitor accepts a replacement.
- Two events remain isolated.

### Quality tests

- Grounded answers use the correct source.
- Unknown facts abstain.
- Arabic RTL layout works.
- Narrow mobile layout works.
- Slow or failed LLM keeps typed fallback working.
- Simulated metrics are labelled.

## 17. Deployment

Development:

- Next.js visitor app.
- Next.js admin app.
- PostgreSQL through Docker Compose or a local service.
- Object storage emulator only if required.
- Seed command for demo data.

Staging:

- Separate database.
- Separate secrets.
- Boulevard World and second sample event.
- Public preview link.
- Migration verification.
- E2E smoke tests.

Production:

- Managed PostgreSQL with backups.
- HTTPS.
- Separate visitor and admin domains or paths.
- Object storage for assets.
- Scheduled cleanup job.
- Health endpoint.
- Error monitoring.
- Deployment rollback.
- Database restore runbook.

The existing VPS can host the first complete web version, but PostgreSQL must be durable and backed up. Do not keep the final product dependent on process memory.

## 18. Delivery phases

### Phase A — architecture and database foundation

Deliver:

- Root agent instructions.
- Master plan.
- Database schema.
- Prisma setup.
- Environment example.
- Docker Compose PostgreSQL.
- Initial migration.
- Seed data.
- Health endpoint.

Acceptance:

- Fresh clone starts PostgreSQL.
- Migration succeeds.
- Seed creates two events.
- Database tests pass.

### Phase B — organization and authentication

Deliver:

- User model.
- Organization model.
- Membership roles.
- Login and logout.
- Protected admin routes.
- Authorization helpers.
- Audit log foundation.

Acceptance:

- A user sees only authorized organizations.
- Viewer cannot publish.
- Operator cannot change memberships.
- Every sensitive action is audited.

### Phase C — catalog and publishing

Deliver:

- Event CRUD.
- Catalog editor.
- Import and validation.
- Draft and published versions.
- Preview.
- Publish and rollback.
- Source references.

Acceptance:

- Invalid catalog cannot publish.
- Published version is immutable.
- Public visitor sees only published data.
- Existing sessions remain version-safe.

### Phase D — visitor web experience

Deliver:

- Event public route.
- Anonymous session.
- Quick profile.
- Plan UI.
- Map UI.
- Activity cards.
- Source and reason cards.
- Responsive RTL design.

Acceptance:

- New visitor can create a plan without an account.
- Two event links produce different content.
- Plan survives refresh during active session.
- Mobile workflow is usable.

### Phase E — planner and assistant

Deliver:

- Shared deterministic planner.
- Replanning.
- Typed chat.
- Grounded retrieval.
- Tool calls.
- Fallback responses.
- Human handoff state.

Acceptance:

- The assistant cannot invent a catalog item.
- Every route modification is validated.
- Unknown questions abstain.
- LLM outage does not break button-based flows.

### Phase F — live operations

Deliver:

- Crowd simulator.
- Operator live updates.
- Closures and delays.
- Visitor alerts.
- Route diffs.
- Operations dashboard.
- Aggregated analytics.

Acceptance:

- Operator update reaches a visitor.
- Visitor sees a proposed change.
- The route is recalculated correctly.
- Simulated values are visibly labelled.

### Phase G — production readiness

Deliver:

- Backups.
- Restore test.
- Rate limits.
- Error monitoring.
- Accessibility review.
- Security review.
- Performance review.
- Release and rollback runbook.
- User acceptance testing.

Acceptance:

- CI passes.
- Production build passes.
- Database restore is verified.
- Critical flows work from a clean device.
- No secrets or private data are committed.

## 19. Phase 2 mobile plan

Only start after Phase 1 has:

- Stable API contracts.
- Stable authentication.
- Stable event and catalog model.
- Stable itinerary operations.
- Tested live update behavior.
- Documented privacy boundary.
- Production monitoring.

Mobile options:

- React Native or Expo if the team wants maximum TypeScript reuse.
- Flutter only if the team has stronger Flutter experience.

The decision should be made after the web API is stable. The mobile app must consume the same API and shared contracts. It must not recreate the planner.

Mobile-specific later features:

- Location permission.
- Background event alerts.
- Native push notifications.
- Offline map cache.
- Camera or QR scanning.
- Voice input.
- Native navigation handoff.

## 20. Definition of done for the full webapp

The first complete webapp is done when:

- An organizer can create an organization.
- An authorized user can create an event.
- The user can import or enter an event catalog.
- The catalog can be validated and published.
- A visitor can enter through a public link without an account.
- The visitor can receive a personalized itinerary.
- The visitor can ask grounded questions.
- The visitor can modify the itinerary.
- An operator can submit a live crowd or closure update.
- The visitor receives a safe replanning suggestion.
- The organizer can see operational metrics.
- PostgreSQL is the source of truth.
- Migrations and seeds are documented.
- CI is green.
- The product works on mobile web in Arabic RTL.
- A second event works without custom code.
- The system is ready for a native client later.

## 21. Immediate implementation order

1. Keep this plan and AGENTS.md as the canonical source.
2. Add PostgreSQL and Prisma without removing the current JSON fallback.
3. Add migrations and seed data for two events.
4. Add organization, user, membership, and session models.
5. Add event and catalog version resolution.
6. Extract shared domain contracts.
7. Move the planner behind the API.
8. Replace process-memory sessions with database-backed sessions.
9. Build catalog validation and publish.
10. Connect the visitor web app to published catalog data.
11. Add grounded assistant tools.
12. Add live updates and replanning.
13. Add operations analytics.
14. Add security, backups, monitoring, and E2E tests.
15. Deploy the complete webapp.
16. Start native app planning only after Phase 1 acceptance.

For the next vertical slices, use this order: shared contracts and flags → cookie sessions/rate limits/retention → visitor 2D UX and HTTP integration → assistant provider adapter and grounded retrieval → operator analytics and restore runbook → Boulevard World UAT → second-event validation.

