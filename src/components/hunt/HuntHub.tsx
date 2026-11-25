"use client";

import { ArrowLeft, CalendarDays, Crosshair, Globe2, Loader2, MapPinned, Sparkles, Trophy } from "lucide-react";
import Link from "@/components/ui/Link";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import huntNs from "@/messages/hunt";
import { HubSection, HubTile, TileFlag } from "@/components/geo/HubParts";
import { WORLD_THUMB } from "@/components/geo/GeoMap";
import { useGeoNames } from "@/lib/geo-i18n-client";

export type HuntMode = "classic" | "region" | "daily";

/**
 * Pokémon Hunt's own hub, PokéGuessr's look: the title, the three ways to
 * play (Daily Hunt, Classic and Region Hunt with its region picker) and how
 * it works. Props-driven: the game starts the mode it's handed.
 */
export function HuntHub({
  regions,
  region,
  onRegion,
  onPlay,
  busy,
  daily,
  best,
  error,
  hubHref = "/pokeguessr",
}: {
  /** The regions a Region Hunt can be played in (the world map is Classic's). */
  regions: GeoRegionInfo[];
  /** The region picked for Region Hunt. */
  region: string;
  onRegion: (id: string) => void;
  onPlay: (mode: HuntMode) => void;
  /** A mode is starting: its button spins and the others wait. */
  busy?: HuntMode | null;
  /** Today's Daily Hunt: its number, and the score if it's been played (resume: part played). */
  daily?: { n: number; score?: number; resume?: boolean } | null;
  /** Best totals by mode. */
  best?: Partial<Record<HuntMode, number>>;
  error?: string | null;
  hubHref?: string;
}) {
  const t = useT(huntNs);
  const names = useGeoNames();
  const fmt = (n: number) => formatNumber(n, t.locale);
  const picked = regions.find((r) => r.id === region) ?? regions[0];
  const spin = (m: HuntMode, icon: React.ReactNode) => (busy === m ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon);
  const stat = (m: HuntMode) => (best?.[m] !== undefined ? t("hub.best", { score: fmt(best[m]!) }) : null);
  return (
    <div className="mx-auto max-w-6xl space-y-12" data-testid="hunt-hub">
      <div className="relative space-y-3 text-center">
        <Link href={hubHref} className="tap absolute left-0 top-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground max-md:static max-md:mb-2" data-testid="hunt-back">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t("hub.back")}
        </Link>
        <p className="hud-label text-screen max-md:hidden">{t("hub.eyebrow")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-6xl">{t.rich("hub.title", { b: (c) => <span className="text-primary">{c}</span> })}</h1>
        <p className="mx-auto max-w-xl text-muted-foreground">{t("hub.tagline")}</p>
      </div>

      {error && (
        <p role="alert" className="text-center text-sm text-destructive" data-testid="hunt-hub-error">
          {error}
        </p>
      )}

      <HubSection id="hunt-modes" eyebrow={t("name")} title={t("hub.modes")}>
        <div className="grid gap-4 md:grid-cols-3">
          <HubTile
            testId="hunt-daily-card"
            className="max-md:order-first"
            tone="warning"
            priority
            image={WORLD_THUMB}
            icon={<CalendarDays className="h-5 w-5" />}
            label={daily ? t("hub.daily.label", { n: daily.n }) : t("hub.daily.title")}
            title={t("hub.daily.title")}
            badge={daily?.score !== undefined ? <TileFlag tone="success">{t("hub.daily.played")}</TileFlag> : undefined}
            blurb={daily?.score !== undefined ? t("hub.daily.scored", { score: fmt(daily.score) }) : t("hub.daily.blurb")}
            action={
              <Button className="w-full" disabled={!daily || !!busy} onClick={() => onPlay("daily")} data-testid="hunt-play-daily">
                {spin("daily", <CalendarDays className="h-4 w-4" aria-hidden />)}
                {daily?.resume ? t("hub.daily.resume") : daily?.score !== undefined ? t("hub.daily.again") : t("hub.daily.play")}
              </Button>
            }
          />
          <HubTile
            testId="hunt-classic-card"
            tone="screen"
            image={null}
            icon={<Globe2 className="h-5 w-5" />}
            label={t("hub.classic.label")}
            title={t("hub.classic.title")}
            blurb={t("hub.classic.blurb")}
            stat={stat("classic")}
            action={
              <Button variant="outline" className="w-full" disabled={!!busy} onClick={() => onPlay("classic")} data-testid="hunt-play-classic">
                {spin("classic", <Crosshair className="h-4 w-4" aria-hidden />)}
                {t("hub.classic.play")}
              </Button>
            }
          />
          <HubTile
            testId="hunt-region-card"
            tone="success"
            image={picked?.map.src ?? null}
            icon={<MapPinned className="h-5 w-5" />}
            label={t("hub.region.label")}
            title={t("hub.region.title")}
            blurb={
              <div className="space-y-2">
                <p>{t("hub.region.blurb")}</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("hub.region.pick")} data-testid="hunt-region-picker">
                  {regions.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={r.id === picked?.id}
                      onClick={() => onRegion(r.id)}
                      className={cn(
                        "tap rounded-md border px-2.5 py-1 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
                        r.id === picked?.id ? "border-success bg-success/15 text-foreground" : "bg-card text-muted-foreground hover:border-success/50 hover:text-foreground"
                      )}
                    >
                      {names.map(r)}
                    </button>
                  ))}
                </div>
              </div>
            }
            stat={stat("region")}
            action={
              <Button variant="success" className="w-full" disabled={!picked || !!busy} onClick={() => onPlay("region")} data-testid="hunt-play-region">
                {spin("region", <MapPinned className="h-4 w-4" aria-hidden />)}
                {t("hub.region.play", { region: picked ? names.map(picked) : "" })}
              </Button>
            }
          />
        </div>
      </HubSection>

      <HubSection id="hunt-how" eyebrow={t("name")} title={t("hub.how.title")}>
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: <Sparkles className="h-5 w-5" />, text: t("hub.how.see") },
            { icon: <MapPinned className="h-5 w-5" />, text: t("hub.how.pin") },
            { icon: <Trophy className="h-5 w-5" />, text: t("hub.how.score") },
          ].map((s, i) => (
            <li key={i} className="flex items-start gap-3 rounded-lg border bg-card p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-shade/30 text-screen" aria-hidden>
                {s.icon}
              </span>
              <p className="text-sm">
                <span className="mr-1.5 font-display font-bold text-primary">{i + 1}.</span>
                {s.text}
              </p>
            </li>
          ))}
        </ol>
      </HubSection>
    </div>
  );
}
