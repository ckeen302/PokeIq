import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buyPokedleHint,
  createPokedleDuel,
  guessPokedle,
  pickSecret,
  pokedleView,
  roundSecret,
  setPokedleGens,
  skipPokedleReveal,
  type PokedleDuel,
} from "@/lib/server/pokedle-duel";
import { asKind, joinDuel, leaveDuel, linkRematch, readyDuel, rematchOf, takeRematchSeat, touchDuel } from "@/lib/server/duels";
import { answerQuiz } from "@/lib/server/quiz-duel";
import { pvpToken, readPvpToken, type PvpFailure, type PvpOutcome } from "@/lib/server/duel-core";
import { duelToken, readDuelToken } from "@/lib/server/duel";
import { pvpStore } from "@/lib/server/duel-store";
import { answerFor, compare } from "@/lib/server/pokedle";
import { getPokemon, poolFor } from "@/lib/pokemon/pokedex";
import { DLE_MAX_GUESSES } from "@/lib/dle-types";
import {
  DLE_DUEL_HINT_COST,
  DLE_DUEL_IDLE_ROUNDS,
  DLE_DUEL_REVEAL_MS,
  DLE_DUEL_ROUNDS,
  DLE_DUEL_ROUND_MS,
  PVP_AWAY_MS,
  PVP_LEAD_MS,
  dleDuelBase,
  dleDuelSpeed,
} from "@/lib/pvp-types";

// The memory store, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const SECOND = 1000;

const must = (out: PvpOutcome<PokedleDuel>): PokedleDuel => {
  if (!out.ok) throw new Error(out.error);
  return out.duel;
};
const failure = (out: PvpOutcome<PokedleDuel>) => (out.ok ? null : (out as PvpFailure));

/** Red opens a Pokédle duel and Blue joins. */
function lobby(seed = "dle-seed") {
  const { duel, playerId: red } = createPokedleDuel("Red", "abcdefgh", T0, seed);
  const joined = joinDuel(duel, "Blue", T0 + SECOND);
  if (!joined.ok) throw new Error(joined.error);
  return { duel: joined.duel, red, blue: joined.playerId };
}

/** Both ready: round 1 starts after the lead-in. */
function started(seed?: string, gens?: number[]) {
  const { duel, red, blue } = lobby(seed);
  const t = T0 + 2 * SECOND;
  let d = gens ? must(setPokedleGens(duel, red, gens, t)) : duel;
  d = must(readyDuel(must(readyDuel(d, red, true, t)), blue, true, t));
  return { duel: d, red, blue, ids: [red, blue], start: t + PVP_LEAD_MS };
}

const current = (d: PokedleDuel) => d.rounds.length - 1;
const secretOf = (d: PokedleDuel, index = current(d)) => roundSecret(d, index).id;
/** `n` Pokémon that aren't the round's secret, starting from `from`. */
function misses(d: PokedleDuel, n: number, from = 1): number[] {
  const out: number[] = [];
  for (let id = from; out.length < n; id++) if (id !== secretOf(d)) out.push(id);
  return out;
}
/** Solving in `n` guesses: n − 1 misses, then the secret. */
const solveIn = (d: PokedleDuel, n: number, from = 1) => [...misses(d, n - 1, from), secretOf(d)];

/** Both trainers poll at `t` (so neither times out). */
const both = (duel: PokedleDuel, t: number) => duel.players.reduce((d, p) => touchDuel(d, p.id, t), duel);

/** Both trainers keep polling, every 5 s, until `t`. */
function pollUntil(d: PokedleDuel, t: number): PokedleDuel {
  for (let at = Math.max(...d.players.map((p) => p.seenAt)) + 5 * SECOND; at < t; at += 5 * SECOND) d = both(d, at);
  return both(d, t);
}

