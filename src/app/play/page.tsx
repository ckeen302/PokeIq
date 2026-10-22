import Link from "next/link";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { MapPin, Swords, Target } from "lucide-react";
import { ModeGrid } from "@/components/home/ModeGrid";
import { QuizDuelCard } from "@/components/quiz/QuizDuelCard";
import { FORMAT_INFO, PLAYABLE_FORMATS, QUIZ_PRESETS } from "@/lib/modes";
import { DUEL_HP } from "@/lib/duel-types";

export const metadata: Metadata = pageMetadata({
  title: "All Pokémon Quiz Modes",
  description: "Who's That Pokémon, cry quiz, Pokédex entries, type matchups, higher or lower — in Classic, Survival and Blitz formats.",
  path: "/play",
});

/** The other duels start on their own pages, where their settings are. */
const DUELS = [
  {
    href: "/pokedle#duel",
    icon: Target,
    title: "Pokédle duel",
    blurb: "The same mystery Pokémon, three rounds. Fewer guesses and quicker solves score more.",
  },
  {
    href: "/guessr",
    icon: MapPin,
    title: "PokéGuessr duel",
    blurb: `The same places, ${DUEL_HP.toLocaleString("en-US")} HP each. The closer pin wins the round.`,
  },
];

/** Daily, the PokéIQ test and the Atlas left the top bar; they live here too. */
const MORE = [
  { href: "/daily", label: "Daily Challenge" },
  { href: "/iq-test", label: "PokéIQ Test" },
  { href: "/atlas", label: "World Atlas" },
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
          <Swords className="h-5 w-5 text-primary" aria-hidden /> Duel a friend
        </h2>
        <p className="text-sm text-muted-foreground">Head to head through a share link: the same questions, puzzles or places for both of you, live.</p>
        <QuizDuelCard />
        <div className="grid gap-3 sm:grid-cols-2">
          {DUELS.map(({ href, icon: Icon, title, blurb }) => (
            <Link key={href} href={href} className="flex items-start gap-3 rounded-md border bg-card p-4 transition hover:border-primary/50">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <span className="space-y-1">
                <span className="block font-display font-bold uppercase">{title}</span>
                <span className="block text-sm text-muted-foreground">{blurb}</span>
              </span>
            </Link>
          ))}
        </div>
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
    </div>
  );
}
