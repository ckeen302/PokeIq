import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { plainNote } from "@/lib/pokemon/encounter-transform";
import { genColumns, genSummary, type EncGen } from "@/lib/pokemon/encounter-types";
import { parseOverview } from "../scripts/dex/serebii";
import { partOfPlace, placeKey, rowsFromLocPage } from "../scripts/dex/serebii-loc";

const DIR = path.join(process.cwd(), "src/data/encounters");
const load = (id: number) => (JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), "utf8")) as { gens: EncGen[] }).gens;
const gen = (id: number, g: number) => load(id).find((x) => x.g === g)!;

describe("plain-English notes", () => {
  it("rewrites Serebii's availability text", () => {
    expect(plainNote("Transfer from Pokémon HOME or Trade with players with The Hidden Treasure of Area Zero")).toBe(
      "Transfer from Pokémon HOME or trade (needs The Hidden Treasure of Area Zero)"
    );
    expect(plainNote("Transfer from Pokémon HOME or Trade with players with Expansion Pass")).toBe("Transfer from Pokémon HOME or trade (needs the Expansion Pass)");
    expect(plainNote("Evolve Ivysaur (The Indigo Disk)")).toBe("Evolve Ivysaur (in The Indigo Disk)");
    expect(plainNote("Evolve Ivysaur", "The Indigo Disk")).toBe("Evolve Ivysaur (in The Indigo Disk)");
    expect(plainNote("Trade from Pokémon Sword (Crown Tundra)")).toBe("Trade from Sword (in The Crown Tundra)");
    expect(plainNote("Transfer through Pokémon HOME or through events")).toBe("Transfer from Pokémon HOME or get it from an event");
    expect(plainNote("Johtonian Form: Trade in Cascarrafa")).toBe("Trade in Cascarrafa, Johtonian form");
    expect(plainNote("Evovle Slowpoke (The Indigo Disk)")).toBe("Evolve Slowpoke (in The Indigo Disk)");
  });
});

describe("Serebii overview: Z-A hyperspace and Tera Raids", () => {
  const html = `<h2>Locations</h2><table>
    <tr><td>Scarlet</td><td class="fooinfo">Tera Raid Battles: <a href="/x/3star.shtml">3 Star Raid Battles</a></td></tr>
    <tr><td>Legends: Z-A Mega Dimension</td><td class="fooinfo">Galarian Form<br /><a href="/pokearth/lumiosecity/hyperspacelumiose.shtml">Hyperspace Lumiose</a> - <a href="/z/grass.shtml"> Grass (4 Star)</a>, <a href="/z/poison.shtml"> Poison (5 Star)</a></td></tr>
  </table>`;
  it("puts the zone and stars in the note, not the place name", () => {
    const rows = parseOverview(html);
    expect(rows).toContainEqual(expect.objectContaining({ ver: "scarlet", loc: "Tera Raid Battles", m: "Tera Raid", n: "3★" }));
    expect(rows).toContainEqual(expect.objectContaining({ ver: "legends-za", loc: "Hyperspace Lumiose", m: "Hyperspace", n: "Galarian form · Grass zone · 4★" }));
    expect(rows).toContainEqual(expect.objectContaining({ ver: "legends-za", loc: "Hyperspace Lumiose", m: "Hyperspace", n: "Galarian form · Poison zone · 5★" }));
    // the bare place link heading the zones is not a row of its own, nor is the form heading
    expect(rows.filter((r) => r.ver === "legends-za")).toHaveLength(2);
  });
});

