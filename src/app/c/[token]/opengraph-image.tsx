import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { sampleQuestion } from "@/lib/og/quiz";
import { resultCard } from "@/lib/og/result";
import { readShareCard } from "@/lib/server/share-card";
import { describeShare, shareCardResult } from "@/lib/share";
import { ogT } from "@/lib/og/i18n";
import { shareTranslators } from "@/lib/og/share";

/** Preview card for a shared quiz result (a signed /c/ challenge): the score and a square per answer. */

export const runtime = "nodejs";
export const alt = "PokéIQ challenge result";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params: Promise<{ token: string }> }) {
  const t = await ogT(props);
  const card = readShareCard((await props.params).token);
  if (card) return resultCard(describeShare(shareCardResult(card), await shareTranslators(t.locale)), card.n || t("result.aTrainer"), t);
  return ogCard({
    eyebrow: t("quizChallenge.eyebrow"),
    title: [t("quizChallenge.title1"), [t("quizChallenge.title2"), C.yellow]],
    subtitle: t("quizChallenge.subtitle"),
    accent: C.yellow,
    visual: sampleQuestion("mixed", C.yellow, t),
    t,
  });
}
