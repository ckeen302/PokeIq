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
export function useHuntPinHint(pins: boolean[], active: number): string {
  const t = useT(huntNs);
  const placed = pins.filter(Boolean).length;
  if (pins.length < 2) return placed ? t("pins.hintMoveOne") : t("pins.hintOne");
  if (placed === pins.length) return t("pins.hintDone", { n: active + 1 });
  return pins[active] ? t("pins.hintMove", { n: active + 1 }) : t("pins.hintPlace", { n: active + 1 });
}

/**
 * The pin tray, between the map and the Guess button (inside the map card
 * on a phone): a numbered chip per pin the round takes. A placed pin's chip
 * is filled in its colour with a × to remove it; the pin a tap on the map
 * moves is ringed in yellow; tapping a chip makes it that pin. Keys 1–3 pick
 * a pin and Delete or Backspace removes the picked one, while the round is up.
 * One line under the chips says what a tap on the map will do.
 */
export function HuntPinTray({ pins, active, onSelect, onRemove, keys = true, className }: {
  /** One slot per pin the round takes: placed (true) or not. */
  pins: boolean[];
  /** The pin a tap on the map places or moves. */
  active: number;
  onSelect: (i: number) => void;
  onRemove: (i: number) => void;
  /** Listen for 1–3 and Delete (off while something else has the keyboard). */
  keys?: boolean;
  className?: string;
}) {
  const t = useT(huntNs);
  const max = pins.length;
  const placed = pins.filter(Boolean).length;

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
      } else if ((e.key === "Delete" || e.key === "Backspace") && pins[active]) {
        e.preventDefault();
        onRemove(active);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, max, pins, active, onSelect, onRemove]);

  const hint = useHuntPinHint(pins, active);

  return (
    <div className={cn("rounded-md bg-[#1e1a3f]/92 px-[1.1vh] py-[0.9vh] text-white shadow-lg ring-1 ring-white/15 backdrop-blur max-md:px-2.5 max-md:py-2", className)} data-testid="hunt-pin-tray">
      {max > 1 && (
        // Touch screens: the count on its own line, then each placed pin as a two-part pill (its number picks it up, its ×
        // removes it), side by side so a thumb never lands on the wrong one. A mouse: chips in a row with a small × badge.
        <div className="flex items-center gap-[0.9vh] [@media(pointer:coarse)]:flex-wrap [@media(pointer:coarse)]:gap-1.5">
          <span className="font-display text-[max(10px,1.2vh)] font-bold uppercase tracking-[0.16em] text-[#c8bfff] [@media(pointer:coarse)]:w-full [@media(pointer:coarse)]:text-[11px]" aria-live="polite" data-testid="hunt-pin-count">
            {t("pins.count", { placed, max })}
          </span>
          <ol className="ml-auto flex items-center gap-[0.8vh] [@media(pointer:coarse)]:ml-0 [@media(pointer:coarse)]:gap-2" aria-label={t("pins.label")}>
            {pins.map((on, i) => {
              const color = huntPinColor(i);
              const isActive = i === active;
              return (
                <li key={i} className={cn("relative flex items-center rounded-full", isActive && "ring-[3px] ring-[#ffd23c] ring-offset-2 ring-offset-[#1e1a3f]")}>
                  <button
                    type="button"
                    onClick={() => onSelect(i)}
                    aria-pressed={isActive}
                    aria-label={on ? t("pins.select", { n: i + 1 }) : t("pins.empty", { n: i + 1 })}
                    title={on ? t("pins.select", { n: i + 1 }) : t("pins.hintPlace", { n: i + 1 })}
                    data-testid={`hunt-pin-chip-${i + 1}`}
                    data-placed={on ? "true" : undefined}
                    className={cn(
                      "flex h-[max(28px,3.4vh)] w-[max(28px,3.4vh)] items-center justify-center rounded-full font-display text-[max(13px,1.6vh)] font-bold transition-[transform,background-color] duration-150 [-webkit-tap-highlight-color:transparent] active:scale-95 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 [@media(pointer:coarse)]:text-base",
                      on ? "text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)] [@media(pointer:coarse)]:rounded-r-none" : "border-2 border-dashed border-white/40 text-white/60"
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
                      className="absolute -right-1.5 -top-1.5 flex h-[max(16px,1.9vh)] w-[max(16px,1.9vh)] items-center justify-center rounded-full bg-[#120f24] text-white ring-1 ring-white/50 transition-colors hover:bg-[#ff5a5a] [-webkit-tap-highlight-color:transparent] [@media(pointer:coarse)]:static [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-8 [@media(pointer:coarse)]:rounded-l-none [@media(pointer:coarse)]:rounded-r-full [@media(pointer:coarse)]:bg-black/45 [@media(pointer:coarse)]:ring-0 [@media(pointer:coarse)]:active:bg-[#ff5a5a]"
                    >
                      <X className="h-[70%] w-[70%] [@media(pointer:coarse)]:h-4 [@media(pointer:coarse)]:w-4" strokeWidth={3} aria-hidden />
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
