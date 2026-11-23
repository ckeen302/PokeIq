import { describe, expect, it } from "vitest";
import { BRACKET_MAX, KEEP, MAX_SCREEN, bitCount, estimateSteps, keptOf, pick, screenSizes, undoPick, viewRun, type Run } from "@/lib/favorite-picker/run";
import { decodeResult, encodeResult, refCodec, type SharedResult } from "@/lib/favorite-picker/link";
import { ALL_POOL, cleanPool, formBit, poolMons, typeBit, typePool } from "@/lib/favorite-picker/pool";
import { shinyMakerHref } from "@/lib/favorite-picker/shiny-link";
import { decodeDesign } from "@/lib/shiny-maker/design";
import { CAT, type Mon } from "@/lib/tier-list/types";

const keys = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const run = (n: number, seed = "seed"): Run => ({ pool: keys(n), seed, picks: [] });

/** Plays a run to the end: keeps the first `keep` of every screen, picks side `side` in every match. */
function play(r: Run, keep = KEEP, side: 0 | 1 = 0): Run {
  for (let guard = 0; guard < 10_000; guard++) {
    const v = viewRun(r);
    if (v.phase === "done") return r;
    if (v.phase === "cull") r = pick(r, (1 << Math.max(v.min, Math.min(keep, v.cap))) - 1);
    else r = pick(r, side);
  }
  throw new Error("never finished");
}

describe("favorite picker: screens", () => {
  it("cuts a round into even screens, never more than the most per screen, at least enough for a full bracket", () => {
    for (const n of [17, 24, 25, 33, 64, 96, 97, 151, 400, 1025, 1500]) {
      const sizes = screenSizes(n);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_SCREEN);
      expect(sizes.length * KEEP).toBeGreaterThanOrEqual(BRACKET_MAX);
    }
  });

  it("a whole Pokédex takes a few rounds and stays a sensible length", () => {
    const steps = estimateSteps(1025);
    expect(steps).toBeLessThan(80);
    expect(estimateSteps(151)).toBeLessThan(30);
    expect(estimateSteps(16)).toBe(15);
    expect(estimateSteps(1)).toBe(0);
  });
});

describe("favorite picker: a run", () => {
  it("goes straight to the bracket for a small pool, and a pool of one is done at once", () => {
    expect(viewRun(run(16)).phase).toBe("duel");
    expect(viewRun(run(2)).phase).toBe("duel");
    const one = viewRun(run(1));
    expect(one.phase).toBe("done");
    if (one.phase === "done") expect(one.ranking).toEqual(["p1"]);
  });

  it("narrows a big pool, then a bracket, then ranks every finalist", () => {
    const end = play(run(1025));
    const v = viewRun(end);
    expect(v.phase).toBe("done");
    if (v.phase !== "done") return;
    expect(v.ranking.length).toBeGreaterThan(9);
    expect(v.ranking.length).toBeLessThanOrEqual(BRACKET_MAX);
    expect(new Set(v.ranking).size).toBe(v.ranking.length);
    expect(v.estimate).toBe(0);
  });

  it("replays the same from its picks (a saved run comes back exactly)", () => {
    const end = play(run(300, "abc"), 3, 1);
    const again = viewRun({ ...end, picks: end.picks.slice() });
    expect(again).toEqual(viewRun(end));
  });

  it("the champion is the one picked in the final, and the runner-up second", () => {
    let r = run(8);
    const beaten: string[] = [];
    for (;;) {
      const v = viewRun(r);
      if (v.phase !== "duel") break;
      if (v.label.kind === "final") beaten.push(v.b);
      r = pick(r, 0);
    }
    const v = viewRun(r);
    if (v.phase !== "done") throw new Error("not done");
    expect(v.ranking[1]).toBe(beaten[0]);
  });

  it("ranks within a round by how the one that won finished", () => {
    // Always the first card: in a bracket of 4, the semifinal loser to the champion ranks 3rd.
    let r = run(4);
    const semis: { a: string; b: string }[] = [];
    for (;;) {
      const v = viewRun(r);
      if (v.phase !== "duel") break;
      if (v.label.kind === "semi") semis.push({ a: v.a, b: v.b });
      r = pick(r, 0);
    }
    const v = viewRun(r);
    if (v.phase !== "done") throw new Error("not done");
    const champ = v.ranking[0];
    const lostToChamp = semis.find((m) => m.a === champ)!.b;
    expect(v.ranking[2]).toBe(lostToChamp);
  });

  it("a screen can't keep more than the cap, and a round can't end too small", () => {
    const r = run(100);
    const v = viewRun(r);
    if (v.phase !== "cull") throw new Error("expected a screen");
    expect(viewRun(pick(r, (1 << (KEEP + 1)) - 1)).steps).toBe(0);
    // Keep nothing anywhere: the round's last screen asks for at least two.
    let x = r;
    for (;;) {
      const w = viewRun(x);
      if (w.phase !== "cull" || w.min > 0) {
        expect(w.phase).toBe("cull");
        if (w.phase === "cull") expect(w.min).toBe(2);
        break;
      }
      x = pick(x, 0);
    }
    expect(viewRun(pick(x, 0)).steps).toBe(x.picks.length);
  });

  it("undo takes back exactly the last pick", () => {
    const r = pick(pick(run(200), 0b101), 0b11);
    expect(undoPick(r).picks).toEqual([0b101]);
    expect(viewRun(undoPick(r))).toEqual(viewRun(pick(run(200), 0b101)));
  });

  it("estimates progress and moves forward", () => {
    const a = viewRun(run(500));
    const b = viewRun(pick(run(500), 0b1));
    expect(b.steps).toBe(a.steps + 1);
    expect(a.estimate).toBeGreaterThan(0);
  });

  it("bit helpers", () => {
    expect(bitCount(0b1011)).toBe(3);
    expect(keptOf(["a", "b", "c", "d"], 0b1010)).toEqual(["b", "d"]);
  });
});

