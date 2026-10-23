/**
 * Pikadoku Tic Tac Toe: two players share one grid and take turns claiming
 * cells with a valid Pokémon. Three in a row wins. A wrong guess or a timeout
 * passes the turn. Pure rules; the duel server calls these.
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

export type TttOutcome = "claimed" | "missed" | "timeout" | "illegal";

/** A turn's guess. `valid` is the server's check of the Pokémon against the cell. */
export function playTtt(s: TttState, cell: number, id: number, valid: boolean): { state: TttState; outcome: TttOutcome } {
  if (s.winner || cell < 0 || cell > 8 || s.owners[cell] || s.used.includes(id)) return { state: s, outcome: "illegal" };
  if (!valid) return { state: { ...s, turn: other(s.turn) }, outcome: "missed" };
  const owners = s.owners.slice();
  owners[cell] = s.turn;
  const used = [...s.used, id];
  const win = tttWinner(owners);
  if (win) return { state: { owners, used, turn: s.turn, winner: win.mark, line: win.line }, outcome: "claimed" };
  const full = owners.every(Boolean);
  return { state: { owners, used, turn: other(s.turn), winner: full ? "draw" : null, line: null }, outcome: "claimed" };
}

/** The turn timer ran out. */
export function timeoutTtt(s: TttState): TttState {
  return s.winner ? s : { ...s, turn: other(s.turn) };
}
