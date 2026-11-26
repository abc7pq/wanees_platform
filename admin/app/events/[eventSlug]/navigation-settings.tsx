"use client";

// Venue navigation settings: live GPS guidance, map accuracy, staff location simulation and the
// plan ⇄ GPS calibration. Owners and admins edit; every change is audited (venue.navigation_change).
import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/lib/admin-fetch";

type Settings = {
  liveGuidance: boolean;
  navigationAccuracy: "SURVEYED" | "APPROXIMATE";
  gpsSimulation: boolean;
  geoAnchorLat: number | null;
  geoAnchorLng: number | null;
  metersPerUnit: number | null;
  rotationDeg: number;
};
type Payload = { venue: { id: string; name: string; sharedByEvents: number }; settings: Settings; updatedAt: string };
type Form = { geoAnchorLat: string; geoAnchorLng: string; metersPerUnit: string; rotationDeg: string };

const toForm = (settings: Settings): Form => ({
  geoAnchorLat: settings.geoAnchorLat == null ? "" : String(settings.geoAnchorLat),
  geoAnchorLng: settings.geoAnchorLng == null ? "" : String(settings.geoAnchorLng),
  metersPerUnit: settings.metersPerUnit == null ? "" : String(settings.metersPerUnit),
  rotationDeg: String(settings.rotationDeg),
});

