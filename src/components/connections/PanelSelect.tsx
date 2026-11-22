"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type PanelSelectOption<T extends string | number> = { id: T; label: string; hint?: string };

/**
 * A small labelled dropdown (the Pokédex "View" picker's look): a button that
 * opens a listbox. ↑/↓ open it and move through the options, Enter picks,
 * Escape, Tab or a click outside closes it.
 */
export function PanelSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
  testId,
  align = "start",
}: {
  label: string;
  value: T;
  options: readonly PanelSelectOption<T>[];
  onChange: (v: T) => void;
  testId: string;
  /** Which edge of the button the list lines up with. */
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const current = options.find((o) => o.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
  const openList = () => {
    setOpen(true);
    requestAnimationFrame(() => items().find((o) => o.getAttribute("aria-selected") === "true")?.focus());
  };
  const pick = (v: T) => {
    setOpen(false);
    buttonRef.current?.focus();
    onChange(v);
  };
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative z-20" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}>
      <button
        ref={buttonRef}
        type="button"
        data-testid={testId}
        data-value={String(current.id)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        title={current.hint}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openList();
          }
        }}
        className="flex h-9 items-center gap-2 rounded-md border border-input bg-shade/40 pl-2.5 pr-2 font-display text-[13px] font-semibold uppercase tracking-[0.08em] transition-colors hover:border-screen/60 aria-expanded:border-screen/60 motion-reduce:transition-none"
      >
        <span className="font-pixel text-[9px] font-normal tracking-[0.12em] text-muted-foreground">{label}</span>
        {/* Every option stacked in one cell, so the button is as wide as the longest and never jumps. */}
        <span className="grid text-left">
          {options.map((o) => (
            <span key={o.id} className={cn("col-start-1 row-start-1", o.id !== current.id && "invisible")} aria-hidden={o.id !== current.id}>
              {o.label}
            </span>
          ))}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} strokeWidth={2.6} aria-hidden />
      </button>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        data-testid={`${testId}-list`}
        onKeyDown={onListKey}
        className={cn(
          "absolute top-full mt-1.5 w-max min-w-full max-w-[min(20rem,calc(100vw-2rem))] flex-col gap-0.5 rounded-lg border border-border bg-card p-1.5 text-left shadow-[0_18px_44px_hsl(var(--shade)/0.6)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150",
          align === "end" ? "right-0" : "left-0",
          open ? "flex" : "hidden"
        )}
      >
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={on}
              tabIndex={-1}
              data-testid={`${testId}-${o.id}`}
              onClick={() => pick(o.id)}
              className={cn(
                "flex min-h-10 items-center justify-between gap-4 rounded-[5px] border px-3 py-1.5 text-left outline-none transition-colors motion-reduce:transition-none",
                on
                  ? "border-primary/45 bg-primary/[0.14] text-foreground"
                  : "border-transparent text-foreground/80 hover:border-border hover:bg-accent/60 hover:text-foreground focus-visible:border-border focus-visible:bg-accent/60 focus-visible:text-foreground"
              )}
            >
              <span className="flex flex-col gap-0.5">
                <span className="font-display text-[13px] font-semibold uppercase tracking-[0.08em]">{o.label}</span>
                {o.hint && <span className="text-xs font-normal normal-case leading-snug tracking-normal text-muted-foreground">{o.hint}</span>}
              </span>
              <Check className={cn("h-3.5 w-3.5 shrink-0 text-primary", !on && "opacity-0")} strokeWidth={3} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}
