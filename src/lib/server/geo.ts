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
  WORLD_REGION,
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
  /** World data: the region the place is in (Isle of Armor, Kitakami, …). */
  region?: string;
  pin: [number, number];
  mask: [number, number][];
  shots: Shot[];
}
/** A town or city square drawn over the map: centre x, y and size, normalised, and 1 for a city. */
type Marker = [number, number, number, number, 0 | 1];
interface Region {
  id: string;
  name: string;
  map: { src: string; width: number; height: number; markers?: Marker[] };
  /** Map pixels per town-map square (distances are reported in squares). */
  squarePx: number;
  /** Map pixels within which a pin counts as spot on. Unset: a share of the map. */
  perfectPx?: number;
  locations: Location[];
}

type StoredLocation = Omit<Location, "pin" | "mask"> & Partial<Pick<Location, "pin" | "mask">>;
interface WorldData {
  map: { src: string; width: number; height: number; squarePx: number };
  /** Region maps cut from the world map: their box in world pixels and the atlas regions they play. */
  crops: Record<string, { name: string; regions: string[]; box: [number, number, number, number]; src: string }>;
  /** Town and city squares, in world pixels. */
  markers?: Marker[];
  locations: StoredLocation[];
}

const DATA = data as unknown as { storageBase?: string; regions: Region[]; world?: WorldData };
const STORAGE_BASE =
  DATA.storageBase ?? `${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/geo`;
const STATE_TTL_MS = 3 * 60 * 60 * 1000;
/** GeoGuessr's curve: 5000 · e^(−10 · d / D), with D the map diagonal. */
const FALLOFF = 10;
/** Town maps: inside (or within a whisker of) the highlighted area counts as perfect. */
const PERFECT_RADIUS = 0.012;
/** Streak mode on a region's map: a pin this close to the place keeps the streak alive. */
const STREAK_RADIUS = 0.035;
/** The town maps are drawn on an 8-pixel grid. */
const TOWN_MAP_SQUARE_PX = 8;
/** World and regional maps: within half a town-map square is spot on. */
const WORLD_PERFECT_SQUARES = 0.5;
/** Regions that count as one for world streaks (DLC areas belong to their region). */
const STREAK_GROUP: Record<string, string> = { "Isle of Armor": "Galar", "Crown Tundra": "Galar", "Blueberry Academy": "Unova" };
const groupOf = (region?: string) => (region ? (STREAK_GROUP[region] ?? region) : "");
/** A starting town per region, for the setup screen's preview picture. */
const HOME: Record<string, string> = {
  kanto: "Pallet Town",
  world: "Pallet Town",
  johto: "New Bark Town",
  hoenn: "Littleroot Town",
  sinnoh: "Twinleaf Town",
  unova: "Nuvema Town",
  kalos: "Vaniville Town",
  alola: "Iki Town",
  galar: "Postwick",
  paldea: "Cabo Poco",
};
/** 3D games: "classic" views. Everything else (Game Boy to DS sprites) is "retro". */
const CLASSIC_GAMES = new Set([
  "Let's Go, Pikachu! / Eevee!",
  "X / Y",
  "Omega Ruby / Alpha Sapphire",
  "Sun / Moon",
  "Ultra Sun / Ultra Moon",
  "Sun / Moon / Ultra Sun / Ultra Moon",
  "Sword / Shield",
  "Brilliant Diamond / Shining Pearl",
  "Scarlet / Violet",
  "Legends: Z-A",
]);

/** The world map, with buildings placed in (and sharing the area of) their parent place. */
function worldRegion(world: WorldData): Region {
  const byName = new Map(world.locations.filter((l) => l.pin).map((l) => [`${l.region}|${l.name}`, l]));
  const locations = world.locations.flatMap((l): Location[] => {
    const home = l.pin ? l : byName.get(`${l.region}|${l.parent}`);
    return home?.pin && home.mask ? [{ ...l, pin: home.pin, mask: home.mask }] : [];
  });
  const { squarePx, ...map } = world.map;
  const markers = (world.markers ?? []).map(([x, y, w, h, city]): Marker => [x / map.width, y / map.height, w / map.width, h / map.height, city]);
  return { id: WORLD_REGION, name: "World", map: { ...map, markers }, squarePx, perfectPx: squarePx * WORLD_PERFECT_SQUARES, locations };
}

