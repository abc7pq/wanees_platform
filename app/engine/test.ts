// اختبارات المحرك — حالات مطابقة لمرجع Python
import { Site, defaultProfile } from "./site.ts";
import { catalogData } from "../data/catalog.ts";
import { buildRoute, replan, fmtTime, hasStaleDelay } from "./route.ts";
import type { Catalog, CrowdEvent, Itinerary, Profile } from "./types.ts";
import { firstFutureDemoStop } from "../lib/demo-event-target.ts";
import { resolveChatTarget } from "../lib/chat-target.ts";

import { calculateCrowdObservation } from "../../packages/engine/src/crowd-observation.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures++;
    console.error(`  ❌ ${name} ${detail}`);
  }
}

// ---- Sequence-aware selection: quality, walking time, variety, and must-include priority
{
  const sequenceCatalog = {
    meta: { source: "sequence-test", note: "", currency: "SAR" },
    site: {
      name: "Sequence test venue",
      walking_speed_m_per_min: 60,
      min_walk_min: 1,
      opening: { from: 0, to: 1440 },
      crowd_threshold: 0.75,
      base_crowd_curve: {},
    },
    zones: [
      { id: "gate", name: "Gate", x: 0, y: 0, popularity: 0.5 },
      { id: "near", name: "Near", x: 10, y: 0, popularity: 0.5 },
      { id: "far", name: "Far", x: 600, y: 0, popularity: 0.5 },
    ],
    activities: [
      { id: "near-show", name: "Near show", zone: "near", type: "show", duration_min: 20, price: 0, family: true, interests: ["fun"], moods: ["fun"], popularity: 0.8, schedule: { type: "continuous" as const, from: 0, to: 1440 } },
      { id: "near-show-2", name: "Near show 2", zone: "near", type: "show", duration_min: 20, price: 0, family: true, interests: ["fun"], moods: ["fun"], popularity: 0.8, schedule: { type: "continuous" as const, from: 0, to: 1440 } },
      { id: "near-culture", name: "Near culture", zone: "near", type: "culture", duration_min: 20, price: 0, family: true, interests: ["fun"], moods: ["fun"], popularity: 0.8, schedule: { type: "continuous" as const, from: 0, to: 1440 } },
      { id: "far-show", name: "Far show", zone: "far", type: "show", duration_min: 20, price: 0, family: true, interests: ["fun"], moods: ["fun"], popularity: 0.8, schedule: { type: "continuous" as const, from: 0, to: 1440 } },
      { id: "must-have", name: "Must have", zone: "far", type: "culture", duration_min: 20, price: 0, family: true, interests: ["rare"], moods: ["quiet"], popularity: 0.1, schedule: { type: "continuous" as const, from: 0, to: 1440 } },
    ],
  };
  const sequenceSite = new Site(sequenceCatalog);
  const baseSequenceProfile: Profile = {
    mood: "fun",
    budget: null,
    companions_kids: false,
    companions_adults: 1,
    interests: ["fun"],
    start_min: 60,
    duration_min: 100,
    start_zone: "gate",
    must_include: [],
    avoid: [],
  };
  const varied = buildRoute(sequenceSite, baseSequenceProfile);
  check("sequence route prefers a nearby first stop", varied.stops[0]?.act_id === "near-show", `first=${varied.stops[0]?.act_id}`);
  check("sequence route avoids repeating the same zone when an equal alternative exists", new Set(varied.stops.map((stop) => stop.zone)).size >= 2, `zones=${varied.stops.map((stop) => stop.zone).join(",")}`);
  check("sequence route records walking time", varied.stops[0]?.walk_min === 1, `walk=${varied.stops[0]?.walk_min}`);
  const mustInclude = buildRoute(sequenceSite, { ...baseSequenceProfile, must_include: ["must-have"], interests: ["fun"] });
  check("must-include remains selected despite lower quality", mustInclude.stops.some((stop) => stop.act_id === "must-have"));
}

// ---- Demo events must target stops still upcoming after the clock advances
{
  const stops = [
    { act_id: "current-after-tick", zone: "planet", start: 1085 },
    { act_id: "still-upcoming", zone: "culture", start: 1110 },
  ];
  const target = firstFutureDemoStop(stops, 1080, 20);
  check("demo event selects stop future after clock advance", target?.act_id === "still-upcoming");
  check("no target when every stop becomes current or past", firstFutureDemoStop(stops, 1080, 40) === undefined);
}


