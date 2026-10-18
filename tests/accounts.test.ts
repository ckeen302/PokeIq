import { describe, expect, it } from "vitest";
import {
  generateRecoveryCode,
  hashPassword,
  hashRecoveryCode,
  sameHash,
  verifyPassword,
  USERNAME_RE,
} from "@/lib/server/auth";
import { mergeProgress, normalizeProgress } from "@/lib/progress-merge";
import type { Progress } from "@/lib/progress";

const base: Progress = {
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
};

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashPassword("pikachu-rocks");
    expect(stored).toMatch(/^s1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await verifyPassword("pikachu-rocks", stored)).toBe(true);
    expect(await verifyPassword("pikachu-rock", stored)).toBe(false);
    expect(await verifyPassword("pikachu-rocks", "garbage")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("recovery codes", () => {
  it("are formatted, unambiguous and match case- and dash-insensitively", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-HJKMNP-TV-Z2-9]{4}(-[A-HJKMNP-TV-Z2-9]{4}){3}$/);
    const typed = code.toLowerCase().replace(/-/g, " ");
    expect(sameHash(hashRecoveryCode(typed), hashRecoveryCode(code))).toBe(true);
    expect(sameHash(hashRecoveryCode(generateRecoveryCode()), hashRecoveryCode(code))).toBe(false);
  });
});

describe("usernames", () => {
  it("allow 3-20 safe characters", () => {
    expect(USERNAME_RE.test("Ash_Ketchum")).toBe(true);
    expect(USERNAME_RE.test("ab")).toBe(false);
    expect(USERNAME_RE.test("<script>")).toBe(false);
    expect(USERNAME_RE.test("a".repeat(21))).toBe(false);
  });
});

describe("progress sync", () => {
  it("normalizes untrusted input and rejects junk", () => {
    expect(normalizeProgress(null)).toBeNull();
    expect(normalizeProgress({ v: 2 })).toBeNull();
    const p = normalizeProgress({ v: 1, xp: -5, name: "x".repeat(99), badges: { a: "nope", b: 3 }, daily: { results: { "not-a-date": {} } } });
    expect(p).not.toBeNull();
    expect(p!.xp).toBe(0);
    expect(p!.name).toHaveLength(24);
    expect(p!.badges).toEqual({ b: 3 });
    expect(p!.daily.results).toEqual({});
  });

  it("rejects oversized records", () => {
    expect(normalizeProgress({ v: 1, name: "x".repeat(300_000) })).toBeNull();
  });

  it("merges two devices without losing badges, bests or dailies", () => {
    const phone: Progress = {
      ...base,
      name: "Misty",
      xp: 500,
      runs: 5,
      rating: 1400,
      best: { "dex:classic": 900 },
      badges: { "first-run": 100, perfect: 300 },
      modulesPlayed: ["dex"],
      daily: { last: "2026-10-17", streak: 4, best: 4, results: { "2026-10-17": { score: 1, correct: 1, total: 1, grid: "1", pokeiq: 100 } } },
    };
    const laptop: Progress = {
      ...base,
      xp: 300,
      runs: 9,
      rating: 1300,
      best: { "dex:classic": 1200, "cry:blitz": 400 },
      badges: { "first-run": 50 },
      modulesPlayed: ["cry"],
      daily: { last: "2026-10-10", streak: 7, best: 7, results: { "2026-10-10": { score: 2, correct: 2, total: 2, grid: "11", pokeiq: 110 } } },
    };
    const m = mergeProgress(phone, laptop);
    expect(m.name).toBe("Misty");
    expect(m.xp).toBe(500);
    expect(m.runs).toBe(9);
    expect(m.rating).toBe(1300); // from the side with more runs
    expect(m.best).toEqual({ "dex:classic": 1200, "cry:blitz": 400 });
    expect(m.badges).toEqual({ "first-run": 50, perfect: 300 });
    expect(m.modulesPlayed.sort()).toEqual(["cry", "dex"]);
    expect(m.daily.last).toBe("2026-10-17");
    expect(m.daily.streak).toBe(4);
    expect(m.daily.best).toBe(7);
    expect(Object.keys(m.daily.results).sort()).toEqual(["2026-10-10", "2026-10-17"]);
  });
});
