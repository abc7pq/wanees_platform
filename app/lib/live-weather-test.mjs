// Live weather adapter: maps Open-Meteo readings to the shared contract and falls back honestly.
// node --experimental-strip-types lib/live-weather-test.mjs
import assert from "node:assert/strict";
import { conditionForCode, impactFor, resetWeatherCache, venueWeather } from "./live-weather.ts";

assert.equal(conditionForCode(0, 22, 5), "clear");
assert.equal(conditionForCode(3, 22, 5), "cloudy");
assert.equal(conditionForCode(61, 22, 5), "rain");
assert.equal(conditionForCode(0, 39, 5), "hot");
assert.equal(conditionForCode(0, 22, 45), "windy");
assert.equal(impactFor("rain", 20), "rain_precaution");
assert.equal(impactFor("clear", 36), "heat_precaution");

const BOULEVARD = { lat: 24.7766539, lng: 46.6003677 };
const ok = async () => new Response(JSON.stringify({ current: { time: "2026-11-26T19:00", temperature_2m: 23.4, weather_code: 1, wind_speed_10m: 12 } }));
resetWeatherCache();
const live = await venueWeather("boulevard-world-demo", BOULEVARD, 1140, ok);
assert.equal(live.live, true);
assert.equal(live.source, "open-meteo");
assert.equal(live.temperatureCelsius, 23.4);
assert.equal(live.condition, "clear");
assert.match(live.summaryAr, /^23° صحو/);

let calls = 0;
const counting = async (...args) => { calls += 1; return ok(...args); };
await venueWeather("boulevard-world-demo", BOULEVARD, 1140, counting);
assert.equal(calls, 0, "a reading is cached for ten minutes");

resetWeatherCache();
const down = await venueWeather("boulevard-world-demo", BOULEVARD, 1140, async () => { throw new Error("offline"); });
assert.equal(down.live, false, "a failed provider never claims a live reading");
assert.match(down.summaryAr, /تقدير/);
assert.equal(await venueWeather("unknown-event", null, 1140, ok), null, "venues without a calibration get no weather");
console.log("live weather: all assertions passed");
