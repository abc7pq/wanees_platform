# WANEES Operations Runbook

This runbook covers the first production-ready Boulevard World demo slice and the
repeatable operating tasks for any future event.

## Environment promotion contract

The deployment branch for `wanees_platform` is `main`. Develop and test in a
separate checkout on a focused branch, save changes through a GitHub pull request,
and only deploy an approved commit from `origin/main` with passing CI. Do not
edit the running release, deploy local-only commits, or force-push.

The [Hetzner deployment guide](../deploy/hetzner/README.md) contains the active
Caddy and systemd configuration, release and migration steps, verification, and
rollback procedure. Secrets are provisioned on the host, not checked into Git.

## Required configuration

Set these values in the visitor and admin deployments:

- `DATABASE_URL`: PostgreSQL connection string.
- `WANEES_ALLOWED_ORIGINS` (optional, visitor app): comma-separated origins, besides the app's own, whose
  pages may change a visit. Any other `Origin` on a POST, PUT, PATCH or DELETE under `/api/` gets 403
  `ORIGIN_FORBIDDEN` (logged as `wanees.http` `refused`). Native apps, kiosks and webhooks send no Origin
  and are not affected. Behind Caddy the comparison uses `X-Forwarded-Proto` and `X-Forwarded-Host`.
  Pages carry a per-response script nonce (`Content-Security-Policy` from `middleware.ts`); an inline
  `<script>` without the nonce does not run.
- `WANEES_DB_POOL_MAX`: database connections one server process may open (1–100, default 20). Each process
  has one pool, shared by the app and the engine. Add up every process on the same database (visitor, admin,
  extra instances, cron jobs) and keep the total under PostgreSQL's `max_connections` (100 by default), or
  requests fail with "too many clients already" and visitors see «الفعالية غير متاحة».
- `WANEES_RATE_LIMIT_SALT`: long random secret shared by the visitor and admin
  services. Rotate it only during a planned restart because rotation invalidates
  rate-limit identities.
- `WANEES_TRUSTED_PROXY_HOPS`: how many reverse proxies in front of the visitor
  and admin apps append to `X-Forwarded-For` (0–5, default 0). Rate limits key on
  the client address only: the N-th `X-Forwarded-For` entry from the right. Entries
  further left, `X-Real-IP`, session tokens and cookies are client-controlled and
  never used. With 0, all callers share one address, so a production deployment
  must set it (1 for a single nginx or load balancer) and must not expose the app
  port directly. At 0 in production each service logs
  `trusted_proxy_hops_unset` once from `wanees.rate-limit`. Requests with fewer
  entries than configured share the `unverified-chain` bucket.
- `WANEES_OWNER_PASSWORD`: initial owner password used by the seed flow.
- `WANEES_ORGANIZATION_SLUG`: organization used by the seed flow.
- `OPENAI_API_KEY`: visitor-server credential for the OpenAI Responses API. Without it, the grounded deterministic assistant is used. `WANEES_OPENAI_MODEL` defaults to `gpt-6-luna`.
- Leave `WANEES_ALLOW_CLOCK_OVERRIDE` and `WANEES_CLOCK_OVERRIDE_MINUTE` unset in every deployment. They pin the event clock for CI only; a production build ignores them unless it runs on a GitHub Actions runner, and logs `[event-clock] … ignored` once if they are set.
- For VPS organizer deployments, leave `WANEES_LOCAL_DEMO` and `WANEES_DEMO_ADMIN_PASSWORD` unset. The demo admin setup is for the loopback test stack.
- `WANEES_PUBLIC_DEMO_EMAIL` and `WANEES_PUBLIC_DEMO_PASSWORD` (admin web process only, e.g. `/etc/wanees/admin.env`): when both are set, the public login page shows them to every visitor, with copy buttons. They appear only while that account is active, the password matches, and every membership of the account is `VIEWER` (a non-VIEWER account hides the panel and logs `public_demo_not_viewer`). Anyone who opens the page can sign in read-only, so use them only for a demo period, rotate the password afterwards, and remove both values to hide the panel.
- `WANEES_BACKUP_DIR`: encrypted backup directory, default `/var/backups/wanees`.
- `WANEES_BACKUP_RETENTION_DAYS`: local retention window, default 7 days (1–90).
- `WANEES_BACKUP_ENCRYPTION_PASSPHRASE`: secret used to encrypt database dumps; keep it outside the repository and outside the backup directory.
- `WANEES_BACKUP_OFFSITE_REQUIRED`: set to `true` in production so a backup is considered successful only after off-host replication.
- `WANEES_BACKUP_S3_ENDPOINT`, `WANEES_BACKUP_S3_BUCKET`, `WANEES_BACKUP_S3_REGION`, `WANEES_BACKUP_S3_ACCESS_KEY_ID`, `WANEES_BACKUP_S3_SECRET_ACCESS_KEY`: S3-compatible object-storage destination for encrypted backup blobs. Keep credentials in the deployment secret store.
- `WANEES_BACKUP_S3_PREFIX`: optional object-key prefix, default `wanees`.
- `WANEES_BACKUP_S3_ALLOW_INSECURE`: development-only escape hatch for an HTTP endpoint; never enable this in production.
- `WANEES_RESTORE_SMOKE_DATABASE_URL`: a maintenance PostgreSQL database with permission to create/drop a uniquely named temporary database. It must not be the same database as `DATABASE_URL`.
- `WANEES_ERROR_MONITORING_DSN`: optional server-side Sentry DSN. Monitoring is disabled when omitted.

