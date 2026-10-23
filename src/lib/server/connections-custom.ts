import "server-only";
import { randomInt } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { isCleanName, publicName } from "@/lib/name-filter";
import { Rng } from "@/lib/rng";
import { CATEGORIES } from "@/lib/connections/categories";
import { FACTS, factsOf } from "@/lib/connections/facts";
import { playGuesses, type Puzzle } from "@/lib/connections/generator";
import {
  CUSTOM_GROUP_NAME_MAX,
  CUSTOM_ID_RE,
  CUSTOM_TITLE_MAX,
  type CustomGroupInput,
  type CustomInput,
  type CustomListResponse,
  type CustomMeta,
  type CustomSummary,
} from "@/lib/connections/custom";
import { CONN_GROUPS, CONN_GROUP_SIZE, type ConnGroupExplained, type ConnGroupReveal, type ConnGuessResponse, type ConnLevel, type ConnPuzzleResponse } from "@/lib/connections/types";
import { connTile } from "./connections";
import { connPlayerKey } from "./connections-results";

/**
 * PokéConnections' community puzzles on the server: checking a creator's
 * sixteen Pokémon, storing the puzzle, playing guesses against it, votes
 * and the community lists.
 *
 * The groups are the answers. Everything a player can reach goes through
 * `customView` (the tiles), `checkCustom` (found groups, and all four once
 * the game is over) and the summaries (title, creator, votes): none of them
 * carries a group's name or members ahead of time.
 *
 * Stored in Supabase (migration 0029_connections_custom.sql, RLS-locked,
 * service role only), or in memory with POKEIQ_LOCAL_ACCOUNTS=1 (tests and
 * the local E2E run). Without either, or before the migration is applied,
 * the store is null and the creator says it's unavailable.
 */

export interface StoredCustom {
  id: string;
  /** An HMAC of the creator's identity, never the identity. */
  creatorKey: string;
  creatorName: string | null;
  title: string | null;
  /** Easiest first: index = level. */
  groups: CustomGroupInput[];
  /** The sixteen Pokémon in the grid's starting order. */
  tiles: number[];
  up: number;
  down: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Checking a creator's puzzle
// ---------------------------------------------------------------------------

const NAME_CHARS = /^[\p{L}\p{N} .,'’&!?:+\-/()]+$/u;

/** A group or puzzle name, or why it can't be used. */
function nameProblem(label: string, name: string, max: number): string | null {
  const n = name.trim();
  if (!n) return `${label} needs a name.`;
  if (n.length > max) return `${label}'s name is over ${max} characters.`;
  if (!NAME_CHARS.test(n)) return `${label}'s name has a character that isn't allowed.`;
  if (!isCleanName(n)) return `${label}'s name isn't allowed. Pick a different one.`;
  return null;
}

/**
 * Everything that blocks publishing: four groups of four, sixteen different
 * real Pokémon, one of each colour, four different clean names. [] when fine.
 */
export function validateCustom(input: { title?: string; groups: readonly CustomGroupInput[] }): string[] {
  const errors: string[] = [];
  const { groups } = input;
  if (input.title?.trim()) {
    const t = nameProblem("The title", input.title, CUSTOM_TITLE_MAX);
    if (t) errors.push(t);
  }
  if (groups.length !== CONN_GROUPS) {
    errors.push(`Make ${CONN_GROUPS} groups (you have ${groups.length}).`);
    return errors;
  }
  const known = new Set(FACTS.map((f) => f.id));
  groups.forEach((g, i) => {
    const label = `Group ${i + 1}`;
    const problem = nameProblem(label, g.name, CUSTOM_GROUP_NAME_MAX);
    if (problem) errors.push(problem);
    if (g.members.length !== CONN_GROUP_SIZE) errors.push(`${label} needs exactly ${CONN_GROUP_SIZE} Pokémon (it has ${g.members.length}).`);
    if (g.members.some((id) => !Number.isInteger(id) || !known.has(id))) errors.push(`${label} has a Pokémon that doesn't exist.`);
  });
  const names = groups.map((g) => g.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) errors.push("Two groups have the same name.");
  if (new Set(groups.map((g) => g.level)).size !== CONN_GROUPS || groups.some((g) => ![0, 1, 2, 3].includes(g.level))) {
    errors.push("Give each group its own colour: yellow, green, blue and purple.");
  }
  const ids = groups.flatMap((g) => g.members);
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id) && known.has(id)) errors.push(`${factsOf(id).name} is in the puzzle twice.`);
    seen.add(id);
  }
  return [...new Set(errors)];
}

