import "server-only";
import geo from "@/data/geo.json";
import answers from "@/data/hunt/answers.json";
import { artUrl } from "@/lib/pokemon/art";
import { isValidDailyDate } from "@/lib/daily";
import { dealHunt } from "@/lib/hunt/deal";
import { matchPins, type Point, type ScoreMap, type ScoreSpot } from "@/lib/hunt/score";
import { decryptJson, encryptJson, randomId, signToken, verifyToken } from "./crypto";
import {
  HUNT_DAILY_FROM,
  HUNT_MAX_ROUND_SCORE,
  HUNT_REGIONS,
  HUNT_REGION_OF_GEO,
  HUNT_ROUNDS,
  HUNT_TIMER_S,
  huntPinsFor,
  isHuntMapRegion,
  type HuntAnswerFile,
  type HuntEntry,
  type HuntGuessResponse,
  type HuntMapRegionId,
  type HuntPin,
  type HuntRegionId,
  type HuntResult,
  type HuntReveal,
  type HuntRoundPublic,
  type HuntSpec,
  type HuntSpot,
  type HuntStartResponse,
} from "@/lib/hunt/types";

/**
 * Pokémon Hunt on the server. The answer table never leaves here before a
 * round is graded: a round carries only the Pokémon and how many pins it
 * takes, the plan is sealed in a signed token (like PokéGuessr's), and every
 * guess is graded here.
 */

type Box = [number, number, number, number];
interface WorldFile {
  map: { width: number; height: number; squarePx: number };
  crops: Record<string, { name: string; box: Box }>;
  locations: { name: string; region?: string; parent?: string; pin?: [number, number]; mask?: [number, number][] }[];
}
const WORLD = (geo as unknown as { world: WorldFile }).world;
const W = WORLD.map.width;
const H = WORLD.map.height;
/** Full points within half a town-map square, as PokéGuessr. */
const PERFECT_PX = WORLD.map.squarePx * 0.5;
const STATE_TTL_MS = 3 * 60 * 60 * 1000;
/** A guess this long after the round's clock has run out scores nothing (PokéGuessr's grace: a reveal read in between, loading, the network). */
export const HUNT_TIMER_GRACE_MS = 3 * 60_000;

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
      spots.push({ region: p.region, area: place.area, name: p.name, geoRegion: p.geoRegion, labels: p.methods.map((m) => `${m.games} · ${m.method}`) });
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

/** The map a spec plays: its box in world pixels, and its scoring scale. */
function mapOf(spec: HuntSpec): { id: "world" | HuntMapRegionId; box: Box; score: ScoreMap } {
  const box: Box = spec.mode === "region" && spec.region && WORLD.crops[spec.region] ? WORLD.crops[spec.region].box : [0, 0, W, H];
  return { id: spec.mode === "region" && spec.region ? spec.region : "world", box, score: { diagonal: Math.hypot(box[2] - box[0], box[3] - box[1]), perfectPx: PERFECT_PX } };
}
/** A map's own 0–1 point → world pixels. */
const mapToPx = (box: Box, p: HuntPin): Point => [box[0] + p.x * (box[2] - box[0]), box[1] + p.y * (box[3] - box[1])];
/** World pixels → a map's own 0–1 point. */
const pxToMap = (box: Box, [x, y]: Point): [number, number] => [round5((x - box[0]) / (box[2] - box[0])), round5((y - box[1]) / (box[3] - box[1]))];
const round5 = (v: number) => Math.round(v * 100000) / 100000;

