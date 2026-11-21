"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites; next/image adds nothing here */
import { motion } from "framer-motion";
import { Users } from "lucide-react";
import { useEffect } from "react";
import { DLE_MIN_PLAYERS_FOR_PERCENTILE, averageGuesses, bucketOf, buckets, percentText } from "@/lib/dle-community";
import { usePokedleCommunity, type PokedleCommunityGame } from "./use-pokedle-community";
import { Pokedle, type PokedleShareCommunity } from "./Pokedle";
import { spriteUrl, type NameEntry } from "./parts";
import { useDleWords } from "./lexicon";
import { formatNumber } from "@/i18n/catalog";
import { useT } from "@/i18n/client";
import gameNs from "@/messages/pokedle-game";
import type { DleLabels } from "@/lib/dle-i18n";
import { cn } from "@/lib/utils";

/**
 * "How everyone did today", under a finished daily Pokédle: trainers, the
 * share who solved it, your place ("Top 18% of 4,213 trainers", "#1,284 to
 * solve today"), the guess distribution with your bar lit, and how many
 * opened like you. Never shown before you finish (it'd be a clue), and not at
 * all when the server has no community stats.
 */

/** The daily Pokédle with the community panel under a finished game, and its percentile in the share. */
export function PokedleWithCommunity({ names, labels }: { names: NameEntry[]; labels?: DleLabels }) {
  return <Pokedle names={names} labels={labels} community={(finished, setShare) => <PokedleCommunity game={finished} onShare={setShare} />} />;
}

const B = (c: React.ReactNode[]) => <b>{c}</b>;

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
  const t = useT(gameNs);
  const words = useDleWords();
  const state = usePokedleCommunity(game);
  const shareWith = state.status === "ready" ? state.data.community : undefined;
  useEffect(() => {
    onShare?.(shareWith);
  }, [onShare, shareWith]);
  // Nothing at all until the numbers are in, and nothing when the server has no community stats.
  if (state.status !== "ready") return null;
  const fmt = (n: number) => formatNumber(n, t.locale);
  const { summary, you, standing } = state.data;
  const { players, solved } = summary;
  const all = buckets(summary);
  const max = summary.dist.length;
  const mine = bucketOf(you, max);
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
      aria-label={t("community.label")}
      className={cn("space-y-4 rounded-md border bg-shade/20 p-4 text-left", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="hud-label flex items-center gap-1.5 text-screen">
          <Users className="h-3.5 w-3.5" aria-hidden /> {t("community.trainers")}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {t("community.summary", { players: fmt(players), pct: percentText(solved, players) })}
          {avg !== null && t("community.avg", { avg: t.locale === "en" ? avg.toFixed(1) : formatNumber(avg, t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
        </p>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("font-display text-3xl font-bold uppercase leading-none", you.solved ? "text-success" : "text-foreground")}>
            {top !== null ? t("community.top", { n: top }) : you.solved && you.rank ? t("community.rank", { n: fmt(you.rank) }) : percentText(solved, players)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {top !== null ? t("community.ofTrainers", { n: players, count: fmt(players) }) : you.solved ? t("community.toSolveToday") : t("community.solvedIt")}
          </p>
        </div>
        {top !== null && you.rank && (
          <div className="shrink-0 text-right">
            <p className="font-pixel text-lg tabular-nums">{t("community.rank", { n: fmt(you.rank) })}</p>
            <p className="text-xs text-muted-foreground">{t("community.toSolve")}</p>
          </div>
        )}
      </div>

      <ol className="space-y-1" aria-label={t("community.list")}>
        {all.map((n, k) => {
          const yours = k === mine;
          const label = k < max ? String(k + 1) : "X";
          return (
            <li
              key={label}
              className="grid grid-cols-[1rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs"
              aria-label={`${t("community.bucket", { n, label: k < max ? t("community.solvedIn", { n: label }) : t("community.notSolved"), count: fmt(n) })}${yours ? t("community.you") : ""}`}
            >
              <span className={cn("font-pixel text-[10px]", yours ? "text-foreground" : "text-muted-foreground")}>{label}</span>
              <span className="h-4 overflow-hidden rounded-sm bg-foreground/5">
                <motion.span
                  className={cn(
                    "block h-full rounded-sm",
                    yours ? (you.solved ? "bg-success" : "bg-destructive/80") : k === max ? "bg-destructive/25" : "bg-foreground/20"
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
            {others > 0
              ? t.rich("community.alsoStarted", { pct: percentText(others, players), name: words.name(you.firstGuess.id, you.firstGuess.name), b: B })
              : t.rich("community.nobodyElse", { name: words.name(you.firstGuess.id, you.firstGuess.name), b: B })}
          </span>
        </p>
        {topOpener && topOpener.id !== you.firstGuess.id && topOpener.count > 1 && (
          <p className="text-xs text-muted-foreground">
            {t.rich("community.popular", {
              name: words.name(topOpener.id, topOpener.name),
              pct: percentText(topOpener.count, players),
              b: (c) => <b className="text-foreground">{c}</b>,
            })}
          </p>
        )}
      </div>
    </motion.section>
  );
}
