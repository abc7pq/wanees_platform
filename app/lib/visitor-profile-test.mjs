import assert from "node:assert/strict";
import { catalogData } from "../data/catalog.ts";
import { buildRoute } from "../engine/route.ts";
import { Site } from "../engine/site.ts";
import { profileFromPreferences, resolveVisitWindow, visitNowMinute } from "./visitor-profile.ts";

const site = new Site(catalogData);
const OPENING = 17 * 60; // 1020 — كتالوج بوليفارد: opening 17→24
const CLOSING = 24 * 60; // 1440

// 1) وصول متأخر جدًا (23:38): ينتقل تلقائيًا لافتتاحية اليوم التالي بمدة كاملة — لا خطة فارغة
const lateNight = profileFromPreferences(catalogData, { availableMinutes: 120, mood: "هادئ", interests: ["طعام"] }, 1418);
assert.equal(lateNight.start_min, OPENING, "post-cutoff arrival must roll to next-day opening");
assert.equal(lateNight.duration_min, 120, "rolled plan keeps the full requested duration");
assert.ok(buildRoute(site, lateNight).stops.length > 0, "rolled plan actually builds stops");

// 2) مساء (23:00): تبقى خطة الليلة مقصوصة على المتبقي حتى الإغلاق
const evening = profileFromPreferences(catalogData, { availableMinutes: 120 }, 1380);
assert.equal(evening.start_min, 1380, "evening plan stays tonight");
assert.equal(evening.duration_min, 60, "duration clamps to the minutes remaining before closing");

// 3) نهارًا: لا تغيير على السلوك القديم
const daytime = profileFromPreferences(catalogData, { availableMinutes: 120 }, 1100);
assert.equal(daytime.start_min, 1100);
assert.equal(daytime.duration_min, 120);

// 4) قيمة زمنية بعد الإغلاق (بيانات قديمة/حساسة للمنطقة الزمنية): ينتقل للافتتاحية
const pastClosing = profileFromPreferences(catalogData, { availableMinutes: 90 }, 1450);
assert.equal(pastClosing.start_min, OPENING);
assert.equal(pastClosing.duration_min, 90);

// 5) الافتراضي بدون تفضيلات: يبدأ من الافتتاحية ويقص إلى نافذة العمل
const defaults = profileFromPreferences(catalogData, null);
assert.equal(defaults.start_min, OPENING);
assert.ok(defaults.duration_min <= CLOSING - OPENING + 1);

// 6) النافذة ودقيقة «الآن» الفعالة تنتقلان معًا — حتى تعامل الإغلاق العاجل المحطات كقادمة
const rolledWindow = resolveVisitWindow(catalogData, { availableMinutes: 120 }, 1418);
assert.equal(rolledWindow.profile.start_min, OPENING);
assert.equal(rolledWindow.effectiveNowMinute, OPENING, "rolled plan shifts the effective clock with the window");
const normalWindow = resolveVisitWindow(catalogData, { availableMinutes: 120 }, 1380);
assert.equal(normalWindow.effectiveNowMinute, 1380, "non-rolled plan keeps the real clock minute");

console.log("visitor-profile late-night policy: all assertions passed");

// 5) Group size and youngest child's age reach the planner; older sessions keep the old behaviour.
const familyPrefs = profileFromPreferences(catalogData, { companions: "عائلة وأطفال", partySize: 4, youngestChildAge: 9 }, 1100);
assert.equal(familyPrefs.companions_kids, true);
assert.equal(familyPrefs.party_size, 4, "party size is carried into the profile");
assert.equal(familyPrefs.youngest_child_age, 9, "youngest child's age is carried into the profile");
const legacyFamily = profileFromPreferences(catalogData, { companions: "عائلة وأطفال" }, 1100);
assert.equal(legacyFamily.party_size, undefined, "no party size → per-head budget as before");
assert.equal(legacyFamily.youngest_child_age, null, "no age → age-limited activities stay excluded");
const ageOnly = profileFromPreferences(catalogData, { youngestChildAge: 5 }, 1100);
assert.equal(ageOnly.companions_kids, true, "a child's age implies children in the group");
console.log("visitor-profile party and age mapping ✓");

// 6) A visit in progress: its saved start never moves, so "now" follows the event clock inside the window.
const savedVisit = resolveVisitWindow(catalogData, { availableMinutes: 180, startMinute: 1140 }, 1140);
assert.equal(visitNowMinute(savedVisit, 1215), 1215, "an ongoing visit plans from the live clock, not the saved start");
assert.equal(visitNowMinute(savedVisit, 1100), 1140, "before the visit starts, now is the visit start");
assert.equal(visitNowMinute(savedVisit, 1400), 1140, "after the visit window, keep the saved start");
assert.equal(visitNowMinute(rolledWindow, 1430), OPENING, "a rolled visit keeps the next-day opening");
console.log("visitor-profile live clock inside the visit ✓");
