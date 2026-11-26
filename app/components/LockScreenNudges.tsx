"use client";

import { useEffect, useState } from "react";
import styles from "./lock-screen-nudges.module.css";

type Status = "checking" | "hidden" | "ios-install" | "off" | "on" | "denied" | "busy" | "error";

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function isIosBrowserTab() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function workerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  // OfflineSupport registers the worker in production builds; register here too in case it has not yet.
  if (process.env.NODE_ENV !== "production") return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/**
 * Opt-in for lock-screen nudges. Nothing is asked until the visitor taps the button; the browser then
 * shows its own permission prompt. The subscription lives only as long as this visit.
 */
export function LockScreenNudges({ eventSlug, openPath, seenNudgeIds }: { eventSlug: string; openPath: string; seenNudgeIds: () => string[] }) {
  const [status, setStatus] = useState<Status>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const api = `/api/v1/events/${encodeURIComponent(eventSlug)}/push`;

  useEffect(() => {
    let disposed = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("Notification" in window)) {
        if (!disposed) setStatus(isIosBrowserTab() ? "ios-install" : "hidden");
        return;
      }
      if (!("PushManager" in window)) {
        if (!disposed) setStatus(isIosBrowserTab() ? "ios-install" : "hidden");
        return;
      }
      try {
        const response = await fetch(api, { credentials: "same-origin", cache: "no-store" });
        const body = await response.json();
        if (!body?.data?.enabled || !body.data.publicKey) { if (!disposed) setStatus("hidden"); return; }
        const registration = await workerRegistration();
        if (!registration) { if (!disposed) setStatus("hidden"); return; }
        const current = await registration.pushManager.getSubscription();
        if (disposed) return;
        setPublicKey(body.data.publicKey);
        if (Notification.permission === "denied") setStatus("denied");
        else setStatus(current && Notification.permission === "granted" ? "on" : "off");
      } catch {
        if (!disposed) setStatus("hidden");
      }
    })();
    return () => { disposed = true; };
  }, [api]);

  const turnOn = async () => {
    if (!publicKey) return;
    setStatus("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus(permission === "denied" ? "denied" : "off"); return; }
      const registration = await workerRegistration();
      if (!registration) { setStatus("error"); return; }
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const key = base64UrlToBytes(publicKey);
      const sameKey = subscription?.options.applicationServerKey
        && new Uint8Array(subscription.options.applicationServerKey).every((byte, index) => byte === key[index]);
      if (subscription && !sameKey) { await subscription.unsubscribe().catch(() => false); subscription = null; }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const json = subscription.toJSON();
      const response = await fetch(api, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: { endpoint: json.endpoint, expirationTime: json.expirationTime ?? null, keys: json.keys }, openPath, seenNudgeIds: seenNudgeIds().slice(-20) }),
      });
      if (!response.ok) { await subscription.unsubscribe().catch(() => false); setStatus("error"); return; }
      setStatus("on");
    } catch {
      setStatus("error");
    }
  };

  const turnOff = async () => {
    setStatus("busy");
    try {
      const registration = await workerRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch(api, {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => null);
        await subscription.unsubscribe().catch(() => false);
      }
      setStatus("off");
    } catch {
      setStatus("error");
    }
  };

  if (status === "checking" || status === "hidden") return null;
  return (
    <div className={styles.card} role="group" aria-labelledby="lock-nudges-title">
      <div className={styles.text}>
        <strong id="lock-nudges-title">تنبيهات ونيس على شاشة القفل</strong>
        {status === "on" && <p role="status">مفعّلة لهذه الزيارة: ونيس ينبهك بوقت التحرك وبداية العروض حتى لو الجوال في جيبك.</p>}
        {(status === "off" || status === "busy") && <p>ونيس ينبهك بوقت التحرك وبداية العروض حتى لو الجوال في جيبك. تنتهي مع نهاية زيارتك.</p>}
        {status === "denied" && <p role="status">التنبيهات موقوفة لهذا الموقع من إعدادات المتصفح. فعّلها من هناك ثم ارجع هنا.</p>}
        {status === "ios-install" && <p>على آيفون: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»، وافتح ونيس من هناك عشان تقدر تفعّل التنبيهات.</p>}
        {status === "error" && <p role="alert">ما قدرنا نفعّل التنبيهات الحين. حاول مرة ثانية بعد شوي.</p>}
      </div>
      {(status === "off" || status === "error") && <button type="button" className={styles.button} onClick={turnOn}>فعّل التنبيهات</button>}
      {status === "busy" && <button type="button" className={styles.button} disabled>لحظة…</button>}
      {status === "on" && <button type="button" className={styles.secondary} onClick={turnOff}>إيقاف</button>}
    </div>
  );
}
