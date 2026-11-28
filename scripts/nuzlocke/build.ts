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
 *    gifts/trades/statics the other two lack;
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
import { areaPages, areaRows, availability, confirmed, partners } from "./lib/bulba-primary";
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
    if (al && !al.sub && keys.has(placeKey(al.area))) return placeKey(al.area);
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
  coverageLosses: string[];
  report: Record<string, unknown>;
}

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
    const ap = await areaPages(cands);
    const subPages = await pages([...new Set([...ap.values()].flatMap((p) => p?.subs ?? []))]);
    const confirmAt = new Map<string, Set<string>>();
    const tpl = new Set(cfg.bulba);
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
      const use = ownRows ? own : [...own, ...subs];
      const dlc = cfg.id === "scarlet-violet" ? ({ Kitakami: "The Teal Mask", Unova: "The Indigo Disk" } as Record<string, string>)[p?.region ?? ""] : undefined;
      for (const r of await areaRows(cfg, n, use, dlc)) add(r);
      for (const u of use) if (catchRows(u.text).some((r) => tpl.has(r.tpl))) sources.add(u.url);
      confirmAt.set(k, new Set([n, ...(p ? [p.title, ...p.subs] : [])]));
    }
    if (cfg.bulbaPrimary === "serebii") {
      const need = serRows.filter((r) => {
        const a = accs.get(placeKey(areaName(r)));
        return !a?.rows.some((x) => x.ver === r.ver && x.species === r.species);
      });
      const av = await availability(cfg.id, new Map([...new Set(need.map((r) => r.species))].map((sp) => [sp, pokedex.find((p) => p.id === sp)?.name ?? String(sp)])));
      const seen = new Set<string>();
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
        add(c.once && r.kind === "wild" ? { ...r, kind: "static", method: "Static" } : r);
        if (c.url) sources.add(c.url);
      }
      notes.push(`Serebii rows not on Bulbapedia's table: ${bpLog.filter((x) => x.action === "add").length} added (the Pokémon's page names the place), ${bpLog.filter((x) => x.action === "skip").length} left out`);
    }
    for (const s of firsts) {
      for (const ver of versions) add({ src: "bulbapedia", ver, place: s.place, ...(s.sub ? { sub: s.sub } : {}), species: s.species, kind: "gift", method: "Starter", url: s.url });
      sources.add(s.url);
    }
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
    if (!locs?.length || !cfg.pokeapi || cfg.serebiiRows) continue;
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
        const part = [...h.heads.filter((x) => !/^Generation /i.test(x)), ...(h.div && !notPart.test(h.div) ? [h.div] : []), ...(/^b?\d+f/i.test(h.method) ? [h.method] : [])].join(" / ");
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
          for (const { h, url } of bRows) a.rows.push(...bulbaToRows(h, ver, slots, a.names[0].name, url, formOfBulba(h)).map((r) => (r.form ? r : withForm(r, a.key))));
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
    if (!locs?.length || cfg.bulbaPrimary) continue;
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
        const sub = h.heads.filter((x) => !/^Generation /i.test(x) && !NOT_RANDOM_TABLE.test(x) && !/^(Hidden|Visible) encounters$/i.test(x)).pop();
        for (const ver of h.versions.filter((v) => versions.includes(v))) {
          const row: Row = { src: "bulbapedia", ver, place: a.names[0].name, ...(sub ? { sub } : {}), species: h.species, ...(form.form ? { form: form.form, art: form.art } : {}), kind: "wild", method, ...(rate !== undefined ? { rate } : {}), ...(levels ? { levels } : {}), url: l.url };
          const keys = coverageKeys(a.key, row);
          for (const k of wanderer ? keys.slice(0, 1) : keys) rawCoverage.add(k);
          // A Pokémon the area already has as a static encounter (Keldeo, the Swords of Justice, Spiritomb) is that one.
          const same = a.rows.find(
            (r) =>
              r.ver === ver &&
              r.species === h.species &&
              (r.kind === "static" || ((r.form ?? "") === (form.form ?? "") && (wanderer ? /^Wanderer/.test(r.method) : mediumOf(r.method) === mediumOf(method)) && levelsOverlap(r.levels, levels))),
          );
          visibleLog.push({ area: a.names[0].name, version: ver, species: h.species, name: speciesName(h.species), section, method: h.method, ...(h.levels ? { levels: h.levels } : {}), action: same ? "duplicate" : "add", ...(same ? { matches: `${same.method}${same.levels ? ` Lv ${same.levels.join("-")}` : ""} (${same.src})` } : {}), source: l.url });
          if (!same) a.rows.push(row);
        }
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
    if (!locs?.length || cfg.bulbaPrimary) continue;
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
        if (!kind) continue;
        for (const ver of h.versions) {
          if (!versions.includes(ver)) continue;
          if (a.rows.some((r) => r.ver === ver && r.species === h.species && r.kind !== "wild")) continue;
          if (accsHasElsewhere(accs, ver, h.species, kind)) continue;
          a.rows.push({
            src: "bulbapedia",
            ver,
            place: a.names[0].name,
            species: h.species,
            kind,
            method: kind === "fossil" ? "Fossil" : kind === "static" ? "Static" : /^Starter$/i.test(h.method) ? "Starter" : kind === "trade" ? "Trade" : kind === "egg" ? "Egg" : "Gift",
            ...(kind !== "trade" && parseLevels(h.levels) ? { levels: parseLevels(h.levels)! } : {}),
            ...(kind === "trade" && h.named.tradename ? { cond: `Give ${h.named.tradename} in a Trade` } : {}),
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

  // ---- Serebii's form-less rows (its "Fixed:" lines name no form): the form Bulbapedia's table gives that Pokémon
  // there, when it gives one form for it (Paldea's fixed Tauros is a Combat Breed).
  if (cfg.serebii && !cfg.pokeapi && !cfg.bulbaPrimary)
    for (const a of accs.values()) {
      const locs = bulba.get(a.key);
      if (!locs?.length) continue;
      for (const r of a.rows) {
        if (r.src !== "serebii" || r.form) continue;
        const hs = locs.flatMap((l) => l.rows).filter((h) => h.versions.includes(r.ver) && h.species === r.species && !bulbaKind(h.method, h.tpl, h.div) === (r.kind === "wild"));
        const labels = [...new Set(hs.map((h) => h.form ?? ""))];
        if (labels.length !== 1 || !labels[0]) continue;
        const f = await formFor(r.species, labels[0]);
        if (!f?.form) continue;
        r.form = f.form;
        r.art = f.art;
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
      if (!locs?.length) continue;
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
            add.push({ src: "bulbapedia", ver, place: a.names[0].name, species: h.species, ...(form?.form ? { form: form.form, art: form.art } : {}), kind: "wild", method: weights ? "Wild" : h.method, ...(rate !== undefined ? { rate } : {}), ...(levels ? { levels } : {}), ...(note ? { cond: note } : {}), url: l.url });
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

  // ---- parts the place itself names (SUB_RULES)
  for (const rule of SUB_RULES.filter((x) => x.games.includes(cfg.id)))
    for (const r of accs.get(rule.area)?.rows ?? []) if (!r.sub && rule.method.test(r.method)) r.sub = rule.sub;

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
    let id = slug(name);
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
function bulbaToRows(h: BulbaRow, ver: string, names: string[], place: string, url: string, form: FormHit = {}): Row[] {
  const n = Math.max(1, names.length);
  const fam = famOf(h.method)!;
  const method = fam === "walk" ? (TERRAIN[h.method.toLowerCase()] ?? "Walking") : fam === "surf" ? "Surf" : fam === "old rod" ? "Old Rod" : fam === "good rod" ? "Good Rod" : "Super Rod";
  // The part: a floor given as the method ("1F") or the table's sub-heading.
  const sub = /^b?\d+f/i.test(h.method) ? h.method : h.heads.filter((x) => !/^Generation /i.test(x) && !/^(Hidden|Visible) encounters$/i.test(x)).pop();
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

function accsHasElsewhere(accs: Map<string, Acc>, ver: string, species: number, kind: string): boolean {
  // A gift/trade listed by Bulbapedia on a city page may already be filed by PokéAPI under the building's own place.
  for (const a of accs.values()) if (a.rows.some((r) => r.ver === ver && r.species === species && r.kind === kind)) return true;
  return false;
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
    const subs = [...g.subs].filter(Boolean).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const named = subs.length && g.subs.size < parts.size ? subs.join(" / ") : "";
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
  const log: Record<string, { disagreements: Disagreement[]; bulbapedia: Audit[]; rates: RateCheck[]; serebii?: SerebiiCheck[]; conditionFixes?: ConditionFix[]; visible?: VisibleCheck[]; coverageLosses?: string[] }> = fs.existsSync(CROSSCHECK) ? JSON.parse(fs.readFileSync(CROSSCHECK, "utf8")).games ?? {} : {};
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  for (const id of ids) {
    const cfg = GAME_BY_ID.get(id);
    if (!cfg) throw new Error(`unknown game ${id}`);
    const t = Date.now();
    const b = await buildGame(cfg);
    fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(b.game));
    log[id] = { disagreements: b.disagreements, bulbapedia: b.audit, rates: b.rates, ...(b.serebii.length ? { serebii: b.serebii } : {}), ...(b.conditionFixes.length ? { conditionFixes: b.conditionFixes } : {}), ...(b.visible.length ? { visible: b.visible } : {}), coverageLosses: b.coverageLosses };
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
          "Per game. disagreements: PokéAPI vs Serebii species disagreements per area and version, each settled by the game's table on Bulbapedia's location page (source): keep/drop = a PokéAPI row Bulbapedia lists / doesn't list; add/skip = a Serebii-only row Bulbapedia lists / doesn't list; unresolved = no Bulbapedia table, PokéAPI's data stands. bulbapedia: every other wild row Bulbapedia's table doesn't list for that version: drop = Bulbapedia lists the Pokémon there for no version of the game (e.g. an unreleased event table), keep = not on its table (both other sources list it). rates: per Pokémon and method family, PokéAPI's chances (per time slot, summed over the place's parts) that differ from Bulbapedia's table: replace = Serebii's rows (which match Bulbapedia) are used instead; add = PokéAPI lacks the method there and Serebii's matching rows are added; add-bulbapedia = only Bulbapedia has it, its rows are added; keep = no two sources agree, PokéAPI's stand. serebii (Scarlet/Violet, Legends: Z-A, whose Bulbapedia location tables are the source): every Serebii row its place's Bulbapedia table doesn't have; add = the Pokémon's own Bulbapedia page names that place for the game, skip = it doesn't (the row is left out). visible: every row of Bulbapedia's visible-Pokémon sections (Sword/Shield's Visible encounters, Wanderers, Curry encounters), add = no row of the area has that Pokémon met the same way (water or land) at overlapping levels in that version, duplicate = one does (named). coverageLosses: area|species|version(|water or land) keys the merged sources had and the output lost other than by a logged drop; it must be empty (verify:nuzlocke fails otherwise). conditionFixes: PokéAPI condition values found on rows they can't belong to (a Max Raid den value on Rolling Fields' wild rows), with the value used instead and the evidence. Written by scripts/nuzlocke/build.ts.",
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
