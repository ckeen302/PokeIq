import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { PublicUser } from "../accounts";
import { sameOrigin, sessionTokenHash, userFromRequest } from "../auth";
import { clientIp, rateLimit, tooManyRequests } from "../rate-limit";
import { NoTournaments } from "./service";
import { TournamentsUnavailable } from "./store";

/** Shared by the tournament endpoints: CSRF on writes, rate limits, the signed-in trainer, and "not available" before the migration. */

export const NO_STORE = { "Cache-Control": "no-store" };

export async function tournamentRequest(
  request: NextRequest,
  bucket: string,
  { perMinute = 60, signedIn = true }: { perMinute?: number; signedIn?: boolean } = {}
): Promise<{ user: PublicUser | null } | NextResponse> {
  if (request.method !== "GET" && !sameOrigin(request)) return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403, headers: NO_STORE });
  if (!rateLimit(`${bucket}:${clientIp(request)}`, perMinute, perMinute / 60)) return tooManyRequests();
  const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
  if (signedIn && !user) return NextResponse.json({ error: "Sign in to play in tournaments." }, { status: 401, headers: NO_STORE });
  return { user };
}

export async function tournamentAction(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof NoTournaments || err instanceof TournamentsUnavailable) return NextResponse.json({ available: false, error: "Tournaments open soon." }, { status: 503, headers: NO_STORE });
    console.error("[tournaments]", err);
    return NextResponse.json({ error: "Something went wrong on our side. Try again." }, { status: 500, headers: NO_STORE });
  }
}

export function result(out: { ok: true } | { ok: false; status: number; error: string }, body: Record<string, unknown> = {}): NextResponse {
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
  return NextResponse.json({ ok: true, ...body }, { headers: NO_STORE });
}
