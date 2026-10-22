import { describe, expect, it } from "vitest";
import { connectionsView, createConnectionsDuel, decidedAt, duelPuzzle, guessConnections, raceWinner, seatRace, type ConnectionsDuel, type SeatRace } from "@/lib/server/connections-duel";
import { duelView, joinDuel, leaveDuel, readyDuel, rematchOf, takeRematchSeat, touchDuel } from "@/lib/server/duels";
import type { PvpFailure, PvpOutcome } from "@/lib/server/duel-core";
import { matchSettingsSchema, queueKey } from "@/lib/server/matchmaking";
import { validatePuzzle } from "@/lib/connections/generator";
import { categoryOf } from "@/lib/connections/categories";
import { solveGrid } from "@/lib/connections/solver";
import { generatePuzzle } from "@/lib/connections/generator";
import { CONN_DUEL_MS, CONN_DUEL_PENALTY_MS, PVP_AWAY_MS, PVP_LEAD_MS, pvpHref } from "@/lib/pvp-types";
import { challengeHref } from "@/lib/community";

// The memory store, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const SECOND = 1000;

const must = (out: PvpOutcome<ConnectionsDuel>): ConnectionsDuel => {
  if (!out.ok) throw new Error(out.error);
  return out.duel;
};
const failure = (out: PvpOutcome<ConnectionsDuel>) => (out.ok ? null : (out as PvpFailure));

/** Red opens a race, Blue joins, both ready: the race starts after the lead-in. */
function started(seed = "race-seed") {
  const { duel, playerId: red } = createConnectionsDuel("Red", "abcdefgh", T0, seed);
  const joined = joinDuel(duel, "Blue", T0 + SECOND);
  if (!joined.ok) throw new Error(joined.error);
  const blue = joined.playerId;
  const t = T0 + 2 * SECOND;
  const d = must(readyDuel(must(readyDuel(joined.duel, red, true, t)), blue, true, t));
  const groups = duelPuzzle(d).groups.map((g) => g.members);
  return { duel: d, red, blue, start: t + PVP_LEAD_MS, groups };
}

/** Four tiles that aren't a group: two from each of two groups (never "one away"). */
const wrong = (g: number[][], a = 0, b = 1, k = 0) => [g[a][k], g[a][(k + 1) % 4], g[b][k], g[b][(k + 1) % 4]];
/** Three of one group and one of another. */
const oneAway = (g: number[][], a = 0, b = 1) => [...g[a].slice(0, 3), g[b][0]];

/** Both poll at `t` (so neither times out). */
const both = (d: ConnectionsDuel, t: number) => d.players.reduce((x, p) => touchDuel(x, p.id, t), d);

/** A guess at `t`, both trainers having polled until then. */
const guess = (d: ConnectionsDuel, id: string, ids: number[], t: number) => must(guessConnections(pollUntil(d, t), id, ids, t));

/** Both keep polling, every 5 s, until `t`. */
function pollUntil(d: ConnectionsDuel, t: number): ConnectionsDuel {
  for (let at = Math.max(...d.players.map((p) => p.seenAt)) + 5 * SECOND; at < t; at += 5 * SECOND) d = both(d, at);
  return both(d, t);
}

const race = (over: boolean, won: boolean, found: number, mistakes: number, doneAt?: number, score?: number, lastAt = 0): SeatRace => ({
  results: [],
  found: Array.from({ length: found }, (_, i) => i as 0),
  mistakes,
  over,
  won,
  out: over && !won,
  lastAt,
  ...(doneAt !== undefined && { doneAt }),
  ...(score !== undefined && { score }),
});

describe("the duel's puzzle", () => {
  it("comes from the practice generator, never the daily, and is fair", () => {
    const { duel } = started("abc");
    const p = duelPuzzle(duel);
    expect(validatePuzzle(p)).toEqual([]);
    expect(p).toEqual(generatePuzzle("duel:abc"));
    // Its own seed space: not the practice puzzle the same seed would give.
    expect(p).not.toEqual(generatePuzzle("practice:abc"));
  });

  it("can always be solved from the public data alone", () => {
    for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
      const p = generatePuzzle(`duel:${seed}`);
      const keys = (gs: number[][]) => gs.map((g) => [...g].sort((a, b) => a - b).join(",")).sort();
      const solutions = solveGrid(p.tiles);
      expect(solutions.map(keys), seed).toContainEqual(keys(p.groups.map((g) => g.members)));
    }
  });
});

