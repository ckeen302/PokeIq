import { beforeEach, describe, expect, it } from "vitest";
import { computeStats } from "@/lib/battle/analysis/stats";
import { aggregateInsights, summaryFromStats, winRate, type BattleSummary } from "@/lib/battle/insights";
import { BACKFILL_PER_VISIT, clearMemoryInsights, insightsAvailable, playerInsights } from "@/lib/server/battle-engine/insights";
import { clearMemoryRecords, memoryRecordStore } from "@/lib/server/battle-engine/records";
import { clearMemoryReplays, memoryReplayStore } from "@/lib/server/battle-engine/replays";
import { simBattle } from "./helpers/sim-battle";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const KEY = "insightsredinsightsred";
const row = (over: Partial<BattleSummary>): BattleSummary => ({ code: "aaaaaaaa", key: KEY, format: "gen9randombattle", ranked: true, result: "win", hasReplay: true, lead: null, team: [], foes: [], koBy: [], at: 0, ...over });

describe("insight sums", () => {
  it("counts leads, win rate per Pokémon and the foes that beat a trainer", () => {
    const rows = [
      row({ code: "a", result: "win", lead: "Garchomp", team: ["Garchomp", "Heatran"], foes: ["Kingambit", "Dragonite"], koBy: ["Kingambit"], at: 3 }),
      row({ code: "b", result: "loss", lead: "Garchomp", team: ["Garchomp", "Corviknight"], foes: ["Kingambit"], koBy: ["Kingambit", "Kingambit"], at: 2 }),
      row({ code: "c", result: "loss", lead: "Heatran", team: ["Heatran"], foes: ["Dragonite"], koBy: [], at: 1 }),
      row({ code: "d", result: "win", hasReplay: false, at: 4 }),
    ];
    const t = aggregateInsights(rows);
    expect(t.battles).toBe(3);
    expect(t.wins).toBe(1);
    expect(t.leads).toEqual([
      { species: "Garchomp", games: 2, wins: 1 },
      { species: "Heatran", games: 1, wins: 0 },
    ]);
    expect(t.mons.find((m) => m.species === "Heatran")).toEqual({ species: "Heatran", games: 2, wins: 1 });
    expect(t.threats[0]).toEqual({ species: "Kingambit", games: 2, losses: 1, kos: 3 });
    expect(t.threats[1]).toEqual({ species: "Dragonite", games: 2, losses: 1, kos: 0 });
    expect(aggregateInsights(rows, 1).battles).toBe(1);
    expect(winRate(2, 3)).toBe("67%");
    expect(winRate(0, 0)).toBe("—");
  });
});

/** Replay ids (the battle code alphabet has no i, l, o, 0 or 1). */
const codeOf = (i: number) => `abcdefg${"abcdefghjkmnpqrstuvwxyz23456789"[i]}`;

describe("a trainer's insights from their saved battles", () => {
  beforeEach(() => {
    clearMemoryRecords();
    clearMemoryReplays();
    clearMemoryInsights();
  });

  it("reads each battle's replay once, a few per visit, and adds them up", async () => {
    const replays = memoryReplayStore();
    const records = memoryRecordStore();
    const battles = Array.from({ length: BACKFILL_PER_VISIT + 3 }, (_, i) => ({ code: codeOf(i), sim: simBattle("gen9randombattle", 40 + (i % 6)), seat: (i % 2) as 0 | 1 }));
    for (const [i, b] of battles.entries()) {
      const players: [string, string] = b.seat === 0 ? ["Rory", "Bea"] : ["Bea", "Rory"];
      const log = b.sim.spectator.map((l) => l.replace(/\|Red\b/g, `|${players[0]}`).replace(/\|Blue\b/g, `|${players[1]}`));
      const winner = b.sim.winner;
      await replays.save({ id: b.code, format: "gen9randombattle", formatName: "[Gen 9] Random Battle", players, winner, reason: "normal", turns: 10, ranked: true, public: true, uploadedAt: i, log, keys: [KEY] });
      await records.record([
        {
          code: b.code,
          key: KEY,
          format: "gen9randombattle",
          formatName: "[Gen 9] Random Battle",
          name: "Rory",
          opponent: "Bea",
          result: winner === null ? "draw" : winner === b.seat ? "win" : "loss",
          ranked: true,
          ratingBefore: 1500 + i,
          ratingAfter: 1501 + i,
          at: 1_000_000 + i * 1000,
        },
      ]);
    }
    expect(await insightsAvailable()).toBe(true);
    const first = (await playerInsights(KEY, "gen9randombattle"))!;
    expect(first.battles).toBe(BACKFILL_PER_VISIT);
    expect(first.pending).toBe(3);
    // Another visit (all formats: not the cached answer): the rest are read, the first ones aren't read again.
    const second = (await playerInsights(KEY, null))!;
    expect(second.battles).toBe(BACKFILL_PER_VISIT + 3);
    expect(second.pending).toBe(0);

    // The same sums, worked out straight from each replay.
    const expected = aggregateInsights(
      battles.map((b, i) => {
        const stats = computeStats(b.sim.spectator);
        const result = b.sim.winner === null ? "draw" : b.sim.winner === b.seat ? "win" : "loss";
        return summaryFromStats(stats, b.seat, { code: b.code, key: KEY, format: "gen9randombattle", ranked: true, result, at: i });
      })
    );
    expect(second.wins).toBe(expected.wins);
    expect(second.leads).toEqual(expected.leads);
    expect(second.mons).toEqual(expected.mons);
    expect(second.threats).toEqual(expected.threats);
    // The rating, game by game, oldest first.
    expect(first.trend.map((p) => p.rating)).toEqual([1500, ...battles.map((_, i) => 1501 + i)]);
  });
});
