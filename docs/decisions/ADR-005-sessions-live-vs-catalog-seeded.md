# ADR-005: Sessions contract

- Status: accepted
- Fingerprint: `D6627EDB…C6B3FE`

The contract keeps two distinct counts:

- `liveSessions`: runtime sessions from the live visitor source.
- `catalogSeeded`: `COUNT(*) FROM "VisitorSession" WHERE "deletedAt" IS NULL` in PostgreSQL.

No `sessions_count`, `session_count`, or overloaded `sessionsCount` field may represent both.
Demo runtime storage may be in-memory, but its restart limitation is explicit; durable historical
counting uses `VisitorSession`.
