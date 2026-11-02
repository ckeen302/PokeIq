import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import pokedex from "@/data/pokedex.json";
import { BOARD_ART_LAST_ID, BOARD_ART_SIZE, artUrl, boardArtUrl } from "@/lib/pokemon/art";

/** PokéConnections' boards show the static pictures in public/art (scripts/board-art.ts). */
describe("board art", () => {
  const dir = path.join(process.cwd(), "public/art", String(BOARD_ART_SIZE));

  it("has a static picture for every species in the Pokédex", () => {
    const ids = (pokedex as { id: number }[]).map((p) => p.id);
    expect(Math.max(...ids)).toBeLessThanOrEqual(BOARD_ART_LAST_ID);
    const missing = ids.filter((id) => !fs.existsSync(path.join(dir, `${id}.webp`)));
    // Run `npx tsx scripts/board-art.ts` after the Pokédex grows.
    expect(missing).toEqual([]);
  });

  it("files are WebP, and small", () => {
    for (const id of [1, 25, 493, 1025]) {
      const buf = fs.readFileSync(path.join(dir, `${id}.webp`));
      expect(buf.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(buf.subarray(8, 12).toString("latin1")).toBe("WEBP");
      expect(buf.length).toBeLessThan(30_000);
    }
  });

  it("points species at the static file and everything else at /api/art", () => {
    expect(boardArtUrl(25)).toBe("/art/160/25.webp");
    expect(boardArtUrl(1025)).toBe("/art/160/1025.webp");
    expect(boardArtUrl(10_100)).toBe(artUrl(10_100, 160));
    expect(boardArtUrl(0)).toBe(artUrl(0, 160));
  });
});
