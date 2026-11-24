import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

// The memory stores (accounts, the round log), whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const { GEO_TIMER_GRACE_MS, answerFor, gradeGeo, pauseGeo, readGeo, resumeGeo, roundsOf, startGeo } = await import("@/lib/server/geo");
const { clearMemoryRoundScores } = await import("@/lib/server/geo-round-scores");
const { createSession, createUser, saveProgress } = await import("@/lib/server/accounts");
const { newSessionToken, newUserId } = await import("@/lib/server/auth");
const { resetRateLimits } = await import("@/lib/server/rate-limit");
const startRoute = await import("@/app/api/geo/route");
const guessRoute = await import("@/app/api/geo/guess/route");
const clockRoute = await import("@/app/api/geo/clock/route");
import { GEO_MAX_ROUND_SCORE, type GeoSpec } from "@/lib/geo-types";
import { currentGeoWeekly } from "@/lib/server/geo";

const T = Date.parse("2026-10-20T12:00:00Z");
const DATE = "2026-10-20";
const CLOCK = 90_000;

/** A browser: the cookies the API sets on it, sent back with each request. */
class Browser {
  jar = new Map<string, string>();
  constructor(readonly session?: string) {}
  async post(route: { POST: (r: NextRequest) => Promise<NextResponse> }, url: string, body: unknown) {
    const cookies = [...this.jar].map(([k, v]) => `${k}=${v}`);
    if (this.session) cookies.push(`pokeiq_session=${this.session}`);
    const res = await route.POST(
      new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookies.length ? { cookie: cookies.join("; ") } : {}) }, body: JSON.stringify(body) })
    );
    for (const c of res.cookies.getAll()) {
      if (c.value && c.maxAge !== 0) this.jar.set(c.name, c.value);
      else this.jar.delete(c.name);
    }
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  start(body: unknown) {
    return this.post(startRoute, "/api/geo", body);
  }
  clock(token: string, action: "pause" | "resume", left?: number) {
    return this.post(clockRoute, "/api/geo/clock", { token, action, ...(left !== undefined ? { left } : {}) });
  }
}

async function signedIn(): Promise<{ id: string; session: string }> {
  const id = newUserId();
  const created = await createUser({ id, username: `dl${id.slice(0, 8)}`, passwordHash: "none", recoveryCodeHash: null, createdAt: new Date().toISOString() });
  if (created === "taken") throw new Error("taken");
  const { token, tokenHash } = newSessionToken();
  await createSession(tokenHash, id, new Date(T + 30 * 86_400_000));
  return { id, session: token };
}

/** A game's current round, and the spot that scores it in full. */
function onTarget(token: string) {
  const state = readGeo(token)!;
  const round = roundsOf(state)[state.log.length];
  const answer = answerFor(state.spec, round);
  return { state, pin: answer.spot ?? answer.pin };
}

const at = (ms: number) => vi.setSystemTime(T + ms);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  resetRateLimits();
  clearMemoryRoundScores();
});
afterEach(() => vi.useRealTimers());

describe("the Daily is played once a day", () => {
  it("starts once per browser: a second start of the same day is refused, with a code the page shows today's result for", async () => {
    const browser = new Browser();
    const first = await browser.start({ daily: DATE });
    expect(first.status).toBe(200);
    expect(first.body.practice).toBeUndefined();
    expect(browser.jar.get("piq_geo_daily")).toBe(DATE);
    const again = await browser.start({ daily: DATE });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "daily-started", daily: DATE });
    expect(again.body.token).toBeUndefined();
    // Not as practice either, and not with a different body.
    expect((await browser.start({ daily: DATE, guessGame: true })).status).toBe(409);
    // Another browser (no cookie) has its own Daily; this browser can still play free games.
    expect((await new Browser().start({ daily: DATE })).status).toBe(200);
    expect((await browser.start({ region: "kanto", kind: "game" })).status).toBe(200);
  });

  it("goes on from the one start: the game's token is kept all day (no three-hour limit), so a game left part played can be finished", async () => {
    const browser = new Browser();
    const { body } = await browser.start({ daily: DATE });
    const token = body.token as string;
    const { pin } = onTarget(token);
    const guessed = await browser.post(guessRoute, "/api/geo/guess", { token, x: pin[0], y: pin[1] });
    expect(guessed.status).toBe(200);
    const next = guessed.body.token as string;
    // Five hours later, the same day: the game is still there to finish (a free game's token isn't).
    at(5 * 3_600_000);
    const free = startGeo({ region: "kanto", kind: "game" });
    at(10 * 3_600_000);
    expect(readGeo(free.token)).toBeNull();
    expect(readGeo(next)?.log).toEqual([guessed.body.score]);
    // Past the Daily's last day anywhere: gone.
    at(3 * 86_400_000);
    expect(readGeo(next)).toBeNull();
  });

  it("holds a signed-in trainer to it on any device: by the account's saved progress, and by its logged rounds", async () => {
    // Finished on another device: the account's progress has today's score.
    const done = await signedIn();
    await saveProgress(done.id, { v: 1, best: { [`geo-daily:${DATE}`]: 18_000 } });
    const refused = await new Browser(done.session).start({ daily: DATE });
    expect(refused).toMatchObject({ status: 409, body: { code: "daily-started" } });
    // Started on another device: a round graded there under the account.
    const player = await signedIn();
    const phone = new Browser(player.session);
    const { body } = await phone.start({ daily: DATE });
    const { pin } = onTarget(body.token as string);
    expect((await phone.post(guessRoute, "/api/geo/guess", { token: body.token, x: pin[0], y: pin[1] })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    const laptop = new Browser(player.session);
    expect((await laptop.start({ daily: DATE })).status).toBe(409);
    // A guest on a fresh browser plays, and so does an account with nothing on file.
    expect((await new Browser().start({ daily: DATE })).status).toBe(200);
    const fresh = await signedIn();
    expect((await new Browser(fresh.session).start({ daily: DATE })).status).toBe(200);
  });
});

