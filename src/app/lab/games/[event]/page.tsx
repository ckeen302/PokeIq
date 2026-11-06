import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { EVENT_IDS, eventOf, isEventId } from "@/lib/games/events";
import { eventPath } from "@/lib/games/deeplink";
import { GamesEventPage } from "@/components/games/GamesPages";

/** /lab/games/<event>: an event with its eight best Pokémon, prerendered; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return EVENT_IDS.map((event) => ({ event }));
}

export async function generateMetadata({ params }: { params: Promise<{ event: string }> }): Promise<Metadata> {
  const id = (await params).event;
  if (!isEventId(id)) return {};
  const e = eventOf(id);
  return pageMetadata({ title: `${e.question} ${e.name} in 3D (The PokéIQ Games)`, description: `${e.name} for Pokémon: eight of the best, scored from their real stats with real physics and the sport's real rules, played out in 3D. Pick your own line-up, share it or make a video.`, path: eventPath(id) });
}

export default async function Page({ params }: { params: Promise<{ event: string }> }) {
  const id = (await params).event;
  if (!isEventId(id)) notFound();
  return <GamesEventPage event={id} />;
}
