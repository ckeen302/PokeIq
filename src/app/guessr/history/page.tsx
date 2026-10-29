import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { BackButton } from "@/components/ui/BackButton";
import { DuelHistoryList } from "@/components/geo/DuelHistory";
import { geoRegions } from "@/lib/server/geo";
import { WORLD_REGION } from "@/lib/geo-types";

export const metadata: Metadata = pageMetadata({
  title: "PokéGuessr duel history",
  description: "Your PokéGuessr duels, casual and ranked, with a round-by-round replay of every one.",
  path: "/guessr/history",
  noindex: true,
});

/** Map ids to the names the list shows. */
const mapNames = () => Object.fromEntries(geoRegions().map((r) => [r.id, r.id === WORLD_REGION ? "World map" : r.name]));

export default function DuelHistoryPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackButton href="/guessr" label="Back to PokéGuessr" />
      <header className="space-y-1">
        <p className="hud-label text-screen">PokéGuessr</p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Duel history</h1>
        <p className="text-sm text-muted-foreground">Every duel you finish on this device, or on your account when you&apos;re signed in. Open one to replay it round by round.</p>
      </header>
      <DuelHistoryList mapNames={mapNames()} />
    </div>
  );
}
