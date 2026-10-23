import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { Rng } from "@/lib/rng";
import { CATEGORIES } from "@/lib/connections/categories";
import { generatePuzzle, playGuesses, type PlayState, type Puzzle } from "@/lib/connections/generator";
import { isCurrentConnDate, isPlayableConnDate, type ConnLevel } from "@/lib/connections/types";
import {
  REPORT_REASONS,
  type ConnCategoryFeedback,
  type ConnChallenge,
  type ConnFriendRow,
  type ConnGroupStats,
  type ConnHintResponse,
  type ReportReason,
} from "@/lib/connections/social";
import { signToken, verifyToken } from "./crypto";
import { dailyConnPuzzle, type DisabledCategories } from "./connections";
import { better, type ConnBoardStore } from "./connections-board";
import type { FriendStore } from "./friends-store";

/**
 * PokéConnections' social layer on the server: feedback and group reports,
 * the share of players who found each group, one hint per puzzle, the
 * categories moderators switched off, the Puzzle of the Day and the friends
 * board.
 *
 * Nothing here trusts a number from the client. Feedback, reports, group
 * stats and hints all start from the server replaying the player's guesses
 * against the real puzzle; a report names a group by its colour and the
 * server looks the category up itself; the hint is recorded here, so asking
 * twice returns the same Pokémon, and the result route reads it back.
 *
 * Stored in Supabase (migration 0030_connections_social.sql: RLS on, no
 * grants, server only) or in memory with POKEIQ_LOCAL_ACCOUNTS=1. Without a
 * store, or before the migration is applied, every function here does
 * nothing and the game carries on without the extras.
 */

export interface StoredHint {
  id: number;
  level: ConnLevel;
}

export interface PotdRow {
  id: string;
  creatorKey: string;
}

export interface SocialStore {
  /** Keeps a player's first rating of a puzzle. */
  rate(date: string, player: string, value: 1 | -1): Promise<"recorded" | "exists">;
  /** Keeps a player's first report of a group. */
  report(date: string, player: string, level: ConnLevel, category: string, reason: ReportReason): Promise<"recorded" | "exists">;
  /** Keeps a player's first result of the day: which groups they found. */
  recordGroups(date: string, player: string, found: boolean[]): Promise<void>;
  groupCounts(date: string): Promise<{ players: number; found: number[] }>;
  getHint(date: string, player: string): Promise<StoredHint | null>;
  /** Keeps the first hint a player takes on a day; returns the one kept. */
  saveHint(date: string, player: string, hint: StoredHint): Promise<StoredHint>;
  disabled(): Promise<Map<string, string>>;
  disable(category: string, after: string, by: string): Promise<void>;
  ratings(): Promise<{ date: string; up: number; down: number }[]>;
  reports(): Promise<{ category: string; reason: ReportReason; count: number }[]>;
  getPotd(date: string): Promise<PotdRow | null>;
  /** Keeps the first pick of a day. */
  setPotd(date: string, row: PotdRow): Promise<void>;
  recentPotdIds(limit: number): Promise<string[]>;
  wasPotd(creatorKey: string): Promise<boolean>;
}

// In memory --------------------------------------------------------------------

interface Mem {
  ratings: Map<string, 1 | -1>;
  reports: Map<string, { category: string; reason: ReportReason }>;
  groups: Map<string, boolean[]>;
  hints: Map<string, StoredHint>;
  disabled: Map<string, string>;
  potd: Map<string, PotdRow>;
}
const globalStore = globalThis as unknown as { __pokeiqConnSocial?: Mem };
const emptyMem = (): Mem => ({ ratings: new Map(), reports: new Map(), groups: new Map(), hints: new Map(), disabled: new Map(), potd: new Map() });

let memStore: SocialStore | null = null;

