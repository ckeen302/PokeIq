import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POKEDEX, MAX_GEN, getPokemon, type Pokemon } from "@/lib/pokemon/pokedex";
import {
  CLASSIC_RULES,
  DLE_ALL_COLUMNS,
  DLE_GEN_COUNT,
  SQUIRDLE_COLUMNS,
  cleanSettings,
  dailyRules,
  dleRules,
  rulesBonus,
  rulesTags,
  settingsOf,
  squirdleGuesses,
} from "@/lib/dle-format";
import { DLE_SQUIRDLE_FROM, dleBasePoints, dleScore, type CellStatus } from "@/lib/dle-types";
import { panelMisfit } from "@/lib/dle-compare";
import { ruledOut, dexClues } from "@/lib/dle-dex";
import { answerFor, compare, dailyPuzzleOf, evaluate, hardModeError, practicePuzzle, traitsOf } from "@/lib/server/pokedle";
import { dailyAnswerId } from "@/lib/server/pokedle-schedule";
import { clearMemoryResults, dleDaySummary, memoryResultStore, recordDleResult } from "@/lib/server/dle-results";
import { buildPokedleShare } from "@/lib/dle-share";
import { dleStats } from "@/lib/dle-stats";
import { createPokedleDuel, duelRules, guessPokedle, pokedleView, roundSecret, setPokedleGens, setPokedleSettings, buyPokedleHint, type PokedleDuel } from "@/lib/server/pokedle-duel";
import { joinDuel, readyDuel } from "@/lib/server/duels";
import { queueKey, searchMatch, newTicket, type MatchSettings } from "@/lib/server/matchmaking";
import { pvpStore, queueStore } from "@/lib/server/duel-store";
import type { PvpOutcome } from "@/lib/server/duel-core";
import { PVP_LEAD_MS } from "@/lib/pvp-types";
import { POST as guessRoute } from "@/app/api/pokedle/route";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const byName = (name: string) => POKEDEX.find((p) => p.name === name)!;
const SQUIRDLE = dailyRules("squirdle");

/**
 * Squirdle's own feedback, transcribed from its game.js: 1 right, 2 the
 * answer is higher, 3 lower, 4 the type is the answer's other one, 5 wrong.
 * Types compare with "" for a missing second type, so two monotypes match.
 */
function squirdleDigits(guess: Pokemon, secret: Pokemon): string {
  const g = [guess.gen, guess.types[0], guess.types[1] ?? "", guess.height, guess.weight] as const;
  const s = [secret.gen, secret.types[0], secret.types[1] ?? "", secret.height, secret.weight] as const;
  const num = (a: number, b: number) => (a === b ? "1" : a < b ? "2" : "3");
  const t1 = g[1] === s[1] ? "1" : g[1] === s[2] ? "4" : "5";
  const t2 = g[2] === s[2] ? "1" : g[2] === s[1] ? "4" : "5";
  return num(g[0], s[0]) + t1 + t2 + num(g[3], s[3]) + num(g[4], s[4]);
}
const DIGIT: Record<CellStatus, string> = { match: "1", higher: "2", lower: "3", partial: "4", miss: "5", "close-higher": "?", "close-lower": "?" };

