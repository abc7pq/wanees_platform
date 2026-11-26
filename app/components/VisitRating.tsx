"use client";

import { useEffect, useState } from "react";
import styles from "./visit-rating.module.css";

const CHOICES: { value: number; face: string; label: string }[] = [
  { value: 1, face: "😕", label: "ما عجبتني" },
  { value: 2, face: "😐", label: "عادية" },
  { value: 3, face: "🙂", label: "حلوة" },
  { value: 4, face: "😄", label: "مرة حلوة" },
  { value: 5, face: "🤩", label: "خيالية" },
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
        <strong className={styles.title}>شكرًا على تقييمك 🙏</strong>
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
            <span aria-hidden="true" className={styles.face}>{choice.face}</span>
            <span className={styles.label}>{choice.label}</span>
          </button>
        ))}
      </div>
      <span className={styles.hint}>تقييم مجهول بضغطة وحدة.</span>
    </div>
  );
}