// ---- Chat target resolution must fail closed unless explicit or exact
{
  const stops = [{ act_id: "first", start: 100 }, { act_id: "second", start: 120 }, { act_id: "completed", start: 80 }];
  const activities = new Map([["first", { name: "العجلة" }], ["second", { name: "القارب" }], ["completed", { name: "المنطاد" }], ["not-planned", { name: "السفينة" }]]);
  const original = stops.map((stop) => ({ ...stop }));
  const unresolved = resolveChatTarget("احذف شيء", undefined, stops, activities, 90);
  check("unrecognized target does not resolve to first future stop", unresolved === null);
  check("unrecognized remove target leaves itinerary unchanged", unresolved === null && JSON.stringify(stops) === JSON.stringify(original));
  check("explicit next-stop wording resolves first future stop", resolveChatTarget("احذف القادم", undefined, stops, activities, 90) === "first");
  check("exact activity name resolves requested target", resolveChatTarget("احذف القارب", undefined, stops, activities, 90) === "second");
  check("catalog ID outside itinerary does not resolve", resolveChatTarget("احذف", "not-planned", stops, activities, 90) === null);
  check("catalog name outside itinerary does not resolve", resolveChatTarget("احذف السفينة", undefined, stops, activities, 90) === null);
  check("completed itinerary activity does not resolve by ID", resolveChatTarget("احذف", "completed", stops, activities, 90) === null);
  check("completed itinerary activity does not resolve by name", resolveChatTarget("احذف المنطاد", undefined, stops, activities, 90) === null);
  check("explicit next skips completed stops", resolveChatTarget("احذف اللي بعده", undefined, stops, activities, 90) === "first");
  const rejectedTarget = resolveChatTarget("احذف السفينة", undefined, stops, activities, 90);
  check("rejected target leaves itinerary unchanged", rejectedTarget === null && JSON.stringify(stops) === JSON.stringify(original));
}

// ---- حالة 1: عائلة بأطفال، ميزانية 300، 3 ساعات
console.log("\nحالة 1: عائلة (أطفال) · 300 ريال · 3 ساعات");
{
  const site = new Site(catalogData);
  const p: Profile = {
    ...defaultProfile(),
    mood: "مرح",
    budget: 300,
    companions_kids: true,
    interests: ["عائلة", "عروض", "طعام"],
  };
  const it = buildRoute(site, p);
  check("المسار غير فارغ", it.stops.length >= 3, `stops=${it.stops.length}`);
  check("ضمن الميزانية", it.total_cost <= 300, `cost=${it.total_cost}`);
  check("كل الأنشطة عائلية", it.stops.every((s) => site.activities.get(s.act_id)!.family));
  check("لا تجاوز وقت الزيارة", it.stops.every((s) => s.end <= p.start_min + p.duration_min));
  check("بلا تضارب زمني", it.stops.every((s, i) => i === 0 || s.start >= it.stops[i - 1].end));
  console.log(
    it.stops
      .map((s) => `     ${fmtTime(s.start)}–${fmtTime(s.end)} ${s.name} (${s.price} ريال)`)
      .join("\n")
  );
}

// ---- حالة 2: مغامر لحاله، بلا ميزانية، 4 ساعات
console.log("\nحالة 2: مغامر · بلا ميزانية · 4 ساعات");
{
  const site = new Site(catalogData);
  const p: Profile = {
    ...defaultProfile(),
    mood: "متحمس",
    budget: null,
    duration_min: 240,
    interests: ["مغامرة", "ألعاب"],
  };
  const it = buildRoute(site, p);
  const thrillish = it.stops.every((s) => {
    const a = site.activities.get(s.act_id)!;
    return a.moods.includes("متحمس") || a.interests.some((i) => p.interests.includes(i));
  });
  check("المسار غير فارغ", it.stops.length >= 4, `stops=${it.stops.length}`);
  check("متوافق مع الاهتمامات/المزاج", thrillish);
  console.log(
    it.stops
      .map((s) => `     ${fmtTime(s.start)}–${fmtTime(s.end)} ${s.name}`)
      .join("\n")
  );
}

