/**
 * Builds the Nuzlocke Tracker's game data: src/data/nuzlocke/{game}.json (a NuzGame each), plus the reviewable
 * cross-check log scripts/nuzlocke/crosscheck.json.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/nuzlocke/build.ts --game firered-leafgreen
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/nuzlocke/build.ts --all
 *
 * Sources (all cached under $DEX_RAW/nuzlocke, default .cache/dex-raw/nuzlocke):
 *  - encounters: PokéAPI location-areas for the versions it covers (Gens 1-7, Let's Go, Sword/Shield + DLC); Serebii's
 *    species pages for the rest (BD/SP, Legends: Arceus, Scarlet/Violet + DLC, Legends: Z-A) and, for Gens 1-7, as the
 *    cross-check; Bulbapedia's location pages settle every disagreement and supply the walking terrain, starters and
 *    gifts/trades/statics the other two lack; the game's whole Bulbapedia location category is swept, so a building's
 *    page joins its town and a place neither other source names becomes an area (lib/bulba-sweep.ts); the Honey Tree
 *    page is each tree place's page; rows Bulbapedia shows to be wrong are fixed with their evidence (lib/fixes.ts);
 *  - story order and bosses: Bulbapedia's walkthrough for the game.
 */
import fs from "node:fs";
import path from "node:path";
import type { NuzArea, NuzBoss, NuzEncounter, NuzGame, NuzStep } from "../../src/lib/nuzlocke/model";
import { ALIASES, API_ROW_ERRORS, BULBA_PAGES, DATA_ERRORS, NOT_A_PLACE, SEREBII_ERRORS, SUB_RULES, type Alias } from "./lib/aliases";
import { placeKey, slug } from "./lib/areas";
import { bulbaKind, bulbaPages, TERRAIN, type BulbaLoc } from "./lib/bulba-loc";
import type { BulbaRow } from "./lib/bulba-catch";
import { pages, pageUrl, plain } from "./lib/bulbapedia";
import { catchRows } from "./lib/bulba-catch";
import { areaPages, areaRows, availability, boxesLeftOut, confirmed, dlcLabels, eventMons, formsAsText, partners, showable, TREATS_URL } from "./lib/bulba-primary";
import { categorySweep } from "./lib/bulba-sweep";
import { mergeStoryBosses, storyBosses } from "./lib/story-bosses";
import { AMBUSH, AREA_AFTER, BATTLE_ONLY_FORMS, BOSS_BEFORE, NOTE_REWRITE, NOTES, ROW_FIXES, SPREAD, STATICS } from "./lib/fixes";
import { GAMES, GAME_BY_ID, type GameCfg } from "./lib/config";
import { STATS } from "./lib/fetch";
import { pokeapiRows, type ConditionFix } from "./lib/pokeapi-rows";
import { parseLevels, parseRate, type Row } from "./lib/rows";
import { locRows } from "./lib/serebii";
import { serebiiToRows } from "./lib/serebii-rows";
import { noteRow, serebiiGameRows } from "./lib/serebii8";
import { summaryBosses, type SummaryBosses } from "./lib/summary-bosses";
import { walkthrough, type Walkthrough, type WtEvent, type WtParty } from "./lib/walkthrough";
import { BOSSES } from "./lib/bosses";
import { addVec, famOf, sameVec, slotNames, vecBulba, vecOurs } from "./lib/rates";
import { formFor, isLegendary, type FormHit } from "./lib/forms";

const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "src/data/nuzlocke");
const CROSSCHECK = path.join(ROOT, "scripts/nuzlocke/crosscheck.json");
const REPORT_DIR = process.env.NUZ_REPORT_DIR ?? path.join(ROOT, ".cache/nuzlocke-report");
const pokedex = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/pokedex.json"), "utf8")) as { id: number; name: string }[];
const speciesName = (id: number) => pokedex.find((p) => p.id === id)?.name ?? `#${id}`;

/* ------------------------------------------------------------------------------------------------ cross-check log -- */

export interface Disagreement {
  area: string;
  version: string;
  species: number;
  name: string;
  /** Which source lists it in this area and version. */
  pokeapi: boolean;
  serebii: boolean;
  /** Bulbapedia's table for the game at this place: "yes" (with the row), "no", or "no page". */
  bulbapedia: "yes" | "no" | "no page";
  bulbapediaRow?: string;
  /** keep / drop (a PokéAPI row), add / skip (a Serebii-only row), unresolved (no Bulbapedia table: PokéAPI stands). */
  resolution: "keep" | "drop" | "add" | "skip" | "unresolved";
  source: string;
}

/** A final wild row checked against Bulbapedia's table when PokéAPI and Serebii didn't disagree about it. */
export interface Audit {
  area: string;
  version: string;
  species: number;
  name: string;
  /** The sources that list it. */
  sources: string[];
  /** "unavailable": Bulbapedia lists it with no version of this game (e.g. an unreleased event table); "not listed": its table doesn't have it. */
  bulbapedia: "unavailable" | "not listed";
  action: "drop" | "keep";
  source: string;
}

/** A rate difference: PokéAPI's chances for a Pokémon and method in a place vs Bulbapedia's and Serebii's (summed over parts, per time slot). */
export interface RateCheck {
  area: string;
  version: string;
  species: number;
  name: string;
  method: string;
  /** Per part (floor, area…) of the place, the chances by time slot. */
  pokeapi?: number[][];
  bulbapedia?: number[][];
  serebii?: number[][];
  /** replace: PokéAPI's rows give way to Serebii's, which match Bulbapedia; add: the method is missing from PokéAPI, Serebii's rows match Bulbapedia; add-bulbapedia: only Bulbapedia has it, its rows are used; keep: no two sources agree on another value, PokéAPI stands. */
  action: "replace" | "add" | "add-bulbapedia" | "keep";
  source: string;
}

/* ------------------------------------------------------------------------------------------------------- areas -- */

interface Acc {
  key: string;
  /** Candidate names by source, first seen first. */
  names: { src: Row["src"] | "alias"; name: string }[];
  rows: Row[];
  /** The name as spelled in the end (one spelling per game, straight apostrophes). */
  nameFix?: string;
}

const REGION_NAMES = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola"];
const SEREBII_URL: Record<string, string> = {
  lgpe: "https://www.serebii.net/pokedex-sm/location/",
  swsh: "https://www.serebii.net/pokedex-swsh/",
  bdsp: "https://www.serebii.net/pokedex-swsh/",
  la: "https://www.serebii.net/pokedex-swsh/",
  sv: "https://www.serebii.net/pokedex-sv/",
  // Serebii's Legends: Z-A Pokédex is the same Gen IX Pokédex (its menu's "-Legends: Z-A Pokédex" links to /pokedex-sv/,
  // whose pages give the Legends: Z-A locations; there is no /pokedex-za/).
  za: "https://www.serebii.net/pokedex-sv/",
};

function aliasOf(game: string, place: string, sub?: string): Alias | undefined {
  const al = ALIASES[game] ?? {};
  const hit = (sub ? al[placeKey(`${place} ${sub}`)] : undefined) ?? al[placeKey(place)];
  if (hit) return hit;
  // Serebii lists roamers under the region's name; PokéAPI under "Roaming <Region>".
  if (REGION_NAMES.includes(place)) return { area: `Roaming ${place}`, why: "roaming Pokémon" };
  return undefined;
}

/* ----------------------------------------------------------------------------------------------------- helpers -- */

/** The area a walkthrough heading names: "Route 2 (West)", "One Island (Town)" and "Route 4" all name their place. */
function keyOfHead(name: string, keys: { has(k: string): boolean }, game?: string): string | undefined {
  const tries = [name, name.replace(/\s*\([^)]*\)\s*$/, ""), name.replace(/^(VS|Battle|Exploring) /i, "")];
  for (const t of tries) {
    const k = placeKey(t);
    if (keys.has(k)) return k;
    const al = game ? ALIASES[game]?.[k] : undefined;
    if (al && !al.sub && !al.rowsOnly && keys.has(placeKey(al.area))) return placeKey(al.area);
  }
  return undefined;
}

const WILD_METHOD_FAMILY = (m: string) => {
  if (/Rod|Fishing/.test(m)) return "fish";
  if (/^Surf/.test(m)) return "surf";
  if (/Headbutt/.test(m)) return "headbutt";
  if (/Rock Smash/.test(m)) return "rocksmash";
  return "walk";
};
const BULBA_FAMILY = (m: string) => {
  const s = m.toLowerCase();
  if (/^fish|rod/.test(s)) return "fish";
  if (/^surf|^water$/.test(s)) return "surf";
  if (/headbutt/.test(s)) return "headbutt";
  if (/rock smash/.test(s)) return "rocksmash";
  return "walk";
};

/** Bulbapedia rows of this game for an area, version and species. */
function bulbaHits(locs: BulbaLoc[] | undefined, ver: string, species: number): BulbaRow[] {
  return (locs ?? []).flatMap((l) => l.rows.filter((r) => r.versions.includes(ver) && r.species === species));
}
const rowText = (r: BulbaRow) => [r.method, r.levels && `Lv. ${r.levels}`, r.rate, r.div].filter(Boolean).join(", ");

/* ------------------------------------------------------------------------------------------------------- build -- */

interface VisibleCheck {
  area: string;
  version: string;
  species: number;
  name: string;
  section: string;
  method: string;
  levels?: string;
  action: "add" | "duplicate";
  matches?: string;
  source: string;
}

interface FixLog {
  area: string;
  version?: string;
  species?: number;
  name?: string;
  method?: string;
  from?: string;
  action: string;
  why: string;
  source: string;
}

interface NonWildCheck {
  area: string;
  version: string;
  species: number;
  name: string;
  kind: string;
  sources: string[];
  action: "drop" | "move";
  to: string;
  source: string;
}

/** The part of a row from a PokéAPI sub-area that no Bulbapedia part matched: never shown. */
const UNLABELLED = "(unnamed part)";

/** A PokéAPI sub-area without a name ("Unknown area 53") and the part of Bulbapedia's table it was matched to (or why not). */
interface UnnamedSub {
  area: string;
  sub: string;
  /** Bulbapedia's part name it now carries, or null: the label is dropped and its rows merge with the area's others. */
  part: string | null;
  why: string;
  source: string;
}

interface SweepLog {
  page: string;
  area: string;
  part?: string;
  action: "fold" | "new area";
  how: string;
  source: string;
}

interface SerebiiCheck {
  area: string;
  version: string;
  species: number;
  name: string;
  serebii: string;
  bulbapedia: string;
  action: string;
  source: string;
}

interface Built {
  game: NuzGame;
  disagreements: Disagreement[];
  audit: Audit[];
  rates: RateCheck[];
  serebii: SerebiiCheck[];
  conditionFixes: ConditionFix[];
  visible: VisibleCheck[];
  fixes: FixLog[];
  sweep: SweepLog[];
  nonWild: NonWildCheck[];
  unnamedSubs: UnnamedSub[];
  battleOnly: BattleOnly[];
  coverageLosses: string[];
  report: Record<string, unknown>;
}

/** A Special encounters box left out because its page says the Pokémon is only battled there. */
type BattleOnly = (typeof boxesLeftOut)[number];

