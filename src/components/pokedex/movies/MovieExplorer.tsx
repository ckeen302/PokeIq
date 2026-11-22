"use client";

import { localUrl } from "@/i18n/paths";
import { useEffect, useState } from "react";
import { MOVIE_ERAS, MOVIES_PATH, parseEra, type MovieEraId } from "@/lib/movies/eras";
import { cn } from "@/lib/utils";
import { MovieCard, type MovieCardData } from "./MovieCard";

/**
 * Every film's poster, with era chips that narrow the grid. The page renders
 * every film, so it reads fine before (or without) the scripts; the chips are
 * plain `?era=` links, and the chosen era stays in the address bar to share.
 */
export function MovieExplorer({ films }: { films: MovieCardData[] }) {
  const [era, setEra] = useState<MovieEraId | null>(null);

  useEffect(() => {
    const read = () => setEra(parseEra(new URLSearchParams(window.location.search).get("era")));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const choose = (next: MovieEraId | null) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setEra(next);
    window.history.replaceState(window.history.state, "", next ? `?era=${next}` : localUrl(MOVIES_PATH));
  };

  const chips = [{ id: null, label: "All" }, ...MOVIE_ERAS];
  const shown = era ? films.filter((f) => f.era === era).length : films.length;

  return (
    <div className="space-y-5">
      <nav aria-label="Film eras" className="flex flex-wrap justify-center gap-1.5" data-testid="movie-eras">
        {chips.map((c) => {
          const on = era === c.id;
          return (
            <a
              key={c.id ?? "all"}
              href={c.id ? `${MOVIES_PATH}?era=${c.id}` : MOVIES_PATH}
              onClick={choose(c.id)}
              aria-current={on ? "true" : undefined}
              data-testid={`movie-era-${c.id ?? "all"}`}
              className={cn(
                "inline-flex h-8 items-center rounded-sm border px-3 font-pixel text-[10px] uppercase tracking-wider transition-colors max-md:h-10",
                on ? "border-primary bg-primary text-primary-foreground" : "border-foreground/15 text-muted-foreground hover:border-screen/60 hover:text-foreground"
              )}
            >
              {c.label}
            </a>
          );
        })}
      </nav>
      <p className="sr-only" aria-live="polite">
        {era ? `Showing ${MOVIE_ERAS.find((e) => e.id === era)?.label} films` : "Showing every film"}
      </p>
      <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 min-[1200px]:grid-cols-9" data-testid="movie-grid" data-count={shown}>
        {films.map((f, i) => (
          <li key={f.slug} hidden={era !== null && f.era !== era}>
            <MovieCard film={f} eager={i < 9} />
          </li>
        ))}
      </ul>
    </div>
  );
}
