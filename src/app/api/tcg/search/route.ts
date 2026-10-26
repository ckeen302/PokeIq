import { NextResponse } from "next/server";
import { searchCards } from "@/lib/tcg/api";
import { toTile } from "@/lib/tcg/prices";

/** Card name search (slim tiles), for pickers. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const cards = await searchCards(q, 24);
  if (!cards) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ cards: cards.map(toTile) }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400" } });
}
