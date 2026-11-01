import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { timelineCard, timelineEntryCard } from "@/lib/og/timeline";
import { TIMELINE } from "@/lib/timeline/data";

/** Share card for one moment on the Pokémon Timeline. Drawn on first request and cached from then on. */

export const alt = "A moment in Pokémon history on the PokéIQ Timeline";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ event: string }> }) {
  const { event } = await params;
  const entry = TIMELINE.find((e) => e.id === event);
  return entry ? timelineEntryCard(entry) : timelineCard();
}
