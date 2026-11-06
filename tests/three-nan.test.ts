import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LuminosityHighPassShader } from "three/examples/jsm/shaders/LuminosityHighPassShader.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import { THREE_MAIN, THREE_READ, scrubRead } from "@/lib/gl/safe-hdr";

/**
 * Apple GPUs follow IEEE strictly: pow() of a slightly negative value is NaN
 * (others give 0), and a bloom spreads one NaN pixel into black blocks. The
 * same guard as World History's film (tests/world-history.test.ts), for every
 * other 3D module on the site.
 */

const root = join(process.cwd(), "src/components");
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

const MODULES: Record<string, string> = {
  sizes: "sizes",
  race: "race",
  "battle arena": "battle/play/arena",
  timeline: "timeline",
  globe: "globe",
  trainer3d: "trainer3d",
  games: "games",
};

describe.each(Object.entries(MODULES))("%s never draws NaN", (_name, dir) => {
  const files = sources(join(root, dir));

  it("has its sources", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("takes no pow() of a value that can dip below zero", () => {
    for (const f of files) {
      // GLSL only: JavaScript's Math.pow is fine.
      const src = readFileSync(f, "utf8").replace(/Math\.pow\(/g, "");
      // Raw interpolated UVs and signed differences squared through pow() are the shapes that go NaN.
      expect(src, f).not.toMatch(/pow\(\s*(vUv|vY|uv|vT)\b/);
      expect(src, f).not.toMatch(/pow\(\s*\(/);
      expect(src, f).not.toMatch(/pow\(\s*[a-zA-Z_][\w.]*\s*\/\s*[\d.]+\s*,/);
      // 1 - dot(unit, unit) can come out a hair below zero.
      expect(src, f).not.toMatch(/pow\(\s*1\.0?\s*-\s*(max\(\s*)?dot\(/);
    }
  });

  it("never divides by a bare fwidth() (0/0 on a flat pixel)", () => {
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/\/\s*fwidth\(/);
  });
});

describe("post chains scrub NaN before the bloom can spread it", () => {
  it("Sizes: the scene copy, depth of field, grade and the bloom's first read", () => {
    const post = readFileSync(join(root, "sizes/scene/post.ts"), "utf8");
    expect(post).toContain("scrubRead(CopyShader.fragmentShader)");
    expect(post).toContain("scrubBloom(bloom)");
    expect((post.match(/glSafe\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("Race: the grade, the photo finish and the bloom's first read", () => {
    const post = readFileSync(join(root, "race/scene/post.ts"), "utf8");
    expect(post).toContain("scrubBloom(bloom)");
    expect(post).toContain("glSafe(b.rgb)");
    expect(readFileSync(join(root, "race/scene/index.ts"), "utf8")).toContain("glSafe(texture2D(t, vUv).rgb)");
  });

  it("patches lines that three.js's shaders still have", () => {
    for (const s of [LuminosityHighPassShader.fragmentShader, CopyShader.fragmentShader]) {
      expect(s).toContain(THREE_MAIN);
      expect(s).toContain(THREE_READ);
      const patched = scrubRead(s);
      expect(patched).toContain("floatBitsToUint");
      expect(patched).toContain("texel.rgb = glSafe( texel.rgb );");
    }
  });
});
