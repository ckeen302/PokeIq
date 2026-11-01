import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { DIFFICULTIES, type ModuleId } from "@/engines/types";
import { FIXED_DIFFICULTY, GEN_FILTER, MODULE_INFO, PLAY_MODULES, QUIZ_PRESETS, difficultiesFor, difficultyLabel, filterFor, playDifficulty } from "@/lib/modes";
import { neaBests, quizBests } from "@/lib/quiz-bests";
import type { PublicUser } from "@/lib/server/accounts";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const ash: PublicUser = { id: "00000000-0000-0000-0000-000000000001", username: "Ash", createdAt: "2026-01-01T00:00:00Z" };
vi.mock("@/lib/server/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/server/auth")>();
  return {
    ...real,
    sessionTokenHash: (r: NextRequest) => r.headers.get("x-test-user"),
    userFromRequest: async (r: NextRequest) => (r.headers.get("x-test-user") === "Ash" ? ash : null),
  };
});

// Client components render here without an app router mounted.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, back() {}, refresh() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("not found");
  },
}));

const { readSession } = await import("@/lib/server/session");
const sessionRoute = await import("@/app/api/session/route");
const duelRoute = await import("@/app/api/duel/route");
const leaderboardRoute = await import("@/app/api/leaderboard/route");
const neaResultRoute = await import("@/app/api/name-em-all/result/route");
const { clearMemoryNea, memoryNeaStore, neaPlayerKey, neaStartToken } = await import("@/lib/server/name-em-all-board");
const { fromQuery } = await import("@/app/quiz/[slug]/QuizSetupFromQuery");
const { QuizSetup } = await import("@/components/quiz/QuizSetup");
const { QuizDuelCard } = await import("@/components/quiz/QuizDuelCard");
const { QuizBests } = await import("@/components/community/QuizBests");

const CHOICE_MODES: ModuleId[] = ["whose-team", "shiny"];
const FIXED_MODES = PLAY_MODULES.filter((m) => !CHOICE_MODES.includes(m));

