import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import type { ModuleId } from "@/engines/types";
import { FORMATS } from "@/engines/types";
import { MODULE_INFO, PLAY_MODULES, QUIZ_PRESETS, filterFor } from "@/lib/modes";
import { PREFETCH_BUDGET, createQuizPrefetcher, prefetchKey } from "@/lib/quiz-prefetch";
import { quizTitle } from "@/lib/share/text";
import type { HeldStartResponse } from "@/lib/session-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, back() {}, refresh() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("not found");
  },
}));

const { beginHeld, gradeAnswer, holdSession, nextQuestion, readSession, startSession } = await import("@/lib/server/session");
const sessionRoute = await import("@/app/api/session/route");
const answerRoute = await import("@/app/api/session/answer/route");
const { QuizSetup } = await import("@/components/quiz/QuizSetup");
const { QuizDuelCard } = await import("@/components/quiz/QuizDuelCard");

let ip = 0;
function req(path: string, body: unknown) {
  const headers = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": `10.88.${Math.floor(++ip / 250)}.${ip % 250}` };
  return new NextRequest(`http://localhost:3000${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

const RUN = { module: "whos-that", format: "classic", difficulty: "medium" } as const;

/** A fake /api/session: holds and begins, counting what's asked. */
function fakeServer() {
  const calls: Record<string, unknown>[] = [];
  const post = vi.fn(async (body: object) => {
    const b = body as Record<string, unknown>;
    calls.push(b);
    if (b.hold) {
      const held: HeldStartResponse = { token: `held-${calls.length}`, sid: "s", rules: { questionMs: 15000, total: 10, runMs: null, lives: null } as never, lives: null, assets: { images: ["/img/1"], audio: [] } };
      return held;
    }
    if (b.begin) return { token: `run-of-${b.begin}`, question: { index: 0 } };
    throw new Error("unexpected");
  });
  return { post, calls };
}

describe("quiz prefetch (client): reuse when the settings match, a fresh start otherwise", () => {
  it("holds once for the settings on screen and begins that run on Start", async () => {
    const { post, calls } = fakeServer();
    const preload = vi.fn();
    const p = createQuizPrefetcher({ post, preload });
    expect(p.prefetch(RUN, "Ash")).toBe(true);
    expect(p.prefetch({ ...RUN })).toBe(false); // already held for these settings
    await Promise.resolve();
    await Promise.resolve();
    expect(preload).toHaveBeenCalledWith({ images: ["/img/1"], audio: [] });
    expect(calls).toEqual([{ ...RUN, name: "Ash", hold: true }]);

    const begun = await p.take({ ...RUN });
    expect(begun?.token).toBe("run-of-held-1");
    expect(calls[1]).toEqual({ begin: "held-1" });
    // A held run begins once: the next Start (Play again) starts fresh.
    expect(p.take(RUN)).toBeNull();
  });

  it("starts fresh when the settings changed since the hold, and matches gens in any order", async () => {
    const { post } = fakeServer();
    const p = createQuizPrefetcher({ post });
    p.prefetch({ ...RUN, gens: [3, 1] });
    expect(p.take({ ...RUN, format: "blitz", gens: [1, 3] })).toBeNull();
    p.prefetch({ ...RUN, gens: [3, 1] });
    expect(await p.take({ ...RUN, gens: [1, 3] })).not.toBeNull();
  });

  it("starts fresh when the hold failed or went stale", async () => {
    let t = 0;
    const failing = createQuizPrefetcher({ post: async () => Promise.reject(new Error("429")), now: () => t });
    failing.prefetch(RUN);
    expect(await failing.take(RUN)).toBeNull();

    const { post } = fakeServer();
    const p = createQuizPrefetcher({ post, now: () => t, ttlMs: 1000 });
    p.prefetch(RUN);
    t = 1500;
    expect(p.take(RUN)).toBeNull();
  });

  it("never prefetches a daily, a Zoom daily or a challenge", () => {
    const { post } = fakeServer();
    const p = createQuizPrefetcher({ post });
    for (const r of [{ daily: "2026-11-02" }, { zoomDaily: "2026-11-02" }, { challenge: "tok" }, { ...RUN, daily: "2026-11-02" }]) {
      expect(prefetchKey(r)).toBeNull();
      expect(p.prefetch(r)).toBe(false);
      expect(p.take(r)).toBeNull();
    }
    expect(post).not.toHaveBeenCalled();
  });

  it("asks for a few held runs per page view at most", () => {
    const { post } = fakeServer();
    const p = createQuizPrefetcher({ post });
    for (const format of ["classic", "survival", "blitz", "classic", "survival", "blitz"]) p.prefetch({ ...RUN, format });
    expect(post).toHaveBeenCalledTimes(PREFETCH_BUDGET);
    expect(p.used).toBe(PREFETCH_BUDGET);
  });
});

describe("held runs (server): no clock, no answer, no record until begun", () => {
  const spec = { module: "whos-that", format: "blitz", difficulty: "medium", seed: "held-seed" } as const;

  it("hands out question 1's media only, and begins with both clocks starting then", () => {
    const held = holdSession(spec);
    const json = JSON.stringify(held);
    expect(held).not.toHaveProperty("question");
    expect(json).not.toMatch(/"(answer|options|prompt)"/);
    expect(held.assets.images).toHaveLength(1);

    const state = readSession(held.token)!;
    expect(state.h).toBe(1);
    // Nothing can be answered before it begins.
    expect(gradeAnswer(state, "Pikachu")).toMatchObject({ ok: false, status: 409 });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 120_000); // the player waited two minutes on the setup screen
      const begun = beginHeld(state);
      expect(begun.ok).toBe(true);
      if (!begun.ok) return;
      const run = readSession(begun.response.token)!;
      expect(run.h).toBeUndefined();
      expect(run.paused).toBeUndefined();
      expect(run.startedAt).toBe(Date.now());
      expect(run.servedAt).toBe(Date.now());
      // The same question a plain start would serve, its picture the very link preloaded.
      expect(begun.response.question.prompt).toBe(startSession(spec).question.prompt);
      expect(begun.response.question.media?.url).toBe(held.assets.images[0]);
      expect(begun.claimKey).toBe(`next:${state.sid}:0`);
      // The begun token can't be begun again (or through /next).
      expect(beginHeld(run).ok).toBe(false);
      expect(nextQuestion(run).ok).toBe(false);

      vi.setSystemTime(Date.now() + 11 * 60_000);
      expect(beginHeld(state)).toMatchObject({ ok: false, status: 409 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("the route holds regular runs only and begins a held token once", async () => {
    const daily = await sessionRoute.POST(req("/api/session", { daily: "2026-11-02", hold: true }));
    expect(daily.status).toBe(400);
    expect(daily.headers.get("set-cookie") ?? "").toBe(""); // not counted as played
    expect((await sessionRoute.POST(req("/api/session", { zoomDaily: "2026-11-02", hold: true }))).status).toBe(400);

    const res = await sessionRoute.POST(req("/api/session", { ...RUN, hold: true }));
    expect(res.status).toBe(200);
    const held = (await res.json()) as HeldStartResponse;
    expect(held.assets.images.length).toBeGreaterThan(0);

    // The held token can't answer anything.
    expect((await answerRoute.POST(req("/api/session/answer", { token: held.token, choice: "Pikachu" }))).status).toBe(409);

    const first = await sessionRoute.POST(req("/api/session", { begin: held.token }));
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.question.index).toBe(0);
    expect(body.question.media.url).toBe(held.assets.images[0]);
    // Retrying the identical request replays the same response; nothing restarts the clock.
    const again = await (await sessionRoute.POST(req("/api/session", { begin: held.token }))).json();
    expect(again.token).toBe(body.token);
    expect((await sessionRoute.POST(req("/api/session", { begin: body.token }))).status).toBe(409);
  });
});

/** Difficulty words, outside the two modes that keep a choice. */
const LEVEL_WORDS = /\b(easy|medium|hard|easier|harder|hardest)\b/i;
const CHOICE_MODES: ModuleId[] = ["whose-team", "shiny"];

describe("no easy / medium / hard wording in quiz copy (except Whose Team and Real Shiny)", () => {
  it("mode info, presets and filter notes", () => {
    for (const m of PLAY_MODULES) {
      if (CHOICE_MODES.includes(m)) continue;
      const i = MODULE_INFO[m];
      for (const text of [i.title, i.tagline, i.description, filterFor(m).note ?? "", filterFor(m).label]) expect(text, m).not.toMatch(LEVEL_WORDS);
    }
    for (const p of QUIZ_PRESETS) {
      if (CHOICE_MODES.includes(p.module)) continue;
      for (const text of [p.title, p.h1, p.description]) expect(text, p.slug).not.toMatch(LEVEL_WORDS);
    }
  });

  it("the setup screen, duel card and share title", () => {
    for (const m of PLAY_MODULES) {
      if (CHOICE_MODES.includes(m)) continue;
      for (const difficulty of ["easy", "medium", "hard"] as const) {
        const html = renderToStaticMarkup(createElement(QuizSetup, { module: m, initialDifficulty: difficulty })) + renderToStaticMarkup(createElement(QuizDuelCard, { module: m, difficulty }));
        expect(html.replace(/<[^>]+>/g, " "), m).not.toMatch(LEVEL_WORDS);
        for (const format of FORMATS) if (format !== "adaptive") expect(quizTitle({ module: m, format, difficulty }), m).not.toMatch(LEVEL_WORDS);
      }
    }
    // An old Real Shiny run on Medium isn't named "Medium" either.
    expect(quizTitle({ module: "shiny", format: "classic", difficulty: "medium" })).not.toMatch(/medium/i);
  });
});
