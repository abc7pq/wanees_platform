"use client";

/** شاشة «البحث الدقيق» بنمط AirTag: سهم كبير يدور مع بوصلة الجهاز نحو النقطة التالية على مسار المشي،
 *  مسافة متبقية بالأمتار، وخلفية خضراء عندما يكون الزائر متجهًا للاتجاه الصحيح.
 *  الموقع من GPS الجهاز (أو محاكاة في العرض التجريبي) والمسار من خدمة الاتجاهات — لا شيء من نموذج لغوي. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UiIcon } from "./UiIcon";

type Point = { x: number; y: number };
export type GuideState = Point & {
  target: Point;
  destName: string;
  remainingM: number;
  totalWalkMin: number;
  arrived: boolean;
  simulated: boolean;
  crowdedZones: string[];
  destCrowded?: boolean;
  /** التعليمة التالية («بعد ٤٠ م لف يمين عند …») وأيقونتها، ومفتاح يتغير مع كل تعليمة جديدة للنطق */
  nextInstruction?: string | null;
  nextIcon?: string | null;
  nextKey?: string | null;
  accuracyM?: number | null;
  heading?: number | null;
  /** Clockwise rotation of the venue plan from true north (Venue.rotationDeg); the compass is true north. */
  planRotationDeg?: number;
  /** The venue plan is approximate: tell the visitor to follow the venue signs too. */
  approximate?: boolean;
};

type OrientationEventWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number };
type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

/** اتجاه من نقطة لنقطة بالدرجات من الشمال (x شرقًا، y جنوبًا) */
export function bearingDeg(from: Point, to: Point) {
  const degrees = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

function signedDelta(a: number, b: number) {
  return ((a - b + 540) % 360) - 180;
}

function formatMeters(meters: number) {
  if (meters >= 1000) return { value: (meters / 1000).toFixed(1), unit: "كم" };
  return { value: String(Math.max(0, Math.round(meters))), unit: "م" };
}

function useCompass() {
  const [heading, setHeading] = useState<number | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const listening = useRef(false);

  const listen = useCallback(() => {
    if (listening.current || typeof window === "undefined") return;
    listening.current = true;
    const onOrientation = (event: Event) => {
      const orientation = event as OrientationEventWithCompass;
      let value: number | null = null;
      if (typeof orientation.webkitCompassHeading === "number") value = orientation.webkitCompassHeading;
      else if (orientation.absolute && typeof orientation.alpha === "number") value = 360 - orientation.alpha;
      if (value == null) return;
      const screenAngle = typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle : 0;
      setHeading((value + screenAngle + 360) % 360);
    };
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrientation, true);
      window.removeEventListener("deviceorientation", onOrientation, true);
      listening.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return;
    const permission = DeviceOrientationEvent as unknown as OrientationPermission;
    if (typeof permission.requestPermission === "function") {
      setNeedsPermission(true);
      return;
    }
    return listen();
  }, [listen]);

  const requestPermission = useCallback(async () => {
    const permission = DeviceOrientationEvent as unknown as OrientationPermission;
    try {
      const result = await permission.requestPermission?.();
      if (result === "granted") {
        setNeedsPermission(false);
        listen();
      }
    } catch {
      setNeedsPermission(false);
    }
  }, [listen]);

  return { heading, needsPermission, requestPermission };
}

