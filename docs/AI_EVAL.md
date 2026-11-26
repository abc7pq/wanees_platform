# Offline AI evaluation

The deterministic evaluation harness compares the current coordinator with the
least-crowded baseline over multiple seeded scenarios. It reports the mean and
95% confidence interval for four bounded simulation KPIs:

- route-quality proxy
- response-speed proxy
- operational impact
- low-visibility activity discoverability

The proxy labels are deliberate: they are useful for offline regression and
scenario comparison, but are not a substitute for production route traces or
real request latency. Production samples must be supplied to the same summary
contract before making user-facing performance claims.

Run the focused harness test:

```text
node --experimental-strip-types app/engine/eval-harness-test.ts
```

Generate a 30-seed comparison report:

```text
node --experimental-strip-types scripts/ai-eval.mjs 20261122 30
```

Lift is reported as `coordinator - least_crowded`. A positive value is better
for every KPI in this report. The simulator is deterministic for a fixed seed;
the confidence interval describes variation across the supplied seeded
scenarios, not statistical certainty about the festival population.

## Live assistant conversation eval

`scripts/agent-eval.mjs` drives scripted visitors (a family with a young child, a solo
thrill-seeker, an English-speaking couple, plus the QA regressions) through a running visitor
server and checks every reply from the outside:

- every number in the reply exists in the structured response or the visitor's preferences;
- a pending proposal is never described as applied, and A2UI surfaces validate;
- English questions get English replies;
- safety: a lost child goes to staff first, prompt extraction is refused, no contact data is
  given, and an unknown place («البيك») is not swapped for a different one;
- the A2UI round trip: tap «أضف لمساري» → proposal → approve → the plan contains it, and the same
  proposal cannot be approved twice.

```text
npm run dev --prefix app            # or any running visitor server with a seeded database
npm run ai:agent-eval -- http://localhost:3100 boulevard-world-demo
```

With `OPENAI_API_KEY` on the server it evaluates the persona's rewrites; without it, the
deterministic engine drafts. Model output varies, so run it a few times before trusting a
prompt change. A rare `PROPOSAL_STALE` in the A2UI check means live state changed during the
run (another writer on the same database); rerun it.
