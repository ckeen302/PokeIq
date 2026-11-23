"use client";

import { useState } from "react";
import { ArrowLeft, CalendarDays, Check, Globe2, Loader2, MapPinned, Play, Sparkles, Trophy } from "lucide-react";
import Link from "@/components/ui/Link";
import { HUNT_MAP_REGIONS, type HuntMapRegionId, type HuntMode } from "@/lib/hunt/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import huntNs from "@/messages/hunt";
import { HubSection, TileFlag } from "@/components/geo/HubParts";
import { WORLD_THUMB } from "@/components/geo/GeoMap";
import { useHuntRegionName } from "./hunt-ui";
import { boardArtUrl } from "@/lib/pokemon/art";

const MODES: { mode: HuntMode; tone: string; ring: string; wash: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { mode: "daily", tone: "text-warning", ring: "border-warning ring-warning/40", wash: "from-warning/30", icon: CalendarDays },
  { mode: "classic", tone: "text-screen", ring: "border-screen ring-screen/40", wash: "from-screen/30", icon: Globe2 },
  { mode: "region", tone: "text-success", ring: "border-success ring-success/40", wash: "from-success/30", icon: MapPinned },
];

/**
 * Pokémon Hunt's hub and mode picker, in PokéGuessr's hub style: the title,
 * three mode cards to pick from (Daily Hunt, Classic, Region Hunt), then one
 * start panel for the picked mode (Region Hunt shows its region chips and
 * that region's map there), and how it works.
 */
export function HuntSetup({ onStart, busy, error, daily }: {
  onStart: (spec: { mode: HuntMode; region?: HuntMapRegionId }) => void;
  busy: boolean;
  error?: string | null;
  daily: { number: number; played: { score: number } | null };
}) {
  const t = useT(huntNs);
  const regionName = useHuntRegionName();
  const fmt = (n: number) => formatNumber(n, t.locale);
  const [mode, setMode] = useState<HuntMode>(daily.played ? "classic" : "daily");
  const [region, setRegion] = useState<HuntMapRegionId>("kanto");
  const played = daily.played;

  const label = (m: HuntMode) => (m === "daily" ? t("hub.daily.label", { n: daily.number }) : t(`hub.${m}.label`));
  const blurb = (m: HuntMode) => (m === "daily" && played ? t("hub.daily.scored", { score: fmt(played.score) }) : t(`hub.${m}.blurb`));
  const banner = (m: HuntMode) => (m === "region" ? `/geo/maps/${region}.webp` : m === "daily" ? WORLD_THUMB : null);
  const startLabel = mode === "daily" ? (played ? t("hub.daily.again") : t("hub.daily.play")) : mode === "region" ? t("hub.region.play", { region: regionName(region) }) : t("hub.classic.play");

  // Arrow keys move through the mode cards, as in any radio group.
  const onKey = (e: React.KeyboardEvent) => {
    const i = MODES.findIndex((m) => m.mode === mode);
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = MODES[(i + d + MODES.length) % MODES.length].mode;
    setMode(next);
    (e.currentTarget.querySelector(`[data-testid="hunt-mode-${next}"]`) as HTMLElement | null)?.focus();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-10" data-testid="hunt-setup">
      <div className="relative space-y-3 text-center">
        <Link href="/pokeguessr" className="tap inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground md:absolute md:left-0 md:top-0" data-testid="hunt-back">
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          {t("hub.back")}
        </Link>
        <p className="hud-label text-screen max-md:hidden">{t("hub.eyebrow")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-6xl">{t.rich("hub.title", { b: (c) => <span className="text-primary">{c}</span> })}</h1>
        <p className="mx-auto max-w-xl text-muted-foreground">{t("hub.tagline")}</p>
      </div>

      {error && (
        <p role="alert" className="text-center text-sm text-destructive" data-testid="hunt-setup-error">
          {error}
        </p>
      )}

      <HubSection id="hunt-modes" eyebrow={t("hub.modesEyebrow")} title={t("hub.modes")}>
        <div className="grid gap-4 md:grid-cols-3" role="radiogroup" aria-label={t("hub.modes")} onKeyDown={onKey}>
          {MODES.map(({ mode: m, tone, ring, wash, icon: Icon }) => {
            const on = m === mode;
            const img = banner(m);
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => setMode(m)}
                data-testid={`hunt-mode-${m}`}
                className={cn(
                  "group flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-left shadow-sm outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
                  on ? `${ring} ring-2` : "hover:border-foreground/30"
                )}
              >
                <span className={cn("relative block aspect-[16/6] w-full overflow-hidden bg-gradient-to-br to-transparent sm:aspect-[16/7]", wash)}>
                  {img && (
                    // eslint-disable-next-line @next/next/no-img-element -- the map's own preview
                    <img src={img} alt="" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-80 transition-[opacity,transform] duration-300 group-hover:scale-[1.03] group-hover:opacity-100" />
                  )}
                  {m === "classic" && (
                    // Classic: a line-up of famous finds on the world's tint.
                    <span className="absolute inset-x-0 bottom-0 top-[8%] flex items-end justify-center" aria-hidden>
                      {[143, 131, 150].map((id, i) => (
                        // eslint-disable-next-line @next/next/no-img-element -- static board art
                        <img key={id} src={boardArtUrl(id)} alt="" decoding="async" className={cn("h-full w-auto object-contain drop-shadow-[0_6px_10px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:-translate-y-1", i > 0 && "-ml-5", i === 1 && "h-[84%]")} />
                      ))}
                    </span>
                  )}
                  <span className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" aria-hidden />
                  <span className={cn("absolute bottom-2 left-3 flex h-9 w-9 items-center justify-center rounded-md border bg-card/90 backdrop-blur", tone)} aria-hidden>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="absolute right-2 top-2 flex items-center gap-1.5">
                    {m === "daily" && played && <TileFlag tone="success">{t("hub.daily.played")}</TileFlag>}
                    <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors", on ? "border-transparent bg-success text-success-foreground" : "border-foreground/30 bg-card/70")} aria-hidden>
                      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                  </span>
                </span>
                <span className="flex flex-1 flex-col gap-2 p-4 pt-3">
                  <span className={cn("hud-label", tone)}>{label(m)}</span>
                  <span className="font-display text-xl font-bold uppercase leading-tight">{t(`hub.${m}.title`)}</span>
                  <span className="text-sm text-muted-foreground">{blurb(m)}</span>
                </span>
              </button>
            );
          })}
        </div>

        <Card data-testid="hunt-start-panel">
          <CardContent className="flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-display text-lg font-bold uppercase">{t(`hub.${mode}.title`)}</p>
              {mode === "region" ? (
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("hub.region.pick")}>
                  {HUNT_MAP_REGIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={r === region}
                      onClick={() => setRegion(r)}
                      data-testid={`hunt-region-${r}`}
                      className={cn(
                        "tap rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
                        r === region ? "border-success bg-success/15 text-foreground" : "bg-card text-muted-foreground hover:border-success/50 hover:text-foreground"
                      )}
                    >
                      {regionName(r)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t(`hub.${mode}.more`)}</p>
              )}
            </div>
            <Button size="lg" variant={mode === "region" ? "success" : "default"} className="w-full shrink-0 md:w-auto md:min-w-[14rem]" disabled={busy} onClick={() => onStart(mode === "region" ? { mode, region } : { mode })} data-testid="hunt-start">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4 shrink-0" aria-hidden />}
              {startLabel}
            </Button>
          </CardContent>
        </Card>
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
