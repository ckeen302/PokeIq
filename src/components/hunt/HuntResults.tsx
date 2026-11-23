"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Crown, LayoutGrid, RotateCcw } from "lucide-react";
import type { HuntResult } from "@/lib/hunt/types";
import { bestAndWorst } from "@/lib/geo-results";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import huntNs from "@/messages/hunt";
import { ExitButton, GameShell, Notch } from "@/components/geo/GameShell";
import { HuntShareGrid } from "./HuntShareGrid";
import { formKey, huntSquare } from "./hunt-ui";

const SCORE_TONE = { green: "text-[#9be15d]", yellow: "text-[#f5c542]", orange: "text-[#fb923c]", red: "text-[#ff6b6b]" } as const;

/**
 * The end of a hunt, PokéGuessr's results layout: on the left (on top on a
 * phone) the trophy shelf, the hunt's Pokémon side by side on the radar
 * with each one's score; on the right the breakdown panel in the site's
 * theme: the total counting up out of 25,000, each round's Pokémon with its
 * regions found and points (the best and the worst lit), Hunt again and All
 * hunts, and the Daily's share grid.
 */
export function HuntResults({ result, share, onAgain, daily, onHub }: {
  result: HuntResult;
  share: string | null;
  onAgain: () => void;
  daily?: { number: number };
  /** Back to the hunts' hub (default: /pokeguessr/hunt). */
  onHub?: () => void;
}) {
  const t = useT(huntNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const reduced = useReducedMotion();
  const scores = result.rounds.map((r) => r.score);
  const { best, worst } = bestAndWorst(scores);
  const headline = useCountUp(result.score);
  const hub = onHub ?? (() => window.location.assign("/pokeguessr/hunt"));
  const modeLine = daily ? t("hud.daily", { n: daily.number }) : t(`hub.${result.spec.mode}.title`);
  const formTag = (id: string) => {
    const f = formKey(id);
    return f && t.has(`forms.${f}`) ? t(`forms.${f}` as "forms.alola") : null;
  };
  return (
    <GameShell onExit={hub}>
      {() => (
        <div className="flex h-full flex-col md:flex-row" data-testid="hunt-results">
          {/* The trophy shelf. */}
          <div className="relative flex shrink-0 flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_55%,#2d2766_0%,#1a163a_50%,#0f0d1f_85%)] max-md:h-[36vh] md:flex-1">
            <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px]" aria-hidden />
            <div className="geo-safe-tl absolute left-3 top-3 z-20">
              <ExitButton onClick={hub} />
            </div>
            <Notch>
              <div className="text-center">
                <div className="whitespace-nowrap font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">{t("results.title")}</div>
                <div className="mt-0.5 whitespace-nowrap font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{modeLine}</div>
              </div>
            </Notch>
            <ol className="relative z-[1] mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-center justify-center gap-[1.5vw] overflow-x-auto px-4 pb-[4vh] pt-[5.5rem] max-md:justify-start max-md:pb-3 max-md:pt-[4.5rem] md:pt-[10vh]" aria-hidden>
              {result.rounds.map((r, i) => (
                <motion.li
                  key={r.id + i}
                  initial={reduced ? false : { opacity: 0, y: 24, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.4, delay: reduced ? 0 : 0.15 + i * 0.09, ease: [0.2, 0.8, 0.2, 1] }}
                  className="flex w-[min(17vw,11rem)] shrink-0 flex-col items-center text-center text-white max-md:w-[17vw]"
                >
                  <div className="relative flex aspect-square w-full items-center justify-center">
                    <div className={cn("absolute inset-[14%] rounded-full blur-2xl", i === best ? "bg-[#4cbb17]/40" : "bg-[#6c5ce7]/30")} />
                    {/* eslint-disable-next-line @next/next/no-img-element -- the round's art, already cached */}
                    <img src={r.art} alt="" className="relative h-full w-full object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.5)]" />
                    {i === best && <Crown className="absolute -top-1 right-1 h-6 w-6 text-[#ffd23c] drop-shadow max-md:h-4 max-md:w-4" />}
                  </div>
                  <p className="mt-1 w-full truncate font-display text-sm font-bold uppercase italic max-md:text-[11px]">{r.name}</p>
                  <p className={cn("font-display text-lg font-bold tabular-nums max-md:text-sm", SCORE_TONE[huntSquare(r.score)])}>{fmt(r.score)}</p>
                </motion.li>
              ))}
            </ol>
          </div>

          {/* The breakdown panel. */}
          <div className="geo-results-panel flex min-h-0 flex-1 flex-col overflow-y-auto border-t-4 border-[#a99cff] bg-background text-foreground md:w-[27rem] md:flex-none md:border-l-4 md:border-t-0" data-testid="hunt-results-panel">
            <div className="space-y-4 p-4 sm:p-5">
              <div className="text-center">
                <p className="hud-label text-screen">{t("results.total")}</p>
                <div className="geo-glow mt-1 font-display text-5xl font-bold italic tabular-nums text-foreground sm:text-6xl" data-testid="hunt-total">
                  {fmt(headline)}
                </div>
                <div className="text-sm text-muted-foreground">{t("results.outOf", { max: fmt(result.max) })}</div>
                <div className="meter mx-auto mt-2 max-w-xs !bg-black/40">
                  <motion.div className="h-full bg-[#9be15d]" initial={{ width: 0 }} animate={{ width: `${(result.score / Math.max(1, result.max)) * 100}%` }} transition={{ duration: reduced ? 0 : 1.1 }} />
                </div>
              </div>

              <ol className="space-y-1.5" aria-label={t("results.rounds")}>
                {result.rounds.map((r, i) => {
                  const tag = i === best ? t("results.best") : i === worst ? t("results.worst") : null;
                  const form = formTag(r.id);
                  return (
                    <li
                      key={i}
                      className={cn("flex items-center gap-3 rounded-md border bg-shade/20 px-2.5 py-1.5", i === best && "border-success/60 bg-success/10", i === worst && "border-destructive/60 bg-destructive/10")}
                      data-testid={`hunt-results-round-${i + 1}`}
                    >
                      <span className="w-4 shrink-0 text-center font-pixel text-[9px] text-muted-foreground">{i + 1}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element -- the round's art, already cached */}
                      <img src={r.art} alt="" className="h-11 w-11 shrink-0 object-contain" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{r.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {form ? `${form} · ` : ""}
                          {t("results.regions", { found: r.found, total: r.of })}
                        </span>
                      </span>
                      <span className="flex flex-col items-end">
                        <span className="font-display text-base font-bold tabular-nums">{fmt(r.score)}</span>
                        {tag && (
                          <span className={cn("flex items-center gap-1 font-pixel text-[9px] uppercase", i === best ? "text-success" : "text-destructive")}>
                            {i === best && <Crown className="h-3 w-3" aria-hidden />}
                            {tag}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button size="lg" variant="success" onClick={onAgain} data-testid="hunt-again">
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  {daily ? t("results.practice") : t("results.again")}
                </Button>
                <Button size="lg" variant="outline" onClick={hub} data-testid="hunt-hub">
                  <LayoutGrid className="h-4 w-4" aria-hidden />
                  {t("results.hub")}
                </Button>
              </div>

              {daily && share && <HuntShareGrid number={daily.number} scores={scores} share={share} />}
            </div>
            <div className="h-[env(safe-area-inset-bottom)] shrink-0" aria-hidden />
          </div>
        </div>
      )}
    </GameShell>
  );
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
