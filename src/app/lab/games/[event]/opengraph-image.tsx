import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { gamesEventCard } from "@/lib/og/games";
import { EVENT_IDS, isEventId } from "@/lib/games/events";

/** Share card for an event: its best eight's podium. */

export const alt = "An event of the PokéIQ Games";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return EVENT_IDS.map((event) => ({ event }));
}

export default async function Image({ params }: { params: Promise<{ event: string }> }) {
  const id = (await params).event;
  return gamesEventCard(isEventId(id) ? id : "100m");
}
