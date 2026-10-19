import type { BattleRecord, LabTotals } from "./stats";
import type { LabSetup } from "./types";

/** Messages between the Battle Lab page and its simulator workers. */

export type ToWorker =
  /** A new run's setup. With `check`, also play battle 0 to report starting conditions that don't take. */
  | { type: "setup"; job: number; setup: LabSetup; seed: string; check: boolean }
  /** Play battles `from` to `to` (exclusive) of the job's run. */
  | { type: "run"; job: number; from: number; to: number }
  /** Play one battle again, with its log. */
  | { type: "replay"; job: number; setup: LabSetup; seed: string; index: number };

export type FromWorker =
  | { type: "ready"; job: number; notes: string[]; misses: string[] }
  | { type: "chunk"; job: number; from: number; to: number; totals: LabTotals; outcomes: Uint8Array; ms: number }
  | { type: "replay"; job: number; index: number; record: BattleRecord; log: string[]; misses: string[] }
  /** `setup`: the setup itself is the problem (a Pokémon the generation doesn't have…). */
  | { type: "error"; job: number; message: string; setup: boolean };
