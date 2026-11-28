/**
 * Bulbapedia as the primary source (Scarlet/Violet, Legends: Arceus, Legends: Z-A): each area's encounters are its
 * Bulbapedia location page's tables (a big area's are the union of its sublocations' pages), plus the one-time
 * Pokémon of its "Special encounters" boxes: this game's boxes only, with the condition the text above them gives, and
 * not the ones that text says are only battled. A Serebii row is added only where Serebii names that exact area and the
 * Pokémon's own Bulbapedia page (its "Game locations" for the game) names that area (or one of its sublocations) too;
 * what that page says of the place (a DLC, "after concluding Side Mission 160") becomes its condition.
 * The starters are the walkthrough's first partners, placed where their Bulbapedia pages say they are received.
 */
import fs from "node:fs";
import path from "node:path";
import type { EncounterKind } from "../../../src/lib/nuzlocke/model";
import { catchRows, type BulbaRow } from "./bulba-catch";
import { pages, pageUrl, plain, templates } from "./bulbapedia";
import { GAMES, type GameCfg } from "./config";
import { COSMETIC_FORMS, formFor } from "./forms";
import { parseLevels, type Row } from "./rows";
import type { Walkthrough } from "./walkthrough";

/** Availability labels ("v=") of each game -> the versions they cover. */
const V_LABELS: Record<string, Record<string, string[]>> = {
  "scarlet-violet": { Scarlet: ["scarlet"], Violet: ["violet"], "The Hidden Treasure of Area Zero": ["scarlet", "violet"], "The Teal Mask": ["scarlet", "violet"], "The Indigo Disk": ["scarlet", "violet"] },
  "legends-arceus": { "Legends: Arceus": ["legends-arceus"] },
  "legends-za": { "Legends: Z-A": ["legends-za"], "Mega Dimension": ["legends-za"] },
};

/** A game's DLC labels: its availability labels that are not one of its versions ("The Teal Mask", "Mega Dimension"). */
export function dlcLabels(game: string): string[] {
  const names = new Set(GAMES.find((g) => g.id === game)?.versions.map((v) => v.name) ?? []);
  return Object.keys(V_LABELS[game] ?? {}).filter((l) => !names.has(l));
}

const norm = (t: string) => {
  const s = t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export interface Avail {
  versions: string[];
  /** The entry's label as the page writes it ("Scarlet", "The Teal Mask", "Mega Dimension"). */
  label: string;
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
      list.push({ versions: [...new Set(vs)], label: plain(tpl.named.v ?? ""), area: tpl.named.area, url: pageUrl(p!.title ?? t) });
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
    // What follows the place up to the next place of the list (a top-level comma) or line: its note, e.g.
    // " ([[List of in-game event Pokémon…|Only one]])".
    const rest = text.slice(m.index + m[0].length);
    let depth = 0;
    let end = rest.length;
    for (let i = 0; i < rest.length; i++) {
      const two = rest.slice(i, i + 2);
      if (two === "[[" || two === "{{") (depth++, i++);
      else if (two === "]]" || two === "}}") (depth--, i++);
      else if (rest[i] === "(") depth++;
      else if (rest[i] === ")") depth--;
      else if (depth <= 0 && (rest[i] === "," || /^<br/i.test(rest.slice(i, i + 3)))) {
        end = i;
        break;
      }
    }
    out.push({ title: norm(m[1]), after: rest.slice(0, end) });
  }
  return out;
}

/**
 * Does a species' availability name this area for this version (a link to the area's page or one of its
 * sublocations, or, under the area's bold group label, a link to some place in it that isn't an area of its own,
 * e.g. "'''[[Vert District]]:''' [[Vert Sector 1]]")? And as "Only one"?
 */