Feature flags are safe to change per deployment. Keep the defaults enabled for
the current demo, and disable a feature only as a rollback measure:

```text
WANEES_FEATURE_BROWSER_COOKIE_SESSION=true
WANEES_FEATURE_PROPOSAL_CONCURRENCY=true
WANEES_FEATURE_MAP_2D_V2=true
WANEES_FEATURE_LLM_ADAPTER=true
WANEES_FEATURE_RETENTION_JOB=true
```

`WANEES_FEATURE_PROPOSAL_CONCURRENCY` no longer affects accepting a
proposal: the stale-base and live-revision checks always run, so turning the
flag off cannot let a stale or replayed accept through.

## Deploying a catalog

1. For a structured candidate list, run a dry run first:

   ```powershell
   npm run catalog:import -- --csv C:\path\to\activities.csv
   ```

   The importer accepts CSV only, reports normalized counts and a SHA-256
   checksum, and does not write unless `--apply` is supplied. With `--apply`,
   it creates a new `DRAFT` version for the selected event. It never replaces
   the published pointer, never invents map coordinates, and never invents
   schedules.
2. Review the imported source in the admin catalog workspace. Approving a
   source promotes its linked imported zones and activities to `VERIFIED`; a
   rejected or unreviewed source cannot pass validation.
3. Add or verify RouteNodes, open RouteEdges, schedules, accessibility metadata,
   and any current-season source corrections.
4. Run catalog validation and resolve every blocking error. The validator
   blocks missing sources, unreviewed/rejected imported content, missing route
   graph data, invalid prices/durations, and activities without schedules.
5. Publish only a validated `DRAFT` as an owner/admin. Published versions are
   immutable. To restore a prior `SUPERSEDED` version, use the admin workspace
   rollback action; the event pointer changes atomically and an audit record is
   written.
6. Run `npm run db:smoke` against the deployment database.
7. Open `/demo` and complete a visitor flow in Arabic and English.

Published catalog versions are immutable. A new publish creates a new version;
existing visitor sessions continue to reference the version they started with.

## Retention and privacy

Run the cleanup job at least hourly in production:

```text
0 * * * * cd /srv/wanees && npm run db:cleanup >> /var/log/wanees-retention.log 2>&1
```

The job removes expired conversation turns, expired visitor sessions (including
their dependent itinerary and analytics records), and expired rate-limit
buckets. It is intentionally a no-op when `DATABASE_URL` is not configured.

Operational history (`CrowdSnapshot` and `EventUpdate`) is **not** touched by
this job. It has a separate, dry-run-by-default job with 90/365-day windows; see
[RETENTION.md](RETENTION.md) before enabling `--apply`.

Do not log bearer tokens, visitor cookies, raw chat transcripts, or request
payloads containing personal data. Structured request logs contain only the
request ID, method, path, status, and duration. Browser sessions use an HttpOnly
cookie; native clients use a bearer token and should store it in the platform
keystore.

## Live operations

The visitor client polls the live endpoint only while the tab is visible. The
endpoint returns a stable `revision`, a recommended next poll delay, and a stale
threshold. If the revision changes, the client asks for a replan. Proposals are
bound to the active itinerary and live revision and expire after 15 minutes.

- `keep_current` dismisses the proposal and records the decision time. It
  returns `409 PROPOSAL_STALE` if the proposal was already decided or expired.
- `accept` returns `409 PROPOSAL_STALE` when the live revision or active
  itinerary changed, or the proposal was already decided or expired; the
  visitor should request a fresh proposal.
- Another session's `proposalId` gets `404 PROPOSAL_NOT_FOUND` for both
  decisions.
- Every refused `accept` or `keep_current` logs one `wanees.agent` record with
  a `reason_code`:
  - `stale_revision`: the `409 PROPOSAL_STALE` cases above.
  - `proposal_not_found`: the `404 PROPOSAL_NOT_FOUND` case.
  - `missing_proposal`: a `400`, either `PROPOSAL_REQUIRED` (no `proposalId`)
    on `keep_current`, or `INVALID_REQUEST` when `proposalId`,
    `baseItineraryId` or `baseLiveRevision` is missing on `accept` or malformed.
- urgent closures are applied immediately and dismiss older proposals.
- Operators can review active and historical updates at the admin dashboard. Revocation is soft: it records the operator, time, and optional reason, writes an audit record, and preserves the original update. Linked crowd snapshots are excluded from visitor live state and replanning after revocation.

## Backups and restore rehearsal

