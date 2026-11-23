"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";

export interface HuntPinBarProps {
  placed: number;
  max: number;
  /** The pin picked up to move (the next tap on the map moves it), or null. */
  selected: number | null;
  onSelect: (i: number) => void;
  onRemove: (i: number) => void;
}

/** The pin counter: "2/3 pins", a chip per pin to pick it up (then tap the map to move it) or remove it. Presentation: owned by hunt design. */
export function HuntPinBar({ placed, max, selected, onSelect, onRemove }: HuntPinBarProps) {
  const t = useT(huntNs);
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-[#1e1a3f]/90 px-2 py-1.5 text-white shadow-lg ring-1 ring-white/10 backdrop-blur" data-testid="hunt-pin-bar">
      <span className="whitespace-nowrap px-1 font-display text-xs font-bold tabular-nums" data-testid="hunt-pin-count" data-placed={placed} data-max={max}>
        {t("round.pins", { placed, max })}
      </span>
      {Array.from({ length: placed }, (_, i) => (
        <span key={i} className={cn("flex items-center overflow-hidden rounded-full ring-1", selected === i ? "bg-[#ffd23c] text-[#120f24] ring-[#ffd23c]" : "bg-[#3a8dde] ring-white/30")}>
          <button type="button" onClick={() => onSelect(i)} aria-pressed={selected === i} aria-label={t("round.move", { n: i + 1 })} title={t("round.move", { n: i + 1 })} className="px-2 py-0.5 font-display text-xs font-bold" data-testid={`hunt-pin-chip-${i + 1}`}>
            {i + 1}
          </button>
          <button type="button" onClick={() => onRemove(i)} aria-label={t("round.remove", { n: i + 1 })} title={t("round.remove", { n: i + 1 })} className="pr-1.5" data-testid={`hunt-pin-remove-${i + 1}`}>
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
