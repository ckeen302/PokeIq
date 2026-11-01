"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { FastForward, X } from "lucide-react";
import { GuessInput, type NameEntry } from "@/components/pokedle/parts";
import { ShareButton } from "@/components/share/ShareButton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ZOOM_STEPS, zoomPoints, zoomShareLine, type ZoomView, type ZoomWindow } from "@/lib/zoom-reveal";
import { useDexNames } from "./use-dex-names";
import { ZoomStage, ZoomSteps } from "./ZoomStage";

/**
 * One Zoom Reveal round, shared by solo runs, the daily and duels: the
 * picture, the six step pips, the name box with Skip, the names already
 * tried and, once it's over, the round's share line.
 */

export interface ZoomOutcome {
  step: number;
  solved: boolean;
  answer: string;
  revealUrl?: string;
  revealFrom?: ZoomWindow;
}

export function ZoomPlay({
  view,
  wrong,
  locked,
  outcome,
  onGuess,
  onSkip,
  shareTitle,
  shareUrl,
  waiting,
}: {
  view: ZoomView;
  /** Names already tried on this Pokémon (each one zoomed out a step). */
  wrong: NameEntry[];
  /** No guessing right now (submitting, time's up, waiting for the reveal). */
  locked: boolean;
  /** Set once the round is over. */
  outcome?: ZoomOutcome | null;
  onGuess: (entry: NameEntry) => void;
  onSkip: () => void;
  /** First line of the share text, e.g. "PokéIQ Zoom Reveal #16". */
  shareTitle?: string;
  shareUrl?: string;
  /** Shown instead of the guess box once this trainer is done but the round isn't (duels). */
  waiting?: string;
}) {
  const names = useDexNames();
  const exclude = useMemo(() => new Set(wrong.map((w) => w[0])), [wrong]);
  const line = outcome ? zoomShareLine(outcome.step, outcome.solved) : null;
  const step = outcome ? outcome.step : view.step;
  const last = view.step === ZOOM_STEPS;

  return (
    <div className="space-y-4">
      <ZoomStage
        view={view}
        reveal={outcome?.revealUrl ? { url: outcome.revealUrl, from: outcome.revealFrom } : null}
        label={outcome?.answer}
      />
      <div className="space-y-1.5">
        <ZoomSteps step={step} steps={view.steps} done={outcome ? (outcome.solved ? "solved" : "missed") : undefined} />
        {!outcome && (
          <p className="text-center font-pixel text-[10px] uppercase tracking-wider text-muted-foreground" aria-live="polite">
            Step {view.step}/{view.steps} · <span className="text-screen">{zoomPoints(view.step)} pts</span>
          </p>
        )}
      </div>

      {wrong.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Names tried">
          {wrong.map(([id, name]) => (
            <motion.li
              key={id}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-1 rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1 font-display text-xs font-semibold uppercase tracking-wide text-destructive line-through decoration-destructive/60"
            >
              <X className="h-3 w-3 shrink-0" aria-hidden />
              {name}
            </motion.li>
          ))}
        </ul>
      )}

      {outcome && line ? (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <p className="font-display text-2xl tracking-wide" data-testid="zoom-share-line" aria-label={outcome.solved ? `Named on step ${outcome.step} of ${ZOOM_STEPS}` : "Not named in six steps"}>
            {line}
          </p>
          <ShareButton
            size="sm"
            variant="outline"
            label="Share"
            kind="zoom-reveal"
            getText={() => [shareTitle ?? "PokéIQ Zoom Reveal", line, shareUrl ?? `${window.location.origin}/quiz/pokemon-zoom-quiz`].join("\n")}
          />
        </motion.div>
      ) : waiting ? (
        <p className="text-center text-sm text-muted-foreground" role="status">
          {waiting}
        </p>
      ) : names ? (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <GuessInput names={names} exclude={exclude} disabled={locked} placeholder="Type a Pokémon…" onGuess={(entry) => (locked ? false : (onGuess(entry), true))} />
          </div>
          <Button type="button" variant="outline" className="h-12 shrink-0 px-3 sm:px-4" disabled={locked} onClick={onSkip} data-testid="zoom-skip">
            <FastForward className="h-4 w-4" aria-hidden />
            {last ? "Give up" : "Skip"}
          </Button>
        </div>
      ) : (
        <Skeleton className="h-12 w-full" />
      )}
    </div>
  );
}
