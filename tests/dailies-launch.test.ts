import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { streakNote } from "@/components/connections/results";
import { feedbackQuestion } from "@/components/connections/social";
import { describeShare, type PikadokuShareResult } from "@/lib/share";
import { BADGES } from "@/lib/progress";

const source = (path: string) => readFileSync(new URL(`../src/components/${path}`, import.meta.url), "utf8");

describe("the dailies' result copy", () => {
  it("only calls a streak a record once there is a run", () => {
    expect(streakNote(1, 1)).toBe("Play tomorrow to keep it going");
    expect(streakNote(1, 0)).toBe("Play tomorrow to keep it going");
    expect(streakNote(2, 2)).toBe("Your best streak yet!");
    expect(streakNote(5, 3)).toBe("Your best streak yet!");
    expect(streakNote(1, 4)).toBe("Best: 4 days");
    expect(streakNote(2, 9)).toBe("Best: 9 days");
  });

  it("asks about today's puzzle only on the live daily", () => {
    expect(feedbackQuestion(true)).toBe("How was today's puzzle?");
    expect(feedbackQuestion(false)).toBe("How was this puzzle?");
    expect(source("connections/Connections.tsx")).toContain('today={mode === "daily"}');
  });

  it("names Pikadoku's score the way the game does: a rarity score", () => {
    const result: PikadokuShareResult = { game: "pikadoku", daily: 4, difficulty: "normal", grid: "yyyyyyyyx", score: 900 };
    expect(describeShare(result).detail).toBe("Filled 8 of 9 cells · rarity score 900");
    expect(BADGES.find((b) => b.id === "pdk-rare")?.description).toBe("A Pikadoku rarity score under 50");
  });
});

describe("the dailies on a phone", () => {
  it("lets the Pokédex notebook's header and filters wrap instead of widening the page", () => {
    const dex = source("pokedle/DexPanel.tsx");
    expect(dex).toContain('"flex items-center justify-between gap-2 max-sm:flex-wrap"');
    expect(dex).toContain('"flex gap-2 max-sm:flex-wrap"');
    expect(dex).toContain("max-sm:basis-full");
  });

  it("keeps the hint chips and Pikadoku's More controls thumb-sized", () => {
    expect(source("pokedle/Pokedle.tsx")).toMatch(/takeHint\(h\)[\s\S]{0,400}max-sm:min-h-10/);
    const pdk = source("pikadoku/Pikadoku.tsx");
    for (const id of ["pdk-more", "pdk-mode-weekly", "pdk-archive-btn"]) expect(pdk).toMatch(new RegExp(`data-testid="${id}"[^\\n]*max-sm:min-h-10`));
  });
});

describe("PokéConnections on a phone", () => {
  it("docks Shuffle, Deselect and Submit above the tab bar in the daily, the duel and the party", () => {
    const parts = source("connections/parts.tsx");
    expect(parts).toMatch(/CONTROLS_DOCK =\s*"max-sm:sticky max-sm:bottom-\[var\(--tabbar-h\)\]/);
    expect(parts).toContain('CONTROLS_WRAP = "max-sm:contents');
    for (const file of ["Connections.tsx", "ConnectionsDuel.tsx", "ConnectionsParty.tsx"]) {
      const src = source(`connections/${file}`);
      expect(src, file).toContain("CONTROLS_WRAP)}>");
      expect(src, file).toMatch(/CONTROLS_DOCK\)} data-testid="conn-controls"/);
    }
  });
});
