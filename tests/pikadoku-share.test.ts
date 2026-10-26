import { describe, expect, it } from "vitest";
import { rarityGrid, rarityLetter, rarityLines } from "@/lib/pikadoku/share";
import { decodeShare, describeShare, encodeShare, pikadokuShareText, type PikadokuShareResult } from "@/lib/share";

describe("rarity colours", () => {
  it("uses the thresholds: under 1, under 10, under 25, 25 and over, black for empty", () => {
    expect(rarityLetter(0, true)).toBe("p");
    expect(rarityLetter(0.9, true)).toBe("p");
    expect(rarityLetter(1, true)).toBe("b");
    expect(rarityLetter(9.9, true)).toBe("b");
    expect(rarityLetter(10, true)).toBe("g");
    expect(rarityLetter(24.9, true)).toBe("g");
    expect(rarityLetter(25, true)).toBe("y");
    expect(rarityLetter(100, true)).toBe("y");
    expect(rarityLetter(0.1, false)).toBe("x");
    expect(rarityLetter(null, false)).toBe("x");
    expect(rarityLetter(null, true)).toBe("g"); // rarity off: a solved cell is still marked
  });
  it("builds nine letters and three emoji lines", () => {
    const pcts = [0.5, 5, 20, 30, null, 99, 0, 2, 12];
    const grid = rarityGrid((i) => i !== 4 && i !== 8, pcts);
    expect(grid).toBe("pbgyxypbx");
    expect(rarityLines(grid)).toEqual(["🟪🟦🟩", "🟨⬛🟨", "🟪🟦⬛"]);
  });
});

describe("share payload and card", () => {
  const result: PikadokuShareResult = { game: "pikadoku", daily: 4, difficulty: "normal", grid: "pbgyxypbx", score: 183.4, streak: 3 };
  it("round-trips and carries colours only", () => {
    const path = encodeShare(result);
    expect(path).toBe("pdk.n4.fn.gpbgyxypbx.q1834.k3");
    expect(decodeShare(path)).toEqual(result);
    expect(path).not.toMatch(/[A-Z]/); // no names, no Pokémon
  });
  it("rejects forged or malformed payloads", () => {
    for (const bad of ["pdk.fn.gpbgyxypb", "pdk.fn.gpbgyxypbxx", "pdk.fn.gpbgyxypbq", "pdk.fq.gpbgyxypbx", "pdk.n4.z2.fn.gpbgyxypbx", "pdk.fn"]) expect(decodeShare(bad)).toBeNull();
  });
  it("describes the board in rarity tiles and shares emoji text with the link", () => {
    const view = describeShare(result);
    expect(view.headline).toBe("7/9");
    expect(view.tiles[0]).toEqual(["pdk-purple", "pdk-blue", "pdk-green"]);
    expect(view.tiles[2][2]).toBe("pdk-empty");
    const text = pikadokuShareText(result, "https://example.test/s/x");
    expect(text.split("\n")).toEqual(["PokéIQ Pikadoku #4 7/9", "Rarity: 183.4 🔥3", "🟪🟦🟩", "🟨⬛🟨", "🟪🟦⬛", "https://example.test/s/x"]);
  });
  it("labels archive and unlimited games", () => {
    expect(pikadokuShareText({ ...result, archive: true, streak: undefined }).split("\n")[0]).toContain("#4 (archive)");
    expect(pikadokuShareText({ game: "pikadoku", difficulty: "normal", grid: "xxxxxxxxx" }).split("\n")[0]).toBe("PokéIQ Pikadoku (Unlimited) 0/9");
  });
});