describe("Serebii per-generation location pages", () => {
  const page = `<a name="general"></a><table><tr><td><a name="or">Omega Ruby</a></td></tr>
    <tr><td class="lochead">Location</td><td class="lochead">Method</td><td class="lochead">Rarity</td><td class="lochead">Min. Level</td><td class="lochead">Max Level</td></tr>
    <tr><td class="fooinfo"><a href="/pokearth/hoenn/route106.shtml">Route 106</a></td><td class="fooinfo">Old Rod</td><td class="fooinfo">65%</td><td class="fooinfo">10</td><td class="fooinfo">15</td></tr>
    <tr><td class="fooinfo"><a href="/pokearth/hoenn/granitecave.shtml">Granite Cave - B1F</a></td><td class="fooinfo">Walking / Grass</td><td class="fooinfo">30%</td><td class="fooinfo">10</td><td class="fooinfo">12</td></tr>
    </table>
    <table><tr><td><a name="sun">Sun</a></td></tr>
    <tr><td class="lochead">Location</td><td class="lochead">Method</td><td class="lochead">Time</td><td class="lochead">Rarity</td><td class="lochead">Initial or SOS</td><td class="lochead">Grass Patch</td><td class="lochead">Level</td></tr>
    <tr><td class="fooinfo"><a href="/pokearth/alola/route1.shtml">Route 1</a></td><td class="fooinfo">Walking / Grass</td><td class="fooinfo">Day</td><td class="fooinfo">20%</td><td class="fooinfo">Initial</td><td class="fooinfo"><a href="/pokearth/maps/alola/wild/1-1.png">Specific Patches</a></td><td class="fooinfo">Lv. 2-3</td></tr>
    <tr><td class="fooinfo"><a href="/pokearth/alola/route1.shtml">Route 1</a></td><td class="fooinfo">Walking / Grass</td><td class="fooinfo">Night</td><td class="fooinfo">10%</td><td class="fooinfo">Initial</td><td class="fooinfo"><a href="/pokearth/maps/alola/wild/1-1.png">Specific Patches</a></td><td class="fooinfo">Lv. 2-3</td></tr>
    </table>`;
  it("parses method, levels and rates per version", () => {
    const rows = rowsFromLocPage(page, { or: "omega-ruby", sun: "sun" });
    expect(rows).toContainEqual({ ver: "omega-ruby", loc: "Route 106", base: "Route 106", m: "Old Rod", lv: "10–15", r: "65%" });
    expect(rows).toContainEqual({ ver: "omega-ruby", loc: "Granite Cave", base: "Granite Cave", sub: "B1F", m: "Cave", lv: "10–12", r: "30%" });
    // Alola's day covers morning and day
    expect(rows).toContainEqual({ ver: "sun", loc: "Route 1", base: "Route 1", m: "Grass", lv: "2–3", t: ["20%", "20%", "10%"] });
  });
  it("matches PokéAPI place names to Serebii's", () => {
    expect(partOfPlace(placeKey("Guidance Chamber"), placeKey("Mistralton Cave - Guidance Chamber"))).toBe(true);
    expect(partOfPlace(placeKey("Glacier Room"), placeKey("Underground Ruins - Iceberg Chamber"))).toBe(true);
    expect(partOfPlace(placeKey("Route 1"), placeKey("Route 10"))).toBe(false);
  });
});

describe("Venusaur (#3)", () => {
  const g9 = gen(3, 9);
  it("shows plain-English notes and hyperspace zones as notes", () => {
    const xs = g9.rows.filter((r) => r.x).map((r) => r.x);
    expect(xs).toContain("Transfer from Pokémon HOME or trade (needs The Hidden Treasure of Area Zero)");
    expect(xs).toContain("Evolve Ivysaur (in The Indigo Disk)");
    const hyper = g9.rows.filter((r) => r.m === "Hyperspace");
    expect(hyper.length).toBeGreaterThan(0);
    for (const r of hyper) {
      expect(r.loc).toBe("Hyperspace Lumiose");
      expect(r.n).toMatch(/^\w+ zone · \d★$/);
    }
    expect(hyper.map((r) => r.n)).toContain("Grass zone · 4★");
  });
  it("counts every shown row in the header and drops empty Levels/Rate columns", () => {
    expect(genSummary(g9, "Venusaur")).toBe(`${g9.rows.length} entries for Venusaur`);
    expect(genColumns(g9.rows)).toEqual({ levels: false, rate: false, timed: false });
  });
});

describe("Starly (#396)", () => {
  it("lists Tera Raids under one place with the stars as a note", () => {
    const raid = gen(396, 9).rows.filter((r) => r.m === "Tera Raid");
    expect(raid).toEqual([{ v: ["scarlet", "violet"], loc: "Tera Raid Battles", m: "Tera Raid", n: "1★" }]);
  });
  it("adds White Forest from Serebii and keeps the Levels column but not an empty Rate column", () => {
    const g5 = gen(396, 5);
    expect(g5.rows).toContainEqual({ v: ["white"], loc: "White Forest", m: "Grass", lv: "5" });
    expect(genColumns(g5.rows)).toEqual({ levels: true, rate: false, timed: false });
    expect(genSummary(g5, "Starly")).toBe(`${g5.rows.length} entries for Starly`);
  });
  it("keeps the Morning/Day/Night columns where rates vary", () => {
    expect(genColumns(gen(396, 4).rows)).toMatchObject({ levels: true, rate: true, timed: true });
  });
});

describe("all encounter files", () => {
  it("never use a hyperspace zone or raid tier as a place name", () => {
    for (const f of fs.readdirSync(DIR)) {
      for (const g of (JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as { gens: EncGen[] }).gens) {
        for (const r of g.rows) expect(r.loc ?? "", f).not.toMatch(/\(\d+ Star\)|Star Raid Battles/);
      }
    }
  });
});
