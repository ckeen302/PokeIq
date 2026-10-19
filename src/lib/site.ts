/** The public deployment, used when no explicit site URL is configured. */
const PRODUCTION_URL = "https://pokeiq.vercel.app";

/**
 * Absolute site URL for metadata (`metadataBase`), sitemaps and share links:
 * NEXT_PUBLIC_SITE_URL when set (a custom domain is one environment
 * variable), else the production domain. Only `next dev` falls back to
 * localhost: a production build never points canonical tags, link previews
 * or the sitemap at a dead host.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : PRODUCTION_URL)
).replace(/\/+$/, "");

export const SITE_NAME = "PokéIQ";
