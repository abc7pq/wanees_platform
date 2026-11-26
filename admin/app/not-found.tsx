import Link from "next/link";
import { Mascot } from "./brand";

export default function NotFound() {
  return (
    <main className="wrap center">
      <div className="card recovery">
        <Mascot mood="confused" height={160} className="recovery-mascot" />
        <h1>الصفحة غير موجودة</h1>
        <p>تأكد من الرابط أو افتح قائمة الفعاليات.</p>
        <Link className="btn primary" href="/events">مساحات الفعاليات</Link>
      </div>
    </main>
  );
}
