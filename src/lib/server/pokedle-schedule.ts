import "server-only";
import poolV1 from "@/data/pokedle-pool.json";
import { getPokemon, POKEDEX } from "@/lib/pokemon/pokedex";
import { LAUNCH_DATE } from "@/lib/daily";
import { hashString, Rng } from "@/lib/rng";
import { DLE_CURATED_FROM, DLE_SQUIRDLE_FROM, DLE_WEEKDAY_TIER } from "@/lib/dle-types";
import type { DleDailyFormat } from "@/lib/dle-format";
import { deriveSeed } from "./crypto";

/**
 * Which Pokémon is the daily Pokédle on a given date.
 *
 * Before DLE_CURATED_FROM, the original pick: HMAC(secret, date) over all
 * 1,025 Pokémon. Those days have been played, so they keep that answer for
 * good (the archive replays them).
 *
 * From then on, each era deals its curated pool (src/data/pokedle-pool.json,
 * from scripts/pokedle-pool.ts) like a deck: a keyed shuffle, so no Pokémon
 * comes back until the whole pool has been the answer once (a cycle of about
 * 800 days), and the open-source code can't predict the order without the
 * server secret. Within a cycle:
 *
 * - the weekday picks the tier: easier Monday to Wednesday, medium Thursday
 *   and Friday, harder at the weekend (DLE_WEEKDAY_TIER);
 * - each tier's order spreads every generation evenly through it;
 * - consecutive days avoid the same generation and the same primary type,
 *   and an evolution family stays out for RECENT_DAYS after one of it was
 *   the answer (no Charmander on Monday, Charizard on Wednesday);
 * - whatever was the answer just before a cycle starts (the end of the
 *   previous cycle, or the original-pick days before the first era) goes to
 *   the back of the new cycle.
 *
 * To change the pool later, add an era with a later start date (one no
 * player anywhere has reached yet) and leave the earlier ones alone: an
 * era's every date depends on its pool.
 */

interface Era {
  /** First date of the era (YYYY-MM-DD). */
  from: string;
  /** Names the era's shuffle: never reuse one. */
  key: string;
  /** Pokédex numbers, easier tier first. */
  tiers: number[][];
  /** Never the Classic daily's answer of the same day (the Squirdle-style daily's eras). */
  shadow?: boolean;
}

export const ERAS: readonly Era[] = [{ from: DLE_CURATED_FROM, key: "pool-v1", tiers: poolV1.tiers }];

/**
 * The Squirdle-style daily: its own deck of the same curated pool, under its
 * own key, so its answer is a different Pokémon from Classic's every day.
 */
export const SQUIRDLE_ERAS: readonly Era[] = [{ from: DLE_SQUIRDLE_FROM, key: "squirdle-v1", tiers: poolV1.tiers, shadow: true }];

/** Days an answer's evolution family stays out, and how far back "just before a cycle" reaches. */
export const RECENT_DAYS = 45;
/** How far down the queue a day looks for a Pokémon that keeps the rules above. */
const LOOKAHEAD = 24;
const DAY_MS = 86_400_000;

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
/** 0 = Sunday. */
const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7;

/** The original daily pick (dates before the first era): unchanged, so those days keep their answers. */
export function legacyDailyId(date: string): number {
  return POKEDEX[hashString(deriveSeed("pokedle", `daily:${date}|`)) % POKEDEX.length].id;
}

function eraOn(date: string, eras: readonly Era[]): Era | undefined {
  let found: Era | undefined;
  for (const era of eras) if (date >= era.from) found = era;
  return found;
}

const eraSize = (era: Era) => era.tiers.reduce((n, t) => n + t.length, 0);

