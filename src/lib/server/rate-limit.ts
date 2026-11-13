import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Token-bucket rate limiter. In-process, so limits are per instance — enough
 * to blunt scripted abuse of the grading and leaderboard endpoints; swap the
 * Map for Redis/Upstash for global limits.
 *
 * Phone carriers and schools put many players behind one address (CGNAT), so
 * gameplay isn't limited by address alone:
 * - a request carrying something the server signed for one player (a run's
 *   token, a battle seat) is limited per player at the route's rate, and the
 *   address shares a ceiling SHARED_ADDRESS_FACTOR times that (playerRateLimit);
 * - a request with nothing signed yet (starting a game, a Daily's guess,
 *   reading a board) is limited per address at CROWD_FACTOR times the route's
 *   rate, CROWD_WRITE_FACTOR for one that stores a result (crowdRateLimit):
 *   room for a crowd, still a wall for one client looping.
 */

interface Bucket {
  tokens: number;
  updated: number;
}

/** Least recently used first: a bucket is moved to the end each time it's used. */
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;

export function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Gameplay writes (posting a score, starting a duel or party, asking for a
 * hint): 25 at once, 25 a minute, per player where the request carries a
 * signed one (playerRateLimit), else per address. Boards add their own
 * per-address and per-day entry caps on top (board-guard.ts).
 */
export const GAMEPLAY_IP_LIMIT = [25, 25 / 60] as const;

/*
 * Sized for 200 players behind one address, each acting every few seconds,
 * all on the same game at once: a Daily's guess route then sees ~40 requests
 * a second from that address, against a route rate of 1–4 a second for one
 * player.
 */
/** The address ceiling over per-player limits: many players can share one address. */
export const SHARED_ADDRESS_FACTOR = 40;
/** Per-address limits on requests that carry no signed player yet (starting a game, a guess on a Daily, reading a board). */
export const CROWD_FACTOR = 40;
/** The same for a request that stores a row (a Daily's result): one per game, so a crowd needs less headroom. */
export const CROWD_WRITE_FACTOR = 10;

/**
 * Returns true if the request is allowed. When the map is full the least
 * recently used bucket goes (it has sat longest, so it had refilled anyway);
 * never all of them at once, which would hand a flood fresh buckets.
 */
export function rateLimit(key: string, capacity: number, refillPerSecond: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, updated: now };
  bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updated) / 1000) * refillPerSecond);
  bucket.updated = now;
  const allowed = bucket.tokens >= 1;
  if (allowed) bucket.tokens -= 1;
  buckets.delete(key);
  buckets.set(key, bucket);
  if (buckets.size > MAX_BUCKETS) buckets.delete(buckets.keys().next().value!);
  return allowed;
}

/**
 * A gameplay limit for a request that carries a signed player: `player` is
 * an id the server itself signed (a run's id from its token, a battle seat),
 * never something the client chose. That player gets the route's own rate;
 * their address shares SHARED_ADDRESS_FACTOR times it, the backstop against
 * one client spending many tokens. Without a player (no token, or one that
 * doesn't verify) it's the route's rate per address, as before.
 *
 * The player's bucket is checked first, so one player hammering is stopped
 * on their own bucket and doesn't drain the address's for everyone else.
 */
export function playerRateLimit(request: NextRequest, bucket: string, capacity: number, refillPerSecond: number, player: string | null | undefined): boolean {
  const ip = clientIp(request);
  if (!player) return rateLimit(`${bucket}:${ip}`, capacity, refillPerSecond);
  return (
    rateLimit(`${bucket}:p:${player}`, capacity, refillPerSecond) &&
    rateLimit(`${bucket}:ip:${ip}`, capacity * SHARED_ADDRESS_FACTOR, refillPerSecond * SHARED_ADDRESS_FACTOR)
  );
}

/** A per-address limit sized for a crowd behind one address (`factor` times the route's rate), for requests with no signed player yet. */
export function crowdRateLimit(request: NextRequest, bucket: string, capacity: number, refillPerSecond: number, factor = CROWD_FACTOR): boolean {
  return rateLimit(`${bucket}:${clientIp(request)}`, capacity * factor, refillPerSecond * factor);
}

/** Tests: start from empty buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** The 429 every endpoint sends: JSON with a message a player can read. */
export function tooManyRequests(error = "Slow down a little — try again in a moment.", retryAfterSeconds = 30): NextResponse {
  return NextResponse.json(
    { error },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } }
  );
}

/**
 * Chat messages, on top of the per-trainer limit each battle or duel keeps
 * (one a second, five in ten seconds): the same per trainer on this instance,
 * and per address. A friendly 429, or null to go ahead.
 */
export function chatRateLimit(ip: string, player: string): NextResponse | null {
  if (!rateLimit(`chat-player:${player}`, 5, 0.5)) return tooManyRequests("You're sending messages too fast. Wait a few seconds.", 5);
  if (!rateLimit(`chat-ip:${ip}`, 10, 1)) return tooManyRequests("Lots of messages from your network. Wait a few seconds.", 10);
  return null;
}
