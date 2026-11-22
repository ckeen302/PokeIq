import { handwrittenLoc, pool, type HandwrittenRow, type TriviaItem } from "./bank";
import { must } from "../localize";
import { personIn } from "./words";
import LEAGUES from "@/data/quiz/anime/leagues.json";
import HANDWRITTEN from "@/data/quiz/anime/handwritten.json";

/**
 * The Pokémon Anime bank: English-dub names, text only. Ash's league results
 * are generated from a table; the rest is hand-written, each question with
 * the Bulbapedia page it was checked against.
 */

/** Series filter (the session's `gens` field), 1-based. */
export const ANIME_SERIES = [
  "Original series",
  "Advanced Generation",
  "Diamond and Pearl",
  "Black & White",
  "XY",
  "Sun & Moon",
  "Journeys",
  "Horizons",
] as const;

const RESULTS = ["Top 16", "Top 8", "Top 4", "Runner-up", "Winner"];
/** A league's name carries its article ("la Liga Naranja"): join it to the preposition before it ("de el" → "del"). */
const CONTRACTIONS: Record<string, [RegExp, string][]> = {
  es: [[/\bde el /g, "del "], [/\ba el /g, "al "]],
  fr: [[/\bde le /g, "du "], [/\bà le /g, "au "], [/\bde les /g, "des "], [/\bà les /g, "aux "]],
  it: [[/\bdi il /g, "del "], [/\bdi la /g, "della "], [/\bdi i /g, "dei "], [/\bdi l'/g, "dell'"], [/\bin il /g, "nel "], [/\bin la /g, "nella "], [/\bin i /g, "nei "], [/\bin l'/g, "nell'"], [/\bda il /g, "dal "], [/\bda la /g, "dalla "], [/\bda i /g, "dai "], [/\bda l'/g, "dall'"]],
};
const contract = (locale: string, s: string) => (CONTRACTIONS[locale] ?? []).reduce((out, [re, to]) => out.replace(re, to), s);

const RESULT_KEY: Record<string, "top16" | "top8" | "top4" | "runnerUp" | "winner"> = { "Top 16": "top16", "Top 8": "top8", "Top 4": "top4", "Runner-up": "runnerUp", Winner: "winner" };

function leagueItems(): TriviaItem[] {
  const items: TriviaItem[] = [];
  LEAGUES.forEach((r, index) => {
    const common = { topic: "leagues", group: r.series, source: r.source };
    items.push({
      ...common,
      id: `league-${index}-opponent`,
      difficulty: r.series >= 5 ? "easy" : "medium",
      prompt: r.won
        ? `Who did Ash defeat in the final of the ${r.league}?`
        : `Who knocked Ash out of the ${r.league}?`,
      answer: r.opponent,
      distractors: pool(LEAGUES.map((o) => o.opponent), r.opponent),
      explanation: r.won ? `Ash beat ${r.opponent} to win the ${r.league}.` : `${r.opponent} eliminated Ash (${r.result}).`,
      from: { table: "leagues", index, field: "opponent" },
      loc: (L) => {
        const league = must(L.league(r.league), r.league);
        const ash = personIn(L, "Ash", "anime");
        const opponent = personIn(L, r.opponent, "anime");
        const result = L.t(`trivia.result.${RESULT_KEY[r.result]}`);
        return {
          prompt: contract(L.locale, L.t(r.won ? "trivia.league.finalPrompt" : "trivia.league.outPrompt", { ash, league })),
          explanation: contract(L.locale, L.t(r.won ? "trivia.league.wonExplanation" : "trivia.league.outExplanation", { ash, league, opponent, result })),
          option: (o) => L.proper(o, "anime"),
        };
      },
    });
    items.push({
      ...common,
      id: `league-${index}-result`,
      difficulty: r.result === "Winner" || r.result === "Runner-up" ? "easy" : "hard",
      prompt: `How far did Ash get in the ${r.league}?`,
      answer: r.result,
      distractors: pool(RESULTS, r.result),
      explanation: `Ash's result in the ${r.league}: ${r.result}.`,
      from: { table: "leagues", index, field: "result" },
      loc: (L) => {
        const league = must(L.league(r.league), r.league);
        const ash = personIn(L, "Ash", "anime");
        const result = L.t(`trivia.result.${RESULT_KEY[r.result]}`);
        return {
          prompt: contract(L.locale, L.t("trivia.league.resultPrompt", { ash, league })),
          explanation: contract(L.locale, L.t("trivia.league.resultExplanation", { ash, league, result })),
          option: (o) => (RESULT_KEY[o] ? L.t(`trivia.result.${RESULT_KEY[o]}`) : undefined),
        };
      },
    });
  });
  return items;
}

export const ANIME_BANK: TriviaItem[] = [
  ...leagueItems(),
  ...(HANDWRITTEN as (HandwrittenRow & { series: number })[]).map((r) => ({
    id: r.id,
    topic: r.topic,
    group: r.series,
    difficulty: r.difficulty,
    prompt: r.prompt,
    answer: r.answer,
    distractors: r.distractors,
    source: r.source,
    explanation: r.explanation,
    loc: handwrittenLoc("anime", r),
  })),
];

export const ANIME_TABLES: Record<string, readonly object[]> = { leagues: LEAGUES };
