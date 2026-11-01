import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { TimelinePage } from "@/components/timeline/TimelinePage";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Timeline — the complete history in 3D",
  description:
    "Fly through Pokémon history from Red and Green in 1996 to today: every main-series game, remake and DLC, every anime season and film, TCG eras, key spin-offs and milestones, with Japanese and Western release dates.",
  path: "/pokedex/timeline",
});

export default function Page() {
  return <TimelinePage />;
}