// ---- حالة 3: إعادة تخطيط عند ازدحام وتأخير عرض
console.log("\nحالة 3: ازدحام مفاجئ + تأخير عرض");
{
  const site = new Site(catalogData);
  const p: Profile = {
    ...defaultProfile(),
    mood: "متحمس",
    interests: ["مغامرة", "عروض"],
    duration_min: 240,
  };
  const it0 = buildRoute(site, p);
  const now = p.start_min + 60;
  const future = it0.stops.filter((s) => s.start > now);
  check("يوجد أنشطة مستقبلية لإعادة التخطيط", future.length >= 1);
  const firstFuture = future[0];
  const originalStart = firstFuture.start; // قبل إعادة التخطيط
  const delayEvents: any[] = [{ type: "delay", activity: firstFuture.act_id, minutes: 30 }];
  const it1 = replan(site, p, it0, now, delayEvents);
  const kept = it1.stops.find((s) => s.act_id === firstFuture.act_id);
  check("النشاط المتأخر محفوظ بوقت مؤجل", kept !== undefined && kept!.start === originalStart + 30);
  check("شرح موجود", it1.explanations.some((e) => e.includes("تأخر")));
  // زحام في منطقة القادم الثانية → يجب أن يظهر تأثير أو بديل
  const second = it1.stops.filter((s) => s.start > now)[1];
  if (second) {
    const it2 = replan(site, p, it1, now, [
      { type: "crowd_spike", zone: second.zone, level: 0.95 },
    ]);
    check("إعادة التخطيط تعمل مع زحام", it2.stops.length >= 1);
    check("شرح الزحام موجود", it2.explanations.some((e) => e.includes("ازدحام")));
  }
}

// ---- حالة 4: موازنة الحمل — التقييم يعاقب المناطق المشبعة
console.log("\nحالة 4: موازنة الحمل التشغيلي");
{
  const site = new Site(catalogData);
  const p: Profile = { ...defaultProfile(), mood: "متحمس", interests: ["مغامرة"] };
  const gamesZone = "games2"; // غير موجود — استخدم منطقة حقيقية مشبعة
  // فرض ازدحام كامل على منطقة funzone
  site.applyEvents([{ type: "crowd_spike", zone: "funzone", level: 0.99, until_hour: 23 }], 1200);
  const factor = site.zoneLoadFactor("funzone", 1200 + 90);
  check("منطقة فوق العتبة لها عقوبة موجبة", factor > 0, `factor=${factor}`);
  const it = buildRoute(site, p);
  const funzoneStops = it.stops.filter((s) => s.zone === "funzone").length;
  check(
    "المحرك يقلل الأنشطة في المنطقة المشبعة",
    it.stops.length === 0 || funzoneStops <= 1,
    `funzoneStops=${funzoneStops}`
  );
}

console.log(failures === 0 ? "\n🎉 كل الاختبارات ناجحة" : `\n💥 ${failures} اختبار فاشل`);

// ---- Sequence-aware route quality: walking, repetition, and must-include priority
console.log("\nSequence-aware route quality");
{
  const site = new Site(catalogData);
  const p: Profile = {
    ...defaultProfile(),
    duration_min: 240,
    interests: [],
    must_include: ["dolphinarium"],
  };
  const it = buildRoute(site, p);
  const activities = it.stops.map((stop) => site.activities.get(stop.act_id)!);
  const totalWalk = it.stops.reduce((sum, stop) => sum + stop.walk_min, 0);
  const adjacentZoneRepeats = it.stops.filter((stop, index) => index > 0 && stop.zone === it.stops[index - 1].zone).length;
  const adjacentTypeRepeats = activities.filter((activity, index) => index > 0 && activity.type === activities[index - 1].type).length;
  check("must-include activity is retained", it.stops.some((stop) => stop.act_id === "dolphinarium"));
  check("route stays within a bounded walking budget", totalWalk <= 60, `walk=${totalWalk}`);
  check("route avoids consecutive zone repetition", adjacentZoneRepeats === 0, `repeats=${adjacentZoneRepeats}`);
  check("route avoids consecutive experience-type repetition", adjacentTypeRepeats === 0, `repeats=${adjacentTypeRepeats}`);
  check("sequence remains useful", it.score > 200 && it.stops.length >= 4, `score=${it.score} stops=${it.stops.length}`);
}


