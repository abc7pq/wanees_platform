import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { OfflineSupport } from "@/components/OfflineSupport";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ونيس WANEES — المرشد الشخصي الذكي للمواسم والمهرجانات",
  description:
    "خمس أسئلة… ومسار ليلتك جاهز. وكيل ذكاء اصطناعي يبني مسارك في المواسم والمهرجانات ويتحرك مع الزحام — حل تحدي GEA في هاكاثون agentX الرابع.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ونيس",
  },
  icons: { apple: "/apple-touch-icon.png", icon: "/icon.svg" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={plexArabic.variable}>
      <body>
        <div className="aurora"><i /><i /><i /></div>
        {children}
        <OfflineSupport />
      </body>
    </html>
  );
}
