import { NextResponse } from "next/server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import type { NextRequest } from "next/server";

/**
 * GET /api/warm: loads the server modules behind the site's busiest routes
 * (the battle simulator, the Pikadoku master, the Pokédle, Connections and
 * PokéGuessr engines, accounts, ranked, TCG prices) so the next real request
 * doesn't pay for a cold start. A scheduled job calls it every few minutes;
 * anyone else gets the same harmless answer, a few times a minute at most.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

const parts: Record<string, () => Promise<unknown>> = {
  battle: () => import("@/lib/server/battle-engine/service"),
  pikadoku: () => import("@/lib/server/pikadoku-master").then((m) => m.ensureMaster()),
  pokedle: () => import("@/lib/server/pokedle"),
  connections: () => import("@/lib/server/connections"),
  geo: () => import("@/lib/server/geo"),
  // PokéGuessr's game start (the route, with its request checks), so a Play click never waits on a cold start.
  geoStart: () => import("@/app/api/geo/route"),
  // What a guess goes through besides the engine (the replay guard, the shot reports and the round log).
  geoGuess: () => Promise.all([import("@/lib/server/replay-guard"), import("@/lib/server/geo-reports"), import("@/lib/server/geo-round-scores")]),
  accounts: () => import("@/lib/server/auth"),
  ranked: () => import("@/lib/server/ranked"),
  tcg: () => import("@/lib/tcg/api").then((m) => m.getSets()),
};

export async function GET(request: NextRequest) {
  if (!rateLimit(`warm:${clientIp(request)}`, 6, 0.1)) return tooManyRequests();
  const ms: Record<string, number> = {};
  const failed: string[] = [];
  await Promise.all(
    Object.entries(parts).map(async ([name, load]) => {
      const t0 = Date.now();
      try {
        await load();
      } catch (err) {
        console.error(`[warm] ${name}:`, err);
        failed.push(name);
      }
      ms[name] = Date.now() - t0;
    })
  );
  return NextResponse.json({ ok: failed.length === 0, ms, ...(failed.length ? { failed } : {}) }, { headers: NO_STORE });
}
