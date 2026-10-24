import type { Rng } from "@/lib/rng";
import type { GenerateOptions, ModuleId, Question, QuestionBuilder } from "./types";
import { isValidQuestion } from "./validate";
import { whosThat } from "./modules/whos-that";
import { cry } from "./modules/cry";
import { dex } from "./modules/dex";
import { types } from "./modules/types";
import { higherLower } from "./modules/higher-lower";
import { anime, games } from "./modules/trivia";
import { shiny } from "./modules/shiny";
import { competitive } from "./modules/competitive";

/** Module registry — adding a game mode is one builder file plus one line here. */
const BUILDERS: Record<Exclude<ModuleId, "mixed">, QuestionBuilder> = {
  "whos-that": whosThat,
  cry,
  dex,
  types,
  "higher-lower": higherLower,
  games,
  anime,
  competitive,
  shiny,
};

/** Mixed (Daily Challenge) rotation. Cry is excluded: people play the daily in public. */
const MIXED_WEIGHTS: [Exclude<ModuleId, "mixed">, number][] = [
  ["whos-that", 0.32],
  ["dex", 0.2],
  ["types", 0.24],
  ["higher-lower", 0.24],
];

function pickMixed(rng: Rng): Exclude<ModuleId, "mixed"> {
  let roll = rng.next();
  for (const [id, weight] of MIXED_WEIGHTS) {
    if ((roll -= weight) < 0) return id;
  }
  return MIXED_WEIGHTS[0][0];
}

/**
 * Build one valid question. Deterministic given the Rng state: builders
 * that decline (ambiguity, starved pools) and gate failures are retried
 * from the same stream, so the server re-derives the identical sequence.
 */
export function buildQuestion(module: ModuleId, rng: Rng, opts: GenerateOptions): Question {
  for (let attempt = 0; attempt < 50; attempt++) {
    // A long endless run on a small pool (one generation) can exhaust it:
    // recycle species rather than fail. Still deterministic.
    if (attempt === 20) opts.used.clear();
    const id = module === "mixed" ? pickMixed(rng) : module;
    const q = BUILDERS[id](rng, opts);
    if (q && isValidQuestion(q)) return q;
  }
  throw new Error(`Module "${module}" could not produce a valid question`);
}

export * from "./types";
