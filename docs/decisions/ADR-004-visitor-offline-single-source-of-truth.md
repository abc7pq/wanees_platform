# ADR-004: Visitor live-signal contract

- Status: accepted
- Fingerprint: `6AB12085…EBAC9E`

`offline` is the single source of truth for live-source availability. The visitor emits it and the
admin consumes it. `metric_mode` is deleted from the contract; display labels are derived at the
consumer edge and are not stored or transported across the boundary. Disconnection degrades to
`offline: true` with zero values rather than failing the dashboard.

Acceptance rule: `offline: false` is emitted only while the live source is present.
