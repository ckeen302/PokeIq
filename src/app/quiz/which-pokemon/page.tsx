/* eslint-disable @next/next/no-img-element -- artwork comes pre-sized from /api/art */
import Link from "next/link";
import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { WhichPokemonQuiz } from "@/components/which-pokemon/WhichPokemonQuiz";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { artUrl } from "@/lib/pokemon/art";
import { POOL, speciesInfo } from "@/lib/which-pokemon/pool";
import { QUIZ_PATH } from "@/lib/which-pokemon/match";

/**
 * /quiz/which-pokemon: the personality quiz. Eighteen in-world statements
 * score seven traits (the Big Five plus competitiveness and independence),
 * and the nearest of 200 researched Pokémon profiles is the result. The page
 * is the quiz and nothing else; the explanation lives on each result page.
 */

export const metadata: Metadata = pageMetadata({
  title: "Which Pokémon Are You? Personality Quiz",
  description:
    "Find your Pokémon from 200 possible results: 18 quick questions score the Big Five plus competitiveness and independence, matched against profiles built from Pokédex entries, Mystery Dungeon and the anime. Share card and compare-with-a-friend link included.",
  path: QUIZ_PATH,
  socialTitle: "Which Pokémon Are You?",
  socialDescription: "18 questions, 200 possible Pokémon, every profile grounded in the Pokédex. Free, no sign-up.",
});

/** Sample results on the page, left to right. */
const SAMPLE = ["pikachu", "gengar", "snorlax", "lucario", "sylveon", "mimikyu", "gholdengo", "psyduck"];

export default function WhichPokemonPage() {
  const samples = SAMPLE.map((slug) => POOL.find((p) => p.slug === slug)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const ld = {
    "@context": "https://schema.org",
    "@type": "Quiz",
    name: "Which Pokémon Are You?",
    description: "A Pokémon personality quiz with a seven-trait model and 200 researched results.",
    about: { "@type": "Thing", name: "Pokémon" },
    isAccessibleForFree: true,
  };
  return (
    <div className="space-y-8">
      <BackButton href="/play" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <header className="mx-auto max-w-2xl space-y-2 text-center">
        <p className="hud-label text-screen">Personality quiz</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Which Pokémon Are You?</h1>
        <p className="text-muted-foreground">Seven traits, 200 Pokémon with a personality on record, one match that&apos;s actually you.</p>
      </header>
      <WhichPokemonQuiz />
      <nav aria-label="Sample results" className="mx-auto flex max-w-xl flex-wrap items-center justify-center gap-1">
        {samples.map((p) => (
          <Link key={p.id} href={`${QUIZ_PATH}/${p.slug}`} className="rounded-md p-1 transition-colors hover:bg-accent/50" title={`I got ${speciesInfo(p.id)?.name ?? p.slug}`}>
            <img src={artUrl(p.id, 96)} alt={speciesInfo(p.id)?.name ?? p.slug} width={48} height={48} loading="lazy" className="h-12 w-12 object-contain" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