/** Guesses for one trainer, a second apart from `at` (both keep polling meanwhile). */
function guessAll(d: PokedleDuel, playerId: string, ids: number[], at: number): PokedleDuel {
  const index = current(d);
  return ids.reduce((acc, id, k) => must(guessPokedle(pollUntil(acc, at + k * SECOND), playerId, index, id, at + k * SECOND)), d);
}

/** Plays out the round: each seat's guesses a second apart from the start (both at once), then on to the next round. */
function playRound(d: PokedleDuel, guesses: number[][]) {
  const index = current(d);
  const start = d.rounds[index].startsAt;
  for (let k = 0; k < Math.max(...guesses.map((g) => g.length)); k++) {
    const at = start + (k + 1) * SECOND;
    d.players.forEach((p, seat) => {
      if (guesses[seat][k] !== undefined) d = must(guessPokedle(pollUntil(d, at), p.id, index, guesses[seat][k], at));
    });
  }
  for (let at = start; !d.rounds[index].result; at += 5 * SECOND) d = pollUntil(d, at);
  if (d.status === "playing") d = pollUntil(d, d.rounds[index].result!.nextAt);
  return d;
}

const lastResult = (d: PokedleDuel) => pokedleView(d, d.players[0].id, T0, 0).revealed.at(-1)!;

afterEach(() => {
  vi.useRealTimers();
});

describe("pokédle duel: the secret", () => {
  it("gives both trainers the same secret, a new one every round, from the duel's seed", () => {
    const { duel, red, blue } = started();
    expect(duel.rounds[0].startsAt).toBe(T0 + 2 * SECOND + PVP_LEAD_MS);
    let d = duel;
    const secrets: number[] = [];
    for (let i = 0; i < DLE_DUEL_ROUNDS; i++) {
      secrets.push(secretOf(d));
      d = playRound(d, [solveIn(d, 3), solveIn(d, 4, 300)]);
    }
    expect(d.status).toBe("finished");
    expect(new Set(secrets).size).toBe(DLE_DUEL_ROUNDS);
    // Same seed, same duel; another seed, another secret.
    expect(secretOf(started("dle-seed").duel)).toBe(secrets[0]);
    expect(secretOf(started("other-seed").duel)).not.toBe(secrets[0]);

    // Both trainers' views of the finished duel agree, answers included.
    const [a, b] = [pokedleView(d, red, T0, 0), pokedleView(d, blue, T0, 0)];
    expect(a.revealed).toEqual(b.revealed);
    expect(a.revealed.map((r) => r.answer.id)).toEqual(secrets);
  });

  it("never picks today's solo Pokédle answer", () => {
    const at = Date.parse("2026-10-19T12:00:00Z");
    const daily = ["2026-10-18", "2026-10-19", "2026-10-20"].map((date) => answerFor({ id: `daily:${date}` }).id);
    for (let i = 0; i < 200; i++) expect(daily).not.toContain(pickSecret(`seed-${i}`, i % 3, at, []));
    // Only today's answer and one other Pokémon left to pick from: it's always the other one.
    const other = poolFor().find((p) => !daily.includes(p.id))!.id;
    const taken = poolFor()
      .map((p) => p.id)
      .filter((id) => id !== other && id !== daily[1]);
    for (let i = 0; i < 5; i++) expect(pickSecret(`seed-${i}`, 0, at, taken)).toBe(other);
  });

  it("draws secrets from the generations the creator picked", () => {
    for (let i = 0; i < 40; i++) expect(getPokemon(pickSecret(`seed-${i}`, 0, T0, [], [1]))!.gen).toBe(1);
    const { duel } = started("gen-seed", [2, 3]);
    expect(duel.gens).toEqual([2, 3]);
    expect([2, 3]).toContain(roundSecret(duel, 0).gen);
  });
});

