import type { FromWorker, ToWorker } from "./protocol";
import { LabSetupError, prepareLab, runLabBattle, runLabRange, type PreparedLab } from "./simulate";

/**
 * A Battle Lab worker: Pokémon Showdown's simulator off the main thread.
 * The page starts a few of these (one per spare core) when the first run
 * starts, so the simulator (several MB of code and data) only ever loads on
 * the Battle Lab page, and only here.
 */

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

/** The current run's prepared setup (runs come one at a time). */
let current: { job: number; prep: PreparedLab; seed: string } | null = null;

function fail(job: number, err: unknown) {
  const setup = err instanceof LabSetupError;
  scope.postMessage({ type: "error", job, setup, message: setup ? (err as Error).message : `The simulator stopped: ${err instanceof Error ? err.message : String(err)}` });
}

scope.onmessage = (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "setup": {
        const prep = prepareLab(msg.setup);
        current = { job: msg.job, prep, seed: msg.seed };
        if (msg.check) {
          const first = runLabBattle(prep, msg.seed, 0, { log: true });
          scope.postMessage({ type: "ready", job: msg.job, notes: prep.notes, misses: first.misses ?? [] });
        }
        break;
      }
      case "run": {
        if (!current || current.job !== msg.job) return; // a cancelled run's leftovers
        const t0 = performance.now();
        const { totals, outcomes } = runLabRange(current.prep, current.seed, msg.from, msg.to);
        scope.postMessage({ type: "chunk", job: msg.job, from: msg.from, to: msg.to, totals, outcomes, ms: performance.now() - t0 }, [outcomes.buffer]);
        break;
      }
      case "replay": {
        const prep = prepareLab(msg.setup);
        const out = runLabBattle(prep, msg.seed, msg.index, { log: true });
        scope.postMessage({ type: "replay", job: msg.job, index: msg.index, record: out.record, log: out.log ?? [], misses: out.misses ?? [] });
        break;
      }
    }
  } catch (err) {
    fail(msg.job, err);
  }
};
