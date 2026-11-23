/**
 * A screenshot's source, as curation.json records it, back to the picture:
 * the wiki file page (Bulbagarden Archives, Bulbapedia, Poképédia, PokéWiki,
 * WikiDex, the Pokémon Wiki on Fandom), optionally followed by
 * " (view cut at left,top,width,height)", the part of the file kept.
 *
 * The file's own URL comes from the wiki's API (the Archives' files through
 * Bulbapedia, which serves them as its shared repository, since the Archives'
 * API sits behind a browser check from some networks). Every request goes
 * through ./http (curl, polite, retried).
 */
import { createHash } from "node:crypto";
import { httpGet, wikiApi } from "./http";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const APIS: Record<string, string> = {
  "archives.bulbagarden.net": "https://bulbapedia.bulbagarden.net/w/api.php",
  "bulbapedia.bulbagarden.net": "https://bulbapedia.bulbagarden.net/w/api.php",
  "www.pokepedia.fr": "https://www.pokepedia.fr/api.php",
  "www.pokewiki.de": "https://www.pokewiki.de/api.php",
  "www.wikidex.net": "https://www.wikidex.net/api.php",
  "pokemon.fandom.com": "https://pokemon.fandom.com/api.php",
};

/** "… (view cut at 0,0,384,288)" → the page URL and the box. */
export function parseSource(source: string): { page: string; cut?: Box } {
  const m = source.match(/^(\S+) \(view cut at (\d+),(\d+),(\d+),(\d+)\)$/);
  if (!m) return { page: source.trim() };
  const [, page, left, top, width, height] = m;
  return { page, cut: { left: +left, top: +top, width: +width, height: +height } };
}

/** The source string for a page and the part of the file kept (none when it's the whole file). */
export function sourceWithCut(page: string, cut: Box | undefined, size?: { width: number; height: number }): string {
  if (!cut) return page;
  if (size && cut.left === 0 && cut.top === 0 && cut.width === size.width && cut.height === size.height) return page;
  return `${page} (view cut at ${cut.left},${cut.top},${cut.width},${cut.height})`;
}

/** A wiki file page's API and title, or null for any other URL (taken as the file itself). */
export function filePage(page: string): { api: string; title: string } | null {
  let url: URL;
  try {
    url = new URL(page);
  } catch {
    throw new Error(`not a URL: ${page}`);
  }
  const api = APIS[url.host];
  if (!api) return null;
  // "/wiki/File:…" on most wikis, "/Datei:…" and "/Fichier:…" on PokéWiki and Poképédia.
  const fromPath = url.pathname.match(/^\/(?:wiki\/)?([^/]+:.+)$/);
  const title = fromPath ? decodeURIComponent(fromPath[1]) : url.searchParams.get("title");
  if (!title || !/^(File|Fichier|Datei|Archivo|Image):/i.test(title)) return null;
  return { api, title };
}

/** The file's URL on the wiki, from its file page. */
export async function fileUrl(page: string): Promise<string> {
  const wiki = filePage(page);
  if (!wiki) return page;
  const r = await wikiApi<{ query: { pages: { missing?: boolean; imageinfo?: { url: string }[] }[] } }>(wiki.api, {
    action: "query",
    titles: wiki.title,
    prop: "imageinfo",
    iiprop: "url",
  });
  const url = r.query.pages[0]?.imageinfo?.[0]?.url;
  if (!url) throw new Error(`no file at ${page}`);
  return url;
}

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/** The source file's bytes (from `image` when given, else the file page's file). */
export async function fetchSource(source: string, image?: string): Promise<{ bytes: Buffer; cut?: Box; page: string; url: string }> {
  const { page, cut } = parseSource(source);
  const url = image ?? (await fileUrl(page));
  const bytes = await httpGet(url);
  return { bytes, cut, page, url };
}