describe("pokédle duel: scoring", () => {
  it("scores 1,000 for a first-guess solve down to 300 on the last, plus up to 150 for speed", () => {
    expect([...Array(DLE_MAX_GUESSES)].map((_, g) => dleDuelBase(g + 1))).toEqual([1000, 900, 800, 700, 600, 500, 400, 300]);
    expect([0, 90 * SECOND, DLE_DUEL_ROUND_MS, DLE_DUEL_ROUND_MS + SECOND].map(dleDuelSpeed)).toEqual([150, 75, 0, 0]);

    const { duel } = started();
    // Red solves in 2 (2 s in), Blue misses all 8.
    const d = playRound(duel, [solveIn(duel, 2), misses(duel, DLE_MAX_GUESSES, 300)]);
    const result = lastResult(d);
    const speed = dleDuelSpeed(2 * SECOND);
    expect(result.scores[0]).toEqual({ guesses: 2, solved: true, ms: 2 * SECOND, base: 900, speed, cost: 0, points: 900 + speed });
    expect(result.scores[1]).toEqual({ guesses: DLE_MAX_GUESSES, solved: false, ms: undefined, base: 0, speed: 0, cost: 0, points: 0 });
    expect(result.totals).toEqual([900 + speed, 0]);
    expect(d.totals).toEqual(result.totals);
  });

  it("charges for hints, never below 0, and only lets you buy each once after your first guess", () => {
    const { duel, red, blue, start } = started();
    expect(failure(buyPokedleHint(duel, red, 0, "genus", start + SECOND))?.error).toMatch(/after your first guess/);
    let d = guessAll(duel, red, misses(duel, 1), start + SECOND);
    d = must(buyPokedleHint(d, red, 0, "genus", start + 2 * SECOND));
    expect(failure(buyPokedleHint(d, red, 0, "genus", start + 3 * SECOND))?.error).toMatch(/already have/);
    d = must(buyPokedleHint(d, red, 0, "silhouette", start + 3 * SECOND));

    // Red sees both hints; Blue (and visitors) see only that Red bought them.
    const answer = roundSecret(d, 0);
    const mine = pokedleView(d, red, start + 4 * SECOND, 0).round!;
    expect(mine.hints.genus).toBe(`The ${answer.genus}`);
    expect(mine.hints.silhouetteUrl).toMatch(/^\/api\/media\/[\w-]+$/);
    for (const viewer of [blue, null]) {
      const theirs = pokedleView(d, viewer, start + 4 * SECOND, 0).round!;
      expect(theirs.hints).toEqual({});
      expect(theirs.boards[0].hints).toEqual(["genus", "silhouette"]);
      expect(JSON.stringify(theirs)).not.toContain(answer.genus);
      expect(JSON.stringify(theirs)).not.toContain("/api/media/");
    }

    // Blue solves in 3 with the category; Red on the 8th guess with both hints (300 + speed − 450: never below 0).
    d = guessAll(d, blue, misses(d, 2, 300), start + 5 * SECOND);
    d = must(buyPokedleHint(pollUntil(d, start + 8 * SECOND), blue, 0, "genus", start + 8 * SECOND));
    d = guessAll(d, blue, [secretOf(d)], start + 9 * SECOND);
    expect(failure(buyPokedleHint(d, blue, 0, "silhouette", start + 10 * SECOND))?.error).toMatch(/done with this round/);
    d = guessAll(d, red, solveIn(d, DLE_MAX_GUESSES - 1, 500), start + 10 * SECOND);
    const [scores] = pokedleView(d, red, start + 30 * SECOND, 0).revealed.map((r) => r.scores);
    expect(scores[0]).toMatchObject({ guesses: DLE_MAX_GUESSES, base: 300, cost: DLE_DUEL_HINT_COST.genus + DLE_DUEL_HINT_COST.silhouette });
    expect(scores[0].points).toBe(Math.max(0, 300 + scores[0].speed - 450));
    expect(scores[1]).toMatchObject({ guesses: 3, base: 800, cost: DLE_DUEL_HINT_COST.genus, points: 800 + scores[1].speed - 150 });
  });

  it("plays three rounds; the most points wins", () => {
    const { duel } = started();
    let d = playRound(duel, [solveIn(duel, 5), solveIn(duel, 2, 300)]);
    expect(d.status).toBe("playing");
    d = playRound(d, [solveIn(d, 2), solveIn(d, 3, 300)]);
    d = playRound(d, [solveIn(d, 1), solveIn(d, 4, 300)]);
    expect(d.rounds).toHaveLength(DLE_DUEL_ROUNDS);
    expect(d.status).toBe("finished");
    // Red: 600 + 900 + 1000; Blue: 900 + 800 + 700, plus a little speed.
    expect(d.totals[0]).toBeGreaterThan(d.totals[1]);
    expect(d.end).toMatchObject({ reason: "played", winner: 0 });
    expect(pokedleView(d, d.players[1].id, T0, 0)).toMatchObject({ status: "finished", round: undefined, next: undefined, totals: d.totals });
  });

  it("breaks a tie on points by fewer guesses, then by less time", () => {
    // Nobody solves anything: 0–0. Red made fewer guesses.
    const fewer = started("tie-seed");
    let d = fewer.duel;
    for (let i = 0; i < DLE_DUEL_ROUNDS; i++) d = playRound(d, [misses(d, 2), misses(d, DLE_MAX_GUESSES, 300)]);
    expect(d.totals).toEqual([0, 0]);
    expect(d.end).toMatchObject({ reason: "played", winner: 0 });

    // The same guesses, but Blue solves a millisecond sooner every round: the same points, Blue wins on time.
    const close = started("close-seed");
    d = close.duel;
    for (let i = 0; i < DLE_DUEL_ROUNDS; i++) {
      const start = d.rounds[i].startsAt;
      d = guessAll(d, close.blue, solveIn(d, 2, 300), start + SECOND);
      d = guessAll(d, close.red, solveIn(d, 2), start + SECOND + 1);
      if (d.status === "playing") d = pollUntil(d, d.rounds[i].result!.nextAt);
    }
    expect(d.totals[0]).toBe(d.totals[1]);
    expect(d.end).toMatchObject({ reason: "played", winner: 1 });

    // Level on everything: a draw.
    const level = started("level-seed");
    d = level.duel;
    for (let i = 0; i < DLE_DUEL_ROUNDS; i++) d = playRound(d, [misses(d, 3), misses(d, 3, 300)]);
    expect(d.end).toMatchObject({ reason: "played", winner: null });
  });
});

