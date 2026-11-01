"use client";

import { useState } from "react";
import type { Difficulty, ModuleId } from "@/engines/types";
import { MODULE_INFO, PLAY_MODULES, difficultiesFor } from "@/lib/modes";
import { QUIZ_DUEL_QUESTIONS, QUIZ_DUEL_QUESTION_MS, ZOOM_DUEL_QUESTION_MS, pvpHref } from "@/lib/pvp-types";
import { ZOOM_POINTS, ZOOM_STEPS } from "@/lib/zoom-reveal";
import { NewDuelCard } from "@/components/duel/NewDuelCard";
import { cn } from "@/lib/utils";

/** "Duel a friend" on a quiz's setup screen (and the /play hub): pick the mode and difficulty, open a quiz duel. */
export function QuizDuelCard({ module: initial = "whos-that", difficulty: initialDifficulty = "medium" }: { module?: ModuleId; difficulty?: Difficulty }) {
  const [module, setModule] = useState<ModuleId>(initial);
  const [picked, setDifficulty] = useState<Difficulty>(initialDifficulty);
  const choices = difficultiesFor(module);
  // A mode without the picked level (Whose Team has no Easy) plays its first one.
  const difficulty = choices.some((c) => c.id === picked) ? picked : choices[0].id;
  return (
    <NewDuelCard
      body={{ kind: "quiz", module, difficulty }}
      href={(code) => pvpHref("quiz", code)}
      heading={`Head to head · ${MODULE_INFO[module].title}`}
      blurb={
        module === "zoom-reveal"
          ? `The same ${QUIZ_DUEL_QUESTIONS} close-ups for both of you, ${ZOOM_DUEL_QUESTION_MS / 1000} seconds each. Named on step 1 scores ${ZOOM_POINTS[0]}, down to ${ZOOM_POINTS[ZOOM_STEPS - 1]} on step ${ZOOM_STEPS}; the most points wins. Send your friend the link and press Ready.`
          : `The same ${QUIZ_DUEL_QUESTIONS} questions for both of you, ${QUIZ_DUEL_QUESTION_MS / 1000} seconds each. A right answer scores 100, plus up to 50 for speed; the most points wins. Send your friend the link and press Ready.`
      }
    >
      <div className="flex flex-wrap items-end gap-3 pt-1">
        <label className="space-y-1">
          <span className="hud-label block">Mode</span>
          <select
            value={module}
            onChange={(e) => setModule(e.target.value as ModuleId)}
            aria-label="Duel mode"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PLAY_MODULES.map((m) => (
              <option key={m} value={m}>
                {MODULE_INFO[m].title}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-1">
          <span className="hud-label block">Difficulty</span>
          <div className="flex gap-1" role="group" aria-label="Duel difficulty">
            {choices.map(({ id: d, label }) => (
              <button
                key={d}
                type="button"
                aria-pressed={difficulty === d}
                onClick={() => setDifficulty(d)}
                className={cn(
                  "h-9 rounded-sm border px-2.5 font-pixel text-[10px] uppercase tracking-wider transition-colors",
                  difficulty === d ? "border-primary bg-primary text-primary-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </NewDuelCard>
  );
}
