/**
 * Serebii's per-species pages, read with the Pokédex build's parsers (scripts/dex/serebii*.ts), regrouped by species:
 *  - Gens 1-7: the per-generation location pages (pokedex-{gs,rs,dp,bw,xy,sm}/location/NNN.shtml);
 *  - Let's Go: the Sun/Moon location page's Let's Go tables;
 *  - Sword/Shield (+ DLC) and BD/SP: the Sword/Shield Pokédex "locations" detail page;
 *  - Legends: Arceus: the Sword/Shield Pokédex overview; Scarlet/Violet (+ DLC) and Legends: Z-A: the Scarlet/Violet Pokédex overview.
 */
import type { RawRow } from "../../../src/lib/pokemon/encounter-transform";
import { parseBdspDetail, parseLgpeDetail, parseOverview, parseSwshDetail } from "../../dex/serebii";
import { LOC_PAGES, rowsFromLocPage } from "../../dex/serebii-loc";
import { get, pool } from "./fetch";

export type SerebiiRow = RawRow & { species: number; url: string };

const nnn = (id: number) => String(id).padStart(3, "0");

/** Serebii serves older sections as Latin-1: decode as UTF-8 unless that breaks characters. */
function decode(b: Buffer): string {
  const u = b.toString("utf8");
  return u.includes("�") ? b.toString("latin1") : u;
}

async function page(rel: string, url: string): Promise<{ html: string; url: string } | null> {
  const g = await get(`serebii/${rel}`, url, "serebii");
  return g.body ? { html: decode(g.body), url: g.url } : null;
}

/** Gen 1-7 location pages of one LOC_PAGES key, for species 1..maxId. */
export async function locRows(key: keyof typeof LOC_PAGES): Promise<SerebiiRow[]> {
  const pg = LOC_PAGES[key];
  const ids = Array.from({ length: pg.maxId }, (_, i) => i + 1);
  const per = await pool(ids, 4, async (id) => {
    const url = `https://www.serebii.net/${pg.dir}/location/${nnn(id)}.shtml`;
    const p = await page(`${pg.dir}/location/${nnn(id)}.shtml`, url);
    return p ? rowsFromLocPage(p.html, pg.anchors).map((r) => ({ ...r, species: id, url })) : [];
  });
  return per.flat();
}

/** Let's Go tables of the Sun/Moon location pages (Kanto 151 + Meltan/Melmetal). */
export async function lgpeRows(): Promise<SerebiiRow[]> {
  const ids = [...Array.from({ length: 151 }, (_, i) => i + 1), 808, 809];
  const per = await pool(ids, 4, async (id) => {
    const url = `https://www.serebii.net/pokedex-sm/location/${nnn(id)}.shtml`;
    const p = await page(`pokedex-sm/location/${nnn(id)}.shtml`, url);
    if (!p) return [];
    return [...parseLgpeDetail(p.html, "letsgop", "lets-go-pikachu"), ...parseLgpeDetail(p.html, "letsgoe", "lets-go-eevee")].map((r) => ({ ...r, species: id, url }));
  });
  return per.flat();
}

/**
 * The overview parser drops a label written inline before a line's places ("Paldean Form: <a>…</a>, <a>…</a>",
 * "Combat Breed: …", "Titan: …"); it only reads a label on a line of its own. Each place of such a line carries the
 * label through the parser ("Alfornada Cavern⟨Paldean Form⟩"), and comes out with it as a note ("label:Paldean Form").
 */
const MARK = /⟨([^⟩]+)⟩/;
function markInline(html: string): string {
  const start = html.indexOf("<h2>Locations</h2>");
  if (start < 0) return html;
  const end = html.indexOf("</table>", start);
  const table = html.slice(start, end).replace(/(<td class="fooinfo"[^>]*>)([\s\S]*?)(<\/td>)/g, (_, a: string, info: string, b: string) => {
    const segs = info.split(/(<br\s*\/?>)/i).map((seg) => {
      const m = seg.match(/^\s*([^:<>]{2,60}?):\s*(?=<a\b)/);
      if (!m || /^(Fixed|Max Raid Battles|Tera Raid Battles)$/.test(m[1].trim())) return seg;
      const label = m[1].trim();
      return seg.replace(/(<a\b[^>]*>)([\s\S]*?)(<\/a>)/g, (_x, o: string, t: string, c: string) => `${o}${t}⟨${label}⟩${c}`);
    });
    return a + segs.join("") + b;
  });
  return html.slice(0, start) + table + html.slice(end);
}
function unmark<T extends { loc?: string; base?: string; n?: string }>(r: T): T {
  const m = r.loc?.match(MARK);
  if (!m) return r;
  const clean = (x?: string) => x?.replace(MARK, "").trim();
  return { ...r, loc: clean(r.loc), base: clean(r.base), n: [`label:${m[1]}`, r.n].filter(Boolean).join(" · ") };
}

/** Sword/Shield Pokédex pages (species 1-905): overview rows (incl. Legends: Arceus and DLC notes) and detail rows. */
export async function swshRows(): Promise<{ overview: SerebiiRow[]; detail: SerebiiRow[] }> {
  const ids = Array.from({ length: 905 }, (_, i) => i + 1);
  const per = await pool(ids, 4, async (id) => {
    const ov = await page(`pokedex-swsh/${nnn(id)}.shtml`, `https://www.serebii.net/pokedex-swsh/${nnn(id)}.shtml`);
    if (!ov) return { overview: [], detail: [] };
    const overview = parseOverview(markInline(ov.html)).map((r) => ({ ...unmark(r), species: id, url: ov.url }));
    const locUrl = ov.url.replace(/\/?(index\.shtml)?$/, "/") + "locations.shtml";
    const loc = await page(`pokedex-swsh/${nnn(id)}-locations.shtml`, locUrl);
    const detail = loc
      ? [...parseSwshDetail(loc.html, "sword", "sword"), ...parseSwshDetail(loc.html, "shiekd", "shield"), ...parseBdspDetail(loc.html, "bd", "brilliant-diamond"), ...parseBdspDetail(loc.html, "sp", "shining-pearl")].map((r) => ({ ...r, species: id, url: locUrl }))
      : [];
    return { overview, detail };
  });
  return { overview: per.flatMap((p) => p.overview), detail: per.flatMap((p) => p.detail) };
}

/** Scarlet/Violet Pokédex pages (species 1-1025): overview rows (Scarlet/Violet, DLC, Legends: Z-A). */
export async function svRows(): Promise<SerebiiRow[]> {
  const ids = Array.from({ length: 1025 }, (_, i) => i + 1);
  const per = await pool(ids, 4, async (id) => {
    const p = await page(`pokedex-sv/${nnn(id)}.shtml`, `https://www.serebii.net/pokedex-sv/${nnn(id)}.shtml`);
    return p ? parseOverview(markInline(p.html)).map((r) => ({ ...unmark(r), species: id, url: p.url })) : [];
  });
  return per.flat();
}

/** The raw HTML of a cached Serebii page (for parsers that need more than the rows). */
export async function html(rel: string, url: string): Promise<string | null> {
  return (await page(rel, url))?.html ?? null;
}
