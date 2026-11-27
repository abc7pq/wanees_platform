"use client";

import { useEffect, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import styles from "./visit-rating.module.css";
import { Mascot } from "./Brand";
import faceMeh from "../public/brand/emoji-meh.webp";
import faceOkay from "../public/brand/emoji-okay.webp";
import faceGood from "../public/brand/emoji-good.webp";
import faceGreat from "../public/brand/emoji-great.webp";
import faceAmazing from "../public/brand/emoji-amazing.webp";

// The five faces come from the identity guide's emoji sheet (الأيموجيات): Wanees himself, not system emoji.
const CHOICES: { value: number; face: StaticImageData; label: string }[] = [
  { value: 1, face: faceMeh, label: "ما عجبتني" },
  { value: 2, face: faceOkay, label: "عادية" },
  { value: 3, face: faceGood, label: "حلوة" },
  { value: 4, face: faceGreat, label: "مرة حلوة" },
  { value: 5, face: faceAmazing, label: "خيالية" },
];

/**
 * One-tap "how was your night?" rating. It is sent as an anonymous aggregate metric (no session id,
 * no text), so operators see satisfaction without any visitor identity. The "already rated" flag
 * lives in sessionStorage for this visit only and the card works without it.
 */
export function VisitRating({ visitKey, onRate }: { visitKey: string; onRate: (value: number) => void }) {
  const storageKey = `wanees-rated:${visitKey}`;
  const [rated, setRated] = useState<number | null>(null);

  useEffect(() => {
    try {
      const saved = Number(window.sessionStorage.getItem(storageKey));
      if (saved >= 1 && saved <= 5) setRated(saved);
    } catch {}
  }, [storageKey]);

  function choose(value: number) {
    if (rated) return;
    setRated(value);
    onRate(value);
    try { window.sessionStorage.setItem(storageKey, String(value)); } catch {}
  }

  if (rated) {
    return (
      <div className={styles.card} role="status">
        <Mascot mood="cheer" height={96} className={styles.mascot} />
        <strong className={styles.title}>شكرًا على تقييمك</strong>
        <span className={styles.hint}>يساعد المنظّمين يحسّنون الليلة الجاية. ما نحفظ معه أي بيانات عنك.</span>
      </div>
    );
  }
  return (
    <div className={styles.card} role="group" aria-labelledby="visit-rating-title">
      <strong id="visit-rating-title" className={styles.title}>كيف كانت ليلتك مع ونيس؟</strong>
      <div className={styles.choices}>
        {CHOICES.map((choice) => (
          <button key={choice.value} type="button" className={styles.choice} aria-label={`${choice.value} من 5: ${choice.label}`} onClick={() => choose(choice.value)}>
            <Image className={styles.face} src={choice.face} alt="" aria-hidden="true" width={Math.round((72 * choice.face.width) / choice.face.height)} height={72} sizes="72px" />
            <span className={styles.label}>{choice.label}</span>
          </button>
        ))}
      </div>
      <span className={styles.hint}>تقييم مجهول بضغطة وحدة.</span>
    </div>
  );
}
