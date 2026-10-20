import { NextRequest, NextResponse } from "next/server";
import { accountsEnabled, searchUsers } from "@/lib/server/accounts";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { USER_QUERY_RE, type UserHit } from "@/lib/community";

/**
 * GET /api/users?q=<prefix>: accounts whose name starts with `q` (at least
 * two characters of a valid name), alphabetically, at most 20. Only names:
 * the rest is on each trainer's public profile.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!rateLimit(`user-search:${clientIp(request)}`, 30, 0.5)) return tooManyRequests("Searching too fast. Wait a moment.", 10);
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (!USER_QUERY_RE.test(q)) return NextResponse.json({ users: [] }, { headers: { "Cache-Control": "no-store" } });
  if (!accountsEnabled()) return NextResponse.json({ users: [], available: false }, { headers: { "Cache-Control": "no-store" } });
  try {
    const users: UserHit[] = (await searchUsers(q, 20)).map((username) => ({ username }));
    // Public data, the same for everyone: a minute at the CDN is plenty fresh.
    return NextResponse.json({ users }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } });
  } catch (err) {
    console.error("[user-search]", err);
    return NextResponse.json({ error: "Search isn't working right now. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
