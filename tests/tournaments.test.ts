import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availableElimMatches, elimEnded, elimResults, freezeElimination, setElimResult } from "@/lib/server/tournaments/generator-elimination";
import { availableRRMatches, disqualifyRR, freezeRoundRobin, rrEnded, rrResults, setRRResult } from "@/lib/server/tournaments/generator-round-robin";
import { applyGame, claimMatches, closeSignups, tournamentView } from "@/lib/server/tournaments/core";
import type { TourRecord } from "@/lib/server/tournaments/store";
import type { PublicUser } from "@/lib/server/accounts";
import { NO_SHOW_MS } from "@/lib/tournaments";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const user = (n: number): PublicUser => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, username: `Trainer${n}`, createdAt: "2026-01-01T00:00:00Z" });

/** Plays out an elimination bracket, player 1 always winning; returns the matches played. */
function playOut(n: number) {
  const b = freezeElimination([...Array(n).keys()]);
  let played = 0;
  for (let guard = 0; guard < 200 && !elimEnded(b); guard++) {
    const [at] = availableElimMatches(b)[0];
    expect(setElimResult(b, at, "win", [1, 0], () => false)).toBe("");
    played++;
  }
  return { b, played };
}

describe("elimination brackets (ported from Showdown)", () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 13, 64])("%i players: n−1 matches and one champion", (n) => {
    const { b, played } = playOut(n);
    expect(played).toBe(n - 1);
    expect(elimResults(b)[0]).toHaveLength(1);
  });

  it("gives a bye to the odd one out", () => {
    for (const n of [3, 5, 7, 9, 13]) {
      const b = freezeElimination([...Array(n).keys()]);
      const firstRound = availableElimMatches(b);
      // Showdown's tree: everyone but one plays at once; the odd one out has a bye.
      expect(firstRound).toHaveLength((n - 1) / 2);
      const playing = firstRound.flatMap(([, p1, p2]) => [p1, p2]);
      expect(new Set(playing).size).toBe(playing.length);
      expect(n - playing.length).toBe(1);
    }
  });

  it("a disqualified player loses their next match at once", () => {
    const b = freezeElimination([0, 1, 2, 3]);
    const dq = new Set([2]);
    const [first, second] = availableElimMatches(b);
    // Whoever plays player 2's side advances to the final against a DQ'd 2 and wins outright.
    const has2 = [first, second].find(([, p1, p2]) => p1 === 2 || p2 === 2)!;
    const other = [first, second].find((m) => m !== has2)!;
    setElimResult(b, has2[0], has2[1] === 2 ? "win" : "loss", [1, 0], (p) => dq.has(p));
    setElimResult(b, other[0], "win", [1, 0], (p) => dq.has(p));
    expect(elimEnded(b)).toBe(true);
    expect(elimResults(b)[0]).toEqual([other[1]]);
  });
});

describe("round robin (ported from Showdown)", () => {
  it("everyone plays everyone once, and the table ranks by points", () => {
    const t = freezeRoundRobin(4);
    expect(availableRRMatches(t)).toHaveLength(6);
    const scores = [0, 0, 0, 0];
    for (const [row, col] of availableRRMatches(t)) {
      // The lower index always wins.
      setRRResult(t, row, col, "loss", [0, 1]);
      scores[col]++;
    }
    expect(rrEnded(t)).toBe(true);
    expect(rrResults(scores)).toEqual([[0], [1], [2], [3]]);
    expect(setRRResult(t, 1, 0, "win", [1, 0])).toBe("InvalidMatch");
  });

  it("a disqualified player forfeits what's left", () => {
    const t = freezeRoundRobin(3);
    setRRResult(t, 1, 0, "win", [1, 0]);
    expect(disqualifyRR(t, 2)).toHaveLength(2);
    expect(rrEnded(t)).toBe(true);
  });
});

function record(n: number, style: "elim" | "rr" = "elim", bestOf: 1 | 3 = 1): TourRecord {
  return {
    v: 1,
    id: "testtour1",
    format: "gen9randombattle",
    style,
    bestOf,
    maxPlayers: 8,
    official: false,
    host: null,
    hostName: "Host",
    status: "signup",
    createdAt: 0,
    signupEndsAt: 1,
    players: [...Array(n).keys()].map((i) => ({ id: `u${i}`, name: `P${i}`, key: `k${i}`, joinedAt: 0, score: 0, wins: 0, losses: 0, games: 0 })),
    matches: [],
    rated: true,
  };
}

const game = (code: string) => ({ code, ids: ["a", "b"] as [string, string], createdAt: 0 });

