import { describe, expect, it } from "vitest";
import { createPokedleDuel, guessPokedle, pokedleView, roundSecret, setPokedleGens, type PokedleDuel } from "@/lib/server/pokedle-duel";
import { joinDuel, leaveDuel, linkRematch, readyDuel, rematchOf, takeRematchSeat, touchDuel } from "@/lib/server/duels";
import { readPvpToken, seriesForRematch, seriesView, type PvpOutcome } from "@/lib/server/duel-core";
import { pvpStore } from "@/lib/server/duel-store";
import { searchMatch, type SearchResult } from "@/lib/server/matchmaking";
import { clueKey, fits, stillPossible } from "@/lib/server/pokedle-candidates";
import { compare } from "@/lib/server/pokedle";
import { getPokemon, poolFor, POKEDEX, type Pokemon } from "@/lib/pokemon/pokedex";
import { DLE_MAX_GUESSES } from "@/lib/dle-types";
import { DLE_DUEL_ROUNDS, PVP_AWAY_MS, PVP_LEAD_MS, type DleDuelView } from "@/lib/pvp-types";

// The memory store, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const SECOND = 1000;

const must = (out: PvpOutcome<PokedleDuel>): PokedleDuel => {
  if (!out.ok) throw new Error(out.error);
  return out.duel;
};

/** Red opens a Pokédle duel, Blue joins, both ready: round 1 starts after the lead-in. */
function started(seed = "social-seed", gens?: number[]) {
  const { duel, playerId: red } = createPokedleDuel("Red", "abcdefgh", T0, seed);
  const joined = joinDuel(duel, "Blue", T0 + SECOND);
  if (!joined.ok) throw new Error(joined.error);
  const blue = joined.playerId;
  const t = T0 + 2 * SECOND;
  let d = gens ? must(setPokedleGens(joined.duel, red, gens, t)) : joined.duel;
  d = must(readyDuel(must(readyDuel(d, red, true, t)), blue, true, t));
  return { duel: d, red, blue, start: t + PVP_LEAD_MS };
}

const current = (d: PokedleDuel) => d.rounds.length - 1;
const secretOf = (d: PokedleDuel, index = current(d)) => roundSecret(d, index).id;
function misses(d: PokedleDuel, n: number, from = 1): number[] {
  const out: number[] = [];
  for (let id = from; out.length < n; id++) if (id !== secretOf(d)) out.push(id);
  return out;
}
const both = (duel: PokedleDuel, t: number) => duel.players.reduce((d, p) => touchDuel(d, p.id, t), duel);
function pollUntil(d: PokedleDuel, t: number): PokedleDuel {
  for (let at = Math.max(...d.players.map((p) => p.seenAt)) + 5 * SECOND; at < t; at += 5 * SECOND) d = both(d, at);
  return both(d, t);
}
function guessAll(d: PokedleDuel, playerId: string, ids: number[], at: number): PokedleDuel {
  const index = current(d);
  return ids.reduce((acc, id, k) => must(guessPokedle(pollUntil(acc, at + k * SECOND), playerId, index, id, at + k * SECOND)), d);
}

/** Plays a whole duel: `winner` solves every round on the first guess, the other on the second (null: both on the first, at once). */
function playDuel(d: PokedleDuel, winner: number | null): PokedleDuel {
  while (d.status === "playing") {
    const index = current(d);
    const start = d.rounds[index].startsAt;
    const order = winner === null ? [0, 1] : [winner, 1 - winner];
    for (const seat of order) {
      const ids = winner === null || seat === winner ? [secretOf(d)] : [...misses(d, 1, 300), secretOf(d)];
      d = guessAll(d, d.players[seat].id, ids, start + SECOND);
    }
    if (d.status === "playing") d = pollUntil(d, d.rounds[index].result!.nextAt);
  }
  return d;
}

/** Both trainers press Rematch on a finished duel: the next game, under way. */
function rematchAndStart(over: PokedleDuel, code: string, t: number): PokedleDuel {
  const linked = linkRematch(over, code);
  if (!linked.ok) throw new Error(linked.error);
  let next = rematchOf(over, code, t);
  for (const p of over.players) next = must(takeRematchSeat(next, p.id, p.name, t));
  expect(next.status).toBe("playing");
  return next;
}

