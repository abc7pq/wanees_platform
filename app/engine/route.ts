// محرك المسار — ترجمة حرفية لمنطق engine/route_engine.py
import { Site } from "./site.ts";
import type { Activity, Itinerary, Profile, Stop, CrowdEvent } from "./types.ts";
import { endMin } from "./types.ts";

export function slotStart(act: Activity, earliest: number): number | null {
  const sch = act.schedule;
  const dur = act.duration_min;
  if (sch.type === "slots") {
    for (const s of [...sch.slots].sort((a, b) => a - b)) {
      if (s >= earliest) return s;
    }
    return null;
  }
  if (earliest + dur <= sch.to) return Math.max(sch.from, earliest);
  return null;
}

export function interestScore(act: Activity, p: Profile): number {
  if (!p.interests.length) return 0.45;
  const overlap = act.interests.filter((i) => p.interests.includes(i)).length;
  return overlap / Math.max(1, p.interests.length);
}

function moodScore(act: Activity, p: Profile): number {
  if (!p.mood) return 0.5;
  return act.moods.includes(p.mood) ? 1 : 0.25;
}

export function scoreCandidate(
  site: Site,
  act: Activity,
  start: number,
  waitMin: number,
  p: Profile
): number {
  let s = 60 * interestScore(act, p) + 25 * moodScore(act, p);
  s += 10 * (act.popularity ?? 0.5);
  if (waitMin > 0) s -= Math.min(25, waitMin * 1.2);
  s -= 45 * site.zoneLoadFactor(act.zone, start + Math.floor(act.duration_min / 2));
  return s;
}

function eligible(site: Site, act: Activity, p: Profile): boolean {
  if (act.price_known === false || act.eligibility_known === false || p.avoid.includes(act.id)) return false;
  if (p.companions_kids && !act.family) return false;
  if (act.min_age !== undefined && p.companions_kids) {
    // عمر أصغر طفل معروف: نستبعد فقط ما يتجاوز عمره. غير معروف: نحتاط ونستبعد كل نشاط مقيد بعمر.
    if (p.youngest_child_age == null || act.min_age > p.youngest_child_age) return false;
  }
  return true;
}

/** Number of tickets each stop costs: the whole group, never fewer than one. */
export function partySize(p: Profile): number {
  return Math.max(1, Math.round(p.party_size ?? 1));
}

/** The budget is for the group; `spent` and `price` are per head. */
function budgetOk(p: Profile, spent: number, price: number): boolean {
  if (p.budget == null) return true;
  return (spent + price) * partySize(p) <= p.budget;
}

/** One sit-down meal per three hours keeps a short visit from becoming a food crawl. */
function mealLimit(p: Profile): number {
  return Math.max(1, Math.floor(p.duration_min / 180));
}

function overMealLimit(act: Activity, p: Profile, selected: Activity[]): boolean {
  if (act.type !== "food") return false;
  return selected.filter((item) => item.type === "food").length >= mealLimit(p);
}

/**
 * A visitor who asked for shows should get at least one when one fits. The bonus applies only
 * when the show starts soon, so the plan fills the time before a slot instead of idling for it.
 */
function showBonus(act: Activity, p: Profile, selected: Activity[], waitMin: number): number {
  if (act.type !== "show" || !p.interests.includes("عروض") || waitMin > 15) return 0;
  return selected.some((item) => item.type === "show") ? 0 : 40;
}

/**
 * A route is a sequence, not a bag of independently ranked activities.
 * Penalize repeated zones/types and long transfers while keeping the penalty
 * soft enough that a must-include activity can still win.
 */
function sequencePenalty(act: Activity, selected: Activity[], walkMin: number): number {
  const sameZone = selected.filter((item) => item.zone === act.zone).length;
  const sameType = selected.filter((item) => item.type === act.type).length;
  return Math.min(18, sameZone * 6) + Math.min(6, sameType * 2) + Math.min(18, walkMin * 1.25);
}

function sequenceScore(
  site: Site,
  act: Activity,
  start: number,
  waitMin: number,
  walkMin: number,
  p: Profile,
  selected: Activity[],
): number {
  return scoreCandidate(site, act, start, waitMin, p) - sequencePenalty(act, selected, walkMin) + showBonus(act, p, selected, waitMin);
}

