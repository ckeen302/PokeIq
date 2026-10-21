import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { bestTier, checkAvatar, defaultAvatar, levelFromXp, parseAvatar, type Avatar, type AvatarMap, type AvatarUnlocks, type PublicAvatar } from "@/lib/avatar";
import { progressDigests, usersByIds, usersByNames } from "./accounts";
import { rankedKey, rankedStore } from "./ranked";
import { battleKey } from "./battle-engine/identity";
import { ladderStore } from "./battle-engine/ladder";
import type { DuelPlayerView } from "@/lib/duel-types";

/**
 * Trainers' avatars (migration 0021: profiles.avatar). Before the migration
 * every account shows its default Pokémon and choices can't be saved. With
 * POKEIQ_LOCAL_ACCOUNTS=1 (tests, local E2E) and in development without
 * Supabase, choices live in memory.
 *
 * Views that list trainers get every avatar in one lookup (no request per
 * row), cached for a minute per server instance.
 */

export class AvatarsUnavailable extends Error {}

/** What profiles.avatar holds. */
export type StoredAvatar = Avatar;

interface Row {
  id: string;
  username: string;
  avatar: unknown;
}

export interface AvatarStore {
  rows(by: "id" | "name", keys: string[]): Promise<Row[]>;
  save(userId: string, avatar: StoredAvatar): Promise<void>;
  /** Choices can be saved (the column is there). */
  saves(): boolean;
}

// ---- memory --------------------------------------------------------------------

const globalStore = globalThis as unknown as { __pokeiqAvatars?: Map<string, unknown> };
const mem = () => (globalStore.__pokeiqAvatars ??= new Map());

export function clearMemoryAvatars() {
  globalStore.__pokeiqAvatars = new Map();
  byId.clear();
  byName.clear();
}

const accountRows = async (by: "id" | "name", keys: string[], avatarOf: (id: string) => unknown): Promise<Row[]> =>
  (await (by === "id" ? usersByIds(keys) : usersByNames(keys))).map((u) => ({ id: u.id, username: u.username, avatar: avatarOf(u.id) }));

export function memoryAvatarStore(): AvatarStore {
  return {
    rows: (by, keys) => accountRows(by, keys, (id) => mem().get(id) ?? null),
    async save(userId, avatar) {
      mem().set(userId, { ...avatar });
    },
    saves: () => true,
  };
}

// ---- Supabase --------------------------------------------------------------------

/** The column isn't there (the migration hasn't been applied). */
const MISSING = new Set(["42703", "PGRST204"]);
const RECHECK_MS = 60_000;
let missingUntil = 0;

function missing(error: { code?: string; message?: string }): boolean {
  if (!MISSING.has(error.code ?? "") && !/column .*avatar.* does not exist/i.test(error.message ?? "")) return false;
  if (Date.now() >= missingUntil) console.warn("[avatars] avatar choices are off until migration 0021_avatars.sql is applied:", error.message);
  missingUntil = Date.now() + RECHECK_MS;
  return true;
}

export function supabaseAvatarStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): AvatarStore {
  return {
    async rows(by, keys) {
      if (Date.now() >= missingUntil) {
        const { data, error } = await sb
          .from("profiles")
          .select("id, username, avatar")
          .in(by === "id" ? "id" : "username_lower", by === "id" ? keys : keys.map((k) => k.toLowerCase()));
        if (!error) return (data ?? []) as Row[];
        if (!missing(error)) throw new Error(error.message);
      }
      return accountRows(by, keys, () => null);
    },
    async save(userId, avatar) {
      if (Date.now() < missingUntil) throw new AvatarsUnavailable("migration 0021 not applied");
      const { error } = await sb.from("profiles").update({ avatar }).eq("id", userId);
      if (error && missing(error)) throw new AvatarsUnavailable(error.message);
      if (error) throw new Error(error.message);
    },
    saves: () => Date.now() >= missingUntil,
  };
}

export function avatarStore(): AvatarStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryAvatarStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseAvatarStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryAvatarStore() : null;
}

// ---------------------------------------------------------------------------
// Looking avatars up
// ---------------------------------------------------------------------------

/** What everyone sees for an account: its choice, or its default. */
export function publicAvatar(row: Row): PublicAvatar {
  return parseAvatar(row.avatar) ?? defaultAvatar(row.username);
}

const CACHE_MS = 60_000;
const CACHE_MAX = 5000;
type Hit = { a: PublicAvatar | null; at: number };
const byId = new Map<string, Hit>();
const byName = new Map<string, Hit>();

