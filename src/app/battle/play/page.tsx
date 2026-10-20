import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { BattleSetup, type Opponent } from "@/components/battle/BattleSetup";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Battle — vs Computer, Online or a Friend",
  description:
    "Real Pokémon battles on Pokémon Showdown's engine: Random Battle, Random Doubles or your own OU team, against a computer opponent, a trainer found by matchmaking, or a friend through an invite link.",
  image: SHARE_IMAGES.battle,
  path: "/battle/play",
});

export default async function BattlePlayPage({ searchParams }: { searchParams: Promise<{ vs?: string; challenge?: string }> }) {
  const { vs, challenge } = await searchParams;
  // ?vs=anyone opens on "Find an opponent", ?vs=friend on the invite link.
  const friend = challenge && /^[A-Za-z0-9_-]{3,20}$/.test(challenge) ? challenge : undefined;
  const opening: Opponent = friend || vs === "friend" ? "pvp" : vs === "anyone" ? "match" : "cpu";
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb="Play" title="Start a" accent="battle">
        Pokémon Showdown&apos;s own battle engine: every move, ability and item works as it does there. Pick an opponent, a format and go.
      </BattleHeader>
      <BattleSetup initial={opening} challenge={friend} />
    </div>
  );
}
