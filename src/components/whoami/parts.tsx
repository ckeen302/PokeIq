"use client";

import { useMemo, useState } from "react";
import { Check, Lock, Search, Sparkles, X, Zap } from "lucide-react";
import {
  BST_STEPS,
  COLOR_FAMILIES,
  HEIGHTS_DM,
  MAX_GEN_WHOAMI,
  STAT_KEYS,
  STAT_NAMES,
  STAT_STEPS,
  WEIGHTS_KG,
  WHOAMI_ABILITIES,
  ABILITY_INFO,
  WHOAMI_MOVES,
  WHOAMI_PP,
  WHOAMI_TYPES,
  parseQuestion,
  questionCost,
  questionText,
  titleCase,
  type WhoamiAbility,
  type WhoamiKnown,
  type WhoamiMine,
  type WhoamiPoolSettings,
} from "@/lib/whoami";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The pool's Pokémon as the browser knows them: number, name and abilities (public Pokédex data, never the secret). */
export type WhoamiDexEntry = [number, string, string[]];

export const spriteUrl = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
export const artUrl = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
export const fmt = (n: number) => n.toLocaleString("en-US");

export function PPBar({ pp, label = "PP", compact }: { pp: number; label?: string; compact?: boolean }) {
  const pct = Math.max(0, Math.min(100, (pp / WHOAMI_PP) * 100));
  return (
    <div className={cn("space-y-1", compact && "min-w-24")}>
      <div className="flex justify-between font-pixel text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className={cn("tabular-nums", pp <= 20 ? "text-warning" : "text-foreground")}>
          {pp}/{WHOAMI_PP}
        </span>
      </div>
      <div className="meter">
        <div className={cn("h-full transition-all duration-500", pp <= 20 ? "bg-warning" : "bg-screen")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

type Group = "type" | "basics" | "gen" | "size" | "stats" | "ability" | "move";
const GROUPS: { key: Group; label: string; cost: string }[] = [
  { key: "type", label: "Type", cost: "10" },
  { key: "basics", label: "Basics", cost: "10" },
  { key: "gen", label: "Generation", cost: "20" },
  { key: "size", label: "Size", cost: "20" },
  { key: "stats", label: "Stats", cost: "20" },
  { key: "ability", label: "Ability", cost: "25" },
  { key: "move", label: "Move", cost: "25" },
];

function chipsFor(group: Group, abilities: string[]): { q: string; label: string }[] {
  switch (group) {
    case "type":
      return WHOAMI_TYPES.map((t) => ({ q: `type:${t}`, label: titleCase(t) }));
    case "basics":
      return [
        { q: "dual", label: "Dual-typed?" },
        { q: "final", label: "Fully evolved?" },
        { q: "basic", label: "First stage?" },
        { q: "legend", label: "Legendary / mythical?" },
        ...Object.entries(COLOR_FAMILIES).map(([k, c]) => ({ q: `color:${k}`, label: `Mostly ${c.label}?` })),
        ...Array.from({ length: MAX_GEN_WHOAMI - 1 }, (_, i) => ({ q: `from:${i + 2}`, label: `Gen ${i + 2}+?` })),
      ];
    case "gen":
      return Array.from({ length: MAX_GEN_WHOAMI }, (_, i) => ({ q: `gen:${i + 1}`, label: `Gen ${i + 1}?` }));
    case "size":
      return [...HEIGHTS_DM.map((h) => ({ q: `height:${h}`, label: `Over ${h / 10} m?` })), ...WEIGHTS_KG.map((w) => ({ q: `weight:${w}`, label: `Over ${w} kg?` }))];
    case "stats":
      return [
        ...STAT_KEYS.flatMap((s) => STAT_STEPS.map((n) => ({ q: `stat:${s}:${n}`, label: `${STAT_NAMES[s]} > ${n}?` }))),
        ...BST_STEPS.map((n) => ({ q: `bst:${n}`, label: `Total > ${n}?` })),
      ];
    case "ability":
      return abilities.map((a) => ({ q: `ability:${a}`, label: titleCase(a) }));
    case "move":
      return Object.entries(WHOAMI_MOVES).map(([m, label]) => ({ q: `move:${m}`, label }));
  }
}

/** The question menu: every question by group, with its cost. Known ones show their answer. */
export function QuestionMenu({
  known,
  pp,
  disabled,
  abilities,
  onAsk,
}: {
  known: WhoamiKnown[];
  pp: number;
  /** Why questions are closed (locked out, taunted, solved), or null. */
  disabled: string | null;
  /** Abilities of the Pokémon still possible. */
  abilities: string[];
  onAsk: (q: string) => void;
}) {
  const [group, setGroup] = useState<Group>("type");
  const [filter, setFilter] = useState("");
  const answers = useMemo(() => new Map(known.map((k) => [k.q, k.yes])), [known]);
  const chips = chipsFor(group, abilities).filter((c) => group !== "ability" || c.label.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-3 rounded-md border bg-card p-3" data-testid="whoami-menu">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Question groups">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={group === g.key}
            onClick={() => setGroup(g.key)}
            className={cn(
              "rounded-md border px-2.5 py-1 font-display text-xs font-semibold uppercase tracking-wider transition",
              group === g.key ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:border-primary/50"
            )}
          >
            {g.label} <span className="font-pixel text-[9px] opacity-70">{g.cost}</span>
          </button>
        ))}
      </div>
      {group === "ability" && (
        <label className="flex items-center gap-2 rounded-md border bg-background px-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter abilities of the Pokémon left…" className="h-8 flex-1 bg-transparent text-sm outline-none" />
        </label>
      )}
      <div className={cn("flex max-h-64 flex-wrap gap-1.5 overflow-y-auto", group === "ability" && "max-h-48")}>
        {chips.map(({ q, label }) => {
          const parsed = parseQuestion(q)!;
          const cost = questionCost(parsed);
          const answer = answers.get(q);
          const type = group === "type" ? q.slice(5) : null;
          return (
            <button
              key={q}
              type="button"
              title={`${questionText(parsed)} (${cost} PP)`}
              disabled={answer !== undefined || !!disabled || cost > pp}
              onClick={() => onAsk(q)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition enabled:hover:-translate-y-px enabled:hover:shadow disabled:cursor-not-allowed",
                answer === undefined && (cost > pp || disabled) && "opacity-40",
                answer === true && "border-success bg-success/15 text-success",
                answer === false && "border-destructive/40 bg-destructive/10 text-destructive line-through decoration-1"
              )}
              style={type && answer === undefined ? { background: typeColor(type), color: typeTextColor(type), borderColor: "transparent" } : undefined}
            >
              {answer === true && <Check className="h-3 w-3" aria-hidden />}
              {answer === false && <X className="h-3 w-3" aria-hidden />}
              {label}
            </button>
          );
        })}
        {chips.length === 0 && <p className="text-sm text-muted-foreground">No abilities match.</p>}
      </div>
      {disabled && <p className="text-center text-xs font-semibold text-warning">{disabled}</p>}
    </div>
  );
}

