export type EventClockSource = "server_clock" | "event_opening" | "event_window" | "demo_clock";

export type EventClock = {
  nowMinute: number;
  actualMinute: number;
  timezone: string;
  isWithinEvent: boolean;
  isOpen: boolean;
  source: EventClockSource;
};

function minute(value: number) {
  return value < 100 ? Math.round(value * 60) : Math.round(value);
}

function localMinute(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minutePart = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    return Math.min(1439, Math.max(0, hour * 60 + minutePart));
  } catch {
    return (date.getUTCHours() * 60 + date.getUTCMinutes()) % 1440;
  }
}

export function getEventClock(input: {
  now?: Date;
  startsAt: Date;
  endsAt: Date;
  timezone?: string | null;
  openingFrom: number;
  openingTo: number;
}): EventClock {
  const now = input.now ?? new Date();
  const timezone = input.timezone || "Asia/Riyadh";
  const actualMinute = localMinute(now, timezone);
  const openingFrom = Math.max(0, Math.min(1439, minute(input.openingFrom)));
  const openingTo = Math.max(openingFrom + 1, Math.min(1440, minute(input.openingTo)));
  const isWithinEvent = now >= input.startsAt && now <= input.endsAt;
  const isOpen = isWithinEvent && actualMinute >= openingFrom && actualMinute < openingTo;

  if (!isWithinEvent) {
    return {
      nowMinute: openingFrom,
      actualMinute,
      timezone,
      isWithinEvent,
      isOpen,
      source: "event_window",
    };
  }

  return {
    nowMinute: Math.min(openingTo - 1, Math.max(openingFrom, actualMinute)),
    actualMinute,
    timezone,
    isWithinEvent,
    isOpen,
    source: actualMinute < openingFrom || actualMinute >= openingTo ? "event_opening" : "server_clock",
  };
}
