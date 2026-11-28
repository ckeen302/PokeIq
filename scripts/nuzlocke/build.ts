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
import { ALIASES, BULBA_PAGES, DATA_ERRORS, NOT_A_PLACE, SUB_RULES, type Alias } from "./lib/aliases";
import { placeKey, slug } from "./lib/areas";
import { bulbaKind, bulbaPages, TERRAIN, type BulbaLoc } from "./lib/bulba-loc";
import type { BulbaRow } from "./lib/bulba-catch";
import { GAMES, GAME_BY_ID, type GameCfg } from "./lib/config";
import { STATS } from "./lib/fetch";
import { pokeapiRows } from "./lib/pokeapi-rows";
import { parseLevels, parseRate, type Row } from "./lib/rows";
import { locRows } from "./lib/serebii";
import { serebiiToRows } from "./lib/serebii-rows";
import { walkthrough, type Walkthrough, type WtParty } from "./lib/walkthrough";
import { BOSSES } from "./lib/bosses";
import { addVec, famOf, sameVec, slotNames, vecBulba, vecOurs } from "./lib/rates";
import { formFor, type FormHit } from "./lib/forms";

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
}

const REGION_NAMES = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola"];

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

interface Built {
  game: NuzGame;
  disagreements: Disagreement[];
  audit: Audit[];
  rates: RateCheck[];
  report: Record<string, unknown>;
}

async function buildGame(cfg: GameCfg): Promise<Built> {
  const versions = cfg.versions.map((v) => v.id);
  const sources = new Set<string>();
  const notes: string[] = [];
  const accs = new Map<string, Acc>();
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
    notes.push(...got.skipped.map((s) => `PokéAPI skipped: ${s}`));
    sources.add("https://pokeapi.co/api/v2/location-area/");
  }
  if (cfg.serebiiLoc) {
    ser = serebiiToRows((await locRows(cfg.serebiiLoc)).filter((r) => versions.includes(r.ver)), { alola: cfg.gen === 7 });
    sources.add(`https://www.serebii.net/${{ rby: "pokedex", gs: "pokedex-gs", rs: "pokedex-rs", dp: "pokedex-dp", bw: "pokedex-bw", xy: "pokedex-xy", sm: "pokedex-sm" }[cfg.serebiiLoc]}/location/`);
  }
  const bad = DATA_ERRORS[cfg.id] ?? {};
  api = api.filter((r) => {
    const why = bad[placeKey(r.place)];
    if (why && !notes.includes(`PokéAPI data error skipped: ${r.place} (${why})`)) notes.push(`PokéAPI data error skipped: ${r.place} (${why})`);
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
  const wt = await walkthrough(cfg.walkthrough);
  sources.add(wt.url);

  // ---- Bulbapedia location pages for every place either source names
  const names = new Map<string, string>();
  for (const [k, a] of accs) names.set(k, a.names[0].name);
  for (const [k, rs] of serByArea) if (!names.has(k)) names.set(k, rs[0].place);
  const bulba = await bulbaPages(names, { templates: cfg.bulba, regions: cfg.bulbaRegions, links: wt.links, extra: BULBA_PAGES[cfg.id] });
  for (const locs of bulba.values()) for (const l of locs) sources.add(l.url);

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
        const hits = bulbaHits(locs, ver, sp).filter((h) => !bulbaKind(h.method));
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
        if (resolution === "drop") for (const r of apiRows) if (r.ver === ver && r.species === sp && comparable(r)) dropped.add(r);
        if (resolution === "add") for (const r of srows) if (r.ver === ver && r.species === sp && comparable(r)) add(withForm(r, key));
      }
    }
  }
  for (const a of accs.values()) a.rows = a.rows.filter((r) => !dropped.has(r));

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
    if (!locs?.length || !cfg.pokeapi) continue;
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
        if (!h.versions.includes(ver) || bulbaKind(h.method)) continue;
        const f = famOf(h.method);
        if (!f || specialDiv.test(h.div ?? "")) continue;
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
        const bRows = locs.flatMap((l) => l.rows.filter((h) => h.versions.includes(ver) && h.species === species && famOf(h.method) === fam && !specialDiv.test(h.div ?? "") && !bulbaKind(h.method)).map((h) => ({ h, url: l.url })));
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
      const k = keyOfHead(e.name, accs, cfg.id);
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
    if (!locs?.length) continue;
    const areaTerrains = new Set(locs.flatMap((l) => l.rows).filter((r) => !bulbaKind(r.method) && BULBA_FAMILY(r.method) === "walk").map((r) => TERRAIN[r.method.toLowerCase()]).filter(Boolean));
    for (const r of a.rows) {
      if (r.kind !== "wild" || r.method !== "Walking") continue;
      // The terrain of Bulbapedia's matching row: same rate and levels first (the same table slot), then any of its rows.
      const walk = bulbaHits(locs, r.ver, r.species).filter((h) => !bulbaKind(h.method) && BULBA_FAMILY(h.method) === "walk" && TERRAIN[h.method.toLowerCase()]);
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
        const kind = bulbaKind(h.method);
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

  // ---- Bulbapedia audit of every wild row: drop what its table marks unavailable in every version; list what it lacks
  const audit: Audit[] = [];
  for (const a of accs.values()) {
    const locs = bulba.get(a.key);
    if (!locs?.length) continue;
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
      if (unavailable) for (const x of a.rows) if (x.ver === r.ver && x.species === r.species && x.kind === "wild") drop.add(x);
    }
    a.rows = a.rows.filter((x) => !drop.has(x));
  }

  // ---- parts the place itself names (SUB_RULES)
  for (const rule of SUB_RULES.filter((x) => x.games.includes(cfg.id)))
    for (const r of accs.get(rule.area)?.rows ?? []) if (!r.sub && rule.method.test(r.method)) r.sub = rule.sub;

  // ---- every row names a real species (a source row we couldn't read is an error, not data)
  for (const a of accs.values())
    for (const r of a.rows) if (!Number.isInteger(r.species) || r.species < 1 || r.species > 1025) throw new Error(`${cfg.id}: unreadable species ${r.species} at ${r.place} (${r.url})`);

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
  const { steps, extra, bossReport, unplaced } = order(cfg, wt, areas);
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

