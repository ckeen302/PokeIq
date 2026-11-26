import { describe, expect, it } from "vitest";
import { achievementCloser, type GeoAchievementState } from "@/lib/geo-achievements";

/**
 * The end screen's medal row, when a game earned nothing new: the achievement
 * the game brought closest (its count went up between the read before the game
 * and the one after), and nothing at all when nothing moved.
 */

const state = (id: string, have: number, need: number, earned = false): GeoAchievementState => ({ id, have, need, earned });
const read = (...achievements: GeoAchievementState[]) => ({ achievements });

describe("the achievement a game brought closer", () => {
  it("is the nearest to done of those that moved", () => {
    const before = read(state("perfect-10", 3, 10), state("perfect-100", 3, 100), state("daily-7", 2, 7));
    const after = read(state("perfect-10", 4, 10), state("perfect-100", 4, 100), state("daily-7", 2, 7));
    expect(achievementCloser(before, after)?.id).toBe("perfect-10");
  });

  it("leaves out what didn't move, what's earned, and one-step badges", () => {
    const before = read(state("perfect-10", 3, 10), state("streak-10", 9, 10), state("weekly-champion", 0, 1));
    const after = read(state("perfect-10", 3, 10), state("streak-10", 10, 10, true), state("weekly-champion", 1, 1));
    expect(achievementCloser(before, after)).toBeNull();
  });

  it("says nothing without both reads", () => {
    const one = read(state("perfect-10", 3, 10));
    expect(achievementCloser(null, one)).toBeNull();
    expect(achievementCloser(one, null)).toBeNull();
    expect(achievementCloser(one, one)).toBeNull();
  });
});
