import { describe, expect, it } from "vitest";
import {
  advanceParty,
  createParty,
  guessParty,
  joinParty,
  leaveParty,
  partyPuzzle,
  partyStore,
  partyView,
  rankSeats,
  readyParty,
  startParty,
  touchParty,
  type ConnectionsParty,
  type PartyOutcome,
} from "@/lib/server/connections-party";
import { seatRace } from "@/lib/server/connections-duel";
import { PARTY_MAX, PARTY_MS, PARTY_PENALTY_MS, type PartyView } from "@/lib/connections/party";
import { PVP_AWAY_MS, PVP_LEAD_MS } from "@/lib/pvp-types";
import { readPvpToken, pvpToken } from "@/lib/server/duel-core";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const SECOND = 1000;

const ok = (out: PartyOutcome): ConnectionsParty => {
  if (!out.ok) throw new Error(out.error);
  return out.party;
};
const fails = (out: PartyOutcome) => (out.ok ? null : out.error);

/** A lobby of `n` players ("P1" is the host), everyone ready. Returns the party and ids. */
function lobby(n: number, ready = true) {
  const made = createParty("P1", "abcdefgh", T0, "seed-1");
  let party = made.party;
  const ids = [made.playerId];
  for (let i = 2; i <= n; i++) {
    const j = joinParty(party, `P${i}`, T0 + i * SECOND);
    if (!j.ok) throw new Error(j.error);
    party = j.party;
    ids.push(j.playerId);
    if (ready) party = ok(readyParty(party, j.playerId, true, T0 + i * SECOND));
  }
  return { party, ids };
}

function started(n: number) {
  const { party, ids } = lobby(n);
  const t = T0 + 20 * SECOND;
  // Everyone is still here.
  let d = party;
  for (const id of ids) d = touchParty(d, id, t);
  d = ok(startParty(d, ids[0], t));
  const start = t + PVP_LEAD_MS;
  return { party: d, ids, start, groups: partyPuzzle(d).groups.map((g) => g.members) };
}

/** Keeps everyone present up to `t`. */
const here = (d: ConnectionsParty, ids: string[], t: number) => ids.reduce((x, id) => touchParty(x, id, t), d);

const solveAll = (d: ConnectionsParty, id: string, groups: number[][], t: number, gap = SECOND) => groups.reduce((x, g, i) => ok(guessParty(x, id, g, t + i * gap)), d);
const wrongGuess = (g: number[][], a = 0, b = 1, k = 0) => [g[a][k], g[a][k + 1], g[b][k], g[b][k + 1]];

describe("the lobby", () => {
  it("seats 2 to 8, the host first, with unique names", () => {
    const { party } = lobby(PARTY_MAX);
    expect(party.players).toHaveLength(8);
    expect(fails(joinParty(party, "Late", T0 + 30 * SECOND) as PartyOutcome)).toMatch(/full/);
    const two = lobby(2).party;
    expect(fails(joinParty(two, "p1", T0 + SECOND) as PartyOutcome)).toMatch(/already in this party/);
  });

  it("starts only when the host asks, with two or more players and everyone else ready", () => {
    const solo = createParty("Solo", "abcdefgh", T0);
    expect(fails(startParty(solo.party, solo.playerId, T0 + SECOND))).toMatch(/at least 2/);
    const { party, ids } = lobby(3, false);
    const t = T0 + 5 * SECOND;
    expect(fails(startParty(touchParty(party, ids[0], t), ids[0], t))).toMatch(/Waiting for P2, P3/);
    const ready = ok(readyParty(ok(readyParty(party, ids[1], true, t)), ids[2], true, t));
    expect(fails(startParty(ready, ids[1], t))).toMatch(/Only the host/);
    const go = ok(startParty(touchParty(touchParty(ready, ids[1], t), ids[2], t), ids[0], t));
    expect(go.status).toBe("playing");
    expect(go.startsAt).toBe(t + PVP_LEAD_MS);
    expect(fails(readyParty(go, ids[1], false, t))).toMatch(/already started/);
    expect(joinParty(go, "Late", t).ok).toBe(false);
  });

  it("drops players who walk away, and the next one hosts", () => {
    const { party, ids } = lobby(3);
    let d = party;
    for (let t = 5; t * SECOND <= PVP_AWAY_MS + 20 * SECOND; t += 5) d = touchParty(d, ids[1], T0 + 20 * SECOND + t * SECOND);
    expect(d.players.map((p) => p.name)).toEqual(["P2"]);
    expect(partyView(d, ids[1], T0 + 100 * SECOND, 1).players[0].host).toBe(true);
    expect(fails(leaveParty(lobby(2).party, "nobody", T0))).toMatch(/not in this party/);
  });
});

