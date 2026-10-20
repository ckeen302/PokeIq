import { CLAIM_MS, type BracketNodeView, type TournamentMatchView, type TournamentView } from "@/lib/tournaments";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import { tournamentTitle } from "@/lib/tournaments";
import { availableElimMatches, disqualifyElim, elimEliminated, elimEnded, elimResults, elimRound, freezeElimination, setElimResult } from "./generator-elimination";
import { availableRRMatches, disqualifyRR, freezeRoundRobin, rrEnded, rrResults, setRRResult } from "./generator-round-robin";
import type { TourGame, TourMatch, TourRecord } from "./store";

/**
 * A tournament's rules, as pure functions on its record: closing sign-ups
 * and building the bracket, recording each game, deciding matches,
 * claiming the matches whose battles must be created, disqualifying and
 * finishing. The service (service.ts) does the reading and writing around
 * them; everything here is safe to run again on the same record (a game
 * is applied once, since it leaves `current`; a decided match stays
 * decided), which is what makes advancing idempotent.
 */

/** What a finished battle said: the winning seat (null: a draw) and who turned up. */
export interface GameOutcome {
  winner: 0 | 1 | null;
  arrived: [boolean, boolean];
}

const isDq = (rec: TourRecord) => (p: number) => !!rec.players[p]?.dq;

/** Fisher–Yates with the given random source. */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Closes sign-ups: the bracket (or table) is built, or the tournament is cancelled with fewer than two players. */
export function closeSignups(rec: TourRecord, now: number, random: () => number = Math.random): void {
  if (rec.status !== "signup") return;
  if (rec.players.length < 2) {
    cancelTournament(rec, "Not enough trainers signed up.", now);
    return;
  }
  rec.status = "running";
  rec.startedAt = now;
  const order = shuffled(rec.players.map((_, i) => i), random);
  if (rec.style === "elim") rec.elim = freezeElimination(order);
  else {
    // Round robin plays in a shuffled order too: reorder the players themselves.
    rec.players = order.map((i) => rec.players[i]);
    rec.rr = freezeRoundRobin(rec.players.length);
  }
}

export function cancelTournament(rec: TourRecord, reason: string, now: number): void {
  if (rec.status === "finished" || rec.status === "cancelled") return;
  rec.status = "cancelled";
  rec.cancelReason = reason;
  rec.endedAt = now;
  for (const m of rec.matches) m.claim = null;
}

const busy = (rec: TourRecord, p: number) => rec.matches.some((m) => !m.done && (m.a === p || m.b === p));

function newMatch(id: string, a: number, b: number, round: number): TourMatch {
  return { id, a, b, round, wins: [0, 0], games: [], current: null, claim: null, done: false, winner: null };
}

/** Writes a decided match into the bracket and the players' records. */
function decide(rec: TourRecord, m: TourMatch, winner: 0 | 1 | null, note?: TourMatch["note"], scored = true): void {
  if (m.done) return;
  m.done = true;
  m.winner = winner;
  m.claim = null;
  m.current = null;
  if (note) m.note = note;
  const [pa, pb] = [rec.players[m.a], rec.players[m.b]];
  pa.games++;
  pb.games++;
  if (winner === null) {
    if (scored) {
      pa.score += 0.5;
      pb.score += 0.5;
    } else {
      pa.losses++;
      pb.losses++;
    }
  } else {
    const [w, l] = winner === 0 ? [pa, pb] : [pb, pa];
    w.score += 1;
    w.wins++;
    l.losses++;
  }
  const score = winner === null ? [0, 0] : [m.wins[0], m.wins[1]];
  if (rec.elim && m.id.startsWith("e")) {
    const error = setElimResult(rec.elim, Number(m.id.slice(1)), winner === 1 ? "loss" : "win", score, isDq(rec));
    if (error) throw new Error(`Unexpected ${error} deciding ${m.id}`);
  } else if (rec.rr) {
    const [row, col] = m.id.slice(1).split("-").map(Number);
    setRRResult(rec.rr, row, col, winner === null ? "draw" : winner === 0 ? "win" : "loss", score);
  }
}

