// Current weather at the venue: live from Open-Meteo, or a labelled estimate when the provider is unreachable.
import { jsonData, jsonError } from "@/lib/api-response";
import { venueWeather } from "@/lib/live-weather";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function riyadhMinute(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

export async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const reading = await venueWeather(eventSlug, riyadhMinute());
  if (!reading) return jsonError(request, "WEATHER_UNAVAILABLE", "ما عندنا موقع جغرافي لهذه الفعالية.", 404);
  return jsonData(request, { weather: reading }, { source: reading.source, live: reading.live });
}
