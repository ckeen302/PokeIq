import { clampLevel, MODELLED_ITEMS, natureName } from "./sets";
import {
  ARENAS, CAMERA_MODES, DEFAULT_FIELD, DEFAULT_PLAYBACK, FORMATIONS, SPEEDS, TERRAINS, TYPE_NAMES, WEATHERS,
  type ArenaId, type ArmySpec, type BattleSpec, type CameraMode, type FieldSpec, type Formation, type GroupRule, type ItemPolicy,
  type PlaybackSpec, type Question, type RulesSpec, type SetChoice, type Terrain, type UnitSpec, type Weather,
} from "./types";

/**
 * Share links. A battle is `?b=` with everything that decides it, readable
 * at a glance and only in characters URLSearchParams leaves alone
 * (letters, digits, - . _ *):
 *
 *   ?b=2.100.plains.k3f9.0.swarm_rattata*1000.line_mewtwo*1
 *   ?b=2.50.colosseum.k3f9.rain-grassy-items.swarm-loose-boss_magikarp*60*l30.line-hold_arceus*1*ilifeorb*twater
 *   ?b=2.100.volcano.1.0.line_all-water-fe*5.line_all-fire-fe*10
 *
 * Version, everyone's level, arena, seed (base 36), the field (weather,
 * terrain, time of day, "items" for random-battle items, "pp" for Real PP,
 * "noff" for friendly fire off; 0 for none of them), then each side: its formation and any other ways it fights
 * (spacing, targeting, hold, single), then its rows, each `slug*count`
 * (or `all-<filters>*count` for a group: types, genN, legendary, mythical,
 * fe for fully evolved, nolegend) and any set choices: level l, moves m
 * (ids joined by -), ability a, item i (i0 for none), nature n, EVs e
 * (o for max offence, b for max bulk), Tera type t.
 *
 * A question is `?ask=` in the same shape, with the solver's settings
 * (the share of battles to win, in percent, and battles per size) in the
 * seed's place and the army's rows sharing its size:
 *
 *   ?ask=2.100.colosseum.50-40.0.swarm_magikarp*1.line_arceus*1
 *
 * How the battle is shown is `?v=` (speed, camera, numbers, nohud,
 * noslow). Version 1 links (`1.100.plains.k3f9.swarm.line.rattata*1000.
 * mewtwo*1`, `?ask=magikarp.arceus.100.plains`) still open. `?q=` stays the
 * render quality, as on the other 3D pages.
 */

export const MASS_BATTLE_PATH = "/lab/mass-battle";
/** Most units a side can have in a shared or hand-made battle (the view's largest cap; the solver goes beyond). */
export const MAX_SIDE = 10000;
/** Most rows a side can have in the sandbox (presets may have more). */
export const MAX_SPECIES = 4;
export const THRESHOLDS = [0.5, 0.9] as const;
export const RUN_CHOICES = [20, 40, 100, 200] as const;
export const DEFAULT_RUNS = 40;

export interface SlugIndex {
  id(slug: string): number | undefined;
  slug(id: number): string | undefined;
}

const clampCount = (n: number) => Math.max(1, Math.min(MAX_SIDE, Math.floor(n)));
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const TYPE_IDS = TYPE_NAMES.map((t) => t.toLowerCase());
const ITEM_BY_ID = new Map([...MODELLED_ITEMS].map((i) => [toId(i), i]));