Install PostgreSQL client tools (`pg_dump`, `pg_restore`, `createdb`, `dropdb`, and `psql`) on the VPS, matching the major version of the PostgreSQL server. Store `DATABASE_URL`, `WANEES_BACKUP_ENCRYPTION_PASSPHRASE`, `WANEES_BACKUP_DIR`, and retention settings in a root-readable deployment environment file with mode `0600`; never put these values in GitHub. Create the backup directory with mode `0700`.

Create a backup manually with `npm run db:backup`. The command streams a PostgreSQL custom dump through AES-256-GCM encryption, writes it with owner-only permissions, atomically publishes the completed file, and prunes expired WANEES backup files. It fails if PostgreSQL tools, the database URL, or the encryption key are missing.

For a daily VPS job, add an entry to `/etc/cron.d/wanees-backup` (adjust the repo path if the deployment moves):

```cron
0 2 * * * root PATH=/root/.hermes/tools/node-26.12.1-linux-x64/bin/npm-12.2.2-linux-x64/bin:/root/.hermes/tools/node-26.12.1-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; export PATH; set -a; . /root/.config/wanees/backup.env; set +a; cd /root/wanees && npm run db:backup >> /var/log/wanees-backup.log 2>&1
```

Run a restore rehearsal weekly from the same protected environment after setting `WANEES_RESTORE_SMOKE_DATABASE_URL` to a maintenance database with `CREATEDB` permission:

```cron
0 3 * * 0 root PATH=/root/.hermes/tools/node-26.12.1-linux-x64/bin/npm-12.2.2-linux-x64/bin:/root/.hermes/tools/node-26.12.1-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; export PATH; set -a; . /root/.config/wanees/backup.env; set +a; cd /root/wanees && npm run db:restore-smoke >> /var/log/wanees-restore-smoke.log 2>&1
```

`db:restore-smoke` decrypts the newest backup into a temporary owner-only file, restores it into a random database on the configured maintenance PostgreSQL server, verifies event and catalog rows, drops only that generated database, and removes the temporary dump. GitHub Actions exercises both commands on a disposable PostgreSQL service for every pull request.

After the local backup is atomically renamed, the command streams the encrypted
blob to the configured S3-compatible object store using a signed PUT. No raw SQL
dump is uploaded. The process fails when `WANEES_BACKUP_OFFSITE_REQUIRED=true`
and the destination is missing or unavailable; it also rejects incomplete or
insecure production configuration. Configure object-store lifecycle retention to
match the local policy and rehearse restoring a downloaded encrypted object in
the same way as `db:restore-smoke`. Without an operator-configured destination,
the local backup still protects against database-level mistakes but not VPS or
disk loss.

## Error monitoring and health checks

The visitor and admin `/api/health` routes are unauthenticated readiness probes.
They return only service name, status, timestamp, and boolean checks for
database reachability and a published catalog pointer; missing or unreachable
PostgreSQL (or no published catalog) returns HTTP 503. They do not reveal
connection details.

Set `WANEES_ERROR_MONITORING_DSN` in each server process to enable Sentry. The integration is server-side only, leaves tracing off, and removes request details, user data, extras, breadcrumbs, tags, and error text before sending stack frames. It does not configure browser session replay or source map uploads. Leave the DSN unset to disable monitoring.

## Incident response

- **Database unavailable:** the public event/map fallback remains available, but
  durable visitor sessions and operator writes should be treated as degraded.
- **Assistant provider unavailable:** keep the deterministic grounded assistant
  enabled; do not disable candidate retrieval.
- **Bad live update:** use the update's `سحب التحديث` action, add a reason when useful, verify it appears in the history with status `REVOKED`, then verify the visitor live revision changes and request a fresh proposal.
- **High traffic:** reduce expensive poll frequency via the returned
  `nextPollAfterMs` and review rate-limit metrics before increasing limits.

## Verification commands

```powershell
npm run db:validate
npm run db:deploy
npm run db:smoke
npm run db:backup
npm run db:restore-smoke
Push-Location app; npm test; npm run build; Pop-Location
Push-Location admin; npm test; npm run build; Pop-Location
npm run test:http
```

The GitHub Actions workflow runs the same schema, database smoke, encrypted
backup/restore rehearsal, builds, and visitor/admin HTTP integration checks on
every pull request.

## Live venue board (`/board/<eventSlug>`)

A read-only screen for gates, info desks and the demo booth. It needs no login
and no visitor session: it polls the public, aggregated `/api/events/<slug>`,
`/api/v1/events/<slug>/crowd` and `/api/v1/events/<slug>/live` every 15 seconds
(paused while the tab is hidden; each request times out after 8 seconds).

- Shows the three quietest open zones, the next six shows with any operator
  delay or cancellation applied, operator notices with their visitor-facing
  `reason`, and every zone's crowd level with its source (measured, operator,
  simulated or estimate). Only sensor readings count as measured.
- Never claims to be live while the venue is closed: the clock shows the real
  local time, the badge says when it opens, and the show list is "tonight's".
- If updates fail it keeps the last reading and says how old it is after 60 s.
- `?tv=1` enlarges everything for a wall screen.
- The logic lives in `app/lib/live-board.ts` (pure, tested by
  `app/lib/live-board-test.mjs`); browser tests are in `tests/ui/board.spec.mjs`.
