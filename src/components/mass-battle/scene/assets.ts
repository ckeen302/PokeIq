import type { MBSpecies } from "@/lib/mass-battle/types";
import type { ReliefLevel, ReliefReply, ReliefRequest } from "./relief.worker";

/**
 * Everything a battle's figures are made of, fetched and built before the
 * battle starts: each species' Pokémon HOME render (the texture) and its
 * baked relief map, turned into 3D relief meshes at every detail level by
 * a couple of workers. Kept for the visit, so a replay or a video of the
 * same armies starts at once.
 */

export interface SpeciesAsset {
  id: number;
  art: ImageBitmap;
  artSize: number;
  /** Meshes, most detailed first, matching `segments`. */
  levels: ReliefLevel[];
  segments: number[];
}

/** The HOME renders: static files where the site has them, the transcoding route otherwise (both the same picture). */
let staticArt: Promise<boolean> | null = null;
function hasStaticArt(): Promise<boolean> {
  staticArt ??= fetch("/sizes/art/256/25.webp", { method: "HEAD" }).then((r) => r.ok && /image/.test(r.headers.get("content-type") ?? ""), () => false);
  return staticArt;
}

export async function artUrl(id: number, size: 256 | 512): Promise<string> {
  return (await hasStaticArt()) ? `/sizes/art/${size}/${id}.webp` : `/api/sizes/home/${id}?s=${size}`;
}

export const reliefUrl = (id: number) => `/sizes/depth/${id}.webp`;

// ---------------------------------------------------------------------------
// Relief workers
// ---------------------------------------------------------------------------

let workers: Worker[] | null = null;
let rr = 0;
let nextId = 1;
const pending = new Map<number, (r: ReliefReply) => void>();

function reliefWorkers(): Worker[] {
  if (workers) return workers;
  const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  workers = [];
  for (let i = 0; i < count; i++) {
    const w = new Worker(new URL("./relief.worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent<ReliefReply>) => {
      const done = pending.get(e.data.id);
      pending.delete(e.data.id);
      done?.(e.data);
    };
    workers.push(w);
  }
  return workers;
}

function buildRelief(s: MBSpecies, segments: number[]): Promise<ReliefLevel[]> {
  const ws = reliefWorkers();
  const id = nextId++;
  const [x, y, w, h, size] = s.box;
  const req: ReliefRequest = { id, url: new URL(reliefUrl(s.id), location.origin).href, box: { x, y, w, h, size }, segments };
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => (r.ok ? resolve(r.levels) : reject(new Error(r.message))));
    ws[rr++ % ws.length].postMessage(req);
  });
}

async function fetchArt(id: number, size: 256 | 512, signal?: AbortSignal): Promise<ImageBitmap> {
  const url = await artUrl(id, size);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Colours for a figure whose render couldn't be fetched (its first type's). */
const TYPE_TINT: Record<string, string> = {
  normal: "#c8c4b4", fire: "#f08a3c", water: "#5a8ef0", electric: "#f5d03c", grass: "#6cc24a", ice: "#8fd8e8", fighting: "#c0503a",
  poison: "#a05ac0", ground: "#d8b45a", flying: "#9fb4f0", psychic: "#f06a9a", bug: "#a8b82a", rock: "#b8a04a", ghost: "#705a98",
  dragon: "#6a4ef0", dark: "#5a4a40", steel: "#b8b8d0", fairy: "#ee99ac",
};

/**
 * When a render can't be fetched (a network hiccup), the figure still stands, in 3D: its silhouette (the relief
 * map's coverage) in its type's colour, so nothing pops in later and nothing flat stands in for it.
 */
async function silhouette(s: MBSpecies): Promise<ImageBitmap> {
  const res = await fetch(reliefUrl(s.id));
  const map = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const [bx, by, bw, bh, size] = s.box;
  const k = 256 / size;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(map, bx * k, by * k, bw * k, bh * k);
  map.close();
  const img = g.getImageData(0, 0, 256, 256);
  const tint = TYPE_TINT[s.types[0]] ?? "#c8c4b4";
  const r = parseInt(tint.slice(1, 3), 16), gg = parseInt(tint.slice(3, 5), 16), b = parseInt(tint.slice(5, 7), 16);
  for (let i = 0; i < img.data.length; i += 4) {
    const covered = img.data[i + 2] > 128;
    const shade = 0.75 + (img.data[i] / 255) * 0.35;
    img.data[i] = Math.min(255, r * shade);
    img.data[i + 1] = Math.min(255, gg * shade);
    img.data[i + 2] = Math.min(255, b * shade);
    img.data[i + 3] = covered ? 255 : 0;
  }
  g.putImageData(img, 0, 0);
  return createImageBitmap(cv, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

const cache = new Map<string, Promise<SpeciesAsset>>();

/** A species' render and relief meshes (cached per detail set). */
export function speciesAsset(s: MBSpecies, segments: number[], artSize: 256 | 512, signal?: AbortSignal): Promise<SpeciesAsset> {
  const key = `${s.id}|${artSize}|${segments.join(",")}`;
  let p = cache.get(key);
  if (!p) {
    p = Promise.all([fetchArt(s.id, artSize, signal).catch((e) => (signal?.aborted ? Promise.reject(e) : silhouette(s))), buildRelief(s, segments)]).then(([art, levels]) => ({ id: s.id, art, artSize: art.width as 256 | 512, levels, segments }));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Loads every species, a few at a time, reporting progress (0..1). */
export async function loadAll(list: { s: MBSpecies; segments: number[]; artSize: 256 | 512 }[], onProgress: (p: number) => void, signal?: AbortSignal): Promise<Map<number, SpeciesAsset>> {
  const out = new Map<number, SpeciesAsset>();
  let done = 0;
  const queue = [...list];
  const lanes = Math.min(6, queue.length);
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (queue.length) {
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        const job = queue.shift()!;
        out.set(job.s.id, await speciesAsset(job.s, job.segments, job.artSize, signal));
        done++;
        onProgress(done / list.length);
      }
    })
  );
  return out;
}
