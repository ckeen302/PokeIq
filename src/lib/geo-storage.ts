/**
 * Where PokéGuessr's screenshots live: the public Supabase Storage bucket
 * (src/data/geo.json's `storageBase`, repeated here so the screenshot route
 * doesn't load the whole data file; tests/geo-shot-route.test.ts keeps the two equal).
 */
export const GEO_STORAGE_BASE = "https://vowzddxxxhxcmibhplgl.supabase.co/storage/v1/object/public/geo";

/** A round's screenshot id (random, so it says nothing about the place). */
export const GEO_SHOT_ROUTE_ID_RE = /^[A-Za-z0-9_-]{8,24}$/;

/**
 * The public media store: NEXT_PUBLIC_MEDIA_BASE, the root that holds the
 * `geo/` folder (`<base>/geo/<id>.webp`), by default Supabase Storage's
 * public root. Moving the screenshots to another store (a Cloudflare R2
 * bucket with no egress fees, say) is this one setting, with the same paths.
 */
export const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE || GEO_STORAGE_BASE.replace(/\/geo$/, "")).replace(/\/+$/, "");

/** A screenshot's file in the media store. */
export const geoStorageUrl = (id: string) => `${MEDIA_BASE}/geo/${id}.webp`;

/**
 * Whether the browser loads a round's screenshot straight from the media
 * store (NEXT_PUBLIC_GEO_SHOTS_DIRECT=1) instead of through /api/geo/shot.
 * Off by default, because the URL and the response must say nothing about
 * the place, and Supabase Storage answers with each file's upload time
 * (Last-Modified): the screenshots went up a region at a time, so that time
 * narrows down the region. Turn it on only for a store whose responses don't
 * carry that (files uploaded all at once in a shuffled order, or a CDN rule
 * that drops Last-Modified), after checking a few with `curl -I`.
 */
export const GEO_SHOTS_DIRECT = process.env.NEXT_PUBLIC_GEO_SHOTS_DIRECT === "1";

/** A round's picture URL: the media store's file, or the same-origin route that serves it. */
export const geoShotUrl = (id: string) => (GEO_SHOTS_DIRECT ? geoStorageUrl(id) : `/api/geo/shot/${id}`);

/** The screenshot id in a round's picture URL (either shape), or null for any other URL. */
export function geoShotIdOf(url: string): string | null {
  const route = /^\/api\/geo\/shot\/([A-Za-z0-9_-]+)$/.exec(url);
  if (route) return route[1];
  const prefix = `${MEDIA_BASE}/geo/`;
  if (!url.startsWith(prefix)) return null;
  const file = /^([A-Za-z0-9_-]+)\.webp$/.exec(url.slice(prefix.length));
  return file ? file[1] : null;
}
