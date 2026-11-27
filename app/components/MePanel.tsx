"use client";

import type { ReactNode } from "react";
import { hoursCount } from "@/lib/ar-count";
import { decodeLikes } from "@/lib/visitor-understanding";
import { InstallHint } from "@/components/InstallHint";
import { ThemeChoice } from "@/components/ThemeChoice";

// «أنا» (audit 2.2): what Wanees understood about this visit, the reply language, and privacy. Every
// fact here came from the visitor's own words; nothing is a survey answer, and nothing leaves the visit.
export type MePreferences = {
  companions?: string | null;
  partySize?: number | null;
  youngestChildAge?: number | null;
  childAges?: number[];
  likes?: string[];
  avoidTags?: string[];
  unmatchedInterests?: string[];
  availableMinutes?: number | null;
  budgetMaxCents?: number | null;
  mobility?: string | null;
  replyLanguage?: string | null;
};

const WHO: Record<string, string> = { self: "أنت", group: "كلكم", son: "ولدك", daughter: "بنتك", child: "العيال", partner: "شريكك", friends: "ربعك" };
const PARTY: Record<string, string> = { family: "عائلة مع أطفال", couple: "شخصين", friends: "ربع", solo: "لحالك" };
const LANGUAGES = [
  { id: "ar", label: "العربية" },
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
  { id: "ur", label: "اردو" },
] as const;

function partyLabel(preferences: MePreferences) {
  const companions = preferences.companions ?? "";
  const named = Object.entries(PARTY).find(([key]) => companions.includes(key))?.[1] ?? (companions || null);
  if (!named) return null;
  return preferences.partySize && preferences.partySize > 1 ? `${named} (${preferences.partySize})` : named;
}

export function MePanel({ preferences, loading, onLanguage, onForget, languageBusy, remember, children }: {
  preferences: MePreferences | null;
  loading: boolean;
  languageBusy: boolean;
  onLanguage: (language: string) => void;
  onForget: (opener: HTMLButtonElement) => void;
  /** Absent where remembering is not offered (the rehearsal, a registered visitor, no server). */
  remember?: { on: boolean; busy: boolean; visitCount: number; onChange: (on: boolean) => void };
  /** Extra sections, such as «اعرض مسارك على شاشة». */
  children?: ReactNode;
}) {
  const facts: Array<[string, string]> = [];
  if (preferences) {
    const party = partyLabel(preferences);
    if (party) facts.push(["مين معك", party]);
    const ages = preferences.childAges?.length ? preferences.childAges : preferences.youngestChildAge != null ? [preferences.youngestChildAge] : [];
    if (ages.length) facts.push(["أعمار الأطفال", ages.join(" و")]);
    for (const like of decodeLikes(preferences.likes ?? [])) facts.push([`${WHO[like.who] ?? "أنت"} يحب`, like.tag]);
    if (preferences.avoidTags?.length) facts.push(["بدون", preferences.avoidTags.join("، ")]);
    if (preferences.unmatchedInterests?.length) facts.push(["طلبت وما لقيناه هنا", preferences.unmatchedInterests.join("، ")]);
    if (preferences.availableMinutes) facts.push(["وقتك", hoursCount(preferences.availableMinutes)]);
    if (preferences.budgetMaxCents != null) facts.push(["ميزانيتك", `${Math.round(preferences.budgetMaxCents / 100)} ريال`]);
    if (preferences.mobility) facts.push(["الطريق", preferences.mobility === "wheelchair" ? "يناسب الكرسي المتحرك" : "يناسب عربية الأطفال"]);
  }
  const language = preferences?.replyLanguage ?? "ar";
  return (
    <div className="me-panel">
      <section aria-labelledby="me-understood">
        <h2 id="me-understood">اللي فهمته عنك</h2>
        {loading && <div className="skeleton-list" aria-label="جارٍ التحميل">{[0, 1].map((key) => <span key={key} className="skeleton-row" />)}</div>}
        {!loading && (facts.length
          ? <dl className="me-facts">{facts.map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          : <p className="guide">ما قلت لي شي عنك للحين. كلمني في «ونيس» وأرتّب جولتك على ذوقك.</p>)}
        <p className="visitor-note">شي غلط؟ قل لي في المحادثة وأصححه.</p>
      </section>
      <section aria-labelledby="me-language">
        <h2 id="me-language">لغة الرد</h2>
        <div className="chips" role="radiogroup" aria-labelledby="me-language">
          {LANGUAGES.map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={language === item.id} disabled={languageBusy} onClick={() => onLanguage(item.id)}>{item.label}</button>
          ))}
        </div>
      </section>
      <ThemeChoice />
      <section aria-labelledby="me-privacy">
        <h2 id="me-privacy">خصوصيتك</h2>
        <p>{remember?.on
          ? "ما نطلب اسمك ولا جوالك. تذكّرتك على هذا الجهاز بس: ذوقك والأماكن اللي مريتها، عشان ما أكررها عليك المرة الجاية."
          : "ما نطلب اسمك ولا جوالك. اللي فهمته عنك يخص هذي الزيارة فقط، ويُحذف معها."} موقعك الدقيق يبقى في جوالك؛ نرسل بس أقرب نقطة على ممرات المشي.</p>
        {remember && (
          <label className="me-remember">
            <input type="checkbox" checked={remember.on} disabled={remember.busy} onChange={(event) => remember.onChange(event.target.checked)} />
            <span>تذكّرني للزيارة الجاية (بدون اسم أو جوال)</span>
          </label>
        )}
        {remember?.on && remember.visitCount > 1 && <p className="visitor-note">هذي زيارتك رقم {remember.visitCount}.</p>}
        <button type="button" className="cta secondary" onClick={(event) => onForget(event.currentTarget)}>احذف بيانات زيارتي</button>
      </section>
      {children}
      <InstallHint />
    </div>
  );
}
