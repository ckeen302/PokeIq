import type { NextConfig } from "next";
import { ROOM_MOVED } from "./src/lib/rooms";
import { ORDERS } from "./src/lib/sizes/order";
import { LEADERBOARD_BOARDS } from "./src/lib/leaderboard-boards";

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
/** Pokémon artwork (public/art) never changes for a species: a month in the browser, and revalidated quietly after that. */
const artCache = [{ key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=31536000" }];
/**
 * Share images rendered on request for one Pokémon, size page, timeline entry or quiz result: the same
 * bytes for everyone until the next deploy, so Vercel's CDN keeps them (Next's own header for these is
 * browser-only max-age). Vercel clears its CDN on every deploy.
 */
const ogCdnCache = [{ key: "CDN-Cache-Control", value: "max-age=86400, stale-while-revalidate=604800" }];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pages that render on request stream their <title>, description and
  // canonical tag after the first bytes, except to the crawlers named here,
  // which get them in <head>. Next's own list leaves Googlebot out (it runs
  // JavaScript); it is added so Google's raw HTML has them in <head> too.
  htmlLimitedBots:
    /Googlebot|[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight/i,
  // The battle simulator runs as plain Node modules: bundled and minified,
  // its state serializer (which records constructor names) breaks.
  serverExternalPackages: ["pokemon-showdown", "@pkmn/sim"],
  // Showdown loads its data, formats and random-team generators with
  // computed require() paths, which file tracing can't follow.
  // Link-preview cards drawn on request (invites, Pokémon pages) read their
  // fonts from disk by a computed path.
  outputFileTracingIncludes: {
    ...Object.fromEntries(
      // Friends name battles (challenges, "now playing") and profiles read battle records: the same engine.
      ["/api/battle/**", "/battle/**", "/api/friends/**", "/api/presence", "/api/live", "/u/**"].map((route) => [route, ["./node_modules/pokemon-showdown/dist/{config,data,lib,sim}/**/*.{js,json}"]])
    ),
    "/**/opengraph-image*": ["./src/assets/fonts/*.ttf"],
    // A size comparison's card is a route of its own (it reads ?vs=).
    "/pokedex/sizes/compare/og": ["./src/assets/fonts/*.ttf"],
    "/lab/mass-battle/og": ["./src/assets/fonts/*.ttf"],
    // A shared PokéGuessr result's card draws the map that was played, by a computed path.
    "/guessr/r/**": ["./public/geo/maps/*.webp"],
    // The learn card's facts come from the Pokédex's places, which read the encounter tables from disk.
    "/api/geo/learn": ["./src/data/encounters/*.json"],
  },
  // Pokémon Sizes in another order (?by=speed&dir=desc) renders at its own route, so each order is a cached page
  // while the address people share stays the query; without ?by= (or with an unknown one) it is Height.
  async rewrites() {
    const by = { type: "query" as const, key: "by", value: `(?<by>${ORDERS.map((o) => o.param).join("|")})` };
    const desc = { type: "query" as const, key: "dir", value: "desc" };
    const noBy = { type: "query" as const, key: "by" };
    const pages = [
      ["/pokedex/sizes", "/pokedex/sizes/by"],
      // A preset's or a Pokémon's page (a comparison reads the query itself).
      ["/pokedex/sizes/:slug((?!compare$|by$)[a-z0-9-]+)", "/pokedex/sizes/:slug/by"],
    ];
    // A bare leaderboard link is a cached page per board; with a date or a format it renders per request.
    const boardQuery = { type: "query" as const, key: "board", value: `(?<board>${LEADERBOARD_BOARDS.join("|")})` };
    const bare = [{ type: "query" as const, key: "date" }, { type: "query" as const, key: "format" }];
    return {
      beforeFiles: [
        ...pages.flatMap(([source, to]) => [
          { source, has: [by, desc], destination: `${to}/:by-desc` },
          { source, has: [by], destination: `${to}/:by` },
          { source, has: [desc], missing: [noBy], destination: `${to}/height-desc` },
        ]),
        { source: "/leaderboard", has: [boardQuery], missing: bare, destination: "/leaderboard/board/:board" },
        { source: "/leaderboard", missing: [{ type: "query" as const, key: "board" }, ...bare], destination: "/leaderboard/board/daily" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  // Battle profiles became the trainer's profile; merged chat rooms point to their new room.
  async redirects() {
    return [
      { source: "/battle/player/:name", destination: "/u/:name", permanent: true },
      ...Object.entries(ROOM_MOVED).map(([from, to]) => ({ source: `/rooms/${from}`, destination: `/rooms/${to}`, permanent: true })),
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...["/geo/maps/:path*", "/home/:path*", "/battle/fx/:path*", "/atlas/:path*", "/icon-192.png", "/icon-512.png", "/logo.svg"].map((source) => ({
        source,
        headers: staticAssetCache,
      })),
      { source: "/art/:path*", headers: artCache },
      // The size comparison's and the race's figures, relief maps and far atlas never change for a Pokémon either (the atlas's names are hashed).
      ...["/race/art/:path*", "/sizes/art/:path*", "/sizes/depth/:path*", "/sizes/far/:path*", "/sizes/tex/:path*", "/sizes/env/:path*"].map((source) => ({ source, headers: artCache })),
      ...["/pokemon/:slug/opengraph-image", "/pokedex/sizes/:slug/opengraph-image", "/pokedex/timeline/:event/opengraph-image", "/quiz/which-pokemon/:slug/opengraph-image"].map((source) => ({
        source,
        headers: ogCdnCache,
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
