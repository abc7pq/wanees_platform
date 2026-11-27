"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// «ثبّت ونيس» (audit 2.5): Android and desktop Chrome offer their own install prompt; iPhone Safari has
// none, so it gets the two taps to do it by hand. Nothing shows once the app runs installed.
export function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent));
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!prompt && !ios)) return null;
  return (
    <section aria-labelledby="me-install">
      <h2 id="me-install">ثبّت ونيس على شاشتك</h2>
      {prompt
        ? <button type="button" className="cta secondary" onClick={() => { void prompt.prompt(); void prompt.userChoice.finally(() => setPrompt(null)); }}>ثبّت التطبيق</button>
        : <p>من زر المشاركة في سفاري اختر «إضافة إلى الشاشة الرئيسية»، ويفتح ونيس مثل أي تطبيق.</p>}
    </section>
  );
}
