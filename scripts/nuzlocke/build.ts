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
import { ALIASES, BULBA_PAGES, type Alias } from "./lib/aliases";
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

/* ------------------------------------------------------------------------------------------------------- areas -- */

interface Acc {
  key: string;
  /** Candidate names by source, first seen first. */
  names: { src: Row["src"] | "alias"; name: string }[];
  rows: Row[];
}

function aliasOf(game: string, place: string, sub?: string): Alias | undefined {
  const al = ALIASES[game] ?? {};
  return (sub ? al[placeKey(`${place} ${sub}`)] : undefined) ?? al[placeKey(place)];
}

/* ----------------------------------------------------------------------------------------------------- helpers -- */

/** The area a walkthrough heading names: "Route 2 (West)", "One Island (Town)" and "Route 4" all name their place. */
function keyOfHead(name: string, keys: { has(k: string): boolean }): string | undefined {
  const tries = [name, name.replace(/\s*\([^)]*\)\s*$/, ""), name.replace(/^(VS|Battle|Exploring) /i, "")];
  for (const t of tries) {
    const k = placeKey(t);
    if (keys.has(k)) return k;
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
    ser = serebiiToRows((await locRows(cfg.serebiiLoc)).filter((r) => versions.includes(r.ver)));
    sources.add(`https://www.serebii.net/${{ rby: "pokedex", gs: "pokedex-gs", rs: "pokedex-rs", dp: "pokedex-dp", bw: "pokedex-bw", xy: "pokedex-xy", sm: "pokedex-sm" }[cfg.serebiiLoc]}/location/`);
  }
  for (const r of api) add(r);
  // Serebii rows are kept aside: they only enter through the cross-check below (or where PokéAPI has no such area).
  const serByArea = new Map<string, Row[]>();
  for (const r of ser) {
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
      for (const r of srows) add(r);
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
        if (resolution === "add") for (const r of srows) if (r.ver === ver && r.species === sp && comparable(r)) add(r);
      }
    }
  }
  for (const a of accs.values()) a.rows = a.rows.filter((r) => !dropped.has(r));

  // ---- starters: the walkthrough's "First partner" table rows, in the area its heading names
  const starters = new Set<string>();
  for (const c of wt.catches) {
    if (!cfg.bulba.includes(c.row.tpl) || !/first partner|starter/i.test(`${c.row.method} ${c.row.div ?? ""}`)) continue;
    const k = [...c.row.heads].reverse().map((h) => keyOfHead(h, accs)).find(Boolean);
    if (k) starters.add(`${k}|${c.row.species}`);
    else notes.push(`walkthrough starter ${speciesName(c.row.species)} under [${c.row.heads.join(" > ")}] names no area`);
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
    report: {
      areas: areas.size,
      encounters: [...areas.values()].reduce((n, a) => n + a.encounters.length, 0),
      bosses: bossReport,
      unplaced,
      disagreements: disagreements.length,
      unresolved: disagreements.filter((d) => d.resolution === "unresolved").length,
      auditDropped: audit.filter((x) => x.action === "drop").length,
      auditNotListed: audit.filter((x) => x.action === "keep").length,
      noBulbapediaPage: [...accs.values()].filter((a) => !bulba.get(a.key)?.length).map((a) => displayName(a)),
      notes,
    },
  };
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
      const k = keyOfHead(e.name, areas);
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
  const log: Record<string, { disagreements: Disagreement[]; bulbapedia: Audit[] }> = fs.existsSync(CROSSCHECK) ? JSON.parse(fs.readFileSync(CROSSCHECK, "utf8")).games ?? {} : {};
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  for (const id of ids) {
    const cfg = GAME_BY_ID.get(id);
    if (!cfg) throw new Error(`unknown game ${id}`);
    const t = Date.now();
    const b = await buildGame(cfg);
    fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(b.game));
    log[id] = { disagreements: b.disagreements, bulbapedia: b.audit };
    fs.writeFileSync(path.join(REPORT_DIR, `${id}.json`), JSON.stringify(b.report, null, 1));
    const r = b.report as { areas: number; encounters: number; bosses: unknown[]; disagreements: number; unresolved: number; auditDropped: number; auditNotListed: number; unplaced: string[] };
    console.log(
      `${id}: ${r.areas} areas, ${r.encounters} encounters, ${r.bosses.length} bosses, ${r.disagreements} disagreements (${r.unresolved} unresolved), Bulbapedia audit: ${r.auditDropped} dropped / ${r.auditNotListed} not listed, ${r.unplaced.length} in extra — ${((Date.now() - t) / 1000).toFixed(1)}s`,
    );
  }
  const ordered = Object.fromEntries(GAMES.filter((g) => log[g.id]).map((g) => [g.id, log[g.id]]));
  fs.writeFileSync(
    CROSSCHECK,
    JSON.stringify(
      {
        about:
          "Per game. disagreements: PokéAPI vs Serebii species disagreements per area and version, each settled by the game's table on Bulbapedia's location page (source): keep/drop = a PokéAPI row Bulbapedia lists / doesn't list; add/skip = a Serebii-only row Bulbapedia lists / doesn't list; unresolved = no Bulbapedia table, PokéAPI's data stands. bulbapedia: every other wild row Bulbapedia's table doesn't list for that version: drop = Bulbapedia lists the Pokémon there for no version of the game (e.g. an unreleased event table), keep = not on its table (both other sources list it). Written by scripts/nuzlocke/build.ts.",
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