/** A region's own map: a crop of the world map, with its places re-normalised to the crop. */
function cropRegion(world: Region, id: string, crop: WorldData["crops"][string]): Region {
  const [x0, y0, x1, y1] = crop.box;
  const { width: W, height: H } = world.map;
  const fx = (x: number) => Math.round(((x * W - x0) / (x1 - x0)) * 100000) / 100000;
  const fy = (y: number) => Math.round(((y * H - y0) / (y1 - y0)) * 100000) / 100000;
  const locations = world.locations
    .filter((l) => l.region && crop.regions.includes(l.region))
    .map((l) => ({ ...l, pin: [fx(l.pin[0]), fy(l.pin[1])] as [number, number], mask: l.mask.map(([x, y]) => [fx(x), fy(y)] as [number, number]) }));
  const markers = (world.map.markers ?? [])
    .map(([x, y, w, h, city]): Marker => [fx(x), fy(y), (w * W) / (x1 - x0), (h * H) / (y1 - y0), city])
    .filter(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1);
  return { ...world, id, name: crop.name, map: { src: crop.src, width: x1 - x0, height: y1 - y0, markers }, locations };
}

const REGIONS: Region[] = (() => {
  const out = DATA.regions.map((r) => ({ ...r, squarePx: TOWN_MAP_SQUARE_PX }));
  if (DATA.world) {
    const world = worldRegion(DATA.world);
    out.push(world, ...Object.entries(DATA.world.crops).map(([id, crop]) => cropRegion(world, id, crop)));
  }
  return out;
})();
const SHOT_IDS = new Set(REGIONS.flatMap((r) => r.locations.flatMap((l) => l.shots.map((s) => s.id))));

const isClassic = (shot: Shot) => CLASSIC_GAMES.has(shot.game);
const shotUrl = (id: string) => `/api/geo/shot/${id}`;
const shotsFor = (location: Location, style: GeoStyle) => location.shots.filter((s) => (style === "classic") === isClassic(s));
const regionOf = (id: string) => REGIONS.find((r) => r.id === id);
const poolFor = (spec: Pick<GeoSpec, "region" | "style">) =>
  (regionOf(spec.region)?.locations ?? []).filter((l) => shotsFor(l, spec.style).length);
/** A town or route with its buildings: one pin, so at most one round. */
const areaOf = (location: Location) => `${location.region}|${location.parent ?? location.name}`;
const areaCount = (spec: Pick<GeoSpec, "region" | "style">) => new Set(poolFor(spec).map(areaOf)).size;

/** Drops combined labels the others already cover ("Sun / Moon / Ultra Sun / Ultra Moon" next to "Sun / Moon" and "Ultra Sun / Ultra Moon"). */
function gameList(games: string[]): string[] {
  const parts = (game: string) => game.split(" / ");
  const covered = (game: string) =>
    parts(game).every((p) => games.some((other) => parts(other).length < parts(game).length && parts(other).includes(p)));
  return games.filter((game) => !covered(game));
}

export function geoRegions(): GeoRegionInfo[] {
  return REGIONS.map((r) => ({
    id: r.id,
    name: r.name,
    map: { ...r.map, pixelArt: r.squarePx === TOWN_MAP_SQUARE_PX },
    locations: Object.fromEntries(GEO_STYLES.map((style) => [style, areaCount({ region: r.id, style })])) as Record<GeoStyle, number>,
    games: Object.fromEntries(
      GEO_STYLES.map((style) => [style, gameList([...new Set(poolFor({ region: r.id, style }).flatMap((l) => shotsFor(l, style).map((s) => s.game)))])])
    ) as Record<GeoStyle, string[]>,
    previews: Object.fromEntries(
      GEO_STYLES.map((style) => {
        const home = r.locations.find((l) => l.name === HOME[r.id] && shotsFor(l, style).length) ?? poolFor({ region: r.id, style })[0];
        const shot = home ? shotsFor(home, style).at(-1) : undefined;
        return [style, shot ? shotUrl(shot.id) : null];
      })
    ) as Record<GeoStyle, string | null>,
  }));
}

