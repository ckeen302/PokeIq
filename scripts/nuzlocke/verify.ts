/**
 * Checks the Nuzlocke Tracker's game data (src/data/nuzlocke/*.json) and fails loudly on anything wrong.
 *
 *   npm run verify:nuzlocke
 *
 * Fails on: a game in NUZ_GAMES without a file, or a file without a NUZ_GAMES entry (unless the game is held back, see
 * HELD_BACK in lib/config.ts; its file is checked all the same); NUZ_GAMES out of release order or
 * out of step with the build's game list or its file; an empty `sources`; duplicate area ids; an area with no
 * encounters; an unknown version id; a species or form without art; a rate outside 0-100; a level range with min > max
 * (or outside 1-100); a boss cap below 1 or above 100; and malformed fields (kinds, forms without art ids, except the
 * location-dependent cosmetic forms of lib/forms.ts COSMETIC_FORMS, which have none…). A form whose
 * art isn't made yet is only allowed when scripts/nuzlocke/art-missing.json lists it (it is printed as a warning). Also a
 * condition on rows it can't belong to: a Max Raid den, Tera Raid, rod, Headbutt, Rock Smash or Honey condition on
 * another method; time-of-day, season or weather conditions in a game without them; "before" and "after" the Hall of
 * Fame at once; wiki markup or an HTML entity ("&#8209;") left in a condition. And any coverage the build lost (crosscheck.json coverageLosses: a place's Pokémon, version or water/land
 * way of meeting it that the merged sources had and the output dropped without a logged reason). And spelling: curly
 * quotes, or two names of a game (areas, parts, conditions) that differ only by case, spacing or punctuation. And the
 * story bosses (scripts/nuzlocke/story-bosses.json): an unknown anchor, a missing source, a badge (a story boss never
 * changes the badge count), one that isn't in the steps right after its anchor or not in the file's order; and a boss
 * step that repeats the one before it exactly.
 */
import fs from "node:fs";
import path from "node:path";
import type { EncounterKind, NuzArea, NuzGame } from "../../src/lib/nuzlocke/model";
import { NUZ_GAMES } from "../../src/lib/nuzlocke/games";
import { VERSIONS } from "../../src/lib/pokemon/encounter-types";
import { GAMES, HELD_BACK } from "./lib/config";
import { COSMETIC_FORMS } from "./lib/forms";
import { storyBosses, storyProblems } from "./lib/story-bosses";

const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "src/data/nuzlocke");
const ART = path.join(ROOT, "public/sizes/art/256");
const KINDS: EncounterKind[] = ["wild", "gift", "static", "trade", "egg", "fossil", "roaming"];
const KNOWN_VERSIONS = new Set(VERSIONS.map((v) => v.key));
const MAX_SPECIES = 1025;

const errors: string[] = [];
const fail = (where: string, msg: string) => errors.push(`${where}: ${msg}`);
const STORY = storyBosses();
for (const id of Object.keys(STORY)) if (!GAMES.some((c) => c.id === id)) fail("story-bosses.json", `unknown game ${id}`);
const hasArt = (id: number) => fs.existsSync(path.join(ART, `${id}.webp`));
/** Forms known to have no art yet (reported, kept in the data): form name -> PokéAPI pokemon id. Anything else without art fails. */
const ART_MISSING = JSON.parse(fs.readFileSync(path.join(__dirname, "art-missing.json"), "utf8")).forms as Record<string, number>;
const artMissingUsed = new Map<string, string[]>();

// ---- the game list
const files = fs.existsSync(DATA) ? fs.readdirSync(DATA).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")) : [];
for (const g of NUZ_GAMES) if (!files.includes(g.id)) fail("NUZ_GAMES", `${g.id} has no src/data/nuzlocke/${g.id}.json`);
for (const f of files) if (!NUZ_GAMES.some((g) => g.id === f) && !HELD_BACK.has(f)) fail(`src/data/nuzlocke/${f}.json`, "not in NUZ_GAMES (nor held back in scripts/nuzlocke/lib/config.ts)");
for (const g of NUZ_GAMES) if (HELD_BACK.has(g.id)) fail("NUZ_GAMES", `${g.id} is held back (scripts/nuzlocke/lib/config.ts HELD_BACK) but listed`);
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

