import { describe, expect, it } from "vitest";
import dailies from "@/data/pikadoku-dailies.json";
import { categoryById } from "@/lib/pikadoku/categories";
import { generateGrid } from "@/lib/pikadoku/generator";

/** The dailies published up to 2026-10-24 (UTC): today in New York and UTC and everything before. They must never change. */
const FROZEN = {"2026-10-22":{"easy":{"rows":["ability:hidden","type:water","evo:basic"],"cols":["region:9","region:3","region:4"]},"normal":{"rows":["move:Charge Beam","move:Ice Punch","ability:hidden"],"cols":["move:Trick","other:mega","evo:trade"]},"expert":{"rows":["type:rock","ability:soundproof","evo:stone"],"cols":["evo:three","evo:notfull","region:7"]}},"2026-10-23":{"easy":{"rows":["ability:hidden","other:legendary","evo:notfull"],"cols":["region:7","type:fighting","type:psychic"]},"normal":{"rows":["region:3","move:Flamethrower","evo:full"],"cols":["ability:sturdy","type:dark","move:Heavy Slam"]},"expert":{"rows":["evo:trade","form:galar","evo:stone"],"cols":["type:electric","region:1","ability:hidden"]}},"2026-10-24":{"easy":{"rows":["region:7","evo:basic","region:9"],"cols":["other:legendary","evo:notfull","type:psychic"]},"normal":{"rows":["type:grass","ability:hidden","type:ice"],"cols":["region:4","move:Amnesia","type:dragon"]},"expert":{"rows":["other:ou","region:7","move:Steel Beam"],"cols":["type:grass","stat:def:100","move:Lock-On"]}}};
const FILE = dailies as unknown as Record<string, Record<"easy" | "normal" | "expert", { rows: string[]; cols: string[] }>>;
const FUTURE = Object.keys(FILE).filter((d) => d > "2026-10-24");

describe("published dailies are frozen", () => {
  it("keeps every date up to 2026-10-24 byte-identical", () => {
    for (const [date, grids] of Object.entries(FROZEN)) expect(JSON.stringify(FILE[date])).toBe(JSON.stringify(grids));
  });
});

describe("PokeDoku-style category mix", () => {
  it("Normal dailies use only the classic mix, with at most one famous move and no abilities", () => {
    expect(FUTURE.length).toBeGreaterThan(300);
    for (const d of FUTURE) {
      const cats = [...FILE[d].normal.rows, ...FILE[d].normal.cols].map((id) => categoryById(id)!);
      expect(cats.every((c) => c.classic)).toBe(true);
      expect(cats.filter((c) => c.family === "moves").length).toBeLessThanOrEqual(1);
      expect(cats.some((c) => c.family === "abilities")).toBe(false);
    }
  });
  it("Easy has no moves or abilities; Unlimited defaults follow the Normal mix", () => {
    for (const d of FUTURE.slice(0, 60)) expect([...FILE[d].easy.rows, ...FILE[d].easy.cols].every((id) => !/^(move|ability):/.test(id))).toBe(true);
    for (const s of ["a1", "b2", "c3", "d4", "e5"]) {
      const g = generateGrid(s, { difficulty: "normal" });
      expect([...g.rows, ...g.cols].every((id) => categoryById(id)!.classic)).toBe(true);
    }
  });
});