{
  const activity = (id: string, zone: string) => ({
    id, zone, name: id, duration_min: 15, price: 20, family: true,
    interests: ["عائلة"], moods: [], popularity: 0.8, type: "ride",
    schedule: { type: "continuous" as const, from: 1080, to: 1200 },
  });
  const catalog: Catalog = {
    ...catalogData,
    zones: [{ id: "hot", name: "مزدحمة", x: 0, y: 0, popularity: 1 }, { id: "calm", name: "أهدأ", x: 60, y: 0, popularity: 1 }],
    activities: [activity("start", "hot"), activity("alternative", "calm")],
  };
  const profile: Profile = { ...defaultProfile(), start_zone: "hot", start_min: 1080, duration_min: 30, budget: 20 };
  const itinerary: Itinerary = {
    stops: [{ act_id: "start", zone: "hot", start: 1085, end: 1100, price: 20, walk_min: 0, wait_min: 0, name: "start", note: "" }],
    unfulfilled: [], explanations: [], score: 0, total_cost: 20,
  };
  const readings: CrowdEvent[] = [
    { type: "crowd_spike", zone: "hot", level: 0.93, measured: true },
    { type: "crowd_spike", zone: "calm", level: 0.2, measured: true },
  ];
  const candidate = replan(new Site(catalog), profile, itinerary, 1080, readings);
  check("a measured lower-load zone replaces the crowded stop within time and budget", candidate.stops.length === 1 && candidate.stops[0].act_id === "alternative" && candidate.total_cost === 20);
  check("a crowd proposal leaves the original itinerary unchanged", itinerary.stops[0].act_id === "start");
  const unchanged = replan(new Site(catalog), profile, itinerary, 1080, readings.slice(0, 1));
  check("crowd routing keeps the original when no calmer zone has a current measurement", unchanged.stops[0].act_id === "start");
  const observation = calculateCrowdObservation(86, 100, 12);
  check("crowd counts use approved capacity and preserve observed waiting time", observation?.level === 0.86 && observation.waitMinutes === 12);
  check("missing capacity and invalid counts cannot produce observations", calculateCrowdObservation(20, null, 3) === null && calculateCrowdObservation(-1, 100, 3) === null);
}

