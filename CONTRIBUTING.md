# Contributing to WANEES

Thank you for helping. This guide is short on purpose; [AGENTS.md](AGENTS.md) is the full
operating contract and applies to people and AI agents alike.

## The one rule

The computer calculates. The assistant understands and explains. The visitor decides.
Prices, hours, availability, walking times, crowd values and plan feasibility come from the
published catalog and the deterministic engine, never from a language model.

## Set up

Follow [Run it locally](README.md#run-it-locally) and [docs/RUNBOOK_LOCAL.md](docs/RUNBOOK_LOCAL.md).
You need Node 26 and PostgreSQL 16. Copy `.env.example` to `.env` and fill in your own values;
never commit `.env`, `.env.local`, keys, tokens or passwords.

## Make a change

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Database change? Add a Prisma migration, update the seed and runtime validation, and test the
   new constraint (AGENTS.md §10). Never edit a production schema by hand.
3. Implement the domain logic first, then the UI.
4. Keep the visitor app Arabic-first and RTL, and check it at phone width (375 px).
5. Every new input is validated (Zod), every query is scoped to its organization and event, and
   every write endpoint is rate-limited and same-origin checked.
6. Update the documentation the change affects, and add a line to [CHANGELOG.md](CHANGELOG.md).

## Check before opening a pull request

Run the checks in [Verify everything](README.md#verify-everything). At minimum:

```sh
npm test --prefix app
npm test --prefix admin
npm run test:contract
npm run build --prefix app
npm run build --prefix admin
```

CI runs the full suite on every pull request; `main` only accepts green pull requests.

## Copy and tone

Visitor-facing text is Saudi Arabic, warm and short (see [docs/BRAND_IDENTITY.md](docs/BRAND_IDENTITY.md)).
Say what is simulated. Never invent a price, time or place in copy, screenshots or mockups; use
real catalog entries.

## Privacy

Collect the minimum. Visitors are anonymous by default; registration is an opt-in organizer
feature. Do not log or store raw chat text, phone numbers in clear, or OTP codes. See
[docs/privacy/llm-data-flow.md](docs/privacy/llm-data-flow.md).

## Security issues

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
