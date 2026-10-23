import { describe, expect, it } from "vitest";
import { baseOf } from "@/lib/pikadoku/categories";
import { newTtt, playTtt } from "@/lib/pikadoku/tictactoe";
import { claimCell, createPikadokuDuel, pikadokuView, type PikadokuDuel } from "@/lib/server/pikadoku-duel";
import { joinDuel, readyDuel, touchDuel } from "@/lib/server/duels";
import { gridFromIds } from "@/lib/pikadoku/generator";
import { ratesFromCounts } from "@/lib/server/pikadoku-rates";
import { matchSettingsSchema, queueKey } from "@/lib/server/matchmaking";
import { PVP_LEAD_MS } from "@/lib/pvp-types";

const MEGA_X = 10034;
const rarity = (m: Record<number, number>) => (id: number) => m[id] ?? 0;
const claimed = (id = 1, cell = 0) => playTtt(newTtt(), cell, id, true).state; // X holds `cell`

describe("Steals rules", () => {
  it("lets the next player steal with a different, rarer valid Pokémon", () => {
    const r = playTtt(claimed(), 0, 2, true, baseOf, { steals: true, holder: 1, rarity: rarity({ 1: 12, 2: 3 }) });
    expect(r.outcome).toBe("stolen");
    expect(r.state.owners[0]).toBe("O");
    expect(r.state.used).toEqual([1, 2]);
  });
  it("fails (and passes the turn) when the steal is not rarer, equal or invalid", () => {
    const rules = { steals: true, holder: 1, rarity: rarity({ 1: 5, 2: 9, 3: 5 }) };
    for (const [id, valid] of [[2, true], [3, true], [4, false]] as const) {
      const r = playTtt(claimed(), 0, id, valid, baseOf, rules);
      expect(r.state.owners[0]).toBe("X");
      expect(r.state.turn).toBe("X");
      expect(r.outcome).toBe(valid ? "notrarer" : "missed");
    }
  });
  it("accepts any different valid Pokémon when rarity data is missing", () => {
    expect(playTtt(claimed(), 0, 2, true, baseOf, { steals: true, holder: 1 }).outcome).toBe("stolen");
  });
  it("never lets you steal your own cell or the same Pokémon (or its form), and is off without the option", () => {
    expect(playTtt({ ...claimed(), turn: "X" }, 0, 7, true, baseOf, { steals: true, holder: 1 }).outcome).toBe("illegal");
    expect(playTtt(claimed(6), 0, MEGA_X, true, baseOf, { steals: true, holder: 6, rarity: rarity({ 6: 9, [MEGA_X]: 1 }) }).outcome).toBe("illegal");
    expect(playTtt(claimed(), 0, 2, true, baseOf, { holder: 1 }).outcome).toBe("illegal");
  });
  it("lets a stolen cell be stolen back, and a steal can finish three in a row", () => {
    const m = { 1: 30, 2: 20, 3: 10 };
    let s = playTtt(newTtt(), 0, 1, true, baseOf, { steals: true }).state; // X
    s = playTtt(s, 0, 2, true, baseOf, { steals: true, holder: 1, rarity: rarity(m) }).state; // O steals
    expect(s.owners[0]).toBe("O");
    s = playTtt(s, 0, 3, true, baseOf, { steals: true, holder: 2, rarity: rarity(m) }).state; // X steals back
    expect(s.owners[0]).toBe("X");
    let t = newTtt();
    const r = rarity({ 10: 50, 11: 40, 12: 30, 13: 20, 15: 5 });
    const go = (cell: number, id: number, holder: number | null = null) => (t = playTtt(t, cell, id, true, baseOf, { steals: true, holder, rarity: r }).state);
    go(0, 10); // X
    go(2, 11); // O
    go(1, 12); // X
    go(5, 13); // O
    go(2, 15, 11); // X steals cell 2 from O with a rarer Pokémon: 0-1-2
    expect(t.winner).toBe("X");
    expect(t.line).toEqual([0, 1, 2]);
  });
  it("never fills up a Steals game into a draw before the cap", () => {
    let t = newTtt();
    const order = [0, 1, 2, 5, 3, 4, 8, 7, 6].map((cell, i) => ({ cell, id: 100 + i }));
    for (const { cell, id } of order.slice(0, 8)) t = playTtt(t, cell, id, true, baseOf, { steals: true }).state;
    expect(t.winner === null || t.winner === "X" || t.winner === "O").toBe(true);
  });
});

