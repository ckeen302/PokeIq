"use client";

import { DUEL_HP } from "@/lib/duel-types";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { GEO_ERA_NAMES, type GeoEra } from "@/lib/geo-families";
import { NewDuelCard } from "@/components/duel/NewDuelCard";

/** "Duel a friend" on /guessr: opens a duel on the chosen map (and era) and goes to its lobby. */
export function DuelCard({ region, era }: { region: GeoRegionInfo; era?: GeoEra }) {
  const games = era ? ` · ${GEO_ERA_NAMES[era]}` : "";
  return (
    <NewDuelCard
      endpoint="/api/geo/duel"
      body={{ region: region.id, ...(era ? { era } : {}) }}
      match={{ game: "geo", region: region.id, ...(era ? { era } : {}) }}
      href={(code) => `/guessr/duel/${code}`}
      heading={`Head to head · ${region.name}${games}`}
      blurb={`The same places for both of you, on the map${era ? " and games" : ""} picked above. ${DUEL_HP.toLocaleString("en-US")} HP each: every round, the lower score loses the difference. Send your friend the link and press Ready.`}
    />
  );
}