describe("advancing a tournament", () => {
  it("applies each game once, however often a tick sees it", () => {
    const rec = record(4);
    closeSignups(rec, 10, () => 0.5);
    const claimed = claimMatches(rec, 10, "me");
    expect(claimed).toHaveLength(2);
    // A second claim within the window takes nothing.
    expect(claimMatches(rec, 11, "other")).toEqual([]);
    for (const id of claimed) rec.matches.find((m) => m.id === id)!.current = game(`code${id}`);
    const [m1] = rec.matches;
    const before = JSON.stringify(rec);
    applyGame(rec, m1.id, { winner: 0, arrived: [true, true] });
    const once = JSON.stringify(rec);
    expect(once).not.toBe(before);
    applyGame(rec, m1.id, { winner: 0, arrived: [true, true] });
    applyGame(rec, m1.id, { winner: 1, arrived: [true, true] });
    expect(JSON.stringify(rec)).toBe(once);
    expect(rec.players[m1.a].wins).toBe(1);
  });

  it("a stale claim is taken over; a no-show loses; two no-shows are both out", () => {
    const rec = record(4);
    closeSignups(rec, 0, () => 0.1);
    const [a, b] = claimMatches(rec, 0, "x");
    expect(claimMatches(rec, 40_000, "y")).toEqual([a, b]);
    rec.matches[0].current = game("c1");
    rec.matches[1].current = game("c2");
    applyGame(rec, a, { winner: 1, arrived: [false, true] });
    expect(rec.matches[0]).toMatchObject({ done: true, winner: 1, note: "noshow" });
    applyGame(rec, b, { winner: 0, arrived: [false, false] });
    expect(rec.matches[1]).toMatchObject({ done: true, note: "noshow" });
    expect(rec.players[rec.matches[1].a].dq && rec.players[rec.matches[1].b].dq).toBe(true);
    // The final is decided against the disqualified side at once.
    claimMatches(rec, 50_000, "z");
    expect(rec.elim!.nodes[rec.elim!.root].state).toBe("finished");
  });

  it("Bo3 needs two wins, and a draw is replayed", () => {
    const rec = record(2, "elim", 3);
    closeSignups(rec, 0);
    const [id] = claimMatches(rec, 0, "x");
    const m = rec.matches[0];
    m.current = game("g1");
    applyGame(rec, id, { winner: 0, arrived: [true, true] });
    expect(m.done).toBe(false);
    m.current = game("g2");
    applyGame(rec, id, { winner: null, arrived: [true, true] });
    expect(m.done).toBe(false);
    m.current = game("g3");
    applyGame(rec, id, { winner: 0, arrived: [true, true] });
    expect(m).toMatchObject({ done: true, winner: 0, wins: [2, 0] });
  });

  it("round robin keeps everyone to one match at a time", () => {
    const rec = record(4, "rr");
    closeSignups(rec, 0);
    expect(claimMatches(rec, 0, "x")).toHaveLength(2);
  });

  it("the public view never carries seat ids, account ids, keys or teams", () => {
    const rec = record(4);
    rec.players[0].team = "secret-team";
    closeSignups(rec, 0);
    claimMatches(rec, 0, "x");
    rec.matches[0].current = { code: "abcdefgh", ids: ["seat-secret-0", "seat-secret-1"], createdAt: 0 };
    const json = JSON.stringify(tournamentView(rec, 1, 0));
    for (const secret of ["seat-secret", "secret-team", '"u0"', '"k0"']) expect(json).not.toContain(secret);
  });
});

describe("tournaments end to end (memory stores, real battles)", () => {
  beforeEach(async () => {
    const { clearMemoryTournaments } = await import("@/lib/server/tournaments/store");
    clearMemoryTournaments();
  });
  afterEach(() => vi.useRealTimers());

  async function fullTournament() {
    const svc = await import("@/lib/server/tournaments/service");
    const players = [1, 2, 3, 4].map(user);
    const made = await svc.createTournament(players[0], { format: "gen9randombattle", style: "elim", maxPlayers: 4, signupMinutes: 5, bestOf: 1 });
    expect(made.ok).toBe(true);
    const id = (made as { id: string }).id;
    for (const p of players) expect(await svc.joinTournament(id, p)).toEqual({ ok: true });
    // Full: sign-ups closed and round one started (both battles created and attached).
    const row = (await svc.tickTournament(id, true))!;
    expect(row.rec.status).toBe("running");
    expect(row.rec.matches.filter((m) => m.current)).toHaveLength(2);
    return { svc, id, players };
  }

  it("runs sign-ups to a champion, forfeits deciding each match", async () => {
    const { svc, id, players } = await fullTournament();
    const { actOnBattle, pollBattle, readBattleToken } = await import("@/lib/server/battle-engine/service");
    for (let round = 0; round < 2; round++) {
      for (const p of players) {
        const view = await svc.viewTournament(id, p);
        if (!view?.you?.match) continue;
        const seat = readBattleToken(view.you.match.token, view.you.match.code)!;
        expect((await pollBattle(view.you.match.code, view.you.match.token, 0)).ok).toBe(true);
        // The second trainer of each pair forfeits.
        if (seat.seat === 1) expect((await actOnBattle(view.you.match.code, seat.playerId, { action: "forfeit" }, 0)).ok).toBe(true);
      }
      await svc.tickTournament(id, true);
      await svc.tickTournament(id, true);
    }
    const done = (await svc.viewTournament(id, null))!;
    expect(done.status).toBe("finished");
    expect(done.results![0]).toHaveLength(1);
    expect(done.matches.every((m) => m.state === "done")).toBe(true);
    // Rated: each finished battle was settled once (ticking again changes nothing).
    const again = (await svc.tickTournament(id, true))!;
    expect(again.version).toBe((await svc.tickTournament(id, true))!.version);
  });

  it("a trainer who never opens their match loses after 3 minutes", async () => {
    const { svc, id, players } = await fullTournament();
    const { pollBattle } = await import("@/lib/server/battle-engine/service");
    // One trainer per pair turns up.
    const shown = new Set<string>();
    for (const p of players) {
      const view = await svc.viewTournament(id, p);
      const m = view!.you!.match!;
      if (shown.has(m.code)) continue;
      shown.add(m.code);
      await pollBattle(m.code, m.token, 0);
    }
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + NO_SHOW_MS + 5_000 });
    await svc.tickTournament(id, true);
    const after = (await svc.viewTournament(id, null))!;
    const first = after.matches.filter((m) => m.round === 1);
    expect(first.every((m) => m.state === "done" && m.note === "noshow")).toBe(true);
  });
});
