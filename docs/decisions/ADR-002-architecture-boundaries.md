# ADR-002: Protect the domain and contract dependency boundaries

## Context

WANEES has three dependency layers: deterministic domain code in `app/engine`,
shared API contracts in `packages/contracts`, and application adapters in the
Next.js routes and persistence libraries. The visitor and admin applications
will continue to evolve in parallel, and the native client planned for Phase 2
must be able to reuse the API without importing browser or database code.

Without an executable guard, a convenient import from Next.js, Prisma, Zod, or
environment configuration can make the route planner or shared contracts
runtime-specific. That would make deterministic tests slower and make future
client reuse require a rewrite.

## Decision

Keep dependency direction outward:

```text
app/engine  -> standard library and domain types only
packages/contracts -> types and constants only
app/admin adapters -> engine, contracts, database, framework, transport
```

The repository-level `npm run test:architecture` check scans source files in
the first two layers and fails when they import framework/database/transport
modules or read environment variables. This is a lightweight guardrail, not a
replacement for code review or TypeScript compilation.

## Consequences

- Domain and contract code remain portable and deterministic.
- Boundary violations fail locally and in CI before they spread across clients.
- The check is intentionally conservative; if a new dependency is genuinely
  required, the rule and this ADR must be changed together.
- The scanner is lexical, so it cannot detect every indirect dependency. Build
  and tests remain required.
