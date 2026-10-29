"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Image from "next/image";
import { Baby, BarChart3, Bone, Circle, Crown, Dna, GitBranch, Handshake, Info, Layers, Loader2, type LucideIcon, Maximize2, MapPin, Orbit, Rocket, Search, Sparkle, Sparkles, Swords, Trophy, Zap } from "lucide-react";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { Sheet } from "@/components/pokedle/sheets";
import { spriteUrl } from "@/lib/pokemon/art";
import { indexEntries, searchEntries } from "@/lib/pikadoku/search";
import { PDK_FAMILY_LABELS, categoryHint, type PdkCategoryView, type PdkFamily, type PdkGridView } from "@/lib/pikadoku/types";
import { cn } from "@/lib/utils";

/** The pieces Pikadoku's solo page and its Tic Tac Toe duel share: the dex names, the board and the picker. */

export interface DexName {
  id: number;
  name: string;
  /** The species (a form's own species id; equal to `id` for a species). */
  base: number;
}

let dexPromise: Promise<DexName[]> | null = null;
/** Starts loading the picker's names (no answers in them) once per page; a failure is retried on the next call. */
export function loadDex(): Promise<DexName[]> {
  dexPromise ??= fetch("/api/pikadoku/dex")
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<{ i: number; n: string; b?: number }[]>;
    })
    .then((rows) => rows.map((x) => ({ id: x.i, name: x.n, base: x.b ?? x.i })))
    .catch(() => {
      dexPromise = null;
      return [];
    });
  return dexPromise;
}
/**
 * The Pokémon names for the picker, fetched once (and cached by the browser for
 * a day). The fetch waits for the browser to go idle, so it never competes with
 * the board's first paint, and is still in hand well before the first search
 * (opening the picker starts it at once if it hasn't begun).
 */
