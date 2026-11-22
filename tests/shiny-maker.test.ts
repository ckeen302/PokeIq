import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hueDiff, inGamut, lchToRgb, rgbToLch } from "@/lib/shiny-maker/color";
import { b64decode, b64encode, decodeSpecies, rleDecode, rleEncode, type SpeciesFile } from "@/lib/shiny-maker/data";
import { cleanName, decodeDesign, encodeDesign, fitsSpecies, fromB64Url, newDesign, quantise, toB64Url, type Design } from "@/lib/shiny-maker/design";
import { decodeGif, encodeGif } from "@/lib/shiny-maker/gif";
import { DEFAULT_ID, firstDesign, presetParts, randomParts, rng } from "@/lib/shiny-maker/presets";
import { partRefs, renderPixels, slotColours, transform } from "@/lib/shiny-maker/recolor";

const species = (id: number) => decodeSpecies(JSON.parse(readFileSync(`public/shiny-maker/px/${id}.json`, "utf8")) as SpeciesFile);

describe("shiny maker: colour", () => {
  it("round-trips sRGB through OKLCH", () => {
    for (const rgb of [[0, 0, 0], [255, 255, 255], [238, 131, 41], [32, 115, 148], [12, 200, 90]] as [number, number, number][]) {
      const c = rgbToLch(...rgb);
      expect(lchToRgb(c.l, c.c, c.h)).toEqual([...rgb]);
    }
  });

  it("maps out-of-gamut colours by lowering chroma only (same lightness and hue)", () => {
    const rgb = lchToRgb(0.7, 0.4, 145); // far outside sRGB
    const back = rgbToLch(...rgb);
    expect(back.l).toBeCloseTo(0.7, 2);
    expect(Math.abs(hueDiff(145, back.h))).toBeLessThan(2.5);
    expect(back.c).toBeLessThan(0.4);
    expect(inGamut(back.l, back.c * 0.999, back.h)).toBe(true);
  });
});

describe("shiny maker: species data", () => {
  it("run-length codes pixel indices losslessly", () => {
    const idx = Array.from({ length: 2000 }, (_, i) => (i % 700 < 300 ? 0 : (i >> 4) % 9));
    const back = rleDecode(b64decode(b64encode(rleEncode(idx))), idx.length);
    expect(Array.from(back, (v) => v + 1)).toEqual(idx);
  });

  it("loads every species file, each slot in exactly one part", () => {
    const files = readdirSync("public/shiny-maker/px").filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(1025);
    for (const f of files) {
      const raw = JSON.parse(readFileSync(`public/shiny-maker/px/${f}`, "utf8")) as SpeciesFile;
      const sp = decodeSpecies(raw);
      const seen = new Set<number>();
      for (const p of sp.parts) for (const s of p.s) {
        expect(seen.has(s)).toBe(false);
        seen.add(s);
      }
      expect(seen.size).toBe(sp.slots.length);
      expect(sp.parts.length).toBeLessThanOrEqual(8);
      if (raw.hd) expect(raw.hd.length).toBe(sp.parts.length);
    }
  });

  it("rejects malformed data", () => {
    expect(() => decodeSpecies({ v: 9 } as unknown as SpeciesFile)).toThrow();
    const good = JSON.parse(readFileSync("public/shiny-maker/px/25.json", "utf8")) as SpeciesFile;
    expect(() => decodeSpecies({ ...good, slots: ["zzzzzz:000000"] })).toThrow();
  });

  it("reproduces the official shiny exactly from the slots", () => {
    const sp = species(6);
    const d = newDesign(6, sp.parts.length, 1);
    const px = renderPixels(sp, d, "official");
    const yours = renderPixels(sp, d, "yours");
    expect(Buffer.from(px).equals(Buffer.from(yours))).toBe(true);
  });
});