const view = (d: PokedleDuel, viewer: string | null, t = T0): DleDuelView => pokedleView(d, viewer, t, 0);

/** Every Pokémon in `pool` that fits every guess's clues, the slow way. */
function bruteForce(answer: Pokemon, guesses: Pokemon[], pool: readonly Pokemon[]): number {
  return pool.filter((c) => guesses.every((g) => clueKey(compare(g, c)) === clueKey(compare(g, answer)))).length;
}

describe("pokédle duel: Pokémon still possible", () => {
  it("counts the Pokémon that fit every clue, down to one on a solve", () => {
    const answer = getPokemon(445)!; // Garchomp
    const guesses = [25, 6, 384, 443, 445].map((id) => getPokemon(id)!);
    const counts = stillPossible(answer, guesses, POKEDEX);
    expect(counts).toHaveLength(guesses.length);
    // Never goes up, never loses the answer, and is exact.
    counts.forEach((n, k) => {
      expect(n).toBe(bruteForce(answer, guesses.slice(0, k + 1), POKEDEX));
      if (k > 0) expect(n).toBeLessThanOrEqual(counts[k - 1]);
      expect(n).toBeGreaterThanOrEqual(1);
    });
    expect(counts.at(-1)).toBe(1);
    // A wrong guess rules itself out; the answer always fits.
    for (const g of guesses.slice(0, -1)) {
      expect(fits(g, answer, g)).toBe(false);
      expect(fits(g, answer, answer)).toBe(true);
    }
  });

  it("matches the slow count for random boards and generation pools", () => {
    let seed = 7;
    const rand = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
    for (let trial = 0; trial < 12; trial++) {
      const pool = trial % 3 === 0 ? poolFor([1, 2]) : POKEDEX;
      const answer = pool[rand(pool.length)];
      const guesses = Array.from({ length: 1 + rand(DLE_MAX_GUESSES - 1) }, () => pool[rand(pool.length)]).filter(
        (g, k, all) => g.id !== answer.id && all.findIndex((x) => x.id === g.id) === k
      );
      const counts = stillPossible(answer, guesses, pool);
      expect(counts.at(-1) ?? pool.length).toBe(bruteForce(answer, guesses, pool));
    }
  });

  it("is cheap: a full board against the whole Pokédex in a few milliseconds", () => {
    const answer = getPokemon(700)!;
    const guesses = [1, 4, 7, 25, 133, 150, 249, 385].map((id) => getPokemon(id)!);
    stillPossible(answer, guesses, POKEDEX);
    const t = performance.now();
    for (let i = 0; i < 10; i++) stillPossible(answer, guesses, POKEDEX);
    expect((performance.now() - t) / 10).toBeLessThan(50);
  });

  it("shows each trainer's count, and the opponent only the count, from the duel's generations", () => {
    const { duel, red, blue, start } = started("meter-seed", [1]);
    const pool = poolFor([1]);
    expect(view(duel, red).pool).toBe(pool.length);
    const mine = misses(duel, 3, 1);
    const d = guessAll(duel, red, mine, start + SECOND);
    const answer = roundSecret(d, 0);
    const expected = stillPossible(answer, mine.map((id) => getPokemon(id)!), pool);
    expect(view(d, red).round!.boards[0].possible).toEqual(expected);
    for (const viewer of [blue, null]) {
      const theirs = view(d, viewer).round!;
      expect(theirs.boards[0].possible).toEqual(expected);
      expect(theirs.boards[1].possible).toEqual([]);
      expect(theirs.rows).toEqual([]);
      const json = JSON.stringify(theirs);
      for (const id of mine) expect(json).not.toContain(getPokemon(id)!.name);
      expect(json).not.toContain(answer.name);
    }
  });

  it("works each count out once, when the guess is made, not on every poll", () => {
    const { duel, red, start } = started();
    let d = guessAll(duel, red, misses(duel, 2), start + SECOND);
    const stored = d.rounds[0].guesses[0].map((g) => g.left);
    expect(stored.every((n) => typeof n === "number")).toBe(true);
    // The view reads what was stored (a stand-in number shows through).
    d = structuredClone(d);
    d.rounds[0].guesses[0][1].left = 42;
    expect(view(d, red).round!.boards[0].possible).toEqual([stored[0], 42]);
    // A guess saved before the meter existed is worked out on the spot.
    delete d.rounds[0].guesses[0][1].left;
    expect(view(d, red).round!.boards[0].possible).toEqual(stored);
  });

  it("reveals both trainers' counts with the round", () => {
    const { duel, red, blue, start } = started();
    let d = guessAll(duel, red, [...misses(duel, 2), secretOf(duel)], start + SECOND);
    d = guessAll(d, blue, misses(d, DLE_MAX_GUESSES, 300), start + 5 * SECOND);
    const [round] = view(d, blue).revealed;
    expect(round.boards[0].possible).toHaveLength(3);
    expect(round.boards[0].possible.at(-1)).toBe(1);
    expect(round.boards[1].possible).toHaveLength(DLE_MAX_GUESSES);
    expect(round.boards[1].possible.at(-1)).toBeGreaterThanOrEqual(1);
  });
});