/**
 * What deserves a second look but doesn't block publishing, from the
 * computed categories: if all four of a group's Pokémon share a known link
 * (a type, an ability, a name ending...) and a Pokémon from another group
 * fits that link too, players could put it in the wrong group. Also two
 * Pokémon from one evolution family. Only call this on a valid puzzle.
 */
export function analyzeCustom(groups: readonly CustomGroupInput[]): string[] {
  const warnings: string[] = [];
  const facts = groups.map((g) => g.members.map(factsOf));
  const byFamily = new Map<number, string[]>();
  for (const f of facts.flat()) byFamily.set(f.familyKey, [...(byFamily.get(f.familyKey) ?? []), f.name]);
  for (const names of byFamily.values()) if (names.length > 1) warnings.push(`${names.join(" and ")} are from one evolution family.`);
  groups.forEach((g, gi) => {
    const links = CATEGORIES.filter((c) => facts[gi].every((f) => c.test(f)));
    if (!links.length) return;
    facts.forEach((others, oi) => {
      if (oi === gi) return;
      for (const f of others) {
        const hit = links.find((c) => c.test(f)) ?? links.find((c) => c.guard?.(f));
        if (hit) warnings.push(`${f.name} (in “${groups[oi].name.trim()}”) also fits “${g.name.trim()}”: ${hit.label}.`);
      }
    });
  });
  return warnings.slice(0, 12);
}

/** Pokémon whose names contain `q`, for the creator's search box (best matches first). */
export function searchPokemon(q: string, limit = 12): { id: number; name: string }[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const pool = FACTS.filter((f) => f.name.toLowerCase().includes(needle));
  pool.sort((a, b) => Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle)) || a.id - b.id);
  return pool.slice(0, limit).map((f) => ({ id: f.id, name: f.name }));
}

// ---------------------------------------------------------------------------
// Playing one
// ---------------------------------------------------------------------------

const asPuzzle = (p: StoredCustom): Puzzle => ({ groups: p.groups.map((g) => ({ category: "custom", members: g.members })), tiles: p.tiles });

/** What a player starts with: sixteen tiles, in the grid's order. Never the groups. */
export function customView(p: StoredCustom): ConnPuzzleResponse {
  return { key: `practice:custom-${p.id}`, tiles: p.tiles.map(connTile) };
}

const reveal = (p: StoredCustom, level: ConnLevel): ConnGroupReveal => ({ level, label: p.groups[level].name, members: p.groups[level].members.map(connTile) });

const explain = (p: StoredCustom, level: ConnLevel): ConnGroupExplained => ({
  ...reveal(p, level),
  rule: `${p.creatorName ? `${p.creatorName}'s` : "The creator's"} link: ${p.groups[level].name}.`,
  lines: p.groups[level].members.map((id) => ({ ...connTile(id), why: p.groups[level].name })),
  herrings: [],
});

/** Plays the guesses so far against a community puzzle (throws on a malformed guess). */
export function checkCustom(p: StoredCustom, guesses: number[][]): ConnGuessResponse {
  const state = playGuesses(asPuzzle(p), guesses);
  return {
    results: state.results,
    found: state.found.map((lv) => reveal(p, lv)),
    mistakes: state.mistakes,
    over: state.over,
    won: state.won,
    ...(state.over && { reveal: ([0, 1, 2, 3] as ConnLevel[]).map((lv) => explain(p, lv)) }),
  };
}

