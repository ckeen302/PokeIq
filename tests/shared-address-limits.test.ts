import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Work a route defers until after its response (calibration): run it straight away here.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));
import { CROWD_FACTOR, SHARED_ADDRESS_FACTOR, resetRateLimits } from "@/lib/server/rate-limit";
import { POST as startRun } from "@/app/api/session/route";
import { POST as answer } from "@/app/api/session/answer/route";
import { POST as nextQuestion } from "@/app/api/session/next/route";
import { POST as startGeo } from "@/app/api/geo/route";
import { POST as geoGuess } from "@/app/api/geo/guess/route";
import { POST as dleGuess } from "@/app/api/pokedle/route";
import { POST as dleResult } from "@/app/api/pokedle/result/route";
import { GET as connDaily, POST as connGuess } from "@/app/api/connections/route";
import { POST as connResult } from "@/app/api/connections/result/route";
import { GET as pdkDaily } from "@/app/api/pikadoku/route";
import { POST as pdkResult } from "@/app/api/pikadoku/result/route";

/**
 * A carrier's NAT: every phone on it reaches us from one address. 200 players
 * on it play at once without a single 429, and one client hammering is still
 * slowed, whether it reuses one run's token, has none, or forges one.
 */

const NAT = "100.64.7.7";
const BASE = "http://localhost:3000";
type Handler = (r: NextRequest) => Promise<Response>;

