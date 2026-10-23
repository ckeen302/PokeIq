import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CUSTOM_ID_RE } from "@/lib/connections/custom";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { metaOf, voteCustom } from "@/lib/server/connections-custom";
import { NO_STORE, PLAYER, whoIs } from "@/lib/server/connections-custom-http";

/**
 * GET  /api/connections/custom/<id>?player=<browser id>
 *   The puzzle's title, creator, votes and this player's own vote (CustomMeta).
 *   Never its groups or tiles: those are only played through /api/connections.
 * POST /api/connections/custom/<id> { value: 1 | -1 | 0, player }
 *   One thumbs up or down per player (0 takes it back), not on your own puzzle.
 */

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  if (!rateLimit(`conn-custom-meta:${clientIp(request)}`, 60, 1)) return tooManyRequests();
  const { id } = await params;
  if (!CUSTOM_ID_RE.test(id)) return NextResponse.json({ error: "That puzzle doesn't exist." }, { status: 404, headers: NO_STORE });
  const player = PLAYER.safeParse(request.nextUrl.searchParams.get("player") ?? undefined);
  const who = await whoIs(request, player.success ? player.data : undefined);
  const meta = await metaOf(id, who?.identity ?? null);
  if (!meta) return NextResponse.json({ error: "That puzzle doesn't exist." }, { status: 404, headers: NO_STORE });
  return NextResponse.json(meta, { headers: NO_STORE });
}

const voteSchema = z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]), player: PLAYER.optional() });

export async function POST(request: NextRequest, { params }: Ctx) {
  if (!rateLimit(`conn-custom-vote:${clientIp(request)}`, 30, 0.5)) return tooManyRequests();
  const { id } = await params;
  const parsed = voteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Vote 1, -1 or 0." }, { status: 400, headers: NO_STORE });
  const who = await whoIs(request, parsed.data.player);
  if (!who) return NextResponse.json({ error: "Missing player id." }, { status: 400, headers: NO_STORE });
  const out = await voteCustom(id, who.identity, parsed.data.value);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
  return NextResponse.json({ up: out.up, down: out.down, myVote: out.myVote }, { headers: NO_STORE });
}
