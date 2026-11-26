import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ونيس WANEES — الديمو الحي",
  description: "جرّب الوكيل نفسه: خمس أسئلة، مسارك جاهز، ويتحرك مع الزحام.",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
