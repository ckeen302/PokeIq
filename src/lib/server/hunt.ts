import "server-only";
import geo from "@/data/geo.json";
import answers from "@/data/hunt/answers.json";
import TYPES_JA from "@/data/i18n/ja/types.json";
import TYPES_ES from "@/data/i18n/es/types.json";
import TYPES_FR from "@/data/i18n/fr/types.json";
import TYPES_DE from "@/data/i18n/de/types.json";
import TYPES_IT from "@/data/i18n/it/types.json";
import { artUrl } from "@/lib/pokemon/art";
import { isValidDailyDate } from "@/lib/daily";
import { VERSION_BY_KEY, versionOrder } from "@/lib/pokemon/encounter-types";
import { dealHunt } from "@/lib/hunt/deal";
import { scorePin, type Point, type ScoreMap, type ScoreSpot } from "@/lib/hunt/score";
import { decryptJson, encryptJson, randomId, signToken, verifyToken } from "./crypto";
import {
  HUNT_DAILY_FROM,
  HUNT_HINTS,
  HUNT_HINT_COSTS,
  HUNT_LABEL_KIND,
  HUNT_MAX_ROUND_SCORE,
  HUNT_PLACE_KINDS,
  HUNT_REGIONS,
  HUNT_REGION_OF_GEO,
  HUNT_ROUNDS,
  HUNT_TIMER_S,
  huntAfterHints,
  huntScales,
  isHuntMapRegion,
  type HuntAnswerFile,
  type HuntDailyResult,
  type HuntDifficulty,
  type HuntEntry,
  type HuntGuessResponse,
  type HuntHint,
  type HuntHintKind,
  type HuntMapRegionId,
  type HuntPin,
  type HuntPlaceKind,
  type HuntRegionId,
  type HuntResult,
  type HuntReveal,
  type HuntRoundPublic,
  type HuntSpec,
  type HuntSpot,
  type HuntStartResponse,
} from "@/lib/hunt/types";

/**
 * Pokémon Hunt on the server. The answer table never leaves here before a round is graded: a round
 * carries only the Pokémon and the hints it offers, the plan is sealed in a signed token (like
 * PokéGuessr's), every hint and every guess is answered here, and a hint's cost comes off the round's
 * points here.
 */

type Box = [number, number, number, number];
interface WorldFile {
  map: { width: number; height: number; squarePx: number };
  crops: Record<string, { name: string; box: Box; regions: string[] }>;
  locations: { name: string; region?: string; parent?: string; pin?: [number, number]; mask?: [number, number][] }[];
}
const WORLD = (geo as unknown as { world: WorldFile }).world;
const W = WORLD.map.width;
const H = WORLD.map.height;
/** Full points within half a town-map square, as PokéGuessr. */
const PERFECT_PX = WORLD.map.squarePx * 0.5;
/** The curve's scale for a spot: its region's own map's diagonal. */
const SCALES = huntScales(WORLD.crops);
const SCORE_MAP: ScoreMap = { diagonal: (r) => SCALES[r], perfectPx: PERFECT_PX, squarePx: WORLD.map.squarePx };
const STATE_TTL_MS = 3 * 60 * 60 * 1000;
/** A guess this long after the round's clock has run out scores nothing (PokéGuessr's grace: a reveal read in between, loading, the network). */
export const HUNT_TIMER_GRACE_MS = 3 * 60_000;
/** A Daily's signed result can go on the board this long after it was played. */
export const HUNT_RESULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const toPx = ([x, y]: [number, number]): Point => [x * W, y * H];

/** Every pinned place on the world map, by "Region|Name", with its area in world pixels. */
const PLACES = new Map(
  WORLD.locations.flatMap((l) => (l.pin && l.mask && l.region && !l.parent ? [[`${l.region}|${l.name}`, { ...l, region: l.region, area: l.mask.map(toPx), at: toPx(l.pin) }] as const] : []))
);

