export function calculateCrowdObservation(people: unknown, capacity: unknown, waitMinutes: unknown) {
  if (typeof people !== "number" || !Number.isSafeInteger(people) || people < 0 || people > 1_000_000) return null;
  if (typeof capacity !== "number" || !Number.isSafeInteger(capacity) || capacity <= 0) return null;
  if (waitMinutes != null && (typeof waitMinutes !== "number" || !Number.isInteger(waitMinutes) || waitMinutes < 0 || waitMinutes > 240)) return null;
  return {
    measurement: "counted" as const,
    occupiedPeople: people,
    capacity,
    level: Math.min(1, people / capacity),
    ...(typeof waitMinutes === "number" ? { waitMinutes } : {}),
  };
}
