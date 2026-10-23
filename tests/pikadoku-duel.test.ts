import { describe, expect, it } from "vitest";
import { claimCell, createPikadokuDuel, pikadokuView, type PikadokuDuel } from "@/lib/server/pikadoku-duel";
import { joinDuel, readyDuel, touchDuel } from "@/lib/server/duels";
import { gridFromIds } from "@/lib/pikadoku/generator";
import { PVP_LEAD_MS } from "@/lib/pvp-types";

function started(now = 1_000_000) {
  const { duel, playerId: a } = createPikadokuDuel("Ash", "ABCDE", now, { turnSecs: 20, families: ["types", "regions"] });
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

describe("Pikadoku Tic Tac Toe duel", () => {
  it("honours the lobby settings and hides the answers", () => {
    const { d, a, t } = started();
    expect(d.status).toBe("playing");
    expect(d.turnSecs).toBe(20);
    const grid = gridFromIds(d.gridIds);
    for (const c of [...grid.rows, ...grid.cols]) expect(["types", "regions"]).toContain(c.family);
    const json = JSON.stringify(pikadokuView(d, a, t, 1));
    expect(json).not.toMatch(/answers|gridIds|members/);
  });

  it("claims on a right guess, passes the turn on a wrong one or a timeout, and ends on three in a row", () => {
    const { d: d0, a, b, t } = started();
    const grid = gridFromIds(d0.gridIds);
    const right = (cell: number, skip: number[] = []) => grid.answers[cell].find((id) => !skip.includes(id))!;
    // A Pokémon that doesn't fit: scan up from #1 (Ivysaur can fit a cell Bulbasaur does).
    const wrongId = (cell: number) => {
      for (let id = 1; ; id++) if (!grid.answers[cell].includes(id)) return id;
    };
    // Not your turn.
    expect(claimCell(d0, b, 0, right(0), t).ok).toBe(false);
    // A wrong guess passes the turn.
    const r = claimCell(d0, a, 0, wrongId(0), t + 10);
    expect(r.ok && r.duel.ttt.owners[0]).toBeNull();
    expect(r.ok && r.duel.ttt.turn).toBe("O");
    // A timeout passes it back (dated by the rules, not the request).
    const slow = touchDuel((r as { duel: PikadokuDuel }).duel, a, t + 10 + 21_000);
    expect(slow.ttt.turn).toBe("X");
    // X takes the top row, O misses elsewhere.
    let d = slow;
    let clock = t + 25_000;
    const used: number[] = [];
    for (const [cell, mark] of [[0, a], [3, b], [1, a], [4, b], [2, a]] as [number, string][]) {
      const id = right(cell, used);
      const out = claimCell(d, mark, cell, id, clock);
      expect(out.ok, `cell ${cell}`).toBe(true);
      if (!out.ok) return;
      d = out.duel;
      used.push(id);
      clock += 1000;
    }
    expect(d.status).toBe("finished");
    expect(d.end?.winner).toBe(0);
  });
});