export function PrecisionGuide({ guide, onClose, onShowMap }: { guide: GuideState; onClose: () => void; onShowMap: () => void }) {
  const { heading: compassHeading, needsPermission, requestPermission } = useCompass();
  // المحاكاة تفترض أن الجوال باتجاه المشي؛ الواقع يستخدم البوصلة ثم اتجاه حركة GPS
  const heading = guide.simulated ? guide.heading ?? null : compassHeading ?? guide.heading ?? null;
  const [voiceOn, setVoiceOn] = useState(false);
  const spokenKey = useRef<string | null>(null);

  // التوجيه الصوتي: نطق كل تعليمة جديدة مرة واحدة (والوصول)
  useEffect(() => {
    if (!voiceOn || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const key = guide.arrived ? "arrived" : guide.nextKey ?? null;
    const text = guide.arrived ? `وصلت إلى ${guide.destName}` : guide.nextInstruction;
    if (!key || !text || spokenKey.current === key) return;
    spokenKey.current = key;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ar-SA";
    const arabic = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("ar"));
    if (arabic) utterance.voice = arabic;
    utterance.rate = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [voiceOn, guide.arrived, guide.nextKey, guide.nextInstruction, guide.destName]);
  useEffect(() => () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);
  // Plan bearings become compass bearings with the venue rotation; a simulated walk stays in plan space.
  const bearing = (bearingDeg(guide, guide.target) + (guide.simulated ? 0 : guide.planRotationDeg ?? 0) + 360) % 360;
  const relative = heading == null ? bearing : signedDelta(bearing, heading);
  const aligned = heading != null && Math.abs(signedDelta(bearing, heading)) <= 22;
  const distance = formatMeters(guide.remainingM);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasAligned = useRef(false);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (aligned && !wasAligned.current && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(35);
    wasAligned.current = aligned;
  }, [aligned]);

  const hint = useMemo(() => {
    if (guide.arrived) return "وصلت! 🎉";
    if (heading == null) return "اتبع السهم — أعلى الشاشة هو الشمال";
    const delta = signedDelta(bearing, heading);
    if (Math.abs(delta) <= 22) return "أمامك";
    if (Math.abs(delta) >= 150) return "ارجع للخلف";
    return delta > 0 ? "لف يمين" : "لف يسار";
  }, [bearing, guide.arrived, heading]);

  const dots = useMemo(() => Array.from({ length: 64 }, (_, index) => ({
    a: `${(index * 360) / 64}deg`,
    r: `${118 + ((index * 37) % 23)}px`,
    d: `${((index * 53) % 24) / 10}s`,
  })), []);

  return (
    <div className={`guide-overlay${aligned ? " is-aligned" : ""}${guide.arrived ? " is-arrived" : ""}`} role="dialog" aria-modal="true" aria-label={`التوجيه إلى ${guide.destName}`}>
      <div className="guide-head">
        <small>{guide.simulated ? "توجيه تجريبي (محاكاة مشي)" : "جارٍ البحث"}</small>
        <h2>{guide.destName}</h2>
        <p>{guide.arrived ? "أنت عند الوجهة" : `حوالي ${Math.max(1, Math.round(guide.remainingM / 65))} د مشي`}{guide.accuracyM ? ` · دقة الموقع ±${Math.round(guide.accuracyM)} م` : ""}</p>
        {guide.approximate && !guide.arrived && <p className="guide-approx" role="note">المسار تقريبي، اتبع لوحات الموقع أيضًا.</p>}
      </div>

      <div className="guide-stage" aria-hidden="true">
        {!aligned && !guide.arrived && <div className="guide-dots">{dots.map((dot, index) => <i key={index} style={{ ["--a" as string]: dot.a, ["--r" as string]: dot.r, ["--d" as string]: dot.d }} />)}</div>}
        {guide.arrived ? (
          <svg className="guide-arrow" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#fff" strokeWidth="8"/><path d="M30 52l13 13 27-30" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/></svg>
        ) : (
          <>
            {aligned && <span className="guide-target-dot" />}
            <svg className="guide-arrow" viewBox="0 0 100 100" style={{ ["--rot" as string]: `${relative}deg` }}>
              <path d="M50 8 L50 88 M50 8 L22 38 M50 8 L78 38" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </>
        )}
      </div>

      <div className="guide-foot">
        <div aria-live="polite">
          <div className="guide-distance">{distance.value}<span>{distance.unit}</span></div>
          <div className="guide-hint">{hint}</div>
        </div>
        {guide.nextInstruction && !guide.arrived && (
          <div className="guide-next" aria-live="polite"><span aria-hidden="true">{guide.nextIcon}</span>{guide.nextInstruction}</div>
        )}
        {(guide.crowdedZones.length > 0 || guide.destCrowded) && !guide.arrived && (
          <div className="guide-meta">
            {guide.crowdedZones.length > 0 && <span className="is-packed">زحمة على الطريق: {guide.crowdedZones.join("، ")}</span>}
            {guide.destCrowded && <span className="is-packed">الوجهة مزدحمة الآن</span>}
          </div>
        )}
        <div className="guide-actions">
          <button ref={closeRef} type="button" className="guide-close" aria-label="إنهاء التوجيه" onClick={onClose}><UiIcon name="close" /></button>
          {needsPermission && <button type="button" className="guide-compass-btn" onClick={requestPermission}><UiIcon name="compass" size={18} /> البوصلة</button>}
          <span className="guide-actions-end">
            <button type="button" onClick={onShowMap} aria-label="عرض الخريطة"><UiIcon name="map" /></button>
            <button type="button" className="guide-voice" aria-pressed={voiceOn} aria-label={voiceOn ? "إيقاف التوجيه الصوتي" : "تشغيل التوجيه الصوتي"} onClick={() => { spokenKey.current = null; setVoiceOn((value) => !value); }}>{voiceOn ? <UiIcon name="speaker" /> : <UiIcon name="speakerOff" />}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