// ---- Family planning: party size, youngest child's age, meal cap and shows
console.log("\nFamily planning: party size, ages, meals, shows");
{
  const always = { type: "continuous" as const, from: 0, to: 1440 };
  const familyCatalog = {
    meta: { source: "family-test", note: "", currency: "SAR" },
    site: { name: "Family test venue", walking_speed_m_per_min: 60, min_walk_min: 1, opening: { from: 0, to: 1440 }, crowd_threshold: 0.75, base_crowd_curve: {} },
    zones: [{ id: "gate", name: "Gate", x: 0, y: 0, popularity: 0.5 }, { id: "plaza", name: "Plaza", x: 30, y: 0, popularity: 0.5 }],
    activities: [
      { id: "lions", name: "Lions", zone: "plaza", type: "wildlife", duration_min: 20, price: 40, family: true, min_age: 6, interests: ["طبيعة"], moods: ["مرح"], popularity: 0.9, schedule: always },
      { id: "coaster", name: "Coaster", zone: "plaza", type: "ride", duration_min: 10, price: 40, family: true, min_age: 12, interests: ["مغامرة"], moods: ["مرح"], popularity: 0.9, schedule: always },
      { id: "burger", name: "Burger", zone: "gate", type: "food", duration_min: 30, price: 30, family: true, interests: ["طعام"], moods: ["مرح"], popularity: 0.9, schedule: always },
      { id: "pizza", name: "Pizza", zone: "plaza", type: "food", duration_min: 30, price: 30, family: true, interests: ["طعام"], moods: ["مرح"], popularity: 0.9, schedule: always },
      { id: "parade", name: "Parade", zone: "plaza", type: "show", duration_min: 20, price: 0, family: true, interests: ["عروض"], moods: ["هادئ"], popularity: 0.3, schedule: always },
      { id: "carousel", name: "Carousel", zone: "gate", type: "ride", duration_min: 10, price: 10, family: true, interests: ["عائلة"], moods: ["مرح"], popularity: 0.5, schedule: always },
    ],
  };
  const familySite = new Site(familyCatalog);
  const family: Profile = {
    mood: "مرح", budget: null, companions_kids: true, companions_adults: 2, interests: ["طبيعة", "مغامرة", "طعام", "عائلة"],
    start_min: 600, duration_min: 180, start_zone: "gate", must_include: [], avoid: [],
  };
  const ids = (it: Itinerary) => it.stops.map((stop) => stop.act_id);

  const unknownAge = buildRoute(familySite, family);
  check("kids with unknown ages skip every age-limited activity", !ids(unknownAge).includes("lions") && !ids(unknownAge).includes("coaster"), ids(unknownAge).join(","));

  const nineYearOld = buildRoute(familySite, { ...family, youngest_child_age: 9 });
  check("a 9-year-old can join a 6+ activity", ids(nineYearOld).includes("lions"), ids(nineYearOld).join(","));
  check("a 9-year-old still skips a 12+ activity", !ids(nineYearOld).includes("coaster"), ids(nineYearOld).join(","));

  check("a 3-hour visit gets at most one meal", ids(nineYearOld).filter((id) => id === "burger" || id === "pizza").length <= 1, ids(nineYearOld).join(","));

  const showLover = buildRoute(familySite, { ...family, youngest_child_age: 9, interests: [...family.interests, "عروض"] });
  check("asking for shows puts a show in the plan when one fits", ids(showLover).includes("parade"), ids(showLover).join(","));

  const groupBudget = buildRoute(familySite, { ...family, youngest_child_age: 9, budget: 160, party_size: 4 });
  check("the budget covers the whole group (price × party size)", groupBudget.total_cost * 4 <= 160, `perHead=${groupBudget.total_cost}`);
  check("a group-budget plan explains the group total", groupBudget.explanations.some((line) => line.includes("لـ4 أشخاص")), groupBudget.explanations.join(" | "));
  check("the explanation uses «بمشي», not «بمشيه»", groupBudget.explanations.every((line) => !line.includes("بمشيه")));
  const soloBudget = buildRoute(familySite, { ...family, youngest_child_age: 9, budget: 160 });
  check("without a party size the budget stays per head (existing sessions unchanged)", soloBudget.total_cost <= 160 && soloBudget.total_cost > groupBudget.total_cost, `solo=${soloBudget.total_cost} group=${groupBudget.total_cost}`);

  // A timed show later in the evening must not make the plan idle while waiting for it.
  const timedShowSite = new Site({
    ...familyCatalog,
    activities: [
      ...familyCatalog.activities.filter((activity) => activity.id !== "parade"),
      { id: "dolphins", name: "Dolphins", zone: "plaza", type: "show", duration_min: 30, price: 0, family: true, interests: ["عروض"], moods: ["مرح"], popularity: 0.9, schedule: { type: "slots" as const, slots: [660] } },
    ],
  });
  const timed = buildRoute(timedShowSite, { ...family, youngest_child_age: 9, interests: [...family.interests, "عروض"] });
  check("a later show slot is still included", ids(timed).includes("dolphins"), ids(timed).join(","));
  check("the plan fills time before a show instead of waiting for it", timed.stops.every((stop) => stop.wait_min <= 15) && timed.stops.findIndex((stop) => stop.act_id === "dolphins") >= 2, timed.stops.map((stop) => `${stop.act_id}:wait${stop.wait_min}`).join(","));

  // A requested show with a later slot reserves it: the plan fills the time before it, never idles.
  const requested = buildRoute(timedShowSite, { ...family, youngest_child_age: 9, must_include: ["dolphins"] });
  check("a requested later show is in the plan", ids(requested).includes("dolphins"), ids(requested).join(","));
  check("the time before a requested show is filled, not idle", requested.stops.every((stop) => stop.wait_min <= 15) && requested.stops.findIndex((stop) => stop.act_id === "dolphins") >= 1, requested.stops.map((stop) => `${stop.act_id}:wait${stop.wait_min}`).join(","));

  // QA B6: a family plan must not stop with most of the evening unused while fitting options remain.
  {
    const qa: Profile = { mood: "هادئ", budget: 300, companions_kids: true, companions_adults: 2, party_size: 4, youngest_child_age: 7, interests: ["طبيعة", "عروض"], start_min: 1020, duration_min: 180, start_zone: "africa", must_include: [], avoid: [] };
    const filled = buildRoute(new Site(catalogData), qa);
    const used = (filled.stops.at(-1)?.end ?? qa.start_min) - qa.start_min;
    check("a 3-hour family plan uses at least 75% of the visit when fitting options remain", used >= 0.75 * qa.duration_min, `used ${used} of ${qa.duration_min} min, ${filled.stops.length} stops`);
    check("the filled plan still respects the group budget", filled.total_cost * 4 <= 300, `perHead=${filled.total_cost}`);
  }

  // Deck story on a full plan: a requested show whose only slot is mid-visit is inserted there once
  // the stops in that slot are skipped, instead of being appended after the last stop and lost.
  {
    const site = new Site(catalogData);
    const deck: Profile = { budget: 300, companions_kids: true, companions_adults: 2, youngest_child_age: null, interests: ["عائلة", "طبيعة", "عروض"], start_min: 1020, duration_min: 180, start_zone: "lagoon", must_include: [], avoid: [] };
    const full = buildRoute(site, deck);
    const inSlot = full.stops.filter((stop) => stop.start < 1150 && stop.end > 1110);
    const withShow = replan(site, deck, structuredClone(full), 1020, [
      ...inSlot.map((stop) => ({ type: "user_skip", activity: stop.act_id }) as const),
      { type: "user_add", activity: "dolphinarium" },
    ]);
    const show = withShow.stops.find((stop) => stop.act_id === "dolphinarium");
    check("a requested mid-visit show is inserted into a full plan once its slot is freed", show?.start === 1110, `plan=${full.stops.map((stop) => `${fmtTime(stop.start)} ${stop.act_id}`).join(" | ")}`);
    check("the inserted show keeps the plan inside the visit and budget", withShow.stops.every((stop) => stop.end <= 1200) && withShow.total_cost <= 300);
  }

  const replanned = replan(familySite, { ...family, youngest_child_age: 9, budget: 160, party_size: 4 }, groupBudget, 600, [{ type: "user_shorten" }]);
  check("replanning keeps the group budget", replanned.total_cost * 4 <= 160, `perHead=${replanned.total_cost}`);
}

