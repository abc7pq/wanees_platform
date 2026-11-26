// Venue-plan ⇄ GPS conversion from the venue's own calibration (Venue.geoAnchorLat, geoAnchorLng,
// metersPerUnit, rotationDeg in the database). Nothing here is specific to one event.
// Plan coordinates: x towards the plan's east, y towards the plan's south.
import type { GeoCalibration, VenueNavigation } from "../../packages/contracts/src/index.ts";

export type { GeoCalibration, VenueNavigation };
export type VenuePoint = { x: number; y: number };
export type GpsRouteNode = VenuePoint & { id: string; label: string; status: string; type?: string };

const METERS_PER_LATITUDE_DEGREE = 110_574;

export type VenueGeo = {
  calibration: GeoCalibration;
  /** Plan point → [latitude, longitude]. */
  toLatLng(x: number, y: number): [number, number];
  /** Device GPS → plan point. */
  fromLatLng(latitude: number, longitude: number): VenuePoint;
  /** Straight-line metres between two plan points. */
  distanceMeters(a: VenuePoint, b: VenuePoint): number;
  /** A bearing measured on the plan (0 = plan north) as a compass bearing (0 = true north). */
  compassBearing(planBearing: number): number;
  /** The anchor (plan origin) as a map centre. */
  center: { lat: number; lng: number };
};

/** True when the venue has a complete GPS calibration. */
export function hasGeoCalibration(navigation: Pick<VenueNavigation, "calibration"> | null | undefined): navigation is { calibration: GeoCalibration } {
  const calibration = navigation?.calibration;
  return Boolean(calibration
    && Number.isFinite(calibration.anchorLat) && Math.abs(calibration.anchorLat) <= 90
    && Number.isFinite(calibration.anchorLng) && Math.abs(calibration.anchorLng) <= 180
    && Number.isFinite(calibration.metersPerUnit) && calibration.metersPerUnit > 0
    && Number.isFinite(calibration.rotationDeg));
}

export function createVenueGeo(calibration: GeoCalibration): VenueGeo {
  const { anchorLat, anchorLng, metersPerUnit } = calibration;
  const rotation = (calibration.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const metersPerLongitudeDegree = 111_320 * Math.cos((anchorLat * Math.PI) / 180);
  return {
    calibration,
    center: { lat: anchorLat, lng: anchorLng },
    toLatLng(x, y) {
      // Plan metres (east, north) before rotation, then rotate clockwise by rotationDeg.
      const planEast = x * metersPerUnit;
      const planNorth = -y * metersPerUnit;
      const east = planEast * cos + planNorth * sin;
      const north = -planEast * sin + planNorth * cos;
      return [anchorLat + north / METERS_PER_LATITUDE_DEGREE, anchorLng + east / metersPerLongitudeDegree];
    },
    fromLatLng(latitude, longitude) {
      const east = (longitude - anchorLng) * metersPerLongitudeDegree;
      const north = (latitude - anchorLat) * METERS_PER_LATITUDE_DEGREE;
      const planEast = east * cos - north * sin;
      const planNorth = east * sin + north * cos;
      return { x: planEast / metersPerUnit, y: -planNorth / metersPerUnit };
    },
    distanceMeters(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y) * metersPerUnit;
    },
    compassBearing(planBearing) {
      return (((planBearing + calibration.rotationDeg) % 360) + 360) % 360;
    },
  };
}

/** Accuracy (m) up to which a fix is trusted as precise; worse fixes up to the limit are "approximate". */
export const GPS_PRECISE_ACCURACY_M = 75;
/** Fixes worse than this are rejected (audit item 3.3). */
export const GPS_MAX_ACCURACY_M = 150;
/** A fix further than this from every open walkway node is outside the venue. */
export const GPS_OUTSIDE_DISTANCE_M = 120;

export type SnapResult =
  | { status: "inaccurate" }
  | { status: "outside" }
  | { status: "ready"; point: VenuePoint; node: GpsRouteNode; approximate: boolean; candidates: GpsRouteNode[] };

/**
 * Snaps a device fix to the nearest open walkway node. A fix up to 75 m is precise; up to 150 m it
 * is approximate and also returns the second-nearest node as an alternative start (crowds and
 * buildings degrade GPS; refusing those fixes left visitors with no guidance at all).
 */
export function snapVenuePosition(
  geo: VenueGeo,
  coordinates: { latitude: number; longitude: number; accuracy: number },
  nodes: readonly GpsRouteNode[],
): SnapResult {
  const { latitude, longitude, accuracy } = coordinates;
  if (![latitude, longitude, accuracy].every(Number.isFinite) || accuracy < 0 || accuracy > GPS_MAX_ACCURACY_M) {
    return { status: "inaccurate" };
  }
  const point = geo.fromLatLng(latitude, longitude);
  const ranked = nodes
    .filter((node) => node.status === "open")
    .map((node) => ({ node, distance: geo.distanceMeters(point, node) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = ranked[0];
  if (!nearest || nearest.distance > GPS_OUTSIDE_DISTANCE_M + Math.max(0, accuracy - GPS_PRECISE_ACCURACY_M)) return { status: "outside" };
  const approximate = accuracy > GPS_PRECISE_ACCURACY_M;
  const candidates = approximate ? ranked.slice(0, 2).map((entry) => entry.node) : [nearest.node];
  return { status: "ready", point, node: nearest.node, approximate, candidates };
}
