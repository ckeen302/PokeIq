import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { customPath } from "@/lib/connections/custom";
import { CREATOR_NAME_RE } from "@/lib/connections/social";
import { creatorPage } from "@/lib/server/connections-creators";

export const dynamic = "force-dynamic";

// Trainers' own pages: playable and shareable, not for search engines.
export const metadata: Metadata = {
  title: "PokéConnections Creator",
  description: "Community PokéConnections puzzles by one trainer.",
  robots: { index: false, follow: false },
};

/** /connections/creator/<name>: a creator's puzzles and their total votes. Titles and votes only, never a puzzle's groups. */
export default async function CreatorPage({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeURIComponent((await params).name);
  if (!CREATOR_NAME_RE.test(name)) notFound();
  const page = await creatorPage(name);
  if (!page) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <p className="hud-label">PokéConnections creator</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight" data-testid="creator-name">
          {page.name}
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="creator-totals">
          {page.puzzles.length} puzzle{page.puzzles.length === 1 ? "" : "s"} · {page.votes.toLocaleString("en-US")} vote{page.votes === 1 ? "" : "s"} (score {page.score >= 0 ? "+" : ""}
          {page.score})
        </p>
      </div>
      <ul className="space-y-2">
        {page.puzzles.map((p) => (
          <li key={p.id}>
            <a href={customPath(p.id)} className="flex items-center justify-between gap-3 rounded-md border border-foreground/15 bg-card px-4 py-3 hover:border-primary/60" data-testid="creator-puzzle">
              <span className="min-w-0">
                <span className="block truncate font-display font-bold">{p.title ?? "Untitled puzzle"}</span>
                <span className="block text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
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
        ))}
      </ul>
    </div>
  );
}
