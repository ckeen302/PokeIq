"use client";

import { ArrowLeft, ArrowRight, CalendarDays, ChevronDown, Crosshair, Globe2, Loader2, MapPinned, Sparkles, Trophy } from "lucide-react";
import Link from "@/components/ui/Link";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { artUrl, boardArtUrl } from "@/lib/pokemon/art";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import huntNs from "@/messages/hunt";
import { HubSection, HubTile, TileFlag } from "@/components/geo/HubParts";
import { WORLD_THUMB } from "@/components/geo/GeoMap";
import { useGeoNames } from "@/lib/geo-i18n-client";

export type HuntMode = "classic" | "region" | "daily";

/** The Pokémon on the entry banner: three famous, memorable finds. */
const BANNER_ART = [143, 131, 150];

/** Each region's three starters: the Region Hunt card shows the picked region's. */
const STARTERS: Record<string, number[]> = {
  kanto: [1, 4, 7],
  johto: [152, 155, 158],
  hoenn: [252, 255, 258],
  sinnoh: [387, 390, 393],
  unova: [495, 498, 501],
  kalos: [650, 653, 656],
  alola: [722, 725, 728],
  galar: [810, 813, 816],
  paldea: [906, 909, 912],
};

/** Three Pokémon peeking over a hub card's map, the middle one a little lower, rising on hover like the entry banner's. */
function CardArt({ ids }: { ids: number[] }) {
  return (
    <div className="flex h-full items-end pb-1">
      {ids.map((id, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- the site's own art
        <img
          key={id}
          src={artUrl(id, 256)}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn("h-[78%] w-auto object-contain drop-shadow-[0_6px_10px_rgba(0,0,0,0.55)] transition-transform duration-300 group-hover:-translate-y-1", i > 0 && "-ml-[6%]", i === 1 && "h-[66%]")}
          style={{ transitionDelay: `${i * 40}ms` }}
        />
      ))}
    </div>
  );
}

/** Today's Pokémon stay a secret until you play: a big question mark over the map. */
function MysteryArt() {
  return (
    <span className="mb-2 mr-4 font-display text-7xl font-bold leading-none text-warning drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)] transition-transform duration-300 group-hover:-translate-y-1 sm:text-8xl">
      ?
    </span>
  );
}

/**
 * The entry on PokéGuessr's hub (the one change to its screens): a wide
 * banner over the Play tiles, three famous Pokémon peeking in, the mode's
 * pitch and the way in.
 */
export function HuntHubBanner({ href, className }: { href: string; className?: string }) {
  const t = useT(huntNs);
  return (
    <Link
      href={href}
      className={cn("group relative flex items-center gap-4 overflow-hidden rounded-lg border border-primary/40 bg-card p-4 shadow-sm transition-colors hover:border-primary/70 sm:p-5", className)}
      data-testid="hunt-hub-entry"
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/20 via-primary/5 to-transparent" aria-hidden />
      <div className="relative min-w-0 flex-1 space-y-1">
        <p className="hud-label flex items-center gap-2 text-primary">
          <Crosshair className="h-3.5 w-3.5" aria-hidden />
          {t("tile.label")}
          <TileFlag tone="success">{t("tile.new")}</TileFlag>
        </p>
        <p className="font-display text-2xl font-bold uppercase leading-tight sm:text-3xl">{t("tile.title")}</p>
        <p className="text-sm text-muted-foreground">{t("tile.blurb")}</p>
        <span className="mt-2 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))] transition-[filter] group-hover:brightness-110">
          {t("tile.play")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <div className="relative -my-2 hidden h-28 shrink-0 items-end sm:flex md:h-32" aria-hidden>
        {BANNER_ART.map((id, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- static board art
          <img
            key={id}
            src={boardArtUrl(id)}
            alt=""
            loading="lazy"
            className={cn("h-full w-auto object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:-translate-y-1", i > 0 && "-ml-6 md:-ml-8", i === 1 && "h-[88%]", i === 2 && "h-[94%] max-md:hidden")}
            style={{ transitionDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
    </Link>
  );
}

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

      <HubSection id="hunt-modes" eyebrow={t("hub.modesEyebrow")} title={t("hub.modes")}>
        <div className="grid gap-4 md:grid-cols-3">
          <HubTile
            testId="hunt-daily-card"
            className="max-md:order-first"
            tone="warning"
            priority
            image={WORLD_THUMB}
            art={<MysteryArt />}
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
            image={WORLD_THUMB}
            art={<CardArt ids={BANNER_ART} />}
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
            art={picked && STARTERS[picked.id] ? <CardArt key={picked.id} ids={STARTERS[picked.id]} /> : undefined}
            icon={<MapPinned className="h-5 w-5" />}
            label={t("hub.region.label")}
            title={t("hub.region.title")}
            blurb={t("hub.region.blurb")}
            stat={stat("region")}
            action={
              <div className="flex gap-2">
                <label className="relative shrink-0">
                  <span className="sr-only">{t("hub.region.pick")}</span>
                  <select
                    value={picked?.id}
                    onChange={(e) => onRegion(e.target.value)}
                    disabled={!!busy}
                    className="tap h-10 appearance-none rounded-md border border-success/50 bg-card pl-3 pr-8 font-display text-sm font-semibold uppercase tracking-wider text-foreground transition-colors hover:border-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success disabled:opacity-60"
                    data-testid="hunt-region-picker"
                  >
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {names.map(r)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                </label>
                <Button variant="success" className="min-w-0 flex-1" disabled={!picked || !!busy} onClick={() => onPlay("region")} data-testid="hunt-play-region">
                  {spin("region", <MapPinned className="h-4 w-4" aria-hidden />)}
                  <span className="truncate">{t("hub.region.play", { region: picked ? names.map(picked) : "" })}</span>
                </Button>
              </div>
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