/** A modelled item's name from its id or name ("" for none, undefined for unknown). */
export function itemName(s: string): string | undefined {
  if (s === "" || s === "0") return "";
  return ITEM_BY_ID.get(toId(s));
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const FIELD_WORDS = { weather: WEATHERS.filter((w) => w !== "none"), terrain: TERRAINS.filter((t) => t !== "none"), time: ["dusk", "night"] };

function encodeField(field: FieldSpec | undefined, items: ItemPolicy | undefined, rules?: RulesSpec): string {
  const f = field ?? DEFAULT_FIELD;
  const words = [f.weather !== "none" ? f.weather : "", f.terrain !== "none" ? f.terrain : "", f.time !== "day" ? f.time : "", items === "sets" ? "items" : "", rules?.pp ? "pp" : "", rules?.friendlyFire === false ? "noff" : ""].filter(Boolean);
  return words.length ? words.join("-") : "0";
}

function decodeField(text: string): { field: FieldSpec; items: ItemPolicy; rules: RulesSpec } | null {
  const field: FieldSpec = { ...DEFAULT_FIELD };
  let items: ItemPolicy = "none";
  const rules: RulesSpec = {};
  if (text === "0" || text === "") return { field, items, rules };
  for (const w of text.split("-")) {
    if ((FIELD_WORDS.weather as string[]).includes(w)) field.weather = w as Weather;
    else if ((FIELD_WORDS.terrain as string[]).includes(w)) field.terrain = w as Terrain;
    else if (w === "dusk" || w === "night") field.time = w;
    else if (w === "items") items = "sets";
    else if (w === "pp") rules.pp = true;
    else if (w === "noff") rules.friendlyFire = false;
    else return null;
  }
  return { field, items, rules };
}

function encodeBehaviour(a: ArmySpec): string {
  const words: string[] = [a.formation];
  if (a.spacing && a.spacing !== "normal") words.push(a.spacing);
  if (a.targeting && a.targeting !== "nearest") words.push(a.targeting);
  if (a.stance === "hold") words.push("hold");
  if (a.spread === "never") words.push("single");
  return words.join("-");
}

function decodeBehaviour(text: string): Omit<ArmySpec, "units"> | null {
  const [form, ...rest] = text.split("-");
  if (!FORMATIONS.includes(form as Formation)) return null;
  const out: Omit<ArmySpec, "units"> = { formation: form as Formation };
  for (const w of rest) {
    if (w === "tight" || w === "loose") out.spacing = w;
    else if (w === "weakest" || w === "strongest" || w === "boss") out.targeting = w;
    else if (w === "hold") out.stance = "hold";
    else if (w === "single") out.spread = "never";
    else return null;
  }
  return out;
}

function encodeGroup(g: GroupRule): string {
  const words = ["all", ...(g.types ?? [])];
  if (g.gen) words.push(`gen${g.gen}`);
  if (g.legendary === true) words.push("legendary");
  if (g.mythical) words.push("mythical");
  if (g.legendary === "no") words.push("nolegend");
  if (g.fullyEvolved) words.push("fe");
  return words.join("-");
}

function decodeGroup(text: string): GroupRule | null {
  const words = text.split("-");
  if (words[0] !== "all") return null;
  const g: GroupRule = {};
  for (const w of words.slice(1)) {
    if (TYPE_IDS.includes(w)) {
      g.types = [...(g.types ?? []), w];
      if (g.types.length > 2) return null;
    } else if (/^gen[1-9]$/.test(w)) g.gen = Number(w.slice(3));
    else if (w === "legendary") g.legendary = true;
    else if (w === "mythical") g.mythical = true;
    else if (w === "nolegend") g.legendary = "no";
    else if (w === "fe") g.fullyEvolved = true;
    else return null;
  }
  return g;
}

function encodeSet(set: SetChoice | undefined): string[] {
  if (!set) return [];
  const out: string[] = [];
  if (set.level !== undefined) out.push(`l${clampLevel(set.level)}`);
  if (set.moves?.length) out.push(`m${set.moves.map(toId).filter(Boolean).slice(0, 4).join("-")}`);
  if (set.ability) out.push(`a${toId(set.ability)}`);
  if (set.item !== undefined) out.push(`i${set.item ? toId(set.item) : "0"}`);
  if (set.nature) out.push(`n${toId(set.nature)}`);
  if (set.evs && set.evs !== "random") out.push(`e${set.evs === "offence" ? "o" : "b"}`);
  if (set.tera) out.push(`t${toId(set.tera)}`);
  return out;
}

function decodeSet(fields: string[]): SetChoice | undefined {
  const set: SetChoice = {};
  for (const f of fields) {
    const k = f[0], v = f.slice(1);
    if (!/^[a-z0-9-]*$/.test(v)) continue;
    if (k === "l" && /^\d{1,3}$/.test(v)) set.level = clampLevel(Number(v));
    else if (k === "m" && v) set.moves = v.split("-").filter(Boolean).slice(0, 4);
    else if (k === "a" && v) set.ability = v;
    else if (k === "i") {
      const it = itemName(v);
      if (it !== undefined) set.item = it;
    } else if (k === "n" && v) set.nature = natureName(v);
    else if (k === "e") set.evs = v === "o" ? "offence" : v === "b" ? "bulk" : "random";
    else if (k === "t" && TYPE_IDS.includes(v)) set.tera = TYPE_NAMES[TYPE_IDS.indexOf(v)];
  }
  return Object.keys(set).length ? set : undefined;
}

function encodeUnit(u: UnitSpec, slugs: SlugIndex): string {
  const who = u.group ? encodeGroup(u.group) : slugs.slug(u.id) ?? "";
  return [`${who}*${Math.max(1, Math.floor(u.count))}`, ...encodeSet(u.set)].join("*");
}

function decodeUnit(text: string, slugs: SlugIndex): UnitSpec | null {
  const [who, count, ...rest] = text.split("*");
  if (!who || !/^\d{1,6}$/.test(count ?? "")) return null;
  const set = decodeSet(rest);
  if (who.startsWith("all-") || who === "all") {
    const group = decodeGroup(who);
    if (!group) return null;
    return { id: 0, count: clampCount(Number(count)), group, ...(set ? { set } : {}) };
  }
  if (!/^[a-z0-9-]+$/.test(who)) return null;
  const id = slugs.id(who);
  if (id === undefined) return null;
  return { id, count: clampCount(Number(count)), ...(set ? { set } : {}) };
}

function encodeSide(a: ArmySpec, slugs: SlugIndex): string {
  return [encodeBehaviour(a), ...a.units.map((u) => encodeUnit(u, slugs))].join("_");
}

/** A side from its link text, rows merged by species and capped (null if anything in it is off). */
function decodeSide(text: string, slugs: SlugIndex, maxRows: number): ArmySpec | null {
  const [head, ...rows] = text.split("_");
  const behaviour = decodeBehaviour(head ?? "");
  if (!behaviour || !rows.length) return null;
  const units: UnitSpec[] = [];
  for (const r of rows) {
    const u = decodeUnit(r, slugs);
    if (!u) return null;
    const same = !u.group && !u.set ? units.find((x) => !x.group && !x.set && x.id === u.id) : undefined;
    if (same) same.count = clampCount(same.count + u.count);
    else units.push(u);
  }
  if (units.length > maxRows) return null;
  capSide(units);
  return { ...behaviour, units };
}

/** A side's single species stay within the cap (a group's count is per species, capped on its own). */
function capSide(units: UnitSpec[]) {
  const total = units.reduce((a, u) => a + (u.group ? 0 : u.count), 0);
  if (total > MAX_SIDE) {
    const k = MAX_SIDE / total;
    for (const u of units) if (!u.group) u.count = Math.max(1, Math.floor(u.count * k));
  }
}

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

export function encodeBattle(spec: BattleSpec, slugs: SlugIndex): string {
  return ["2", clampLevel(spec.level), spec.arena, (spec.seed >>> 0).toString(36), encodeField(spec.field, spec.items, spec.rules), encodeSide(spec.sides[0], slugs), encodeSide(spec.sides[1], slugs)].join(".");
}

/** A battle from its link (version 1 or 2), or null if anything in it is off (an unknown Pokémon, a bad number…). */
export function decodeBattle(code: string | null | undefined, slugs: SlugIndex, maxRows = 64): BattleSpec | null {
  if (!code) return null;
  const parts = code.split(".");
  if (parts[0] === "1") return decodeBattleV1(parts, slugs, maxRows);
  if (parts.length !== 7 || parts[0] !== "2") return null;
  if (!/^\d{1,3}$/.test(parts[1])) return null;
  const level = clampLevel(Number(parts[1]));
  const arena = parts[2] as ArenaId;
  if (!ARENAS.includes(arena)) return null;
  if (!/^[0-9a-z]{1,7}$/.test(parts[3])) return null;
  const seed = parseInt(parts[3], 36) >>> 0;
  const fi = decodeField(parts[4]);
  if (!fi) return null;
  const a = decodeSide(parts[5], slugs, maxRows), b = decodeSide(parts[6], slugs, maxRows);
  if (!a || !b) return null;
  const spec: BattleSpec = { sides: [a, b], level, arena, seed };
  if (fi.field.weather !== "none" || fi.field.terrain !== "none" || fi.field.time !== "day") spec.field = fi.field;
  if (fi.items === "sets") spec.items = "sets";
  if (fi.rules.pp || fi.rules.friendlyFire === false) spec.rules = fi.rules;
  return spec;
}

/** Version 1: `1.100.plains.k3f9.swarm.line.rattata*1000.mewtwo*1` (level 50 or 100, one formation each, species and counts). */
function decodeBattleV1(parts: string[], slugs: SlugIndex, maxRows: number): BattleSpec | null {
  if (parts.length !== 8) return null;
  const level = Number(parts[1]);
  if (level !== 50 && level !== 100) return null;
  const arena = parts[2] as ArenaId;
  if (!ARENAS.includes(arena)) return null;
  if (!/^[0-9a-z]{1,7}$/.test(parts[3])) return null;
  const seed = parseInt(parts[3], 36) >>> 0;
  const forms = [parts[4], parts[5]] as Formation[];
  if (!forms.every((f) => FORMATIONS.includes(f))) return null;
  const side = (text: string) => {
    if (!text) return null;
    const units: UnitSpec[] = [];
    for (const u of text.split("_")) {
      const m = /^([a-z0-9-]+)\*(\d{1,6})$/.exec(u);
      if (!m) return null;
      const id = slugs.id(m[1]);
      if (id === undefined) return null;
      const prev = units.find((x) => x.id === id);
      if (prev) prev.count = clampCount(prev.count + Number(m[2]));
      else units.push({ id, count: clampCount(Number(m[2])) });
    }
    if (!units.length || units.length > maxRows) return null;
    capSide(units);
    return units;
  };
  const a = side(parts[6]), b = side(parts[7]);
  if (!a || !b) return null;
  // Version 1 battles held their random-battle items: they open as they were.
  return { sides: [{ units: a, formation: forms[0] }, { units: b, formation: forms[1] }], level, arena, seed, items: "sets" };
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export const thresholdOf = (q: Pick<Question, "threshold">) => (q.threshold === 0.9 ? 0.9 : 0.5);
export const runsOf = (q: Pick<Question, "runs">) => (RUN_CHOICES as readonly number[]).includes(q.runs ?? DEFAULT_RUNS) ? (q.runs ?? DEFAULT_RUNS) : DEFAULT_RUNS;

export function encodeQuestion(q: Question, slugs: SlugIndex): string {
  const solver = `${Math.round(thresholdOf(q) * 100)}-${runsOf(q)}`;
  const army: ArmySpec = { ...q.army, units: q.army.units.map((u) => ({ ...u, count: 1 })) };
  return ["2", clampLevel(q.level), q.arena, solver, encodeField(q.field, q.items, q.rules), encodeSide(army, slugs), encodeSide(q.boss, slugs)].join(".");
}

/** The key a question's battles are seeded by: everything that decides them, but not how many are played. */
export function questionKey(q: Question, slugs: SlugIndex): string {
  const parts = encodeQuestion(q, slugs).split(".");
  parts[3] = "";
  return parts.join(".");
}

export function decodeQuestion(code: string | null | undefined, slugs: SlugIndex): Question | null {
  if (!code) return null;
  const parts = code.split(".");
  if (parts[0] !== "2") return decodeQuestionV1(parts, slugs);
  if (parts.length !== 7) return null;
  if (!/^\d{1,3}$/.test(parts[1])) return null;
  const level = clampLevel(Number(parts[1]));
  const arena = parts[2] as ArenaId;
  if (!ARENAS.includes(arena)) return null;
  const sm = /^(50|90)-(\d{1,3})$/.exec(parts[3]);
  if (!sm) return null;
  const fi = decodeField(parts[4]);
  if (!fi) return null;
  const army = decodeSide(parts[5], slugs, MAX_SPECIES), boss = decodeSide(parts[6], slugs, MAX_SPECIES);
  if (!army || !boss) return null;
  const q: Question = { army: { ...army, units: army.units.map((u) => ({ ...u, count: 1 })) }, boss, level, arena, threshold: Number(sm[1]) / 100, runs: Number(sm[2]) };
  q.runs = runsOf(q);
  if (fi.field.weather !== "none" || fi.field.terrain !== "none" || fi.field.time !== "day") q.field = fi.field;
  if (fi.items === "sets") q.items = "sets";
  if (fi.rules.pp || fi.rules.friendlyFire === false) q.rules = fi.rules;
  return q;
}

/** Version 1: `magikarp.arceus.100.plains`. */
function decodeQuestionV1(parts: string[], slugs: SlugIndex): Question | null {
  const [c, b, lv = "100", arena = "plains"] = parts;
  const challenger = c ? slugs.id(c) : undefined;
  const boss = b ? slugs.id(b) : undefined;
  const level = Number(lv);
  if (parts.length > 4 || challenger === undefined || boss === undefined || (level !== 50 && level !== 100) || !ARENAS.includes(arena as ArenaId)) return null;
  return simpleQuestion(challenger, boss, level, arena as ArenaId);
}

/** "How many X beat Y?" with the defaults: X in a swarm, one Y in a line, no held items. */
export function simpleQuestion(challenger: number, boss: number, level = 100, arena: ArenaId = "plains"): Question {
  return { army: { formation: "swarm", units: [{ id: challenger, count: 1 }] }, boss: { formation: "line", units: [{ id: boss, count: 1 }] }, level, arena };
}

/** The battle a question plays with an army of `n` (its rows share it evenly, the first rows taking any remainder). */
export function questionSpec(q: Question, n: number, seed: number): BattleSpec {
  const rows = q.army.units.length || 1;
  const units = q.army.units.map((u, k) => ({ ...u, count: Math.floor(n / rows) + (k < n % rows ? 1 : 0) })).filter((u) => u.count > 0);
  const spec: BattleSpec = { sides: [{ ...q.army, units }, q.boss], level: q.level, arena: q.arena, seed };
  if (q.field) spec.field = q.field;
  if (q.items) spec.items = q.items;
  if (q.rules) spec.rules = q.rules;
  return spec;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export function encodePlayback(p: PlaybackSpec): string {
  const words: string[] = [];
  if (p.speed !== 1) words.push(String(p.speed));
  if (p.camera !== "director") words.push(p.camera);
  if (p.numbers) words.push("numbers");
  if (!p.hud) words.push("nohud");
  if (!p.slowmo) words.push("noslow");
  return words.join("-");
}

export function decodePlayback(code: string | null | undefined): PlaybackSpec {
  const p: PlaybackSpec = { ...DEFAULT_PLAYBACK };
  if (!code) return p;
  for (const w of code.split("-")) {
    const n = Number(w);
    if ((SPEEDS as readonly number[]).includes(n)) p.speed = n;
    else if ((CAMERA_MODES as string[]).includes(w)) p.camera = w as CameraMode;
    else if (w === "numbers") p.numbers = true;
    else if (w === "nohud") p.hud = false;
    else if (w === "noslow") p.slowmo = false;
  }
  return p;
}

const viewParam = (p?: PlaybackSpec) => {
  const v = p ? encodePlayback(p) : "";
  return v ? `&v=${v}` : "";
};

export const battleHref = (spec: BattleSpec, slugs: SlugIndex, p?: PlaybackSpec) => `${MASS_BATTLE_PATH}?b=${encodeBattle(spec, slugs)}${viewParam(p)}`;
export const questionHref = (q: Question, slugs: SlugIndex, p?: PlaybackSpec) => `${MASS_BATTLE_PATH}?ask=${encodeQuestion(q, slugs)}${viewParam(p)}`;

/** A fresh seed for a new battle. */
export const newSeed = () => (Math.floor(Math.random() * 2 ** 32) >>> 0) % 36 ** 6;