const mon = (k: string, d: number, extra: Partial<Mon> = {}): Mon => ({ k, n: k, d, g: 1, t: ["fire"], b: 300, a: String(d), m: 31, c: 0, ...extra });

describe("favorite picker: pool", () => {
  const mons: Mon[] = [
    mon("charmander", 4, { c: CAT.starter }),
    mon("charizard", 6, { t: ["fire", "flying"] }),
    mon("charizardmegax", 6, { f: "mega", s: "charizard", t: ["fire", "dragon"] }),
    mon("vulpixalola", 37, { f: "regional", s: "vulpix", t: ["ice"], g: 7 }),
    mon("vulpix", 37),
    mon("mewtwo", 150, { t: ["psychic"], c: CAT.legendary }),
    mon("sprigatito", 906, { t: ["grass"], g: 9, c: CAT.starter }),
  ];
  it("species only by default, forms by kind", () => {
    expect(poolMons(mons, ALL_POOL).map((m) => m.k)).toEqual(["charmander", "charizard", "vulpix", "mewtwo", "sprigatito"]);
    expect(poolMons(mons, { ...ALL_POOL, forms: formBit("mega") }).map((m) => m.k)).toContain("charizardmegax");
    expect(poolMons(mons, { ...ALL_POOL, forms: formBit("mega") }).map((m) => m.k)).not.toContain("vulpixalola");
  });
  it("generations, types and categories", () => {
    expect(poolMons(mons, { ...ALL_POOL, gens: 1 << 8 }).map((m) => m.k)).toEqual(["sprigatito"]);
    expect(poolMons(mons, { ...ALL_POOL, types: typeBit("flying") | typeBit("psychic") }).map((m) => m.k)).toEqual(["charizard", "mewtwo"]);
    expect(poolMons(mons, { ...ALL_POOL, cat: "starter" }).map((m) => m.k)).toEqual(["charmander", "sprigatito"]);
    expect(poolMons(mons, typePool("ice", formBit("regional"))).map((m) => m.k)).toEqual(["vulpixalola"]);
  });
  it("a form counts as its species for the category", () => {
    const withStarterForm = [...mons, mon("charmanderother", 4, { f: "other", s: "charmander" })];
    expect(poolMons(withStarterForm, { ...ALL_POOL, cat: "starter", forms: formBit("other") }).map((m) => m.k)).toContain("charmanderother");
  });
  it("cleans a saved pool", () => {
    expect(cleanPool({ gens: -1, types: 2 ** 30, cat: "nope" as never, forms: 3 })).toEqual({ gens: 0, types: 0, cat: "all", forms: 3 });
  });
});

describe("favorite picker: links", () => {
  const r: SharedResult = {
    top: [{ ref: 94, shiny: true }, { ref: "charizardmegax", shiny: false }, { ref: 1025, shiny: true }],
    chart: { fire: { ref: 6, shiny: false }, fairy: { ref: 700, shiny: true }, normal: { ref: "zigzagoongalar", shiny: false } },
    pool: { gens: 0b101, types: typeBit("fire"), cat: "starter", forms: 3 },
    chartFirst: false,
  };
  it("round-trips a result", () => {
    const s = encodeResult(r);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeResult(s)).toEqual(r);
  });
  it("round-trips a chart on its own (it opens on the chart)", () => {
    const only = { top: [], chart: r.chart, pool: null };
    expect(decodeResult(encodeResult(only))).toEqual({ ...only, chartFirst: true });
  });
  it("rejects anything else", () => {
    const s = encodeResult(r);
    for (const bad of [null, "", "!!", s.slice(0, -2), `${s}A`, "AA", "AQA"]) expect(decodeResult(bad)).toBeNull();
  });
  it("species travel as numbers, forms as ids", () => {
    const codec = refCodec([mon("charizard", 6), mon("charizardmegax", 6, { f: "mega" })]);
    expect(codec.ref("charizard")).toBe(6);
    expect(codec.ref("charizardmegax")).toBe("charizardmegax");
    expect(codec.key(6)).toBe("charizard");
    expect(codec.key("charizardmegax")).toBe("charizardmegax");
    expect(codec.key("nope")).toBeNull();
  });
});

describe("favorite picker: Shiny Pokémon Maker links", () => {
  it("opens the maker on the species with its part count, shiny or not", () => {
    const parts = "5".repeat(1025);
    const href = shinyMakerHref(25, parts, true)!;
    const d = decodeDesign(new URL(href, "https://x").searchParams.get("d"));
    expect(d?.id).toBe(25);
    expect(d?.parts.length).toBe(5);
    expect(d?.parts.every((p) => p.src === 1)).toBe(true);
    expect(decodeDesign(new URL(shinyMakerHref(25, parts, false)!, "https://x").searchParams.get("d"))?.parts[0].src).toBe(0);
    expect(shinyMakerHref(25, null, true)).toBeNull();
    expect(shinyMakerHref(2000, parts, true)).toBeNull();
  });
});
