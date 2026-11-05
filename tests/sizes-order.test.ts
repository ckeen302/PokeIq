import { describe, expect, it } from "vitest";
import { Dex } from "@pkmn/dex";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { SIZE_BY_KEY, SIZE_FORMS, SIZE_ITEMS } from "@/lib/sizes/data";
import { formStats } from "@/lib/sizes/form-stats";
import { DEFAULT_PRESET, MILESTONES, PRESETS, PRESET_BY_ID, compareLineup, presetLineup } from "@/lib/sizes/presets";
import { compareHook, lineFor } from "@/lib/sizes/lineup";
import {
  HEIGHT_ORDER, ORDERS, ORDER_SEGMENTS, badgeStat, dirLabel, framingFor, inOrder, isDefaultOrder, orderCompare, orderFact, orderItems, orderLeftOut, orderNote, orderQuery,
  orderRange, orderSegment, orderSpanFact, orderTag, orderTitle, orderValue, parseOrder, parseOrderSegment, ringRuleFor, withOrder, type Order, type OrderKey,
} from "@/lib/sizes/order";
import { everythingLine, listCaption, listItems, listNote, listOrder, listRows, neighbourLine } from "@/lib/sizes/list";
import { MIXED_SLOPE, envelope, frameDistance, framer, glideAt, type Lens } from "@/lib/sizes/glide";
import { holdsFor, planPlay } from "@/lib/sizes/play";
import { planWorld } from "@/lib/sizes/world";
import { stopCaption } from "@/lib/sizes/facts";
import { badgeSize } from "@/lib/sizes/badges";
import { bySize, fromRow, layoutLine, toRow, type SizeItem } from "@/lib/sizes/types";

const item = (key: string) => {
  const i = SIZE_BY_KEY.get(key);
  if (!i) throw new Error(`no ${key}`);
  return i;
};
const every = (o: Order = HEIGHT_ORDER) => presetLineup(DEFAULT_PRESET, SIZE_ITEMS, o);
const ALL_ORDERS: Order[] = ORDERS.flatMap((o) => (["asc", "desc"] as const).map((dir) => ({ by: o.key, dir })));
const NON_HEIGHT = ALL_ORDERS.filter((o) => o.by !== "height");
const STAT_KEYS: OrderKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];

describe("Order by: the values", () => {
  it("default forms take the Pokédex's weight and base stats", () => {
    for (const p of POKEDEX) {
      const i = item(p.slug);
      expect(orderValue(i, "weight")).toBeCloseTo(p.weight / 10, 10);
      STAT_KEYS.forEach((k, n) => expect(orderValue(i, k)).toBe(Object.values(p.stats)[n]));
      expect(orderValue(i, "bst")).toBe(p.bst);
      expect(orderValue(i, "height")).toBe(i.m);
    }
  });

  it("each form has its own stats from @pkmn/dex, never its species'", () => {
    for (const f of SIZE_FORMS) {
      const i = item(f.slug);
      expect(i.stats).not.toBeNull();
      const s = Dex.species.get(i.name.replace(/^Mega (.*?)( [XY])?$/, "$1-Mega$2").replace(/ /g, "-"));
      if (s.exists && s.forme) expect(i.stats).toEqual([s.baseStats.hp, s.baseStats.atk, s.baseStats.def, s.baseStats.spa, s.baseStats.spd, s.baseStats.spe]);
    }
    // A Mega's own numbers.
    expect(orderValue(item("alakazam-mega"), "spe")).toBe(150);
    expect(orderValue(item("alakazam"), "spe")).toBe(120);
    expect(orderValue(item("eternatus-eternamax"), "hp")).toBe(255);
    // The spellings @pkmn/dex files differently are mapped, not guessed.
    expect(formStats("tauros-paldea-aqua-breed", 128)).toEqual([75, 110, 105, 30, 70, 100]);
    expect(formStats("darmanitan-galar-standard", 555)).toEqual([105, 140, 55, 30, 55, 95]);
    // An unknown forme, or another species', gives nothing (it never falls back to the base species).
    expect(formStats("charizard-made-up", 6)).toBeNull();
    expect(formStats("pikachu-gmax", 6)).toBeNull();
    expect(formStats("charizard", 6)).toBeNull();
  });

  it("weights stay documented: Gigantamax and Eternamax have none, and are left out of the Weight order", () => {
    const all = everythingLine(SIZE_ITEMS);
    const out = orderLeftOut(all, { by: "weight", dir: "asc" });
    expect(out.forms.map((i) => i.kind).sort()).toEqual([...Array(33).fill("gmax"), "eternamax"].sort());
    expect(out.refs).toBe(true);
    for (const i of out.forms) expect(orderValue(i, "weight")).toBeNull();
    expect(everythingLine(SIZE_ITEMS, { by: "weight", dir: "asc" }).some((i) => i.kind === "gmax" || i.kind === "eternamax")).toBe(false);
    // Every form has listed base stats: nothing is left out of a stat order.
    for (const k of [...STAT_KEYS, "bst"] as OrderKey[]) expect(orderLeftOut(all, { by: k, dir: "desc" }).forms).toEqual([]);
    expect(orderNote(all, { by: "weight", dir: "asc" })).toBe("Forms without a listed weight are left out. Real-world sizes stand in the Height order only.");
    expect(orderNote(all, { by: "spe", dir: "asc" })).toBe("Real-world sizes stand in the Height order only.");
    expect(orderNote(all, HEIGHT_ORDER)).toBeNull();
  });
});

