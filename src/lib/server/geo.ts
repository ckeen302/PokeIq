import "server-only";
import data from "@/data/geo.json";
import themeTags from "@/data/geo-themes.json";
import shotMeta from "@/data/geo-shot-meta.json";
import geoRetired from "@/data/geo-retired.json";
import {
  DEFAULT_DIFFICULTY,
  fitsMode,
  rampOrder,
  scoredDifficulty,
  shotWeight,
  type GeoDifficulty,
  type ShotMetaFile,
} from "@/lib/geo-difficulty";
import { GEO_THEMES, isWorldwide, themeMapId, themeOf } from "@/lib/geo-themes";
import { Rng } from "@/lib/rng";
import { shotBlur } from "./geo-blur";
import { isValidDailyDate } from "@/lib/daily";
import { publicName } from "@/lib/name-filter";
import { decryptJson, deriveSeed, encryptJson, hmac, randomId, signToken, verifyToken } from "./crypto";
import {
  GEO_FILTER_MIN_PLACES,
  GEO_KINDS,
  GEO_FALLOFF,
  GEO_MAX_ROUND_SCORE,
  GEO_ROUNDS,
  geoRoundsOf,
  isGeoRounds,
  type GeoAnswer,
  type GeoChallenge,
  type GeoGameGuess,
  type GeoGuessResponse,
  type GeoRegionInfo,
  type GeoResult,
  type GeoRoundPublic,
  type GeoSpec,
  WORLD_REGION,
} from "@/lib/geo-types";
import {
  GEO_GAME_BONUS,
  allowedFamilies,
  familyOfGame,
  familyRank,
  geoFamily,
  isGeoFamily,
  normalizeFamilies,
  type FamilyCombos,
  type GeoEra,
  type GeoFamilyId,
} from "@/lib/geo-families";

/**
 * PokéGuessr: GeoGuessr for the Pokémon world. Each round shows an in-game
 * screenshot; the player drops a pin on the region map. Rounds are a pure
 * function of a secret-derived seed, the state lives in a signed token, and
 * every guess is graded here, so the answer never reaches the browser early.
 */

