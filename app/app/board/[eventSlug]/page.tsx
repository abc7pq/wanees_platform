import type { Metadata } from "next";
import { LiveBoard } from "./LiveBoard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "لوحة الموقع الحية · ونيس",
  description: "شاشة البوابة: الأهدأ الحين، العروض الجاية مع أي تأخير، وتنبيهات إدارة الموقع — من بيانات مجمعة بلا معلومات شخصية.",
};

export default async function BoardPage({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  return <LiveBoard eventSlug={eventSlug} />;
}
