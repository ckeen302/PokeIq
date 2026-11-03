import { describe, expect, it } from "vitest";
import { Director, type ArmySummary, type FieldSummary, type ShotName } from "@/lib/mass-battle/director";
import { EV, EVENT_INTS } from "@/lib/mass-battle/constants";
import { moveStyle } from "@/components/mass-battle/scene/effects";
import { lookFor, normTerrain, normTime, normWeather, TIMES, WEATHERS } from "@/components/mass-battle/scene/look";
import { noteLabel, statusFxType } from "@/components/mass-battle/damage-numbers";
import { NOTE, NOTE_CONFUSION, NOTE_SKIP } from "@/lib/mass-battle/constants";
import { formsOf, type Fighter } from "@/lib/mass-battle/damage";
import { FORM_FIGURES, formFigures, speciesForms } from "@/components/mass-battle/scene/forms";
import type { MBSpecies } from "@/lib/mass-battle/types";
import { noteLabel as label } from "@/components/mass-battle/damage-numbers";
import { BattleView, HIT_TYPES, LEAD, drawMask } from "@/components/mass-battle/view";
import type { SimFrame, SimReady } from "@/components/mass-battle/protocol";
import { ARENAS } from "@/lib/mass-battle/types";

const army = (cx: number, alive: number, start: number, h: number, extent: number, speed = 0): ArmySummary => ({ alive, start, cx, cz: 0, extent, fx: cx > 0 ? cx - extent : cx + extent, fz: 0, h, speed });

describe("mass battle visuals: the director cuts like a trailer", () => {
  it("establishes, charges at ground level, slows for the impact, then cuts round the melee and ends on the finale", () => {
    const d = new Director();
    let field: FieldSummary = { t: 0, phase: "deploy", armies: [army(-25, 500, 500, 0.4, 12), army(25, 1, 1, 2, 1)], boss: { x: 25, z: 0, h: 2, side: 1 }, arena: 70, aspect: 1.6 };
    d.reset(field);
    const shots: ShotName[] = [];
    const note = () => { if (shots[shots.length - 1] !== d.shot) shots.push(d.shot); };
    for (let i = 0; i < 20; i++) { d.update(field, 0.1); note(); }
    // The charge: the armies close in.
    for (let i = 0; i < 40; i++) {
      const gap = Math.max(0, 50 - i * 1.4);
      field = { ...field, t: i * 0.1, phase: "battle", armies: [army(-gap / 2 - 12, 500, 500, 0.4, 12, 8), army(gap / 2 + 1, 1, 1, 2, 1, 6)], boss: { x: gap / 2 + 1, z: 0, h: 2, side: 1 } };
      d.update(field, 0.1);
      note();
    }
    expect(shots[0]).toBe("establish");
    expect(shots).toContain("charge");
    // Contact: the impact in slow motion.
    field = { ...field, armies: [army(-12.5, 480, 500, 0.4, 12, 3), army(1.5, 1, 1, 2, 1, 1)], boss: { x: 1.5, z: 0, h: 2, side: 1 } };
    d.update(field, 0.1);
    note();
    expect(d.shot).toBe("impact");
    expect(d.timeScale).toBeLessThan(0.5);
    for (let i = 0; i < 200; i++) { d.update(field, 0.1); note(); }
    expect(d.timeScale).toBe(1);
    expect(new Set(shots).size).toBeGreaterThanOrEqual(5);
    expect(shots.some((s) => s === "boss" || s === "hero")).toBe(true);
    // A crowd knocked out at once: a slow-motion cut.
    d.offer({ kind: "multi", x: 0, z: 0, h: 2, power: 1 });
    d.update(field, 0.1);
    expect(d.shot).toBe("slowmo");
    expect(d.timeScale).toBeLessThan(0.5);
    // The end.
    d.update({ ...field, phase: "ended", armies: [army(-12, 300, 500, 0.4, 10), army(1.5, 0, 1, 2, 0)] }, 0.1);
    expect(d.shot).toBe("finale");
  });

  it("keeps slow motion off when the viewer turns it off", () => {
    const d = new Director();
    const field: FieldSummary = { t: 0, phase: "battle", armies: [army(-3, 50, 50, 1, 4), army(3, 50, 50, 1, 4)], boss: null, arena: 40, aspect: 1.6 };
    d.reset({ ...field, phase: "deploy" });
    d.allowSlow = false;
    for (let i = 0; i < 30; i++) {
      d.update(field, 0.1);
      expect(d.timeScale).toBe(1);
    }
    d.offer({ kind: "multi", x: 0, z: 0, h: 1, power: 1 });
    d.update(field, 0.1);
    expect(d.timeScale).toBe(1);
  });

  it("never puts the camera below the ground or at a silly distance", () => {
    for (const aspect of [1.6, 1080 / 1920]) {
      const d = new Director();
      const field: FieldSummary = { t: 0, phase: "deploy", armies: [army(-40, 2000, 2000, 1, 20, 8), army(40, 2000, 2000, 1.6, 20, 8)], boss: null, arena: 120, aspect };
      d.reset(field);
      for (let i = 0; i < 400; i++) {
        const gap = Math.max(0, 80 - i * 0.6);
        const p = d.update({ ...field, phase: i < 20 ? "deploy" : "battle", armies: [army(-gap / 2 - 20, 2000 - i * 3, 2000, 1, 20, 6), army(gap / 2 + 20, 2000 - i * 4, 2000, 1.6, 20, 6)] }, 0.1);
        const camY = p.ty + Math.sin(p.pitch) * p.dist;
        expect(camY).toBeGreaterThan(-0.01);
        expect(p.dist).toBeGreaterThan(0.4);
        expect(p.dist).toBeLessThan(2000);
        expect(Number.isFinite(p.yaw) && Number.isFinite(p.pitch) && Number.isFinite(p.tx)).toBe(true);
      }
    }
  });
});