describe("Squirdle-style format, against Squirdle's real one", () => {
  it("shows Squirdle's five columns and its feedback, with no close states", () => {
    expect(SQUIRDLE.columns).toEqual(["gen", "type1", "type2", "height", "weight"]);
    expect(SQUIRDLE.close).toBe(false);
    // Every pair from a deterministic sample of the Pokédex gets the same feedback as Squirdle's.
    const sample = POKEDEX.filter((_, i) => i % 23 === 0);
    for (const guess of sample)
      for (const secret of sample) {
        const row = compare(guess, secret, SQUIRDLE);
        expect(Object.keys(row.cells)).toEqual([...SQUIRDLE_COLUMNS]);
        const digits = SQUIRDLE.columns.map((c) => DIGIT[row.cells[c]!.status]).join("");
        expect(digits, `${guess.name} vs ${secret.name}`).toBe(squirdleDigits(guess, secret));
      }
  });

  it("marks a type in the other slot (Squirdle's 🟨) and two missing second types as a match", () => {
    const row = compare(byName("Charizard"), byName("Gyarados"), SQUIRDLE); // fire/flying vs water/flying
    expect(row.cells.type1!.status).toBe("miss");
    expect(row.cells.type2!.status).toBe("match");
    const swap = compare(byName("Pelipper"), byName("Swanna"), SQUIRDLE); // water/flying vs water/flying
    expect(swap.cells.type1!.status).toBe("match");
    expect(compare(byName("Pikachu"), byName("Charmander"), SQUIRDLE).cells.type2!.status).toBe("match");
    // Type 1 is the answer's Type 2: 🟨 (Squirdle's "wrong position").
    const swapped = compare(byName("Pikachu"), byName("Rotom"), SQUIRDLE); // electric vs electric/ghost
    expect(swapped.cells.type1!.status).toBe("match");
    const other = compare(byName("Gastly"), byName("Rotom"), SQUIRDLE); // ghost/poison vs electric/ghost
    expect(other.cells.type1!.status).toBe("partial");
    expect(other.cells.type2!.status).toBe("miss");
  });

  it("uses Squirdle's guess counts: floor(span / 2) + 5, so 9 for the all-gens daily", () => {
    const want = { 0: 5, 1: 5, 2: 6, 3: 6, 4: 7, 5: 7, 6: 8, 7: 8, 8: 9 } as Record<number, number>;
    for (let span = 0; span <= 8; span++) expect(squirdleGuesses(1, 1 + span)).toBe(want[span]);
    expect(SQUIRDLE.maxGuesses).toBe(9);
    expect(dleRules({ format: "squirdle", gens: [1, 1] }).maxGuesses).toBe(5);
    expect(dleRules({ format: "squirdle", gens: [1, 4], guesses: 8 }).maxGuesses).toBe(8);
    expect(DLE_GEN_COUNT).toBe(MAX_GEN);
  });
});