async function buildGame(cfg: GameCfg): Promise<Built> {
  const versions = cfg.versions.map((v) => v.id);
  const sources = new Set<string>();
  const notes: string[] = [];
  const accs = new Map<string, Acc>();
  const conditionFixes: ConditionFix[] = [];
  const add = (r: Row) => {
    const al = aliasOf(cfg.id, r.place, r.sub);
    const name = al?.area ?? r.place;
    const key = placeKey(name);
    const row: Row = al ? { ...r, place: al.area, ...(al.sub ? { sub: al.sub } : {}) } : r;
    if (al && !al.sub) delete row.sub;
    const a = accs.get(key) ?? { key, names: [], rows: [] };
    if (al) a.names.push({ src: "alias", name: al.area });
    a.names.push({ src: r.src, name: r.place });
    a.rows.push(row);
    accs.set(key, a);
  };

  // ---- primary + cross-check sources
  let api: Row[] = [];
  let ser: Row[] = [];
  if (cfg.pokeapi) {
    const got = await pokeapiRows(cfg.pokeapi);
    api = got.rows;
    conditionFixes.push(...got.fixes);
    notes.push(...got.skipped.map((s) => `PokéAPI skipped: ${s}`));
    sources.add("https://pokeapi.co/api/v2/location-area/");
  }
  if (cfg.serebiiLoc) {
    ser = serebiiToRows((await locRows(cfg.serebiiLoc)).filter((r) => versions.includes(r.ver)), { alola: cfg.gen === 7 });
    sources.add(`https://www.serebii.net/${{ rby: "pokedex", gs: "pokedex-gs", rs: "pokedex-rs", dp: "pokedex-dp", bw: "pokedex-bw", xy: "pokedex-xy", sm: "pokedex-sm" }[cfg.serebiiLoc]}/location/`);
  }
  // Let's Go and Sword/Shield: Serebii's detail tables are the cross-check of PokéAPI's data.
  if (cfg.serebii && cfg.pokeapi) {
    ser = (await serebiiGameRows(cfg.serebii, versions)).rows;
    sources.add(SEREBII_URL[cfg.serebii]);
  }
  // Scarlet/Violet and the Legends games: Bulbapedia's location tables are the source (lib/bulba-primary.ts). Serebii
  // names the areas; with bulbaPrimary "serebii" its row is added where the Pokémon's own Bulbapedia page confirms
  // that exact area (a region-wide row never maps to one area).
  const bpLog: SerebiiCheck[] = [];
  const battleOnly: BattleOnly[] = [];
  let starterPlaces: string[] = [];
  if (cfg.bulbaPrimary) {
    const wt0 = await walkthrough(cfg.walkthrough, cfg.wtMentions);
    const got = cfg.serebii ? await serebiiGameRows(cfg.serebii, versions) : { rows: [], notes: [] };
    const serRows: Row[] = got.rows.filter((r) => !NOT_A_PLACE.has(placeKey(r.place)));
    for (const n of got.notes) {
      const r = await noteRow(n);
      if (r && !NOT_A_PLACE.has(placeKey(r.place))) serRows.push(r);
    }
    const areaName = (r: Row) => aliasOf(cfg.id, r.place, r.sub)?.area ?? r.place;
    const firsts = await partners(cfg, wt0, pokedex);
    // Bulbapedia's list of the game's in-game event Pokémon: the levels of its one-time Pokémon and first partners.
    const events = await eventMons(cfg);
    starterPlaces = [...new Set(firsts.map((f) => f.place))];
    const names = new Map<string, string>();
    for (const r of serRows) if (!names.has(placeKey(areaName(r)))) names.set(placeKey(areaName(r)), areaName(r));
    for (const s of firsts) if (!names.has(placeKey(s.place))) names.set(placeKey(s.place), s.place);
    const linkByKey = new Map<string, string[]>();
    for (const [label, title] of wt0.links) {
      const k = placeKey(label);
      if (names.has(k)) linkByKey.set(k, [...new Set([...(linkByKey.get(k) ?? []), title])]);
    }
    const cands = new Map([...names].map(([k, n]) => [k, [...(linkByKey.get(k) ?? []), n, ...cfg.bulbaRegions.flatMap((R) => [`${n} (${R})`, `${R} ${n}`])]]));
    const ap = await areaPages(cands, new Set(cfg.bulba));
    const subPages = await pages([...new Set([...ap.values()].flatMap((p) => p?.subs ?? []))]);
    const confirmAt = new Map<string, Set<string>>();
    const tpl = new Set(cfg.bulba);
    const TYPES = ["Normal", "Fire", "Water", "Grass", "Electric", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"];
    const listTitles = cfg.id === "legends-za" ? TYPES.map((t) => `List of ${t}-type hyperspace wild zones`) : [];
    const listPages = await pages(listTitles);
    const hyperspaceLists = listTitles.flatMap((t) => {
      const x = listPages.get(t);
      return x?.text && x.title ? [{ title: x.title, url: pageUrl(x.title), text: x.text, whole: true }] : [];
    });
    if (cfg.id === "legends-za" && hyperspaceLists.length !== TYPES.length) throw new Error(`legends-za: ${hyperspaceLists.length} of ${TYPES.length} hyperspace wild zone lists found`);
    for (const [k, n] of names) {
      const p = ap.get(k);
      const own = p ? [{ title: p.title, url: p.url, text: p.text }] : [];
      // A sublocation that is an area of its own here (Jubilife Village) is not counted twice.
      const subs = (p?.subs ?? [])
        .filter((t) => !names.has(placeKey(t)) || placeKey(t) === k)
        .flatMap((t) => {
          const x = subPages.get(t);
          return x?.text && x.title ? [{ title: x.title, url: pageUrl(x.title), text: x.text }] : [];
        });
      const ownRows = own.length && catchRows(own[0].text).some((r) => tpl.has(r.tpl));
      // Legends: Z-A's Hyperspace Lumiose: Bulbapedia lists its wild zones' Pokémon on one page per type.
      const lists = cfg.id === "legends-za" && n === "Hyperspace Lumiose" ? hyperspaceLists : [];
      const use = [...(ownRows ? own : [...own, ...subs]), ...lists];
      const dlc = cfg.id === "scarlet-violet" ? ({ Kitakami: "The Teal Mask", Unova: "The Indigo Disk" } as Record<string, string>)[p?.region ?? ""] : lists.length ? "Mega Dimension" : undefined;
      for (const r of await areaRows(cfg, n, use, dlc)) add(r);
      battleOnly.push(...boxesLeftOut.splice(0));
      for (const u of use) if (catchRows(u.text, { whole: "whole" in u && !!u.whole }).some((r) => tpl.has(r.tpl))) sources.add(u.url);
      confirmAt.set(k, new Set([n, ...(p ? [p.title, ...p.subs] : [])]));
    }
    if (formsAsText.size) notes.push(`forms kept as condition text (no art yet): ${[...formsAsText].join(", ")}`);
    formsAsText.clear();
    if (cfg.bulbaPrimary === "serebii") {
      const need = serRows.filter((r) => {
        const a = accs.get(placeKey(areaName(r)));
        return !a?.rows.some((x) => x.ver === r.ver && x.species === r.species);
      });
      const av = await availability(cfg.id, new Map([...new Set(need.map((r) => r.species))].map((sp) => [sp, pokedex.find((p) => p.id === sp)?.name ?? String(sp)])));
      const seen = new Set<string>();
      // The levels of the Terastallized Pokémon on the area tables, by species and Tera Type: a Serebii row the
      // Pokémon's page gives as that Tera Type takes them (the area table and the Pokémon's page can name neighbouring areas).
      const teraLevels = new Map<string, [number, number]>();
      for (const a of accs.values())
        for (const x of a.rows) {
          const t = /Terastallized \((\w+) Tera Type\)/.exec(x.cond ?? "")?.[1];
          if (t && x.levels) teraLevels.set(`${x.species}|${t}`, x.levels);
        }

      for (const r of need) {
        const k = placeKey(areaName(r));
        const others = new Set([...confirmAt].filter(([kk]) => kk !== k).flatMap(([, t]) => [...t]));
        const c = confirmed(av.get(r.species), r.ver, confirmAt.get(k) ?? new Set([areaName(r)]), others);
        const id = `${k}|${r.ver}|${r.species}`;
        if (!seen.has(id)) {
          seen.add(id);
          bpLog.push({ area: areaName(r), version: r.ver, species: r.species, name: speciesName(r.species), serebii: r.method, bulbapedia: c.ok ? `the Pokémon's page names it there${c.once ? " (Only one)" : ""}` : "neither the place's table nor the Pokémon's page has it there", action: c.ok ? "add" : "skip", source: c.url ?? ap.get(k)?.url ?? "" });
        }
        if (!c.ok) continue;
        // The entry's DLC label ("Mega Dimension"), and what it says of the place ("after concluding Side Mission 160") when
        // Serebii's row has no condition of its own, as the condition.
        // (Not when the row already names a DLC: "The Teal Mask" says more than "The Hidden Treasure of Area Zero".)
        const isDlc = (x: string) => !!x && !cfg.versions.some((v) => v.name === x);
        const dlcLabel = c.label && isDlc(c.label) && !dlcLabels(cfg.id).some((d) => r.cond?.includes(d)) ? c.label : undefined;
        const note = c.note ?? "";
        // What the Pokémon's page says of the place decides the row: "Only one" -> a one-time encounter (its level from
        // Bulbapedia's in-game event list, where it is met there); "Electric Tera Type" -> a fixed Terastallized
        // Pokémon, as the area tables write it (and with their level for it); a form ("Alolan Form") -> that form;
        // anything else Serebii calls "Static" is an ordinary spawn there.
        const formHit = note && /\b(?:Form|Forme|Breed|Style|Flower|Pattern|Plumage|Cloak|Striped|Sea)$/.test(note) && !r.form ? await formFor(r.species, note) : null;
        const form = formHit?.form && showable(formHit.form, formHit.art) ? formHit : undefined;
        const tera = /^(\w+) Tera Type$/.exec(note)?.[1];
        let kind = r.kind;
        let method = r.method;
        let levels = r.levels;
        const extra: string[] = [];
        if (c.once) {
          kind = "static";
          method = "Static";
          const ev = events.get(r.species)?.find((e) => [areaName(r), c.place].some((x) => !!x && placeKey(x) === placeKey(e.met)));
          if (ev && !levels) {
            levels = [ev.level, ev.level];
            sources.add(ev.url);
          }
        } else if (tera) {
          kind = "wild";
          method = "Fixed";
          extra.push(`Terastallized (${tera} Tera Type)`);
          levels ??= teraLevels.get(`${r.species}|${tera}`);
        } else if (r.kind === "static") {
          kind = "wild";
          method = "Wild";
        }
        const other = !form && !tera && !r.cond ? note : undefined;
        const cond = [...new Set([r.cond, dlcLabel, ...extra, other].filter((x): x is string => !!x))].join("; ") || undefined;
        const { cond: _c, levels: _l, ...base } = r;
        void _c;
        void _l;
        add({ ...base, kind, method, ...(levels ? { levels } : {}), ...(form?.form ? { form: form.form, art: form.art } : {}), ...(cond ? { cond } : {}) });
        if (c.url) sources.add(c.url);
      }
      notes.push(`Serebii rows not on Bulbapedia's table: ${bpLog.filter((x) => x.action === "add").length} added (the Pokémon's page names the place), ${bpLog.filter((x) => x.action === "skip").length} left out`);
    }
    for (const s of firsts) {
      // The place's table may give the same gift (Cabo Poco's "Gift" rows): one row, the starter's, with its level.
      const a = accs.get(placeKey(aliasOf(cfg.id, s.place)?.area ?? s.place));
      const table = a?.rows.filter((r) => r.species === s.species && r.kind === "gift" && r.method === "Gift") ?? [];
      // Else the event list's level (its one entry for the species: "Lumiose first partner Pokémon: Chikorita Lv. 5").
      const ev = events.get(s.species);
      const levels = table.find((r) => r.levels)?.levels ?? (ev?.length === 1 ? ([ev[0].level, ev[0].level] as [number, number]) : undefined);
      if (!table.length && ev?.length === 1) sources.add(ev[0].url);
      if (a && table.length) a.rows = a.rows.filter((r) => !table.includes(r));
      for (const ver of versions) add({ src: "bulbapedia", ver, place: s.place, ...(s.sub ? { sub: s.sub } : {}), species: s.species, kind: "gift", method: "Starter", ...(levels ? { levels } : {}), url: s.url });
      sources.add(s.url);
    }
    if (cfg.id === "scarlet-violet") sources.add(TREATS_URL);
    if (firsts.length) notes.push(`starters (first partners in the walkthrough, placed by their Bulbapedia pages): ${firsts.map((s) => `${speciesName(s.species)} at ${s.place}${s.sub ? ` (${s.sub})` : ""}`).join(", ")}`);
    sources.add(wt0.url);
    if (cfg.serebii && cfg.bulbaPrimary === "serebii") sources.add(SEREBII_URL[cfg.serebii]);
  }
  // BD/SP: Serebii is the source (PokéAPI has no encounters for it).
  if (cfg.serebii && !cfg.pokeapi && !cfg.bulbaPrimary) {
    const got = await serebiiGameRows(cfg.serebii, versions);
    const errs = SEREBII_ERRORS[cfg.id] ?? [];
    for (const r of got.rows) {
      const err = errs.find(([place, sp]) => place === placeKey(r.place) && sp === r.species);
      if (err) {
        const n = `Serebii data error skipped: ${speciesName(r.species)} at ${r.place} (${err[2]})`;
        if (!notes.includes(n)) notes.push(n);
        continue;
      }
      if (!NOT_A_PLACE.has(placeKey(r.place))) add(r);
    }
    for (const n of got.notes) {
      const r = await noteRow(n);
      if (r && !NOT_A_PLACE.has(placeKey(r.place))) add(r);
    }
    sources.add(SEREBII_URL[cfg.serebii]);
  }
  // ---- source rows Bulbapedia shows to be wrong (lib/fixes.ts): dropped or corrected before they enter
  const fixesLog: FixLog[] = [];
  const rowFixes = ROW_FIXES.filter((f) => f.games.includes(cfg.id));
  const applyFixes = (rows: Row[]): Row[] =>
    rows.filter((r) => {
      const f = rowFixes.find((x) => x.area === placeKey(r.place) && x.method.test(r.method) && (!x.species || x.species.includes(r.species)));
      if (!f) return true;
      fixesLog.push({ area: r.place, version: r.ver, species: r.species, name: speciesName(r.species), method: r.method, from: r.src, action: f.drop ? "drop" : `levels ${f.levels!.join("-")}${r.levels ? ` (was ${r.levels.join("-")})` : ""}`, why: f.why, source: f.source });
      if (f.drop) return false;
      if (f.levels) r.levels = f.levels;
      return true;
    });
  api = applyFixes(api);
  ser = applyFixes(ser);
  const spreads = SPREAD.filter((x) => x.game === cfg.id);
  const spreadRows = api.filter((r) => spreads.some((x) => x.from === placeKey(r.place)));
  api = api.filter((r) => !spreadRows.includes(r));
  const bad = DATA_ERRORS[cfg.id] ?? {};
  const badRows = API_ROW_ERRORS[cfg.id] ?? [];
  api = api.filter((r) => {
    const why = bad[placeKey(r.place)] ?? badRows.find(([pl, sp]) => pl === placeKey(r.place) && sp === r.species)?.[2];
    const n = `PokéAPI data error skipped: ${bad[placeKey(r.place)] ? r.place : `${speciesName(r.species)} at ${r.place}`} (${why})`;
    if (why && !notes.includes(n)) notes.push(n);
    return !why;
  });
  for (const r of api) add(r);
  // Serebii and Bulbapedia name species, not forms: a row they add takes the form PokéAPI has for that species in that
  // place, else the only form PokéAPI has for it anywhere in the game (Alola's Rattata are all Alolan), else none.
  const formsBy = (rows: Row[], species: number) => new Map(rows.filter((r) => r.src === "pokeapi" && r.species === species).map((r) => [r.form ?? "", { form: r.form, art: r.art }]));
  const withForm = (r: Row, areaKey: string): Row => {
    if (r.form) return r;
    let f = formsBy(accs.get(areaKey)?.rows ?? [], r.species);
    if (f.size !== 1) f = formsBy(api, r.species);
    const only = f.size === 1 ? [...f.values()][0] : undefined;
    return only?.form ? { ...r, form: only.form, art: only.art } : r;
  };
  // Serebii rows are kept aside: they only enter through the cross-check below (or where PokéAPI has no such area).
  // Serebii glues some parts to the place's name ("Lost Tower5F", "Route 210South"): a PokéAPI place's name followed by
  // a capital or a digit is that place and part.
  const apiNames = [...new Set(api.map((r) => r.place))].sort((a, b) => b.length - a.length);
  for (const r of ser) {
    if (accs.has(placeKey(r.place)) || aliasOf(cfg.id, r.place, r.sub)) continue;
    const p = apiNames.find((n) => r.place.length > n.length && r.place.startsWith(n) && /^[A-Z0-9]/.test(r.place.slice(n.length)) && !(/\d$/.test(n) && /^\d/.test(r.place.slice(n.length))));
    if (p) {
      const part = r.place.slice(p.length).trim();
      r.sub = r.sub ? `${part} ${r.sub}` : part;
      r.place = p;
    }
  }
  const serByArea = new Map<string, Row[]>();
  for (const r of ser) {
    if (NOT_A_PLACE.has(placeKey(r.place))) continue;
    const al = aliasOf(cfg.id, r.place, r.sub);
    const name = al?.area ?? r.place;
    const key = placeKey(name);
    const row: Row = al ? { ...r, place: al.area, ...(al.sub ? { sub: al.sub } : {}) } : r;
    if (al && !al.sub) delete row.sub;
    if (!serByArea.has(key)) serByArea.set(key, []);
    serByArea.get(key)!.push(row);
  }

  // ---- walkthrough (its links find Bulbapedia's location pages)
  const wt = await walkthrough(cfg.walkthrough, cfg.wtMentions);
  // The starters' place is reached where the walkthrough gives the first partner (Legends: Z-A's Vert District, which
  // no heading names): placed at that section.
  if (starterPlaces.length) {
    const at = wt.events.find((e) => e.type === "head" && /^(First partner Pokémon|A little help from the Professor)$/.test(e.name));
    if (at) {
      for (const place of starterPlaces) wt.events.push({ type: "head", lvl: 9, name: place, linked: [], path: [], part: at.part, at: at.at + 1 });
      wt.events.sort((a, b) => a.part - b.part || a.at - b.at);
    }
  }
  sources.add(wt.url);

  // ---- Bulbapedia location pages for every place either source names
  const names = new Map<string, string>();
  for (const [k, a] of accs) names.set(k, a.names[0].name);
  for (const [k, rs] of serByArea) if (!names.has(k)) names.set(k, rs[0].place);
  const bulba = await bulbaPages(names, { templates: cfg.bulba, regions: cfg.bulbaRegions, links: wt.links, extra: BULBA_PAGES[cfg.id] });
  for (const locs of bulba.values()) for (const l of locs) sources.add(l.url);

  // ---- the game's other Bulbapedia location pages (its category): a building's or part's page joins its area's pages
  // (its gifts, trades and statics, and its wild rows, come in through the steps below like the area's own page's); a
  // place no source names becomes an area of its own, its rows from its page (Dewford Town in Omega Ruby/Alpha
  // Sapphire, Hearthome City in Brilliant Diamond/Shining Pearl).
  const sweepLog: SweepLog[] = [];
  const pageSub = new Map<string, string>();
  const pageSubByUrl = new Map<string, string>();
  /** Areas only Bulbapedia names: built whole from their pages here, left alone by the steps that add Bulbapedia rows. */
  const newAreas = new Set<string>();
  if (!cfg.bulbaPrimary) {
    const usedTitles = new Set([...bulba.values()].flat().map((l) => l.title));
    for (const sp of await categorySweep(cfg, usedTitles, names)) {
      const key = sp.into ?? placeKey(sp.name);
      if (!sp.into) {
        if (accs.has(key) || names.has(key)) throw new Error(`${cfg.id}: swept page ${sp.title} is a new place but ${sp.name} exists`);
        accs.set(key, { key, names: [{ src: "bulbapedia", name: sp.name }], rows: [] });
        names.set(key, sp.name);
        newAreas.add(key);
      }
      const loc: BulbaLoc = { title: sp.title, url: sp.url, rows: sp.rows, boxes: sp.boxes };
      bulba.set(key, [...(bulba.get(key) ?? []), loc]);
      if (sp.sub) {
        pageSub.set(sp.title, sp.sub);
        pageSubByUrl.set(sp.url, sp.sub);
      }
      if (newAreas.has(key)) accs.get(key)!.rows.push(...(await rowsOfPage(cfg, loc, names.get(key)!, sp.sub)));
      sources.add(sp.url);
      sweepLog.push({ page: sp.title, area: names.get(key)!, ...(sp.sub ? { part: sp.sub } : {}), action: sp.into ? "fold" : "new area", how: sp.how, source: sp.url });
    }
  }

  // ---- Honey Trees (Diamond/Pearl/Platinum, Brilliant Diamond/Shining Pearl): one table for every tree, on
  // Bulbapedia's Honey Tree page, whose Locations table names the 21 trees; the places' own pages leave them out. That
  // page is one of each such place's pages (so PokéAPI's honey rows there are checked against it, not dropped).
  if (/^(diamond-pearl|platinum|brilliant-diamond-shining-pearl)$/.test(cfg.id)) {
    const hp = (await pages(["Honey Tree"])).get("Honey Tree");
    const text = hp?.text ?? "";
    const locs = /===\s*Locations\s*===([\s\S]*?)\n===/.exec(text)?.[1] ?? "";
    const places = [...locs.matchAll(/\{\{rt\|(\d+)\|Sinnoh\}\}|\[\[([^|\]]+)\]\]/g)].map((m) => (m[1] ? `Route ${m[1]}` : m[2]));
    if (places.length < 18 || !hp?.title) throw new Error(`${cfg.id}: Bulbapedia's Honey Tree page lists ${places.length} tree places`);
    const tpl = new Set(cfg.bulba);
    const loc: BulbaLoc = { title: hp.title, url: pageUrl(hp.title), rows: catchRows(text).filter((r) => tpl.has(r.tpl) && r.species > 0), boxes: [] };
    for (const pl of new Set(places)) {
      const k = placeKey(pl);
      if (!names.has(k)) continue;
      bulba.set(k, [...(bulba.get(k) ?? []), loc]);
    }
    sources.add(loc.url);
  }

  // ---- water Bulbapedia's table notes can't be reached ("The water is inaccessible without glitches": Gold, Silver
  // and Crystal's Route 14, National Park): its rows are no encounters. Ours for that Pokémon, version and water
  // method there go, and those table rows are left out of every later step.
  for (const [key, locs] of bulba)
    for (const l of locs) {
      const blocked = l.rows.filter((h) => h.inaccessible);
      if (!blocked.length) continue;
      const a = accs.get(key);
      const ser = serByArea.get(key) ?? [];
      for (const h of blocked)
        for (const ver of h.versions.filter((v) => versions.includes(v))) {
          const fam = famOf(h.method);
          const hit = (r: Row) => r.ver === ver && r.species === h.species && r.kind === "wild" && famOf(r.method) === fam;
          const why = "Bulbapedia's table notes that this water can't be reached (\"The water is inaccessible without glitches\" / \"without the use of a cheating device\"), so its rows are no encounters";
          const ours = [...(a?.rows ?? []), ...ser].filter(hit);
          for (const r of ours) fixesLog.push({ area: names.get(key)!, version: ver, species: r.species, name: speciesName(r.species), method: r.method, from: r.src, action: "drop", why, source: l.url });
          if (!ours.length) fixesLog.push({ area: names.get(key)!, version: ver, species: h.species, name: speciesName(h.species), method: h.method, from: "bulbapedia", action: "left out", why, source: l.url });
          if (a) a.rows = a.rows.filter((r) => !hit(r));
          serByArea.set(key, (serByArea.get(key) ?? []).filter((r) => !hit(r)));
        }
      l.rows = l.rows.filter((h) => !h.inaccessible);
    }

  // ---- rows a source files under a place of its own that are met at several places (lib/fixes.ts SPREAD: Sword/Shield's
  // Regina): each area whose Bulbapedia page lists them gets them
  for (const sp of spreads) {
    const rows = spreadRows.filter((r) => placeKey(r.place) === sp.from);
    const titles = [...bulba.values()].flat().map((l) => l.title);
    const texts = await pages(titles);
    let n = 0;
    for (const [key, locs] of bulba) {
      const l = locs.find((x) => sp.section.test(texts.get(x.title)?.text ?? ""));
      if (!l) continue;
      n++;
      for (const r of rows) add({ ...r, place: names.get(key)!, sub: undefined, cond: [r.cond, sp.cond].filter(Boolean).join("; "), url: r.url });
      for (const r of rows.filter((x, i) => rows.findIndex((y) => y.species === x.species) === i)) fixesLog.push({ area: names.get(key)!, species: r.species, name: speciesName(r.species), method: r.method, from: r.src, action: `copied from ${rows[0]?.place}`, why: sp.why, source: l.url });
    }
    if (rows.length && !n) throw new Error(`${cfg.id}: no area's Bulbapedia page has the section for ${sp.from}`);
  }

  // ---- Brilliant Diamond/Shining Pearl: Serebii (the source) and Bulbapedia give different rod chances throughout
  // (Serebii's fit slot weights 60/30/5/4/1, Bulbapedia's Diamond/Pearl's 40/40/15/4/1, and its Fishing page is marked
  // incomplete for these games); neither cites a datamine, so a rod row whose chance Bulbapedia's table doesn't share has
  // none. The Poké Radar rows take Bulbapedia's chance and levels where it has one row for that Pokémon (Route 221's
  // Nidorina and Nidorino: Serebii's levels 22 and 29-30 are not the route's).
  if (cfg.id === "brilliant-diamond-shining-pearl")
    for (const a of accs.values()) {
      const hs = (bulba.get(a.key) ?? []).flatMap((l) => l.rows.map((h) => ({ h, url: l.url })));
      for (const r of a.rows) {
        const fam = famOf(r.method);
        if (r.kind === "wild" && /rod$/.test(fam ?? "") && r.rate !== undefined) {
          const b = hs.filter(({ h }) => h.species === r.species && h.versions.includes(r.ver) && famOf(h.method) === fam && !bulbaKind(h.method, h.tpl, h.div));
          if (!b.length || b.some(({ h }) => parseRate(h.rate) === r.rate)) continue;
          fixesLog.push({ area: a.names[0].name, version: r.ver, species: r.species, name: speciesName(r.species), method: r.method, from: r.src, action: `no chance (Serebii ${r.rate}%, Bulbapedia ${b.map(({ h }) => h.rate).join(" / ")})`, why: "Serebii's and Bulbapedia's rod chances disagree and neither cites a datamine (Bulbapedia's Fishing page is marked incomplete for Brilliant Diamond and Shining Pearl): no chance is shown rather than a wrong one", source: b[0].url });
          delete r.rate;
        }
        if (r.kind === "wild" && /^Poké Radar$/i.test(r.method)) {
          const b = hs.filter(({ h }) => h.species === r.species && h.versions.includes(r.ver) && /Poké Radar/i.test(h.method));
          if (b.length !== 1) continue;
          const rate = parseRate(b[0].h.rate);
          const levels = parseLevels(b[0].h.levels);
          if (rate === r.rate && JSON.stringify(levels) === JSON.stringify(r.levels)) continue;
          fixesLog.push({ area: a.names[0].name, version: r.ver, species: r.species, name: speciesName(r.species), method: r.method, from: r.src, action: `Bulbapedia's ${rate ?? "-"}% Lv ${levels?.join("-") ?? "-"} (Serebii ${r.rate ?? "-"}% Lv ${r.levels?.join("-") ?? "-"})`, why: "Bulbapedia's Poké Radar row for this Pokémon here; Serebii's chance and levels don't fit the place", source: b[0].url });
          if (rate !== undefined) r.rate = rate;
          else delete r.rate;
          if (levels) r.levels = levels;
        }
      }
    }

  // ---- Generation VII ambush encounters: PokéAPI's "bubbling-spots" rows take the method Bulbapedia's table gives
  // that Pokémon there when it is an ambush (rustling grass, a flying Pokémon's shadow…); an SOS row "from a bubbling
  // spot" where every such row turned out to be one ambush becomes an SOS row of that ambush (Haina Desert's sand clouds).
  if (cfg.gen === 7 && cfg.pokeapi)
    for (const a of accs.values()) {
      const locs = bulba.get(a.key) ?? [];
      const seen = new Set<string>();
      let realFishing = false;
      for (const r of a.rows) {
        if (r.src !== "pokeapi" || r.method !== "Fishing (bubbling spot)") continue;
        const ms = new Set(locs.flatMap((l) => l.rows).filter((h) => h.species === r.species && h.versions.includes(r.ver)).map((h) => AMBUSH[h.method.toLowerCase()]).filter(Boolean));
        if (ms.size !== 1) {
          realFishing = true;
          continue;
        }
        const to = [...ms][0];
        fixesLog.push({ area: a.names[0].name, version: r.ver, species: r.species, name: speciesName(r.species), method: r.method, from: r.src, action: `method ${to}`, why: "PokéAPI files Generation VII ambush encounters under its bubbling-spots method (fishing); Bulbapedia's table gives this Pokémon here as an ambush", source: locs[0]?.url ?? "" });
        r.method = to;
        seen.add(to);
      }
      if (seen.size === 1 && !realFishing && !locs.some((l) => l.rows.some((h) => /bubbling spot/i.test(h.div ?? ""))))
        for (const r of a.rows) {
          if (r.src !== "pokeapi" || r.method !== "SOS Battle (bubbling spot)") continue;
          const to = `SOS Battle (${[...seen][0].toLowerCase()})`;
          fixesLog.push({ area: a.names[0].name, version: r.ver, species: r.species, name: speciesName(r.species), method: r.method, from: r.src, action: `method ${to}`, why: "an SOS ally PokéAPI files as called from a bubbling spot, in a place whose bubbling-spot rows are all one ambush and where Bulbapedia's table has no fishing at a bubbling spot", source: locs[0]?.url ?? "" });
          r.method = to;
        }
    }

  // ---- coverage of the merged sources (every row is one place, Pokémon, version and water/land), checked at the end:
  // no area may lose one except by a logged decision (a cross-check or audit drop)
  const rawCoverage = new Set<string>();
  for (const a of accs.values()) for (const r of a.rows) for (const k of coverageKeys(a.key, r)) rawCoverage.add(k);
  const droppedOnPurpose = new Set<string>();
  const visibleLog: VisibleCheck[] = [];

  // ---- cross-check PokéAPI vs Serebii, settled by Bulbapedia
  const disagreements: Disagreement[] = [];
  const dropped = new Set<Row>();
  const comparable = (r: Row) => r.kind === "wild" && !/slot 2|radio/i.test(r.cond ?? "");
  for (const [key, srows] of serByArea) {
    const a = accs.get(key);
    const apiRows = a?.rows.filter((r) => r.src === "pokeapi") ?? [];
    if (!apiRows.length) {
      // A place only Serebii has: its rows fill the gap (checked against Bulbapedia below like any Serebii row).
      for (const r of srows) add(withForm(r, key));
      if (srows.length) notes.push(`Serebii-only place: ${srows[0].place} (${new Set(srows.map((r) => r.species)).size} species)`);
      continue;
    }
    for (const ver of versions) {
      const P = new Set(apiRows.filter((r) => r.ver === ver && comparable(r)).map((r) => r.species));
      const S = new Set(srows.filter((r) => r.ver === ver && comparable(r)).map((r) => r.species));
      if (!P.size && !S.size) continue;
      for (const sp of new Set([...P, ...S])) {
        if (P.has(sp) === S.has(sp)) continue;
        const locs = bulba.get(key);
        const hits = bulbaHits(locs, ver, sp).filter((h) => !bulbaKind(h.method, h.tpl, h.div));
        const b: Disagreement["bulbapedia"] = !locs?.length ? "no page" : hits.length ? "yes" : "no";
        let resolution: Disagreement["resolution"];
        if (P.has(sp)) resolution = b === "yes" ? "keep" : b === "no" ? "drop" : "unresolved";
        else resolution = b === "yes" ? "add" : b === "no" ? "skip" : "unresolved";
        disagreements.push({
          area: names.get(key)!,
          version: ver,
          species: sp,
          name: speciesName(sp),
          pokeapi: P.has(sp),
          serebii: S.has(sp),
          bulbapedia: b,
          ...(hits.length ? { bulbapediaRow: hits.map(rowText).join(" | ") } : {}),
          resolution,
          source: locs?.[0]?.url ?? "",
        });
        if (resolution === "drop")
          for (const r of apiRows)
            if (r.ver === ver && r.species === sp && comparable(r)) {
              dropped.add(r);
              for (const k of coverageKeys(key, r)) droppedOnPurpose.add(k);
            }
        if (resolution === "add") for (const r of srows) if (r.ver === ver && r.species === sp && comparable(r)) add(withForm(r, key));
      }
    }
  }
  for (const a of accs.values()) a.rows = a.rows.filter((r) => !dropped.has(r));

  // ---- Let's Go: PokéAPI's rows have no chances (every one is 100) and its own method names ("Overworld (sky)"); for
  // each Pokémon both sources list (after the cross-check), Serebii's detail rows stand in, with their methods, chances
  // and levels. A Pokémon only PokéAPI (and Bulbapedia) lists keeps PokéAPI's row, without the chance.
  if (cfg.serebiiRows) {
    for (const [key, srows] of serByArea) {
      const a = accs.get(key);
      if (!a) continue;
      for (const ver of versions) {
        const S = new Set(srows.filter((r) => r.ver === ver && r.kind === "wild").map((r) => r.species));
        const gone = new Set(a.rows.filter((r) => r.src === "pokeapi" && r.ver === ver && r.kind === "wild" && S.has(r.species)).map((r) => r.species));
        if (!gone.size) continue;
        const already = new Set(a.rows.filter((r) => r.src === "serebii" && r.ver === ver).map((r) => r.species));
        // A condition PokéAPI gives a Pokémon there (one for all its rows) that Serebii doesn't: kept on Serebii's rows.
        const pcond = new Map<number, string>();
        for (const sp of gone) {
          const cs = [...new Set(a.rows.filter((r) => r.src === "pokeapi" && r.ver === ver && r.kind === "wild" && r.species === sp).map((r) => r.cond ?? ""))];
          if (cs.length === 1 && cs[0]) pcond.set(sp, cs[0]);
        }
        a.rows = a.rows.filter((r) => !(r.src === "pokeapi" && r.ver === ver && r.kind === "wild" && gone.has(r.species)));
        for (const r of srows)
          if (r.ver === ver && r.kind === "wild" && gone.has(r.species) && !already.has(r.species)) {
            const c = pcond.get(r.species);
            add(withForm(c && !(r.cond ?? "").includes(c) ? { ...r, cond: [c, r.cond].filter(Boolean).join("; ") } : r, key));
          }
      }
    }
    // PokéAPI's own rows left (a Pokémon only it and Bulbapedia list there): no chance, and Serebii's method words.
    const LG: Record<string, [string, string?]> = { Overworld: ["Walking"], "Overworld (rare spawn)": ["Walking", "Rare Spawns"], "Overworld (water)": ["Water"], "Overworld (water, rare spawn)": ["Water", "Rare Spawns"], "Overworld (sky)": ["In the Sky"], "Overworld (sky, rare spawn)": ["In the Sky", "Rare Spawns"] };
    for (const a of accs.values())
      for (const r of a.rows) {
        if (r.src !== "pokeapi") continue;
        delete r.rate;
        const to = LG[r.method];
        if (!to) continue;
        r.method = to[0];
        if (to[1]) r.cond = [r.cond, to[1]].filter(Boolean).join("; ");
      }
    // The sky: Bulbapedia's tables head its rows "While riding a Flying Pokémon / After becoming Champion" (a post-game
    // encounter); Serebii's "In the Sky" rows take that as their condition.
    for (const a of accs.values()) {
      const head = bulba.get(a.key)?.flatMap((l) => l.rows).find((h) => /^Sky$/i.test(h.method) && /^While riding/i.test(h.div ?? ""))?.div;
      if (!head) continue;
      const cond = head.replace(/\s+(After becoming)/, "; $1").replace(/; After/, "; after");
      for (const r of a.rows) if (/^In the Sky/.test(r.method)) r.cond = [cond, r.cond].filter(Boolean).join("; ");
    }
  }

  // ---- Bulbapedia's form labels ("Alolan Form", "Midnight Form") as PokéAPI forms
  const bulbaForms = new Map<string, FormHit | null>();
  for (const locs of bulba.values())
    for (const l of locs)
      for (const h of l.rows) if (h.form && !bulbaForms.has(`${h.species}|${h.form}`)) bulbaForms.set(`${h.species}|${h.form}`, await formFor(h.species, h.form));
  const formOfBulba = (h: BulbaRow): FormHit => (h.form ? (bulbaForms.get(`${h.species}|${h.form}`) ?? {}) : {});

  // ---- rates: PokéAPI's chances per Pokémon and method checked against Bulbapedia's; Serebii settles a difference.
  // Compared as the set of chance vectors of its table slots (one per part and level range, its time slots summed),
  // so sources that split a place into parts differently (one table for "2F-3F" vs one per floor) still compare equal.
  const rateChecks: RateCheck[] = [];
  const slots = slotNames(cfg.id);
  const nSlots = Math.max(1, slots.length);
  const specialDiv = /swarm|radar|slot|radio|insert|outbreak|special|contest|hoenn|sinnoh|sound|safari|block|daily|grotto|horde|ambush|sos|ally|island scan|bubbl|rustling|shadow|dust|rippl|shaking|flower|rough|berry/i;
  const notPart = /^(surfing|surf|fishing|fish|old rod|good rod|super rod|headbutt|rock smash|grass|tall grass|cave|water|land)$/i;
  for (const a of accs.values()) {
    const locs = bulba.get(a.key);
    const srows = serByArea.get(a.key) ?? [];
    if (!locs?.length || !cfg.pokeapi || cfg.serebiiRows || newAreas.has(a.key)) continue;
    for (const ver of versions) {
      // key "species|family" -> part -> summed slot vector
      const P = new Map<string, Map<string, number[]>>();
      const B = new Map<string, Map<string, number[]>>();
      const S = new Map<string, Map<string, number[]>>();
      const put = (m: Map<string, Map<string, number[]>>, key: string, part: string, v: number[]) => {
        if (!m.has(key)) m.set(key, new Map());
        addVec(m.get(key)!, part, v);
      };
      const pRows = a.rows.filter((r) => r.src === "pokeapi" && r.ver === ver && r.kind === "wild");
      for (const r of pRows) {
        const v = vecOurs(r, slots);
        const f = famOf(r.method);
        if (v && f) put(P, `${r.species}|${f}`, `${r.sub ?? ""}|${r.levels}`, v);
      }
      for (const h of locs.flatMap((l) => l.rows)) {
        if (!h.versions.includes(ver) || bulbaKind(h.method, h.tpl, h.div)) continue;
        const f = famOf(h.method);
        if (!f || specialDiv.test(h.div ?? "") || NOT_RANDOM_TABLE.test(h.heads.join(" | "))) continue;
        const v = vecBulba(h, nSlots);
        const part = [...h.heads.filter((x) => !GAME_HEAD.test(x)), ...(h.div && !notPart.test(h.div) ? [h.div] : []), ...(/^b?\d+f/i.test(h.method) ? [h.method] : [])].join(" / ");
        if (v) put(B, `${h.species}|${f}`, `${part}|${parseLevels(h.levels)}`, v);
      }
      for (const r of srows.filter((x) => x.ver === ver && x.kind === "wild")) {
        const v = vecOurs(r, slots);
        const f = famOf(r.method);
        if (v && f) put(S, `${r.species}|${f}`, `${r.sub ?? ""}|${r.levels}`, v);
      }
      const setOf = (m?: Map<string, number[]>) => (m ? [...m.values()] : undefined);
      const total = (x: number[][]) => x.reduce((acc, v) => acc.map((a, i) => a + v[i]), Array(nSlots).fill(0) as number[]);
      // Same table: the same set of slot vectors, or the same totals per time slot (one source splits a Pokémon's
      // slots into rows by level or by time, another adds them up).
      const sameSet = (x?: number[][], y?: number[][]) =>
        !!x && !!y && ((x.every((v) => y.some((w) => sameVec(v, w))) && y.every((w) => x.some((v) => sameVec(v, w)))) || sameVec(total(x), total(y)));
      for (const key of new Set([...P.keys(), ...B.keys()])) {
        const [sp, fam] = key.split("|");
        const species = Number(sp);
        if (!Number.isInteger(species) || species < 1) continue;
        const p = setOf(P.get(key));
        const b = setOf(B.get(key));
        if (!b || sameSet(p, b)) continue;
        // Only rows without other conditions were compared; a key PokéAPI has under conditions only is not comparable.
        if (!p && pRows.some((r) => r.species === species && famOf(r.method) === fam)) continue;
        const sv = setOf(S.get(key));
        // Neither PokéAPI nor Serebii has this method for it here (e.g. Red/Blue's Route 4 fishing, which the pret
        // disassembly confirms): Bulbapedia's own rows fill the gap.
        const onlyBulba = !p && !sv && !srows.some((x) => x.ver === ver && x.species === species && famOf(x.method) === fam);
        const action: RateCheck["action"] = onlyBulba ? "add-bulbapedia" : sameSet(sv, b) ? (p ? "replace" : "add") : "keep";
        rateChecks.push({ area: a.names[0].name, version: ver, species, name: speciesName(species), method: fam, ...(p ? { pokeapi: p } : {}), bulbapedia: b, ...(sv ? { serebii: sv } : {}), action, source: locs[0].url });
        if (action === "keep") continue;
        // Bulbapedia's rows also carry forms (Sun/Moon's Midday and Midnight Lycanroc): when they name one, they are
        // the rows used (Serebii's name the species only).
        const bRows = locs.flatMap((l) => l.rows.filter((h) => h.versions.includes(ver) && h.species === species && famOf(h.method) === fam && !specialDiv.test(h.div ?? "") && !NOT_RANDOM_TABLE.test(h.heads.join(" | ")) && !bulbaKind(h.method, h.tpl, h.div)).map((h) => ({ h, url: l.url })));
        const useBulba = action === "add-bulbapedia" || bRows.some(({ h }) => formOfBulba(h).form);
        if (useBulba) {
          a.rows = a.rows.filter((r) => !(r.src === "pokeapi" && r.ver === ver && r.kind === "wild" && r.species === species && famOf(r.method) === fam && vecOurs(r, slots)));
          for (const { h, url } of bRows) a.rows.push(...bulbaToRows(h, ver, slots, a.names[0].name, url, formOfBulba(h), pageSubByUrl.get(url)).map((r) => (r.form ? r : withForm(r, a.key))));
          continue;
        }
        const repl = srows.filter((x) => x.ver === ver && x.kind === "wild" && x.species === species && famOf(x.method) === fam && vecOurs(x, slots));
        a.rows = a.rows.filter((r) => !(r.src === "pokeapi" && r.ver === ver && r.kind === "wild" && r.species === species && famOf(r.method) === fam && vecOurs(r, slots)));
        for (const r of repl) a.rows.push(withForm({ ...r }, a.key));
      }
    }
  }

  // ---- Diamond/Pearl/Platinum's dual-slot Pokémon: Serebii names the slot's game as the method ("FireRed"), PokéAPI
  // as a condition of the grass or cave row ("FireRed in slot 2"). One row per Pokémon and slot game: a Serebii row is
  // dropped where PokéAPI has that Pokémon for that game there, else written PokéAPI's way.
  if (cfg.id === "diamond-pearl" || cfg.id === "platinum")
    for (const a of accs.values()) {
      const drop = new Set<Row>();
      for (const r of a.rows) {
        const game = r.src === "serebii" ? r.method.match(/^(Ruby|Sapphire|Emerald|FireRed|LeafGreen)$/)?.[1] : undefined;
        if (!game) continue;
        const twin = a.rows.find((x) => x !== r && x.src !== "serebii" && x.ver === r.ver && x.species === r.species && (x.cond ?? "").split("; ").includes(`${game} in slot 2`));
        if (twin) {
          drop.add(r);
          notes.push(`dual-slot duplicate dropped: ${speciesName(r.species)} at ${a.names[0].name} (${r.ver}, Serebii "${game}"${r.levels ? ` Lv ${r.levels.join("-")}` : ""}) — PokéAPI's "${twin.method}; ${twin.cond}" row stays`);
        } else {
          r.method = "Walking";
          r.cond = [r.cond, `${game} in slot 2`].filter(Boolean).join("; ");
        }
      }
      a.rows = a.rows.filter((x) => !drop.has(x));
    }

  // ---- Bulbapedia's visible-Pokémon sections (Sword/Shield's "Visible encounters", "Wanderers", "Curry encounters"):
  // not random-encounter slots, so outside the rate check. Each row is added unless the area already has that Pokémon
  // (species and form) in that version met the same way (on water or on land) at overlapping levels; PokéAPI's
  // overworld rows usually do (Challenge Beach's surfing Corphish, Cramorant and Arrokuda they don't).
  for (const a of accs.values()) {
    const locs = bulba.get(a.key);
    if (!locs?.length || cfg.bulbaPrimary || newAreas.has(a.key)) continue;
    // Matched against the area's rows from before this step (two of Bulbapedia's rows for one wanderer, in two
    // weathers, are both kept).
    const before = [...a.rows];
    for (const l of locs)
      for (const h of l.rows) {
        const section = h.heads.find((x) => NOT_RANDOM_TABLE.test(x));
        if (!section || bulbaKind(h.method, h.tpl, h.div)) continue;
        // The table's terrain column says "Grass" for a surfing spawn too; its divider says "Surfing". A wanderer's
        // divider says where it walks ("In the east end of the lake"): its water or land is not given.
        const wanderer = /^Wanderers?$/i.test(section);
        const water = /surf|water|fishing|diving/i.test(h.div ?? "") || mediumOf(h.method) === "water";
        const method = wanderer ? "Wanderer" : /^Curry/i.test(section) ? "Curry (camp)" : water ? "Overworld (water)" : "Overworld";
        const levels = parseLevels(h.levels);
        const rate = /\//.test(h.rate ?? "") ? undefined : parseRate(h.rate);
        const form = formOfBulba(h);
        const sub = h.heads.filter((x) => !GAME_HEAD.test(x) && !NOT_RANDOM_TABLE.test(x) && !/^(Hidden|Visible) encounters$/i.test(x)).pop();
        // The divider's "After becoming Champion" is the Hall of Fame condition; the weather columns (rain=, fog=…) are
        // the weathers it appears in, one row each, worded as PokéAPI's rows (clear weather is a row without one).
        const story = /after becoming (the )?champion|after entering the hall of fame/i.test(h.div ?? "") ? "Enter the Hall of Fame" : undefined;
        const wx = WEATHER.filter(([k]) => (h.named[k] ?? "").trim() && !/^(-|—|0%?)$/.test(plain(h.named[k])));
        const weathers = h.named.all !== undefined || !wx.length || wx.length === WEATHER.length ? [undefined] : wx.map(([, c]) => c);
        // A strong wanderer Bulbapedia gives no story condition, in a place whose other Pokémon change at the Hall of
        // Fame: it is there before the Hall of Fame too (Workout Sea's Lv 80 Wailord), and the row says so.
        const split = a.rows.some((r) => /Hall of Fame/.test(r.cond ?? ""));
        const strong = !story && split && !!levels && levels[1] > 60 ? "There before the Hall of Fame too" : undefined;
        for (const ver of h.versions.filter((v) => versions.includes(v))) {
          const row: Row = { src: "bulbapedia", ver, place: a.names[0].name, ...(sub ? { sub } : {}), species: h.species, ...(form.form ? { form: form.form, art: form.art } : {}), kind: "wild", method, ...(rate !== undefined ? { rate } : {}), ...(levels ? { levels } : {}), url: l.url };
          const variants = weathers.map((w): Row => {
            const cond = [strong ?? story, w].filter(Boolean).join("; ");
            return cond ? { ...row, cond } : row;
          });
          const keys = coverageKeys(a.key, row);
          for (const k of wanderer ? keys.slice(0, 1) : keys) rawCoverage.add(k);
          // A Pokémon the area already has as a static encounter (Keldeo, the Swords of Justice, Spiritomb) is that one.
          const same = before.find(
            (r) =>
              r.ver === ver &&
              r.species === h.species &&
              (r.kind === "static" || ((r.form ?? "") === (form.form ?? "") && (wanderer ? /^Wanderer/.test(r.method) : mediumOf(r.method) === mediumOf(method)) && levelsOverlap(r.levels, levels))),
          );
          visibleLog.push({ area: a.names[0].name, version: ver, species: h.species, name: speciesName(h.species), section, method: h.method, ...(h.levels ? { levels: h.levels } : {}), action: same ? "duplicate" : "add", ...(same ? { matches: `${same.method}${same.levels ? ` Lv ${same.levels.join("-")}` : ""} (${same.src})` } : {}), source: l.url });
          if (!same) a.rows.push(...variants);
        }
      }
  }

  // ---- Sword/Shield: in a place whose Pokémon change at the Hall of Fame, a row above Lv 60 without that condition
  // is checked against Bulbapedia's table: post-game there ("After becoming Champion") -> the Hall of Fame condition;
  // there before it too (no such note) -> the row says so (Workout Sea's Lv 80 Wailord). Each is logged.
  if (cfg.id === "sword-shield")
    for (const a of accs.values()) {
      if (!a.rows.some((r) => /Hall of Fame/.test(r.cond ?? ""))) continue;
      const hs = (bulba.get(a.key) ?? []).flatMap((l) => l.rows.map((h) => ({ h, url: l.url })));
      for (const r of a.rows) {
        if (r.kind !== "wild" || !r.levels || r.levels[1] <= 60 || /Hall of Fame/.test(r.cond ?? "")) continue;
        const m = hs.filter(({ h }) => h.species === r.species && h.versions.includes(r.ver) && levelsOverlap(parseLevels(h.levels), r.levels));
        if (!m.length) continue;
        const post = m.some(({ h }) => /after becoming (the )?champion|after entering the hall of fame/i.test(`${h.div ?? ""} ${h.heads.join(" ")}`));
        const add = post ? "Enter the Hall of Fame" : "There before the Hall of Fame too";
        if ((r.cond ?? "").includes(add)) continue;
        fixesLog.push({ area: a.names[0].name, version: r.ver, species: r.species, name: speciesName(r.species), method: r.method, from: r.src, action: `condition "${add}" (Lv ${r.levels.join("-")})`, why: post ? "Bulbapedia's table gives this Pokémon at this level here after becoming Champion only" : "Bulbapedia's table gives this Pokémon at this level here with no story condition, in a place whose other Pokémon change at the Hall of Fame", source: m[0].url });
        r.cond = [add, r.cond].filter(Boolean).join("; ");
      }
    }

  // ---- starters: the walkthrough's "First partner" table rows, in the area its heading names
  const starters = new Set<string>();
  for (const c of wt.catches) {
    if (!cfg.bulba.includes(c.row.tpl) || !/first partner|starter/i.test(`${c.row.method} ${c.row.div ?? ""}`)) continue;
    const k = [...c.row.heads].reverse().map((h) => keyOfHead(h, accs, cfg.id)).find(Boolean);
    if (k) starters.add(`${k}|${c.row.species}`);
    else notes.push(`walkthrough starter ${speciesName(c.row.species)} under [${c.row.heads.join(" > ")}] names no area`);
  }
  if (!starters.size) {
    // No "First partner" table: the species the walkthrough's rival battles name as the player's choice
    // ({{PlayerChoice}} captions), given in the earliest area (by the walkthrough's order) that gifts them.
    const chosen = new Set(
      wt.events
        .filter((e): e is WtParty => e.type === "party" && /^Player choice: /.test(e.caption))
        .map((e) => pokedex.find((p) => p.name === e.caption.replace(/^Player choice: /, "").trim())?.id)
        .filter((x): x is number => !!x),
    );
    const firstSeen: string[] = [];
    for (const e of wt.events) {
      if (e.type !== "head") continue;
      const k = [e.name, ...e.linked].map((n) => keyOfHead(n, accs, cfg.id)).find(Boolean);
      if (k && !firstSeen.includes(k)) firstSeen.push(k);
    }
    for (const sp of chosen) {
      const at = firstSeen.find((k) => accs.get(k)!.rows.some((r) => r.kind === "gift" && r.species === sp));
      if (at) starters.add(`${at}|${sp}`);
    }
    if (chosen.size) notes.push(`starters from the walkthrough's player-choice captions: ${[...chosen].map(speciesName).join(", ")}`);
  }
  for (const a of accs.values())
    for (const r of a.rows) {
      if (r.kind === "gift" && starters.has(`${a.key}|${r.species}`)) r.method = "Starter";
      // PokéAPI's coin conditions: the Game Corner's prize Pokémon.
      if (r.kind === "gift" && /coins in your Coin Case/.test(r.cond ?? "")) r.method = "Game Corner prize";
    }

  // ---- Bulbapedia enrichment: walking terrain; starters and named non-wild methods; gifts/trades/statics missing
  for (const a of accs.values()) {
    const locs = bulba.get(a.key);
    if (!locs?.length || cfg.bulbaPrimary || newAreas.has(a.key)) continue;
    const areaTerrains = new Set(locs.flatMap((l) => l.rows).filter((r) => !bulbaKind(r.method, r.tpl, r.div) && BULBA_FAMILY(r.method) === "walk").map((r) => TERRAIN[r.method.toLowerCase()]).filter(Boolean));
    for (const r of a.rows) {
      if (r.kind !== "wild" || r.method !== "Walking") continue;
      // The terrain of Bulbapedia's matching row: same rate and levels first (the same table slot), then any of its rows.
      const walk = bulbaHits(locs, r.ver, r.species).filter((h) => !bulbaKind(h.method, h.tpl, h.div) && BULBA_FAMILY(h.method) === "walk" && TERRAIN[h.method.toLowerCase()]);
      const lv = (h: BulbaRow) => JSON.stringify(parseLevels(h.levels));
      const tiers = [
        walk.filter((h) => parseRate(h.rate) === r.rate && lv(h) === JSON.stringify(r.levels)),
        walk.filter((h) => lv(h) === JSON.stringify(r.levels)),
        walk.filter((h) => parseRate(h.rate) === r.rate),
        walk,
      ];
      for (const tier of tiers) {
        const t = new Set(tier.map((h) => TERRAIN[h.method.toLowerCase()]));
        if (t.size === 1) {
          r.method = [...t][0];
          break;
        }
        if (t.size > 1) break;
      }
      if (r.method === "Walking" && !walk.length && areaTerrains.size === 1) r.method = [...areaTerrains][0];
    }
    // Non-wild encounters on Bulbapedia's table that neither PokéAPI nor Serebii has here.
    for (const l of locs)
      for (const h of l.rows) {
        const kind = bulbaKind(h.method, h.tpl, h.div);
        if (!kind || h.uncatchable || h.event) continue;
        for (const ver of h.versions) {
          if (!versions.includes(ver)) continue;
          if (a.rows.some((r) => r.ver === ver && r.species === h.species && r.kind !== "wild")) continue;
          if (accsHasElsewhere(accs, ver, h.species, kind, bulba)) continue;
          a.rows.push({
            src: "bulbapedia",
            ver,
            place: a.names[0].name,
            ...(pageSub.get(l.title) ? { sub: pageSub.get(l.title) } : {}),
            species: h.species,
            kind,
            method: kind === "fossil" ? "Fossil" : kind === "static" ? "Static" : /^Starter$/i.test(h.method) ? "Starter" : kind === "trade" ? "Trade" : kind === "egg" ? "Egg" : "Gift",
            ...(kind !== "trade" && parseLevels(h.levels) ? { levels: parseLevels(h.levels)! } : {}),
            ...([kind === "trade" ? tradeCond(h) : undefined, h.note].filter(Boolean).length ? { cond: [kind === "trade" ? tradeCond(h) : undefined, h.note].filter(Boolean).join("; ") } : {}),
            url: l.url,
          });
          notes.push(`Bulbapedia-only ${kind}: ${speciesName(h.species)} at ${a.names[0].name} (${ver}) — ${l.url}`);
        }
      }
  }

  // ---- One-time encounters that Serebii files as "Wild" (where Serebii is the source): a Pokémon Bulbapedia's page has
  // only as a one-time encounter there (a fixed "Only One" row, or a Special encounters box), never on its wild table.
  // A Pokémon Bulbapedia never lists as wild anywhere in the game but shows as a one-time encounter somewhere counts too
  // (Serebii files Snacksworth's Zapdos under Poco Path; Bulbapedia under South Province (Area One), around it).
  const allLocs = [...bulba.values()].flat();
  const onceRow = (l: (typeof allLocs)[number], ver: string, sp: number) => l.rows.some((h) => h.tpl === "entry9/special" && h.versions.includes(ver) && h.species === sp && /^Only One$/i.test(h.rate ?? "")) || l.boxes.includes(sp);
  const wildIn = (ls: typeof allLocs, ver: string, sp: number) => ls.some((l) => l.rows.some((h) => h.versions.includes(ver) && h.species === sp && !bulbaKind(h.method, h.tpl, h.div)));
  if (cfg.serebii && !cfg.pokeapi && !cfg.bulbaPrimary)
    for (const a of accs.values()) {
      const locs = bulba.get(a.key) ?? [];
      const wildHere = (ver: string, sp: number) => wildIn(locs, ver, sp);
      // Elsewhere only for a Legendary or Mythical Pokémon (PokéAPI's flag): a common one Bulbapedia shows once somewhere
      // may simply be missing from the wild table of a place it has no page for.
      const legendary = new Set<number>();
      for (const r of a.rows) if (r.src === "serebii" && r.kind === "wild" && (await isLegendary(r.species))) legendary.add(r.species);
      const once = (ver: string, sp: number) => locs.find((l) => onceRow(l, ver, sp)) ?? (!legendary.has(sp) || wildIn(allLocs, ver, sp) ? undefined : allLocs.find((l) => onceRow(l, ver, sp)));
      const drop = new Set<Row>();
      for (const r of a.rows) {
        if (r.src !== "serebii" || r.kind !== "wild" || wildHere(r.ver, r.species)) continue;
        const l = once(r.ver, r.species);
        if (!l) continue;
        if (a.rows.some((x) => x !== r && x.ver === r.ver && x.species === r.species && x.kind === "static")) drop.add(r);
        else {
          r.kind = "static";
          r.method = "Static";
        }
        notes.push(`one-time encounter, not wild: ${speciesName(r.species)} at ${a.names[0].name} (${r.ver}) — Serebii "Wild", ${l.url} ${drop.has(r) ? "(its static row kept)" : "(made static)"}`);
      }
      a.rows = a.rows.filter((x) => !drop.has(x));
    }

  // ---- Form-less rows (Serebii's "Fixed:" lines name no form; PokéAPI has no pokemon for a cosmetic form such as
  // East Sea Shellos): the form Bulbapedia's table gives that Pokémon there, when it gives one form for it (Paldea's
  // fixed Tauros is a Combat Breed; Stony Wilderness's Shellos are East Sea), or one form for the rows met the same way
  // at overlapping levels (Giant's Mirror has both seas).
  if (!cfg.bulbaPrimary)
    for (const a of accs.values()) {
      const locs = bulba.get(a.key);
      if (!locs?.length) continue;
      for (const r of a.rows) {
        if (r.form) continue;
        // Its form from Bulbapedia's rows met the same way (wild or not), else from any of its rows there (a static
        // PokéAPI files for the Lv 50 Gastrodon Bulbapedia lists as a wanderer).
        const mine = locs.flatMap((l) => l.rows).filter((h) => h.versions.includes(r.ver) && h.species === r.species);
        const same = mine.filter((h) => !bulbaKind(h.method, h.tpl, h.div) === (r.kind === "wild"));
        const hs = same.length ? same : mine;
        let labels = [...new Set(hs.map((h) => h.form ?? ""))];
        if (labels.length > 1) labels = [...new Set(hs.filter((h) => famOf(h.method) === famOf(r.method) && levelsOverlap(parseLevels(h.levels), r.levels)).map((h) => h.form ?? ""))];
        if (labels.length !== 1 || !labels[0]) continue;
        const f = await formFor(r.species, labels[0]);
        if (!f?.form) continue;
        r.form = f.form;
        if (f.art !== undefined) r.art = f.art;
        else delete r.art;
        notes.push(`form from Bulbapedia's table: ${speciesName(r.species)} at ${a.names[0].name} (${r.ver}, ${r.kind}) is ${f.form} — ${locs[0].url}`);
      }
    }

  // ---- Levels Serebii doesn't give (Legends: Arceus, Scarlet/Violet): the range of Bulbapedia's wild rows for that
  // Pokémon there (its regular rows: not alpha, mass-outbreak or distortion rows).
  if (cfg.serebii && !cfg.pokeapi && !cfg.bulbaPrimary)
    for (const a of accs.values()) {
      const locs = bulba.get(a.key);
      if (!locs?.length) continue;
      for (const r of a.rows) {
        if (r.levels || r.kind !== "wild" || /outbreak|distortion/i.test(`${r.method} ${r.sub ?? ""} ${r.cond ?? ""}`)) continue;
        const lv = locs
          .flatMap((l) => l.rows)
          .filter((h) => h.versions.includes(r.ver) && h.species === r.species && !bulbaKind(h.method, h.tpl, h.div) && !/outbreak|distortion|alpha/i.test(h.div ?? ""))
          .map((h) => parseLevels(h.levels))
          .filter((x): x is [number, number] => !!x);
        if (!lv.length) continue;
        r.levels = [Math.min(...lv.map((x) => x[0])), Math.max(...lv.map((x) => x[1]))];
      }
    }

  // ---- Wild Pokémon Bulbapedia's table has at a place and Serebii doesn't (where Serebii is the source; neither lists
  // every Pokémon of Scarlet/Violet's or Legends: Arceus's big areas, and each row either gives is a sourced encounter):
  // Bulbapedia's rows are added, with its levels and its note as the condition. Rows of a special table (mass outbreaks,
  // space-time distortions, alphas, Unown, missions, swarms, radar, honey) are left out. Scarlet/Violet's and the
  // Legends games' numbers are spawn weights, not chances: no rate. (Serebii files Poco Path's wild Pokémon under South
  // Province (Area One), so Poco Path's come from here.)
  const SPECIAL_TABLE = /outbreak|distortion|unown|alpha|only during|mission|request|swarm|radar|honey|special/i;
  if (cfg.serebii && !cfg.pokeapi && !cfg.bulbaPrimary)
    for (const a of accs.values()) {
      const locs = bulba.get(a.key);
      if (!locs?.length || newAreas.has(a.key)) continue;
      // A DLC's place (every Serebii row there says "The Teal Mask"): Bulbapedia's rows there need that DLC too.
      const ser = a.rows.filter((r) => r.src === "serebii");
      const dlc = ["The Teal Mask", "The Indigo Disk", "Mega Dimension"].find((d) => ser.length && ser.every((r) => (r.cond ?? "").split("; ").includes(d)));
      for (const ver of versions) {
        const have = new Set(a.rows.filter((r) => r.ver === ver).map((r) => r.species));
        const add: Row[] = [];
        for (const l of locs)
          for (const h of l.rows) {
            if (!h.versions.includes(ver) || have.has(h.species) || bulbaKind(h.method, h.tpl, h.div) || SPECIAL_TABLE.test(`${h.div ?? ""} ${h.heads.join(" ")}`)) continue;
            const form = h.form ? await formFor(h.species, h.form) : {};
            const levels = parseLevels(h.levels);
            const weights = cfg.gen === 9 || /^entry(la|za)$/.test(h.tpl);
            const rate = weights ? undefined : parseRate(h.rate);
            const note = [h.named.note ? plain(h.named.note) : "", dlc ?? ""].filter(Boolean).join("; ") || undefined;
            add.push({ src: "bulbapedia", ver, place: a.names[0].name, ...(pageSub.get(l.title) ? { sub: pageSub.get(l.title) } : {}), species: h.species, ...(form?.form ? { form: form.form, art: form.art } : {}), kind: "wild", method: weights ? "Wild" : h.method, ...(rate !== undefined ? { rate } : {}), ...(levels ? { levels } : {}), ...(note ? { cond: note } : {}), url: l.url });
          }
        if (!add.length) continue;
        a.rows.push(...add);
        notes.push(`Bulbapedia-only wild (${ver}) at ${a.names[0].name}: ${[...new Set(add.map((r) => speciesName(r.species)))].join(", ")} — ${[...new Set(add.map((r) => r.url))].join(", ")}`);
      }
    }

  // ---- Bulbapedia audit of every wild row: drop what its table marks unavailable in every version; list what it lacks
  const audit: Audit[] = [];
  for (const a of accs.values()) {
    const locs = bulba.get(a.key);
    if (!locs?.length || cfg.bulbaPrimary) continue;
    const seen = new Set<string>();
    const drop = new Set<Row>();
    for (const r of a.rows) {
      if (r.kind !== "wild" || !versions.includes(r.ver)) continue;
      const k = `${r.ver}|${r.species}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (bulbaHits(locs, r.ver, r.species).length) continue;
      const rowsOf = locs.flatMap((l) => l.rows.filter((h) => h.species === r.species));
      const unavailable = rowsOf.length > 0 && rowsOf.every((h) => !h.versions.length);
      const sourcesOf = [...new Set(a.rows.filter((x) => x.ver === r.ver && x.species === r.species && x.kind === "wild").map((x) => x.src))];
      audit.push({ area: a.names[0].name, version: r.ver, species: r.species, name: speciesName(r.species), sources: sourcesOf, bulbapedia: unavailable ? "unavailable" : "not listed", action: unavailable ? "drop" : "keep", source: locs[0].url });
      if (unavailable)
        for (const x of a.rows)
          if (x.ver === r.ver && x.species === r.species && x.kind === "wild") {
            drop.add(x);
            for (const k of coverageKeys(a.key, x)) droppedOnPurpose.add(k);
          }
    }
    a.rows = a.rows.filter((x) => !drop.has(x));
  }

  // ---- Bulbapedia audit of every gift, static, Egg and fossil: one its area's pages don't list but another area's
  // pages do (the same encounter: kind and levels) belongs there (Red/Blue's Magikarp salesman is in Route 4's Pokémon
  // Center, not on Route 3): it is dropped where that area already has it, else moved there (when one area lists it).
  // Logged either way.
  const nonWildLog: NonWildCheck[] = [];
  if (!cfg.bulbaPrimary) {
    const lists = (key: string, ver: string, sp: number) => (bulba.get(key) ?? []).some((l) => l.boxes.includes(sp) || l.rows.some((h) => h.species === sp && h.versions.includes(ver) && !h.uncatchable && !h.event && !!bulbaKind(h.method, h.tpl, h.div)));
    // A "gift" Bulbapedia's table gives as revived from a fossil (Let's Go's Cinnabar Lab) is a fossil.
    for (const a of accs.values())
      for (const r of a.rows) {
        if (r.kind !== "gift") continue;
        const ks = (bulba.get(a.key) ?? []).flatMap((l) => l.rows.filter((h) => h.species === r.species && h.versions.includes(r.ver)).map((h) => ({ k: bulbaKind(h.method, h.tpl, h.div), url: l.url }))).filter((x) => x.k);
        if (!ks.length || !ks.every((x) => x.k === "fossil")) continue;
        fixesLog.push({ area: a.names[0].name, version: r.ver, species: r.species, name: speciesName(r.species), method: r.method, from: r.src, action: "kind fossil", why: "Bulbapedia's table gives this Pokémon here as revived from a Fossil", source: ks[0].url });
        r.kind = "fossil";
        r.method = "Fossil";
      }
    // The same encounter: same Pokémon and form, kind (a fossil filed as a gift is one), method, levels, and for a
    // trade the Pokémon asked for. (Celadon's Game Corner Nidorina is not Route 11's traded one.)
    const kindOf = (k: string) => (k === "fossil" ? "gift" : k);
    const giveOf = (c?: string) => /Give (.+?) in a Trade/.exec(c ?? "")?.[1] ?? "";
    const methodOf = (m: string) => (/^(Gift|Fossil)$/.test(m) ? "Gift" : m);
    const same = (r: Row, x: Row) =>
      x.ver === r.ver && x.species === r.species && (x.form ?? "") === (r.form ?? "") && kindOf(x.kind) === kindOf(r.kind) && methodOf(x.method) === methodOf(r.method) && JSON.stringify(x.levels ?? null) === JSON.stringify(r.levels ?? null) && (r.kind !== "trade" || giveOf(x.cond) === giveOf(r.cond));
    // An area's Bulbapedia rows that are this encounter: same Pokémon, version, kind and (when both give them) levels.
    const rowsFor = (key: string, r: Row) =>
      (bulba.get(key) ?? []).flatMap((l) => l.rows).filter((h) => {
        const k = bulbaKind(h.method, h.tpl, h.div);
        if (!k || h.uncatchable || h.species !== r.species || !h.versions.includes(r.ver) || kindOf(k) !== kindOf(r.kind)) return false;
        const lv = parseLevels(h.levels);
        return r.kind === "trade" || !lv || !r.levels || JSON.stringify(lv) === JSON.stringify(r.levels);
      });
    for (const a of accs.values()) {
      if (!bulba.get(a.key)?.length) continue;
      const out = new Set<Row>();
      for (const r of a.rows) {
        // Trades are left where they are: two places' trades of one Pokémon for the same one look alike (Turffield
        // Stadium's Meowth and Regina's).
        if (r.kind === "wild" || r.kind === "roaming" || r.kind === "trade" || !versions.includes(r.ver) || lists(a.key, r.ver, r.species)) continue;
        const there = [...accs.values()].filter((b) => b !== a && rowsFor(b.key, r).length);
        if (!there.length) continue;
        const has = there.find((b) => b.rows.some((x) => x !== r && same(r, x)));
        const to = has ?? (there.length === 1 && !there[0].rows.some((x) => x.ver === r.ver && x.species === r.species && kindOf(x.kind) === kindOf(r.kind)) ? there[0] : undefined);
        if (!to) continue;
        out.add(r);
        for (const k of coverageKeys(a.key, r)) droppedOnPurpose.add(k);
        if (!has) to.rows.push({ ...r, place: to.names[0].name, sub: undefined });
        nonWildLog.push({ area: a.names[0].name, version: r.ver, species: r.species, name: speciesName(r.species), kind: r.kind, sources: [r.src], action: has ? "drop" : "move", to: to.names[0].name, source: (bulba.get(to.key) ?? [])[0]?.url ?? "" });
      }
      a.rows = a.rows.filter((r) => !out.has(r));
    }
  }

  // ---- the dropping fixes once more, for rows Bulbapedia's pages added since (the Slumbering Weald's uncatchable
  // Zacian and Zamazenta are on its table as Special encounters)
  for (const a of accs.values())
    a.rows = a.rows.filter((r) => {
      const f = rowFixes.find((x) => x.drop && x.area === a.key && x.method.test(r.method) && (!x.species || x.species.includes(r.species)));
      if (!f) return true;
      fixesLog.push({ area: a.names[0].name, version: r.ver, species: r.species, name: speciesName(r.species), method: r.method, from: r.src, action: "drop", why: f.why, source: f.source });
      return false;
    });

  // ---- one-time encounters only a page's Special encounters text gives (lib/fixes.ts STATICS)
  const statics = STATICS.filter((x) => x.game === cfg.id);
  const already = statics.filter((st) => (st.versions ?? versions).some((ver) => accsHasAny(accs, ver, st.species)));
  if (already.length) throw new Error(`${cfg.id}: STATICS ${already.map((st) => speciesName(st.species)).join(", ")} in the data already`);
  for (const st of statics) {
    const a = accs.get(st.area);
    if (!a) throw new Error(`${cfg.id}: STATICS area ${st.area} not found`);
    for (const ver of st.versions ?? versions) {
      a.rows.push({ src: "bulbapedia", ver, place: a.names[0].name, species: st.species, kind: "static", method: "Static", levels: st.levels, cond: st.cond, url: st.source });
      fixesLog.push({ area: a.names[0].name, version: ver, species: st.species, name: speciesName(st.species), method: "Static", from: "bulbapedia", action: `added Lv ${st.levels.join("-")}`, why: "the page's Special encounters text gives this one-time encounter (no table row); no source has it anywhere in the game", source: st.source });
      sources.add(st.source);
    }
  }

  // ---- table notes too long to read as a condition, said in short (lib/fixes.ts NOTE_REWRITE)
  for (const n of NOTE_REWRITE.filter((x) => x.game === cfg.id)) {
    let hit = 0;
    for (const a of accs.values())
      for (const r of a.rows)
        if (r.cond?.split("; ").some((p) => n.match.test(p))) {
          r.cond = r.cond.split("; ").map((p) => (n.match.test(p) ? n.cond : p)).join("; ");
          hit++;
        }
    if (!hit) throw new Error(`${cfg.id}: NOTE_REWRITE ${n.match} matches no row`);
    fixesLog.push({ area: "(every row with the note)", action: `condition "${n.cond}" (${hit} rows)`, why: n.why, source: n.source });
  }

  // ---- conditions a row's table leaves out and its page's text gives (lib/fixes.ts NOTES)
  for (const n of NOTES.filter((x) => x.game === cfg.id))
    for (const r of accs.get(n.area)?.rows ?? [])
      if (r.species === n.species && r.kind === n.kind && !(r.cond ?? "").includes(n.cond)) {
        r.cond = [r.cond, n.cond].filter(Boolean).join("; ");
        fixesLog.push({ area: names.get(n.area) ?? n.area, version: r.ver, species: r.species, name: speciesName(r.species), method: r.method, from: r.src, action: `condition "${n.cond}"`, why: "the page's text gives this condition; its table doesn't", source: n.source });
      }

  // ---- parts the place itself names (SUB_RULES)
  for (const rule of SUB_RULES.filter((x) => x.games.includes(cfg.id)))
    for (const r of accs.get(rule.area)?.rows ?? []) if (!r.sub && rule.method.test(r.method)) r.sub = rule.sub;

  // ---- PokéAPI's unnamed sub-areas ("Unknown area 53"): named after the part of Bulbapedia's table (its headings and
  // divider, as the rate checks read them) that holds the same encounters. A sub-area matches a part when every one of
  // its encounters (Pokémon, way of meeting it, version, level range) is in that part, they make up at least three
  // quarters of the part (PokéAPI can lack one, e.g. Victory Road's Mienfoo), and no other part holds them all. Parts
  // that all hold them and share a first name ("Interior / Entrances", "Interior / Main") give that name. Otherwise
  // the label is dropped and the sub-area's rows merge with the area's others (a range of rates, which is still true).
  const unnamedLog: UnnamedSub[] = [];
  {
    const UNNAMED = /^Unknown area \d+$/i;
    const partOf = (h: BulbaRow) => [...h.heads.filter((x) => !GAME_HEAD.test(x)), ...(h.div && !notPart.test(h.div) ? [h.div] : []), ...(/^b?\d+f/i.test(h.method) ? [h.method] : [])].join(" / ");
    for (const a of accs.values()) {
      const unnamed = [...new Set(a.rows.flatMap((r) => (r.sub && UNNAMED.test(r.sub) ? [r.sub] : [])))];
      if (!unnamed.length) continue;
      const locs = bulba.get(a.key) ?? [];
      // Each part's encounters: "version|species|way|levels" (a Pokémon's rows of one way merged into one level range).
      const ranges = new Map<string, Map<string, [number, number]>>();
      for (const l of locs)
        for (const h of l.rows) {
          const f = famOf(h.method);
          if (!f || NOT_RANDOM_TABLE.test(h.heads.join(" | ")) || bulbaKind(h.method, h.tpl, h.div)) continue;
          const lv = parseLevels(h.levels);
          if (!lv) continue;
          const part = partOf(h);
          if (!ranges.has(part)) ranges.set(part, new Map());
          const m = ranges.get(part)!;
          for (const ver of h.versions.filter((v) => versions.includes(v))) {
            const k = `${ver}|${h.species}|${f}`;
            const o = m.get(k);
            m.set(k, o ? [Math.min(o[0], lv[0]), Math.max(o[1], lv[1])] : [lv[0], lv[1]]);
          }
        }
      const sigs = (m: Map<string, [number, number]>) => new Set([...m].map(([k, v]) => `${k}|${v.join("-")}`));
      const parts = new Map([...ranges].filter(([p]) => p).map(([p, m]) => [p, sigs(m)] as const));
      const source = locs[0]?.url ?? "";
      for (const u of unnamed) {
        const m = new Map<string, [number, number]>();
        for (const r of a.rows) {
          const f = famOf(r.method);
          if (r.sub !== u || !r.levels || !f) continue;
          const k = `${r.ver}|${r.species}|${f}`;
          const o = m.get(k);
          m.set(k, o ? [Math.min(o[0], r.levels[0]), Math.max(o[1], r.levels[1])] : [r.levels[0], r.levels[1]]);
        }
        const mine = sigs(m);
        const holds = [...parts].filter(([, ps]) => mine.size && [...mine].every((x) => ps.has(x)) && mine.size >= 0.75 * ps.size).map(([p]) => p);
        const firsts = [...new Set(holds.map((p) => p.split(" / ")[0]))];
        const part = holds.length === 1 ? holds[0] : holds.length > 1 && firsts.length === 1 && holds.every((p) => p.includes(" / ")) ? firsts[0] : null;
        const why = !locs.length
          ? "no Bulbapedia table for this place"
          : !parts.size
            ? "Bulbapedia's table for this place is not split into parts"
            : !mine.size
              ? "it has no walking, surfing or fishing encounters with levels to compare"
              : holds.length === 1
                ? `its ${mine.size} encounters (Pokémon, way, version, levels) are all in Bulbapedia's "${part}" part, which has ${parts.get(part!)!.size}; no other part has them all`
                : part
                  ? `its ${mine.size} encounters are all in each of Bulbapedia's parts ${holds.map((h) => `"${h}"`).join(", ")}, which share the name "${part}"`
                  : holds.length > 1
                    ? `its encounters are all in ${holds.length} of Bulbapedia's parts (${holds.map((h) => `"${h}"`).join(", ")}): not certain which`
                    : "no part of Bulbapedia's table holds its encounters (Pokémon, way, version and levels)";
        for (const r of a.rows) if (r.sub === u) r.sub = part ?? UNLABELLED;
        unnamedLog.push({ area: displayName(a), sub: u, part, why, source });
      }
    }
  }

  // ---- every row names a real species (a source row we couldn't read is an error, not data)
  for (const a of accs.values())
    for (const r of a.rows) if (!Number.isInteger(r.species) || r.species < 1 || r.species > 1025) throw new Error(`${cfg.id}: unreadable species ${r.species} at ${r.place} (${r.url})`);

  // ---- one spelling per name: straight apostrophes everywhere, and where two strings of the game (area names, parts,
  // conditions) differ only by case, spacing or punctuation ("Hauoli outskirts", "Hau'oli Outskirts"), the one
  // Bulbapedia uses (a page title or walkthrough link of the game), else the area's own name, else the one with the
  // apostrophe, the spacing and the capitals of a name.
  {
    const straight = (t: string) => t.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
    const key = (t: string) => straight(t).toLowerCase().replace(/[^a-z0-9]/g, "");
    const bulbaNames = new Set<string>([...wt.links.keys(), ...wt.links.values(), ...[...bulba.values()].flat().map((l) => l.title)].map(straight));
    const areaNames = new Set([...accs.values()].map((a) => straight(displayName(a))));
    const seen = new Map<string, Map<string, number>>();
    const note = (t: string) => {
      const s = straight(t);
      const k = key(s);
      if (!k) return;
      const m = seen.get(k) ?? new Map<string, number>();
      m.set(s, (m.get(s) ?? 0) + 1);
      seen.set(k, m);
    };
    const parts = (t: string) => t.split(/(; | \/ )/);
    for (const a of accs.values()) {
      note(displayName(a));
      for (const r of a.rows) for (const t of [r.sub, r.cond]) if (t) for (const p of parts(t)) if (p !== "; " && p !== " / ") note(p);
    }
    const SMALL = /^(of|the|and|in|on|to|a|an|at|for|from|by|with|or)$/i;
    const score = (v: string, n: number) =>
      (bulbaNames.has(v) ? 1000 : 0) + (areaNames.has(v) ? 500 : 0) + 20 * (v.match(/'/g)?.length ?? 0) + 5 * (v.match(/ /g)?.length ?? 0) + v.split(/\s+/).filter((w) => /^[A-Z]/.test(w) && !SMALL.test(w)).length - 3 * v.split(/\s+/).filter((w) => /^[A-Z]/.test(w) && SMALL.test(w)).length + n / 1e6;
    const canon = new Map<string, string>();
    for (const [k, m] of seen) canon.set(k, [...m].sort((x, y) => score(y[0], y[1]) - score(x[0], x[1]))[0][0]);
    const fix = (t: string) => parts(t).map((p) => (p === "; " || p === " / " ? p : (canon.get(key(p)) ?? straight(p)))).join("");
    for (const a of accs.values()) {
      for (const r of a.rows) {
        if (r.sub) r.sub = fix(r.sub);
        if (r.cond) r.cond = fix(r.cond);
      }
      a.nameFix = fix(displayName(a));
    }
  }

  // ---- coverage: what the merged sources had that the output lost (other than on purpose) is a build error
  const finalCoverage = new Set<string>();
  for (const a of accs.values()) for (const r of a.rows) if (versions.includes(r.ver)) for (const k of coverageKeys(a.key, r)) finalCoverage.add(k);
  const coverageLosses = [...rawCoverage].filter((k) => !finalCoverage.has(k) && !droppedOnPurpose.has(k.split("|").slice(0, 3).join("|")) && !droppedOnPurpose.has(k));
  if (coverageLosses.length) notes.push(`COVERAGE LOST (a bug): ${coverageLosses.slice(0, 20).join(", ")}`);

  // ---- areas
  const areas = new Map<string, NuzArea>();
  const usedIds = new Set<string>();
  for (const a of accs.values()) {
    const rows = a.rows.filter((r) => versions.includes(r.ver));
    if (!rows.length) continue;
    const name = displayName(a);
    const id = slug(name);
    if (usedIds.has(id)) throw new Error(`${cfg.id}: two areas named ${name}`);
    usedIds.add(id);
    areas.set(a.key, { id, name, encounters: encountersOf(rows, versions) });
  }

  // ---- story order and bosses
  const sb = await summaryBosses(cfg.id);
  for (const u of sb.urls) sources.add(u);
  notes.push(...sb.notes);
  const { steps, extra, bossReport, unplaced, fromSummary } = order(cfg, wt, areas, sb);
  if (fromSummary.length) notes.push(`placed by the walkthrough index's part summaries: ${fromSummary.join("; ")}`);
  for (const m of BOSS_BEFORE.filter((x) => x.game === cfg.id)) {
    const b = steps.findIndex((s) => s.type === "boss" && s.boss.name === m.boss);
    const a = steps.findIndex((s) => s.type === "area" && s.area.id === m.area);
    if (b < 0 || a < 0) throw new Error(`${cfg.id}: BOSS_BEFORE ${m.boss} / ${m.area} not found`);
    if (b < a) continue;
    const [boss] = steps.splice(b, 1);
    steps.splice(a, 0, boss);
    fixesLog.push({ area: m.area, action: `${m.boss} before it`, why: m.why, source: m.source });
    sources.add(m.source);
  }
  for (const m of AREA_AFTER.filter((x) => x.game === cfg.id)) {
    const a = steps.findIndex((s) => s.type === "area" && s.area.id === m.area);
    if (a < 0 || steps.findIndex((s) => s.type === "area" && s.area.id === m.after) < 0) throw new Error(`${cfg.id}: AREA_AFTER ${m.area} / ${m.after} not found`);
    const [step] = steps.splice(a, 1);
    steps.splice(steps.findIndex((s) => s.type === "area" && s.area.id === m.after) + 1, 0, step);
    fixesLog.push({ area: m.area, action: `after ${m.after}`, why: m.why, source: m.source });
    sources.add(m.source);
  }
  // ---- story bosses (scripts/nuzlocke/story-bosses.json: rivals, villains, totems…), by their anchors
  const story = storyBosses()[cfg.id] ?? [];
  const merged = mergeStoryBosses(cfg.id, steps, story);
  steps.splice(0, steps.length, ...merged.steps);
  for (const e of story) sources.add(e.source);
  if (merged.problems.length) notes.push(`STORY BOSSES LEFT OUT: ${merged.problems.join("; ")}`);
  if (story.length) notes.push(`story bosses: ${merged.placed} of ${story.length} placed`);
  const game: NuzGame = {
    id: cfg.id,
    name: cfg.name,
    gen: cfg.gen,
    region: cfg.region,
    versions: cfg.versions,
    steps,
    extra,
    sources: [...sources].sort(),
  };
  return {
    game,
    disagreements,
    audit,
    rates: rateChecks,
    serebii: bpLog,
    conditionFixes: summarizeFixes(conditionFixes),
    visible: visibleLog,
    fixes: fixesLog,
    sweep: sweepLog,
    nonWild: nonWildLog,
    unnamedSubs: unnamedLog,
    battleOnly,
    coverageLosses,
    report: {
      areas: areas.size,
      encounters: [...areas.values()].reduce((n, a) => n + a.encounters.length, 0),
      bosses: bossReport,
      unplaced,
      disagreements: disagreements.length,
      unresolved: disagreements.filter((d) => d.resolution === "unresolved").length,
      auditDropped: audit.filter((x) => x.action === "drop").length,
      rateReplaced: rateChecks.filter((x) => x.action === "replace").length,
      rateAdded: rateChecks.filter((x) => x.action === "add").length,
      rateAddedBulbapedia: rateChecks.filter((x) => x.action === "add-bulbapedia").length,
      rateKept: rateChecks.filter((x) => x.action === "keep").length,
      auditNotListed: audit.filter((x) => x.action === "keep").length,
      noBulbapediaPage: [...accs.values()].filter((a) => !bulba.get(a.key)?.length).map((a) => displayName(a)),
      notes,
    },
  };
}

/**
 * Bulbapedia's Sword/Shield tables put the visible (overworld) Pokémon, the wanderers and the curry visitors in their
 * own sections, with the same terrain words as the random encounters: they are not the random-encounter slots the rate
 * check compares (PokéAPI's "walk"), so they stay out of it (PokéAPI's overworld rows have them).
 */
const NOT_RANDOM_TABLE = /(^|\| )(Visible encounters|Wanderers?|Curry encounters)( \||$)/i;

/** A heading that names a generation or a game ("Generation IV", "Pokémon Ultra Sun and Ultra Moon"), not a part. */
const GAME_HEAD = /^(Generation [IVX]+|Pokémon (Red|Blue|Green|Yellow|Gold|Silver|Crystal|Ruby|Sapphire|Emerald|FireRed|LeafGreen|Diamond|Pearl|Platinum|HeartGold|SoulSilver|Black|White|X|Y|Omega Ruby|Alpha Sapphire|Sun|Moon|Ultra Sun|Ultra Moon|Let's Go|Sword|Shield|Brilliant Diamond|Shining Pearl|Legends|Scarlet|Violet)\b.*)$/i;

/** Bulbapedia's Sword/Shield weather columns -> PokéAPI's wording of that weather (clear weather: no condition). */
const WEATHER: [string, string | undefined][] = [
  ["clear", undefined],
  ["cloudy", "During overcast weather"],
  ["rain", "During rainy weather"],
  ["thunderstorm", "During a thunderstorm"],
  ["snow", "During snowy weather"],
  ["blizzard", "During a snowstorm"],
  ["sun", "During intense sun"],
  ["sandstorm", "During a sandstorm"],
  ["fog", "During foggy weather"],
];

/** Water or land: how a row's method meets the Pokémon (the coverage check keeps both apart). */
function mediumOf(method: string): "water" | "land" {
  return /surf|rod|fish|water|dive|seaweed|bubbl|rippl|sea skim/i.test(method) ? "water" : "land";
}

function levelsOverlap(a?: [number, number], b?: [number, number]): boolean {
  return !a || !b || Math.max(a[0], b[0]) <= Math.min(a[1], b[1]);
}

/**
 * A row's coverage: its area, species and version, with and without how it is met (water/land). Not the form: a
 * source's form can be corrected (PokéAPI's Kantonian Rattata on Ultra Sun/Ultra Moon's Route 1, Alolan on Bulbapedia's
 * table) without the area losing the Pokémon.
 */
function coverageKeys(areaKey: string, r: Row): string[] {
  const base = `${areaKey}|${r.species}|${r.ver}`;
  return [base, `${base}|${mediumOf(r.method)}`];
}

/** One log entry per (area, version, species, method) for PokéAPI condition fixes (each covers its rows' details). */
function summarizeFixes(fixes: ConditionFix[]): ConditionFix[] {
  const seen = new Map<string, ConditionFix>();
  for (const f of fixes) {
    const k = `${f.area}|${f.version}|${f.species}|${f.method}|${f.wrong}`;
    if (!seen.has(k)) seen.set(k, f);
  }
  return [...seen.values()];
}

/** Bulbapedia catch rows -> our Rows (one per distinct chance across the time/season slots). */
/**
 * Every row of a Bulbapedia page as ours, for a place only Bulbapedia names: wild rows with the table's chances per time
 * slot (a special method's numbers only when they make up one table: a Berry tree's "100%" each is no chance),
 * gifts/trades/statics/Eggs/fossils with their levels, a trade's "Give X" and a one-time row's note as the condition.
 */
async function rowsOfPage(cfg: GameCfg, l: BulbaLoc, place: string, part?: string): Promise<Row[]> {
  const versions = cfg.versions.map((v) => v.id);
  const slots = slotNames(cfg.id);
  const out: Row[] = [];
  const total = new Map<string, number>();
  for (const h of l.rows) if (!bulbaKind(h.method, h.tpl, h.div) && !famOf(h.method)) for (const v of h.versions) total.set(`${v}|${h.method}`, (total.get(`${v}|${h.method}`) ?? 0) + (parseRate(h.rate) ?? 0));
  for (const h of l.rows) {
    if (h.uncatchable || h.event) continue;
    const f = h.form ? ((await formFor(h.species, h.form)) ?? {}) : {};
    // A form only the battle has (Eternamax Eternatus is caught as Eternatus).
    const form = f.form && BATTLE_ONLY_FORMS.has(f.form) ? {} : f;
    const kind = bulbaKind(h.method, h.tpl, h.div);
    const levels = parseLevels(h.levels);
    const note = h.note;
    for (const ver of h.versions.filter((v) => versions.includes(v))) {
      if (!kind && famOf(h.method)) {
        out.push(...bulbaToRows(h, ver, slots, place, l.url, form, part));
        continue;
      }
      const base = { src: "bulbapedia" as const, ver, place, ...(part ? { sub: part } : {}), species: h.species, ...(form.form ? { form: form.form, ...(form.art !== undefined ? { art: form.art } : {}) } : {}), url: l.url };
      if (!kind) {
        const rate = parseRate(h.rate);
        const one = (total.get(`${ver}|${h.method}`) ?? 0) <= 100;
        out.push({ ...base, kind: "wild", method: h.method[0].toUpperCase() + h.method.slice(1), ...(one && rate !== undefined ? { rate } : {}), ...(levels ? { levels } : {}), ...(note ? { cond: note } : {}) });
        continue;
      }
      const method = kind === "fossil" ? "Fossil" : kind === "static" ? "Static" : /^Starter$/i.test(h.method) ? "Starter" : kind === "trade" ? "Trade" : kind === "egg" ? "Egg" : kind === "roaming" ? "Roaming" : "Gift";
      const cond = [kind === "trade" ? (tradeCond(h) ?? "") : "", note ?? ""].filter(Boolean).join("; ");
      out.push({ ...base, kind, method, ...(kind !== "trade" && levels ? { levels } : {}), ...(cond ? { cond } : {}) });
    }
  }
  return out;
}

function bulbaToRows(h: BulbaRow, ver: string, names: string[], place: string, url: string, form: FormHit = {}, pagePart?: string): Row[] {
  const n = Math.max(1, names.length);
  const fam = famOf(h.method)!;
  const method = fam === "walk" ? (TERRAIN[h.method.toLowerCase()] ?? "Walking") : fam === "surf" ? "Surf" : fam === "old rod" ? "Old Rod" : fam === "good rod" ? "Good Rod" : "Super Rod";
  // The part: a floor given as the method ("1F") or the table's sub-heading; on a page that is a part of the area
  // (Mirage Mountain (southeast of Route 129)), that part first.
  const own = /^b?\d+f/i.test(h.method) ? h.method : h.heads.filter((x) => !GAME_HEAD.test(x) && !/^(Hidden|Visible) encounters$/i.test(x)).pop();
  const sub = [pagePart, own].filter(Boolean).join(" ") || undefined;
  const v = vecBulba(h, n) ?? [];
  const levels = parseLevels(h.levels);
  const by = new Map<number, number[]>();
  v.forEach((x, i) => {
    if (x > 0) by.set(x, [...(by.get(x) ?? []), i]);
  });
  const out: Row[] = [];
  for (const [rate, idx] of by) {
    const cond = n > 1 && idx.length < n ? idx.map((i) => names[i]).join(", ") : undefined;
    out.push({ src: "bulbapedia", ver, place, ...(sub ? { sub } : {}), species: h.species, ...(form.form ? { form: form.form, art: form.art } : {}), kind: "wild", method, rate, ...(levels ? { levels } : {}), ...(cond ? { cond } : {}), url });
  }
  return out;
}

function accsHasElsewhere(accs: Map<string, Acc>, ver: string, species: number, kind: string, bulba: Map<string, BulbaLoc[]>): boolean {
  // A gift/trade listed by Bulbapedia on a city page may already be filed by PokéAPI under the building's own place:
  // another area's row is that one unless that area's own pages list it too (then each place has its own, like
  // X/Y's hotel trades in Camphrier, Coumarine, Geosenge and Couriway).
  const listed = (key: string) => (bulba.get(key) ?? []).some((l) => l.boxes.includes(species) || l.rows.some((h) => h.species === species && h.versions.includes(ver) && !!bulbaKind(h.method, h.tpl, h.div)));
  for (const a of accs.values()) if (a.rows.some((r) => r.ver === ver && r.species === species && r.kind === kind) && !listed(a.key)) return true;
  return false;
}

function accsHasAny(accs: Map<string, Acc>, ver: string, species: number): boolean {
  for (const a of accs.values()) if (a.rows.some((r) => r.ver === ver && r.species === species)) return true;
  return false;
}

/** A trade's condition: the Pokémon asked for ("tradenum=000": any). */
function tradeCond(h: BulbaRow): string | undefined {
  const name = h.named.tradename ? plain(h.named.tradename) : "";
  if (/^any$/i.test(name) || (!name && /^0+$/.test(h.named.tradenum ?? ""))) return "Give any Pokémon in a Trade";
  return name ? `Give ${name} in a Trade` : undefined;
}

function displayName(a: Acc): string {
  return a.nameFix ?? (a.names.find((n) => n.src === "alias") ?? a.names.find((n) => n.src === "pokeapi") ?? a.names[0]).name;
}

/* ----------------------------------------------------------------------------------------- rows -> encounters -- */

function encountersOf(rows: Row[], versions: string[]): NuzEncounter[] {
  // 1. per version: identical rows across sub-areas fold; a part is named unless the encounter is in every part of the area.
  const parts = new Set(rows.map((r) => r.sub ?? ""));
  // A roamer's grass and water rows are one roaming Pokémon: one row, with whatever condition PokéAPI gives either.
  const roamCond = new Map<string, string>();
  for (const r of rows) if (r.kind === "roaming" && r.cond) roamCond.set(`${r.ver}|${r.species}`, r.cond);
  rows = rows.map((r) => (r.kind === "roaming" ? { ...r, method: "Roaming", ...(roamCond.get(`${r.ver}|${r.species}`) ? { cond: roamCond.get(`${r.ver}|${r.species}`) } : {}) } : r));
  const bySig = new Map<string, { r: Row; subs: Set<string>; vers: Set<string> }>();
  for (const r of rows) {
    const sig = JSON.stringify([r.ver, r.species, r.form, r.kind, r.method, r.rate, r.levels, r.cond]);
    const g = bySig.get(sig) ?? { r, subs: new Set<string>(), vers: new Set([r.ver]) };
    g.subs.add(r.sub ?? "");
    bySig.set(sig, g);
  }
  const perVer: { r: Row; cond?: string }[] = [];
  for (const g of bySig.values()) {
    // (An encounter also met in a part with no name, e.g. a PokéAPI sub-area no Bulbapedia part matched, names no part:
    // naming only the others would say it is met there alone.)
    const subs = [...g.subs].filter((x) => x && x !== UNLABELLED).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const named = subs.length && !g.subs.has(UNLABELLED) && g.subs.size < parts.size ? subs.join(" / ") : "";
    const cond = [named, g.r.cond].filter(Boolean).join("; ");
    perVer.push({ r: g.r, ...(cond ? { cond } : {}) });
  }
  // 2. identical entries across versions merge; `versions` only when not every version has it.
  const byEnc = new Map<string, { e: NuzEncounter; vers: Set<string> }>();
  for (const { r, cond } of perVer) {
    const e: NuzEncounter = { species: r.species, ...(r.form ? { form: r.form, art: r.art } : {}), kind: r.kind, method: r.method, ...(r.rate !== undefined ? { rate: r.rate } : {}), ...(r.levels ? { levels: r.levels } : {}), ...(cond ? { condition: cond } : {}) };
    const sig = JSON.stringify(e);
    const g = byEnc.get(sig) ?? { e, vers: new Set<string>() };
    g.vers.add(r.ver);
    byEnc.set(sig, g);
  }
  const KIND_ORDER = ["wild", "roaming", "static", "gift", "fossil", "egg", "trade"];
  return [...byEnc.values()]
    .map(({ e, vers }) => {
      const v = versions.filter((x) => vers.has(x));
      return v.length === versions.length ? e : { ...e, versions: v };
    })
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.method.localeCompare(b.method) || a.species - b.species || (a.form ?? "").localeCompare(b.form ?? "") || (a.condition ?? "").localeCompare(b.condition ?? "", "en", { numeric: true }) || (b.rate ?? 0) - (a.rate ?? 0));
}

/* ------------------------------------------------------------------------------------------- order and bosses -- */

/**
 * A walkthrough index's summary of a part -> its items, in order: "Victory Road, Part 7: Cortondo, South Province (Area
 * Six), Alfornada, Optional: Alfornada Cavern" -> Cortondo, South Province (Area Six), Alfornada, Alfornada Cavern.
 * "X (A & B)" and "X (A, B)" name several places: X (A) or A X.
 */
function summaryItems(summary: string): string[][] {
  // "Routes 17 & 18", "Routes 132, 133, and 134": one item per route.
  summary = summary.replace(/\bRoutes (\d+(?:, \d+)*,? (?:and|&) \d+)\b/g, (_, ns: string) => ns.split(/,? (?:and|&) |, /).map((n) => `Route ${n}`).join(", "));
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of summary) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      items.push(cur);
      cur = "";
    } else cur += ch;
  }
  items.push(cur);
  return items
    // "Lake of the Moone / Lake of the Sunne", "Naranja Academy/Uva Academy": one place per version, each its own item.
    .flatMap((x) => x.split(/\s*\/\s*/))
    .map((x) => x.trim().replace(/^(?:Part \d+:\s*)?(?:Optional:\s*)?/, "").trim())
    .filter(Boolean)
    .map((x) => {
      const m = x.match(/^(.+?) \(([^()]*(?:,|&)[^()]*)\)$/);
      if (!m) return [x];
      return m[2].split(/\s*(?:,|&)\s*/).map((a) => `${m[1]} (${a})|${a} ${m[1]}`);
    })
    .flat()
    .map((x) => x.split("|"));
}

