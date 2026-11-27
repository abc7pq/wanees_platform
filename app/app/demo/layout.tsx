import type { Metadata, Viewport } from "next";
import { THEME_COLORS } from "@/lib/visitor-theme";

export const metadata: Metadata = {
  title: "ونيس WANEES — الديمو الحي",
  description: "جرّب الوكيل نفسه: قل له وش بالك بجملة، ومسارك جاهز ويتحرك مع الزحام.",
};

// The visitor app follows the phone's light or dark setting, so the browser bar does too.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
