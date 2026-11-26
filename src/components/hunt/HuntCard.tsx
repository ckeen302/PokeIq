"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinned } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import huntNs from "@/messages/hunt";
import { formKey } from "./hunt-ui";

/** What a round shows of its Pokémon (never where it lives). */
export interface HuntPokemonView {
  /** Its name in the page's language, form included as the games write it ("Alolan Meowth"). */
  name: string;
  /** The entry's key ("52-alola"): its form tag comes from it. */
  id?: string;
  /** A form label to show as given, instead of the one worked out from `id`. */
  form?: string;
  /** National Pokédex number, shown small. */
  dex?: number;
  /** Official art of exactly this form. */
  art: string;
}

/** The form's tag ("Alolan Form"), from `form` or the entry's key; null for a base form. */
export function useFormTag(p: Pick<HuntPokemonView, "id" | "form">): string | null {
  return formTagOf(useT(huntNs), p);
}

/** The same, with the translator in hand (for lists). */
export function formTagOf(t: Translator<(typeof huntNs)["en"]>, p: Pick<HuntPokemonView, "id" | "form">): string | null {
  if (p.form) return p.form;
  const f = p.id ? formKey(p.id) : null;
  return f && t.has(`forms.${f}`) ? t(`forms.${f}` as "forms.alola") : null;
}

/**
 * The round's picture, where PokéGuessr shows its screenshot: the Pokémon's official art big in the
 * middle of a tracking-radar backdrop, the question with its name ("Where would you catch Gible?"), a tag
 * for its form (so a regional form is never in doubt), and under it `children`: the round's hints. It
 * fills the space the HUD leaves: between the notch and the corner dock on a computer, between the dials
 * and the bottom bar on a phone.
 */
export function HuntCard({ pokemon, priority, mapName, className, children }: {
  pokemon: HuntPokemonView;
  /** The game's first card: its art is fetched first. */
  priority?: boolean;
  /** A region's own map: its name ("On the Kanto map"). */
  mapName?: string;
  className?: string;
  /** The hints, under the question. */
  children?: React.ReactNode;
}) {
  const t = useT(huntNs);
  const [art, setArt] = useState<"loading" | "ready" | "failed">("loading");
  // The art can finish loading before the page is interactive (its onLoad never runs): read where it got to.
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = imgRef.current;
    setArt(img?.complete ? (img.naturalWidth ? "ready" : "failed") : "loading");
  }, [pokemon.art]);
  const formTag = useFormTag(pokemon);
  return (
    <div className={cn("relative flex h-full w-full flex-col items-center justify-center overflow-hidden", className)} data-testid="hunt-card">
      <Radar />
      <div className="relative z-[1] flex min-h-0 w-full flex-1 flex-col items-center justify-center px-4 pb-3 pt-[calc(env(safe-area-inset-top)+5.25rem)] md:px-[19vw] md:pb-[3vh] md:pt-[13vh]">
        {/* The art: a soft glow under it. */}
        <div className="relative flex aspect-square h-[min(31vh,64vw)] max-h-full min-h-[6.5rem] shrink items-center justify-center md:h-[min(40vh,34vw)]">
          <div className="absolute inset-[12%] rounded-full bg-[#6c5ce7]/35 blur-3xl" aria-hidden />
          {art !== "ready" && (
            <div className={cn("absolute inset-[18%] rounded-full", art === "loading" ? "animate-pulse bg-white/10" : "bg-white/5")} data-testid="hunt-art-placeholder">
              {art === "failed" && (
                <>
                  <PokeBallMark className="h-full w-full p-[18%] text-white/20" />
                  <span className="sr-only">{t("state.artFailed")}</span>
                </>
              )}
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- official art, served sized by /api/art */}
          <img
            key={pokemon.art}
            ref={imgRef}
            src={pokemon.art}
            alt={t("card.artAlt", { name: pokemon.name })}
            draggable={false}
            fetchPriority={priority ? "high" : undefined}
            onLoad={() => setArt("ready")}
            onError={() => setArt("failed")}
            className={cn("hunt-art relative h-full w-full select-none object-contain drop-shadow-[0_18px_30px_rgba(0,0,0,0.55)] transition-opacity duration-300", art === "ready" ? "opacity-100" : "opacity-0")}
            data-testid="hunt-art"
          />
        </div>

        <div className="mt-[1.2vh] flex max-w-full flex-col items-center text-center">
          {pokemon.dex !== undefined && (
            <p className="font-pixel text-[10px] tracking-wider text-[#c8bfff]/80" aria-hidden>
              #{String(pokemon.dex).padStart(4, "0")}
            </p>
          )}
          <h2 className="mt-1 max-w-full text-balance font-display text-[clamp(1.35rem,4vh,2.6rem)] font-bold uppercase italic leading-[1.02] tracking-tight text-white [overflow-wrap:anywhere] [text-shadow:0_3px_0_rgba(0,0,0,0.45)]" data-testid="hunt-question">
            {t.rich("card.question", {
              name: pokemon.name,
              b: (c) => (
                <span className="text-[1.3em] text-[#ffd23c]" data-testid="hunt-name">
                  {c}
                </span>
              ),
            })}
          </h2>
          {(formTag || mapName) && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              {formTag && (
                <span className="inline-flex max-w-full items-center rounded-full bg-[#e2306f] px-3 py-1 font-display text-xs font-bold uppercase tracking-[0.14em] text-white shadow-lg ring-2 ring-white/20 sm:text-sm" data-testid="hunt-form">
                  <span className="truncate">{formTag}</span>
                </span>
              )}
              {mapName && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1e1a3f]/90 px-3 py-1 font-display text-xs font-bold uppercase tracking-[0.14em] text-white ring-2 ring-[#a99cff]/60 sm:text-sm" data-testid="hunt-map-name">
                  <MapPinned className="h-3.5 w-3.5 shrink-0 text-[#9be15d]" aria-hidden />
                  {t("card.onMap", { map: mapName })}
                </span>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/** The tracking backdrop: faint rings sweeping out from the Pokémon, and a fine grid. Still under reduced motion. */
function Radar() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,#2d2766_0%,#1a163a_45%,#0f0d1f_80%)]" />
      <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="hunt-ring absolute left-1/2 top-1/2 h-[90vmin] w-[90vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#a99cff]/25" style={{ animationDelay: `${i * 1.6}s` }} />
        ))}
        <span className="absolute left-1/2 top-1/2 h-[56vmin] w-[56vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-[#a99cff]/15" />
      </div>
    </div>
  );
}

/** A plain Poké Ball outline, for art that didn't load. */
export function PokeBallMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="3" />
      <path d="M3 24h15M30 24h15" stroke="currentColor" strokeWidth="3" />
      <circle cx="24" cy="24" r="6" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}
