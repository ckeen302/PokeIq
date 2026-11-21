import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, itemList } from "@/lib/structured-data";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { MOVIES } from "@/lib/movies/data";
import { MOVIES_PATH, moviePath } from "@/lib/movies/eras";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { MovieExplorer } from "@/components/pokedex/movies/MovieExplorer";
import type { MovieCardData } from "@/components/pokedex/movies/MovieCard";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Movies — Every Pokémon Film in Release Order",
  description:
    "Every Pokémon film in release order, from Mewtwo Strikes Back to Secrets of the Jungle, the live-action Detective Pikachu and Pokémon: Wild Card: posters, the Pokémon each one stars, settings and characters.",
  path: MOVIES_PATH,
  image: SHARE_IMAGES.pokedex,
});

export default function MoviesPage() {
  const films: MovieCardData[] = MOVIES.map((m) => ({
    slug: m.slug,
    title: m.title,
    year: m.year,
    poster: m.poster,
    era: m.era,
    comingSoon: m.era === "coming-soon",
    featured: m.featured.slice(0, 2).map((id) => ({ id, name: getPokemon(id)?.name ?? "" })),
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader
        kicker="Film archive"
        title="Poké"
        accent="dex"
        blurb="Every Pokémon film, from Mewtwo Strikes Back to the live-action Detective Pikachu and what's coming next: the posters, the Pokémon each one stars and who's who."
      />
      <DexTabs active="movies" />
      <MovieExplorer films={films} />
      <p className="pt-6 text-center text-xs text-muted-foreground">
        Release years, settings and characters are checked against{" "}
        <a href="https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_movie" className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
          Bulbapedia
        </a>
        . The year under each poster is its first release.
      </p>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(breadcrumbList([{ name: "Pokédex", path: "/pokedex" }, { name: "Movies", path: MOVIES_PATH }])),
        }}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(itemList("Pokémon movies", MOVIES.map((m) => ({ name: m.title, path: moviePath(m.slug) })))) }} />
    </div>
  );
}