describe("pokédle duel: best-of-three series", () => {
  it("counts each rematch into the series until someone wins two games, then starts a new one", () => {
    const { duel, red, blue } = started();
    // Game 1 shows as game 1 of a new series from the start.
    expect(view(duel, red).series).toEqual({ game: 1, wins: [0, 0], draws: 0, winner: null });

    const g1 = playDuel(duel, 0);
    expect(g1.end).toMatchObject({ reason: "played", winner: 0 });
    expect(view(g1, red).series).toEqual({ game: 1, wins: [1, 0], draws: 0, winner: null });

    const t = g1.end!.at + 10 * SECOND;
    let g2 = rematchAndStart(g1, "bcdefghj", t);
    expect(g2.series).toEqual({ ids: [red, blue], wins: [1, 0], draws: 0 });
    expect(view(g2, blue).series).toEqual({ game: 2, wins: [1, 0], draws: 0, winner: null });
    g2 = playDuel(g2, 1);
    expect(view(g2, red).series).toEqual({ game: 2, wins: [1, 1], draws: 0, winner: null });

    let g3 = rematchAndStart(g2, "cdefghjk", g2.end!.at + 10 * SECOND);
    expect(view(g3, red).series).toMatchObject({ game: 3, wins: [1, 1] });
    g3 = playDuel(g3, 0);
    expect(view(g3, blue).series).toEqual({ game: 3, wins: [2, 1], draws: 0, winner: 0 });

    // Red took it 2–1: the next rematch is game 1 of a new series.
    expect(seriesForRematch(g3)).toBeUndefined();
    const g4 = rematchAndStart(g3, "defghjkm", g3.end!.at + 10 * SECOND);
    expect(g4.series).toBeUndefined();
    expect(view(g4, red).series).toEqual({ game: 1, wins: [0, 0], draws: 0, winner: null });
  });

  it("counts a draw as a game won by nobody, and a forfeit as a win", () => {
    const { duel, red, blue } = started("draw-seed");
    const drawn = playDuel(duel, null);
    expect(drawn.end).toMatchObject({ winner: null });
    expect(view(drawn, red).series).toEqual({ game: 1, wins: [0, 0], draws: 1, winner: null });

    const g2 = rematchAndStart(drawn, "bcdefghj", drawn.end!.at + SECOND);
    expect(view(g2, red).series).toMatchObject({ game: 2, wins: [0, 0], draws: 1 });
    const forfeit = must(leaveDuel(g2, red, g2.rounds[0].startsAt + SECOND));
    expect(view(forfeit, blue).series).toEqual({ game: 2, wins: [0, 1], draws: 1, winner: null });
    expect(seriesForRematch(forfeit)).toEqual({ ids: [red, blue], wins: [0, 1], draws: 1 });
  });

  it("keeps each trainer's wins when the rematch lobby swaps their seats", () => {
    const { duel, red, blue } = started();
    const g1 = playDuel(duel, 0); // Red 1–0
    const t = g1.end!.at + SECOND;
    let next = rematchOf(g1, "bcdefghj", t);
    // Blue presses Rematch at once; Red only comes back after the lobby let their seat go.
    next = must(takeRematchSeat(next, blue, "Blue", t));
    next = touchDuel(next, blue, t + PVP_AWAY_MS + 5 * SECOND);
    expect(next.players.map((p) => p.id)).toEqual([blue]);
    expect(seriesView(next)).toBeUndefined();
    next = must(takeRematchSeat(next, red, "Red", t + PVP_AWAY_MS + 6 * SECOND));
    expect(next.status).toBe("playing");
    expect(next.players.map((p) => p.id)).toEqual([blue, red]);
    // Seat 0 is Blue now: the wins follow the trainers, not the seats.
    expect(view(next, red).series).toEqual({ game: 2, wins: [0, 1], draws: 0, winner: null });
  });

  it("starts a new series when someone else takes a seat in the rematch", () => {
    const { duel, blue } = started();
    const g1 = playDuel(duel, 1);
    const t = g1.end!.at + SECOND;
    let next = must(takeRematchSeat(rematchOf(g1, "bcdefghj", t), blue, "Blue", t));
    next = touchDuel(next, blue, t + PVP_AWAY_MS + 5 * SECOND);
    const joined = joinDuel(next, "Green", t + PVP_AWAY_MS + 6 * SECOND);
    if (!joined.ok) throw new Error(joined.error);
    expect(view(joined.duel, blue).series).toEqual({ game: 1, wins: [0, 0], draws: 0, winner: null });
    const green = must(readyDuel(joined.duel, joined.playerId, true, t + PVP_AWAY_MS + 7 * SECOND));
    expect(green.status).toBe("playing");
    expect(seriesForRematch(playDuel(green, 0))).toEqual({ ids: [blue, joined.playerId], wins: [1, 0], draws: 0 });
  });

  it("needs both trainers to press Rematch before the next game starts", () => {
    const { duel, red, blue } = started();
    const g1 = playDuel(duel, 0);
    const t = g1.end!.at + SECOND;
    let next = must(takeRematchSeat(rematchOf(g1, "bcdefghj", t), red, "Red", t));
    expect(next.status).toBe("lobby");
    expect(view(next, red).players.map((p) => p.ready)).toEqual([true, false]);
    // A rematch can't open before the duel is over.
    expect(linkRematch(duel, "cdefghjk").ok).toBe(false);
    next = must(takeRematchSeat(next, blue, "Blue", t + SECOND));
    expect(next.status).toBe("playing");
    expect(next.rounds).toHaveLength(1);
    expect(next.totals).toEqual([0, 0]);
    expect(next.seed).not.toBe(g1.seed);
  });

  it("gives matched opponents the same rematch and series", async () => {
    const tickets = ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"];
    expect((await searchMatch({ game: "pokedle" }, "Ash", tickets[0])).ok).toBe(true);
    const matched = (await searchMatch({ game: "pokedle" }, "Misty", tickets[1])) as SearchResult;
    if (!matched.ok || matched.status !== "matched") throw new Error("not matched");
    const stored = (await pvpStore.load(matched.code))!.duel as PokedleDuel;
    expect(stored.status).toBe("playing");
    const misty = readPvpToken(matched.token, matched.code)!;
    const now = stored.rounds[0].startsAt + SECOND;
    const over = must(leaveDuel(stored, misty, now));
    const next = rematchAndStart(over, "efghjkmn", now + SECOND);
    expect(next.players.map((p) => p.name)).toEqual(["Ash", "Misty"]);
    expect(view(next, misty).series).toEqual({ game: 2, wins: [1, 0], draws: 0, winner: null });
    expect(DLE_DUEL_ROUNDS).toBe(3);
  });
});