describe("Order by: the line", () => {
  it("sorts every lineup by each key, either way, and keeps its real sizes", () => {
    for (const p of PRESETS) {
      for (const o of ALL_ORDERS) {
        const line = presetLineup(p, SIZE_ITEMS, o);
        // Gigantamax forms have no listed weight: that lineup has nothing to stand by weight (the page falls back to Height).
        if (p.id === "gigantamax" && o.by === "weight") expect(line).toEqual([]);
        else expect(line.length).toBeGreaterThan(0);
        for (let k = 1; k < line.length; k++) {
          const a = orderValue(line[k - 1], o.by)!, b = orderValue(line[k], o.by)!;
          if (o.dir === "asc") expect(a).toBeLessThanOrEqual(b);
          else expect(a).toBeGreaterThanOrEqual(b);
        }
        // Only the order changes: the figures are the same items, at their own sizes.
        for (const i of line) expect(i).toBe(SIZE_BY_KEY.get(i.key));
      }
    }
    const fastest = every({ by: "spe", dir: "desc" });
    expect(fastest[0].key).toBe("regieleki");
    // The slowest tie at 5, by Dex number: Shuckle, Munchlax, Pyukumuku.
    expect(fastest.slice(-3).map((i) => i.key)).toEqual(["shuckle", "munchlax", "pyukumuku"]);
    expect(every({ by: "weight", dir: "desc" })[0].kg).toBe(999.9);
    expect(every({ by: "bst", dir: "desc" }).slice(0, 2).map((i) => i.key)).toEqual(["eternatus-eternamax", "arceus"]);
    // Blissey and Eternamax Eternatus tie at 255: Dex number first.
    expect(every({ by: "hp", dir: "desc" }).slice(0, 2).map((i) => i.key)).toEqual(["blissey", "eternatus-eternamax"]);
  });

  it("the filter picks the set and the order sorts it", () => {
    for (const p of PRESETS) {
      const height = new Set(presetLineup(p, SIZE_ITEMS).filter((i) => i.kind !== "ref").map((i) => i.key));
      for (const o of NON_HEIGHT) {
        const keys = presetLineup(p, SIZE_ITEMS, o).map((i) => i.key);
        for (const k of keys) expect(height.has(k)).toBe(true);
        // Everything with a value in the order is there.
        expect(keys.length).toBe([...height].filter((k) => inOrder(item(k), o)).length);
      }
    }
    const gen1 = presetLineup(PRESET_BY_ID.get("gen-1")!, SIZE_ITEMS, { by: "spe", dir: "desc" });
    expect(gen1).toHaveLength(151);
    expect(gen1[0].key).toBe("electrode");
    const house = presetLineup(PRESET_BY_ID.get("bigger-than-a-house")!, SIZE_ITEMS, { by: "weight", dir: "asc" });
    for (const i of house) expect(i.m).toBeGreaterThan(6.2);
  });

  it("ties go by Dex number, then name, whichever way", () => {
    const slow = every({ by: "spe", dir: "asc" }).filter((i) => orderValue(i, "spe") === 5).map((i) => i.species);
    expect(slow.length).toBeGreaterThan(1);
    expect(slow).toEqual([...slow].sort((a, b) => a - b));
    const fast = every({ by: "spe", dir: "desc" }).filter((i) => orderValue(i, "spe") === 100).map((i) => i.species);
    expect(fast).toEqual([...fast].sort((a, b) => a - b));
    // Same species and value: by name.
    const a = { ...item("tauros-paldea-aqua-breed"), stats: [1, 1, 1, 1, 1, 1] as SizeItem["stats"] };
    const b = { ...item("tauros-paldea-blaze-breed"), stats: [1, 1, 1, 1, 1, 1] as SizeItem["stats"] };
    expect(orderItems([b, a], { by: "hp", dir: "asc" }).map((i) => i.name)).toEqual([a.name, b.name].sort());
    expect(orderItems([b, a], { by: "hp", dir: "desc" }).map((i) => i.name)).toEqual([a.name, b.name].sort());
  });

  it("real-world references stand in the Height order only", () => {
    for (const p of PRESETS) {
      expect(presetLineup(p, SIZE_ITEMS).some((i) => i.kind === "ref")).toBe(true);
      expect(presetLineup(p, SIZE_ITEMS, { by: "height", dir: "desc" }).some((i) => i.kind === "ref")).toBe(true);
      for (const o of NON_HEIGHT) expect(presetLineup(p, SIZE_ITEMS, o).some((i) => i.kind === "ref")).toBe(false);
    }
    const vs = [item("wailord"), item("eternatus")];
    expect(compareLineup(vs, SIZE_ITEMS).map((i) => i.key)).toContain("ref-human");
    expect(compareLineup(vs, SIZE_ITEMS, { by: "spe", dir: "desc" }).map((i) => i.key)).toEqual(["eternatus", "wailord"]);
    // A comparison by weight leaves out a figure without a listed weight.
    expect(compareLineup([item("charizard-gmax"), item("snorlax")], SIZE_ITEMS, { by: "weight", dir: "asc" }).map((i) => i.key)).toEqual(["snorlax"]);
  });

  it("Height, smallest first, is exactly the line as it was", () => {
    for (const p of PRESETS) {
      const line = presetLineup(p, SIZE_ITEMS, HEIGHT_ORDER).map((i) => i.key);
      expect(line).toEqual([...presetLineup(p, SIZE_ITEMS)].sort(bySize).map((i) => i.key));
    }
    expect(orderCompare(HEIGHT_ORDER)).toBe(bySize);
    expect(presetLineup(DEFAULT_PRESET, SIZE_ITEMS, { by: "height", dir: "desc" }).map((i) => i.key)[0]).toBe("eternatus-eternamax");
    // A form opened by link joins the line only where it has a value.
    expect(lineFor({ preset: DEFAULT_PRESET.id, vs: [], extra: ["charizard-gmax"] }, SIZE_ITEMS).some((i) => i.key === "charizard-gmax")).toBe(true);
    expect(lineFor({ preset: DEFAULT_PRESET.id, vs: [], extra: ["charizard-gmax"] }, SIZE_ITEMS, { by: "spe", dir: "asc" }).some((i) => i.key === "charizard-gmax")).toBe(true);
    expect(lineFor({ preset: DEFAULT_PRESET.id, vs: [], extra: ["charizard-gmax"] }, SIZE_ITEMS, { by: "weight", dir: "asc" }).some((i) => i.key === "charizard-gmax")).toBe(false);
  });

  it("the browser builds every ordered line exactly as the server does (from the wire rows)", () => {
    const client = SIZE_ITEMS.map((i) => fromRow(toRow(i)));
    for (const i of client) expect(i.stats).toEqual(SIZE_BY_KEY.get(i.key)!.stats);
    for (const o of ALL_ORDERS) {
      for (const p of PRESETS) expect(presetLineup(p, client, o).map((i) => i.key)).toEqual(presetLineup(p, SIZE_ITEMS, o).map((i) => i.key));
      const spec = { preset: DEFAULT_PRESET.id };
      expect(listRows(listItems(client, spec, o), client)).toEqual(listRows(listItems(SIZE_ITEMS, spec, o), SIZE_ITEMS));
    }
  });
});