/** What you know so far, newest first. */
export function KnownList({ known }: { known: WhoamiKnown[] }) {
  if (known.length === 0) return <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">Ask a question: every answer strikes Pokémon off the grid.</p>;
  return (
    <ol className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-card p-2 text-sm" aria-label="What you know" data-testid="whoami-known">
      {[...known].reverse().map((k) => (
        <li key={k.q} className="flex items-center gap-2 rounded px-1.5 py-1 odd:bg-shade/20">
          <span className={cn("w-9 shrink-0 rounded text-center font-pixel text-[10px]", k.yes ? "bg-success/20 text-success" : "bg-destructive/15 text-destructive")}>{k.yes ? "YES" : "NO"}</span>
          <span className="flex-1">{questionText(parseQuestion(k.q)!)}</span>
          {k.via !== "ask" && (
            <span className="hud-label flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" aria-hidden /> {k.via === "clue" ? "Clue" : "Traced"}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The grid: every Pokémon in the pool, struck out as answers rule it out. Click one, then guess it. */
export function PokeGrid({
  pool,
  mine,
  dex,
  locked,
  done,
  onGuess,
}: {
  pool: number[];
  mine: Pick<WhoamiMine, "alive" | "wrong">;
  dex: Map<number, WhoamiDexEntry>;
  /** Why guessing is closed right now, or null. */
  locked: string | null;
  done: boolean;
  onGuess: (id: number) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [hide, setHide] = useState(false);
  const alive = useMemo(() => new Set(mine.alive), [mine.alive]);
  const shown = hide ? pool.filter((id) => alive.has(id)) : pool;
  const pick = picked !== null && alive.has(picked) ? picked : null;
  return (
    <div className="space-y-2" data-testid="whoami-grid">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-display text-lg font-bold uppercase">
          <span className="text-screen tabular-nums" data-testid="whoami-left">
            {fmt(alive.size)}
          </span>{" "}
          <span className="text-sm text-muted-foreground">of {fmt(pool.length)} left</span>
        </p>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Hide struck
        </label>
        {!done && (
          <Button size="sm" variant="success" disabled={pick === null || !!locked} onClick={() => pick !== null && onGuess(pick)} data-testid="whoami-guess">
            <Zap className="h-3.5 w-3.5" aria-hidden />
            {locked ?? (pick !== null ? `Guess ${dex.get(pick)?.[1] ?? "it"}` : "Pick a Pokémon to guess")}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-1 rounded-md border bg-shade/10 p-2">
        {shown.map((id) => {
          const out = !alive.has(id);
          const wrong = mine.wrong.includes(id);
          const name = dex.get(id)?.[1] ?? `#${id}`;
          return (
            <button
              key={id}
              type="button"
              disabled={out || done}
              title={name}
              aria-label={out ? `${name} (ruled out)` : name}
              aria-pressed={pick === id}
              onClick={() => setPicked(id)}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-md border border-transparent transition duration-300",
                out ? "scale-90 opacity-20 grayscale" : "bg-card hover:border-primary/60",
                pick === id && "border-primary bg-primary/15 ring-2 ring-primary"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={spriteUrl(id)} alt="" width={56} height={56} loading="lazy" className="h-full w-full object-contain [image-rendering:pixelated]" />
              {wrong && <X className="absolute h-8 w-8 text-destructive" aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A countdown pill: locked out, taunted. */
export function LockPill({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
      <Lock className="h-3 w-3" aria-hidden /> {text}
    </span>
  );
}

/** Generation range and the legendaries switch; `onChange` absent: read-only. */
export function PoolPicker({ value, size, onChange, disabled }: { value: WhoamiPoolSettings; size?: number; onChange?: (s: WhoamiPoolSettings) => void; disabled?: boolean }) {
  const gens = Array.from({ length: MAX_GEN_WHOAMI }, (_, i) => i + 1);
  const select = "h-8 rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="hud-label">Generations</span>
      <select aria-label="From generation" className={select} value={value.from} disabled={!onChange || disabled} onChange={(e) => onChange?.({ ...value, from: Number(e.target.value), to: Math.max(value.to, Number(e.target.value)) })}>
        {gens.map((g) => (
          <option key={g} value={g}>
            Gen {g}
          </option>
        ))}
      </select>
      <span className="text-muted-foreground">to</span>
      <select aria-label="To generation" className={select} value={value.to} disabled={!onChange || disabled} onChange={(e) => onChange?.({ ...value, to: Number(e.target.value), from: Math.min(value.from, Number(e.target.value)) })}>
        {gens.map((g) => (
          <option key={g} value={g}>
            Gen {g}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={value.casual} disabled={!onChange || disabled} onChange={(e) => onChange?.({ ...value, casual: e.target.checked })} /> No legendaries
      </label>
      {size !== undefined && <span className="font-pixel text-[10px] text-muted-foreground" data-testid="whoami-pool-size">{fmt(size)} Pokémon</span>}
    </div>
  );
}

export function AbilityPicker({ value, onChange, disabled }: { value: WhoamiAbility; onChange?: (a: WhoamiAbility) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <p className="hud-label">Your trainer ability · once a round</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {WHOAMI_ABILITIES.map((a) => (
          <button
            key={a}
            type="button"
            disabled={!onChange || disabled}
            aria-pressed={value === a}
            onClick={() => onChange?.(a)}
            className={cn("rounded-md border p-2 text-left text-xs transition", value === a ? "border-primary bg-primary/10" : "hover:border-primary/50 disabled:opacity-60")}
          >
            <span className="block font-display text-sm font-bold uppercase">{ABILITY_INFO[a].label}</span>
            <span className="text-muted-foreground">{ABILITY_INFO[a].blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Abilities of the Pokémon still in `alive`, for the menu. */
export function aliveAbilities(alive: number[], dex: Map<number, WhoamiDexEntry>): string[] {
  const set = new Set<string>();
  for (const id of alive) for (const a of dex.get(id)?.[2] ?? []) set.add(a);
  return [...set].sort();
}
