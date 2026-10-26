"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { artUrl } from "@/lib/pokemon/art";
import { NEA_GEN_REGIONS } from "@/lib/name-em-all/categories";
import type { NeaTarget } from "@/lib/name-em-all/types";
import { cn } from "@/lib/utils";

/** Pixel sprites from the games, or the official artwork thumbnails. */
export type SpriteStyle = "pixel" | "art";

const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

export function neaSpriteUrl(id: number, style: SpriteStyle, shiny: boolean): string {
  return style === "art" ? artUrl(id, 96, shiny) : `${SPRITES}/${shiny ? "shiny/" : ""}${id}.png`;
}

/** A fixed-size sprite: lazy, async, and never shifts the layout (falls back to the artwork if a pixel sprite is missing). */
export function Sprite({ id, style, shiny, size, className, silhouette, fluid }: { id: number; style: SpriteStyle; shiny: boolean; size: number; className?: string; silhouette?: boolean; fluid?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = neaSpriteUrl(id, style, shiny);
  const use = failed === src ? neaSpriteUrl(id, "art", shiny) : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={use}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(src)}
      className={cn("select-none object-contain", style === "pixel" && use === src && "[image-rendering:pixelated]", silhouette && "opacity-90 brightness-0 invert", className)}
      style={fluid ? undefined : { width: size, height: size }}
    />
  );
}

export type SlotState = "open" | "named" | "missed" | "current";

const pad = (n: number, total: number) => String(n).padStart(total > 999 ? 4 : 3, "0");

/** One slot of the grid: its number until named, then its sprite and name. After the end, missed ones show in red and link to the Pokédex. */
export const Slot = memo(function Slot({ target, state, style, shiny, digits, fresh }: { target: NeaTarget; state: SlotState; style: SpriteStyle; shiny: boolean; digits: number; fresh: boolean }) {
  const shown = state === "named" || state === "missed";
  const body = (
    <>
      <span className={cn("hud-label absolute left-1 top-1 text-[9px]", state === "current" && "text-screen")}>{pad(target.num, digits)}</span>
      <span className="flex h-12 w-12 items-center justify-center sm:h-16 sm:w-16">
        {shown ? <Sprite id={target.id} style={style} shiny={shiny} size={64} fluid className={cn("h-full w-full", state === "missed" && "opacity-60 grayscale")} /> : <span className={cn("font-display text-lg font-bold text-muted-foreground/40", state === "current" && "animate-pulse text-screen")}>?</span>}
      </span>
      <span className={cn("block w-full truncate px-0.5 text-center text-[10px] font-semibold leading-tight", state === "missed" ? "text-destructive" : "text-foreground/90", !shown && "invisible")}>{shown ? target.name : "·"}</span>
    </>
  );
  const cls = cn(
    "relative flex h-[78px] flex-col items-center justify-end overflow-hidden rounded-md border pb-1.5 pt-2.5 transition-colors sm:h-[96px]",
    state === "named" && "border-success/40 bg-success/[0.08]",
    state === "missed" && "border-destructive/40 bg-destructive/[0.07] hover:border-destructive",
    state === "open" && "border-border/70 bg-card/60",
    state === "current" && "border-screen bg-screen/10 ring-2 ring-screen/60",
    fresh && "animate-in zoom-in-90 fade-in duration-300"
  );
  if (state === "missed") {
    return (
      <Link href={`/pokemon/${target.slug}`} target="_blank" className={cls} title={`${target.name}: open its Pokédex page`} data-testid="nea-missed">
        {body}
      </Link>
    );
  }
  return (
    <div className={cls} data-slot={target.num} data-state={state} title={shown ? target.name : undefined}>
      {body}
    </div>
  );
});

export interface SlotGroup {
  key: string;
  label: string | null;
  slots: number[];
}

/** Big categories are grouped by generation so the grid reads like a dex; small ones are one block. */
export function groupSlots(targets: readonly NeaTarget[]): SlotGroup[] {
  const gens = new Set(targets.map((t) => t.gen));
  const grouped = targets.length > 60 && gens.size > 1 && !targets.some((t) => t.num !== t.species);
  if (!grouped) return [{ key: "all", label: null, slots: targets.map((_, i) => i) }];
  const out = new Map<number, number[]>();
  targets.forEach((t, i) => {
    const list = out.get(t.gen) ?? [];
    list.push(i);
    out.set(t.gen, list);
  });
  return [...out].sort((a, b) => a[0] - b[0]).map(([gen, slots]) => ({ key: `gen-${gen}`, label: `Gen ${gen} · ${NEA_GEN_REGIONS[gen - 1]}`, slots }));
}

export function SlotGrid({
  targets,
  groups,
  stateOf,
  style,
  shiny,
  fresh,
}: {
  targets: readonly NeaTarget[];
  groups: SlotGroup[];
  stateOf: (slot: number) => SlotState;
  style: SpriteStyle;
  shiny: boolean;
  fresh: number | null;
}) {
  const digits = Math.max(...targets.map((t) => t.num)) > 999 ? 4 : 3;
  return (
    <div className="space-y-5" data-testid="nea-grid">
      {groups.map((g) => {
        const done = g.slots.filter((s) => {
          const st = stateOf(s);
          return st === "named";
        }).length;
        return (
          <section key={g.key} aria-label={g.label ?? "Pokémon"} className="[content-visibility:auto] [contain-intrinsic-size:auto_600px]">
            {g.label && (
              <h2 className="mb-2 flex items-baseline justify-between gap-3 border-b border-border/60 pb-1">
                <span className="font-display text-sm font-bold uppercase tracking-wider">{g.label}</span>
                <span className="hud-label tabular-nums">
                  {done}/{g.slots.length}
                </span>
              </h2>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(54px,1fr))] gap-1 sm:grid-cols-[repeat(auto-fill,minmax(76px,1fr))] sm:gap-2">
              {g.slots.map((s) => (
                <Slot key={targets[s].id} target={targets[s]} state={stateOf(s)} style={style} shiny={shiny} digits={digits} fresh={fresh === s} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A labelled on/off switch. */
export function Toggle({ label, hint, checked, onChange, disabled, testId }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start justify-between gap-3 rounded-md border border-border/70 bg-background/40 px-3 py-2.5", disabled && "cursor-not-allowed opacity-50")}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span aria-hidden className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-shade/70 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-foreground/80 after:transition-transform peer-checked:bg-success peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ring" />
    </label>
  );
}
