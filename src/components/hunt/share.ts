import { composeShare } from "@/lib/share/text";
import { formatNumber } from "@/i18n/format";

/** A round's square, PokéGuessr's colours on its share of 5,000: green nearly all of it, yellow most, orange some, red none. */
export function huntSquare(points: number, max = 5000): string {
  const k = max > 0 ? points / max : 0;
  if (k >= 0.8) return "🟩";
  if (k >= 0.4) return "🟨";
  if (k > 0) return "🟧";
  return "🟥";
}

/** One round of a finished hunt, as the share text needs it: its points. */
export interface HuntShareRound {
  score: number;
}

/**
 * The share text: "PokéIQ Pokémon Hunt #12 18,420/25,000", a square per round, and the link. Never a
 * Pokémon's name or a place.
 */
export function huntShareText({ title, rounds, url, locale = "en" }: { title: string; rounds: HuntShareRound[]; url?: string; locale?: string }): string {
  const total = rounds.reduce((s, r) => s + r.score, 0);
  const fmt = (n: number) => formatNumber(n, locale as Parameters<typeof formatNumber>[1]);
  return composeShare({ title, score: `${fmt(total)}/${fmt(rounds.length * 5000)}`, lines: [rounds.map((r) => huntSquare(r.score)).join("")], url });
}