function order(cfg: GameCfg, wt: Walkthrough, areas: Map<string, NuzArea>, sb: SummaryBosses) {
  const steps: NuzStep[] = [];
  const placed = new Set<string>();
  const bossCfg = BOSSES[cfg.id];
  if (!bossCfg) throw new Error(`${cfg.id}: no boss config`);
  const parties = wt.events.filter((e): e is WtParty => e.type === "party");
  const picked = bossCfg.pick(parties);
  const pickedSet = new Map(picked.map((b) => [b.first, b]));
  const bossNote = new Map<NuzBoss, string | undefined>();
  const fromSummary: string[] = [];
  const headKey = (e: WtEvent) => (e.type === "head" ? [e.name, ...e.linked].map((n) => keyOfHead(n, areas, cfg.id)).find(Boolean) : undefined);
  // Places some part's headings reach: those headings place them (a summary may name a place the story only passes,
  // e.g. on Mr. Briney's boat); the summaries place the rest.
  const byHeading = new Set(wt.events.map(headKey).filter(Boolean) as string[]);
  for (const part of wt.parts) {
    const start = steps.length;
    // 1. The part's page: places as its headings reach them, bosses as its parties meet them.
    for (const e of wt.events) {
      if (e.part !== part.idx) continue;
      if (e.type === "head") {
        const k = headKey(e);
        if (k && !placed.has(k)) {
          placed.add(k);
          steps.push({ type: "area", area: areas.get(k)! });
        }
      } else {
        const b = pickedSet.get(e);
        if (!b) continue;
        steps.push({ type: "boss", boss: b.boss });
        bossNote.set(b.boss, b.note);
      }
    }
    // 2. The index's summary of the part: a place (or boss) its page doesn't reach (or has no page yet) goes in the
    // summary's order, after the summary item before it that this part has already placed.
    let at = start;
    const indexOf = (pred: (s: NuzStep) => boolean) => steps.findIndex((s, i) => i >= start && pred(s));
    for (const alts of summaryItems(part.summary)) {
      const bosses = sb.byItem.get(alts[0]);
      if (bosses) {
        for (const boss of bosses) {
          const i = indexOf((s) => s.type === "boss" && s.boss.name === boss.name);
          if (i >= 0) {
            at = Math.max(at, i + 1);
            continue;
          }
          steps.splice(at++, 0, { type: "boss", boss });
          bossNote.set(boss, `placed by the walkthrough index's summary of ${part.title}`);
        }
        continue;
      }
      const k = alts.map((n) => keyOfHead(n, areas, cfg.id)).find(Boolean);
      if (!k) continue;
      if (placed.has(k)) {
        const i = indexOf((s) => s.type === "area" && s.area === areas.get(k));
        if (i >= 0) at = Math.max(at, i + 1);
        continue;
      }
      if (byHeading.has(k)) continue;
      placed.add(k);
      steps.splice(at++, 0, { type: "area", area: areas.get(k)! });
      fromSummary.push(`${areas.get(k)!.name} (${part.title})`);
    }
  }
  const extra = [...areas.entries()].filter(([k]) => !placed.has(k)).map(([, a]) => a);
  const bossReport = steps.flatMap((s) => {
    if (s.type !== "boss") return [];
    const b = s.boss;
    const note = bossNote.get(b);
    return [{ name: b.name, ...(b.cap !== undefined ? { cap: b.cap } : {}), ...(b.capByVersion ? { capByVersion: b.capByVersion } : {}), ...(note ? { note } : {}) }];
  });
  return { steps, extra, bossReport, unplaced: extra.map((a) => a.name), fromSummary };
}

