"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Search } from "lucide-react";
import { Sheet } from "@/components/pokedle/sheets";
import { spriteUrl } from "@/lib/pokemon/art";
import { PDK_FAMILY_LABELS, type PdkCategoryView, type PdkFamily, type PdkGridView } from "@/lib/pikadoku/types";
import { cn } from "@/lib/utils";

/** The pieces Pikadoku's solo page and its Tic Tac Toe duel share: the dex names, the board and the picker. */

export interface DexName {
  id: number;
  name: string;
  slug: string;
  /** The species (a form's own species id; equal to `id` for a species). */
  base: number;
  form?: boolean;
}

let dexPromise: Promise<DexName[]> | null = null;
/** The Pokémon names for the picker (no answers in them), fetched once. */
export function useDex(): DexName[] {
  const [dex, setDex] = useState<DexName[]>([]);
  useEffect(() => {
    dexPromise ??= fetch("/api/pikadoku/dex")
      .then((r) => (r.ok ? (r.json() as Promise<DexName[]>) : []))
      .catch(() => {
        dexPromise = null;
        return [];
      });
    let live = true;
    void dexPromise.then((d) => live && setDex(d));
    return () => {
      live = false;
    };
  }, []);
  return dex;
}

const FAMILY_TINT: Record<PdkFamily, string> = {
  types: "border-sky-400/50 bg-sky-400/10",
  regions: "border-emerald-400/50 bg-emerald-400/10",
  evolution: "border-fuchsia-400/50 bg-fuchsia-400/10",
  moves: "border-orange-400/50 bg-orange-400/10",
  abilities: "border-violet-400/50 bg-violet-400/10",
  other: "border-amber-400/50 bg-amber-400/10",
};

function Header({ cat, testId }: { cat: PdkCategoryView | undefined; testId: string }) {
  return (
    <div
      data-testid={testId}
      title={cat ? PDK_FAMILY_LABELS[cat.family] : undefined}
      className={cn("flex min-h-14 items-center justify-center rounded-md border px-1.5 py-1 text-center text-[11px] font-semibold leading-tight sm:text-sm", cat ? FAMILY_TINT[cat.family] : "border-foreground/10")}
    >
      {cat?.label ?? "…"}
    </div>
  );
}

export interface BoardCell {
  id: number | null;
  /** 0 or 1: the seat that owns it (duels). */
  owner?: 0 | 1 | null;
  pct?: number | null;
  /** Briefly flagged after a wrong guess. */
  miss?: boolean;
  highlight?: boolean;
}

