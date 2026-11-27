# A2UI v1.0 schemas (vendored)

The official A2UI v1.0 JSON schemas, copied unchanged from
[a2ui-project/a2ui](https://github.com/a2ui-project/a2ui) at commit
`36725eee042da90c526f469f94246f96e16fdc35`. They are licensed under Apache 2.0 (`v1_0/LICENSE`).

| File | Upstream path |
| --- | --- |
| `v1_0/agent_to_renderer.json` | `specification/v1_0/json/agent_to_renderer.json` |
| `v1_0/renderer_to_agent.json` | `specification/v1_0/json/renderer_to_agent.json` |
| `v1_0/common_types.json` | `specification/v1_0/json/common_types.json` |
| `v1_0/basic_catalog.json` | `catalogs/basic/v1/catalog.json` |

They are test data, not runtime code. `app/lib/a2ui-conformance-test.mjs` (part of `npm test`) builds
every card Wanees can send (assistant replies and nudges), validates each message against these
schemas, taps every button and validates the action it sends against the official schema and against
our own server schema. That proves any official A2UI renderer (`@a2ui/react`, Flutter, SwiftUI,
Compose) can draw our cards, which is what the Phase 2 native app relies on.

To update: download the same four files and `LICENSE` from a newer upstream commit, replace these
copies, change the commit above, and run `npm test --prefix app`. A failing card means our builder
(`app/lib/a2ui.ts`, `app/lib/nudges.ts`) has drifted from the spec; fix the builder, not the schema.
