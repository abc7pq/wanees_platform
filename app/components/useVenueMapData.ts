"use client";

import { useEffect, useState } from "react";
export { VENUE_CENTER, fromLatLng, planarDistanceMeters, toLatLng } from "../lib/venue-gps";

export type ZoneXY = { id: string; name: string; x: number; y: number };
export type MapLocation = { id: string; label: string; type: string; zone?: string; x: number; y: number; accessible: boolean; status: string };
export type RouteGraph = { nodes: Array<{ id: string; x: number; y: number; status: string }>; edges: Array<{ from: string; to: string; status: string; accessible: boolean }> };
export type VenueMapData = { zones: ZoneXY[]; locations: MapLocation[]; routeGraph: RouteGraph | null };

/** بيانات الخريطة المنشورة (مناطق/مواقع/شبكة مشي) لجميع مصيرات الخريطة */
export function useVenueMapData(eventSlug: string, onError: () => void) {
  const [data, setData] = useState<VenueMapData>({ zones: [], locations: [], routeGraph: null });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/map`, { signal: controller.signal, credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("map unavailable");
        return response.json();
      })
      .then((payload) => {
        setData({ zones: payload.data?.zones ?? [], locations: payload.data?.locations ?? [], routeGraph: payload.data?.routeGraph ?? null });
      })
      .catch((error) => { if (error?.name !== "AbortError") onError(); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSlug]);

  return data;
}
