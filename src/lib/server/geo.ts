import "server-only";
import data from "@/data/geo.json";
import { Rng } from "@/lib/rng";
import { deriveSeed, randomId, signToken, verifyToken } from "./crypto";
import {
  GEO_MAX_ROUND_SCORE,
  GEO_ROUNDS,
  GEO_STYLES,
  type GeoAnswer,
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

const isClassic = (shot: Shot) => shot.game.startsWith("Let's Go");
const shotUrl = (id: string) => `/api/geo/shot/${id}`;
const shotsFor = (location: Location, style: GeoStyle) => location.shots.filter((s) => (style === "classic") === isClassic(s));

export function geoRegions(): GeoRegionInfo[] {
  return DATA.regions.map((r) => ({
    id: r.id,
    name: r.name,
    map: r.map,
    locations: Object.fromEntries(
      GEO_STYLES.map((style) => [style, r.locations.filter((l) => shotsFor(l, style).length).length])
    ) as Record<GeoStyle, number>,
    previews: Object.fromEntries(
      GEO_STYLES.map((style) => {
        const home = r.locations.find((l) => l.name === "Pallet Town");
        const shot = home ? shotsFor(home, style).at(-1) : undefined;
        return [style, shot ? shotUrl(shot.id) : null];
      })
    ) as Record<GeoStyle, string | null>,
  }));
}

export function isGeoSpec(spec: Pick<GeoSpec, "region" | "style">): boolean {
  const region = DATA.regions.find((r) => r.id === spec.region);
  return !!region && GEO_STYLES.includes(spec.style) && region.locations.filter((l) => shotsFor(l, spec.style).length).length >= GEO_ROUNDS;
}

export function shotSource(id: string): string | null {
  return SHOT_IDS.has(id) ? `${STORAGE_BASE}/${id}.webp` : null;
}

interface PlannedRound {
  location: string;
  shot: string;
}

/** The game's five rounds: distinct locations, one screenshot each in the chosen style. */
export function planRounds(spec: GeoSpec, seed: string): PlannedRound[] {
  const rng = new Rng(deriveSeed("geo", seed));
  const region = DATA.regions.find((r) => r.id === spec.region)!;
  const pool = region.locations.filter((l) => shotsFor(l, spec.style).length);
  return rng
    .shuffle(pool)
    .slice(0, GEO_ROUNDS)
    .map((l) => ({ location: l.name, shot: rng.pick(shotsFor(l, spec.style)).id }));
}

function lookup(spec: GeoSpec, round: PlannedRound) {
  const region = DATA.regions.find((r) => r.id === spec.region)!;
  const location = region.locations.find((l) => l.name === round.location)!;
  return { region, location, shot: location.shots.find((s) => s.id === round.shot) ?? location.shots[0] };
}

/** Score for a guess at normalised (x, y) on the region map. */
export function scoreGuess(spec: GeoSpec, round: PlannedRound, x: number, y: number): number {
  const { region, location } = lookup(spec, round);
  const { width, height } = region.map;
  let best = Infinity;
  for (const [mx, my] of location.mask) best = Math.min(best, Math.hypot((x - mx) * width, (y - my) * height));
  const d = best / Math.hypot(width, height);
  return d <= PERFECT_RADIUS ? GEO_MAX_ROUND_SCORE : Math.round(GEO_MAX_ROUND_SCORE * Math.exp(-FALLOFF * d));
}

export function answerFor(spec: GeoSpec, round: PlannedRound): GeoAnswer {
  const { location, shot } = lookup(spec, round);
  return { name: location.name, game: shot.game, pin: location.pin, mask: location.mask };
}

// ---------------------------------------------------------------------------
// Signed game state
// ---------------------------------------------------------------------------

export interface GeoState {
  v: 2;
  sid: string;
  spec: GeoSpec;
  seed: string;
  startedAt: number;
  /** One score per finished round. */
  log: number[];
}

export function startGeo(spec: GeoSpec): { token: string; round: GeoRoundPublic } {
  const seed = spec.daily ? `geo-daily:${spec.daily}` : randomId();
  const state: GeoState = { v: 2, sid: randomId(), spec, seed, startedAt: Date.now(), log: [] };
  const [first] = planRounds(spec, seed);
  return { token: signToken("geo", state), round: { index: 0, shot: shotUrl(first.shot) } };
}

export function readGeo(token: unknown): GeoState | null {
  const state = verifyToken<GeoState>("geo", token);
  if (!state || state.v !== 2 || Date.now() - state.startedAt > STATE_TTL_MS) return null;
  return isGeoSpec(state.spec) ? state : null;
}

export type GeoGuessOutcome =
  | { ok: true; claimKey: string; body: GeoGuessResponse }
  | { ok: false; status: number; error: string };

export function gradeGeo(state: GeoState, guess: { x: number; y: number }): GeoGuessOutcome {
  const rounds = planRounds(state.spec, state.seed);
  const index = state.log.length;
  if (index >= rounds.length) return { ok: false, status: 409, error: "This game is already over." };

  const round = rounds[index];
  const score = scoreGuess(state.spec, round, guess.x, guess.y);
  const next: GeoState = { ...state, log: [...state.log, score] };
  const total = next.log.reduce((s, x) => s + x, 0);
  const done = next.log.length >= rounds.length;
  const now = Date.now();

  let result: GeoResult | undefined;
  if (done) {
    result = {
      sid: state.sid,
      spec: state.spec,
      score: total,
      rounds: rounds.map((r, i) => ({ score: next.log[i], name: r.location })),
      durationMs: Math.max(1, now - state.startedAt),
      finishedAt: now,
    };
  }
  return {
    ok: true,
    claimKey: `geo:${state.sid}:${index}`,
    body: {
      score,
      answer: answerFor(state.spec, round),
      token: signToken("geo", next),
      total,
      next: done ? undefined : { index: index + 1, shot: shotUrl(rounds[index + 1].shot) },
      done,
      result,
      resultToken: result ? signToken("geo-result", result) : undefined,
    },
  };
}