describe("the Weekly follows the same rule", () => {
  it("starts once a week per browser, and not again for an account that finished it", async () => {
    // A Tuesday in the Weekly's second week.
    const tuesday = Date.parse("2026-11-03T12:00:00Z");
    vi.setSystemTime(tuesday);
    const weekly = currentGeoWeekly()!;
    expect(weekly.week).toBe("2026-11-02");
    const browser = new Browser();
    const first = await browser.start({ weekly: true });
    expect(first.status).toBe(200);
    expect(first.body.weekly).toBe(weekly.week);
    expect(await browser.start({ weekly: true })).toMatchObject({ status: 409, body: { code: "weekly-started", weekly: weekly.week } });
    const done = await signedIn();
    await saveProgress(done.id, { v: 1, best: { [`geo-weekly:${weekly.week}`]: 12_000 } });
    expect((await new Browser(done.session).start({ weekly: true })).status).toBe(409);
    // A Weekly left on its Tuesday is still there on Sunday, not once the next week's has begun (and its grace).
    const token = first.body.token as string;
    vi.setSystemTime(tuesday + 5 * 86_400_000);
    expect(readGeo(token)).not.toBeNull();
    vi.setSystemTime(tuesday + 7 * 86_400_000);
    expect(readGeo(token)).toBeNull();
  });
});

