import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { gamesEventCard } from "@/lib/og/games";
import { EVENT_IDS, isEventId } from "@/lib/games/events";
import { ogT } from "@/lib/og/i18n";

/** Share card for an event: its best eight's podium. */

export const alt = "An event of the PokéIQ Games";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return EVENT_IDS.map((event) => ({ event }));
}

export default async function Image(props: { params: Promise<{ event: string }> }) {
  const id = (await props.params).event;
  return gamesEventCard(isEventId(id) ? id : "100m", undefined, undefined, undefined, await ogT(props));
}