describe("scoring and penalties", () => {
  it("a solve's score is its time plus 15 s a mistake", () => {
    const { duel, red, start, groups } = started();
    let d = must(guessConnections(duel, red, wrong(groups), start + 5 * SECOND));
    groups.forEach((g, i) => (d = must(guessConnections(d, red, g, start + (10 + i) * SECOND))));
    const r = seatRace(d, duelPuzzle(d), 0);
    expect(r.won).toBe(true);
    expect(r.mistakes).toBe(1);
    expect(r.score).toBe(13 * SECOND + CONN_DUEL_PENALTY_MS);
  });

  it("ranks a solve over no solve, then the lower score; else more groups, then fewer mistakes", () => {
    expect(raceWinner([race(true, true, 4, 3, 1, 100), race(false, false, 3, 0)])).toBe(0);
    expect(raceWinner([race(true, true, 4, 0, 1, 90), race(true, true, 4, 0, 1, 80)])).toBe(1);
    expect(raceWinner([race(true, true, 4, 0, 1, 80), race(true, true, 4, 0, 1, 80)])).toBeNull();
    expect(raceWinner([race(true, false, 1, 4), race(true, false, 2, 4)])).toBe(1);
    expect(raceWinner([race(false, false, 2, 1), race(true, false, 2, 4)])).toBe(0);
    expect(raceWinner([race(true, false, 2, 4), race(true, false, 2, 4)])).toBeNull();
  });
});

describe("end conditions", () => {
  it("a clean first solve wins on the spot: the other could only tie", () => {
    const { duel, red, blue, start, groups } = started();
    let d = must(guessConnections(duel, blue, groups[3], start + 2 * SECOND));
    groups.forEach((g, i) => (d = must(guessConnections(d, red, g, start + (20 + i) * SECOND))));
    expect(d.end).toEqual({ reason: "played", winner: 0, at: start + 23 * SECOND });
  });

  it("a solve with penalties leaves the other time to catch up, until they can't", () => {
    const { duel, red, start, groups } = started();
    let d = must(guessConnections(duel, red, wrong(groups), start + SECOND));
    groups.forEach((g, i) => (d = guess(d, red, g, start + (20 + i) * SECOND)));
    // Red: 23 s + 15 s = 38 s. Blue, clean so far, can still win until 38 s in.
    expect(d.status).toBe("playing");
    d = pollUntil(d, start + 37 * SECOND);
    expect(d.status).toBe("playing");
    d = pollUntil(d, start + 39 * SECOND);
    expect(d.end).toEqual({ reason: "played", winner: 0, at: start + 38 * SECOND });
  });

  it("the other's own mistakes bring that moment forward", () => {
    const { duel, red, blue, start, groups } = started();
    let d = must(guessConnections(duel, red, wrong(groups), start + SECOND));
    d = must(guessConnections(d, red, wrong(groups, 2, 3), start + 2 * SECOND));
    groups.forEach((g, i) => (d = guess(d, red, g, start + (40 + i) * SECOND)));
    // Red: 43 s + 30 s = 73 s. Blue has until 73 s, less 15 s for each mistake they make.
    d = guess(d, blue, wrong(groups, 0, 2), start + 50 * SECOND);
    expect(d.status).toBe("playing");
    d = guess(d, blue, wrong(groups, 1, 3), start + 51 * SECOND);
    // Two mistakes: 73 − 30 = 43 s, long gone, so it ends with that guess.
    expect(d.end).toEqual({ reason: "played", winner: 0, at: start + 51 * SECOND });
  });

  it("the other can still win in the penalty window", () => {
    const { duel, red, blue, start, groups } = started();
    let d = must(guessConnections(duel, red, wrong(groups), start + SECOND));
    groups.forEach((g, i) => (d = must(guessConnections(d, red, g, start + (20 + i) * SECOND))));
    groups.forEach((g, i) => (d = must(guessConnections(d, blue, g, start + (30 + i) * SECOND))));
    // Blue: 33 s, clean, beats Red's 38 s.
    expect(d.end).toEqual({ reason: "played", winner: 1, at: start + 33 * SECOND });
  });

  it("a faster but sloppier solve can lose", () => {
    const { duel, red, blue, start, groups } = started();
    let d = must(guessConnections(duel, red, wrong(groups), start + SECOND));
    d = must(guessConnections(d, red, wrong(groups, 2, 3), start + 2 * SECOND));
    groups.forEach((g, i) => (d = must(guessConnections(d, red, g, start + (10 + i) * SECOND))));
    // Red: 13 s + 30 s = 43 s. Blue, clean, at 30 s, wins.
    groups.forEach((g, i) => (d = must(guessConnections(d, blue, g, start + (27 + i) * SECOND))));
    expect(d.status).toBe("finished");
    expect(d.end?.winner).toBe(1);
    expect(connectionsView(d, red, start + 31 * SECOND, 1).boards.map((b) => b.score)).toEqual([43 * SECOND, 30 * SECOND]);
  });

  it("four mistakes and you're out; both out, more groups found wins", () => {
    const { duel, red, blue, start, groups } = started();
    let d = must(guessConnections(duel, red, groups[0], start + SECOND));
    for (let k = 0; k < 4; k++) d = must(guessConnections(d, red, wrong(groups, 1, 2, k), start + (2 + k) * SECOND));
    expect(failure(guessConnections(d, red, groups[1], start + 7 * SECOND))?.status).toBe(409);
    expect(d.status).toBe("playing");
    for (let k = 0; k < 4; k++) d = must(guessConnections(d, blue, wrong(groups, 0, 3, k), start + (10 + k) * SECOND));
    expect(d.end).toEqual({ reason: "played", winner: 0, at: start + 13 * SECOND });
  });

  it("once one is out, the other wins as soon as they've found more groups", () => {
    const { duel, red, blue, start, groups } = started();
    let d = duel;
    for (let k = 0; k < 4; k++) d = must(guessConnections(d, red, wrong(groups, 1, 2, k), start + (1 + k) * SECOND));
    expect(d.status).toBe("playing");
    d = must(guessConnections(d, blue, groups[2], start + 9 * SECOND));
    expect(d.end).toEqual({ reason: "played", winner: 1, at: start + 9 * SECOND });
  });

  it("the clock ends it after ten minutes", () => {
    const { duel, red, start, groups } = started();
    let d = must(guessConnections(duel, red, groups[1], start + SECOND));
    for (let t = start + 5 * SECOND; t < start + CONN_DUEL_MS; t += 5 * SECOND) d = both(d, t);
    expect(d.status).toBe("playing");
    d = both(d, start + CONN_DUEL_MS);
    expect(d.end).toEqual({ reason: "played", winner: 0, at: start + CONN_DUEL_MS });
  });

  it("decidedAt is open while nobody is done", () => {
    expect(decidedAt(0, [race(false, false, 2, 1), race(false, false, 3, 0)])).toBe(Infinity);
  });

  it("leaving forfeits, and going quiet does too", () => {
    const { duel, red, blue, start } = started();
    const left = must(leaveDuel(duel, red, start + SECOND));
    expect(left.end).toMatchObject({ reason: "left", winner: 1 });
    let d = touchDuel(duel, red, start + 20 * SECOND);
    d = touchDuel(d, red, start + PVP_AWAY_MS + 10 * SECOND);
    expect(d.end).toMatchObject({ reason: "left", winner: 0 });
    expect(blue).toBeTruthy();
  });
});

