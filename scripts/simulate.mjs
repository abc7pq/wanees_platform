// نقطة دخول حزام المحاكاة — حتمية بلا شبكة/LLM/child_process
// التشغيل:  node scripts/simulate.mjs [seed] [horizonMinutes] [arrivalsPerMin]
import { compareStrategies } from "../packages/engine/src/simulate.ts";

const seed = Number(process.argv[2] ?? 20261122);
const horizonMinutes = Number(process.argv[3] ?? 90);
const arrivalsPerMin = Number(process.argv[4] ?? 35);

const scenario = {
  seed,
  horizonMinutes,
  arrivalsPerMin,
  zones: [
    { id: "hot", name: "Hot zone", popularity: 1.0, capacity: 60, serviceRatePerMin: 12 },
    { id: "mid", name: "Mid zone", popularity: 0.85, capacity: 50, serviceRatePerMin: 10 },
    { id: "gem", name: "Hidden gem", popularity: 0.5, capacity: 40, serviceRatePerMin: 8 },
    { id: "calm", name: "Calm zone", popularity: 0.3, capacity: 40, serviceRatePerMin: 8 },
    { id: "quiet", name: "Quiet zone", popularity: 0.2, capacity: 30, serviceRatePerMin: 6 },
  ],
};

const result = compareStrategies(scenario);
console.log(JSON.stringify(result, null, 2));
console.log(
  result.acceptance.passed ? "\n✅ عتبات القبول تمر" : "\n❌ عتبات القبول فشلت"
);
process.exitCode = result.acceptance.passed ? 0 : 1;
