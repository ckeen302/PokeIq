import { BackButton } from "@/components/ui/BackButton";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { jsonLd as ldJson, pageMetadata } from "@/lib/seo";
import { GameInfo } from "@/components/seo/GameInfo";
import { ModeIcon } from "@/components/game/ModeIcon";
import { MODULE_INFO, QUIZ_PRESETS, difficultiesFor, presetFor, type QuizPreset } from "@/lib/modes";
import { QuizSetupFromQuery } from "./QuizSetupFromQuery";
import { ZoomDaily } from "@/components/quiz/zoom/ZoomDaily";
import { DexNamesProvider } from "@/components/quiz/zoom/use-dex-names";
import { zoomNames } from "@/lib/quiz-names";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import type { Translator } from "@/i18n/catalog";
import pages from "@/messages/quiz-pages";
import modes from "@/messages/quiz-modes";
import setup from "@/messages/quiz-setup";
import run from "@/messages/quiz-run";
import badges from "@/messages/badges";
import copyFallback from "@/messages/copy-fallback";
import duelShared from "@/messages/duel";
import share from "@/messages/share";
import countdown from "@/messages/countdown";
import board from "@/messages/pokedle-board";

/** What a quiz's setup, run and results show (and the Zoom Reveal guess box adds pokedle-board's). */
const QUIZ_NAMESPACES = [modes, setup, run, badges, copyFallback, duelShared, share, countdown];

/**
 * One route, every quiz landing page. Each preset (mode × optional
 * generation) is statically generated with its own title, description and
 * JSON-LD so it can rank for searches like "gen 1 pokemon quiz".
 */

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return QUIZ_PRESETS.map((p) => ({ slug: p.slug }));
}

const REGION_KEYS = ["kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"] as const;
type PresetSlug = keyof typeof pages.en.presets;

/** A preset's title, heading and description in the page's language (a generation's preset from one pattern). */
function presetText(preset: QuizPreset, t: Translator<typeof pages.en>, st: Translator<typeof setup.en>): { title: string; h1: string; description: string } {
  const gen = preset.gens?.length === 1 && preset.slug === `gen-${preset.gens[0]}-pokemon-quiz` ? preset.gens[0] : null;
  if (gen !== null) {
    const values = { n: gen, region: st(`regions.${REGION_KEYS[gen - 1]}`) };
    return { title: t("gen.title", values), h1: t("gen.h1", values), description: t("gen.description", values) };
  }
  const slug = preset.slug as PresetSlug;
  return { title: t(`presets.${slug}.title`), h1: t(`presets.${slug}.h1`), description: t(`presets.${slug}.description`) };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const preset = presetFor((await params).slug);
  if (!preset) return {};
  const { title, description } = presetText(preset, serverT(pages), serverT(setup));
  return pageMetadata({ title, description, path: `/quiz/${preset.slug}` });
}

export const dynamicParams = false;

export default async function QuizPage({ params }: PageProps) {
  const preset = presetFor((await params).slug);
  if (!preset) notFound();
  const info = MODULE_INFO[preset.module];
  const t = serverT(pages);
  const text = presetText(preset, t, serverT(setup));
  const locale = getLocale();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Quiz",
    name: text.title,
    description: text.description,
    educationalLevel: "beginner to expert",
    about: { "@type": "Thing", name: "Pokémon" },
    isAccessibleForFree: true,
  };

  const quiz = (
    <>
      {preset.module === "zoom-reveal" && <ZoomDaily />}

      <QuizSetupFromQuery
        slug={preset.slug}
        module={preset.module}
        format={preset.format}
        gens={preset.gens}
      />
    </>
  );

  return (
    <div className="space-y-8">
      <BackButton href="/quiz" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(jsonLd) }} />
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
        <span className="screen flex h-14 w-14 items-center justify-center rounded-md" style={{ color: `hsl(${info.accent})` }}>
          <ModeIcon module={preset.module} className="relative z-[3] h-7 w-7" />
        </span>
        <p className="hud-label max-md:hidden text-screen">{t("preset.modeSelect")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{text.h1}</h1>
        <p className="text-muted-foreground">{text.description}</p>
      </div>

      <ClientMessages namespaces={preset.module === "zoom-reveal" ? [...QUIZ_NAMESPACES, board] : QUIZ_NAMESPACES}>
        {/* A page in another language gives the Zoom Reveal guess box its names (English pages fetch them). */}
        {preset.module === "zoom-reveal" && locale !== "en" ? <DexNamesProvider names={zoomNames(locale)}>{quiz}</DexNamesProvider> : quiz}
      </ClientMessages>

      <GameInfo
        hidden
        path={`/quiz/${preset.slug}`}
        name={`${text.h1}`}
        description={`${text.description}`}
        intro={t("preset.intro", { name: text.h1, description: text.description })}
        steps={[
          difficultiesFor(preset.module).length
            ? t("preset.stepDifficulty")
            : t("preset.stepFormat"),
          t("preset.step2"),
          t("preset.step3"),
        ]}
        faqs={[
          { q: t("preset.faqQ"), a: t("preset.faqA") },
        ]}
      />
    </div>
  );
}
