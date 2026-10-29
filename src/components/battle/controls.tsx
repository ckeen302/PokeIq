"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { buildIndex, search } from "@/lib/battle/search";
import { cn } from "@/lib/utils";

/** Form controls shared by the team builder and the damage calculator. */

export const inputClass =
  "h-9 w-full min-w-0 rounded-md border-2 border-foreground/15 bg-shade/40 px-2.5 text-sm focus-visible:border-screen/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";

export { normalize } from "@/lib/battle/search";

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0 space-y-1.5", className)}>
      <span className="hud-label block">{label}</span>
      {children}
    </label>
  );
}

export function Toggle({
  pressed,
  onChange,
  children,
  className,
  disabled,
}: {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors disabled:opacity-40",
        pressed ? "border-screen/60 bg-screen/15 text-foreground" : "border-foreground/10 bg-shade/30 text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

/** A number box that keeps its value within [min, max] once you leave it. */
export function NumberInput({
  value,
  min,
  max,
  onChange,
  label,
  className,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    onChange(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value);
    setDraft(null);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      min={min}
      max={max}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isInteger(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
      className={cn(inputClass, "px-1.5 text-center font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none", className)}
    />
  );
}

/**
 * Type to search, arrows + Enter to pick. Shows `value` while closed; × clears it if `onClear` is given.
 * Matching is fuzzy (prefix, word starts, initials, in-order letters, one typo) over an index built
 * once per list, and only the visible rows render, so thousands of options stay smooth per keystroke.
 * `filters` sits above the results and may hold its own controls: focus moving there keeps it open.
 */
export function SearchSelect<T>({
  label,
  value,
  placeholder,
  options,
  initial,
  getKey,
  getText,
  render,
  onSelect,
  onClear,
  header,
  filters,
  leading,
  rank,
  keep,
  limit = Infinity,
  rowHeight = 36,
  className,
  listClassName,
  disabled,
}: {
  label: string;
  value: string;
  placeholder?: string;
  options: readonly T[];
  /** What to list before anything is typed (defaults to every option, in `rank` order when given). */
  initial?: readonly T[];
  getKey: (option: T) => string;
  getText: (option: T) => string;
  render: (option: T) => React.ReactNode;
  onSelect: (option: T) => void;
  onClear?: () => void;
  header?: React.ReactNode;
  /** Filter controls shown above the results. */
  filters?: React.ReactNode;
  leading?: React.ReactNode;
  /** Lower ranks first among equally good matches (usage order, say). */
  rank?: (option: T) => number;
  /** Only options this keeps are listed (the active filters). */
  keep?: (option: T) => boolean;
  limit?: number;
  /** Every row's height in px (rows are windowed, so they all match). */
  rowHeight?: number;
  className?: string;
  listClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const textRef = useRef(getText);
  useEffect(() => {
    textRef.current = getText;
  });

  // Indexed once per option list (and only while open), not per keystroke.
  const index = useMemo(() => (open ? buildIndex(options, (o) => textRef.current(o)) : []), [options, open]);

  const results = useMemo(() => {
    if (!open) return [];
    if (!query.trim()) {
      let list = [...(initial ?? options)];
      if (keep) list = list.filter(keep);
      if (rank && !initial) list = list.map((o, i) => ({ o, i, r: rank(o) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.o);
      return list.slice(0, limit);
    }
    return search(index, query, { rank, keep, limit });
  }, [open, query, index, initial, options, rank, keep, limit]);

  const view = Math.round(8.5 * rowHeight);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const last = Math.min(results.length, Math.ceil((scrollTop + view) / rowHeight) + 4);

  // A new result list starts at the top.
  const [listFor, setListFor] = useState(results);
  if (listFor !== results) {
    setListFor(results);
    setHighlight(0);
    setScrollTop(0);
  }
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [results]);

  // Keep the highlighted row in view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const top = highlight * rowHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + rowHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + rowHeight - list.clientHeight;
  }, [highlight, rowHeight]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setHighlight(0);
  };
  const pick = (option: T | undefined) => {
    if (!option) return;
    onSelect(option);
    close();
    inputRef.current?.blur();
  };
  const move = (by: number) => setHighlight((h) => Math.max(0, Math.min(results.length - 1, h + by)));

  return (
    <div
      ref={rootRef}
      className={cn("relative min-w-0", className)}
      onBlur={(e) => {
        // Focus moving to a filter control inside keeps the list open.
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
          inputRef.current?.blur();
        }
      }}
    >
      {leading && <span className="pointer-events-none absolute left-1 top-0 flex h-9 items-center">{leading}</span>}
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results.length ? `${listId}-${highlight}` : undefined}
        disabled={disabled}
        value={open ? query : value}
        placeholder={open ? value || placeholder : placeholder}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "PageDown") {
            e.preventDefault();
            move(8);
          } else if (e.key === "PageUp") {
            e.preventDefault();
            move(-8);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open) pick(results[highlight]);
          } else if (e.key === "Tab" && !e.shiftKey && open && query.trim() && results[highlight]) {
            // As in Showdown: Tab takes the highlighted match and moves on to the next field.
            onSelect(results[highlight]);
            close();
          }
        }}
        autoComplete="off"
        spellCheck={false}
        className={cn(inputClass, "font-display font-semibold tracking-wide", leading && "pl-11", onClear && value && "pr-8")}
      />
      {onClear && value && !open && !disabled && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${label.toLowerCase()}`}
          className="absolute right-1 top-0 flex h-9 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {open && (
        <div
          className={cn(
            "absolute left-0 top-full z-40 mt-1 w-full min-w-[16rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border-2 border-foreground/15 bg-card shadow-2xl",
            listClassName
          )}
        >
          {filters && <div className="border-b border-foreground/10 bg-shade/30 px-2 py-1.5">{filters}</div>}
          {header && <div className="border-b border-foreground/10 bg-shade/40 px-2 py-1.5">{header}</div>}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            style={{ maxHeight: view }}
            className="overflow-y-auto overscroll-contain"
          >
            {results.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">No matches</div>
            ) : (
              <div style={{ height: results.length * rowHeight, position: "relative" }}>
                {results.slice(first, last).map((option, k) => {
                  const i = first + k;
                  return (
                    <div
                      key={getKey(option)}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === highlight}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(option)}
                      onMouseMove={() => i !== highlight && setHighlight(i)}
                      style={{ position: "absolute", top: i * rowHeight, height: rowHeight, left: 0, right: 0 }}
                      className={cn("flex cursor-pointer items-center overflow-hidden px-2 text-sm", i === highlight && "bg-screen/15")}
                    >
                      <div className="min-w-0 flex-1">{render(option)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {results.length > 0 && (
            <div className="hud-label flex justify-between gap-2 border-t border-foreground/10 bg-shade/30 px-2 py-1 normal-case tracking-wider">
              <span>
                {results.length.toLocaleString()} result{results.length === 1 ? "" : "s"}
              </span>
              <span className="hidden sm:inline">↑↓ · Enter · Tab · Esc</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
