import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceDuel,
  createDuel,
  duelToken,
  duelView,
  guessDuel,
  isDuelMap,
  joinDuel,
  leaveDuel,
  linkRematch,
  readDuelToken,
  readyDuel,
  rematchOf,
  roundAnswer,
  skipReveal,
  takeRematchSeat,
  touchDuel,
  type Duel,
  type DuelFailure,
  type DuelOutcome,
} from "@/lib/server/duel";
import { insertDuel, loadDuel, saveDuel, updateDuel } from "@/lib/server/duel-store";
import {
  DUEL_AWAY_MS,
  DUEL_COUNTDOWN_MS,
  DUEL_HP,
  DUEL_IDLE_ROUNDS,
  DUEL_LEAD_MS,
  DUEL_MAX_ROUNDS,
  DUEL_REVEAL_MS,
  DUEL_ROUND_MS,
  duelMultiplier,
} from "@/lib/duel-types";
import { GEO_MAX_ROUND_SCORE, WORLD_REGION } from "@/lib/geo-types";

// The memory store, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const SECOND = 1000;

const must = (out: DuelOutcome): Duel => {
  if (!out.ok) throw new Error(out.error);
  return out.duel;
};
const failure = (out: DuelOutcome) => (out.ok ? null : (out as DuelFailure));

/** Red opens a duel on Kanto and Blue joins. */
function lobby(region = "kanto", seed = "duel-seed") {
  const { duel, playerId: red } = createDuel(region, "Red", "abcdefgh", T0, seed);
  const joined = joinDuel(duel, "Blue", T0 + SECOND);
  if (!joined.ok) throw new Error(joined.error);
  return { duel: joined.duel, red, blue: joined.playerId };
}

/** Both ready: round 1 starts after the lead-in. */
function started(region?: string, seed?: string) {
  const { duel, red, blue } = lobby(region, seed);
  const t = T0 + 2 * SECOND;
  const ready = must(readyDuel(must(readyDuel(duel, red, true, t)), blue, true, t));
  return { duel: ready, red, blue, start: t + DUEL_LEAD_MS };
}

/** Both trainers poll at `t` (so neither times out). */
const both = (duel: Duel, ids: string[], t: number) => ids.reduce((d, id) => touchDuel(d, id, t), duel);

/** The perfect pin: the shot's exact spot when it has one, else the place's pin. */
const pinOf = (duel: Duel, index: number) => {
  const answer = roundAnswer(duel, index);
  const [x, y] = answer.spot ?? answer.pin;
  return { x, y };
};
/** The far corner from the answer: a low score. */
const farFrom = (duel: Duel, index: number) => {
  const { x, y } = pinOf(duel, index);
  return { x: x > 0.5 ? 0 : 1, y: y > 0.5 ? 0 : 1 };
};

