/**
 * The Pokémon Wiki on Fandom: in-game screenshots of places that Bulbapedia
 * only has guidebook maps of (most X/Y and Sun/Moon routes, for one).
 */
import { api } from "./bulbapedia";

export const FANDOM = "https://pokemon.fandom.com/api.php";

export interface FandomFile {
  file: string;
  url: string;
  width: number;
  height: number;
}

/** The first of `titles` that is a page (after redirects), or null. */
export async function fandomPage(titles: string[]): Promise<string | null> {
  const r = await api<{ query: { pages: { title: string; missing?: boolean }[]; redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] } }>(
    FANDOM,
    { action: "query", titles: titles.join("|"), redirects: "1" }
  );
  const normal = new Map((r.query.normalized ?? []).map((n) => [n.from, n.to]));
  const target = new Map((r.query.redirects ?? []).map((n) => [n.from, n.to]));
  for (const title of titles) {
    const t = target.get(normal.get(title) ?? title) ?? normal.get(title) ?? title;
    if (r.query.pages.some((p) => p.title === t && !p.missing)) return t;
  }
  return null;
}

/** Every image on a page, with its size and URL. */
export async function fandomImages(title: string): Promise<FandomFile[]> {
  const out: FandomFile[] = [];
  let cont: Record<string, string> = {};
  for (;;) {
    const r = await api<{
      query?: { pages: { title: string; imageinfo?: { url: string; width: number; height: number }[] }[] };
      continue?: Record<string, string>;
    }>(FANDOM, { action: "query", titles: title, generator: "images", gimlimit: "max", prop: "imageinfo", iiprop: "url|size", ...cont });
    for (const p of r.query?.pages ?? []) {
      const info = p.imageinfo?.[0];
      if (info) out.push({ file: p.title.replace(/^File:/, "").replace(/ /g, "_"), url: info.url, width: info.width, height: info.height });
    }
    if (!r.continue) return out;
    cont = r.continue;
  }
}
