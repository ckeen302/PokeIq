import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { TrainerCreator } from "@/components/trainer3d/TrainerCreator";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Trainer creator",
  description: "Make your 3D PokéIQ trainer: hair, hats, outfits, bags, your Poké Ball and a partner Pokémon at your side.",
  path: "/trainer/avatar",
});

export default function TrainerAvatarPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <BackButton href="/trainer" label="Back to trainer card" />
      <header className="space-y-1">
        <p className="hud-label text-screen">Trainer creator</p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide sm:text-4xl">Make your trainer</h1>
      </header>
      <TrainerCreator />
    </div>
  );
}
