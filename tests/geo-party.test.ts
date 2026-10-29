import { describe, expect, it } from "vitest";
import {
  advanceParty,
  createParty,
  emoteParty,
  guessParty,
  joinParty,
  kickPlayer,
  leaveParty,
  partyAgain,
  partyRoundAnswer,
  partyToken,
  partyView,
  readPartyToken,
  setPartySettings,
  setTeam,
  skipPartyReveal,
  startParty,
  touchParty,
  type GeoParty,
  type PartyOutcome,
} from "@/lib/server/geo-party";
import {
  PARTY_AWAY_MS,
  PARTY_FIRST_LEAD_MS,
  PARTY_MAX_PLAYERS,
  PARTY_TEAM_HP,
  defaultPartySettings,
  livesAfter,
  parsePartySettings,
  royaleLosers,
  royalePlaces,
  royaleWinners,
  teamRound,
} from "@/lib/geo-party";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const S = 1000;

const must = (out: PartyOutcome): GeoParty => {
  if (!out.ok) throw new Error(out.error);
  return out.party;
};

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

describe("Battle Royale rules", () => {
  it("takes a life from the lowest score", () => {
    expect(royaleLosers([4000, 1200, 3000], [true, true, true])).toEqual([1]);
  });
  it("takes a life from every trainer tied on the lowest score", () => {
    expect(royaleLosers([4000, 1200, 1200, 5000], [true, true, true, true])).toEqual([1, 2]);
  });
  it("takes no life when everyone still in is level", () => {
    expect(royaleLosers([0, 0, 0], [true, true, true])).toEqual([]);
    expect(royaleLosers([2500, 2500], [true, true])).toEqual([]);
  });
  it("ignores trainers who are out (and their scores)", () => {
    expect(royaleLosers([0, 3000, 2000], [false, true, true])).toEqual([2]);
    // Only one trainer still in: nobody to beat.
    expect(royaleLosers([0, 3000], [false, true])).toEqual([]);
  });
  it("never takes lives below zero", () => {
    expect(livesAfter([1, 0, 3], [0, 1])).toEqual([0, 0, 3]);
  });
  it("places the last trainer standing first, then by how long each lasted", () => {
    const places = royalePlaces([
      { lives: 0, outRound: 2, points: 9000 },
      { lives: 1, points: 7000 },
      { lives: 0, outRound: 4, points: 3000 },
      { lives: 0, outRound: 2, points: 9000 },
      { lives: 0, outRound: 2, points: 8000 },
    ]);
    expect(places).toEqual([3, 1, 2, 3, 5]);
    expect(royaleWinners([{ lives: 2, points: 10 }, { lives: 2, points: 10 }, { lives: 0, outRound: 0, points: 0 }])).toEqual([0, 1]);
  });
  it("breaks a capped game on lives, then points", () => {
    expect(royalePlaces([{ lives: 1, points: 20000 }, { lives: 2, points: 100 }, { lives: 1, points: 5 }])).toEqual([2, 1, 3]);
  });
});

describe("team duel rules", () => {
  it("scores each team by its best member and deals the gap times the multiplier", () => {
    const t = teamRound([4000, 1000, 3500, 3600], [0, 0, 1, 1], 0);
    expect(t.scores).toEqual([4000, 3600]);
    expect(t.best).toEqual([0, 3]);
    expect(t.hurt).toBe(1);
    expect(t.damage).toBe(400);
    // Round 4 is ×1.5.
    expect(teamRound([4000, 1000, 3500, 3600], [0, 0, 1, 1], 3).damage).toBe(600);
  });
  it("deals nothing when the best scores tie, and skips trainers not playing", () => {
    expect(teamRound([3000, 0, 3000, 0], [0, 0, 1, 1], 0).hurt).toBeNull();
    expect(teamRound([5000, 100, 200], [null, 0, 1], 0)).toMatchObject({ scores: [100, 200], hurt: 0, damage: 100 });
  });
});

