import "server-only";
import { C, VersusVisual, ogCard } from "./card";

export type ChallengeGame = "pokedle" | "quiz" | "geo" | "battle" | "connections";

/**
 * The link-preview card for every invite (Pokédle, quiz and PokéGuessr
 * duels, live battles). It is the same for every code on purpose: it never
 * reads the game, so it can't give away a mystery Pokémon, a place or a team,
 * it needs no database round trip while Discord or Reddit is waiting on it,
 * and a code that has expired still gets a proper card.
 */

const GAMES: Record<ChallengeGame, { eyebrow: string; accent: string; footer: string }> = {
  pokedle: { eyebrow: "Pokédle duel", accent: C.violet, footer: "Same mystery Pokémon · three rounds · tap to play →" },
  quiz: { eyebrow: "Quiz duel", accent: C.yellow, footer: "Same questions · right and fast wins · tap to play →" },
  geo: { eyebrow: "PokéGuessr duel", accent: C.green, footer: "Same places · closer pin wins · tap to play →" },
  battle: { eyebrow: "Live battle", accent: C.pink, footer: "Pokémon Showdown rules · live · tap to battle →" },
  connections: { eyebrow: "PokéConnections duel", accent: C.cyan, footer: "Same 16 Pokémon · find the 4 groups first · tap to race →" },
};

export const CHALLENGE_ALT = "A PokéIQ challenge: open the link to play";

export function challengeCard(game: ChallengeGame) {
  const g = GAMES[game];
  return ogCard({
    eyebrow: g.eyebrow,
    title: ["You've been", ["challenged", g.accent]],
    subtitle: "A trainer sent you an invite. No sign-up: open it, pick a name and play.",
    accent: g.accent,
    visual: <VersusVisual host="A trainer" />,
    footer: g.footer,
  });
}