/** The daily answer's Pokédex number on `date` (a valid YYYY-MM-DD), for Classic or the Squirdle-style daily. */
export function dailyAnswerId(date: string, format: DleDailyFormat = "classic"): number {
  const squirdle = format === "squirdle";
  const era = eraOn(date, squirdle ? SQUIRDLE_ERAS : ERAS);
  // Before the Squirdle-style daily began there was none: a keyed pick, never played.
  if (!era) return squirdle ? POKEDEX[hashString(deriveSeed("pokedle", `squirdle:${date}`)) % POKEDEX.length].id : legacyDailyId(date);
  const day = dayNumber(date) - dayNumber(era.from);
  const size = eraSize(era);
  return cycleOrder(era, Math.floor(day / size))[day % size];
}

/** The daily answers of the `count` days before `date` (none before launch), oldest first. */
function answersBefore(date: string, count: number): number[] {
  const end = dayNumber(date);
  const start = Math.max(end - count, dayNumber(LAUNCH_DATE));
  const out: number[] = [];
  for (let day = start; day < end; day++) out.push(dailyAnswerId(dateOf(day)));
  return out;
}

interface Entry {
  id: number;
  gen: number;
  type: string;
  chain: number;
}

function entry(id: number): Entry {
  const p = getPokemon(id);
  if (!p) throw new Error(`Pokédle pool: unknown Pokémon ${id}`);
  return { id, gen: p.gen, type: p.types[0], chain: p.chain };
}

/** A random order of `ids` with each generation spread evenly through it. */
function spread(ids: readonly number[], rng: Rng): Entry[] {
  const byGen = new Map<number, Entry[]>();
  for (const e of ids.map(entry)) byGen.set(e.gen, [...(byGen.get(e.gen) ?? []), e]);
  const keyed: [number, Entry][] = [];
  for (const gen of [...byGen.keys()].sort((a, b) => a - b)) {
    const members = rng.shuffle(byGen.get(gen)!);
    const offset = rng.next();
    members.forEach((e, j) => keyed.push([(j + offset) / members.length, e]));
  }
  return keyed.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id).map(([, e]) => e);
}

/** Built cycles, by their (secret-derived) seed. */
const cycles = new Map<string, number[]>();

/** Cycle `index` of an era: every Pokémon of its pool once, in day order. */
export function cycleOrder(era: Era, index: number): number[] {
  const seed = deriveSeed("pokedle-deck", `${era.key}:${index}`);
  const built = cycles.get(seed);
  if (built) return built;

  const size = eraSize(era);
  const rng = new Rng(seed);
  const before = index > 0 ? cycleOrder(era, index - 1).slice(-RECENT_DAYS) : answersBefore(era.from, RECENT_DAYS);
  const recent = new Set(before);
  // Just been the answer: to the back of the queue (a stable sort keeps the rest in order).
  const queues = era.tiers.map((tier) => spread(tier, rng).sort((a, b) => Number(recent.has(a.id)) - Number(recent.has(b.id))));

  const history = before.map(entry);
  const first = dayNumber(era.from) + index * size;
  const order: number[] = [];
  for (let p = 0; p < size; p++) {
    const want = DLE_WEEKDAY_TIER[weekdayOf(first + p)];
    // A tier that has run out (near the end of a cycle) borrows from the nearest one.
    const tier = [want, want - 1, want + 1, want - 2, want + 2].find((t) => queues[t]?.length)!;
    const queue = queues[tier];
    const prev = history[history.length - 1];
    const chains = new Set(history.slice(-RECENT_DAYS).map((e) => e.chain));
    // A shadow era's day never shares Classic's evolution family that day.
    const clash = era.shadow ? entry(dailyAnswerId(dateOf(first + p))).chain : null;
    const window = queue.slice(0, LOOKAHEAD);
    let k = window.findIndex((e) => !chains.has(e.chain) && e.chain !== clash && e.gen !== prev?.gen && e.type !== prev?.type);
    if (k < 0) k = window.findIndex((e) => !chains.has(e.chain) && e.chain !== clash);
    if (k < 0) k = queue.findIndex((e) => e.chain !== clash);
    if (k < 0) k = 0;
    const [pick] = queue.splice(k, 1);
    order.push(pick.id);
    history.push(pick);
  }
  cycles.set(seed, order);
  return order;
}