async function lookup(by: "id" | "name", keys: string[], now = Date.now()): Promise<Map<string, PublicAvatar>> {
  const cache = by === "id" ? byId : byName;
  const norm = (k: string) => (by === "id" ? k : k.toLowerCase());
  const out = new Map<string, PublicAvatar>();
  const wanted: string[] = [];
  for (const k of new Set(keys.filter(Boolean).map(norm))) {
    const hit = cache.get(k);
    if (hit && now - hit.at < CACHE_MS) {
      if (hit.a) out.set(k, hit.a);
    } else wanted.push(k);
  }
  const store = avatarStore();
  if (!wanted.length || !store) return out;
  try {
    const rows = await store.rows(by, wanted.slice(0, 200));
    if (cache.size > CACHE_MAX) cache.clear();
    const found = new Map(rows.map((r) => [by === "id" ? r.id : r.username.toLowerCase(), publicAvatar(r)]));
    for (const k of wanted.slice(0, 200)) {
      const a = found.get(k) ?? null;
      cache.set(k, { a, at: now });
      if (a) out.set(k, a);
    }
  } catch (err) {
    console.error("[avatars] lookup failed:", err);
  }
  return out;
}

/** Avatars of these accounts, by account id (one query for all of them). */
export const avatarsByIds = (ids: string[]) => lookup("id", ids);

/** Avatars by lower-cased name; names that aren't accounts (guests) are left out. Never throws. */
export async function avatarsByNames(names: (string | null | undefined)[]): Promise<AvatarMap> {
  return Object.fromEntries(await lookup("name", names.filter((n): n is string => !!n)));
}

/** A view with its trainers' avatars added (`avatars`, by lower-cased name). */
export async function withAvatars<T extends object>(view: T, names: (string | null | undefined)[]): Promise<T & { avatars: AvatarMap }> {
  return { ...view, avatars: await avatarsByNames(names) };
}

/** A battle or duel view with each seat's avatar added (seats whose name isn't an account get none). */
export async function seatAvatars<V extends { players: DuelPlayerView[] }>(view: V): Promise<V> {
  const map = await avatarsByNames(view.players.map((p) => p.name));
  return { ...view, players: view.players.map((p) => (map[p.name.toLowerCase()] ? { ...p, avatar: map[p.name.toLowerCase()] } : p)) };
}

function forget(userId: string, username: string) {
  byId.delete(userId);
  byName.delete(username.toLowerCase());
}

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

const quietly = <T>(p: Promise<T> | undefined, fallback: T): Promise<T> => (p ?? Promise.resolve(fallback)).catch(() => fallback);

/** What an account has unlocked: its level (synced XP) and best rating in ranked Pokédle or any ladder. */
export async function avatarUnlocks(userId: string): Promise<AvatarUnlocks> {
  const [digests, pokedle, ladder] = await Promise.all([
    quietly(progressDigests([userId]), new Map()),
    quietly(rankedStore()?.rating(rankedKey(`u:${userId}`)), null),
    quietly(ladderStore()?.standings(battleKey(`u:${userId}`)), []),
  ]);
  const ratings = [...(pokedle && pokedle.games > 0 ? [pokedle.rating] : []), ...ladder.filter((l) => l.standing.games > 0).map((l) => l.standing.rating)];
  return { level: levelFromXp(digests.get(userId)?.xp ?? 0), tier: bestTier(ratings) };
}

/** The account's own avatar (its choice or default). */
export async function ownAvatar(user: { id: string; username: string }): Promise<PublicAvatar> {
  const store = avatarStore();
  const row = store ? (await store.rows("id", [user.id]).catch(() => []))[0] : undefined;
  return row ? publicAvatar(row) : defaultAvatar(user.username);
}

export type SaveAvatar = { ok: true; avatar: PublicAvatar } | { ok: false; status: number; error: string };

/** Saves a trainer's pick, after checking the Pokémon is real and the shiny and frame are theirs to use. */
export async function chooseAvatar(user: { id: string; username: string }, raw: unknown): Promise<SaveAvatar> {
  const store = avatarStore();
  if (!store?.saves()) return { ok: false, status: 503, error: "Avatars open soon." };
  const checked = checkAvatar(raw, await avatarUnlocks(user.id));
  if (!checked.ok) return { ok: false, status: 403, error: checked.error };
  try {
    await store.save(user.id, checked.avatar);
  } catch (err) {
    if (err instanceof AvatarsUnavailable) return { ok: false, status: 503, error: "Avatars open soon." };
    throw err;
  }
  forget(user.id, user.username);
  return { ok: true, avatar: checked.avatar };
}
