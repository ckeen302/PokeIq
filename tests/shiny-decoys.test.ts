import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { encodeOption, makeDecoys, meanDeltaE, MIN_DELTA_E, MIN_PAIR_DELTA_E, OUT_SIZE, PROFILES, SHINY_DIFFICULTIES, type Raw } from "../scripts/shiny/decoys";

function sprite(rgb: [number, number, number]): Raw {
  const w = 16;
  const data = new Uint8Array(w * w * 4);
  for (let i = 0; i < w * w; i++) {
    const inside = i % w > 3 && i % w < 12 && Math.floor(i / w) > 3 && Math.floor(i / w) < 12;
    data.set(inside ? [...rgb, 255] : [0, 0, 0, 0], i * 4);
  }
  return { data, width: w, height: w };
}

describe("shiny difficulty profiles", () => {
  it.each(SHINY_DIFFICULTIES.flatMap((d) => [[d, [240, 190, 40]], [d, [210, 210, 210]], [d, [30, 30, 40]]]) as [(typeof SHINY_DIFFICULTIES)[number], [number, number, number]][])(
    "%s: decoys clear the floors for %j",
    (difficulty, rgb) => {
      const real = sprite(rgb);
      const { min, pair } = PROFILES[difficulty];
      const decoys = makeDecoys(real, 77, difficulty);
      for (const d of decoys) expect(meanDeltaE(real, d.raw)).toBeGreaterThanOrEqual(min);
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(meanDeltaE(decoys[i].raw, decoys[j].raw)).toBeGreaterThanOrEqual(pair);
    }
  );
  it("hard is tighter than normal, which is tighter than easy", () => {
    const real = sprite([240, 190, 40]);
    const far = (d: (typeof SHINY_DIFFICULTIES)[number]) => meanDeltaE(real, makeDecoys(real, 5, d)[2].raw);
    expect(far("hard")).toBeLessThan(far("normal"));
    expect(far("normal")).toBeLessThan(far("easy"));
  });
});

describe("shiny decoys", () => {
  it.each([[[240, 190, 40]], [[200, 200, 205]], [[40, 40, 45]], [[250, 250, 250]]] as [[number, number, number]][])(
    "meet the minimum difference even for %j",
    (rgb) => {
      const real = sprite(rgb);
      const decoys = makeDecoys(real, 25);
      expect(decoys.map((d) => d.tier)).toEqual(["near", "medium", "far"]);
      const diffs = decoys.map((d) => meanDeltaE(real, d.raw));
      for (const d of diffs) expect(d).toBeGreaterThanOrEqual(MIN_DELTA_E);
      expect(diffs[0]).toBeLessThan(diffs[1]);
      expect(diffs[1]).toBeLessThan(diffs[2]);
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(meanDeltaE(decoys[i].raw, decoys[j].raw)).toBeGreaterThanOrEqual(MIN_PAIR_DELTA_E);
    }
  );

  it("keeps transparency and encodes every option identically", async () => {
    const real = sprite([240, 190, 40]);
    const decoys = makeDecoys(real, 3);
    const outs = await Promise.all([real, ...decoys.map((d) => d.raw)].map(encodeOption));
    for (const buf of outs) {
      const meta = await sharp(buf).metadata();
      expect([meta.format, meta.width, meta.height, meta.hasAlpha, meta.exif, meta.icc]).toEqual(["webp", OUT_SIZE, OUT_SIZE, true, undefined, undefined]);
    }
    for (const d of decoys) expect(d.raw.data[3]).toBe(0);
  });

  it("is deterministic", () => {
    const real = sprite([30, 120, 220]);
    expect(makeDecoys(real, 9).map((d) => d.deltaE)).toEqual(makeDecoys(real, 9).map((d) => d.deltaE));
  });
});