describe("mass battle visuals: moves and weather", () => {
  it("draws ranged moves by their kind and contact moves as strikes", () => {
    expect(moveStyle("Hyper Beam", "Normal", false)).toBe("beam");
    expect(moveStyle("Ice Beam", "Ice", false)).toBe("beam");
    expect(moveStyle("Thunderbolt", "Electric", false)).toBe("bolt");
    expect(moveStyle("Thunder", "Electric", false)).toBe("sky");
    expect(moveStyle("Flamethrower", "Fire", false)).toBe("stream");
    expect(moveStyle("Hydro Pump", "Water", false)).toBe("stream");
    expect(moveStyle("Shadow Ball", "Ghost", false)).toBe("orb");
    expect(moveStyle("Stone Edge", "Rock", false)).toBe("erupt");
    expect(moveStyle("Psychic", "Psychic", false)).toBe("wave");
    expect(moveStyle("Air Slash", "Flying", false)).toBe("volley");
    expect(moveStyle("Judgment", "Normal", false)).toBe("sky");
    expect(moveStyle("Close Combat", "Fighting", true)).toBe("strike");
  });

  it("reads a weather from any of the battle's names for it", () => {
    expect(normWeather("Rain Dance")).toBe("rain");
    expect(normWeather("rain")).toBe("rain");
    expect(normWeather("Harsh Sunlight")).toBe("sun");
    expect(normWeather("Sunny Day")).toBe("sun");
    expect(normWeather("Sandstorm")).toBe("sand");
    expect(normWeather("Hail")).toBe("snow");
    expect(normWeather("Snowscape")).toBe("snow");
    expect(normWeather(undefined)).toBe("none");
    expect(normWeather("clear")).toBe("none");
    expect(normTime("night")).toBe("night");
    expect(normTime("sunset")).toBe("dusk");
    expect(normTime(undefined)).toBe("day");
  });

  it("labels what happens to a unit besides a hit", () => {
    expect(noteLabel(NOTE.HEAL, 25)?.text).toBe("+25");
    expect(noteLabel(NOTE.CHIP, 12)?.text).toBe("−12");
    expect(noteLabel(NOTE.STATUS, 2)?.text).toBe("Burned");
    expect(noteLabel(NOTE.STATUS, NOTE_CONFUSION)?.text).toBe("Confused");
    // Attack +2: stat 0 × 16 + 2 + 8.
    expect(noteLabel(NOTE.BOOST, 10)?.text).toBe("Attack ↑↑");
    // Speed −1.
    expect(noteLabel(NOTE.BOOST, 4 * 16 + 7)?.text).toBe("Speed ↓");
    expect(noteLabel(NOTE.SKIP, NOTE_SKIP.flinch)?.text).toBe("Flinched");
    expect(noteLabel(99, 1)).toBeNull();
    expect(statusFxType(1)).toBe("Electric");
    expect(statusFxType(2)).toBe("Fire");
    expect(statusFxType(6)).toBe("Ice");
    expect(normTerrain("electric")).toBe("electric");
    expect(normTerrain("Misty Terrain")).toBe("misty");
    expect(normTerrain("none")).toBe("none");
  });

  it("has a look for every arena, time of day and weather", () => {
    const hex = /^#[0-9a-f]{6}$/i;
    for (const a of ARENAS) for (const t of TIMES) for (const w of WEATHERS) {
      const l = lookFor(a, t, w);
      for (const c of [l.skyTop, l.skyHorizon, l.sunGlow, l.cloudColor, l.fog, l.sun, l.hemiSky, l.hemiGround, l.rim]) expect(c).toMatch(hex);
      expect(l.sunIntensity).toBeGreaterThan(0.3);
      expect(l.exposure).toBeGreaterThan(0.5);
      expect(l.fogDensity).toBeGreaterThan(0);
    }
    expect(lookFor("plains", "day", "rain").wet).toBe(1);
    expect(lookFor("plains", "night", "none").stars).toBe(1);
  });
});

