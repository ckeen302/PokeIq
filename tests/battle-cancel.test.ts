import { describe, expect, it } from "vitest";
import { SimSession, randomTeam, replay, type SimSnapshot } from "@/lib/server/battle-engine/engine";

function start() {
  return SimSession.create({
    formatid: "gen9randombattle",
    seed: "1,2,3,4",
    p1: { name: "Red", team: randomTeam("gen9randombattle", "11,12,13,14") },
    p2: { name: "Blue", team: randomTeam("gen9randombattle", "21,22,23,24") },
  });
}
const roundTrip = (s: SimSnapshot): SimSnapshot => JSON.parse(JSON.stringify(s));

describe("cancel (Showdown's undo)", () => {
  it("takes back a choice while the opponent is still choosing, across a save, without logging it", () => {
    const session = start();
    session.result();
    expect(session.choose("p1", "move 1")).toEqual({ ok: true });
    expect(session.pending("p1")).toBeNull();
    const restored = SimSession.restore(roundTrip(session.result()));
    expect(restored.undo("p1")).toEqual({ ok: true });
    expect(restored.pending("p1")).not.toBeNull();
    expect(restored.choose("p1", "move 2")).toEqual({ ok: true });
    expect(restored.choose("p2", "move 1")).toEqual({ ok: true });
    const res = restored.result();
    expect(res.inputLog.filter((l) => l.startsWith(">p1 move"))).toHaveLength(1);
    expect(replay(res.inputLog).turn).toBe(restored.turn);
  });

  it("has nothing to cancel before a choice", () => {
    expect(start().undo("p1").ok).toBe(false);
  });
});
