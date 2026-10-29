/* eslint-disable @next/next/no-img-element -- the region map pictures are static files */
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Crown, Play } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { readGeoShare } from "@/lib/server/geo-share";
import { guessrSquare } from "@/lib/share";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * /guessr/r/<token>: a shared PokéGuessr result (a finished game, daily or
 * streak by its signed result, a duel by its code). Rendered from the token
 * alone, so a link can't be forged; nothing here names a place.
 */

interface PageProps {
  params: Promise<{ token: string }>;
}

async function read(params: PageProps["params"]) {
  let raw: string;
  try {
    raw = decodeURIComponent((await params).token);
  } catch {
    return null;
  }
  return readGeoShare(raw);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const view = await read(params);
  if (!view) return { title: "PokéGuessr result", robots: { index: false } };
  return pageMetadata({ title: view.title, description: view.detail, socialTitle: `${view.title} · PokéIQ`, noindex: true });
}

const fmt = (n: number) => n.toLocaleString("en-US");

export default async function GeoResultPage({ params }: PageProps) {
  const view = await read(params);
  if (!view) notFound();
  const streak = view.kind === "streak" || view.kind === "region-streak";
  return (
    <div className="mx-auto max-w-xl space-y-6 py-4">
      <Card className="overflow-hidden" data-testid="geo-result-page">
        <div className="relative">
          <img src={view.map.thumb} alt={`Map of ${view.map.name}`} className="h-48 w-full object-cover opacity-80" />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-6 text-center">
            <p className="hud-label text-screen">A trainer shared their result</p>
            <p className="mt-2 font-display text-lg font-semibold uppercase tracking-wide text-muted-foreground">{view.eyebrow.replace("PokéGuessr · ", "")}</p>
            <h1 className="mt-1 font-display text-5xl font-bold uppercase tabular-nums tracking-tight sm:text-6xl" data-testid="geo-result-headline">
              {view.headline}
            </h1>
          </div>
        </div>
        <CardContent className="space-y-6 p-6 text-center">
          <p className="text-muted-foreground">{view.detail}</p>
          {view.players ? (
            <div className="space-y-2 text-left">
              {view.players.map((p) => (
                <div key={p.name} className={cn("flex items-center gap-3 rounded-md border px-3 py-2", p.winner && "border-success/60 bg-success/10")}>
                  {p.winner && <Crown className="h-4 w-4 text-success" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate font-display text-lg font-bold uppercase">{p.name}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{fmt(p.hp)} HP</span>
                  <span className="text-lg" aria-hidden>
                    {p.scores.map(guessrSquare).join("")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-3xl leading-none" aria-label={streak ? `${view.total} in a row` : `${view.rounds.length} rounds`}>
                {streak ? `${"✅".repeat(Math.min(view.total, 20))}${view.total > 20 ? "…" : ""}❌` : view.rounds.map(guessrSquare).join("")}
              </p>
              {!streak && <p className="font-pixel text-[10px] text-muted-foreground">{view.rounds.map(fmt).join(" · ")}</p>}
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {view.chips.map((c) => (
              <span key={c} className="rounded-sm border bg-shade/20 px-2 py-1 font-pixel text-[10px] uppercase">
                {c}
              </span>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">Think you can beat it? Free, no sign-up, right in your browser.</p>
          <Link href={view.playHref} className={cn(buttonVariants({ size: "lg" }), "h-14 w-full text-base")} data-testid="share-play">
            <Play className="h-5 w-5" aria-hidden /> {view.playLabel}
          </Link>
          <Link href="/guessr" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
            All PokéGuessr modes
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