function retimeStops(site: Site, p: Profile, stops: Stop[]): boolean {
  let t = p.start_min;
  let zone = p.start_zone;
  for (const s of stops) {
    const act = site.activities.get(s.act_id)!;
    const arrive = t + site.travelMin(zone, s.zone);
    const st = slotStart(act, arrive);
    if (st === null || st + act.duration_min > endMin(p)) return false;
    s.walk_min = site.travelMin(zone, s.zone);
    s.wait_min = Math.max(0, st - arrive);
    s.start = st;
    s.end = st + act.duration_min;
    t = s.end;
    zone = s.zone;
  }
  return true;
}

function improveOrder(site: Site, p: Profile, stops: Stop[]) {
  let improved = true;
  let passes = 0;
  while (improved && passes < 8) {
    improved = false;
    passes++;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      const prevEnd = i === 0 ? p.start_min : stops[i - 1].end;
      const prevZone = i === 0 ? p.start_zone : stops[i - 1].zone;
      const na = slotStart(
        site.activities.get(b.act_id)!,
        prevEnd + site.travelMin(prevZone, b.zone)
      );
      const bDur = site.activities.get(b.act_id)!.duration_min;
      if (na === null || na + bDur > endMin(p)) continue;
      const nb = slotStart(
        site.activities.get(a.act_id)!,
        na + bDur + site.travelMin(b.zone, a.zone)
      );
      const aDur = site.activities.get(a.act_id)!.duration_min;
      if (nb === null || nb + aDur > endMin(p)) continue;
      const oldCost =
        a.wait_min +
        b.wait_min +
        site.travelMin(prevZone, a.zone) +
        site.travelMin(a.zone, b.zone);
      const newCost =
        na -
        prevEnd -
        site.travelMin(prevZone, b.zone) +
        (nb - na - bDur) +
        site.travelMin(prevZone, b.zone) +
        site.travelMin(b.zone, a.zone);
      if (newCost < oldCost - 2) {
        const snapshot = stops.map((s) => ({ ...s }));
        stops[i] = b;
        stops[i + 1] = a;
        // نقبل التبديل فقط إذا بقي المسار كاملًا ضمن وقت الزيارة
        if (retimeStops(site, p, stops) && stops.every((s) => s.end <= endMin(p))) {
          improved = true;
        } else {
          for (let k = 0; k < stops.length; k++) stops[k] = snapshot[k];
        }
      }
    }
  }
}

