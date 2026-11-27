import type { Metadata } from "next";
import { visitorViewport } from "@/lib/visitor-viewport";

export const metadata: Metadata = {
  title: "ونيس WANEES — الديمو الحي",
  description: "جرّب الوكيل نفسه: قل له وش بالك بجملة، ومسارك جاهز ويتحرك مع الزحام.",
};

export const generateViewport = visitorViewport;

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
