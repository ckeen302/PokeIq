import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { GAMES_LIVE } from "@/lib/lab";
import { EVENT_IDS, eventOf, isEventId } from "@/lib/games/events";
import { recordsPath } from "@/lib/games/deeplink";
import { RECORDS_ALL } from "@/lib/games/records-data";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { GamesRecordsPage, recordMark } from "@/components/games/GamesRecords";

/** /lab/games/records/<event>: the top ten, the bottom ten and the record holder, prerendered. */
export const dynamicParams = false;

export function generateStaticParams() {
  return EVENT_IDS.map((event) => ({ event }));
}

export async function generateMetadata({ params }: { params: Promise<{ event: string }> }): Promise<Metadata> {
  const id = (await params).event;
  if (!isEventId(id)) return {};
  const e = eventOf(id);
  const top = RECORDS_ALL.ranking(id)[0];
  const holder = GAMES_BY_KEY.get(top)?.name ?? top;
  return pageMetadata({
    title: `${e.question} ${e.name} records for every Pokémon`,
    description: `${e.name} for all 1,025 Pokémon and their forms, from their real stats with real physics: ${holder} holds the record with ${recordMark(id, RECORDS_ALL.mark(top, id))}. The top ten, the bottom ten and every Pokémon's mark.`,
    path: recordsPath(id),
    noindex: !GAMES_LIVE,
  });
}

export default async function Page({ params }: { params: Promise<{ event: string }> }) {
  const id = (await params).event;
  if (!isEventId(id)) notFound();
  return <GamesRecordsPage event={id} />;
}
