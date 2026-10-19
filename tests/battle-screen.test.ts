import { describe, expect, it } from "vitest";
import { SimSession, randomTeam, type SideID } from "@/lib/server/battle-engine/engine";
import { firstChoice } from "@/lib/server/battle-engine/choices";
import { BattleModel, slotOf, textLines } from "@/components/battle/play/model";
import { Track, projectPos, spritePosition } from "@/components/battle/play/scene";

function p2Channel() {
  const session = SimSession.create({
    formatid: "gen9randombattle",
    seed: "3,1,4,1",
    p1: { name: "Red", team: randomTeam("gen9randombattle", "5,9,2,6") },
    p2: { name: "Blue", team: randomTeam("gen9randombattle", "5,3,5,8") },
  });
  const lines: string[] = [...session.result().lines.p2];
  for (let i = 0; i < 30 && !session.ended && session.turn < 8; i++) {
    for (const side of ["p1", "p2"] as SideID[]) {
      const req = session.pending(side);
      if (req) session.choose(side, firstChoice(req, false));
    }
    lines.push(...session.result().lines.p2);
  }
  return lines;
}

describe("battle screen model", () => {
  it("turns a player's channel into steps and snapshots, the opponent's HP as a percentage", () => {
    const model = new BattleModel("p2");
    const steps = p2Channel()
      .map((line) => model.feed(line))
      .filter((s) => s !== null);
    expect(steps.some((s) => s.cmd === "move" && s.moveId && s.targets?.length)).toBe(true);
    expect(steps.some((s) => s.cmd === "turn")).toBe(true);
    const snap = model.snapshot();
    const foe = snap.sides.p1.active[0]!;
    const mine = snap.sides.p2.active[0]!;
    expect(foe.maxhp).toBe(100);
    expect(mine.maxhp).toBeGreaterThan(100);
    // Only what's been shown: the opponent's unrevealed moves aren't known.
    expect(snap.sides.p1.team.every((m) => m.moves.length <= 4)).toBe(true);
  });

  it("reads idents and Showdown's text markup", () => {
    expect(slotOf("p2b: Pikachu")).toEqual({ side: "p2", slot: 1 });
    expect(slotOf("p1: Pikachu")).toEqual({ side: "p1", slot: 0 });
    const lines = textLines("\nGo! **Pikachu**!\n  (Pikachu lost ||−22/256||8.6%|| of its health!)\n");
    expect(lines).toEqual([
      [{ bold: false, text: "Go! " }, { bold: true, text: "Pikachu" }, { bold: false, text: "!" }],
      [{ bold: false, text: "(Pikachu lost 8.6% of its health!)" }],
    ]);
  });
});

describe("battle scene", () => {
  it("queues css, delays and tweens like jQuery, with Showdown's easings", () => {
    const track = new Track(null, { left: 0, opacity: 0 });
    track.delay(100).animate({ opacity: 1 }, 1).animate({ left: [100, "linear"] }, 100).animate({ left: [0, "quadDown"] }, 100);
    expect(track.end).toBe(301);
    expect(track.sample(50)).toEqual({ left: 0, opacity: 0 });
    expect(track.sample(151).left).toBeCloseTo(50);
    expect(track.sample(251).left).toBeCloseTo(100 - 100 * 0.25);
    expect(track.sample(1000)).toEqual({ left: 0, opacity: 1 });
  });

  it("projects scene positions like Showdown's stage", () => {
    const near = projectPos(spritePosition(true, 0, 1, false), { w: 100, h: 100, gen: 6 });
    const far = projectPos(spritePosition(false, 0, 1, false), { w: 100, h: 100, gen: 6 });
    expect(near).toMatchObject({ left: 210 - 75, top: 245 - 75, width: 150, height: 150 });
    expect(far).toMatchObject({ left: 430 - 50, top: 135 - 50, width: 100, height: 100 });
  });
});
