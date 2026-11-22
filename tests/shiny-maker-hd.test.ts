import { existsSync, readFileSync, statSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { SpeciesFile } from "@/lib/shiny-maker/data";
import { HD_FIXES, HD_ONE_PIECE } from "../scripts/shiny-maker/hd-review";

const roster = JSON.parse(readFileSync("public/shiny-maker/species.json", "utf8")) as [number, string, string][];
const file = (id: number) => JSON.parse(readFileSync(`public/shiny-maker/px/${id}.json`, "utf8")) as SpeciesFile;
const mask = async (id: number) => {
  const { data, info } = await sharp(`public/shiny-maker/hd/${id}.png`).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  return { data, info };
};

describe("shiny maker: 3D (HD) for every Pokémon", () => {
  it("covers the whole roster", () => {
    expect(roster.length).toBe(1025);
    expect(new Set(roster.map((r) => r[0])).size).toBe(roster.length);
  });

  it("gives every species 3D references (one per part) and a mask, with no fallback list needed", () => {
    const missing: number[] = [];
    for (const [id] of roster) {
      const f = file(id);
      if (!f.hd || f.hd.length !== f.parts.length || !existsSync(`public/shiny-maker/hd/${id}.png`)) missing.push(id);
      else for (const ref of f.hd) {
        expect(ref).toHaveLength(6);
        for (const v of ref) expect(Number.isFinite(v)).toBe(true);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has 512 × 512 masks whose labels are the species' parts, with every part's pixels on the figure", async () => {
    for (const [id] of roster) {
      const f = file(id);
      const { data, info } = await mask(id);
      expect([info.width, info.height]).toEqual([512, 512]);
      let max = 0, labelled = 0;
      for (const v of data) { if (v > max) max = v; if (v) labelled++; }
      expect(max, `#${id}`).toBeLessThanOrEqual(f.parts.length);
      // A mask that labels almost nothing would draw 3D unrecoloured.
      expect(labelled / (512 * 512), `#${id}`).toBeGreaterThan(0.02);
    }
  }, 120_000);

  it("keeps the fallback review list to real species and the settings the builder knows", () => {
    expect(HD_ONE_PIECE.length).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(HD_FIXES)) {
      expect(roster.some((r) => r[0] === Number(k))).toBe(true);
      if (v !== "one-piece") {
        expect([0.1, 0.25, 0.5, 1]).toContain(v.wl);
        expect([0.3, 0.6, 1]).toContain(v.k);
      }
    }
  });

  it("keeps masks small, since each loads on its own when that Pokémon is picked in 3D", () => {
    let total = 0;
    for (const [id] of roster) {
      const s = statSync(`public/shiny-maker/hd/${id}.png`).size;
      expect(s, `#${id}`).toBeLessThan(40_000);
      total += s;
    }
    expect(total).toBeLessThan(8_000_000);
  });
});
