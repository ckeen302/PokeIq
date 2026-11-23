"use client";

/* eslint-disable @next/next/no-img-element -- Pokémon pictures from the roster (the site's own renders or PokéAPI's), lazy and sized by their box */
import { useState } from "react";
import { Sparkles, WandSparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Translator } from "@/i18n/catalog";
import type picker from "@/messages/favorite-picker";
import { artUrl, isPixelUrl, type ArtStyle } from "@/lib/tier-list/art";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { FORM_KINDS, POOL_CATEGORIES, poolGens, poolTypes, type PoolConfig } from "@/lib/favorite-picker/pool";
import type { Mon, TypeName } from "@/lib/tier-list/types";

export type PickerT = Translator<typeof picker.en>;

/** A Pokémon's picture: lazy, and falling back to the other style, then to the normal colours, when one is missing. */
export function MonArt({ mon, art, shiny, className, eager }: { mon: Mon; art: ArtStyle; shiny: boolean; className?: string; eager?: boolean }) {
  const tries = [artUrl(mon, art, shiny), artUrl(mon, art === "hd" ? "pixel" : "hd", shiny), ...(shiny ? [artUrl(mon, art, false)] : [])];
  const [n, setN] = useState(0);
  const src = tries[Math.min(n, tries.length - 1)];
  return (
    <img
      key={src}
      src={src}
      alt=""
      draggable={false}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setN((v) => (v < tries.length - 1 ? v + 1 : v))}
      className={cn("pointer-events-none select-none object-contain", isPixelUrl(src) && "[image-rendering:pixelated]", className)}
    />
  );
}

export function typeName(t: PickerT, type: string): string {
  return t(`typeNames.${type as TypeName}`);
}

export function TypeChip({ t, type, className }: { t: PickerT; type: string; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold", className)} style={{ background: typeColor(type), color: typeTextColor(type) }}>
      {typeName(t, type)}
    </span>
  );
}

/** "All Pokémon", or "Gen 1, Gen 2 · Fire · Starters · with forms". */
export function poolLabel(t: PickerT, c: PoolConfig): string {
  const parts: string[] = [];
  const gens = poolGens(c);
  if (gens.length) parts.push(gens.map((g) => t("setup.genN", { n: g })).join(", "));
  const types = poolTypes(c);
  if (types.length) parts.push(types.map((ty) => typeName(t, ty)).join(", "));
  if (c.cat !== "all") parts.push(t(`setup.categories.${c.cat}`));
  if (!parts.length) parts.push(t("result.allPokemon"));
  if (c.forms) parts.push(t("result.withForms"));
  return parts.join(" · ");
}

export { FORM_KINDS, POOL_CATEGORIES };

/** A round toggle for a slot's shiny colours. */
export function ShinyToggle({ on, onChange, label, size = "md", testId }: { on: boolean; onChange(v: boolean): void; label: string; size?: "sm" | "md"; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      data-testid={testId}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        size === "sm" ? "h-10 w-10" : "h-11 w-11",
        on ? "bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))]" : "text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
      )}
    >
      <Sparkles className="h-[18px] w-[18px]" aria-hidden />
    </button>
  );
}

/** A link into the Shiny Pokémon Maker with the Pokémon loaded (nothing while its data hasn't loaded). */
export function ShinyMakerLink({ href, label, compact, testId }: { href: string | null; label: string; compact?: boolean; testId?: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      aria-label={compact ? label : undefined}
      title={label}
      data-testid={testId}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "h-10 w-10" : "h-10 bg-foreground/[0.07] px-4 text-sm font-semibold text-foreground hover:bg-foreground/[0.11] max-md:h-11"
      )}
    >
      <WandSparkles className="h-4 w-4" aria-hidden />
      {!compact && label}
    </a>
  );
}

export function Toast({ text }: { text: string | null }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[90] flex justify-center px-4 lg:bottom-8">
      {text && (
        <div className="tlm-rise rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-xl" data-testid="fp-toast">
          {text}
        </div>
      )}
    </div>
  );
}
