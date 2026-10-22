import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Connections } from "@/components/connections/Connections";

export const metadata: Metadata = pageMetadata({
  title: "PokéConnections — Daily Pokémon Connections Puzzle",
  description:
    "Sixteen Pokémon, four hidden groups: types, abilities, evolutions, stats and more. Find what links them with four mistakes to spare. A new puzzle every day, an archive and unlimited practice.",
  path: "/connections",
});

export default function ConnectionsPage() {
  // The tiles come from /api/connections once the player's local date is known; the groups never reach the page.
  return <Connections />;
}