export const summaryOf = (p: StoredCustom): CustomSummary => ({
  id: p.id,
  title: p.title ? publicName(p.title, "Untitled") : null,
  creator: p.creatorName ? publicName(p.creatorName) : null,
  up: p.up,
  down: p.down,
  createdAt: p.createdAt,
});

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface CustomStore {
  /** False when the id is taken. */
  insert(p: StoredCustom): Promise<boolean>;
  get(id: string): Promise<StoredCustom | null>;
  /** How many this creator has made since `sinceMs`. */
  countBy(creatorKey: string, sinceMs: number): Promise<number>;
  /** Highest score first (newest breaks ties), or newest first; `sinceMs` limits to puzzles made after it. */
  list(sort: "top" | "new", limit: number, sinceMs?: number): Promise<StoredCustom[]>;
  /** Sets (1, -1) or clears (0) a vote; the tallies, or null when there's no such puzzle. */
  vote(id: string, voterKey: string, value: -1 | 0 | 1): Promise<{ up: number; down: number } | null>;
  myVote(id: string, voterKey: string): Promise<-1 | 0 | 1>;
  /** A creator's puzzles by the name they're credited under (any capitalisation), newest first. */
  byCreatorName(name: string, limit: number): Promise<StoredCustom[]>;
}

const globalStore = globalThis as unknown as { __pokeiqConnCustom?: { puzzles: Map<string, StoredCustom>; votes: Map<string, Map<string, -1 | 1>> } };

const ranked = (a: StoredCustom, b: StoredCustom) => b.up - b.down - (a.up - a.down) || Date.parse(b.createdAt) - Date.parse(a.createdAt);

