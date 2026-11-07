import type { NextRequest } from "next/server";
import { gamesEventCard } from "@/lib/og/games";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { parseEvent, parseField, parseGamesSeed, parseRain } from "@/lib/games/deeplink";

/** GET /lab/games/run/og?e=weightlifting&vs=snorlax,machamp&seed=7&rain=1: a shared run's preview card (its podium). */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const event = parseEvent(sp.get("e")) ?? "100m";
  const keys = parseField(sp.get("vs"), (k) => GAMES_BY_KEY.has(k));
  return gamesEventCard(event, keys, parseGamesSeed(sp.get("seed")), parseRain(sp.get("rain")));
}
