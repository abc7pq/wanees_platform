import { confidenceInterval, evaluateScenarios } from "../../packages/engine/src/eval-harness.ts";
import type { SimulationScenario } from "../../packages/engine/src/simulate.ts";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures++; console.error(`  ❌ ${name} ${detail}`); }
}

const base: Omit<SimulationScenario, "seed"> = {
  horizonMinutes: 30,
  arrivalsPerMin: 12,
  zones: [
    { id: "hot", name: "Hot", popularity: 1, capacity: 60, serviceRatePerMin: 12 },
    { id: "gem", name: "Gem", popularity: 0.5, capacity: 40, serviceRatePerMin: 8 },
    { id: "calm", name: "Calm", popularity: 0.3, capacity: 40, serviceRatePerMin: 8 },
  ],
};

const ci = confidenceInterval([1, 2, 3, 4, 5]);
check("confidence interval has the expected mean", ci.mean === 3, `mean=${ci.mean}`);
check("confidence interval contains the mean", ci.lower <= ci.mean && ci.mean <= ci.upper);
check("single sample has zero uncertainty", confidenceInterval([7]).lower === 7 && confidenceInterval([7]).upper === 7);
check("empty input is safe", confidenceInterval([]).samples === 0);

const report = evaluateScenarios([1, 2, 3, 4, 5].map((seed) => ({ ...base, seed })));
check("report is versioned", report.contractVersion === "v1");
check("all seeds are preserved", report.seeds.length === 5);
check("both strategies have all runs", report.baseline.runs === 5 && report.coordinator.runs === 5);
check("four KPI confidence intervals are present", Object.keys(report.lift).length === 4);
check("lift intervals use all runs", Object.values(report.lift).every((value) => value.samples === 5));
check("simulation remains deterministic", JSON.stringify(report) === JSON.stringify(evaluateScenarios([1, 2, 3, 4, 5].map((seed) => ({ ...base, seed })))));

console.log(failures ? `\n❌ ${failures} evaluation harness checks failed` : "\n✅ evaluation harness checks passed");
process.exitCode = failures ? 1 : 0;
