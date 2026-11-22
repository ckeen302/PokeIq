import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { GAMES_LIVE } from "@/lib/lab";
import { EVENT_IDS, isEventId } from "@/lib/games/events";
import { recordsPath } from "@/lib/games/deeplink";
import { RECORDS_ALL } from "@/lib/games/records-data";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { GamesRecordsPage, recordMark } from "@/components/games/GamesRecords";
import { localName } from "@/components/games/GamesPages";
import { serverT } from "@/i18n/server";
import gamesEvents from "@/messages/games-events";
import gamesPages from "@/messages/games-pages";

/** /lab/games/records/<event>: the top ten, the bottom ten and the record holder, prerendered. */
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
  const top = RECORDS_ALL.ranking(id)[0];
  const a = GAMES_BY_KEY.get(top);
  const holder = a ? localName(a) : top;
  return pageMetadata({
    title: t("meta.recordsTitle", { question: te(`events.${id}.question`), event }),
    description: t("meta.recordsDescription", { event, holder, mark: recordMark(id, RECORDS_ALL.mark(top, id), t.locale) }),
    path: recordsPath(id),
    noindex: !GAMES_LIVE,
  });
}

export default async function Page({ params }: { params: Promise<{ event: string }> }) {
  const id = (await params).event;
  if (!isEventId(id)) notFound();
  return <GamesRecordsPage event={id} />;
}
