import "server-only";
import { getPokemon, type Pokemon } from "@/lib/pokemon/pokedex";
import { Rng } from "@/lib/rng";
import { PVP_LEAD_MS } from "@/lib/pvp-types";
import {
  CLUE_KINDS,
  WHOAMI_BID_MS,
  WHOAMI_DEFAULT_ABILITY,
  WHOAMI_DEFAULT_POOL,
  WHOAMI_DROP_EVERY_MS,
  WHOAMI_LAST_CALL_MS,
  WHOAMI_MAX_BID,
  WHOAMI_REVEAL_MS,
  WHOAMI_ROUNDS,
  WHOAMI_ROUND_MS,
  WHOAMI_ROUND_WINS,
  WHOAMI_TAUNT_MS,
  resolveBids,
  type WhoamiAbility,
  type WhoamiBoard,
  type WhoamiClueKind,
  type WhoamiDuelView,
  type WhoamiPoolSettings,
  type WhoamiRoundResult,
} from "@/lib/whoami";
import { deriveSeed } from "./crypto";
import { baseView, fail, finish, newSeat, notPlaying, pvpBase, seatOf, seated, type PvpBase, type PvpOutcome, type PvpRules } from "./duel-core";
import { MIN_POOL, aliveOf, askSeat, clueFact, dailySecret, guessSeat, learn, mineOf, newSeatPlay, normalizeSettings, poolOf, seatScore, type WhoamiSeat } from "./whoami";

/**
 * Who Am I? duels: both trainers get the same secret Pokémon and race to
 * name it, asking yes/no questions paid for in PP. Best of three rounds.
 *
 * Every ~40 s a sealed clue drops: each trainer secretly bids PP on it for
 * 8 s; the higher bid wins the clue (a strong, true fact, shown only to the
 * winner), the loser gets half their bid back (a tie: nobody wins, both get
 * half back). Each trainer also brings one ability, once per round: Taunt,
 * Trace or Frisk.
 *
 * As with every duel, nothing runs on a timer: each request catches the duel
 * up, every step dated by the rules (clue drops, bids closing, the round's
 * end). The secret, a clue's content and the opponent's questions never
 * leave the server, except what Trace shows: their last question.
 */

interface WhoamiDrop {
  kind: WhoamiClueKind;
  opensAt: number;
  /** The clue (a question id whose answer is yes). Server-side only; shown to the winner once settled. */
  fact: string;
  bids: (number | null)[];
  result?: { winner: number | null; bids: number[] };
}

interface WhoamiRound {
  /** Server-side only until the round is over. */
  secret: number;
  startsAt: number;
  seats: WhoamiSeat[];
  /** When each seat used its ability this round (null: not yet). */
  used: (number | null)[];
  /** Trace's result per seat (the opponent's last question then), and Frisk's (their grid's size then). */
  traced: ({ q: string; yes: boolean } | null)[];
  frisked: (number | null)[];
  drops: WhoamiDrop[];
  skip: boolean[];
  result?: { at: number; timedOut: boolean; winner: number | null; scores: number[]; nextAt: number };
}

export interface WhoamiDuel extends PvpBase {
  kind: "whoami";
  settings: WhoamiPoolSettings;
  /** Each trainer's ability, by player id (absent: the default). */
  abilities: Record<string, WhoamiAbility>;
  rounds: WhoamiRound[];
  queue?: "casual";
}

/** A move sent just before the bell still counts if it arrives within this long after it. */
const GRACE_MS = 1_000;
/** Running out the clock without asking or guessing this many rounds in a row is a forfeit. */
const IDLE_ROUNDS = 2;

const abilityOf = (d: WhoamiDuel, seat: number): WhoamiAbility => d.abilities[d.players[seat]?.id] ?? WHOAMI_DEFAULT_ABILITY;

/** The round's secret: drawn by the duel's seed from its pool, never one this duel has had, nor today's daily. */
export function pickWhoamiSecret(seed: string, index: number, settings: WhoamiPoolSettings, taken: readonly number[], at: number): number {
  const daily = dailySecret(new Date(at).toISOString().slice(0, 10)).id;
  const pool = poolOf(settings);
  const fresh = pool.filter((p) => !taken.includes(p.id) && p.id !== daily);
  return new Rng(deriveSeed("whoami-duel", `${seed}:${index}`)).pick(fresh.length ? fresh : pool).id;
}

