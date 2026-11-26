# Operational history retention

`CrowdSnapshot` and `EventUpdate` are live-operations history, not visitor
profile data. They are **not** deleted by `npm run db:cleanup`; they have their
own job because deleting operator history is a product decision and must be
explicit.

| Table | Age column | Default window | Environment variable |
| --- | --- | --- | --- |
| `CrowdSnapshot` | `observedAt` | 90 days | `WANEES_RETENTION_CROWD_SNAPSHOT_DAYS` |
| `EventUpdate` | `createdAt` | 365 days (only ended or revoked rows) | `WANEES_RETENTION_EVENT_UPDATE_DAYS` |

Both windows must be integers from 1 to 3650. `WANEES_FEATURE_RETENTION_JOB=false`
disables the job (the same flag already disables `db:cleanup`).

An `EventUpdate` is eligible only when it is no longer live: `revokedAt` is set,
or `endsAt` is in the past. A row with `endsAt` null or in the future and no
`revokedAt` is still active — possibly a permanent closure — and age alone never
deletes it.

## Dry run is the default

```bash
npm run db:retention
```

This prints JSON and issues **no DELETE**:

```json
{
  "mode": "dry-run",
  "tables": [
    { "table": "CrowdSnapshot", "retentionDays": 90, "cutoff": "...", "matched": 3, "deleted": 0, "sample": [] },
    { "table": "EventUpdate", "retentionDays": 365, "cutoff": "...", "matched": 1, "deleted": 0, "sample": [] }
  ],
  "note": "No rows were deleted..."
}
```

`matched` is the number of rows older than the cutoff; `sample` lists up to five
row IDs and timestamps (oldest first) so the dry run can be reviewed before
anything is removed.

## Enabling deletion explicitly

```bash
npm run db:retention -- --apply
# or, for a scheduled environment:
WANEES_RETENTION_APPLY=true npm run db:retention
```

Delete order and batching:

1. `CrowdSnapshot` rows older than the snapshot cutoff, 1,000 rows per batch,
   oldest first.
2. `EventUpdate` rows older than the update cutoff, 1,000 rows per batch,
   oldest first.

Each batch runs in its own statement (autocommit), so a long purge does not hold
one large transaction. A rerun after a failure is safe: the predicate is
time-based and already-deleted rows no longer match.

Deleting an `EventUpdate` sets `CrowdSnapshot.eventUpdateId` to `NULL`
(`ON DELETE SET NULL`) for any remaining snapshot that references it. Snapshot
rows are only deleted by their own `observedAt` rule, so the snapshot window
must be shorter than or equal to the update window when both are in use. The
defaults (90/365) satisfy that.

## Supporting indexes

Migration `20261121153000_retention_history_indexes` adds
`CrowdSnapshot(observedAt)` and `EventUpdate(createdAt)`. The existing composite
indexes lead with `eventId`, so they cannot serve the global cutoff scan; without
these indexes every batch would scan and sort the whole table.

At production scale, create them with `CREATE INDEX CONCURRENTLY` outside a
transaction, then mark this migration as applied with
`npx prisma migrate resolve --applied 20261121153000_retention_history_indexes`
instead of running its transactional `CREATE INDEX`.

## Verification

```bash
npm run test:retention
```

The smoke test refuses to run when the target database already has rows older
than the default cutoffs; use the demo or a scratch database. It inserts five
marked rows (two snapshots and three updates, including one live old update),
then checks:

- dry-run matches exactly the old rows, deletes nothing, and leaves all five
  rows present;
- `WANEES_RETENTION_CROWD_SNAPSHOT_DAYS=120` and
  `WANEES_RETENTION_EVENT_UPDATE_DAYS=500` match zero rows;
- a `0`-day window is rejected with the accepted range;
- `--apply` deletes exactly the two old rows and keeps both new rows **and** an
  old update that is still active (`endsAt` null, never revoked).

The four test rows are removed in a `finally` block, including after a failure.

## Scheduling

`db:cleanup` stays hourly and only handles expired sessions, turns, and
rate-limit buckets. Run the history policy separately and deliberately, for
example nightly after backups:

```cron
15 3 * * * cd /srv/wanees && WANEES_RETENTION_APPLY=true npm run db:retention >> /var/log/wanees-retention-history.log 2>&1
```

Start with the dry run in production, review `matched` for a few nights, then
enable `--apply`.

## Locks, rollback, and audit expectations

- No schema change and no migration: this only deletes rows, in batches.
- Row deletes take normal row locks. Schedule them off-peak; there is no
  `TRUNCATE`, `VACUUM FULL`, or index rebuild here.
- Deleted rows are not recoverable from the application. Take an encrypted
  backup first (`npm run db:backup`) if the window is being shortened.
- `EventUpdate` is operator audit history. Keep its window at or above the
  legal/operational requirement agreed with the product owner; shortening it is
  a policy decision, not a performance tweak.

`cron` and the encrypted backup procedure are documented in
[OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md).
