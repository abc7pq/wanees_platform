import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import "./globals.css";

// Identity guide typefaces: IBM Plex Sans Arabic for Arabic, Inter for English.
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
  title: "ونيس — لوحة الإدارة",
  description: "إدارة الفعاليات والأنشطة والأحداث الحية",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Every page renders per request so its scripts can carry that response's CSP nonce (audit 6.3).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();
  return (
    <html lang="ar" dir="rtl" className={`${plexArabic.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