describe("shiny maker: recolour", () => {
  it("keeps each part's lightness ramp in order (shading kept)", () => {
    const sp = species(6);
    const refs = partRefs(sp, 0);
    for (const target of [{ l: 0.3, c: 0.05, h: 285, k: 1 }, { l: 0.8, c: 0.14, h: 82, k: 1 }, { l: 0.6, c: 0.2, h: 150, k: 1.4 }]) {
      sp.parts.forEach((p, pi) => {
        const shades = p.s.map((s) => sp.slots[s].nl).sort((a, b) => a.l - b.l);
        const out = shades.map((c) => transform(c, refs[pi], target).l);
        for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1] - 1e-9);
        for (const l of out) {
          expect(l).toBeGreaterThan(0);
          expect(l).toBeLessThan(1);
        }
      });
    }
  });

  it("lands the part's middle shade on the chosen colour", () => {
    const sp = species(25);
    const refs = partRefs(sp, 0);
    const t = quantise({ l: 0.62, c: 0.12, h: 210, k: 1 });
    const out = transform(refs[0], refs[0], t);
    expect(out.l).toBeCloseTo(t.l, 6);
    expect(out.c).toBeCloseTo(t.c, 6);
  });

  it("only produces in-gamut colours", () => {
    const sp = species(94);
    const d = newDesign(94, sp.parts.length, 0);
    d.parts = presetParts(sp, d, "neon");
    for (const rgb of slotColours(sp, d).rgb) for (const v of rgb) expect(v >= 0 && v <= 255 && Number.isInteger(v)).toBe(true);
  });

  it("inverts hue by rotating it, not by inverting lightness", () => {
    const sp = species(1);
    const d = newDesign(1, sp.parts.length, 0);
    d.parts = presetParts(sp, d, "inverted");
    const refs = partRefs(sp, 0);
    d.parts.forEach((p, i) => {
      if (!p.col) return;
      expect(p.col.l).toBeCloseTo(refs[i].l, 2);
      expect(Math.abs(hueDiff(refs[i].h + 180, p.col.h))).toBeLessThan(1);
    });
  });
});

describe("shiny maker: randomise", () => {
  it("leaves locked parts and the outline alone, and is reproducible with a seed", () => {
    const sp = species(6);
    const d = firstDesign(sp);
    const locked = new Set([0, 2]);
    const a = randomParts(sp, d, locked, rng(42));
    const b = randomParts(sp, d, locked, rng(42));
    expect(a).toEqual(b);
    for (const i of locked) expect(a[i]).toBe(d.parts[i]);
    sp.parts.forEach((p, i) => { if (p.o) expect(a[i]).toBe(d.parts[i]); });
    expect(a.some((p, i) => !locked.has(i) && !sp.parts[i].o && p !== d.parts[i])).toBe(true);
  });

  it("keeps each part's lightness close to its own (readable)", () => {
    const sp = species(149);
    const d = newDesign(149, sp.parts.length, 0);
    const refs = partRefs(sp, 0);
    for (let seed = 0; seed < 20; seed++) {
      randomParts(sp, d, new Set(), rng(seed)).forEach((p, i) => {
        if (p.col) expect(Math.abs(p.col.l - Math.min(0.94, Math.max(0.18, refs[i].l)))).toBeLessThan(0.1);
      });
    }
  });
});

describe("shiny maker: design links", () => {
  const sample = (): Design => {
    const sp = species(DEFAULT_ID);
    const d = firstDesign(sp);
    return { ...d, style: "hd", finish: "holo", sparkle: true, glow: true, bg: "none", name: "Ember Night ✨", shades: { 3: [12, 200, 255] } };
  };

  it("round-trips a design exactly", () => {
    const d = sample();
    const s = encodeDesign(d);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeLessThan(120);
    const back = decodeDesign(s)!;
    expect(back).toEqual({ ...d, parts: d.parts.map((p) => ({ src: p.src, col: p.col && quantise(p.col) })) });
    expect(encodeDesign(back)).toBe(s);
  });

  it("re-quantising is stable (what you see is what the link carries)", () => {
    for (let i = 0; i < 200; i++) {
      const r = rng(i);
      const c = quantise({ l: r(), c: r() * 0.4, h: r() * 360, k: 0.25 + r() * 1.7 });
      expect(quantise(c)).toEqual(c);
    }
  });

  it("renders the same pixels from the link", () => {
    const sp = species(DEFAULT_ID);
    const d = { ...sample(), style: "px" as const };
    const back = decodeDesign(encodeDesign(d))!;
    expect(Buffer.from(renderPixels(sp, back)).equals(Buffer.from(renderPixels(sp, d)))).toBe(true);
  });

  it("rejects junk, other versions, bad species and trailing bytes", () => {
    for (const bad of ["", "!!!", "a", "AAAA", "x".repeat(700), "<script>", "AQAG", "AgAGAAAAAQ"]) expect(decodeDesign(bad)).toBeNull();
    const good = encodeDesign(sample());
    const bytes = fromB64Url(good)!;
    const v3 = Uint8Array.from(bytes); v3[0] = 3;
    expect(decodeDesign(toB64Url(v3))).toBeNull();
    const id0 = Uint8Array.from(bytes); id0[1] = 0; id0[2] = 0;
    expect(decodeDesign(toB64Url(id0))).toBeNull();
    const big = Uint8Array.from(bytes); big[1] = 0x0f; big[2] = 0xff;
    expect(decodeDesign(toB64Url(big))).toBeNull();
    expect(decodeDesign(toB64Url(Uint8Array.from([...bytes, 0])))).toBeNull();
    expect(decodeDesign(toB64Url(bytes.subarray(0, bytes.length - 2)))).toBeNull();
  });

  it("checks a design against its species", () => {
    const sp = species(DEFAULT_ID);
    const d = firstDesign(sp);
    expect(fitsSpecies(d, sp.parts.length, sp.slots.length)).toBe(true);
    expect(fitsSpecies({ ...d, parts: d.parts.slice(1) }, sp.parts.length, sp.slots.length)).toBe(false);
    expect(fitsSpecies({ ...d, shades: { 250: [0, 0, 0] } }, sp.parts.length, sp.slots.length)).toBe(false);
  });

  it("cleans names (length, control and invisible characters)", () => {
    expect(cleanName("  Hello​   world\n ")).toBe("Hello world");
    expect(Array.from(cleanName("x".repeat(80))).length).toBe(24);
  });
});

