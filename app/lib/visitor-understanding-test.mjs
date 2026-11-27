import assert from "node:assert/strict";
import {
  applyUnderstanding, assumptionLine, decodeLikes, detectReplyLanguage, followUpQuestion, mergeModelUnderstanding, planAssumptions, understandMessage,
} from "./visitor-understanding.ts";

// Audit item 1.2: a 30-sentence corpus (Saudi dialect, English, mixed) gives the expected profile
// from the deterministic reader alone, i.e. without the AI key.
const like = (who, tag) => ({ who, tag });
const CORPUS = [
  ["معي عيالي", { party: "family", hasChildren: true, wantsPlan: true }],
  ["طلعة شباب", { party: "friends", wantsPlan: true }],
  ["عندي ساعتين بس", { availableMinutes: 120, wantsPlan: true }],
  ["أبي شي هادي", { mood: "هادئ", wantsPlan: true }],
  ["ابي مسار", { wantsPlan: true }],
  ["وش أسوي؟", { wantsPlan: true }],
  ["معي ولدي عمره 6 سنين ويحب الطيارات", { party: "family", childAges: [6], likes: [like("son", "طيران")] }],
  ["بنتي عمرها ٤ تحب الحيوانات وولدي ٩ سنين يحب السيارات", { childAges: [4, 9], likes: [like("daughter", "حيوانات"), like("son", "سيارات")] }],
  ["احنا 5 أشخاص ونحب العروض", { partySize: 5, likes: [like("group", "عروض")] }],
  ["أنا وزوجتي نبي عشاء رايق", { party: "couple", mood: "هادئ", likes: [like("group", "أكل")] }],
  ["لحالي وأحب الأنمي", { party: "solo", likes: [like("self", "أنمي")] }],
  ["ميزانيتي 200 ريال", { budgetSar: 200 }],
  ["نبي شي رخيص للعيال", { budgetLevel: "low", party: "family" }],
  ["بدون رعب الله يخليك", { avoidTags: ["رعب"] }],
  ["الشباب يحبون الإثارة والرماية", { party: "friends", likes: [like("friends", "إثارة"), like("friends", "رماية")] }],
  ["معنا كرسي متحرك", { mobility: "wheelchair" }],
  ["معي عربية أطفال وطفل عمره سنتين", { mobility: "stroller", childAges: [2], party: "family" }],
  ["عندنا ساعة ونص", { availableMinutes: 90 }],
  ["لين يسكرون", { untilClosing: true }],
  ["ولدي يحب الكورة", { likes: [like("son", "كورة")] }],
  ["I'm here with my kids, my son is 7 and loves planes", { party: "family", childAges: [7], likes: [like("son", "طيران")], language: "en" }],
  ["We are 4 friends looking for thrills", { party: "friends", partySize: 4, likes: [like("group", "إثارة")], language: "en" }],
  ["Just me, I have 2 hours and love history", { availableMinutes: 120, likes: [like("self", "تاريخ")], language: "en" }],
  ["Something calm, no horror please", { mood: "هادئ", avoidTags: ["رعب"], language: "en" }],
  ["My daughter is 5 and loves animals", { childAges: [5], likes: [like("daughter", "حيوانات")], language: "en" }],
  ["budget 300 riyals", { budgetSar: 300, language: "en" }],
  ["ابي plan للعيال", { party: "family", wantsPlan: true, language: "ar" }],
  ["ولدي يحب anime", { likes: [like("son", "أنمي")], language: "ar" }],
  ["معي ربعي ونبي VR وألعاب", { party: "friends", likes: [like("friends", "واقع افتراضي"), like("friends", "ألعاب")] }],
  ["Bonjour, nous sommes une famille avec deux enfants", { language: "fr" }],
];
assert.equal(CORPUS.length, 30);
for (const [sentence, expected] of CORPUS) {
  const understood = understandMessage(sentence);
  for (const [key, value] of Object.entries(expected)) {
    if (key === "likes") {
      for (const item of value) assert.ok(understood.likes.some((like) => like.who === item.who && like.tag === item.tag), `${sentence}: expected like ${item.who}:${item.tag}, got ${JSON.stringify(understood.likes)}`);
    } else {
      assert.deepEqual(understood[key], value, `${sentence}: ${key}`);
    }
  }
}

