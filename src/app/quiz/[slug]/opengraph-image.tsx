import { OG_CONTENT_TYPE, OG_SIZE, hslHex, ogCard } from "@/lib/og/card";
import { sampleQuestion } from "@/lib/og/quiz";
import { MODULE_INFO, QUIZ_PRESETS, presetFor } from "@/lib/modes";

/** Share card for each quiz landing page. */

export const alt = "PokéIQ Pokémon quiz";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return QUIZ_PRESETS.map((p) => ({ slug: p.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const preset = presetFor((await params).slug) ?? QUIZ_PRESETS[0];
  const info = MODULE_INFO[preset.module];
  const accent = hslHex(info.accent);
  return ogCard({
    eyebrow: `Quiz · ${info.title}`,
    title: [preset.h1],
    titleSize: preset.h1.length > 18 ? 56 : 70,
    subtitle: preset.description,
    accent,
    visual: sampleQuestion(preset.module, accent),
    footer: "Classic · Survival · Blitz →",
  });
}
