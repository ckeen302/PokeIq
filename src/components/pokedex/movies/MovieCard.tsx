/* eslint-disable @next/next/no-img-element -- posters and art are pre-sized static files (public/movies, public/art/160) */
import Link from "@/components/ui/Link";
import { boardArtUrl } from "@/lib/pokemon/art";
import { moviePath } from "@/lib/movies/eras";
import { cn } from "@/lib/utils";

export interface MovieCardData {
  slug: string;
  title: string;
  year: number;
  poster: string;
  era: string;
  comingSoon: boolean;
  /** The one or two Pokémon it stars, drawn small under the poster. */
  featured: { id: number; name: string }[];
}

/**
 * A film's poster tile: the poster, its year with small art of the Pokémon it stars, and its title. `posterAlt` and
 * `soonLabel` are the poster's alt text and the "Coming soon" badge in the page's language.
 */
export function MovieCard({ film, className, eager, posterAlt, soonLabel }: { film: MovieCardData; className?: string; eager?: boolean; posterAlt: string; soonLabel: string }) {
  return (
    <Link
      href={moviePath(film.slug)}
      data-testid="movie-card"
      data-era={film.era}
      className={cn("group flex h-full flex-col gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <span className="relative block overflow-hidden rounded-md border border-foreground/10 bg-shade/40 shadow-sm transition-colors group-hover:border-screen/60">
        <img
          src={film.poster}
          alt={posterAlt}
          width={300}
          height={450}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          data-testid="movie-poster"
          className="block aspect-[2/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {film.comingSoon && (
          <span className="absolute bottom-1.5 left-1.5 rounded-sm bg-primary px-1.5 py-1 font-pixel text-[9px] uppercase tracking-wider text-primary-foreground">{soonLabel}</span>
        )}
      </span>
      <span className="flex items-center justify-between gap-1">
        <span className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground">{film.year}</span>
        <span className="flex shrink-0 -space-x-1.5" aria-hidden>
          {film.featured.map((p) => (
            <img key={p.id} src={boardArtUrl(p.id)} alt="" width={28} height={28} loading="lazy" decoding="async" className="h-7 w-7 object-contain max-sm:h-6 max-sm:w-6" />
          ))}
        </span>
      </span>
      <span className="font-display text-[13px] font-bold leading-tight tracking-wide group-hover:text-screen [overflow-wrap:anywhere]">{film.title}</span>
    </Link>
  );
}
