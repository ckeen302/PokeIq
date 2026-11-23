"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";
import { huntPinColor } from "./map-marks";

/**
 * What a tap on the map will do now: "Tap the map to drop pin 2", "Tap the
 * map to move pin 1", "All pins down…". The phone's map card shows it as its
 * label (MapDock's `hint`); a computer shows it under the chips.
 */
export function useHuntPinHint(placed: number, max: number, selected: number | null): string {
  const t = useT(huntNs);
  const active = selected ?? (placed < max ? placed : -1);
  if (max < 2) return placed ? t("pins.hintMoveOne") : t("pins.hintOne");
  if (active < 0) return t("pins.hintDone");
  return active < placed ? t("pins.hintMove", { n: active + 1 }) : t("pins.hintPlace", { n: active + 1 });
}

/**
 * The pin bar, between the map and the Guess button (inside the map card on
 * a phone): "2 of 3 pins" and a numbered chip per pin the round takes. A
 * placed pin's chip is filled in its colour with a × to remove it; the pin a
 * tap on the map moves wears a yellow ring (with none picked, a tap drops the
 * next pin, whose empty chip is ringed instead). Tapping a chip picks that
 * pin. Keys 1–3 pick a pin, Delete or Backspace removes the picked one. One
 * line under the chips says what a tap on the map will do.
 */
export function HuntPinBar({ placed, max, selected, onSelect, onRemove, keys = true, className }: {
  /** Pins down (pins 1 to `placed`). */
  placed: number;
  /** Pins the round takes. */
  max: number;
  /** The pin a tap on the map moves; null: a tap drops the next one. */
  selected: number | null;
  onSelect: (i: number) => void;
  onRemove: (i: number) => void;
  /** Listen for 1–3 and Delete (off while something else has the keyboard). */
  keys?: boolean;
  className?: string;
}) {
  const t = useT(huntNs);
  const pins = Array.from({ length: max }, (_, i) => i < placed);
  // The ringed chip: the picked pin, else the next one to drop (none once they're all down).
  const active = selected ?? (placed < max ? placed : -1);

  useEffect(() => {
    if (!keys || max < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= max) {
        e.preventDefault();
        onSelect(n - 1);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected !== null && selected < placed) {
        e.preventDefault();
        onRemove(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, max, placed, selected, onSelect, onRemove]);

  const hint = useHuntPinHint(placed, max, selected);

  return (
    <div className={cn("rounded-md bg-[#1e1a3f]/92 px-[1.1vh] py-[0.9vh] text-white shadow-lg ring-1 ring-white/15 backdrop-blur max-md:px-2.5 max-md:py-2", className)} data-testid="hunt-pin-tray">
      {max > 1 && (
        <div className="flex items-center gap-[0.9vh] max-md:gap-2">
          <span className="font-display text-[max(10px,1.2vh)] font-bold uppercase tracking-[0.16em] text-[#c8bfff] max-md:text-[11px]" aria-live="polite" data-testid="hunt-pin-count">
            {t("pins.count", { placed, max })}
          </span>
          <ol className="ml-auto flex items-center gap-[0.8vh] max-md:gap-2" aria-label={t("pins.label")}>
            {pins.map((on, i) => {
              const color = huntPinColor(i);
              const isActive = i === active;
              return (
                <li key={i} className="relative">
                  <button
                    type="button"
                    onClick={() => onSelect(i)}
                    aria-pressed={isActive}
                    aria-label={on ? t("pins.select", { n: i + 1 }) : t("pins.empty", { n: i + 1 })}
                    title={on ? t("pins.select", { n: i + 1 }) : t("pins.hintPlace", { n: i + 1 })}
                    data-testid={`hunt-pin-chip-${i + 1}`}
                    data-placed={on ? "true" : undefined}
                    className={cn(
                      "tap flex h-[max(28px,3.4vh)] w-[max(28px,3.4vh)] items-center justify-center rounded-full font-display text-[max(13px,1.6vh)] font-bold transition-[transform,box-shadow,background-color] duration-150 [-webkit-tap-highlight-color:transparent] active:scale-95 max-md:h-10 max-md:w-10 max-md:text-base",
                      on ? "text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]" : "border-2 border-dashed border-white/40 text-white/60",
                      isActive && "ring-[3px] ring-[#ffd23c] ring-offset-2 ring-offset-[#1e1a3f]"
                    )}
                    style={on ? { background: color } : undefined}
                  >
                    {i + 1}
                  </button>
                  {on && (
                    <button
                      type="button"
                      onClick={() => onRemove(i)}
                      aria-label={t("pins.remove", { n: i + 1 })}
                      title={t("pins.remove", { n: i + 1 })}
                      data-testid={`hunt-pin-remove-${i + 1}`}
                      className="tap absolute -right-1.5 -top-1.5 flex h-[max(16px,1.9vh)] w-[max(16px,1.9vh)] items-center justify-center rounded-full bg-[#120f24] text-white ring-1 ring-white/50 transition-colors hover:bg-[#ff5a5a] max-md:h-5 max-md:w-5"
                    >
                      <X className="h-[70%] w-[70%]" strokeWidth={3} aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <p className={cn("text-[max(11px,1.3vh)] font-medium leading-snug text-white/80 max-md:hidden", max > 1 && "mt-[0.6vh]")} data-testid="hunt-pin-hint">
        {hint}
      </p>
    </div>
  );
}
