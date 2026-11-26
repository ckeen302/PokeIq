"use client";

import { CalendarDays, Crosshair, Globe2, Loader2, Play } from "lucide-react";
import { WORLD_REGION, type GeoRegionInfo } from "@/lib/geo-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import huntNs from "@/messages/hunt";
import { useGeoNames } from "@/lib/geo-i18n-client";
import { HUNT_DIFFICULTIES, type HuntDifficulty } from "@/lib/hunt/types";
import { HuntBoardList, type HuntBoardState } from "./HuntBoard";

/** What the setup's Play starts: today's Daily, or a free hunt on the picked map and difficulty. */
export type HuntPlay = "daily" | "free";

/**
 * Pokémon Hunt's setup, opened in place on PokéGuessr's landing by the Pokémon Hunt tile (as Classic's
 * tile opens the solo setup), and shown on /pokeguessr/hunt for old and shared links. The Daily Hunt
 * with today's board beside it; then a free hunt: the map (the world or a region), the difficulty, and
 * Play. Hard is always the world map.
 */
export function HuntSetup({
  id = "hunt",
  maps,
  map,
  onMap,
  difficulty,
  onDifficulty,
  onPlay,
  busy,
  daily,
  best,
  board,
  error,
  className,
}: {
  id?: string;
  /** The world, then the regions a hunt can be played on. */
  maps: GeoRegionInfo[];
  /** The picked map's id ("world", "kanto"). */
  map: string;
  onMap: (id: string) => void;
  difficulty: HuntDifficulty;
  onDifficulty: (d: HuntDifficulty) => void;
  onPlay: (what: HuntPlay) => void;
  /** A hunt is starting: its button spins and the others wait. */
  busy?: HuntPlay | null;
  /** Today's Daily Hunt: its number, and the score once it's been played here. */
  daily: { n: number; score?: number } | null;
  /** The best total for the picked map and difficulty. */
  best?: number;
  board: HuntBoardState;
  error?: string | null;
  className?: string;
}) {
  const t = useT(huntNs);
  const names = useGeoNames();
  const fmt = (n: number) => formatNumber(n, t.locale);
  const hard = difficulty === "hard";
  const picked = maps.find((m) => m.id === (hard ? WORLD_REGION : map)) ?? maps[0];
  const spin = (what: HuntPlay, icon: React.ReactNode) => (busy === what ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon);
  const played = daily?.score !== undefined;
  const radio = (on: boolean, tone: "screen" | "success" = "screen") =>
    cn(
      "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40",
      on ? (tone === "success" ? "border-success bg-success/15 text-foreground" : "border-screen bg-screen/15 text-foreground") : "bg-card text-muted-foreground enabled:hover:border-screen/50 enabled:hover:text-foreground"
    );

  return (
    <Card id={id} className={cn("scroll-mt-24", className)} data-testid="hunt-setup">
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 font-display text-xl font-bold uppercase">
              <Crosshair className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              {t("setup.heading")}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("setup.tagline")}</p>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="hunt-setup-error">
            {error}
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          {/* The Daily Hunt, and today's board when there is one. */}
          <section className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/[0.06] p-4" data-testid="hunt-daily-card" aria-labelledby={`${id}-daily`}>
            <div>
              <p className="hud-label flex items-center gap-1.5 text-warning">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                {daily ? t("setup.daily.label", { n: daily.n }) : t("setup.daily.title")}
              </p>
              <h4 id={`${id}-daily`} className="mt-1 font-display text-lg font-bold uppercase">
                {t("setup.daily.title")}
              </h4>
              <p className="mt-0.5 text-sm text-muted-foreground">{played ? t("setup.daily.scored", { score: fmt(daily!.score!) }) : t("setup.daily.blurb")}</p>
            </div>
            <Button variant={played ? "outline" : "default"} className="w-full" disabled={!daily || !!busy} onClick={() => onPlay("daily")} data-testid="hunt-play-daily">
              {spin("daily", <CalendarDays className="h-4 w-4" aria-hidden />)}
              {played ? t("setup.daily.again") : t("setup.daily.play")}
            </Button>
            {board.status === "ready" && <HuntBoardList rows={board.rows} className="border-t border-warning/25 pt-3" />}
          </section>

          {/* A free hunt: the map, the difficulty, Play. */}
          <section className="flex flex-col gap-4 rounded-lg border p-4" aria-labelledby={`${id}-free`} data-testid="hunt-free">
            <h4 id={`${id}-free`} className="sr-only">
              {t("setup.free")}
            </h4>
            <div className="space-y-1.5">
              <p className="hud-label">{t("setup.map")}</p>
              <div className="flex flex-wrap gap-1.5 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4 max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&>*]:shrink-0" role="radiogroup" aria-label={t("setup.map")} data-testid="hunt-map-picker">
                {maps.map((m) => (
                  <button key={m.id} type="button" role="radio" aria-checked={m.id === picked.id} disabled={hard && m.id !== WORLD_REGION} onClick={() => onMap(m.id)} className={radio(m.id === picked.id)} data-map={m.id}>
                    {m.id === WORLD_REGION && <Globe2 className="h-3.5 w-3.5" aria-hidden />}
                    {names.map(m)}
                  </button>
                ))}
              </div>
              {hard && <p className="text-xs text-muted-foreground">{t("setup.hardWorld")}</p>}
            </div>

            <div className="space-y-1.5">
              <p className="hud-label">{t("setup.difficulty")}</p>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("setup.difficulty")} data-testid="hunt-difficulty">
                {HUNT_DIFFICULTIES.map((d) => (
                  <button key={d} type="button" role="radio" aria-checked={d === difficulty} onClick={() => onDifficulty(d)} className={cn(radio(d === difficulty, "success"), "justify-center py-2 text-[13px]")} data-difficulty={d}>
                    {t(`setup.level.${d}`)}
                  </button>
                ))}
              </div>
              <p className="text-sm text-muted-foreground" data-testid="hunt-difficulty-blurb">
                {t(`setup.blurb.${difficulty}`)}
              </p>
            </div>

            <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
              {best !== undefined ? <p className="font-display text-sm font-semibold text-muted-foreground">{t("setup.best", { score: fmt(best) })}</p> : <span />}
              <Button variant="success" size="lg" className="max-sm:w-full" disabled={!!busy} onClick={() => onPlay("free")} data-testid="hunt-play">
                {spin("free", <Play className="h-4 w-4 fill-current" aria-hidden />)}
                {picked.id === WORLD_REGION ? t("setup.play") : t("setup.playOn", { map: names.map(picked) })}
              </Button>
            </div>
          </section>
        </div>

        <p className="text-xs text-muted-foreground">{t("setup.how")}</p>
      </CardContent>
    </Card>
  );
}
