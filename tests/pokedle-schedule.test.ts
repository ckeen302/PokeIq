import { describe, expect, it } from "vitest";
import pool from "@/data/pokedle-pool.json";
import { answerFor } from "@/lib/server/pokedle";
import { cycleOrder, dailyAnswerId, ERAS, legacyDailyId, RECENT_DAYS } from "@/lib/server/pokedle-schedule";
import { deriveSeed } from "@/lib/server/crypto";
import { hashString } from "@/lib/rng";
import { getPokemon, POKEDEX } from "@/lib/pokemon/pokedex";
import { LAUNCH_DATE } from "@/lib/daily";
import { DLE_CURATED_FROM, DLE_WEEKDAY_TIER } from "@/lib/dle-types";

const DAY_MS = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const days = (from: string, count: number) => Array.from({ length: count }, (_, i) => addDays(from, i));
const POOL = pool.tiers.flat();
const tierOf = new Map(pool.tiers.flatMap((t, i) => t.map((id) => [id, i] as const)));

/** The pick every daily used before the curated pool, copied from the original answerFor. */
const original = (date: string) => POKEDEX[hashString(deriveSeed("pokedle", `daily:${date}|`)) % POKEDEX.length].id;

describe("the curated pool", () => {
  it("holds real, distinct Pokémon in three tiers sized for the week", () => {
    expect(new Set(POOL).size).toBe(POOL.length);
    for (const id of POOL) expect(getPokemon(id)).toBeDefined();
    expect(POOL.length).toBeGreaterThan(700);
    // Three easier weekdays, two medium, two harder: the tiers are about 3/7, 2/7 and 2/7 of the pool.
    pool.tiers.forEach((tier, t) => {
      const share = DLE_WEEKDAY_TIER.filter((x) => x === t).length / 7;
      expect(Math.abs(tier.length / POOL.length - share)).toBeLessThan(0.02);
    });
  });

  it("keeps every generation in every tier, and leaves out the deep cuts", () => {
    for (const tier of pool.tiers) expect(new Set(tier.map((id) => getPokemon(id)!.gen)).size).toBe(9);
    // Starters and mascots are on the easier days; Paradox Pokémon and Ultra Beasts are never answers.
    for (const id of [1, 4, 7, 25, 133, 906]) expect(tierOf.get(id)).toBe(0);
    for (const id of [984, 1005, 793, 1024, 1025]) expect(tierOf.has(id)).toBe(false);
  });
});

describe("the daily schedule", () => {
  it("cuts over no earlier than 22 October 2026, after every player's launch-day today", () => {
    // The schedule shipped on 19 October 2026 (UTC); in UTC+14 that was at most the 20th, so "tomorrow" anywhere was the 21st at the latest.
    expect(DLE_CURATED_FROM >= "2026-10-22").toBe(true);
    expect(ERAS[0].from).toBe(DLE_CURATED_FROM);
  });

  it("keeps every date before the cutover on its original answer", () => {
    const before = days(LAUNCH_DATE, Math.round((Date.parse(DLE_CURATED_FROM) - Date.parse(LAUNCH_DATE)) / DAY_MS));
    expect(before.at(-1)).toBe(addDays(DLE_CURATED_FROM, -1));
    for (const date of before) {
      expect(legacyDailyId(date)).toBe(original(date));
      expect(dailyAnswerId(date)).toBe(original(date));
      expect(answerFor({ id: `daily:${date}` }).id).toBe(original(date));
    }
    if (!process.env.POKEIQ_SECRET) {
      // Pinned with the development secret: Linoone, Arcanine, Tinkatuff, Toucannon, Musharna.
      expect(before.map((d) => dailyAnswerId(d))).toEqual([264, 59, 958, 733, 518]);
    }
  });

  it("deals the pool with no repeats in a cycle, then deals it again", () => {
    const era = ERAS[0];
    const cycle = days(era.from, POOL.length).map((d) => dailyAnswerId(d));
    expect(new Set(cycle).size).toBe(POOL.length);
    expect([...cycle].sort((a, b) => a - b)).toEqual([...POOL].sort((a, b) => a - b));
    const next = cycleOrder(era, 1);
    expect(new Set(next).size).toBe(POOL.length);
    expect(next).not.toEqual(cycle);
    // No answer of the last weeks comes straight back at the start of the next cycle, or of the era.
    const tail = new Set(cycle.slice(-RECENT_DAYS));
    for (const id of next.slice(0, RECENT_DAYS)) expect(tail.has(id)).toBe(false);
    const legacy = new Set(days(LAUNCH_DATE, 5).map(original));
    for (const id of cycle.slice(0, 200)) expect(legacy.has(id)).toBe(false);
  });

  it("is deterministic, and the answer is the same Pokémon wherever it's asked for", () => {
    const sample = days(DLE_CURATED_FROM, 60);
    expect(sample.map((d) => dailyAnswerId(d))).toEqual(sample.map((d) => dailyAnswerId(d)));
    for (const date of sample.slice(0, 10)) expect(answerFor({ id: `daily:${date}` }).id).toBe(dailyAnswerId(date));
  });

  it("depends on the server secret, so the open-source code can't predict it", () => {
    const sample = days(DLE_CURATED_FROM, 30);
    const mine = sample.map((d) => dailyAnswerId(d));
    const saved = process.env.POKEIQ_SECRET;
    process.env.POKEIQ_SECRET = "another-secret-entirely-0123456789";
    try {
      expect(sample.map((d) => dailyAnswerId(d))).not.toEqual(mine);
    } finally {
      if (saved === undefined) delete process.env.POKEIQ_SECRET;
      else process.env.POKEIQ_SECRET = saved;
    }
    expect(sample.map((d) => dailyAnswerId(d))).toEqual(mine);
  });

  it("follows the weekday curve, mixes generations and spaces out evolution families", () => {
    const year = days(DLE_CURATED_FROM, 364);
    const answers = year.map((d) => getPokemon(dailyAnswerId(d))!);
    let onTier = 0;
    year.forEach((date, i) => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (tierOf.get(answers[i].id) === DLE_WEEKDAY_TIER[weekday]) onTier++;
    });
    expect(onTier).toBe(year.length);
    for (let i = 1; i < answers.length; i++) {
      expect(answers[i].gen).not.toBe(answers[i - 1].gen);
      expect(answers[i].types[0]).not.toBe(answers[i - 1].types[0]);
    }
    for (let i = 0; i + 30 <= answers.length; i += 7) expect(new Set(answers.slice(i, i + 30).map((p) => p.gen)).size).toBeGreaterThanOrEqual(7);
    let familyRepeats = 0;
    answers.forEach((p, i) => {
      if (answers.slice(Math.max(0, i - RECENT_DAYS), i).some((q) => q.chain === p.chain)) familyRepeats++;
    });
    expect(familyRepeats).toBe(0);
  });
});
