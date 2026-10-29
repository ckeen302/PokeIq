"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, Crown, RotateCcw, X } from "lucide-react";
import { GEO_MAX_ROUND_SCORE, type GeoGuessResponse, type GeoKind, type GeoRegionInfo } from "@/lib/geo-types";
import { isWorldwide } from "@/lib/geo-themes";
import { placeLabel, squaresText } from "@/lib/geo-names";
import { BEST_COLOR, WORST_COLOR, bestAndWorst } from "@/lib/geo-results";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GeoMap, type MapPin, type RevealedRound } from "./GeoMap";
import { ExitButton, GameShell, Notch } from "./GameShell";
import { ShareResultLink } from "./ShareResultLink";

/** What the results map needs of a finished game: the map and the rounds as graded. */
export interface ResultsGame {
  region: GeoRegionInfo;
  kind: GeoKind;
  rounds: number;
  daily?: string;
}
export interface ResultsRound {
  guess: MapPin | null;
  graded: GeoGuessResponse;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Counts up to `value` once, eased; instant under reduced motion. */
function useCountUp(value: number, ms = 1100): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      start ||= now;
      const t = Math.min(1, (now - start) / ms);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, reduced]);
  return shown;
}

/**
 * The end of a game, GeoGuessr's summary: the whole map with every round's
 * pin and the place it was, a line between them, and a breakdown panel with
 * each round's distance and score (the best and the worst lit), the total,
 * play again and sharing. `children` is the rest of the summary (the
 * leaderboard form, the challenge link, the badges), scrolled under the
 * breakdown.
 */
