import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { listCustom, publishCustom, searchPokemon } from "@/lib/server/connections-custom";
import { NO_STORE, inputSchema, whoIs } from "@/lib/server/connections-custom-http";

/**
 * PokéConnections' community puzzles.
 *
 * GET /api/connections/custom?q=pika
 *   Pokémon whose names contain the text, for the creator's search box.
 * GET /api/connections/custom
 *   The community page: { available, featured, top, newest }. Titles, creators
 *   and votes only: never a puzzle's groups or tiles.
 * POST /api/connections/custom { title?, groups, name?, player? }
 *   Publishes a puzzle and returns its short id ({ id, path }). Group names are
 *   run through the profanity filter, counts and duplicates are blocked, and
 *   creation is rate-limited per address and per creator. The creator is the
 *   signed-in trainer, else `name`, else nobody.
 */

export async function GET(request: NextRequest) {
  if (!rateLimit(`conn-custom-get:${clientIp(request)}`, 60, 1)) return tooManyRequests();
  const q = request.nextUrl.searchParams.get("q");
  if (q !== null) return NextResponse.json({ results: searchPokemon(q.slice(0, 40)) }, { headers: NO_STORE });
  return NextResponse.json(await listCustom(), { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" } });
}

export async function POST(request: NextRequest) {
  // A few a minute from one address; the per-creator daily cap is in publishCustom.
  if (!rateLimit(`conn-custom-make:${clientIp(request)}`, 5, 1 / 120)) return tooManyRequests("You're publishing too fast. Wait a moment.");
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const who = await whoIs(request, parsed.data.player);
  if (!who) return NextResponse.json({ error: "Missing player id." }, { status: 400, headers: NO_STORE });
  try {
    const out = await publishCustom({
      title: parsed.data.title,
      groups: parsed.data.groups as never,
      identity: who.identity,
      creatorName: who.username ?? parsed.data.name ?? null,
    });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    return NextResponse.json({ id: out.id, path: `/connections/c/${out.id}` }, { headers: NO_STORE });
  } catch (err) {
    console.error("[connections] publish failed:", err);
    return NextResponse.json({ error: "Couldn't publish. Try again." }, { status: 500, headers: NO_STORE });
  }
}
