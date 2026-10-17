/** The public deployment, used when no explicit site URL is configured. */
const PRODUCTION_URL = "https://pokeiq.vercel.app";

/**
 * Absolute site URL for metadata, sitemaps and share links. Production
 * builds never fall back to localhost: canonical tags and the sitemap would
 * otherwise point search engines at a dead host.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NODE_ENV === "production"
      ? PRODUCTION_URL
      : "http://localhost:3000")
).replace(/\/+$/, "");

export const SITE_NAME = "PokéIQ";
