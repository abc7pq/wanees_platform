"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="wrap center">
      <div className="card recovery">
        <h1>تعذر تحميل الصفحة</h1>
        <p>حاول مرة أخرى أو ارجع إلى لوحة الإدارة.</p>
        <button type="button" className="btn primary" onClick={reset}>إعادة المحاولة</button>
        <Link className="btn ghost" href="/">لوحة الإدارة</Link>
      </div>
    </main>
  );
}
