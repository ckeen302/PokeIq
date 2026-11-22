import { OG_CONTENT_TYPE, OG_SIZE, hslHex, ogCard, visualLength } from "@/lib/og/card";
import { ogT } from "@/lib/og/i18n";
import { sampleQuestion } from "@/lib/og/quiz";
import { MODULE_INFO, QUIZ_PRESETS, presetFor, type QuizPreset } from "@/lib/modes";
import { getT } from "@/i18n/server";
import type { Locale } from "@/i18n/config";
import pages from "@/messages/quiz-pages";
import modes from "@/messages/quiz-modes";
import setup from "@/messages/quiz-setup";

/** Share card for each quiz landing page. */

export const alt = "PokéIQ Pokémon quiz";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return QUIZ_PRESETS.map((p) => ({ slug: p.slug }));
}

const REGION_KEYS = ["kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"] as const;

/** The preset's mode, heading and description in another language (as its page writes them). */
async function localText(preset: QuizPreset, locale: Locale): Promise<{ mode: string; h1: string; description: string }> {
  const [t, st, mt] = await Promise.all([getT(pages, locale), getT(setup, locale), getT(modes, locale)]);
  const mode = mt(`modules.${preset.module}.title`);
  const gen = preset.gens?.length === 1 && preset.slug === `gen-${preset.gens[0]}-pokemon-quiz` ? preset.gens[0] : null;
  if (gen !== null) {
    const values = { n: gen, region: st(`regions.${REGION_KEYS[gen - 1]}`) };
    return { mode, h1: t("gen.h1", values), description: t("gen.description", values) };
  }
  const slug = preset.slug as keyof typeof pages.en.presets;
  return { mode, h1: t(`presets.${slug}.h1`), description: t(`presets.${slug}.description`) };
}

export default async function Image(props: { params: Promise<{ slug: string }> }) {
  const t = await ogT(props);
  const preset = presetFor((await props.params).slug) ?? QUIZ_PRESETS[0];
  const info = MODULE_INFO[preset.module];
  const accent = hslHex(info.accent);
  const text = t.locale === "en" ? { mode: info.title, h1: preset.h1, description: preset.description } : await localText(preset, t.locale);
  return ogCard({
    eyebrow: t("quizPreset.eyebrow", { mode: text.mode }),
    title: [text.h1],
    titleSize: visualLength(text.h1) > 18 ? 56 : 70,
    subtitle: text.description,
    accent,
    visual: sampleQuestion(preset.module, accent, t),
    footer: t("quizPreset.footer"),
    t,
  });
}