function req(path: string, body?: unknown, ip = NAT): NextRequest {
  return new NextRequest(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", origin: BASE, "x-forwarded-for": ip },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const today = () => new Date().toISOString().slice(0, 10);
const statuses: number[] = [];
const limited = new Map<string, number>();
async function call(handler: Handler, path: string, body?: unknown, ip?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await handler(req(path, body, ip));
  statuses.push(res.status);
  if (res.status === 429) limited.set(path.split("?")[0], (limited.get(path.split("?")[0]) ?? 0) + 1);
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** One player's game, a step at a time (each step: one round's requests). */
function* quizRun(): Generator<Promise<unknown>, void, unknown> {
  let started: { json: Record<string, unknown> } | null = null;
  yield call(startRun, "/api/session", { module: "whos-that", format: "classic" }).then((r) => (started = r));
  let token = started!.json.token as string;
  let question = started!.json.question as { options: string[] } | undefined;
  for (let i = 0; i < 5 && token && question; i++) {
    let graded: { json: Record<string, unknown> } | null = null;
    yield call(answer, "/api/session/answer", { token, choice: question.options[0] }).then((r) => (graded = r));
    token = graded!.json.token as string;
    let served: { json: Record<string, unknown> } | null = null;
    yield call(nextQuestion, "/api/session/next", { token }).then((r) => (served = r));
    token = served!.json.token as string;
    question = served!.json.question as { options: string[] } | undefined;
  }
}

function* guessrDaily(): Generator<Promise<unknown>, void, unknown> {
  let started: { json: Record<string, unknown> } | null = null;
  yield call(startGeo, "/api/geo", { daily: today() }).then((r) => (started = r));
  let token = started!.json.token as string;
  for (let round = 0; round < 5 && token; round++) {
    let graded: { json: Record<string, unknown> } | null = null;
    yield call(geoGuess, "/api/geo/guess", { token, x: 0.5, y: 0.5 }).then((r) => (graded = r));
    token = graded!.json.token as string;
  }
}

function* dailies(player: string): Generator<Promise<unknown>, void, unknown> {
  const guesses: number[] = [];
  for (const id of [25, 6, 150, 133, 94, 448]) {
    guesses.push(id);
    yield call(dleGuess, "/api/pokedle", { date: today(), guesses: [...guesses] });
  }
  yield call(dleResult, "/api/pokedle/result", { date: today(), player, guesses });
  let puzzle: { json: Record<string, unknown> } | null = null;
  yield call(connDaily, `/api/connections?date=${today()}`).then((r) => (puzzle = r));
  const ids = ((puzzle!.json.tiles as { id: number }[]) ?? []).map((t) => t.id);
  const tries = [ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 12), ids.slice(12, 16)];
  for (let n = 1; n <= 4; n++) yield call(connGuess, "/api/connections", { date: today(), guesses: tries.slice(0, n) });
  yield call(connResult, "/api/connections/result", { date: today(), player, guesses: tries, start: puzzle!.json.start });
  let grid: { json: Record<string, unknown> } | null = null;
  yield call(pdkDaily, `/api/pikadoku?date=${today()}`).then((r) => (grid = r));
  yield call(pdkResult, "/api/pikadoku/result", { date: today(), difficulty: "normal", guesses: [], giveUp: true, player, start: grid!.json.start });
}

describe("many players behind one address (carrier NAT)", () => {
  beforeEach(() => {
    resetRateLimits();
    statuses.length = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("200 players on one address play a quiz, the PokéGuessr Daily, Pokédle, Connections and Pikadoku without a 429", async () => {
    const players = Array.from({ length: 200 }, (_, i) => {
      const id = `natplayer${String(i).padStart(4, "0")}xxxxxx`;
      return [quizRun(), guessrDaily(), dailies(id)];
    }).flat();
    // Everyone takes a step together, then five seconds pass (reading the question, dropping a pin, typing a name), and again.
    let live = players;
    let steps = 0;
    while (live.length) {
      const next: typeof live = [];
      await Promise.all(
        live.map(async (game) => {
          const step = game.next();
          if (step.done) return;
          await step.value;
          next.push(game);
        })
      );
      live = next;
      steps++;
      vi.setSystemTime(Date.now() + 5_000);
    }
    expect(steps).toBeGreaterThan(10);
    expect(statuses.length).toBeGreaterThan(200 * 30);
    expect(Object.fromEntries(limited)).toEqual({});
    expect(statuses.filter((s) => s >= 500)).toHaveLength(0);
    // And they really played: nearly every request was answered 200 (the rest: a Pokédle result already in, a giving-up grid).
    expect(statuses.filter((s) => s === 200).length / statuses.length).toBeGreaterThan(0.9);
  }, 120_000);

  it("one client hammering with one run's token is slowed on its own allowance, and its neighbours aren't", async () => {
    const started = await call(startRun, "/api/session", { module: "whos-that", format: "classic" });
    const token = started.json.token as string;
    const out: number[] = [];
    for (let i = 0; i < 100; i++) out.push((await call(answer, "/api/session/answer", { token, choice: "Pikachu" })).status);
    // 60 at once per run (most are 409s: that question was answered), then 429.
    expect(out.slice(0, 60)).not.toContain(429);
    expect(out.slice(60)).toEqual(Array(40).fill(429));
    // Another player on the same address is unaffected.
    const other = await call(startRun, "/api/session", { module: "whos-that", format: "classic" });
    const q = other.json.question as { options: string[] };
    expect((await call(answer, "/api/session/answer", { token: other.json.token, choice: q.options[0] })).status).toBe(200);
  });

  it("a client with no token, or a forged one, gets the per-address limit", async () => {
    const forged: number[] = [];
    for (let i = 0; i < 70; i++) forged.push((await call(answer, "/api/session/answer", { token: `forged-token-${i}.abc`, choice: "x" })).status);
    expect(forged.slice(0, 60)).not.toContain(429);
    expect(forged.slice(60)).toEqual(Array(10).fill(429));
  });

  it("a flood of new games from one address is still walled off", async () => {
    const out: number[] = [];
    const cap = 30 * CROWD_FACTOR;
    for (let i = 0; i < cap + 20; i++) out.push((await call(startGeo, "/api/geo", {})).status);
    expect(out.slice(0, cap)).not.toContain(429);
    expect(out.slice(cap)).toEqual(Array(20).fill(429));
  });

  it("many runs' tokens from one address still share a ceiling", async () => {
    // A script starting runs to spend each one's allowance: the address stops it at the shared ceiling.
    const tokens: string[] = [];
    for (let i = 0; i < 50; i++) tokens.push((await call(startRun, "/api/session", { module: "whos-that", format: "classic" })).json.token as string);
    let limited = 0;
    let sent = 0;
    for (const token of tokens) {
      for (let i = 0; i < 60; i++, sent++) if ((await call(nextQuestion, "/api/session/next", { token })).status === 429) limited++;
    }
    expect(sent).toBe(3000);
    expect(sent - limited).toBe(60 * SHARED_ADDRESS_FACTOR);
  });
});