export function buildRoute(site: Site, p: Profile): Itinerary {
  const stops: Stop[] = [];
  const explanations: string[] = [];
  let unfulfilled: string[] = [];
  let spent = 0;
  const used = new Set<string>();
  let curZone = p.start_zone;
  let curTime = p.start_min;
  const pending = p.must_include.filter((id) => !p.avoid.includes(id));

  interface Cand {
    score: number;
    aid: string;
    act: Activity;
    st: number;
    walk: number;
    wait: number;
  }

  const candidates = (): Cand[] => {
    const out: Cand[] = [];
    const selected = stops
      .map((stop) => site.activities.get(stop.act_id))
      .filter((item): item is Activity => Boolean(item));
    // A requested timed activity whose next slot is a while away reserves that slot: the time before
    // it is filled only with stops that still let the visitor reach it, instead of idling until it starts.
    const reservations = pending.flatMap((id) => {
      const act = site.activities.get(id);
      if (!act || used.has(id) || !eligible(site, act, p)) return [];
      const arrive = curTime + site.travelMin(curZone, act.zone);
      const st = slotStart(act, arrive);
      return st !== null && st - arrive > 15 ? [{ act, st }] : [];
    });
    for (const [aid, act] of site.activities) {
      if (used.has(aid) || p.avoid.includes(aid)) continue;
      if (!eligible(site, act, p)) continue;
      const isPending = pending.includes(aid);
      if (!isPending && overMealLimit(act, p, selected)) continue;
      const arrive = curTime + site.travelMin(curZone, act.zone);
      const st = slotStart(act, arrive);
      if (st === null || st + act.duration_min > endMin(p)) continue;
      if (!isPending && reservations.some((slot) => st + act.duration_min + site.travelMin(act.zone, slot.act.zone) > slot.st)) continue;
      if (!budgetOk(p, spent, act.price)) continue;
      const walk = site.travelMin(curZone, act.zone);
      const wait = st - arrive;
      let sc = sequenceScore(site, act, st, wait, walk, p, selected);
      if (isPending && wait <= 15) sc += 1000;
      out.push({ score: sc, aid, act, st, walk, wait });
    }
    return out;
  };

  for (;;) {
    const cands = candidates().sort((a, b) => b.score - a.score);
    if (!cands.length) break;
    const best = cands[0];
    // نضمن مسارًا غير فارغ: العتبة تعمل فقط بعد أول 3 محطات
    // After three stops, stop early only if the next option is weak AND little time is left (or it is
    // clearly poor). A requested activity still to come keeps the plan going so its slot is reached.
    const remaining = endMin(p) - curTime;
    const weak = best.score < 30 && stops.length >= 3 && !pending.length;
    if (weak && (remaining < Math.max(30, p.duration_min * 0.25) || best.score < 10)) break;
    stops.push({
      act_id: best.aid,
      zone: best.act.zone,
      start: best.st,
      end: best.st + best.act.duration_min,
      walk_min: best.walk,
      wait_min: best.wait,
      price: best.act.price,
      name: best.act.name,
      note: "",
    });
    used.add(best.aid);
    if (pending.includes(best.aid)) {
      pending.splice(pending.indexOf(best.aid), 1);
      explanations.push(`ضمنا لك «${best.act.name}» لأنك طلبته صراحة.`);
    }
    spent += best.act.price;
    curZone = best.act.zone;
    curTime = best.st + best.act.duration_min;
  }

  unfulfilled = [...pending];
  if (unfulfilled.length) {
    const names = unfulfilled.map((a) => site.activities.get(a)!.name);
    explanations.push(
      "ما قدرنا نضيف: " + names.join("، ") + " — الوقت/الميزانية ما تسمح."
    );
  }

  improveOrder(site, p, stops);

  // «أنشطة ممتازة تبقى غير مكتشفة»: نعلن الجواهر المخفية التي اخترناها بسبب المطابقة
  for (const s of stops) {
    const a = site.activities.get(s.act_id)!;
    if (a.popularity <= 0.6 && interestScore(a, p) >= 0.5) {
      explanations.push(
        `اكتشفنا لك «${a.name}» — تجربة ممتازة ما يعرفها الكثر، ومطابقة لاهتماماتك.`
      );
    }
  }

  // أسباب إيجابية: لماذا هذه المحطات بالذات (لا الاستبعادات فقط)
  if (stops.length) {
    const mood = p.mood ?? "";
    const ranked = stops
      .map((s) => ({ s, a: site.activities.get(s.act_id)! }))
      .filter(({ a }) => interestScore(a, p) > 0 || (mood && a.moods.includes(mood)))
      .sort(
        (x, y) =>
          interestScore(y.a, p) + (mood && y.a.moods.includes(mood) ? 1 : 0) -
          (interestScore(x.a, p) + (mood && x.a.moods.includes(mood) ? 1 : 0))
      )
      .slice(0, 2);
    for (const { s, a } of ranked) {
      const bits: string[] = [];
      const match = a.interests.filter((i) => p.interests.includes(i));
      if (match.length) bits.push(`يطابق ذوقك: ${match.join("، ")}`);
      if (mood && a.moods.includes(mood)) bits.push("على مزاجك الليلة");
      if (bits.length) explanations.push(`اخترنا «${a.name}» لأنه ${bits.join("، ")}.`);
    }
    const walkTotal = stops.reduce((acc, s, i) => (i === 0 ? 0 : acc + s.walk_min), 0);
    const perHead = stops.reduce((acc, s) => acc + s.price, 0);
    const people = partySize(p);
    const groupCost = perHead * people;
    const costText = people > 1 ? `${groupCost} ريال لـ${people} أشخاص` : `${perHead} ريال`;
    explanations.push(
      `رتبنا ${stops.length} محطات بمشي إجمالي ${walkTotal} دقيقة بين المناطق` +
        (p.budget != null ? `، وكلها ضمن ميزانيتك (${costText}).` : ".")
    );
  }

  const score = evaluate(site, p, stops);
  const totalCost = stops.reduce((s, x) => s + x.price, 0);
  return { stops, unfulfilled, explanations, score, total_cost: totalCost };
}