export function memorySocialStore(): SocialStore {
  const m = (globalStore.__pokeiqConnSocial ??= emptyMem());
  return (memStore ??= {
    async rate(date, player, value) {
      const k = `${date}|${player}`;
      if (m.ratings.has(k)) return "exists";
      m.ratings.set(k, value);
      return "recorded";
    },
    async report(date, player, level, category, reason) {
      const k = `${date}|${player}|${level}`;
      if (m.reports.has(k)) return "exists";
      m.reports.set(k, { category, reason });
      return "recorded";
    },
    async recordGroups(date, player, found) {
      const k = `${date}|${player}`;
      if (!m.groups.has(k)) m.groups.set(k, found);
    },
    async groupCounts(date) {
      const rows = [...m.groups.entries()].filter(([k]) => k.startsWith(`${date}|`)).map(([, v]) => v);
      return { players: rows.length, found: [0, 1, 2, 3].map((i) => rows.filter((r) => r[i]).length) };
    },
    async getHint(date, player) {
      return m.hints.get(`${date}|${player}`) ?? null;
    },
    async saveHint(date, player, hint) {
      const k = `${date}|${player}`;
      if (!m.hints.has(k)) m.hints.set(k, hint);
      return m.hints.get(k)!;
    },
    async disabled() {
      return new Map(m.disabled);
    },
    async disable(category, after) {
      if (!m.disabled.has(category)) m.disabled.set(category, after);
    },
    async ratings() {
      const byDate = new Map<string, { up: number; down: number }>();
      for (const [k, v] of m.ratings) {
        const date = k.split("|")[0];
        const t = byDate.get(date) ?? { up: 0, down: 0 };
        if (v === 1) t.up++;
        else t.down++;
        byDate.set(date, t);
      }
      return [...byDate].map(([date, t]) => ({ date, ...t }));
    },
    async reports() {
      const out = new Map<string, { category: string; reason: ReportReason; count: number }>();
      for (const r of m.reports.values()) {
        const k = `${r.category}|${r.reason}`;
        out.set(k, { ...r, count: (out.get(k)?.count ?? 0) + 1 });
      }
      return [...out.values()];
    },
    async getPotd(date) {
      return m.potd.get(date) ?? null;
    },
    async setPotd(date, row) {
      if (!m.potd.has(date)) m.potd.set(date, row);
    },
    async recentPotdIds(limit) {
      return [...m.potd.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, limit)
        .map(([, r]) => r.id);
    },
    async wasPotd(creatorKey) {
      return [...m.potd.values()].some((r) => r.creatorKey === creatorKey);
    },
  });
}

export function clearMemorySocial() {
  globalStore.__pokeiqConnSocial = undefined;
  memStore = null;
  disabledCache = null;
}

// Supabase ---------------------------------------------------------------------

/** The tables aren't there (migration 0030 hasn't been applied). */
const MISSING = new Set(["42P01", "PGRST205"]);
const ROW_CAP = 20_000;

/** The social tables are missing: treated like no store. */
export class SocialOffError extends Error {
  constructor() {
    super("The PokéConnections extras are off until migration 0030_connections_social.sql is applied.");
  }
}

