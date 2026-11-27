// Arabic counted-noun agreement: every count a visitor reads goes through ar-count.ts.
import assert from "node:assert/strict";
import { AR_MINUTE, arCount, hoursCount, minutesCount, peopleCount, stationsCount } from "./ar-count.ts";
import { describeWalkingBrief } from "./walking-brief.ts";
import { minutesText } from "./agent-persona.ts";

const cases = [
  [1, "دقيقة واحدة", "محطة واحدة", "شخص واحد"],
  [2, "دقيقتين", "محطتين", "شخصين"],
  [3, "3 دقائق", "3 محطات", "3 أشخاص"],
  [6, "6 دقائق", "6 محطات", "6 أشخاص"],
  [10, "10 دقائق", "10 محطات", "10 أشخاص"],
  [11, "11 دقيقة", "11 محطة", "11 شخصًا"],
  [25, "25 دقيقة", "25 محطة", "25 شخصًا"],
  [100, "100 دقيقة", "100 محطة", "100 شخص"],
  [103, "103 دقائق", "103 محطات", "103 أشخاص"],
];
for (const [n, minutes, stations, people] of cases) {
  assert.equal(minutesCount(n), minutes, `minutes ${n}`);
  assert.equal(stationsCount(n), stations, `stations ${n}`);
  assert.equal(peopleCount(n), people, `people ${n}`);
}
assert.equal(minutesCount(5.6), "6 دقائق", "fractional minutes round before agreement");
assert.equal(minutesText(6), "6 دقائق", "the persona helper shares the same rules");
assert.equal(arCount(1, AR_MINUTE), "دقيقة", "the bare noun stays available for «بعد دقيقة»");
assert.equal(arCount(4, AR_MINUTE, (value) => value.toLocaleString("ar-SA")), "٤ دقائق");

const brief = (totalWalkMin) => describeWalkingBrief({ targetId: "a", targetName: "الزرافات", originName: "أفريقيا", totalWalkMin, via: [], avoided: [], crowdedOnRoute: [], sameZone: false });
assert.match(brief(6), /حوالي 6 دقائق مشي/, "walking briefs no longer say «6 دقيقة»");
assert.doesNotMatch(brief(6), /6 دقيقة/);
assert.match(brief(1), /حوالي دقيقة واحدة مشي/);
assert.match(brief(2), /حوالي دقيقتين مشي/);
assert.match(brief(14), /حوالي 14 دقيقة مشي/);

// «أنا ← وقتك» used to say «3 ساعة».
for (const [minutes, text] of [[20, "نص ساعة"], [30, "نص ساعة"], [60, "ساعة"], [90, "ساعة ونص"], [120, "ساعتين"], [150, "ساعتين ونص"], [180, "3 ساعات"], [210, "3 ساعات ونص"], [240, "4 ساعات"], [660, "11 ساعة"], [100, "ساعة ونص"], [110, "ساعتين"]]) {
  assert.equal(hoursCount(minutes), text, `hours for ${minutes} minutes`);
}

console.log("arabic counts: 1, 2, 3–10, 11+, 100s and visit hours agree");
