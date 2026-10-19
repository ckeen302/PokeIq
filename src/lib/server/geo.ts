import "server-only";
import data from "@/data/geo.json";
import { Rng } from "@/lib/rng";
import { decryptJson, deriveSeed, encryptJson, randomId, signToken, verifyToken } from "./crypto";
import {
  GEO_KINDS,
  GEO_MAX_ROUND_SCORE,
  GEO_ROUNDS,
  type GeoAnswer,
  type GeoChallenge,
  type GeoGuessResponse,
  type GeoRegionInfo,
  type GeoResult,
  type GeoRoundPublic,
  type GeoSpec,
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
/** World-map pixels: left, top, right, bottom. */
type Box = [number, number, number, number];
interface Region {
  id: string;
  name: string;
  /** A picture of the map (for previews), its size, and where it sits on the world map (the atlas). */
  map: { src: string; width: number; height: number; box: Box };
  /** Map pixels per town-map square (distances are reported in squares). */
  squarePx: number;
  /** Map pixels within which a pin counts as spot on. */
  perfectPx: number;
  locations: Location[];
}

type StoredLocation = Omit<Location, "pin" | "mask"> & Partial<Pick<Location, "pin" | "mask">>;
interface WorldData {
  map: { src: string; width: number; height: number; squarePx: number };
  /** Region maps cut from the world map: their box in world pixels and the atlas regions they play. */
  crops: Record<string, { name: string; regions: string[]; box: Box; src: string }>;
  locations: StoredLocation[];
}

const DATA = data as unknown as { storageBase?: string; world: WorldData };
const STORAGE_BASE =
  DATA.storageBase ?? `${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/geo`;
const STATE_TTL_MS = 3 * 60 * 60 * 1000;
/** GeoGuessr's curve: 5000 · e^(−10 · d / D), with D the map diagonal. */
const FALLOFF = 10;
/** Streak mode on a region's map: a pin this close to the place keeps the streak alive. */
const STREAK_RADIUS = 0.035;
/** Within half a town-map square of the place is spot on. */
const PERFECT_SQUARES = 0.5;
/** Parts of a region that count as it in world games and streaks: DLC areas, and the Sevii Islands (Kanto's). */
const REGION_GROUP: Record<string, string> = { "Isle of Armor": "Galar", "Crown Tundra": "Galar", "Blueberry Academy": "Unova", "Sevii Islands": "Kanto" };
const groupOf = (region?: string) => (region ? (REGION_GROUP[region] ?? region) : "");
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
/**
 * Versions that share their graphics are one look of a place: a round picks
 * one of the place's looks (Red / Blue, FireRed, HeartGold, Let's Go…), then
 * a screenshot of it, so Emerald's and Ruby's shots don't crowd out the remakes.
 */
const LOOK: Record<string, string> = {
  "Red / Green / Blue / Yellow": "Red / Blue / Yellow",
  "Red / Blue": "Red / Blue / Yellow",
  Yellow: "Red / Blue / Yellow",
  "Gold / Silver": "Gold / Silver / Crystal",
  Crystal: "Gold / Silver / Crystal",
  "Ruby / Sapphire": "Ruby / Sapphire / Emerald",
  "Sapphire / Emerald": "Ruby / Sapphire / Emerald",
  Emerald: "Ruby / Sapphire / Emerald",
  "Diamond / Pearl": "Diamond / Pearl / Platinum",
  Platinum: "Diamond / Pearl / Platinum",
  "Black / White": "Black / White / Black 2 / White 2",
  "Black 2 / White 2": "Black / White / Black 2 / White 2",
  "Omega Ruby": "Omega Ruby / Alpha Sapphire",
  "Alpha Sapphire": "Omega Ruby / Alpha Sapphire",
  "Sun / Moon": "Sun / Moon / Ultra Sun / Ultra Moon",
  "Ultra Sun / Ultra Moon": "Sun / Moon / Ultra Sun / Ultra Moon",
};
const lookOf = (game: string) => LOOK[game] ?? game;

/** The world map, with buildings placed in (and sharing the area of) their parent place. */
function worldRegion(world: WorldData): Region {
  const byName = new Map(world.locations.filter((l) => l.pin).map((l) => [`${l.region}|${l.name}`, l]));
  const locations = world.locations.flatMap((l): Location[] => {
    const home = l.pin ? l : byName.get(`${l.region}|${l.parent}`);
    return home?.pin && home.mask ? [{ ...l, pin: home.pin, mask: home.mask }] : [];
  });
  const { squarePx, ...map } = world.map;
  return {
    id: WORLD_REGION,
    name: "World",
    map: { ...map, box: [0, 0, map.width, map.height] },
    squarePx,
    perfectPx: squarePx * PERFECT_SQUARES,
    locations,
  };
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
  return { ...world, id, name: crop.name, map: { src: crop.src, width: x1 - x0, height: y1 - y0, box: crop.box }, locations };
}

/** The world, then each region on its part of the world map. */
const REGIONS: Region[] = (() => {
  const world = worldRegion(DATA.world);
  return [world, ...Object.entries(DATA.world.crops).map(([id, crop]) => cropRegion(world, id, crop))];
})();

const shotUrl = (id: string) => `/api/geo/shot/${id}`;
const regionOf = (id: string) => REGIONS.find((r) => r.id === id);
/** A town or route with its buildings: one pin, so at most one round. */
const areaOf = (location: Pick<Location, "region" | "name" | "parent">) => `${location.region}|${location.parent ?? location.name}`;

/** A town or route and the buildings and landmarks in it, with screenshots. */
interface Area {
  key: string;
  group: string;
  place?: Location;
  buildings: Location[];
}

/** Each map's areas, in data order. */
const AREAS = new Map(
  REGIONS.map((r) => {
    const areas = new Map<string, Area>();
    for (const l of r.locations) {
      if (!l.shots.length) continue;
      const key = areaOf(l);
      const area = areas.get(key) ?? { key, group: groupOf(l.region), buildings: [] };
      if (l.parent) area.buildings.push(l);
      else area.place = l;
      areas.set(key, area);
    }
    return [r.id, [...areas.values()]];
  })
);
const areasOf = (region: string) => AREAS.get(region) ?? [];

/** Drops combined labels the others already cover ("Sun / Moon / Ultra Sun / Ultra Moon" next to "Sun / Moon" and "Ultra Sun / Ultra Moon"). */
function gameList(games: string[]): string[] {
  const parts = (game: string) => game.split(" / ");
  const covered = (game: string) =>
    parts(game).every((p) => games.some((other) => parts(other).length < parts(game).length && parts(other).includes(p)));
  return games.filter((game) => !covered(game));
}

/** Games in release order (the order of their first screenshot in the data is arbitrary). */
const RELEASE_ORDER = [
  "Red",
  "Gold",
  "Crystal",
  "Ruby",
  "Sapphire",
  "Emerald",
  "FireRed",
  "Diamond",
  "Platinum",
  "HeartGold",
  "Black / White",
  "Black / White /",
  "Black 2",
  "X / Y",
  "Omega Ruby",
  "Sun",
  "Ultra Sun",
  "Let's Go",
  "Sword",
  "Brilliant Diamond",
  "Scarlet",
  "Legends: Z-A",
];
const releaseRank = (game: string) => {
  const i = RELEASE_ORDER.findLastIndex((g) => game.startsWith(g));
  return i < 0 ? RELEASE_ORDER.length : i;
};

export function geoRegions(): GeoRegionInfo[] {
  return REGIONS.map((r) => {
    const areas = areasOf(r.id);
    const home = areas.find((a) => a.place?.name === HOME[r.id])?.place ?? areas[0]?.place;
    // The newest game's view of it.
    const shot = home?.shots.reduce((a, b) => (releaseRank(b.game) > releaseRank(a.game) ? b : a));
    const games = [...new Set(areas.flatMap((a) => [a.place, ...a.buildings].flatMap((l) => l?.shots.map((s) => lookOf(s.game)) ?? [])))];
    return {
      id: r.id,
      name: r.name,
      map: { src: r.map.src, box: r.map.box },
      locations: areas.length,
      games: gameList(games).sort((a, b) => releaseRank(a) - releaseRank(b)),
      preview: shot ? shotUrl(shot.id) : null,
    };
  });
}

export function isGeoSpec(spec: Pick<GeoSpec, "region" | "kind">): boolean {
  return GEO_KINDS.includes(spec.kind) && areasOf(spec.region).length >= GEO_ROUNDS;
}

/** Any screenshot in storage: a game started before an update keeps showing its own. */
export function shotSource(id: string): string {
  return `${STORAGE_BASE}/${id}.webp`;
}

interface PlannedRound {
  location: string;
  /** World data: the place's region (names repeat across regions: Route 1, Victory Road…). */
  region?: string;
  shot: string;
  /** The screenshot's game, in case an update replaces the screenshot mid-game. */
  game?: string;
}

/**
 * A round in an area: the town or route itself half the time (when it has
 * screenshots), else one of its buildings; then one of the place's looks, and
 * a screenshot of that look.
 */
function pickRound(rng: Rng, area: Area): PlannedRound {
  const location = area.place && (!area.buildings.length || rng.chance(0.5)) ? area.place : rng.pick(area.buildings);
  const look = rng.pick([...new Set(location.shots.map((s) => lookOf(s.game)))]);
  const shot = rng.pick(location.shots.filter((s) => lookOf(s.game) === look));
  return { location: location.name, region: location.region, shot: shot.id, game: shot.game };
}

/**
 * The game's rounds: five for a standard game, every place for a streak.
 * Every town, route and landmark is equally likely, from every game it's in,
 * and no two rounds share a town (a building and its town are the same pin).
 * A five-round world game visits five different regions. `limit` stops early
 * (the first rounds don't depend on it).
 */
export function planRounds(spec: Pick<GeoSpec, "region" | "kind">, seed: string, limit = Infinity): PlannedRound[] {
  const rng = new Rng(deriveSeed("geo", seed));
  const areas = rng.shuffle(areasOf(spec.region));
  const max = Math.min(limit, spec.kind === "game" ? GEO_ROUNDS : Infinity);
  const oneEach = spec.region === WORLD_REGION && spec.kind === "game" && new Set(areas.map((a) => a.group)).size >= GEO_ROUNDS;
  const groups = new Set<string>();
  const rounds: PlannedRound[] = [];
  for (const area of areas) {
    if (rounds.length >= max) break;
    if (oneEach && groups.has(area.group)) continue;
    groups.add(area.group);
    rounds.push(pickRound(rng, area));
  }
  return rounds;
}

/** How much a game's first rounds repeat the player's recent places (weighted: the latest count most). */
function staleness(spec: GeoSpec, rounds: PlannedRound[], recent: Map<string, number>): number {
  return rounds.reduce((sum, r) => sum + (recent.get(areaOf(lookup(spec, r).location)) ?? 0), 0);
}
/** Seeds tried for a free-play game, keeping the one that repeats the player's recent places least. */
const SEED_TRIES = 64;

const findLocation = (spec: Pick<GeoSpec, "region">, round: PlannedRound) =>
  regionOf(spec.region)?.locations.find((l) => l.name === round.location && l.region === round.region);

function lookup(spec: GeoSpec, round: PlannedRound) {
  const region = regionOf(spec.region)!;
  const location = findLocation(spec, round);
  if (!location) throw new Error(`No place ${round.region} | ${round.location} on ${spec.region}`);
  const shot = location.shots.find((s) => s.id === round.shot) ?? { id: round.shot, game: round.game ?? location.shots[0].game };
  return { region, location, shot };
}

/** A game's planned rounds, sealed into its token (encrypted: the token mustn't give the places away). */
type SealedRound = [location: string, region: string | undefined, shot: string, game: string | undefined];
const seal = (rounds: PlannedRound[]) => encryptJson(rounds.map((r): SealedRound => [r.location, r.region, r.shot, r.game]));
function unseal(sealed: string | undefined): PlannedRound[] | null {
  const rounds = sealed ? decryptJson<SealedRound[]>(sealed) : null;
  return Array.isArray(rounds) ? rounds.map(([location, region, shot, game]) => ({ location, region: region ?? undefined, shot, game: game ?? undefined })) : null;
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
  const perfect = px <= region.perfectPx;
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
  v: 4;
  sid: string;
  spec: GeoSpec;
  seed: string;
  startedAt: number;
  /** Trainer name, for the challenge link. */
  name?: string;
  /** One score per finished round (streaks: 1 per hit). */
  log: number[];
  /**
   * The rounds as planned at the start, sealed: a five-round game's five, a
   * streak's current one. A game in progress outlives an update to the
   * places or screenshots (the seed alone would plan other rounds).
   */
  plan?: string;
}

/** What a challenge link carries: the seed (so the same places come up) and the friend's result. */
interface ChallengeCard {
  s: string;
  r: string;
  /** Links from before every game's screenshots were one pool carry a style; their seeds now plan other places. */
  y?: string;
  n: string;
  t: number;
  p: number[];
  /** The five rounds, sealed, so the challenge stays the same five screenshots after an update. */
  l?: string;
}

export function readGeoChallenge(token: unknown): (GeoChallenge & { seed: string; region: string; plan?: string }) | null {
  const card = verifyToken<ChallengeCard>("geo-challenge", token);
  if (!card || card.y !== undefined || !regionOf(card.r)) return null;
  return { seed: card.s, region: card.r, name: card.n, score: card.t, rounds: card.p, plan: card.l };
}

/**
 * Starts a game. Free play takes the player's recently seen areas (most
 * recent first) and, of a few seeds, plays the one that repeats them least.
 */
export function startGeo(
  spec: GeoSpec,
  opts: { seed?: string; name?: string; recent?: string[]; plan?: string } = {}
): { token: string; round: GeoRoundPublic } {
  let seed = opts.seed ?? (spec.daily ? `geo-daily:${spec.daily}` : randomId());
  if (!opts.seed && !spec.daily && opts.recent?.length) {
    // Never more than half the map's areas, so a fresh game is always possible.
    const recent = opts.recent.slice(0, Math.floor(areasOf(spec.region).length / 2));
    const weights = new Map(recent.map((key, i) => [key, recent.length - i] as const));
    let best = staleness(spec, planRounds(spec, seed, GEO_ROUNDS), weights);
    for (let i = 1; i < SEED_TRIES && best > 0; i++) {
      const next = randomId();
      const stale = staleness(spec, planRounds(spec, next, GEO_ROUNDS), weights);
      if (stale < best) [seed, best] = [next, stale];
    }
  }
  // A challenge's own five rounds when it carries them and they're all still on the map.
  const given = spec.kind === "game" ? unseal(opts.plan)?.filter((r) => findLocation(spec, r)) : undefined;
  const rounds = given?.length === GEO_ROUNDS ? given : planRounds(spec, seed, spec.kind === "game" ? GEO_ROUNDS : 1);
  const plan = given?.length === GEO_ROUNDS ? opts.plan : seal(rounds);
  const state: GeoState = { v: 4, sid: randomId(), spec, seed, startedAt: Date.now(), name: opts.name, log: [], plan };
  return { token: signToken("geo", state), round: { index: 0, shot: shotUrl(rounds[0].shot) } };
}

export function readGeo(token: unknown): GeoState | null {
  const state = verifyToken<GeoState>("geo", token);
  if (!state || state.v !== 4 || Date.now() - state.startedAt > STATE_TTL_MS) return null;
  return isGeoSpec(state.spec) ? state : null;
}

export type GeoGuessOutcome =
  | { ok: true; claimKey: string; body: GeoGuessResponse }
  | { ok: false; status: number; error: string };

export function gradeGeo(state: GeoState, guess: { x: number; y: number }): GeoGuessOutcome {
  const { spec } = state;
  const streak = spec.kind === "streak";
  const sealed = unseal(state.plan);
  // A game plays the rounds it started with; a streak its current round, then the next as planned now.
  const rounds = !streak && sealed ? sealed : planRounds(spec, state.seed);
  const index = state.log.length;
  const over = streak ? state.log.includes(0) || index >= rounds.length : index >= rounds.length;
  if (over) return { ok: false, status: 409, error: "This game is already over." };

  const round = (streak ? sealed?.[0] : undefined) ?? rounds[index];
  if (!findLocation(spec, round)) return { ok: false, status: 409, error: "PokéGuessr was just updated. Start a new game." };
  const { score, hit, squares } = measureGuess(spec, round, guess.x, guess.y);
  const next: GeoState = { ...state, log: [...state.log, streak ? (hit ? 1 : 0) : score] };
  if (streak && rounds[index + 1]) next.plan = seal([rounds[index + 1]]);
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
      const card: ChallengeCard = { s: state.seed, r: spec.region, n: state.name ?? "", t: total, p: next.log, l: state.plan };
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