export function supabaseSocialStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): SocialStore {
  const fail = (error: { code?: string; message: string }): never => {
    if (MISSING.has(error.code ?? "")) throw new SocialOffError();
    throw new Error(error.message);
  };
  /** An insert that keeps the first row: "exists" on a duplicate key. */
  const insertOnce = async (table: string, row: Record<string, unknown>): Promise<"recorded" | "exists"> => {
    const { error } = await sb.from(table).insert(row);
    if (!error) return "recorded";
    if (error.code === "23505") return "exists";
    return fail(error);
  };
  const count = async (table: string, date: string, column?: string) => {
    let q = sb.from(table).select("player_key", { count: "exact", head: true }).eq("puzzle_date", date);
    if (column) q = q.eq(column, true);
    const { count: n, error } = await q;
    if (error) fail(error);
    return n ?? 0;
  };
  return {
    rate: (date, player, value) => insertOnce("connections_feedback", { puzzle_date: date, player_key: player, rating: value }),
    report: (date, player, level, category, reason) => insertOnce("connections_reports", { puzzle_date: date, player_key: player, level, category, reason }),
    async recordGroups(date, player, found) {
      await insertOnce("connections_group_results", { puzzle_date: date, player_key: player, l0: found[0], l1: found[1], l2: found[2], l3: found[3] });
    },
    async groupCounts(date) {
      const [players, ...found] = await Promise.all([count("connections_group_results", date), ...["l0", "l1", "l2", "l3"].map((c) => count("connections_group_results", date, c))]);
      return { players, found };
    },
    async getHint(date, player) {
      const { data, error } = await sb.from("connections_hints").select("pokemon_id, level").eq("puzzle_date", date).eq("player_key", player).maybeSingle();
      if (error) fail(error);
      const r = data as { pokemon_id: number; level: ConnLevel } | null;
      return r ? { id: r.pokemon_id, level: r.level } : null;
    },
    async saveHint(date, player, hint) {
      await insertOnce("connections_hints", { puzzle_date: date, player_key: player, pokemon_id: hint.id, level: hint.level });
      return (await this.getHint(date, player)) ?? hint;
    },
    async disabled() {
      const { data, error } = await sb.from("connections_disabled").select("category, after_date");
      if (error) fail(error);
      return new Map(((data ?? []) as { category: string; after_date: string }[]).map((r) => [r.category, r.after_date]));
    },
    async disable(category, after, by) {
      await insertOnce("connections_disabled", { category, after_date: after, disabled_by: by });
    },
    async ratings() {
      const { data, error } = await sb.from("connections_feedback").select("puzzle_date, rating").limit(ROW_CAP);
      if (error) fail(error);
      const byDate = new Map<string, { up: number; down: number }>();
      for (const r of (data ?? []) as { puzzle_date: string; rating: number }[]) {
        const t = byDate.get(r.puzzle_date) ?? { up: 0, down: 0 };
        if (r.rating > 0) t.up++;
        else t.down++;
        byDate.set(r.puzzle_date, t);
      }
      return [...byDate].map(([date, t]) => ({ date, ...t }));
    },
    async reports() {
      const { data, error } = await sb.from("connections_reports").select("category, reason").limit(ROW_CAP);
      if (error) fail(error);
      const out = new Map<string, { category: string; reason: ReportReason; count: number }>();
      for (const r of (data ?? []) as { category: string; reason: ReportReason }[]) {
        const k = `${r.category}|${r.reason}`;
        out.set(k, { ...r, count: (out.get(k)?.count ?? 0) + 1 });
      }
      return [...out.values()];
    },
    async getPotd(date) {
      const { data, error } = await sb.from("connections_potd").select("puzzle_id, creator_key").eq("puzzle_date", date).maybeSingle();
      if (error) fail(error);
      const r = data as { puzzle_id: string; creator_key: string } | null;
      return r ? { id: r.puzzle_id, creatorKey: r.creator_key } : null;
    },
    async setPotd(date, row) {
      await insertOnce("connections_potd", { puzzle_date: date, puzzle_id: row.id, creator_key: row.creatorKey });
    },
    async recentPotdIds(limit) {
      const { data, error } = await sb.from("connections_potd").select("puzzle_id").order("puzzle_date", { ascending: false }).limit(limit);
      if (error) fail(error);
      return ((data ?? []) as { puzzle_id: string }[]).map((r) => r.puzzle_id);
    },
    async wasPotd(creatorKey) {
      const { count: n, error } = await sb.from("connections_potd").select("puzzle_id", { count: "exact", head: true }).eq("creator_key", creatorKey);
      if (error) fail(error);
      return (n ?? 0) > 0;
    },
  };
}

let liveStore: SocialStore | null | undefined;

