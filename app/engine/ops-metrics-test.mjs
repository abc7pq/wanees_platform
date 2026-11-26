import assert from "node:assert/strict";
import { DEMO_METRIC_CONTRACT, HEURISTIC_PEAK_SCORE_LABEL, heuristicPeakReductionScore } from "./ops-metrics.ts";

assert.equal(heuristicPeakReductionScore(0, 100), 15);
assert.equal(heuristicPeakReductionScore(10, 100), 38);
assert.equal(heuristicPeakReductionScore(0, 0), 0);
assert.deepEqual(DEMO_METRIC_CONTRACT, {
  live_sessions_field: "liveSessions",
  planned_stop_count_field: "planned_stops_count",
  heuristic_score_field: "heuristic_peak_reduction_score_pct",
});
assert.match(HEURISTIC_PEAK_SCORE_LABEL, /تقديرية/);
assert.match(HEURISTIC_PEAK_SCORE_LABEL, /ليست خفضًا مقاسًا/);
console.log("ops-metrics-test: ok");