describe("Steals in a duel", () => {
  function started(steals: boolean, now = 1_000_000) {
    const { duel, playerId: a } = createPikadokuDuel("Ash", "ABCDE", now, { steals });
    const joined = joinDuel(duel, "Misty", now);
    if (!joined.ok) throw new Error("join");
    const b = joined.playerId;
    let d: PikadokuDuel = joined.duel;
    for (const id of [a, b]) {
      const r = readyDuel(d, id, true, now);
      if (!r.ok) throw new Error("ready");
      d = r.duel;
    }
    return { d: touchDuel(d, a, now + PVP_LEAD_MS + 1), a, b, t: now + PVP_LEAD_MS + 1 };
  }
  const distinct = (answers: number[]) => {
    const seen = new Set<number>();
    return answers.filter((id) => (seen.has(baseOf(id)) ? false : (seen.add(baseOf(id)), true)));
  };

  it("enforces rarity on the server and shows the mode in the view", () => {
    const { d, a, b, t } = started(true);
    expect(pikadokuView(d, a, t, 1).settings.steals).toBe(true);
    const [x, y, z] = distinct(gridFromIds(d.gridIds).answers[0]);
    const rates = new Map([[x, 10], [y, 2], [z, 40]]);
    const first = claimCell(d, a, 0, x, t, rates);
    if (!first.ok) throw new Error("claim");
    // B tries a less rare one: the steal fails and the turn passes.
    const weak = claimCell(first.duel, b, 0, z, t + 1, rates);
    if (!weak.ok) throw new Error("steal");
    expect(weak.duel.ttt.owners[0]).toBe("X");
    expect(weak.duel.last?.outcome).toBe("notrarer");
    // A (X) cannot steal their own; B's turn is next? The failed steal passed the turn to X, who plays elsewhere.
    expect(claimCell(weak.duel, a, 0, y, t + 2, rates).ok).toBe(false);
  });
  it("steals with a rarer pick and holds a classic game's cells", () => {
    const { d, a, b, t } = started(true);
    const [x, y] = distinct(gridFromIds(d.gridIds).answers[0]);
    const first = claimCell(d, a, 0, x, t, new Map([[x, 10], [y, 2]]));
    if (!first.ok) throw new Error("claim");
    const stolen = claimCell(first.duel, b, 0, y, t + 1, new Map([[x, 10], [y, 2]]));
    if (!stolen.ok) throw new Error("steal");
    expect(stolen.duel.ttt.owners[0]).toBe("O");
    expect(stolen.duel.picks[0]).toBe(y);
    const classic = started(false);
    const [p, q] = distinct(gridFromIds(classic.d.gridIds).answers[0]);
    const c1 = claimCell(classic.d, classic.a, 0, p, classic.t);
    if (!c1.ok) throw new Error("claim");
    expect(claimCell(c1.duel, classic.b, 0, q, classic.t + 1).ok).toBe(false);
  });
});

describe("Steals settings and rarity data", () => {
  it("is part of matchmaking settings and the queue", () => {
    expect(matchSettingsSchema.safeParse({ game: "pikadoku", steals: true }).success).toBe(true);
    expect(queueKey({ game: "pikadoku", steals: true })).toBe("pikadoku:steals");
    expect(queueKey({ game: "pikadoku" })).toBe("pikadoku");
  });
  it("reports no rarity data when too few answers are recorded", () => {
    expect(ratesFromCounts([new Map([[1, 2]])], [2])).toBeNull();
    const rates = ratesFromCounts([new Map([[1, 40]]), new Map([[1, 10], [2, 50]])], [50, 50]);
    expect(rates?.get(1)).toBe(50);
    expect(rates?.get(2)).toBe(50);
  });
});