export function socialStore(): SocialStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memorySocialStore();
  if (liveStore === undefined) {
    const sb = getServiceSupabase();
    liveStore = sb ? supabaseSocialStore(sb) : null;
  }
  return liveStore;
}

/** Runs a store call; the extras being off (no store, no tables) gives `fallback` instead of an error. */
export async function orOff<T>(fn: (s: SocialStore) => Promise<T>, fallback: T, store: SocialStore | null = socialStore()): Promise<T> {
  if (!store) return fallback;
  try {
    return await fn(store);
  } catch (err) {
    if (err instanceof SocialOffError) return fallback;
    throw err;
  }
}

// Disabled categories ------------------------------------------------------------

const DISABLED_TTL_MS = 30_000;
let disabledCache: { store: SocialStore | null; at: number; map: Map<string, string> } | null = null;

/** The categories moderators switched off (cached for 30 seconds per store; empty when the extras are off). */
export async function loadDisabled(store: SocialStore | null = socialStore(), now = Date.now()): Promise<DisabledCategories> {
  if (disabledCache && disabledCache.store === store && now - disabledCache.at < DISABLED_TTL_MS) return disabledCache.map;
  try {
    const map = await orOff((s) => s.disabled(), new Map<string, string>(), store);
    disabledCache = { store, at: now, map };
    return map;
  } catch (err) {
    // The game never waits on this: keep dealing with what was last known.
    console.error("[connections] couldn't load the disabled categories:", err);
    return disabledCache?.store === store ? disabledCache.map : new Map<string, string>();
  }
}

export function clearDisabledCache() {
  disabledCache = null;
}

/** The daily as it is dealt: without the categories switched off for that date. */
export async function effectiveDaily(date: string, store: SocialStore | null = socialStore()): Promise<Puzzle> {
  return dailyConnPuzzle(date, await loadDisabled(store));
}

const DAY_MS = 86_400_000;
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type SocialOutcome<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

/**
 * Switches a category off: dailies after tomorrow (UTC) skip it; today's and
 * tomorrow's, which players may already have played, and every earlier one
 * stay as they were. Refused if the generator could no longer make puzzles.
 */
export async function disableCategory(category: string, adminName: string, store: SocialStore | null = socialStore(), now = Date.now()): Promise<SocialOutcome<{ after: string }>> {
  if (!CATEGORIES.some((c) => c.id === category)) return { ok: false, status: 400, error: "No such category." };
  if (!store) return { ok: false, status: 503, error: "Feedback isn't stored on this server." };
  try {
    const current = await store.disabled();
    if (current.has(category)) return { ok: true, after: current.get(category)! };
    try {
      generatePuzzle("daily:probe", { excludeCategories: new Set([...current.keys(), category]) });
    } catch {
      return { ok: false, status: 409, error: "Too many categories would be off to make a puzzle." };
    }
    const after = utcDate(now + DAY_MS);
    await store.disable(category, after, adminName);
    clearDisabledCache();
    return { ok: true, after };
  } catch (err) {
    if (err instanceof SocialOffError) return { ok: false, status: 503, error: "Run migration 0030_connections_social.sql first." };
    throw err;
  }
}

// Feedback ---------------------------------------------------------------------

export interface FeedbackInput {
  date: string;
  /** The player key (connPlayerKey of their identity). */
  player: string;
  guesses: number[][];
  rating?: 1 | -1;
  report?: { level: ConnLevel; reason: string };
}

/** Replays a finished daily; the state or the reason it can't be used. */
async function finished(date: string, guesses: number[][], store: SocialStore | null, current = false): Promise<{ puzzle: Puzzle; state: PlayState } | { error: string; status: number }> {
  if (!(current ? isCurrentConnDate(date) : isPlayableConnDate(date))) return { error: "No PokéConnections that day.", status: 400 };
  const puzzle = await effectiveDaily(date, store);
  let state: PlayState;
  try {
    state = playGuesses(puzzle, guesses);
  } catch (err) {
    return { error: (err as Error).message, status: 400 };
  }
  return { puzzle, state };
}

