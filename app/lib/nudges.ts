// تنبيهات ونيس الاستباقية: ونيس يبادر بالكلام في اللحظة المناسبة، من المسار والساعة فقط.
// حتمية بالكامل (لا LLM): الوقت والمشي من المحرك، والمعرّف ثابت حتى يظهر كل تنبيه مرة واحدة.
import type { Site } from "../engine/site.ts";
import type { Itinerary, Profile } from "../engine/types.ts";
import { clockText, minutesText } from "./agent-persona.ts";
import { stationsCount } from "./ar-count.ts";
import { A2UI_BASIC_CATALOG, A2UI_VERSION, type A2uiComponent, type A2uiMessage } from "./a2ui.ts";

export type NudgeKind = "leave_now" | "show_soon" | "visit_ending";
export type Nudge = { id: string; kind: NudgeKind; text: string; targetId?: string; ui: A2uiMessage[] };

/** نافذة التنبيه تفتح قبل وقت المغادرة بدقيقتين. */
const OPEN_EARLY_MIN = 2;
const VISIT_ENDING_MIN = 20;

function surface(id: string, title: string, note: string, buttons: Array<{ label: string; variant: "primary" | "borderless"; name: "get_directions" | "show_on_map" | "shorten_plan"; context?: Record<string, string> }>): A2uiMessage[] {
  const components: A2uiComponent[] = [
    { id: "nudge_title", component: "Text", text: { "@path": "/title" }, variant: "body" },
    { id: "nudge_note", component: "Text", text: { "@path": "/note" }, variant: "caption" },
  ];
  const buttonIds = buttons.map((button, index) => {
    components.push({ id: `nudge_btn${index}_label`, component: "Text", text: button.label });
    components.push({ id: `nudge_btn${index}`, component: "Button", child: `nudge_btn${index}_label`, variant: button.variant, action: { event: { name: button.name, context: button.context ?? {} } } });
    return `nudge_btn${index}`;
  });
  const lines = ["nudge_title", "nudge_note"];
  if (buttonIds.length) {
    components.push({ id: "nudge_actions", component: "Row", children: buttonIds });
    lines.push("nudge_actions");
  }
  components.push({ id: "nudge_col", component: "Column", children: lines });
  components.push({ id: "nudge_card", component: "Card", child: "nudge_col" });
  components.push({ id: "root", component: "Column", children: ["nudge_card"] });
  const surfaceId = `nudge_${id.replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 120);
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: A2UI_BASIC_CATALOG, sendDataModel: false, dataModel: { title, note } } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

export function computeNudges(input: {
  site: Site;
  plan: Itinerary | null;
  profile: Profile;
  nowMin: number;
  isOpen: boolean;
  walkingTolerance?: string | null;
}): Nudge[] {
  const { site, plan, profile, nowMin } = input;
  if (!input.isOpen || !plan?.stops.length) return [];
  const nudges: Nudge[] = [];

  // 1) Time to walk to the next stop. Families and low-walking visitors get a longer buffer.
  const next = plan.stops.find((stop) => stop.start > nowMin);
  if (next) {
    const buffer = profile.companions_kids || input.walkingTolerance === "low" ? 6 : 3;
    const leaveAt = next.start - next.walk_min - buffer;
    if (nowMin >= leaveAt - OPEN_EARLY_MIN) {
      const activity = site.activities.get(next.act_id);
      const timed = activity?.schedule.type === "slots";
      const kind: NudgeKind = timed ? "show_soon" : "leave_now";
      const minutesLeft = next.start - nowMin;
      const zone = site.zones.get(next.zone)?.name ?? next.zone;
      const walk = next.walk_min > 0 ? `، المشي حوالي ${minutesText(next.walk_min)}` : "";
      const text = timed
        ? `«${next.name}» يبدأ ${clockText(next.start)}، بعد ${minutesText(minutesLeft)}، والعروض تبدأ بوقتها. تحرك الحين${walk}.`
        : `«${next.name}» موعدها ${clockText(next.start)} في ${zone}. تحرك الحين عشان توصل بوقت${walk}.`;
      nudges.push({
        id: `${kind}:${next.act_id}:${next.start}`,
        kind,
        text,
        targetId: next.act_id,
        ui: surface(`${kind}_${next.act_id}_${next.start}`, timed ? `العرض يبدأ ${clockText(next.start)}` : `وقت التحرك إلى «${next.name}»`, `${zone}${next.walk_min > 0 ? ` · ${minutesText(next.walk_min)} مشي` : ""}`, [
          { label: "دلّني", variant: "primary", name: "get_directions", context: { targetId: next.act_id } },
          { label: "على الخريطة", variant: "borderless", name: "show_on_map", context: { targetId: next.act_id } },
        ]),
      });
    }
  }

  // 2) The visit window is about to end.
  const endMin = profile.start_min + profile.duration_min;
  const remaining = endMin - nowMin;
  if (remaining > 0 && remaining <= VISIT_ENDING_MIN) {
    const left = plan.stops.filter((stop) => stop.end > nowMin).length;
    const text = left > 1
      ? `باقي ${minutesText(remaining)} على نهاية زيارتك، وعندك ${stationsCount(left)} باقية. تبي أقصّر الجولة على الأهم؟`
      : `باقي ${minutesText(remaining)} على نهاية زيارتك. استمتع بآخرها!`;
    nudges.push({
      id: `visit_ending:${endMin}`,
      kind: "visit_ending",
      text,
      ui: surface(`visit_ending_${endMin}`, `زيارتك تنتهي ${clockText(endMin)}`, left > 1 ? `${stationsCount(left)} باقية` : "آخر محطة", left > 1
        ? [{ label: "قصّر الجولة", variant: "primary", name: "shorten_plan" }]
        : []),
    });
  }
  return nudges;
}
