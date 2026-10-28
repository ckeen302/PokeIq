import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GEO_TIMER_GRACE_MS, answerFor, gradeGeo, planRounds, readGeo, startGeo } from "@/lib/server/geo";
import { signToken } from "@/lib/server/crypto";
import {
  clearMemoryRoundScores,
  flaggedFrom,
  flaggedPlayers,
  logRoundScore,
  memoryRoundScoreStore,
  roundFlag,
  supabaseRoundScoreStore,
  type RoundScoreStore,
} from "@/lib/server/geo-round-scores";
import { GEO_MAX_ROUND_SCORE, type GeoSpec } from "@/lib/geo-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
const guessRoute = await import("@/app/api/geo/guess/route");
const startRoute = await import("@/app/api/geo/route");

const kanto: GeoSpec = { region: "kanto", kind: "game" };
const T = Date.parse("2026-10-20T12:00:00Z");

/** The first round's true pin for a started game. */
function firstPin(spec: GeoSpec, token: string) {
  const state = readGeo(token)!;
  const [round] = planRounds(spec, state.seed, 1);
  const { pin } = answerFor(spec, round);
  return { state, pin, round };
}

const post = (url: string, body: unknown, cookie?: string) =>
  new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

describe("PokéGuessr guess rules", () => {
  it("grades each round exactly once: a second guess is a 409, an identical retry gets the same answer", async () => {
    const started = await startRoute.POST(post("/api/geo", { region: "kanto", kind: "game" }));
    expect(started.status).toBe(200);
    const { token } = (await started.json()) as { token: string };
    const first = await guessRoute.POST(post("/api/geo/guess", { token, x: 0.5, y: 0.5 }));
    expect(first.status).toBe(200);
    const body = (await first.json()) as { score: number; token: string; answer: { name: string } };
    expect(body.answer.name).toBeTruthy();
    // The same guess again (a lost response): the same grading, not a second one.
    const again = await guessRoute.POST(post("/api/geo/guess", { token, x: 0.5, y: 0.5 }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { score: number }).score).toBe(body.score);
    // A different pin on the already-guessed round: refused.
    const second = await guessRoute.POST(post("/api/geo/guess", { token, x: 0.2, y: 0.8 }));
    expect(second.status).toBe(409);
    // Guests get a device id for the round log, kept to the game's API.
    expect(first.headers.get("set-cookie")).toMatch(/piq_geo_id=[A-Za-z0-9_-]{12,}.*Path=\/api\/geo/);
    // The next round plays on from the new token.
    const next = await guessRoute.POST(post("/api/geo/guess", { token: body.token, x: 0.5, y: 0.5 }));
    expect(next.status).toBe(200);
  });

  it("keeps the Timer on the server: a pin after the clock and its grace scores nothing", () => {
    const start = startGeo(kanto, { timer: 30 });
    const { state, pin } = firstPin(kanto, start.token);
    expect(state.timer).toBe(30);
    expect(state.roundAt).toBe(state.startedAt);
    const at = (ms: number) => gradeGeo(state, { x: pin[0], y: pin[1] }, state.roundAt! + ms);
    const inTime = at(30_000 + GEO_TIMER_GRACE_MS - 1);
    if (!inTime.ok) throw new Error(inTime.error);
    expect(inTime.body.score).toBe(GEO_MAX_ROUND_SCORE);
    expect(inTime.body.late).toBeUndefined();
    const late = at(30_000 + GEO_TIMER_GRACE_MS + 1);
    if (!late.ok) throw new Error(late.error);
    expect(late.body).toMatchObject({ score: 0, timedOut: true, late: true, total: 0 });
    // The answer still comes back, and the game goes on to the next round, dealt now.
    expect(late.body.answer.name).toBeTruthy();
    expect(late.body.next).toBeTruthy();
    expect(readGeo(late.body.token)!.roundAt).toBe(state.roundAt! + 30_000 + GEO_TIMER_GRACE_MS + 1);
    // The clock running out with no pin is reported honestly at any time, and never counts as late.
    const timedOut = gradeGeo(state, { x: 0, y: 0, timeout: true }, state.roundAt! + 120_000);
    if (!timedOut.ok) throw new Error(timedOut.error);
    expect(timedOut.body).toMatchObject({ score: 0, timedOut: true });
    expect(timedOut.body.late).toBeUndefined();
    // "Guess the game too": no bonus on a late pin either.
    const bonus = startGeo({ ...kanto, guessGame: true }, { timer: 30 });
    const b = firstPin({ ...kanto, guessGame: true }, bonus.token);
    const lateBonus = gradeGeo(b.state, { x: b.pin[0], y: b.pin[1], family: answerFor(kanto, b.round).family }, b.state.roundAt! + 60_000);
    if (!lateBonus.ok) throw new Error(lateBonus.error);
    expect(lateBonus.body.gameGuess?.bonus).toBe(0);
  });

  it("without a timer a pin is graded whenever it comes, and old tokens without a round time still work", () => {
    const start = startGeo(kanto);
    const { state, pin } = firstPin(kanto, start.token);
    expect(state.timer).toBeUndefined();
    const slow = gradeGeo(state, { x: pin[0], y: pin[1] }, state.startedAt + 60 * 60_000);
    if (!slow.ok) throw new Error(slow.error);
    expect(slow.body.score).toBe(GEO_MAX_ROUND_SCORE);
    const { roundAt: _roundAt, ...legacy } = state;
    void _roundAt;
    const old = gradeGeo(readGeo(signToken("geo", legacy))!, { x: pin[0], y: pin[1] }, state.startedAt + 1000);
    if (!old.ok) throw new Error(old.error);
    expect(old.played.elapsedMs).toBe(1000);
  });

  it("the start API takes only the real timer settings", async () => {
    const bad = await startRoute.POST(post("/api/geo", { region: "kanto", kind: "game", timer: 7 }));
    expect(bad.status).toBe(400);
    const ok = await startRoute.POST(post("/api/geo", { region: "kanto", kind: "game", timer: 60 }));
    expect(ok.status).toBe(200);
    expect(readGeo(((await ok.json()) as { token: string }).token)!.timer).toBe(60);
  });

  it("grades a daily only on its day, so its answers come out only after a guess and only that day", () => {
    const daily: GeoSpec = { ...kanto, daily: "2026-10-20" };
    const start = startGeo(daily);
    expect(JSON.stringify(start.round)).not.toMatch(/name|pin|mask/);
    const { state, pin } = firstPin(daily, start.token);
    const onTheDay = gradeGeo(state, { x: pin[0], y: pin[1] }, T);
    if (!onTheDay.ok) throw new Error(onTheDay.error);
    expect(onTheDay.body.answer.name).toBeTruthy();
    // The day after, within the time-zone window, still counts; beyond it, the daily is closed.
    expect(gradeGeo(state, { x: pin[0], y: pin[1] }, T + 24 * 3_600_000).ok).toBe(true);
    const closed = gradeGeo(state, { x: pin[0], y: pin[1] }, T + 3 * 24 * 3_600_000);
    expect(closed).toMatchObject({ ok: false, status: 409 });
    const early = gradeGeo(state, { x: pin[0], y: pin[1] }, T - 3 * 24 * 3_600_000);
    expect(early).toMatchObject({ ok: false, status: 409 });
    // Free play has no such window.
    const free = firstPin(kanto, startGeo(kanto).token);
    expect(gradeGeo(free.state, { x: free.pin[0], y: free.pin[1] }, T + 30 * 24 * 3_600_000).ok).toBe(true);
  });
});