function evaluate(site: Site, p: Profile, stops: Stop[]): number {
  if (!stops.length) return 0;
  let total = 0;
  let t = p.start_min;
  let zone = p.start_zone;
  for (const s of stops) {
    const wait =
      s.wait_min + Math.max(0, s.start - (t + site.travelMin(zone, s.zone)));
    total += scoreCandidate(site, site.activities.get(s.act_id)!, s.start, wait, p);
    t = s.end;
    zone = s.zone;
  }
  const idle = endMin(p) - t;
  total -= 0.15 * Math.max(0, idle);
  return total;
}

// ------------------------------------------------------------- إعادة التخطيط
const DELAY_NOTE = /^تأخّر (\d+) دقيقة$/;

/** An upcoming stop still carries a delay that is no longer live (revoked by the operator or expired). */
export function hasStaleDelay(itinerary: Itinerary, nowMin: number, events: CrowdEvent[]) {
  return itinerary.stops.some((stop) =>
    stop.start >= nowMin
    && DELAY_NOTE.test(stop.note)
    && !events.some((event) => event.type === "delay" && event.activity === stop.act_id));
}

/** Why a requested activity could not be added, in words the visitor can act on. */
function addFailureReason(site: Site, p: Profile, stops: Stop[], act: Activity, nowMin: number) {
  const people = partySize(p);
  // Only money already spent is fixed: upcoming stops could still make room for the request.
  const spent = stops.filter((stop) => stop.end <= nowMin).reduce((total, stop) => total + stop.price, 0) * people;
  if (p.budget != null && spent + act.price * people > p.budget) {
    return `ما قدرت أضيف «${act.name}»: سعره ${act.price * people} ريال${people > 1 ? ` لـ${people} أشخاص` : ""} والمتبقي من ميزانيتك ${Math.max(0, p.budget - spent)} ريال.`;
  }
  if (act.schedule.type === "slots") {
    const current = stops.filter((stop) => stop.start <= nowMin).at(-1);
    const earliest = current ? Math.max(nowMin, current.end + site.travelMin(current.zone, act.zone)) : nowMin;
    const slots = [...act.schedule.slots].sort((a, b) => a - b);
    const fitting = slots.filter((slot) => slot >= earliest && slot + act.duration_min <= endMin(p));
    if (!fitting.length) {
      const next = slots.find((slot) => slot >= earliest);
      return next != null
        ? `ما قدرت أضيف «${act.name}»: أقرب عرض الساعة ${fmtTime(next)} وينتهي بعد نهاية زيارتك (${fmtTime(endMin(p))}).`
        : `ما قدرت أضيف «${act.name}»: ما بقي له عروض الليلة.`;
    }
    return `ما قدرت أضيف «${act.name}»: عرضه الساعة ${fmtTime(fitting[0])} يتعارض مع محطات في مسارك. شيل محطة أو اطلب تقصير الجولة ثم جرّب.`;
  }
  return `ما قدرت أضيف «${act.name}» ضمن الوقت المتبقي من زيارتك.`;
}