describe("leaving the Daily keeps the round and its time", () => {
  const daily: GeoSpec = { region: "kanto", kind: "game", daily: DATE };

  it("goes on with the time the clock showed, and a guess after the time away scores normally", () => {
    const { token } = startGeo(daily);
    const state = readGeo(token)!;
    expect(state.timer).toBe(90);
    // 40 s after the round was dealt (10 s reading the start, 30 s on the picture): 60 s on the player's clock.
    const pause = pauseGeo(state, 60_000, T + 40_000)!;
    expect(pause).toMatchObject({ sid: state.sid, round: 0, used: 40_000, left: 60_000, at: T + 40_000 });
    // Back two hours later: the clock shows 60 s, and the round's time moves on by the time away.
    const back = resumeGeo(state, pause, T + 2 * 3_600_000);
    expect(back.resumed).toBe(true);
    expect(back.left).toBe(60_000);
    const resumed = readGeo(back.token, T + 2 * 3_600_000)!;
    expect(resumed.roundAt).toBe(T + 2 * 3_600_000 - 40_000);
    // 50 s later the pin is in time and scores in full (without the pause it would be hours late).
    const { pin } = onTarget(back.token);
    const graded = gradeGeo(resumed, { x: pin[0], y: pin[1] }, T + 2 * 3_600_000 + 50_000);
    if (!graded.ok) throw new Error(graded.error);
    expect(graded.body.score).toBe(GEO_MAX_ROUND_SCORE);
    expect(graded.body.late).toBeUndefined();
    const stale = gradeGeo(state, { x: pin[0], y: pin[1] }, T + 2 * 3_600_000 + 50_000);
    expect(stale.ok && stale.body.late).toBe(true);
    // The time away isn't part of the game's time.
    expect(readGeo(graded.body.token, T + 2 * 3_600_000 + 50_000)!.paused).toBe(2 * 3_600_000 - 40_000);
    // Sent again soon after: the same round time, whichever token comes; later, the pause is spent.
    const again = resumeGeo(state, back.keep, T + 2 * 3_600_000 + 10_000);
    expect(readGeo(again.token, T + 2 * 3_600_000 + 10_000)!.roundAt).toBe(resumed.roundAt);
    expect(again.left).toBe(50_000);
    const same = resumeGeo(resumed, back.keep, T + 2 * 3_600_000 + 10_000);
    expect(readGeo(same.token, T + 2 * 3_600_000 + 10_000)).toMatchObject({ roundAt: resumed.roundAt, paused: resumed.paused });
    expect(resumeGeo(state, back.keep, T + 2 * 3_600_000 + 60_000)).toMatchObject({ resumed: false, keep: null, left: 0 });
  });

  it("never gives back more time than was left: the shown time is capped by the round's clock and the server's own count", () => {
    const { token } = startGeo(daily);
    const state = readGeo(token)!;
    // A made-up time over the round's clock: 1:30 at most.
    expect(pauseGeo(state, 10 * 60_000, T + 5_000)!.left).toBe(CLOCK);
    // The server's clock (deal time plus its grace) bounds it too: 4 min in, 30 s at most.
    expect(pauseGeo(state, CLOCK, T + 4 * 60_000)!.left).toBe(CLOCK + GEO_TIMER_GRACE_MS - 4 * 60_000);
    // Past it: nothing left, and it stays that way.
    const over = pauseGeo(state, CLOCK, T + 10 * 60_000)!;
    expect(over.left).toBe(0);
    expect(resumeGeo(state, over, T + 20 * 60_000).left).toBe(0);
    // Not stopped on the server (the pause never got there): its clock never stopped.
    const unpaused = resumeGeo(state, null, T + 60 * 60_000);
    expect(unpaused).toMatchObject({ resumed: false, left: 0 });
    expect(readGeo(unpaused.token, T + 60 * 60_000)!.roundAt).toBe(state.roundAt);
    expect(resumeGeo(state, null, T + 20_000).left).toBe(CLOCK);
    // Another game's or another round's pause doesn't move this one.
    const other = readGeo(startGeo(daily).token)!;
    expect(resumeGeo(other, pauseGeo(state, 60_000, T + 5_000), T + 60_000).resumed).toBe(false);
    // A free game isn't kept: nothing to stop.
    expect(pauseGeo(readGeo(startGeo({ region: "kanto", kind: "game" }, { timer: 60 }).token)!, 30_000, T + 5_000)).toBeNull();
  });

  it("keeps the pause in a cookie as the page goes, spends it on the way back, and a round already timed out stays timed out", async () => {
    const browser = new Browser();
    const { body } = await browser.start({ daily: DATE });
    const round1 = body.token as string;
    at(25_000);
    const paused = await browser.clock(round1, "pause", 70_000);
    expect(paused).toMatchObject({ status: 200, body: { paused: true, left: 70_000 } });
    expect(browser.jar.get("piq_geo_clock")).toBeTruthy();
    // Back ten hours later: the same round, 70 s on the clock; the pause is spent.
    at(10 * 3_600_000);
    const back = await browser.clock(round1, "resume");
    expect(back.body.left).toBe(70_000);
    const resumed = readGeo(back.body.token as string)!;
    expect(resumed.log).toEqual([]);
    expect(resumed.roundAt).toBe(T + 10 * 3_600_000 - 25_000);
    // The same resume again a moment later (its answer lost on the way): the same round time, not a second helping.
    at(10 * 3_600_000 + 5_000);
    const retry = await browser.clock(round1, "resume");
    expect(retry.body.left).toBe(65_000);
    expect(readGeo(retry.body.token as string)!.roundAt).toBe(resumed.roundAt);
    // A guess on it, in its time: graded normally.
    at(10 * 3_600_000 + 30_000);
    const { pin } = onTarget(back.body.token as string);
    const guessed = await browser.post(guessRoute, "/api/geo/guess", { token: back.body.token, x: pin[0], y: pin[1] });
    expect(guessed.body).toMatchObject({ score: GEO_MAX_ROUND_SCORE });
    expect(guessed.body.late).toBeUndefined();
    // Round 2, left 10 s in and picked up an hour later; then the same pause again: spent, so the hour counts.
    const round2 = guessed.body.token as string;
    at(10 * 3_600_000 + 40_000);
    expect((await browser.clock(round2, "pause", 80_000)).body.left).toBe(80_000);
    at(11 * 3_600_000);
    const back2 = await browser.clock(round2, "resume");
    expect(back2.body.left).toBe(80_000);
    at(12 * 3_600_000);
    expect((await browser.clock(round2, "resume")).body.left).toBe(0);
    // Its clock run out before the player left: it comes back at zero, and a pin then scores nothing.
    expect((await browser.clock(back2.body.token as string, "pause", 0)).body.left).toBe(0);
    at(13 * 3_600_000);
    const zero = await browser.clock(back2.body.token as string, "resume");
    expect(zero.body.left).toBe(0);
    // An older token (round 1, already played) never stops the game's clock in a later round's place.
    expect((await browser.clock(zero.body.token as string, "pause", 0)).body.paused).toBe(true);
    expect((await browser.clock(round1, "pause", 80_000)).body.paused).toBe(false);
    const late = onTarget(zero.body.token as string);
    const timedOut = await browser.post(guessRoute, "/api/geo/guess", { token: zero.body.token, x: late.pin[0], y: late.pin[1] });
    expect(timedOut.body).toMatchObject({ score: 0, timedOut: true, late: true });
    // Only the Daily and the Weekly are kept.
    const free = await browser.start({ region: "kanto", kind: "game", timer: 60 });
    expect((await browser.clock(free.body.token as string, "pause", 30_000)).status).toBe(400);
  });
});