interface Shot {
  id: string;
  /** The game as specifically as it's known ("Crystal", "Black 2 / White 2"). */
  game: string;
  family: GeoFamilyId;
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

type StoredShot = { id: string; game: string; family?: string };
type StoredLocation = Omit<Location, "pin" | "mask" | "shots"> & Partial<Pick<Location, "pin" | "mask">> & { shots: StoredShot[] };
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
/**
 * The Timer setting is kept on the server too: a guess this long after the
 * round's clock has run out scores nothing. The grace covers the picture
 * loading (the browser's clock starts once it's decoded) and the network.
 */
export const GEO_TIMER_GRACE_MS = 10_000;
/** GeoGuessr's curve: 5000 · e^(−10 · d / D), with D the map diagonal. */
const FALLOFF = GEO_FALLOFF;
/** Streak mode on a region's map: a pin this close to the place keeps the streak alive. */
const STREAK_RADIUS = 0.035;
/** Within half a town-map square of the place is spot on. */
const PERFECT_SQUARES = 0.5;
/** Parts of a region that count as it in world games and streaks: DLC areas, and the Sevii Islands (Kanto's). */
const REGION_GROUP: Record<string, string> = { "Isle of Armor": "Galar", "Crown Tundra": "Galar", "Blueberry Academy": "Unova", "Sevii Islands": "Kanto" };
const groupOf = (region?: string) => (region ? (REGION_GROUP[region] ?? region) : "");
/** The region a place counts as in a region streak (Region Streak mode reads it). */
export const regionGroupOf = groupOf;
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

/** A stored shot with its family (the data carries it; older data is read from the game's label). */
function readShot(s: StoredShot): Shot | null {
  const family = isGeoFamily(s.family) ? s.family : familyOfGame(s.game);
  return family ? { id: s.id, game: s.game, family } : null;
}

/** The world map, with buildings placed in (and sharing the area of) their parent place. */
function worldRegion(world: WorldData): Region {
  const byName = new Map(world.locations.filter((l) => l.pin).map((l) => [`${l.region}|${l.name}`, l]));
  const locations = world.locations.flatMap((l): Location[] => {
    const home = l.pin ? l : byName.get(`${l.region}|${l.parent}`);
    const shots = l.shots.flatMap((s) => readShot(s) ?? []);
    return home?.pin && home.mask ? [{ ...l, shots, pin: home.pin, mask: home.mask }] : [];
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

type ThemeTags = { places?: string[]; buildings?: string[]; preview: string };
const THEME_TAGS = themeTags as Record<string, ThemeTags>;
const placeKey = (l: Pick<Location, "region" | "name">) => `${l.region}|${l.name}`;

/**
 * A themed map: the whole world map, with only the theme's places (a town or
 * route with its buildings), or only its buildings (the Gyms, each on its
 * own, at its town's pin).
 */
function themeRegion(world: Region, id: string, name: string, tags: ThemeTags): Region {
  const places = new Set(tags.places ?? []);
  const buildings = new Set(tags.buildings ?? []);
  const locations = world.locations.filter((l) =>
    l.parent ? buildings.has(placeKey(l)) || places.has(`${l.region}|${l.parent}`) : places.has(placeKey(l))
  );
  return { ...world, id, name, locations };
}

/** The world, then each region on its part of the world map, then the themed maps. */
const REGIONS: Region[] = (() => {
  const world = worldRegion(DATA.world);
  const themes = GEO_THEMES.flatMap((t) => (THEME_TAGS[t.id] ? [themeRegion(world, themeMapId(t.id), t.name, THEME_TAGS[t.id])] : []));
  return [world, ...Object.entries(DATA.world.crops).map(([id, crop]) => cropRegion(world, id, crop)), ...themes];
})();

const shotUrl = (id: string) => `/api/geo/shot/${id}`;

// ---------------------------------------------------------------------------
// Previews outside a game (the Atlas, the map picker, the how-to demo)
// ---------------------------------------------------------------------------

/**
 * A round's image id must never be matched to a place from outside a live
 * round, so every picture shown elsewhere is served under a separate name:
 * an HMAC of the id under the server secret. The map from preview names back
 * to ids is built once, and `/api/geo/preview/<name>` resolves it server-side.
 */
export const GEO_PREVIEW_RE = /^[A-Za-z0-9_-]{4,32}$/;
export const previewToken = (id: string) => hmac("geo-preview", id).subarray(0, 12).toString("base64url");
export const previewUrl = (id: string) => `/api/geo/preview/${previewToken(id)}`;
/** Fixed preview names (the PokéGuessr how-to's demo round, so the client needs no token). */
const PREVIEW_ALIASES: Record<string, string> = { demo: "uV4ANtrw-q6M" };
let PREVIEWS: Map<string, string> | null = null;
/** The screenshot a preview name stands for, or null. */
export function previewShot(name: string): string | null {
  if (!GEO_PREVIEW_RE.test(name)) return null;
  if (PREVIEW_ALIASES[name]) return PREVIEW_ALIASES[name];
  PREVIEWS ??= new Map([...KNOWN_SHOTS].map((id) => [previewToken(id), id]));
  return PREVIEWS.get(name) ?? null;
}

const regionOf = (id: string) => REGIONS.find((r) => r.id === id);
/** A town or route with its buildings: one pin, so at most one round. */
const areaOf = (location: Pick<Location, "region" | "name" | "parent">) => `${location.region}|${location.parent ?? location.name}`;

// ---------------------------------------------------------------------------
// Shots out of rotation (players' reports), and the game filters
// ---------------------------------------------------------------------------

/**
 * Shots retired by review (src/data/geo-retired.json): area maps cut from a
 * full-map image with black around them, and the like. They stay in the data
 * (every shot is protected) but are never dealt.
 */
const RETIRED: ReadonlySet<string> = new Set(geoRetired as string[]);

/** Shots out of play: retired by review, reported enough by players, or removed by a moderator. Kept for games already under way, never dealt again. */
let HIDDEN: ReadonlySet<string> = RETIRED;

/** Replaces the reported/removed shots (geo-reports.ts keeps them fresh); the retired ones always stay out. */
export function setHiddenShots(ids: Iterable<string>) {
  const next = new Set([...RETIRED, ...ids]);
  if (next.size === HIDDEN.size && [...next].every((id) => HIDDEN.has(id))) return;
  HIDDEN = next;
  FILTERED.clear();
}
export const hiddenShots = (): ReadonlySet<string> => HIDDEN;

// ---------------------------------------------------------------------------
// The screenshot audit: quality flags and difficulty (scripts/geo/audit-shots.ts)
// ---------------------------------------------------------------------------

const META = (shotMeta as unknown as ShotMetaFile).shots;
/** A shot's audit flags (0: clean, or not audited yet). */
const flagsOf = (id: string) => META[id]?.[2] ?? 0;
/** The audit's own rating: fixed, so the Daily plans the same for everyone all day. */
export const heuristicDifficultyOf = (id: string) => (META[id] ? META[id][3] / 10 : DEFAULT_DIFFICULTY);
/** Ratings moved by players' scores (geo-round-scores.ts keeps them fresh). */
let SCORED: ReadonlyMap<string, number> = new Map();
/** A shot's difficulty for Easy and Hard: players' scores once there are enough, else the audit's. */
export const difficultyOf = (id: string) => SCORED.get(id) ?? heuristicDifficultyOf(id);

/** Players' average score per shot (and rounds logged): replaces the ratings they move. */
export function setShotScores(rows: Iterable<{ id: string; avg: number; rounds: number }>) {
  const next = new Map<string, number>();
  for (const r of rows) {
    if (!KNOWN_SHOTS.has(r.id)) continue;
    const d = scoredDifficulty(heuristicDifficultyOf(r.id), r.avg, r.rounds);
    if (d !== heuristicDifficultyOf(r.id)) next.set(r.id, d);
  }
  SCORED = next;
  FILTERED.clear();
}

/** One of the items, each as likely as its weight (one draw, like Rng.pick). */
function weightedPick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  const weights = items.map(weight);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/** What a game deals from: a map, optionally an era or some game families, and Easy or Hard. */
type DealSpec = Pick<GeoSpec, "region" | "era" | "families" | "difficulty">;
const filtered = (spec: Omit<DealSpec, "region">) => !!spec.era || !!spec.families?.length;

/** A place's shots a game can deal: in the filter's families, and not hidden. */
const usableShots = (location: Location, allowed: ReadonlySet<GeoFamilyId>) => location.shots.filter((s) => allowed.has(s.family) && !HIDDEN.has(s.id));

/** A town or route and the buildings and landmarks in it, with screenshots. */
interface Area {
  key: string;
  group: string;
  place?: Location;
  buildings: Location[];
}

/** Each map's areas, in data order (every shot, hidden or not). */
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

/** Easy or Hard keeps only the areas with a shot that fits it, when that leaves at least this many. */
const MODE_MIN_AREAS = 20;
const modeOf = (spec: Pick<GeoSpec, "difficulty">): GeoDifficulty => spec.difficulty ?? "normal";
/** A place's shots that fit Easy or Hard (all of them in Normal). */
const fitting = (location: Location, allowed: ReadonlySet<GeoFamilyId>, mode: GeoDifficulty) =>
  usableShots(location, allowed).filter((s) => fitsMode(difficultyOf(s.id), mode));

/** A map's areas a filter can deal, cut down to the places with usable shots (cached until the hidden shots change). */
const FILTERED = new Map<string, Area[]>();
function areasOf(spec: DealSpec): Area[] {
  const allowed = allowedFamilies(spec);
  const mode = modeOf(spec);
  const key = `${spec.region}|${[...allowed].join(",")}|${mode}`;
  const cached = FILTERED.get(key);
  if (cached) return cached;
  const cut = (has: (l: Location) => boolean) =>
    (AREAS.get(spec.region) ?? []).flatMap((a): Area[] => {
      const place = a.place && has(a.place) ? a.place : undefined;
      const buildings = a.buildings.filter(has);
      return place || buildings.length ? [{ ...a, place, buildings }] : [];
    });
  const all = cut((l) => usableShots(l, allowed).length > 0);
  // Easy and Hard: only areas with a shot that fits, unless that leaves too few (then every area, leaning by weight).
  const moded = mode === "normal" ? all : cut((l) => fitting(l, allowed, mode).length > 0);
  const areas = moded.length >= Math.min(MODE_MIN_AREAS, all.length) ? moded : all;
  FILTERED.set(key, areas);
  return areas;
}

/** Each family set's number of places on a map (playable shots only): "rby,frlg" → 12. */
function familyCombos(region: string): FamilyCombos {
  const combos: FamilyCombos = {};
  for (const a of areasOf({ region })) {
    const families = new Set([a.place, ...a.buildings].flatMap((l) => (l ? l.shots.filter((s) => !HIDDEN.has(s.id)).map((s) => s.family) : [])));
    const key = [...families].sort((x, y) => familyRank(x) - familyRank(y)).join(",");
    combos[key] = (combos[key] ?? 0) + 1;
  }
  return combos;
}

/** A map's size in pixels (the Gym Leader bot's aim scales with it). */
export function mapSize(region: string): { width: number; height: number } {
  const r = regionOf(region);
  if (!r) throw new Error(`Unknown map ${region}`);
  return { width: r.map.width, height: r.map.height };
}

export function geoRegions(): GeoRegionInfo[] {
  return REGIONS.map((r) => {
    const areas = areasOf({ region: r.id });
    // A themed map's preview is its own kind of place (a Gym, a cave…).
    const preview = THEME_TAGS[themeOf(r.id)?.id ?? ""]?.preview;
    const home = preview
      ? r.locations.find((l) => placeKey(l) === preview && l.shots.length)
      : (areas.find((a) => a.place?.name === HOME[r.id])?.place ?? areas[0]?.place);
    // The newest game's view of it.
    const shots = home ? usableShots(home, allowedFamilies({})) : [];
    const shot = shots.length ? shots.reduce((a, b) => (familyRank(b.family) > familyRank(a.family) ? b : a)) : undefined;
    const combos = familyCombos(r.id);
    const families = [...new Set(Object.keys(combos).flatMap((k) => k.split(",")))]
      .filter(isGeoFamily)
      .sort((a, b) => familyRank(a) - familyRank(b));
    return {
      id: r.id,
      name: r.name,
      map: { src: r.map.src, box: r.map.box },
      locations: areas.length,
      games: families.map((f) => geoFamily(f).name),
      families,
      combos,
      preview: shot ? previewUrl(shot.id) : null,
      ...(themeOf(r.id) ? { theme: true } : {}),
    };
  });
}

/** Headline numbers for the home page and share cards, counted from the data so they stay true. */
export function geoStats(): { places: number; screenshots: number; games: number } {
  const world = geoRegions().find((r) => r.id === WORLD_REGION);
  const located = regionOf(WORLD_REGION)?.locations ?? [];
  return {
    places: world?.locations ?? 0,
    screenshots: located.reduce((n, l) => n + l.shots.filter((s) => !HIDDEN.has(s.id)).length, 0),
    games: world?.families.length ?? 0,
  };
}

/** Where a town sits on the world map (0–1 across and down), for the home page's showcase. */
export function geoWorldPin(region: string, name: string): [number, number] | null {
  return regionOf(WORLD_REGION)?.locations.find((l) => l.region === region && l.name === name && !l.parent)?.pin ?? null;
}

/**
 * Whether a map (with its filter) can be played: enough places for a game,
 * and with an era or picked games, at least GEO_FILTER_MIN_PLACES of them.
 */
export function isGeoSpec(spec: Pick<GeoSpec, "region" | "kind" | "rounds"> & Omit<DealSpec, "region">): boolean {
  if (spec.rounds !== undefined && !isGeoRounds(spec.rounds)) return false;
  const rounds = geoRoundsOf(spec);
  const min = filtered(spec) ? Math.max(rounds, GEO_FILTER_MIN_PLACES) : rounds;
  return GEO_KINDS.includes(spec.kind) && areasOf(spec).length >= min;
}

/** A filter as the server keeps it: a known era, and picked families only when they narrow it. */
export function geoFilter(era: unknown, families: unknown): { era?: GeoEra; families?: GeoFamilyId[] } {
  const e = era === "2d" || era === "3d" ? era : undefined;
  const f = normalizeFamilies(e, Array.isArray(families) ? families.filter((x): x is string => typeof x === "string") : undefined);
  return { ...(e ? { era: e } : {}), ...(f ? { families: f } : {}) };
}

/** Any screenshot in storage: a game started before an update keeps showing its own. */
export function shotSource(id: string): string {
  return `${STORAGE_BASE}/${id}.webp`;
}

/** A screenshot's place and game as the data has them (the moderators' review queue). */
export function shotInfo(id: string): { place: string; game: string; family: GeoFamilyId } | null {
  for (const l of regionOf(WORLD_REGION)?.locations ?? []) {
    const shot = l.shots.find((s) => s.id === id);
    if (shot) return { place: `${l.parent ? `${l.name} · ${l.parent}` : l.name}, ${l.region}`, game: shot.game, family: shot.family };
  }
  return null;
}

/** Every screenshot id in the data. */
export function isKnownShot(id: string): boolean {
  return KNOWN_SHOTS.has(id);
}
const KNOWN_SHOTS = new Set((regionOf(WORLD_REGION)?.locations ?? []).flatMap((l) => l.shots.map((s) => s.id)));

interface PlannedRound {
  location: string;
  /** World data: the place's region (names repeat across regions: Route 1, Victory Road…). */
  region?: string;
  shot: string;
  /** The screenshot's game, in case an update replaces the screenshot mid-game. */
  game?: string;
}

// ---------------------------------------------------------------------------
// No-repeat: the screenshots a player has already been dealt
// ---------------------------------------------------------------------------

/**
 * Seen screenshots by recency rank (0: the most recent). An unseen shot is
 * freshest; among seen ones, the larger the rank the longer ago. A streak
 * carries its list as a bitset with no ranks (every seen shot ranks 0).
 */
export type SeenShots = ReadonlyMap<string, number>;
const freshness = (seen: SeenShots | undefined, id: string) => (seen ? (seen.get(id) ?? Infinity) : Infinity);
/** The freshest a list of shots gets: unseen (Infinity), or the oldest seen. */
const freshest = (seen: SeenShots | undefined, shots: readonly Shot[]) => shots.reduce((best, s) => Math.max(best, freshness(seen, s.id)), -1);
/** Only the shots as fresh as the freshest one (all of them when nothing was seen). */
function freshOnly(seen: SeenShots | undefined, shots: Shot[]): Shot[] {
  if (!seen?.size) return shots;
  const best = freshest(seen, shots);
  return shots.filter((s) => freshness(seen, s.id) === best);
}

/** Every known screenshot, in data order (a streak's seen list is a bitset over it). */
let KNOWN_LIST: string[] | null = null;
const knownList = () => (KNOWN_LIST ??= [...KNOWN_SHOTS]);
/** A seen list as a streak's token carries it: a base64url bitset over the known screenshots (about 600 characters). */
export function packSeen(seen: SeenShots): string | undefined {
  if (!seen.size) return undefined;
  const list = knownList();
  const index = new Map(list.map((id, i) => [id, i]));
  const bits = new Uint8Array(Math.ceil(list.length / 8));
  let any = false;
  for (const id of seen.keys()) {
    const i = index.get(id);
    if (i === undefined) continue;
    bits[i >> 3] |= 1 << (i & 7);
    any = true;
  }
  return any ? Buffer.from(bits).toString("base64url") : undefined;
}
export function unpackSeen(packed: string | undefined): SeenShots | undefined {
  if (!packed) return undefined;
  const list = knownList();
  const bits = Buffer.from(packed, "base64url");
  const seen = new Map<string, number>();
  for (let i = 0; i < list.length && i >> 3 < bits.length; i++) if (bits[i >> 3] & (1 << (i & 7))) seen.set(list[i], 0);
  return seen.size ? seen : undefined;
}
/** The seen list a game's state carries (a streak's), for planning its rounds again. */
export const seenShotsOf = (state: Pick<GeoState, "seen">): SeenShots | undefined => unpackSeen(state.seen);

/**
 * A round in an area: the town or route itself half the time (when it has
 * screenshots), else one of its buildings; then one of the place's game
 * families, and a screenshot from it (so Emerald's and Ruby's shots don't
 * crowd out the remakes). With a seen list, only the place's freshest shots
 * are in the draw: unseen ones, else those seen longest ago.
 */
function pickRound(rng: Rng, area: Area, allowed: ReadonlySet<GeoFamilyId>, mode: GeoDifficulty = "normal", weighted = true, seen?: SeenShots): PlannedRound {
  // Easy and Hard: the town or a building that has a shot fitting the mode, when one does.
  const has = (l: Location) => fitting(l, allowed, mode).length > 0;
  let buildings = mode === "normal" || !area.buildings.some(has) ? area.buildings : area.buildings.filter(has);
  let place = area.place && (mode === "normal" || has(area.place) || !buildings.some(has)) ? area.place : undefined;
  if (seen?.size) {
    // Only the places in the area with its freshest shots.
    const best = freshest(seen, [place, ...buildings].flatMap((l) => (l ? usableShots(l, allowed) : [])));
    const fresh = (l: Location) => freshest(seen, usableShots(l, allowed)) === best;
    buildings = buildings.filter(fresh);
    place = place && fresh(place) ? place : undefined;
    if (!place && !buildings.length) [place, buildings] = [area.place, area.buildings];
  }
  const location = place && (!buildings.length || rng.chance(0.5)) ? place : buildings.length ? rng.pick(buildings) : area.place!;
  const fits = freshOnly(seen, fitting(location, allowed, mode));
  const shots = fits.length ? fits : freshOnly(seen, usableShots(location, allowed));
  const family = rng.pick([...new Set(shots.map((s) => s.family))]);
  // Low-quality shots (the audit's flags) come up a quarter as often; Easy and Hard lean to their end.
  const shot = weightedPick(
    rng,
    shots.filter((s) => s.family === family),
    (s) => (weighted ? shotWeight(mode === "normal" ? DEFAULT_DIFFICULTY : difficultyOf(s.id), flagsOf(s.id), mode) : 1)
  );
  return { location: location.name, region: location.region, shot: shot.id, game: shot.game };
}

/** From this date the Daily ramps from an easier first round to a harder last one (earlier dailies keep their order). */
export const DAILY_RAMP_FROM = "2026-10-28";

/**
 * The game's rounds: five for a standard game, every place for a streak.
 * Every town, route and landmark is equally likely, from every game it's in,
 * and no two rounds share a town (a building and its town are the same pin).
 * A five-round world game visits five different regions. `limit` stops early
 * (the first rounds don't depend on it). A filter deals only its games' shots.
 * With a seen list, areas with an unseen shot come first, then the others by
 * how long ago their freshest shot was seen (duels: pass both players' lists
 * as one).
 */
export function planRounds(spec: Pick<GeoSpec, "region" | "kind" | "rounds" | "daily"> & Omit<DealSpec, "region">, seed: string, limit = Infinity, seen?: SeenShots): PlannedRound[] {
  const rng = new Rng(deriveSeed("geo", seed));
  const allowed = allowedFamilies(spec);
  let areas = rng.shuffle(areasOf(spec));
  if (seen?.size) {
    const fresh = new Map(areas.map((a) => [a.key, freshest(seen, [a.place, ...a.buildings].flatMap((l) => (l ? usableShots(l, allowed) : [])))]));
    areas = [...areas].sort((a, b) => fresh.get(b.key)! - fresh.get(a.key)!);
  }
  const count = geoRoundsOf(spec);
  const max = Math.min(limit, spec.kind === "game" ? count : Infinity);
  const oneEach = isWorldwide(spec.region) && spec.kind === "game" && new Set(areas.map((a) => a.group)).size >= count;
  const groups = new Set<string>();
  const rounds: PlannedRound[] = [];
  // Dailies before the ramp keep the plain draw they were played with.
  const weighted = !spec.daily || spec.daily >= DAILY_RAMP_FROM;
  for (const area of areas) {
    if (rounds.length >= max) break;
    if (oneEach && groups.has(area.group)) continue;
    groups.add(area.group);
    rounds.push(pickRound(rng, area, allowed, modeOf(spec), weighted, seen));
  }
  // The Daily: easiest first, by the audit's fixed rating, so it's the same five in the same order all day.
  if (spec.daily && spec.daily >= DAILY_RAMP_FROM) return rampOrder(rounds.map((r) => ({ r, difficulty: heuristicDifficultyOf(r.shot) }))).map((x) => x.r);
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

function lookup(spec: Pick<GeoSpec, "region">, round: PlannedRound) {
  const region = regionOf(spec.region)!;
  const location = findLocation(spec, round);
  if (!location) throw new Error(`No place ${round.region} | ${round.location} on ${spec.region}`);
  const game = round.game ?? location.shots[0].game;
  const shot = location.shots.find((s) => s.id === round.shot) ?? { id: round.shot, game, family: familyOfGame(game) ?? location.shots[0].family };
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
export function measureGuess(spec: Pick<GeoSpec, "region">, round: PlannedRound, x: number, y: number) {
  const { region, location } = lookup(spec, round);
  const { width, height } = region.map;
  const diagonal = Math.hypot(width, height);
  const px = nearestPx(region, location, x, y);
  const perfect = px <= region.perfectPx;
  const score = perfect ? GEO_MAX_ROUND_SCORE : Math.round(GEO_MAX_ROUND_SCORE * Math.exp((-FALLOFF * px) / diagonal));
  // Themed maps share the world map, so a pin's region is read from every place on it, not just the theme's.
  const hit = isWorldwide(region.id) ? regionAt(regionOf(WORLD_REGION)!, x, y) === groupOf(location.region) : px / diagonal <= STREAK_RADIUS;
  // For the behaviour flags: how close to the place itself (its pin or its area's edge) the guess was, in map pixels.
  const toPin = Math.hypot((x - location.pin[0]) * width, (y - location.pin[1]) * height);
  return { score, hit, squares: perfect ? 0 : Math.round((px / region.squarePx) * 10) / 10, px: Math.round(Math.min(px, toPin) * 10) / 10 };
}

export function answerFor(spec: Pick<GeoSpec, "region">, round: PlannedRound, squares = 0): GeoAnswer {
  const { location, shot } = lookup(spec, round);
  return { name: location.name, parent: location.parent, game: shot.game, family: shot.family, pin: location.pin, mask: location.mask, squares, region: location.region };
}

/** Look around: at most this many views of a place per round. */
export const GEO_MAX_VIEWS = 8;

/**
 * Look around: every screenshot of the round's place the game can deal (its
 * filter's families, none hidden), the dealt one first, so the player can
 * flip through them like moving in Street View. With "guess the game too"
 * only the dealt shot's family, so the other views don't give the game away.
 */
export function roundViews(spec: DealSpec & Pick<GeoSpec, "guessGame">, round: PlannedRound): string[] {
  const location = findLocation(spec, round);
  if (!location) return [round.shot];
  const allowed = allowedFamilies(spec);
  const dealt = location.shots.find((s) => s.id === round.shot);
  const family = dealt?.family ?? familyOfGame(round.game ?? "");
  const others = usableShots(location, allowed).filter((s) => s.id !== round.shot && (!spec.guessGame || s.family === family));
  return [round.shot, ...others.map((s) => s.id)].slice(0, GEO_MAX_VIEWS);
}

/** A round as the player sees it: the dealt screenshot, and the place's other views when there are any. */
function publicRound(spec: GeoSpec, index: number, round: PlannedRound, next?: PlannedRound): GeoRoundPublic {
  // One screenshot per round, like GeoGuessr's single view; the place's other shots come up in other games.
  void spec;
  // The next round's picture URL (a random id: it says nothing about the place) so the browser can fetch it ahead.
  const blur = shotBlur(round.shot);
  return { index, shot: shotUrl(round.shot), ...(blur ? { blur } : {}), ...(next ? { preload: shotUrl(next.shot) } : {}) };
}

/** "Guess the game too": the bonus for naming the screenshot's family. */
export function gradeGameGuess(answer: Pick<GeoAnswer, "family">, guessed: string | undefined): GeoGameGuess {
  const family = isGeoFamily(guessed) ? guessed : null;
  const correct = family === answer.family;
  return { guessed: family, correct, bonus: correct ? GEO_GAME_BONUS : 0 };
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
  /** "Guess the game too": the bonus each finished round earned. */
  bonus?: number[];
  /**
   * The rounds as planned at the start, sealed: a five-round game's five, a
   * streak's current one. A game in progress outlives an update to the
   * places or screenshots (the seed alone would plan other rounds).
   */
  plan?: string;
  /** The Timer setting (seconds per round) the game started with, so a late guess scores nothing. */
  timer?: number;
  /** When the current round was dealt (the start, or the last guess's grading). */
  roundAt?: number;
  /** Streaks: the player's seen screenshots (packSeen), so each next round is planned as at the start. */
  seen?: string;
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
  /** The friend's game filter: era and picked families. */
  e?: GeoEra;
  f?: GeoFamilyId[];
  /** Easy or Hard (practice). */
  d?: "easy" | "hard";
}

export function readGeoChallenge(
  token: unknown
): (GeoChallenge & { seed: string; region: string; plan?: string; era?: GeoEra; families?: GeoFamilyId[]; difficulty?: "easy" | "hard" }) | null {
  const card = verifyToken<ChallengeCard>("geo-challenge", token);
  if (!card || card.y !== undefined || !regionOf(card.r)) return null;
  // Links signed before names were checked: shown without the name.
  const difficulty = card.d === "easy" || card.d === "hard" ? card.d : undefined;
  return { seed: card.s, region: card.r, name: publicName(card.n, ""), score: card.t, rounds: card.p, plan: card.l, ...geoFilter(card.e, card.f), ...(difficulty ? { difficulty } : {}) };
}

/**
 * Starts a game. Free play takes the player's recently seen areas (most
 * recent first) and, of a few seeds, plays the one that repeats them least;
 * and their seen screenshots (most recent first), dealt last (a streak
 * keeps the list in its token, without the order). The Daily and a friend's
 * challenge play their own rounds.
 */
export function startGeo(
  spec: GeoSpec,
  opts: { seed?: string; name?: string; recent?: string[]; plan?: string; timer?: number; seen?: string[] } = {}
): { token: string; round: GeoRoundPublic } {
  let seed = opts.seed ?? (spec.daily ? `geo-daily:${spec.daily}` : randomId());
  const free = !opts.seed && !spec.daily;
  const streak = spec.kind === "streak";
  let seen: SeenShots | undefined;
  if (free && opts.seen?.length) {
    const ranked = new Map<string, number>();
    opts.seen.forEach((id, i) => {
      if (KNOWN_SHOTS.has(id) && !ranked.has(id)) ranked.set(id, streak ? 0 : i);
    });
    if (ranked.size) seen = ranked;
  }
  if (free && opts.recent?.length) {
    // Never more than half the map's areas, so a fresh game is always possible.
    const recent = opts.recent.slice(0, Math.floor(areasOf(spec).length / 2));
    const weights = new Map(recent.map((key, i) => [key, recent.length - i] as const));
    let best = staleness(spec, planRounds(spec, seed, geoRoundsOf(spec), seen), weights);
    for (let i = 1; i < SEED_TRIES && best > 0; i++) {
      const next = randomId();
      const stale = staleness(spec, planRounds(spec, next, geoRoundsOf(spec), seen), weights);
      if (stale < best) [seed, best] = [next, stale];
    }
  }
  // A challenge's own five rounds when it carries them and they're all still on the map.
  const given = spec.kind === "game" ? unseal(opts.plan)?.filter((r) => findLocation(spec, r)) : undefined;
  const want = geoRoundsOf(spec);
  // A streak plans its first two rounds (the second only to be fetched ahead) and seals the first.
  const rounds = given?.length === want ? given : planRounds(spec, seed, spec.kind === "game" ? want : 2, seen);
  const plan = given?.length === want ? opts.plan : seal(spec.kind === "game" ? rounds : rounds.slice(0, 1));
  const now = Date.now();
  const state: GeoState = { v: 4, sid: randomId(), spec, seed, startedAt: now, name: opts.name, log: [], plan, roundAt: now };
  if (opts.timer && opts.timer > 0) state.timer = opts.timer;
  if (streak && seen) state.seen = packSeen(seen);
  // With a timer, the next picture isn't given out early (it could be studied while the clock runs).
  return { token: signToken("geo", state), round: publicRound(spec, 0, rounds[0], state.timer ? undefined : rounds[1]) };
}

export function readGeo(token: unknown): GeoState | null {
  const state = verifyToken<GeoState>("geo", token);
  if (!state || state.v !== 4 || Date.now() - state.startedAt > STATE_TTL_MS) return null;
  return isGeoSpec(state.spec) ? state : null;
}

export type GeoGuessOutcome =
  | {
      ok: true;
      claimKey: string;
      body: GeoGuessResponse;
      /** The round's screenshot (for the per-shot score log; never sent). */
      shot: string;
      /** How the round was played, for the behaviour flags (never sent): pixels from the place, time since it was dealt. */
      played: { px: number; elapsedMs: number; perfect: boolean };
    }
  | { ok: false; status: number; error: string };

/**
 * Grades a guess. `timeout`: the round's clock ran out before a pin went down
 * (the Timer setting), which scores nothing and ends a streak. With a timer, a
 * pin sent after the clock plus GEO_TIMER_GRACE_MS is graded the same way. A
 * daily is only graded while its day is current, so its answers come out
 * only after a guess and only on the day.
 */
/** A game's rounds as it plays them: the ones it started with (sealed); a streak's as planned now (with its seen list). */
export function roundsOf(state: GeoState): PlannedRound[] {
  const sealed = unseal(state.plan);
  return state.spec.kind !== "streak" && sealed ? sealed : planRounds(state.spec, state.seed, Infinity, seenShotsOf(state));
}

export function gradeGeo(state: GeoState, guess: { x: number; y: number; family?: string; timeout?: boolean }, now = Date.now()): GeoGuessOutcome {
  const { spec } = state;
  const streak = spec.kind === "streak";
  if (spec.daily && !isValidDailyDate(spec.daily, now)) return { ok: false, status: 409, error: "That daily game is over. Today's is waiting." };
  const sealed = unseal(state.plan);
  // A game plays the rounds it started with; a streak its current round, then the next as planned now.
  const rounds = roundsOf(state);
  const index = state.log.length;
  const over = streak ? state.log.includes(0) || index >= rounds.length : index >= rounds.length;
  if (over) return { ok: false, status: 409, error: "This game is already over." };

  const round = (streak ? sealed?.[0] : undefined) ?? rounds[index];
  if (!findLocation(spec, round)) return { ok: false, status: 409, error: "PokéGuessr was just updated. Start a new game." };
  const measured = measureGuess(spec, round, guess.x, guess.y);
  const elapsedMs = Math.max(0, now - (state.roundAt ?? state.startedAt));
  const late = !!state.timer && !guess.timeout && elapsedMs > state.timer * 1000 + GEO_TIMER_GRACE_MS;
  const timedOut = !!guess.timeout || late;
  const { score, hit, squares } = timedOut ? { score: 0, hit: false, squares: measured.squares } : measured;
  const answer = answerFor(spec, round, squares);
  const gameGuess = spec.guessGame ? gradeGameGuess(answer, late ? undefined : guess.family) : undefined;
  const next: GeoState = { ...state, log: [...state.log, streak ? (hit ? 1 : 0) : score], roundAt: now };
  if (gameGuess) next.bonus = [...(state.bonus ?? []), gameGuess.bonus];
  if (streak && rounds[index + 1]) next.plan = seal([rounds[index + 1]]);
  const total = next.log.reduce((s, x) => s + x, 0);
  const bonusTotal = next.bonus?.reduce((s, x) => s + x, 0);
  const done = streak ? !hit || next.log.length >= rounds.length : next.log.length >= rounds.length;

  let result: GeoResult | undefined;
  let challengeToken: string | undefined;
  if (done) {
    result = {
      sid: state.sid,
      spec,
      score: total,
      ...(bonusTotal !== undefined ? { bonus: bonusTotal } : {}),
      rounds: next.log.map((s, i) => ({ score: s, name: rounds[i].location })),
      durationMs: Math.max(1, now - state.startedAt),
      finishedAt: now,
    };
    if (!streak) {
      const card: ChallengeCard = { s: state.seed, r: spec.region, n: state.name ?? "", t: total, p: next.log, l: state.plan };
      if (spec.era) card.e = spec.era;
      if (spec.families) card.f = spec.families;
      if (spec.difficulty) card.d = spec.difficulty;
      challengeToken = signToken("geo-challenge", card);
    }
  }
  return {
    ok: true,
    claimKey: `geo:${state.sid}:${index}`,
    shot: round.shot,
    played: { px: measured.px, elapsedMs, perfect: !timedOut && measured.score === GEO_MAX_ROUND_SCORE },
    body: {
      score,
      hit,
      ...(timedOut ? { timedOut: true } : {}),
      ...(late ? { late: true } : {}),
      answer,
      ...(gameGuess ? { gameGuess, bonusTotal } : {}),
      token: signToken("geo", next),
      total,
      next: done ? undefined : publicRound(spec, index + 1, rounds[index + 1], state.timer ? undefined : rounds[index + 2]),
      done,
      result,
      resultToken: result ? signToken("geo-result", result) : undefined,
      challengeToken,
    },
  };
}
