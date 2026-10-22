import { describe, expect, it } from "vitest";
import {
  SHARE_PAYLOAD_MAX,
  battleShareText,
  buildPokedleShare,
  composeShare,
  decodeShare,
  describeShare,
  encodeShare,
  guessrShareText,
  pokedleShareResult,
  quizShareResult,
  quizShareText,
  replayShareText,
  shareCardResult,
  sharePath,
  type BattleShareResult,
  type GuessrShareResult,
  type PokedleShareResult,
  type QuizShareResult,
  type ShareResult,
} from "@/lib/share";
import type { CellStatus } from "@/lib/dle-types";
import type { RunResult, ShareCard } from "@/lib/session-types";

const URL = "https://pokeiq.vercel.app/s/x";
const M: CellStatus = "match";

const pokedle: PokedleShareResult = {
  game: "pokedle",
  daily: 123,
  format: "classic",
  max: 8,
  solved: true,
  streak: 5,
  assist: "notebook",
  rows: ["gybbyby", "ggybgbg", "ggggggg"],
};
const guessr: GuessrShareResult = { game: "guessr", daily: 6, region: "world", rounds: [4812, 2310, 5000, 0, 1205] };
const quiz: QuizShareResult = {
  game: "quiz",
  module: "whos-that",
  format: "blitz",
  difficulty: "hard",
  correct: 8,
  total: 10,
  pokeiq: 124,
  score: 12340,
  seconds: 42,
  grid: "1101111011",
};
const battle: BattleShareResult = { game: "battle", format: "gen9randombattle", outcome: "win", cpu: "hard", turns: 23 };

describe("share payloads", () => {
  it("round-trips every game through a short, URL-safe path segment", () => {
    const all: ShareResult[] = [
      pokedle,
      { ...pokedle, format: "squirdle", max: 9, rows: ["mpxdu", "ccccc"], hints: ["genus", "silhouette"], hard: true, top: 18, players: 4213 },
      { game: "pokedle", format: "custom", max: 6, solved: false, rows: ["gyb", "byb"] },
      guessr,
      { game: "guessr", region: "kanto", streak: 7 },
      quiz,
      { ...quiz, format: "adaptive", difficulty: undefined, total: 20, grid: "1".repeat(20) },
      { game: "quiz", module: "mixed", format: "classic", daily: 12, correct: 9, total: 10, pokeiq: 131, score: 9000, grid: "1111111110", streak: 4 },
      battle,
      { game: "battle", format: "gen9ou", outcome: "tie", ranked: true, turns: 40 },
    ];
    for (const r of all) {
      const clean = JSON.parse(JSON.stringify(r)) as ShareResult;
      const encoded = encodeShare(clean);
      expect(encoded).toMatch(/^[a-z]+(\.[a-z][A-Za-z0-9-]*)*$/);
      expect(encoded.length).toBeLessThanOrEqual(SHARE_PAYLOAD_MAX);
      expect(decodeShare(encoded)).toEqual(clean);
    }
    expect(sharePath(pokedle)).toBe("/s/dle.n123.fc.m8.w1.k5.lnotebook.rgybbyby-ggybgbg-ggggggg");
  });

  it("rejects anything malformed, out of range or oversized", () => {
    const bad = [
      undefined,
      42,
      "",
      "nope.n1",
      "x".repeat(SHARE_PAYLOAD_MAX + 1),
      "dle.n123.fc.m8.w1.r" + "g".repeat(400),
      "dle.n123.fc.m8.w1.rggggggg.rggggggg", // a key twice
      "dle.n123.fc.m8.w1.rgyb", // solved, but the last row isn't all right
      "dle.n123.fc.m2.w0.rgyb-gyb-gyb", // more rows than guesses
      "dle.n123.fc.m8.w1.rgyb-gggg", // ragged rows
      "dle.n123.fs.m8.w1.rggg", // Classic squares on a Squirdle board
      "dle.n123.fconstructor.m8.w1.rggg", // a prototype key
      "dle.n123.fc.m8.w1.rggg.iz", // an unknown hint
      "geo.zatlantis.r1-2-3-4-5",
      "geo.zkanto.r1-2-3-4", // four rounds
      "geo.zkanto.r1-2-3-4-5001",
      "quiz.owhos-that.fclassic.c11.t10.q100.s1.r1",
      "quiz.otoString.fclassic.c1.t10.q100.s1",
      "quiz.owhos-that.fclassic.c1.t1.q100.s1.r11", // grid longer than the run
      "bat.fgen9randombattle.ow", // no turns
      "bat.f__proto__.ow.t3",
      "bat.fhasOwnProperty.ow.t3",
      "dle.n1<script>",
      "dle.n1.fc.m8.w1.rggg%3Cb%3E",
      "geo.zkanto.s1.r1 2",
    ];
    for (const raw of bad) expect(decodeShare(raw), String(raw)).toBeNull();
  });

  it("drops what doesn't belong rather than trusting it", () => {
    // A streak on a practice game, and an unknown key: ignored.
    expect(decodeShare("dle.fc.m8.w1.k99.q7.rggg")).toEqual({ game: "pokedle", format: "classic", max: 8, solved: true, rows: ["ggg"] });
    // A ranked CPU battle isn't a thing.
    expect(decodeShare("bat.fgen9ou.ow.lhard.k1.t5")).toEqual({ game: "battle", format: "gen9ou", outcome: "win", cpu: "hard", turns: 5 });
  });

  it("carries no free text: the landing page and card only ever show known labels and numbers", () => {
    for (const raw of [encodeShare(pokedle), encodeShare(guessr), encodeShare(quiz), encodeShare(battle)]) {
      const view = describeShare(decodeShare(raw)!);
      const text = JSON.stringify(view);
      expect(text).not.toMatch(/[<>]/);
    }
  });
});