/** A spec's spots: every spot on the world map; only the region's own on a region's map. */
function spotsFor(spec: HuntSpec, loaded: Loaded): LoadedSpot[] {
  return spec.mode === "region" && spec.region ? loaded.spots.filter((s) => s.region === spec.region) : loaded.spots;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export interface HuntState {
  v: 1;
  sid: string;
  spec: HuntSpec;
  /** The rounds' entry ids, sealed. */
  plan: string;
  startedAt: number;
  /** When the current round was dealt. */
  roundAt: number;
  /** Each graded round: its points, regions found, pins it took. */
  log: [score: number, found: number, of: number][];
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
  return dealFor(spec, "check").length > 0;
}

function dealFor(spec: HuntSpec, seed: string, recent?: readonly string[]): HuntEntry[] {
  return dealHunt(TABLE.entries, seed, { mode: spec.mode, region: spec.region, rounds: HUNT_ROUNDS, recent });
}

function publicRound(spec: HuntSpec, index: number, loaded: Loaded): HuntRoundPublic {
  const regions = spec.mode === "region" ? 1 : loaded.entry.regions.length;
  return {
    index,
    id: loaded.entry.id,
    dex: loaded.entry.dex,
    name: loaded.entry.name,
    art: artUrl(loaded.entry.art, 400),
    regions,
    pins: huntPinsFor(regions, spec.mode),
  };
}

const seal = (ids: string[]) => encryptJson(ids, "hunt-plan");
const unseal = (plan: string) => decryptJson<string[]>(plan, "hunt-plan");

export type HuntStartOutcome = { ok: true; body: HuntStartResponse } | { ok: false; status: number; error: string };

export function startHunt(input: { mode: HuntSpec["mode"]; region?: HuntMapRegionId; date?: string; recent?: string[]; name?: string }, now = Date.now()): HuntStartOutcome {
  const spec: HuntSpec = { mode: input.mode };
  if (input.mode === "region") {
    if (!isHuntMapRegion(input.region)) return { ok: false, status: 400, error: "Pick a region." };
    spec.region = input.region;
  }
  if (input.mode === "daily") {
    const date = input.date ?? new Date(now).toISOString().slice(0, 10);
    if (!isHuntDailyDate(date, now)) return { ok: false, status: 400, error: "That Daily Hunt isn't open." };
    spec.daily = date;
  }
  const seed = spec.daily ? `hunt-daily:${spec.daily}` : randomId();
  const dealt = dealFor(spec, seed, spec.daily ? undefined : input.recent);
  if (dealt.length < HUNT_ROUNDS) return { ok: false, status: 409, error: "Not enough Pokémon to hunt on that map yet." };
  const state: HuntState = { v: 1, sid: randomId(), spec, plan: seal(dealt.map((e) => e.id)), startedAt: now, roundAt: now, log: [], ...(input.name ? { name: input.name } : {}) };
  const first = TABLE.byId.get(dealt[0].id)!;
  return {
    ok: true,
    body: {
      token: signToken("hunt", state),
      mode: spec.mode,
      map: mapOf(spec).id,
      rounds: HUNT_ROUNDS,
      timer: HUNT_TIMER_S,
      ...(spec.daily ? { daily: { date: spec.daily, number: huntDailyNumber(spec.daily) } } : {}),
      round: publicRound(spec, 0, first),
    },
  };
}

export function readHunt(token: unknown, now = Date.now()): HuntState | null {
  const state = verifyToken<HuntState>("hunt", token);
  if (!state || state.v !== 1 || now - state.startedAt > STATE_TTL_MS) return null;
  return state;
}

/** The fact line: the data's own, else one written from the places (nothing invented). */
function factOf(loaded: Loaded): string {
  if (loaded.entry.fact) return loaded.entry.fact;
  const { spots } = loaded;
  if (spots.length === 1) return `${loaded.entry.name} is only found in ${spots[0].name}.`;
  const regions = loaded.entry.regions.length;
  return regions === 1 ? `Every ${loaded.entry.name} in the wild lives in one region.` : `${loaded.entry.name} turns up in the wild across ${regions} regions.`;
}

export type HuntGuessOutcome = { ok: true; claimKey: string; body: HuntGuessResponse } | { ok: false; status: number; error: string };

export function gradeHunt(state: HuntState, guess: { pins: HuntPin[]; timeout?: boolean }, now = Date.now()): HuntGuessOutcome {
  const { spec } = state;
  if (spec.daily && !isHuntDailyDate(spec.daily, now)) return { ok: false, status: 409, error: "That Daily Hunt is over. Today's is waiting." };
  const ids = unseal(state.plan);
  if (!ids) return { ok: false, status: 401, error: "Game expired or invalid. Start a new one." };
  const index = state.log.length;
  if (index >= ids.length) return { ok: false, status: 409, error: "This game is already over." };
  const loaded = TABLE.byId.get(ids[index]);
  if (!loaded) return { ok: false, status: 409, error: "Pokémon Hunt was just updated. Start a new game." };

  const map = mapOf(spec);
  const round = publicRound(spec, index, loaded);
  const spots = spotsFor(spec, loaded);
  const elapsed = now - state.roundAt;
  const late = elapsed > HUNT_TIMER_S * 1000 + HUNT_TIMER_GRACE_MS;
  const pins = (late ? [] : guess.pins).slice(0, round.pins).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  const points = pins.map((p) => mapToPx(map.box, p));
  const matched = matchPins(map.score, points, spots, round.pins);
  const pinResults = matched.pins.map((m, i) => {
    const found = m.region !== null && huntRegionAt(points[i]) === m.region;
    return { pin: pins[i], region: m.region, spot: m.spot, distancePx: Number.isFinite(m.distancePx) ? m.distancePx : -1, score: m.score, found };
  });
  const found = pinResults.filter((p) => p.found).length;
  const score = matched.total;

  const revealSpots: HuntSpot[] = spots.map((s) => ({
    region: s.region,
    name: s.name,
    pin: pxToMap(map.box, PLACES.get(`${s.geoRegion}|${s.name}`)!.at),
    mask: s.area.map((p) => pxToMap(map.box, p)),
    labels: s.labels,
  }));
  const reveal: HuntReveal = {
    id: loaded.entry.id,
    name: loaded.entry.name,
    spots: revealSpots,
    regions: spec.mode === "region" && spec.region ? [spec.region] : loaded.entry.regions,
    pins: pinResults,
    found,
    of: round.pins,
    fact: factOf(loaded),
    dex: `/pokemon/${loaded.entry.slug}#encounters`,
  };

  const next: HuntState = { ...state, log: [...state.log, [score, found, round.pins]], roundAt: now };
  const total = next.log.reduce((s, [x]) => s + x, 0);
  const done = next.log.length >= ids.length;
  let result: HuntResult | undefined;
  if (done) {
    result = {
      sid: state.sid,
      spec,
      score: total,
      max: ids.length * HUNT_MAX_ROUND_SCORE,
      rounds: next.log.map(([s, f, of], i) => {
        const e = TABLE.byId.get(ids[i])?.entry;
        return { id: ids[i], name: e?.name ?? "", art: e ? artUrl(e.art, 160) : "", score: s, found: f, of };
      }),
      durationMs: Math.max(1, now - state.startedAt),
    };
  }
  const nextLoaded = done ? undefined : TABLE.byId.get(ids[index + 1]);
  return {
    ok: true,
    claimKey: `hunt:${state.sid}:${index}`,
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
