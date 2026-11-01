/**
 * Asset preloading for timed games: a question's countdown only starts once
 * every image it shows is downloaded *and decoded* (and its cry, if any, can
 * play), so slow connections are never charged for loading time.
 *
 * Results are memoised per URL, so preloading the same asset again (e.g. the
 * rendered <img> mounting after a warm-up) resolves immediately. Failures
 * resolve too: a broken image must not freeze the game, it shows its own
 * retry state instead.
 */

const cache = new Map<string, Promise<void>>();
const MAX_CACHE = 300;
/** The decoded images themselves, kept alive so the browser still has them when they're rendered. */
const images = new Map<string, HTMLImageElement>();

function remember(key: string, p: Promise<void>): Promise<void> {
  cache.set(key, p);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return p;
}

/** A preloaded, decoded image (its size is known and it can be shown at once), or null. */
export function preloadedImage(url: string): HTMLImageElement | null {
  const img = images.get(url);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

export function preloadImage(url: string): Promise<void> {
  if (typeof window === "undefined" || !url) return Promise.resolve();
  const hit = cache.get(url);
  if (hit) return hit;
  const img = new window.Image();
  img.decoding = "async";
  const p = new Promise<void>((resolve) => {
    img.onload = () => {
      images.set(url, img);
      if (images.size > MAX_CACHE) images.delete(images.keys().next().value!);
      // decode() guarantees the first paint won't stall on decoding.
      if (typeof img.decode === "function") img.decode().then(resolve, () => resolve());
      else resolve();
    };
    img.onerror = () => {
      cache.delete(url); // allow a later retry
      resolve();
    };
  });
  img.src = url;
  return remember(url, p);
}

export function preloadAudio(url: string): Promise<void> {
  if (typeof window === "undefined" || !url) return Promise.resolve();
  const key = `audio:${url}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const audio = new Audio();
  if (!audio.canPlayType("audio/ogg")) return Promise.resolve();
  const p = new Promise<void>((resolve) => {
    const done = () => resolve();
    audio.addEventListener("canplaythrough", done, { once: true });
    audio.addEventListener("error", done, { once: true });
  });
  audio.preload = "auto";
  audio.src = url;
  audio.load();
  return remember(key, p);
}

export interface AssetList {
  images?: (string | undefined | null)[];
  audio?: (string | undefined | null)[];
}

/**
 * Resolve once every asset is ready, or after `capMs` (a safety valve for
 * stalled connections — the server bounds its load allowance the same way).
 */
export function preloadAssets(assets: AssetList, capMs = 6000): Promise<void> {
  const jobs = [
    ...(assets.images ?? []).filter((u): u is string => !!u).map(preloadImage),
    ...(assets.audio ?? []).filter((u): u is string => !!u).map(preloadAudio),
  ];
  if (!jobs.length) return Promise.resolve();
  return Promise.race([
    Promise.all(jobs).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, capMs)),
  ]);
}

/** Everything a quiz question renders before the player can answer it. */
export function questionAssets(q: {
  images?: string[];
  media?: { type: "image" | "audio"; url: string };
  cards?: { imageUrl: string }[];
  zoom?: { url: string };
}): AssetList {
  return {
    images: [
      ...(q.images ?? []),
      ...(q.cards ?? []).map((c) => c.imageUrl),
      q.media?.type === "image" ? q.media.url : undefined,
      q.zoom?.url,
    ],
    audio: [q.media?.type === "audio" ? q.media.url : undefined],
  };
}
