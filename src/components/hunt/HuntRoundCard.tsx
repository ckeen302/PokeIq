"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinned } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";
import type { HuntMode, HuntRoundPublic } from "@/lib/hunt/types";
import { formKey } from "./hunt-ui";

/**
 * The round's picture, where PokéGuessr shows its screenshot: the Pokémon's
 * official art big in the middle of a tracking-radar backdrop, its name, a
 * tag for its form (so a regional form is never in doubt) and how many
 * regions it lives in, with how many pins to drop. It fills the space the
 * HUD leaves: between the notch and the corner dock on a computer, between
 * the dials and the bottom bar on a phone.
 */
export function HuntRoundCard({ round, mode, mapName, className }: { round: HuntRoundPublic; mode: HuntMode; /** Region mode: the map's name. */ mapName?: string; className?: string }) {
  const t = useT(huntNs);
  const [art, setArt] = useState<"loading" | "ready" | "failed">("loading");
  // The art can finish loading before the page is interactive (its onLoad never runs): read where it got to.
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = imgRef.current;
    setArt(img?.complete ? (img.naturalWidth ? "ready" : "failed") : "loading");
  }, [round.art]);
  const form = formKey(round.id);
  const formTag = form && t.has(`forms.${form}`) ? t(`forms.${form}` as "forms.alola") : null;
  const found = mode === "region" && mapName ? t("card.foundIn", { map: mapName }) : t("card.found", { n: round.regions });
  const instruction = round.pins <= 1 ? t("card.dropOne") : round.regions > round.pins ? t("card.dropUpTo", { max: round.pins }) : t("card.dropEach");
  return (
    <div className={cn("relative flex h-full w-full flex-col items-center justify-center overflow-hidden", className)} data-testid="hunt-round-card">
      <Radar />
      <div className="relative z-[1] flex min-h-0 w-full flex-1 flex-col items-center justify-center px-4 pb-3 pt-[calc(env(safe-area-inset-top)+5.75rem)] md:px-[19vw] md:pb-[3vh] md:pt-[14vh]">
        {/* The art: a soft glow under it, a gentle float once it's in. */}
        <div className="relative flex aspect-square h-[min(38vh,78vw)] max-h-full min-h-[8rem] shrink items-center justify-center md:h-[min(46vh,38vw)]">
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
            key={round.art}
            ref={imgRef}
            src={round.art}
            alt={t("card.artAlt", { name: round.name })}
            draggable={false}
            fetchPriority={round.index === 0 ? "high" : undefined}
            onLoad={() => setArt("ready")}
            onError={() => setArt("failed")}
            className={cn("hunt-art relative h-full w-full select-none object-contain drop-shadow-[0_18px_30px_rgba(0,0,0,0.55)] transition-opacity duration-300", art === "ready" ? "opacity-100" : "opacity-0")}
            data-testid="hunt-art"
          />
        </div>

        <div className="mt-[1.4vh] flex max-w-full flex-col items-center text-center">
          <p className="font-pixel text-[10px] tracking-wider text-[#c8bfff]/80" aria-hidden>
            #{String(round.dex).padStart(4, "0")}
          </p>
          <h2 className="mt-1 max-w-full font-display text-[clamp(1.75rem,5.4vh,3.75rem)] font-bold uppercase italic leading-[0.95] tracking-tight text-white [overflow-wrap:anywhere] [text-shadow:0_3px_0_rgba(0,0,0,0.45)]" data-testid="hunt-name">
            {round.name}
          </h2>
          {formTag && (
            <span className="mt-2 inline-flex max-w-full items-center rounded-full bg-[#e2306f] px-3 py-1 font-display text-xs font-bold uppercase tracking-[0.14em] text-white shadow-lg ring-2 ring-white/20 sm:text-sm" data-testid="hunt-form">
              <span className="truncate">{formTag}</span>
            </span>
          )}
          <p className="mt-[1.5vh] inline-flex items-center gap-2 rounded-full bg-[#1e1a3f]/90 py-1.5 pl-2 pr-4 font-display text-base font-bold uppercase italic tracking-wide text-white shadow-lg ring-2 ring-[#a99cff]/70 sm:text-lg" data-testid="hunt-found-in">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4cbb17]" aria-hidden>
              <MapPinned className="h-4 w-4" />
            </span>
            {found}
          </p>
          <p className="mt-1.5 text-sm font-medium text-[#c8bfff]" data-testid="hunt-instruction">
            {instruction}
          </p>
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