describe("shiny maker: GIF", () => {
  it("encodes and decodes frames losslessly", () => {
    const W = 37, H = 23;
    const frames = [0, 1, 2].map((f) => {
      const rgba = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        if ((i + f) % 7 === 0) continue;
        const c = [((i + f) % 15) * 17, ((i >> 4) % 8) * 30, 100];
        rgba.set([...c, 255], i * 4);
      }
      return { rgba, delay: 120 };
    });
    const gif = decodeGif(encodeGif(W, H, frames));
    expect(gif.width).toBe(W);
    expect(gif.frames.length).toBe(3);
    gif.frames.forEach((f, i) => {
      expect(f.delay).toBe(120);
      expect(Buffer.from(f.rgba).equals(Buffer.from(frames[i].rgba))).toBe(true);
    });
  });
});

describe("shiny maker: styles", () => {
  it("encodes every style and reads old v1 links (3D flag, animated flag)", async () => {
    const { STYLES, toB64Url: b64 } = await import("@/lib/shiny-maker/design");
    const sp = species(DEFAULT_ID);
    for (const style of STYLES) {
      const d = { ...firstDesign(sp), style };
      expect(decodeDesign(encodeDesign(d))?.style).toBe(style);
    }
    // v1: [1] id form flags finish n, one untouched part.
    const v1 = (flags: number) => b64(Uint8Array.from([1, 0, 6, 0, flags, 0, 1, 1]));
    expect(decodeDesign(v1(0))?.style).toBe("px");
    expect(decodeDesign(v1(1))?.style).toBe("hd");
    expect(decodeDesign(v1(32))?.style).toBe("sd");
    // v2 rejects reserved flag bits and unknown styles.
    const good = fromB64Url(encodeDesign(firstDesign(sp)))!;
    const bad1 = Uint8Array.from(good); bad1[4] |= 1;
    expect(decodeDesign(toB64Url(bad1))).toBeNull();
    const bad2 = Uint8Array.from(good); bad2[5] = 9;
    expect(decodeDesign(toB64Url(bad2))).toBeNull();
  });

  it("matches a picture's colours to the parts (normal and shiny pairs, the outline left out)", async () => {
    const { makeMatcher, matchParts } = await import("@/lib/shiny-maker/match");
    const raw = JSON.parse(readFileSync("public/shiny-maker/px/6.json", "utf8")) as SpeciesFile;
    const m = makeMatcher(matchParts(raw.slots, raw.parts));
    const names = raw.parts.map((p) => p.n);
    // Charizard's own shades land in their own parts: orange body (→ grey shiny), teal wings (→ red), cream belly.
    expect(names[m(238, 131, 41, 131, 123, 148, true)[0]]).toBe("Body");
    expect(names[m(32, 115, 148, 189, 32, 65, true)[0]]).toBe("Wings");
    expect(names[m(238, 222, 123, 222, 222, 172, true)[0]]).toBe("Belly");
    // Black never goes to the outline (only Pixel sprites draw one).
    expect(raw.parts[m(0, 0, 0, 0, 0, 0, true)[0]].o).toBeUndefined();
  });

  it("ships 3D and Artwork masks only with matching reference colours", () => {
    for (const f of readdirSync("public/shiny-maker/px")) {
      const raw = JSON.parse(readFileSync(`public/shiny-maker/px/${f}`, "utf8")) as SpeciesFile;
      for (const kind of ["hd", "art"] as const) {
        const has = readdirSync(`public/shiny-maker/${kind}`).includes(`${raw.id}.png`);
        expect(!!raw[kind]).toBe(has);
      }
    }
  });
});
