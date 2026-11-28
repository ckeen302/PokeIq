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
  /** Scarlet/Violet's Terastallized encounters: the Tera Type its level cell's Tera Jewel shows ("Normal"). */
  tera?: string;
  /** Scarlet/Violet's Kitakami rows: the levels after the player completes The Way Home ("levelscaled"). */
  levelsAfter?: string;
  /** Legends: Arceus's "Alpha Levels" column (a fixed alpha's only level). */
  alphaLevels?: string;
  /** A level cell with two ranges ("33-36<br>50-52": two spawns of it at different levels), each range. */
  levelSets?: string[];
  /** Legends: Arceus: the spawn is always an alpha ("alpha=yes", the alpha icon). */
  alpha?: true;
  /** The times of day it appears at, when not all ("Night"; Scarlet/Violet and the Legends games' time columns). */
  times?: string[];
  /** The weather it appears in, when not every weather its table has (the Legends games' weather columns). */
  weather?: string[];
  rate?: string;
  /** The table's current divider label ("Fishing", "Headbutt Group A", "B1F-3F"…), plain text. */
  div?: string;
  /** The headings above the table inside the Pokémon section ("Generation III", "1F"…). */
  heads: string[];
  /** Named params as given (type1, tradename, all…). */
  named: Record<string, string>;
  /** The table notes that this part of it can't be reached in the game ("The water is inaccessible without glitches"). */
  inaccessible?: true;
  /** The rate column's tooltip ("{{tt|One|After receiving the National Pokédex}}"), plain text. */
  note?: string;
  /** The tooltip says the Pokémon can't be caught (Sword/Shield's first Eternatus battle). */
  uncatchable?: true;
  /** The tooltip says it needs an event (a QR code activation, a distribution): not an encounter of the game itself. */
  event?: true;
}

/** A table note saying its rows can't be reached in normal play. */
const INACCESSIBLE = /\binaccessible\b|without (the use of )?(a )?cheating device|without glitches/i;

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