describe("settings and column toggles", () => {
  it("keeps Custom at 3 or more columns, in board order, and cleans anything else up", () => {
    expect(dleRules({ format: "custom", columns: ["weight", "gen", "color"] }).columns).toEqual(["gen", "weight", "color"]);
    expect(dleRules({ format: "custom", columns: ["gen", "weight"] }).columns).toEqual(DLE_ALL_COLUMNS);
    expect(dleRules({ format: "custom", columns: ["gen", "nope", "stage", "type1"] }).columns).toEqual(["gen", "type1", "stage"]);
    const junk = cleanSettings({ format: "x", gens: [7, 2], guesses: 7, timer: "1h", pool: "shiny", hints: "no" });
    expect(junk).toMatchObject({ format: "classic", gens: [2, 7], guesses: 0, timer: "none", pool: "all", hints: true });
    expect(dleRules({}).maxGuesses).toBe(8);
    expect(CLASSIC_RULES).toMatchObject({ format: "classic", columns: DLE_ALL_COLUMNS, gens: [], maxGuesses: 8, close: true, hints: true });
    // Squirdle-style never has close states, whatever is sent.
    expect(dleRules({ format: "squirdle", close: true }).close).toBe(false);
    expect(settingsOf(dleRules({ format: "custom", columns: ["gen", "type1", "height"], gens: [1, 4], guesses: 6 }))).toMatchObject({ gens: [1, 4], guesses: 6 });
  });

  it("works out and sends only the columns the rules show (server side)", () => {
    const rules = dleRules({ format: "custom", columns: ["gen", "height", "stage"], close: false });
    const puzzle = practicePuzzle("cols1234", rules);
    const answer = answerFor(puzzle);
    const wrong = POKEDEX.find((p) => p.id !== answer.id)!;
    const res = evaluate(puzzle, [wrong.id], [], "notebook", rules);
    expect(Object.keys(res.rows[0].cells)).toEqual(["gen", "height", "stage"]);
    expect(JSON.stringify(res)).not.toMatch(/"(type1|type2|weight|color)"\s*:\s*\{/);
    for (const cell of Object.values(res.rows[0].cells)) expect(cell!.status).not.toMatch(/^close/);
  });

  it("the API settles the rules: a daily's are fixed, a practice game's come from its settings", async () => {
    const post = (body: unknown) => guessRoute(new NextRequest("http://localhost:3000/api/pokedle", { method: "POST", body: JSON.stringify(body) }));
    const today = new Date().toISOString().slice(0, 10);
    // A daily ignores settings: the Squirdle-style daily is Squirdle's rules over every generation.
    const daily = await (await post({ date: today, format: "squirdle", guesses: [25], settings: { format: "custom", columns: ["gen", "type1", "color"] } })).json();
    expect(daily.rules).toMatchObject({ format: "squirdle", maxGuesses: 9, gens: [] });
    expect(Object.keys(daily.rows[0].cells)).toEqual([...SQUIRDLE_COLUMNS]);
    const practice = await (await post({ practiceSeed: "abcd1234", guesses: [25], settings: { format: "custom", columns: ["gen", "type1", "color"], gens: [1, 1], guesses: 6 } })).json();
    expect(practice.rules).toMatchObject({ format: "custom", gens: [1], maxGuesses: 6 });
    expect(Object.keys(practice.rows[0].cells)).toEqual(["gen", "type1", "color"]);
    expect(getPokemon(answerFor(practicePuzzle("abcd1234", practice.rules)).id)!.gen).toBe(1);
    // An old client's practice game (no settings) is Classic, as before.
    const old = await (await post({ practiceSeed: "abcd1234", guesses: [25] })).json();
    expect(old.rules.format).toBe("classic");
    expect(Object.keys(old.rows[0].cells)).toHaveLength(7);
    expect((await post({ date: "2026-10-01", format: "squirdle", guesses: [25] })).status).toBe(400);
  });

  it("ends a timed game when its clock runs out, never an untimed one", () => {
    const timed = dleRules({ timer: "60s" });
    const puzzle = practicePuzzle("timer123", timed);
    const wrong = POKEDEX.find((p) => p.id !== answerFor(puzzle).id)!;
    const res = evaluate(puzzle, [wrong.id], [], "notebook", timed, true);
    expect(res).toMatchObject({ over: true, solved: false, timedOut: true, score: 0 });
    expect(res.answer).toBeDefined();
    expect(evaluate(puzzle, [wrong.id], [], "notebook", dleRules({}), true).over).toBe(false);
  });

  it("limits a legendaries-only pool to legendary and mythical Pokémon", () => {
    const rules = dleRules({ pool: "legendary", gens: [1, 1] });
    for (let i = 0; i < 20; i++) {
      const p = answerFor(practicePuzzle(`legend${i}`, rules));
      expect(p.legendary || p.mythical).toBe(true);
      expect(p.gen).toBe(1);
    }
  });

  it("drops hints when the rules turn them off", () => {
    const rules = dleRules({ hints: false });
    const puzzle = practicePuzzle("nohint12", rules);
    const wrong = POKEDEX.find((p) => p.id !== answerFor(puzzle).id)!;
    expect(evaluate(puzzle, [wrong.id], ["genus", "silhouette"], "notebook", rules).hints).toEqual({ silhouetteUrl: undefined, genus: undefined });
  });
});

describe("strict clues, hard mode and the Pokédex", () => {
  it("reads gen clues without close states in hard mode and the Pokédex", () => {
    const guess = traitsOf(byName("Pikachu")); // gen 1
    const answer = traitsOf(byName("Chikorita")); // gen 2
    const statuses = { gen: "higher" as CellStatus };
    // Strict: a gen 2 candidate gives "higher" too, so it fits; with close states it wouldn't.
    expect(panelMisfit(guess, statuses, answer, false)).toBeNull();
    expect(panelMisfit(guess, statuses, answer, true)).toBe("gen");
    // A column the game doesn't show rules nothing out.
    expect(panelMisfit(guess, {}, traitsOf(byName("Mew")), false)).toBeNull();
    const rows = [[byName("Pikachu").id, "Pikachu", 1, "electric", null]] as [number, string, number, string, null][];
    const clue = dexClues([{ id: byName("Pikachu").id, cells: { gen: { value: "1", status: "higher" } } }]);
    expect(ruledOut(rows, clue, false).has(byName("Pikachu").id)).toBe(true);
  });

  it("holds hard mode to the clues the rules show", () => {
    const rules = dleRules({ format: "custom", columns: ["height", "weight", "color"] });
    const puzzle = practicePuzzle("hard1234", rules);
    const ids = POKEDEX.filter((p) => p.id !== answerFor(puzzle).id)
      .slice(0, 3)
      .map((p) => p.id);
    // No gen or type columns: nothing for hard mode to hold you to.
    expect(hardModeError(puzzle, ids, rules)).toBeNull();
  });
});

describe("dailies per format", () => {
  beforeEach(() => clearMemoryResults());

  it("keeps Classic's answers and gives the Squirdle-style daily its own, never Classic's family that day", () => {
    const dates = Array.from({ length: 60 }, (_, k) => new Date(Date.parse(`${DLE_SQUIRDLE_FROM}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10));
    for (const d of dates) {
      expect(answerFor(dailyPuzzleOf(d))).toBe(answerFor({ id: `daily:${d}` }));
      expect(dailyAnswerId(d, "classic")).toBe(dailyAnswerId(d));
      const a = getPokemon(dailyAnswerId(d))!;
      const b = getPokemon(dailyAnswerId(d, "squirdle"))!;
      expect(b.chain, d).not.toBe(a.chain);
    }
    const ids = new Set(dates.map((d) => dailyAnswerId(d, "squirdle")));
    expect(ids.size).toBe(dates.length);
  });

  it("records, sums up and keeps stats apart per format", async () => {
    const store = memoryResultStore();
    const now = Date.parse("2026-10-21T12:00:00Z");
    const date = "2026-10-21";
    const sq = answerFor(dailyPuzzleOf(date, "squirdle")).id;
    const cl = answerFor(dailyPuzzleOf(date)).id;
    const a = await recordDleResult({ date, identity: "d:same", guesses: [sq], format: "squirdle", assist: "off" }, store, now);
    const b = await recordDleResult({ date, identity: "d:same", guesses: [cl] }, store, now);
    expect(a && a.ok && a.you).toMatchObject({ recorded: true, solved: true, guesses: 1, position: 1 });
    expect(b && b.ok && b.you).toMatchObject({ recorded: true, solved: true, guesses: 1, position: 1 });
    // A Squirdle-style solve scores with its +20% and the Pokédex-off ×1.25.
    expect(a && a.ok && a.you.score).toBe(Math.round(1000 * 1.25 * 1.2));
    const sqDay = await dleDaySummary(date, store, "squirdle");
    const clDay = await dleDaySummary(date, store);
    expect(sqDay).toMatchObject({ players: 1, solved: 1 });
    expect(sqDay!.dist).toHaveLength(9);
    expect(clDay!.dist).toHaveLength(8);
    // Classic's guesses don't solve the Squirdle-style daily.
    const c = await recordDleResult({ date, identity: "d:other", guesses: [cl], format: "squirdle" }, store, now);
    expect(c && !c.ok && c.status).toBe(409);
    expect(await dleDaySummary("2026-10-01", store, "squirdle")).toBeNull();
  });

  it("works out each format's streaks and stats from its own results", () => {
    const results = { "2026-10-20": { guesses: [1, 2, 3, 4, 5, 6, 7, 8, 9], solved: true, over: true }, "2026-10-21": { guesses: [1], solved: true, over: true } };
    const s = dleStats(results, "2026-10-21", 9);
    expect(s.distribution).toHaveLength(9);
    expect(s.distribution[8]).toBe(1);
    expect(s.playStreak).toBe(2);
  });
});

describe("share text, results and scoring", () => {
  it("shares a Squirdle-style daily with its format and Squirdle's symbols, the gen arrow masked", () => {
    const text = buildPokedleShare({
      number: 3,
      max: 9,
      tags: ["Squirdle"],
      squirdle: true,
      rows: [
        ["higher", "partial", "miss", "lower", "higher"],
        ["match", "match", "match", "match", "match"],
      ],
      solved: true,
      hard: false,
      hints: [],
      assist: "off",
      streak: 2,
      url: "https://pokeiq.vercel.app/pokedle",
    });
    expect(text.split("\n")).toEqual(["Pokédle #3 · Squirdle 2/9 🧠 🔥2", "🟦🟨❌🔽🔼", "✅✅✅✅✅", "pokeiq.vercel.app/pokedle"]);
  });

  it("shares a practice game with its settings tags", () => {
    const rules = dleRules({ format: "custom", columns: ["gen", "type1", "type2"], gens: [1, 1], guesses: 6, timer: "60s" });
    const tags = rulesTags(rules).filter((t) => !/ guesses$/.test(t));
    const text = buildPokedleShare({ max: 6, tags, rows: [["match", "match", "match"]], solved: true, hard: true, hints: [], streak: 9, url: "https://x.app/pokedle" });
    expect(text.split("\n")[0]).toBe("Pokédle Practice · Custom · 3 clues · Gen 1 · 60 s blitz 1/6*");
  });

  it("tags a game for the summary chip and result", () => {
    expect(rulesTags(dleRules({ format: "squirdle", gens: [1, 4], guesses: 8 }), { dex: "No dex" }).join(" · ")).toBe("Squirdle · Gen 1–4 · 8 guesses · No dex");
    expect(rulesTags(CLASSIC_RULES, { dex: "Notebook", hard: true }).join(" · ")).toBe("Classic · 8 guesses · Notebook · Hard");
    expect(rulesTags(dleRules({ close: false, hints: false, pool: "legendary" }))).toEqual(["Classic", "8 guesses", "Strict", "No hints", "Legendaries"]);
  });

  it("pays a small bonus for fewer columns or no close states, and never more points for more guesses", () => {
    expect(rulesBonus(CLASSIC_RULES)).toBe(0);
    expect(rulesBonus(SQUIRDLE)).toBe(0.2);
    expect(rulesBonus(dleRules({ close: false }))).toBe(0.1);
    expect(rulesBonus(dleRules({ format: "custom", columns: ["gen", "type1", "type2", "height", "weight", "color"] }))).toBe(0.05);
    expect(rulesBonus(dleRules({ format: "custom", columns: ["gen", "type1", "type2"], close: false }))).toBe(0.25);
    expect([1, 8, 9, 10].map(dleBasePoints)).toEqual([1000, 300, 300, 300]);
    expect(dleScore(2, true, [], "notebook", 0.2)).toBe(1080);
    expect(dleScore(2, true, [], "notebook")).toBe(900);
  });
});

describe("duels and matchmaking with settings", () => {
  const T0 = 1_800_000_000_000;
  const must = (out: PvpOutcome<PokedleDuel>): PokedleDuel => {
    if (!out.ok) throw new Error(out.error);
    return out.duel;
  };

  it("plays by the host's settings, which only the host sets, in the lobby, and the guest sees", () => {
    const { duel, playerId: red } = createPokedleDuel("Red", "fmtduel1", T0, "seed-fmt", { settings: { format: "squirdle", timer: "60s", hints: false } });
    const joined = joinDuel(duel, "Blue", T0 + 1000);
    if (!joined.ok) throw new Error(joined.error);
    const blue = joined.playerId;
    expect(setPokedleSettings(joined.duel as PokedleDuel, blue, { format: "classic" }, T0 + 2000).ok).toBe(false);
    let d = must(setPokedleSettings(joined.duel as PokedleDuel, red, { format: "squirdle", timer: "60s", hints: false, guesses: 6 }, T0 + 2000));
    d = must(setPokedleGens(d, red, [1], T0 + 2000));
    const guestView = pokedleView(d, blue, T0 + 2000, 1);
    expect(guestView.rules).toMatchObject({ format: "squirdle", maxGuesses: 6, hints: false, timer: "60s", close: false, gens: [1] });
    d = must(readyDuel(must(readyDuel(d, red, true, T0 + 3000)), blue, true, T0 + 3000)) as PokedleDuel;
    const start = T0 + 3000 + PVP_LEAD_MS;
    expect(setPokedleSettings(d, red, { format: "classic" }, start).ok).toBe(false);
    const secret = roundSecret(d, 0);
    expect(secret.gen).toBe(1);
    const wrong = POKEDEX.find((p) => p.gen === 1 && p.id !== secret.id)!;
    d = must(guessPokedle(d, red, 0, wrong.id, start + 1000));
    const view = pokedleView(d, red, start + 1000, 2);
    expect(view.round!.endsAt - view.round!.startsAt).toBe(60_000);
    expect(Object.keys(view.round!.rows[0].cells)).toEqual([...SQUIRDLE_COLUMNS]);
    expect(view.round!.boards[0].colours[0]).toHaveLength(5);
    expect(buyPokedleHint(d, red, 0, "genus", start + 2000).ok).toBe(false);
  });

  it("keeps ranked duels Classic whatever is asked", () => {
    const { duel } = createPokedleDuel("Red", "fmtduel2", T0, "seed-r", {
      settings: { format: "squirdle" },
      queue: "ranked",
      ranked: { keys: ["a".repeat(20), "b".repeat(20)], ratings: [1200, 1200], games: [0, 0] },
    });
    expect(duel.settings).toBeUndefined();
    expect(duelRules(duel)).toMatchObject({ format: "classic", maxGuesses: 8, columns: DLE_ALL_COLUMNS, timer: "3m" });
  });

  it("has a few casual queues: one per format and Pokédex level, Classic + Notebook the one there was", async () => {
    const k = (s: MatchSettings) => queueKey(s);
    expect(k({ game: "pokedle" })).toBe("pokedle:all");
    expect(k({ game: "pokedle", format: "classic", assist: "notebook" })).toBe("pokedle:all");
    expect(k({ game: "pokedle", format: "squirdle" })).toBe("pokedle:squirdle");
    expect(k({ game: "pokedle", format: "squirdle", assist: "off" })).toBe("pokedle:squirdle:off");
    for (const key of ["pokedle:all", "pokedle:squirdle", "pokedle:squirdle:off"]) expect(key).toMatch(/^[a-z0-9:-]{3,64}$/);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    try {
      const settings: MatchSettings = { game: "pokedle", format: "squirdle" };
      await queueStore.remove(queueKey(settings));
      const red = newTicket();
      await searchMatch(settings, "Red", red);
      vi.setSystemTime(T0 + 2000);
      const out = await searchMatch(settings, "Blue", newTicket());
      if (!out.ok || out.status !== "matched") throw new Error("no match");
      const { duel } = (await pvpStore.load(out.code))!;
      expect(duel.kind === "pokedle" && duelRules(duel).format).toBe("squirdle");
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => vi.useRealTimers());