let ip = 0;
function req(path: string, body?: unknown, as?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": `10.77.${Math.floor(++ip / 250)}.${ip % 250}` };
  if (as) headers["x-test-user"] = as;
  return new NextRequest(`http://localhost:3000${path}`, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
}

describe("quiz difficulty: one fixed tuning, except Whose Team and Real Shiny", () => {
  it("only Whose Team Is This? (Normal / Hard) and Real Shiny? (Easy / Hard) offer a choice", () => {
    for (const m of FIXED_MODES) expect(difficultiesFor(m), m).toEqual([]);
    expect(difficultiesFor("whose-team").map((d) => [d.id, d.label])).toEqual([["medium", "Normal"], ["hard", "Hard"]]);
    expect(difficultiesFor("shiny").map((d) => [d.id, d.label])).toEqual([["easy", "Easy"], ["hard", "Hard"]]);
  });

  it("plays the fixed tuning for any old or odd difficulty, and keeps a valid choice where there is one", () => {
    expect(FIXED_DIFFICULTY).toBe("medium");
    for (const m of FIXED_MODES) for (const asked of [...DIFFICULTIES, undefined, "", "insane", 3]) expect(playDifficulty(m, asked), `${m} ${asked}`).toBe("medium");
    expect(playDifficulty("whose-team", "hard")).toBe("hard");
    expect(playDifficulty("whose-team", "easy")).toBe("medium");
    expect(playDifficulty("whose-team", undefined)).toBe("medium");
    expect(playDifficulty("shiny", "hard")).toBe("hard");
    // Real Shiny's old Normal (medium) links land on Easy, its default.
    expect(playDifficulty("shiny", "medium")).toBe("easy");
    expect(playDifficulty("shiny", "nope")).toBe("easy");
  });

  it("names a difficulty only where it is a choice", () => {
    expect(difficultyLabel("whos-that", "hard")).toBeNull();
    expect(difficultyLabel("whose-team", "medium")).toBe("Normal");
    expect(difficultyLabel("shiny", "hard")).toBe("Hard");
  });

  it("shows no difficulty picker on the setup screen or the duel card for a fixed mode, even from an old ?difficulty= link", () => {
    for (const m of FIXED_MODES) {
      for (const html of [
        renderToStaticMarkup(createElement(QuizSetup, { module: m, initialDifficulty: "hard" })),
        renderToStaticMarkup(createElement(QuizDuelCard, { module: m, difficulty: "hard" })),
      ]) {
        expect(html, m).not.toMatch(/>Difficulty</);
        expect(html, m).not.toMatch(/quiz-difficulty|Duel difficulty/);
      }
      // Formats and the generation filter stay.
      const setup = renderToStaticMarkup(createElement(QuizSetup, { module: m }));
      for (const f of ["Classic", "Survival", "Blitz"]) expect(setup).toContain(f);
      expect(setup).toContain(filterFor(m).label);
    }
  });

  it("keeps the two-way picker for Whose Team and Real Shiny, honouring an old link's choice", () => {
    const team = renderToStaticMarkup(createElement(QuizSetup, { module: "whose-team", initialDifficulty: "hard" }));
    expect(team).toContain('data-testid="quiz-difficulty"');
    expect(team).toMatch(/aria-pressed="true"[^>]*>.{0,200}Hard/);
    expect(team).toContain("Normal");
    const shiny = renderToStaticMarkup(createElement(QuizSetup, { module: "shiny", initialDifficulty: "medium" }));
    expect(shiny).toMatch(/aria-pressed="true"[^>]*>.{0,200}Easy/);
    expect(shiny).not.toMatch(/>Medium</i);
    expect(renderToStaticMarkup(createElement(QuizDuelCard, { module: "shiny" }))).toContain("Duel difficulty");
  });

  it("reads old links' query strings without choking on the difficulty", () => {
    expect(fromQuery("?difficulty=hard&format=blitz&gen=1,3", {})).toEqual({ format: "blitz", difficulty: "hard", gens: [1, 3] });
    expect(fromQuery("?difficulty=whatever", { format: "survival" })).toMatchObject({ format: "survival", difficulty: "whatever" });
  });

  it("no preset or description promises a difficulty a mode no longer has", () => {
    for (const p of QUIZ_PRESETS) {
      expect(p, p.slug).not.toHaveProperty("difficulty");
      expect(p.description, p.slug).not.toMatch(/three difficulties/i);
    }
    for (const m of FIXED_MODES) expect(MODULE_INFO[m].description, m).not.toMatch(/\b(hard|easy) (mode|fakes)\b/i);
    expect(GEN_FILTER.note).not.toMatch(/Easy|Hard|Medium/);
    for (const m of PLAY_MODULES) expect(filterFor(m).note ?? "", m).not.toMatch(/\b(Easy|Medium|Hard) uses\b|Every difficulty/);
  });
});

describe("old links and invites with a difficulty still start", () => {
  it("POST /api/session maps the difficulty instead of refusing it", async () => {
    const start = async (body: unknown) => {
      const res = await sessionRoute.POST(req("/api/session", body));
      expect(res.status).toBe(200);
      return readSession(((await res.json()) as { token: string }).token)!.spec;
    };
    expect((await start({ module: "whos-that", format: "classic", difficulty: "hard" })).difficulty).toBe("medium");
    expect((await start({ module: "higher-lower", format: "survival", difficulty: "easy" })).difficulty).toBe("medium");
    expect((await start({ module: "cry", format: "blitz", difficulty: "legendary" })).difficulty).toBe("medium");
    expect((await start({ module: "games", format: "classic" })).difficulty).toBe("medium");
    expect((await start({ module: "whose-team", format: "classic", difficulty: "hard" })).difficulty).toBe("hard");
    expect((await start({ module: "shiny", format: "classic", difficulty: "hard" })).difficulty).toBe("hard");
    expect((await start({ module: "shiny", format: "classic", difficulty: "medium" })).difficulty).toBe("easy");
  });

  it("POST /api/duel opens a quiz duel at the mode's difficulty", async () => {
    const open = async (body: Record<string, unknown>) => {
      const res = await duelRoute.POST(req("/api/duel", { kind: "quiz", name: "Red", ...body }));
      expect(res.status).toBe(200);
      return ((await res.json()) as { view: { module: string; difficulty: string } }).view;
    };
    expect(await open({ module: "types", difficulty: "hard" })).toMatchObject({ module: "types", difficulty: "medium" });
    expect(await open({ module: "dex", difficulty: "bogus" })).toMatchObject({ module: "dex", difficulty: "medium" });
    expect(await open({ module: "whose-team", difficulty: "hard" })).toMatchObject({ module: "whose-team", difficulty: "hard" });
  });
});

describe("quiz scores are off the leaderboard", () => {
  it("the leaderboard page has no quiz-mode tabs, and an old quiz board link shows the Daily", async () => {
    const { default: LeaderboardPage } = await import("@/app/leaderboard/page");
    for (const board of ["whos-that", "shiny", "whose-team", undefined]) {
      const html = renderToStaticMarkup(await LeaderboardPage({ searchParams: Promise.resolve({ board, format: "blitz", difficulty: "hard" } as { board?: string }) }));
      const tabs = html.slice(html.indexOf('data-testid="leaderboard-tabs"'), html.indexOf("Daily Challenge #"));
      for (const m of PLAY_MODULES) {
        expect(html).not.toContain(`/leaderboard?board=${m}"`);
        expect(tabs).not.toContain(`>${MODULE_INFO[m].title.replace("'", "&#x27;")}<`);
      }
      expect(html).not.toContain("All-generation runs only");
      expect(html).toContain("Daily Challenge #");
      // The other games keep their boards.
      for (const b of ["daily", "iq", "geo", "pokedle", "connections", "battle"]) expect(tabs).toContain(`board=${b}"`);
    }
  });

  it("the leaderboard API serves no quiz board and takes no quiz-mode run", async () => {
    const res = await leaderboardRoute.GET(req("/api/leaderboard?module=whos-that&format=classic&difficulty=medium"));
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ entries: [] });
  });

  it("Name 'em All has no leaderboard route any more", async () => {
    await expect(import("@/app/api/name-em-all/leaderboard/route" as string)).rejects.toThrow();
  });
});

