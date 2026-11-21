/* eslint-disable @next/next/no-img-element -- posters and art are pre-sized static files (public/movies, public/art/160) */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MapPin, CalendarDays } from "lucide-react";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, movie as movieLd } from "@/lib/structured-data";
import { species } from "@/lib/dex/data";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { boardArtUrl } from "@/lib/pokemon/art";
import { MOVIES, getMovie, movieKicker, movieYears, relatedFor, type Movie, type MovieCharacter } from "@/lib/movies/data";
import { MOVIES_PATH, moviePath } from "@/lib/movies/eras";
import { pagerFor } from "@/lib/dex/neighbours";
import { Section } from "@/components/pokedex/entry/Reveal";
import { DetailNav, SpeciesGrid, type SpeciesChip } from "@/components/pokedex/detail/DetailParts";
import { MovieCard, type MovieCardData } from "@/components/pokedex/movies/MovieCard";
import { cn } from "@/lib/utils";

export const dynamicParams = false;

export function generateStaticParams() {
  return MOVIES.map((m) => ({ slug: m.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** "Pokémon: Wild Card" already says Pokémon; the others read better with it. */
const fullTitle = (m: Movie) => (m.title.startsWith("Pokémon") ? m.title : `Pokémon: ${m.title}`);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const m = getMovie((await params).slug);
  if (!m) return {};
  const when = m.premiere ? `(${m.year})` : `(coming ${m.year})`;
  return pageMetadata({
    title: `${fullTitle(m)} ${when} — Pokémon Movie`,
    description: `${m.summary} The Pokémon it stars, its characters and their partners${m.setting ? `, and where it's set` : ""}.`,
    path: moviePath(m.slug),
    socialTitle: `${m.title} · PokéIQ Pokédex`,
    // The preview picture is this segment's opengraph-image (the poster on the site's 1200 × 630 card).
  });
}

const ROLE_LABEL: Record<MovieCharacter["role"], string> = { hero: "Hero", guest: "Guest", villain: "Villain" };
const ROLE_CLS: Record<MovieCharacter["role"], string> = {
  hero: "border-screen/40 text-screen",
  guest: "border-foreground/20 text-muted-foreground",
  villain: "border-primary/50 text-primary",
};

const toCard = (m: Movie): MovieCardData => ({
  slug: m.slug,
  title: m.title,
  year: m.year,
  poster: m.poster,
  era: m.era,
  comingSoon: m.era === "coming-soon",
  featured: m.featured.slice(0, 2).map((id) => ({ id, name: getPokemon(id)?.name ?? "" })),
});

export default async function MoviePage({ params }: PageProps) {
  const m = getMovie((await params).slug);
  if (!m) notFound();
  const featured = m.featured.map((id) => species(id)).filter((s): s is SpeciesChip => Boolean(s));
  const related = relatedFor(m);
  const pager = pagerFor(MOVIES, (x) => x.slug === m.slug, (x) => ({ href: moviePath(x.slug), label: x.title }));
  let idx = 0;

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav tab="movies" label="All movies" pager={pager} />

      <header className="hud relative isolate overflow-hidden rounded-lg border bg-black text-white" data-testid="movie-hero">
        <img src={m.poster} alt="" aria-hidden className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-70 blur-2xl" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/80 via-black/60 to-black/35" aria-hidden />
        <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
          <img
            src={m.poster}
            alt={`${m.title} poster`}
            width={300}
            height={450}
            data-testid="movie-hero-poster"
            className="aspect-[2/3] w-40 shrink-0 self-center rounded-md border border-white/15 object-cover shadow-2xl sm:w-56 sm:self-auto"
          />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="hud-label text-screen">{movieKicker(m)}</p>
            <h1 className="font-display text-3xl font-bold uppercase tracking-tight [overflow-wrap:anywhere] sm:text-5xl">{m.title}</h1>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-white/80">
              <li className="flex items-center gap-1.5" data-testid="movie-years">
                <CalendarDays className="h-4 w-4 shrink-0 text-white/60" aria-hidden />
                {movieYears(m)}
              </li>
              {m.setting && (
                <li className="flex items-center gap-1.5" data-testid="movie-setting">
                  <MapPin className="h-4 w-4 shrink-0 text-white/60" aria-hidden />
                  {m.setting}
                </li>
              )}
            </ul>
            <p className="max-w-2xl text-base leading-relaxed text-white/90" data-testid="movie-summary">
              {m.summary}
            </p>
          </div>
        </div>
      </header>

      <Section id="featured" index={++idx} title="Featured Pokémon" subtitle="Tap one for its Pokédex entry">
        <div data-testid="movie-featured">
          <SpeciesGrid list={featured} />
        </div>
      </Section>

      {m.characters.length > 0 && (
        <Section id="characters" index={++idx} title="Characters" subtitle="Heroes, guests and villains">
          <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4" data-testid="movie-characters">
            {m.characters.map((c) => {
              const partner = c.partner ? getPokemon(c.partner) : undefined;
              return (
                <li key={c.name} className="flex items-center gap-3 rounded-lg border bg-card p-3" data-testid="movie-character">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-shade/50">
                    {partner ? (
                      <img src={boardArtUrl(partner.id)} alt="" width={48} height={48} loading="lazy" decoding="async" className="h-11 w-11 object-contain" />
                    ) : (
                      <span className="font-display text-lg font-bold uppercase text-muted-foreground" aria-hidden>
                        {c.name.charAt(0)}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block font-display text-base font-bold uppercase leading-tight tracking-wide [overflow-wrap:anywhere]">{c.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("rounded-sm border px-1.5 py-0.5 font-pixel text-[9px] uppercase tracking-wider", ROLE_CLS[c.role])}>{ROLE_LABEL[c.role]}</span>
                      {partner && <span className="truncate text-xs text-muted-foreground">with {partner.name}</span>}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {related.films.length > 0 && (
        <Section id="related" index={++idx} title="Related" subtitle={related.title}>
          <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-6" data-testid="movie-related">
            {related.films.map((f) => (
              <li key={f.slug}>
                <MovieCard film={toCard(f)} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            breadcrumbList([
              { name: "Pokédex", path: "/pokedex" },
              { name: "Movies", path: MOVIES_PATH },
              { name: m.title, path: moviePath(m.slug) },
            ])
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(movieLd({ name: fullTitle(m), path: moviePath(m.slug), description: m.summary, image: m.poster, datePublished: m.premiere })) }}
      />
    </article>
  );
}
