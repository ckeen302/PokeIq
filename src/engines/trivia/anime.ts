import { pool, type HandwrittenRow, type TriviaItem } from "./bank";
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
  })),
];

export const ANIME_TABLES: Record<string, readonly object[]> = { leagues: LEAGUES };