describe("party settings", () => {
  const base = defaultPartySettings("world");
  it("accepts only the options on the menu", () => {
    expect(parsePartySettings({ lives: 5, roundSeconds: 30 }, base)).toMatchObject({ lives: 5, roundSeconds: 30, mode: "royale" });
    expect(parsePartySettings({ lives: 9 }, base)).toBeNull();
    expect(parsePartySettings({ roundSeconds: 45 }, base)).toBeNull();
    expect(parsePartySettings({ mode: "solo" }, base)).toBeNull();
  });
  it("switching mode picks that mode's default round cap", () => {
    expect(parsePartySettings({ mode: "team" }, base)?.rounds).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** A room on Kanto with `names` (the first is the host). */
function room(names: string[], mode: "royale" | "team" = "royale") {
  const { party, playerId } = createParty("abcdef", names[0], "kanto", T0, mode);
  let p = { ...party, seed: "party-seed" };
  const ids = [playerId];
  for (const name of names.slice(1)) {
    const out = joinParty(p, name, T0 + S);
    if (!out.ok) throw new Error(out.error);
    p = out.party;
    ids.push(out.playerId);
  }
  return { p, ids };
}

const pinOf = (p: GeoParty, index: number, off = 0) => {
  const [x, y] = partyRoundAnswer(p, index).pin;
  return { x: Math.min(1, Math.max(0, x + off)), y };
};

/** Everyone in `ids` touches the party at `t` (so nobody goes quiet). */
const all = (p: GeoParty, ids: string[], t: number) => ids.reduce((d, id) => touchParty(d, id, t), p);

/** Plays the live round: each trainer's offset from the answer (null: no guess), then runs out the reveal. */
function playRound(p: GeoParty, ids: string[], offsets: (number | null)[]) {
  const index = p.rounds.length - 1;
  const t = Math.max(p.rounds[index].startsAt + S, ...ids.map(() => 0));
  let d = all(p, ids, t);
  ids.forEach((id, k) => {
    if (offsets[k] === null || !d.rounds[index].playing[k] || d.rounds[index].result) return;
    d = must(guessParty(d, id, index, pinOf(d, index, offsets[k]!), t));
  });
  // Keep everyone here while the clock runs, until the next round is dealt (or the game ends).
  for (let at = t; at < t + 200 * S && d.status === "playing" && d.rounds.length === index + 1; at += 2 * S) d = all(d, ids, at);
  return d;
}

describe("party lobby", () => {
  it("lets trainers join up to the cap, with unique names", () => {
    let { p } = room(["Red"]);
    for (let i = 1; i < PARTY_MAX_PLAYERS; i++) {
      const out = joinParty(p, `T${i}`, T0 + S);
      expect(out.ok).toBe(true);
      if (out.ok) p = out.party;
    }
    expect(p.players).toHaveLength(PARTY_MAX_PLAYERS);
    const full = joinParty(p, "Late", T0 + S);
    expect(!full.ok && full.error).toMatch(/full/);
    const { p: two } = room(["Red", "Blue"]);
    const dup = joinParty(two, "blue", T0 + S);
    expect(!dup.ok && dup.error).toMatch(/already in this party/);
  });

  it("only the host changes settings, starts and kicks", () => {
    const { p, ids } = room(["Red", "Blue", "Green"]);
    const settings = { ...p.settings, lives: 1 };
    expect(setPartySettings(p, ids[1], settings, T0 + 2 * S).ok).toBe(false);
    expect(startParty(p, ids[1], T0 + 2 * S).ok).toBe(false);
    expect(kickPlayer(p, ids[1], 2, T0 + 2 * S).ok).toBe(false);
    const changed = must(setPartySettings(p, ids[0], settings, T0 + 2 * S));
    expect(changed.players.every((x) => x.lives === 1)).toBe(true);
  });

  it("a kicked trainer can't come back, by seat or by name", () => {
    const { p, ids } = room(["Red", "Blue", "Green"]);
    const kicked = must(kickPlayer(p, ids[0], 1, T0 + 2 * S));
    expect(kicked.players.map((x) => x.name)).toEqual(["Red", "Green"]);
    expect(joinParty(kicked, "Blue", T0 + 3 * S).ok).toBe(false);
    expect(joinParty(kicked, "Someone", T0 + 3 * S, ids[1]).ok).toBe(false);
    expect(partyView(kicked, ids[1], T0 + 3 * S, 1).you).toBeNull();
  });

  it("a trainer dropped from the lobby takes their seat back with their token", () => {
    const { p, ids } = room(["Red", "Blue"]);
    const later = T0 + PARTY_AWAY_MS + 5 * S;
    const dropped = touchParty(p, ids[0], later);
    expect(dropped.players.map((x) => x.name)).toEqual(["Red"]);
    const seat = readPartyToken(partyToken("abcdef", ids[1], "Blue"), "abcdef");
    expect(seat).toEqual({ id: ids[1], name: "Blue" });
    expect(readPartyToken(partyToken("abcdef", ids[1], "Blue"), "zzzzzz")).toBeNull();
    const back = joinParty(dropped, seat!.name, later, seat!.id);
    expect(back.ok && back.playerId).toBe(ids[1]);
  });

  it("passes the host on when the host leaves", () => {
    const { p, ids } = room(["Red", "Blue", "Green"]);
    const left = must(leaveParty(p, ids[0], T0 + 2 * S));
    expect(partyView(left, ids[1], T0 + 2 * S, 1).host).toBe(0);
    expect(left.hostId).toBe(ids[1]);
  });

  it("needs two trainers for a Battle Royale, and a trainer on each team for a team duel", () => {
    const { p, ids } = room(["Red"]);
    expect(startParty(p, ids[0], T0 + S).ok).toBe(false);
    const t = room(["Red", "Blue"], "team");
    expect(t.p.players.map((x) => x.team)).toEqual([0, 1]);
    const lopsided = must(setTeam(t.p, t.ids[1], undefined, 0, T0 + 2 * S));
    const blocked = startParty(lopsided, t.ids[0], T0 + 2 * S);
    expect(!blocked.ok && blocked.error).toMatch(/Each team/);
  });
});

describe("Battle Royale", () => {
  it("is sealed: nobody sees the place or another pin before the reveal", () => {
    const { p, ids } = room(["Red", "Blue", "Green"]);
    let d = must(startParty(p, ids[0], T0 + 2 * S));
    const t = T0 + 2 * S + PARTY_FIRST_LEAD_MS + S;
    d = all(d, ids, t);
    d = must(guessParty(d, ids[0], 0, pinOf(d, 0), t));
    const seen = JSON.stringify(partyView(d, ids[1], t, 1));
    const answer = partyRoundAnswer(d, 0);
    expect(seen).not.toContain(answer.name);
    expect(seen).not.toContain(String(pinOf(d, 0).x));
    expect(partyView(d, ids[1], t, 1).round?.guessed).toEqual([true, false, false]);
    expect(partyView(d, ids[1], t, 1).round?.mates).toBeUndefined();
  });

  it("knocks trainers out on lives until the last one standing wins", () => {
    const { p, ids } = room(["Red", "Blue", "Green"]);
    let d = must(setPartySettings(p, ids[0], { ...p.settings, lives: 2 }, T0 + 2 * S));
    d = must(startParty(d, ids[0], T0 + 2 * S));
    // Green is furthest twice: out after round 2.
    d = playRound(d, ids, [0, 0.05, 0.3]);
    expect(d.rounds[0].result?.losers).toEqual([2]);
    expect(d.players.map((x) => x.lives)).toEqual([2, 2, 1]);
    d = playRound(d, ids, [0, 0.05, 0.3]);
    expect(d.players[2].lives).toBe(0);
    expect(d.players[2].outRound).toBe(1);
    expect(d.status).toBe("playing");
    // Green watches: no longer playing the rounds.
    expect(d.rounds[2].playing).toEqual([true, true, false]);
    const spectator = partyView(d, ids[2], d.rounds[2].startsAt + S, 9);
    expect(spectator.players[2].out).toBe(true);
    expect(guessParty(d, ids[2], 2, { x: 0.5, y: 0.5 }, d.rounds[2].startsAt + S).ok).toBe(false);
    // Blue misses twice.
    d = playRound(d, ids, [0, 0.2, null]);
    d = playRound(d, ids, [0, 0.2, null]);
    expect(d.status).toBe("finished");
    expect(d.end?.reason).toBe("last");
    expect(d.end?.winners).toEqual([0]);
    expect(d.end?.places).toEqual([1, 2, 3]);
  });

  it("trainers level on the lowest score both lose a life; an all-level round costs nobody", () => {
    const { p, ids } = room(["Red", "Blue", "Green"]);
    let d = must(startParty(p, ids[0], T0 + 2 * S));
    d = playRound(d, ids, [0, null, null]);
    expect(d.rounds[0].result?.losers).toEqual([1, 2]);
    d = playRound(d, ids, [null, null, null]);
    expect(d.rounds[1].result?.losers).toEqual([]);
    expect(d.players.map((x) => x.lives)).toEqual([3, 2, 2]);
  });

  it("a trainer who goes quiet is out, and the reveal waits only for those still in", () => {
    const { p, ids } = room(["Red", "Blue", "Green"]);
    let d = must(startParty(p, ids[0], T0 + 2 * S));
    d = playRound(d, ids, [0, 0.05, 0.3]);
    // Green stops polling.
    const t = Math.max(...d.players.map((x) => x.seenAt));
    for (let at = t; at < t + PARTY_AWAY_MS + 10 * S; at += 5 * S) d = all(d, ids.slice(0, 2), at);
    expect(d.players[2].left).toBe(true);
    expect(d.status).toBe("playing");
    const index = d.rounds.length - 1;
    const now = Math.max(d.rounds[index].startsAt + S, t + PARTY_AWAY_MS + 10 * S);
    d = all(d, ids.slice(0, 2), now);
    if (!d.rounds[index].result) {
      d = must(guessParty(d, ids[0], index, pinOf(d, index), now));
      d = must(guessParty(d, ids[1], index, pinOf(d, index, 0.1), now));
      expect(d.rounds[index].result).toBeDefined();
      d = must(skipPartyReveal(d, ids[0], index, now));
      d = must(skipPartyReveal(d, ids[1], index, now));
      expect(d.rounds[index].result!.nextAt).toBe(now);
    }
  });

  it("the last trainer standing wins when everyone else leaves", () => {
    const { p, ids } = room(["Red", "Blue"]);
    let d = must(startParty(p, ids[0], T0 + 2 * S));
    d = must(leaveParty(d, ids[1], T0 + 3 * S));
    expect(d.status).toBe("finished");
    expect(d.end?.winners).toEqual([0]);
  });

  it("Play again takes the room back to the lobby with everyone still here", () => {
    const { p, ids } = room(["Red", "Blue", "Green"]);
    let d = must(startParty(p, ids[0], T0 + 2 * S));
    d = must(leaveParty(d, ids[2], T0 + 3 * S));
    d = must(leaveParty(d, ids[1], T0 + 3 * S));
    expect(d.status).toBe("finished");
    expect(partyAgain(d, ids[1], T0 + 4 * S).ok).toBe(false);
    const again = must(partyAgain(d, ids[0], T0 + 4 * S));
    expect(again.status).toBe("lobby");
    expect(again.players.map((x) => x.name)).toEqual(["Red"]);
    expect(again.seed).not.toBe(d.seed);
  });

  it("taunts wait for the end; reactions are rate limited", () => {
    const { p, ids } = room(["Red", "Blue"]);
    const d = must(startParty(p, ids[0], T0 + 2 * S));
    expect(emoteParty(d, ids[0], "dab", T0 + 3 * S).ok).toBe(false);
    const once = must(emoteParty(d, ids[0], "gg", T0 + 3 * S));
    expect(emoteParty(once, ids[0], "fire", T0 + 3 * S + 100).ok).toBe(false);
  });
});

describe("team duels", () => {
  it("shares HP per team, scores the best member and shows teammates' pins only", () => {
    const { p, ids } = room(["Red", "Blue", "Green", "Gold"], "team");
    expect(p.players.map((x) => x.team)).toEqual([0, 1, 0, 1]);
    let d = must(startParty(p, ids[0], T0 + 2 * S));
    const index = 0;
    const t = d.rounds[0].startsAt + S;
    d = all(d, ids, t);
    d = must(guessParty(d, ids[2], index, pinOf(d, 0, 0.2), t));
    const red = partyView(d, ids[0], t, 1).round!;
    expect(red.mates?.[2]).toMatchObject({ locked: true });
    expect(red.mates?.[1]).toBeNull();
    const blue = partyView(d, ids[1], t, 1).round!;
    expect(blue.mates?.[2]).toBeNull();
    // Red is spot on; Blue's best is a little off: Blue's team takes the gap.
    d = must(guessParty(d, ids[0], index, pinOf(d, 0), t));
    d = must(guessParty(d, ids[1], index, pinOf(d, 0, 0.05), t));
    d = must(guessParty(d, ids[3], index, pinOf(d, 0, 0.3), t));
    const r = d.rounds[0].result!;
    expect(r.team?.best).toEqual([0, 1]);
    expect(r.team?.hurt).toBe(1);
    expect(r.team?.damage).toBe(r.scores[0] - r.scores[1]);
    expect(d.hp).toEqual([PARTY_TEAM_HP, PARTY_TEAM_HP - r.team!.damage]);
  });

  it("a team with nobody left loses", () => {
    const { p, ids } = room(["Red", "Blue", "Green", "Gold"], "team");
    let d = must(startParty(p, ids[0], T0 + 2 * S));
    d = must(leaveParty(d, ids[1], T0 + 3 * S));
    expect(d.status).toBe("playing");
    d = must(leaveParty(d, ids[3], T0 + 3 * S));
    expect(d.status).toBe("finished");
    expect(d.end?.team).toBe(0);
    expect(d.end?.places).toEqual([1, 2, 1, 2]);
  });

  it("runs to 0 HP", () => {
    const { p, ids } = room(["Red", "Blue"], "team");
    let d = must(startParty(p, ids[0], T0 + 2 * S));
    for (let i = 0; i < 12 && d.status === "playing"; i++) d = playRound(d, ids, [0, null]);
    expect(d.status).toBe("finished");
    expect(d.end?.reason).toBe("hp");
    expect(d.end?.team).toBe(0);
    expect(advanceParty(d, T0 + 10_000 * S).status).toBe("finished");
  });
});
