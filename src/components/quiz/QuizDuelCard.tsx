"use client";

import { useState } from "react";
import type { Difficulty, ModuleId } from "@/engines/types";
import { PLAY_MODULES, difficultiesFor, levelKey, playDifficulty } from "@/lib/modes";
import { QUIZ_DUEL_QUESTIONS, QUIZ_DUEL_QUESTION_MS, ZOOM_DUEL_QUESTION_MS, pvpHref } from "@/lib/pvp-types";
import { ZOOM_POINTS, ZOOM_STEPS } from "@/lib/zoom-reveal";
import { NewDuelCard } from "@/components/duel/NewDuelCard";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import modesNs from "@/messages/quiz-modes";
import setupNs from "@/messages/quiz-setup";

/**
 * "Duel a friend" on a quiz's setup screen (and the /quiz hub): pick the mode
 * (and the difficulty, for the two modes that have one), open a quiz duel.
 */
export function QuizDuelCard({ module: initial = "whos-that", difficulty: initialDifficulty }: { module?: ModuleId; difficulty?: Difficulty }) {
  const t = useT(setupNs);
  const mt = useT(modesNs);
  const lang = t.locale;
  const [module, setModule] = useState<ModuleId>(initial);
  const [picked, setDifficulty] = useState<Difficulty | undefined>(initialDifficulty);
  const choices = difficultiesFor(module);
  // A mode without the picked level (Whose Team has no Easy) plays its default; most modes have one fixed tuning.
  const difficulty = playDifficulty(module, picked);
  return (
    <NewDuelCard
      // A page in another language opens the duel with its questions in that language.
      body={lang === "en" ? { kind: "quiz", module, difficulty } : { kind: "quiz", module, difficulty, lang }}
      href={(code) => pvpHref("quiz", code)}
      heading={t("duel.heading", { mode: mt(`modules.${module}.title`) })}
      blurb={
        module === "zoom-reveal"
          ? t("duel.zoomBlurb", { n: QUIZ_DUEL_QUESTIONS, seconds: ZOOM_DUEL_QUESTION_MS / 1000, first: ZOOM_POINTS[0], last: ZOOM_POINTS[ZOOM_STEPS - 1], steps: ZOOM_STEPS })
          : t("duel.blurb", { n: QUIZ_DUEL_QUESTIONS, seconds: QUIZ_DUEL_QUESTION_MS / 1000 })
      }
    >
      <div className="flex flex-wrap items-end gap-3 pt-1">
        <label className="space-y-1">
          <span className="hud-label block">{t("duel.mode")}</span>
          <select
            value={module}
            onChange={(e) => setModule(e.target.value as ModuleId)}
            aria-label={t("duel.modeLabel")}
            className="h-9 max-md:h-10 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PLAY_MODULES.map((m) => (
              <option key={m} value={m}>
                {mt(`modules.${m}.title`)}
              </option>
            ))}
          </select>
        </label>
        {choices.length > 0 && (
          <div className="space-y-1">
            <span className="hud-label block">{t("duel.difficulty")}</span>
            <div className="flex gap-1" role="group" aria-label={t("duel.difficultyLabel")}>
              {choices.map(({ id: d }) => (
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
                  {mt(`levels.${levelKey(module, d)!}.label`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </NewDuelCard>
  );
}
