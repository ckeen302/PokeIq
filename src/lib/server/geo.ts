import "server-only";
import data from "@/data/geo.json";
import { Rng } from "@/lib/rng";
import { deriveSeed, randomId, signToken, verifyToken } from "./crypto";
import {
  GEO_KINDS,
  GEO_MAX_ROUND_SCORE,
  GEO_ROUNDS,
  GEO_STYLES,
  type GeoAnswer,
  type GeoChallenge,
  type GeoGuessResponse,
  type GeoRegionInfo,
  type GeoResult,
  type GeoRoundPublic,
  type GeoSpec,
  type GeoStyle,
} from "@/lib/geo-types";

/**
 * PokéGuessr: GeoGuessr for the Pokémon world. Each round shows an in-game
 * screenshot; the player drops a pin on the region map. Rounds are a pure
 * function of a secret-derived seed, the state lives in a signed token, and
 * every guess is graded here, so the answer never reaches the browser early.
 */

interface Shot {
  id: string;
  game: string;
}
interface Location {
  name: string;
  /** Buildings and landmarks sit in a pinned town or route and share its area. */
  parent?: string;
  pin: [number, number];
  mask: [number, number][];
  shots: Shot[];
}
interface Region {
  id: string;
  name: string;
  map: { src: string; width: number; height: number };
  locations: Location[];
}

const DATA = data as unknown as { storageBase?: string; regions: Region[] };
const STORAGE_BASE =
  DATA.storageBase ?? `${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/geo`;
const SHOT_IDS = new Set(DATA.regions.flatMap((r) => r.locations.flatMap((l) => l.shots.map((s) => s.id))));
const STATE_TTL_MS = 3 * 60 * 60 * 1000;
/** Points fall off exponentially with distance as a share of the map diagonal. */
const FALLOFF = 8;
/** Inside (or within a whisker of) the highlighted area counts as perfect. */
const PERFECT_RADIUS = 0.012;
/** Streak mode: a pin this close to the place keeps the streak alive. */
const STREAK_RADIUS = 0.035;
/** The town maps are drawn on an 8-pixel grid. */
const MAP_SQUARE_PX = 8;

const isClassic = (shot: Shot) => shot.game.startsWith("Let's Go");
const shotUrl = (id: string) => `/api/geo/shot/${id}`;
const shotsFor = (location: Location, style: GeoStyle) => location.shots.filter((s) => (style === "classic") === isClassic(s));
const regionOf = (id: string) => DATA.regions.find((r) => r.id === id);
const poolFor = (spec: Pick<GeoSpec, "region" | "style">) =>
  (regionOf(spec.region)?.locations ?? []).filter((l) => shotsFor(l, spec.style).length);

export function geoRegions(): GeoRegionInfo[] {
  return DATA.regions.map((r) => ({
    id: r.id,
    name: r.name,
    map: r.map,
    locations: Object.fromEntries(GEO_STYLES.map((style) => [style, poolFor({ region: r.id, style }).length])) as Record<GeoStyle, number>,
    previews: Object.fromEntries(
      GEO_STYLES.map((style) => {
        const home = r.locations.find((l) => l.name === "Pallet Town");
        const shot = home ? shotsFor(home, style).at(-1) : undefined;
        return [style, shot ? shotUrl(shot.id) : null];
      })
    ) as Record<GeoStyle, string | null>,
  }));
}

export function isGeoSpec(spec: Pick<GeoSpec, "region" | "style" | "kind">): boolean {
  return GEO_STYLES.includes(spec.style) && GEO_KINDS.includes(spec.kind) && poolFor(spec).length >= GEO_ROUNDS;
}

export function shotSource(id: string): string | null {
  return SHOT_IDS.has(id) ? `${STORAGE_BASE}/${id}.webp` : null;
}

interface PlannedRound {
  location: string;
  shot: string;
}

/**
 * The game's rounds: five for a standard game, every place for a streak.
 * One screenshot each in the chosen style, and no two rounds in the same
 * town (a building and its town would be the same pin).
 */
export function planRounds(spec: GeoSpec, seed: string): PlannedRound[] {
  const rng = new Rng(deriveSeed("geo", seed));
  const areas = new Set<string>();
  const rounds: PlannedRound[] = [];
  for (const location of rng.shuffle(poolFor(spec))) {
    const area = location.parent ?? location.name;
    if (areas.has(area)) continue;
    areas.add(area);
    rounds.push({ location: location.name, shot: rng.pick(shotsFor(location, spec.style)).id });
    if (spec.kind === "game" && rounds.length === GEO_ROUNDS) break;
  }
  return rounds;
}

function lookup(spec: GeoSpec, round: PlannedRound) {
  const region = regionOf(spec.region)!;
  const location = region.locations.find((l) => l.name === round.location)!;
  return { region, location, shot: location.shots.find((s) => s.id === round.shot) ?? location.shots[0] };
}