// «معي عيالي» says who is coming; it is not an interest in children's activities.
assert.deepEqual(understandMessage("معي عيالي").likes, []);
// Interests with no tag are kept as the visitor's words, never mapped to something else.
assert.deepEqual(understandMessage("ولدي يحب الديناصورات").unmatched, ["الديناصورات"]);
assert.deepEqual(understandMessage("ولدي يحب الديناصورات").likes, []);
// Greetings carry no plan intent.
assert.equal(understandMessage("هلا والله").wantsPlan, false);

// Language: Saudi Arabic by default; a foreign word inside Arabic does not switch; a full message does.
assert.equal(detectReplyLanguage("هلا"), "ar");
assert.equal(detectReplyLanguage("ابي VR"), "ar");
assert.equal(detectReplyLanguage("where are the restrooms?"), "en");
assert.equal(detectReplyLanguage("ok", "en"), "en");
assert.equal(detectReplyLanguage("👍", "en"), "en");
assert.equal(detectReplyLanguage("تمام", "en"), "ar");
assert.equal(detectReplyLanguage("Où sont les toilettes s'il vous plaît"), "fr");
assert.equal(detectReplyLanguage("مجھے کھانا چاہیے کہاں ہے"), "ur");

// The model may add only what the visitor's words support.
const base = understandMessage("ولدي يموت على الطيارات");
const merged = mergeModelUnderstanding("ولدي يموت على الطيارات", { ...base, likes: [] }, {
  party: "family", partySize: null, childAges: [8], budgetSar: 500, availableMinutes: null, mood: null, mobility: null,
  likes: [{ who: "son", tag: "طيران", evidence: "الطيارات" }, { who: "son", tag: "رعب", evidence: "بيت الرعب" }, { who: "son", tag: "سيارات", evidence: "الطيارات" }],
  unmatched: ["كرة السلة"], avoidTags: [],
});
assert.deepEqual(merged.likes, [{ who: "son", tag: "طيران" }]);
assert.deepEqual(merged.childAges, [], "an age the visitor never said is dropped");
assert.equal(merged.budgetSar, null, "a budget the visitor never said is dropped");
assert.deepEqual(merged.unmatched, []);
assert.deepEqual(mergeModelUnderstanding("x", base, { not: "valid" }), base, "invalid model output is ignored");

// Applying: facts accumulate across messages; children imply a family; avoid removes a like.
let prefs = applyUnderstanding(null, understandMessage("معي عيالي")).preferences;
assert.equal(prefs.companions, "عائلة وأطفال");
assert.equal(followUpQuestion(prefs), "كم عمر أصغر طفل معكم؟ عشان أستبعد اللي ما يناسبه.");
const step = applyUnderstanding(prefs, understandMessage("ولدي عمره 6 ويحب الطيران"));
prefs = step.preferences;
assert.deepEqual(prefs.childAges, [6]);
assert.equal(prefs.youngestChildAge, 6);
assert.equal(prefs.partySize, 3);
assert.deepEqual(decodeLikes(prefs.likes), [{ who: "son", tag: "طيران" }]);
assert.ok(step.changed.includes("youngestChildAge") && step.changed.includes("likes"));
assert.equal(followUpQuestion(prefs), null, "ages known: no question");
prefs = applyUnderstanding(prefs, understandMessage("بدون طيران")).preferences;
assert.deepEqual(prefs.likes, []);
assert.deepEqual(prefs.avoidTags, ["طيران"]);
assert.equal(applyUnderstanding(null, understandMessage("لين يسكرون"), 200).preferences.availableMinutes, 200);
assert.equal(applyUnderstanding(null, understandMessage("نبي شي رخيص")).preferences.budgetMaxCents, 10000);

// Assumptions are listed while they are in force, and disappear once the visitor says otherwise.
assert.equal(assumptionLine(planAssumptions(null)), "افترضت: 3 ساعات · بدون رعب · ميزانية متوسطة · بدون أطفال صغار");
assert.equal(assumptionLine(planAssumptions(prefs)), "افترضت: 3 ساعات · ميزانية متوسطة");
assert.deepEqual(planAssumptions(null).map((item) => item.message), ["عندي ساعة بس", "نحب الرعب", "أبي شي رخيص", "معي عيالي"]);
console.log("visitor understanding: 30-sentence corpus and all assertions passed");
