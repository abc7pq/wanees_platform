# WANEES venue rehearsal and pilot

## Provision the rehearsal

1. Complete the deployment workflow for the verified master commit and apply the committed migrations. Configure `WANEES_PITCH_OPERATOR_PASSWORD` on the deployment host. Run `npm run db:seed:pitch` with the intended database URL. This provisions a separate organization, one scoped operator, and the labeled `boulevard-world-pitch` fixture independently of the ordinary demo seed.
2. Configure `NEXT_PUBLIC_APP_URL` with the exact public visitor origin before building the organizer app. In the organizer dashboard select the rehearsal and use «عرض رمز الدخول (QR)» to display or download its QR. Scan it and check that it opens `/events/boulevard-world-pitch` and displays «عرض تجريبي». The rehearsal clock shows 18:00 Riyadh time. Update scheduling, expiry, and audit timestamps use real time.
3. Sign in as the rehearsal operator and verify its event selector. Create a visitor plan and delay a future stop with the authenticated form. Use the Active and History tabs to revoke the update. Start a new anonymous visit for the next run.
4. In the verification environment, run `npm run db:smoke`, `npm run test:http`, and `npm run test:pitch`. The pitch test publishes and revokes event updates and requires an idle rehearsal. Verify QR entry, help, refresh, offline recovery, delay, and closure on physical iPhone and Android devices before the venue presentation.
5. To rehearse crowd routing, count the occupied and quieter areas separately. Use «إشغال المناطق ووقت الانتظار» to enter each zone's count, observed wait if available, and expiry. A lower-load alternative needs a current measurement and must satisfy the visit's constraints. Staff can publish an offer with a fulfillment location and end time and see how many visitor sessions requested it.

Migration `20261125120000_event_idempotency_nullable_session` aligns PostgreSQL with the existing nullable Prisma session relationship. Event-level reservations carry an event ID and no visitor-session ID. For application rollback, restore the previous verified application SHA and retain the compatible nullability change.

Migration `20261125123000_route_edge_source` adds an optional source reference to walking segments. Older published catalogs can still load. A field catalog must have a verified reference on each open segment before it can be published. Retain this additive migration when rolling back the application.

## Approve a field catalog

Choose one staffed gate, a connected cluster of destinations, and one operating shift. Record the venue operations lead and sign-off date. Confirm local hours, including service after midnight, activity schedules, restrictions, price basis, staff availability, and current access. Use the current 2026–27 booklet for names, the supplied CSV as a reconciliation draft, and the 2024 guide for historical context.

| Record | Venue evidence |
|---|---|
| Activity and schedule | Operator source, price basis and eligibility rules, effective date, verification date |
| Gate and service | Sign or approved map, displayed name, surveyed location, staff availability |
| Path segment | Endpoints, permitted direction, walking distance and time, closure alternative, accessibility review |
| Zone capacity | Owner- or administrator-approved capacity, operating document reference and effective date |
| Live update | Source, effective and expiry times, target, publication time, operator role |
| Artwork | Permission to publish and current edition |

In a draft catalog, use «ممرات المشي» to record each surveyed segment and its source and walk date. Add a separate segment for the reverse direction when permitted. Use «اعتماد سعة منطقة» for capacity and its source. Revalidate the draft before publishing it. Review each proposed route and any accessible variant on foot with staff. Check the fallback for a closed segment and use a manual origin or staffed help point when location or data is unavailable. Keep fixture data in the rehearsal organization.

In the activity editor, add the operator's reference for the confirmed price, eligibility, and schedule. An unknown price stays empty. Set a confirmed opening period for imported activities before validation. The planner excludes activities with unknown prices or unreviewed eligibility.

Run `node scripts/catalog-publication-smoke.mjs` against a disposable local integration database to exercise first publication and directions from the resulting route. The check creates a synthetic event. CI uses a fresh database for this check.

## Measure the shift

Assign participants the same tasks with WANEES and the venue’s current information where practical. Record outcomes by condition without personal identifiers, precise location history, or transcripts.

| Measure | Recording method |
|---|---|
| Time to a useful next action | Seconds from opening the QR or baseline material to choosing a feasible stop |
| Destination finding | Successful arrivals divided by all attempts |
| Update delivery | Publication to proposal display, with a count of eligible visits |
| Alternative decisions | Accepted, kept, or undecided out of proposals shown |
| Staff workload | Request counts, handling minutes, staff on shift, unresolved requests |

Report medians, task totals and missing outcomes. Use independent venue counts for any claim about measured queue or crowd changes.
