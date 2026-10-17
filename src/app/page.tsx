import Link from "next/link";
import { ArrowRight, BookOpenCheck, Brain, Swords, Flame } from "lucide-react";
import { DailyCards } from "@/components/home/DailyCards";
import { ModeGrid } from "@/components/home/ModeGrid";
import { HeroStats } from "@/components/home/HeroStats";
import { HeroDevice } from "@/components/home/HeroDevice";
import { HudHeading } from "@/components/game/HudHeading";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-16">
      {/* Title screen */}
      <section className="grid items-center gap-10 pt-2 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-6">
          <p className="hud-label flex items-center gap-2 text-screen">
            <span className="led h-1.5 w-1.5 animate-blink text-screen" /> Field research unit · 1,025 species online
          </p>
          <h1 className="font-display text-5xl font-bold uppercase leading-[0.95] tracking-tight sm:text-7xl">
            How high is
            <br />
            your <span className="text-primary [text-shadow:0_0_30px_hsl(var(--primary)/0.45)]">PokéIQ</span>?
          </h1>
          <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
            Silhouettes, cries, Pokédex entries, type matchups and stat battles, scored by an adaptive rating that
            measures exactly how much you know. New puzzles every day.
          </p>
          <HeroStats />
        </div>
        <HeroDevice />
      </section>

      <section className="space-y-5" aria-labelledby="daily-heading">
        <HudHeading id="daily-heading" index={1} title="Today's puzzles" aside="Resets at local midnight" />
        <DailyCards />
      </section>

      <section className="space-y-5">
        <HudHeading index={2} title="Game modes" aside={<Link href="/play" className="hover:text-foreground">Formats + generations →</Link>} />
        <ModeGrid />
      </section>

      <section className="space-y-5">
        <HudHeading index={3} title="Research tools" />
        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/pokedex" className="menu-item group block rounded-lg border bg-card p-5 hover:border-screen/50">
            <div className="flex items-center gap-4">
              <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-screen">
                <BookOpenCheck className="relative z-[3] h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-bold uppercase tracking-wide">Pokédex</div>
                <p className="text-sm text-muted-foreground">Stats, evolutions, movesets, matchups and every entry ever written.</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
            </div>
          </Link>
          <Link href="/pokedex/study" className="menu-item group block rounded-lg border bg-card p-5 hover:border-screen/50">
            <div className="flex items-center gap-4">
              <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-screen">
                <Brain className="relative z-[3] h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-bold uppercase tracking-wide">Study mode</div>
                <p className="text-sm text-muted-foreground">Swipeable flashcards with mastery tracking, generation by generation.</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
            </div>
          </Link>
        </div>
      </section>

      <section className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        {[
          { icon: Brain, title: "A real rating", text: "Every question carries a difficulty rating. Your PokéIQ comes from which ones you got right, not just how many." },
          { icon: Swords, title: "Challenge friends", text: "Every result is a link. Friends play the exact same questions and see who wins." },
          { icon: Flame, title: "Daily streaks", text: "A new Daily Challenge and Pokédle every day. Keep the streak alive and climb the board." },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="space-y-2 bg-card p-6">
            <Icon className="h-5 w-5 text-primary" aria-hidden />
            <h3 className="font-display text-base font-bold uppercase tracking-wide">{title}</h3>
            <p className="text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
