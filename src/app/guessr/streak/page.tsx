import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { StreakGame } from "@/components/geo/StreakGame";
import { geoRegions } from "@/lib/server/geo";
import { WORLD_REGION } from "@/lib/geo-types";

export const metadata: Metadata = pageMetadata({
  title: "PokéGuessr Region Streak: name the region from one screenshot",
  description:
    "Region Streak is PokéGuessr's country streak: one in-game screenshot, pick the region from Kanto to Paldea. Right deals the next one, wrong ends the run. How long can you go?",
  path: "/guessr/streak",
});

export default function StreakPage() {
  const world = geoRegions().find((r) => r.id === WORLD_REGION);
  if (!world) notFound();
  return <StreakGame world={world} />;
}