function newRound(d: WhoamiDuel, startsAt: number): WhoamiRound {
  return {
    secret: pickWhoamiSecret(d.seed, d.rounds.length, d.settings, d.rounds.map((r) => r.secret), startsAt),
    startsAt,
    seats: d.players.map(() => newSeatPlay()),
    used: d.players.map(() => null),
    traced: d.players.map(() => null),
    frisked: d.players.map(() => null),
    drops: [],
    skip: d.players.map(() => false),
  };
}

/** When the round closes: three minutes, or half a minute after the first solve, whichever is sooner. */
export function roundEnds(round: WhoamiRound): number {
  const solves = round.seats.map((s) => s.solvedAt).filter((t): t is number => t !== undefined);
  const limit = round.startsAt + WHOAMI_ROUND_MS;
  return solves.length ? Math.min(limit, Math.min(...solves) + WHOAMI_LAST_CALL_MS) : limit;
}

const dropCloses = (drop: WhoamiDrop) => drop.opensAt + WHOAMI_BID_MS;

function settleDrop(round: WhoamiRound, drop: WhoamiDrop) {
  const { winner, refunds } = resolveBids(drop.bids);
  drop.result = { winner, bids: drop.bids.map((b) => b ?? 0) };
  round.seats.forEach((s, seat) => (s.pp += refunds[seat]));
  if (winner !== null) learn(round.seats[winner], drop.fact, true, "clue");
}

/** Round winner: the first to solve; nobody solved: the most PP left (level: a draw). */
function roundWinner(round: WhoamiRound): number | null {
  const [a, b] = round.seats;
  if (a.solvedAt !== undefined || b.solvedAt !== undefined) {
    if (b.solvedAt === undefined) return 0;
    if (a.solvedAt === undefined) return 1;
    return a.solvedAt <= b.solvedAt ? 0 : 1;
  }
  return a.pp === b.pp ? null : a.pp > b.pp ? 0 : 1;
}

export function roundWins(d: WhoamiDuel): number[] {
  const wins = [0, 0];
  for (const r of d.rounds) if (r.result && r.result.winner !== null) wins[r.result.winner]++;
  return wins;
}

const totalsOf = (d: WhoamiDuel) => [0, 1].map((k) => d.rounds.reduce((sum, r) => sum + (r.result?.scores[k] ?? 0), 0));

/** The most rounds won takes the duel; then the most points; else a draw. */
function duelWinner(d: WhoamiDuel): number | null {
  const [w, t] = [roundWins(d), totalsOf(d)];
  if (w[0] !== w[1]) return w[0] > w[1] ? 0 : 1;
  if (t[0] !== t[1]) return t[0] > t[1] ? 0 : 1;
  return null;
}

const acted = (s: WhoamiSeat) => s.known.some((k) => k.via === "ask") || s.wrong.length > 0 || s.solvedAt !== undefined;

function closeRound(d: WhoamiDuel, round: WhoamiRound, at: number, timedOut: boolean) {
  const open = round.drops.at(-1);
  if (open && !open.result) settleDrop(round, open);
  round.result = { at, timedOut, winner: roundWinner(round), scores: round.seats.map(seatScore), nextAt: at + WHOAMI_REVEAL_MS };

  const idle = d.players.map(
    (_, seat) => d.rounds.length >= IDLE_ROUNDS && d.rounds.slice(-IDLE_ROUNDS).every((r) => r.result?.timedOut && !acted(r.seats[seat]))
  );
  const wins = roundWins(d);
  if (idle[0] !== idle[1]) finish(d, "idle", idle[0] ? 1 : 0, at);
  else if (idle[0]) finish(d, "idle", duelWinner(d), at);
  else if (wins.some((w) => w >= WHOAMI_ROUND_WINS) || d.rounds.length >= WHOAMI_ROUNDS) finish(d, "played", duelWinner(d), at);
}

