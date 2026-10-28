import Link from "next/link";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { ChevronRight, ListChecks, Swords } from "lucide-react";
import { ModeGrid } from "@/components/home/ModeGrid";
import { QuizDuelCard } from "@/components/quiz/QuizDuelCard";
import { WhichPokemonCard } from "@/components/which-pokemon/WhichPokemonCard";
import { GameInfo } from "@/components/seo/GameInfo";
import { FORMAT_INFO, PLAYABLE_FORMATS, QUIZ_PRESETS } from "@/lib/modes";

export const metadata: Metadata = pageMetadata({
  title: "Who's That Pokémon Quiz and More Pokémon Quiz Modes",
  description: "Play the Who's That Pokémon quiz, a cry quiz, Pokédex entries, type matchups, higher or lower — in Classic, Survival and Blitz formats.",
  path: "/play",
});

/** Daily, the PokéIQ test and the Atlas left the top bar; they live here too. */
const MORE = [
  { href: "/daily", label: "Daily Challenge" },
  { href: "/iq-test", label: "PokéIQ Test" },
];

export default function PlayPage() {
  const genPresets = QUIZ_PRESETS.filter((p) => p.gens);
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Game modes</h1>
        <p className="text-muted-foreground">Pick a mode, then choose a format, difficulty and generations.</p>
      </div>
      <ModeGrid />
      <Link
        href="/quiz/name-em-all"
        className="menu-item group relative flex items-center gap-4 overflow-hidden rounded-lg border bg-card p-4 hover:border-screen/50 hover:bg-accent/40"
        aria-label="Play Name 'em All"
        data-testid="play-name-em-all"
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-[hsl(170_80%_45%)]" aria-hidden />
        <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-[hsl(170_80%_55%)]">
          <ListChecks className="relative z-[3] h-6 w-6" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="hud-label text-screen">New</span>
            <span className="truncate font-display text-lg font-bold uppercase tracking-wide">Name &apos;em All</span>
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Type every Pokémon you can remember: all 1,025, a generation, a type, Legendaries, Megas or a regional dex. Daily, races and leaderboards.
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" aria-hidden />
      </Link>
      <WhichPokemonCard />
      <nav aria-label="More to play" className="flex flex-wrap justify-center gap-3">
        {MORE.map(({ href, label }) => (
          <Link key={href} href={href} className="rounded-md border bg-card px-4 py-2 text-sm font-semibold transition hover:border-primary/50">
            {label}
          </Link>
        ))}
      </nav>
      <section className="grid gap-4 sm:grid-cols-3">
        {PLAYABLE_FORMATS.map((f) => (
          <div key={f} className="rounded-md border bg-card p-5">
            <h2 className="font-semibold">{FORMAT_INFO[f].title}</h2>
            <p className="text-sm text-muted-foreground">{FORMAT_INFO[f].description}</p>
          </div>
        ))}
      </section>
      <section className="space-y-3" aria-labelledby="duels">
        <h2 id="duels" className="flex items-center gap-2 text-xl font-bold">
          <Swords className="h-5 w-5 text-primary" aria-hidden /> Quiz duel
        </h2>
        <p className="text-sm text-muted-foreground">Send a friend a link and answer the same questions head to head, live.</p>
        <QuizDuelCard />
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Quiz by generation</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {genPresets.map((p) => (
            <Link key={p.slug} href={`/quiz/${p.slug}`} className="rounded-lg border bg-card p-4 text-sm font-medium transition hover:border-primary/50">
              {p.h1}
            </Link>
          ))}
        </div>
      </section>
      <GameInfo
        hidden
        path="/play"
        name={`the Pokémon quizzes`}
        description={`Free Pokémon quizzes including the Who's That Pokémon quiz, a cry quiz and type matchups, in Classic, Survival and Blitz formats.`}
        intro={`Play the Who's That Pokémon quiz and our other Pokémon quizzes in three formats, covering all 1,025 Pokémon.`}
        steps={[
          "Pick a quiz mode and the generations to include.",
          "Choose a format: Classic, Survival or Blitz.",
          "Answer before the clock runs out.",
          "Your PokéIQ is calculated from how hard the questions you got right were.",
        ]}
        faqs={[
          { q: `What formats are there?`, a: `Classic is 10 questions with 15 seconds each, Survival is endless with 3 lives and Blitz gives you 60 seconds to answer as many as you can.` },
          { q: `Can I choose which generations to play?`, a: `Yes, pick the generations to include, or jump straight to a quiz by generation.` },
        ]}
      />
    </div>
  );
}