export function useDex(): DexName[] {
  const [dex, setDex] = useState<DexName[]>([]);
  useEffect(() => {
    let live = true;
    const go = () => void loadDex().then((d) => live && setDex(d));
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (dexPromise || !w.requestIdleCallback) {
      go();
      return () => {
        live = false;
      };
    }
    const id = w.requestIdleCallback(go, { timeout: 1500 });
    // Pointing at or focusing a cell is a strong hint a search is next.
    const early = () => {
      w.cancelIdleCallback?.(id);
      go();
    };
    window.addEventListener("pointerdown", early, { once: true, capture: true });
    window.addEventListener("keydown", early, { once: true, capture: true });
    return () => {
      live = false;
      w.cancelIdleCallback?.(id);
      window.removeEventListener("pointerdown", early, { capture: true });
      window.removeEventListener("keydown", early, { capture: true });
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

const ICONS: Record<string, LucideIcon> = {
  "types:dual": Layers,
  "types:single": Circle,
  "other:legendary": Crown,
  "other:mythical": Sparkles,
  "other:lm": Crown,
  "other:fossil": Bone,
  "other:baby": Baby,
  "other:mega": Zap,
  "other:gmax": Maximize2,
  "other:paradox": Orbit,
  "other:ultrabeast": Rocket,
  "other:partner": Handshake,
  "other:ou": Trophy,
  "evo:branch": GitBranch,
};
const FAMILY_ICON: Record<PdkFamily, LucideIcon> = { types: Layers, regions: MapPin, evolution: Dna, moves: Swords, abilities: Sparkle, other: BarChart3 };

/** A category's icon: its own where it has one, else its family's. */
function CategoryIcon({ cat }: { cat: PdkCategoryView }) {
  const Icon = ICONS[cat.id] ?? FAMILY_ICON[cat.family];
  return <Icon className="h-3.5 w-3.5 shrink-0 opacity-80 sm:h-4 sm:w-4" aria-hidden />;
}

/**
 * A category label that always fits its header whole: it wraps only between
 * words (never inside one) and shrinks its font, down to 7px, until its longest
 * word fits the cell ("NO EVOLUTION LINE", "FLAMETHROWER" at 390px).
 */
function FitLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = -1;
    const fit = () => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      el.style.fontSize = "";
      el.style.letterSpacing = "";
      let size = parseFloat(getComputedStyle(el).fontSize);
      let tight = false;
      // Shrink to 8px, then drop the wide letter-spacing, then shrink to 6.5px at most (PROTOSYNTHESIS on a 360px phone).
      while (el.scrollWidth > el.clientWidth + 0.5) {
        if (size > 8) size -= 0.5;
        else if (!tight) tight = true;
        else if (size > 6.5) size -= 0.5;
        else break;
        el.style.fontSize = `${size}px`;
        if (tight) el.style.letterSpacing = "-0.01em";
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <span ref={ref} data-fit-label className="block w-full [hyphens:none] [overflow-wrap:normal] [word-break:normal]">
      {/* Each word (hyphenated ones too: SELF-DESTRUCT) stays on one line; lines break only at spaces. */}
      {text.split(" ").map((w, i) => (
        <span key={i}>
          {i > 0 && " "}
          <span className="whitespace-nowrap">{w}</span>
        </span>
      ))}
    </span>
  );
}

function Header({ cat, testId }: { cat: PdkCategoryView | undefined; testId: string }) {
  const [open, setOpen] = useState(false);
  const tipId = `${testId}-tip`;
  return (
    <div
      data-testid={testId}
      title={cat ? PDK_FAMILY_LABELS[cat.family] : undefined}
      className={cn("relative flex min-h-14 items-center justify-center rounded-md border px-1 py-1 sm:px-1.5 text-center text-[11px] font-bold leading-tight sm:text-sm", cat ? FAMILY_TINT[cat.family] : "border-foreground/10")}
      onMouseLeave={() => setOpen(false)}
    >
      {cat?.id.startsWith("type:") ? (
        <TypeBadge type={cat.id.slice(5)} size="md" className="max-w-full" />
      ) : (
        <span className="flex w-full min-w-0 flex-col items-center gap-0.5 font-display font-bold uppercase tracking-wide">
          {cat && <CategoryIcon cat={cat} />}
          {cat ? <FitLabel text={cat.label} /> : <span>…</span>}
        </span>
      )}
      {cat && (
        <>
          <button
            type="button"
            aria-label={`What counts for ${cat.label}`}
            aria-expanded={open}
            aria-describedby={open ? tipId : undefined}
            data-testid={`${testId}-info`}
            onClick={() => setOpen((o) => !o)}
            onMouseEnter={() => setOpen(true)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
          {open && (
            <span id={tipId} role="tooltip" data-testid={tipId} className={cn("absolute top-full z-30 mt-1 w-56 max-w-[70vw] rounded-md border border-foreground/20 bg-card p-2 text-left text-xs font-normal leading-snug text-foreground shadow-lg", testId.endsWith("-row-0") || testId.endsWith("-row-1") || testId.endsWith("-row-2") ? "left-0" : testId.endsWith("-col-2") ? "right-0" : "left-1/2 -translate-x-1/2")}>
              {categoryHint(cat.id)}
            </span>
          )}
        </>
      )}
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
  /** Briefly flagged after a right guess locks in. */
  hit?: boolean;
  highlight?: boolean;
}

/** The 3×3 grid with its category headers. */
export function PdkBoard({
  grid,
  cells,
  names,
  onCell,
  disabled,
  stealable,
  onType,
  testPrefix = "pdk",
}: {
  grid: PdkGridView | null;
  cells: BoardCell[];
  names: Map<number, string>;
  onCell?: (cell: number) => void;
  /** A letter or digit typed on a focused cell: open its search with that text. */
  onType?: (cell: number, text: string) => void;
  disabled?: boolean;
  /** Filled cells that can still be played (Steals mode: the opponent's). */
  stealable?: (cell: number) => boolean;
  testPrefix?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // Arrow keys move between the playable cells (skipping filled ones); typing on a cell searches for it.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const from = refs.current.indexOf(e.target as HTMLButtonElement);
    if (from < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (step) {
      e.preventDefault();
      let [r, c] = [Math.floor(from / 3), from % 3];
      for (;;) {
        r += step[0];
        c += step[1];
        if (r < 0 || r > 2 || c < 0 || c > 2) return;
        const el = refs.current[r * 3 + c];
        if (el && !el.disabled) return el.focus();
      }
    }
    if (onType && e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key) && !refs.current[from]?.disabled) {
      e.preventDefault();
      onType(from, e.key);
    }
  };
  return (
    <div className="mx-auto grid max-w-xl grid-cols-[minmax(4.5rem,0.8fr)_repeat(3,minmax(0,1fr))] gap-1.5" role="grid" aria-label="Pikadoku grid" onKeyDown={onKeyDown}>
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
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="gridcell"
              data-testid={`${testPrefix}-cell-${i}`}
              disabled={disabled || (filled && !stealable?.(i)) || !onCell || !grid}
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
                cell.miss && "animate-pulse border-solid border-destructive bg-destructive/15",
                cell.hit && "border-success bg-success/20 ring-2 ring-success/60",
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

/** The searchable Pokémon picker for one cell: forgiving search (accents, punctuation, typos, dex numbers), arrow keys and Enter. */
export function PdkPicker({ dex: given, used, title, busy, initialQuery = "", onPick, onClose }: { dex: DexName[]; used: ReadonlySet<number>; title: string; busy?: boolean; /** What was typed on the cell to open it. */ initialQuery?: string; onPick: (p: DexName) => void; onClose: () => void }) {
  // If the names failed to load with the page, try again now.
  const [retried, setRetried] = useState<DexName[]>([]);
  useEffect(() => {
    if (!given.length) void loadDex().then(setRetried);
  }, [given.length]);
  const dex = given.length ? given : retried;
  const [q, setQ] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    // Typing started on the cell: keep going after what was typed.
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const index = useMemo(() => indexEntries(dex), [dex]);
  // A form and its species are one Pokémon: using either rules out both.
  const usedBase = useMemo(() => new Set(dex.filter((p) => used.has(p.id)).map((p) => p.base)), [dex, used]);
  const isUsed = (p: DexName) => used.has(p.id) || usedBase.has(p.base);
  const matches = useMemo(() => searchEntries(index, q, 8), [index, q]);
  const pickable = matches.filter((p) => !isUsed(p));
  const activeId = pickable[Math.min(active, pickable.length - 1)]?.id;
  const loading = !dex.length;
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const p = pickable.find((x) => x.id === activeId);
          if (p && !busy) onPick(p);
        }}
      >
        <label className="flex items-center gap-2 rounded-md border-2 border-foreground/20 bg-card px-3 py-2 focus-within:border-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : <Search className="h-4 w-4 text-muted-foreground" aria-hidden />}
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = pickable.length;
                if (n) setActive((a) => (Math.min(a, n - 1) + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
              }
            }}
            placeholder={loading ? "Loading Pokémon…" : "Type a Pokémon's name"}
            aria-label="Search for a Pokémon"
            aria-controls="pdk-options"
            aria-activedescendant={activeId ? `pdk-opt-${activeId}` : undefined}
            data-testid="pdk-search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            className="min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        </label>
        {/* A fixed height for eight rows, so the sheet doesn't jump while typing. */}
        <ul id="pdk-options" role="listbox" className="min-h-[22rem] space-y-1" aria-label="Matching Pokémon">
          {matches.map((p) => {
            const taken = isUsed(p);
            const on = p.id === activeId;
            return (
              <li key={p.id} id={`pdk-opt-${p.id}`} role="option" aria-selected={on} aria-disabled={taken}>
                <button
                  type="button"
                  disabled={busy || taken}
                  data-testid={`pdk-option-${p.id}`}
                  onClick={() => onPick(p)}
                  onMouseEnter={() => !taken && setActive(pickable.indexOf(p))}
                  className={cn(
                    "flex h-10 w-full items-center gap-3 rounded-md border px-2 text-left transition-colors disabled:cursor-not-allowed",
                    on ? "border-primary bg-primary/10" : "border-foreground/10 hover:border-primary hover:bg-primary/5",
                    taken && "opacity-45"
                  )}
                >
                  <Image src={spriteUrl(p.id)} alt="" width={40} height={40} unoptimized className="h-10 w-10 shrink-0" style={{ imageRendering: "pixelated" }} />
                  <span className="min-w-0 truncate font-semibold">{p.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{taken ? "Used" : p.base === p.id ? `#${p.id}` : "Form"}</span>
                </button>
              </li>
            );
          })}
          {!q.trim() && (
            <li className="px-2 py-3 text-sm text-muted-foreground" data-testid="pdk-search-tip">
              Start typing: spelling doesn&apos;t have to be perfect. Forms like Alolan Raichu or Mega Charizard X are their own picks. Enter picks the highlighted one.
            </li>
          )}
          {q.trim() && !matches.length && <li className="px-2 py-3 text-sm text-muted-foreground">{loading ? "Loading Pokémon…" : "No Pokémon match that."}</li>}
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
