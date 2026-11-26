"use client";

import { useState } from "react";

// «حولي» (audit 2.2, 3.2): one tap to the nearest toilets, food, prayer room, first aid, info desk or
// seating, by real walking minutes from where the visitor is. Each result has «دلّني».
const CATEGORIES = [
  { id: "toilets", label: "دورات المياه", icon: "🚻" },
  { id: "food", label: "أكل وقهوة", icon: "🍽️" },
  { id: "prayer", label: "مصلى", icon: "🕌" },
  { id: "first_aid", label: "إسعاف", icon: "⛑️" },
  { id: "info", label: "معلومات", icon: "ℹ️" },
  { id: "seating", label: "مكان أرتاح فيه", icon: "🪑" },
] as const;

export type NearbyPosition = { nodeId: string; accuracyM: number; capturedAt: string };

type NearbyResult = { id: string; kind: "activity" | "location"; name: string; zoneName: string; walkMin: number };
type NearbyResponse = {
  category: string;
  label: string;
  calmInstead: boolean;
  origin: { source: string; phrase: string } | null;
  positionRejected?: string;
  results: NearbyResult[];
};

export function NearbyPanel({ eventSlug, request, locate, stopZone, onGuide, onShowOnMap }: {
  eventSlug: string;
  request: (path: string) => Promise<{ data: NearbyResponse }>;
  /** Snaps the device's GPS to a walkway node on the phone; null when unavailable or refused. */
  locate: () => Promise<NearbyPosition | null>;
  stopZone?: string;
  onGuide: (targetId: string, opener: HTMLButtonElement) => void;
  onShowOnMap: (zone: string) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<NearbyResponse | null>(null);

  const look = async (category: string) => {
    setActive(category);
    setBusy(true);
    setError("");
    try {
      const position = await locate().catch(() => null);
      const query = new URLSearchParams({ category });
      if (position) {
        query.set("nodeId", position.nodeId);
        query.set("source", "gps");
        query.set("capturedAt", position.capturedAt);
        query.set("accuracyM", String(Math.round(position.accuracyM)));
      }
      if (stopZone) query.set("stopZone", stopZone);
      const response = await request(`/api/v1/events/${encodeURIComponent(eventSlug)}/nearby?${query.toString()}`);
      setAnswer(response.data);
    } catch {
      setAnswer(null);
      setError("تعذر جلب الأماكن القريبة الآن. تحقّق من الاتصال وحاول مرة ثانية.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nearby-panel">
      <h2 id="nearby-title">وش تبي قريب منك؟</h2>
      <div className="nearby-grid" role="group" aria-labelledby="nearby-title">
        {CATEGORIES.map((category) => (
          <button key={category.id} type="button" className="nearby-tile" aria-pressed={active === category.id} disabled={busy} onClick={() => void look(category.id)}>
            <span aria-hidden="true">{category.icon}</span>
            {category.label}
          </button>
        ))}
      </div>
      <div aria-live="polite" aria-busy={busy}>
        {busy && <div className="skeleton-list" aria-label="أدور لك على الأقرب">{[0, 1, 2].map((key) => <span key={key} className="skeleton-row" />)}</div>}
        {error && <p className="guide" role="alert">{error}</p>}
        {!busy && answer && <>
          <p className="nearby-origin">
            {answer.calmInstead ? "ما فيه جلسات منشورة، هذي أهدى أماكن قريبة" : `أقرب ${answer.label}`}
            {answer.origin ? ` ${answer.origin.phrase}` : ""}
          </p>
          {answer.origin?.source !== "gps" && <p className="visitor-note">فعّل الموقع عشان أحسب المشي من مكانك بالضبط.</p>}
          {!answer.results.length && <p className="guide">ما فيه {answer.label} في قائمة هذي الفعالية. نقطة المعلومات تقدر تساعدك.</p>}
          <ol className="nearby-results">
            {answer.results.map((place) => (
              <li key={place.id}>
                <div>
                  <strong>{place.name}</strong>
                  <small>{place.zoneName} · {place.walkMin ? `${place.walkMin} د مشي` : "في نفس المنطقة"}</small>
                </div>
                <div className="nearby-actions">
                  <button type="button" className="link-btn" onClick={() => onShowOnMap(place.id)}>على الخريطة</button>
                  <button type="button" className="cta small" onClick={(event) => onGuide(place.id, event.currentTarget)}>دلّني</button>
                </div>
              </li>
            ))}
          </ol>
        </>}
      </div>
    </div>
  );
}
