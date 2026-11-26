// «أوقات الذروة» لكل منطقة (مثل Popular times في خرائط Google):
// ساعات التشغيل من نموذج الزحام الحتمي، والساعة الحالية تأخذ القراءة الحية إن وجدت.
import type { Site } from "../engine/site.ts";

export type HourlyCrowd = { hour: number; level: number; live: boolean };
export type ZoneForecast = { hours: HourlyCrowd[]; quietestUpcomingHour: number | null };

export function zoneForecast(
  site: Site,
  zoneId: string,
  options: { openingFrom: number; openingTo: number; nowMinute: number; liveLevel?: number | null },
): ZoneForecast {
  // The catalog stores opening hours either as hours (17, 24) or as minutes (1020, 1440).
  const toMinutes = (value: number) => (value <= 24 ? value * 60 : value);
  const firstHour = Math.floor(toMinutes(options.openingFrom) / 60);
  const lastHour = Math.ceil(toMinutes(options.openingTo) / 60) - 1;
  const nowHour = Math.floor(options.nowMinute / 60);
  const hours: HourlyCrowd[] = [];
  for (let hour = firstHour; hour <= lastHour; hour += 1) {
    const live = hour === nowHour && options.liveLevel != null && Number.isFinite(options.liveLevel);
    const level = live ? (options.liveLevel as number) : site.crowd(zoneId, hour * 60);
    hours.push({ hour: hour % 24, level: Math.round(Math.min(1, Math.max(0, level)) * 100) / 100, live });
  }
  const upcoming = hours.filter((_, index) => firstHour + index >= nowHour);
  const quietest = upcoming.reduce<HourlyCrowd | null>((best, entry) => (!best || entry.level < best.level ? entry : best), null);
  return { hours, quietestUpcomingHour: quietest ? quietest.hour : null };
}
