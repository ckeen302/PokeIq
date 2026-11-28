/**
 * Bulbapedia as the primary source (Scarlet/Violet, Legends: Arceus, Legends: Z-A): each area's encounters are its
 * Bulbapedia location page's tables (a big area's are the union of its sublocations' pages), plus the one-time
 * Pokémon of its "Special encounters" boxes. A Serebii row is added only where Serebii names that exact area and the
 * Pokémon's own Bulbapedia page (its "Game locations" for the game) names that area (or one of its sublocations) too.
 * The starters are the walkthrough's first partners, placed where their Bulbapedia pages say they are received.
 */
import type { EncounterKind } from "../../../src/lib/nuzlocke/model";
import { catchRows, type BulbaRow } from "./bulba-catch";
import { pages, pageUrl, plain, templates } from "./bulbapedia";
import type { GameCfg } from "./config";
import { formFor } from "./forms";
import { parseLevels, type Row } from "./rows";
import type { Walkthrough } from "./walkthrough";

/** Availability labels ("v=") of each game -> the versions they cover. */
const V_LABELS: Record<string, Record<string, string[]>> = {
  "scarlet-violet": { Scarlet: ["scarlet"], Violet: ["violet"], "The Teal Mask": ["scarlet", "violet"], "The Indigo Disk": ["scarlet", "violet"] },
  "legends-arceus": { "Legends: Arceus": ["legends-arceus"] },
  "legends-za": { "Legends: Z-A": ["legends-za"], "Mega Dimension": ["legends-za"] },
};

