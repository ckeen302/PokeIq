/**
 * Bulbapedia location pages' encounter tables ({{Catch/entry…}} templates): which Pokémon each game's table lists,
 * for which versions, how, at what levels and rates. Parameter positions follow the templates' own source
 * (https://bulbapedia.bulbagarden.net/wiki/Template:Catch/entry1 and siblings).
 */
import { plain, templates, type Template } from "./bulbapedia";

/** Template name (lowercase, after "catch/") -> version ids of its yes/no flags, and the positions (1-based) of method, levels and rates. */
interface Spec {
  flags: string[];
  /** Position of the method param; 0 = none (Scarlet/Violet name the habitat in flags, the Legends games have one way). */
  method: number;
  levels: number;
  /** Positional rate params (one, or one per time of day / season); `all=` overrides. */
  rates: number[];
  /** A single-version game's template has no version flags: every row is that version's. */
  single?: string;
}
const S = (flags: string[], method: number, levels: number, rates: number[], single?: string): Spec => ({ flags, method, levels, rates, ...(single ? { single } : {}) });
/** Scarlet/Violet's habitat flags -> method label. */
const HABITAT: [string, string][] = [
  ["land", "Land"],
  ["watersurface", "Water surface"],
  ["underwater", "Underwater"],
  ["overland", "Overland"],
  ["sky", "Sky"],
];
export const SPECS: Record<string, Spec> = {
  entry1: S(["red", "blue", "yellow"], 6, 7, [8]),
  entry2: S(["gold", "silver", "crystal"], 6, 7, [8, 9, 10]),
  entry3: S(["ruby", "sapphire", "emerald"], 6, 7, [8]),
  entryfl: S(["firered", "leafgreen"], 5, 6, [7]),
  /** Altering Cave's table (FireRed, LeafGreen, Emerald). */
  entry3a: S(["firered", "leafgreen", "emerald"], 6, 7, [8]),
  entry4: S(["diamond", "pearl", "platinum"], 6, 7, [8, 9, 10]),
  entryhs: S(["heartgold", "soulsilver"], 5, 6, [7, 8, 9]),
  entrybdsp: S(["brilliant-diamond", "shining-pearl"], 5, 6, [7, 8, 9]),
  entry5: S(["black", "white"], 6, 7, [8, 9, 10, 11]),
  "entry5-2": S(["black-2", "white-2"], 5, 6, [7, 8, 9, 10]),
  entry6: S(["x", "y"], 5, 6, [7]),
  entryoras: S(["omega-ruby", "alpha-sapphire"], 5, 6, [7]),
  entry7: S(["sun", "moon"], 5, 6, [7, 8]),
  entryusum: S(["ultra-sun", "ultra-moon"], 5, 6, [7, 8]),
  entrype: S(["lets-go-pikachu", "lets-go-eevee"], 5, 6, [7]),
  entry8: S(["sword", "shield"], 5, 6, [7]),
  entry9: S(["scarlet", "violet"], 0, 5, []),
  "entry9/special": S(["scarlet", "violet"], 5, 6, [7]),
  entryla: S([], 0, 3, [], "legends-arceus"),
  entryza: S([], 0, 3, [], "legends-za"),
};

export interface BulbaRow {
  /** Template key ("entryfl"). */
  tpl: string;
  versions: string[];
  species: number;
  name: string;
  form?: string;
  /** The template's method value ("Grass", "Fish Old", "Gift", "Trade", "Special"…). */
  method: string;
  levels?: string;
  rate?: string;
  /** The table's current divider label ("Fishing", "Headbutt Group A", "B1F-3F"…), plain text. */
  div?: string;
  /** The headings above the table inside the Pokémon section ("Generation III", "1F"…). */
  heads: string[];
  /** Named params as given (type1, tradename, all…). */
  named: Record<string, string>;
}

/** The "Pokémon" section of a location page ("==Pokémon==", or "===Pokémon===" on a building's page), to the next heading of its level. */
export function pokemonSection(text: string): { body: string; offset: number } | null {
  // Lenient on the closing "=" ("==Pokémon===" occurs).
  const m = /^(={2,3})\s*Pokémon\s*={2,3}\s*$/m.exec(text);
  if (!m) return null;
  const lvl = m[1].length;
  const start = m.index + m[0].length;
  const next = new RegExp(`^={2,${lvl}}[^=].*?[^=]={2,${lvl}}\\s*$`, "m").exec(text.slice(start));
  return { body: text.slice(start, next ? start + next.index : undefined), offset: start };
}

/** Scarlet/Violet pages put fixed and special encounters in their own level-2 sections. */
function extraSections(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^==\s*(Fixed encounters|Special encounters|Static encounters|Gift Pokémon)\s*==\s*$/gm)) {
    const start = m.index! + m[0].length;
    const next = /^==[^=].*?[^=]==\s*$/m.exec(text.slice(start));
    out.push(text.slice(start, next ? start + next.index : undefined));
  }
  return out;
}

