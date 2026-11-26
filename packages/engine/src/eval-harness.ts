import { compareStrategies } from "./simulate.ts";
import type { SimulationComparison, SimulationScenario, SimulationStrategy } from "./simulate.ts";

export interface ConfidenceInterval {
  mean: number;
  lower: number;
  upper: number;
  samples: number;
}

export interface KpiObservation {
  routeQuality: number;
  responseSpeed: number;
  operationalImpact: number;
  discoverability: number;
}

export interface KpiSummary {
  routeQuality: ConfidenceInterval;
  responseSpeed: ConfidenceInterval;
  operationalImpact: ConfidenceInterval;
  discoverability: ConfidenceInterval;
}

export interface StrategyEvaluation {
  strategy: SimulationStrategy;
  runs: number;
  kpis: KpiSummary;
  outcomes: SimulationComparison[];
}

export interface EvaluationReport {
  contractVersion: "v1";
  seeds: number[];
  baseline: StrategyEvaluation;
  coordinator: StrategyEvaluation;
  lift: Record<keyof KpiObservation, ConfidenceInterval>;
}

/** A deterministic 95% normal-approximation CI. The mean is the only estimate
 * reported; no claim is made that simulation samples represent production traffic. */
export function confidenceInterval(values: readonly number[]): ConfidenceInterval {
  if (!values.length) return { mean: 0, lower: 0, upper: 0, samples: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length === 1) return roundedInterval(mean, mean, mean, 1);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const margin = 1.96 * Math.sqrt(variance / values.length);
  return roundedInterval(mean, mean - margin, mean + margin, values.length);
}

function roundedInterval(mean: number, lower: number, upper: number, samples: number): ConfidenceInterval {
  return {
    mean: round4(mean),
    lower: round4(lower),
    upper: round4(upper),
    samples,
  };
}

function observations(comparisons: readonly SimulationComparison[], strategy: SimulationStrategy): KpiObservation[] {
  return comparisons.map((comparison) => {
    const outcome = comparison[strategy === "coordinator" ? "coordinator" : "leastCrowded"];
    const baseline = comparison.leastCrowded;
    const peakReduction = baseline.peakCrowd > 0
      ? ((baseline.peakCrowd - outcome.peakCrowd) / baseline.peakCrowd) * 100
      : 0;
    // These are simulation KPIs. Route quality and response speed are bounded
    // operational proxies; production route/latency samples remain separate.
    return {
      routeQuality: clamp100(100 - outcome.avgWaitMin * 5 - outcome.overflow / Math.max(1, outcome.visitors) * 100),
      responseSpeed: clamp100(100 - outcome.avgWaitMin * 3),
      operationalImpact: clamp100(outcome.loadBalancePct * 0.6 + clamp100(peakReduction) * 0.4),
      discoverability: clamp100(outcome.gemUtilization * 100),
    };
  });
}

function summarize(values: readonly KpiObservation[]): KpiSummary {
  return {
    routeQuality: confidenceInterval(values.map((value) => value.routeQuality)),
    responseSpeed: confidenceInterval(values.map((value) => value.responseSpeed)),
    operationalImpact: confidenceInterval(values.map((value) => value.operationalImpact)),
    discoverability: confidenceInterval(values.map((value) => value.discoverability)),
  };
}

export function evaluateScenarios(scenarios: readonly SimulationScenario[]): EvaluationReport {
  const outcomes = scenarios.map((scenario) => compareStrategies(scenario));
  const baselineValues = observations(outcomes, "least_crowded");
  const coordinatorValues = observations(outcomes, "coordinator");
  const keys: (keyof KpiObservation)[] = ["routeQuality", "responseSpeed", "operationalImpact", "discoverability"];
  const lift = Object.fromEntries(keys.map((key) => [
    key,
    confidenceInterval(coordinatorValues.map((value, index) => value[key] - baselineValues[index][key])),
  ])) as Record<keyof KpiObservation, ConfidenceInterval>;
  return {
    contractVersion: "v1",
    seeds: scenarios.map((scenario) => scenario.seed),
    baseline: { strategy: "least_crowded", runs: scenarios.length, kpis: summarize(baselineValues), outcomes },
    coordinator: { strategy: "coordinator", runs: scenarios.length, kpis: summarize(coordinatorValues), outcomes },
    lift,
  };
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
