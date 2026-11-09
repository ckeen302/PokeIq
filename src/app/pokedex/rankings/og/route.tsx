import type { NextRequest } from "next/server";
import { rankingCard, rankingsHubCard } from "@/lib/og/rankings";

/** GET /pokedex/rankings/og?m=heaviest&s=fire: a rankings list's preview card (no `m`: the hub's). */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const m = sp.get("m");
  return m ? rankingCard(m, sp.get("s")) : rankingsHubCard();
}