/** Bulbapedia catch rows -> our Rows (one per distinct chance across the time/season slots). */
function bulbaToRows(h: BulbaRow, ver: string, names: string[], place: string, url: string, form: FormHit = {}): Row[] {
  const n = Math.max(1, names.length);
  const fam = famOf(h.method)!;
  const method = fam === "walk" ? (TERRAIN[h.method.toLowerCase()] ?? "Walking") : fam === "surf" ? "Surf" : fam === "old rod" ? "Old Rod" : fam === "good rod" ? "Good Rod" : "Super Rod";
  // The part: a floor given as the method ("1F") or the table's sub-heading.
  const sub = /^b?\d+f/i.test(h.method) ? h.method : h.heads.filter((x) => !/^Generation /i.test(x)).pop();
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
  return (a.names.find((n) => n.src === "alias") ?? a.names.find((n) => n.src === "pokeapi") ?? a.names[0]).name;
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

function order(cfg: GameCfg, wt: Walkthrough, areas: Map<string, NuzArea>) {
  const steps: NuzStep[] = [];
  const placed = new Set<string>();
  const bossCfg = BOSSES[cfg.id];
  if (!bossCfg) throw new Error(`${cfg.id}: no boss config`);
  const parties = wt.events.filter((e): e is WtParty => e.type === "party");
  const picked = bossCfg.pick(parties);
  const pickedSet = new Map(picked.map((b) => [b.first, b]));
  const bossReport: { name: string; cap?: number; capByVersion?: Record<string, number>; note?: string }[] = [];
  for (const e of wt.events) {
    if (e.type === "head") {
      const k = keyOfHead(e.name, areas, cfg.id);
      if (k && !placed.has(k)) {
        placed.add(k);
        steps.push({ type: "area", area: areas.get(k)! });
      }
    } else {
      const b = pickedSet.get(e);
      if (!b) continue;
      steps.push({ type: "boss", boss: b.boss });
      bossReport.push({ name: b.boss.name, ...(b.boss.cap !== undefined ? { cap: b.boss.cap } : {}), ...(b.boss.capByVersion ? { capByVersion: b.boss.capByVersion } : {}), ...(b.note ? { note: b.note } : {}) });
    }
  }
  const extra = [...areas.entries()].filter(([k]) => !placed.has(k)).map(([, a]) => a);
  return { steps, extra, bossReport, unplaced: extra.map((a) => a.name) };
}

/* -------------------------------------------------------------------------------------------------------- main -- */

async function main() {
  const args = process.argv.slice(2);
  const ids = args.includes("--all") ? GAMES.map((g) => g.id) : args.filter((a, i) => args[i - 1] === "--game");
  if (!ids.length) throw new Error("usage: build.ts --game <id> [--game <id>…] | --all");
  const log: Record<string, { disagreements: Disagreement[]; bulbapedia: Audit[]; rates: RateCheck[] }> = fs.existsSync(CROSSCHECK) ? JSON.parse(fs.readFileSync(CROSSCHECK, "utf8")).games ?? {} : {};
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  for (const id of ids) {
    const cfg = GAME_BY_ID.get(id);
    if (!cfg) throw new Error(`unknown game ${id}`);
    const t = Date.now();
    const b = await buildGame(cfg);
    fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(b.game));
    log[id] = { disagreements: b.disagreements, bulbapedia: b.audit, rates: b.rates };
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
          "Per game. disagreements: PokéAPI vs Serebii species disagreements per area and version, each settled by the game's table on Bulbapedia's location page (source): keep/drop = a PokéAPI row Bulbapedia lists / doesn't list; add/skip = a Serebii-only row Bulbapedia lists / doesn't list; unresolved = no Bulbapedia table, PokéAPI's data stands. bulbapedia: every other wild row Bulbapedia's table doesn't list for that version: drop = Bulbapedia lists the Pokémon there for no version of the game (e.g. an unreleased event table), keep = not on its table (both other sources list it). rates: per Pokémon and method family, PokéAPI's chances (per time slot, summed over the place's parts) that differ from Bulbapedia's table: replace = Serebii's rows (which match Bulbapedia) are used instead; add = PokéAPI lacks the method there and Serebii's matching rows are added; add-bulbapedia = only Bulbapedia has it, its rows are added; keep = no two sources agree, PokéAPI's stand. Written by scripts/nuzlocke/build.ts.",
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
