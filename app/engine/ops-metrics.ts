export function heuristicPeakReductionScore(divertedStops: number, loadBalancePct: number): number {
  return Math.max(0, Math.min(38, Math.round(divertedStops * 6 + loadBalancePct * 0.15)));
}

export const DEMO_METRIC_CONTRACT = {
  live_sessions_field: "liveSessions",
  planned_stop_count_field: "planned_stops_count",
  heuristic_score_field: "heuristic_peak_reduction_score_pct",
} as const;

export const HEURISTIC_PEAK_SCORE_LABEL = "درجة تقديرية تجريبية، ليست خفضًا مقاسًا للذروة";