export function replan(
  site: Site,
  p: Profile,
  itinerary: Itinerary,
  nowMin: number,
  events: CrowdEvent[]
): Itinerary {
  const explanations = site.applyEvents(events, nowMin);

  const done: Stop[] = [];
  const ongoing: Stop[] = [];
  const future: Stop[] = [];
  for (const s of itinerary.stops) {
    if (s.end <= nowMin) done.push(s);
    else if (s.start < nowMin && !events.some((event) => event.type === "cancel" && event.activity === s.act_id)) ongoing.push(s);
    else future.push({ ...s });
  }

  const skip = new Set<string>(p.avoid);
  for (const event of events) {
    if (event.type === "cancel" || event.type === "user_skip") skip.add(event.activity);
  }
  let curZone = p.start_zone;
  let curTime = p.start_min;
  if (done.length) {
    curZone = done[done.length - 1].zone;
    curTime = done[done.length - 1].end;
  }
  if (ongoing.length) {
    curZone = ongoing[ongoing.length - 1].zone;
    curTime = ongoing[ongoing.length - 1].end;
  }

  const keptFuture: Stop[] = [];
  for (const s of future) {
    // استبدال موضعي أولًا — قبل فحص الاستبعاد، لأن الهدف يُضاف إلى avoid كي لا يعيد الجدول إدراجه لاحقًا
    const swapEv = events.find(
      (e) => e.type === "swap" && e.activity === s.act_id
    ) as { type: "swap"; activity: string; replacement: string } | undefined;
    if (swapEv) {
      const rep = site.activities.get(swapEv.replacement);
      const takenElsewhere =
        !!rep && itinerary.stops.some((x) => x.act_id === rep.id && x.start !== s.start);
      if (
        rep &&
        rep.id !== s.act_id &&
        !skip.has(rep.id) &&
        !takenElsewhere &&
        eligible(site, rep, p)
      ) {
        explanations.push(
          `استبدلنا «${s.name}» بـ«${rep.name}» — أنسب مع نفس وقتك تقريبًا.`
        );
        s.act_id = rep.id;
        s.name = rep.name;
        s.zone = rep.zone;
        s.price = rep.price;
        s.note = "بديل مقترح";
      } else {
        skip.add(s.act_id);
        explanations.push(`استثنينا «${s.name}» من المسار.`);
        continue;
      }
    }
    const cancelled = events.some(
      (e) => (e.type === "cancel" || e.type === "user_skip") && e.activity === s.act_id
    );
    if (cancelled || skip.has(s.act_id)) {
      skip.add(s.act_id); // حتى لا يعيده scheduleTail لاحقًا
      explanations.push(`استثنينا «${s.name}» من المسار.`);
      continue;
    }
    const delay = events.find(
      (e) => e.type === "delay" && e.activity === s.act_id
    ) as { minutes: number } | undefined;
    if (delay) {
      const priorDelay = Number(s.note.match(DELAY_NOTE)?.[1] ?? 0);
      s.start += delay.minutes - priorDelay;
      s.end += delay.minutes - priorDelay;
      s.note = `تأخّر ${delay.minutes} دقيقة`;
      explanations.push(
        `«${s.name}» تأخر ${delay.minutes} دقيقة، أعدنا ترتيب ما بعده.`
      );
    } else if (DELAY_NOTE.test(s.note)) {
      // The operator revoked the delay or it expired: move the activity back to its original time.
      const priorDelay = Number(s.note.match(DELAY_NOTE)?.[1] ?? 0);
      s.start -= priorDelay;
      s.end -= priorDelay;
      s.note = "";
      explanations.push(`انتهى تأخير «${s.name}»، رجّعناه لموعده وأعدنا ترتيب ما بعده.`);
    }
    keptFuture.push(s);
  }

  // «قلّل الجولة»: نشيل آخر نشاط قادم فعلًا ولا نعيد ملء وقته — الجولة تقصر صدقًا
  const shorten = events.some((e) => e.type === "user_shorten");
  if (shorten && keptFuture.length) {
    const dropped = keptFuture.pop()!;
    skip.add(dropped.act_id);
    explanations.push(
      `خفّفنا الجولة: شلنا «${dropped.name}» وكسبت وقت راحة في آخر الليلة.`
    );
  }

  const priorityAdds = new Set(
    events.filter((event): event is { type: "user_add"; activity: string } => event.type === "user_add").map((event) => event.activity),
  );
  const fixed = [...done, ...ongoing];
  // A requested timed activity (a show with fixed slots) may only fit mid-visit, not after the last
  // kept stop. Try it between the kept stops first and keep the best placement that drops none of
  // them; otherwise it is appended by scheduleTail below if time allows.
  for (const activityId of priorityAdds) {
    const act = site.activities.get(activityId);
    if (!act || skip.has(activityId) || !eligible(site, act, p)) continue;
    if ([...fixed, ...keptFuture].some((stop) => stop.act_id === activityId)) continue;
    const requested: Stop = { act_id: activityId, zone: act.zone, start: 0, end: 0, walk_min: 0, wait_min: 0, price: act.price, name: act.name, note: "" };
    let placement: Stop[] | null = null;
    let placementScore = -Infinity;
    for (let index = 0; index <= keptFuture.length; index += 1) {
      const trial = [...keptFuture.slice(0, index), requested, ...keptFuture.slice(index)];
      const placed = retimeFuture(site, p, fixed, trial, nowMin, new Set(skip));
      if (placed.length !== trial.length) continue;
      const score = evaluate(site, p, [...fixed, ...placed]);
      if (score > placementScore) {
        placementScore = score;
        placement = trial;
      }
    }
    if (placement) keptFuture.splice(0, keptFuture.length, ...placement);
  }
  let feasible = retimeFuture(site, p, fixed, keptFuture, nowMin, skip);
  const diversion = divertMeasuredCrowd(site, p, fixed, feasible, events, nowMin, skip);
  if (diversion) {
    feasible = diversion.stops;
    explanations.push(`«${diversion.from}» مزدحم بحسب القياس الحالي. اقترحنا «${diversion.to}» في منطقة أقل إشغالًا.`);
  } else if (events.length > 0 && events.every((event) => event.type === "crowd_spike" && event.measured)) {
    return itinerary;
  }
  const rest = shorten ? [] : scheduleTail(site, p, nowMin, curZone, curTime, [...fixed, ...feasible], skip, priorityAdds);
  const newStops = [...fixed, ...feasible, ...rest];
  for (const activityId of priorityAdds) {
    const activity = site.activities.get(activityId);
    if (!activity) continue;
    const placed = newStops.find((stop) => stop.act_id === activityId);
    explanations.push(placed
      ? `أضفنا «${activity.name}» لمسارك الساعة ${fmtTime(placed.start)} بعد التحقق من الوقت والميزانية.`
      : addFailureReason(site, p, newStops, activity, nowMin));
  }
  const totalCost = newStops.reduce((s, x) => s + x.price, 0);
  return {
    stops: newStops,
    unfulfilled: [],
    explanations: [...itinerary.explanations, ...explanations],
    score: evaluate(site, p, newStops),
    total_cost: totalCost,
  };
}

