import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { QuizSetup } from "@/components/quiz/QuizSetup";
import { ModeIcon } from "@/components/game/ModeIcon";
import { DIFFICULTIES, type Difficulty, type QuizFormat } from "@/engines/types";
import { MODULE_INFO, PLAYABLE_FORMATS, QUIZ_PRESETS, presetFor } from "@/lib/modes";

/**
 * One route, every quiz landing page. Each preset (mode × optional
 * generation) is statically generated with its own title, description and
 * JSON-LD so it can rank for searches like "gen 1 pokemon quiz".
 */

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ format?: string; difficulty?: string; gen?: string }>;
}

export function generateStaticParams() {
  return QUIZ_PRESETS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const preset = presetFor((await params).slug);
  if (!preset) return {};
  return {
    title: preset.title,
    description: preset.description,
    alternates: { canonical: `/quiz/${preset.slug}` },
    openGraph: { title: preset.title, description: preset.description },
  };
}

export default async function QuizPage({ params, searchParams }: PageProps) {
  const preset = presetFor((await params).slug);
  if (!preset) notFound();
  const query = await searchParams;
  const info = MODULE_INFO[preset.module];

  const format = (PLAYABLE_FORMATS as readonly string[]).includes(query.format ?? "") ? (query.format as QuizFormat) : preset.format;
  const difficulty = DIFFICULTIES.includes(query.difficulty as Difficulty) ? (query.difficulty as Difficulty) : preset.difficulty;
  const queryGens = query.gen
    ?.split(",")
    .map(Number)
    .filter((g) => g >= 1 && g <= 9);
  const gens = queryGens?.length ? queryGens : preset.gens;

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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
        <span className="screen flex h-14 w-14 items-center justify-center rounded-md" style={{ color: `hsl(${info.accent})` }}>
          <ModeIcon module={preset.module} className="relative z-[3] h-7 w-7" />
        </span>
        <p className="hud-label text-screen">Mode select</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{preset.h1}</h1>
        <p className="text-muted-foreground">{preset.description}</p>
      </div>

      <QuizSetup
        key={preset.slug}
        module={preset.module}
        initialFormat={format}
        initialDifficulty={difficulty}
        initialGens={gens}
      />

      <section className="mx-auto max-w-2xl space-y-3 text-sm text-muted-foreground">
        <h2 className="font-display text-base font-bold uppercase tracking-wider text-foreground">How it works</h2>
        <p>
          Every question is generated on the fly from the complete Pokédex — there are thousands of possible
          questions, so no two runs are the same. Answers are checked on our server and your PokéIQ is calculated
          from how hard each question you got right actually was.
        </p>
        <p>
          <b className="text-foreground">Classic</b> is 10 questions with 15 seconds each.{" "}
          <b className="text-foreground">Survival</b> keeps going until you lose three lives.{" "}
          <b className="text-foreground">Blitz</b> gives you 60 seconds to answer as many as you can.
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          More quizzes:
          {QUIZ_PRESETS.filter((p) => p.slug !== preset.slug)
            .slice(0, 8)
            .map((p) => (
              <Link key={p.slug} href={`/quiz/${p.slug}`} className="underline-offset-2 hover:text-foreground hover:underline">
                {p.h1}
              </Link>
            ))}
        </p>
      </section>
    </div>
  );
}
