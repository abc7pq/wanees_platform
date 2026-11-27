"use client";

import { useEffect, useMemo, useState } from "react";
import { createVenueGeo, hasGeoCalibration, type VenueGeo, type VenueNavigation } from "../lib/venue-gps";
export type { VenueGeo, VenueNavigation };

export type ZoneXY = { id: string; name: string; x: number; y: number };
export type MapLocation = { id: string; label: string; type: string; zone?: string; x: number; y: number; accessible: boolean; status: string };
export type RouteGraph = { nodes: Array<{ id: string; x: number; y: number; status: string }>; edges: Array<{ from: string; to: string; status: string; accessible: boolean }> };
export type VenueMapData = { zones: ZoneXY[]; locations: MapLocation[]; routeGraph: RouteGraph | null; navigation: VenueNavigation | null; loaded: boolean };

/** بيانات الخريطة المنشورة (مناطق/مواقع/شبكة مشي) لجميع مصيرات الخريطة */
export function useVenueMapData(eventSlug: string, onError: () => void) {
  const [data, setData] = useState<VenueMapData>({ zones: [], locations: [], routeGraph: null, navigation: null, loaded: false });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/map`, { signal: controller.signal, credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("map unavailable");
        return response.json();
      })
      .then((payload) => {
        setData({ zones: payload.data?.zones ?? [], locations: payload.data?.locations ?? [], routeGraph: payload.data?.routeGraph ?? null, navigation: payload.data?.navigation ?? null, loaded: true });
      })
      .catch((error) => { if (error?.name !== "AbortError") onError(); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSlug]);

  return data;
}

/** The venue's plan ⇄ GPS conversion, or null when the organizer has not calibrated the venue. */
export function useVenueGeo(navigation: VenueNavigation | null | undefined): VenueGeo | null {
  const calibration = navigation?.calibration;
  return useMemo(
    () => (navigation && hasGeoCalibration(navigation) ? createVenueGeo(navigation.calibration) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calibration?.anchorLat, calibration?.anchorLng, calibration?.metersPerUnit, calibration?.rotationDeg],
  );
}

/** Plan-unit extent of everything on the map, so any venue fits its own bounds. */
export function planExtent(data: Pick<VenueMapData, "zones" | "locations" | "routeGraph">, fallback = { minX: -100, maxX: 100, minY: -100, maxY: 100 }) {
  const points = [...data.zones, ...data.locations, ...(data.routeGraph?.nodes ?? [])];
  if (!points.length) return fallback;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const pad = Math.max(40, (Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)) * 0.05);
  return { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad };
}