describe("mass battle visuals: the view", () => {
  const ready = (n: number, sides: number[]): SimReady => ({
    type: "ready",
    id: 1,
    n,
    arena: 30,
    species: [25],
    sp: new Uint16Array(n),
    side: Uint8Array.from(sides),
    maxHp: [100],
    radius: [0.3],
    start: [sides.filter((s) => s === 0).length, sides.filter((s) => s === 1).length],
    moves: [[{ name: "Thunderbolt", type: "Electric", cat: "Special", contact: false, spread: false }]],
    fighters: [{ level: 100, ability: "Static", item: "", nature: "Hardy", tera: "" }],
    field: { weather: "none", terrain: "none", time: "day" },
    frame: frame(0, n, []),
    setupMs: 1,
  });
  function frame(tick: number, n: number, events: number[]): SimFrame {
    return { tick, pos: new Float32Array(n * 2).map((_, i) => i), hp: new Uint16Array(n).fill(100), target: new Int32Array(n).fill(-1), events: Int32Array.from(events), notes: new Int32Array(0), left: [1, 1], ended: false, winner: 2 };
  }

  it("launches a move before it lands, and lands it once", () => {
    const r = ready(2, [0, 1]);
    const v = new BattleView(r, 100);
    const launches: number[] = [], hits: number[] = [];
    v.onLaunch = (h) => launches.push(h.t);
    v.onHit = (h) => hits.push(h.t);
    const ev = [0, 1, 0, 30, EV.CRIT, 7];
    expect(ev.length).toBe(EVENT_INTS);
    const frames: SimFrame[] = [];
    for (let k = 1; k <= 20; k++) frames.push(frame(k, 2, k === 12 ? ev : []));
    v.push(frames);
    const hitT = (12 - 0.5) / 20;
    let launchedAt = -1, hitAt = -1;
    for (let k = 0; k < 120; k++) {
      v.advance(1 / 120);
      if (launches.length && launchedAt < 0) launchedAt = v.t;
      if (hits.length && hitAt < 0) hitAt = v.t;
    }
    expect(launches).toHaveLength(1);
    expect(hits).toHaveLength(1);
    expect(launches[0]).toBeCloseTo(hitT, 5);
    // The launch fires LEAD seconds of battle time ahead of the hit.
    expect(hitAt - launchedAt).toBeGreaterThan(LEAD - 0.02);
    // The attacker's lunge peaks as the hit lands.
    expect(v.attackAt[0]).toBeCloseTo(hitT - 0.18, 5);
  });

  it("remembers each hit's move type for the colour of its flash (a miss changes nothing)", () => {
    const r = ready(3, [0, 1, 1]);
    const v = new BattleView(r, 100);
    const frames: SimFrame[] = [];
    for (let k = 1; k <= 20; k++) frames.push(frame(k, 3, k === 5 ? [0, 1, 0, 30, 0, 7] : k === 8 ? [0, 2, 0, 0, EV.MISS, 7] : []));
    v.push(frames);
    for (let k = 0; k < 120; k++) v.advance(1 / 120);
    expect(v.hitType[1]).toBe(HIT_TYPES.indexOf("Electric") + 1);
    expect(v.hitAt[1]).toBeGreaterThan(0);
    expect(v.hitType[2]).toBe(0);
    expect(v.hitAt[2]).toBe(-1);
  });

  it("starts each unit in its species' form and changes it when a FORM note passes", () => {
    const r = ready(2, [0, 1]);
    const v = new BattleView(r, 100);
    v.startForms([1]);
    expect([...v.form]).toEqual([1, 1]);
    const frames: SimFrame[] = [];
    for (let k = 1; k <= 20; k++) frames.push(k === 6 ? { ...frame(k, 2, []), notes: Int32Array.from([1, NOTE.FORM, 0, -1]) } : frame(k, 2, []));
    v.push(frames);
    for (let k = 0; k < 120; k++) v.advance(1 / 120);
    expect([...v.form]).toEqual([1, 0]);
  });

  it("draws a representative share of a big army and every boss", () => {
    const n = 1001;
    const sp = new Uint16Array(n);
    sp[n - 1] = 1;
    const mask = drawMask({ n, sp, species: [19, 150] }, 200);
    expect(mask[n - 1]).toBe(1);
    const drawn = mask.reduce((a, b) => a + b, 0);
    expect(drawn).toBeGreaterThan(190);
    expect(drawn).toBeLessThanOrEqual(200);
  });
});