describe("pokédle duel: rounds and clock", () => {
  it("ends a round once both trainers have solved or run out of guesses", () => {
    const { duel, ids, start } = started();
    let d = guessAll(duel, ids[0], solveIn(duel, 2), start + SECOND);
    // Red solved quickly, but Blue still plays the round out.
    expect(d.rounds[0].result).toBeUndefined();
    d = guessAll(d, ids[1], misses(d, DLE_MAX_GUESSES - 1, 300), start + 10 * SECOND);
    expect(d.rounds[0].result).toBeUndefined();
    d = guessAll(d, ids[1], [secretOf(d)], start + 60 * SECOND);
    expect(d.rounds[0].result).toMatchObject({ timedOut: false, at: start + 60 * SECOND });
    expect(failure(guessPokedle(d, ids[1], 0, secretOf(d, 0), start + 61 * SECOND))?.error).toMatch(/round is over/);
    expect(lastResult(d).scores.map((s) => s.base)).toEqual([900, 300]);
  });

  it("closes a round after three minutes; a guess in flight at the bell still counts", () => {
    const { duel, ids, start } = started();
    const bell = start + DLE_DUEL_ROUND_MS;
    let d = guessAll(duel, ids[0], misses(duel, 2), start + SECOND);
    d = pollUntil(d, bell);
    expect(pokedleView(d, ids[0], bell - SECOND, 0).round!.endsAt).toBe(bell);
    // Blue's solve lands half a second after the bell: it counts (with no speed bonus left).
    const late = must(guessPokedle(d, ids[1], 0, secretOf(d), bell + 500));
    expect(late.rounds[0].result).toBeUndefined();
    const lateScores = pokedleView(pollUntil(late, bell + 2 * SECOND), ids[1], bell, 0).revealed[0].scores;
    expect(lateScores[1]).toMatchObject({ solved: true, base: 1000, speed: 0 });

    // Two seconds after the bell the round is over.
    d = pollUntil(d, bell + 2 * SECOND);
    expect(d.rounds[0].result).toMatchObject({ timedOut: true, at: bell + SECOND, points: [0, 0] });
    expect(failure(guessPokedle(d, ids[1], 0, secretOf(d, 0), bell + 2 * SECOND))?.status).toBe(409);
  });

  it("shows the reveal for 15 s, or until both trainers press Next", () => {
    const { duel, ids, start } = started();
    let d = guessAll(duel, ids[0], [secretOf(duel)], start + SECOND);
    d = guessAll(d, ids[1], [secretOf(d)], start + 2 * SECOND);
    const at = d.rounds[0].result!.at;
    expect(at).toBe(start + 2 * SECOND);
    expect(pokedleView(d, ids[0], at, 0).next).toEqual({ at: at + DLE_DUEL_REVEAL_MS, pressed: [false, false] });
    expect(pollUntil(d, at + DLE_DUEL_REVEAL_MS).rounds[1].startsAt).toBe(at + DLE_DUEL_REVEAL_MS + PVP_LEAD_MS);

    d = must(skipPokedleReveal(d, ids[0], 0, at + SECOND));
    expect(d.rounds).toHaveLength(1);
    d = must(skipPokedleReveal(d, ids[1], 0, at + 2 * SECOND));
    expect(d.rounds).toHaveLength(2);
    expect(d.rounds[1].startsAt).toBe(at + 2 * SECOND + PVP_LEAD_MS);
    // A late press for the old round is harmless.
    expect(must(skipPokedleReveal(d, ids[0], 0, at + 3 * SECOND)).rounds).toHaveLength(2);
  });

  it("forfeits a trainer who stops responding, or leaves", () => {
    const { duel, red, start } = started();
    let d = duel;
    for (let at = start; at < start + PVP_AWAY_MS + 10 * SECOND; at += 5 * SECOND) d = touchDuel(d, red, at);
    expect(d.end).toMatchObject({ reason: "left", winner: 0 });
    expect(pokedleView(d, red, start + PVP_AWAY_MS + 10 * SECOND, 0).end?.reason).toBe("left");
    expect(must(leaveDuel(duel, red, start + SECOND)).end).toMatchObject({ reason: "left", winner: 1 });
  });

  it("forfeits a trainer who sits out two rounds", () => {
    const { duel } = started();
    let d = duel;
    for (let i = 0; i < DLE_DUEL_IDLE_ROUNDS; i++) d = playRound(d, [misses(d, 2), []]);
    expect(d.end).toMatchObject({ reason: "idle", winner: 0 });
  });
});

