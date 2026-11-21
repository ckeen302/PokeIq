import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, itemList } from "@/lib/structured-data";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { GamesExplorer } from "@/components/pokedex/games/GamesExplorer";
import { VIDEO_GAMES, toCard } from "@/lib/dex/video-games";

export const metadata: Metadata = pageMetadata({
  title: "Every Pokémon Game — Main Series, Remakes, Spin-offs & Mobile",
  description:
    "Every Pokémon video game from Red and Green to Legends: Z-A, with box art: the main series, remakes, spin-offs like Snap, Mystery Dungeon and Stadium, and mobile games like Pokémon GO. Filter by generation and type.",
  path: "/pokedex/games",
  socialTitle: "Every Pokémon game · PokéIQ Pokédex",
});

export default function GamesPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <ListHeader
        kicker="Game database"
        title="Poké"
        accent="dex"
        blurb="Every Pokémon game, from Red and Green on the Game Boy to today: the main series and its remakes, the spin-offs and the mobile games, each with its box art."
      />
      <DexTabs active="games" />
      <GamesExplorer games={VIDEO_GAMES.map(toCard)} />
      <p className="pt-6 text-center text-xs text-muted-foreground">
        Release dates, platforms and developers from{" "}
        <a href="https://en.wikipedia.org/wiki/List_of_Pok%C3%A9mon_video_games" className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
          Wikipedia
        </a>
        ; box art, version exclusives and Legendary Pokémon from{" "}
        <a href="https://www.serebii.net/" className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
          Serebii
        </a>
        . Years are each game&apos;s first release; Gen is the generation it belongs to, or for a spin-off the one that was current.
      </p>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            breadcrumbList([
              { name: "Pokédex", path: "/pokedex" },
              { name: "Games", path: "/pokedex/games" },
            ]),
            itemList(
              "Pokémon video games",
              VIDEO_GAMES.map((g) => ({ name: g.name, path: `/pokedex/games/${g.slug}` }))
            ),
          ]),
        }}
      />
    </div>
  );
}
