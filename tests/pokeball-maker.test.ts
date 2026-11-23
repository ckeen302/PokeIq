import { describe, expect, it } from "vitest";
import { blankDesign, cleanDesc, cleanName, decodeDesign, encodeDesign, FINISHES, LINK_MAX, MAX_STICKERS, type Design } from "@/lib/pokeball-maker/design";
import { BALL_IDS, ballPreset, ITEM_KEY, pokemonPreset, randomDesign, typePreset, TYPES } from "@/lib/pokeball-maker/presets";
import { PATTERNS, PATTERN_COUNT } from "@/lib/pokeball-maker/patterns";
import { GLYPH_COUNT } from "@/lib/pokeball-maker/glyphs";
import { dimsOf, fullProfile, latheSolid, printParts, stlBytes, volume, watertight } from "@/lib/pokeball-maker/geometry";
import { fromB64Url, toB64Url } from "@/lib/share/link-bytes";
import { catchPose, idlePose, openPose, OPEN_SECONDS, CATCH_SECONDS } from "@/lib/pokeball-maker/anim";
import enItems from "@/data/i18n/ja/items.json";

/** A small seeded random (so a "random" design is the same every run). */
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function full(): Design {
  const d = randomDesign(seeded(7));
  d.effect = { kind: "lightning", colours: [[1, 2, 3], [250, 251, 252], [9, 8, 7]] };
  d.stickers = Array.from({ length: MAX_STICKERS }, (_, i) => ({ glyph: (i * 5) % GLYPH_COUNT, az: i * 4000, pol: 30000 + i, size: i * 20, rot: i * 7, colour: [i, 2 * i, 3 * i] as [number, number, number] }));
  d.inside = { id: 1025, shiny: true, custom: Uint8Array.from([2, 0, 6, 0, 0, 1, 0, 1]) };
  d.name = "Ember Orb ✨";
  d.desc = "A ball that glows warm when the Pokémon inside is happy. Feels a little heavy.";
  return d;
}

describe("Poké Ball Maker design links", () => {
  it("round-trips every field exactly", () => {
    for (const d of [blankDesign(), full(), ...BALL_IDS.map(ballPreset), ...TYPES.map(typePreset)]) {
      const s = encodeDesign(d);
      expect(s.length).toBeLessThan(LINK_MAX);
      const back = decodeDesign(s);
      expect(back).not.toBeNull();
      expect(encodeDesign(back!)).toBe(s);
      expect(back!.colours).toEqual(d.colours);
      expect(back!.finishes).toEqual(d.finishes);
      expect(back!.stickers).toEqual(d.stickers);
      expect(back!.name).toBe(cleanName(d.name));
      expect(back!.desc).toBe(cleanDesc(d.desc));
      expect(back!.inside.id).toBe(d.inside.id);
      expect(back!.inside.shiny).toBe(d.inside.shiny);
      expect(back!.effect.kind).toBe(d.effect.kind);
    }
  });

  it("round-trips random designs", () => {
    const rnd = seeded(42);
    for (let k = 0; k < 300; k++) {
      const d = randomDesign(rnd);
      const s = encodeDesign(d);
      expect(encodeDesign(decodeDesign(s)!)).toBe(s);
    }
  });

  it("never throws on bad links, and rejects them", () => {
    const good = fromB64Url(encodeDesign(full()))!;
    expect(decodeDesign(null)).toBeNull();
    expect(decodeDesign("")).toBeNull();
    expect(decodeDesign("!!!")).toBeNull();
    expect(decodeDesign("A".repeat(LINK_MAX + 4))).toBeNull();
    expect(decodeDesign(toB64Url(Uint8Array.from([...good, 0])))).toBeNull();
    for (let n = 0; n < good.length; n++) expect(decodeDesign(toB64Url(good.subarray(0, n)))).toBeNull();
    const wrongVersion = good.slice();
    wrongVersion[0] = 9;
    expect(decodeDesign(toB64Url(wrongVersion))).toBeNull();
    const badFinish = good.slice();
    badFinish[2 + 18] = FINISHES.length;
    expect(decodeDesign(toB64Url(badFinish))).toBeNull();
    // Random bytes: whatever they are, the decoder answers without throwing.
    const rnd = seeded(3);
    for (let k = 0; k < 3000; k++) {
      const bytes = Uint8Array.from({ length: 2 + Math.floor(rnd() * 90) }, () => Math.floor(rnd() * 256));
      bytes[0] = 1;
      expect(() => decodeDesign(toB64Url(bytes))).not.toThrow();
    }
    // Mutating one byte of a good link: decodes to something valid or to null, never throws.
    for (let n = 0; n < good.length; n++) {
      for (const v of [0, 1, 255, 128]) {
        const m = good.slice();
        m[n] = v;
        const d = decodeDesign(toB64Url(m));
        if (d) expect(decodeDesign(encodeDesign(d))).not.toBeNull();
      }
    }
  });

  it("cleans names and descriptions", () => {
    expect(cleanName("  Fire​   ball\n ")).toBe("Fire ball");
    expect(Array.from(cleanName("x".repeat(80))).length).toBe(24);
    expect(Array.from(cleanDesc("y ".repeat(200))).length).toBeLessThanOrEqual(120);
  });
});

