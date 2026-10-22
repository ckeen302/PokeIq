import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { sampleQuestion } from "@/lib/og/quiz";

/** Share card for /play: every quiz mode. */

export const alt = "PokéIQ quizzes: Who's That Pokémon, cries, Pokédex entries, type matchups and more";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Pokémon quizzes",
    title: ["How well do", "you know", ["Pokémon?", C.yellow]],
    titleSize: 66,
    subtitle: "Silhouettes, cries, Pokédex entries, type matchups, the games and the anime.",
    accent: C.yellow,
    visual: sampleQuestion("whos-that", C.yellow),
    chips: ["Classic", "Survival", "Blitz", "All 1,025 Pokémon"],
  });
}
