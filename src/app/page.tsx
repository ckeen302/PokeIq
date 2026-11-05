import type { Metadata } from "next";
import { Coffee } from "lucide-react";
import { COFFEE_URL } from "@/lib/support";
import { DailyCards } from "@/components/home/DailyCards";
import { Hero } from "@/components/home/Hero";
import { SectionTiles } from "@/components/home/SectionTiles";
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

/** The title screen, a tile per tab, today's puzzles. Everything else lives on its own tab. */
export default function HomePage() {
  return (
    <div className="mx-auto -mt-4 max-w-6xl space-y-12 sm:mt-0 sm:space-y-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(websiteWithSearch()) }} />
      <div className="space-y-4 sm:space-y-5">
        <Hero />
        <SectionTiles />
      </div>

      <section className="space-y-5" aria-labelledby="daily-heading">
        <HudHeading id="daily-heading" index={1} title="Today's puzzles" aside="Resets at local midnight" />
        <DailyCards />
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
