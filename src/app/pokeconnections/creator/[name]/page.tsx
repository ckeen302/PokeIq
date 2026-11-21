import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { customPath } from "@/lib/connections/custom";
import { CREATOR_NAME_RE } from "@/lib/connections/social";
import { creatorPage } from "@/lib/server/connections-creators";
import { Card, CardContent } from "@/components/ui/card";
import { INTL_LOCALE, formatNumber } from "@/i18n/catalog";
import { localizePath } from "@/i18n/paths";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/connections-pages";

export const dynamic = "force-dynamic";

// Trainers' own pages: playable and shareable, not for search engines.
export function generateMetadata(): Metadata {
  const t = serverT(pages);
  return {
    title: t("meta.creatorTitle"),
    description: t("meta.creatorDescription"),
    robots: { index: false, follow: false },
  };
}

/** /pokeconnections/creator/<name>: a creator's puzzles and their total votes. Titles and votes only, never a puzzle's groups. */
export default async function CreatorPage({ params }: { params: Promise<{ name: string }> }) {
  const t = serverT(pages);
  const locale = getLocale();
  const name = decodeURIComponent((await params).name);
  if (!CREATOR_NAME_RE.test(name)) notFound();
  const page = await creatorPage(name).catch((err) => {
    console.error("[connections] creator page unavailable:", err instanceof Error ? err.message : err);
    return "unavailable" as const;
  });
  if (!page) notFound();
  if (page === "unavailable") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <BackButton href="/pokeconnections/community" label={t("backCommunity")} />
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground" data-testid="creator-unavailable">
            {t("creator.unavailable")}
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
    <BackButton href="/pokeconnections/community" label={t("backCommunity")} />
      <div className="space-y-1">
        <p className="hud-label">{t("creator.eyebrow")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight" data-testid="creator-name">
          {page.name}
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="creator-totals">
          {t("creator.totals", { n: page.puzzles.length, votes: formatNumber(page.votes, locale), v: page.votes, score: `${page.score >= 0 ? "+" : ""}${page.score}` })}
        </p>
      </div>
      <ul className="space-y-2">
        {page.puzzles.map((p) => (
          <li key={p.id}>
            <a href={localizePath(customPath(p.id), locale)} className="flex items-center justify-between gap-3 rounded-md border border-foreground/15 bg-card px-4 py-3 hover:border-primary/60" data-testid="creator-puzzle">
              <span className="min-w-0">
                <span className="block truncate font-display font-bold">{p.title ?? t("creator.untitled")}</span>
                <span className="block text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString(INTL_LOCALE[locale], { month: "short", day: "numeric", year: "numeric" })}</span>
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
