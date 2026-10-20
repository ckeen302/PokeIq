import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearMemoryResults,
  dailyPuzzle,
  dleDaySummary,
  isStatsDate,
  memoryResultStore,
  playerKey,
  recordDleResult,
  supabaseResultStore,
  type DleResultStore,
} from "@/lib/server/dle-results";
import { answerFor, hardModeError } from "@/lib/server/pokedle";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { DLE_MAX_GUESSES, type DleHint } from "@/lib/dle-types";
import { buildPokedleShare } from "@/lib/dle-share";
import {
  DLE_MIN_PLAYERS_FOR_PERCENTILE,
  averageGuesses,
  bucketOf,
  percentText,
  shareCommunity,
  standingOf,
  withYou,
  type DleDaySummary,
  type DlePersonal,
  type DleResultResponse,
  type DleStatsResponse,
} from "@/lib/dle-community";

// The memory store, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const TODAY = "2026-10-19";
const answerOn = (date: string) => answerFor(dailyPuzzle(date)).id;

/** `n` Pokémon that aren't the day's answer, starting from `from`. */
function misses(date: string, n: number, from = 1): number[] {
  const out: number[] = [];
  for (let id = from; out.length < n; id++) if (id !== answerOn(date)) out.push(id);
  return out;
}
/** Solving in `n`: n − 1 misses, then the answer. */
const solveIn = (date: string, n: number, from = 1) => [...misses(date, n - 1, from), answerOn(date)];

let store: DleResultStore;
beforeEach(() => {
  clearMemoryResults();
  store = memoryResultStore();
});

async function record(identity: string, guesses: number[], date = TODAY, extra: { hard?: boolean; hints?: DleHint[] } = {}) {
  const out = await recordDleResult({ date, identity, guesses, ...extra }, store, NOW);
  if (!out || !out.ok) throw new Error(out ? out.error : "stats off");
  return out.you;
}

