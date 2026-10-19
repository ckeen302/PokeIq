"use client";

import { DUEL_HP } from "@/lib/duel-types";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { NewDuelCard } from "@/components/duel/NewDuelCard";

/** "Duel a friend" on /guessr: opens a duel on the chosen map and goes to its lobby. */
export function DuelCard({ region }: { region: GeoRegionInfo }) {
  return (
    <NewDuelCard
      endpoint="/api/geo/duel"
      body={{ region: region.id }}
      match={{ game: "geo", region: region.id }}
      href={(code) => `/guessr/duel/${code}`}
      heading={`Head to head · ${region.name}`}
      blurb={`The same places for both of you, on the map picked above. ${DUEL_HP.toLocaleString("en-US")} HP each: every round, the lower score loses the difference. Send your friend the link and press Ready.`}
    />
  );
}
