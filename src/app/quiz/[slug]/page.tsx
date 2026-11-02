import { BackButton } from "@/components/ui/BackButton";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
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
      <BackButton href="/play" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
        <span className="screen flex h-14 w-14 items-center justify-center rounded-md" style={{ color: `hsl(${info.accent})` }}>
          <ModeIcon module={preset.module} className="relative z-[3] h-7 w-7" />
        </span>
        <p className="hud-label text-screen">Mode select</p>
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

      <section className="mx-auto max-w-2xl space-y-3 text-sm text-muted-foreground">
        <h2 className="font-display text-base font-bold uppercase tracking-wider text-foreground">How it works</h2>
        {preset.module === "games" || preset.module === "anime" ? (
          <p>
            Every question was checked against Bulbapedia, and each answer links the page it came from. Where the games
            differ, the question names the game. Answers are checked on our server and your PokéIQ weighs each right answer by
            how tricky that question is.
          </p>
        ) : preset.module === "whose-team" ? (
          <p>
            Game teams come from the games&apos; own party data (the decompilations for Gens I–IV, Bulbapedia for Gens V–IX,
            each confirmed by Serebii), anime teams from the Pokémon Wiki&apos;s lists of each trainer&apos;s Pokémon. Every answer names the exact battle
            or series and links its source. Answers are checked on our server, and on Hard the hidden Pokémon stay there
            until you reveal them.
          </p>
        ) : preset.module === "shiny" ? (
          <p>
            Each round shows four pictures of one Pokémon: its real shiny and three fakes made by shifting the colours.
            Easy fakes are far off, Hard ones are barely different. Answers are checked on our
            server, and nothing in the picture addresses says which one is real.
          </p>
        ) : preset.module === "zoom-reveal" ? (
          <p>
            Each round starts on a close-up of a detailed part of the Pokémon&apos;s official artwork. A wrong name or a
            skip zooms out one step, six in all, the last showing the whole artwork. In Classic and Survival each step
            has 15 seconds. Pictures are cut on our server, so nothing reaches your browser before you&apos;ve seen it.
          </p>
        ) : preset.module === "competitive" ? (
          <p>
            Every question is generated from the Pokémon Showdown data (current generation): abilities, move types and
            categories, and item effects. Answers are checked on our server and your PokéIQ weighs each right answer by how
            tricky that question is.
          </p>
        ) : (
          <p>
            Every question is generated on the fly from the complete Pokédex — there are thousands of possible
            questions, so no two runs are the same. Answers are checked on our server and your PokéIQ weighs
            each right answer by how tricky that question is.
          </p>
        )}
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
