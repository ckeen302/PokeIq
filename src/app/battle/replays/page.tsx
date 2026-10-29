import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import Link from "next/link";
import { FileUp, Radio } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ReplayLists } from "@/components/battle/ReplayLists";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Battle Replays",
  description: "Watch Pokémon battle replays turn by turn, on Pokémon Showdown's engine: your own battles and the latest ranked and public ones.",
  image: SHARE_IMAGES.battle,
  path: "/battle/replays",
});

export default function ReplaysPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb="Replays" title="Battle" accent="replays">
        Every ranked and public battle is saved as a replay; after any other, press Save replay. Replays show what spectators saw, turn by turn.
      </BattleHeader>
      <div className="flex flex-wrap gap-2">
        <Link href="/battle/replay/import" className={buttonVariants({ variant: "outline" })} data-testid="replay-import-link">
          <FileUp className="h-4 w-4" aria-hidden /> Watch a Showdown replay
        </Link>
        <Link href="/battle/watch" className={buttonVariants({ variant: "outline" })}>
          <Radio className="h-4 w-4" aria-hidden /> Live battles
        </Link>
      </div>
      <ReplayLists />
    </div>
  );
}
