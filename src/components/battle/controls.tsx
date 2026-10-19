"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Form controls shared by the team builder and the damage calculator. */

export const inputClass =
  "h-9 w-full min-w-0 rounded-md border-2 border-foreground/15 bg-shade/40 px-2.5 text-sm focus-visible:border-screen/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";

export const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

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

/** Type to search, arrows + Enter to pick. Shows `value` while closed; × clears it if `onClear` is given. */
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
  leading,
  limit = 80,
  className,
  listClassName,
  disabled,
}: {
  label: string;
  value: string;
  placeholder?: string;
  options: readonly T[];
  /** What to list before anything is typed (defaults to every option). */
  initial?: readonly T[];
  getKey: (option: T) => string;
  getText: (option: T) => string;
  render: (option: T) => React.ReactNode;
  onSelect: (option: T) => void;
  onClear?: () => void;
  header?: React.ReactNode;
  leading?: React.ReactNode;
  limit?: number;
  className?: string;
  listClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();

  const results = useMemo(() => {
    const q = normalize(query);
    if (!q) return (initial ?? options).slice(0, limit);
    const starts: T[] = [];
    const contains: T[] = [];
    for (const option of options) {
      const text = normalize(getText(option));
      if (text.startsWith(q)) starts.push(option);
      else if (text.includes(q)) contains.push(option);
    }
    return [...starts, ...contains].slice(0, limit);
  }, [query, options, initial, getText, limit]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setHighlight(0);
  };
  const pick = (option: T | undefined) => {
    if (!option) return;
    onSelect(option);
    close();
  };

  return (
    <div className={cn("relative min-w-0", className)}>
      {leading && <span className="pointer-events-none absolute inset-y-0 left-1 flex items-center">{leading}</span>}
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        value={open ? query : value}
        placeholder={open ? value || placeholder : placeholder}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onBlur={close}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open) pick(results[highlight]);
          } else if (e.key === "Escape") {
            close();
            (e.target as HTMLInputElement).blur();
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
          className="absolute inset-y-0 right-1 flex w-7 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {open && (
        <div
          className={cn(
            "absolute left-0 top-full z-40 mt-1 w-full min-w-[16rem] overflow-hidden rounded-md border-2 border-foreground/15 bg-card shadow-2xl",
            listClassName
          )}
        >
          {header && <div className="border-b border-foreground/10 bg-shade/40 px-2 py-1.5">{header}</div>}
          <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto overscroll-contain">
            {results.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No matches</li>}
            {results.map((option, i) => (
              <li
                key={getKey(option)}
                data-index={i}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(option)}
                onMouseEnter={() => setHighlight(i)}
                className={cn("cursor-pointer px-2 py-1 text-sm", i === highlight && "bg-screen/15")}
              >
                {render(option)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