/**
 * A game of `m` is over. A trainer who never turned up loses the match (both
 * missing: in elimination both are disqualified; in round robin both lose).
 * A draw replays the game, except in a round robin Bo1 where it stands.
 */
export function applyGame(rec: TourRecord, matchId: string, out: GameOutcome): void {
  const m = rec.matches.find((x) => x.id === matchId);
  if (!m || m.done || !m.current) return;
  m.games.push({ ...m.current, winner: out.winner });
  m.current = null;
  if (!out.arrived[0] && !out.arrived[1]) {
    if (rec.style === "elim") {
      rec.players[m.a].dq = true;
      rec.players[m.b].dq = true;
      decide(rec, m, 1, "noshow");
    } else decide(rec, m, null, "noshow", false);
    return;
  }
  if (out.winner === null) {
    if (rec.style === "rr" && rec.bestOf === 1) decide(rec, m, null);
    // A match can't go on forever: after many draws, round robin calls it a draw and elimination a coin flip for player 1.
    else if (m.games.length >= rec.bestOf * 3) decide(rec, m, rec.style === "rr" ? null : 0);
    return;
  }
  m.wins[out.winner]++;
  if (!out.arrived[1 - out.winner]) decide(rec, m, out.winner, "noshow");
  else if (m.wins[out.winner] > rec.bestOf / 2) decide(rec, m, out.winner);
}

/**
 * Claims every match whose next battle must be created now: new matches the
 * bracket made available (both players free) and undecided ones between
 * games, plus claims gone stale. Returns the claimed match ids.
 */
export function claimMatches(rec: TourRecord, now: number, by: string): string[] {
  if (rec.status !== "running") return [];
  if (rec.elim) {
    for (const [node, a, b] of availableElimMatches(rec.elim)) {
      if (!rec.matches.some((m) => m.id === `e${node}`)) rec.matches.push(newMatch(`e${node}`, a, b, elimRound(rec.elim, node)));
    }
  } else if (rec.rr) {
    // Everyone plays one match at a time; rounds are just the order matches start in.
    const round = 1 + Math.floor(rec.matches.length / Math.max(1, Math.floor(rec.players.length / 2)));
    for (const [row, col] of availableRRMatches(rec.rr)) {
      if (rec.matches.some((m) => m.id === `r${row}-${col}`) || busy(rec, row) || busy(rec, col)) continue;
      rec.matches.push(newMatch(`r${row}-${col}`, row, col, round));
    }
  }
  const claimed: string[] = [];
  for (const m of rec.matches) {
    if (m.done || m.current) continue;
    if (m.claim && now - m.claim.at < CLAIM_MS) continue;
    m.claim = { by, at: now };
    claimed.push(m.id);
  }
  return claimed;
}

/** The battle for a claimed match was created: it becomes the current game (false if the claim was lost). */
export function attachGame(rec: TourRecord, matchId: string, by: string, game: TourGame): boolean {
  const m = rec.matches.find((x) => x.id === matchId);
  if (!m || m.done || m.current || m.claim?.by !== by || rec.status !== "running") return false;
  m.current = game;
  m.claim = null;
  return true;
}

/** Disqualifies a player: they lose what they're playing and everything after. */
export function disqualify(rec: TourRecord, p: number): void {
  const player = rec.players[p];
  if (!player || player.dq || rec.status !== "running") {
    if (player && rec.status === "signup") rec.players.splice(p, 1);
    return;
  }
  player.dq = true;
  for (const m of rec.matches) {
    if (m.done || (m.a !== p && m.b !== p)) continue;
    decide(rec, m, m.a === p ? 1 : 0, "dq");
  }
  if (rec.elim) disqualifyElim(rec.elim, p, isDq(rec));
  else if (rec.rr) {
    for (const [row, col, result] of disqualifyRR(rec.rr, p)) {
      const m = newMatch(`r${row}-${col}`, row, col, 0);
      m.done = true;
      m.winner = result === "win" ? 0 : 1;
      m.note = "dq";
      rec.matches.push(m);
      const [w, l] = result === "win" ? [rec.players[row], rec.players[col]] : [rec.players[col], rec.players[row]];
      w.score += 1;
      w.wins++;
      l.losses++;
      w.games++;
      l.games++;
    }
  }
}

