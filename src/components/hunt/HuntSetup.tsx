"use client";

import { useState } from "react";
import Link from "@/components/ui/Link";
import { ArrowLeft, CalendarDays, Globe2, Loader2, Map as MapIcon, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/i18n/format";
import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";
import geoNamesNs from "@/messages/geo-names";
import { HUNT_MAP_REGIONS, type HuntMapRegionId, type HuntMode } from "@/lib/hunt/types";

export interface HuntSetupProps {
  onStart: (spec: { mode: HuntMode; region?: HuntMapRegionId }) => void;
  busy: boolean;
  error?: string | null;
  daily: { number: number; played: { score: number } | null };
}

/** The Hunt's first screen: pick Classic, a region, or the Daily. Presentation: owned by hunt design. */
export function HuntSetup({ onStart, busy, error, daily }: HuntSetupProps) {
  const t = useT(huntNs);
  const names = useT(geoNamesNs);
  const [mode, setMode] = useState<HuntMode>("classic");
  const [region, setRegion] = useState<HuntMapRegionId>("kanto");
  const regionName = (id: HuntMapRegionId) => names(`regions.${id}`);
  const modes: { id: HuntMode; icon: React.ReactNode; title: string; blurb: string }[] = [
    { id: "classic", icon: <Globe2 className="h-5 w-5" aria-hidden />, title: t("setup.classic"), blurb: t("setup.classicBlurb") },
    { id: "region", icon: <MapIcon className="h-5 w-5" aria-hidden />, title: t("setup.region"), blurb: t("setup.regionBlurb") },
    { id: "daily", icon: <CalendarDays className="h-5 w-5" aria-hidden />, title: t("setup.daily", { n: daily.number }), blurb: daily.played ? t("setup.dailyPlayed", { score: formatNumber(daily.played.score, t.locale) }) : t("setup.dailyBlurb") },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="hunt-setup">
      <Link href="/pokeguessr" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t("setup.back")}
      </Link>
      <div className="space-y-2">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("setup.eyebrow")}</p>
        <h1 className="font-display text-4xl font-bold uppercase italic">{t.rich("setup.title", { b: (c) => <span className="text-success">{c}</span> })}</h1>
        <p className="max-w-prose text-muted-foreground">{t("setup.intro")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => setMode(m.id)}
            data-testid={`hunt-mode-${m.id}`}
            className={cn("flex flex-col gap-1.5 rounded-lg border bg-card p-4 text-left transition-colors", mode === m.id ? "border-success ring-2 ring-success/40" : "hover:border-success/50")}
          >
            <span className="flex items-center gap-2 font-display text-lg font-bold uppercase">
              {m.icon}
              {m.title}
            </span>
            <span className="text-sm text-muted-foreground">{m.blurb}</span>
          </button>
        ))}
      </div>
      {mode === "region" && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="font-display text-sm font-semibold uppercase tracking-wider">{t("setup.pickRegion")}</p>
            <div className="flex flex-wrap gap-2">
              {HUNT_MAP_REGIONS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRegion(id)}
                  aria-pressed={region === id}
                  data-testid={`hunt-region-${id}`}
                  className={cn("rounded-md border px-3 py-1.5 text-sm font-semibold", region === id ? "border-success bg-success/15" : "hover:border-success/50")}
                >
                  {regionName(id)}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm" role="alert">
          {error}
        </p>
      )}
      <Button variant="success" size="lg" className="w-full sm:w-auto" disabled={busy} onClick={() => onStart(mode === "region" ? { mode, region } : { mode })} data-testid="hunt-start">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        {t("setup.start")}
      </Button>
    </div>
  );
}
