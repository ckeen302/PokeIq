import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import type { ChallengeKind, FriendActivity } from "@/lib/community";

/**
 * Where friends, presence, challenges and encounters live (migration 0019):
 * Supabase tables locked to the service role, or memory with
 * POKEIQ_LOCAL_ACCOUNTS=1 (tests, the local E2E run) and in development
 * without Supabase. Production without Supabase has no friends; before the
 * migration is applied every call throws FriendsUnavailable and the routes
 * answer `available: false`.
 */

export class FriendsUnavailable extends Error {}

export interface Friendship {
  /** The pair, a < b. */
  a: string;
  b: string;
  requestedBy: string;
  status: "pending" | "accepted";
  createdAt: number;
}

export interface PresenceRow {
  userId: string;
  lastSeen: number;
  expiresAt: number;
  invisible: boolean;
  activity: FriendActivity | null;
}

export interface ChallengeRow {
  id: string;
  from: string;
  to: string;
  kind: ChallengeKind;
  code: string;
  label: string;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
  expiresAt: number;
}

export interface FriendStore {
  friendship(a: string, b: string): Promise<Friendship | null>;
  friendshipsOf(user: string): Promise<Friendship[]>;
  /** False if the pair already has a row. */
  insertFriendship(f: Friendship): Promise<boolean>;
  acceptFriendship(a: string, b: string): Promise<void>;
  deleteFriendship(a: string, b: string): Promise<void>;

  isBlocked(blocker: string, blocked: string): Promise<boolean>;
  blocksOf(blocker: string): Promise<string[]>;
  block(blocker: string, blocked: string): Promise<void>;
  unblock(blocker: string, blocked: string): Promise<void>;

  presence(ids: string[]): Promise<PresenceRow[]>;
  /** Writes a heartbeat (leaves `invisible` as it was). */
  beat(userId: string, lastSeen: number, expiresAt: number, activity: FriendActivity | null): Promise<void>;
  setInvisible(userId: string, invisible: boolean): Promise<void>;
  /** Visible trainers whose presence hasn't expired by `now` (at most `limit`). */
  onlineIds(now: number, limit?: number): Promise<string[]>;
  /** Visible trainers in chat rooms right now (one room, or all of them). */
  roomPresence(now: number, room?: string, limit?: number): Promise<{ userId: string; room: string }[]>;

  insertChallenge(c: ChallengeRow): Promise<void>;
  /** Unexpired challenges to `user`, or from `user` (any status). */
  challengesTo(user: string, now: number): Promise<ChallengeRow[]>;
  challengesFrom(user: string, now: number): Promise<ChallengeRow[]>;
  challenge(id: string): Promise<ChallengeRow | null>;
  setChallengeStatus(id: string, status: ChallengeRow["status"]): Promise<void>;
  deleteChallenges(ids: string[]): Promise<void>;
  /** Drops every challenge between two trainers (a block or a removed friend). */
  deleteChallengesBetween(a: string, b: string): Promise<void>;

  putEncounter(key: string, userId: string, expiresAt: number): Promise<void>;
  encounter(key: string, now: number): Promise<string | null>;
}

export const pairOf = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

interface MemoryDb {
  friendships: Map<string, Friendship>;
  blocks: Set<string>;
  presence: Map<string, PresenceRow>;
  challenges: Map<string, ChallengeRow>;
  encounters: Map<string, { userId: string; expiresAt: number }>;
}

const globalStore = globalThis as unknown as { __pokeiqFriends?: MemoryDb };
const blankDb = (): MemoryDb => ({ friendships: new Map(), blocks: new Set(), presence: new Map(), challenges: new Map(), encounters: new Map() });

export function clearMemoryFriends() {
  globalStore.__pokeiqFriends = blankDb();
}