const norm = (t: string) => {
  const s = t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export interface Avail {
  versions: string[];
  /** The entry's area text (wikitext). */
  area: string;
  url: string;
}

/** Each species' Bulbapedia "Game locations" entries for this game. */
export async function availability(game: string, names: Map<number, string>): Promise<Map<number, Avail[]>> {
  const labels = V_LABELS[game] ?? {};
  const titles = new Map([...names].map(([id, n]) => [id, `${n} (Pokémon)`]));
  const got = await pages([...titles.values()]);
  const out = new Map<number, Avail[]>();
  for (const [id, t] of titles) {
    const p = got.get(t);
    const list: Avail[] = [];
    for (const tpl of templates(p?.text ?? "")) {
      if (!/^Availability\/Entry[12]$/.test(tpl.name)) continue;
      const vs = [tpl.named.v, tpl.named.v2].filter(Boolean).map((v) => plain(v!)).flatMap((v) => labels[v] ?? []);
      if (!vs.length || !tpl.named.area) continue;
      list.push({ versions: [...new Set(vs)], area: tpl.named.area, url: pageUrl(p!.title ?? t) });
    }
    out.set(id, list);
  }
  return out;
}

/** The places an availability text names: its links, without the bold group labels ("'''[[Vert District]]:'''"). */
export function placesIn(area: string): { title: string; after: string }[] {
  const text = area.replace(/'''\[\[[^\]]+\]\]:?'''\s*:?/g, " ");
  const out: { title: string; after: string }[] = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + m[0].length);
    const end = rest.search(/\[\[|<br\s*\/?>/i);
    out.push({ title: norm(m[1]), after: end < 0 ? rest : rest.slice(0, end) });
  }
  return out;
}

/**
 * Does a species' availability name this area for this version (a link to the area's page or one of its
 * sublocations, or, under the area's bold group label, a link to some place in it that isn't an area of its own,
 * e.g. "'''[[Vert District]]:''' [[Vert Sector 1]]")? And as "Only one"?
 */
export function confirmed(av: Avail[] | undefined, ver: string, titles: Set<string>, otherAreas: Set<string> = new Set()): { ok: boolean; once: boolean; url?: string } {
  for (const a of av ?? []) {
    if (!a.versions.includes(ver)) continue;
    for (const line of a.area.split(/<br\s*\/?>/i)) {
      const links = placesIn(line);
      const hit = links.find((p) => titles.has(p.title));
      if (hit) return { ok: true, once: /Only one/i.test(hit.after), url: a.url };
      const label = line.match(/^\s*'''\[\[([^\]|]+)(?:\|[^\]]*)?\]\]:?'''/)?.[1];
      if (label && titles.has(norm(label)) && links.some((p) => !otherAreas.has(p.title))) return { ok: true, once: /Only one/i.test(line), url: a.url };
    }
  }
  return { ok: false, once: false };
}

/** A page's title, its sublocations (a "Sublocations" or "Sectors" list) and its infobox region. */
export interface AreaPage {
  title: string;
  url: string;
  subs: string[];
  region: string;
  text: string;
}

export async function areaPages(candidates: Map<string, string[]>): Promise<Map<string, AreaPage | null>> {
  const got = await pages([...new Set([...candidates.values()].flat())]);
  const out = new Map<string, AreaPage | null>();
  for (const [key, list] of candidates) {
    let hit: AreaPage | null = null;
    for (const t of list) {
      const p = got.get(t);
      if (!p?.text || !p.title || /\{\{\s*disambig/i.test(p.text)) continue;
      const subs: string[] = [];
      for (const m of p.text.matchAll(/^(={2,4})\s*(Sublocations|Sectors)\s*\1\s*$/gm)) {
        const rest = p.text.slice(m.index! + m[0].length);
        const stop = new RegExp(`^={2,${m[1].length}}[^=]`, "m").exec(rest);
        const body = rest.slice(0, stop ? stop.index : rest.length);
        for (const l of body.matchAll(/\[\[([^|\]#]+)(?:\|[^\]]*)?\]\]/g)) subs.push(norm(l[1]));
      }
      hit = { title: p.title, url: pageUrl(p.title), subs: [...new Set(subs)], region: plain(p.text.match(/^\|\s*region\s*=\s*([^\n|]*)/m)?.[1] ?? ""), text: p.text };
      break;
    }
    out.set(key, hit);
  }
  return out;
}

/** One-time Pokémon of a page's "Special encounters" boxes: not a trainer's team, not a Titan's or Noble's battle. */
export function boxRows(text: string): { species: number; name: string; level?: number; head: string }[] {
  const out: { species: number; name: string; level?: number; head: string }[] = [];
  for (const m of text.matchAll(/^==\s*Special encounters\s*==\s*$/gm)) {
    const start = m.index! + m[0].length;
    const next = /^==[^=].*?[^=]==\s*$/m.exec(text.slice(start));
    const body = text.slice(start, next ? start + next.index : undefined);
    const heads = [...body.matchAll(/^(={3,6})\s*(.*?)\s*\1\s*$/gm)].map((h) => ({ at: h.index!, name: plain(h[2]) }));
    const all = templates(body);
    const teams = all.filter((t) => /^Party$/i.test(t.name)).map((t) => [t.start, body.indexOf("{{Party/end}}", t.end)] as const);
    for (const t of all) {
      if (!/^Pokémon$/i.test(t.name) || teams.some(([a, b]) => t.start > a && (b < 0 || t.start < b))) continue;
      const head = heads.filter((h) => h.at < t.start).pop()?.name ?? "";
      if (/Titan|Frenzy|frenzied|Noble/i.test(head)) continue;
      const species = Number(String(t.named.ndex ?? "").match(/\d{1,4}/)?.[0] ?? NaN);
      const lv = Number(plain(t.named.level ?? "").match(/\d+/)?.[0] ?? NaN);
      if (Number.isInteger(species)) out.push({ species, name: plain(t.named.pokemon ?? ""), ...(Number.isFinite(lv) ? { level: lv } : {}), head });
    }
  }
  return out;
}

/** A Bulbapedia table row -> kind, method and condition, by the game's table layout. */
function kindOf(game: string, h: BulbaRow): { kind: EncounterKind; method: string; cond?: string } | null {
  const note = h.named.note ? plain(h.named.note) : "";
  const div = h.div ?? "";
  if (game === "scarlet-violet") {
    if (h.tpl === "entry9/special") {
      const where = h.method && !/^Fixed$/i.test(h.method) ? h.method : "";
      const cond = [where, note].filter(Boolean).join("; ") || undefined;
      return /^Only One$/i.test(h.rate ?? "") ? { kind: "static", method: "Static", ...(cond ? { cond } : {}) } : { kind: "wild", method: "Fixed", ...(cond ? { cond } : {}) };
    }
    return { kind: "wild", method: h.method || "Wild", ...(note ? { cond: note } : {}) };
  }
  if (game === "legends-arceus") {
    if (/^Gift$/i.test(div)) return { kind: "gift", method: "Gift", ...(note ? { cond: note } : {}) };
    if (/Unown Research Notes|Special Pokémon/i.test(div) || /\bRequest \d+/.test(note)) return { kind: "static", method: "Static", ...(note ? { cond: note } : {}) };
    const method = !div ? "Wild" : /Space-time/i.test(div) ? "Space-time distortion" : /Mass outbreak/i.test(div) ? "Mass outbreak" : /Fixed Alpha/i.test(div) ? "Fixed alpha" : div;
    return { kind: "wild", method, ...(note ? { cond: note } : {}) };
  }
  if (game === "legends-za") {
    if (/\bGift Pokémon\b/i.test(div)) return { kind: "gift", method: "Gift", cond: div.replace(/^Gift Pokémon\s*/i, "") || undefined };
    if (/\bFossil\b/i.test(div)) return { kind: "fossil", method: "Fossil", cond: div };
    if (/Only during|Mission/i.test(div)) return { kind: "static", method: "Static", cond: div };
    return { kind: "wild", method: /Fixed alpha/i.test(div) ? "Fixed alpha" : "Wild", ...(note ? { cond: note } : {}) };
  }
  return null;
}

/** Every row of an area's Bulbapedia pages (its own, or its sublocations'), as Rows; DLC places get the DLC as condition. */
export async function areaRows(cfg: GameCfg, place: string, pagesOf: { title: string; url: string; text: string }[], dlc?: string): Promise<Row[]> {
  const out: Row[] = [];
  const tpl = new Set(cfg.bulba);
  const versions = cfg.versions.map((v) => v.id);
  for (const p of pagesOf) {
    for (const h of catchRows(p.text).filter((r) => tpl.has(r.tpl))) {
      const k = kindOf(cfg.id, h);
      if (!k) continue;
      const f = h.form ? await formFor(h.species, h.form) : {};
      const levels = parseLevels(h.levels);
      // A form PokéAPI doesn't list as a Pokémon (a cosmetic one, "Former Titan") stays in the condition.
      const cond = [k.cond, f === null ? h.form : "", dlc].filter(Boolean).join("; ") || undefined;
      for (const ver of h.versions.filter((v) => versions.includes(v)))
        out.push({ src: "bulbapedia", ver, place, species: h.species, ...(f?.form ? { form: f.form, art: f.art } : {}), kind: k.kind, method: k.method, ...(levels ? { levels } : {}), ...(cond ? { cond } : {}), url: p.url });
    }
    for (const b of boxRows(p.text))
      for (const ver of versions)
        out.push({ src: "bulbapedia", ver, place, species: b.species, kind: "static", method: "Static", ...(b.level ? { levels: [b.level, b.level] as [number, number] } : {}), ...(dlc ? { cond: dlc } : {}), url: p.url });
  }
  return out;
}

/**
 * The first partners: the Pokémon the walkthrough offers as such (its "First partner" section, or its rival battles'
 * player-choice captions), each where its own Bulbapedia page says it is received ("First partner Pokémon from
 * Clavell in [[Cabo Poco]]"; "'''[[Jubilife Village]]:''' [[First partner Pokémon]] from…").
 */
export async function partners(cfg: GameCfg, wt: Walkthrough, dex: { id: number; name: string }[]): Promise<{ species: number; place: string; sub?: string; url: string }[]> {
  const idByName = (n: string) => dex.find((p) => p.name === n)?.id;
  const named = new Set<number>();
  for (const e of wt.events) if (e.type === "party" && /^Player choice: /.test(e.caption)) named.add(idByName(e.caption.replace(/^Player choice: /, "").trim()) ?? 0);
  const got = await pages(wt.parts.slice(0, 3).map((p) => p.title));
  for (const p of wt.parts.slice(0, 3)) {
    const text = got.get(p.title)?.text ?? "";
    for (const m of text.matchAll(/^(={2,4})\s*(First partner Pokémon|A little help from the Professor)\s*\1\s*$/gm)) {
      const rest = text.slice(m.index! + m[0].length);
      const body = rest.slice(0, /^={2,4}[^=]/m.exec(rest)?.index ?? rest.length);
      for (const x of body.matchAll(/\{\{p\|([^}|]+)\}\}/g)) named.add(idByName(plain(x[1])) ?? 0);
    }
  }
  named.delete(0);
  const av = await availability(cfg.id, new Map([...named].map((id) => [id, dex.find((p) => p.id === id)!.name])));
  const out: { species: number; place: string; sub?: string; url: string }[] = [];
  for (const [id, list] of av)
    for (const a of list)
      for (const line of a.area.split(/<br\s*\/?>/i)) {
        if (!/\[\[First partner Pokémon\]\]/.test(line)) continue;
        const label = line.match(/'''\[\[([^\]|]+)/)?.[1];
        const inPlace = line.match(/First partner Pokémon\]\][^<]*?\bin \[\[([^\]|]+)/)?.[1];
        const place = label ?? inPlace;
        if (place && !out.some((o) => o.species === id)) out.push({ species: id, place: norm(place), ...(label && inPlace ? { sub: norm(inPlace) } : {}), url: a.url });
      }
  return out;
}
