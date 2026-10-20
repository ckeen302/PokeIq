import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { WatchLobby } from "@/components/battle/WatchLobby";

export const metadata: Metadata = pageMetadata({
  title: "Watch Live Pokémon Battles",
  description: "Spectate live Pokémon battles on Pokémon Showdown's engine: ranked ladder matches and open friend battles, as they happen.",
  image: SHARE_IMAGES.battle,
  path: "/battle/watch",
});

export default function BattleWatchPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb="Watch" title="Watch" accent="live">
        Battles under way right now. Spectators see what Showdown&apos;s spectators see: each side&apos;s team is revealed only as it plays out.
      </BattleHeader>
      <WatchLobby />
    </div>
  );
}
