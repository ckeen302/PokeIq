"use client";

import { BookOpen } from "lucide-react";
import { DLE_ASSISTS, DLE_ASSIST_INFO, multiplierText, type DleAssist } from "@/lib/dle-assist";
import { cn } from "@/lib/utils";

/**
 * The Pokédex assist setting: four levels in a row, with the chosen one's
 * line and points multiplier underneath. `disabled` once a game has started
 * (the level is locked for the game), and `note` says why.
 */
export function AssistPicker({
  value,
  onChange,
  disabled,
  note,
  points = true,
  label = "Pokédex assist",
  className,
}: {
  value: DleAssist;
  onChange?: (assist: DleAssist) => void;
  disabled?: boolean;
  /** Shown in place of the level's line, e.g. why it can't change. */
  note?: string;
  /** Show the points multipliers (solo; a duel has no multiplier). */
  points?: boolean;
  /** The setting's accessible name, when a page has more than one. */
  label?: string;
  className?: string;
}) {
  const info = DLE_ASSIST_INFO[value];
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" aria-hidden /> Pokédex
        </span>
        <div className="flex flex-wrap justify-center rounded-md border border-foreground/15 p-0.5" role="radiogroup" aria-label={label}>
          {DLE_ASSISTS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={a === value}
              disabled={disabled || !onChange}
              onClick={() => onChange?.(a)}
              title={`${DLE_ASSIST_INFO[a].label}: ${DLE_ASSIST_INFO[a].blurb}${points ? ` Points ${multiplierText(a)}.` : ""}`}
              className={cn(
                "rounded px-2 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed",
                a === value ? "bg-primary text-primary-foreground" : "text-muted-foreground enabled:hover:text-foreground disabled:opacity-50"
              )}
            >
              {DLE_ASSIST_INFO[a].label}
              {points && <span className="ml-1 font-normal tabular-nums opacity-80">{multiplierText(a)}</span>}
            </button>
          ))}
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground" data-testid="assist-blurb">
        {note ?? info.blurb}
      </p>
    </div>
  );
}