export const whoamiRules: PvpRules<WhoamiDuel> = {
  begin(d, at) {
    d.rounds = [newRound(d, at)];
  },
  play(d, now) {
    const round = d.rounds[d.rounds.length - 1];
    if (round.result) {
      if (now < round.result.nextAt) return false;
      d.rounds.push(newRound(d, round.result.nextAt + PVP_LEAD_MS));
      return true;
    }
    const ends = roundEnds(round);
    const open = round.drops.at(-1);
    if (open && !open.result && now >= dropCloses(open) && dropCloses(open) <= ends) {
      settleDrop(round, open);
      return true;
    }
    const solves = round.seats.map((s) => s.solvedAt);
    if (solves.every((t) => t !== undefined)) {
      closeRound(d, round, Math.max(...(solves as number[])), false);
      return true;
    }
    if (now > ends + GRACE_MS) {
      closeRound(d, round, ends, solves.every((t) => t === undefined));
      return true;
    }
    const opensAt = round.startsAt + WHOAMI_DROP_EVERY_MS * (round.drops.length + 1);
    if (now >= opensAt && opensAt + WHOAMI_BID_MS <= ends && solves.every((t) => t === undefined || t > opensAt)) {
      const rng = new Rng(deriveSeed("whoami-clue", `${d.seed}:${d.rounds.length - 1}:${round.drops.length}`));
      const kind = rng.pick(CLUE_KINDS);
      round.drops.push({ kind, opensAt, fact: clueFact(kind, getPokemon(round.secret)!, rng), bids: d.players.map(() => null) });
      return true;
    }
    return false;
  },
  blank: (base, like) => blankDuel(base, like.settings, like.abilities),
};

const blankDuel = (base: PvpBase, settings: WhoamiPoolSettings, abilities: Record<string, WhoamiAbility> = {}): WhoamiDuel => ({
  ...base,
  kind: "whoami",
  settings,
  abilities,
  rounds: [],
});

