"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites; next/image adds nothing here */
import { motion } from "framer-motion";
import { Users } from "lucide-react";
import { useEffect } from "react";
import { DLE_MAX_GUESSES } from "@/lib/dle-types";
import { DLE_MIN_PLAYERS_FOR_PERCENTILE, averageGuesses, bucketOf, buckets, percentText } from "@/lib/dle-community";
import { usePokedleCommunity, type PokedleCommunityGame } from "./use-pokedle-community";
import { Pokedle, type PokedleShareCommunity } from "./Pokedle";
import { spriteUrl, type NameEntry } from "./parts";
import { cn } from "@/lib/utils";

/**
 * "How everyone did today", under a finished daily Pokédle: trainers, the
 * share who solved it, your place ("Top 18% of 4,213 trainers", "#1,284 to
 * solve today"), the guess distribution with your bar lit, and how many
 * opened like you. Never shown before you finish (it'd be a clue), and not at
 * all when the server has no community stats.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
const trainers = (n: number) => `${fmt(n)} trainer${n === 1 ? "" : "s"}`;

/** The daily Pokédle with the community panel under a finished game, and its percentile in the share. */
export function PokedleWithCommunity({ names }: { names: NameEntry[] }) {
  return <Pokedle names={names} community={(finished, setShare) => <PokedleCommunity game={finished} onShare={setShare} />} />;
}

export function PokedleCommunity({
  game,
  onShare,
  className,
}: {
  game: PokedleCommunityGame;
  /** Gets the percentile for the share text once it's known (undefined: too few trainers, or stats off). */
  onShare?: (community: PokedleShareCommunity | undefined) => void;
  className?: string;
}) {
  const state = usePokedleCommunity(game);
  const shareWith = state.status === "ready" ? state.data.community : undefined;
  useEffect(() => {
    onShare?.(shareWith);
  }, [onShare, shareWith]);
  // Nothing at all until the numbers are in, and nothing when the server has no community stats.
  if (state.status !== "ready") return null;
  const { summary, you, standing } = state.data;
  const { players, solved } = summary;
  const all = buckets(summary);
  const mine = bucketOf(you);
  const widest = Math.max(1, ...all);
  const avg = averageGuesses(summary);
  const others = you.sameOpener - 1;
  const topOpener = summary.openers[0];
  // "Top N%" once enough trainers have finished for it to mean something, and when it flatters.
  const top = players >= DLE_MIN_PLAYERS_FOR_PERCENTILE && standing && standing.top <= 50 ? standing.top : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      aria-label="How everyone did today"
      className={cn("space-y-4 rounded-md border bg-shade/20 p-4 text-left", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="hud-label flex items-center gap-1.5 text-screen">
          <Users className="h-3.5 w-3.5" aria-hidden /> Today&apos;s trainers
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {fmt(players)} played · {percentText(solved, players)} solved{avg !== null && ` · avg ${avg.toFixed(1)}`}
        </p>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("font-display text-3xl font-bold uppercase leading-none", you.solved ? "text-success" : "text-foreground")}>
            {top !== null ? `Top ${top}%` : you.solved && you.rank ? `#${fmt(you.rank)}` : percentText(solved, players)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {top !== null ? `of ${trainers(players)} today` : you.solved ? "trainer to solve it today" : "of trainers solved it"}
          </p>
        </div>
        {top !== null && you.rank && (
          <div className="shrink-0 text-right">
            <p className="font-pixel text-lg tabular-nums">#{fmt(you.rank)}</p>
            <p className="text-xs text-muted-foreground">to solve it</p>
          </div>
        )}
      </div>

      <ol className="space-y-1" aria-label="Guesses everyone needed">
        {all.map((n, k) => {
          const yours = k === mine;
          const label = k < DLE_MAX_GUESSES ? String(k + 1) : "X";
          return (
            <li
              key={label}
              className="grid grid-cols-[1rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs"
              aria-label={`${k < DLE_MAX_GUESSES ? `Solved in ${label}` : "Not solved"}: ${trainers(n)}${yours ? " (you)" : ""}`}
            >
              <span className={cn("font-pixel text-[10px]", yours ? "text-foreground" : "text-muted-foreground")}>{label}</span>
              <span className="h-4 overflow-hidden rounded-sm bg-foreground/5">
                <motion.span
                  className={cn(
                    "block h-full rounded-sm",
                    yours ? (you.solved ? "bg-success" : "bg-destructive/80") : k === DLE_MAX_GUESSES ? "bg-destructive/25" : "bg-foreground/20"
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: n ? `${Math.max(3, (n / widest) * 100)}%` : 0 }}
                  transition={{ duration: 0.5, delay: 0.05 * k }}
                />
              </span>
              <span className={cn("text-right tabular-nums", yours ? "font-semibold text-foreground" : "text-muted-foreground")}>{percentText(n, players)}</span>
            </li>
          );
        })}
      </ol>

      <div className="space-y-1.5 border-t border-foreground/10 pt-3 text-sm">
        <p className="flex items-center gap-2">
          <img src={spriteUrl(you.firstGuess.id)} alt="" width={32} height={32} className="-my-1 h-8 w-8 shrink-0" />
          <span>
            {others > 0 ? (
              <>
                <b>{percentText(others, players)}</b> also started with <b>{you.firstGuess.name}</b>
              </>
            ) : (
              <>
                Nobody else opened with <b>{you.firstGuess.name}</b> today
              </>
            )}
          </span>
        </p>
        {topOpener && topOpener.id !== you.firstGuess.id && topOpener.count > 1 && (
          <p className="text-xs text-muted-foreground">
            Most popular opener: <b className="text-foreground">{topOpener.name}</b> ({percentText(topOpener.count, players)})
          </p>
        )}
      </div>
    </motion.section>
  );
}
