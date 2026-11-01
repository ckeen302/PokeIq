import { describe, expect, it } from "vitest";
import { gradeGeo, isGeoSpec, planRounds, readGeo, readGeoChallenge, startGeo, answerFor, geoChallengeFirstShot, geoChallengeSpec } from "@/lib/server/geo";
import {
  advanceDuel,
  createDuel,
  duelView,
  guessDuel,
  joinDuel,
  parseDuelSettings,
  raceWinner,
  readyDuel,
  rematchOf,
  roundAnswer,
  touchDuel,
  type Duel,
  type DuelOutcome,
} from "@/lib/server/duel";
import { GEO_MAX_ROUND_SCORE, GEO_ROUNDS, GEO_ROUND_OPTIONS, geoBoardKey, geoRoundsOf, isGeoRounds, WORLD_REGION } from "@/lib/geo-types";
import { DUEL_LEAD_MS } from "@/lib/duel-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

/** Plays a whole solo game, every pin on the answer. */
function playSolo(spec: Parameters<typeof startGeo>[0], opts: Parameters<typeof startGeo>[1] = {}) {
  let token = startGeo(spec, opts).token;
  let last;
  for (let i = 0; i < 20; i++) {
    const state = readGeo(token)!;
    const rounds = planRounds(spec, state.seed);
    // The sealed plan is authoritative; ask gradeGeo with the answer pin of the current round.
    const probe = gradeGeo(state, { x: 0, y: 0 });
    if (!probe.ok) throw new Error(probe.error);
    // Grade again on the true pin.
    const [px, py] = probe.body.answer.spot ?? probe.body.answer.pin;
    const out = gradeGeo(state, { x: px, y: py });
    if (!out.ok) throw new Error(out.error);
    token = out.body.token;
    last = out.body;
    if (out.body.done) return { last, rounds, played: i + 1 };
  }
  throw new Error("game never ended");
}

describe("PokéGuessr rounds", () => {
  it("only accepts 3, 5 or 10", () => {
    expect(GEO_ROUND_OPTIONS).toEqual([3, 5, 10]);
    for (const n of [3, 5, 10]) expect(isGeoRounds(n)).toBe(true);
    for (const n of [0, 1, 4, 7, 11, 100, "5", null, undefined]) expect(isGeoRounds(n)).toBe(false);
    expect(isGeoSpec({ region: WORLD_REGION, kind: "game", rounds: 3 })).toBe(true);
    expect(isGeoSpec({ region: WORLD_REGION, kind: "game", rounds: 7 as 3 })).toBe(false);
    expect(geoRoundsOf({})).toBe(GEO_ROUNDS);
    expect(geoRoundsOf({ rounds: 10 })).toBe(10);
  });

  it("plans exactly the picked number of places, all different", () => {
    for (const rounds of GEO_ROUND_OPTIONS) {
      const plan = planRounds({ region: WORLD_REGION, kind: "game", rounds }, "seed-a");
      expect(plan).toHaveLength(rounds);
      // Distinct places: a Route 4 in Kanto and one in Unova are two places.
      expect(new Set(plan.map((r) => `${r.region}|${r.location}`)).size).toBe(rounds);
    }
    expect(planRounds({ region: WORLD_REGION, kind: "game" }, "seed-a")).toHaveLength(5);
  });

  it("plays and scores a game of each length, signed into the token", () => {
    for (const rounds of GEO_ROUND_OPTIONS) {
      const spec = { region: WORLD_REGION, kind: "game" as const, rounds };
      const { token } = startGeo(spec, { seed: `len-${rounds}` });
      expect(readGeo(token)!.spec.rounds).toBe(rounds);
      const { last, played } = playSolo(spec, { seed: `len-${rounds}` });
      expect(played).toBe(rounds);
      expect(last.result!.rounds).toHaveLength(rounds);
      expect(last.result!.score).toBe(rounds * GEO_MAX_ROUND_SCORE);
      expect(last.result!.spec.rounds).toBe(rounds);
    }
  });

  it("keeps the old 5-round board key and gives 3 and 10 their own", () => {
    expect(geoBoardKey({ region: "kanto", kind: "game" })).toBe("kanto");
    expect(geoBoardKey({ region: "kanto", kind: "game", rounds: 5 })).toBe("kanto");
    expect(geoBoardKey({ region: "kanto", kind: "game", rounds: 3 })).toBe("kanto:r3");
    expect(geoBoardKey({ region: "world", kind: "game", era: "2d", rounds: 10 })).toBe("world:2d:r10");
    expect(geoBoardKey({ region: "kanto", kind: "streak" })).toBe("kanto:streak");
  });

  it("carries the round count on a challenge link", () => {
    const spec = { region: "kanto", kind: "game" as const, rounds: 3 as const };
    const { last } = playSolo(spec, { seed: "chal-3", name: "Ash" });
    const card = readGeoChallenge(last.challengeToken)!;
    expect(card.rounds).toHaveLength(3);
    expect(card.plan).toBeTruthy();
    // Starting from the card gives the same three places.
    const again = startGeo({ ...spec, practice: "challenge" }, { seed: card.seed, plan: card.plan });
    expect(readGeo(again.token)!.spec.rounds).toBe(3);
    expect(answerFor(spec, planRounds(spec, card.seed)[0]).name).toBeTruthy();
  });

  it("knows a challenge link's first picture before the game starts (the one the start deals)", () => {
    const spec = { region: "kanto", kind: "game" as const };
    const { last } = playSolo(spec, { seed: "chal-first", name: "Ash" });
    const card = readGeoChallenge(last.challengeToken)!;
    const started = startGeo(geoChallengeSpec(card), { seed: card.seed, plan: card.plan });
    expect(geoChallengeFirstShot(last.challengeToken)).toBe(started.round.shot);
    expect(geoChallengeFirstShot("not-a-token")).toBeNull();
  });
});

