import { BackButton } from "@/components/ui/BackButton";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { jsonLd as ldJson, pageMetadata } from "@/lib/seo";
import { GameInfo } from "@/components/seo/GameInfo";
import { ModeIcon } from "@/components/game/ModeIcon";
import { MODULE_INFO, QUIZ_PRESETS, difficultiesFor, presetFor } from "@/lib/modes";
import { QuizSetupFromQuery } from "./QuizSetupFromQuery";
import { ZoomDaily } from "@/components/quiz/zoom/ZoomDaily";

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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const preset = presetFor((await params).slug);
  if (!preset) return {};
  return pageMetadata({ title: preset.title, description: preset.description, path: `/quiz/${preset.slug}` });
}

export const dynamicParams = false;

export default async function QuizPage({ params }: PageProps) {
  const preset = presetFor((await params).slug);
  if (!preset) notFound();
  const info = MODULE_INFO[preset.module];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Quiz",
    name: preset.title,
    description: preset.description,
    educationalLevel: "beginner to expert",
    about: { "@type": "Thing", name: "Pokémon" },
    isAccessibleForFree: true,
  };

  return (
    <div className="space-y-8">
      <BackButton href="/quiz" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(jsonLd) }} />
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
        <span className="screen flex h-14 w-14 items-center justify-center rounded-md" style={{ color: `hsl(${info.accent})` }}>
          <ModeIcon module={preset.module} className="relative z-[3] h-7 w-7" />
        </span>
        <p className="hud-label max-md:hidden text-screen">Mode select</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{preset.h1}</h1>
        <p className="text-muted-foreground">{preset.description}</p>
      </div>

      {preset.module === "zoom-reveal" && <ZoomDaily />}

      <QuizSetupFromQuery
        slug={preset.slug}
        module={preset.module}
        format={preset.format}
        gens={preset.gens}
      />

      <GameInfo
        hidden
        path={`/quiz/${preset.slug}`}
        name={`${preset.h1}`}
        description={`${preset.description}`}
        intro={`${preset.h1} is one of our free Pokémon quizzes, like the Who's That Pokémon quiz: ${preset.description}`}
        steps={[
          difficultiesFor(preset.module).length
            ? "Choose a format and difficulty, and the generations to include."
            : "Choose a format and the generations to include.",
          "Answer each question before the timer runs out.",
          "Your PokéIQ weighs each right answer by how tricky that question is.",
        ]}
        faqs={[
          { q: `What formats can I play?`, a: `Classic is 10 questions with 15 seconds each, Survival is endless with 3 lives and Blitz gives you 60 seconds to answer as many as you can.` },
        ]}
      />
    </div>
  );
}
