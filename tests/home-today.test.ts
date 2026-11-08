import { describe, expect, it } from "vitest";
import { DAILIES, allDone, bestStreak, dailyStatuses, listNames, streakText } from "@/components/home/today";
import type { Progress } from "@/lib/progress";

const TODAY = "2026-11-07";
const day = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

function progress(patch: Partial<Progress> = {}): Progress {
  return {
    v: 1,
    name: "",
    xp: 0,
    rating: null,
    runs: 0,
    answered: 0,
    correct: 0,
    bestStreak: 0,
    best: {},
    modulesPlayed: [],
    daily: { last: null, streak: 0, best: 0, results: {} },
    dle: { last: null, streak: 0, best: 0, results: {} },
    badges: {},
    skills: {},
    ...patch,
  };
}

/** Pokédle solved on each of the last `n` days, today included. */
function dleDays(n: number): Progress["dle"] {
  const results: Progress["dle"]["results"] = {};
  for (let i = n - 1; i >= 0; i--) results[day(i)] = { guesses: [1, 2, 3, 4], solved: true, over: true };
  return { last: TODAY, streak: n, best: n, results };
}

describe("home: today's dailies", () => {
  it("lists the five dailies in order, with consistent names and no counts", () => {
    expect(DAILIES.map((d) => d.name)).toEqual(["Daily Challenge", "Pokédle", "PokéGuessr", "Connections", "Pikadoku"]);
    for (const d of DAILIES) expect(d.line).not.toMatch(/\d/);
    // PokéGuessr's Play starts today's game straight away.
    expect(DAILIES.find((d) => d.id === "guessr")!.href).toBe("/guessr?play=daily");
  });

  it("shows everything as new on the server and for a new visitor", () => {
    for (const p of [null, progress()]) {
      const s = dailyStatuses(p, p ? TODAY : null);
      expect(Object.values(s).every((x) => x.state === "new" && x.result === null && x.streak === 0)).toBe(true);
      expect(bestStreak(s)).toBeNull();
      expect(allDone(s)).toBe(false);
    }
  });

  it("reads today's results from the stored progress", () => {
    const p = progress({
      best: { [`geo-daily:${TODAY}`]: 18240, "geo:dailyStreak": 2, "geo:dailyLast": Number(TODAY.replaceAll("-", "")) },
      dle: dleDays(4),
    });
    const s = dailyStatuses(p, TODAY);
    expect(s.pokedle).toMatchObject({ state: "done", result: "Solved in 4", streak: 4 });
    expect(s.guessr).toMatchObject({ state: "done", result: "18,240 pts", streak: 2 });
    expect(s.daily.state).toBe("new");
    expect(bestStreak(s)).toEqual({ days: 4, games: ["Pokédle"], atRisk: false });
    expect(allDone(s)).toBe(false);
  });

  it("marks a started puzzle in progress and a missed one done", () => {
    const p = progress({
      dle: { last: null, streak: 0, best: 0, results: { [TODAY]: { guesses: [1, 2], solved: false, over: false } } },
      conn: { last: TODAY, streak: 0, best: 0, results: { [TODAY]: { guesses: [[1, 2, 3, 4]], solved: false, over: true, mistakes: 4 } } },
    });
    const s = dailyStatuses(p, TODAY);
    expect(s.pokedle).toMatchObject({ state: "progress", result: null });
    expect(s.connections).toMatchObject({ state: "done", result: "Missed today" });
  });

  it("keeps a streak from yesterday alive, at risk until today's is played", () => {
    const yesterday = dleDays(3);
    delete yesterday.results[TODAY];
    yesterday.last = day(1);
    const s = dailyStatuses(progress({ dle: yesterday }), TODAY);
    expect(s.pokedle.state).toBe("new");
    expect(bestStreak(s)).toMatchObject({ games: ["Pokédle"], atRisk: true });
    expect(bestStreak(s)!.days).toBeGreaterThanOrEqual(2);
  });

  it("knows when all five are done", () => {
    const p = progress({
      best: { [`geo-daily:${TODAY}`]: 9000 },
      daily: { last: TODAY, streak: 1, best: 1, results: { [TODAY]: { score: 800, correct: 8, total: 10, grid: "", pokeiq: 110 } } },
      dle: dleDays(1),
      conn: { last: TODAY, streak: 1, best: 1, results: { [TODAY]: { guesses: [], solved: true, over: true, mistakes: 0 } } },
      pdk: { last: TODAY, streak: 1, best: 1, results: { [TODAY]: { guesses: [], won: false, over: true, solved: 7, score: 120 } } },
    });
    const s = dailyStatuses(p, TODAY);
    expect(allDone(s)).toBe(true);
    expect(s.daily.result).toBe("8/10 right");
    expect(s.connections.result).toBe("Perfect");
    expect(s.pikadoku.result).toBe("7/9 filled");
  });

  it("words the streak line", () => {
    expect(listNames(["Pokédle"])).toBe("Pokédle");
    expect(streakText({ days: 4, games: ["Pokédle"] })).toBe("4-day Pokédle streak");
    expect(streakText({ days: 2, games: ["Pokédle", "PokéGuessr"] })).toBe("2-day Pokédle and PokéGuessr streaks");
    expect(streakText({ days: 3, games: ["Daily Challenge", "Pokédle", "Pikadoku"] })).toBe("3-day streaks in Daily Challenge, Pokédle and Pikadoku");
  });
});