function divertMeasuredCrowd(site: Site, profile: Profile, fixed: Stop[], future: Stop[], events: CrowdEvent[], nowMin: number, skip: Set<string>) {
  const measured = new Map(events.flatMap((event) =>
    event.type === "crowd_spike" && event.measured && event.level != null ? [[event.zone, event.level] as const] : [],
  ));
  if (measured.size < 2) return null;
  const used = new Set([...fixed, ...future].map((stop) => stop.act_id));
  for (const [index, stop] of future.entries()) {
    const currentLevel = measured.get(stop.zone);
    const currentActivity = site.activities.get(stop.act_id);
    if (!currentActivity || currentLevel == null || currentLevel < site.crowdThreshold) continue;
    const choices = [...site.activities.values()].filter((activity) => {
      const level = measured.get(activity.zone);
      return !used.has(activity.id) && !skip.has(activity.id) && eligible(site, activity, profile)
        && level != null && level < site.crowdThreshold && currentLevel - level >= 0.15
        && (activity.type === currentActivity.type || activity.interests.some((item) => currentActivity.interests.includes(item)));
    }).sort((left, right) =>
      measured.get(left.zone)! - measured.get(right.zone)!
      || site.travelMin(stop.zone, left.zone) - site.travelMin(stop.zone, right.zone)
      || left.price - right.price
      || left.id.localeCompare(right.id),
    );
    for (const activity of choices) {
      const trial = [...future];
      trial[index] = { ...stop, act_id: activity.id, zone: activity.zone, name: activity.name, price: activity.price, note: "بديل بسبب الإشغال المرصود" };
      const timed = retimeFuture(site, profile, fixed, trial, nowMin, new Set(skip));
      if (timed.length !== future.length) continue;
      skip.add(stop.act_id);
      return { stops: timed, from: stop.name, to: activity.name };
    }
  }
  return null;
}

