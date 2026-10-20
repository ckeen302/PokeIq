import "server-only";
import { randomInt } from "node:crypto";
import { findUserByName, progressDigests, usersByIds, type ProgressDigest, type PublicUser } from "./accounts";
import { pairOf, type ChallengeRow, type FriendStore, type Friendship } from "./friends-store";
import {
  CHALLENGE_TTL_MS,
  MAX_CHALLENGES_OUT,
  MAX_FRIENDS,
  MAX_PENDING_OUT,
  PRESENCE_TTL_MS,
  challengeHref,
  type ChallengeKind,
  type ChallengeView,
  type FriendActivity,
  type FriendDaily,
  type FriendsResponse,
  type FriendView,
  type HeartbeatResponse,
  type MetRelation,
} from "@/lib/community";

/**
 * The rules of friends, presence and challenges, on top of a FriendStore.
 *
 * - A request goes to an account by name. Either side blocking the other
 *   stops it (and the error doesn't say which). Two trainers asking each
 *   other become friends at once.
 * - Accept, decline, cancel and remove change only the pair's own row.
 * - Blocking removes any friendship and challenge between the two.
 * - Online status, activity and dailies are shown to accepted friends only,
 *   and not at all while a trainer appears offline.
 * - A challenge goes to an accepted friend only, for a battle or duel the
 *   challenger already opened; the friend answers it once.
 */

export type Fail = { ok: false; status: number; error: string };
export type Result<T = object> = ({ ok: true } & T) | Fail;
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

/** Looks accounts up (the accounts store; tests pass their own). */
export interface Directory {
  byName(name: string): Promise<PublicUser | null>;
  byIds(ids: string[]): Promise<PublicUser[]>;
  digests(ids: string[]): Promise<Map<string, ProgressDigest>>;
}

export const accountDirectory: Directory = { byName: findUserByName, byIds: usersByIds, digests: progressDigests };

const NOT_FOUND = "No trainer by that name.";
const CANT_ADD = "You can't send this trainer a friend request.";

export const isOnline = (p: { expiresAt: number; invisible: boolean } | undefined, now: number) => !!p && !p.invisible && p.expiresAt > now;

/** Whether either trainer has blocked the other. */
export async function blockedEitherWay(store: FriendStore, a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([store.isBlocked(a, b), store.isBlocked(b, a)]);
  return x || y;
}

