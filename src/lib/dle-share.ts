import { DLE_HINT_EMOJI, DLE_HINT_KINDS, DLE_MAX_GUESSES, isNear, type CellStatus, type DleHint } from "./dle-types";

/**
 * Pokédle's share text: the puzzle number, guesses (X for a miss), `*` for
 * hard mode, a marker per hint used, the play streak, one square per clue
 * (exact, partial or close, wrong: arrows would break the gradient), an
 * optional line on how the player did against everyone else, and a short
 * link. It's built from colours only, so it can never name a guess or the
 * answer.
 */
export interface PokedleShareInput {
  number: number;
  /** Each guess's clues, oldest first, in DLE_COLUMNS order. */
  rows: CellStatus[][];
  solved: boolean;
  hard: boolean;
  hints: readonly DleHint[];
  /** The play streak (0: none shown). */
  streak: number;
  /** The link, e.g. "https://pokeiq.app/pokedle" (shown without the scheme). */
  url: string;
  /** Orange and blue squares in place of green and yellow. */
  colourBlind?: boolean;
  /** A past daily played from the archive: marked, and no streak. */
  archive?: boolean;
  /** Percentile: the share of the day's players this result beat or tied (0–100), and how many played. */
  community?: { percentile: number; players: number };
}

const PALETTE = { normal: { match: "🟩", near: "🟨" }, colourBlind: { match: "🟧", near: "🟦" } };

export function shareSquare(status: CellStatus, colourBlind = false): string {
  const p = colourBlind ? PALETTE.colourBlind : PALETTE.normal;
  return status === "match" ? p.match : isNear(status) ? p.near : "⬛";
}

/** "https://pokeiq.app/pokedle?x=1" -> "pokeiq.app/pokedle". */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/$/, "");
}

export function buildPokedleShare(input: PokedleShareInput): string {
  const score = `${input.solved ? input.rows.length : "X"}/${DLE_MAX_GUESSES}${input.hard ? "*" : ""}`;
  const hints = DLE_HINT_KINDS.filter((h) => input.hints.includes(h))
    .map((h) => DLE_HINT_EMOJI[h])
    .join("");
  const header = [`Pokédle #${input.number}${input.archive ? " (archive)" : ""}`, score, hints, !input.archive && input.streak > 0 ? `🔥${input.streak}` : ""]
    .filter(Boolean)
    .join(" ");
  const grid = input.rows.map((row) => row.map((s) => shareSquare(s, input.colourBlind)).join(""));
  const lines = [header, ...grid];
  const c = input.community;
  if (c && c.players > 1 && Number.isFinite(c.percentile)) {
    const top = Math.min(100, Math.max(1, Math.ceil(100 - c.percentile)));
    lines.push(`Top ${top}% of ${c.players.toLocaleString("en-US")} trainers`);
  }
  lines.push(shortUrl(input.url));
  return lines.join("\n");
}