/** Ends a tournament whose last match is decided. */
export function finishIfEnded(rec: TourRecord, now: number): boolean {
  if (rec.status !== "running") return false;
  const ended = rec.elim ? elimEnded(rec.elim) : rec.rr ? rrEnded(rec.rr) : false;
  if (!ended) return false;
  rec.status = "finished";
  rec.endedAt = now;
  rec.results = rec.elim ? elimResults(rec.elim) : rrResults(rec.players.map((p) => p.score));
  for (const m of rec.matches) m.claim = null;
  return true;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function bracketView(rec: TourRecord): BracketNodeView | null {
  const b = rec.elim;
  if (!b) return null;
  const walk = (i: number): BracketNodeView => {
    const n = b.nodes[i];
    const name = n.user === null ? null : rec.players[n.user]?.name ?? null;
    if (!n.children) return { name };
    return { name: n.state === "finished" ? name : null, match: `e${i}`, state: n.state, children: [walk(n.children[0]), walk(n.children[1])] };
  };
  return walk(b.root);
}

function matchView(rec: TourRecord, m: TourMatch): TournamentMatchView {
  const a = rec.players[m.a]?.name ?? "?";
  const b = rec.players[m.b]?.name ?? "?";
  return {
    id: m.id,
    a,
    b,
    wins: m.wins,
    state: m.done ? "done" : m.current ? "playing" : "waiting",
    winner: m.done && m.winner !== null ? (m.winner === 0 ? a : b) : null,
    code: m.current?.code ?? null,
    round: m.round,
    ...(m.note ? { note: m.note } : {}),
  };
}

/** The tournament as anyone may see it: no account ids, teams, ladder keys or seat ids. */
export function tournamentView(rec: TourRecord, version: number, now: number): TournamentView {
  const out = rec.elim ? elimEliminated(rec.elim) : new Set<number>();
  return {
    id: rec.id,
    title: tournamentTitle(rec.format, rec.official ? null : rec.hostName),
    format: rec.format,
    formatName: PLAY_FORMAT_INFO[rec.format].name,
    style: rec.style,
    bestOf: rec.bestOf,
    maxPlayers: rec.maxPlayers,
    official: rec.official,
    host: rec.hostName,
    status: rec.status,
    createdAt: rec.createdAt,
    signupEndsAt: rec.signupEndsAt,
    startedAt: rec.startedAt ?? null,
    endedAt: rec.endedAt ?? null,
    players: rec.players.map((p, i) => ({ name: p.name, score: p.score, wins: p.wins, losses: p.losses, dq: !!p.dq, out: out.has(i) })),
    matches: rec.matches.map((m) => matchView(rec, m)),
    bracket: bracketView(rec),
    results: rec.results ? rec.results.map((place) => place.map((i) => rec.players[i]?.name ?? "?")) : null,
    rated: rec.rated,
    ...(rec.cancelReason ? { cancelReason: rec.cancelReason } : {}),
    version,
    now,
  };
}

/** `userId`'s match waiting to be played, if any: its battle and their seat in it. */
export function playerMatch(rec: TourRecord, userId: string): { m: TourMatch; seat: 0 | 1 } | null {
  if (rec.status !== "running") return null;
  const p = rec.players.findIndex((x) => x.id === userId);
  if (p < 0) return null;
  const m = rec.matches.find((x) => !x.done && x.current && (x.a === p || x.b === p));
  return m ? { m, seat: m.a === p ? 0 : 1 } : null;
}