export function NavigationSettings({ eventSlug }: { eventSlug: string }) {
  const path = `/api/v1/events/${encodeURIComponent(eventSlug)}/navigation`;
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [form, setForm] = useState<Form>({ geoAnchorLat: "", geoAnchorLng: "", metersPerUnit: "", rotationDeg: "0" });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  const load = useCallback(async () => {
    const response = await adminFetch(path);
    if (!response.ok) throw new Error("navigation unavailable");
    const payload = (await response.json()).data as Payload;
    setData(payload);
    setForm(toForm(payload.settings));
    setState("ready");
  }, [path]);

  useEffect(() => { load().catch(() => setState("error")); }, [load]);

  const save = async (changes: Partial<Record<keyof Settings, unknown>>, success: string) => {
    if (!data) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await adminFetch(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...changes, updatedAt: data.updatedAt, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message ?? "تعذر حفظ الإعدادات.");
      setData(payload.data);
      setForm(toForm(payload.data.settings));
      setReason("");
      setMessage({ text: success, kind: "ok" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "تعذر حفظ الإعدادات.", kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") return <div className="card" role="status">جارٍ تحميل إعدادات التوجيه…</div>;
  if (state === "error" || !data) {
    return (
      <div className="card" role="alert">
        <h2 id="navigation-settings">التوجيه وGPS</h2>
        <p className="err">تعذر تحميل إعدادات التوجيه. قد تكون الفعالية غير مربوطة بموقع.</p>
        <button className="btn" type="button" onClick={() => { setState("loading"); load().catch(() => setState("error")); }}>إعادة المحاولة</button>
      </div>
    );
  }

  const { settings } = data;
  const calibrated = settings.geoAnchorLat != null && settings.geoAnchorLng != null && settings.metersPerUnit != null;
  return (
    <section className="card" aria-labelledby="navigation-settings">
      <h2 id="navigation-settings">التوجيه وGPS</h2>
      <p className="muted">
        إعدادات موقع «{data.venue.name}»{data.venue.sharedByEvents > 1 ? ` (تنطبق على ${data.venue.sharedByEvents} فعاليات في نفس الموقع)` : ""}.
        تصل للزوار خلال 30 ثانية بدون إعادة نشر الكتالوج، وكل تغيير يُسجل في سجل التدقيق.
      </p>

      <div className="grid2">
        <div>
          <span className="label">التوجيه الحي من موقع الزائر</span>
          <p><strong>{settings.liveGuidance ? "مفعّل" : "متوقف"}</strong>{!calibrated && " · يحتاج معايرة أولًا"}</p>
          <button className={`btn${settings.liveGuidance ? "" : " primary"}`} type="button" disabled={busy || (!calibrated && !settings.liveGuidance)}
            onClick={() => save({ liveGuidance: !settings.liveGuidance }, settings.liveGuidance ? "أُوقف التوجيه الحي." : "فُعّل التوجيه الحي.")}>
            {settings.liveGuidance ? "إيقاف التوجيه الحي" : "تفعيل التوجيه الحي"}
          </button>
        </div>
        <div>
          <label htmlFor="navigation-accuracy">دقة خريطة الموقع</label>
          <select id="navigation-accuracy" value={settings.navigationAccuracy} disabled={busy}
            onChange={(event) => save({ navigationAccuracy: event.target.value }, "حُفظت دقة الخريطة.")}>
            <option value="APPROXIMATE">تقريبية (يُطلب من الزائر اتباع اللوحات أيضًا)</option>
            <option value="SURVEYED">مسح ميداني</option>
          </select>
        </div>
        <div>
          <span className="label">محاكاة الموقع للموظفين والعروض</span>
          <p><strong>{settings.gpsSimulation ? "مسموحة" : "غير مسموحة"}</strong></p>
          <button className="btn" type="button" disabled={busy || (!calibrated && !settings.gpsSimulation)}
            onClick={() => save({ gpsSimulation: !settings.gpsSimulation }, settings.gpsSimulation ? "أُوقفت محاكاة الموقع." : "سُمح بمحاكاة الموقع.")}>
            {settings.gpsSimulation ? "منع المحاكاة" : "السماح بالمحاكاة"}
          </button>
        </div>
        <div>
          <label htmlFor="navigation-reason">سبب التغيير (اختياري، يظهر في سجل التدقيق)</label>
          <input id="navigation-reason" maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثال: بعد جولة المعايرة الميدانية" />
        </div>
      </div>

      <h3>معايرة GPS</h3>
      <p className="muted">موضع نقطة (0، 0) في مخطط الموقع على الخريطة، وعدد الأمتار لكل وحدة، ودوران المخطط عن الشرق باتجاه عقارب الساعة.</p>
      <div className="grid2">
        <div><label htmlFor="navigation-lat">خط العرض</label><input id="navigation-lat" inputMode="decimal" dir="ltr" value={form.geoAnchorLat} onChange={(event) => setForm({ ...form, geoAnchorLat: event.target.value })} placeholder="24.7766539" /></div>
        <div><label htmlFor="navigation-lng">خط الطول</label><input id="navigation-lng" inputMode="decimal" dir="ltr" value={form.geoAnchorLng} onChange={(event) => setForm({ ...form, geoAnchorLng: event.target.value })} placeholder="46.6003677" /></div>
        <div><label htmlFor="navigation-scale">متر لكل وحدة</label><input id="navigation-scale" inputMode="decimal" dir="ltr" value={form.metersPerUnit} onChange={(event) => setForm({ ...form, metersPerUnit: event.target.value })} placeholder="0.62" /></div>
        <div><label htmlFor="navigation-rotation">الدوران بالدرجات</label><input id="navigation-rotation" inputMode="decimal" dir="ltr" value={form.rotationDeg} onChange={(event) => setForm({ ...form, rotationDeg: event.target.value })} /></div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" type="button" disabled={busy}
          onClick={() => save({ geoAnchorLat: form.geoAnchorLat.trim() || null, geoAnchorLng: form.geoAnchorLng.trim() || null, metersPerUnit: form.metersPerUnit.trim() || null, rotationDeg: form.rotationDeg.trim() || "0" }, "حُفظت المعايرة.")}>
          حفظ المعايرة
        </button>
      </div>
      {message && <p className={message.kind === "ok" ? "ok" : "err"} role={message.kind === "ok" ? "status" : "alert"}>{message.text}</p>}
    </section>
  );
}
