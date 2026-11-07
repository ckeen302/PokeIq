import type { NextRequest } from "next/server";
import { gamesPlayCard } from "@/lib/og/games";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { DEFAULT_NATIONS, parseGamesSeed, parseNations, parseRain } from "@/lib/games/deeplink";

/** GET /lab/games/play/og?n=fire,water&seed=7: the Games' preview card (the medal table's top three). */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ns = parseNations(sp.get("n"), (k) => GAMES_BY_KEY.has(k));
  return gamesPlayCard(ns.length >= 2 ? ns : DEFAULT_NATIONS, parseGamesSeed(sp.get("seed")), parseRain(sp.get("rain")));
}
