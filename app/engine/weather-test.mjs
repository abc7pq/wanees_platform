// اختبار مصدر الطقس الحتمي — يثبت الواجهة والاستبدال وعدم العشوائية
import assert from "node:assert/strict";
import {
  DeterministicWeatherSource,
  defaultWeatherSource,
} from "./weather.ts";

const src = new DeterministicWeatherSource();

// 1) معرّف المصدر
assert.equal(src.sourceId, "deterministic-stub");

// 2) عقد المخرجات (temperature, condition, impact hint) حاضر ومطابِق للشكل
const reading = src.reading("lagoon", 1080); // 18:00
assert.equal(reading.region, "lagoon");
assert.equal(typeof reading.temperatureCelsius, "number");
assert.equal(typeof reading.condition, "string");
assert.equal(typeof reading.impactHint, "string");
assert.equal(reading.source, "deterministic-stub");
assert.match(reading.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

// 3) حتمية: نفس المدخلات → نفس المخرجات بالضبط
assert.deepEqual(src.reading("africa", 900), src.reading("africa", 900));

// 4) اعتماد على التوقيت: ذروة النهار أدفأ من الفجر لنفس المنطقة
const dawn = src.reading("saudi", 300); // 05:00
const peak = src.reading("saudi", 1020); // 17:00
assert.ok(
  peak.temperatureCelsius > dawn.temperatureCelsius,
  "peak should be warmer than dawn"
);

// 5) حدود معقولة لكل المناطق المعروفة + الافتراضية
for (const region of [
  "lagoon",
  "africa",
  "courchevel",
  "saudi",
  "japan",
  "france",
  "unknown-region",
]) {
  for (const minute of [0, 300, 720, 1020, 1380]) {
    const r = src.reading(region, minute);
    assert.ok(
      r.temperatureCelsius >= 5 && r.temperatureCelsius <= 45,
      `${region}@${minute} out of range: ${r.temperatureCelsius}`
    );
  }
}

// 6) تأثير الحرارة على التلميح: حار → احتياط حراري، بارد → تفضيل داخلي، مطر → احتياط مطر
assert.equal(src.reading("saudi", 1020).impactHint, "heat_precaution");
assert.equal(src.reading("courchevel", 300).impactHint, "indoor_preferred");
assert.equal(src.reading("france", 840).impactHint, "rain_precaution");

// 7) منطقة باردة أبرد من منطقة دافئة عند نفس التوقيت
assert.ok(
  src.reading("courchevel", 1020).temperatureCelsius <
    src.reading("saudi", 1020).temperatureCelsius
);

// 8) المصدر الافتراضي للحقن جاهز ومطابق للواجهة
const injected = defaultWeatherSource();
assert.equal(injected.sourceId, "deterministic-stub");
assert.ok(injected instanceof DeterministicWeatherSource);

console.log("weather-test: ok");
