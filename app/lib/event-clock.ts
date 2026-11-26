// The canonical clock remains pure and shared. This app wrapper adds an explicit,
// process-local test override without accepting time from an untrusted request.
import { PITCH_EVENT_SLUG } from "../../packages/contracts/src/index.ts";
import {
  getEventClock as getCanonicalEventClock,
  type EventClock,
} from "../../packages/engine/src/event-clock.ts";

export type { EventClock, EventClockSource } from "../../packages/engine/src/event-clock.ts";

type EventClockInput = Parameters<typeof getCanonicalEventClock>[0] & { eventSlug?: string };

type ClockEnv = Record<string, string | undefined>;

// A production build (`next start` always sets NODE_ENV=production) never honours the
// override, except on a GitHub Actions runner, where CI starts the production build
// against its own throwaway Postgres. A deployed server is never a GitHub Actions runner.
export function clockOverrideMinute(env: ClockEnv): number | null {
  if (env.WANEES_ALLOW_CLOCK_OVERRIDE !== "true") return null;
  const isProduction = env.NODE_ENV === "production";
  const isCiRunner = env.CI === "true" && env.GITHUB_ACTIONS === "true";
  if (isProduction && !isCiRunner) return null;

  const raw = env.WANEES_CLOCK_OVERRIDE_MINUTE ?? "";
  if (!/^\d{1,4}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 1439 ? value : null;
}

let warnedIgnoredOverride = false;

function configuredTestMinute() {
  const minute = clockOverrideMinute(process.env);
  if (minute === null && process.env.WANEES_ALLOW_CLOCK_OVERRIDE === "true" && !warnedIgnoredOverride) {
    warnedIgnoredOverride = true;
    console.warn("[event-clock] WANEES_ALLOW_CLOCK_OVERRIDE is set but ignored in this environment; using the real clock.");
  }
  return minute;
}

export function getEventClock(input: EventClockInput): EventClock {
  if (input.eventSlug === PITCH_EVENT_SLUG) {
    return { nowMinute: 1080, actualMinute: 1080, timezone: "Asia/Riyadh", isWithinEvent: true, isOpen: true, source: "demo_clock" };
  }
  const overrideMinute = configuredTestMinute();
  if (overrideMinute === null) return getCanonicalEventClock(input);

  const baseline = input.now ?? new Date();
  const baselineClock = getCanonicalEventClock({ ...input, now: baseline });
  const shifted = new Date(
    baseline.getTime() + (overrideMinute - baselineClock.actualMinute) * 60_000,
  );

  return getCanonicalEventClock({ ...input, now: shifted });
}
