import type { NextRequest } from "next/server";
import { pokeballMakerCard } from "@/lib/og/pokeball-maker";
import { decodeDesign } from "@/lib/pokeball-maker/design";

/** GET /tools/pokeball-maker/og?d=…: a design's preview card (the maker's own card without a valid design). */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return pokeballMakerCard(decodeDesign(req.nextUrl.searchParams.get("d")));
}