export function createWhoamiDuel(
  name: string,
  code: string,
  now: number,
  opts: { settings?: Partial<WhoamiPoolSettings>; ability?: WhoamiAbility; queue?: "casual"; seed?: string } = {}
): { duel: WhoamiDuel; playerId: string } {
  const seat = newSeat(name, now);
  const duel = blankDuel(pvpBase("whoami", code, [seat], now, opts.seed), normalizeSettings(opts.settings ?? WHOAMI_DEFAULT_POOL), opts.ability ? { [seat.id]: opts.ability } : {});
  return { duel: opts.queue ? { ...duel, queue: opts.queue } : duel, playerId: seat.id };
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export type WhoamiMove =
  | { type: "settings"; settings: WhoamiPoolSettings }
  | { type: "pick"; ability: WhoamiAbility }
  | { type: "ask"; round: number; q: string }
  | { type: "guess"; round: number; pokemon: number }
  | { type: "bid"; round: number; amount: number }
  | { type: "ability"; round: number };

function liveRound(d: WhoamiDuel, index: number, now: number): WhoamiRound | ReturnType<typeof fail> {
  if (d.status !== "playing") return notPlaying(d);
  const round = d.rounds[d.rounds.length - 1];
  if (index !== d.rounds.length - 1 || round.result) return fail(409, "That round is over.");
  if (now < round.startsAt) return fail(409, "The round hasn't started yet.");
  return round;
}

export function whoamiMove(duel: WhoamiDuel, playerId: string, move: WhoamiMove, now: number): PvpOutcome<WhoamiDuel> {
  return seated(whoamiRules, duel, playerId, now, (d, seat) => {
    if (move.type === "settings" || move.type === "pick") {
      if (d.status !== "lobby") return fail(409, "The duel has already started.");
      if (move.type === "pick") {
        d.abilities = { ...d.abilities, [playerId]: move.ability };
        return { ok: true, duel: d };
      }
      if (seat !== 0) return fail(403, "Only the trainer who made the duel picks the Pokémon.");
      const settings = normalizeSettings(move.settings);
      if (poolOf(settings).length < MIN_POOL) return fail(400, "That leaves too few Pokémon. Widen the generations.");
      if (JSON.stringify(settings) === JSON.stringify(d.settings)) return { ok: true, duel: d };
      d.settings = settings;
      // Both get to see the change before the duel starts.
      for (const p of d.players) p.ready = false;
      return { ok: true, duel: d };
    }

    const round = liveRound(d, move.round, now);
    if ("ok" in round) return round;
    const me = round.seats[seat];
    const rival = round.seats[1 - seat];
    const secret = getPokemon(round.secret)!;
    switch (move.type) {
      case "ask": {
        const out = askSeat(me, secret, move.q, now);
        return out.ok ? { ok: true, duel: d } : out;
      }
      case "guess": {
        const out = guessSeat(me, secret, move.pokemon, poolOf(d.settings), now);
        return out.ok ? { ok: true, duel: d } : out;
      }
      case "bid": {
        const drop = round.drops.at(-1);
        if (!drop || drop.result || now >= dropCloses(drop)) return fail(409, "No clue is up for bids right now.");
        if (drop.bids[seat] !== null) return fail(409, "You've already bid on this clue.");
        if (!Number.isInteger(move.amount) || move.amount < 0 || move.amount > WHOAMI_MAX_BID) return fail(400, `Bid 0 to ${WHOAMI_MAX_BID} PP.`);
        if (move.amount > me.pp) return fail(409, "You don't have that much PP.");
        me.pp -= move.amount;
        drop.bids[seat] = move.amount;
        return { ok: true, duel: d };
      }
      case "ability": {
        if (round.used[seat] !== null) return fail(409, "You've used your ability this round.");
        const ability = abilityOf(d, seat);
        if (ability === "taunt") rival.tauntUntil = Math.max(rival.tauntUntil, now + WHOAMI_TAUNT_MS);
        else if (ability === "trace") {
          const last = rival.known.filter((k) => k.via === "ask").at(-1);
          if (!last) return fail(409, "Your opponent hasn't asked anything yet.");
          round.traced[seat] = { q: last.q, yes: last.yes };
          learn(me, last.q, last.yes, "trace");
        } else round.frisked[seat] = aliveOf(poolOf(d.settings), rival).length;
        round.used[seat] = now;
        return { ok: true, duel: d };
      }
    }
  });
}

/** Next round, please: once both trainers press it, the reveal ends early. */
export function skipWhoamiReveal(duel: WhoamiDuel, playerId: string, index: number, now: number): PvpOutcome<WhoamiDuel> {
  return seated(whoamiRules, duel, playerId, now, (d, seat) => {
    if (d.status !== "playing") return notPlaying(d);
    if (index < d.rounds.length - 1) return { ok: true, duel: d };
    const round = d.rounds[index];
    if (!round?.result) return fail(409, "That round isn't over yet.");
    round.skip[seat] = true;
    if (round.skip.every(Boolean)) round.result.nextAt = Math.min(round.result.nextAt, now);
    return { ok: true, duel: d };
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function boardOf(round: WhoamiRound, seat: number): WhoamiBoard {
  const s = round.seats[seat];
  return {
    pp: s.pp,
    asked: s.known.filter((k) => k.via === "ask").length,
    wrong: s.wrong.length,
    solvedMs: s.solvedAt !== undefined ? s.solvedAt - round.startsAt : undefined,
    lockUntil: s.lockUntil,
    tauntUntil: s.tauntUntil,
    abilityUsed: round.used[seat] !== null,
    score: seatScore(s),
  };
}

const answerOf = (p: Pokemon) => ({ id: p.id, name: p.name, genus: p.genus });

/** What one trainer (or a visitor: null) may see of the duel right now. */
export function whoamiView(duel: WhoamiDuel, playerId: string | null, now: number, rev: number): WhoamiDuelView {
  const seat = seatOf(duel, playerId);
  const pool = poolOf(duel.settings);
  const revealed = duel.rounds.flatMap((r, index): WhoamiRoundResult[] =>
    r.result
      ? [{ index, answer: answerOf(getPokemon(r.secret)!), boards: r.seats.map((_, k) => boardOf(r, k)), winner: r.result.winner, timedOut: r.result.timedOut }]
      : []
  );
  const last = duel.rounds[duel.rounds.length - 1];
  const live = duel.status === "playing" && last && !last.result ? last : undefined;
  let round: WhoamiDuelView["round"];
  if (live) {
    const drop = live.drops.at(-1);
    round = {
      index: duel.rounds.length - 1,
      startsAt: live.startsAt,
      endsAt: roundEnds(live),
      boards: live.seats.map((_, k) => boardOf(live, k)),
      // Your own questions, answers and grid; never the opponent's.
      ...(seat >= 0 && {
        mine: mineOf(live.seats[seat], pool),
        traced: live.traced[seat],
        ...(live.frisked[seat] !== null && { frisked: live.frisked[seat]! }),
      }),
      ...(drop && {
        drop: {
          index: live.drops.length - 1,
          kind: drop.kind,
          opensAt: drop.opensAt,
          closesAt: dropCloses(drop),
          bid: seat >= 0 ? drop.bids[seat] : null,
          rivalBid: seat >= 0 ? drop.bids[1 - seat] !== null : false,
          result: drop.result,
        },
      }),
    };
  }
  return {
    kind: "whoami",
    ...baseView(duel, playerId, now, rev),
    settings: duel.settings,
    abilities: duel.players.map((_, k) => abilityOf(duel, k)),
    pool: pool.map((p) => p.id),
    rounds: WHOAMI_ROUNDS,
    wins: roundWins(duel),
    totals: totalsOf(duel),
    round,
    revealed,
    next: duel.status === "playing" && last?.result ? { at: last.result.nextAt, pressed: last.skip } : undefined,
    queue: duel.queue,
  };
}



