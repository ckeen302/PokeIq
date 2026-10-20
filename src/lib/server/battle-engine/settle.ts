import "server-only";
import { fail } from "../duel-core";
import type { BattleView } from "@/lib/battle/play";
import { updateBattle, type Outcome } from "./service";
import { loadBattle, type BattleRecord, type BattleSettled } from "./store";
import { ReplaysUnavailable, replayFromRecord, replayStore } from "./replays";
import { ladderStore, settleRankedBattle } from "./ladder";
import { recordStore, resultsOf } from "./records";
import { RankedUnavailable } from "../ranked";

/**
 * What happens once a live battle is over, exactly once per battle: a ranked
 * battle moves both ratings (ladder.ts), each known trainer's record gets
 * the result (records.ts), and ranked
 * battles and battles open to spectators are saved as replays (the spectator
 * channel only). The battle then records that it's settled, so polls stop
 * asking. Any write here is idempotent (keyed by the battle's code), so
 * racing polls can't count anything twice; a store that isn't there yet
 * (the migration) is skipped, not retried forever.
 */

/** A finished live battle that hasn't been settled yet. */
export const needsSettling = (view: BattleView) => view.kind === "pvp" && view.status === "finished" && !view.settled;

/** Whether a finished battle is worth a replay (a battle that never got going isn't). */
const replayable = (rec: BattleRecord) => rec.meta.end?.reason !== "nocontest" && rec.meta.turn >= 1 && rec.logs.spectator.length > 0;

/** Saves the battle's replay (idempotent); its id, or null when replays aren't available here. */
async function storeReplay(rec: BattleRecord, listed: boolean, now: number): Promise<string | null> {
  const store = replayStore();
  if (!store) return null;
  try {
    await store.save(replayFromRecord(rec, listed, now));
    return rec.meta.code;
  } catch (err) {
    if (err instanceof ReplaysUnavailable) return null;
    throw err;
  }
}

/** Settles a finished live battle (see above). Throws on a store error, for the next poll to try again. */
export async function settleBattle(code: string): Promise<void> {
  const loaded = await loadBattle(code);
  if (!loaded) return;
  const { rec } = loaded;
  const meta = rec.meta;
  if (meta.kind !== "pvp" || meta.status !== "finished" || meta.settled) return;
  const now = Date.now();
  const settled: BattleSettled = { at: now };
  // Ranked: the ratings move, once per battle (the store records the battle by its code).
  if (meta.ranked) {
    const store = ladderStore();
    try {
      const ratings = store ? await settleRankedBattle(meta, store) : null;
      if (ratings) settled.ratings = ratings;
    } catch (err) {
      if (!(err instanceof RankedUnavailable)) throw err;
    }
  }
  // The replay shows the ratings the trainers brought.
  if (settled.ratings) rec.meta.settled = settled;
  // Each known trainer's record (wins and losses per format, their latest battles).
  const records = recordStore();
  try {
    await records?.record(resultsOf(meta, settled.ratings, now));
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) throw err;
  }
  let replay = meta.replay ?? null;
  if (!replay && (meta.ranked || meta.public) && replayable(rec)) replay = await storeReplay(rec, true, now);
  await updateBattle(code, (work) => {
    if (!work.meta.settled) work.meta.settled = settled;
    if (replay && !work.meta.replay) work.meta.replay = replay;
    return { ok: true };
  });
}

/**
 * "Save replay" after a battle: either trainer may save it. A battle open to
 * spectators is listed in recent replays; a private one is kept unlisted
 * (anyone with its link can watch it).
 */
export async function saveReplayFor(code: string, playerId: string): Promise<Outcome<{ id: string }>> {
  const loaded = await loadBattle(code);
  if (!loaded) return fail(404, "This battle has ended or never existed.");
  const { rec } = loaded;
  if (!rec.meta.seats.some((s) => s.id === playerId)) return fail(403, "Only the trainers in this battle can save its replay.");
  if (rec.meta.status !== "finished") return fail(409, "The battle isn't over yet.");
  if (rec.meta.replay) return { ok: true, id: rec.meta.replay };
  if (!replayable(rec)) return fail(409, "This battle ended before it began: there's nothing to replay.");
  const id = await storeReplay(rec, rec.meta.kind === "pvp" && !!rec.meta.public, Date.now());
  if (!id) return fail(503, "Replays aren't available on this server yet.");
  const out = await updateBattle(code, (work) => {
    if (!work.meta.replay) work.meta.replay = id;
    return { ok: true };
  });
  return out.ok ? { ok: true, id } : out;
}