export function confirmed(av: Avail[] | undefined, ver: string, titles: Set<string>, otherAreas: Set<string> = new Set()): { ok: boolean; once: boolean; url?: string; label?: string; note?: string } {
  for (const a of av ?? []) {
    if (!a.versions.includes(ver)) continue;
    // A bold group label on a line of its own ("'''[[Bleu District]]:'''<br>[[Bleu Sector 8]] …") heads the lines below it.
    let group: string | undefined;
    for (const line of a.area.split(/<br\s*\/?>/i)) {
      const links = placesIn(line);
      const hit = links.find((p) => titles.has(p.title));
      // What the entry says of that place ("(after concluding Side Mission 160: …)"), as its condition.
      const note = hit ? (/^\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/.exec(prose(hit.after))?.[1].trim() ?? "") : "";
      if (hit) return { ok: true, once: /Only one/i.test(hit.after), url: a.url, label: a.label, ...(note ? { note } : {}) };
      const own = line.match(/^\s*'''\[\[([^\]|]+)(?:\|[^\]]*)?\]\]:?'''/)?.[1];
      if (own) group = links.length ? undefined : own;
      const label = own ?? group;
      if (label && titles.has(norm(label)) && links.some((p) => !otherAreas.has(p.title))) return { ok: true, once: /Only one/i.test(line), url: a.url, label: a.label };
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

/** Each area's page: the first candidate with a table of this game's templates, else the first that exists. */
export async function areaPages(candidates: Map<string, string[]>, tpl: Set<string> = new Set()): Promise<Map<string, AreaPage | null>> {
  const got = await pages([...new Set([...candidates.values()].flat())]);
  const out = new Map<string, AreaPage | null>();
  const hasTable = (text: string) => catchRows(text).some((r) => tpl.has(r.tpl));
  for (const [key, list0] of candidates) {
    let hit: AreaPage | null = null;
    const list = [...list0.filter((t) => got.get(t)?.text && hasTable(got.get(t)!.text!)), ...list0];
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

/** HTML entities -> characters (a non-breaking hyphen, "&#8209;", as a plain "-"). */
export function decode(s: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", eacute: "é", times: "×" };
  const ch = (n: number) => (n === 0x2011 ? "-" : String.fromCodePoint(n));
  return s
    .replace(/&#(\d+);/g, (_, n: string) => ch(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => ch(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => named[n.toLowerCase()] ?? m);
}

/** Wikitext prose -> plain text, keeping the words of the inline templates prose uses ({{player}}, {{pkmn2|caught}}…). */
export function prose(s: string): string {
  const t = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/\[\[(?:File|Image):(?:[^[\]]|\[\[[^\]]*\]\])*\]\]/gi, "")
    .replace(/\{\{player\}\}/gi, "player")
    .replace(/\{\{fd\|[^|{}]*\|([^|{}]*)\}\}/gi, "$1")
    .replace(/\{\{Shiny\}\}/gi, "Shiny")
    .replace(/\{\{sup\/\w+\|[^{}]*\}\}/gi, "")
    .replace(/\{\{(?:pkmn2|OBP)\|([^|{}]*)(?:\|[^{}]*)?\}\}/gi, "$1")
    .replace(/\{\{DL\|[^|{}]*\|([^|{}]*)(?:\|([^{}]*))?\}\}/gi, (_, sec: string, disp?: string) => disp ?? sec);
  return decode(plain(t)).replace(/\s+(["”])(?=[,.;:!?)]|$)/g, "$1");
}

/** The first sentence that says how or when (not a note on its Shiny lock, moves, stats or Nature). */
function firstSentence(text: string): string {
  const sents: string[] = [];
  for (const p of text.split(/(?<=[.!?]["”]?)\s+(?=["“A-Z])/)) {
    if (sents.length && /\b(?:Mt|No|Dr|Mr|Ms|St|Jr|vs|Ver)\.$/.test(sents[sents.length - 1])) sents[sents.length - 1] += ` ${p}`;
    else if (p.trim()) sents.push(p.trim());
  }
  const aside = (x: string) => /coded to never|^In addition\b|^(?:It|They|This [\w ]+?|Both) (?:has|have|always|will always)\b|^The following applies\b/i.test(x) || /\bNature\b/.test(x);
  return (sents.find((x) => !aside(x)) ?? "").replace(/\.$/, "");
}

/** What a box's prose says when the Pokémon is only battled ("cannot be caught", a Rogue Mega Evolution's fight). */
const UNCATCHABLE = /\b(?:cannot|can't|can ?not|could not|can never) be (?:caught|captured)\b|\buncatchable\b|\bnone of (?:them|the \w+) can be caught\b|\bneither (?:of them )?can be caught\b|\bmust be defeated\b|\bhas to defeat\b|\bRogue Mega[- ]Evolved \w+(?: and \w+)? (?:is|are) battled\b/i;

/** The box "gen" codes of each Bulbapedia-primary game (a box of another game on a shared page is not this game's). */
const BOX_GEN: Record<string, string[]> = { "legends-arceus": ["LA"], "scarlet-violet": ["9", "SV"], "legends-za": ["ZA"] };
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
const VERSION_NAMES = new Set(GAMES.flatMap((g) => g.versions.map((v) => v.name)));

/** A heading that names games or a generation ("Pokémon Legends: Arceus", "Pokémon Scarlet", "Generation IV", "In Gen IX"): whether it is this game's, and which of its versions it names. */
function gameHeading(h: string, cfg: GameCfg): { ours: boolean; versions?: string[] } | null {
  const gen = /^(?:In )?Gen(?:eration)? ([IVX]+)$/i.exec(h);
  if (gen) return { ours: gen[1].toUpperCase() === ROMAN[cfg.gen] };
  const parts = h.replace(/^Pokémon\s+/, "").split(/,\s*(?:and\s+)?|\s+and\s+/).map((x) => x.replace(/^Pokémon\s+/, "").trim());
  if (!parts.length || !parts.every((x) => VERSION_NAMES.has(x))) return null;
  const mine = cfg.versions.filter((v) => parts.includes(v.name)).map((v) => v.id);
  return mine.length ? { ours: true, ...(mine.length < cfg.versions.length ? { versions: mine } : {}) } : { ours: false };
}

export interface BoxRow {
  species: number;
  name: string;
  levels?: [number, number];
  /** The headings above it (innermost last). */
  heads: string[];
  /** The versions it is limited to (a "Scarlet" caption, a "Pokémon Violet" heading). */
  versions?: string[];
  /** When and how, from the text above the box. */
  cond?: string;
  /** Why it is only battled, when the text says so. */
  uncatchable?: string;
}

/**
 * The Pokémon of a page's "Special encounters" boxes ("==Special encounters==", or "===Special encounters===" on a page
 * for several games), this game's only: not a trainer's team, not a Titan's or Noble's battle, not a box under another
 * game's heading or with another game's "gen". Each box takes its condition from the text above it (the box's own
 * paragraph, else its section's) and a ";term" line above it ("Before completing The Way Home"), and is marked
 * uncatchable when that text says the Pokémon is only battled.
 */
export function boxRows(text: string, cfg: GameCfg): BoxRow[] {
  const out: BoxRow[] = [];
  const gens = BOX_GEN[cfg.id] ?? [];
  for (const m of text.matchAll(/^(={2,3})\s*Special encounters\s*\1\s*$/gm)) {
    const lvl = m[1].length;
    const start = m.index! + m[0].length;
    const next = new RegExp(`^={2,${lvl}}[^=]`, "m").exec(text.slice(start));
    const body = text.slice(start, next ? start + next.index : undefined);
    const heads = [...body.matchAll(/^(={3,6})\s*(.*?)\s*\1\s*$/gm)].map((h) => ({ at: h.index!, end: h.index! + h[0].length, lvl: h[1].length, name: plain(h[2]) }));
    const all = templates(body);
    const teams = all.filter((t) => /^Party$/i.test(t.name)).map((t) => [t.start, body.indexOf("{{Party/end}}", t.end)] as const);
    const inTeam = (at: number) => teams.some(([a, b]) => at > a && (b < 0 || at < b));
    // The text with the block templates (boxes, grids, teams, notices) blanked: what is left is prose and ";term" lines.
    let masked = body;
    const blank = (a: number, b: number) => (masked = masked.slice(0, a) + masked.slice(a, b).replace(/[^\n]/g, " ") + masked.slice(b));
    for (const t of all) if (/^(?:Pokémon(?:\/.*)?|Party(?:\/.*)?|incomplete|missing image|main|see also|clear)$/i.test(t.name)) blank(t.start, t.end);
    for (const [a, b] of teams) if (b > a) blank(a, b + "{{Party/end}}".length);
    const proseOf = (a: number, b: number) => prose(masked.slice(a, b).split("\n").filter((l) => !/^\s*;/.test(l)).join("\n"));
    const termOf = (a: number, b: number) => [...masked.slice(a, b).matchAll(/^\s*;\s*(.+?)\s*$/gm)].map((x) => prose(x[1])).pop();
    const boxes = all.filter((t) => /^Pokémon$/i.test(t.name) && !inTeam(t.start));
    boxes.forEach((t, bi) => {
      const above = heads.filter((h) => h.at < t.start);
      const chain: typeof heads = [];
      for (const h of above) {
        while (chain.length && chain[chain.length - 1].lvl >= h.lvl) chain.pop();
        chain.push(h);
      }
      const names = chain.map((h) => h.name);
      if (names.some((h) => /Titan|Frenzy|frenzied|Noble/i.test(h))) return;
      const gen = plain(t.named.gen ?? "");
      if (gen && gens.length && !gens.includes(gen)) return;
      let versions: string[] | undefined;
      for (const h of names) {
        const g = gameHeading(h, cfg);
        if (g && !g.ours) return;
        if (g?.versions) versions = g.versions;
      }
      const caption = plain(t.named.caption ?? "");
      const capV = cfg.versions.filter((v) => v.name === caption).map((v) => v.id);
      if (capV.length) versions = capV;
      const species = Number(String(t.named.ndex ?? "").match(/\d{1,4}/)?.[0] ?? NaN);
      if (!Number.isInteger(species)) return;
      // The box's own text: from its heading (or the previous box under it) to the box; else its sections' own text.
      const segStart = chain.length ? chain[chain.length - 1].end : 0;
      const prev = boxes.slice(0, bi).filter((b) => b.end <= t.start && b.start >= segStart);
      const pieces = [segStart, ...prev.map((b) => b.end)].map((a, i, arr) => [a, i + 1 < arr.length ? prev[i].start : t.start] as const);
      let said = "";
      for (const [a, b] of pieces) if (proseOf(a, b)) said = proseOf(a, b);
      const term = pieces.map(([a, b]) => termOf(a, b)).filter(Boolean).pop();
      for (let k = chain.length - 2; !said && k >= -1; k--) {
        const from = k >= 0 ? chain[k].end : 0;
        const to = heads.find((h) => h.at >= from)?.at ?? body.length;
        said = proseOf(from, to);
      }
      const lv = parseLevels(plain(t.named.level ?? ""));
      const why = [term, said].filter(Boolean).join(" ").match(UNCATCHABLE)?.[0];
      const sentence = firstSentence(said);
      const plainHeads = names.filter((h) => !gameHeading(h, cfg));
      const cond = [term, sentence || plainHeads.pop()].filter(Boolean).join("; ");
      out.push({ species, name: plain(t.named.pokemon ?? ""), ...(lv ? { levels: lv } : {}), heads: names, ...(versions ? { versions } : {}), ...(cond ? { cond } : {}), ...(why ? { uncatchable: why } : {}) });
    });
  }
  return out;
}

const ART_DIR = path.resolve(__dirname, "../../../public/sizes/art/256");
const ART_MISSING = new Set(Object.keys((JSON.parse(fs.readFileSync(path.resolve(__dirname, "../art-missing.json"), "utf8")) as { forms: Record<string, number> }).forms));
/** A form the data can carry: a cosmetic one (no art of its own), one with art, or one art-missing.json lists. */
const showable = (form: string, art?: number) => COSMETIC_FORMS.has(form) || ART_MISSING.has(form) || (art !== undefined && fs.existsSync(path.join(ART_DIR, `${art}.webp`)));
/** Forms kept as condition text because they have no art yet (for the build's notes). */
export const formsAsText = new Set<string>();

/** Boxes left out because their text says the Pokémon is only battled (for the crosscheck log). */
export const boxesLeftOut: { place: string; species: number; name: string; levels?: [number, number]; why: string; url: string }[] = [];

/** A Bulbapedia table row -> kind, method and condition, by the game's table layout. */
function kindOf(game: string, h: BulbaRow): { kind: EncounterKind; method: string; cond?: string } | null {
  const note = h.named.note ? plain(h.named.note) : "";
  const div = h.div ?? "";
  if (game === "scarlet-violet") {
    if (h.tpl === "entry9/special") {
      const where = h.method && !/^Fixed$/i.test(h.method) ? h.method : "";
      const cond = [where, h.tera ? `Terastallized (${h.tera} Tera Type)` : "", note].filter(Boolean).join("; ") || undefined;
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
      const formText = h.form ? decode(h.form) : undefined;
      const f0 = formText ? await formFor(h.species, formText) : {};
      // A form with no art yet (and not on scripts/nuzlocke/art-missing.json) stays as text until it has art.
      const f = f0?.form && !showable(f0.form, f0.art) ? null : f0;
      if (f === null && f0?.form) formsAsText.add(`${f0.form} (${f0.art})`);
      const levels = parseLevels(h.levels);
      // A form PokéAPI doesn't list as a Pokémon (a cosmetic one, "Former Titan") stays in the condition.
      const cond = [k.cond ? decode(k.cond) : "", f === null ? formText : "", dlc].filter(Boolean).join("; ") || undefined;
      for (const ver of h.versions.filter((v) => versions.includes(v)))
        out.push({ src: "bulbapedia", ver, place, species: h.species, ...(f?.form ? { form: f.form, art: f.art } : {}), kind: k.kind, method: k.method, ...(levels ? { levels } : {}), ...(cond ? { cond } : {}), url: p.url });
    }
    for (const b of boxRows(p.text, cfg)) {
      if (b.uncatchable) {
        boxesLeftOut.push({ place, species: b.species, name: b.name, ...(b.levels ? { levels: b.levels } : {}), why: b.uncatchable, url: p.url });
        continue;
      }
      const cond = [b.cond, dlc].filter(Boolean).join("; ") || undefined;
      for (const ver of b.versions ?? versions)
        out.push({ src: "bulbapedia", ver, place, species: b.species, kind: "static", method: "Static", ...(b.levels ? { levels: b.levels } : {}), ...(cond ? { cond } : {}), url: p.url });
    }
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