const T0 = 1_800_000_000_000;
const SEC = 1000;
const must = (out: DuelOutcome): Duel => {
  if (!out.ok) throw new Error(out.error);
  return out.duel;
};
function race(rounds: number | undefined, seed = "race-seed") {
  const settings = parseDuelSettings("race", rounds)!;
  const { duel, playerId: red } = createDuel("kanto", "Red", "abcdefgh", T0, seed, undefined, settings);
  const joined = joinDuel(duel, "Blue", T0 + SEC);
  if (!joined.ok) throw new Error(joined.error);
  const t = T0 + 2 * SEC;
  const ready = must(readyDuel(must(readyDuel(joined.duel, red, true, t)), joined.playerId, true, t));
  return { duel: ready, ids: [red, joined.playerId], start: t + DUEL_LEAD_MS };
}
const pin = (d: Duel, i: number) => {
  const a = roundAnswer(d, i);
  // The flag: the exact spot of a spot-scored shot, else the place's pin.
  const [x, y] = a.spot ?? a.pin;
  return { x, y };
};
const far = (d: Duel, i: number) => {
  const p = pin(d, i);
  return { x: p.x > 0.5 ? 0 : 1, y: p.y > 0.5 ? 0 : 1 };
};
function playRound(duel: Duel, ids: string[], pins: ({ x: number; y: number } | null)[]) {
  const index = duel.rounds.length - 1;
  const t = duel.rounds[index].startsAt + 2 * SEC;
  let d = ids.reduce((x, id) => touchDuel(x, id, t), duel);
  pins.forEach((p, seat) => {
    if (p) d = must(guessDuel(d, ids[seat], index, p, t));
  });
  for (let at = t; !d.rounds[index].result; ) {
    at += 5 * SEC;
    d = ids.reduce((x, id) => touchDuel(x, id, at), d);
  }
  if (d.status === "playing") d = ids.reduce((x, id) => touchDuel(x, id, d.rounds[index].result!.nextAt), d);
  return d;
}

