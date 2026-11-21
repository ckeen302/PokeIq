"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "@/components/ui/Link";
import { GameCover } from "./GameCover";
import { KindTag } from "./KindTag";
import { DEFAULT_QUERY, GENS, KIND_FILTERS, SORTS, applyGameQuery, gameQueryString, parseGameQuery, releaseYear, type GameCard, type GameQuery, type GameSort } from "@/lib/dex/video-games-types";
import { cn } from "@/lib/utils";

/**
 * The Games list: kind chips, a generation picker and the sort, all kept in
 * the URL (?kind=remake&gen=3&sort=oldest) so a filtered list can be shared.
 * The page is static: it renders every game newest first, and a shared
 * link's filter is applied once the page is running.
 */
export function GamesExplorer({ games }: { games: GameCard[] }) {
  const [q, setQ] = useState<GameQuery>(DEFAULT_QUERY);

  useEffect(() => {
    try {
      setQ(parseGameQuery(new URLSearchParams(window.location.search)));
    } catch {
      // No URL access: keep the default list.
    }
    const onPop = () => setQ(parseGameQuery(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const update = (next: Partial<GameQuery>) => {
    const merged = { ...q, ...next };
    setQ(merged);
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${gameQueryString(merged)}`);
    } catch {
      // The list still filters; only the address doesn't follow.
    }
  };

  const shown = useMemo(() => applyGameQuery(games, q), [games, q]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3" data-testid="games-filters">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind of game">
          {KIND_FILTERS.map((f) => {
            const on = q.kind === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => update({ kind: f.id })}
                data-testid={`games-kind-${f.id}`}
                className={cn(
                  "h-9 rounded-md border px-3.5 font-display text-xs font-bold uppercase tracking-wider transition-colors max-md:h-10",
                  on ? "border-transparent bg-primary text-primary-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:text-foreground"
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={q.gen ?? ""}
            onChange={(e) => update({ gen: e.target.value ? Number(e.target.value) : null })}
            aria-label="Generation"
            data-testid="games-gen"
            className="h-9 rounded-md border border-input bg-shade/40 px-3 font-display text-sm max-md:h-10 max-md:text-base"
          >
            <option value="">Every generation</option>
            {GENS.map((g) => (
              <option key={g} value={g}>
                Gen {g}
              </option>
            ))}
          </select>
          <select
            value={q.sort}
            onChange={(e) => update({ sort: e.target.value as GameSort })}
            aria-label="Sort"
            data-testid="games-sort"
            className="h-9 rounded-md border border-input bg-shade/40 px-3 font-display text-sm max-md:h-10 max-md:text-base"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {shown.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" data-testid="games-grid">
          {shown.map((g, i) => (
            <li key={g.slug}>
              <Link
                href={`/pokedex/games/${g.slug}`}
                data-testid="games-card"
                data-slug={g.slug}
                className="group flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-screen/60"
              >
                <span className="block border-b border-foreground/5 bg-shade/30 px-1 py-2">
                  <GameCover cover={g.cover} eager={i < 12} />
                </span>
                <span className="flex flex-1 flex-col gap-1.5 p-2.5">
                  <span className="hud-label flex flex-wrap gap-x-1.5 gap-y-1 leading-snug">
                    <span>{releaseYear(g.released)}</span>
                    <span aria-hidden>·</span>
                    <span className="whitespace-nowrap">{g.platform}</span>
                    <span aria-hidden>·</span>
                    <span className="whitespace-nowrap">Gen {g.gen}</span>
                  </span>
                  <span className="font-display text-sm font-bold uppercase leading-tight tracking-wide group-hover:text-screen">{g.name}</span>
                  <span className="mt-auto pt-0.5">
                    <KindTag kind={g.kind} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-center text-muted-foreground" data-testid="games-empty">
          No games match.{" "}
          <button type="button" onClick={() => update(DEFAULT_QUERY)} className="font-semibold text-foreground underline-offset-2 hover:underline">
            Show every game
          </button>
        </p>
      )}
    </div>
  );
}