describe("Poké Ball Maker presets", () => {
  it("covers every official ball, each with its own look and an official name", () => {
    const wanted = ["poke", "great", "ultra", "master", "safari", "sport", "park", "dream", "beast", "cherish", "premier", "fast", "friend", "heavy", "level", "love", "lure", "moon", "net", "dive", "nest", "repeat", "timer", "luxury", "dusk", "heal", "quick", "strange", "origin", "hisui-poke", "hisui-great", "hisui-ultra", "hisui-heavy", "feather", "wing", "jet", "leaden", "gigaton"];
    expect([...BALL_IDS].sort()).toEqual([...wanted].sort());
    const seen = new Set<string>();
    for (const id of BALL_IDS) {
      const link = encodeDesign(ballPreset(id));
      expect(seen.has(link)).toBe(false);
      seen.add(link);
      expect((enItems as Record<string, string>)[ITEM_KEY[id]]).toBeTruthy();
    }
    for (const id of ["hisui-poke", "feather", "jet", "gigaton"] as const) expect(ballPreset(id).shape).toBe("hisui");
    expect(ballPreset("origin").shape).toBe("faceted");
  });

  it("has a theme for every type", () => {
    expect(TYPES.length).toBe(18);
    for (const t of TYPES) expect(decodeDesign(encodeDesign(typePreset(t)))).not.toBeNull();
  });

  it("makes a ball from a Pokémon's colours and types", () => {
    const d = pokemonPreset({ id: 6, types: ["fire", "flying"], colours: [[240, 128, 48], [48, 104, 120], [248, 208, 120], [40, 40, 40], [250, 250, 250]] });
    expect(d.colours.top).toEqual([240, 128, 48]);
    expect(PATTERNS[d.patterns.top.id].key).toBe("flames");
    expect(d.effect.kind).toBe("fire");
    expect(d.inside.id).toBe(6);
    expect(decodeDesign(encodeDesign(d))).not.toBeNull();
  });

  it("has enough patterns", () => {
    expect(PATTERN_COUNT - 1).toBeGreaterThanOrEqual(25);
  });
});

describe("Poké Ball Maker printing", () => {
  it("every printed piece is watertight and faces out", () => {
    for (const d of [blankDesign(), ballPreset("hisui-poke"), ballPreset("origin"), { ...blankDesign(), band: 0 }, { ...blankDesign(), band: 255, button: "glow" as const }]) {
      const parts = printParts(d);
      expect(parts.map((p) => p.key)).toEqual(expect.arrayContaining(["top", "bottom", "coupler"]));
      for (const p of parts) {
        const w = watertight(p.solid);
        expect(w, `${p.key}`).toMatchObject({ ok: true, bad: 0 });
        expect(volume(p.solid)).toBeGreaterThan(0);
        // Laid flat: nothing below the bed, something on it.
        let minZ = Infinity;
        for (let i = 2; i < p.solid.pos.length; i += 3) minZ = Math.min(minZ, p.solid.pos[i]);
        expect(minZ).toBeCloseTo(0, 3);
      }
    }
  });

  it("has a real wall and the right size", () => {
    const dm = dimsOf(blankDesign(), "print");
    const half = latheSolid(fullProfile(dm), dm.radial);
    // A 60 mm ball's half with a 3 mm wall: about 2/3 π (30³ − 27³) less the recess.
    const v = volume(half);
    expect(v).toBeGreaterThan(9000);
    expect(v).toBeLessThan(15500);
    const bytes = stlBytes(printParts(blankDesign()).map((p) => p.solid));
    const n = new DataView(bytes.buffer).getUint32(80, true);
    expect(bytes.length).toBe(84 + n * 50);
  });
});

describe("Poké Ball Maker animation", () => {
  it("is a pure function of time", () => {
    for (const t of [0, 0.3, 1.234, 2.5, OPEN_SECONDS - 0.01]) expect(openPose(t)).toEqual(openPose(t));
    expect(idlePose(5)).toEqual(idlePose(5));
    expect(catchPose(1.7)).toEqual(catchPose(1.7));
  });

  it("opens with an overshoot, and wobbles three times before the click", () => {
    let peak = 0;
    for (let t = 0; t < OPEN_SECONDS; t += 1 / 120) peak = Math.max(peak, openPose(t).lid);
    const rest = openPose(1.6).lid;
    expect(peak).toBeGreaterThan(rest * 1.05);
    expect(openPose(0).lid).toBe(0);
    let swings = 0, last = 0;
    for (let t = 0; t < CATCH_SECONDS; t += 1 / 240) {
      const w = catchPose(t).wobble;
      if (Math.abs(w) > 0.2 && Math.sign(w) !== Math.sign(last) && Math.abs(last) > 0.2) swings++;
      if (Math.abs(w) > 0.2) last = w;
    }
    expect(swings).toBeGreaterThanOrEqual(2);
    const clicked = Array.from({ length: 200 }, (_, i) => catchPose((i / 200) * CATCH_SECONDS).click).some((c) => c > 0.5);
    expect(clicked).toBe(true);
  });
});