describe("pokédle duel: security", () => {
  it("never shows the opponent's Pokémon or the secret before the round is over", () => {
    const { duel, red, blue, start } = started();
    const mine = misses(duel, 3, 1);
    let d = guessAll(duel, red, mine, start + SECOND);
    const secret = roundSecret(d, 0);
    for (const viewer of [blue, null]) {
      const view = pokedleView(d, viewer, start + 10 * SECOND, 0);
      const json = JSON.stringify(view);
      for (const id of mine) expect(json).not.toContain(getPokemon(id)!.name);
      expect(json).not.toContain(secret.name);
      expect(json).not.toContain(secret.genus);
      expect(json).not.toContain(d.seed);
      expect(json).not.toMatch(/"(id|secret|seed|seenAt|value|imageUrl|silhouetteUrl|genus)":/);
      expect(view.round!.rows).toEqual([]);
      expect(view.round!.boards[0].colours).toHaveLength(3);
    }
    // Red sees their own rows, with solo Pokédle's clues.
    expect(pokedleView(d, red, start + 10 * SECOND, 0).round!.rows).toEqual(mine.map((id) => compare(getPokemon(id)!, secret)));

    // Once the round is over, both boards and the answer are out.
    d = guessAll(d, red, [secretOf(d)], start + 20 * SECOND);
    d = guessAll(d, blue, [secretOf(d)], start + 21 * SECOND);
    const [round] = pokedleView(d, blue, start + 22 * SECOND, 0).revealed;
    expect(round.answer.name).toBe(secret.name);
    expect(round.boards[0].rows.map((r) => r.id)).toEqual([...mine, secret.id]);
  });

  it("rejects illegal moves", () => {
    const { duel, red, blue, start } = started();
    const s = secretOf(duel);
    expect(failure(guessPokedle(duel, red, 0, 25, start - SECOND))?.error).toMatch(/hasn't started/);
    const once = must(guessPokedle(duel, red, 0, misses(duel, 1)[0], start + SECOND));
    expect(failure(guessPokedle(once, red, 0, misses(duel, 1)[0], start + 2 * SECOND))?.error).toMatch(/already guessed/);
    expect(failure(guessPokedle(once, red, 0, 99_999, start + 2 * SECOND))?.status).toBe(400);
    expect(failure(guessPokedle(once, red, 1, s, start + 2 * SECOND))?.status).toBe(409);
    expect(failure(guessPokedle(once, "stranger", 0, s, start + 2 * SECOND))?.status).toBe(403);
    const solved = must(guessPokedle(once, red, 0, s, start + 2 * SECOND));
    expect(failure(guessPokedle(solved, red, 0, 1, start + 3 * SECOND))?.error).toMatch(/already solved/);
    const out = guessAll(duel, blue, misses(duel, DLE_MAX_GUESSES), start + SECOND);
    expect(failure(guessPokedle(out, blue, 0, s, start + 10 * SECOND))?.error).toMatch(/out of guesses/);
    // Seats are signed per duel, and a PokéGuessr seat isn't a Pokédle one.
    expect(readPvpToken(pvpToken("abcdefgh", blue), "abcdefgh")).toBe(blue);
    expect(readPvpToken(pvpToken("abcdefgh", blue), "hgfedcba")).toBeNull();
    expect(readPvpToken(duelToken("abcdefgh", blue), "abcdefgh")).toBeNull();
    expect(readDuelToken(pvpToken("abcdefgh", blue), "abcdefgh")).toBeNull();
    expect(readPvpToken("not-a-token", "abcdefgh")).toBeNull();
    // Joining a duel under way, readying up or changing generations mid-duel, guessing in the lobby.
    const joined = joinDuel(duel, "Green", start);
    expect(!joined.ok && joined.error).toMatch(/already started/);
    expect(failure(readyDuel(duel, red, false, start))?.status).toBe(409);
    expect(failure(setPokedleGens(duel, red, [1], start))?.status).toBe(409);
    const waiting = lobby();
    expect(failure(guessPokedle(waiting.duel, waiting.red, 0, s, T0 + 2 * SECOND))?.error).toMatch(/hasn't started/);
    // After the end.
    const over = must(leaveDuel(duel, blue, start + SECOND));
    expect(failure(guessPokedle(over, red, 0, s, start + 2 * SECOND))?.error).toMatch(/over/);
    expect(touchDuel(over, red, start + 60 * SECOND)).toEqual(over);
  });
});

describe("pokédle duel: lobby and rematch", () => {
  it("starts once both trainers are ready, and frees the seat of one who left", () => {
    const { duel, red, blue } = lobby();
    expect(pokedleView(duel, null, T0, 0)).toMatchObject({ kind: "pokedle", status: "lobby", you: null, players: [{ name: "Red" }, { name: "Blue" }] });
    let d = must(readyDuel(duel, red, true, T0 + 2 * SECOND));
    expect(d.status).toBe("lobby");
    d = must(readyDuel(d, blue, true, T0 + 3 * SECOND));
    expect(d.status).toBe("playing");
    expect(d.rounds[0].startsAt).toBe(T0 + 3 * SECOND + PVP_LEAD_MS);

    const left = touchDuel(duel, red, T0 + PVP_AWAY_MS + 5 * SECOND);
    expect(left.players.map((p) => p.name)).toEqual(["Red"]);
  });

  it("lets only the creator pick the generations, and shows both trainers the change", () => {
    const { duel, red, blue } = lobby();
    const t = T0 + 2 * SECOND;
    const ready = must(readyDuel(duel, blue, true, t));
    expect(failure(setPokedleGens(ready, blue, [1], t))?.status).toBe(403);
    let d = must(setPokedleGens(ready, red, [3, 1, 1], t));
    expect(d.gens).toEqual([1, 3]);
    // Blue was ready for every generation: they have to agree to the new ones.
    expect(d.players.map((p) => p.ready)).toEqual([false, false]);
    expect(pokedleView(d, blue, t, 0).gens).toEqual([1, 3]);
    // All nine is the same as no filter.
    d = must(setPokedleGens(d, red, [1, 2, 3, 4, 5, 6, 7, 8, 9], t));
    expect(d.gens).toBeUndefined();
  });

  it("opens a rematch with the same trainers and generations, and new secrets, once both press Rematch", () => {
    const { duel, red, blue, start } = started("rematch-seed", [1]);
    const over = must(leaveDuel(duel, blue, start + SECOND));
    const linked = linkRematch(over, "mnpqrstu");
    expect(linked.ok && linked.duel.rematch).toBe("mnpqrstu");
    const early = linkRematch(duel, "zzzzzzzz");
    expect(!early.ok && early.status).toBe(409);

    const t = start + 5 * SECOND;
    const next = rematchOf(over, "mnpqrstu", t);
    expect(next).toMatchObject({ kind: "pokedle", code: "mnpqrstu", status: "lobby", gens: [1], totals: [0, 0], rounds: [] });
    expect(next.players.map((p) => [p.id, p.ready])).toEqual([
      [red, false],
      [blue, false],
    ]);
    expect(next.seed).not.toBe(over.seed);
    let d = must(takeRematchSeat(next, red, "Red", t));
    expect(d.status).toBe("lobby");
    d = must(takeRematchSeat(d, blue, "Blue", t + SECOND));
    expect(d.status).toBe("playing");
    expect(failure(takeRematchSeat(d, "stranger", "Green", t + 2 * SECOND))?.status).toBe(409);
  });
});

describe("pokédle duel: store", () => {
  it("never loses a guess when both trainers guess at once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const { duel, red, blue } = started();
    const code = "pqrstuvw";
    expect(await pvpStore.insert({ ...duel, code })).toBe(true);
    expect(await pvpStore.insert({ ...duel, code })).toBe(false);
    vi.setSystemTime(duel.rounds[0].startsAt + SECOND);
    const [a, b] = misses(duel, 2);
    const [x, y] = await Promise.all([
      pvpStore.update(code, (d, now) => asKind(d, "pokedle", (p) => guessPokedle(p, red, 0, a, now))),
      pvpStore.update(code, (d, now) => asKind(d, "pokedle", (p) => guessPokedle(p, blue, 0, b, now))),
    ]);
    expect(x.ok && y.ok).toBe(true);
    // A quiz move on a Pokédle duel is refused.
    expect((await pvpStore.update(code, (d, now) => asKind(d, "quiz", (q) => answerQuiz(q, red, 0, "Pikachu", now)))).ok).toBe(false);
    const after = (await pvpStore.load(code))!;
    expect((after.duel as PokedleDuel).rounds[0].guesses.map((g) => g.map((v) => v.id))).toEqual([[a], [b]]);
    expect(after.version).toBe(2);
    expect(await pvpStore.save(after.duel, 1)).toBe(false);
  });
});
