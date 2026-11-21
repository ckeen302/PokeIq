import "server-only";
import type { NextRequest } from "next/server";
import { randomId, signToken, verifyToken } from "./crypto";
import { sessionTokenHash, userFromRequest } from "./auth";

/**
 * Who a ranked trainer is, for ranked PokéGuessr and the battle ladder.
 *
 * A trainer is their account when signed in, else a signed anonymous id the
 * server hands their browser (so ids can't be made up to take over someone
 * else's rating). Each ladder stores only an HMAC of it.
 */

// ---------------------------------------------------------------------------
// Who's playing
// ---------------------------------------------------------------------------

// The token kind every anonymous id was signed under (it began with ranked Pokédle): kept, so ids browsers already hold stay valid.
const ANON_KIND = "pokedle-ranked-anon";
const ANON_RE = /^[A-Za-z0-9_-]{16}$/;

/** A new signed anonymous id for a browser that doesn't have one. */
export const newAnonId = () => signToken(ANON_KIND, { a: randomId(12) });

/** The anonymous id inside a token, if the server signed it. */
export function readAnonId(token: unknown): string | null {
  const out = verifyToken<{ a?: unknown }>(ANON_KIND, token);
  return out && typeof out.a === "string" && ANON_RE.test(out.a) ? out.a : null;
}

/**
 * Thrown when a request carries a session but the accounts service can't say
 * whose it is. Falling back to the browser's anonymous id would rate a
 * signed-in trainer's game on a different ladder entry, so callers answer
 * 503 (or, for casual play, go on without a ladder key).
 */
export class AccountsUnavailable extends Error {
  constructor() {
    super("Accounts are unavailable right now.");
  }
}

/**
 * The trainer behind a request: their account if signed in, else the
 * anonymous id they sent. Null when neither. A session cookie that no longer
 * names an account (signed out elsewhere, expired) counts as no session.
 * Throws AccountsUnavailable when there is a session and the accounts
 * service fails: never the anonymous id for a request that carries a session.
 */
export async function rankedIdentity(request: NextRequest, anonToken: unknown): Promise<string | null> {
  if (sessionTokenHash(request)) {
    let user: Awaited<ReturnType<typeof userFromRequest>>;
    try {
      user = await userFromRequest(request);
    } catch (err) {
      console.error("[ranked] accounts lookup failed:", err);
      throw new AccountsUnavailable();
    }
    if (user) return `u:${user.id}`;
  }
  const anon = readAnonId(anonToken);
  return anon ? `a:${anon}` : null;
}

/** Thrown when a ladder's store isn't there (its migration hasn't been applied). */
export class RankedUnavailable extends Error {}
