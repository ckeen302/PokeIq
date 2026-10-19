"use client";

import { useState } from "react";
import { DIFFICULTIES, type Difficulty, type ModuleId } from "@/engines/types";
import { MODULE_INFO, PLAY_MODULES } from "@/lib/modes";
import { QUIZ_DUEL_QUESTIONS, QUIZ_DUEL_QUESTION_MS, pvpHref } from "@/lib/pvp-types";
import { NewDuelCard } from "@/components/duel/NewDuelCard";
import { cn } from "@/lib/utils";

/** "Duel a friend" on a quiz's setup screen (and the /play hub): pick the mode and difficulty, open a quiz duel. */
export function QuizDuelCard({ module: initial = "whos-that", difficulty: initialDifficulty = "medium" }: { module?: ModuleId; difficulty?: Difficulty }) {
  const [module, setModule] = useState<ModuleId>(initial);
  const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
  return (
    <NewDuelCard
      body={{ kind: "quiz", module, difficulty }}
      href={(code) => pvpHref("quiz", code)}
      heading={`Head to head · ${MODULE_INFO[module].title}`}
      blurb={`The same ${QUIZ_DUEL_QUESTIONS} questions for both of you, ${QUIZ_DUEL_QUESTION_MS / 1000} seconds each. A right answer scores 100, plus up to 50 for speed; the most points wins. Send your friend the link and press Ready.`}
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
            {DIFFICULTIES.map((d) => (
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
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>
    </NewDuelCard>
  );
}
