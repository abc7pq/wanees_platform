// ملخص مشي للمساعد: «من وين لوين، كم دقيقة، عن طريق أي مناطق، وأي زحمة تجنبنا».
// كل الأرقام من رسم الممرات المنشور والزحام الحي — المساعد يصيغ فقط.
import type { Site } from "../engine/site.ts";

export type WalkingBrief = {
  targetId: string;
  targetName: string;
  originName: string;
  totalWalkMin: number;
  via: string[];
  avoided: string[];
  crowdedOnRoute: string[];
  sameZone: boolean;
};

export function zoneNodeId(site: Site, zoneId: string) {
  const nodes = [...site.routeGraphNodes.values()].filter((node) => node.zone === zoneId && node.status === "open");
  return (nodes.find((node) => node.type === "ZONE") ?? nodes[0])?.id ?? null;
}

/** أين الزائر الآن تقريبيًا؟ آخر محطة بدأت، وإلا أول محطة، وإلا نقطة البداية، وإلا البوابة */
export function likelyOriginZone(
  site: Site,
  stops: ReadonlyArray<{ zone: string; start: number; end: number }>,
  nowMin: number,
  startPoint?: string | null,
) {
  const started = [...stops].filter((stop) => stop.start <= nowMin).sort((a, b) => b.start - a.start)[0];
  if (started && site.zones.has(started.zone)) return started.zone;
  if (startPoint && site.zones.has(startPoint)) return startPoint;
  const gate = [...site.routeGraphNodes.values()].find((node) => node.type === "ENTRANCE" && node.status === "open");
  if (gate?.zone) return gate.zone;
  if (gate) {
    // بوابة بلا منطقة: أقرب منطقة لها
    let best: { id: string; distance: number } | null = null;
    for (const zone of site.zones.values()) {
      const distance = Math.hypot(zone.x - gate.x, zone.y - gate.y);
      if (!best || distance < best.distance) best = { id: zone.id, distance };
    }
    if (best) return best.id;
  }
  const first = [...stops].sort((a, b) => a.start - b.start)[0];
  return first && site.zones.has(first.zone) ? first.zone : null;
}

export function walkingBrief(
  site: Site,
  input: { originZone: string; targetId: string; targetName: string; targetNodeId: string | null; targetZone: string },
  crowdLevels: ReadonlyMap<string, number>,
): WalkingBrief | null {
  const startNodeId = zoneNodeId(site, input.originZone);
  const targetNodeId = input.targetNodeId ?? zoneNodeId(site, input.targetZone);
  if (!startNodeId || !targetNodeId) return null;
  const originName = site.zones.get(input.originZone)?.name ?? input.originZone;
  if (input.originZone === input.targetZone && !input.targetNodeId) {
    return { targetId: input.targetId, targetName: input.targetName, originName, totalWalkMin: 0, via: [], avoided: [], crowdedOnRoute: [], sameZone: true };
  }
  const threshold = site.crowdThreshold;
  const penalty = (zoneId: string) => {
    const level = crowdLevels.get(zoneId);
    if (level == null || zoneId === input.targetZone) return 0;
    return level >= threshold ? 1.5 : level >= threshold * 0.65 ? 0.4 : 0;
  };
  const plain = site.pathBetweenNodes(startNodeId, targetNodeId);
  const chosen = crowdLevels.size ? site.pathBetweenNodes(startNodeId, targetNodeId, { zonePenalty: penalty }) : plain;
  if (!chosen) return null;
  const zonesOf = (nodeIds: string[]) => [...new Set(nodeIds.map((id) => site.routeGraphNodes.get(id)?.zone).filter((zone): zone is string => Boolean(zone)))];
  const chosenZones = zonesOf(chosen.nodeIds);
  const crowded = (zoneId: string) => (crowdLevels.get(zoneId) ?? 0) >= threshold;
  const avoided = plain ? zonesOf(plain.nodeIds).filter((zone) => crowded(zone) && !chosenZones.includes(zone)) : [];
  const name = (zoneId: string) => site.zones.get(zoneId)?.name ?? zoneId;
  return {
    targetId: input.targetId,
    targetName: input.targetName,
    originName,
    // Measured walking time, as /directions reports it; min_walk_min is a planning buffer, not a walk.
    totalWalkMin: Math.max(1, Math.round(chosen.minutes)),
    via: chosenZones.filter((zone) => zone !== input.originZone && zone !== input.targetZone).map(name),
    avoided: avoided.map(name),
    crowdedOnRoute: chosenZones.filter((zone) => zone !== input.targetZone && crowded(zone)).map(name),
    sameZone: false,
  };
}

// ————— مطابقة تقريبية لأسماء الأنشطة في طلبات التوجيه («الدلافين» ← «الدولفيناريوم»، «زرافة» ← «الزرافات»)
const GENERIC_WORDS = new Set(["عرض", "عروض", "تجربه", "تجارب", "منطقه", "مطعم", "مطاعم", "لعبه", "العاب", "رحله", "جوله", "ركوب", "مكان", "نشاط", "فعاليه", "كيف", "اروح", "اوصل", "وين", "ودني", "وديني", "خذني", "دلني", "ابي", "ابغي", "عند", "الي", "على", "علي"]);

function arabicSkeleton(word: string) {
  let value = word
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/^(?:وال|بال|لل|فال|كال|ال)/, "");
  value = value.replace(/(?:ات|ين|ون|يه|ه)$/, "");
  return value.replace(/[اوي]/g, "");
}

function distinctiveTokens(text: string) {
  return text
    .toLocaleLowerCase("ar-SA")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !GENERIC_WORDS.has(token.normalize("NFKD").replace(/[ً-ٟ]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/^ال/, "")))
    .map(arabicSkeleton)
    .filter((skeleton) => skeleton.length >= 3);
}

/** أفضل نشاط بمطابقة هياكل الكلمات المميزة؛ null إذا لا تطابق أو تعادل أكثر من نشاط */
export function fuzzyActivityTarget(text: string, site: Site): string | null {
  const queryTokens = distinctiveTokens(text);
  if (!queryTokens.length) return null;
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const [id, activity] of site.activities) {
    const nameTokens = distinctiveTokens(`${activity.name} ${activity.name_en ?? ""}`);
    let score = 0;
    for (const query of queryTokens) {
      if (nameTokens.some((name) => name === query || (query.length >= 3 && name.startsWith(query)) || (name.length >= 4 && query.startsWith(name)))) score += 1;
    }
    if (!score) continue;
    if (!best || score > best.score) { best = { id, score }; tie = false; }
    else if (score === best.score) tie = true;
  }
  return best && !tie ? best.id : null;
}

export function describeWalkingBrief(brief: WalkingBrief) {
  if (brief.sameZone) return `«${brief.targetName}» قريب منك في نفس المنطقة.`;
  const via = brief.via.length ? ` مرورًا بـ${brief.via.slice(0, 3).join(" ثم ")}` : "";
  let text = `من ${brief.originName} إلى «${brief.targetName}» حوالي ${brief.totalWalkMin} دقيقة مشي${via}.`;
  if (brief.avoided.length) text += ` اخترت لك طريقًا يتجنب زحمة ${brief.avoided.join("، ")}.`;
  if (brief.crowdedOnRoute.length) text += ` انتبه: فيه زحمة الآن في ${brief.crowdedOnRoute.join("، ")}.`;
  return `${text} اضغط «دلّني الآن» وأوجهك بالبوصلة من موقعك الحقيقي.`;
}
