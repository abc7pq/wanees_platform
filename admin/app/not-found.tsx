import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap center">
      <div className="card recovery">
        <h1>الصفحة غير موجودة</h1>
        <p>تأكد من الرابط أو افتح قائمة الفعاليات.</p>
        <Link className="btn primary" href="/events">مساحات الفعاليات</Link>
      </div>
    </main>
  );
}