describe("duel settings", () => {
  it("validates mode and rounds", () => {
    expect(parseDuelSettings(undefined, undefined)).toEqual({ mode: "hp" });
    expect(parseDuelSettings("hp", undefined)).toEqual({ mode: "hp" });
    expect(parseDuelSettings("hp", 3)).toBeNull();
    expect(parseDuelSettings("race", 3)).toEqual({ mode: "race", rounds: 3 });
    expect(parseDuelSettings("race", 10)).toEqual({ mode: "race", rounds: 10 });
    expect(parseDuelSettings("race", undefined)).toEqual({ mode: "race", rounds: 5 });
    expect(parseDuelSettings("race", 4)).toBeNull();
    expect(parseDuelSettings("race", 11)).toBeNull();
    expect(parseDuelSettings("battle", 5)).toBeNull();
  });

  it("an HP duel stays an HP duel by default", () => {
    const { duel } = createDuel("kanto", "Red", "abcdefgh", T0);
    expect(duel.mode).toBeUndefined();
    expect(duelView(duel, null, T0, 0).mode).toBe("hp");
  });
});

describe("points race", () => {
  it("picks the winner by total points, level totals draw", () => {
    expect(raceWinner([9000, 8000])).toBe(0);
    expect(raceWinner([100, 8000])).toBe(1);
    expect(raceWinner([5000, 5000])).toBeNull();
  });

  it("runs the picked rounds with no damage, the higher total wins", () => {
    const { duel, ids } = race(3);
    expect(duel.maxRounds).toBe(3);
    expect(duelView(duel, ids[0], T0, 0)).toMatchObject({ mode: "race", maxRounds: 3 });
    let d = duel;
    // Red nails every pin, Blue is off in round 2 only.
    d = playRound(d, ids, [pin(d, 0), pin(d, 0)]);
    d = playRound(d, ids, [pin(d, 1), far(d, 1)]);
    expect(d.status).toBe("playing");
    d = playRound(d, ids, [pin(d, 2), pin(d, 2)]);
    expect(d.status).toBe("finished");
    expect(d.rounds).toHaveLength(3);
    expect(d.end).toMatchObject({ reason: "rounds", winner: 0 });
    const view = duelView(d, ids[1], T0, 0);
    expect(view.totals![0]).toBe(3 * GEO_MAX_ROUND_SCORE);
    expect(view.totals![1]).toBeLessThan(view.totals![0]);
    expect(view.revealed.every((r) => r.damage === 0 && r.hurt === null && r.multiplier === 1)).toBe(true);
    expect(d.hp[0]).toBe(d.hp[1]);
  });

  it("is a draw when the totals are level", () => {
    const { duel, ids } = race(3, "draw-seed");
    let d = duel;
    while (d.status === "playing") d = playRound(d, ids, [pin(d, d.rounds.length - 1), pin(d, d.rounds.length - 1)]);
    expect(d.end).toMatchObject({ reason: "rounds", winner: null });
  });

  it("lets the lower scorer win on total, not on a single round", () => {
    const { duel, ids } = race(3, "total-seed");
    let d = duel;
    d = playRound(d, ids, [far(d, 0), pin(d, 0)]); // Blue +big
    d = playRound(d, ids, [pin(d, 1), far(d, 1)]);
    d = playRound(d, ids, [pin(d, 2), pin(d, 2)]);
    const [a, b] = duelView(d, ids[0], T0, 0).totals!;
    expect(d.end!.winner).toBe(raceWinner([a, b]));
  });

  it("a rematch keeps the mode and rounds", () => {
    const { duel } = race(10, "keep-seed");
    const next = rematchOf(advanceDuel(duel, T0), "zzzzzzzz", T0 + 1000);
    expect(next.mode).toBe("race");
    expect(next.maxRounds).toBe(10);
    expect(next.status).toBe("lobby");
    const plain = rematchOf(createDuel("kanto", "A", "abcdefgh", T0).duel, "yyyyyyyy", T0);
    expect(plain.mode).toBeUndefined();
    expect(plain.maxRounds).toBe(10);
  });
});
