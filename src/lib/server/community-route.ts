import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { PublicUser } from "./accounts";
import { sameOrigin, sessionTokenHash, userFromRequest } from "./auth";
import { clientIp, rateLimit, tooManyRequests } from "./rate-limit";
import { friendStore, FriendsUnavailable, type FriendStore } from "./friends-store";

/**
 * Shared guards for the friends endpoints: CSRF on writes, a per-address and
 * per-account rate limit, the store (absent: `available: false`), and the
 * signed-in trainer (guests get a 401 that asks them to sign in).
 */

export const NO_STORE = { "Cache-Control": "no-store" };

export const unavailable = (extra: Record<string, unknown> = {}) => NextResponse.json({ available: false, ...extra }, { headers: NO_STORE });

export async function communityRequest(
  request: NextRequest,
  bucket: string,
  { capacity = 30, perMinute = 30, write = request.method !== "GET" }: { capacity?: number; perMinute?: number; write?: boolean } = {}
): Promise<{ user: PublicUser; store: FriendStore } | NextResponse> {
  if (write && !sameOrigin(request)) return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403, headers: NO_STORE });
  // Per address, roomier (a school or office shares one), then per account below.
  if (!rateLimit(`${bucket}:${clientIp(request)}`, capacity * 5, (perMinute * 5) / 60)) return tooManyRequests();
  const store = friendStore();
  if (!store) return unavailable({ signedIn: false });
  const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
  if (!user) return NextResponse.json({ available: true, signedIn: false, error: "Sign in to use friends." }, { status: 401, headers: NO_STORE });
  if (!rateLimit(`${bucket}-user:${user.id}`, capacity, perMinute / 60)) return tooManyRequests();
  return { user, store };
}

/** Runs a friends action: missing tables answer `available: false`, anything else a 500. */
export async function friendsAction(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof FriendsUnavailable) return unavailable({ signedIn: true });
    console.error("[friends]", err);
    return NextResponse.json({ error: "Something went wrong on our side. Try again." }, { status: 500, headers: NO_STORE });
  }
}

export function outcome(out: { ok: true } | { ok: false; status: number; error: string }, body: Record<string, unknown> = {}): NextResponse {
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
  const { ok: _ok, ...rest } = out as Record<string, unknown>;
  void _ok;
  return NextResponse.json({ ok: true, ...rest, ...body }, { headers: NO_STORE });
}