describe("PokéGuessr behaviour flags", () => {
  beforeEach(() => clearMemoryRoundScores());

  it("flags a pin within a few pixels under two seconds, notes a fast perfect, ignores the rest", () => {
    expect(roundFlag({ px: 1.5, elapsedMs: 900, perfect: true })).toBe(2);
    expect(roundFlag({ px: 3, elapsedMs: 1999, perfect: true })).toBe(2);
    expect(roundFlag({ px: 9, elapsedMs: 1200, perfect: true })).toBe(1);
    expect(roundFlag({ px: 1, elapsedMs: 2000, perfect: true })).toBe(0);
    expect(roundFlag({ px: 1, elapsedMs: 45_000, perfect: true })).toBe(0);
    expect(roundFlag({ px: 40, elapsedMs: 500, perfect: false })).toBe(0);
  });

  it("measures a graded round for the flags: pixels from the place and time since it was dealt", () => {
    const start = startGeo(kanto);
    const { state, pin } = firstPin(kanto, start.token);
    const quick = gradeGeo(state, { x: pin[0], y: pin[1] }, state.roundAt! + 800);
    if (!quick.ok) throw new Error(quick.error);
    expect(quick.played).toMatchObject({ elapsedMs: 800, perfect: true });
    expect(quick.played.px).toBeLessThanOrEqual(1);
    expect(roundFlag(quick.played)).toBe(2);
    const human = gradeGeo(state, { x: pin[0], y: pin[1] }, state.roundAt! + 12_000);
    if (!human.ok) throw new Error(human.error);
    expect(roundFlag(human.played)).toBe(0);
    const far = gradeGeo(state, { x: pin[0] > 0.5 ? 0 : 1, y: pin[1] > 0.5 ? 0 : 1 }, state.roundAt! + 500);
    if (!far.ok) throw new Error(far.error);
    expect(far.played.perfect).toBe(false);
    expect(far.played.px).toBeGreaterThan(50);
    expect(roundFlag(far.played)).toBe(0);
    // Nothing about the flags reaches the player.
    expect(JSON.stringify(quick.body)).not.toMatch(/px|elapsed|flag|suspicious/);
  });

  it("lists flagged trainers with counts across games, most flagged first", async () => {
    const store = memoryRoundScoreStore();
    const ash = { key: "k".repeat(20), name: "Ash" };
    const guest = { key: "g".repeat(20), name: null };
    const rows = [
      { shot: "shot0001", score: 5000, mode: "solo" as const, player: ash, game: "g1", elapsedMs: 700, flag: 2 as const },
      { shot: "shot0002", score: 5000, mode: "solo" as const, player: ash, game: "g2", elapsedMs: 1500, flag: 1 as const },
      { shot: "shot0003", score: 3000, mode: "daily" as const, player: ash, game: "g2", elapsedMs: 9000, flag: 0 as const },
      { shot: "shot0004", score: 5000, mode: "solo" as const, player: guest, game: "g3", elapsedMs: 1000, flag: 1 as const },
      { shot: "shot0005", score: 2000, mode: "solo" as const, player: { key: "h".repeat(20), name: "Misty" }, game: "g4", elapsedMs: 8000, flag: 0 as const },
      { shot: "shot0006", score: 2000, mode: "solo" as const, game: "g5", elapsedMs: 300, flag: 2 as const },
    ];
    for (const r of rows) await logRoundScore(r, store);
    const flagged = await flaggedPlayers(store);
    expect(flagged).toHaveLength(2);
    expect(flagged![0]).toMatchObject({ key: ash.key, name: "Ash", flagged: 1, fast: 2, games: 2, rounds: 3 });
    expect(flagged![1]).toMatchObject({ key: guest.key, name: null, flagged: 0, fast: 1, games: 1, rounds: 1 });
    expect(flagged![0].lastAt).toBeGreaterThan(0);
    // The pure aggregation sorts by flagged, then fast.
    const now = Date.now();
    const out = flaggedFrom([
      { shot: "a", score: 1, mode: "solo", player: { key: "one", name: null }, flag: 1, at: now },
      { shot: "b", score: 1, mode: "solo", player: { key: "two", name: "Two" }, flag: 2, at: now },
    ]);
    expect(out.map((p) => p.key)).toEqual(["two", "one"]);
  });

  it("logs the guess API's rounds with the player and flag", async () => {
    const started = await startRoute.POST(post("/api/geo", { region: "kanto", kind: "game" }));
    const { token } = (await started.json()) as { token: string };
    const { pin } = firstPin(kanto, token);
    const res = await guessRoute.POST(post("/api/geo/guess", { token, x: pin[0], y: pin[1] }, "piq_geo_id=device-for-tests-1"));
    expect(res.status).toBe(200);
    // The log is written off the response path.
    await new Promise((r) => setTimeout(r, 50));
    const flagged = await flaggedPlayers(memoryRoundScoreStore());
    expect(flagged).toHaveLength(1);
    expect(flagged![0]).toMatchObject({ name: null, flagged: 1, fast: 1, games: 1, rounds: 1 });
    expect(flagged![0].key).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(flagged![0].key).not.toContain("device-for-tests");
  });

  it("writes rows without the flag columns until migration 0045 is applied, and reads no flags before it", async () => {
    const inserted: Record<string, unknown>[] = [];
    let missing = true;
    const sb = {
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row);
          return missing && "flag" in row ? { error: { code: "PGRST204", message: "Could not find the 'flag' column of 'geo_round_scores' in the schema cache" } } : { error: null };
        },
        select: () => ({
          order: () => ({ order: () => ({ limit: async () => ({ data: null, error: table === "geo_flagged_players" ? { code: "42P01", message: "relation does not exist" } : null }) }) }),
          limit: async () => ({ data: [], error: null }),
        }),
      }),
    };
    const store: RoundScoreStore = supabaseRoundScoreStore(sb as unknown as Parameters<typeof supabaseRoundScoreStore>[0]);
    await logRoundScore({ shot: "shot0001", score: 4000, mode: "solo", player: { key: "k".repeat(20), name: "Ash" }, game: "g1", elapsedMs: 5000, flag: 0 }, store);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ shot_id: "shot0001", score: 4000, mode: "solo", player_name: "Ash", flag: 0, elapsed_ms: 5000 });
    expect(inserted[1]).toEqual({ shot_id: "shot0001", score: 4000, mode: "solo" });
    // The next rows go straight in without the columns (no second round trip each time).
    await logRoundScore({ shot: "shot0002", score: 1000, mode: "daily", flag: 1 }, store);
    expect(inserted).toHaveLength(3);
    expect(inserted[2]).toEqual({ shot_id: "shot0002", score: 1000, mode: "daily" });
    missing = false;
    expect(await flaggedPlayers(store)).toBeNull();
  });
});
