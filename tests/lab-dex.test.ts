import { describe, expect, it } from "vitest";
import { Wheel, mod, nearestSlot, podSlots, PODS } from "@/lib/lab-dex/wheel";
import { ROLES, roleTable, standing, standings } from "@/lib/lab-dex/roles";
import { DEFAULT_VIEW, buildSequence, searchSequence, viewFromParams, viewToParams } from "@/lib/lab-dex/sequence";
import { fromRow } from "@/lib/lab-dex/types";
import { labDetails, labRows } from "@/lib/lab-dex/data";
import { SIZE_FORM_IDS } from "@/lib/lab-dex/form-ids";
import { SIZE_FORMS } from "@/lib/sizes/data";
import type { Stats6 } from "@/lib/lab-dex/types";

const run = (w: Wheel, s = 3) => { for (let t = 0; t < s * 60; t++) w.update(1 / 60); };

describe("lab wheel", () => {
  it("steps and settles on whole slots", () => {
    const w = new Wheel();
    w.step(1); w.step(1);
    run(w);
    expect(w.p).toBe(2);
    expect(w.settled()).toBe(true);
  });
  it("a fling glides on without overshooting, a slow release snaps", () => {
    const w = new Wheel();
    w.grab(0);
    for (let i = 1; i <= 6; i++) w.drag(0.5, i * 0.016);
    w.release(0.1);
    const target = w.target!;
    expect(target).toBeGreaterThan(3);
    let max = -Infinity;
    for (let t = 0; t < 300; t++) { w.update(1 / 60); max = Math.max(max, w.p); }
    expect(max).toBeLessThanOrEqual(target + 0.05);
    expect(w.p).toBe(target);
    const s = new Wheel();
    s.grab(0); s.drag(0.3, 0.01); s.release(0.5);
    expect(s.target).toBe(0);
  });
  it("finds the nearest slot for a position, wrapping round the sequence", () => {
    expect(nearestSlot(0, 9, 10)).toBe(-1);
    expect(nearestSlot(20, 3, 10)).toBe(23);
    expect(mod(-1, 12)).toBe(11);
  });
  it("gives each pod one slot; fewer Pokémon than pods each appear once", () => {
    const s = podSlots(5.3, 1025) as number[];
    expect(new Set(s).size).toBe(PODS);
    s.forEach((v, k) => expect(mod(v, PODS)).toBe(k));
    expect(Math.max(...s.map((v) => Math.abs(v - 5)))).toBeLessThanOrEqual(6);
    const few = podSlots(0, 3).filter((v) => v !== null) as number[];
    expect(few.map((v) => mod(v, 3)).sort()).toEqual([0, 1, 2]);
    expect(podSlots(0, 0).every((v) => v === null)).toBe(true);
  });
});

describe("battle roles", () => {
  const set = [
    { stats: [50, 100, 50, 50, 50, 100] as Stats6 },
    { stats: [50, 50, 50, 50, 50, 50] as Stats6 },
    { stats: [100, 50, 100, 50, 100, 50] as Stats6 },
    { stats: [50, 50, 50, 50, 50, 50] as Stats6 },
  ];
  const table = roleTable(set);
  it("uses the owner's formulas", () => {
    const ps = ROLES.find((r) => r.key === "physicalSweeper")!;
    expect(standing(set[0].stats, table, ps).score).toBe(200);
    const wall = ROLES.find((r) => r.key === "wall")!;
    expect(standing(set[2].stats, table, wall).score).toBe(300);
  });
  it("ranks with real percentiles; ties share the better rank", () => {
    const ps = ROLES.find((r) => r.key === "physicalSweeper")!;
    const top = standing(set[0].stats, table, ps);
    expect(top.rank).toBe(1);
    expect(top.top).toBe(25);
    const tie = standing(set[1].stats, table, ps);
    expect(tie.rank).toBe(2);
    expect(standings(set[2], table).best).toBe("wall");
  });
});

describe("lab data", () => {
  const all = labRows().map(fromRow);
  it("has every species and form, each with a figure box", () => {
    expect(all.filter((m) => !m.isForm)).toHaveLength(1025);
    expect(all.every((m) => m.box[2] > 0 && m.box[3] > 0)).toBe(true);
  });
  it("keeps the form id list in step with the sizes data", () => {
    expect(new Set(SIZE_FORMS.map((f) => f.id))).toEqual(new Set(SIZE_FORM_IDS));
  });
  it("filters and sorts like the Pokédex; forms follow their species", () => {
    expect(buildSequence(all, DEFAULT_VIEW)).toHaveLength(1025);
    const fire = buildSequence(all, { ...DEFAULT_VIEW, types: ["fire", "flying"] }).map((i) => all[i]);
    expect(fire.every((m) => m.types.includes("fire") && m.types.includes("flying"))).toBe(true);
    const forms = buildSequence(all, { ...DEFAULT_VIEW, forms: true }).map((i) => all[i].id);
    expect(forms.indexOf(10034)).toBe(forms.indexOf(6) + 1);
    const fast = buildSequence(all, { ...DEFAULT_VIEW, sort: "spe" }).map((i) => all[i]);
    expect(fast[0].stats[5]).toBeGreaterThanOrEqual(fast[1].stats[5]);
  });
  it("search jumps by name or number", () => {
    const seq = buildSequence(all, DEFAULT_VIEW);
    expect(all[seq[searchSequence(all, seq, "pika")[0]]].name).toBe("Pikachu");
    expect(all[seq[searchSequence(all, seq, "6")[0]]].id).toBe(6);
  });
  it("round-trips the view through the URL", () => {
    const v = { ...DEFAULT_VIEW, types: ["fire"], gens: [1, 3], legends: true, sort: "wall" as const, reverse: true };
    expect(viewFromParams(viewToParams(v, 6))).toEqual(v);
  });
  it("serves details for a species and a form", () => {
    const d = labDetails(6)!;
    expect(d.entry?.text.length).toBeGreaterThan(10);
    expect(d.evolution?.id).toBe(4);
    expect(labDetails(10034)!.abilities.length).toBeGreaterThan(0);
  });
});
