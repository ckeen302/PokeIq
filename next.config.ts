import type { NextConfig } from "next";

/**
 * Only PokéAPI's sprite CDN (GitHub raw) is allowed as a remote image source.
 * WebP only: AVIF saves a few KB but its cold encode (~1s) is felt mid-quiz.
 * Question media that must stay secret (silhouettes, cries) never uses this
 * pipeline — it's served by /api/media behind encrypted tokens.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The battle simulator runs as plain Node modules: bundled and minified,
  // its state serializer (which records constructor names) breaks.
  serverExternalPackages: ["@pkmn/sim", "@pkmn/randoms", "@pkmn/mods"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  images: {
    formats: ["image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [{ protocol: "https", hostname: "raw.githubusercontent.com", pathname: "/PokeAPI/sprites/**" }],
  },
};

export default nextConfig;