export function memoryCustomStore(): CustomStore {
  const mem = (globalStore.__pokeiqConnCustom ??= { puzzles: new Map(), votes: new Map() });
  return {
    async insert(p) {
      if (mem.puzzles.has(p.id)) return false;
      mem.puzzles.set(p.id, { ...p });
      return true;
    },
    async get(id) {
      return mem.puzzles.get(id) ?? null;
    },
    async countBy(creatorKey, sinceMs) {
      return [...mem.puzzles.values()].filter((p) => p.creatorKey === creatorKey && Date.parse(p.createdAt) >= sinceMs).length;
    },
    async list(sort, limit, sinceMs = 0) {
      const all = [...mem.puzzles.values()].filter((p) => Date.parse(p.createdAt) >= sinceMs);
      all.sort(sort === "top" ? ranked : (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return all.slice(0, limit);
    },
    async vote(id, voterKey, value) {
      const p = mem.puzzles.get(id);
      if (!p) return null;
      let votes = mem.votes.get(id);
      if (!votes) mem.votes.set(id, (votes = new Map()));
      if (value === 0) votes.delete(voterKey);
      else votes.set(voterKey, value);
      p.up = [...votes.values()].filter((v) => v === 1).length;
      p.down = [...votes.values()].filter((v) => v === -1).length;
      return { up: p.up, down: p.down };
    },
    async myVote(id, voterKey) {
      return mem.votes.get(id)?.get(voterKey) ?? 0;
    },
    async byCreatorName(name, limit) {
      return [...mem.puzzles.values()]
        .filter((p) => p.creatorName?.toLowerCase() === name.toLowerCase())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit);
    },
  };
}

export function clearMemoryCustom() {
  globalStore.__pokeiqConnCustom = undefined;
}

/** The table or its function isn't there (migration 0029 hasn't been applied). */
const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

interface Row {
  id: string;
  creator_key: string;
  creator_name: string | null;
  title: string | null;
  groups: CustomGroupInput[];
  tiles: number[];
  up: number;
  down: number;
  created_at: string;
}

const fromRow = (r: Row): StoredCustom => ({
  id: r.id,
  creatorKey: r.creator_key,
  creatorName: r.creator_name,
  title: r.title,
  groups: r.groups,
  tiles: r.tiles,
  up: r.up,
  down: r.down,
  createdAt: r.created_at,
});

export function supabaseCustomStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): CustomStore {
  const fail = (error: { code?: string; message: string }): never => {
    if (MISSING.has(error.code ?? "")) throw new CustomOffError();
    throw new Error(error.message);
  };
  return {
    async insert(p) {
      const { error } = await sb.from("connections_custom").insert({
        id: p.id,
        creator_key: p.creatorKey,
        creator_name: p.creatorName,
        title: p.title,
        groups: p.groups,
        tiles: p.tiles,
      });
      if (error?.code === "23505") return false;
      if (error) fail(error);
      return true;
    },
    async get(id) {
      const { data, error } = await sb.from("connections_custom").select("*").eq("id", id).maybeSingle();
      if (error) fail(error);
      return data ? fromRow(data as Row) : null;
    },
    async countBy(creatorKey, sinceMs) {
      const { count, error } = await sb.from("connections_custom").select("id", { count: "exact", head: true }).eq("creator_key", creatorKey).gte("created_at", new Date(sinceMs).toISOString());
      if (error) fail(error);
      return count ?? 0;
    },
    async list(sort, limit, sinceMs = 0) {
      let q = sb.from("connections_custom").select("*");
      if (sinceMs) q = q.gte("created_at", new Date(sinceMs).toISOString());
      q = sort === "top" ? q.order("score", { ascending: false }).order("created_at", { ascending: false }) : q.order("created_at", { ascending: false });
      const { data, error } = await q.limit(limit);
      if (error) fail(error);
      return ((data ?? []) as Row[]).map(fromRow);
    },
    async vote(id, voterKey, value) {
      const { data, error } = await sb.rpc("conn_custom_vote", { p_id: id, p_voter: voterKey, p_value: value });
      if (error) fail(error);
      const t = data as { up: number; down: number } | null;
      return t ? { up: Number(t.up), down: Number(t.down) } : null;
    },
    async myVote(id, voterKey) {
      const { data, error } = await sb.from("connections_custom_votes").select("value").eq("puzzle_id", id).eq("voter_key", voterKey).maybeSingle();
      if (error) fail(error);
      return ((data as { value: number } | null)?.value ?? 0) as -1 | 0 | 1;
    },
    async byCreatorName(name, limit) {
      // ilike is case-insensitive; the name's own wildcards are escaped so it matches exactly.
      const exact = name.replace(/[\\%_]/g, (c) => `\\${c}`);
      const { data, error } = await sb.from("connections_custom").select("*").ilike("creator_name", exact).order("created_at", { ascending: false }).limit(limit);
      if (error) fail(error);
      return ((data ?? []) as Row[]).map(fromRow);
    },
  };
}

/** The store's table isn't there: treated like no store. */
export class CustomOffError extends Error {
  constructor() {
    super("Community puzzles are off until migration 0029_connections_custom.sql is applied.");
  }
}

export function customStore(): CustomStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryCustomStore();
  const sb = getServiceSupabase();
  return sb ? supabaseCustomStore(sb) : null;
}

// ---------------------------------------------------------------------------
// Publishing, voting and the lists
// ---------------------------------------------------------------------------

/** At most this many puzzles per creator per day (on top of the per-address rate limit). */
export const CUSTOM_DAILY_LIMIT = 10;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const ID_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const newId = () => Array.from({ length: 8 }, () => ID_CHARS[randomInt(ID_CHARS.length)]).join("");

export type CustomOutcome<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export interface PublishInput extends Pick<CustomInput, "title" | "groups"> {
  /** "u:<account id>" or "d:<browser id>". */
  identity: string;
  /** A signed-in trainer's username or a checked trainer name; none: anonymous. */
  creatorName?: string | null;
}