describe("quiz personal bests on the profile", () => {
  beforeEach(() => clearMemoryNea());

  it("takes the Quizzes tab's bests per mode and format from the trainer's progress, nothing else", () => {
    const rows = quizBests({ "whos-that:classic": 1450, "whos-that:blitz": 3200, "shiny:survival": 900, "geo:kanto": 20000, "mixed:adaptive": 999, "cry:classic": "lots", "dex:blitz": 0 });
    expect(rows).toEqual([
      { module: "whos-that", scores: { classic: 1450, blitz: 3200 } },
      { module: "shiny", scores: { survival: 900 } },
    ]);
    expect(quizBests(null)).toEqual([]);
    expect(quizBests([1, 2])).toEqual([]);
  });

  it("keeps a signed-in trainer's checked Name 'em All run as their best, and reads it back for the profile", async () => {
    const scope = "ultra-beasts";
    const key = neaPlayerKey(`u:${ash.id}`);
    const t0 = Date.now() - 31_000;
    const named = Array.from({ length: 11 }, (_, i) => i);
    const times = named.map((i) => 2_000 + i * 2_000);
    const body = { scope, player: "browser-id-0123456789", token: neaStartToken(scope, key, t0), named, times, ms: 30_000 };
    const res = await neaResultRoute.POST(req("/api/name-em-all/result", body, "Ash"));
    const out = await res.json();
    expect(out, JSON.stringify(out)).toMatchObject({ saved: true, improved: true, counted: 11 });

    const mine = await memoryNeaStore().mine(key);
    const rows = neaBests(mine);
    expect(rows).toEqual([{ category: scope, label: expect.any(String), total: 11, count: { named: 11, ms: 22_000 }, clearMs: 22_000 }]);

    // Someone who isn't signed in is checked but not kept: there's no board to post to.
    const anon = await neaResultRoute.POST(req("/api/name-em-all/result", { ...body, token: neaStartToken(scope, neaPlayerKey("d:browser-id-0123456789"), t0) }));
    expect(await anon.json()).toMatchObject({ saved: false, signIn: true });
    expect(await memoryNeaStore().mine(neaPlayerKey("d:browser-id-0123456789"))).toEqual([]);
  });

  it("renders the bests table on the profile, with an empty state", () => {
    const html = renderToStaticMarkup(
      createElement(QuizBests, {
        username: "Ash",
        quiz: quizBests({ "whos-that:classic": 1450, "whose-team:blitz": 2100 }),
        nea: [{ category: "gen-1", label: "Gen 1", total: 151, count: { named: 120, ms: 600_000 }, clearMs: 800_000 }],
      })
    );
    expect(html).toContain('data-testid="profile-quiz-bests"');
    expect(html).toContain("Quiz personal bests");
    expect(html.match(/data-testid="profile-quiz-best"/g)).toHaveLength(2);
    expect(html).toContain("1,450");
    expect(html).toContain("2,100");
    expect(html).toContain("120/151");
    expect(html).toContain("13:20");
    expect(renderToStaticMarkup(createElement(QuizBests, { username: "Ash", quiz: [], nea: [] }))).toContain("hasn&#x27;t set a quiz best yet");
  });
});