function scheduleTail(
  site: Site,
  p: Profile,
  nowMin: number,
  startZone: string,
  startTime: number,
  kept: Stop[],
  skip: Set<string>,
  priority = new Set<string>(),
): Stop[] {
  let curZone = startZone;
  let curTime = startTime;
  if (kept.length) {
    curZone = kept[kept.length - 1].zone;
    curTime = kept[kept.length - 1].end;
  }
  let spent = kept.reduce((s, x) => s + x.price, 0);
  const used = new Set(kept.map((s) => s.act_id));
  const selected = kept
    .map((stop) => site.activities.get(stop.act_id))
    .filter((activity): activity is Activity => Boolean(activity));
  const out: Stop[] = [];
  for (;;) {
    let best: { score: number; aid: string; act: Activity; st: number; walk: number; wait: number } | null = null;
    for (const [aid, act] of site.activities) {
      if (used.has(aid) || skip.has(aid)) continue;
      if (!eligible(site, act, p)) continue;
      const soFar = [...selected, ...out.map((stop) => site.activities.get(stop.act_id)).filter((activity): activity is Activity => Boolean(activity))];
      if (!priority.has(aid) && overMealLimit(act, p, soFar)) continue;
      const arrive = Math.max(nowMin, curTime + site.travelMin(curZone, act.zone));
      const st = slotStart(act, arrive);
      if (st === null || st + act.duration_min > endMin(p)) continue;
      if (!budgetOk(p, spent, act.price)) continue;
      const walk = site.travelMin(curZone, act.zone);
      const wait = st - arrive;
      const score = sequenceScore(
        site,
        act,
        st,
        wait,
        walk,
        p,
        [...selected, ...out.map((stop) => site.activities.get(stop.act_id)).filter((activity): activity is Activity => Boolean(activity))],
      ) + 15 + (priority.has(aid) ? 1000 : 0);
      if (!best || score > best.score) best = { score, aid, act, st, walk, wait };
    }
    if (!best || (best.score < 30 && !priority.has(best.aid))) break;
    out.push({
      act_id: best.aid,
      zone: best.act.zone,
      start: best.st,
      end: best.st + best.act.duration_min,
      walk_min: best.walk,
      wait_min: best.wait,
      price: best.act.price,
      name: best.act.name,
      note: "بديل مقترح",
    });
    used.add(best.aid);
    selected.push(best.act);
    spent += best.act.price;
    curZone = best.act.zone;
    curTime = best.st + best.act.duration_min;
  }
  return out;
}

function retimeFuture(site: Site, p: Profile, fixed: Stop[], future: Stop[], nowMin: number, skip: Set<string>) {
  const feasible: Stop[] = [];
  let previous = fixed.at(-1);
  let spent = fixed.reduce((total, stop) => total + stop.price, 0);
  for (const stop of future) {
    const act = site.activities.get(stop.act_id);
    if (!act) continue;
    const walk = site.travelMin(previous?.zone ?? p.start_zone, stop.zone);
    const arrive = Math.max((previous?.end ?? p.start_min) + walk, nowMin);
    const start = stop.note.includes("تأخّر")
      ? Math.max(stop.start, arrive)
      : slotStart(act, arrive);
    if (start === null || start + act.duration_min > endMin(p) || !budgetOk(p, spent, stop.price)) {
      skip.add(stop.act_id);
      continue;
    }
    const next = { ...stop, start, end: start + act.duration_min, walk_min: walk, wait_min: Math.max(0, start - arrive) };
    feasible.push(next);
    previous = next;
    spent += stop.price;
  }
  return feasible;
}

/** اختيار بديل لنشاط — يستخدمه التبديل بالمحادثة، ويدعم تفضيل مزاج مثل «أهدى» */
export function pickSwap(
  site: Site,
  p: Profile,
  targetId: string,
  targetStart: number,
  taken: Set<string>,
  remainBudget: number | null,
  moodHint: string | undefined,
  nowMin: number,
  preferenceHint?: "quiet" | "cheap" | "near",
): string | null {
  const act = site.activities.get(targetId);
  if (!act) return null;
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const [aid, cand] of site.activities) {
    if (aid === targetId || taken.has(aid)) continue;
    if (!eligible(site, cand, p)) continue;
    if (moodHint && !cand.moods.includes(moodHint)) continue;
    if (Math.abs(cand.duration_min - act.duration_min) > 25) continue;
    // remainBudget is what the group has left; prices are per head.
    if (remainBudget != null && (cand.price - act.price) * partySize(p) > remainBudget) continue;
    const st = slotStart(cand, Math.max(nowMin, targetStart));
    if (st === null || st + cand.duration_min > endMin(p)) continue;
    const mid = st + Math.floor(cand.duration_min / 2);
    const score =
      cand.interests.filter((i) => act.interests.includes(i)).length * 2 +
      (cand.moods.includes(p.mood ?? "") ? 1 : 0) -
      site.zoneLoadFactor(cand.zone, mid) * 10;
    const preferenceScore = preferenceHint === "quiet"
      ? (1 - site.crowd(cand.zone, mid)) * 15
      : preferenceHint === "cheap"
        ? -cand.price * 0.4
        : preferenceHint === "near"
          ? -site.travelMin(act.zone, cand.zone) * 2
          : 0;
    const totalScore = score + preferenceScore;
    if (totalScore > bestScore) {
      bestScore = totalScore;
      best = aid;
    }
  }
  return best;
}

// ------------------------------------------------------------- تنسيق عربي
export function fmtTime(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
