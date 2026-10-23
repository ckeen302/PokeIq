import "server-only";
import type { PdkDuelView } from "@/lib/pvp-types";
import { generateGrid, gridFromIds, type PdkGrid, type PdkGridIds } from "@/lib/pikadoku/generator";
import { newTtt, playTtt, timeoutTtt, type TttState, type TttOutcome } from "@/lib/pikadoku/tictactoe";
import { PDK_FAMILIES, type PdkFamily } from "@/lib/pikadoku/types";
import { baseOf } from "@/lib/pikadoku/categories";
import { gridView, isDexId } from "./pikadoku";
import { baseView, fail, finish, newSeat, notPlaying, pvpBase, seated, type PvpBase, type PvpOutcome, type PvpRules } from "./duel-core";

/**
 * Pikadoku Tic Tac Toe duels. Two trainers share one grid (seat 0 plays X,
 * seat 1 plays O) and take turns claiming a cell with a Pokémon that fits
 * both its row and its column; three in a row wins. A wrong guess, or a turn
 * that runs out of time, passes the turn. A Pokémon can be used once.
 *
 * Every guess is checked here, and the view shows the six categories and who
 * owns what, never the cells' valid answers. Nothing runs on a timer: each
 * request catches the duel up, every timeout dated by the rules (turn start
 * plus the turn timer) rather than by when the request arrived.
 */

export const PDK_DUEL_MIN_SECS = 10;
export const PDK_DUEL_MAX_SECS = 90;
export const PDK_DUEL_DEFAULT_SECS = 30;
/** A game that is still undecided after this long is a draw (a safety net). */
const MAX_GAME_MS = 30 * 60_000;

export interface PikadokuDuel extends PvpBase {
  kind: "pikadoku";
  turnSecs: number;
  families: PdkFamily[];
  /** Steals mode: a cell the opponent holds can be taken with a rarer Pokémon. */
  steals?: boolean;
  /** The grid's category ids (server-side only; the cells' answers are derived from them). */
  gridIds: PdkGridIds;
  startsAt?: number;
  turnStart?: number;
  ttt: TttState;
  /** The Pokémon claimed in each cell. */
  picks: (number | null)[];
  last?: { seat: number; cell: number; id: number; hit: boolean; at: number; outcome?: TttOutcome };
}

export interface PdkDuelOptions {
  turnSecs?: number;
  families?: readonly string[];
  steals?: boolean;
}

const grids = new Map<string, PdkGrid>();
const gridOf = (d: PikadokuDuel): PdkGrid => {
  const key = d.gridIds.rows.concat(d.gridIds.cols).join("|");
  let g = grids.get(key);
  if (!g) {
    if (grids.size > 200) grids.clear();
    grids.set(key, (g = gridFromIds(d.gridIds)));
  }
  return g;
};

const cleanFamilies = (f?: readonly string[]): PdkFamily[] => {
  const out = PDK_FAMILIES.filter((x) => f?.includes(x));
  return out.length ? out : [...PDK_FAMILIES];
};
const cleanSecs = (s?: number) => Math.min(PDK_DUEL_MAX_SECS, Math.max(PDK_DUEL_MIN_SECS, Math.round(s ?? PDK_DUEL_DEFAULT_SECS)));

function blankDuel(base: PvpBase, opts: PdkDuelOptions): PikadokuDuel {
  const families = cleanFamilies(opts.families);
  return {
    ...base,
    kind: "pikadoku",
    turnSecs: cleanSecs(opts.turnSecs),
    families,
    ...(opts.steals && { steals: true }),
    gridIds: generateGrid(`duel:${base.seed}`, { difficulty: "normal", families }),
    ttt: newTtt(),
    picks: Array(9).fill(null),
  };
}

export function createPikadokuDuel(name: string, code: string, now: number, opts: PdkDuelOptions = {}, seed?: string): { duel: PikadokuDuel; playerId: string } {
  const seat = newSeat(name, now);
  return { duel: blankDuel(pvpBase("pikadoku", code, [seat], now, seed), opts), playerId: seat.id };
}

