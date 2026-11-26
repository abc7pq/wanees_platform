"use client";

import { useEffect, useState } from "react";
import styles from "./offline-support.module.css";

/**
 * Registers the visitor service worker (production builds only, so it never fights dev hot reload)
 * and shows a small banner while the device is offline, so a visitor knows the plan on screen is
 * the last saved copy rather than live.
 */
export function OfflineSupport() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className={styles.banner} role="status" aria-live="polite">
      ما فيه اتصال الحين. نعرض آخر نسخة محفوظة من مسارك، والتحديثات الحية ترجع أول ما يرجع الاتصال.
    </div>
  );
}
