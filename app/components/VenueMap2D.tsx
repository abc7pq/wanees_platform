"use client";

import { useEffect, useState } from "react";

type Stop = { zone: string };
type ZoneXY = { id: string; name: string; x: number; y: number };
type MapLocation = { id: string; label: string; type: string; zone?: string; x: number; y: number; accessible: boolean; status: string };
type RouteGraph = { nodes: Array<{ id: string; x: number; y: number; status: string }>; edges: Array<{ from: string; to: string; status: string; accessible: boolean }> };

function zoneLines(name: string): string[] {
  const clean = name.replace(/^منطقة\s+/, "");
  const lines: string[] = [];
  let current = "";
  for (const word of clean.split(/\s+/)) {
    if (current && (current + " " + word).length > 10) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

export function VenueMap2D({ stops, eventSlug, focusId, path }: { stops: Stop[]; eventSlug: string; focusId?: string | null; path?: { x: number; y: number }[] | null }) {
  const [zones, setZones] = useState<ZoneXY[]>([]);
  const [locations, setLocations] = useState<MapLocation[]>([]);
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [routeGraph, setRouteGraph] = useState<RouteGraph | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/map`, { signal: controller.signal, credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("map unavailable");
        return response.json();
      })
      .then((payload) => {
        setShowAccessibility(payload.data?.demoNavigation === false);
        setZones(payload.data?.zones ?? []);
        setLocations(payload.data?.locations ?? []);
        setRouteGraph(payload.data?.routeGraph ?? null);
      })
      .catch((error) => { if (error?.name !== "AbortError") setRouteGraph(null); });
    return () => controller.abort();
  }, [eventSlug]);

  const routeZones = [...new Set(stops.map((stop) => stop.zone))];
  const points = routeZones.map((zone) => zones.find((item) => item.id === zone)).filter(Boolean) as ZoneXY[];
  const nodeById = new Map((routeGraph?.nodes ?? []).map((node) => [node.id, node]));
  const focusedLocation = locations.find((location) => location.id === focusId);

  return (
    <div className="map-card" aria-label="خريطة مسار الزيارة">
      <svg viewBox="-600 -680 1200 1380" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="خريطة المسار">
        {routeGraph?.edges.filter((edge) => edge.status === "open").map((edge) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);
          if (!from || !to) return null;
          return <line key={`${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.accessible ? "rgba(142,43,255,0.20)" : "rgba(142,43,255,0.09)"} strokeWidth="5" strokeDasharray={edge.accessible ? undefined : "8 8"} />;
        })}
        {points.length > 1 && <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#00806f" strokeWidth="6" strokeDasharray="14 10" strokeLinecap="round" opacity={0.9} />}
        {path && path.length > 1 && (
          <g aria-label="مسار الاتجاهات">
            <polyline points={path.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#ff8c00" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
            <circle cx={path[0].x} cy={path[0].y} r="16" fill="#ffffff" stroke="#ff8c00" strokeWidth="6" />
            <circle cx={path[path.length - 1].x} cy={path[path.length - 1].y} r="20" fill="#ff8c00" stroke="#ffffff" strokeWidth="5" />
          </g>
        )}
        {zones.map((zone) => {
          const onRoute = routeZones.includes(zone.id);
          const lines = zoneLines(zone.name);
          const y0 = zone.y + 8 - (lines.length - 1) * 11;
          return (
            <g key={zone.id}>
              <circle cx={zone.x} cy={zone.y} r={onRoute ? 46 : 36} fill={onRoute ? "rgba(142,43,255,0.12)" : "#f5f3fe"} stroke={onRoute ? "#8e2bff" : "rgba(142,43,255,0.20)"} strokeWidth={onRoute ? 5 : 2} />
              <text x={zone.x} y={y0} textAnchor="middle" fontSize={onRoute ? 22 : 19} fill={onRoute ? "#2d1b4f" : "#6b6a86"}>{lines.map((line, index) => <tspan key={index} x={zone.x} dy={index === 0 ? 0 : 21}>{line}</tspan>)}</text>
            </g>
          );
        })}
        {locations.map((location) => {
          const focused = location.id === focusId;
          const closed = location.status !== "open";
          return (
            <g key={location.id} opacity={closed ? 0.55 : 1}>
              <circle cx={location.x} cy={location.y} r={focused ? 28 : 18} fill={focused ? "#ff8c00" : closed ? "#b9b4c9" : "#8e2bff"} stroke="#ffffff" strokeWidth={focused ? 6 : 3} />
              <text x={location.x} y={location.y - (focused ? 38 : 28)} textAnchor="middle" fontSize={focused ? 18 : 14} fill={focused ? "#2d1b4f" : "#5d647b"}>{location.label}</text>
            </g>
          );
        })}
        {focusedLocation && <text x={focusedLocation.x} y={focusedLocation.y + 52} textAnchor="middle" fontSize="16" fill="#8e2bff">موقع مختار</text>}
      </svg>
      {focusedLocation && <p className="map-focus-note">{focusedLocation.label}{showAccessibility && (focusedLocation.accessible ? " · مناسب للوصول" : " · قد يحتاج مسارًا خاصًا")}</p>}
    </div>
  );
}
