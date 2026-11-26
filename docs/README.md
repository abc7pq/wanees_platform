# WANEES documentation

Start with the [project README](../README.md). Contributors and AI agents should read
[AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) first.

## Product and direction

| Document | What it covers |
|---|---|
| [MASTER_BUILD_PLAN.md](MASTER_BUILD_PLAN.md) | The canonical plan for the current product direction |
| [PRODUCT_PLATFORM_PLAN.md](PRODUCT_PLATFORM_PLAN.md) | Multi-event platform model, catalog versions, sessions |
| [AI_AGENT_CONTEXT.md](AI_AGENT_CONTEXT.md) | Context and rules for AI agents working on the code |
| [PROJECT_STORY.md](PROJECT_STORY.md) | How the project started and what it is for |
| [SUCCESS_METRICS.md](SUCCESS_METRICS.md) | What success means for visitors and organizers |
| [BRAND_IDENTITY.md](BRAND_IDENTITY.md) | Visual identity, voice and copy rules |
| [AUDIT_2026-11-26.md](AUDIT_2026-11-26.md) | Full product, UX, code and positioning audit with the remaining roadmap |

## Architecture and data

| Document | What it covers |
|---|---|
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | PostgreSQL schema, scoping, registered visitors, retention |
| [decisions/](decisions/) | Architecture decision records (ADR-001 to ADR-005) |
| [api/](api/) | OpenAPI contract (`openapi.yaml`) and its conformance test |
| [MAP_AND_CROWD_SENSING.md](MAP_AND_CROWD_SENSING.md) | Route graph, map placement and crowd inputs |
| [SIMULATION.md](SIMULATION.md) | What is simulated, how it is labelled, and why |
| [privacy/llm-data-flow.md](privacy/llm-data-flow.md) | What reaches the language model, and what never does |
| [RETENTION.md](RETENTION.md) | Retention windows and the `db:cleanup` job |

## Quality

| Document | What it covers |
|---|---|
| [AI_EVAL.md](AI_EVAL.md) | Assistant evaluation harness and grounding checks |
| [eval/](eval/) | Metric definitions, methodology, frozen baseline, presentation claim ledger |

## Operations

| Document | What it covers |
|---|---|
| [RUNBOOK_LOCAL.md](RUNBOOK_LOCAL.md) | Running everything on one machine |
| [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) | Production operations, backups, incidents |
| [VENUE_PILOT_RUNBOOK.md](VENUE_PILOT_RUNBOOK.md) | Taking WANEES to a new venue |
| [../deploy/hetzner/README.md](../deploy/hetzner/README.md) | The current production deployment |
| [../SECURITY.md](../SECURITY.md) | Security model and how to report a vulnerability |

## Archive

[archive/](archive/) keeps historical hackathon material (challenge analysis, demo video script).
It is not maintained and may contradict the current product.