// ---- conditions that only fit some methods or games
/** A condition naming a way of meeting Pokémon sits only on rows of that method. */
const COND_NEEDS: [RegExp, RegExp, string][] = [
  [/max raid|raid battle|raid den|pillar of light|wild area news|dynamax adventure/i, /raid|dynamax/i, "a Max Raid den condition"],
  [/tera raid/i, /tera raid/i, "a Tera Raid condition"],
  [/\b(old|good|super) rod\b/i, /rod|fish/i, "a fishing condition"],
  [/\bheadbutt\b/i, /headbutt/i, "a Headbutt condition"],
  [/\brock smash\b/i, /rock smash/i, "a Rock Smash condition"],
  [/\bhoney\b/i, /honey/i, "a Honey Tree condition"],
];
const TIME_PART = /^(Morning|Day|Night)(, (Morning|Day|Night))*$/;
const SEASON_PART = /^(Spring|Summer|Autumn|Winter)(, (Spring|Summer|Autumn|Winter))*$/;
const WEATHER_PART = /^During .*weather$|^During (a |an )?(snowstorm|sandstorm|thunderstorm|intense sun|fog)$/i;
const TIME_GAMES = new Set(["gold-silver", "crystal", "diamond-pearl", "platinum", "heartgold-soulsilver", "sun-moon", "ultra-sun-ultra-moon", "brilliant-diamond-shining-pearl"]);
const SEASON_GAMES = new Set(["black-white", "black-2-white-2"]);
const WEATHER_GAMES = new Set(["sword-shield"]);
function conditionProblems(game: string, kind: EncounterKind, method: string, cond: string): string[] {
  const out: string[] = [];
  // (A gift's condition may name what earns it: "Catch 5 Ultra Beasts in Dynamax Adventures".)
  if (kind === "wild" || kind === "static") for (const [c, m, what] of COND_NEEDS) if (c.test(cond) && !m.test(method)) out.push(`${what} ("${cond}") on a ${method} row`);
  const parts = cond.split("; ");
  if (parts.some((x) => TIME_PART.test(x)) && !TIME_GAMES.has(game)) out.push(`a time-of-day condition ("${cond}") in a game without time-of-day encounters`);
  if (parts.some((x) => SEASON_PART.test(x)) && !SEASON_GAMES.has(game)) out.push(`a season condition ("${cond}") in a game without seasons`);
  if (parts.some((x) => WEATHER_PART.test(x)) && !WEATHER_GAMES.has(game)) out.push(`a weather condition ("${cond}") in a game without weather encounters`);
  if (/\bBefore entering the Hall of Fame\b/.test(cond) && /\bEnter the Hall of Fame\b/.test(cond)) out.push(`contradictory story conditions ("${cond}")`);
  if (/&#?\w+;|\[\[|\]\]|\{\{|\}\}|'''/.test(cond)) out.push(`wiki markup or an HTML entity in a condition ("${cond}")`);
  return out;
}

// ---- coverage: the build logs, per game, what the merged sources had that its output lost other than by a logged
// drop (area, Pokémon, version, water or land); anything there is a bug
const CROSSCHECK = path.join(__dirname, "crosscheck.json");
const crossGames = fs.existsSync(CROSSCHECK) ? (JSON.parse(fs.readFileSync(CROSSCHECK, "utf8")).games as Record<string, { coverageLosses?: string[] }>) : {};
for (const [id, c] of Object.entries(crossGames)) {
  if (!files.includes(id)) continue;
  if (c.coverageLosses === undefined) fail(`crosscheck.json ${id}`, "no coverage check recorded (rebuild the game)");
  for (const k of c.coverageLosses ?? []) fail(`${id} coverage`, `the merged sources had ${k}, the output lost it`);
}
for (const f of files) if (!crossGames[f]) fail(`crosscheck.json`, `${f} has no entry (rebuild it)`);

// ---- spelling: straight apostrophes, and no two names of a game (areas, parts, conditions) that differ only by case,
// spacing or punctuation ("Hauoli outskirts" / "Hau'oli Outskirts")
function spellingProblems(id: string, g: NuzGame): string[] {
  const out: string[] = [];
  const byKey = new Map<string, Set<string>>();
  const note = (t: string, what: string) => {
    if (/[’‘“”]/.test(t)) out.push(`${what} "${t}" has a curly quote (use straight ones)`);
    const k = t.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!k) return;
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k)!.add(t);
  };
  const areas = [...g.steps.flatMap((s) => (s.type === "area" ? [s.area] : [])), ...g.extra];
  for (const a of areas) {
    note(a.name, "area name");
    for (const e of a.encounters) if (e.condition) for (const p of e.condition.split(/; | \/ /)) note(p, `${a.id} condition`);
  }
  for (const [, v] of byKey) if (v.size > 1) out.push(`names that differ only by case or punctuation: ${[...v].map((x) => `"${x}"`).join(", ")}`);
  return out.map((m) => `${id}: ${m}`);
}

