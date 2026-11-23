import { composeShare } from "@/lib/share/text";
import { formatNumber } from "@/i18n/format";

/**
 * A pin's square, PokéGuessr's colours on the pin's share of the round:
 * green nearly all of it, yellow most, orange some, red none.
 */
export function huntSquare(points: number, max: number): string {
  const k = max > 0 ? points / max : 0;
  if (k >= 0.8) return "🟩";
  if (k >= 0.4) return "🟨";
  if (k > 0) return "🟧";
  return "🟥";
}

/** One round of a finished hunt, as the share grid needs it: each pin's points and what a pin could score. */
export interface HuntShareRound {
  pins: number[];
  /** The round's most points per pin (5,000 split across the pins the round took). */
  pinMax: number;
  score: number;
}

/** The grid's rows: a numbered keycap, then a square per pin (a round with no pin down is one red square). */
export function huntShareRows(rounds: HuntShareRound[]): string[] {
  const keycaps = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  return rounds.map((r, i) => `${keycaps[i] ?? `${i + 1}.`} ${(r.pins.length ? r.pins : [0]).map((p) => huntSquare(p, r.pinMax)).join("")}`);
}

/**
 * The share text: "PokéIQ Pokémon Hunt #12 18,420/25,000", a row of squares
 * per round, and the link. Never a Pokémon's name or a place.
 */
export function huntShareText({ title, rounds, url, locale = "en" }: { title: string; rounds: HuntShareRound[]; url?: string; locale?: string }): string {
  const total = rounds.reduce((s, r) => s + r.score, 0);
  const fmt = (n: number) => formatNumber(n, locale as Parameters<typeof formatNumber>[1]);
  return composeShare({ title, score: `${fmt(total)}/${fmt(rounds.length * 5000)}`, lines: huntShareRows(rounds), url });
}
