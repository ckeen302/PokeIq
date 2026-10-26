"use client";

import { useEffect, useState } from "react";
import { PencilLine, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { customPath, type CustomListResponse, type CustomSummary } from "@/lib/connections/custom";

/** /connections/community: the week's featured puzzle, the top ones and the newest. Titles and votes only. */

function Row({ p }: { p: CustomSummary }) {
  return (
    <li>
      <a href={customPath(p.id)} className="flex items-center justify-between gap-3 rounded-md border border-foreground/15 bg-card px-4 py-3 hover:border-primary/60" data-testid="community-row">
        <span className="min-w-0">
          <span className="block truncate font-display font-bold">{p.title ?? "Untitled puzzle"}</span>
          <span className="block text-xs text-muted-foreground">
            by {p.creator ?? "a trainer"} · {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <ThumbsUp className="h-4 w-4" aria-hidden /> {p.up}
          </span>
          <span className="flex items-center gap-1">
            <ThumbsDown className="h-4 w-4" aria-hidden /> {p.down}
          </span>
        </span>
      </a>
    </li>
  );
}

export function CommunityList() {
  const [data, setData] = useState<CustomListResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/connections/custom")
      .then((r) => r.json())
      .then((b) => setData(b as CustomListResponse))
      .catch(() => setFailed(true));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">PokéConnections · Community</p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl">Trainer-made puzzles</h1>
        <p className="text-sm text-muted-foreground">Puzzles other trainers built. Play one, vote it up, or make your own and share the link.</p>
        <a href="/connections/create" className={cn(buttonVariants({ size: "sm" }), "mt-1")} data-testid="community-create">
          <PencilLine className="h-4 w-4" aria-hidden /> Make your own
        </a>
      </div>
      {failed && <p className="text-center text-sm text-destructive">Couldn&apos;t load the puzzles.</p>}
      {!data && !failed && <p className="text-center text-sm text-muted-foreground">Loading…</p>}
      {data && !data.available && <p className="text-center text-sm text-muted-foreground">Community puzzles aren&apos;t available right now.</p>}
      {data?.available && !data.featured && !data.top.length && !data.newest.length && (
        <div className="mx-auto max-w-md space-y-3 rounded-lg border border-dashed border-foreground/20 bg-card px-5 py-8 text-center" data-testid="community-empty">
          <p className="font-display text-lg font-bold uppercase">No puzzles yet</p>
          <p className="text-sm text-muted-foreground">Be the first: pick four groups of four Pokémon, name them, and send the link to a friend. The builder warns you when a Pokémon could fit two groups.</p>
          <a href="/connections/create" className={buttonVariants()}>
            <PencilLine className="h-4 w-4" aria-hidden /> Create a puzzle
          </a>
        </div>
      )}
      {data?.available && (data.featured || data.top.length > 0 || data.newest.length > 0) && (
        <>
          {data.featured && (
            <section className="space-y-2" aria-labelledby="featured-h">
              <h2 id="featured-h" className="flex items-center gap-2 font-display text-xl font-bold uppercase">
                <Star className="h-5 w-5 text-primary" aria-hidden /> Featured this week
              </h2>
              <ul>
                <Row p={data.featured} />
              </ul>
            </section>
          )}
          <section className="space-y-2" aria-labelledby="top-h">
            <h2 id="top-h" className="font-display text-xl font-bold uppercase">
              Top rated
            </h2>
            {data.top.length ? (
              <ul className="space-y-2">
                {data.top.map((p) => (
                  <Row key={p.id} p={p} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No puzzles yet. Be the first.</p>
            )}
          </section>
          <section className="space-y-2" aria-labelledby="new-h">
            <h2 id="new-h" className="font-display text-xl font-bold uppercase">
              Newest
            </h2>
            {data.newest.length ? (
              <ul className="space-y-2">
                {data.newest.map((p) => (
                  <Row key={p.id} p={p} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing here yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
