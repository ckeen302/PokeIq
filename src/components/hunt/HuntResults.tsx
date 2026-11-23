"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Crown, LayoutGrid, RotateCcw } from "lucide-react";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { bestAndWorst } from "@/lib/geo-results";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import huntNs from "@/messages/hunt";
import { ExitButton, GameShell, Notch } from "@/components/geo/GameShell";
import { GeoMap } from "@/components/geo/GeoMap";
import type { HuntPokemonView } from "./HuntCard";
import { shortLabel, type HuntRevealPin, type HuntRevealSpot } from "./HuntReveal";
import { HUNT_ROUND_MAX } from "./hunt-ui";
import { formTagOf } from "./HuntCard";

export interface HuntResultRound {
  pokemon: HuntPokemonView;
  score: number;
  regionsFound: number;
  regionsTotal: number;
  spots: HuntRevealSpot[];
  pins: HuntRevealPin[];
}

/**
 * The end of a hunt, PokéGuessr's summary layout: the map (the round picked
 * in the list: its spots and the lines from its pins) beside the breakdown
 * panel: the total counting up, each round's Pokémon with its regions found
 * and score (best and worst lit), Hunt again and All hunts, then `children`
 * (the Daily's share grid, the leaderboard).
 */
export function HuntResults({ region, rounds, modeLine, onAgain, onHub, children }: {
  region: GeoRegionInfo;
  rounds: HuntResultRound[];
  modeLine: string;
  onAgain: () => void;
  onHub: () => void;
  children?: React.ReactNode;
}) {
  const t = useT(huntNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const scores = rounds.map((r) => r.score);
  const total = scores.reduce((a, b) => a + b, 0);
  const max = rounds.length * HUNT_ROUND_MAX;
  const { best, worst } = bestAndWorst(scores);
  const [focus, setFocus] = useState(best ?? 0);
  const headline = useCountUp(total);
  const r = rounds[focus] ?? rounds[0];
  return (
    <GameShell onExit={onHub}>
      {() => (
        <div className="flex h-full flex-col md:flex-row" data-testid="hunt-results">
          <div className="relative h-[40vh] shrink-0 md:h-full md:flex-1">
            {r && (
              <GeoMap
                key={focus}
                region={region}
                fill
                spots={r.spots.map((s, i) => ({ x: s.x, y: s.y, mask: s.mask, found: r.pins.some((p) => p.spot === i && (p.found ?? true)), tag: tagged(r).has(i) ? shortLabel(s.labels ?? [`${s.game} · ${s.method}`], t) : undefined }))}
                links={r.pins.map((p, i) => ({ pin: p.pin, spot: p.spot, n: i + 1 }))}
                fit={{ duration: 700 }}
              />
            )}
            <div className="geo-safe-tl absolute left-3 top-3 z-20">
              <ExitButton onClick={onHub} />
            </div>
            <Notch>
              <div className="text-center">
                <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">{t("results.title")}</div>
                <div className="mt-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{modeLine}</div>
              </div>
            </Notch>
            {r && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-md bg-black/60 py-1 pl-1 pr-3 text-white backdrop-blur" data-testid="hunt-results-focus">
                {/* eslint-disable-next-line @next/next/no-img-element -- the round's art, already cached */}
                <img src={r.pokemon.art} alt="" className="h-8 w-8 object-contain" />
                <span className="font-display text-sm font-bold uppercase italic">{r.pokemon.name}</span>
              </div>
            )}
          </div>

          <div className="geo-results-panel flex min-h-0 flex-1 flex-col overflow-y-auto border-t-4 border-[#a99cff] bg-background text-foreground md:w-[27rem] md:flex-none md:border-l-4 md:border-t-0" data-testid="hunt-results-panel">
            <div className="space-y-4 p-4 sm:p-5">
              <div className="text-center">
                <p className="hud-label text-screen">{t("results.total")}</p>
                <div className="geo-glow mt-1 font-display text-5xl font-bold italic tabular-nums text-foreground sm:text-6xl" data-testid="hunt-results-total">
                  {fmt(headline)}
                </div>
                <div className="text-sm text-muted-foreground">{t("results.outOf", { max: fmt(max) })}</div>
                <div className="meter mx-auto mt-2 max-w-xs !bg-black/40">
                  <motion.div className="h-full bg-[#9be15d]" initial={{ width: 0 }} animate={{ width: `${(total / max) * 100}%` }} transition={{ duration: 1.1 }} />
                </div>
              </div>

              <ol className="space-y-1.5" aria-label={t("results.rounds")}>
                {rounds.map((x, i) => {
                  const tag = i === best ? t("results.best") : i === worst ? t("results.worst") : null;
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => setFocus(i)}
                        onMouseEnter={() => setFocus(i)}
                        onFocus={() => setFocus(i)}
                        aria-pressed={focus === i}
                        aria-label={`${t("results.show", { n: i + 1 })}: ${x.pokemon.name}`}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md border bg-shade/20 px-2.5 py-1.5 text-left transition-colors hover:border-[#a99cff]/60",
                          i === best && "border-[#4cbb17]/60 bg-[#4cbb17]/10",
                          i === worst && "border-[#ff5a5a]/60 bg-[#ff5a5a]/10",
                          focus === i && "border-[#ffd23c] ring-1 ring-[#ffd23c]"
                        )}
                        data-testid={`hunt-results-round-${i + 1}`}
                      >
                        <span className="w-4 shrink-0 text-center font-pixel text-[9px] text-muted-foreground">{i + 1}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element -- the round's art, already cached */}
                        <img src={x.pokemon.art} alt="" className="h-11 w-11 shrink-0 object-contain" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{x.pokemon.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {formTagOf(t, x.pokemon) ? `${formTagOf(t, x.pokemon)} · ` : ""}
                            {t("results.regions", { found: x.regionsFound, total: x.regionsTotal })}
                          </span>
                        </span>
                        <span className="flex flex-col items-end">
                          <span className="font-display text-base font-bold tabular-nums">{fmt(x.score)}</span>
                          {tag && (
                            <span className={cn("flex items-center gap-1 font-pixel text-[9px] uppercase", i === best ? "text-success" : "text-destructive")}>
                              {i === best && <Crown className="h-3 w-3" aria-hidden />}
                              {tag}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button size="lg" variant="success" onClick={onAgain} data-testid="hunt-again">
                  <RotateCcw className="h-4 w-4 shrink-0" aria-hidden />
                  {t("results.again")}
                </Button>
                <Button size="lg" variant="outline" onClick={onHub} data-testid="hunt-hub">
                  <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
                  {t("results.hub")}
                </Button>
              </div>
            </div>
            {children && <div className="border-t px-4 pb-6 pt-4 sm:px-5">{children}</div>}
            <div className="h-[env(safe-area-inset-bottom)] shrink-0" aria-hidden />
          </div>
        </div>
      )}
    </GameShell>
  );
}

/** The spots the map tags: those the pins scored against, and the first of each region nobody found. */
function tagged(r: HuntResultRound): Set<number> {
  const out = new Set(r.pins.map((p) => p.spot));
  for (const region of new Set(r.spots.map((s) => s.region))) if (!r.pins.some((p) => r.spots[p.spot]?.region === region)) out.add(r.spots.findIndex((s) => s.region === region));
  return out;
}

function useCountUp(value: number, ms = 1100): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) return setShown(value);
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      start ||= now;
      const k = Math.min(1, (now - start) / ms);
      setShown(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, reduced]);
  return shown;
}
