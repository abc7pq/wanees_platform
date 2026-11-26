export type DemoStop = { act_id: string; zone: string; start: number };

/** Select a stop the server will still consider upcoming after the demo clock advances. */
export function firstFutureDemoStop<T extends DemoStop>(stops: T[], now: number, advanceMinutes: number): T | undefined {
  return stops.find((stop) => stop.start > now + advanceMinutes);
}
