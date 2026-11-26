"use client";

import Link from "next/link";
import { BrandLogo, Mascot } from "@/components/Brand";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="container recovery-page">
      <BrandLogo height={40} label="ونيس" className="recovery-logo" />
      <Mascot mood="confused" height={180} className="recovery-mascot" />
      <h1>تعذر تحميل الصفحة</h1>
      <p>حاول مرة أخرى أو ارجع إلى الرئيسية.</p>
      <button type="button" className="cta" onClick={reset}>إعادة المحاولة</button>
      <Link className="ghost-link" href="/">الرئيسية</Link>
    </main>
  );
}
