import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The 3D Lab's video exports print the site's address on their end cards: it comes from SITE_URL (src/lib/site.ts),
// so a custom domain set with NEXT_PUBLIC_SITE_URL reaches every card, and no export carries a host of its own.
const DIRS = ["games", "race", "mass-battle", "world-history", "pokemon-story"];
const files = DIRS.flatMap((d) => readdirSync(join("src/components", d)).filter((f) => /^(record\.ts|Make\w+Video\.tsx)$/.test(f)).map((f) => join("src/components", d, f)));

describe("Lab video exports: the site's address", () => {
  it("finds every export's recorder and dialog", () => {
    expect(files.length).toBe(DIRS.length * 2);
  });
  it.each(files)("%s names no host of its own", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(src).not.toMatch(/NEXT_PUBLIC_SITE_URL/);
  });
});
