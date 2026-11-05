import { DamageTable } from "@/lib/mass-battle/damage";
import { prepare, runHeadless } from "@/lib/mass-battle/engine";
import { questionSpec } from "@/lib/mass-battle/share";
import type { Question } from "@/lib/mass-battle/types";
import type { FromSolver, RosterSlice, ToSolver } from "./protocol";

/**
 * A "how many?" worker: plays whole battles without drawing them, as fast
 * as it can. The page starts one per spare core; each keeps the question's
 * damage table between battles (its fighters are the same at every size).
 */

const scope = self as unknown as {
  postMessage(message: FromSolver): void;
  onmessage: ((event: MessageEvent<ToSolver>) => void) | null;
};

let job = -1;
let roster: RosterSlice | null = null;
let question: Question | null = null;
/** Damage tables by the number of fighters (a small army may field fewer of a group's rows; the rest is the same). */
let tables = new Map<number, DamageTable>();

scope.onmessage = (event) => {
  const msg = event.data;
  try {
    if (msg.type === "setup") {
      job = msg.job;
      roster = msg.roster;
      question = msg.question;
      tables = new Map();
      return;
    }
    if (msg.type === "run") {
      if (msg.job !== job || !roster || !question) return;
      const t0 = performance.now();
      // "melee": everyone in reach of everyone (the pure battle maths); otherwise the battlefield.
      const prep = prepare(roster, questionSpec(question, msg.n, msg.seed), { layout: msg.layout ?? "field" });
      // Sizes with the same rows have the same fighters in the same order, so their table carries over.
      let table = tables.get(prep.species.length);
      if (!table) {
        table = new DamageTable(prep.species.map((species, k) => ({ species, set: prep.sets[k] })), prep.field);
        tables.set(prep.species.length, table);
      }
      const b = runHeadless(prep, table);
      scope.postMessage({ type: "result", job: msg.job, tag: msg.tag, n: msg.n, seed: msg.seed, winner: b.winner, seconds: b.seconds, ms: performance.now() - t0 });
    }
  } catch (err) {
    scope.postMessage({ type: "error", job: msg.job, message: err instanceof Error ? err.message : String(err) });
  }
};
