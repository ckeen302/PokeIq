import "server-only";
import type { NextRequest } from "next/server";
import { deriveSeed } from "../crypto";
import { findUserByName } from "../accounts";
import { rankedIdentity } from "../ranked";

/**
 * Who a battler is, for the ladder, their battle record and "My replays":
 * their account when signed in, else the signed anonymous id the server gave
 * their browser (the same one ranked Pokédle uses). Only an HMAC of it, the
 * ladder key, is ever stored; it never leaves the server.
 */

export const battleKey = (identity: string) => deriveSeed("battle-ladder", identity);

/** The ladder key of whoever sent `request` (with the browser's signed id), or null. */
export async function battlePlayerKey(request: NextRequest, anonToken: unknown): Promise<string | null> {
  const identity = await rankedIdentity(request, anonToken);
  return identity ? battleKey(identity) : null;
}

/** An account's ladder key, for its public battle profile; null if there's no such account. */
export async function accountBattleKey(username: string): Promise<{ key: string; username: string } | null> {
  const user = await findUserByName(username).catch(() => null);
  return user ? { key: battleKey(`u:${user.id}`), username: user.username } : null;
}