/** The 3×3 grid with its category headers. */
export function PdkBoard({
  grid,
  cells,
  names,
  onCell,
  disabled,
  testPrefix = "pdk",
}: {
  grid: PdkGridView | null;
  cells: BoardCell[];
  names: Map<number, string>;
  onCell?: (cell: number) => void;
  disabled?: boolean;
  testPrefix?: string;
}) {
  return (
    <div className="mx-auto grid max-w-xl grid-cols-[minmax(4.5rem,0.8fr)_repeat(3,minmax(0,1fr))] gap-1.5" role="grid" aria-label="Pikadoku grid">
      <div />
      {[0, 1, 2].map((c) => (
        <Header key={c} cat={grid?.cols[c]} testId={`${testPrefix}-col-${c}`} />
      ))}
      {[0, 1, 2].flatMap((r) => [
        <Header key={`r${r}`} cat={grid?.rows[r]} testId={`${testPrefix}-row-${r}`} />,
        ...[0, 1, 2].map((c) => {
          const i = r * 3 + c;
          const cell = cells[i] ?? { id: null };
          const filled = cell.id !== null;
          const label = filled ? names.get(cell.id!) ?? `#${cell.id}` : "Empty";
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              data-testid={`${testPrefix}-cell-${i}`}
              disabled={disabled || filled || !onCell || !grid}
              onClick={() => onCell?.(i)}
              aria-label={`Row ${r + 1}, column ${c + 1}: ${label}`}
              className={cn(
                "relative flex aspect-square min-w-0 flex-col items-center justify-center rounded-md border-2 p-0.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filled
                  ? cell.owner === 1
                    ? "border-rose-400 bg-rose-400/15"
                    : cell.owner === 0
                      ? "border-sky-400 bg-sky-400/15"
                      : "border-primary/60 bg-primary/10"
                  : "border-dashed border-foreground/25 bg-card hover:border-primary hover:bg-primary/5 disabled:hover:border-foreground/25 disabled:hover:bg-card",
                cell.miss && "animate-pulse border-destructive bg-destructive/15",
                cell.highlight && "ring-2 ring-warning"
              )}
            >
              {filled ? (
                <>
                  <Image src={spriteUrl(cell.id!)} alt="" width={64} height={64} unoptimized className="h-10 w-10 sm:h-16 sm:w-16" style={{ imageRendering: "pixelated" }} />
                  <span className="max-w-full truncate text-[10px] font-semibold leading-tight sm:text-xs">{label}</span>
                  {cell.owner != null && <span className="absolute left-1 top-0.5 text-xs font-bold">{cell.owner === 0 ? "X" : "O"}</span>}
                  {cell.pct != null && (
                    <span data-testid={`${testPrefix}-pct-${i}`} className="absolute right-1 top-0.5 rounded bg-background/80 px-1 text-[10px] font-bold tabular-nums">
                      {cell.pct}%
                    </span>
                  )}
                </>
              ) : (
                <span className="text-2xl text-foreground/25" aria-hidden>
                  +
                </span>
              )}
            </button>
          );
        }),
      ])}
    </div>
  );
}

/** The searchable Pokémon picker for one cell. */
export function PdkPicker({ dex, used, title, busy, onPick, onClose }: { dex: DexName[]; used: ReadonlySet<number>; title: string; busy?: boolean; onPick: (p: DexName) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => input.current?.focus(), []);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const starts: DexName[] = [];
    const inside: DexName[] = [];
    // A form and its species are one Pokémon: using either rules out both.
    const usedBase = new Set(dex.filter((p) => used.has(p.id)).map((p) => p.base));
    for (const p of dex) {
      if (used.has(p.id) || usedBase.has(p.base)) continue;
      const n = p.name.toLowerCase();
      if (n.startsWith(s)) starts.push(p);
      else if (n.includes(s)) inside.push(p);
    }
    return [...starts, ...inside].slice(0, 8);
  }, [q, dex, used]);
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches[0] && !busy) onPick(matches[0]);
        }}
      >
        <label className="flex items-center gap-2 rounded-md border border-foreground/20 bg-card px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search for a Pokémon"
            aria-label="Search for a Pokémon"
            data-testid="pdk-search"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        </label>
        <ul className="space-y-1" aria-label="Matching Pokémon">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={busy}
                data-testid={`pdk-option-${p.id}`}
                onClick={() => onPick(p)}
                className="flex w-full items-center gap-3 rounded-md border border-foreground/10 px-2 py-1 text-left hover:border-primary hover:bg-primary/5 disabled:opacity-50"
              >
                <Image src={spriteUrl(p.id)} alt="" width={40} height={40} unoptimized className="h-10 w-10" style={{ imageRendering: "pixelated" }} />
                <span className="font-semibold">{p.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">#{p.id}</span>
              </button>
            </li>
          ))}
          {q.trim() && !matches.length && <li className="px-2 py-3 text-sm text-muted-foreground">No unused Pokémon match that.</li>}
        </ul>
      </form>
    </Sheet>
  );
}

export const iconButton =
  "relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-screen/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

export function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={cn("relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", checked ? "border-primary bg-primary" : "border-foreground/20 bg-shade/30")}
      >
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-foreground transition-[left]", checked ? "left-[1.1rem] bg-primary-foreground" : "left-0.5")} />
      </button>
    </label>
  );
}