export function isGeoSpec(spec: Pick<GeoSpec, "region" | "style" | "kind">): boolean {
  return GEO_STYLES.includes(spec.style) && GEO_KINDS.includes(spec.kind) && areaCount(spec) >= GEO_ROUNDS;
}

export function shotSource(id: string): string | null {
  return SHOT_IDS.has(id) ? `${STORAGE_BASE}/${id}.webp` : null;
}

interface PlannedRound {
  location: string;
  /** World data: the place's region (names repeat across regions: Route 1, Victory Road…). */
  region?: string;
  shot: string;
}

/**
 * The game's rounds: five for a standard game, every place for a streak.
 * One screenshot each in the chosen style, and no two rounds in the same
 * town (a building and its town would be the same pin). A five-round world
 * game visits five different regions, each equally likely.
 */
export function planRounds(spec: GeoSpec, seed: string): PlannedRound[] {
  const rng = new Rng(deriveSeed("geo", seed));
  const pool = rng.shuffle(poolFor(spec));
  const pick = (location: Location): PlannedRound => ({ location: location.name, region: location.region, shot: rng.pick(shotsFor(location, spec.style)).id });
  if (spec.region === WORLD_REGION && spec.kind === "game") {
    const groups = rng.shuffle([...new Set(pool.map((l) => groupOf(l.region)))]);
    if (groups.length >= GEO_ROUNDS) return groups.slice(0, GEO_ROUNDS).map((g) => pick(pool.find((l) => groupOf(l.region) === g)!));
  }
  const areas = new Set<string>();
  const rounds: PlannedRound[] = [];
  for (const location of pool) {
    const area = areaOf(location);
    if (areas.has(area)) continue;
    areas.add(area);
    rounds.push(pick(location));
    if (spec.kind === "game" && rounds.length === GEO_ROUNDS) break;
  }
  return rounds;
}

function lookup(spec: GeoSpec, round: PlannedRound) {
  const region = regionOf(spec.region)!;
  const location = region.locations.find((l) => l.name === round.location && l.region === round.region)!;
  return { region, location, shot: location.shots.find((s) => s.id === round.shot) ?? location.shots[0] };
}

/** Distance in map pixels from (x, y) to the nearest point of a location's area. */
function nearestPx(region: Region, location: Location, x: number, y: number): number {
  const { width, height } = region.map;
  let px = Infinity;
  for (const [mx, my] of location.mask) px = Math.min(px, Math.hypot((x - mx) * width, (y - my) * height));
  return px;
}

/** The region a pin on the world map falls in: the region of the nearest place. */
function regionAt(region: Region, x: number, y: number): string {
  let best = "";
  let bd = Infinity;
  for (const l of region.locations) {
    if (l.parent) continue;
    const d = nearestPx(region, l, x, y);
    if (d < bd) [bd, best] = [d, groupOf(l.region)];
  }
  return best;
}

/**
 * Distance from a guess at normalised (x, y) to the location's area, and its
 * score on GeoGuessr's curve. Streaks: on a region's map the pin has to land
 * on the place; on the world map, in the right region (like a country streak).
 */
export function measureGuess(spec: GeoSpec, round: PlannedRound, x: number, y: number) {
  const { region, location } = lookup(spec, round);
  const { width, height } = region.map;
  const diagonal = Math.hypot(width, height);
  const px = nearestPx(region, location, x, y);
  const perfect = px <= (region.perfectPx ?? PERFECT_RADIUS * diagonal);
  const score = perfect ? GEO_MAX_ROUND_SCORE : Math.round(GEO_MAX_ROUND_SCORE * Math.exp((-FALLOFF * px) / diagonal));
  const hit = region.id === WORLD_REGION ? regionAt(region, x, y) === groupOf(location.region) : px / diagonal <= STREAK_RADIUS;
  return { score, hit, squares: perfect ? 0 : Math.round((px / region.squarePx) * 10) / 10 };
}

export function answerFor(spec: GeoSpec, round: PlannedRound, squares = 0): GeoAnswer {
  const { location, shot } = lookup(spec, round);
  return { name: location.name, parent: location.parent, game: shot.game, pin: location.pin, mask: location.mask, squares, region: location.region };
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
