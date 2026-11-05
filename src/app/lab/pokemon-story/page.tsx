import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { POKEMON_STORY_LIVE } from "@/lib/lab";
import { STORY_PATH } from "@/lib/pokemon-story/deeplink";
import { StoryPage } from "@/components/pokemon-story/StoryPage";
import { StoryFilm } from "@/components/pokemon-story/StoryFilm";

export const metadata: Metadata = pageMetadata({
  title: "The Story of Pokémon: the real history, as a 3D film",
  description:
    "How Pokémon was made and how it grew, from Satoshi Tajiri's bug hunts in 1970s Machida and the Game Boy link cable to Red and Green, Pokémania, Pokémon GO and thirty years. A cinematic 3D film with every line sourced.",
  path: STORY_PATH,
  socialTitle: "The Story of Pokémon · PokéIQ",
  noindex: !POKEMON_STORY_LIVE,
});

export default function Page() {
  return <StoryPage film={(text) => <StoryFilm initialChapter={null}>{text}</StoryFilm>} />;
}
