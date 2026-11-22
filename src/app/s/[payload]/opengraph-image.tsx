import { C, ClueTilesVisual, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { resultCard } from "@/lib/og/result";
import { decodeShare, describeShare } from "@/lib/share";
import { ogT } from "@/lib/og/i18n";
import { shareTranslators } from "@/lib/og/share";

/** Preview card for a shared result (/s/<payload>): the game, the score and the board. */

export const runtime = "nodejs";
export const alt = "A PokéIQ result: open the link to play";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params: Promise<{ payload: string }> }) {
  const t = await ogT(props);
  let raw = "";
  try {
    raw = decodeURIComponent((await props.params).payload);
  } catch {
    // A malformed escape: the generic card below.
  }
  const result = decodeShare(raw);
  if (result) return resultCard(describeShare(result, await shareTranslators(t.locale)), undefined, t);
  // A broken or tampered link still gets a proper card, never an error.
  return ogCard({
    eyebrow: t("home.eyebrow"),
    title: [t("result.fallback.title1"), [t("result.fallback.title2"), C.pink]],
    subtitle: t("result.fallback.subtitle"),
    accent: C.pink,
    visual: <ClueTilesVisual />,
    t,
  });
}