describe("the race", () => {
  it("hides the tiles until the start, then shows everyone the same grid", () => {
    const { party, ids, start } = started(3);
    expect(partyView(party, ids[1], start - SECOND, 1).tiles).toBeUndefined();
    const a = partyView(party, ids[0], start, 2);
    const b = partyView(party, ids[2], start, 2);
    expect(a.tiles).toHaveLength(16);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.round).toEqual({ startsAt: start, endsAt: start + PARTY_MS });
  });

  it("checks every guess on the server and shows only counts to the others, never tiles", () => {
    const { party, ids, start, groups } = started(3);
    let d = here(party, ids, start);
    d = ok(guessParty(d, ids[0], groups[0], start + SECOND));
    d = here(d, ids, start + 2 * SECOND);
    d = ok(guessParty(d, ids[1], wrongGuess(groups), start + 2 * SECOND));
    const view = partyView(d, ids[2], start + 3 * SECOND, 3) as PartyView;
    expect(view.standings.map((s) => [s.name, s.found, s.mistakes])).toEqual([
      ["P1", 1, 0],
      ["P3", 0, 0],
      ["P2", 0, 1],
    ]);
    // P3 never sees P1's group or P2's wrong guess.
    expect(view.mine).toMatchObject({ guesses: [], found: [] });
    const raw = JSON.stringify(view);
    expect(view.standings.every((s) => Object.keys(s).every((k) => ["seat", "name", "place", "found", "mistakes", "solved", "out", "ms", "score"].includes(k)))).toBe(true);
    expect(view.reveal).toBeUndefined();
    expect(raw).not.toMatch(/category|"rule"|"herrings"/);
    // P1's own view has their group, and still no reveal.
    const mine = partyView(d, ids[0], start + 3 * SECOND, 3);
    expect(mine.mine!.found).toHaveLength(1);
    expect(mine.mine!.found[0].members.map((m) => m.id).sort()).toEqual([...groups[0]].sort());
    expect(mine.reveal).toBeUndefined();
    // Bad guesses are refused: a tile off the grid, repeats, and guessing before the start.
    expect(fails(guessParty(here(d, ids, start + 4 * SECOND), ids[1], [1, 2, 3, 4], start + 4 * SECOND))).toBeTruthy();
    expect(fails(guessParty(here(d, ids, start + 4 * SECOND), ids[1], wrongGuess(groups), start + 4 * SECOND))).toMatch(/Already guessed/);
    expect(fails(guessParty(party, ids[0], groups[0], start - SECOND))).toMatch(/hasn't started/);
    expect(fails(guessParty(here(d, ids, start + 4 * SECOND), "nobody", groups[0], start + 4 * SECOND))).toMatch(/not in this party/);
  });

  it("ends when everyone is done, ranks a faster clean solve first, and reveals the answers only then", () => {
    const { party, ids, start, groups } = started(4);
    let d = here(party, ids, start);
    // P1: clean and quick. P2: one mistake, quick. P3: finds 2 groups then is out. P4: slow clean.
    d = solveAll(d, ids[0], groups, start + 10 * SECOND);
    d = here(d, ids, start + 20 * SECOND);
    d = ok(guessParty(d, ids[1], wrongGuess(groups), start + 20 * SECOND));
    d = solveAll(here(d, ids, start + 21 * SECOND), ids[1], groups, start + 21 * SECOND);
    d = here(d, ids, start + 40 * SECOND);
    d = ok(guessParty(d, ids[2], groups[0], start + 40 * SECOND));
    d = ok(guessParty(d, ids[2], groups[1], start + 41 * SECOND));
    // Four different wrong guesses from the two groups left.
    [
      [0, 0],
      [0, 2],
      [2, 0],
      [2, 2],
    ].forEach(([a, b], i) => {
      d = ok(guessParty(here(d, ids, start + (42 + i) * SECOND), ids[2], [groups[2][a], groups[2][a + 1], groups[3][b], groups[3][b + 1]], start + (42 + i) * SECOND));
    });
    expect(partyView(d, ids[0], start + 50 * SECOND, 5).status).toBe("playing");
    d = here(d, ids, start + 60 * SECOND);
    d = solveAll(d, ids[3], groups, start + 60 * SECOND, 5 * SECOND);
    expect(d.status).toBe("finished");
    const view = partyView(d, ids[2], start + 100 * SECOND, 9);
    expect(view.standings.map((s) => s.name)).toEqual(["P1", "P2", "P4", "P3"]);
    expect(view.standings.map((s) => s.place)).toEqual([1, 2, 3, 4]);
    expect(view.standings[1].score).toBeGreaterThan(view.standings[0].score!);
    expect(view.standings[1].score! - view.standings[1].ms!).toBe(PARTY_PENALTY_MS);
    expect(view.standings[3]).toMatchObject({ solved: false, found: 2, out: true });
    expect(view.end?.winner).toBe(0);
    expect(view.reveal).toHaveLength(4);
    // Visitors see the final standings and the reveal too.
    expect(partyView(d, null, start + 100 * SECOND, 9).reveal).toHaveLength(4);
  });

  it("ranks by groups found when nobody solves, then mistakes, then who got there first", () => {
    const { party, ids, groups, start } = started(3);
    const races = (d: ConnectionsParty) => d.players.map((_, s) => seatRace(d, partyPuzzle(d), s));
    let d = here(party, ids, start);
    d = ok(guessParty(d, ids[0], groups[0], start + 5 * SECOND));
    d = ok(guessParty(d, ids[1], groups[0], start + 4 * SECOND));
    d = ok(guessParty(d, ids[2], wrongGuess(groups), start + 3 * SECOND));
    // Same groups and mistakes for P1 and P2: P2 was first.
    expect(rankSeats(races(d))).toEqual([1, 0, 2]);
    d = ok(guessParty(d, ids[0], wrongGuess(groups, 1, 2), start + 6 * SECOND));
    expect(rankSeats(races(d))).toEqual([1, 0, 2]);
    // Two mistakes for P2 now: P1 (one mistake) is ahead.
    d = ok(guessParty(d, ids[1], wrongGuess(groups, 1, 2), start + 7 * SECOND));
    d = ok(guessParty(d, ids[1], wrongGuess(groups, 1, 2, 2), start + 8 * SECOND));
    expect(rankSeats(races(d))).toEqual([0, 1, 2]);
  });

  it("ends at the time limit, giving the win to whoever is ahead, or nobody if no group was found", () => {
    const { party, ids, start, groups } = started(3);
    let d = ok(guessParty(here(party, ids, start), ids[1], groups[0], start + SECOND));
    // Everyone keeps polling, but nobody finishes.
    for (let t = 30; t * SECOND < PARTY_MS; t += 25) d = here(d, ids, start + t * SECOND);
    d = here(d, ids, start + PARTY_MS + SECOND);
    expect(d.status).toBe("finished");
    expect(d.end).toEqual({ at: start + PARTY_MS, winner: 1 });

    const none = started(2);
    let q = none.party;
    for (let t = 30; t * SECOND < PARTY_MS; t += 25) q = here(q, none.ids, none.start + t * SECOND);
    q = here(q, none.ids, none.start + PARTY_MS + SECOND);
    expect(q.end?.winner).toBeNull();
  });

  it("lets a player drop out; the race ends when the rest are done", () => {
    const { party, ids, start, groups } = started(3);
    let d = here(party, ids, start + SECOND);
    d = ok(leaveParty(d, ids[2], start + 2 * SECOND));
    expect(partyView(d, ids[0], start + 3 * SECOND, 1).standings.find((s) => s.name === "P3")!.out).toBe(true);
    expect(d.status).toBe("playing");
    d = solveAll(here(d, ids.slice(0, 2), start + 4 * SECOND), ids[0], groups, start + 4 * SECOND);
    d = solveAll(here(d, ids.slice(0, 2), start + 20 * SECOND), ids[1], groups, start + 20 * SECOND);
    expect(d.status).toBe("finished");
    expect(d.end?.winner).toBe(0);
  });

  it("counts a player who goes quiet as out", () => {
    const { party, ids, start, groups } = started(2);
    let d = here(party, ids, start + SECOND);
    d = solveAll(d, ids[0], groups, start + 5 * SECOND);
    expect(d.status).toBe("playing");
    // P2 never comes back.
    for (let t = 10; t * SECOND <= PVP_AWAY_MS + 30 * SECOND; t += 5) d = touchParty(d, ids[0], start + 5 * SECOND + t * SECOND);
    expect(advanceParty(d, start + 90 * SECOND).status).toBe("finished");
    expect(advanceParty(d, start + 90 * SECOND).end?.winner).toBe(0);
  });
});

describe("the store and tokens", () => {
  it("keeps a party by its code, and tokens are per code", async () => {
    const made = createParty("Host", "zzzzzzzz".replace(/z/g, "k"), T0);
    expect(await partyStore.insert(made.party)).toBe(true);
    expect(await partyStore.insert(made.party)).toBe(false);
    const stored = await partyStore.load("kkkkkkkk");
    expect(stored!.duel.players[0].name).toBe("Host");
    const token = pvpToken("kkkkkkkk", made.playerId);
    expect(readPvpToken(token, "kkkkkkkk")).toBe(made.playerId);
    expect(readPvpToken(token, "mmmmmmmm")).toBeNull();
    await partyStore.remove("kkkkkkkk");
  });
});
