"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Battle hotkeys, after Pokémon Showdown's: 1-4 pick a move, Shift+1-6
 * switch to that Pokémon (plain 1-6 when a switch is the only choice, or to
 * pick leads at team preview), T toggles Terastallization, M toggles Mega
 * Evolution / Z-Move / Dynamax, Esc goes back, ? shows the list.
 */

export interface BattleKeys {
  /** 1-4: a move (or a target while aiming); 1-6 at team preview or a forced switch. */
  digit?: (n: number) => void;
  /** Shift+1-6: switch to that party slot. */
  shiftDigit?: (n: number) => void;
  tera?: () => void;
  extra?: () => void;
  back?: () => void;
}

/** Keys typed into a text box (the chat) are the box's, not the battle's. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** Listens for battle hotkeys; the handlers are read fresh on every key, so they may change each render. */
export function useBattleKeys(keys: BattleKeys, onHelp: () => void) {
  const ref = useRef(keys);
  ref.current = keys;
  const help = useRef(onHelp);
  help.current = onHelp;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const k = ref.current;
      // e.code, not e.key: Shift+1 types "!" on most layouts.
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (digit) {
        const n = Number(digit[1]);
        const fn = e.shiftKey ? (k.shiftDigit ?? k.digit) : k.digit;
        if (fn) {
          e.preventDefault();
          fn(n);
        }
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        help.current();
      } else if ((e.key === "t" || e.key === "T") && k.tera) {
        e.preventDefault();
        k.tera();
      } else if ((e.key === "m" || e.key === "M") && k.extra) {
        e.preventDefault();
        k.extra();
      } else if (e.key === "Escape" && k.back) {
        e.preventDefault();
        k.back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

const ROWS: [string, string][] = [
  ["1 – 4", "Use that move (or pick a target)"],
  ["Shift + 1 – 6", "Switch to that Pokémon"],
  ["1 – 6", "Pick leads at team preview; send one out after a faint"],
  ["T", "Toggle Terastallize"],
  ["M", "Toggle Mega Evolution / Z-Move / Dynamax"],
  ["Esc", "Back / start over"],
  ["?", "Show or hide this list"],
];

/** The small "Keys" button and its list of hotkeys. */
export function HotkeyHelp({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <span className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        data-testid="hotkeys-button"
        className={cn("hud-label flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:text-foreground", open && "text-foreground")}
      >
        <Keyboard className="h-3.5 w-3.5" aria-hidden /> Keys
      </button>
      {open && (
        <span role="tooltip" data-testid="hotkeys-help" className="absolute right-0 top-full z-30 mt-1 block w-72 rounded-md border bg-popover p-3 text-left text-xs text-popover-foreground shadow-lg">
          <span className="hud-label mb-2 block">Keyboard shortcuts</span>
          {ROWS.map(([key, what]) => (
            <span key={key} className="flex items-start justify-between gap-3 py-0.5">
              <kbd className="shrink-0 rounded border bg-muted px-1.5 font-mono text-[10px]">{key}</kbd>
              <span className="text-right text-muted-foreground">{what}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/** Whether the hotkey list is open, remembered for the page's life. */
export function useHotkeyHelp() {
  const [open, setOpen] = useState(false);
  return { open, toggle: () => setOpen((o) => !o) };
}
