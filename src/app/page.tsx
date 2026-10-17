import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DailyCards } from "@/components/home/DailyCards";
import { ModeGrid } from "@/components/home/ModeGrid";
import { HeroStats } from "@/components/home/HeroStats";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <section className="space-y-5 pt-2 text-center">
        <Badge variant="secondary" className="gap-1.5 px-3 py-1">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
          All 1,025 Pokémon · new puzzles every day
        </Badge>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">
          What&apos;s your <span className="text-shimmer">PokéIQ</span>?
        </h1>
        <p className="mx-auto max-w-2xl text-base text-muted-foreground sm:text-lg">
          The ultimate test for Pokémon fans: silhouettes, cries, Pokédex entries, type matchups and stat battles —
          scored with an adaptive rating that tells you exactly how much you know.
        </p>
        <HeroStats />
      </section>

      <section className="space-y-4" aria-labelledby="daily-heading">
        <h2 id="daily-heading" className="text-xl font-bold">Today&apos;s puzzles</h2>
        <DailyCards />
      </section>

      <section className="space-y-4" aria-labelledby="modes-heading">
        <div className="flex items-end justify-between">
          <h2 id="modes-heading" className="text-xl font-bold">Game modes</h2>
          <Link href="/play" className="text-sm text-muted-foreground hover:text-foreground">
            Formats &amp; generations →
          </Link>
        </div>
        <ModeGrid />
      </section>

      <section className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-sky-500/15 via-card to-card p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-10 -top-10 hidden h-64 w-64 sm:block" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/art/150?s=256" alt="" className="h-full w-full object-contain opacity-30 [filter:drop-shadow(0_0_30px_rgba(56,189,248,0.6))]" />
        </div>
        <div className="relative max-w-xl space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-sky-400">Study up</p>
          <h2 className="text-2xl font-bold sm:text-3xl">The full Pokédex — and flashcards to master it</h2>
          <p className="text-muted-foreground">
            Every Pokémon&apos;s stats, evolutions, movesets, abilities, matchups, forms and every Pokédex entry ever
            written. Then drill silhouettes, entries and typings with swipeable flashcards.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/pokedex" className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-500/90">
              Open the Pokédex
            </Link>
            <Link href="/pokedex/study" className="rounded-full border px-5 py-2.5 text-sm font-bold hover:bg-accent">
              Study mode
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card/60 p-6 sm:grid-cols-3">
        {[
          ["🧠", "A real rating", "Every question has a difficulty rating. Your PokéIQ is computed from which ones you got right — not just how many."],
          ["⚔️", "Challenge friends", "Every result is a link. Your friends play the exact same questions and see who wins."],
          ["🔥", "Daily streaks", "A new Daily Challenge and Pokédle every day. Keep your streak and climb the board."],
        ].map(([emoji, title, text]) => (
          <div key={title} className="space-y-1">
            <div className="text-2xl" aria-hidden>{emoji}</div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
