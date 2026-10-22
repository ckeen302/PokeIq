import { C, ClueTilesVisual, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { resultCard } from "@/lib/og/result";
import { decodeShare, describeShare } from "@/lib/share";

/** Preview card for a shared result (/s/<payload>): the game, the score and the board. */

export const runtime = "nodejs";
export const alt = "A PokéIQ result: open the link to play";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ payload: string }> }) {
  let raw = "";
  try {
    raw = decodeURIComponent((await params).payload);
  } catch {
    // A malformed escape: the generic card below.
  }
  const result = decodeShare(raw);
  if (result) return resultCard(describeShare(result));
  // A broken or tampered link still gets a proper card, never an error.
  return ogCard({
    eyebrow: "Free Pokémon games",
    title: ["Can you", ["beat it?", C.pink]],
    subtitle: "Pokédle, PokéGuessr, quizzes and battles. No sign-up.",
    accent: C.pink,
    visual: <ClueTilesVisual />,
  });
}
