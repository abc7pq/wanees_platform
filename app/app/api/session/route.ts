import { NextResponse } from "next/server";
import { createSession, getSession, deleteSession, rebuild, applyEvents, sessionNow, advanceDemoClock, allSessions } from "@/lib/session";
import { buildRoute, fmtTime, pickSwap } from "@/engine/route.ts";
import { parseCommand } from "@/lib/llm";
import { resolveChatTarget } from "@/lib/chat-target";
import type { CrowdEvent } from "@/engine/types.ts";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function stateOf(s: ReturnType<typeof getSession>) {
  if (!s) return null;
  const now = sessionNow(s);
  return {
    sessionId: s.id,
    profile: s.profile,
    itinerary: s.itinerary,
    now,
    nowText: fmtTime(now),
    demoMode: s.demoMode,
  };
}

/** Copies only known profile fields with the same primitive type (or string arrays) onto the profile. */
function mergeProfile(target: Record<string, unknown>, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(key in target)) continue;
    const current = target[key];
    if (Array.isArray(current)) {
      if (Array.isArray(value) && value.length <= 50 && value.every((item) => typeof item === "string" && item.length <= 80)) target[key] = value;
    } else if (value === null || typeof value === typeof current || current === null) {
      if (typeof value === "string" && value.length > 120) continue;
      if (value !== null && typeof value === "object") continue;
      target[key] = value;
    }
  }
}

export async function POST(req: Request) {
  // Legacy demo endpoint: rate-limited because "new" allocates memory and "chat" calls the language model.
  const rate = await enforceRateLimit(req, { scope: "legacy-session", limit: 120 });
  if (!rate.allowed) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds) } });
  const body = (await req.json().catch(() => null)) as Record<string, any> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const op = body.op as string;
  const sessionId = body.sessionId as string | undefined;
  const s = op === "new" ? createSession() : getSession(sessionId ?? "");
  if (!s) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const messages: { role: "agent"; text: string }[] = [];

  switch (op) {
    case "new":
      return NextResponse.json({ ...stateOf(s)!, welcome: true });

    case "profile": {
      mergeProfile(s.profile as unknown as Record<string, unknown>, body.profile);
      s.itinerary = rebuild(s);
      messages.push({
        role: "agent",
        text: `تم! هذا مسارك يا ${body.profile?.mood === "متحمس" ? "المغامر" : "صديقي"} 🎡 «ليش هذا المسار؟» تحت، أو قل لي أي تعديل.`,
      });
      break;
    }

    case "chat": {
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";
      const now = sessionNow(s);
      const candidates = [...s.site.activities.values()]
        .map((activity) => ({ id: activity.id, name: activity.name }));
      const cmd = await parseCommand(text, candidates, now);
      const it = s.itinerary;
      if (!it) {
        messages.push({ role: "agent", text: "خلنا نبني مسارك أولًا 😉" });
        break;
      }
      const findTarget = (): string | null => resolveChatTarget(text, cmd.target, it.stops, s.site.activities, now);
      if (cmd.action === "shorten") {
        const future = it.stops.filter((x) => x.start > now);
        if (future.length > 1) {
          s.itinerary = applyEvents(s, [{ type: "user_shorten" }], now);
          messages.push({ role: "agent", text: "خفّفت الجولة — شلت آخر نشاط وحررت لك وقت راحة في آخر الليلة 🌙" });
        } else {
          messages.push({ role: "agent", text: "الجولة أصلاً خفيفة، ما في شي أشيله." });
        }
      } else if (cmd.action === "remove") {
        const target = findTarget();
        if (target) {
          s.itinerary = applyEvents(s, [{ type: "user_skip", activity: target }], now);
          messages.push({ role: "agent", text: `شلنا «${s.site.activities.get(target)!.name}» ورتبنا الوقت لك.` });
        } else messages.push({ role: "agent", text: "ما لقيت النشاط، ذكرني باسمه؟" });
      } else if (cmd.action === "swap") {
        const target = findTarget();
        if (target) {
          const oldName = s.site.activities.get(target)!.name;
          // صفة البديل من نص الرسالة: «أهدى» / «أقوى» / «أمرح»
          const hint = /أهدى|هدوء|هادئ|استرخاء|أرتخي/.test(text)
            ? "هادئ"
            : /أقوى|أحمس|حماسًا|حماس|إثارة|أكثر مغامرة/.test(text)
              ? "متحمس"
              : /أمرح|أكثر مرح/.test(text)
                ? "مرح"
                : undefined;
          const hintWord = hint === "هادئ" ? "بخيار أهدى" : hint === "متحمس" ? "بخيار أقوى" : hint === "مرح" ? "بخيار أمرح" : "بأنسب بديل";
          const tStop = it.stops.find((x) => x.act_id === target);
          const isFuture = !!tStop && tStop.start > now;
          let rep: string | null = null;
          if (isFuture) {
            const taken = new Set(it.stops.map((x) => x.act_id));
            const spentDone = it.stops.filter((x) => x.end <= now).reduce((a, x) => a + x.price, 0);
            const remain = s.profile.budget != null ? s.profile.budget - spentDone : null;
            rep = pickSwap(s.site, s.profile, target, tStop!.start, taken, remain, hint, now);
          }
          s.profile.avoid = [...s.profile.avoid, target];
          if (rep) {
            s.itinerary = applyEvents(s, [{ type: "swap", activity: target, replacement: rep }], now);
            messages.push({ role: "agent", text: `بدّلنا «${oldName}» ${hintWord}: «${s.site.activities.get(rep)!.name}» — بنفس وقتك تقريبًا.` });
          } else {
            s.itinerary = rebuild(s);
            messages.push({ role: "agent", text: `بدّلنا «${oldName}» وأعدنا ترتيب مسارك بدونها.` });
          }
        } else messages.push({ role: "agent", text: "قل لي أي نشاط تبي أبدله؟" });
      } else {
        // unknown: لطيف ويعيد التوجيه
        messages.push({
          role: "agent",
          text: "أقدر أشيل أو أبدّل نشاطًا محددًا، أو أقصّر الجولة. جرّب: «بدّل العجلة» أو «تعبت قلّل الجولة».",
        });
      }
      break;
    }

    case "events": {
      const now = sessionNow(s);
      s.itinerary = applyEvents(s, (body.events ?? []) as CrowdEvent[], now);
      const exp = s.itinerary.explanations.slice(-2).filter(Boolean).join(" ");
      messages.push({ role: "agent", text: exp || "حدّثنا مسارك حسب الأحداث الجديدة ✅" });
      break;
    }

    case "demo_clock": {
      s.demoMode = true;
      advanceDemoClock(s, Number(body.minutes ?? 30));
      break;
    }

    case "demo_flag": {
      s.demoMode = !!body.on;
      break;
    }
  }

  return NextResponse.json({ ...stateOf(s)!, messages });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("session");
  if (!id) {
    return NextResponse.json({ sessions: allSessions().length });
  }
  const s = getSession(id);
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(stateOf(s));
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  if (!id || !deleteSession(id)) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
