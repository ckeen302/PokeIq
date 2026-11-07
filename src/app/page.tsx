import type { Metadata } from "next";
import { Coffee } from "lucide-react";
import { COFFEE_URL } from "@/lib/support";
import { DexSearch } from "@/components/home/DexSearch";
import { Hero } from "@/components/home/Hero";
import { LabShowcase } from "@/components/home/LabShowcase";
import { MoreToPlay } from "@/components/home/MoreToPlay";
import { TodaySection } from "@/components/home/TodaySection";
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

/**
 * The landing page, for a first visit (today's PokéGuessr, one press away),
 * a return (today's five dailies and the streak) and showing off (the 3D Lab).
 * Then a Pokédex search, the other tabs, and the coffee button.
 */
export default function HomePage() {
  return (
    // A phone's title screen starts under the header's bottom edge; the structured data goes last so it takes no space.
    <div className="mx-auto -mt-4 max-w-6xl space-y-12 sm:mt-0 sm:space-y-14 max-sm:-mt-8 max-sm:space-y-9">
      <div className="space-y-8 max-sm:space-y-5">
        <Hero />
        <TodaySection />
      </div>
      <LabShowcase />
      <DexSearch />
      <MoreToPlay />

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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(websiteWithSearch()) }} />
    </div>
  );
}