// ---- A revoked delay moves the stop back; add requests explain the time or the reason
console.log("\nRevoked delays and add explanations");
{
  const site = new Site(catalogData as Catalog);
  const profile = { ...defaultProfile(), companions_kids: true, budget: 300, interests: ["عروض", "طبيعة"], start_zone: "africa", start_min: 1020, duration_min: 180 } as Profile;
  const plan = buildRoute(site, profile);
  const target = plan.stops[1];
  const delayed = replan(new Site(catalogData as Catalog), profile, structuredClone(plan), 1020, [{ type: "delay", activity: target.act_id, minutes: 25 } as CrowdEvent]);
  const delayedStop = delayed.stops.find((stop) => stop.act_id === target.act_id)!;
  check("a delay shifts the stop by its minutes", delayedStop.start === target.start + 25, `${target.start} → ${delayedStop.start}`);
  check("a delayed stop with no live delay event is stale", hasStaleDelay(delayed, 1020, []));
  check("a delayed stop whose delay is still live is not stale", !hasStaleDelay(delayed, 1020, [{ type: "delay", activity: target.act_id, minutes: 25 } as CrowdEvent]));
  const restored = replan(new Site(catalogData as Catalog), profile, structuredClone(delayed), 1020, []);
  const restoredStop = restored.stops.find((stop) => stop.act_id === target.act_id);
  check("a revoked delay moves the stop back to its original time", restoredStop?.start === target.start && restoredStop?.note === "", `${restoredStop?.start} note=${restoredStop?.note}`);
  check("the revert is explained to the visitor", restored.explanations.some((line) => line.startsWith("انتهى تأخير")));

  const added = replan(new Site(catalogData as Catalog), profile, structuredClone(plan), 1020, [{ type: "user_add", activity: "dolphinarium" }]);
  const show = added.stops.find((stop) => stop.act_id === "dolphinarium");
  if (show) check("an accepted add names its time", added.explanations.some((line) => line.includes("عرض الدولفيناريوم") && line.includes(fmtTime(show.start))), added.explanations.at(-1));
  const late = { ...profile, start_min: 1300, duration_min: 60 } as Profile;
  const refused = replan(new Site(catalogData as Catalog), late, structuredClone(buildRoute(site, late)), 1300, [{ type: "user_add", activity: "dolphinarium" }]);
  check("a show whose next slot ends after the visit gets an exact reason", refused.explanations.some((line) => line.includes("أقرب عرض الساعة") || line.includes("ما بقي له عروض")), refused.explanations.at(-1));
}

process.exit(failures === 0 ? 0 : 1);
