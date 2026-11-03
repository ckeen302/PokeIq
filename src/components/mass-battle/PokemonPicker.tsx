"use client";

import { useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ChevronDown, Search } from "lucide-react";
import { boardArtUrl } from "@/lib/pokemon/art";
import { cn } from "@/lib/utils";

export interface PickerMon {
  id: number;
  slug: string;
  name: string;
  types: string[];
  /** Can it attack at all in this battle (has attacking moves by default)? */
  attacks: boolean;
  gen: number;
  /** "L" legendary, "M" mythical. */
  rank: "" | "L" | "M";
  fe: boolean;
  /** "mega", a region ("alola"…), or "" for a default form. */
  form: string;
}

const FORM_TAG: Record<string, string> = { mega: "Mega", alola: "Alola", galar: "Galar", hisui: "Hisui", paldea: "Paldea" };

/** A searchable Pokémon picker: type a name or a Pokédex number, pick from the matches (keyboard or pointer). Forms included. */
export function PokemonPicker({ label, value, list, onChange, testId, disabled }: { label: string; value: number; list: PickerMon[]; onChange(id: number): void; testId: string; disabled?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = list.find((p) => p.id === value);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list.slice(0, 40);
    if (/^#?\d+$/.test(q)) {
      const n = Number(q.replace("#", ""));
      return list.filter((p) => p.id === n || String(p.id).startsWith(String(n))).slice(0, 40);
    }
    const starts = list.filter((p) => p.name.toLowerCase().startsWith(q) || p.slug.startsWith(q));
    const has = list.filter((p) => !starts.includes(p) && (p.name.toLowerCase().includes(q) || p.slug.includes(q.replace(/\s+/g, "-"))));
    return [...starts, ...has].slice(0, 40);
  }, [list, query]);
  const choose = (p: PickerMon) => {
    onChange(p.id);
    setOpen(false);
    setQuery("");
  };
  return (
    <div className="relative min-w-0">
      <label htmlFor={`${id}-in`} className="font-pixel text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</label>
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen(true);
            setActive(0);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="mt-1 flex h-12 w-full items-center gap-2 rounded-lg border bg-card px-2 text-left transition-colors hover:border-screen/60 disabled:opacity-50"
          data-testid={testId}
          data-value={current?.slug ?? ""}
          aria-haspopup="listbox"
        >
          {current && <Image src={boardArtUrl(current.id)} alt="" width={40} height={40} className="h-10 w-10 shrink-0 object-contain" unoptimized />}
          <span className="min-w-0 flex-1 truncate font-display text-base font-bold uppercase tracking-wide">{current?.name ?? "Pick a Pokémon"}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      ) : (
        <div className="mt-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              id={`${id}-in`}
              ref={inputRef}
              value={query}
              placeholder="Search Pokémon"
              autoComplete="off"
              role="combobox"
              aria-expanded
              aria-controls={`${id}-list`}
              aria-activedescendant={matches[active] ? `${id}-o${matches[active].id}` : undefined}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(matches.length - 1, a + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                else if (e.key === "Enter" && matches[active]) { e.preventDefault(); choose(matches[active]); }
                else if (e.key === "Escape") setOpen(false);
              }}
              className="h-12 w-full rounded-lg border border-screen/60 bg-card pl-9 pr-3 font-display text-base font-semibold uppercase tracking-wide outline-none"
              data-testid={`${testId}-search`}
            />
          </div>
          <ul id={`${id}-list`} role="listbox" aria-label={label} className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-card p-1 shadow-xl">
            {matches.map((p, i) => (
              <li
                key={p.id}
                id={`${id}-o${p.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1", i === active && "bg-accent")}
                data-testid={`${testId}-option`}
                data-slug={p.slug}
              >
                <Image src={boardArtUrl(p.id)} alt="" width={32} height={32} className="h-8 w-8 object-contain" unoptimized />
                <span className="font-display text-sm font-semibold uppercase tracking-wide">{p.name}</span>
                {p.form && <span className="rounded bg-primary/15 px-1.5 py-0.5 font-pixel text-[8px] uppercase text-primary">{FORM_TAG[p.form] ?? p.form}</span>}
                <span className="ml-auto font-pixel text-[9px] uppercase text-muted-foreground">{p.id < 10000 ? `#${String(p.id).padStart(4, "0")}` : ""}</span>
                {!p.attacks && <span className="font-pixel text-[9px] uppercase text-destructive">No attacks</span>}
              </li>
            ))}
            {!matches.length && <li className="px-2 py-2 text-sm text-muted-foreground">No Pokémon by that name</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
