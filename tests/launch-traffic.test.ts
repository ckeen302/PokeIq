import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Launch-day traffic on the free plans: the leaderboards' caches can't be
 * cleared on every saved score, a cached board keeps its last good copy when
 * the database fails, the database's trouble is counted, and the image
 * optimizer takes only the site's own pictures.
 */

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string) => revalidateTag(tag),
  unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
}));

let trouble = 0;
let viewReads: () => void = () => {};
vi.mock("@/app/leaderboard/view", () => ({
  LeaderboardView: async () => {
    viewReads();
    return "board";
  },
  leaderboardBoardMetadata: () => ({}),
}));
vi.mock("@/lib/supabase", async (load) => ({ ...(await load<typeof import("@/lib/supabase")>()), databaseTroubleCount: () => trouble }));

const { refreshBoards, BOARD_REFRESH_MS, LEADERBOARD_TAG } = await import("@/lib/server/leaderboard");
const { default: BoardPage, revalidate } = await import("@/app/leaderboard/board/[board]/page");

describe("leaderboard caches on a busy day", () => {
  it("a saved score clears the boards' cache at most once per BOARD_REFRESH_MS", () => {
    const t0 = 1_000_000_000_000;
    expect(refreshBoards(t0)).toBe(true);
    for (let i = 1; i < 100; i++) expect(refreshBoards(t0 + i * 100)).toBe(false);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith(LEADERBOARD_TAG);
    expect(refreshBoards(t0 + BOARD_REFRESH_MS)).toBe(true);
    expect(revalidateTag).toHaveBeenCalledTimes(2);
  });

  it("a board page is rebuilt at most once a minute", () => {
    expect(revalidate).toBeGreaterThanOrEqual(60);
  });
});

describe("a cached board keeps its last copy when the database fails", () => {
  const params = Promise.resolve({ board: "daily" });
  afterEach(() => {
    viewReads = () => {};
    delete process.env.NEXT_PHASE;
  });

  it("renders the board when its reads went through", async () => {
    await expect(BoardPage({ params })).resolves.toBe("board");
  });

  it("throws (so Next keeps serving the last good page) when a read hit a failing database", async () => {
    viewReads = () => void (trouble += 1);
    await expect(BoardPage({ params })).rejects.toThrow(/keeping the last copy/);
  });

  it("at build time there is no earlier copy: the page renders as it can", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    viewReads = () => void (trouble += 1);
    await expect(BoardPage({ params })).resolves.toBe("board");
  });
});

describe("the database's trouble is counted", () => {
  it("counts timeouts and refusals, 5xx answers and a used-up quota (402), not ordinary answers", async () => {
    const real = await vi.importActual<typeof import("@/lib/supabase")>("@/lib/supabase");
    const fetchBefore = globalThis.fetch;
    let status = 200;
    globalThis.fetch = (async () => {
      if (status === 0) throw new TypeError("fetch failed");
      return new Response("[]", { status });
    }) as typeof fetch;
    try {
      real.resetDatabaseBackoff();
      const start = real.databaseTroubleCount();
      for (const s of [200, 201, 400, 404, 409]) {
        status = s;
        await real.resilientFetch("http://db.invalid/rest/v1/x");
      }
      expect(real.databaseTroubleCount()).toBe(start);
      status = 402;
      await real.resilientFetch("http://db.invalid/rest/v1/x");
      status = 500;
      await real.resilientFetch("http://db.invalid/rest/v1/x");
      status = 0;
      await expect(real.resilientFetch("http://db.invalid/rest/v1/x")).rejects.toThrow(/unavailable/);
      expect(real.databaseTroubleCount()).toBe(start + 3);
    } finally {
      globalThis.fetch = fetchBefore;
      real.resetDatabaseBackoff();
    }
  });
});

describe("the image optimizer's free allowance", () => {
  it("takes no remote pictures, only the site's own that use it, at one quality", async () => {
    const { default: config } = await import("../next.config");
    expect(config.images?.remotePatterns ?? []).toEqual([]);
    expect(config.images?.qualities).toEqual([75]);
    expect(config.images?.localPatterns?.map((p) => p.pathname)).toEqual(["/lab/**", "/_next/static/media/**"]);
  });
});
