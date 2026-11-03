import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { WORLD_HISTORY_LIVE } from "@/lib/lab";
import { HISTORY_PATH } from "@/lib/world-history/deeplink";
import { WorldHistoryPage } from "@/components/world-history/WorldHistoryPage";

export const metadata: Metadata = pageMetadata({
  title: "The History of the Pokémon World: the in-universe story in 3D",
  description:
    "The history of the Pokémon world as the games tell it, from Sinnoh's creation myth and Hoenn's Primal clash to Kalos's ultimate weapon, Galar's Darkest Day, the Burned Tower and Area Zero's time machine. A cinematic 3D museum with every line sourced to the games.",
  path: HISTORY_PATH,
  socialTitle: "The History of the Pokémon World · PokéIQ",
  noindex: !WORLD_HISTORY_LIVE,
});

export default function Page() {
  return <WorldHistoryPage />;
}