/**
 * A thumbs up/down on a finished daily and/or a report on one of its groups,
 * one of each per player. The game must be over (the server replays the
 * guesses), so a report never needs the answers shown before; the group is
 * named by colour and the server finds its category.
 */
export async function submitFeedback(input: FeedbackInput, store: SocialStore | null = socialStore()): Promise<SocialOutcome<{ available: boolean; rated: boolean; reported: boolean }>> {
  if (input.report && !(REPORT_REASONS as readonly string[]).includes(input.report.reason)) return { ok: false, status: 400, error: "Pick a reason." };
  const game = await finished(input.date, input.guesses, store);
  if ("error" in game) return { ok: false, ...game };
  if (!game.state.over) return { ok: false, status: 409, error: "Finish the puzzle first." };
  const out = await orOff(
    async (s) => {
      const rated = input.rating ? (await s.rate(input.date, input.player, input.rating)) === "recorded" : false;
      const reported = input.report
        ? (await s.report(input.date, input.player, input.report.level, game.puzzle.groups[input.report.level].category, input.report.reason as ReportReason)) === "recorded"
        : false;
      return { available: true, rated, reported };
    },
    { available: false, rated: false, reported: false },
    store
  );
  return { ok: true, ...out };
}

// Group stats ------------------------------------------------------------------

/** Which groups a replayed game found (index = level). */
export const foundMask = (state: Pick<PlayState, "found">): boolean[] => [0, 1, 2, 3].map((lv) => state.found.includes(lv as ConnLevel));

export function groupStatsOf(counts: { players: number; found: number[] }): ConnGroupStats {
  const pct = [0, 1, 2, 3].map((i) => (counts.players ? Math.round((100 * (counts.found[i] ?? 0)) / counts.players) : 0));
  return { players: counts.players, pct: pct as ConnGroupStats["pct"] };
}

/** Counts a finished daily's groups for the player (first result kept) and returns the day's percentages. Never throws: stats are a bonus. */
export async function recordGroupStats(date: string, player: string, state: PlayState, store: SocialStore | null = socialStore()): Promise<ConnGroupStats | undefined> {
  try {
    return await orOff(
      async (s) => {
        await s.recordGroups(date, player, foundMask(state));
        return groupStatsOf(await s.groupCounts(date));
      },
      undefined,
      store
    );
  } catch (err) {
    console.error("[connections] group stats failed:", err);
    return undefined;
  }
}

// Hints ------------------------------------------------------------------------

/**
 * One hint per player per daily: a single Pokémon from the easiest group not
 * yet found. The server replays the guesses, records the hint (the first one
 * is kept, so asking again returns it and never a second) and answers with
 * the Pokémon and its group's colour only.
 */
export async function requestHint(
  input: { date: string; player: string; guesses: number[][] },
  store: SocialStore | null = socialStore()
): Promise<SocialOutcome<{ hint: ConnHintResponse }>> {
  const game = await finished(input.date, input.guesses, store, true);
  if ("error" in game) return { ok: false, ...game };
  if (game.state.over) return { ok: false, status: 409, error: "The game is over." };
  const level = ([0, 1, 2, 3] as ConnLevel[]).find((lv) => !game.state.found.includes(lv))!;
  const pick = new Rng(`conn-hint:${input.date}:${input.player}:${level}`).shuffle([...game.puzzle.groups[level].members])[0];
  const kept = await orOff(async (s) => (await s.getHint(input.date, input.player)) ?? s.saveHint(input.date, input.player, { id: pick, level }), null, store);
  return { ok: true, hint: kept ? { available: true, hint: kept } : { available: false } };
}

