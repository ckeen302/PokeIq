import { NextResponse } from "next/server";
import { cardsForDex } from "@/lib/tcg/api";
import { toTile } from "@/lib/tcg/prices";

/** A species' newest TCG cards (slim tiles) for its Pokédex page. Cached a day upstream and at the CDN. */
export async function GET(_req: Request, { params }: { params: Promise<{ dex: string }> }) {
  const dex = Number((await params).dex);
  if (!Number.isInteger(dex) || dex < 1 || dex > 2000) return NextResponse.json({ error: "bad dex number" }, { status: 400 });
  const res = await cardsForDex(dex, 12);
  if (!res) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(
    { cards: res.cards.map(toTile), total: res.total },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400" } }
  );
}