export function memoryFriendStore(): FriendStore {
  const db = () => (globalStore.__pokeiqFriends ??= blankDb());
  const pairKey = (a: string, b: string) => pairOf(a, b).join("|");
  const copy = <T>(v: T): T => structuredClone(v);
  return {
    async friendship(a, b) {
      const f = db().friendships.get(pairKey(a, b));
      return f ? copy(f) : null;
    },
    async friendshipsOf(user) {
      return [...db().friendships.values()].filter((f) => f.a === user || f.b === user).map(copy);
    },
    async insertFriendship(f) {
      const key = pairKey(f.a, f.b);
      if (db().friendships.has(key)) return false;
      db().friendships.set(key, copy(f));
      return true;
    },
    async acceptFriendship(a, b) {
      const f = db().friendships.get(pairKey(a, b));
      if (f) f.status = "accepted";
    },
    async deleteFriendship(a, b) {
      db().friendships.delete(pairKey(a, b));
    },
    async isBlocked(blocker, blocked) {
      return db().blocks.has(`${blocker}>${blocked}`);
    },
    async blocksOf(blocker) {
      return [...db().blocks].filter((k) => k.startsWith(`${blocker}>`)).map((k) => k.slice(blocker.length + 1));
    },
    async block(blocker, blocked) {
      db().blocks.add(`${blocker}>${blocked}`);
    },
    async unblock(blocker, blocked) {
      db().blocks.delete(`${blocker}>${blocked}`);
    },
    async presence(ids) {
      return ids.map((id) => db().presence.get(id)).filter((p): p is PresenceRow => !!p).map(copy);
    },
    async beat(userId, lastSeen, expiresAt, activity) {
      const was = db().presence.get(userId);
      db().presence.set(userId, { userId, lastSeen, expiresAt, invisible: was?.invisible ?? false, activity: copy(activity) });
    },
    async setInvisible(userId, invisible) {
      const was = db().presence.get(userId);
      db().presence.set(userId, { userId, lastSeen: was?.lastSeen ?? 0, expiresAt: was?.expiresAt ?? 0, activity: was?.activity ?? null, invisible });
    },
    async onlineIds(now, limit = 5000) {
      return [...db().presence.values()].filter((p) => !p.invisible && p.expiresAt > now).slice(0, limit).map((p) => p.userId);
    },
    async roomPresence(now, room, limit = 2000) {
      return [...db().presence.values()]
        .filter((p) => !p.invisible && p.expiresAt > now && p.activity?.room && (!room || p.activity.room === room))
        .slice(0, limit)
        .map((p) => ({ userId: p.userId, room: p.activity!.room! }));
    },
    async insertChallenge(c) {
      db().challenges.set(c.id, copy(c));
    },
    async challengesTo(user, now) {
      return [...db().challenges.values()].filter((c) => c.to === user && c.expiresAt > now).map(copy);
    },
    async challengesFrom(user, now) {
      return [...db().challenges.values()].filter((c) => c.from === user && c.expiresAt > now).map(copy);
    },
    async challenge(id) {
      const c = db().challenges.get(id);
      return c ? copy(c) : null;
    },
    async setChallengeStatus(id, status) {
      const c = db().challenges.get(id);
      if (c) c.status = status;
    },
    async deleteChallenges(ids) {
      for (const id of ids) db().challenges.delete(id);
    },
    async deleteChallengesBetween(a, b) {
      for (const [id, c] of db().challenges) if ((c.from === a && c.to === b) || (c.from === b && c.to === a)) db().challenges.delete(id);
    },
    async putEncounter(key, userId, expiresAt) {
      const now = Date.now();
      for (const [k, e] of db().encounters) if (e.expiresAt <= now) db().encounters.delete(k);
      db().encounters.set(key, { userId, expiresAt });
    },
    async encounter(key, now) {
      const e = db().encounters.get(key);
      return e && e.expiresAt > now ? e.userId : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

type Sb = NonNullable<ReturnType<typeof getServiceSupabase>>;

/** The tables aren't there yet (42P01, or PostgREST's schema-cache miss). */
function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "")) throw new FriendsUnavailable(error.message);
  throw new Error(error.message);
}

