import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SizesPage } from "@/components/sizes/SizesPage";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon size comparison: every Pokémon to scale in 3D",
  description:
    "Every Pokémon side by side at its real size, from 0.1 m to Eternamax Eternatus at 100 m, in a 3D Lumiose City. Play the glide, compare any Pokémon, and make your own size comparison video for TikTok, Reels and Shorts.",
  path: "/pokedex/sizes",
  socialTitle: "Every Pokémon to scale, in 3D · PokéIQ",
});

export default function Page() {
  return <SizesPage />;
}
