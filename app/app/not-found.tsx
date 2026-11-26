import Link from "next/link";
import { BrandLogo, Mascot } from "@/components/Brand";

export default function NotFound() {
  return (
    <main className="container recovery-page">
      <BrandLogo height={40} label="ونيس" className="recovery-logo" />
      <Mascot mood="confused" height={180} className="recovery-mascot" />
      <h1>الصفحة غير موجودة</h1>
      <p>تأكد من الرابط، أو ارجع إلى الرئيسية.</p>
      <Link className="cta" href="/">الرئيسية</Link>
    </main>
  );
}
