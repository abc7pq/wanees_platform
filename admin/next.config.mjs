import path from "node:path";
import SentryConfig from "@sentry/nextjs/config";

// Baseline browser hardening. HSTS is opt-in so local HTTPS test proxies never pin localhost.
// Pages get their Content-Security-Policy (with a per-response script nonce) from middleware.ts.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.WANEES_HSTS === "true" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Same as the visitor app: tests and verification builds can use their own build folder,
  // so they never overwrite the .next of a running dev or production server.
  distDir: process.env.WANEES_NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  serverExternalPackages: ["@prisma/adapter-pg", "@prisma/client", "pg"],
  webpack(config) {
    config.resolve ??= {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      "pg-native": false,
    };
    const databaseExternal = { pg: "commonjs pg" };
    config.externals = Array.isArray(config.externals)
      ? [...config.externals, databaseExternal]
      : [config.externals, databaseExternal].filter(Boolean);
    return config;
  },
  outputFileTracingRoot: path.join(process.cwd(), ".."),
};

export default SentryConfig.withSentryConfig(nextConfig, { silent: true, telemetry: false, sourcemaps: { disable: true } });
