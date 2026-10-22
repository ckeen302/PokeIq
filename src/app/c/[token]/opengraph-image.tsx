import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { sampleQuestion } from "@/lib/og/quiz";
import { resultCard } from "@/lib/og/result";
import { readShareCard } from "@/lib/server/share-card";
import { describeShare, shareCardResult } from "@/lib/share";

/** Preview card for a shared quiz result (a signed /c/ challenge): the score and a square per answer. */

export const runtime = "nodejs";
export const alt = "PokéIQ challenge result";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const card = readShareCard((await params).token);
  if (card) return resultCard(describeShare(shareCardResult(card)), card.n || "A trainer");
  return ogCard({
    eyebrow: "Pokémon quiz",
    title: ["The ultimate", ["Pokémon quiz", C.yellow]],
    subtitle: "Silhouettes, cries, Pokédex entries and type matchups. No sign-up.",
    accent: C.yellow,
    visual: sampleQuestion("mixed", C.yellow),
  });
}