/** Where `me` stands with `other`. */
export async function relationOf(store: FriendStore, me: string, other: string): Promise<MetRelation> {
  if (await store.isBlocked(me, other)) return "blocked";
  const f = await store.friendship(me, other);
  if (!f) return "none";
  if (f.status === "accepted") return "friends";
  return f.requestedBy === me ? "sent" : "received";
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Sends a friend request to `target` (or accepts theirs, if they asked first). */
export async function requestFriend(store: FriendStore, me: PublicUser, target: PublicUser, now = Date.now()): Promise<Result<{ status: "sent" | "friends" }>> {
  if (target.id === me.id) return fail(400, "That's you!");
  if (await blockedEitherWay(store, me.id, target.id)) return fail(403, CANT_ADD);
  const existing = await store.friendship(me.id, target.id);
  if (existing?.status === "accepted") return fail(409, `You're already friends with ${target.username}.`);
  if (existing && existing.requestedBy === me.id) return fail(409, `You've already sent ${target.username} a request.`);
  const mine = await store.friendshipsOf(me.id);
  if (mine.filter((f) => f.status === "accepted").length >= MAX_FRIENDS) return fail(409, `You can have up to ${MAX_FRIENDS} friends.`);
  if (existing) {
    // They asked first: asking back is accepting.
    await store.acceptFriendship(me.id, target.id);
    return { ok: true, status: "friends" };
  }
  if (mine.filter((f) => f.status === "pending" && f.requestedBy === me.id).length >= MAX_PENDING_OUT) {
    return fail(409, "You have lots of requests waiting. Wait for some answers first.");
  }
  const [a, b] = pairOf(me.id, target.id);
  const row: Friendship = { a, b, requestedBy: me.id, status: "pending", createdAt: now };
  if (!(await store.insertFriendship(row))) {
    // Both asked at the same moment: theirs won the insert.
    const now2 = await store.friendship(me.id, target.id);
    if (now2?.status === "pending" && now2.requestedBy !== me.id) {
      await store.acceptFriendship(me.id, target.id);
      return { ok: true, status: "friends" };
    }
    return fail(409, `You've already sent ${target.username} a request.`);
  }
  return { ok: true, status: "sent" };
}

export async function requestFriendByName(store: FriendStore, dir: Directory, me: PublicUser, name: string, now = Date.now()) {
  const target = await dir.byName(name);
  if (!target) return fail(404, NOT_FOUND);
  return requestFriend(store, me, target, now);
}

/** Accepts or declines a request `name` sent. */
export async function answerRequest(store: FriendStore, dir: Directory, me: PublicUser, name: string, accept: boolean): Promise<Result> {
  const other = await dir.byName(name);
  if (!other) return fail(404, NOT_FOUND);
  const f = await store.friendship(me.id, other.id);
  if (!f || f.status !== "pending" || f.requestedBy === me.id) return fail(404, "That request isn't there any more.");
  if (accept) {
    if (await blockedEitherWay(store, me.id, other.id)) return fail(403, "You can't add this trainer.");
    await store.acceptFriendship(me.id, other.id);
  } else {
    await store.deleteFriendship(me.id, other.id);
  }
  return { ok: true };
}

/** Takes back a request, or removes a friend. */
export async function removeFriend(store: FriendStore, dir: Directory, me: PublicUser, name: string): Promise<Result> {
  const other = await dir.byName(name);
  if (!other) return fail(404, NOT_FOUND);
  const f = await store.friendship(me.id, other.id);
  // A request they sent is declined, not removed.
  if (!f || (f.status === "pending" && f.requestedBy !== me.id)) return fail(404, "You're not friends with this trainer.");
  await store.deleteFriendship(me.id, other.id);
  await store.deleteChallengesBetween(me.id, other.id);
  return { ok: true };
}

export async function blockUser(store: FriendStore, dir: Directory, me: PublicUser, name: string): Promise<Result> {
  const other = await dir.byName(name);
  if (!other) return fail(404, NOT_FOUND);
  if (other.id === me.id) return fail(400, "You can't block yourself.");
  await store.block(me.id, other.id);
  await store.deleteFriendship(me.id, other.id);
  await store.deleteChallengesBetween(me.id, other.id);
  return { ok: true };
}

export async function unblockUser(store: FriendStore, dir: Directory, me: PublicUser, name: string): Promise<Result> {
  const other = await dir.byName(name);
  if (!other) return fail(404, NOT_FOUND);
  await store.unblock(me.id, other.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The friends list
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** A streak still counts if its last day was today or yesterday (a day of slack for time zones). */
function liveStreak(last: unknown, streak: unknown, now: number): number {
  if (typeof last !== "string" || !DATE_RE.test(last)) return 0;
  return now - dayMs(last) <= 3 * 86_400_000 ? num(streak) : 0;
}

/** The latest day in a progress record's results, if any. */
function latest(results: unknown): [string, Record<string, unknown>] | null {
  if (!results || typeof results !== "object") return null;
  const days = Object.keys(results).filter((d) => DATE_RE.test(d)).sort();
  const day = days[days.length - 1];
  const rec = day ? (results as Record<string, unknown>)[day] : null;
  return day && rec && typeof rec === "object" ? [day, rec as Record<string, unknown>] : null;
}

/** A friend's latest dailies, from their synced progress (never trusted to be well-formed). */
export function dailyDigest(digest: ProgressDigest | undefined, now = Date.now()): FriendDaily | null {
  if (!digest) return null;
  const out: FriendDaily = {};
  const daily = digest.daily as { last?: unknown; streak?: unknown; results?: unknown } | null;
  const d = latest(daily?.results);
  if (d) out.daily = { date: d[0], correct: num(d[1].correct), total: num(d[1].total), streak: liveStreak(daily?.last, daily?.streak, now) };
  const dle = digest.dle as { last?: unknown; streak?: unknown; results?: unknown } | null;
  const p = latest(dle?.results);
  if (p && p[1].over === true) {
    out.dle = { date: p[0], solved: p[1].solved === true, guesses: Array.isArray(p[1].guesses) ? p[1].guesses.length : 0, streak: liveStreak(dle?.last, dle?.streak, now) };
  }
  return out.daily || out.dle ? out : null;
}

export async function listFriends(store: FriendStore, dir: Directory, me: PublicUser, now = Date.now()): Promise<FriendsResponse> {
  const [rows, blockedIds, mine] = await Promise.all([store.friendshipsOf(me.id), store.blocksOf(me.id), store.presence([me.id])]);
  const other = (f: Friendship) => (f.a === me.id ? f.b : f.a);
  const friendIds = rows.filter((f) => f.status === "accepted").map(other);
  const [users, presence, digests] = await Promise.all([
    dir.byIds([...rows.map(other), ...blockedIds]),
    store.presence(friendIds),
    friendIds.length ? dir.digests(friendIds) : Promise.resolve(new Map<string, ProgressDigest>()),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.username]));
  const presenceOf = new Map(presence.map((p) => [p.userId, p]));
  const friends: FriendView[] = [];
  const incoming: FriendsResponse["incoming"] = [];
  const outgoing: FriendsResponse["outgoing"] = [];
  for (const f of rows) {
    const id = other(f);
    const username = nameOf.get(id);
    if (!username) continue;
    if (f.status === "pending") {
      (f.requestedBy === me.id ? outgoing : incoming).push({ username, at: f.createdAt });
      continue;
    }
    const p = presenceOf.get(id);
    const online = isOnline(p, now);
    friends.push({ username, online, activity: online ? (p?.activity ?? null) : null, daily: dailyDigest(digests.get(id), now), since: f.createdAt });
  }
  friends.sort((x, y) => Number(y.online) - Number(x.online) || x.username.toLowerCase().localeCompare(y.username.toLowerCase()));
  return {
    available: true,
    signedIn: true,
    friends,
    incoming: incoming.sort((x, y) => y.at - x.at),
    outgoing: outgoing.sort((x, y) => y.at - x.at),
    blocked: blockedIds.map((id) => nameOf.get(id)).filter((n): n is string => !!n),
    appearOffline: mine[0]?.invisible ?? false,
  };
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

/**
 * A heartbeat: marks the trainer online until now + TTL with what they're
 * doing, and returns what's waiting for them (friend requests, challenges,
 * answers to their own challenges, each answer delivered once).
 */
export async function heartbeat(store: FriendStore, dir: Directory, me: PublicUser, activity: FriendActivity | null, now = Date.now()): Promise<HeartbeatResponse> {
  await store.beat(me.id, now, now + PRESENCE_TTL_MS, activity);
  const [rows, to, from] = await Promise.all([store.friendshipsOf(me.id), store.challengesTo(me.id, now), store.challengesFrom(me.id, now)]);
  const requests = rows.filter((f) => f.status === "pending" && f.requestedBy !== me.id).length;
  const waiting = to.filter((c) => c.status === "pending");
  const answered = from.filter((c) => c.status !== "pending");
  const names = new Map((await dir.byIds([...waiting.map((c) => c.from), ...answered.map((c) => c.to)])).map((u) => [u.id, u.username]));
  if (answered.length) await store.deleteChallenges(answered.map((c) => c.id));
  return {
    available: true,
    requests,
    challenges: waiting
      .filter((c) => names.has(c.from))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => challengeView(c, names.get(c.from)!)),
    answers: answered.filter((c) => names.has(c.to)).map((c) => ({ id: c.id, to: names.get(c.to)!, label: c.label, status: c.status as "accepted" | "declined" })),
  };
}

const challengeView = (c: ChallengeRow, from: string): ChallengeView => ({ id: c.id, from, kind: c.kind, label: c.label, href: challengeHref(c.kind, c.code), expiresAt: c.expiresAt });

/** "Appear offline": friends see the trainer as offline (and they aren't counted online). */
export async function setAppearOffline(store: FriendStore, me: PublicUser, on: boolean): Promise<void> {
  await store.setInvisible(me.id, on);
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newChallengeId = () => Array.from({ length: 12 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join("");

/** Challenges a friend to a battle or duel `me` already opened (`code`; checked by the caller). */
export async function sendChallenge(
  store: FriendStore,
  dir: Directory,
  me: PublicUser,
  toName: string,
  game: { kind: ChallengeKind; code: string; label: string },
  now = Date.now()
): Promise<Result<{ id: string }>> {
  const to = await dir.byName(toName);
  if (!to) return fail(404, NOT_FOUND);
  if (to.id === me.id) return fail(400, "That's you!");
  const f = await store.friendship(me.id, to.id);
  if (f?.status !== "accepted" || (await blockedEitherWay(store, me.id, to.id))) return fail(403, `You can only challenge your friends.`);
  const out = (await store.challengesFrom(me.id, now)).filter((c) => c.status === "pending");
  // A new challenge to the same friend replaces the last one.
  const stale = out.filter((c) => c.to === to.id).map((c) => c.id);
  if (out.length - stale.length >= MAX_CHALLENGES_OUT) return fail(429, "You have lots of challenges waiting. Wait for some answers first.");
  if (stale.length) await store.deleteChallenges(stale);
  const id = newChallengeId();
  await store.insertChallenge({ id, from: me.id, to: to.id, kind: game.kind, code: game.code, label: game.label.slice(0, 80), status: "pending", createdAt: now, expiresAt: now + CHALLENGE_TTL_MS });
  return { ok: true, id };
}

/** Accepts (the answer carries the invite page) or declines a challenge sent to `me`. */
export async function answerChallenge(store: FriendStore, me: PublicUser, id: string, accept: boolean, now = Date.now()): Promise<Result<{ href?: string }>> {
  const c = await store.challenge(id);
  if (!c || c.to !== me.id || c.expiresAt <= now) return fail(404, "That challenge has expired.");
  if (c.status !== "pending") return fail(409, "You've already answered that challenge.");
  if (accept && (await blockedEitherWay(store, me.id, c.from))) return fail(403, "You can't accept this challenge.");
  await store.setChallengeStatus(id, accept ? "accepted" : "declined");
  return accept ? { ok: true, href: challengeHref(c.kind, c.code) } : { ok: true };
}

/** Takes back a challenge `me` sent. */
export async function cancelChallenge(store: FriendStore, me: PublicUser, id: string): Promise<Result> {
  const c = await store.challenge(id);
  if (!c || c.from !== me.id) return fail(404, "That challenge isn't there any more.");
  await store.deleteChallenges([id]);
  return { ok: true };
}