export function GeoResults({
  game,
  played,
  pinImage,
  shareToken,
  onRestart,
  children,
}: {
  game: ResultsGame;
  played: ResultsRound[];
  pinImage?: string;
  /** A signed result, for the result page's link and preview card. */
  shareToken?: string;
  onRestart: () => void;
  children?: React.ReactNode;
}) {
  const isStreak = game.kind === "streak";
  const isWorld = isWorldwide(game.region.id);
  const scores = played.map((p) => p.graded.score);
  const total = scores.reduce((s, x) => s + x, 0);
  const streak = played.filter((p) => p.graded.hit).length;
  const { best, worst } = isStreak ? { best: null, worst: null } : bestAndWorst(scores);
  const headline = useCountUp(isStreak ? streak : total);
  const [focus, setFocus] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  const revealed = useMemo<RevealedRound[]>(
    () =>
      played.map((p, i) => ({
        guess: p.guess,
        answer: p.graded.answer,
        label: String(i + 1),
        image: pinImage,
        color: focus === i ? "#ffd23c" : i === best ? BEST_COLOR : i === worst ? WORST_COLOR : isStreak && !p.graded.hit ? WORST_COLOR : undefined,
      })),
    [played, pinImage, best, worst, focus, isStreak]
  );
  // The panel's lower part (leaderboard, sharing) scrolls into view from "More".
  useEffect(() => {
    if (!more || !panelRef.current) return;
    panelRef.current.querySelector("[data-results-more]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [more]);

  const max = game.rounds * GEO_MAX_ROUND_SCORE;
  return (
    <GameShell onExit={onRestart}>
      {() => (
        <div className="flex h-full flex-col md:flex-row" data-testid="geo-results">
          {/* The map: every round's pin, flag and line. */}
          <div className="relative h-[42vh] shrink-0 md:h-full md:flex-1">
            <GeoMap region={game.region} revealed={revealed} fill fit={{ duration: 900 }} />
            <div className="absolute left-3 top-3 z-20">
              <ExitButton onClick={onRestart} />
            </div>
            <Notch>
              <div className="text-center">
                <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">{isStreak ? "Streak over" : "Survey complete"}</div>
                <div className="mt-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{game.region.name}</div>
              </div>
            </Notch>
            {!isStreak && best !== null && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex gap-2 font-display text-[11px] font-semibold uppercase tracking-wider text-white" aria-hidden>
                <span className="flex items-center gap-1.5 rounded bg-black/55 px-2 py-1 backdrop-blur">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: BEST_COLOR }} /> Best round
                </span>
                <span className="flex items-center gap-1.5 rounded bg-black/55 px-2 py-1 backdrop-blur">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: WORST_COLOR }} /> Worst round
                </span>
              </div>
            )}
          </div>

          {/* The breakdown panel. */}
          <div
            ref={panelRef}
            className="geo-results-panel flex min-h-0 flex-1 flex-col overflow-y-auto border-t-4 border-[#a99cff] bg-background text-foreground md:w-[27rem] md:flex-none md:border-l-4 md:border-t-0"
            data-testid="geo-results-panel"
          >
            <div className="space-y-4 p-4 sm:p-5">
              <div className="text-center">
                <p className="hud-label text-screen">{isStreak ? "Final streak" : `Total score · ${game.rounds} rounds`}</p>
                <div className="geo-glow mt-1 font-display text-5xl font-bold italic tabular-nums text-white sm:text-6xl" data-testid="geo-results-total">
                  {isStreak ? `${headline} in a row` : fmt(headline)}
                </div>
                {!isStreak && (
                  <>
                    <div className="text-sm text-muted-foreground">out of {fmt(max)}</div>
                    <div className="meter mx-auto mt-2 max-w-xs !bg-black/40">
                      <motion.div className="h-full bg-[#9be15d]" initial={{ width: 0 }} animate={{ width: `${(total / max) * 100}%` }} transition={{ duration: 1.1 }} />
                    </div>
                  </>
                )}
              </div>

              <ol className="space-y-1.5" aria-label="Rounds">
                {played.map((p, i) => {
                  const tag = i === best ? "Best" : i === worst ? "Worst" : null;
                  const miss = isStreak && !p.graded.hit;
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        onMouseEnter={() => setFocus(i)}
                        onMouseLeave={() => setFocus(null)}
                        onFocus={() => setFocus(i)}
                        onBlur={() => setFocus(null)}
                        onClick={() => setFocus((f) => (f === i ? null : i))}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md border bg-shade/20 px-3 py-2 text-left transition-colors hover:border-[#a99cff]/60",
                          i === best && "border-[#4cbb17]/60 bg-[#4cbb17]/10",
                          (i === worst || miss) && "border-[#ff5a5a]/60 bg-[#ff5a5a]/10",
                          focus === i && "border-[#ffd23c]"
                        )}
                        data-testid={`geo-results-round-${i + 1}`}
                      >
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white"
                          style={{ background: i === best ? BEST_COLOR : i === worst || miss ? WORST_COLOR : "#3a8dde" }}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{placeLabel(p.graded.answer, game.region)}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.graded.answer.game}
                            {p.graded.timedOut ? " · Time's up" : ` · ${isStreak && isWorld ? (p.graded.hit ? "Right region" : "Wrong region") : squaresText(p.graded.answer.squares)}`}
                          </span>
                        </span>
                        {isStreak ? (
                          p.graded.hit ? <Check className="h-5 w-5 text-[#9be15d]" aria-label="Correct" /> : <X className="h-5 w-5 text-[#ff5a5a]" aria-label="Missed" />
                        ) : (
                          <span className="flex flex-col items-end">
                            <span className="font-display text-base font-bold tabular-nums">{fmt(p.graded.score)}</span>
                            {tag && (
                              <span className={cn("flex items-center gap-1 font-pixel text-[9px] uppercase", i === best ? "text-[#9be15d]" : "text-[#ff5a5a]")}>
                                {i === best && <Crown className="h-3 w-3" aria-hidden />}
                                {tag}
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button size="lg" variant="success" onClick={onRestart} data-testid="geo-results-again">
                  <RotateCcw className="h-4 w-4" aria-hidden /> Play again
                </Button>
                {shareToken ? (
                  <ShareResultLink token={shareToken} />
                ) : (
                  <Button size="lg" variant="outline" onClick={() => setMore(true)}>
                    <ChevronDown className="h-4 w-4" aria-hidden /> Share &amp; leaderboard
                  </Button>
                )}
              </div>
            </div>

            {children && (
              <div className="border-t px-4 pb-6 pt-4 sm:px-5" data-results-more>
                {children}
              </div>
            )}
          </div>
        </div>
      )}
    </GameShell>
  );
}