/** Scarlet/Violet pages put fixed, Terastallized and special encounters in their own level-2 sections. */
function extraSections(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^==\s*(Fixed encounters|Terastallized encounters|Special encounters|Static encounters|Gift Pokémon)\s*==\s*$/gm)) {
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
  let divType = "";
  let lastHeadAt = -1;
  // The current table's header params: which weather columns it has (Legends: Arceus, Legends: Z-A).
  let cols: Record<string, string> = {};
  // The rows of the current table ({{Catch/header}} to {{Catch/footer}}) by divider type ("water", "land"…): a note
  // divider saying that part can't be reached marks every row of its type in the table, before or after it.
  let table: { row: BulbaRow; type: string }[] = [];
  const blocked = new Set<string>();
  const closeTable = () => {
    for (const x of table) if (blocked.has(x.type)) x.row.inaccessible = true;
    table = [];
    blocked.clear();
  };
  for (const t of templates(body)) {
    const name = t.name.toLowerCase().replace(/^catch\//, "");
    if (!/^catch\//i.test(t.name)) continue;
    const headsAbove = heads.filter((h) => h.at < t.start);
    const curHeadAt = headsAbove.length ? headsAbove[headsAbove.length - 1].at : -1;
    if (curHeadAt !== lastHeadAt) {
      div = undefined;
      divType = "";
      lastHeadAt = curHeadAt;
    }
    if (/^(header|footer)/.test(name)) {
      div = undefined;
      closeTable();
      cols = /^header/.test(name) ? t.named : {};
      // A table's header names its first rows' type ("land", "water") until a divider says otherwise.
      divType = /^header/.test(name) ? (t.pos[0] ?? "").trim().toLowerCase() : "";
      continue;
    }
    if (/^div/.test(name)) {
      const label = plain(t.pos[1] ?? "");
      if (INACCESSIBLE.test(label)) {
        blocked.add((t.pos[0] ?? "").trim().toLowerCase());
        continue;
      }
      div = label || undefined;
      divType = (t.pos[0] ?? "").trim().toLowerCase();
      continue;
    }
    const spec = SPECS[name];
    if (!spec) continue;
    const chain = stack(headsAbove);
    // A demo's table ("Pokémon Omega Ruby and Pokémon Alpha Sapphire Special Demo Version") is not the game's.
    if (chain.some((h) => /\bDemo\b/i.test(h))) continue;
    const row = rowOf(t, name, spec, div, chain, cols);
    out.push(row);
    table.push({ row, type: divType });
  }
  closeTable();
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

const TIMES = ["morning", "day", "evening", "night"];
const WEATHER: Record<string, string> = { clear: "Clear", sun: "Harsh sunlight", cloudy: "Cloudy", rain: "Rain", thunderstorm: "Thunderstorm", snow: "Snow", blizzard: "Blizzard", fog: "Fog" };
const ZA_WEATHER = ["clear", "sun", "cloudy", "rain", "fog"];

/**
 * The time-of-day and weather columns of Scarlet/Violet's and the Legends games' rows, read as their templates do:
 * Scarlet/Violet: "all", or morning/day/evening/night ("0" = not then; unset = the spawn weight). Legends: Arceus:
 * "all", or morning/day/evening/night (params 5-8, a mark = then); weather: param 9 (every weather), or one named
 * param per weather (empty = not then, "na" = the table has no such column). Legends: Z-A: param 4 (all day), or
 * day/night (params 5-6); weather: param 7 (every weather), or params 8-12 (clear, harsh sunlight, cloudy, rain, fog).
 */
function timeWeather(t: Template, tpl: string, cols: Record<string, string>): { times?: string[]; weather?: string[] } {
  const given = (n: number) => t.pos[n - 1];
  const val = (name: string | undefined, n: number | undefined, dflt: string) => {
    const v = (name ? t.named[name] : undefined) ?? (n ? given(n) : undefined);
    return v === undefined ? dflt : plain(v).trim();
  };
  const on = (v: string) => v !== "" && v !== "0" && !/^(no|na|✘|✗)$/i.test(v);
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const out: { times?: string[]; weather?: string[] } = {};
  const has = (w: string) => !/^no$/i.test(plain(cols[w] ?? "yes"));
  if (tpl === "entry9" && t.named.all === undefined) {
    const ok = TIMES.filter((x) => on(val(x, 6, "50")));
    if (ok.length && ok.length < TIMES.length) out.times = ok.map(cap);
  }
  if (tpl === "entryla") {
    if (!on(plain(t.named.all ?? ""))) {
      const ok = TIMES.filter((x, i) => on(val(x, 5 + i, "✔")));
      if (ok.length && ok.length < TIMES.length) out.times = ok.map(cap);
    }
    if (!on(val(undefined, 9, ""))) {
      const present = Object.keys(WEATHER).filter((w) => has(w) && val(w, undefined, "") !== "na");
      const ok = present.filter((w) => on(val(w, undefined, "")));
      if (ok.length && ok.length < present.length) out.weather = ok.map((w) => WEATHER[w]);
    }
  }
  if (tpl === "entryza") {
    if (!on(val(undefined, 4, ""))) {
      const ok = ["day", "night"].filter((x, i) => on(val(x, 5 + i, "✔")));
      if (ok.length === 1) out.times = ok.map(cap);
    }
    if (!on(val(undefined, 7, ""))) {
      const present = ZA_WEATHER.filter(has);
      const ok = present.filter((w) => on(val(undefined, 8 + ZA_WEATHER.indexOf(w), "")));
      if (ok.length && ok.length < present.length) out.weather = ok.map((w) => WEATHER[w]);
    }
  }
  return out;
}

function rowOf(t: Template, tpl: string, spec: Spec, div: string | undefined, heads: string[], cols: Record<string, string> = {}): BulbaRow {
  const p = (n: number) => (t.pos[n - 1] ?? "").trim();
  const versions = spec.single ? [spec.single] : spec.flags.filter((_, i) => /^yes$/i.test(p(3 + i)));
  const habitat = HABITAT.filter(([k]) => /^yes$/i.test(t.named[k] ?? "")).map(([, l]) => l).join(", ");
  const rates = spec.rates.map(p).filter(Boolean);
  const rate = t.named.all !== undefined ? plain(t.named.all) : rates.length ? rates.map(plain).join("/") : undefined;
  const rawRate = t.named.all ?? rates.join(" ");
  const tip = /\{\{tt\|[^|{}]*\|([^{}]*)\}\}/.exec(rawRate)?.[1];
  const note = tip ? plain(tip) : undefined;
  // Legends: Arceus writes the form in the dex code: "058H" (Hisuian Growlithe), "550W" (White-Striped Basculin),
  // "487O" (Origin Giratina), "422E" (East Sea Shellos), "413G"/"413S" (Sandy/Trash Cloak), "037A" (Alolan Vulpix). Unown's letters ("201H",
  // "201QU") are its letter, not these codes: they name no form.
  const LA_CODE: Record<string, string> = { H: "Hisuian Form", W: "White-Striped Form", O: "Origin Forme", E: "East Sea", G: "Sandy Cloak", S: "Trash Cloak", A: "Alolan Form" };
  const code = tpl === "entryla" && !/^0*201\D/.test(p(1)) ? p(1).match(/^\d{1,4}([A-Z])$/)?.[1] : undefined;
  const form = t.named.form ? plain(t.named.form) : code && LA_CODE[code] ? LA_CODE[code] : undefined;
  return {
    tpl,
    versions,
    // "025", "201A" (Unown's letter), "025Ro" (Pikachu in a costume), "{{#ifexpr:…|592|592F}}" (Frillish's gender): the dex number.
    species: Number((/^\{\{#if/.test(p(1)) ? p(1).split("|")[1] : p(1)).match(/\d{1,4}/)?.[0] ?? NaN),
    name: plain(p(2)),
    ...(form ? { form } : {}),
    method: spec.method ? plain(p(spec.method)) : habitat || "Wild",
    // "37 [[image:TeraGem_Normal.png|30px]]": the level, and the Tera Jewel's type.
    ...(p(spec.levels) ? { levels: plain(p(spec.levels).replace(/\[\[(?:image|file):[^\]]*\]\]/gi, "")) } : {}),
    ...(/TeraGem_(\w+)\./i.test(p(spec.levels)) ? { tera: /TeraGem_(\w+)\./i.exec(p(spec.levels))![1] } : {}),
    ...(t.named.levelscaled?.trim() ? { levelsAfter: plain(t.named.levelscaled) } : {}),
    ...(tpl === "entryla" && p(4) ? { alphaLevels: plain(p(4)) } : {}),
    ...(/^entry(la|za|9)$/.test(tpl) && /<br\s*\/?>/i.test(p(spec.levels)) ? { levelSets: p(spec.levels).split(/<br\s*\/?>/i).map((x) => plain(x)).filter(Boolean) } : {}),
    ...(tpl === "entryla" && /^yes$/i.test(t.named.alpha ?? "") ? { alpha: true as const } : {}),
    ...timeWeather(t, tpl, cols),
    ...(rate ? { rate } : {}),
    ...(div ? { div } : {}),
    heads,
    named: t.named,
    ...(note ? { note } : {}),
    ...(note && /\b(cannot|can't|can not) be caught\b/i.test(note) ? { uncatchable: true as const } : {}),
    ...(note && /\bQR Code\b|\bevent\b|\bdistribut|\bMystery Gift\b|\bserial code\b/i.test(note) ? { event: true as const } : {}),
  };
}
