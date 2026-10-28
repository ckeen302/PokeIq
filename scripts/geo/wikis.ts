/**
 * Other Pokémon wikis, for in-game screenshots of places Bulbapedia only has
 * guidebook maps of (most X/Y, Sun/Moon and Sword/Shield routes): the
 * Pokémon Wiki on Fandom, Poképédia (French) and PokéWiki (German). PokéAPI
 * gives each place's French and German name.
 */
import { WIKI, api, codeOf } from "./bulbapedia";
import { httpGet } from "./http";

export interface Wiki {
  id: string;
  api: string;
  /** Language of its page titles, for PokéAPI's names. */
  lang: "en" | "fr" | "de";
  /** The wiki's game abbreviations in file names → Bulbapedia's codes. */
  codes: Record<string, string>;
}

export const WIKIS: Wiki[] = [
  { id: "fandom", api: "https://pokemon.fandom.com/api.php", lang: "en", codes: {} },
  {
    id: "pokepedia",
    api: "https://www.pokepedia.fr/api.php",
    lang: "fr",
    codes: { XY: "XY", ROSA: "ORAS", SL: "SM", USUL: "USUM", EB: "SwSh", DEPS: "BDSP", EV: "SV", LGPE: "LGPE", RFVF: "FRLG", E: "E", RS: "RS", HGSS: "HGSS", DP: "DP", Pt: "Pt", NB: "BW", N2B2: "B2W2" },
  },
  {
    id: "pokewiki",
    api: "https://www.pokewiki.de/api.php",
    lang: "de",
    codes: { XY: "XY", ORAS: "ORAS", SoMo: "SM", USUM: "USUM", SWSH: "SwSh", SDLP: "BDSP", KP: "SV", LGPE: "LGPE", FRBG: "FRLG", HGSS: "HGSS" },
  },
];

export interface WikiFile {
  file: string;
  url: string;
  width: number;
  height: number;
}

/** The first of `titles` that is a page on the wiki (after redirects), or null. */
export async function wikiPage(wiki: Wiki, titles: string[]): Promise<string | null> {
  const r = await api<{ query: { pages: { title: string; missing?: boolean }[]; redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] } }>(
    wiki.api,
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
export async function wikiImages(wiki: Wiki, title: string): Promise<WikiFile[]> {
  const out: WikiFile[] = [];
  let cont: Record<string, string> = {};
  for (;;) {
    const r = await api<{
      query?: { pages: { title: string; imageinfo?: { url: string; width: number; height: number }[] }[] };
      continue?: Record<string, string>;
    }>(wiki.api, { action: "query", titles: title, generator: "images", gimlimit: "max", prop: "imageinfo", iiprop: "url|size", ...cont });
    for (const p of r.query?.pages ?? []) {
      const info = p.imageinfo?.[0];
      if (info) out.push({ file: p.title.replace(/^[^:]+:/, "").replace(/ /g, "_"), url: info.url, width: info.width, height: info.height });
    }
    if (!r.continue) return out;
    cont = r.continue;
  }
}

/** The game a file's name gives, as a Bulbapedia code: the wiki's abbreviation first or last, or Bulbapedia's. */
export function wikiCode(wiki: Wiki, file: string): string | null {
  const tokens = file.replace(/\.[a-z0-9]+$/i, "").split(/[ _]/).filter(Boolean);
  for (const t of [tokens.at(-1), tokens[0]]) if (t && wiki.codes[t]) return wiki.codes[t];
  return codeOf(file);
}

const POKEAPI = "https://pokeapi.co/api/v2/location";
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * A place's names in other languages: PokéAPI's ("Dendemille Town" → La
 * Frescale, Frescora), else the Poképédia and PokéWiki pages Bulbapedia's
 * page links to (PokéAPI has none for Ultra Sun / Ultra Moon's or Kitakami's
 * places: "Mossui Town" → Jaderaude, Midoriya).
 */
export async function localNames(name: string, region: string): Promise<Partial<Record<"fr" | "de", string>>> {
  let found: Partial<Record<"fr" | "de", string>> = {};
  for (const s of [`${slug(region)}-${slug(name)}`, slug(name)]) {
    const body = await httpGet(`${POKEAPI}/${s}/`).catch(() => null);
    if (!body) continue;
    const j = JSON.parse(body.toString("utf8")) as { region?: { name: string }; names: { name: string; language: { name: string } }[] };
    if (j.region && j.region.name !== slug(region)) continue;
    const names = Object.fromEntries(j.names.map((n) => [n.language.name, n.name]));
    found = Object.fromEntries(Object.entries({ fr: names.fr, de: names.de }).filter(([, v]) => v));
    if (found.fr && found.de) return found;
    break;
  }
  // A bare "Route 9" is another region's (or a list of them).
  const titles = [`${region} ${name}`, `${name} (${region})`, ...(/^Route \d+$/.test(name) ? [] : [name])];
  const r = await api<{ query: { pages: { title: string; missing?: boolean; langlinks?: { lang: string; title: string }[] }[]; redirects?: { from: string; to: string }[] } }>(
    WIKI,
    { action: "query", titles: titles.join("|"), redirects: "1", prop: "langlinks", lllimit: "max" }
  );
  const target = new Map((r.query.redirects ?? []).map((x) => [x.from, x.to]));
  for (const t of titles) {
    const links = r.query.pages.find((p) => p.title === (target.get(t) ?? t) && !p.missing)?.langlinks;
    if (links) return { ...Object.fromEntries(links.filter((l) => l.lang === "fr" || l.lang === "de").map((l) => [l.lang, l.title])), ...found };
  }
  return found;
}
