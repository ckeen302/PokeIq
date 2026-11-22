import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, itemList } from "@/lib/structured-data";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { MOVIES, type Movie } from "@/lib/movies/data";
import { MOVIES_PATH, moviePath } from "@/lib/movies/eras";
import { localizeMovie, movieTexts } from "@/lib/movies/i18n";
import { speciesName } from "@/lib/names/species";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { MovieExplorer } from "@/components/pokedex/movies/MovieExplorer";
import type { MovieCardData } from "@/components/pokedex/movies/MovieCard";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import dexMovies from "@/messages/dex-movies";
import dexMoviesList from "@/messages/dex-movies-list";

export function generateMetadata(): Metadata {
  const t = serverT(dexMovies);
  return pageMetadata({
    title: t("meta.title"),
    description: t("meta.description"),
    path: MOVIES_PATH,
    image: SHARE_IMAGES.pokedex,
  });
}

export default function MoviesPage() {
  const locale = getLocale();
  return locale === DEFAULT_LOCALE ? <MoviesView movies={MOVIES} locale={locale} /> : <LocalMoviesView locale={locale} />;
}

/** Another language's list: the films with their titles in that language. */
async function LocalMoviesView({ locale }: { locale: Locale }) {
  const tx = await movieTexts(locale);
  return <MoviesView movies={MOVIES.map((m) => localizeMovie(m, tx))} locale={locale} />;
}

function MoviesView({ movies, locale }: { movies: Movie[]; locale: Locale }) {
  const t = serverT(dexMovies);
  const films: MovieCardData[] = movies.map((m) => ({
    slug: m.slug,
    title: m.title,
    year: m.year,
    poster: m.poster,
    era: m.era,
    comingSoon: m.era === "coming-soon",
    featured: m.featured.slice(0, 2).map((id) => ({ id, name: speciesName(id, getPokemon(id)?.name ?? "", locale) })),
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader kicker={t("header.kicker")} title={t("header.title")} accent={t("header.accent")} blurb={t("header.blurb")} />
      <DexTabs active="movies" />
      <ClientMessages namespaces={[dexMoviesList]}>
        <MovieExplorer films={films} />
      </ClientMessages>
      <p className="pt-6 text-center text-xs text-muted-foreground">
        {t.rich("credit", {
          bulba: (chunks) => (
            <a href="https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_movie" className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
              {chunks}
            </a>
          ),
        })}
      </p>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(breadcrumbList([{ name: t("ld.pokedex"), path: "/pokedex" }, { name: t("ld.movies"), path: MOVIES_PATH }])),
        }}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(itemList(t("ld.list"), movies.map((m) => ({ name: m.title, path: moviePath(m.slug) })))) }} />
    </div>
  );
}
