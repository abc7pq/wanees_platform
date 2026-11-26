# WANEES presentation claim ledger

This ledger keeps the attached solution presentation unchanged while preventing
presentation language from becoming an unsupported product claim. The attached
deck is a historical/target artifact; the application and release evidence must
use the status and source shown here.

## Source precedence

1. The current 2026–27 Boulevard World booklet is preferred for names,
   descriptions, and current-season zone context.
2. The supplied activities CSV is an import candidate for structured fields.
   Its prices, capacities, durations, ages, and schedules require operator
   review before they are labelled verified.
3. The supplied map is a visual reference for manual RouteNode placement. It
   does not establish walking time, route geometry, crowd, or accessibility.
4. The older Boulevard guide is historical fallback material and cannot
   override a current-season source.

## Current evidence

The published repository fixture contains 59 activities and 24 zones. The
supplied CSV contains 109 complete records across 33 raw zone labels, including
61 attraction/show records, 26 food records, 22 retail records, 63 non-zero
price candidates, 46 free candidates, and 12 records marked `new_2026`.

The CSV has no field-level verification marker and contains no offer records.
It must therefore create a draft catalog and a review queue rather than silently
replace the published catalog.

Run the reproducible audit with:

```powershell
npm run claims:audit
npm run claims:audit -- --csv C:\path\to\wanees_blvd_world_activities.csv
npm run catalog:import -- --csv C:\path\to\wanees_blvd_world_activities.csv
```

`catalog:import` is dry-run by default. `--apply` creates a source-linked draft
version in PostgreSQL with `UNREVIEWED` status; it does not publish the draft,
create map geometry, or create schedules. The admin source-review action and
catalog validator are required before any imported record can become publishable.

## Frozen presentation claims

| Presentation claim | Current evidence | Release status |
| --- | --- | --- |
| 110 activities/restaurants/offers | 109 CSV candidate records; 59 published fixture records | Candidate; no fabricated record |
| 23 zones | 33 raw CSV labels; canonical grouping is not yet verified | Requires normalization and operator review |
| 17 verified prices | 63 CSV price candidates; none are field-verified by the importer | Requires source review |
| Operational impact | Operators can publish field counts and measured waits, and the dashboard records plan and replan interactions | A comparison with independent venue counts is needed to establish queue or crowd impact |

## Product evidence

| Visitor or operator promise | Working path in the release candidate | Verification still needed at Boulevard World |
| --- | --- | --- |
| Personalized Arabic plan | Event QR, anonymous preference choices, and a deterministic schedule constrained by budget, group and available time | A task study to measure time to a usable first plan |
| Ask, find, explain and modify | Typed questions, catalog-backed service and activity cards, and reviewable add, remove, swap, and shorten requests. Browser voice uses the same assistant with typed fallback. | Voice and location permission checks on physical phones |
| Respond to change while preserving visitor choice | The organizer publishes a delay or closure. A delay is a proposal. A closure removes an unavailable future stop. Stale proposals preserve the active plan. | Operator ownership and update-delivery checks on the release deployment |
| Suggest calmer alternatives | The organizer records current occupancy against a source-approved zone capacity. When a measured quieter option is feasible, the planner can propose it with an explanation. | Current venue capacity, sustained measurements and field observation |
| Find services and walk a route | Published location nodes and dated, directed walking segments support graph directions. Missing verified paths give a recovery message. | Walk the exact published routes and check landmarks before field use |
| Offer an incentive and measure use | Operators publish an expiring offer with a fulfillment location. Anonymous sessions can request it once and the dashboard reports requests. | Venue fulfillment and usage study |
| Run more than one event | Events, catalogs, updates, staff access, offers and analytics have event scope. A new reviewed catalog can be published to its own public link. | Staff access and publish permissions on the production organization |

Catalog counts describe source records or rehearsal data. The pilot readout uses observed task outcomes and states how many tasks were measured.

The product may display the exact measured catalog counts and source labels. It
must not display the presentation numbers as live evidence until the ledger
changes through a reviewable source update.