/* -------------------------------------------------------------------------------------------------------- main -- */

async function main() {
  const args = process.argv.slice(2);
  const ids = args.includes("--all") ? GAMES.map((g) => g.id) : args.filter((a, i) => args[i - 1] === "--game");
  if (!ids.length) throw new Error("usage: build.ts --game <id> [--game <id>…] | --all");
  const log: Record<string, { disagreements: Disagreement[]; bulbapedia: Audit[]; rates: RateCheck[]; serebii?: SerebiiCheck[]; conditionFixes?: ConditionFix[]; visible?: VisibleCheck[]; fixes?: FixLog[]; sweep?: SweepLog[]; nonWild?: NonWildCheck[]; unnamedSubs?: UnnamedSub[]; battleOnly?: BattleOnly[]; coverageLosses?: string[] }> = fs.existsSync(CROSSCHECK) ? JSON.parse(fs.readFileSync(CROSSCHECK, "utf8")).games ?? {} : {};
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  for (const id of ids) {
    const cfg = GAME_BY_ID.get(id);
    if (!cfg) throw new Error(`unknown game ${id}`);
    const t = Date.now();
    const b = await buildGame(cfg);
    fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(b.game));
    log[id] = { disagreements: b.disagreements, bulbapedia: b.audit, rates: b.rates, ...(b.serebii.length ? { serebii: b.serebii } : {}), ...(b.conditionFixes.length ? { conditionFixes: b.conditionFixes } : {}), ...(b.visible.length ? { visible: b.visible } : {}), ...(b.fixes.length ? { fixes: b.fixes } : {}), ...(b.sweep.length ? { sweep: b.sweep } : {}), ...(b.nonWild.length ? { nonWild: b.nonWild } : {}), ...(b.unnamedSubs.length ? { unnamedSubs: b.unnamedSubs } : {}), ...(b.battleOnly.length ? { battleOnly: b.battleOnly } : {}), coverageLosses: b.coverageLosses };
    fs.writeFileSync(path.join(REPORT_DIR, `${id}.json`), JSON.stringify(b.report, null, 1));
    const r = b.report as { areas: number; encounters: number; bosses: unknown[]; disagreements: number; unresolved: number; auditDropped: number; auditNotListed: number; rateReplaced: number; rateAdded: number; rateAddedBulbapedia: number; rateKept: number; unplaced: string[] };
    console.log(
      `${id}: ${r.areas} areas, ${r.encounters} encounters, ${r.bosses.length} bosses, ${r.disagreements} disagreements (${r.unresolved} unresolved), Bulbapedia audit: ${r.auditDropped} dropped / ${r.auditNotListed} not listed, rates: ${r.rateReplaced} replaced / ${r.rateAdded} added / ${r.rateAddedBulbapedia} Bulbapedia-only / ${r.rateKept} kept, ${r.unplaced.length} in extra — ${((Date.now() - t) / 1000).toFixed(1)}s`,
    );
  }
  const ordered = Object.fromEntries(GAMES.filter((g) => log[g.id]).map((g) => [g.id, log[g.id]]));
  fs.writeFileSync(
    CROSSCHECK,
    JSON.stringify(
      {
        about:
          "Per game. disagreements: PokéAPI vs Serebii species disagreements per area and version, each settled by the game's table on Bulbapedia's location page (source): keep/drop = a PokéAPI row Bulbapedia lists / doesn't list; add/skip = a Serebii-only row Bulbapedia lists / doesn't list; unresolved = no Bulbapedia table, PokéAPI's data stands. bulbapedia: every other wild row Bulbapedia's table doesn't list for that version: drop = Bulbapedia lists the Pokémon there for no version of the game (e.g. an unreleased event table), keep = not on its table (both other sources list it). rates: per Pokémon and method family, PokéAPI's chances (per time slot, summed over the place's parts) that differ from Bulbapedia's table: replace = Serebii's rows (which match Bulbapedia) are used instead; add = PokéAPI lacks the method there and Serebii's matching rows are added; add-bulbapedia = only Bulbapedia has it, its rows are added; keep = no two sources agree, PokéAPI's stand. serebii (Scarlet/Violet, Legends: Z-A, whose Bulbapedia location tables are the source): every Serebii row its place's Bulbapedia table doesn't have; add = the Pokémon's own Bulbapedia page names that place for the game, skip = it doesn't (the row is left out). visible: every row of Bulbapedia's visible-Pokémon sections (Sword/Shield's Visible encounters, Wanderers, Curry encounters), add = no row of the area has that Pokémon met the same way (water or land) at overlapping levels in that version, duplicate = one does (named). coverageLosses: area|species|version(|water or land) keys the merged sources had and the output lost other than by a logged drop; it must be empty (verify:nuzlocke fails otherwise). conditionFixes: PokéAPI condition values found on rows they can't belong to (a Max Raid den value on Rolling Fields' wild rows), with the value used instead and the evidence. fixes: source rows Bulbapedia shows to be wrong and what was done (drop, levels, method, no chance, copied to the places a moving NPC appears at, kind, condition), each with its evidence (scripts/nuzlocke/lib/fixes.ts, Bulbapedia's notes on unreachable water, PokéAPI's Generation VII ambush rows). sweep: the game's Bulbapedia location pages (its category) that no area's lookup reached and that have its table rows: fold = the page is part of an area (a building in a town, by its infobox location; a part, by its title; or a named rule) and joins that area's pages; new area = a place no other source names, built from its page. nonWild: gifts, statics, Eggs and fossils that their area's Bulbapedia pages don't list but another area's do (the same encounter: kind and levels; trades are left where they are): drop = that area already has it, move = it is moved there. unnamedSubs: PokéAPI's unnamed sub-areas (\"Unknown area 53\") and the part of Bulbapedia's table each was matched to by its encounters (every Pokémon, way, version and level range of it in that part, at least three quarters of the part, and in no other part; parts that all match and share a first name give that name), or null with the reason, its rows then naming no part. battleOnly (Scarlet/Violet, Legends: Arceus, Legends: Z-A): Special encounters boxes left out because the text above them says the Pokémon is only battled (why: the words that say so, e.g. \"cannot be caught\" or a Rogue Mega Evolution's battle). Written by scripts/nuzlocke/build.ts.",
        games: ordered,
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`fetch: ${JSON.stringify(STATS)}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