/** Validates and stores a puzzle; its short id. The server shuffles the grid. */
export async function publishCustom(input: PublishInput, store: CustomStore | null = customStore(), now = Date.now()): Promise<CustomOutcome<{ id: string }>> {
  if (!store) return { ok: false, status: 503, error: "Community puzzles aren't available right now." };
  const errors = validateCustom(input);
  if (errors.length) return { ok: false, status: 400, error: errors[0] };
  const creatorKey = connPlayerKey(input.identity);
  try {
    if ((await store.countBy(creatorKey, now - DAY_MS)) >= CUSTOM_DAILY_LIMIT) {
      return { ok: false, status: 429, error: `You've published ${CUSTOM_DAILY_LIMIT} puzzles today. Come back tomorrow.` };
    }
    const groups = [...input.groups].sort((a, b) => a.level - b.level).map((g) => ({ name: g.name.trim(), level: g.level, members: [...g.members] }));
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId();
      const tiles = new Rng(`custom:${id}`).shuffle(groups.flatMap((g) => g.members));
      const stored: StoredCustom = {
        id,
        creatorKey,
        creatorName: input.creatorName?.trim() || null,
        title: input.title?.trim() || null,
        groups,
        tiles,
        up: 0,
        down: 0,
        createdAt: new Date(now).toISOString(),
      };
      if (await store.insert(stored)) return { ok: true, id };
    }
    return { ok: false, status: 503, error: "Couldn't make a link. Try again." };
  } catch (err) {
    if (err instanceof CustomOffError) return { ok: false, status: 503, error: "Community puzzles aren't available right now." };
    throw err;
  }
}

/** A community puzzle by id (null when there is none, or the store is off). */
export async function getCustom(id: string, store: CustomStore | null = customStore()): Promise<StoredCustom | null> {
  if (!store || !CUSTOM_ID_RE.test(id)) return null;
  try {
    return await store.get(id);
  } catch (err) {
    if (err instanceof CustomOffError) return null;
    throw err;
  }
}

/** One thumbs up or down per player; voting again changes it, 0 takes it back. Not on your own puzzle. */
export async function voteCustom(id: string, identity: string, value: -1 | 0 | 1, store: CustomStore | null = customStore()): Promise<CustomOutcome<{ up: number; down: number; myVote: -1 | 0 | 1 }>> {
  if (!store) return { ok: false, status: 503, error: "Voting isn't available right now." };
  const p = await getCustom(id, store);
  if (!p) return { ok: false, status: 404, error: "No such puzzle." };
  const voterKey = connPlayerKey(identity);
  if (voterKey === p.creatorKey) return { ok: false, status: 403, error: "You can't vote on your own puzzle." };
  const tally = await store.vote(id, voterKey, value);
  if (!tally) return { ok: false, status: 404, error: "No such puzzle." };
  return { ok: true, ...tally, myVote: value };
}

export async function metaOf(id: string, identity: string | null, store: CustomStore | null = customStore()): Promise<CustomMeta | null> {
  const p = await getCustom(id, store);
  if (!p || !store) return null;
  return { ...summaryOf(p), myVote: identity ? await store.myVote(id, connPlayerKey(identity)) : 0 };
}

/** The community page: the best-voted puzzle of the week, the top ones of all time, the newest. */
export async function listCustom(store: CustomStore | null = customStore(), now = Date.now()): Promise<CustomListResponse> {
  if (!store) return { available: false, featured: null, top: [], newest: [] };
  try {
    const [week, top, newest] = await Promise.all([store.list("top", 1, now - WEEK_MS), store.list("top", 20), store.list("new", 20)]);
    const best = week[0];
    return { available: true, featured: best && best.up - best.down > 0 ? summaryOf(best) : null, top: top.map(summaryOf), newest: newest.map(summaryOf) };
  } catch (err) {
    if (err instanceof CustomOffError) return { available: false, featured: null, top: [], newest: [] };
    throw err;
  }
}
