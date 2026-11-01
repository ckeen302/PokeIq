import type { Rng } from "@/lib/rng";
import ROUNDS from "@/data/trainer-teams.json";
import { ANSWER_NAMES, monLabel, revealOrder, teamKey, type TeamEntry } from "@/lib/whose-team";
import type { GenerateOptions, Question, QuestionBuilder } from "../types";

/**
 * Whose Team Is This? — a famous trainer's team, name the trainer. The guess
 * is typed, autocompleting over every trainer with a round (`options`, the
 * same list for every question, so it says nothing about the answer).
 *
 * Normal shows the whole team in party order. Hard (`difficulty: "hard"`)
 * puts the team in reveal order, ace last, and serves only the first card:
 * the session layer hands out the rest one at a time (see `reveal`).
 *
 * The rounds (src/data/trainer-teams.json) are built and checked by
 * scripts/whose-team/build.ts; this file only picks from them.
 */

export const TEAM_ROUNDS = ROUNDS as TeamEntry[];

/** Ids for the session's `used` set: clear of the Pokédex ids other modes use. */
const USED_OFFSET = 300_000;
const SIBLINGS = new Map<string, number[]>();
TEAM_ROUNDS.forEach((r, i) => {
  // The same trainer with the same Pokémon (Lorelei in Red, Yellow and FireRed): one per run.
  const k = `${r.trainer}|${teamKey(r.team)}`;
  SIBLINGS.set(k, [...(SIBLINGS.get(k) ?? []), i]);
});

/** Prior difficulty: the anime and Gens I–IV are the most familiar; Hard starts with a single Pokémon. */
function rating(r: TeamEntry, hard: boolean): number {
  const base = r.kind === "anime" ? 1150 : r.gen <= 2 ? 1100 : r.gen <= 4 ? 1180 : 1260;
  return base + (hard ? 160 : 0);
}

export function roundsFor(opts: Pick<GenerateOptions, "gens" | "scope">): number[] {
  const gens = opts.gens?.length ? new Set(opts.gens) : null;
  const out: number[] = [];
  TEAM_ROUNDS.forEach((r, i) => {
    if (gens && !gens.has(r.gen)) return;
    if (opts.scope === "games" && r.kind !== "game") return;
    if (opts.scope === "anime" && r.kind !== "anime") return;
    out.push(i);
  });
  return out;
}

export function teamQuestion(r: TeamEntry, hard: boolean): Question {
  const team = hard ? revealOrder(r) : r.team;
  return {
    itemKey: `whose-team:${r.id}${hard ? ":hard" : ""}`,
    module: "whose-team",
    prompt: "Whose team is this?",
    cards: team.map((m) => ({ pokemonId: m.art ?? m.dex, label: monLabel(m) })),
    options: ANSWER_NAMES,
    answer: r.trainer,
    explanation: [r.appearance, r.variant].filter(Boolean).join(" · "),
    source: r.source,
    rating: rating(r, hard),
    input: "type",
    ...(hard && { reveal: 1 }),
  };
}

export const whoseTeam: QuestionBuilder = (rng: Rng, opts: GenerateOptions): Question | null => {
  const open = roundsFor(opts).filter((i) => !opts.used.has(USED_OFFSET + i));
  if (open.length === 0) return null;
  const i = rng.pick(open);
  const r = TEAM_ROUNDS[i];
  for (const j of SIBLINGS.get(`${r.trainer}|${teamKey(r.team)}`) ?? [i]) opts.used.add(USED_OFFSET + j);
  return teamQuestion(r, opts.difficulty === "hard");
};
