/**
 * Checks the Nuzlocke Tracker's game data (src/data/nuzlocke/*.json) and fails loudly on anything wrong.
 *
 *   npm run verify:nuzlocke
 *
 * Fails on: a game in NUZ_GAMES without a file, or a file without a NUZ_GAMES entry; NUZ_GAMES out of release order or
 * out of step with the build's game list or its file; an empty `sources`; duplicate area ids; an area with no
 * encounters; an unknown version id; a species or form without art; a rate outside 0-100; a level range with min > max
 * (or outside 1-100); a boss cap below 1 or above 100; and malformed fields (kinds, forms without art ids…). A form whose
 * art isn't made yet is only allowed when scripts/nuzlocke/art-missing.json lists it (it is printed as a warning).
 */
import fs from "node:fs";
import path from "node:path";
import type { EncounterKind, NuzArea, NuzGame } from "../../src/lib/nuzlocke/model";
import { NUZ_GAMES } from "../../src/lib/nuzlocke/games";
import { VERSIONS } from "../../src/lib/pokemon/encounter-types";
import { GAMES } from "./lib/config";

const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "src/data/nuzlocke");
const ART = path.join(ROOT, "public/sizes/art/256");
const KINDS: EncounterKind[] = ["wild", "gift", "static", "trade", "egg", "fossil", "roaming"];
const KNOWN_VERSIONS = new Set(VERSIONS.map((v) => v.key));
const MAX_SPECIES = 1025;

const errors: string[] = [];
const fail = (where: string, msg: string) => errors.push(`${where}: ${msg}`);
const hasArt = (id: number) => fs.existsSync(path.join(ART, `${id}.webp`));
/** Forms known to have no art yet (reported, kept in the data): form name -> PokéAPI pokemon id. Anything else without art fails. */
const ART_MISSING = JSON.parse(fs.readFileSync(path.join(__dirname, "art-missing.json"), "utf8")).forms as Record<string, number>;
const artMissingUsed = new Map<string, string[]>();

// ---- the game list
const files = fs.existsSync(DATA) ? fs.readdirSync(DATA).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")) : [];
for (const g of NUZ_GAMES) if (!files.includes(g.id)) fail("NUZ_GAMES", `${g.id} has no src/data/nuzlocke/${g.id}.json`);
for (const f of files) if (!NUZ_GAMES.some((g) => g.id === f)) fail(`src/data/nuzlocke/${f}.json`, "not in NUZ_GAMES");
const order = GAMES.map((g) => g.id);
let last = -1;
for (const g of NUZ_GAMES) {
  const i = order.indexOf(g.id);
  if (i < 0) fail("NUZ_GAMES", `${g.id} is not a game the build knows (scripts/nuzlocke/lib/config.ts)`);
  else if (i < last) fail("NUZ_GAMES", `${g.id} is out of release order`);
  last = Math.max(last, i);
  const cfg = GAMES.find((c) => c.id === g.id);
  if (cfg && JSON.stringify({ n: cfg.name, g: cfg.gen, r: cfg.region, v: cfg.versions }) !== JSON.stringify({ n: g.name, g: g.gen, r: g.region, v: g.versions })) fail("NUZ_GAMES", `${g.id} differs from the build's config`);
}
if (new Set(NUZ_GAMES.map((g) => g.id)).size !== NUZ_GAMES.length) fail("NUZ_GAMES", "duplicate game id");

