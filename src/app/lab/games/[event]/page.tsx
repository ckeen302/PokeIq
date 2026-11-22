import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { GAMES_LIVE } from "@/lib/lab";
import { EVENT_IDS, isEventId } from "@/lib/games/events";
import { eventPath } from "@/lib/games/deeplink";
import { GamesEventPage } from "@/components/games/GamesPages";
import { serverT } from "@/i18n/server";
import gamesEvents from "@/messages/games-events";
import gamesPages from "@/messages/games-pages";

/** /lab/games/<event>: an event with its eight best Pokémon, prerendered; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return EVENT_IDS.map((event) => ({ event }));
}

export async function generateMetadata({ params }: { params: Promise<{ event: string }> }): Promise<Metadata> {
  const id = (await params).event;
  if (!isEventId(id)) return {};
  const t = serverT(gamesPages);
  const te = serverT(gamesEvents);
  const event = te(`events.${id}.name`);
  return pageMetadata({ title: t("meta.eventTitle", { question: te(`events.${id}.question`), event }), description: t("meta.eventDescription", { event }), path: eventPath(id), noindex: !GAMES_LIVE });
}

export default async function Page({ params }: { params: Promise<{ event: string }> }) {
  const id = (await params).event;
  if (!isEventId(id)) notFound();
  return <GamesEventPage event={id} />;
}
