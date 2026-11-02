import { DamageTable } from "@/lib/mass-battle/damage";
import { prepare, runHeadless } from "@/lib/mass-battle/engine";
import type { Question } from "@/lib/mass-battle/types";
import type { FromSolver, RosterSlice, ToSolver } from "./protocol";

/**
 * A "how many?" worker: plays whole battles without drawing them, as fast
 * as it can. The page starts one per spare core; each keeps the question's
 * damage table between battles.
 */

const scope = self as unknown as {
  postMessage(message: FromSolver): void;
  onmessage: ((event: MessageEvent<ToSolver>) => void) | null;
};

let job = -1;
let roster: RosterSlice | null = null;
let question: Question | null = null;
let table: DamageTable | null = null;

scope.onmessage = (event) => {
  const msg = event.data;
  try {
    if (msg.type === "setup") {
      job = msg.job;
      roster = msg.roster;
      question = msg.question;
      table = null;
      return;
    }
    if (msg.type === "run") {
      if (msg.job !== job || !roster || !question) return;
      const t0 = performance.now();
      const prep = prepare(roster, {
        sides: [{ units: [{ id: question.challenger, count: msg.n }], formation: "swarm" }, { units: [{ id: question.boss, count: 1 }], formation: "line" }],
        level: question.level,
        arena: question.arena,
        seed: msg.seed,
      });
      table ??= new DamageTable(prep.species, prep.moves, prep.level);
      const b = runHeadless(prep, table);
      scope.postMessage({ type: "result", job: msg.job, tag: msg.tag, n: msg.n, seed: msg.seed, winner: b.winner, seconds: b.seconds, ms: performance.now() - t0 });
    }
  } catch (err) {
    scope.postMessage({ type: "error", job: msg.job, message: err instanceof Error ? err.message : String(err) });
  }
};
