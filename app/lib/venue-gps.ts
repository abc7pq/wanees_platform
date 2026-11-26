export type VenuePoint = { x: number; y: number };
export type GpsRouteNode = VenuePoint & { id: string; label: string; status: string; type?: string };

// Published geographic calibration for Boulevard World, Riyadh.
export const VENUE_CENTER = { lat: 24.7766539, lng: 46.6003677 };
const METERS_PER_UNIT = 0.62;
const METERS_PER_LONGITUDE_DEGREE = 111_320 * Math.cos((VENUE_CENTER.lat * Math.PI) / 180);

export function supportsVenueGps(eventSlug: string) {
  return eventSlug === "boulevard-world-demo" || eventSlug === "boulevard_world";
}

export function toLatLng(x: number, y: number): [number, number] {
  return [
    VENUE_CENTER.lat - (y * METERS_PER_UNIT) / 110_574,
    VENUE_CENTER.lng + (x * METERS_PER_UNIT) / METERS_PER_LONGITUDE_DEGREE,
  ];
}

/** Inverse of toLatLng: device GPS → venue plan coordinates. */
export function fromLatLng(latitude: number, longitude: number): VenuePoint {
  return {
    x: ((longitude - VENUE_CENTER.lng) * METERS_PER_LONGITUDE_DEGREE) / METERS_PER_UNIT,
    y: (-(latitude - VENUE_CENTER.lat) * 110_574) / METERS_PER_UNIT,
  };
}

export function planarDistanceMeters(a: VenuePoint, b: VenuePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y) * METERS_PER_UNIT;
}

export function snapVenuePosition(
  coordinates: { latitude: number; longitude: number; accuracy: number },
  nodes: readonly GpsRouteNode[],
) {
  const { latitude, longitude, accuracy } = coordinates;
  if (![latitude, longitude, accuracy].every(Number.isFinite) || accuracy < 0 || accuracy > 75) {
    return { status: "inaccurate" } as const;
  }
  const point = fromLatLng(latitude, longitude);
  let nearest: GpsRouteNode | undefined;
  let distance = Infinity;
  for (const node of nodes) {
    if (node.status !== "open") continue;
    const candidateDistance = planarDistanceMeters(point, node);
    if (candidateDistance < distance) {
      nearest = node;
      distance = candidateDistance;
    }
  }
  if (!nearest || distance > 120) return { status: "outside" } as const;
  return { status: "ready", point, node: nearest } as const;
}
