import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import "./globals.css";
import { OfflineSupport } from "@/components/OfflineSupport";
import { THEME_COOKIE, parseTheme } from "@/lib/visitor-theme";

// Identity guide typefaces: IBM Plex Sans Arabic for Arabic, Inter for English (Bold / SemiBold / Medium / Regular).
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  // No metric fallback: the generated "Inter Fallback" (local Arial) has Arabic glyphs and would
  // catch Arabic text before IBM Plex. Without it, Inter's latin unicode-range hands Arabic to Plex.
  adjustFontFallback: false,
  display: "swap",
});

export const metadata: Metadata = {
  title: "ونيس WANEES — المرشد الشخصي الذكي للمواسم والمهرجانات",
  description:
    "قل لونيس وش بالك بجملة وحدة، ومسار ليلتك جاهز. ونيس يبني مسارك في المواسم والمهرجانات من كتالوج الفعالية، ويقترح بديلًا مع السبب إذا زاد الزحام أو تأخّر عرض.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ونيس",
  },
  icons: { apple: "/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

// Every page renders per request so its scripts can carry that response's CSP nonce (audit 6.3).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();
  // «المظهر» in «أنا» (visitor app only): a pinned light or dark theme is applied before the first paint.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="ar" dir="rtl" className={`${plexArabic.variable} ${inter.variable}`} data-theme={theme === "system" ? undefined : theme}>
      <body>
        <div className="aurora"><i /><i /><i /></div>
        {children}
        <OfflineSupport />
      </body>
    </html>
  );
}
