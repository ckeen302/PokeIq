import { describe, expect, it } from "vitest";
import { matchScores, tierOf } from "@/lib/ranked";
import { emptyRankedQueue, planRanked, withRankedWaiter, type Pairable, type RankedQueueRow } from "@/lib/server/ranked-queue";
import { newAnonId, readAnonId } from "@/lib/server/ranked";

/**
 * What ranked PokéGuessr and the battle ladders share: how a finished game
 * scores, the Poké Ball to Master Ball tiers, the signed anonymous ids and
 * the ranked queue's pairing.
 */

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const SECOND = 1000;

describe("scores and tiers", () => {
  it("scores forfeits and walk-outs as losses", () => {
    expect(matchScores("played", 0)).toEqual([1, 0]);
    expect(matchScores("played", null)).toEqual([0.5, 0.5]);
    expect(matchScores("left", 1)).toEqual([0, 1]);
    expect(matchScores("idle", 0)).toEqual([1, 0]);
    // Both walked away with no winner: both lose.
    expect(matchScores("idle", null)).toEqual([0, 0]);
    expect(matchScores("left", null)).toEqual([0, 0]);
  });

  it("names tiers and divisions, with progress to the next", () => {
    expect(tierOf(1000)).toMatchObject({ label: "Poké Ball II", progress: 0, next: { label: "Poké Ball I", at: 1100 } });
    expect(tierOf(950)).toMatchObject({ label: "Poké Ball III", progress: 0.5 });
    expect(tierOf(400)).toMatchObject({ label: "Poké Ball III", progress: 0 });
    expect(tierOf(1199)).toMatchObject({ label: "Poké Ball I", next: { label: "Great Ball III", at: 1200 } });
    expect(tierOf(1200).label).toBe("Great Ball III");
    expect(tierOf(1450)).toMatchObject({ label: "Great Ball I", progress: 0.5 });
    expect(tierOf(1799)).toMatchObject({ label: "Ultra Ball I", next: { label: "Master Ball", at: 1800 } });
    expect(tierOf(2300)).toMatchObject({ label: "Master Ball", division: null, next: null, progress: 1 });
    // Every division is a step up from the last.
    const steps = [950, 1050, 1150, 1250, 1350, 1450, 1550, 1650, 1750, 1850].map((r) => tierOf(r).step);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("anonymous ranked ids", () => {
  it("only accepts ids the server signed", () => {
    const id = newAnonId();
    expect(readAnonId(id)).toMatch(/^[A-Za-z0-9_-]{16}$/);
    // Change one character inside the signature, always to a different one. Swapping the last two for "xx" sometimes
    // left the signature unchanged, or changed only its final character's spare bits, so this failed about once in a
    // thousand runs.
    const at = id.lastIndexOf(".") + 2;
    const tampered = `${id.slice(0, at)}${id[at] === "A" ? "B" : "A"}${id.slice(at + 1)}`;
    expect(readAnonId(tampered)).toBeNull();
    expect(readAnonId("not-a-token")).toBeNull();
  });
});

describe("the ranked queue", () => {
  /** A gap of 100 at once, 15 more each second the longer of the two has waited. */
  const pairable: Pairable = (gap, waits) => gap <= 100 + 15 * Math.floor(Math.max(waits[0], waits[1]) / SECOND);
  const me = (ticket: string, player: string) => ({ ticket, name: player, player });
  const rowWith = (...waiters: [string, number, number][]): RankedQueueRow =>
    waiters.reduce((row, [player, rating, since]) => withRankedWaiter(row, me(`t-${player}`, player), { rating, games: 5 }, since), emptyRankedQueue("test:ranked"));

  it("pairs close ratings at once, distant ones only after waiting", () => {
    // Ash (1,400) has just started waiting: Brock at 1,000 is too far off...
    const row = rowWith(["ash", 1400, T0]);
    expect(planRanked(row, me("t-brock", "brock"), 1000, T0 + SECOND, pairable).kind).toBe("wait");
    // ...Misty at 1,350 isn't.
    expect(planRanked(row, me("t-misty", "misty"), 1350, T0 + SECOND, pairable)).toMatchObject({ kind: "pair", opponent: { player: "ash" } });
    // Twenty seconds on (Ash still polling), 400 points is close enough.
    const later = withRankedWaiter(row, me("t-ash", "ash"), { rating: 1400, games: 5 }, T0 + 20 * SECOND);
    expect(planRanked(later, me("t-brock", "brock"), 1000, T0 + 20 * SECOND, pairable)).toMatchObject({ kind: "pair", opponent: { player: "ash" } });
  });

  it("picks the closest rating, and never the same trainer or a stale one", () => {
    const row = rowWith(["ash", 1100, T0], ["gary", 1040, T0], ["oak", 1000, T0 - 60 * SECOND]);
    // Oak stopped polling long ago; Gary is closer than Ash.
    expect(planRanked(row, me("t-new", "new"), 1010, T0 + SECOND, pairable)).toMatchObject({ kind: "pair", opponent: { player: "gary" } });
    // Gary in a second tab is never paired with Gary.
    expect(planRanked(row, me("t-gary2", "gary"), 1040, T0 + SECOND, pairable)).toMatchObject({ kind: "pair", opponent: { player: "ash" } });
  });
});
