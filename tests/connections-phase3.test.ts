import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMemoryConnBoard, memoryConnBoard, startToken, timeFromStart } from "@/lib/server/connections-board";
import { clearMemoryConnResults, memoryConnStore, recordConnResult } from "@/lib/server/connections-results";
import { dailyConnPuzzle } from "@/lib/server/connections";
import { connDigest } from "@/lib/server/friends";
import { mergeProgress, normalizeProgress } from "@/lib/progress-merge";

// progress.ts persists to localStorage; give the node test env an in-memory one.
const ls = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => void ls.set(k, v),
  removeItem: (k: string) => void ls.delete(k),
});

const DATE = "2026-10-25";
const T = Date.parse(`${DATE}T12:00:00Z`);
const SECOND = 1000;
const groups = dailyConnPuzzle(DATE).groups.map((g) => g.members);
const [y, g, b, p] = groups;
const miss = [y[0], y[1], g[0], g[1]];
const miss2 = [b[0], b[1], p[0], p[1]];
const solve = (mistakes = 0) => [...[miss, miss2, [y[0], y[1], b[0], b[1]]].slice(0, mistakes), y, g, b, p];

/** A finished daily by `who`, dealt `ms` before it reached the server. */
function finish(who: string, mistakes: number, ms: number, name: string | null = who, board = memoryConnBoard()) {
  return recordConnResult({ date: DATE, identity: `d:${who}`, guesses: solve(mistakes), start: startToken(DATE, T - ms), name }, memoryConnStore(), T, board);
}

beforeEach(() => {
  clearMemoryConnBoard();
  clearMemoryConnResults();
  ls.clear();
});

describe("the daily leaderboard", () => {
  it("ranks fewest mistakes, then fastest, from the server's replay and clock", async () => {
    await finish("slow-perfect", 0, 300 * SECOND);
    await finish("fast-sloppy", 2, 40 * SECOND);
    await finish("fast-perfect", 0, 90 * SECOND);
    const top = await memoryConnBoard().top(DATE, 10);
    expect(top).toEqual([
      { name: "fast-perfect", mistakes: 0, ms: 90 * SECOND },
      { name: "slow-perfect", mistakes: 0, ms: 300 * SECOND },
      { name: "fast-sloppy", mistakes: 2, ms: 40 * SECOND },
    ]);
  });

  it("returns where you stand, keeps your first entry, and refuses a name someone has today", async () => {
    expect(await finish("alice", 1, 60 * SECOND)).toMatchObject({ ok: true, board: { position: 1, total: 1, name: "alice" } });
    expect(await finish("bob", 0, 120 * SECOND)).toMatchObject({ board: { position: 1, total: 2 } });
    // Alice again (a reload): still her first entry, now second.
    expect(await finish("alice", 0, 5 * SECOND)).toMatchObject({ board: { position: 2, total: 2 } });
    // Another trainer under Bob's name.
    expect(await finish("carol", 0, 10 * SECOND, "BOB")).toMatchObject({ board: { unranked: "name-taken" } });
  });

  it("ranks only solved games by named trainers with the server's start token", async () => {
    const lost = await recordConnResult({ date: DATE, identity: "d:x", guesses: [miss, miss2, [y[0], g[0], b[0], p[0]], [y[1], g[1], b[1], p[1]]], start: startToken(DATE, T - 5000), name: "x" }, memoryConnStore(), T, memoryConnBoard());
    expect(lost).toMatchObject({ ok: true, board: { unranked: "unsolved" } });
    expect(await finish("anon", 0, 30 * SECOND, null)).toMatchObject({ board: { unranked: "no-name" } });
    // No token, another day's, or a forged one: not timed, so not ranked.
    for (const start of [undefined, startToken("2026-10-24", T - 1000), "eyJkIjoiMjAyNi0xMC0yNSIsInQiOjB9.forged"]) {
      const out = await recordConnResult({ date: DATE, identity: "d:t", guesses: solve(), start, name: "t" }, memoryConnStore(), T, memoryConnBoard());
      expect(out).toMatchObject({ board: { unranked: "untimed" } });
    }
    expect(await memoryConnBoard().top(DATE, 10)).toEqual([]);
  });

  it("the time is the server's: from its token to now, nothing the client says", () => {
    expect(timeFromStart(startToken(DATE, T - 65 * SECOND), DATE, T)).toBe(65 * SECOND);
    expect(timeFromStart(startToken(DATE, T + SECOND), DATE, T)).toBeNull();
    expect(timeFromStart(startToken(DATE, T - 40 * 3600 * SECOND), DATE, T)).toBeNull();
  });

  it("without a board (no table yet) the game still records its stats", async () => {
    const out = await recordConnResult({ date: DATE, identity: "d:z", guesses: solve(), start: startToken(DATE, T - 1000), name: "z" }, memoryConnStore(), T, null);
    expect(out).toMatchObject({ ok: true, summary: { players: 1 }, board: { unranked: "off" } });
  });
});

