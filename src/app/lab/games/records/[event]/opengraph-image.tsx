import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { gamesRecordsCard } from "@/lib/og/games";
import { EVENT_IDS, isEventId } from "@/lib/games/events";
import { ogT } from "@/lib/og/i18n";

/** Share card for an event's records: the top three of all 1,025 Pokémon. */

export const alt = "PokéIQ Games records";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return EVENT_IDS.map((event) => ({ event }));
}

export default async function Image(props: { params: Promise<{ event: string }> }) {
  const id = (await props.params).event;
  return gamesRecordsCard(isEventId(id) ? id : "100m", await ogT(props));
}