describe("mass battle visuals: forms", () => {
  const moves = [{ name: "Shadow Ball", type: "Ghost" }, { name: "Iron Head", type: "Steel" }, { name: "Close Combat", type: "Fighting" }];
  const cases: { calc: string; types: string[]; ability: string; tera: string }[] = [
    { calc: "Aegislash", types: ["steel", "ghost"], ability: "Stance Change", tera: "" },
    { calc: "Wishiwashi", types: ["water"], ability: "Schooling", tera: "" },
    { calc: "Minior-Meteor", types: ["rock", "flying"], ability: "Shields Down", tera: "" },
    { calc: "Eiscue", types: ["ice"], ability: "Ice Face", tera: "" },
    { calc: "Greninja", types: ["water", "dark"], ability: "Protean", tera: "" },
    { calc: "Cinderace", types: ["fire"], ability: "Libero", tera: "" },
    { calc: "Greninja", types: ["water", "dark"], ability: "Protean", tera: "Water" },
    { calc: "Pikachu", types: ["electric"], ability: "Static", tera: "" },
  ];

  it("reads the engine's forms the way the engine does (same rule, same forms in the same order)", () => {
    for (const c of cases) {
      const engine = formsOf({ species: { calc: c.calc, types: c.types }, set: { ability: c.ability, tera: c.tera, moves } } as unknown as Fighter);
      const mine = speciesForms({ calc: c.calc, types: c.types }, { ability: c.ability, tera: c.tera, level: 100 }, moves);
      expect(mine.rule, c.calc).toBe(engine.rule);
      expect(mine.forms.length, c.calc).toBe(engine.forms.length);
      // A Protean form is its move's type.
      engine.forms.forEach((f, k) => { if (f.types) expect(mine.forms[k].label).toBe(`${f.types[0]} type`); });
    }
    expect(speciesForms({ calc: "Aegislash", types: ["steel", "ghost"] }, { ability: "Stance Change", tera: "", level: 50 }, moves).forms[1]).toMatchObject({ label: "Blade Forme", figure: FORM_FIGURES.aegislashBlade });
  });

  it("starts Wishiwashi schooled from level 20, as the engine does", () => {
    const at = (level: number) => speciesForms({ calc: "Wishiwashi", types: ["water"] }, { ability: "Schooling", tera: "", level }, moves).initial;
    expect(at(19)).toBe(0);
    expect(at(20)).toBe(1);
    expect(at(100)).toBe(1);
  });

  it("gives a form with a figure its documented size and render box (src/data/race-forms.json), and Protean none", async () => {
    const base = { id: 746, slug: "wishiwashi", name: "Wishiwashi", calc: "Wishiwashi", types: ["water"], m: 0.2, kg: 0.3, shape: "fish", box: [61, 154, 390, 204, 512] } as unknown as MBSpecies;
    const school = speciesForms(base, { ability: "Schooling", tera: "", level: 100 }, moves);
    const figs = await formFigures([base], [school]);
    expect(figs).toHaveLength(1);
    expect(figs[0]).toMatchObject({ sp: 0, form: 1, relief: "/race/depth/10127.webp" });
    expect(figs[0].species.m).toBeCloseTo(8.2, 5);
    expect(figs[0].species.box).toEqual([11, 100, 491, 312, 512]);
    expect(figs[0].art(512)).toBe("/api/race/home/10127?s=512");
    const greninja = { ...base, calc: "Greninja", types: ["water", "dark"] } as MBSpecies;
    expect(await formFigures([greninja], [speciesForms(greninja, { ability: "Protean", tera: "", level: 100 }, moves)])).toHaveLength(0);
  });

  it("names form changes and Truant's lost turns", () => {
    expect(label(NOTE.FORM, 1, "Blade Forme")).toEqual({ text: "Blade Forme", cls: "mb-dmg-form" });
    expect(label(NOTE.FORM, 1)).toBeNull();
    expect(label(NOTE.SKIP, NOTE_SKIP.loafing)?.text).toBe("Loafing around");
  });
});
