import { describe, expect, it } from "vitest";
import {
  DUEL_COUNTDOWN_MS,
  DUEL_HP,
  DUEL_TURBO_CAP_MS,
  REVEAL_BEATS,
  SUPER_EFFECTIVE_MIN,
  closesAfterGuess,
  countValue,
  countdownAfterGuess,
  hpAfter,
  hpBefore,
  hpColor,
  rampMultiplier,
  revealTimeline,
  roundDamage,
  seatMultipliers,
} from "@/lib/geo-duel-rules";
import { createDuel, duelView, guessDuel, joinDuel, parseDuelSettings, readyDuel, rematchOf, touchDuel, type Duel } from "@/lib/server/duel";
import { DUEL_LEAD_MS, DUEL_ROUND_MS } from "@/lib/duel-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

describe("the multiplier ramp", () => {
  it("is ×1 for rounds 1–3, ×1.5 for 4–6, ×2 for 7–9, then +0.5 every three rounds", () => {
    expect([...Array(13)].map((_, i) => rampMultiplier(i))).toEqual([1, 1, 1, 1.5, 1.5, 1.5, 2, 2, 2, 2.5, 2.5, 2.5, 3]);
    expect(rampMultiplier(-1)).toBe(1);
  });

  it("gives each seat its own multiplier", () => {
    expect(seatMultipliers(0)).toEqual([1, 1]);
    expect(seatMultipliers(4)).toEqual([1.5, 1.5]);
    expect(seatMultipliers(7, 2)).toHaveLength(2);
  });
});

describe("damage", () => {
  it("is the gap times the round winner's own multiplier, in full", () => {
    expect(roundDamage([5000, 3200], [1.5, 2])).toEqual({ winner: 0, hurt: 1, damage: 2700, multiplier: 1.5 });
    expect(roundDamage([1000, 4000], [1.5, 2])).toEqual({ winner: 1, hurt: 0, damage: 6000, multiplier: 2 });
    expect(roundDamage([2500, 2500], [3, 3])).toEqual({ winner: null, hurt: null, damage: 0, multiplier: 1 });
  });

  it("rounds to a whole number", () => {
    expect(roundDamage([1001, 0], [1.5, 1.5]).damage).toBe(1502);
  });

  it("is shown in full even past the loser's remaining HP, which never goes below 0", () => {
    const hit = roundDamage([5000, 0], [2, 2]);
    expect(hit.damage).toBe(10_000);
    expect(hpAfter([6000, 1200], hit.hurt, hit.damage)).toEqual([6000, 0]);
    expect(hpAfter([6000, 1200], null, 0)).toEqual([6000, 1200]);
  });

  it("knows the HP before a round from the rounds before it", () => {
    expect(hpBefore([], 0)).toEqual([DUEL_HP, DUEL_HP]);
    expect(hpBefore([{ hp: [6000, 4100] }, { hp: [5000, 4100] }], 2)).toEqual([5000, 4100]);
    expect(hpBefore([{ hp: [6000, 4100] }], 1)).toEqual([6000, 4100]);
  });
});

