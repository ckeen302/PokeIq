import type { NextConfig } from "next";

/**
 * Only PokéAPI's sprite CDN (GitHub raw) is allowed as a remote image source.
 * WebP only: AVIF saves a few KB but its cold encode (~1s) is felt mid-quiz.
 * Question media that must stay secret (silhouettes, cries) never uses this
 * pipeline — it's served by /api/media behind encrypted tokens.
 *
 * Security headers stay clear of a script Content-Security-Policy: Next's
 * inline bootstrap scripts and Vercel Analytics would need nonces. The CSP
 * only says who may frame the site (nobody, as X-Frame-Options says).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

/**
 * Files in /public keep their names across deploys, so they aren't immutable,
 * but they rarely change: a browser reuses them for a day instead of asking
 * the CDN again on every page.
 */
const staticAssetCache = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The battle simulator runs as plain Node modules: bundled and minified,
  // its state serializer (which records constructor names) breaks.
  serverExternalPackages: ["pokemon-showdown", "@pkmn/sim"],
  // Showdown loads its data, formats and random-team generators with
  // computed require() paths, which file tracing can't follow.
  outputFileTracingIncludes: Object.fromEntries(
    ["/api/battle/**", "/battle/**"].map((route) => [
      route,
      ["./node_modules/pokemon-showdown/dist/{config,data,lib,sim}/**/*.{js,json}"],
    ])
  ),
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...["/geo/maps/:path*", "/battle/fx/:path*", "/atlas/:path*", "/icon-192.png", "/icon-512.png", "/logo.svg"].map((source) => ({
        source,
        headers: staticAssetCache,
      })),
    ];
  },
  images: {
    formats: ["image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [{ protocol: "https", hostname: "raw.githubusercontent.com", pathname: "/PokeAPI/sprites/**" }],
  },
};

export default nextConfig;