describe("Order by: the address", () => {
  it("round-trips ?by= and ?dir=, and no parameter means Height", () => {
    for (const o of ALL_ORDERS) {
      const q = new URLSearchParams(orderQuery(o));
      expect(parseOrder(q.get("by"), q.get("dir"))).toEqual(o);
      expect(parseOrderSegment(orderSegment(o))).toEqual(o);
      const u = new URL(`https://x.test${withOrder("/pokedex/sizes/compare?vs=pikachu,snorlax", o)}`);
      expect(u.searchParams.get("vs")).toBe("pikachu,snorlax");
      expect(parseOrder(u.searchParams.get("by"), u.searchParams.get("dir"))).toEqual(o);
    }
    expect(orderQuery(HEIGHT_ORDER)).toBe("");
    expect(withOrder("/pokedex/sizes", HEIGHT_ORDER)).toBe("/pokedex/sizes");
    expect(withOrder("/pokedex/sizes", { by: "spe", dir: "desc" })).toBe("/pokedex/sizes?by=speed&dir=desc");
    expect(withOrder("/pokedex/sizes/gen-1", { by: "weight", dir: "asc" })).toBe("/pokedex/sizes/gen-1?by=weight");
    expect(parseOrder(null, null)).toEqual(HEIGHT_ORDER);
    expect(parseOrder("not-a-stat", "sideways")).toEqual(HEIGHT_ORDER);
    expect(parseOrder(null, "desc")).toEqual({ by: "height", dir: "desc" });
    expect(parseOrder("SPE", "DESC")).toEqual({ by: "spe", dir: "desc" });
    expect(parseOrder(["total", "hp"], ["desc"])).toEqual({ by: "bst", dir: "desc" });
    expect(parseOrderSegment("nope")).toBeNull();
    expect(ORDER_SEGMENTS).toHaveLength(ALL_ORDERS.length - 1);
    expect(ORDER_SEGMENTS).toContain("speed-desc");
    expect(isDefaultOrder(parseOrder("height", "asc"))).toBe(true);
  });
});

