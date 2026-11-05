import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { catchUpBattle } from "./service";
import { publishBattle } from "./live";
import { needsSettlingRecord, settleBattle } from "./settle";
import { dueBattles } from "./store";

/**
 * The battle tick: live battles keep time even when nobody polls. Showdown
 * checks its timers every few seconds in one process (server/room-battle.ts
 * nextTick); here a sweep finds the battles with something due (their
 * `next_deadline` has passed: a clock out, a trainer gone, the computer
 * owing a choice) and catches each one up through the normal
 * compare-and-swap path, exactly as a poll would, then settles any battle
 * that just ended (ratings, records, the replay).
 *
 * The database's scheduler (pg_cron and pg_net, migration 0054) calls
 * POST /api/battle/tick once a minute with the shared secret; within one call
 * the route sweeps every TICK_EVERY_MS for about TICK_RUN_MS. Without the
 * schedule nothing calls it, and polls catch battles up as before.
 */

/** How often one call sweeps, and for how long it keeps sweeping (the next call comes a minute after the last). */
export const TICK_EVERY_MS = 5_000;
export const TICK_RUN_MS = 50_000;
/** Battles caught up per sweep at most (the soonest due first). */
export const TICK_BATCH = 50;

/** The header the scheduler sends the secret in. */
export const TICK_SECRET_HEADER = "x-battle-tick-secret";

/**
 * Whether `given` is the tick secret (BATTLE_TICK_SECRET). With no secret
 * configured the tick is off and nothing is accepted. Compared as hashes in
 * constant time, so neither the length nor the content leaks.
 */
export function tickAuthorized(given: string | null | undefined): boolean {
  const secret = process.env.BATTLE_TICK_SECRET;
  if (!secret || secret.length < 16 || !given) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

export interface TickSweep {
  /** Battles found due. */
  due: number;
  /** Caught up (through the compare-and-swap; written only where something was due). */
  caught: number;
  /** Battles that ended and were settled. */
  settled: number;
  /** Battles that failed (busy, gone); the next sweep tries again. */
  failed: number;
}

/** One sweep at `now`: every battle due is caught up, and those that ended are settled. */
export async function tickBattles(now = Date.now(), limit = TICK_BATCH): Promise<TickSweep> {
  const out: TickSweep = { due: 0, caught: 0, settled: 0, failed: 0 };
  const codes = await dueBattles(now, limit);
  out.due = codes.length;
  for (const code of codes) {
    try {
      const caught = await catchUpBattle(code);
      if (!caught.ok) {
        out.failed++;
        continue;
      }
      out.caught++;
      // Inside the tick's request a "later" broadcast waits for the whole sweep (up to ~50 s) to answer, so wake the
      // battle's pages now. The deferred copy from the write still goes out afterwards; pages ignore a revision they have.
      if (caught.rec.meta.kind === "pvp") await publishBattle(code, caught.rev);
      if (needsSettlingRecord(caught.rec)) {
        await settleBattle(code);
        out.settled++;
      }
    } catch (err) {
      out.failed++;
      console.error(`[battle-tick] ${code}:`, err);
    }
  }
  return out;
}
