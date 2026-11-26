"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="container recovery-page">
      <h1>تعذر تحميل الصفحة</h1>
      <p>حاول مرة أخرى أو ارجع إلى الرئيسية.</p>
      <button type="button" className="cta" onClick={reset}>إعادة المحاولة</button>
      <Link className="ghost-link" href="/">الرئيسية</Link>
    </main>
  );
}
