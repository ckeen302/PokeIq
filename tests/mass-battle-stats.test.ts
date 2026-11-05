import { describe, expect, it } from "vitest";
import { mvpName, pickMvp } from "@/components/mass-battle/post-stats";

describe("mass battle: post-battle stats", () => {
  it("the MVP comes from the winning side, even when a loser scored more KOs", () => {
    // 100 Pikachu (side 0) beat a Snorlax (side 1) that knocked out 2 of them; one Pikachu got the KO.
    const side = [1, ...Array(100).fill(0)];
    const kos = [2, 1, ...Array(99).fill(0)];
    const dealt = [12656, 120, ...Array(99).fill(40)];
    expect(pickMvp(side, kos, dealt, 0)).toBe(1);
    // In a draw, anyone's.
    expect(pickMvp(side, kos, dealt, 2)).toBe(0);
    // Winners with no KOs (the boss fell to recoil): the one that dealt the most.
    expect(pickMvp([0, 0, 1], [0, 0, 3], [10, 50, 900], 0)).toBe(1);
    // Ties in KOs go to the damage.
    expect(pickMvp([0, 0], [2, 2], [100, 300], 0)).toBe(1);
  });

  it("names the MVP without repeating its species as its side", () => {
    expect(mvpName("Snorlax", "Snorlax")).toBe("Snorlax");
    expect(mvpName("Pikachu", "Pikachu")).toBe("Pikachu");
    expect(mvpName("Charmander", "Kanto starters")).toBe("Charmander (Kanto starters)");
  });
});