const turnMs = (d: PikadokuDuel) => d.turnSecs * 1000;

function conclude(d: PikadokuDuel, at: number) {
  if (!d.ttt.winner) return;
  finish(d, "played", d.ttt.winner === "draw" ? null : d.ttt.winner === "X" ? 0 : 1, at);
}

export const pikadokuRules: PvpRules<PikadokuDuel> = {
  begin(d, at) {
    d.startsAt = at;
    d.turnStart = at;
    d.ttt = newTtt();
    d.picks = Array(9).fill(null);
    delete d.last;
  },
  play(d, now) {
    if (d.startsAt === undefined || d.turnStart === undefined || d.status !== "playing") return false;
    if (now - d.startsAt >= MAX_GAME_MS) {
      d.ttt = { ...d.ttt, winner: "draw" };
      conclude(d, d.startsAt + MAX_GAME_MS);
      return true;
    }
    if (now < d.turnStart + turnMs(d)) return false;
    // The turn ran out: pass it, dated by the rules.
    d.ttt = timeoutTtt(d.ttt);
    d.turnStart += turnMs(d);
    return true;
  },
  blank: (base, like) => blankDuel(base, { turnSecs: like.turnSecs, families: like.families, steals: like.steals }),
};

/** A trainer's claim: this Pokémon in this cell. A wrong guess passes the turn; it is not an error. */
export function claimCell(duel: PikadokuDuel, playerId: string, cell: number, id: number, now: number, rates: ReadonlyMap<number, number> | null = null): PvpOutcome<PikadokuDuel> {
  return seated(pikadokuRules, duel, playerId, now, (d, seat) => {
    if (d.status !== "playing") return notPlaying(d);
    if (d.startsAt === undefined || now < d.startsAt) return fail(409, "The game hasn't started yet.");
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || !isDexId(id)) return fail(400, "Pick a cell and a Pokémon.");
    if ((d.ttt.turn === "X" ? 0 : 1) !== seat) return fail(409, "It's not your turn.");
    const valid = gridOf(d).answers[cell].includes(id);
    const rules = { steals: !!d.steals, holder: d.picks[cell], rarity: rates ? (x: number) => rates.get(x) ?? 0 : undefined };
    const { state, outcome } = playTtt(d.ttt, cell, id, valid, baseOf, rules);
    if (outcome === "illegal") return fail(409, d.ttt.owners[cell] ? (d.steals ? "That cell is yours, or the game is over." : "That cell is taken.") : "That Pokémon was already used.");
    d.ttt = state;
    d.turnStart = now;
    d.last = { seat, cell, id, hit: outcome === "claimed" || outcome === "stolen", at: now, outcome };
    if (outcome === "claimed" || outcome === "stolen") d.picks[cell] = id;
    conclude(d, now);
    return { ok: true, duel: d };
  });
}

/** What a trainer (or a visitor) may see: the categories once play starts, who owns what, never the valid answers. */
export function pikadokuView(duel: PikadokuDuel, playerId: string | null, now: number, rev: number): PdkDuelView {
  const begun = duel.startsAt !== undefined && (duel.status !== "lobby" && now >= duel.startsAt);
  return {
    kind: "pikadoku",
    ...baseView(duel, playerId, now, rev),
    settings: { turnSecs: duel.turnSecs, families: duel.families, steals: !!duel.steals },
    ...(duel.startsAt !== undefined && duel.status === "playing" && { round: { startsAt: duel.startsAt, endsAt: duel.startsAt + MAX_GAME_MS } }),
    ...(begun || duel.status === "finished" ? { grid: gridView(gridOf(duel)) } : {}),
    owners: duel.ttt.owners.map((o) => (o === "X" ? 0 : o === "O" ? 1 : null)),
    picks: duel.picks,
    used: duel.ttt.used,
    turn: duel.ttt.turn === "X" ? 0 : 1,
    ...(duel.turnStart !== undefined && duel.status === "playing" && { turnEndsAt: duel.turnStart + turnMs(duel) }),
    line: duel.ttt.line,
    ...(duel.last && { last: duel.last }),
  };
}
