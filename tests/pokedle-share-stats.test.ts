import { describe, expect, it } from "vitest";
import { buildPokedleShare } from "@/lib/share";
import { dleStats, type DleResultLike } from "@/lib/dle-stats";
import type { CellStatus } from "@/lib/dle-types";

const M: CellStatus = "match";
const row = (...s: CellStatus[]) => s;

describe("buildPokedleShare", () => {
  const rows = [
    row("miss", "partial", "miss", "close-higher", "lower", "miss", "higher"),
    row(M, M, M, M, M, M, M),
  ];
  const base = { number: 142, rows, solved: true, hard: false, hints: [], streak: 0, url: "https://pokeiq.vercel.app/pokedle" };

  it("is a three-colour grid, close counting as yellow, with a short link", () => {
    expect(buildPokedleShare(base)).toBe(["PokéIQ Pokédle #142 2/8", "⬛🟨⬛🟨⬛⬛⬛", "🟩🟩🟩🟩🟩🟩🟩", "https://pokeiq.vercel.app/pokedle"].join("\n"));
  });

  it("marks hard mode, hints, the streak and a loss", () => {
    const text = buildPokedleShare({ ...base, solved: false, hard: true, hints: ["genus", "silhouette"], streak: 12 });
    expect(text.split("\n")[0]).toBe("PokéIQ Pokédle #142 X/8* 📖👤 🔥12");
  });

  it("adds the community line only when given, and uses orange and blue for colour-blind players", () => {
    const text = buildPokedleShare({ ...base, colourBlind: true, community: { percentile: 82.4, players: 4213 } });
    expect(text.split("\n")).toEqual(["PokéIQ Pokédle #142 2/8", "⬛🟦⬛🟦⬛⬛⬛", "🟧🟧🟧🟧🟧🟧🟧", "Top 18% of 4,213 trainers", "https://pokeiq.vercel.app/pokedle"]);
  });

  it("marks an archive game and leaves its streak off", () => {
    expect(buildPokedleShare({ ...base, archive: true, streak: 5 }).split("\n")[0]).toBe("PokéIQ Pokédle #142 (archive) 2/8");
  });

  it("never spells out a guess or the answer", () => {
    const text = buildPokedleShare({ ...base, hard: true, hints: ["silhouette"], streak: 3 });
    expect(text.replace("https://pokeiq.vercel.app/pokedle", "").replace("PokéIQ Pokédle", "")).not.toMatch(/[A-Za-z]/);
  });
});

describe("dleStats", () => {
  const won = (n: number, hard = false): DleResultLike => ({ guesses: Array(n).fill(1), solved: true, over: true, hard });
  const lost: DleResultLike = { guesses: Array(8).fill(1), solved: false, over: true };
  const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

  it("counts plays, wins and the guess distribution", () => {
    const s = dleStats({ "2026-10-17": won(3), "2026-10-18": lost, "2026-10-19": won(1, true) }, "2026-10-19");
    expect([s.played, s.wins, s.winPct, s.losses, s.hardWins]).toEqual([3, 2, 67, 1, 1]);
    expect(s.distribution).toEqual([1, 0, 1, 0, 0, 0, 0, 0]);
    expect([s.playStreak, s.winStreak, s.bestWinStreak]).toEqual([3, 1, 1]);
    expect([s.doneToday, s.atRisk]).toEqual([true, false]);
  });

  it("keeps the play streak through a loss, and puts it at risk until today is done", () => {
    const s = dleStats({ "2026-10-17": won(2), "2026-10-18": lost }, "2026-10-19");
    expect([s.playStreak, s.winStreak, s.atRisk]).toEqual([2, 0, true]);
    expect(dleStats({ "2026-10-17": won(2) }, "2026-10-19").playStreak).toBe(0);
  });

  it("earns a freeze every 7 days (2 at most) and spends one on a missed day", () => {
    const results: Record<string, DleResultLike> = {};
    for (const d of days("2026-11-01", 14)) results[d] = won(4);
    // Missed 15 November; played 16 November.
    results["2026-11-16"] = won(4);
    const s = dleStats(results, "2026-11-16");
    expect(s.frozenDays).toEqual(["2026-11-15"]);
    expect([s.playStreak, s.winStreak, s.freezes, s.savedByFreeze]).toEqual([15, 15, 1, true]);

    for (const d of days("2026-11-17", 20)) results[d] = won(4);
    expect(dleStats(results, "2026-12-06").freezes).toBe(2);
    // Three days missed: two freezes, then the streak ends.
    const after = dleStats(results, "2026-12-10");
    expect([after.playStreak, after.freezes, after.bestPlayStreak]).toEqual([0, 0, 35]);
  });

  it("ignores unfinished and future days", () => {
    const s = dleStats({ "2026-10-18": { guesses: [1], solved: false, over: false }, "2026-10-20": won(2) }, "2026-10-19");
    expect([s.played, s.playStreak]).toEqual([0, 0]);
  });
});
