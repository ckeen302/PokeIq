import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BookOpenCheck, Brain, Coffee, Flame, Globe2, Swords } from "lucide-react";
import { COFFEE_URL } from "@/lib/support";
import { DailyCards } from "@/components/home/DailyCards";
import { ModeGrid } from "@/components/home/ModeGrid";
import { HeroDevice } from "@/components/home/HeroDevice";
import { Hero } from "@/components/home/Hero";
import { Experiences } from "@/components/home/Experiences";
import { TimelineCard } from "@/components/home/TimelineCard";
import { SizesCard } from "@/components/home/SizesCard";
import { WhichPokemonCard } from "@/components/which-pokemon/WhichPokemonCard";
import { HudHeading } from "@/components/game/HudHeading";
import { SITE_NAME } from "@/lib/site";
import { SITE_DESCRIPTION, SITE_TAGLINE, jsonLd, pageMetadata } from "@/lib/seo";
import { websiteWithSearch } from "@/lib/structured-data";

export const metadata: Metadata = {
  ...pageMetadata({
    title: `${SITE_NAME}: ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    path: "/",
    socialTitle: `${SITE_NAME}: GeoGuessr, Wordle and Showdown for Pokémon`,
    socialDescription:
      "PokéGuessr with real in-game screenshots of every region, a daily Pokédle with live duels, Showdown-accurate battles and a Battle Lab that simulates thousands of them. Free, no sign-up.",
  }),
  // The home page's title is the whole name, not "… · PokéIQ".
  title: { absolute: `${SITE_NAME}: ${SITE_TAGLINE}` },
};

export default function HomePage() {
  return (
    <div className="mx-auto -mt-4 max-w-6xl space-y-14 sm:mt-0 sm:space-y-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(websiteWithSearch()) }} />
      <div className="space-y-4 sm:space-y-6">
        <Hero />
        <Experiences />
      </div>

      <section className="space-y-5" aria-labelledby="daily-heading">
        <HudHeading id="daily-heading" index={1} title="Today's puzzles" aside="Resets at local midnight" />
        <DailyCards />
      </section>

      <section className="space-y-5" aria-labelledby="quiz-heading">
        <HudHeading
          id="quiz-heading"
          index={2}
          title="Quizzes"
          aside={
            <Link href="/play" className="hover:text-foreground">
              Formats + generations →
            </Link>
          }
        />
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
          <div className="hidden lg:block">
            <HeroDevice />
          </div>
          <ModeGrid />
        </div>
        <WhichPokemonCard />
      </section>

      <section className="space-y-5" aria-labelledby="tools-heading">
        <HudHeading id="tools-heading" index={3} title="Research tools" />
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { href: "/pokedex", icon: BookOpenCheck, title: "Pokédex", text: "Stats, evolutions, movesets, matchups and every entry ever written." },
            { href: "/pokedex/study", icon: Brain, title: "Study mode", text: "Swipeable flashcards with mastery tracking, generation by generation." },
            { href: "/atlas", icon: Globe2, title: "World atlas", text: "Every region from Kanto to Paldea on one zoomable map, every town labelled." },
          ].map(({ href, icon: Icon, title, text }) => (
            <Link key={href} href={href} className="menu-item group block rounded-lg border bg-card p-5 hover:border-screen/50">
              <div className="flex items-center gap-4">
                <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-screen">
                  <Icon className="relative z-[3] h-6 w-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-lg font-bold uppercase tracking-wide">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" aria-hidden />
              </div>
            </Link>
          ))}
        </div>
        <TimelineCard />
        <SizesCard />
      </section>

      <section className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3" aria-label="Why PokéIQ">
        {[
          { icon: Brain, title: "A real rating", text: "Every question carries a difficulty rating. Your PokéIQ comes from which ones you got right, not just how many." },
          { icon: Swords, title: "Challenge anyone", text: "Every result is a link. Duel a friend through an invite, or get matched with a stranger in PokéGuessr, Pokédle and battles." },
          { icon: Flame, title: "Daily streaks", text: "A new PokéGuessr, Pokédle and Daily Challenge every day. Keep the streak alive and climb the board." },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="space-y-2 bg-card p-6">
            <Icon className="h-5 w-5 text-primary" aria-hidden />
            <h3 className="font-display text-base font-bold uppercase tracking-wide">{title}</h3>
            <p className="text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>

      <div className="flex justify-center pb-2">
        <a
          href={COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-2 rounded-md border bg-card px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-[0_0_16px_hsl(var(--primary)/0.25)]"
          data-testid="coffee-button"
        >
          <Coffee className="h-4 w-4 text-primary" aria-hidden />
          Buy me a coffee
        </a>
      </div>
    </div>
  );
}
