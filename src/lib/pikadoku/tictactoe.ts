/**
 * Pikadoku Tic Tac Toe: two players share one grid and take turns claiming
 * cells with a valid Pokémon. Three in a row wins. A wrong guess or a timeout
 * passes the turn. In Steals mode a cell the opponent holds can be taken with
 * a rarer Pokémon. Pure rules; the duel server calls these.
 */
export type TttMark = "X" | "O";
export interface TttState {
  owners: (TttMark | null)[];
  used: number[];
  turn: TttMark;
  winner: TttMark | "draw" | null;
  line: number[] | null;
}

export const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export const newTtt = (): TttState => ({ owners: Array(9).fill(null), used: [], turn: "X", winner: null, line: null });
const other = (m: TttMark): TttMark => (m === "X" ? "O" : "X");

export function tttWinner(owners: readonly (TttMark | null)[]): { mark: TttMark; line: number[] } | null {
  for (const line of TTT_LINES) {
    const m = owners[line[0]];
    if (m && line.every((i) => owners[i] === m)) return { mark: m, line };
  }
  return null;
}

export type TttOutcome = "claimed" | "stolen" | "missed" | "notrarer" | "timeout" | "illegal";

/** A game with steals can't fill up, so it ends as a draw after this many claims. */
export const TTT_STEAL_CAP = 27;

export interface TttRules {
  /** Steals mode: a cell the opponent holds can be claimed with a rarer, different Pokémon. */
  steals?: boolean;
  /** The Pokémon id now holding the cell being played (the server tracks it). */
  holder?: number | null;
  /** Pick % of a Pokémon (lower = rarer); absent when rarity data is missing, and then any different valid Pokémon steals. */
  rarity?: (id: number) => number;
}

/** Can `id` take a cell from `holder` by rarity? Without rarity data, any different Pokémon can. */
export function beatsHolder(id: number, holder: number | null | undefined, rarity?: (id: number) => number): boolean {
  if (!rarity || holder == null) return true;
  return rarity(id) < rarity(holder);
}

/**
 * A turn's guess. `valid` is the server's check of the Pokémon against the
 * cell. `base` maps a form to its species (a form and its species are one
 * Pokémon, so `used` holds species ids). In steals mode a cell held by the
 * opponent can be claimed with a different valid Pokémon that is rarer; a
 * failed steal passes the turn like a miss. Your own cells can't be played.
 */
export function playTtt(s: TttState, cell: number, id: number, valid: boolean, base: (id: number) => number = (x) => x, rules: TttRules = {}): { state: TttState; outcome: TttOutcome } {
  if (s.winner || cell < 0 || cell > 8 || s.used.includes(base(id))) return { state: s, outcome: "illegal" };
  const holder = s.owners[cell];
  if (holder && (!rules.steals || holder === s.turn)) return { state: s, outcome: "illegal" };
  const pass = (outcome: TttOutcome) => ({ state: { ...s, turn: other(s.turn) }, outcome });
  if (!valid) return pass("missed");
  if (holder && !beatsHolder(id, rules.holder, rules.rarity)) return pass("notrarer");
  const owners = s.owners.slice();
  owners[cell] = s.turn;
  const used = [...s.used, base(id)];
  const outcome: TttOutcome = holder ? "stolen" : "claimed";
  const win = tttWinner(owners);
  if (win) return { state: { owners, used, turn: s.turn, winner: win.mark, line: win.line }, outcome };
  const done = rules.steals ? used.length >= TTT_STEAL_CAP : owners.every(Boolean);
  return { state: { owners, used, turn: other(s.turn), winner: done ? "draw" : null, line: null }, outcome };
}

/** The turn timer ran out. */
export function timeoutTtt(s: TttState): TttState {
  return s.winner ? s : { ...s, turn: other(s.turn) };
}