/** The Pokémon of the {{Pokémon}} boxes in a page's "Special encounters" section (Scarlet/Violet's Snacksworth Legendaries), by National Dex number. */
export function specialBoxes(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/^==\s*Special encounters\s*==\s*$/gm)) {
    const start = m.index! + m[0].length;
    const next = /^==[^=].*?[^=]==\s*$/m.exec(text.slice(start));
    const body = text.slice(start, next ? start + next.index : undefined);
    const all = templates(body);
    // A trainer's team ({{Party}} … {{Party/end}}, e.g. Carmine beside the player against a Titan) is not an encounter.
    const teams = all.filter((t) => /^Party$/i.test(t.name)).map((t) => [t.start, body.indexOf("{{Party/end}}", t.end)] as const);
    for (const t of all)
      if (/^Pokémon$/i.test(t.name) && !teams.some(([a, b]) => t.start > a && (b < 0 || t.start < b))) {
        const n = Number(String(t.named.ndex ?? "").match(/\d{1,4}/)?.[0] ?? NaN);
        if (Number.isInteger(n)) out.push(n);
      }
  }
  return out;
}

/** Every catch entry whose template is in SPECS: of the page's Pokémon sections, or (`whole`) of the whole text, e.g. a walkthrough part. */
export function catchRows(text: string, opts: { whole?: boolean } = {}): BulbaRow[] {
  if (!opts.whole) {
    const sec = pokemonSection(text);
    const bodies = [...(sec ? [sec.body] : []), ...extraSections(text)];
    return bodies.flatMap((b) => catchRows(b, { whole: true }));
  }
  const body = text;
  const heads = [...body.matchAll(/^(={2,6})\s*(.*?)\s*\1\s*$/gm)].map((h) => ({ at: h.index!, lvl: h[1].length, name: plain(h[2]) }));
  const out: BulbaRow[] = [];
  let div: string | undefined;
  let lastHeadAt = -1;
  for (const t of templates(body)) {
    const name = t.name.toLowerCase().replace(/^catch\//, "");
    if (!/^catch\//i.test(t.name)) continue;
    const headsAbove = heads.filter((h) => h.at < t.start);
    const curHeadAt = headsAbove.length ? headsAbove[headsAbove.length - 1].at : -1;
    if (curHeadAt !== lastHeadAt) {
      div = undefined;
      lastHeadAt = curHeadAt;
    }
    if (/^(header|footer)/.test(name)) {
      div = undefined;
      continue;
    }
    if (/^div/.test(name)) {
      div = plain(t.pos[1] ?? "") || undefined;
      continue;
    }
    const spec = SPECS[name];
    if (!spec) continue;
    out.push(rowOf(t, name, spec, div, stack(headsAbove)));
  }
  return out;
}

/** The chain of headings (by level) above a point. */
function stack(hs: { lvl: number; name: string }[]): string[] {
  const chain: { lvl: number; name: string }[] = [];
  for (const h of hs) {
    while (chain.length && chain[chain.length - 1].lvl >= h.lvl) chain.pop();
    chain.push(h);
  }
  return chain.map((h) => h.name);
}

function rowOf(t: Template, tpl: string, spec: Spec, div: string | undefined, heads: string[]): BulbaRow {
  const p = (n: number) => (t.pos[n - 1] ?? "").trim();
  const versions = spec.single ? [spec.single] : spec.flags.filter((_, i) => /^yes$/i.test(p(3 + i)));
  const habitat = HABITAT.filter(([k]) => /^yes$/i.test(t.named[k] ?? "")).map(([, l]) => l).join(", ");
  const rates = spec.rates.map(p).filter(Boolean);
  const rate = t.named.all !== undefined ? plain(t.named.all) : rates.length ? rates.map(plain).join("/") : undefined;
  const form = t.named.form ? plain(t.named.form) : undefined;
  return {
    tpl,
    versions,
    // "025", "201A" (Unown's letter), "025Ro" (Pikachu in a costume), "{{#ifexpr:…|592|592F}}" (Frillish's gender): the dex number.
    species: Number((/^\{\{#if/.test(p(1)) ? p(1).split("|")[1] : p(1)).match(/\d{1,4}/)?.[0] ?? NaN),
    name: plain(p(2)),
    ...(form ? { form } : {}),
    method: spec.method ? plain(p(spec.method)) : habitat || "Wild",
    ...(p(spec.levels) ? { levels: plain(p(spec.levels)) } : {}),
    ...(rate ? { rate } : {}),
    ...(div ? { div } : {}),
    heads,
    named: t.named,
  };
}
