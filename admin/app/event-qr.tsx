"use client";

import { useState } from "react";

const visitorOrigin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";

export function EventQr({ slug }: { slug: string }) {
  const visitorUrl = new URL(`/events/${encodeURIComponent(slug)}`, visitorOrigin).href;
  const [image, setImage] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");

  async function generateCode() {
    setState("loading");
    try {
      const { default: qr } = await import("qrcode");
      setImage(await qr.toDataURL(visitorUrl, { width: 640, errorCorrectionLevel: "M" }));
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return <div className="event-entry">
    <div className="row">
      <a className="btn" href={visitorUrl} target="_blank" rel="noreferrer">افتح رابط الزائر</a>
      {!image && <button className="btn" type="button" disabled={state === "loading"} onClick={generateCode}>
        {state === "loading" ? "جارٍ تجهيز الرمز…" : "عرض رمز الدخول (QR)"}
      </button>}
    </div>
    {state === "failed" && <p role="alert">تعذر تجهيز الرمز. يمكنك فتح رابط الزائر أو المحاولة مرة أخرى.</p>}
    {image && <div className="event-entry-code">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} width={184} height={184} alt="رمز QR لفتح رابط الزائر لهذه الفعالية" />
      <a className="btn" href={image} download={`wanees-${slug}.png`}>تنزيل رمز الدخول</a>
    </div>}
  </div>;
}
