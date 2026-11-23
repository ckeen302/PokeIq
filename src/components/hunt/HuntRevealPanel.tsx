"use client";

import Link from "@/components/ui/Link";
import { ArrowRight, BookOpen, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/i18n/format";
import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";
import geoNamesNs from "@/messages/geo-names";
import { HUNT_MAX_ROUND_SCORE, HUNT_REGIONS, type HuntReveal } from "@/lib/hunt/types";

export interface HuntRevealPanelProps {
  reveal: HuntReveal;
  score: number;
  /** The round just played (0-based). */
  index: number;
  rounds: number;
  onNext: () => void;
  last: boolean;
}

/** The round's answer under the map: points, regions found, every real spot with its games and methods, a fact, the Pokédex link. Presentation: owned by hunt design. */
export function HuntRevealPanel({ reveal, score, onNext, last }: HuntRevealPanelProps) {
  const t = useT(huntNs);
  const names = useT(geoNamesNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const regions = HUNT_REGIONS.filter((r) => reveal.spots.some((s) => s.region === r));
  return (
    <div className="mx-auto grid max-w-6xl gap-3 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-center md:gap-6" data-testid="hunt-reveal">
      <div className="min-w-0 text-center md:text-left">
        <p className="hud-label" data-testid="hunt-found">
          {t("reveal.found", { found: reveal.found, of: reveal.of })}
        </p>
        <p className="font-display text-4xl font-bold italic tabular-nums" data-testid="hunt-round-score">
          {t("reveal.points", { score: fmt(score) })}
        </p>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[#9be15d] transition-[width] duration-700" style={{ width: `${(score / HUNT_MAX_ROUND_SCORE) * 100}%` }} />
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-sm text-white/85">{reveal.fact}</p>
        <details className="group rounded-md bg-white/5 px-3 py-2 text-sm" open>
          <summary className="cursor-pointer font-display text-xs font-semibold uppercase tracking-wider text-[#c8bfff]">{t("reveal.spots")}</summary>
          <ul className="mt-2 max-h-36 space-y-2 overflow-y-auto pr-1">
            {regions.map((r) => (
              <li key={r}>
                <p className="font-display text-xs font-bold uppercase tracking-wider text-white/60">{names(`regions.${r}`)}</p>
                <ul className="space-y-1">
                  {reveal.spots
                    .filter((s) => s.region === r)
                    .map((s) => (
                      <li key={s.name} className="flex gap-1.5" data-testid="hunt-spot">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ffd23c]" aria-hidden />
                        <span>
                          <span className="font-semibold">{s.name}</span>
                          <span className="text-white/60"> · {s.labels.join("; ")}</span>
                        </span>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
        <Link href={reveal.dex} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#9be15d] hover:underline" data-testid="hunt-dex-link">
          <BookOpen className="h-4 w-4" aria-hidden /> {t("reveal.dex")}
        </Link>
      </div>
      <Button variant="success" size="lg" onClick={onNext} data-testid="hunt-next" autoFocus>
        {last ? t("reveal.results") : t("reveal.next")} <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
