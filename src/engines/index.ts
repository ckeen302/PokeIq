import type { GenerateOptions, ModuleId, Question, QuestionBuilder } from "./types";
import { isServable, isValidQuestion } from "./validate";
import { localize } from "./localize";
import type { QuizLang } from "./i18n";
import { Rng } from "@/lib/rng";
import { whosThat } from "./modules/whos-that";
import { cry } from "./modules/cry";
import { dex } from "./modules/dex";
import { types } from "./modules/types";
import { higherLower } from "./modules/higher-lower";
import { anime, games } from "./modules/trivia";
import { shiny } from "./modules/shiny";
import { competitive } from "./modules/competitive";
import { whoseTeam } from "./modules/whose-team";
import { zoomReveal } from "./modules/zoom-reveal";

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
  "whose-team": whoseTeam,
  "zoom-reveal": zoomReveal,
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

/** Swapped-in questions keep close to the rating of the one they replace while they can. */
const SWAP_CLOSE_ATTEMPTS = 24;
const SWAP_ATTEMPTS = 60;

/**
 * Question `q` (built in English by buildQuestion) in another language: the same question re-worded. When it has no
 * faithful wording there, another question of the same module and difficulty takes its place, drawn from its own
 * stream (`swapSeed`), so the rest of the run is still the English run's, and the swap is the same on every request.
 * The swap's Pokémon aren't added to `opts.used` (that would change later questions); it avoids those already used.
 *
 * Without a `swapSeed` (duels, where both trainers must face the same question), an unwordable question stays English.
 */
export function localizeQuestion(q: Question, L: QuizLang | null, opts: GenerateOptions, swapSeed: string | number | null): Question {
  if (!L) return q;
  const own = localize(q, L);
  if (own && isServable(own)) return own;
  if (swapSeed === null) return q;
  const rng = new Rng(swapSeed);
  const used = new Set(opts.used);
  const keys = new Set([q.itemKey]);
  for (let attempt = 0; attempt < SWAP_ATTEMPTS; attempt++) {
    const r = BUILDERS[q.module](rng, { ...opts, used: new Set(used) });
    if (!r || keys.has(r.itemKey) || !isServable(r)) continue;
    keys.add(r.itemKey);
    if (attempt < SWAP_CLOSE_ATTEMPTS && Math.abs(r.rating - q.rating) > 80) continue;
    const worded = localize(r, L);
    if (worded && isServable(worded)) return worded;
  }
  return q;
}

export { localize } from "./localize";
export { loadQuizLang, quizLang, type QuizLang } from "./i18n";
export * from "./types";