describe("pokédle results: recording", () => {
  it("plays the guesses again rather than taking the client's word", async () => {
    const you = await record("d:alpha-device-0001", solveIn(TODAY, 3, 10));
    expect(you).toMatchObject({ recorded: true, guesses: 3, solved: true, position: 1, rank: 1, sameOpener: 1 });
    expect(you.firstGuess.id).toBe(misses(TODAY, 1, 10)[0]);
    expect(you.firstGuess.name).toBe(POKEDEX.find((p) => p.id === you.firstGuess.id)!.name);

    // Guesses after the solve, repeats and unknown Pokémon don't count, as in the game itself.
    const [a, b] = misses(TODAY, 2, 40);
    const padded = await record("d:bravo-device-0002", [a, a, 99_999, b, answerOn(TODAY), 1, 2, 3]);
    expect(padded).toMatchObject({ guesses: 3, solved: true, rank: 2 });

    // Eight misses: a loss, whatever the client might claim.
    const lost = await record("d:charlie-device-03", misses(TODAY, DLE_MAX_GUESSES, 200));
    expect(lost).toMatchObject({ guesses: DLE_MAX_GUESSES, solved: false, rank: null, position: 3 });
  });

  it("only takes a finished daily: not half a game, not another day", async () => {
    const unfinished = await recordDleResult({ date: TODAY, identity: "d:delta-device-0004", guesses: misses(TODAY, 3) }, store, NOW);
    expect(unfinished).toMatchObject({ ok: false, status: 409 });
    // Yesterday (and tomorrow) can be someone's today; earlier days are the archive's.
    expect((await recordDleResult({ date: "2026-10-18", identity: "d:x-device-00000001", guesses: solveIn("2026-10-18", 2) }, store, NOW))?.ok).toBe(true);
    expect((await recordDleResult({ date: "2026-10-20", identity: "d:x-device-00000001", guesses: solveIn("2026-10-20", 2) }, store, NOW))?.ok).toBe(true);
    for (const date of ["2026-10-17", "2026-10-21", "2026-02-30", "practice:abcd", ""]) {
      expect(await recordDleResult({ date, identity: "d:x-device-00000001", guesses: [1] }, store, NOW)).toMatchObject({ ok: false, status: 400 });
    }
    expect((await dleDaySummary(TODAY, store))!.players).toBe(0);
  });

  it("keeps the first result per trainer and day; sending it again returns that one", async () => {
    const first = await record("d:echo-device-00005", solveIn(TODAY, 5));
    const again = await record("d:echo-device-00005", solveIn(TODAY, 1));
    expect(again).toEqual({ ...first, recorded: false });
    expect((await dleDaySummary(TODAY, store))!).toMatchObject({ players: 1, solved: 1 });
    // A new day is a new result.
    expect((await record("d:echo-device-00005", solveIn("2026-10-18", 1), "2026-10-18")).recorded).toBe(true);
  });

  it("counts a signed-in trainer as their account, and stores only a key", () => {
    expect(playerKey("d:foxtrot-device-06")).toBe(playerKey("d:foxtrot-device-06"));
    expect(playerKey("d:foxtrot-device-06")).not.toBe(playerKey("u:foxtrot-device-06"));
    expect(playerKey("d:foxtrot-device-06")).not.toContain("foxtrot");
    expect(playerKey("u:1234")).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it("ranks solvers in the order they finished, and counts shared openers", async () => {
    const opener = 25;
    const pika = (n: number, from: number) => [opener, ...solveIn(TODAY, n - 1, from)];
    const a = await record("d:trainer-aaaa-0001", pika(4, 100));
    const b = await record("d:trainer-bbbb-0002", [opener, ...misses(TODAY, DLE_MAX_GUESSES - 1, 300)]);
    const c = await record("d:trainer-cccc-0003", solveIn(TODAY, 2, 500));
    const d = await record("d:trainer-dddd-0004", pika(3, 700));
    expect([a, b, c, d].map((y) => [y.position, y.rank])).toEqual([
      [1, 1],
      [2, null],
      [3, 2],
      [4, 3],
    ]);
    expect(d.sameOpener).toBe(3);
    expect(c.sameOpener).toBe(1);
  });

  it("records the hints used, and hard mode only when every guess fitted", async () => {
    const rows: { hard: boolean; hints: number }[] = [];
    const spy: DleResultStore = {
      async record(row) {
        rows.push({ hard: row.hard, hints: row.hints });
        return store.record(row);
      },
      summary: (date) => store.summary(date),
    };
    const go = (identity: string, guesses: number[], extra: { hard?: boolean; hints?: DleHint[] } = {}) =>
      recordDleResult({ date: TODAY, identity, guesses, ...extra }, spy, NOW);
    await go("d:hint-test-000001", solveIn(TODAY, 2));
    await go("d:hint-test-000002", solveIn(TODAY, 5), { hints: ["silhouette"] });
    await go("d:hint-test-000003", solveIn(TODAY, 7), { hints: ["genus", "silhouette", "genus"] });
    // A first-guess solve fits hard mode by definition.
    await go("d:hint-test-000004", [answerOn(TODAY)], { hard: true });
    // Guesses that ignore the clues before them aren't hard mode, whatever the client says.
    const sloppy = misses(TODAY, 2, 1);
    expect(hardModeError(dailyPuzzle(TODAY), [...sloppy, answerOn(TODAY)])).not.toBeNull();
    await go("d:hint-test-000005", [...sloppy, answerOn(TODAY)], { hard: true });
    expect(rows).toEqual([
      { hard: false, hints: 0 },
      { hard: false, hints: 1 },
      { hard: false, hints: 2 },
      { hard: true, hints: 0 },
      { hard: false, hints: 0 },
    ]);
  });
});

describe("pokédle results: the day's totals", () => {
  it("adds up trainers, the guess distribution and the top openers", async () => {
    await record("d:sum-trainer-0001", solveIn(TODAY, 3, 1));
    await record("d:sum-trainer-0002", solveIn(TODAY, 3, 1));
    await record("d:sum-trainer-0003", solveIn(TODAY, 1));
    await record("d:sum-trainer-0004", misses(TODAY, DLE_MAX_GUESSES, 50));
    const s = (await dleDaySummary(TODAY, store))!;
    expect(s).toMatchObject({ date: TODAY, players: 4, solved: 3, failed: 1 });
    expect(s.dist).toEqual([1, 0, 2, 0, 0, 0, 0, 0]);
    expect(s.openers[0]).toMatchObject({ id: misses(TODAY, 1, 1)[0], count: 2 });
    expect(s.openers.map((o) => o.count)).toEqual([2, 1, 1]);
    expect(averageGuesses(s)).toBeCloseTo(7 / 3);
    // Another day is separate.
    expect((await dleDaySummary("2026-10-18", store))!.players).toBe(0);
  });

  it("is off without a store, or before the table exists", async () => {
    expect(await dleDaySummary(TODAY, null)).toBeNull();
    expect(await recordDleResult({ date: TODAY, identity: "d:no-store-000001", guesses: solveIn(TODAY, 2) }, null, NOW)).toBeNull();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.dle_day_summary" } }));
    const missing = supabaseResultStore({ rpc } as unknown as SupabaseClient);
    expect(await dleDaySummary(TODAY, missing)).toBeNull();
    expect(await recordDleResult({ date: TODAY, identity: "d:no-table-000001", guesses: solveIn(TODAY, 2) }, missing, NOW)).toBeNull();
    // It doesn't ask again for a while, and says so once.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("reads the database functions' answers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 60_000); // past the "table missing" pause from the test before
    const rpc = vi.fn(async (fn: string) =>
      fn === "dle_day_summary"
        ? { data: { players: 3, solved: 2, solves: { "2": 1, "4": 1 }, openers: [[25, 2], [6, 1]] }, error: null }
        : { data: { recorded: true, guesses: 4, solved: true, first_guess: 25, position: "3", rank: "2", same_opener: "2" }, error: null }
    );
    const db = supabaseResultStore({ rpc } as unknown as SupabaseClient);
    expect(await dleDaySummary(TODAY, db)).toEqual({
      date: TODAY,
      players: 3,
      solved: 2,
      dist: [0, 1, 0, 1, 0, 0, 0, 0],
      failed: 1,
      openers: [
        { id: 25, name: "Pikachu", count: 2 },
        { id: 6, name: "Charizard", count: 1 },
      ],
    });
    const you = await recordDleResult({ date: TODAY, identity: "d:db-trainer-000001", guesses: solveIn(TODAY, 4) }, db, NOW);
    expect(you).toEqual({
      ok: true,
      you: { recorded: true, guesses: 4, solved: true, firstGuess: { id: 25, name: "Pikachu" }, position: 3, rank: 2, sameOpener: 2, assist: "notebook", score: 700 },
    });
    expect(rpc).toHaveBeenCalledWith("dle_record_result", expect.objectContaining({ p_date: TODAY, p_guesses: 4, p_solved: true, p_first: misses(TODAY, 1)[0] }));
    // Any other database error is an error, not "off".
    const broken = supabaseResultStore({ rpc: async () => ({ data: null, error: { code: "57014", message: "timeout" } }) } as unknown as SupabaseClient);
    await expect(dleDaySummary(TODAY, broken)).rejects.toThrow("timeout");
    vi.useRealTimers();
  });

  it("serves stats for days that have been out, never days to come", () => {
    expect(isStatsDate(TODAY, NOW)).toBe(true);
    expect(isStatsDate("2026-10-20", NOW)).toBe(true);
    expect(isStatsDate("2026-10-17", NOW)).toBe(true);
    for (const date of ["2026-10-21", "2026-10-16", "2026-13-01", "today", null, 20261019]) expect(isStatsDate(date, NOW)).toBe(false);
  });
});

describe("pokédle results: where you stand", () => {
  const summary = (dist: number[], failed: number): DleDaySummary => ({
    date: TODAY,
    players: dist.reduce((a, b) => a + b, 0) + failed,
    solved: dist.reduce((a, b) => a + b, 0),
    dist,
    failed,
    openers: [],
  });
  const you = (guesses: number, solved: boolean, position: number): DlePersonal => ({
    recorded: true,
    guesses,
    solved,
    firstGuess: { id: 25, name: "Pikachu" },
    position,
    rank: solved ? position : null,
    sameOpener: 1,
    assist: "notebook",
    score: 0,
  });

  it("puts solves by guess count in order, then misses", () => {
    expect(bucketOf({ guesses: 1, solved: true })).toBe(0);
    expect(bucketOf({ guesses: DLE_MAX_GUESSES, solved: true })).toBe(DLE_MAX_GUESSES - 1);
    expect(bucketOf({ guesses: DLE_MAX_GUESSES, solved: false })).toBe(DLE_MAX_GUESSES);
  });

  it("works out the share of trainers beaten or tied, and 'top N%' from it", () => {
    // 100 trainers: 10 in 2, 20 in 3, 40 in 4, 20 in 5, 10 missed.
    const s = summary([0, 10, 20, 40, 20, 0, 0, 0], 10);
    expect(standingOf(s, { guesses: 2, solved: true })).toEqual({ percentile: 100, top: 1, better: 0, same: 10, worse: 90 });
    expect(standingOf(s, { guesses: 4, solved: true })).toEqual({ percentile: 70, top: 30, better: 30, same: 40, worse: 30 });
    expect(standingOf(s, { guesses: 5, solved: true })).toEqual({ percentile: 30, top: 70, better: 70, same: 20, worse: 10 });
    expect(standingOf(s, { guesses: 8, solved: false })).toEqual({ percentile: 10, top: 90, better: 90, same: 10, worse: 0 });
    // Alone at the top of 4,213: "top 1%", never 0.
    const big = summary([1, 0, 0, 4212, 0, 0, 0, 0], 0);
    expect(standingOf(big, { guesses: 1, solved: true })).toMatchObject({ percentile: 100, top: 1 });
    // Rounded down, never flattering: 2 of 3 is 66, not 67.
    expect(standingOf(summary([0, 1, 1, 0, 0, 0, 0, 0], 1), { guesses: 3, solved: true })!.percentile).toBe(66);
    expect(standingOf(summary([0, 0, 0, 0, 0, 0, 0, 0], 0), { guesses: 3, solved: true })).toEqual({ percentile: 100, top: 1, better: 0, same: 1, worse: 0 });
  });

  it("adds your result to a summary cached from before you finished, once", () => {
    const s = summary([0, 1, 1, 0, 0, 0, 0, 0], 0); // 2 trainers
    const mine = you(3, true, 3); // you were the 3rd to finish: not in it yet
    const added = withYou(s, mine);
    expect(added).toMatchObject({ players: 3, solved: 3, dist: [0, 1, 2, 0, 0, 0, 0, 0], failed: 0 });
    expect(withYou(added, mine)).toBe(added);
    expect(withYou(s, you(8, false, 3))).toMatchObject({ players: 3, solved: 2, failed: 1 });
    // A fresher summary already has you.
    expect(withYou(summary([0, 1, 2, 0, 0, 0, 0, 0], 0), mine).players).toBe(3);
  });

  it("gives the share text { percentile, players } once enough trainers have finished", () => {
    const few = summary([0, 1, 2, 0, 0, 0, 0, 0], 0);
    expect(shareCommunity(few, you(2, true, 1))).toBeUndefined();
    const many = summary([0, 10, 20, 40, 20, 0, 0, 0], 10);
    expect(shareCommunity(many, you(3, true, 5))).toEqual({ percentile: 90, players: 100 });
    expect(DLE_MIN_PLAYERS_FOR_PERCENTILE).toBeLessThanOrEqual(100);
    // The share words it as the panel does.
    const text = buildPokedleShare({
      number: 3,
      rows: [["match", "match", "match", "match", "match", "match", "match"]],
      solved: true,
      hard: false,
      hints: [],
      streak: 0,
      url: "https://pokeiq.app/pokedle",
      community: shareCommunity(many, you(3, true, 5)),
    });
    expect(text).toContain(`Top ${standingOf(many, { guesses: 3, solved: true })!.top}% of 100 trainers`);
  });

  it("writes percentages people can read", () => {
    expect(percentText(0, 10)).toBe("0%");
    expect(percentText(1, 400)).toBe("<1%");
    expect(percentText(12, 100)).toBe("12%");
    expect(percentText(2, 3)).toBe("67%");
    expect(percentText(3, 0)).toBe("0%");
  });
});

describe("pokédle results: the endpoints", () => {
  const today = () => new Date().toISOString().slice(0, 10);
  const post = (body: unknown) =>
    new NextRequest("http://localhost/api/pokedle/result", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": "10.0.0.1" } });

  it("records with POST and serves the cached totals with GET", async () => {
    const { POST } = await import("@/app/api/pokedle/result/route");
    const { GET } = await import("@/app/api/pokedle/stats/route");
    const date = today();
    const guesses = solveIn(date, 2);

    const res = await POST(post({ date, player: "endpoint-device-0001", guesses }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as DleResultResponse;
    expect(body).toMatchObject({ available: true, you: { recorded: true, guesses: 2, solved: true, position: 1, rank: 1 } });
    // Nothing the client claims about the outcome is read.
    const forged = await POST(post({ date, player: "endpoint-device-0002", guesses: misses(date, 2), solved: true }));
    expect(forged.status).toBe(409);
    expect((await POST(post({ date, player: "bad id", guesses }))).status).toBe(400);

    const stats = await GET(new NextRequest(`http://localhost/api/pokedle/stats?date=${date}`));
    expect(stats.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    const totals = (await stats.json()) as DleStatsResponse;
    expect(totals).toMatchObject({ available: true, date, players: 1, solved: 1 });
    // The cached totals carry nothing about any one trainer.
    expect(JSON.stringify(totals)).not.toMatch(/position|rank|"player"|"you"|sameOpener/);
    expect((await GET(new NextRequest("http://localhost/api/pokedle/stats?date=2020-01-01"))).status).toBe(400);
  });
});