// ---- each game
const totals: string[] = [];
for (const info of NUZ_GAMES) {
  const file = path.join(DATA, `${info.id}.json`);
  if (!fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, "utf8");
  const g = JSON.parse(raw) as NuzGame;
  const at = info.id;
  if (raw.includes("\n")) fail(at, "file is pretty-printed (keep it compact)");
  if (g.id !== info.id || g.name !== info.name || g.gen !== info.gen || g.region !== info.region || JSON.stringify(g.versions) !== JSON.stringify(info.versions)) fail(at, "id/name/gen/region/versions differ from NUZ_GAMES");
  const vids = g.versions.map((v) => v.id);
  for (const v of vids) if (!KNOWN_VERSIONS.has(v)) fail(at, `unknown version id ${v}`);
  if (!vids.length) fail(at, "no versions");
  if (!Array.isArray(g.sources) || !g.sources.length) fail(at, "empty sources");
  for (const s of g.sources ?? []) if (!/^https:\/\//.test(s)) fail(at, `source is not a URL: ${s}`);
  if (!Array.isArray(g.steps) || !Array.isArray(g.extra)) fail(at, "steps/extra missing");

  const areas: NuzArea[] = [...g.steps.filter((s) => s.type === "area").map((s) => (s as { area: NuzArea }).area), ...g.extra];
  const ids = new Set<string>();
  let encounters = 0;
  let bosses = 0;
  for (const s of g.steps) {
    if (s.type === "boss") {
      bosses++;
      const b = s.boss;
      if (!b.name?.trim()) fail(at, "boss without a name");
      if (b.cap !== undefined && (!Number.isInteger(b.cap) || b.cap < 1 || b.cap > 100)) fail(at, `boss ${b.name}: cap ${b.cap} outside 1-100`);
      for (const [v, c] of Object.entries(b.capByVersion ?? {})) {
        if (!vids.includes(v)) fail(at, `boss ${b.name}: capByVersion for unknown version ${v}`);
        if (!Number.isInteger(c) || c < 1 || c > 100) fail(at, `boss ${b.name}: ${v} cap ${c} outside 1-100`);
      }
    } else if (s.type !== "area") fail(at, `unknown step type ${(s as { type: string }).type}`);
  }
  for (const a of areas) {
    const where = `${at} / ${a.id}`;
    if (!a.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.id)) fail(where, "area id is not a slug");
    if (ids.has(a.id)) fail(where, "duplicate area id");
    ids.add(a.id);
    if (!a.name?.trim()) fail(where, "area without a name");
    if (!a.encounters?.length) fail(where, "area with no encounters");
    const sigs = new Set<string>();
    for (const e of a.encounters ?? []) {
      encounters++;
      const what = `${where} #${e.species}${e.form ? ` ${e.form}` : ""} ${e.method}`;
      if (!Number.isInteger(e.species) || e.species < 1 || e.species > MAX_SPECIES) fail(what, `species ${e.species} is not a national dex number`);
      if (!KINDS.includes(e.kind)) fail(what, `unknown kind ${e.kind}`);
      if (!e.method?.trim()) fail(what, "empty method");
      if (e.form !== undefined && (!e.form || e.art === undefined)) fail(what, "form without its art id");
      if (e.art !== undefined && e.form === undefined) fail(what, "art id without a form");
      const art = e.art ?? e.species;
      if (!hasArt(art)) {
        if (e.form && ART_MISSING[e.form] === art) artMissingUsed.set(e.form, [...new Set([...(artMissingUsed.get(e.form) ?? []), at])]);
        else fail(what, `no art: public/sizes/art/256/${art}.webp`);
      }
      if (e.versions !== undefined) {
        if (!e.versions.length) fail(what, "empty versions");
        for (const v of e.versions) if (!vids.includes(v)) fail(what, `unknown version id ${v}`);
        if (e.versions.length === vids.length) fail(what, "versions lists every version (omit it)");
      }
      if (e.rate !== undefined && (typeof e.rate !== "number" || !(e.rate > 0 && e.rate <= 100))) fail(what, `rate ${e.rate} outside 0-100`);
      if (e.levels !== undefined) {
        const [lo, hi] = e.levels;
        if (!Number.isInteger(lo) || !Number.isInteger(hi)) fail(what, `levels ${e.levels} not whole numbers`);
        if (lo > hi) fail(what, `levels ${lo}-${hi}: min > max`);
        if (lo < 1 || hi > 100) fail(what, `levels ${lo}-${hi} outside 1-100`);
      }
      if (e.condition !== undefined && !e.condition.trim()) fail(what, "empty condition");
      const sig = JSON.stringify(e);
      if (sigs.has(sig)) fail(what, "duplicate encounter");
      sigs.add(sig);
    }
  }
  if (!areas.length) fail(at, "no areas");
  totals.push(`${at}: ${areas.length} areas (${g.extra.length} extra), ${encounters} encounters, ${bosses} bosses`);
}

for (const [form, id] of Object.entries(ART_MISSING)) {
  if (hasArt(id)) fail("art-missing.json", `${form} (${id}) has art now: remove it from the list`);
  else if (!artMissingUsed.has(form)) fail("art-missing.json", `${form} is listed but no encounter uses it`);
}
for (const t of totals) console.log(t);
if (artMissingUsed.size) {
  console.warn(`\n⚠ ${artMissingUsed.size} form(s) have no art yet (listed in scripts/nuzlocke/art-missing.json; the encounters are kept):`);
  for (const [form, games] of artMissingUsed) console.warn(`  - ${form} (public/sizes/art/256/${ART_MISSING[form]}.webp) in ${games.join(", ")}`);
}
if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s):`);
  for (const e of errors.slice(0, 200)) console.error(`  - ${e}`);
  if (errors.length > 200) console.error(`  … and ${errors.length - 200} more`);
  process.exit(1);
}
console.log(`\n✓ ${NUZ_GAMES.length} game(s) verified`);
