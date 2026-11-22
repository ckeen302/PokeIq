"use client";

/* eslint-disable @next/next/no-img-element -- MOCK: pre-recoloured sprites */
/* MOCK ONLY: the Shiny Studio on a phone: stage on top, parts as a strip, the colour editor in a bottom sheet. */

import { ArrowLeftRight, ChevronLeft, Dices, Eye, Lock, Pipette, Redo2, Share2, Sparkles, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { A, GradientSlider, HARMONIES, HarmonyChip, OklchWheel, PARTS, PokeballMark, RAMPS, RampSwatch, SEL, SEL_HEX, Twinkle } from "./studio-parts";

const FIRE = "#ee8130";
const FLYING = "#a98ff3";

function mask(url: string, background: string): React.CSSProperties {
  return { background, WebkitMaskImage: `url(${url})`, maskImage: `url(${url})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%" };
}

export function PhoneStudio() {
  return (
    <div className="-mx-4 -mt-6 flex flex-col" data-testid="shiny-studio-phone">
      {/* Top bar */}
      <div className="flex h-11 items-center gap-1 px-2">
        <button type="button" aria-label="Back to Tools" className="flex h-10 w-8 items-center justify-center text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 leading-none">
          <p className="font-display text-[15px] font-bold uppercase tracking-[0.04em]">
            Shiny <span className="studio-title-accent">Studio</span>
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Obsidian Ember · Charizard</p>
        </div>
        <div className="ml-auto flex items-center">
          <PhoneIcon label="Undo">
            <Undo2 className="h-[18px] w-[18px]" />
          </PhoneIcon>
          <PhoneIcon label="Redo" dim>
            <Redo2 className="h-[18px] w-[18px]" />
          </PhoneIcon>
          <button type="button" aria-label="Share" className="ml-1 flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 font-display text-xs font-semibold uppercase tracking-wider text-primary-foreground shadow-[0_3px_0_hsl(var(--primary-shadow))]">
            <Share2 className="h-4 w-4" /> Share
          </button>
        </div>
      </div>

      {/* Stage */}
      <div className="screen studio-stage relative mx-3 h-[288px] overflow-hidden rounded-xl border border-screen/25">
        <div className="absolute inset-0" style={{ background: `radial-gradient(55% 60% at 50% 56%, ${FIRE}38, ${FLYING}1c 50%, transparent 76%)` }} aria-hidden />
        <div className="studio-floor" aria-hidden />
        <PokeballMark className="inset-0 m-auto h-[92%] w-[92%] text-foreground/[0.045]" />
        <div className="absolute left-[calc(50%+12px)] top-0 z-[2] h-[288px] w-[288px] -translate-x-1/2">
          <div className="absolute left-[18%] right-[14%] top-[86%] h-[9%] rounded-[50%] bg-[radial-gradient(closest-side,rgb(0_0_0/0.6),transparent)]" aria-hidden />
          <img src={`${A}/px-yours.png`} alt="Charizard in your colours" className="studio-sprite absolute inset-0 h-full w-full [image-rendering:pixelated]" />
          <div className="absolute inset-0 mix-blend-screen" style={mask(`${A}/px-fill-wings.png`, "rgb(255 255 255 / 0.12)")} aria-hidden />
          <div className="studio-outline absolute inset-0" aria-hidden>
            <div className="absolute inset-0" style={mask(`${A}/px-line-wings.png`, "#fff")} />
          </div>
          <Twinkle className="studio-tw h-6 w-6" color="#8ff4ff" style={{ left: "0%", top: "38%" }} />
          <Twinkle className="studio-tw h-4 w-4 [animation-delay:-0.6s]" color="#ffe29a" style={{ left: "88%", top: "58%" }} />
          <Twinkle className="studio-tw h-3 w-3 [animation-delay:-1.2s]" color="#fff" style={{ left: "40%", top: "1%" }} />
        </div>
        {/* Style */}
        <div className="absolute left-2 top-2 z-[4] inline-flex rounded-full border border-white/10 bg-black/45 p-0.5 backdrop-blur-md">
          {["Pixel", "HD"].map((m, i) => (
            <span key={m} className={cn("flex h-7 items-center rounded-full px-3 font-display text-[11px] font-semibold uppercase tracking-[0.08em]", i === 0 ? "bg-primary/25 text-white shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.6)]" : "text-white/60")}>
              {m}
            </span>
          ))}
        </div>
        <span className="hud-label absolute right-2 top-2 z-[4] flex items-center gap-1 rounded-sm border border-warning/50 bg-black/40 px-1.5 py-1.5 text-warning">
          <Sparkles className="h-3 w-3" /> Yours
        </span>
        <div className="absolute bottom-2 left-2 z-[4] flex gap-1">
          <StageChip label="Vision">
            <Eye className="h-4 w-4" />
          </StageChip>
          <StageChip label="Compare">
            <ArrowLeftRight className="h-4 w-4" />
          </StageChip>
        </div>
        <button type="button" aria-label="Randomise" className="absolute bottom-2 right-2 z-[4] flex h-11 w-11 items-center justify-center rounded-full bg-screen text-[hsl(250_45%_8%)] shadow-[0_0_0_4px_hsl(var(--screen)/0.25),0_6px_18px_rgb(0_0_0/0.5)]">
          <Dices className="h-5 w-5" strokeWidth={2.3} />
        </button>
      </div>

      {/* Parts strip */}
      <div className="flex gap-1.5 overflow-x-hidden px-3 py-2 [mask-image:linear-gradient(90deg,#000_88%,transparent)]">
        {PARTS.filter((p) => !p.expert).map((p) => {
          const on = p.id === "wings";
          return (
            <span
              key={p.id}
              className={cn(
                "flex h-10 shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3",
                on ? "border-primary/70 bg-primary/[0.14] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.3)]" : "border-foreground/10 bg-card"
              )}
            >
              <RampSwatch ramp={RAMPS[p.id].yours} className="h-7 w-7" rounded="rounded-full" />
              <span className={cn("font-display text-[12px] font-bold uppercase tracking-[0.06em]", on ? "text-foreground" : "text-foreground/75")}>{p.short}</span>
              {p.locked && <Lock className="h-3 w-3 text-warning" strokeWidth={2.4} />}
            </span>
          );
        })}
      </div>

      {/* Bottom sheet */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 rounded-t-2xl border-t border-screen/25 bg-card shadow-[0_-18px_40px_rgb(0_0_0/0.55)]">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-foreground/20" aria-hidden />
        <div className="mt-1.5 flex border-b border-foreground/[0.07] px-3">
          {["Colour", "Start from", "Finish", "Effects"].map((t, i) => (
            <span key={t} className={cn("relative flex-1 py-2.5 text-center font-display text-[12px] font-semibold uppercase tracking-[0.08em]", i === 0 ? "text-foreground" : "text-muted-foreground")}>
              {t}
              {i === 0 && <span className="absolute inset-x-4 -bottom-px h-[3px] bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />}
            </span>
          ))}
        </div>
        <div className="space-y-3 px-4 pb-3 pt-3">
          <div className="flex gap-3">
            <OklchWheel size={122} ring={11} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-display text-[14px] font-bold uppercase tracking-[0.08em]">Wings</span>
                <span className="hud-label">Membrane</span>
              </div>
              <div className="flex h-9 overflow-hidden rounded-md shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]">
                {RAMPS.wings.yours.map((c) => (
                  <span key={c} className="flex-1" style={{ background: c }} />
                ))}
              </div>
              <div className="flex gap-1.5">
                <span className="flex h-9 min-w-0 flex-1 items-center gap-1 rounded-md border border-input bg-shade/40 px-2 font-mono text-[13px] uppercase">
                  <span className="text-muted-foreground">#</span>
                  {SEL_HEX.slice(1)}
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-input bg-shade/40 text-muted-foreground">
                  <Pipette className="h-4 w-4" />
                </span>
              </div>
            </div>
          </div>
          <GradientSlider
            compact
            label="Lightness"
            value={`${Math.round(SEL.l * 100)}%`}
            pct={SEL.l * 100}
            track={`linear-gradient(90deg in oklch, oklch(0.18 0.15 ${SEL.h}), oklch(0.6 0.15 ${SEL.h}), oklch(0.97 0.15 ${SEL.h}))`}
            thumb={SEL_HEX}
          />
          <GradientSlider
            compact
            label="Colour strength"
            value={`${Math.round((SEL.c / 0.22) * 100)}%`}
            pct={(SEL.c / 0.22) * 100}
            track={`linear-gradient(90deg in oklch, oklch(${SEL.l} 0 ${SEL.h}), oklch(${SEL.l} 0.22 ${SEL.h}))`}
            thumb={SEL_HEX}
          />
          <div className="-mx-4 flex gap-1.5 overflow-hidden px-4 [mask-image:linear-gradient(90deg,#000_85%,transparent)]">
            {HARMONIES.map((h) => (
              <span key={h.id} className="shrink-0">
                <HarmonyChip label={h.label} hues={h.hues} active={h.id === "complement"} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneIcon({ children, label, dim }: { children: React.ReactNode; label: string; dim?: boolean }) {
  return (
    <button type="button" aria-label={label} className={cn("flex h-10 w-9 items-center justify-center text-muted-foreground", dim && "opacity-35")}>
      {children}
    </button>
  );
}

function StageChip({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button type="button" aria-label={label} className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-black/45 text-white/80 backdrop-blur-md">
      {children}
    </button>
  );
}
