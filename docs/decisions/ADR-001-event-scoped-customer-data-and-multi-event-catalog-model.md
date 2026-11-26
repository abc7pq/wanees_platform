# ADR-001: Event-scoped customer data and multi-event catalog model

## Status
accepted

## Date
2026-11-20

## Context
WANEES is moving from a single Boulevard World demo toward a reusable guide for multiple event organizers, venues, and event occurrences. The user selected opt-in, pseudonymous preferences plus minimal session metrics, with deletion available. Raw voice audio and full transcripts are not to be retained by default. A separate question about sharing visitor identity across events was unanswered; use event/organizer isolation as the conservative default. A durable-retention period has not been chosen.

Today the app has a JSON catalog index with one active Boulevard World catalog, process-memory sessions that expire after 12 hours of inactivity, and browser-local session/chat state. There is no durable customer-account or multi-tenant authorization system. The current system must not be described as having persistent customer memory.

## Options Considered

### Option A: Persistent identified customer profiles and conversations shared across events
- Pros: supports long-term personalization and cross-visit continuity.
- Cons: expands sensitive-data collection, requires identity, consent, retention, access control, and deletion/backup policies; not authorized by the user’s selected default.

### Option B: Event-scoped pseudonymous visit preferences and minimal metrics
- Pros: supports event-specific personalization and operations while minimizing identity and cross-organizer leakage.
- Cons: does not provide automatic continuity across events; requires a consent and deletion flow before durable persistence.

### Option C: No customer-level persistence; aggregate metrics only
- Pros: smallest privacy footprint and simplest initial rollout.
- Cons: cannot retain the explicitly selected opt-in preference profile for a visit or event.

## Decision
Use Option B as the product default. Model `tenant/operator → venue → event occurrence → immutable catalog version`; pin each visitor session to one event and catalog version. Keep visitor identity pseudonymous and isolated per event/organizer. Persist only the structured preferences and minimum session metrics needed for the opted-in feature. Provide a deletion path. Do not store raw voice audio or full transcripts by default, and do not enable cross-event identity or memory.

The exact durable-retention period remains unresolved. Do not introduce durable customer/session persistence until the retention period, consent interaction, and deletion behavior are specified and tested. Until then, retain the demo’s explicitly documented in-memory session behavior. Voice transcription must be provider-mediated by the server and must not retain audio by default.

## Consequences
- Positive: one route engine can serve many independently configured events; event boundaries are explicit; visitor data is minimized and deletable.
- Negative: the global active-catalog lookup must be replaced with explicit event selection; admin authorization must become tenant/event scoped before multiple operators are onboarded; cross-event personalization is unavailable by default.
- Neutral: JSON catalogs can remain the initial authoring/storage format if schema validation, immutable published versions, and rollback are added before multi-event production use.

## Review
- Cadence: on-trigger
- Next review:
- Trigger: before enabling durable visitor-data storage, cross-event identity, onboarding a second organizer, or integrating a voice provider with retention/logging behavior.