/** Distance from a guess at normalised (x, y) to the location's area, and its score. */
export function measureGuess(spec: GeoSpec, round: PlannedRound, x: number, y: number) {
  const { region, location } = lookup(spec, round);
  const { width, height } = region.map;
  let px = Infinity;
  for (const [mx, my] of location.mask) px = Math.min(px, Math.hypot((x - mx) * width, (y - my) * height));
  const d = px / Math.hypot(width, height);
  const score = d <= PERFECT_RADIUS ? GEO_MAX_ROUND_SCORE : Math.round(GEO_MAX_ROUND_SCORE * Math.exp(-FALLOFF * d));
  return { score, hit: d <= STREAK_RADIUS, squares: d <= PERFECT_RADIUS ? 0 : Math.round((px / MAP_SQUARE_PX) * 10) / 10 };
}

export function answerFor(spec: GeoSpec, round: PlannedRound, squares = 0): GeoAnswer {
  const { location, shot } = lookup(spec, round);
  return { name: location.name, parent: location.parent, game: shot.game, pin: location.pin, mask: location.mask, squares };
}

// ---------------------------------------------------------------------------
// Signed game state
// ---------------------------------------------------------------------------

export interface GeoState {
  v: 3;
  sid: string;
  spec: GeoSpec;
  seed: string;
  startedAt: number;
  /** Trainer name, for the challenge link. */
  name?: string;
  /** One score per finished round (streaks: 1 per hit). */
  log: number[];
}

/** What a challenge link carries: the seed (so the same places come up) and the friend's result. */
interface ChallengeCard {
  s: string;
  r: string;
  y: GeoStyle;
  n: string;
  t: number;
  p: number[];
}

export function readGeoChallenge(token: unknown): (GeoChallenge & { seed: string; region: string }) | null {
  const card = verifyToken<ChallengeCard>("geo-challenge", token);
  if (!card || !GEO_STYLES.includes(card.y) || !regionOf(card.r)) return null;
  return { seed: card.s, region: card.r, style: card.y, name: card.n, score: card.t, rounds: card.p };
}

export function startGeo(spec: GeoSpec, opts: { seed?: string; name?: string } = {}): { token: string; round: GeoRoundPublic } {
  const seed = opts.seed ?? (spec.daily ? `geo-daily:${spec.daily}` : randomId());
  const state: GeoState = { v: 3, sid: randomId(), spec, seed, startedAt: Date.now(), name: opts.name, log: [] };
  const [first] = planRounds(spec, seed);
  return { token: signToken("geo", state), round: { index: 0, shot: shotUrl(first.shot) } };
}

export function readGeo(token: unknown): GeoState | null {
  const state = verifyToken<GeoState>("geo", token);
  if (!state || state.v !== 3 || Date.now() - state.startedAt > STATE_TTL_MS) return null;
  return isGeoSpec(state.spec) ? state : null;
}

export type GeoGuessOutcome =
  | { ok: true; claimKey: string; body: GeoGuessResponse }
  | { ok: false; status: number; error: string };

export function gradeGeo(state: GeoState, guess: { x: number; y: number }): GeoGuessOutcome {
  const { spec } = state;
  const rounds = planRounds(spec, state.seed);
  const index = state.log.length;
  const streak = spec.kind === "streak";
  const over = streak ? state.log.includes(0) || index >= rounds.length : index >= rounds.length;
  if (over) return { ok: false, status: 409, error: "This game is already over." };

  const round = rounds[index];
  const { score, hit, squares } = measureGuess(spec, round, guess.x, guess.y);
  const next: GeoState = { ...state, log: [...state.log, streak ? (hit ? 1 : 0) : score] };
  const total = next.log.reduce((s, x) => s + x, 0);
  const done = streak ? !hit || next.log.length >= rounds.length : next.log.length >= rounds.length;
  const now = Date.now();

  let result: GeoResult | undefined;
  let challengeToken: string | undefined;
  if (done) {
    result = {
      sid: state.sid,
      spec,
      score: total,
      rounds: next.log.map((s, i) => ({ score: s, name: rounds[i].location })),
      durationMs: Math.max(1, now - state.startedAt),
      finishedAt: now,
    };
    if (!streak) {
      const card: ChallengeCard = { s: state.seed, r: spec.region, y: spec.style, n: state.name ?? "", t: total, p: next.log };
      challengeToken = signToken("geo-challenge", card);
    }
  }
  return {
    ok: true,
    claimKey: `geo:${state.sid}:${index}`,
    body: {
      score,
      hit,
      answer: answerFor(spec, round, squares),
      token: signToken("geo", next),
      total,
      next: done ? undefined : { index: index + 1, shot: shotUrl(rounds[index + 1].shot) },
      done,
      result,
      resultToken: result ? signToken("geo-result", result) : undefined,
      challengeToken,
    },
  };
}
