import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { TIMELINE } from "@/lib/timeline/data";
import { ERAS } from "@/lib/timeline/types";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { TimelineExperience, type EraStart } from "@/components/timeline/TimelineExperience";
import { TimelineList } from "@/components/timeline/TimelineList";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Timeline — the complete history in 3D",
  description:
    "Fly through Pokémon history from Red and Green in 1996 to today: every main-series game, remake and DLC, every anime season and film, TCG eras, key spin-offs and milestones, with Japanese and Western release dates.",
  path: "/pokedex/timeline",
  image: SHARE_IMAGES.pokedex,
});

/** Each era starts at its first generation's opener (Japanese release). */
function eraStarts(): EraStart[] {
  return ERAS.map((era) => {
    const opener = TIMELINE.find((e) => e.lane === "games" && e.introduces === era.gens[0])!;
    return { id: era.id, start: opener.t, year: Math.floor(opener.t) };
  });
}

export default function TimelinePage() {
  const starts = eraStarts();
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Pokémon history timeline",
    url: `${SITE_URL}/pokedex/timeline`,
    numberOfItems: TIMELINE.length,
    itemListElement: TIMELINE.map((e, i) => ({ "@type": "ListItem", position: i + 1, name: e.title, url: `${SITE_URL}/pokedex/timeline#${e.id}` })),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <TimelineExperience entries={TIMELINE} eraStarts={starts}>
        <div className="space-y-6">
          <ListHeader
            kicker="Pokémon history"
            title="Pokémon "
            accent="Timeline"
            blurb="From Red and Green in 1996 to today: the main-series games, the anime, the films, the card game, key spin-offs and the milestones in between, with Japanese and Western release dates kept apart."
          />
          <DexTabs active="timeline" />
          <TimelineList entries={TIMELINE} eraStarts={starts} />
        </div>
      </TimelineExperience>
    </div>
  );
}
