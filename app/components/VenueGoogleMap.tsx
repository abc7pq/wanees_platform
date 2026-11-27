"use client";

/** Google Maps JavaScript API renderer — يُفعّل تلقائيًا عند وجود NEXT_PUBLIC_GOOGLE_MAPS_KEY وقت البناء.
 *  نفس طبقات الخريطة: مناطق، مواقع، شبكة مشي، مسار زيارة مرقّم، مسار اتجاهات برتقالي، تمييز الهدف. */
import { useEffect, useRef, useState } from "react";
import type { VenueGeo, VenueMapData } from "./useVenueMapData";

type Stop = { zone: string };

declare global {
  interface Window {
    google?: any;
  }
}

let mapsPromise: Promise<any> | null = null;
function loadGoogleMaps(key: string): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=ar&region=SA&v=weekly`;
    script.async = true;
    script.onload = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("google-maps-missing"));
    };
    script.onerror = () => {
      mapsPromise = null;
      reject(new Error("google-maps-load-failed"));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}

// دبوس دمعة Google — مسار SVG بألوان الخطة
const PIN_PATH = "M 0 -28 C -8 -17 -11 -12 -11 -5 A 11 11 0 1 0 11 -5 C 11 -12 8 -17 0 -28 Z";
function pinIcon(maps: any, color: string) {
  return {
    path: PIN_PATH,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
    scale: 1,
    anchor: new maps.Point(0, 28),
    labelOrigin: new maps.Point(0, -5),
  };
}

export function VenueGoogleMap({
  data,
  geo,
  stops,
  focusId,
  path,
  me,
  apiKey,
  loadErrorFallback,
}: {
  data: VenueMapData;
  geo: VenueGeo;
  stops: Stop[];
  focusId?: string | null;
  path?: { x: number; y: number }[] | null;
  me?: { x: number; y: number; target?: { x: number; y: number } } | null;
  apiKey: string;
  loadErrorFallback: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new maps.Map(containerRef.current, {
          center: geo.center,
          zoom: 15,
          mapTypeControl: true,
          mapTypeControlOptions: { style: maps.MapTypeControlStyle.HORIZONTAL_BAR, position: maps.ControlPosition.TOP_RIGHT },
          zoomControl: true,
          zoomControlOptions: { position: maps.ControlPosition.RIGHT_BOTTOM },
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) loadErrorFallback();
      });
    return () => {
      cancelled = true;
      mapRef.current = null;
    };
  }, [apiKey, loadErrorFallback]);

  useEffect(() => {
    const maps = window.google?.maps;
    const map = mapRef.current;
    if (!ready || !maps || !map || !data.zones.length) return;

    const overlays: any[] = [];
    const addPolyline = (latLngs: [number, number][], opts: Record<string, unknown>) => {
      const line = new maps.Polyline({ path: latLngs.map(([lat, lng]) => ({ lat, lng })), map, ...opts });
      overlays.push(line);
      return line;
    };
    const addPin = (latLng: [number, number], opts: Record<string, unknown>) => {
      const marker = new maps.Marker({ position: { lat: latLng[0], lng: latLng[1] }, map, ...opts });
      overlays.push(marker);
      return marker;
    };
    const bounds = new maps.LatLngBounds();
    const extend = (latLng: [number, number]) => bounds.extend({ lat: latLng[0], lng: latLng[1] });

    // شبكة المشي بين المناطق
    const nodeById = new Map((data.routeGraph?.nodes ?? []).map((node) => [node.id, node]));
    for (const edge of data.routeGraph?.edges ?? []) {
      if (edge.status !== "open") continue;
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) continue;
      addPolyline([geo.toLatLng(from.x, from.y), geo.toLatLng(to.x, to.y)], {
        strokeColor: "#8e2bff",
        strokeOpacity: edge.accessible ? 0.35 : 0.16,
        strokeWeight: 2,
        ...(edge.accessible ? {} : { strokeDashStyle: 2, icons: [] }),
        clickable: false,
      });
      extend(geo.toLatLng(from.x, from.y));
      extend(geo.toLatLng(to.x, to.y));
    }

    // المواقع (دورات مياه، بوابات…) كنقاط صغيرة بعنوان عند التحويم
    for (const location of data.locations) {
      if (location.status !== "open") continue;
      const ll = geo.toLatLng(location.x, location.y);
      addPin(ll, {
        title: location.label,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 4, fillColor: "#ffffff", fillOpacity: 0.9, strokeColor: "#5d647b", strokeWeight: 1.5 },
      });
      extend(ll);
    }

    // مناطق الموقع: دائرة بنفسجية مع الاسم العربي فوقها
    for (const zone of data.zones) {
      const ll = geo.toLatLng(zone.x, zone.y);
      addPin(ll, {
        clickable: false,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: "#8e2bff", fillOpacity: 0.18, strokeColor: "#8e2bff", strokeWeight: 2.5 },
        label: { text: zone.name, color: "#3b1f66", fontSize: "12px", fontWeight: "700", fontFamily: "inherit" },
      });
      extend(ll);
    }

    // مسار الزيارة: خط متقطع فيروزي + دبابيس مرقّمة
    const routeZones = [...new Set(stops.map((stop) => stop.zone))];
    const routeLatLngs = routeZones
      .map((zoneId) => data.zones.find((zone) => zone.id === zoneId))
      .filter((zone): zone is NonNullable<typeof zone> => Boolean(zone))
      .map((zone) => geo.toLatLng(zone.x, zone.y));
    if (routeLatLngs.length > 1) {
      addPolyline(routeLatLngs, { strokeColor: "#00806f", strokeOpacity: 0.9, strokeWeight: 5, clickable: false });
      routeLatLngs.forEach((ll, index) => {
        addPin(ll, {
          clickable: false,
          icon: pinIcon(maps, "#00806f"),
          label: { text: String(index + 1), color: "#ffffff", fontSize: "13px", fontWeight: "800", fontFamily: "inherit" },
          zIndex: 30,
        });
      });
    }

    if (path?.length) {
      const pathLatLngs = path.map((point) => geo.toLatLng(point.x, point.y));
      addPolyline(pathLatLngs, { strokeColor: "#ff8c00", strokeOpacity: 0.95, strokeWeight: 8, clickable: false, zIndex: 50 });
      addPin(pathLatLngs[0], { title: "البداية", icon: { path: maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#ffffff", fillOpacity: 1, strokeColor: "#ff8c00", strokeWeight: 3 } });
      addPin(pathLatLngs[pathLatLngs.length - 1], { icon: pinIcon(maps, "#ff8c00"), label: { text: "!", color: "#ffffff", fontSize: "14px", fontWeight: "800" }, zIndex: 60 });
      map.fitBounds(boundsFor(maps, pathLatLngs), 64);
      overlaysRef.current = overlays;
      return;
    }

    const focusedZone = focusId ? data.zones.find((zone) => zone.id === focusId) : null;
    const focusedLocation = focusId ? data.locations.find((location) => location.id === focusId) : null;
    const focusLL = focusedZone ? geo.toLatLng(focusedZone.x, focusedZone.y) : focusedLocation ? geo.toLatLng(focusedLocation.x, focusedLocation.y) : null;
    if (focusLL) {
      addPin(focusLL, { icon: pinIcon(maps, "#ea4335"), zIndex: 70 });
      map.setZoom(Math.max(map.getZoom(), 16));
      map.panTo({ lat: focusLL[0], lng: focusLL[1] });
      overlaysRef.current = overlays;
      return;
    }

    if (!bounds.isEmpty()) map.fitBounds(bounds, 24);
    overlaysRef.current = overlays;
  }, [ready, data, stops, focusId, path]);

  // دليل AirTag في مصيّر Google: سهم يدور بزاوية الهدف + نقطة موقعي + شارة المسافة
  useEffect(() => {
    const maps = window.google?.maps;
    const map = mapRef.current;
    if (!ready || !maps || !map || !me) return;
    const overlays: any[] = [];
    const meLL = { lat: geo.toLatLng(me.x, me.y)[0], lng: geo.toLatLng(me.x, me.y)[1] };
    if (path?.length) {
      overlays.push(new maps.Polyline({ path: path.map((point) => { const [lat, lng] = geo.toLatLng(point.x, point.y); return { lat, lng }; }), map, strokeColor: "#ff8c00", strokeOpacity: 0.95, strokeWeight: 8, clickable: false, zIndex: 50 }));
    }
    const bearing = me.target ? (Math.atan2(me.target.x - me.x, -(me.target.y - me.y)) * 180) / Math.PI : 0;
    overlays.push(new maps.Marker({
      position: meLL,
      map,
      icon: { path: "M 0 -14 L 9 13 L 0 7 L -9 13 Z", fillColor: "#0066ff", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2, rotation: bearing, scale: 1.6 },
      zIndex: 90,
    }));
    overlays.push(new maps.Circle({ center: meLL, radius: 6, map, fillColor: "#0066ff", fillOpacity: 0.9, strokeColor: "#ffffff", strokeWeight: 3, zIndex: 89 }));
    if (me.target) {
      const meters = Math.round(geo.distanceMeters(me, me.target));
      const [tLat, tLng] = geo.toLatLng(me.target.x, me.target.y);
      overlays.push(new maps.Marker({
        position: { lat: tLat, lng: tLng },
        map,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 0.1, fillColor: "#0066ff", fillOpacity: 0, strokeOpacity: 0 },
        label: { text: meters >= 1000 ? `${(meters / 1000).toFixed(1)} كم` : `${meters} م`, color: "#ffffff", fontSize: "12px", fontWeight: "800", fontFamily: "inherit" },
        zIndex: 85,
      }));
    }
    map.setZoom(Math.max(map.getZoom(), 16));
    map.panTo(meLL);
    return () => {
      for (const overlay of overlays) overlay.setMap(null);
    };
  }, [ready, me, path]);

  useEffect(() => () => {
    for (const overlay of overlaysRef.current) overlay.setMap(null);
    overlaysRef.current = [];
  }, []);

  return <div ref={containerRef} className="geo-map-container" role="application" aria-label="خريطة Google تفاعلية بمواقع المناطق الحقيقية ومسار زيارتك" />;
}

function boundsFor(maps: any, latLngs: [number, number][]) {
  const bounds = new maps.LatLngBounds();
  for (const [lat, lng] of latLngs) bounds.extend({ lat, lng });
  return bounds;
}
