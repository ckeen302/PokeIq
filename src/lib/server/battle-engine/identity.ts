import "server-only";
import type { NextRequest } from "next/server";
import { deriveSeed } from "../crypto";
import { findUserByName } from "../accounts";
import { clientIp } from "../rate-limit";
import { AccountsUnavailable, rankedIdentity } from "../ranked";

/**
 * Who a battler is, for the ladder, their battle record and "My replays":
 * their account when signed in, else the signed anonymous id the server gave
 * their browser (the same one ranked Pokédle uses). Only an HMAC of it, the
 * ladder key, is ever stored; it never leaves the server.
 */

export const battleKey = (identity: string) => deriveSeed("battle-ladder", identity);

/**
 * The ladder key of whoever sent `request` (with the browser's signed id), or
 * null. Throws AccountsUnavailable when the request carries a session the
 * accounts service can't read (see rankedIdentity).
 */
export async function battlePlayerKey(request: NextRequest, anonToken: unknown): Promise<string | null> {
  const identity = await rankedIdentity(request, anonToken);
  return identity ? battleKey(identity) : null;
}

/**
 * For casual play: as battlePlayerKey, but while the accounts service is down
 * a signed-in trainer plays on without a ladder key (the battle isn't added
 * to anyone's record) rather than under their anonymous id or not at all.
 */
export async function casualBattlePlayerKey(request: NextRequest, anonToken: unknown): Promise<string | null> {
  try {
    return await battlePlayerKey(request, anonToken);
  } catch (err) {
    if (err instanceof AccountsUnavailable) return null;
    throw err;
  }
}

/**
 * For ranked play: the ladder key of a signed-in trainer. Anyone else is a
 * "guest" (ranked needs an account, as on Showdown: a cookie id would make
 * every private window a fresh ladder entry); "down" while the accounts
 * service can't say who a session belongs to.
 */
export async function rankedBattlePlayerKey(request: NextRequest): Promise<{ ok: true; key: string } | { ok: false; reason: "guest" | "down" }> {
  let identity: string | null;
  try {
    identity = await rankedIdentity(request, null);
  } catch (err) {
    if (err instanceof AccountsUnavailable) return { ok: false, reason: "down" };
    throw err;
  }
  return identity?.startsWith("u:") ? { ok: true, key: battleKey(identity) } : { ok: false, reason: "guest" };
}

/** An account's ladder key, for its public battle profile; null if there's no such account. */
export async function accountBattleKey(username: string): Promise<{ key: string; username: string } | null> {
  const user = await findUserByName(username).catch(() => null);
  return user ? { key: battleKey(`u:${user.id}`), username: user.username } : null;
}

/**
 * A salted HMAC of the request's IP address, for matchmaking's
 * same-connection rule; undefined when the address isn't known. The address
 * itself is never stored.
 */
export function ipHashOf(request: NextRequest): string | undefined {
  const ip = clientIp(request);
  return ip && ip !== "unknown" ? deriveSeed("battle-ip", ip) : undefined;
}