/** Whether the player took the hint on a daily. */
export async function hintUsed(date: string, player: string, store: SocialStore | null = socialStore()): Promise<boolean> {
  try {
    return !!(await orOff((s) => s.getHint(date, player), null, store));
  } catch (err) {
    console.error("[connections] hint lookup failed:", err);
    return false;
  }
}

// Friends board and "Beat my time" ------------------------------------------------

/** Today's board for you and your accepted friends, best first (hint-free before hinted). */
export async function friendsBoard(
  date: string,
  me: { id: string },
  friends: FriendStore,
  board: ConnBoardStore,
  keyOf: (identity: string) => string
): Promise<ConnFriendRow[]> {
  const ids = (await friends.friendshipsOf(me.id)).filter((f) => f.status === "accepted").map((f) => (f.a === me.id ? f.b : f.a));
  const keys = [me.id, ...ids].map((id) => keyOf(`u:${id}`));
  const mine = keyOf(`u:${me.id}`);
  return (await board.byPlayers(date, keys))
    .sort(better)
    .map((e) => ({ name: e.name, mistakes: e.mistakes, ms: e.durationMs, hinted: !!e.hinted, you: e.player === mine }));
}

/** A signed "Beat my time" token for a player's own ranked result today; null if they have none. */
export async function beatToken(date: string, player: string, board: ConnBoardStore): Promise<string | null> {
  const [entry] = await board.byPlayers(date, [player]);
  if (!entry) return null;
  return signToken("conn-beat", { d: date, n: entry.name, m: entry.mistakes, t: entry.durationMs, h: !!entry.hinted });
}

/** What a share link's token says, or null if the server didn't sign it. */
export function readBeatToken(token: unknown): ConnChallenge | null {
  const t = verifyToken<{ d: string; n: string; m: number; t: number; h: boolean }>("conn-beat", token);
  if (!t || !isPlayableConnDate(t.d) || typeof t.n !== "string" || typeof t.m !== "number" || typeof t.t !== "number") return null;
  return { date: t.d, name: t.n, mistakes: t.m, ms: t.t, hinted: !!t.h };
}

// Moderation ---------------------------------------------------------------------

/**
 * Every category players reported or rated down, for the moderators: its
 * reports (with the reasons) and the thumbs of the dailies it appeared in.
 * Sorting is left to the desk (most reports, or worst ratings).
 */
export async function categoryFeedback(store: SocialStore | null = socialStore()): Promise<{ stored: boolean; categories: ConnCategoryFeedback[] }> {
  if (!store) return { stored: false, categories: [] };
  try {
    const [reports, ratings, disabled] = await Promise.all([store.reports(), store.ratings(), store.disabled()]);
    const rows = new Map<string, ConnCategoryFeedback>();
    const row = (category: string): ConnCategoryFeedback => {
      let r = rows.get(category);
      if (!r) {
        const known = CATEGORIES.find((c) => c.id === category);
        rows.set(category, (r = { category, label: known?.label ?? category, reports: 0, reasons: { "wrong-fact": 0, unfair: 0, "too-obscure": 0 }, up: 0, down: 0, disabled: disabled.has(category) }));
      }
      return r;
    };
    for (const rep of reports) {
      const r = row(rep.category);
      r.reports += rep.count;
      r.reasons[rep.reason] += rep.count;
    }
    for (const day of ratings) {
      if (!isPlayableConnDate(day.date)) continue;
      // The puzzle as it was dealt that day, so the ratings go to the categories players actually saw.
      for (const g of dailyConnPuzzle(day.date, disabled).groups) {
        const r = row(g.category);
        r.up += day.up;
        r.down += day.down;
      }
    }
    const categories = [...rows.values()].filter((r) => r.reports > 0 || r.down > 0);
    return { stored: true, categories: categories.sort((a, b) => b.reports - a.reports || b.down - b.up - (a.down - a.up)).slice(0, 100) };
  } catch (err) {
    if (err instanceof SocialOffError) return { stored: false, categories: [] };
    throw err;
  }
}