describe("Turbo", () => {
  it("caps the opponent's remaining time at 10 s instead of 15", () => {
    expect(countdownAfterGuess(false)).toBe(DUEL_COUNTDOWN_MS);
    expect(countdownAfterGuess(true)).toBe(DUEL_TURBO_CAP_MS);
    expect(DUEL_TURBO_CAP_MS).toBe(10_000);
    const start = 1_000_000;
    expect(closesAfterGuess(start, DUEL_ROUND_MS, null)).toBe(start + DUEL_ROUND_MS);
    expect(closesAfterGuess(start, DUEL_ROUND_MS, start + 20_000)).toBe(start + 35_000);
    expect(closesAfterGuess(start, DUEL_ROUND_MS, start + 20_000, true)).toBe(start + 30_000);
  });

  it("never gives more time than the round has left", () => {
    const start = 1_000_000;
    expect(closesAfterGuess(start, DUEL_ROUND_MS, start + 85_000, true)).toBe(start + DUEL_ROUND_MS);
    expect(closesAfterGuess(start, DUEL_ROUND_MS, start + 80_000)).toBe(start + DUEL_ROUND_MS);
  });

  it("is a party setting the server parses, keeps on the duel and carries into a rematch", () => {
    expect(parseDuelSettings(undefined, undefined, true)).toEqual({ mode: "hp", turbo: true });
    expect(parseDuelSettings("race", 3, true)).toEqual({ mode: "race", rounds: 3, turbo: true });
    expect(parseDuelSettings("hp", undefined, "yes")).toEqual({ mode: "hp" });
    const T0 = 1_800_000_000_000;
    const { duel, playerId: red } = createDuel("kanto", "Red", "abcdefgh", T0, "turbo-seed", undefined, { mode: "hp", turbo: true });
    expect(duel.turbo).toBe(true);
    const joined = joinDuel(duel, "Blue", T0 + 1000);
    if (!joined.ok) throw new Error(joined.error);
    const blue = joined.playerId;
    let d: Duel = joined.duel;
    for (const [id, t] of [[red, T0 + 2000], [blue, T0 + 2500]] as const) {
      const out = readyDuel(d, id, true, t);
      if (!out.ok) throw new Error(out.error);
      d = out.duel;
    }
    const startsAt = d.rounds[0].startsAt;
    expect(startsAt).toBe(T0 + 2500 + DUEL_LEAD_MS);
    const view = duelView(d, red, startsAt, 0);
    expect(view.turbo).toBe(true);
    expect(view.round?.endsAt).toBe(startsAt + DUEL_ROUND_MS);
    // Red guesses 20 s in: Blue has 10 s, not 15.
    const guessed = guessDuel(d, red, 0, { x: 0.5, y: 0.5 }, startsAt + 20_000);
    if (!guessed.ok) throw new Error(guessed.error);
    expect(duelView(guessed.duel, blue, startsAt + 20_000, 0).round?.endsAt).toBe(startsAt + 30_000);
    const again = rematchOf(guessed.duel, "hjkmnpqr", startsAt + 60_000);
    expect(again.turbo).toBe(true);
  });

  it("stamps each seat's multiplier and the winner's on every round result", () => {
    const T0 = 1_800_000_000_000;
    const { duel, playerId: red } = createDuel("kanto", "Red", "abcdefgh", T0, "stamp-seed");
    const joined = joinDuel(duel, "Blue", T0 + 1000);
    if (!joined.ok) throw new Error(joined.error);
    const blue = joined.playerId;
    let d: Duel = joined.duel;
    for (const id of [red, blue]) {
      const out = readyDuel(d, id, true, T0 + 2000);
      if (!out.ok) throw new Error(out.error);
      d = out.duel;
    }
    const startsAt = d.rounds[0].startsAt;
    for (const [id, pin] of [[red, { x: 0.5, y: 0.5 }], [blue, { x: 0.1, y: 0.9 }]] as const) {
      const out = guessDuel(d, id, 0, pin, startsAt + 5000);
      if (!out.ok) throw new Error(out.error);
      d = out.duel;
    }
    d = touchDuel(d, red, startsAt + 6000);
    const [first] = duelView(d, red, startsAt + 6000, 0).revealed;
    expect(first.multipliers).toEqual([1, 1]);
    expect(first.hpBefore).toEqual([DUEL_HP, DUEL_HP]);
    if (first.winner === null) {
      expect(first).toMatchObject({ hurt: null, damage: 0, multiplier: 1 });
    } else {
      expect(first.hurt).toBe(1 - first.winner);
      expect(first.multiplier).toBe(first.multipliers[first.winner]);
      const gap = Math.abs(first.guesses[0]!.score - first.guesses[1]!.score);
      expect(first.damage).toBe(gap);
      expect(first.hp[first.hurt!]).toBe(DUEL_HP - gap);
    }
  });
});

describe("the HP bar's colour", () => {
  it("is green, yellow from half and red from a fifth", () => {
    expect(hpColor(1)).toBe("green");
    expect(hpColor(0.51)).toBe("green");
    expect(hpColor(0.5)).toBe("yellow");
    expect(hpColor(0.21)).toBe("yellow");
    expect(hpColor(0.2)).toBe("red");
    expect(hpColor(0)).toBe("red");
  });
});

describe("the reveal's timeline", () => {
  it("counts scores up, floats the damage, drains the bar, then rests", () => {
    const t = revealTimeline({ hurt: 1, damage: 800 });
    expect(t.scoresAt).toBe(0);
    expect(t.scoresDone).toBe(REVEAL_BEATS.scores);
    expect(t.damageAt).toBe(REVEAL_BEATS.scores + REVEAL_BEATS.gap);
    expect(t.drainAt).toBe(t.damageAt! + REVEAL_BEATS.float);
    expect(t.drainDone).toBe(t.drainAt! + REVEAL_BEATS.drain);
    expect(t.superAt).toBeNull();
    expect(t.total).toBeGreaterThan(t.drainDone!);
  });

  it("pops 'super effective' on a big hit, and skips the damage beats on a tie", () => {
    const big = revealTimeline({ hurt: 0, damage: SUPER_EFFECTIVE_MIN });
    expect(big.superAt).toBe(big.drainAt);
    const tie = revealTimeline({ hurt: null, damage: 0 });
    expect(tie.damageAt).toBeNull();
    expect(tie.drainAt).toBeNull();
    expect(tie.total).toBe(REVEAL_BEATS.scores + REVEAL_BEATS.gap);
  });

  it("lands everything at once under reduced motion", () => {
    const t = revealTimeline({ hurt: 1, damage: 3000 }, true);
    expect(t).toEqual({ scoresAt: 0, scoresDone: 0, damageAt: 0, drainAt: 0, drainDone: 0, superAt: 0, total: 0 });
  });

  it("counts a number up with an ease-out", () => {
    expect(countValue(0, 4000, 0, 1000)).toBe(0);
    expect(countValue(0, 4000, 1000, 1000)).toBe(4000);
    expect(countValue(0, 4000, 2000, 1000)).toBe(4000);
    const half = countValue(0, 4000, 500, 1000);
    expect(half).toBeGreaterThan(2000);
    expect(half).toBeLessThan(4000);
    expect(countValue(6000, 2000, 500, 1000)).toBeLessThan(4000);
    expect(countValue(0, 10, 5, 0)).toBe(10);
  });
});