// ---- each game (shipped ones, then held-back ones, checked the same way)
const totals: string[] = [];
const held = GAMES.filter((c) => HELD_BACK.has(c.id) && files.includes(c.id)).map((c) => ({ id: c.id, name: c.name, gen: c.gen, region: c.region, versions: c.versions }));
for (const info of [...NUZ_GAMES, ...held]) {
  const file = path.join(DATA, `${info.id}.json`);
  if (!fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, "utf8");
  const g = JSON.parse(raw) as NuzGame;
  const at = info.id;
  if (raw.includes("\n")) fail(at, "file is pretty-printed (keep it compact)");
  if (g.id !== info.id || g.name !== info.name || g.gen !== info.gen || g.region !== info.region || JSON.stringify(g.versions) !== JSON.stringify(info.versions)) fail(at, "id/name/gen/region/versions differ from NUZ_GAMES");
  const vids = g.versions.map((v) => v.id);
  for (const v of vids) if (!KNOWN_VERSIONS.has(v)) fail(at, `unknown version id ${v}`);
  for (const p of spellingProblems(at, g)) fail("spelling", p);
  if (!vids.length) fail(at, "no versions");
  if (!Array.isArray(g.sources) || !g.sources.length) fail(at, "empty sources");
  for (const s of g.sources ?? []) if (!/^https:\/\//.test(s)) fail(at, `source is not a URL: ${s}`);
  if (!Array.isArray(g.steps) || !Array.isArray(g.extra)) fail(at, "steps/extra missing");

  // Story bosses (scripts/nuzlocke/story-bosses.json): every anchor exists, every entry has its source and no badge
  // (a story boss never changes the badge count), and each one is in the steps at its anchor.
  const story = STORY[info.id] ?? [];
  const storyNames = new Set(story.map((e) => e.boss?.name));
  const baseSteps = g.steps.filter((s) => !(s.type === "boss" && storyNames.has(s.boss.name)));
  for (const p of storyProblems(info.id, story, baseSteps)) fail("story-bosses.json", p.msg);
  const badges = (steps: typeof g.steps) => steps.filter((s) => s.type === "boss" && s.boss.badge).length;
  if (badges(g.steps) !== badges(baseSteps)) fail(at, "story bosses change the badge count");
  // In the steps in the file's order, and no boss twice in a row.
  let lastAt = -1;
  for (const e of story) {
    const i = g.steps.findIndex((s, k) => k > lastAt && s.type === "boss" && s.boss.name === e.boss.name && s.boss.cap === e.boss.cap);
    if (i < 0) {
      fail(at, `story boss ${e.boss.name} is not in the steps after the one before it in the file (rebuild, or its anchor is out of story order)`);
      continue;
    }
    lastAt = i;
    // Its anchor comes before it, with only bosses between them.
    let j = i - 1;
    while (j >= 0 && g.steps[j].type === "boss" && !(e.afterBoss && (g.steps[j] as { boss: { name: string } }).boss.name === e.afterBoss)) j--;
    const anchor = g.steps[j];
    const ok = anchor && (e.after ? anchor.type === "area" && anchor.area.id === e.after : anchor.type === "boss" && anchor.boss.name === e.afterBoss);
    if (!ok) fail(at, `story boss ${e.boss.name} is not right after its anchor ${e.after ?? e.afterBoss}`);
  }

  g.steps.forEach((s, k) => {
    const prev = g.steps[k - 1];
    if (k && s.type === "boss" && prev.type === "boss" && JSON.stringify(s.boss) === JSON.stringify(prev.boss)) fail(at, `boss ${s.boss.name} twice in a row`);
  });

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
      // A location-dependent cosmetic form (East Sea Shellos) has no PokéAPI pokemon, so no art id: the species' art.
      if (e.form !== undefined && (!e.form || (e.art === undefined && !COSMETIC_FORMS.has(e.form)))) fail(what, "form without its art id");
      if (e.form && COSMETIC_FORMS.has(e.form) && e.art !== undefined) fail(what, "a cosmetic form with an art id");
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
      if (e.condition) for (const p of conditionProblems(info.id, e.kind, e.method, e.condition)) fail(what, p);
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
console.log(`\n✓ ${NUZ_GAMES.length} game(s) verified${held.length ? ` (+ ${held.length} held back, not in NUZ_GAMES: ${held.map((h) => h.id).join(", ")})` : ""}`);