interface FriendshipDbRow {
  user_a: string;
  user_b: string;
  requested_by: string;
  status: "pending" | "accepted";
  created_at: string;
}
const fromFriendship = (r: FriendshipDbRow): Friendship => ({ a: r.user_a, b: r.user_b, requestedBy: r.requested_by, status: r.status, createdAt: Date.parse(r.created_at) });

interface ChallengeDbRow {
  id: string;
  from_user: string;
  to_user: string;
  kind: ChallengeKind;
  code: string;
  label: string;
  status: ChallengeRow["status"];
  created_at: string;
  expires_at: string;
}
const fromChallenge = (r: ChallengeDbRow): ChallengeRow => ({
  id: r.id,
  from: r.from_user,
  to: r.to_user,
  kind: r.kind,
  code: r.code,
  label: r.label,
  status: r.status,
  createdAt: Date.parse(r.created_at),
  expiresAt: Date.parse(r.expires_at),
});
const CHALLENGE_COLUMNS = "id, from_user, to_user, kind, code, label, status, created_at, expires_at";
const iso = (ms: number) => new Date(ms).toISOString();

export function supabaseFriendStore(sb: Sb): FriendStore {
  return {
    async friendship(x, y) {
      const [a, b] = pairOf(x, y);
      const { data, error } = await sb.from("friendships").select("user_a, user_b, requested_by, status, created_at").eq("user_a", a).eq("user_b", b).maybeSingle<FriendshipDbRow>();
      check(error);
      return data ? fromFriendship(data) : null;
    },
    async friendshipsOf(user) {
      const { data, error } = await sb.from("friendships").select("user_a, user_b, requested_by, status, created_at").or(`user_a.eq.${user},user_b.eq.${user}`).limit(1000);
      check(error);
      return ((data ?? []) as FriendshipDbRow[]).map(fromFriendship);
    },
    async insertFriendship(f) {
      const { error } = await sb.from("friendships").insert({ user_a: f.a, user_b: f.b, requested_by: f.requestedBy, status: f.status, created_at: iso(f.createdAt) });
      if (error?.code === "23505") return false;
      check(error);
      return true;
    },
    async acceptFriendship(x, y) {
      const [a, b] = pairOf(x, y);
      const { error } = await sb.from("friendships").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("user_a", a).eq("user_b", b);
      check(error);
    },
    async deleteFriendship(x, y) {
      const [a, b] = pairOf(x, y);
      const { error } = await sb.from("friendships").delete().eq("user_a", a).eq("user_b", b);
      check(error);
    },
    async isBlocked(blocker, blocked) {
      const { data, error } = await sb.from("user_blocks").select("blocker").eq("blocker", blocker).eq("blocked", blocked).maybeSingle();
      check(error);
      return !!data;
    },
    async blocksOf(blocker) {
      const { data, error } = await sb.from("user_blocks").select("blocked").eq("blocker", blocker).limit(1000);
      check(error);
      return (data ?? []).map((r: { blocked: string }) => r.blocked);
    },
    async block(blocker, blocked) {
      const { error } = await sb.from("user_blocks").upsert({ blocker, blocked }, { onConflict: "blocker,blocked", ignoreDuplicates: true });
      check(error);
    },
    async unblock(blocker, blocked) {
      const { error } = await sb.from("user_blocks").delete().eq("blocker", blocker).eq("blocked", blocked);
      check(error);
    },
    async presence(ids) {
      if (!ids.length) return [];
      const { data, error } = await sb.from("user_presence").select("user_id, last_seen, expires_at, invisible, activity").in("user_id", ids);
      check(error);
      return ((data ?? []) as { user_id: string; last_seen: string; expires_at: string; invisible: boolean; activity: FriendActivity | null }[]).map((r) => ({
        userId: r.user_id,
        lastSeen: Date.parse(r.last_seen),
        expiresAt: Date.parse(r.expires_at),
        invisible: r.invisible,
        activity: r.activity,
      }));
    },
    async beat(userId, lastSeen, expiresAt, activity) {
      const { error } = await sb.from("user_presence").upsert({ user_id: userId, last_seen: iso(lastSeen), expires_at: iso(expiresAt), activity });
      check(error);
    },
    async setInvisible(userId, invisible) {
      const { error } = await sb.from("user_presence").upsert({ user_id: userId, invisible });
      check(error);
    },
    async onlineIds(now, limit = 5000) {
      const { data, error } = await sb.from("user_presence").select("user_id").eq("invisible", false).gt("expires_at", iso(now)).limit(limit);
      check(error);
      return (data ?? []).map((r: { user_id: string }) => r.user_id);
    },
    async roomPresence(now, room, limit = 2000) {
      let q = sb.from("user_presence").select("user_id, room:activity->>room").eq("invisible", false).gt("expires_at", iso(now));
      q = room ? q.eq("activity->>room", room) : q.not("activity->>room", "is", null);
      const { data, error } = await q.limit(limit);
      check(error);
      return ((data ?? []) as unknown as { user_id: string; room: string | null }[]).filter((r) => r.room).map((r) => ({ userId: r.user_id, room: r.room! }));
    },
    async insertChallenge(c) {
      // Opportunistic cleanup keeps the table small without a cron job.
      await sb.from("friend_challenges").delete().lt("expires_at", iso(Date.now()));
      const { error } = await sb.from("friend_challenges").insert({
        id: c.id,
        from_user: c.from,
        to_user: c.to,
        kind: c.kind,
        code: c.code,
        label: c.label,
        status: c.status,
        created_at: iso(c.createdAt),
        expires_at: iso(c.expiresAt),
      });
      check(error);
    },
    async challengesTo(user, now) {
      const { data, error } = await sb.from("friend_challenges").select(CHALLENGE_COLUMNS).eq("to_user", user).gt("expires_at", iso(now)).limit(50);
      check(error);
      return ((data ?? []) as ChallengeDbRow[]).map(fromChallenge);
    },
    async challengesFrom(user, now) {
      const { data, error } = await sb.from("friend_challenges").select(CHALLENGE_COLUMNS).eq("from_user", user).gt("expires_at", iso(now)).limit(50);
      check(error);
      return ((data ?? []) as ChallengeDbRow[]).map(fromChallenge);
    },
    async challenge(id) {
      const { data, error } = await sb.from("friend_challenges").select(CHALLENGE_COLUMNS).eq("id", id).maybeSingle<ChallengeDbRow>();
      check(error);
      return data ? fromChallenge(data) : null;
    },
    async setChallengeStatus(id, status) {
      const { error } = await sb.from("friend_challenges").update({ status }).eq("id", id);
      check(error);
    },
    async deleteChallenges(ids) {
      if (!ids.length) return;
      const { error } = await sb.from("friend_challenges").delete().in("id", ids);
      check(error);
    },
    async deleteChallengesBetween(a, b) {
      const { error } = await sb.from("friend_challenges").delete().or(`and(from_user.eq.${a},to_user.eq.${b}),and(from_user.eq.${b},to_user.eq.${a})`);
      check(error);
    },
    async putEncounter(key, userId, expiresAt) {
      if (Math.random() < 0.05) await sb.from("friend_encounters").delete().lt("expires_at", iso(Date.now()));
      const { error } = await sb.from("friend_encounters").upsert({ key, user_id: userId, expires_at: iso(expiresAt) });
      check(error);
    },
    async encounter(key, now) {
      const { data, error } = await sb.from("friend_encounters").select("user_id, expires_at").eq("key", key).maybeSingle<{ user_id: string; expires_at: string }>();
      check(error);
      return data && Date.parse(data.expires_at) > now ? data.user_id : null;
    },
  };
}

/** The store for this server, or null when friends are off here (production without Supabase). */
export function friendStore(): FriendStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryFriendStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseFriendStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryFriendStore() : null;
}
