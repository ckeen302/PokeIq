import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EncGen } from "@/lib/pokemon/encounter-types";

const DIR = path.join(process.cwd(), "src/data/encounters");
const load = (id: number) => JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), "utf8")) as { gens: EncGen[] };

describe("encounter data files", () => {
  it("never mention Gen 4 dual-slot (GBA slot) or radio-sound rows", () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(1025);
    for (const f of files) {
      const text = fs.readFileSync(path.join(DIR, f), "utf8");
      expect(text, f).not.toMatch(/GBA slot|Hoenn Sound|Sinnoh Sound|slot2/i);
    }
  });

  it("shows Starly's Gen 4 Route 201 as one plain D/P/Pt row with the real rates", () => {
    const g4 = load(396).gens.find((g) => g.g === 4)!;
    const r201 = g4.rows.filter((r) => r.loc === "Route 201");
    expect(r201).toHaveLength(1);
    expect(r201[0]).toMatchObject({ v: ["diamond", "pearl", "platinum"], m: "Grass", lv: "2–3", t: ["50%", "50%", "40%"] });
    expect(r201[0].n).toBeUndefined();
    expect(g4.rows.every((r) => !r.n || !/slot|sound/i.test(r.n))).toBe(true);
  });
});