/** Plays the current round: each trainer's pin (null: no guess), then lets the reveal run out. */
function playRound(duel: Duel, ids: string[], pins: ({ x: number; y: number } | null)[]) {
  const index = duel.rounds.length - 1;
  const t = duel.rounds[index].startsAt + 2 * SECOND;
  let d = both(duel, ids, t);
  pins.forEach((pin, seat) => {
    if (pin) d = must(guessDuel(d, ids[seat], index, pin, t));
  });
  // No guess from someone: the round closes on its own (both keep polling meanwhile).
  for (let at = t; !d.rounds[index].result; ) {
    at += 5 * SECOND;
    d = both(d, ids, at);
  }
  const result = d.rounds[index].result!;
  if (d.status === "playing") {
    d = both(d, ids, result.nextAt);
    expect(d.rounds).toHaveLength(index + 2);
  }
  return d;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("duel rules", () => {
  it("raises the damage multiplier as the duel goes on", () => {
    expect([...Array(12)].map((_, i) => duelMultiplier(i))).toEqual([1, 1, 1, 1.5, 1.5, 1.5, 2, 2, 2, 2.5, 2.5, 2.5]);
  });

  it("plays every map, and gives both trainers the same rounds from one seed", () => {
    for (const region of [WORLD_REGION, "kanto", "johto", "galar", "paldea"]) expect(isDuelMap(region), region).toBe(true);
    expect(isDuelMap("orre")).toBe(false);

    const { duel, red, blue } = started();
    expect(duel.maxRounds).toBe(DUEL_MAX_ROUNDS);
    let d = duel;
    const shots: string[] = [];
    for (let i = 0; i < 4; i++) {
      const t = d.rounds[i].startsAt;
      const [a, b] = [duelView(d, red, t, 0), duelView(d, blue, t, 0)];
      expect(a.round!.shot).toBeTruthy();
      expect(a.round).toEqual(b.round);
      shots.push(a.round!.shot!);
      d = playRound(d, [red, blue], [pinOf(d, i), farFrom(d, i)]);
      if (d.status !== "playing") break;
    }
    // Every round is a different place, and the same seed plans the same duel.
    const places = d.rounds.map((_, i) => roundAnswer(d, i)).map((a) => `${a.region}|${a.parent ?? a.name}`);
    expect(new Set(places).size).toBe(places.length);
    expect(new Set(shots).size).toBe(shots.length);
    const again = started(undefined, "duel-seed").duel;
    expect(again.rounds[0].plan).toEqual(duel.rounds[0].plan);
    expect(started(undefined, "another-seed").duel.rounds[0].plan).not.toEqual(duel.rounds[0].plan);
    const views = [duelView(d, red, T0, 0), duelView(d, blue, T0, 0)];
    expect(views[0].revealed).toEqual(views[1].revealed);
  });

  it("takes the score difference times the multiplier from the lower scorer", () => {
    const { duel, red, blue } = started();
    let d = playRound(duel, [red, blue], [pinOf(duel, 0), farFrom(duel, 0)]);
    const [first] = duelView(d, red, T0, 0).revealed;
    expect(first.guesses[0]!.score).toBe(GEO_MAX_ROUND_SCORE);
    const blueScore = first.guesses[1]!.score;
    expect(blueScore).toBeLessThan(GEO_MAX_ROUND_SCORE);
    expect(first).toMatchObject({ multiplier: 1, hurt: 1, damage: GEO_MAX_ROUND_SCORE - blueScore, hp: [DUEL_HP, DUEL_HP - (GEO_MAX_ROUND_SCORE - blueScore)] });
    expect(d.hp).toEqual(first.hp);

    // Two tied rounds: no damage.
    for (const i of [1, 2]) d = playRound(d, [red, blue], [pinOf(d, i), pinOf(d, i)]);
    expect(d.hp).toEqual(first.hp);
    expect(duelView(d, red, T0, 0).revealed[2]).toMatchObject({ hurt: null, damage: 0 });

    // Round 4 is worth 1.5×: Blue goes down to 0 HP (never below) and loses.
    d = playRound(d, [red, blue], [pinOf(d, 3), farFrom(d, 3)]);
    const fourth = duelView(d, red, T0, 0).revealed[3];
    expect(fourth.multiplier).toBe(1.5);
    expect(fourth.hurt).toBe(1);
    expect(fourth.damage).toBe(Math.round((GEO_MAX_ROUND_SCORE - fourth.guesses[1]!.score) * 1.5));
    expect(fourth.damage).toBeGreaterThan(first.hp[1]);
    expect(d.hp).toEqual([DUEL_HP, 0]);
    expect(d.status).toBe("finished");
    expect(d.end).toMatchObject({ reason: "hp", winner: 0 });
  });

  it("ends after the last round: more HP wins, equal HP is a draw", () => {
    const tie = started();
    let d = tie.duel;
    while (d.status === "playing") {
      const i = d.rounds.length - 1;
      d = playRound(d, [tie.red, tie.blue], [pinOf(d, i), pinOf(d, i)]);
    }
    expect(d.rounds).toHaveLength(DUEL_MAX_ROUNDS);
    expect(d.end).toMatchObject({ reason: "rounds", winner: null });
    expect(d.hp).toEqual([DUEL_HP, DUEL_HP]);

    const close = started(undefined, "close-seed");
    d = close.duel;
    const { x, y } = pinOf(d, 0);
    d = playRound(d, [close.red, close.blue], [{ x: x > 0.5 ? x - 0.2 : x + 0.2, y }, pinOf(d, 0)]);
    expect(d.hp[0]).toBeLessThan(DUEL_HP);
    while (d.status === "playing") {
      const i = d.rounds.length - 1;
      d = playRound(d, [close.red, close.blue], [pinOf(d, i), pinOf(d, i)]);
    }
    expect(d.end).toMatchObject({ reason: "rounds", winner: 1 });
  });
});

describe("duel clock", () => {
  it("gives the other trainer 15 s once one guesses, then 0 points", () => {
    const { duel, red, blue, start } = started();
    expect(duelView(duel, red, start - SECOND, 0).round!.shot).toBeUndefined();
    expect(failure(guessDuel(duel, red, 0, { x: 0.5, y: 0.5 }, start - SECOND))?.error).toMatch(/hasn't started/);

    const t = start + 5 * SECOND;
    let d = must(guessDuel(duel, red, 0, { x: 0.5, y: 0.5 }, t));
    const view = duelView(d, blue, t, 0);
    expect(view.round).toMatchObject({ countdown: true, guessed: [true, false], endsAt: t + DUEL_COUNTDOWN_MS });
    expect(view.round!.yours).toBeUndefined();

    // A guess still in flight at the bell counts…
    const late = must(guessDuel(d, blue, 0, { x: 0.5, y: 0.5 }, t + DUEL_COUNTDOWN_MS + 500));
    expect(late.rounds[0].guesses[1]).not.toBeNull();
    expect(late.rounds[0].result).toBeTruthy();
    // …but not one long after it: the round is revealed with no guess from Blue.
    d = touchDuel(d, red, t + DUEL_COUNTDOWN_MS + 3 * SECOND);
    const out = guessDuel(d, blue, 0, { x: 0.5, y: 0.5 }, t + DUEL_COUNTDOWN_MS + 3 * SECOND);
    expect(failure(out)?.status).toBe(409);
    const [round] = duelView(d, blue, t + DUEL_COUNTDOWN_MS + 3 * SECOND, 0).revealed;
    expect(round.guesses[1]).toBeNull();
    expect(round.hurt).toBe(1);
    expect(round.damage).toBe(round.guesses[0]!.score);
  });

  it("closes a round after 90 s, with no damage when nobody guessed", () => {
    const { duel, red, blue, start } = started();
    let d = duel;
    for (let at = start; at < start + DUEL_ROUND_MS; at += 20 * SECOND) d = both(d, [red, blue], at);
    d = both(d, [red, blue], start + DUEL_ROUND_MS);
    expect(d.rounds[0].result).toBeUndefined();
    expect(duelView(d, red, start + DUEL_ROUND_MS - SECOND, 0).round!.endsAt).toBe(start + DUEL_ROUND_MS);
    d = both(d, [red, blue], start + DUEL_ROUND_MS + 2 * SECOND);
    expect(d.rounds[0].result).toMatchObject({ scores: [0, 0], damage: 0, hurt: null });
    expect(d.hp).toEqual([DUEL_HP, DUEL_HP]);
  });

  it("shows the reveal for 12 s, or until both trainers press Next", () => {
    const { duel, red, blue, start } = started();
    const t = start + 4 * SECOND;
    let d = must(guessDuel(must(guessDuel(duel, red, 0, { x: 0.2, y: 0.2 }, t)), blue, 0, { x: 0.8, y: 0.8 }, t + SECOND));
    const revealedAt = t + SECOND;
    expect(d.rounds[0].result!.at).toBe(revealedAt);
    expect(duelView(d, red, revealedAt, 0).next).toEqual({ at: revealedAt + DUEL_REVEAL_MS, pressed: [false, false] });

    // The reveal runs out on its own.
    const waited = both(d, [red, blue], revealedAt + DUEL_REVEAL_MS);
    expect(waited.rounds[1].startsAt).toBe(revealedAt + DUEL_REVEAL_MS + DUEL_LEAD_MS);

    // One press isn't enough; two end it.
    d = must(skipReveal(d, red, 0, revealedAt + 2 * SECOND));
    expect(d.rounds).toHaveLength(1);
    d = must(skipReveal(d, blue, 0, revealedAt + 3 * SECOND));
    expect(d.rounds).toHaveLength(2);
    expect(d.rounds[1].startsAt).toBe(revealedAt + 3 * SECOND + DUEL_LEAD_MS);
    // A late press for the old round is harmless.
    expect(must(skipReveal(d, red, 0, revealedAt + 4 * SECOND)).rounds).toHaveLength(2);
  });

  it("forfeits a trainer who stops responding, and the opponent sees it", () => {
    const { duel, red, start } = started();
    let d = duel;
    // Blue's tab is closed: only Red keeps polling.
    for (let at = start; at < start + DUEL_AWAY_MS + 10 * SECOND; at += 5 * SECOND) d = touchDuel(d, red, at);
    expect(d.status).toBe("finished");
    expect(d.end).toMatchObject({ reason: "left", winner: 0 });
    expect(duelView(d, red, start + DUEL_AWAY_MS + 10 * SECOND, 0).end?.reason).toBe("left");
  });

  it("flags a quiet trainer before they time out", () => {
    const { duel, red, start } = started();
    const d = touchDuel(duel, red, start + 12 * SECOND);
    expect(duelView(d, red, start + 12 * SECOND, 0).players.map((p) => p.quiet)).toEqual([false, true]);
  });

  it("forfeits a trainer who misses three rounds in a row", () => {
    const { duel, red, blue } = started();
    let d = duel;
    for (let i = 0; i < DUEL_IDLE_ROUNDS; i++) d = playRound(d, [red, blue], [farFrom(d, i), null]);
    expect(d.end).toMatchObject({ reason: "idle", winner: 0 });

    const asleep = started();
    d = asleep.duel;
    for (let i = 0; i < DUEL_IDLE_ROUNDS; i++) d = playRound(d, [asleep.red, asleep.blue], [null, null]);
    expect(d.end).toMatchObject({ reason: "idle", winner: null });
  });

  it("forfeits at once for a trainer who leaves mid-duel", () => {
    const { duel, blue, start } = started();
    const d = must(leaveDuel(duel, blue, start + SECOND));
    expect(d.end).toMatchObject({ reason: "left", winner: 0 });
  });
});

describe("duel lobby", () => {
  it("starts once both trainers are ready", () => {
    const { duel, red, blue } = lobby();
    expect(duelView(duel, null, T0, 0)).toMatchObject({ status: "lobby", you: null, players: [{ name: "Red" }, { name: "Blue" }] });
    let d = must(readyDuel(duel, red, true, T0 + 2 * SECOND));
    expect(d.status).toBe("lobby");
    d = must(readyDuel(d, red, false, T0 + 2 * SECOND));
    d = must(readyDuel(d, blue, true, T0 + 2 * SECOND));
    expect(d.status).toBe("lobby");
    d = must(readyDuel(d, red, true, T0 + 3 * SECOND));
    expect(d.status).toBe("playing");
    expect(d.rounds[0].startsAt).toBe(T0 + 3 * SECOND + DUEL_LEAD_MS);
  });

  it("frees the seat of a trainer who left the lobby", () => {
    const { duel, red } = lobby();
    const d = touchDuel(duel, red, T0 + DUEL_AWAY_MS + 5 * SECOND);
    expect(d.players.map((p) => p.name)).toEqual(["Red"]);
    const joined = joinDuel(d, "Green", T0 + DUEL_AWAY_MS + 6 * SECOND);
    expect(joined.ok && joined.duel.players.map((p) => p.name)).toEqual(["Red", "Green"]);
    expect(must(leaveDuel(duel, red, T0 + 2 * SECOND)).players.map((p) => p.name)).toEqual(["Blue"]);
  });
});

describe("duel security", () => {
  it("never sends the answer or the opponent's pin before the reveal", () => {
    const { duel, red, blue, start } = started();
    const t = start + 3 * SECOND;
    const pin = { x: 0.123457, y: 0.654321 };
    let d = must(guessDuel(duel, red, 0, pin, t));
    const answer = roundAnswer(d, 0);
    for (const viewer of [blue, null]) {
      const json = JSON.stringify(duelView(d, viewer, t, 0));
      expect(json).not.toContain("0.123457");
      expect(json).not.toContain("0.654321");
      expect(json).not.toContain(answer.name);
      expect(json).not.toContain(d.seed);
      expect(json).not.toMatch(/"(pin|mask|plan|location|answer|seenAt|id)"/);
    }
    expect(duelView(d, red, t, 0).round!.yours).toEqual(pin);

    d = must(guessDuel(d, blue, 0, { x: 0.9, y: 0.1 }, t + SECOND));
    const [round] = duelView(d, blue, t + SECOND, 0).revealed;
    expect(round.answer).toEqual(answer);
    expect(round.guesses[0]).toMatchObject(pin);
    expect(JSON.stringify(duelView(d, blue, t + SECOND, 0))).not.toContain(d.seed);
  });

  it("rejects illegal actions", () => {
    const { duel, red, blue, start } = started();
    const t = start + SECOND;
    // Guessing twice.
    const once = must(guessDuel(duel, red, 0, { x: 0.5, y: 0.5 }, t));
    expect(failure(guessDuel(once, red, 0, { x: 0.4, y: 0.4 }, t + 100))?.error).toMatch(/already guessed/);
    expect(once.rounds[0].guesses[1]).toBeNull();
    // Acting for a seat that isn't yours: only the token's seat can act, and tokens are per duel.
    expect(failure(guessDuel(duel, "someone-else", 0, { x: 0.5, y: 0.5 }, t))?.status).toBe(403);
    expect(readDuelToken(duelToken("abcdefgh", blue), "abcdefgh")).toBe(blue);
    expect(readDuelToken(duelToken("abcdefgh", blue), "hgfedcba")).toBeNull();
    const forged = duelToken("abcdefgh", blue).replace(/^./, (c) => (c === "e" ? "f" : "e"));
    expect(readDuelToken(forged, "abcdefgh")).toBeNull();
    expect(readDuelToken("not-a-token", "abcdefgh")).toBeNull();
    // A round that isn't the current one.
    expect(failure(guessDuel(duel, red, 1, { x: 0.5, y: 0.5 }, t))?.status).toBe(409);
    // Joining a duel that's under way, or full.
    expect(failure(joinDuel(duel, "Green", t))?.error).toMatch(/already started/);
    const full = lobby().duel;
    expect(failure(joinDuel(full, "Green", T0 + 2 * SECOND))?.error).toMatch(/full/);
    expect(failure(joinDuel(createDuel("kanto", "Red", "abcdefgh", T0).duel, "red", T0))?.error).toMatch(/Pick another name/);
    // Readying up mid-duel, guessing in the lobby.
    expect(failure(readyDuel(duel, red, false, t))?.status).toBe(409);
    const waiting = lobby();
    expect(failure(guessDuel(waiting.duel, waiting.red, 0, { x: 0.5, y: 0.5 }, T0 + 2 * SECOND))?.error).toMatch(/hasn't started/);

    // Acting after the end.
    const over = must(leaveDuel(duel, blue, t));
    for (const out of [guessDuel(over, red, 0, { x: 0.5, y: 0.5 }, t + 1), skipReveal(over, red, 0, t + 1), readyDuel(over, red, true, t + 1)]) {
      expect(failure(out)?.status).toBe(409);
    }
    expect(failure(guessDuel(over, red, 0, { x: 0.5, y: 0.5 }, t + 1))?.error).toMatch(/over/);
    expect(advanceDuel(over, t + 10 * DUEL_ROUND_MS)).toEqual(over);
    // Polls after the end (waiting for a rematch) change nothing, so they never write.
    expect(touchDuel(over, red, t + 60 * SECOND)).toEqual(over);
  });
});

describe("rematch", () => {
  it("opens a new duel with the same map and trainers, which starts once both press Rematch", () => {
    const { duel, red, blue, start } = started("johto");
    const over = must(leaveDuel(duel, blue, start + SECOND));
    expect(failure(linkRematch(duel, "zzzzzzzz"))?.status).toBe(409);
    const linked = must(linkRematch(over, "mnpqrstu"));
    expect(linked.rematch).toBe("mnpqrstu");
    expect(must(linkRematch(linked, "otherone")).rematch).toBe("mnpqrstu");

    const t = start + 5 * SECOND;
    const next = rematchOf(over, "mnpqrstu", t);
    expect(next).toMatchObject({ code: "mnpqrstu", region: "johto", status: "lobby", hp: [DUEL_HP, DUEL_HP], rounds: [] });
    expect(next.players.map((p) => [p.id, p.name, p.ready])).toEqual([
      [red, "Red", false],
      [blue, "Blue", false],
    ]);
    expect(next.seed).not.toBe(over.seed);

    let d = must(takeRematchSeat(next, red, "Red", t));
    expect(d.status).toBe("lobby");
    d = must(takeRematchSeat(d, blue, "Blue", t + SECOND));
    expect(d.status).toBe("playing");
    // Pressing it again once it has started is harmless; strangers can't take a seat.
    expect(must(takeRematchSeat(d, blue, "Blue", t + 2 * SECOND)).status).toBe("playing");
    expect(failure(takeRematchSeat(d, "stranger", "Green", t + 2 * SECOND))?.status).toBe(409);
  });

  it("gives back a seat the rematch lobby dropped", () => {
    const { duel, red, blue, start } = started();
    const over = must(leaveDuel(duel, blue, start + SECOND));
    const t = start + 5 * SECOND;
    let d = must(takeRematchSeat(rematchOf(over, "mnpqrstu", t), red, "Red", t));
    // Blue took a while to press Rematch.
    d = touchDuel(d, red, t + DUEL_AWAY_MS + 5 * SECOND);
    expect(d.players).toHaveLength(1);
    d = must(takeRematchSeat(d, blue, "Blue", t + DUEL_AWAY_MS + 6 * SECOND));
    expect(d.status).toBe("playing");
  });
});

describe("duel store", () => {
  it("never loses a write when both trainers act at once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const { duel, red, blue } = started();
    const code = "rmqtzzxy";
    const stored = { ...duel, code };
    expect(await insertDuel(stored)).toBe(true);
    expect(await insertDuel(stored)).toBe(false);
    vi.setSystemTime(stored.rounds[0].startsAt + SECOND);

    const [a, b] = await Promise.all([
      updateDuel(code, (d, now) => guessDuel(d, red, 0, { x: 0.3, y: 0.3 }, now)),
      updateDuel(code, (d, now) => guessDuel(d, blue, 0, { x: 0.7, y: 0.7 }, now)),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const after = (await loadDuel(code))!;
    expect(after.duel.rounds[0].guesses.every(Boolean)).toBe(true);
    expect(after.duel.rounds[0].result).toBeTruthy();
    expect(after.version).toBe(2);

    // A write based on a stale read is refused.
    expect(await saveDuel(after.duel, 1)).toBe(false);
    expect(await saveDuel(after.duel, 2)).toBe(true);
    // A poll that changes nothing doesn't write.
    const poll = await updateDuel(code, (d) => ({ ok: true as const, duel: d }));
    expect(poll.ok && poll.rev).toBe(3);
    expect((await loadDuel(code))!.version).toBe(3);
    expect((await updateDuel("nosuchdl", (d) => ({ ok: true as const, duel: d }))).ok).toBe(false);
  });
});
