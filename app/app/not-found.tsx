import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container recovery-page">
      <h1>الصفحة غير موجودة</h1>
      <p>تأكد من الرابط، أو ارجع إلى الرئيسية.</p>
      <Link className="cta" href="/">الرئيسية</Link>
    </main>
  );
}
