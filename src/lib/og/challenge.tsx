import "server-only";
import { C, VersusVisual, ogCard } from "./card";
import { englishOgT, type OgT } from "./i18n";

export type ChallengeGame = "pokedle" | "quiz" | "geo" | "battle" | "connections" | "connections-party" | "pikadoku" | "name-em-all";

/**
 * The link-preview card for every invite (Pokédle, quiz, PokéGuessr,
 * PokéConnections and Pikadoku duels, parties and races, live battles). It is the same for every code on purpose: it never
 * reads the game, so it can't give away a mystery Pokémon, a place or a team,
 * it needs no database round trip while Discord or Reddit is waiting on it,
 * and a code that has expired still gets a proper card.
 */

/** Each game's accent; its eyebrow and footer are og's challenge.<game>.eyebrow / .footer. */
const ACCENTS: Record<ChallengeGame, string> = {
  pokedle: C.violet,
  quiz: C.yellow,
  geo: C.green,
  battle: C.pink,
  connections: C.cyan,
  "connections-party": C.cyan,
  pikadoku: C.violet,
  "name-em-all": C.green,
};

export const CHALLENGE_ALT = "A PokéIQ challenge: open the link to play";

export function challengeCard(game: ChallengeGame, t: OgT = englishOgT()) {
  const accent = ACCENTS[game];
  return ogCard({
    eyebrow: t(`challenge.${game}.eyebrow`),
    title: [t("challenge.title1"), [t("challenge.title2"), accent]],
    subtitle: t("challenge.subtitle"),
    accent,
    visual: <VersusVisual host={t("challenge.host")} t={t} />,
    footer: t(`challenge.${game}.footer`),
    t,
  });
}