describe("badges and tallies", () => {
  async function fresh() {
    vi.resetModules();
    return import("@/lib/progress");
  }

  it("a first solve, perfect solves, a Hard solve and duel wins earn their badges once", async () => {
    const prog = await fresh();
    const ids = (bs: { id: string }[]) => bs.map((x) => x.id);
    expect(ids(prog.saveConn(DATE, { guesses: solve(), solved: true, over: true, mistakes: 0 }))).toContain("conn-first");
    expect(ids(prog.recordConnGame(true, 0, true))).toEqual(["conn-hard"]);
    for (let i = 0; i < 7; i++) prog.recordConnGame(true, 0, false);
    expect(ids(prog.recordConnGame(true, 0, false))).toEqual(["conn-perfect-10"]);
    expect(prog.getProgress().connPlay).toMatchObject({ wins: 10, perfect: 10, hard: 1 });
    for (let i = 0; i < 9; i++) expect(prog.recordConnDuel(`abcdefg${"23456789a"[i]}`, "win")).toEqual([]);
    expect(ids(prog.recordConnDuel("abcdefgb", "win"))).toEqual(["conn-duel-10"]);
    // The same duel again (a reload) counts nothing.
    prog.recordConnDuel("abcdefgb", "win");
    prog.recordConnDuel("abcdefgc", "loss");
    expect(prog.getProgress().connPlay).toMatchObject({ duelWins: 10, duelLosses: 1 });
  });

  it("a 7-day streak earns its badge on the seventh day", async () => {
    const prog = await fresh();
    let earned: string[] = [];
    for (let d = 1; d <= 7; d++) {
      const date = `2026-11-0${d}`;
      earned = prog.saveConn(date, { guesses: [[1, 2, 3, 4]], solved: true, over: true, mistakes: 1 }).map((x) => x.id);
      if (d < 7) expect(earned).not.toContain("conn-streak-7");
    }
    expect(earned).toContain("conn-streak-7");
  });

  it("tallies sync: the larger side of each, counted duels unioned", () => {
    const base = normalizeProgress({ v: 1 })!;
    const a = normalizeProgress({ ...base, connPlay: { wins: 5, perfect: 2, hard: 0, duelWins: 1, duelLosses: 4, duelDraws: 0, duels: ["abcdefgh"] } })!;
    const bb = normalizeProgress({ ...base, connPlay: { wins: 3, perfect: 3, hard: 1, duelWins: "x", duels: ["bcdefghj", "not a code"] } })!;
    expect(bb.connPlay).toMatchObject({ wins: 3, duelWins: 0, duels: ["bcdefghj"] });
    expect(mergeProgress(a, bb).connPlay).toEqual({ wins: 5, perfect: 3, hard: 1, duelWins: 1, duelLosses: 4, duelDraws: 0, duels: ["bcdefghj", "abcdefgh"] });
  });
});

describe("the public profile", () => {
  it("reads PokéConnections from the synced progress, safely", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    const digest = { xp: 0, daily: null, dle: null, conn: { last: "2026-11-02", streak: 4, best: 9 }, connPlay: { wins: 12, perfect: 3, duelWins: 2, duelLosses: 1, duelDraws: 0 } };
    expect(connDigest(digest, now)).toEqual({ streak: 4, best: 9, wins: 12, perfect: 3, duelWins: 2, duelLosses: 1, duelDraws: 0 });
    // A streak whose last day is long gone is over.
    expect(connDigest({ ...digest, conn: { last: "2026-10-01", streak: 4, best: 9 } }, now)?.streak).toBe(0);
    expect(connDigest({ xp: 0, daily: null, dle: null }, now)).toBeNull();
    expect(connDigest({ xp: 0, daily: null, dle: null, connPlay: "junk" }, now)).toBeNull();
  });
});