describe("share text", () => {
  it("builds Pokédle's as in the brief: brand, number, score, streak, board, link", () => {
    const rows: CellStatus[][] = [
      ["match", "partial", "miss", "miss", "close-higher"],
      [M, M, "close-lower", "miss", M],
      [M, M, M, M, M],
    ];
    const input = { number: 123, max: 6, rows, solved: true, hard: false, hints: [], streak: 5 };
    const text = buildPokedleShare({ ...input, url: `https://pokeiq.vercel.app${sharePath(pokedleShareResult(input))}` });
    expect(text.split("\n")).toEqual(["PokéIQ Pokédle #123 3/6 🔥5", "🟩🟨⬛⬛🟨", "🟩🟩🟨⬛🟩", "🟩🟩🟩🟩🟩", "https://pokeiq.vercel.app/s/dle.n123.fc.m6.w1.k5.rgybby-ggybg-ggggg"]);
    // The link carries the same board.
    expect(decodeShare(text.split("/s/")[1])).toMatchObject({ daily: 123, rows: ["gybby", "ggybg", "ggggg"], streak: 5 });
  });

  it("masks the generation arrow of a Squirdle daily in the link too", () => {
    const r = pokedleShareResult({ number: 3, max: 9, squirdle: true, rows: [["higher", "partial", "miss", "lower", "higher"], [M, M, M, M, M]], solved: true, hard: false, hints: [], streak: 0 });
    expect(r.rows).toEqual(["mpxdu", "ccccc"]);
    expect(r.format).toBe("squirdle");
  });

  it("gives PokéGuessr a square and the points per round, never a place", () => {
    expect(guessrShareText(guessr, "World", URL).split("\n")).toEqual([
      "PokéIQ PokéGuessr Daily #6 · World 13,327/25,000",
      "🟩🟨🟩🟥🟧",
      "4,812 · 2,310 · 5,000 · 0 · 1,205",
      URL,
    ]);
    expect(guessrShareText({ game: "guessr", region: "kanto", streak: 3 }, "Kanto")).toBe("PokéIQ PokéGuessr Kanto Streak 🔥3 in a row\n✅✅✅❌");
  });

  it("gives quizzes the score, time, PokéIQ and a square per answer", () => {
    expect(quizShareText(quiz, URL).split("\n")).toEqual([
      "PokéIQ Who's That Pokémon? · Blitz · Hard 8/10 ⏱0:42",
      "🧠 PokéIQ 124 · 12,340 pts",
      "🟩🟩🟥🟩🟩🟩🟩🟥🟩🟩",
      URL,
    ]);
    const daily = { ...quiz, daily: 12, streak: 4, difficulty: undefined };
    expect(quizShareText(daily).split("\n")[0]).toBe("PokéIQ Daily #12 8/10 🔥4 ⏱0:42");
    const test = { ...quiz, format: "adaptive" as const, difficulty: undefined, correct: 15, total: 20, pokeiq: 132, grid: "1".repeat(20) };
    expect(quizShareText(test).split("\n").slice(0, 2)).toEqual(["PokéIQ Test 🧠 132 · 15/20 ⏱0:42", "12,340 pts"]);
  });

  it("builds a quiz result from a finished run and from a challenge card", () => {
    const run: RunResult = {
      sid: "s",
      spec: { module: "cry", format: "classic", difficulty: "easy", seed: "x", daily: "2026-10-28" },
      score: 5000,
      correct: 7,
      total: 10,
      bestStreak: 3,
      grid: "1110111010",
      durationMs: 61_400,
      rating: 0,
      pokeiq: 112,
      finishedAt: 0,
    };
    expect(quizShareResult(run, 2)).toEqual({ game: "quiz", module: "cry", format: "classic", daily: 12, correct: 7, total: 10, pokeiq: 112, score: 5000, seconds: 61, grid: "1110111010", streak: 2 });
    const card: ShareCard = { m: "types", f: "survival", d: "hard", s: "x", sc: 900, c: 12, t: 15, q: 140, gr: "111111111111000" };
    expect(describeShare(shareCardResult(card))).toMatchObject({ headline: "12/15", playHref: "/play" });
  });

  it("gives battles the outcome, format, opponent and length", () => {
    expect(battleShareText(battle, URL)).toBe(`PokéIQ Battle 🏆 Victory\n[Gen 9] Random Battle · vs CPU (Hard) · 23 turns\n${URL}`);
    expect(replayShareText("Red beat Blue", "[Gen 9] OU", URL).split("\n")[0]).toBe("PokéIQ Battle replay");
  });

  it("composes every game the same way, skipping what's empty", () => {
    expect(composeShare({ title: "X", score: "1/2", badges: [false, "🔥3", null], lines: ["a", undefined, "b"], url: URL })).toBe(`PokéIQ X 1/2 🔥3\na\nb\n${URL}`);
  });
});

describe("share landing", () => {
  it("describes each game with a big way in to today's", () => {
    expect(describeShare(pokedle)).toMatchObject({ headline: "3/8", playHref: "/pokedle", playLabel: "Play today's Pokédle", accent: "violet" });
    expect(describeShare(pokedle).tiles[0]).toEqual(["hit", "near", "miss", "miss", "near", "miss", "near"]);
    expect(describeShare(guessr)).toMatchObject({ headline: "13,327", numbers: ["4,812", "2,310", "5,000", "0", "1,205"], playHref: "/guessr" });
    expect(describeShare({ ...quiz, daily: 3 })).toMatchObject({ playHref: "/daily", label: "Daily Challenge #3" });
    expect(describeShare({ ...quiz, format: "adaptive" })).toMatchObject({ playHref: "/iq-test", headline: "PokéIQ 124" });
    expect(describeShare(battle)).toMatchObject({ headline: "Victory", playHref: "/battle/play", tiles: [] });
  });
});
