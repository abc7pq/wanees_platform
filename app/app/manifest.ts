import type { MetadataRoute } from "next";

// The installed app opens the visitor guide, not the marketing page. Icons are rendered from
// app/icon.svg (192/512 for install prompts, a padded 512 for Android's maskable crop).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/demo",
    name: "ونيس WANEES",
    short_name: "ونيس",
    description: "خمس أسئلة… ومسار ليلتك جاهز.",
    start_url: "/demo",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    dir: "rtl",
    lang: "ar",
    categories: ["entertainment", "travel", "navigation"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
