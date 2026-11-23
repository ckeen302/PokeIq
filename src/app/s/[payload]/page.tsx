import Link from "@/components/ui/Link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Play } from "lucide-react";
import { decodeShare, describeShare } from "@/lib/share";
import { pageMetadata } from "@/lib/seo";
import { ShareBoard } from "@/components/share/ShareBoard";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getLocale, serverT } from "@/i18n/server";
import type { Locale } from "@/i18n/config";
import share from "@/messages/share";
import sharePage from "@/messages/share-page";
import jaRegions from "@/data/i18n/ja/regions.json";
import esRegions from "@/data/i18n/es/regions.json";
import frRegions from "@/data/i18n/fr/regions.json";
import deRegions from "@/data/i18n/de/regions.json";
import itRegions from "@/data/i18n/it/regions.json";

/**
 * /s/<payload>: a shared result. The payload is the result itself (see
 * lib/share/payload): decoded, validated and rendered as text here and on
 * the preview card beside this page, with a big way in to today's game.
 */

/** Region names in each language (official names, src/data/i18n): read here, on the server only. */
const REGIONS: Partial<Record<Locale, Record<string, string>>> = { ja: jaRegions, es: esRegions, fr: frRegions, de: deRegions, it: itRegions };

interface PageProps {
  params: Promise<{ payload: string }>;
}

async function read(params: PageProps["params"]) {
  let raw: string;
  try {
    raw = decodeURIComponent((await params).payload);
  } catch {
    return null;
  }
  const result = decodeShare(raw);
  const regions = REGIONS[getLocale()];
  return result ? describeShare(result, { t: serverT(share), tp: serverT(sharePage), region: (id) => regions?.[id] }) : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const view = await read(params);
  const t = serverT(sharePage);
  if (!view) return { title: t("meta.fallbackTitle"), robots: { index: false } };
  // No canonical path, kept out of search; the picture is this segment's opengraph-image.
  return pageMetadata({ title: view.title, description: view.description, socialTitle: t("meta.socialTitle", { title: view.title }), noindex: true, url: `/s/${encodeURIComponent((await params).payload)}` });
}

export default async function SharedResultPage({ params }: PageProps) {
  const view = await read(params);
  if (!view) notFound();
  const t = serverT(sharePage);
  return (
    <div className="mx-auto max-w-xl space-y-6 py-4">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/20 via-transparent to-transparent p-6 text-center">
          <p className="hud-label text-screen">{t("page.eyebrow")}</p>
          <p className="mt-2 font-display text-lg font-semibold uppercase tracking-wide text-muted-foreground">{view.label}</p>
          <h1 className="mt-1 font-display text-6xl font-bold uppercase tabular-nums tracking-tight">{view.headline}</h1>
          <p className="mt-1 text-muted-foreground">{view.detail}</p>
        </div>
        <CardContent className="space-y-6 p-6 text-center">
          {view.tiles.length > 0 && (
            <div className="flex justify-center">
              <ShareBoard tiles={view.tiles} numbers={view.numbers} />
            </div>
          )}
          {view.chips.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {view.chips.map((c) => (
                <span key={c} className="rounded-sm border bg-shade/20 px-2 py-1 font-pixel text-[10px] uppercase max-sm:rounded-full max-sm:px-3 max-sm:font-sans max-sm:text-xs max-sm:font-medium max-sm:normal-case">
                  {c}
                </span>
              ))}
            </div>
          )}
          <p className="text-sm text-muted-foreground">{t("page.beatIt")}</p>
          <Link href={view.playHref} className={cn(buttonVariants({ size: "lg" }), "h-14 w-full text-base max-sm:gap-2 max-sm:px-3 max-sm:tracking-wide")} data-testid="share-play">
            <Play className="h-5 w-5" aria-hidden /> {view.playLabel}
          </Link>
          <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
            {t("page.more")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
