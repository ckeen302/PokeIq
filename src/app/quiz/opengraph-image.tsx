import { ogT } from "@/lib/og/i18n";
import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { sampleQuestion } from "@/lib/og/quiz";

/** Share card for /quiz: every quiz mode. */

export const alt = "PokéIQ quizzes: Who's That Pokémon, cries, Pokédex entries, type matchups and more";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  return ogCard({
    eyebrow: t("quiz.eyebrow"),
    title: [t("quiz.title1"), t("quiz.title2"), [t("quiz.title3"), C.yellow]],
    titleSize: 66,
    subtitle: t("quiz.subtitle"),
    accent: C.yellow,
    visual: sampleQuestion("whos-that", C.yellow, t),
    chips: [t("quiz.chips.classic"), t("quiz.chips.survival"), t("quiz.chips.blitz"), t("quiz.chips.all")],
    t,
  });
}
