import { NextResponse } from "next/server";
import { BATTLE_FORMAT_IDS, isBattleFormatId } from "@/lib/battle/formats";
import { formatBans } from "./bans";

/**
 * GET /api/battle/validate/legal/:format -> { species, moves, items, abilities }
 * Ids the format bans, with Pokémon Showdown's reason for each. Built once at
 * build time: the team builder's search marks and filters with it.
 */

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return BATTLE_FORMAT_IDS.map((format) => ({ format }));
}

export async function GET(_request: Request, context: { params: Promise<{ format: string }> }) {
  const { format } = await context.params;
  if (!isBattleFormatId(format)) return NextResponse.json({ error: "No such format." }, { status: 404 });
  return NextResponse.json(formatBans(format));
}
