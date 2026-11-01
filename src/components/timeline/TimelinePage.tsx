import Link from "next/link";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { TIMELINE } from "@/lib/timeline/data";
import { entryPath } from "@/lib/timeline/deeplink";
import { ERAS, ERA_BY_ID, LANE_BY_ID, dateRows, formatDate, type TimelineEntry } from "@/lib/timeline/types";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { TimelineExperience, type EraStart } from "./TimelineExperience";
import { TimelineList } from "./TimelineList";

/** Each era starts at its first generation's opener (Japanese release). */
export function eraStarts(): EraStart[] {
  return ERAS.map((era) => {
    const opener = TIMELINE.find((e) => e.lane === "games" && e.introduces === era.gens[0])!;
    return { id: era.id, start: opener.t, year: Math.floor(opener.t) };
  });
}

/**
 * /pokedex/timeline and each entry's own page (/pokedex/timeline/<id>): the
 * 3D view over the server-rendered list. An entry's page opens on that entry
 * and leads its HTML with the entry itself.
 */
export function TimelinePage({ focus }: { focus?: TimelineEntry }) {
  const starts = eraStarts();
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Pokémon history timeline",
    url: `${SITE_URL}/pokedex/timeline`,
    numberOfItems: TIMELINE.length,
    itemListElement: TIMELINE.map((e, i) => ({ "@type": "ListItem", position: i + 1, name: e.title, url: `${SITE_URL}${entryPath(e.id)}` })),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <TimelineExperience entries={TIMELINE} eraStarts={starts} initialId={focus?.id ?? null}>
        <div className="space-y-6">
          {focus ? (
            <FocusHeader entry={focus} />
          ) : (
            <ListHeader
              kicker="Pokémon history"
              title="Pokémon "
              accent="Timeline"
              blurb="From Red and Green in 1996 to today: the main-series games, the anime, the films, the card game, key spin-offs and the milestones in between, with Japanese and Western release dates kept apart."
            />
          )}
          <DexTabs active="timeline" />
          <TimelineList entries={TIMELINE} eraStarts={starts} />
        </div>
      </TimelineExperience>
    </div>
  );
}

function FocusHeader({ entry }: { entry: TimelineEntry }) {
  const lane = LANE_BY_ID[entry.lane];
  const era = ERA_BY_ID[entry.era];
  return (
    <div className="space-y-3 text-center">
      <p className="hud-label text-screen">
        <Link href="/pokedex/timeline" className="hover:text-foreground">Pokémon Timeline</Link> · {lane.label} · {era.device}
      </p>
      <h1 className="break-words font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{entry.title}</h1>
      <dl className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm">
        {dateRows(entry).map((r) => (
          <div key={r.label} className="flex gap-1.5">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="font-semibold tabular-nums">
              <time dateTime={r.date}>{formatDate(r.date)}</time>
            </dd>
          </div>
        ))}
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Platform</dt>
          <dd className="font-semibold">{entry.platform}</dd>
        </div>
      </dl>
      {entry.note && <p className="mx-auto max-w-2xl text-muted-foreground">{entry.note}</p>}
    </div>
  );
}