describe("Order by: Play, captions and labels", () => {
  const lens: Lens = { vfov: 35, aspect: 16 / 9 };
  const placedOf = (line: SizeItem[]) => layoutLine(line).map((p, i) => ({ ...p, key: line[i].key }));

  it("holds at evenly spaced figures in a non-height order (never the milestones' size landmarks), and ends on the order's last figure", () => {
    for (const o of NON_HEIGHT) {
      const line = every(o);
      const placed = placedOf(line);
      const holds = holdsFor(placed, false);
      expect(holds).toHaveLength(3);
      const at = holds.map((k) => line.findIndex((i) => i.key === k));
      expect(at).toEqual([...at].sort((a, b) => a - b));
      for (const [n, q] of [0.3, 0.55, 0.8].entries()) expect(Math.abs(at[n] / (line.length - 1) - q)).toBeLessThan(0.01);
      const plan = planPlay(placed, lens, { duration: 60, framing: framingFor(o) });
      const stops = plan.glide.stops;
      expect(stops.slice(0, -1).map((s) => s.key)).toEqual(holds);
      expect(stops[stops.length - 1]).toMatchObject({ key: line[line.length - 1].key, finale: true });
    }
    // In Height (either way) Play still pauses on the milestones.
    const down = every({ by: "height", dir: "desc" });
    const plan = planPlay(placedOf(down), lens, { duration: 60, framing: framingFor({ by: "height", dir: "desc" }) });
    expect(plan.glide.stops.slice(0, -1).map((s) => s.key)).toEqual([...MILESTONES].reverse());
    expect(holdsFor([{ key: "a" }, { key: "b" }, { key: "c" }], false)).toEqual([]);
  });

  it("titles, ranges, captions and the finale read the order", () => {
    expect(orderTitle(DEFAULT_PRESET.hook, { by: "spe", dir: "asc" })).toBe("Every Pokémon by Speed 😳");
    expect(orderTitle(DEFAULT_PRESET.hook, { by: "spe", dir: "desc" })).toBe("Every Pokémon by Speed, fastest first 😳");
    expect(orderTitle(DEFAULT_PRESET.hook, HEIGHT_ORDER)).toBe(DEFAULT_PRESET.hook);
    expect(orderTitle(DEFAULT_PRESET.hook, { by: "height", dir: "desc" })).toBe("Every Pokémon by size, largest first 😳");
    expect(orderTitle(PRESET_BY_ID.get("starters")!.hook, { by: "weight", dir: "asc" })).toBe("Every starter Pokémon by Weight 🔥💧🌿");
    expect(orderTitle(PRESET_BY_ID.get("bigger-than-a-house")!.hook, { by: "bst", dir: "desc" })).toBe("Pokémon bigger than a house, by Base Stat Total, highest first 🏠");
    expect(compareHook([item("pikachu"), item("snorlax")], { by: "spe", dir: "asc" })).toBe("Pikachu vs Snorlax, by Speed 😳");
    const fast = every({ by: "spe", dir: "desc" });
    expect(orderRange(fast, { by: "spe", dir: "desc" })).toBe("Speed 200 to 5");
    expect(orderRange(every(), HEIGHT_ORDER)).toBe("0.1 m to 100 m");
    expect(orderFact(item("regieleki"), fast, { by: "spe", dir: "desc" })).toBe("Regieleki's base Speed is 200: the fastest in this line");
    expect(orderFact(item("shuckle"), fast, { by: "spe", dir: "desc" })).toBe("Shuckle's base Speed is 5: the joint slowest in this line");
    expect(orderFact(item("pikachu"), fast, { by: "spe", dir: "desc" })).toMatch(/^Pikachu's base Speed is 90: faster than \d+% of this line$/);
    const heavy = every({ by: "weight", dir: "asc" });
    expect(orderFact(item("snorlax"), heavy, { by: "weight", dir: "asc" })).toMatch(/^Snorlax weighs 460 kg \(1,014 lb\): heavier than \d+% of this line$/);
    expect(orderSpanFact(fast, { by: "spe", dir: "desc" })).toBe("Regieleki's base Speed is 40× Shuckle's");
    expect(stopCaption(item("regieleki"), fast, { by: "spe", dir: "desc" }, true)).toBe("Regieleki's base Speed is 40× Shuckle's");
    // Height keeps its size captions.
    expect(stopCaption(item("snorlax"), every(), HEIGHT_ORDER, false)).toBe("Snorlax weighs 460 kg (1,014 lb)");
    for (const o of NON_HEIGHT) {
      const line = every(o);
      for (const i of line.filter((_, n) => n % 37 === 0)) expect(orderFact(i, line, o) ?? "").not.toMatch(/NaN|Infinity|undefined|null/);
    }
    expect(orderTag(item("snorlax"), { by: "weight", dir: "asc" })).toBe("Weight 460 kg");
    expect(orderTag(item("regieleki"), { by: "spe", dir: "asc" })).toBe("Speed 200");
    expect(orderTag(item("snorlax"), HEIGHT_ORDER)).toBeNull();
    expect(dirLabel("spe", "desc")).toBe("Fastest first");
    expect(dirLabel("weight", "asc")).toBe("Lightest first");
  });

  it("each badge carries the order's value beside its height", () => {
    expect(badgeStat(item("snorlax"), { by: "weight", dir: "asc" })).toEqual({ num: "460", unit: "kg weight", sub: "1,014 lb" });
    expect(badgeStat(item("regieleki"), { by: "spe", dir: "desc" })).toEqual({ num: "200", unit: "speed", sub: "base stat" });
    expect(badgeStat(item("arceus"), { by: "bst", dir: "desc" })).toEqual({ num: "720", unit: "base total", sub: "base stats" });
    expect(badgeStat(item("snorlax"), HEIGHT_ORDER)).toBeNull();
    const measure = (t: string, px: number) => t.length * px * 0.6;
    const base = { name: "Snorlax", dex: 143, kind: "pokemon" as const, m: 2.1, length: false, min: false, types: ["normal"] };
    expect(badgeSize({ ...base, stat: badgeStat(item("snorlax"), { by: "weight", dir: "asc" }) }, 20, measure).w).toBeGreaterThan(badgeSize(base, 20, measure).w);
  });

  it("the table follows the order, with the order's value and what it leaves out", () => {
    const spec = { preset: DEFAULT_PRESET.id };
    const rows = listRows(listItems(SIZE_ITEMS, spec, { by: "spe", dir: "desc" }), SIZE_ITEMS);
    expect(rows[0][0]).toBe("regieleki");
    expect(rows[0][10]).toBe(item("regieleki").stats!.join("/"));
    expect(listCaption(SIZE_ITEMS, spec, { by: "spe", dir: "desc" })).toBe("Every Pokémon by Speed, fastest first");
    expect(listNote(SIZE_ITEMS, spec, { by: "weight", dir: "desc" })).toMatch(/^Forms without a listed weight are left out\./);
    // A Pokémon's own page: its neighbours in the order (no human outside Height).
    const near = neighbourLine(SIZE_ITEMS, item("pikachu"), { by: "spe", dir: "asc" });
    expect(near.some((i) => i.key === "pikachu")).toBe(true);
    expect(near.some((i) => i.kind === "ref")).toBe(false);
    for (const i of near) expect(Math.abs(orderValue(i, "spe")! - 90)).toBeLessThanOrEqual(10);
    // …and one without a value in the order stands by height.
    expect(listOrder(SIZE_ITEMS, { preset: DEFAULT_PRESET.id, focus: "charizard-gmax" }, { by: "weight", dir: "asc" })).toEqual(HEIGHT_ORDER);
    expect(listCaption(SIZE_ITEMS, { preset: DEFAULT_PRESET.id, focus: "pikachu" }, { by: "spe", dir: "asc" })).toBe("Pokémon close to Pikachu's Speed");
    // A lineup with nothing to show in an order (Gigantamax by weight) stands by height.
    expect(listOrder(SIZE_ITEMS, { preset: "gigantamax" }, { by: "weight", dir: "desc" })).toEqual(HEIGHT_ORDER);
    expect(listOrder(SIZE_ITEMS, { preset: "gigantamax" }, { by: "spe", dir: "desc" })).toEqual({ by: "spe", dir: "desc" });
  });
});

describe("Order by: the camera in a mixed line", () => {
  const lens: Lens = { vfov: 35, aspect: 16 / 9 };
  const speed: Order = { by: "spe", dir: "asc" };
  const line = every(speed);
  const placed = layoutLine(line).map((p, i) => ({ ...p, key: line[i].key }));
  const raw = placed.map((p) => Math.log(frameDistance(p.w, p.h, lens)));

  it("the envelope stays over every figure's own framing and changes slowly from one figure to the next", () => {
    const fr = framer(placed, lens, "mixed");
    for (let i = 0; i < placed.length; i++) {
      expect(fr.logD[i]).toBeGreaterThanOrEqual(raw[i]);
      if (i) expect(Math.abs(fr.logD[i] - fr.logD[i - 1])).toBeLessThanOrEqual(MIXED_SLOPE + 1e-9);
    }
    // In this order the sizes jump about: figure to figure, the raw framing swings far more than the envelope.
    let swingRaw = 0, swingEnv = 0;
    for (let i = 1; i < raw.length; i++) { swingRaw += Math.abs(raw[i] - raw[i - 1]); swingEnv += Math.abs(fr.logD[i] - fr.logD[i - 1]); }
    expect(swingEnv).toBeLessThan(swingRaw / 10);
    expect(envelope([0, 5, 0])).toHaveLength(3);
  });

  it("Play in Speed order: the camera's distance changes slowly (bounded per second), and no figure is cut off at its stop", () => {
    const rate = (framing: "size" | "mixed") => {
      const g = planPlay(placed, lens, { framing }).glide;
      let max = 0, prev = Math.log(glideAt(g, 0).d);
      for (let t = 0.1; t <= g.duration; t += 0.1) {
        const l = Math.log(glideAt(g, t).d);
        max = Math.max(max, Math.abs(l - prev) / 0.1);
        prev = l;
      }
      return { g, max };
    };
    const mixed = rate("mixed");
    // At most about 30% closer or further a second at 1× (the speed button multiplies it).
    expect(mixed.max).toBeLessThan(0.3);
    // The Height framing would pump in and out on the same line.
    expect(rate("size").max).toBeGreaterThan(1);
    for (const s of mixed.g.stops) {
      const p = placed[s.index];
      for (let t = s.t0; t <= s.t1; t += 0.05) {
        const st = glideAt(mixed.g, t);
        expect(st.d).toBeGreaterThanOrEqual(frameDistance(p.w, p.h, lens));
      }
    }
    // Every figure, as the camera reaches it: never framed tighter than it needs.
    const fr = framer(placed, lens, "mixed");
    for (let i = 0; i < placed.length; i += 7) expect(fr.at(placed[i].x)).toBeGreaterThanOrEqual(frameDistance(placed[i].w, placed[i].h, lens) * (1 - 1e-9));
  });

  it("a mixed line stays on the boulevard unless it ends in giants; Height smallest first keeps its ring", () => {
    expect(framingFor(speed)).toBe("mixed");
    expect(framingFor(HEIGHT_ORDER)).toBe("size");
    expect(framingFor({ by: "height", dir: "desc" })).toBe("size");
    expect(ringRuleFor(HEIGHT_ORDER)).toBe("first-big");
    expect(ringRuleFor(speed)).toBe("tail");
    expect(planWorld(placed, ringRuleFor(speed)).ring).toBeNull();
    const h = every();
    const hp = layoutLine(h);
    expect(JSON.stringify(planWorld(hp, ringRuleFor(HEIGHT_ORDER)))).toBe(JSON.stringify(planWorld(hp)));
    const gmax = presetLineup(PRESET_BY_ID.get("gigantamax")!, SIZE_ITEMS, speed);
    const gp = layoutLine(gmax);
    const gw = planWorld(gp, "tail");
    expect(gw.ring).not.toBeNull();
    expect(gw.ring!.s0).toBeLessThan(gp[0].x);
    // The default framing is the Height one, unchanged.
    expect(framer(placed, lens).logD).toEqual(framer(placed, lens, "size").logD);
  });
});
