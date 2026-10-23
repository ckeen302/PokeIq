import { describe, expect, it } from "vitest";
import { practiceConnPuzzle } from "@/lib/server/connections";

// Unlimited lets a player pick any pack with any difficulty; every pair must deal a puzzle.
describe("Unlimited: every pack and difficulty deals a puzzle", () => {
  for (const pack of ["", "kanto-", "gen9-", "competitive-"])
    for (const level of ["", "easy-", "hard-"])
      it(`${pack || "all-"}${level || "normal-"}`, () => {
        for (let i = 0; i < 6; i++) expect(practiceConnPuzzle(`${pack}${level}seed${i}abc`).groups).toHaveLength(4);
      });
});
