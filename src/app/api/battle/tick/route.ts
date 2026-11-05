import { NextRequest, NextResponse } from "next/server";
import { battlesEnabled } from "@/lib/server/battle-engine/store";
import { TICK_EVERY_MS, TICK_RUN_MS, TICK_SECRET_HEADER, tickAuthorized, tickBattles, type TickSweep } from "@/lib/server/battle-engine/tick";

/**
 * POST /api/battle/tick: the battle tick (lib/server/battle-engine/tick.ts),
 * for the database's scheduler only. It needs the shared secret in the
 * x-battle-tick-secret header (BATTLE_TICK_SECRET; with none set the tick is
 * off). Anything else gets a plain 404, as if there were nothing here.
 *
 * One call sweeps every 5 s for about 50 s (the scheduler calls once a
 * minute); `?once=1` sweeps once. Answers with what the sweeps did.
 */

// The sweeps run the simulator (unbundled, see next.config.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function POST(request: NextRequest) {
  if (!tickAuthorized(request.headers.get(TICK_SECRET_HEADER))) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  if (!battlesEnabled()) return NextResponse.json({ ok: true, sweeps: 0 }, { headers: NO_STORE });
  const once = request.nextUrl.searchParams.get("once") === "1";
  const until = Date.now() + TICK_RUN_MS;
  const total: TickSweep = { due: 0, caught: 0, settled: 0, failed: 0 };
  let sweeps = 0;
  try {
    for (;;) {
      const started = Date.now();
      const sweep = await tickBattles(started);
      sweeps++;
      for (const k of Object.keys(total) as (keyof TickSweep)[]) total[k] += sweep[k];
      const next = started + TICK_EVERY_MS;
      if (once || next >= until) break;
      await sleep(Math.max(0, next - Date.now()));
    }
  } catch (err) {
    console.error("[battle-tick]", err);
    return NextResponse.json({ error: "The tick hiccupped.", sweeps, ...total }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, sweeps, ...total }, { headers: NO_STORE });
}
