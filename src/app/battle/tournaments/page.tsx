import type { Metadata } from "next";
import Link from "next/link";
import { Castle, Swords, Users } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";

export const metadata: Metadata = pageMetadata({
  title: "Tournaments",
  description: "Pokémon battle tournaments on PokéIQ: coming next.",
  path: "/battle/tournaments",
  noindex: true,
});

export default function TournamentsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <BattleHeader crumb="Tournaments" title="Tournaments" accent="coming next">
        Brackets in any format, open to everyone or just your friends, with live spectating and replays of every round.
      </BattleHeader>
      <div className="hud relative space-y-4 rounded-xl border border-dashed border-warning/50 bg-card p-8 text-center">
        <Castle className="mx-auto h-10 w-10 text-warning" aria-hidden />
        <p className="font-display text-2xl font-bold uppercase">Coming next</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">Tournaments are being built right now. Until then, climb the ladder or challenge your friends.</p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Link href="/battle" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground">
            <Swords className="h-4 w-4" aria-hidden /> Battle now
          </Link>
          <Link href="/users" className="inline-flex items-center gap-2 rounded-md border bg-background px-4 py-2 font-display text-sm font-semibold uppercase tracking-wider">
            <Users className="h-4 w-4" aria-hidden /> Find a trainer
          </Link>
        </div>
      </div>
    </div>
  );
}