describe("guesses are checked on the server", () => {
  it("refuses guesses before the start, repeats, bad picks and found groups", () => {
    const { duel, red, start, groups } = started();
    expect(failure(guessConnections(duel, red, groups[0], start - SECOND))?.error).toMatch(/hasn't started/);
    let d = must(guessConnections(duel, red, wrong(groups), start + SECOND));
    const repeat = failure(guessConnections(d, red, [...wrong(groups)].reverse(), start + 2 * SECOND));
    expect(repeat).toMatchObject({ status: 409, error: "Already guessed!" });
    expect(seatRace(d, duelPuzzle(d), 0).mistakes).toBe(1);
    expect(failure(guessConnections(d, red, [groups[0][0], groups[0][0], groups[0][1], groups[0][2]], start + 3 * SECOND))?.status).toBe(400);
    expect(failure(guessConnections(d, red, [...groups[0].slice(0, 3), 99999], start + 3 * SECOND))?.status).toBe(400);
    d = must(guessConnections(d, red, groups[0], start + 4 * SECOND));
    expect(failure(guessConnections(d, red, [groups[0][0], ...groups[1].slice(0, 3)], start + 5 * SECOND))?.status).toBe(400);
    d = must(guessConnections(d, red, oneAway(groups, 1, 2), start + 6 * SECOND));
    expect(seatRace(d, duelPuzzle(d), 0).results.map((r) => r.kind)).toEqual(["wrong", "correct", "one-away"]);
  });
});

describe("no answers before the end", () => {
  const leaks = (json: string, d: ConnectionsDuel, except: number[] = []) =>
    duelPuzzle(d).groups.some((g, lv) => !except.includes(lv) && (json.includes(`"${categoryOf(g.category).label}"`) || json.includes(categoryOf(g.category).rule)));

  it("the lobby and lead-in send no tiles; the race sends tiles but no groups", () => {
    const { duel, red, blue, start } = started();
    const lead = connectionsView(duel, red, start - SECOND, 1);
    expect(lead.tiles).toBeUndefined();
    const v = connectionsView(duel, blue, start + SECOND, 2);
    expect(v.tiles).toHaveLength(16);
    expect(v.reveal).toBeUndefined();
    expect(v.rows).toBeUndefined();
    expect(leaks(JSON.stringify(v), duel)).toBe(false);
  });

  it("you see your own found groups; your opponent sees their colours only", () => {
    const { duel, red, blue, start, groups } = started();
    const d = must(guessConnections(duel, red, groups[2], start + SECOND));
    const mine = connectionsView(d, red, start + 2 * SECOND, 3);
    expect(mine.mine?.found.map((g) => g.level)).toEqual([2]);
    expect(leaks(JSON.stringify(mine), d, [2])).toBe(false);
    const theirs = connectionsView(d, blue, start + 2 * SECOND, 3);
    const json = JSON.stringify(theirs);
    expect(theirs.boards[0]).toMatchObject({ found: [2], mistakes: 0, solved: false });
    expect(theirs.mine?.guesses).toEqual([]);
    expect(leaks(json, d)).toBe(false);
    // Nowhere does Blue's view say which Pokémon Red grouped.
    expect(json).not.toContain(JSON.stringify(groups[2]));
    // Visitors see the same colours.
    expect(leaks(JSON.stringify(duelView(d, null, start + 2 * SECOND, 3)), d)).toBe(false);
  });

  it("your solve or your loss doesn't reveal anything while your opponent is still racing", () => {
    const { duel, red, blue, start, groups } = started();
    let d = duel;
    for (let k = 0; k < 4; k++) d = must(guessConnections(d, red, wrong(groups, 0, 1, k), start + (1 + k) * SECOND));
    expect(d.status).toBe("playing");
    const out = connectionsView(d, red, start + 6 * SECOND, 4);
    expect(out.reveal).toBeUndefined();
    expect(leaks(JSON.stringify(out), d)).toBe(false);
    expect(blue).toBeTruthy();
  });

  it("after the end: every group explained, and both races as colours", () => {
    const { duel, red, blue, start, groups } = started();
    let d = must(guessConnections(duel, blue, wrong(groups), start + SECOND));
    groups.forEach((g, i) => (d = must(guessConnections(d, red, g, start + (2 + i) * SECOND))));
    d = both(d, start + 20 * SECOND);
    const v = connectionsView(d, blue, start + 20 * SECOND, 9);
    expect(v.status).toBe("finished");
    expect(v.reveal).toHaveLength(4);
    expect(v.rows).toEqual([[[0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3]], [[0, 0, 1, 1]]]);
  });
});

describe("rematches, matchmaking and challenges", () => {
  it("a rematch is a new race with the same trainers and a new puzzle", () => {
    const { duel, red, blue, start } = started();
    const done = must(leaveDuel(duel, blue, start + SECOND));
    const next = rematchOf(done, "bcdefghj", start + 2 * SECOND);
    expect(next.kind).toBe("connections");
    expect(next.seed).not.toBe(done.seed);
    expect(next.boards).toEqual([]);
    const both = must(takeRematchSeat(must(takeRematchSeat(next, red, "Red", start + 3 * SECOND)), blue, "Blue", start + 3 * SECOND));
    expect(both.status).toBe("playing");
    // Red won the first game (Blue's forfeit): the best-of-three carries on into game 2.
    expect(connectionsView(both, red, start + 3 * SECOND, 1).series).toMatchObject({ game: 2, wins: [1, 0] });
  });

  it("matchmaking has one PokéConnections queue, and challenges link to the race", () => {
    const s = matchSettingsSchema.parse({ game: "connections" });
    expect(queueKey(s)).toBe("connections");
    expect(pvpHref("connections", "abcdefgh")).toBe("/connections/duel/abcdefgh");
    expect(challengeHref("connections", "abcdefgh")).toBe("/connections/duel/abcdefgh");
  });
});