/** The Hunt region a world point falls in: the nearest place's (as PokéGuessr's streak reads a pin's region). */
export function huntRegionAt(p: Point): HuntRegionId | null {
  let best: HuntRegionId | null = null;
  let bd = Infinity;
  for (const place of PLACES.values()) {
    for (const q of place.area) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < bd) [bd, best] = [d, HUNT_REGION_OF_GEO[place.region] ?? null];
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The answer table, checked once on load: every place must be a pinned place on the map
// ---------------------------------------------------------------------------

interface LoadedSpot extends ScoreSpot {
  name: string;
  geoRegion: string;
  labels: string[];
  methods: { games: string; method: string; versions: string[] }[];
}
interface Loaded {
  entry: HuntEntry;
  spots: LoadedSpot[];
}

function load(file: HuntAnswerFile): { entries: HuntEntry[]; byId: Map<string, Loaded>; problems: string[] } {
  const problems: string[] = [];
  const byId = new Map<string, Loaded>();
  for (const entry of file.entries) {
    const spots: LoadedSpot[] = [];
    for (const p of entry.places) {
      const place = PLACES.get(`${p.geoRegion}|${p.name}`);
      if (!place) {
        problems.push(`${entry.id}: ${p.name} (${p.geoRegion}) is not a pinned place on the map`);
        continue;
      }
      if (HUNT_REGION_OF_GEO[p.geoRegion] !== p.region) problems.push(`${entry.id}: ${p.name} is in ${p.geoRegion}, not ${p.region}`);
      spots.push({
        region: p.region,
        area: place.area,
        name: p.name,
        geoRegion: p.geoRegion,
        labels: p.methods.map((m) => `${m.games} · ${m.method}`),
        methods: p.methods.map((m) => ({ games: m.games, method: m.method, versions: m.versions })),
      });
    }
    // Rule 4: a Pokémon with any place off the map is never dealt.
    if (spots.length !== entry.places.length || !spots.length) continue;
    spots.sort((a, b) => HUNT_REGIONS.indexOf(a.region) - HUNT_REGIONS.indexOf(b.region) || a.name.localeCompare(b.name));
    byId.set(entry.id, { entry, spots });
  }
  return { entries: [...byId.values()].map((l) => l.entry), byId, problems };
}

const TABLE = load(answers as unknown as HuntAnswerFile);
/** Places in the table that aren't on the map (tests read this: it must be empty). */
export const huntTableProblems = (): readonly string[] => TABLE.problems;
export const huntEntries = (): readonly HuntEntry[] => TABLE.entries;
export const huntIsSample = () => !!(answers as unknown as HuntAnswerFile).sample;

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

/** The map a spec plays: its box in world pixels. */
function mapOf(spec: HuntSpec): { id: "world" | HuntMapRegionId; box: Box } {
  const box: Box = spec.mode === "region" && spec.region && WORLD.crops[spec.region] ? WORLD.crops[spec.region].box : [0, 0, W, H];
  return { id: spec.mode === "region" && spec.region ? spec.region : "world", box };
}
/** A map's own 0–1 point → world pixels. */
const mapToPx = (box: Box, p: HuntPin): Point => [box[0] + p.x * (box[2] - box[0]), box[1] + p.y * (box[3] - box[1])];
/** World pixels → a map's own 0–1 point. */
const pxToMap = (box: Box, [x, y]: Point): [number, number] => [round5((x - box[0]) / (box[2] - box[0])), round5((y - box[1]) / (box[3] - box[1]))];
const round5 = (v: number) => Math.round(v * 100000) / 100000;

/** A spec's spots: every spot on the world map; only the region's own on a region's map. */
function spotsFor(spec: HuntSpec, loaded: Loaded): LoadedSpot[] {
  if (spec.mode !== "region" || !spec.region) return loaded.spots;
  // Only the spots on the region's own map (its crop's places: Kanto's has no Sevii Islands).
  const on = WORLD.crops[spec.region]?.regions ?? [];
  return loaded.spots.filter((s) => s.region === spec.region && on.includes(s.geoRegion));
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export interface HuntState {
  v: 2;
  sid: string;
  spec: HuntSpec;
  /** The rounds' entry ids, sealed. */
  plan: string;
  startedAt: number;
  /** When the current round was dealt. */
  roundAt: number;
  /** The hints taken this round. */
  hints: HuntHintKind[];
  /** Each graded round: its points (after hints) and how many hints it took. */
  log: [score: number, hints: number][];
  name?: string;
}

/** The Daily Hunt's number: #1 on HUNT_DAILY_FROM. */
export function huntDailyNumber(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${HUNT_DAILY_FROM}T00:00:00Z`)) / 86_400_000) + 1;
}
export const isHuntDailyDate = (date: unknown, now = Date.now()): date is string => isValidDailyDate(date, now) && (date as string) >= HUNT_DAILY_FROM;

/** Whether a spec can be played (a region with enough Pokémon, a valid daily). */
export function isHuntPlayable(spec: HuntSpec): boolean {
  if (spec.mode === "region" && !isHuntMapRegion(spec.region)) return false;
  return dealFor(spec, "check").length >= HUNT_ROUNDS;
}

function dealFor(spec: HuntSpec, seed: string, recent?: readonly string[]): HuntEntry[] {
  return dealHunt(TABLE.entries, seed, { mode: spec.mode, region: spec.region, difficulty: spec.difficulty ?? "normal", rounds: HUNT_ROUNDS, recent });
}

/** The hints a spec offers: none on Hard. */
const hintsOf = (spec: HuntSpec): HuntHintKind[] => (spec.difficulty === "hard" ? [] : [...HUNT_HINTS]);

function publicRound(spec: HuntSpec, index: number, loaded: Loaded): HuntRoundPublic {
  return { index, id: loaded.entry.id, dex: loaded.entry.dex, name: loaded.entry.name, art: artUrl(loaded.entry.art, 400), hints: hintsOf(spec) };
}

const seal = (ids: string[]) => encryptJson(ids, "hunt-plan");
const unseal = (plan: string) => decryptJson<string[]>(plan, "hunt-plan");

export type HuntStartOutcome = { ok: true; body: HuntStartResponse } | { ok: false; status: number; error: string };

export interface HuntStartInput {
  mode: HuntSpec["mode"];
  region?: HuntMapRegionId;
  difficulty?: HuntDifficulty;
  date?: string;
  recent?: string[];
  name?: string;
  /** This device already started that Daily (its cookie): it plays, but never goes on the board. */
  repeat?: boolean;
}

export function startHunt(input: HuntStartInput, now = Date.now()): HuntStartOutcome {
  const spec: HuntSpec = { mode: input.mode };
  if (input.mode === "region") {
    if (!isHuntMapRegion(input.region)) return { ok: false, status: 400, error: "Pick a region." };
    spec.region = input.region;
  }
  if (input.mode === "daily") {
    const date = input.date ?? new Date(now).toISOString().slice(0, 10);
    if (!isHuntDailyDate(date, now)) return { ok: false, status: 400, error: "That Daily Hunt isn't open." };
    spec.daily = date;
    if (input.repeat) spec.practice = "repeat-daily";
  } else if (input.difficulty === "easy" || input.difficulty === "hard") {
    // Hard is the world map, no hints.
    if (input.difficulty === "hard" && input.mode === "region") return { ok: false, status: 400, error: "Hard is played on the world map." };
    spec.difficulty = input.difficulty;
  }
  const seed = spec.daily ? `hunt-daily:${spec.daily}` : randomId();
  const dealt = dealFor(spec, seed, spec.daily ? undefined : input.recent);
  if (dealt.length < HUNT_ROUNDS) return { ok: false, status: 409, error: "Not enough Pokémon to hunt on that map yet." };
  const state: HuntState = { v: 2, sid: randomId(), spec, plan: seal(dealt.map((e) => e.id)), startedAt: now, roundAt: now, hints: [], log: [], ...(input.name ? { name: input.name } : {}) };
  const first = TABLE.byId.get(dealt[0].id)!;
  return {
    ok: true,
    body: {
      token: signToken("hunt", state),
      mode: spec.mode,
      map: mapOf(spec).id,
      rounds: HUNT_ROUNDS,
      timer: HUNT_TIMER_S,
      difficulty: spec.difficulty ?? "normal",
      ...(spec.daily ? { daily: { date: spec.daily, number: huntDailyNumber(spec.daily) } } : {}),
      ...(spec.practice ? { practice: true } : {}),
      round: publicRound(spec, 0, first),
    },
  };
}

export function readHunt(token: unknown, now = Date.now()): HuntState | null {
  const state = verifyToken<HuntState>("hunt", token);
  if (!state || state.v !== 2 || now - state.startedAt > STATE_TTL_MS || !Array.isArray(state.hints)) return null;
  return state;
}

/** The single-use claim a round's grading takes (replay-guard). A hint taken on it is `<key>:hint:<kind>`. */
export const huntRoundKey = (state: HuntState): string => `hunt:${state.sid}:${state.log.length}`;
export const huntHintKey = (state: HuntState, kind: HuntHintKind): string => `${huntRoundKey(state)}:hint:${kind}`;

/** The fact line: the data's own, else one written from the places (nothing invented). */
function factOf(loaded: Loaded): string {
  if (loaded.entry.fact) return loaded.entry.fact;
  const { spots } = loaded;
  if (spots.length === 1) return `${loaded.entry.name} is only found in ${spots[0].name}.`;
  return `${loaded.entry.name} turns up in the wild in more than one place.`;
}

/** The round being played, or why there's none. */
function current(state: HuntState, now: number): { ok: true; ids: string[]; index: number; loaded: Loaded } | { ok: false; status: number; error: string } {
  if (state.spec.daily && !isHuntDailyDate(state.spec.daily, now)) return { ok: false, status: 409, error: "That Daily Hunt is over. Today's is waiting." };
  const ids = unseal(state.plan);
  if (!ids) return { ok: false, status: 401, error: "Game expired or invalid. Start a new one." };
  const index = state.log.length;
  if (index >= ids.length) return { ok: false, status: 409, error: "This game is already over." };
  const loaded = TABLE.byId.get(ids[index]);
  if (!loaded) return { ok: false, status: 409, error: "Pokémon Hunt was just updated. Start a new game." };
  return { ok: true, ids, index, loaded };
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

const TYPE_NAMES: Record<string, Record<string, string>> = { ja: TYPES_JA, es: TYPES_ES, fr: TYPES_FR, de: TYPES_DE, it: TYPES_IT };
const typeName = (type: string, locale: string) => TYPE_NAMES[locale]?.[type] ?? type[0].toUpperCase() + type.slice(1);

/** The games that come out as one (Red / Blue / Yellow): a version's set, for the games hint. */
const GAME_SETS: string[][] = [
  ["red", "blue", "yellow"],
  ["gold", "silver", "crystal"],
  ["ruby", "sapphire", "emerald"],
  ["firered", "leafgreen"],
  ["diamond", "pearl", "platinum"],
  ["heartgold", "soulsilver"],
  ["black", "white"],
  ["black-2", "white-2"],
  ["x", "y"],
  ["omega-ruby", "alpha-sapphire"],
  ["sun", "moon"],
  ["ultra-sun", "ultra-moon"],
  ["lets-go-pikachu", "lets-go-eevee"],
  ["sword", "shield"],
  ["brilliant-diamond", "shining-pearl"],
  ["scarlet", "violet"],
  ["legends-za"],
];

/** Every game a Pokémon's spots on this map come from, a set at a time, in release order ("Diamond / Pearl", "Sword / Shield"). */
export function huntGamesOf(spots: readonly { methods: { versions: string[] }[] }[]): string[] {
  const versions = new Set(spots.flatMap((s) => s.methods.flatMap((m) => m.versions)));
  const out: { at: number; name: string }[] = [];
  for (const set of GAME_SETS) {
    const have = set.filter((v) => versions.has(v));
    if (have.length) out.push({ at: versionOrder(have[0]), name: have.map((v) => VERSION_BY_KEY[v]?.name ?? v).join(" / ") });
  }
  // A version outside every set (a new game) still shows, on its own.
  for (const v of versions) if (!GAME_SETS.some((s) => s.includes(v))) out.push({ at: versionOrder(v), name: VERSION_BY_KEY[v]?.name ?? v });
  return out.sort((a, b) => a.at - b.at).map((g) => g.name);
}

/** The kinds of place a Pokémon's spots on this map are, from the ways it's met there. */
export function huntPlaceKindsOf(spots: readonly { methods: { method: string }[] }[]): HuntPlaceKind[] {
  const kinds = new Set(spots.flatMap((s) => s.methods.map((m) => HUNT_LABEL_KIND[m.method]).filter(Boolean)));
  return HUNT_PLACE_KINDS.filter((k) => kinds.has(k));
}

/** A hint for the round being played. The cost is charged when the round is graded (the token records the hint). */
export function hintFor(state: HuntState, kind: HuntHintKind, locale = "en", now = Date.now()): { ok: true; body: { token: string; hint: HuntHint; cost: number; hints: HuntHintKind[] } } | { ok: false; status: number; error: string } {
  if (!hintsOf(state.spec).includes(kind)) return { ok: false, status: 403, error: "Hard hunts have no hints." };
  const at = current(state, now);
  if (!at.ok) return at;
  const spots = spotsFor(state.spec, at.loaded);
  const hint: HuntHint =
    kind === "type"
      ? { kind, types: at.loaded.entry.types, names: at.loaded.entry.types.map((t) => typeName(t, locale)) }
      : kind === "place"
        ? { kind, kinds: huntPlaceKindsOf(spots) }
        : { kind, games: huntGamesOf(spots) };
  const hints = state.hints.includes(kind) ? state.hints : [...state.hints, kind];
  return { ok: true, body: { token: signToken("hunt", { ...state, hints } satisfies HuntState), hint, cost: HUNT_HINT_COSTS[kind], hints } };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export type HuntGuessOutcome = { ok: true; claimKey: string; body: HuntGuessResponse } | { ok: false; status: number; error: string };

/**
 * Grades the round being played. `taken`: hints the server knows were given on this round although this
 * token doesn't carry them (an older token sent after a hint): they're charged all the same.
 */
export function gradeHunt(state: HuntState, guess: { pins: HuntPin[]; timeout?: boolean }, now = Date.now(), taken: readonly HuntHintKind[] = []): HuntGuessOutcome {
  const { spec } = state;
  const at = current(state, now);
  if (!at.ok) return at;
  const { ids, index, loaded } = at;

  const map = mapOf(spec);
  const round = publicRound(spec, index, loaded);
  const spots = spotsFor(spec, loaded);
  const elapsed = now - state.roundAt;
  const late = elapsed > HUNT_TIMER_S * 1000 + HUNT_TIMER_GRACE_MS;
  const pins = (late ? [] : guess.pins).slice(0, 1).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  const point = pins[0] ? mapToPx(map.box, pins[0]) : null;
  const scored = scorePin(SCORE_MAP, point, spots);
  const hints = HUNT_HINTS.filter((h) => round.hints.includes(h) && (state.hints.includes(h) || taken.includes(h)));
  const score = huntAfterHints(scored.score, hints);
  const pinResults = pins.length
    ? [
        {
          pin: pins[0],
          region: scored.region,
          spot: scored.spot,
          distancePx: Number.isFinite(scored.distancePx) ? scored.distancePx : -1,
          squares: scored.squares,
          score: scored.score,
          found: scored.region !== null && !!point && huntRegionAt(point) === scored.region,
        },
      ]
    : [];

  const revealSpots: HuntSpot[] = spots.map((s) => ({
    region: s.region,
    name: s.name,
    pin: pxToMap(map.box, PLACES.get(`${s.geoRegion}|${s.name}`)!.at),
    mask: s.area.map((p) => pxToMap(map.box, p)),
    labels: s.labels,
    methods: s.methods.map((m) => ({ games: m.games, method: m.method })),
  }));
  const reveal: HuntReveal = {
    id: loaded.entry.id,
    name: loaded.entry.name,
    spots: revealSpots,
    regions: spec.mode === "region" && spec.region ? [spec.region] : loaded.entry.regions,
    pins: pinResults,
    hints,
    hintCost: hints.reduce((sum, h) => sum + HUNT_HINT_COSTS[h], 0),
    fact: factOf(loaded),
    dex: `/pokemon/${loaded.entry.slug}#encounters`,
  };

  const next: HuntState = { ...state, log: [...state.log, [score, hints.length]], roundAt: now, hints: [] };
  const total = next.log.reduce((s, [x]) => s + x, 0);
  const done = next.log.length >= ids.length;
  let result: HuntResult | undefined;
  if (done) {
    const durationMs = Math.max(1, now - state.startedAt);
    result = {
      sid: state.sid,
      spec,
      score: total,
      max: ids.length * HUNT_MAX_ROUND_SCORE,
      rounds: next.log.map(([s, h], i) => {
        const e = TABLE.byId.get(ids[i])?.entry;
        return { id: ids[i], name: e?.name ?? "", art: e ? artUrl(e.art, 160) : "", score: s, hints: h };
      }),
      durationMs,
    };
    // The Daily's first play on this device can go on its board: a signed result holding only the score.
    if (spec.daily && !spec.practice) {
      const signed: HuntDailyResult = { sid: state.sid, date: spec.daily, score: total, rounds: next.log.map(([s]) => s), durationMs, finishedAt: now };
      result.resultToken = signToken("hunt-result", signed);
    }
  }
  const nextLoaded = done ? undefined : TABLE.byId.get(ids[index + 1]);
  return {
    ok: true,
    claimKey: huntRoundKey(state),
    body: {
      score,
      total,
      ...(guess.timeout || late ? { timedOut: true } : {}),
      reveal,
      token: signToken("hunt", next),
      ...(nextLoaded ? { next: publicRound(spec, index + 1, nextLoaded) } : {}),
      done,
      ...(result ? { result } : {}),
    },
  };
}

/** A Daily's signed result, if it's genuine and recent enough for the board. */
export function readHuntResult(token: unknown, now = Date.now()): HuntDailyResult | null {
  const r = verifyToken<HuntDailyResult>("hunt-result", token);
  if (!r || typeof r.score !== "number" || !Array.isArray(r.rounds) || now - r.finishedAt > HUNT_RESULT_MAX_AGE_MS) return null;
  return r;
}
