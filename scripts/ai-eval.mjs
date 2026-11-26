import { evaluateScenarios } from "../packages/engine/src/eval-harness.ts";

const seedStart = Number(process.argv[2] ?? 20261122);
const runs = Number(process.argv[3] ?? 30);
const scenario = (seed) => ({
  seed,
  horizonMinutes: 90,
  // Fractional demand makes the seeded arrival stream vary across runs while
  // keeping the scenario close to the 35 visitors/min demo load.
  arrivalsPerMin: 35.5,
  zones: [
    { id: "hot", name: "Hot zone", popularity: 1, capacity: 60, serviceRatePerMin: 12 },
    { id: "mid", name: "Mid zone", popularity: 0.85, capacity: 50, serviceRatePerMin: 10 },
    { id: "gem", name: "Hidden gem", popularity: 0.5, capacity: 40, serviceRatePerMin: 8 },
    { id: "calm", name: "Calm zone", popularity: 0.3, capacity: 40, serviceRatePerMin: 8 },
    { id: "quiet", name: "Quiet zone", popularity: 0.2, capacity: 30, serviceRatePerMin: 6 },
  ],
});

const report = evaluateScenarios(Array.from({ length: runs }, (_, index) => scenario(seedStart + index)));
console.log(JSON.stringify(report, null, 2));
console.log(`\n✅ evaluated ${runs} deterministic scenarios; lift is coordinator minus least_crowded`);
