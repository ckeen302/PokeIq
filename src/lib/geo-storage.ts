/**
 * Where PokéGuessr's screenshots live: the public Supabase Storage bucket
 * (src/data/geo.json's `storageBase`, repeated here so the screenshot route
 * doesn't load the whole data file; tests/geo-shot-route.test.ts keeps the two equal).
 */
export const GEO_STORAGE_BASE = "https://vowzddxxxhxcmibhplgl.supabase.co/storage/v1/object/public/geo";

/** A round's screenshot id (random, so it says nothing about the place). */
export const GEO_SHOT_ROUTE_ID_RE = /^[A-Za-z0-9_-]{8,24}$/;
