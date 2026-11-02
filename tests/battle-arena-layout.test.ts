import { describe, expect, it } from "vitest";
import { arenaField, arenaKindOf, footOf, groundSpot, groundSpots, sameField, toNdc, BACKDROP_H, BACKDROP_TOP } from "../src/components/battle/play/arena/layout";
import { projectPos, spritePosition } from "../src/components/battle/play/scene";
import { versusRecord } from "../src/lib/battle/versus";

describe("battle arena layout", () => {
  it("picks an arena per context", () => {
    expect(arenaKindOf("gen9randombattle", false)).toBe("stadium");
    expect(arenaKindOf("gen9ou", false)).toBe("stadium");
    expect(arenaKindOf("factory", false)).toBe("frontier");
    expect(arenaKindOf("bssfactory", false)).toBe("frontier");
    expect(arenaKindOf("tower", false)).toBe("frontier");
    expect(arenaKindOf("gen9randomdoublesbattle", true)).toBe("doubles");
    expect(arenaKindOf("custom", false)).toBe("field");
  });

  it("puts each platform under where the sprites stand (Showdown's projection)", () => {
    const { near, far } = groundSpots(1);
    // A typical sprite's feet: the stage's own projection.
    const nearFoot = footOf(projectPos(spritePosition(true, 0, 1, false), { w: 96, h: 96, gen: 6 }), false);
    const farFoot = footOf(projectPos(spritePosition(false, 0, 1, false), { w: 96, h: 96, gen: 6 }), false);
    expect(near.x).toBeCloseTo(nearFoot.x);
    expect(near.y).toBeCloseTo(nearFoot.y);
    expect(far.x).toBeCloseTo(farFoot.x);
    expect(far.y).toBeCloseTo(farFoot.y);
    // Yours is nearer: lower on screen, bigger; the opponent's up and to the right.
    expect(near.y).toBeGreaterThan(far.y);
    expect(near.x).toBeLessThan(far.x);
    expect(near.width).toBeGreaterThan(far.width);
    expect(near.x).toBeCloseTo(210, 0);
    expect(far.x).toBeCloseTo(430, 0);
  });

  it("widens the platforms in doubles to hold both Pokémon", () => {
    const singles = groundSpot(true, 1);
    const doubles = groundSpot(true, 2);
    expect(doubles.width).toBeGreaterThan(singles.width);
    const slots = [0, 1].map((slot) => footOf(projectPos(spritePosition(true, slot, 2, false), { w: 96, h: 96, gen: 6 }), false).x);
    expect(doubles.x).toBeGreaterThan(Math.min(...slots));
    expect(doubles.x).toBeLessThan(Math.max(...slots));
    for (const x of slots) expect(Math.abs(x - doubles.x)).toBeLessThan(doubles.width / 2);
  });

  it("maps stage points into the taller backdrop layer", () => {
    const centre = toNdc(320, BACKDROP_H / 2 - BACKDROP_TOP);
    expect(centre.x).toBeCloseTo(0);
    expect(centre.y).toBeCloseTo(0);
    expect(toNdc(0, -BACKDROP_TOP)).toEqual({ x: -1, y: 1 });
    expect(toNdc(640, 360)).toEqual({ x: 1, y: -1 });
  });

  it("reads the field from the snapshot's names", () => {
    expect(arenaField("Rain", "", [])).toEqual({ weather: "rain", heavy: false, terrain: null, trickRoom: false });
    expect(arenaField("Harsh Sunshine", "Electric", ["trickroom"])).toEqual({ weather: "sun", heavy: true, terrain: "electric", trickRoom: true });
    expect(arenaField("Hail", "Psychic", []).weather).toBe("snow");
    expect(arenaField("Sand", "Misty", []).terrain).toBe("misty");
    expect(arenaField("Strong Winds", "", []).weather).toBeNull();
    expect(sameField(arenaField("Rain", "", []), arenaField("Rain", "", []))).toBe(true);
    expect(sameField(arenaField("Rain", "", []), arenaField("Rain", "Grassy", []))).toBe(false);
  });
});

describe("versus record", () => {
  it("sums the record and takes this format's rating", () => {
    const record = versusRecord(
      {
        formats: [
          { format: "gen9randombattle", formatName: "[Gen 9] Random Battle", wins: 5, losses: 3, draws: 1, elo: 1234, position: 7 },
          { format: "gen9ou", formatName: "[Gen 9] OU", wins: 2, losses: 0, draws: 0 },
        ],
        recent: ["win", "loss", "win", "win", "draw", "loss"].map((result, i) => ({ code: `c${i}`, format: "gen9ou", formatName: "OU", name: "a", opponent: "b", result: result as "win" | "loss" | "draw", ranked: false, replay: false, at: i })),
      },
      "gen9randombattle"
    );
    expect(record).toEqual({ battles: 11, wins: 7, losses: 3, draws: 1, elo: 1234, position: 7, recent: ["win", "loss", "win", "win", "draw"] });
    expect(versusRecord(null, "gen9ou")).toBeNull();
    expect(versusRecord({ formats: [], recent: [] }, "gen9ou")).toEqual({ battles: 0, wins: 0, losses: 0, draws: 0, recent: [] });
  });
});
