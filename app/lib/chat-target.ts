type Stop = { act_id: string; start: number };
type Activity = { name: string; name_en?: string };

export function resolveChatTarget(
  text: string,
  target: string | undefined,
  stops: Stop[],
  activities: Map<string, Activity>,
  now: number
): string | null {
  const futureStops = stops.filter((stop) => stop.start > now);
  if (target && activities.has(target) && futureStops.some((stop) => stop.act_id === target)) return target;
  for (const stop of futureStops) {
    const activity = activities.get(stop.act_id);
    if (activity && (text.includes(activity.name) || (activity.name_en && text.toLowerCase().includes(activity.name_en.toLowerCase())))) return stop.act_id;
  }
  if (/القادم|اللي\s*بعده|اللي\s*بعدها/.test(text)) {
    return futureStops[0]?.act_id ?? null;
  }
  return null;
}
