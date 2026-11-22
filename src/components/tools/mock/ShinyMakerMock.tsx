"use client";

/* eslint-disable @next/next/no-img-element -- MOCK: pre-recoloured sprites */
/* MOCK ONLY: three simple directions for the Shiny Pokémon Maker, as static pictures for review. Nothing is wired up. */

import { ChevronDown, Dices, Ellipsis, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AVATAR, Dot, Hero, HueRail, HueRing, MAKER_CSS, PARTS, SEL_HEX, Segmented, Swatches, TonePlane } from "./maker-parts";

export type Direction = "a" | "b" | "c";

/** Fills the window under the header. */
const FULL = "h-[calc(100dvh-108px)] min-h-[680px]";

export function ShinyMakerMock({ direction, popover }: { direction: Direction; popover: boolean }) {
  return (
    <>
      <div className="lg:hidden">
        <PhoneA />
      </div>
      <div className="max-lg:hidden" data-testid="shiny-maker-mock">
        {direction === "a" && <DirectionA popover={popover} />}
        {direction === "b" && <DirectionB />}
        {direction === "c" && <DirectionC popover={popover} />}
      </div>
      <style>{MAKER_CSS}</style>
    </>
  );
}

function Title({ className, center }: { className?: string; center?: boolean }) {
  return (
    <header className={cn(center && "text-center", className)}>
      <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight">Shiny Pokémon Maker</h1>
      <p className="mt-1 text-[15px] text-muted-foreground">Design your own shiny Pokémon.</p>
    </header>
  );
}

function Avatar({ size = 36 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground/[0.06]" style={{ width: size, height: size }}>
      <img src={AVATAR} alt="" width={size} height={size} className="scale-[1.15] object-contain" />
    </span>
  );
}

function IconButton({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cn("flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground", className)}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ A: Stage + dock */

function DirectionA({ popover }: { popover: boolean }) {
  return (
    <section className={cn("maker-stage relative -mt-2 rounded-[28px] border border-foreground/[0.06]", FULL)}>
      <Title className="absolute left-9 top-8" />
      <Segmented className="absolute right-8 top-8" items={["Normal", "Official", "Yours"]} value="Yours" />
      {/* With a colour open, the Pokémon glides up and steps back a little, so the popover never covers it. */}
      <div className={cn("absolute inset-0 flex justify-center", popover ? "items-start pt-[22px]" : "items-center pb-20")}>
        <Hero scale={popover ? 5 : 6} />
      </div>
      <Dock popover={popover} />
    </section>
  );
}

function Dock({ popover }: { popover: boolean }) {
  return (
    <div className="maker-dock absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full p-1.5">
      <button type="button" className="flex h-11 items-center gap-2.5 rounded-full pl-1 pr-3.5 transition-colors hover:bg-foreground/[0.06]">
        <Avatar size={36} />
        <span className="text-[15px] font-medium">Charizard</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
      </button>
      <span className="mx-1.5 h-6 w-px bg-foreground/10" aria-hidden />
      {PARTS.map((p) => {
        const on = p.id === "wings";
        return (
          <div key={p.id} className="relative">
            {on && popover && <ColourPopover />}
            <button
              type="button"
              aria-pressed={on}
              className={cn(
                "flex h-11 items-center gap-2 rounded-full pl-3 pr-4 text-[14px] transition-colors",
                on ? "bg-foreground/[0.1] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground"
              )}
            >
              <Dot color={p.color} size={18} />
              {p.name}
            </button>
          </div>
        );
      })}
      <span className="mx-1.5 h-6 w-px bg-foreground/10" aria-hidden />
      <IconButton label="Effects and more">
        <Ellipsis className="h-5 w-5" />
      </IconButton>
      <button type="button" className="flex h-11 items-center gap-2 rounded-full px-4 text-[14px] text-foreground/70 transition-colors hover:bg-foreground/[0.05] hover:text-foreground">
        <Dices className="h-[18px] w-[18px]" aria-hidden /> Randomise
      </button>
      <Button className="ml-1 h-11 rounded-full px-5 shadow-none active:shadow-none">
        <Share className="h-4 w-4" aria-hidden /> Share
      </Button>
    </div>
  );
}

function ColourPopover() {
  return (
    <div className="maker-pop absolute bottom-full left-1/2 mb-4 flex -translate-x-1/2 gap-5 rounded-[24px] p-4 pr-5" role="dialog" aria-label="Wings colour">
      <HueRing size={176} ring={12} />
      <div className="flex w-[132px] flex-col justify-center gap-4">
        <Swatches className="grid grid-cols-4 gap-x-3 gap-y-3.5" size={24} />
        <div className="flex items-center justify-between border-t border-foreground/[0.07] pt-3.5 text-[13px]">
          <span className="font-mono tracking-wide text-muted-foreground">{SEL_HEX.toUpperCase()}</span>
          <button type="button" className="text-muted-foreground transition-colors hover:text-foreground">Reset</button>
        </div>
      </div>
      <span className="maker-pop absolute -bottom-[7px] left-1/2 h-3.5 w-3.5 -translate-x-1/2 rotate-45 rounded-[3px] [clip-path:polygon(100%_0,100%_100%,0_100%)]" aria-hidden />
    </div>
  );
}

/* ------------------------------------------------------------------ B: Split */

function DirectionB() {
  return (
    <div className={cn("-mt-2 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5", FULL)}>
      <section className="maker-stage relative rounded-[28px] border border-foreground/[0.06]">
        <Title className="absolute left-9 top-8" />
        <Segmented className="absolute right-8 top-8" items={["Pixel", "HD"]} value="Pixel" />
        <div className="absolute inset-0 flex items-center justify-center pt-10">
          <Hero scale={6} />
        </div>
      </section>
      <aside className="flex flex-col rounded-[28px] border border-foreground/[0.06] bg-card/70 p-6">
        <div className="flex items-center gap-3">
          <button type="button" className="-ml-1.5 flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-1.5 text-left transition-colors hover:bg-foreground/[0.05]">
            <Avatar size={44} />
            <span className="text-[17px] font-semibold">Charizard</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          </button>
          <IconButton label="Effects and more">
            <Ellipsis className="h-5 w-5" />
          </IconButton>
        </div>

        <ul className="mt-5 space-y-1" aria-label="Parts">
          {PARTS.map((p) => {
            const on = p.id === "wings";
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  className={cn(
                    "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] transition-colors",
                    on ? "bg-foreground/[0.08] text-foreground" : "text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground"
                  )}
                >
                  <Dot color={p.color} size={20} />
                  {p.name}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 space-y-6">
          <TonePlane width={348} height={210} className="!w-full" radius={14} />
          <HueRail />
          <Swatches size={28} />
        </div>

        <div className="mt-auto grid grid-cols-2 gap-3 pt-6">
          <Button variant="outline" className="h-11 rounded-full shadow-none active:shadow-none">
            <Dices className="h-4 w-4" aria-hidden /> Randomise
          </Button>
          <Button className="h-11 rounded-full shadow-none active:shadow-none">
            <Share className="h-4 w-4" aria-hidden /> Share
          </Button>
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ C: Palette strip */

function DirectionC({ popover }: { popover: boolean }) {
  return (
    <section className={cn("relative -mt-2 flex flex-col items-center", FULL)}>
      <Title className="absolute left-1 top-1" />
      <Segmented className="mt-2" items={["Normal", "Official", "Yours"]} value="Yours" />
      <div className="flex flex-1 items-center justify-center">
        <Hero scale={5.5} />
      </div>
      <div className="flex items-start gap-5 pb-2">
        <PaletteItem label="Charizard">
          <Avatar size={60} />
        </PaletteItem>
        <span className="mt-[14px] h-8 w-px bg-foreground/10" aria-hidden />
        {PARTS.map((p) => (
          <div key={p.id} className="relative">
            {p.id === "wings" && popover && <MiniPicker />}
            <PaletteItem label={p.name} on={p.id === "wings"}>
              <Dot color={p.color} size={60} ring={p.id === "wings"} />
            </PaletteItem>
          </div>
        ))}
        <span className="mt-[14px] h-8 w-px bg-foreground/10" aria-hidden />
        <PaletteItem label="Randomise">
          <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-dashed border-foreground/20 text-muted-foreground">
            <Dices className="h-5 w-5" aria-hidden />
          </span>
        </PaletteItem>
        <Button className="ml-3 mt-[6px] h-12 rounded-full px-7 shadow-none active:shadow-none">
          <Share className="h-4 w-4" aria-hidden /> Share
        </Button>
      </div>
    </section>
  );
}

function PaletteItem({ label, on, children }: { label: string; on?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" className="group flex w-[68px] flex-col items-center gap-2.5">
      {children}
      <span className={cn("text-[13px]", on ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>{label}</span>
    </button>
  );
}

function MiniPicker() {
  return (
    <div className="maker-pop absolute bottom-full left-1/2 mb-4 w-[260px] -translate-x-1/2 space-y-4 rounded-[22px] p-4" role="dialog" aria-label="Wings colour">
      <TonePlane width={228} height={132} className="!w-full" radius={12} />
      <HueRail />
      <Swatches size={20} />
    </div>
  );
}

/* ------------------------------------------------------------------ Phone (A) */

function PhoneA() {
  return (
    <div className="-mx-1 space-y-4" data-testid="shiny-maker-phone">
      <Title className="px-1 [&_h1]:text-[22px] [&_p]:text-sm" />
      <section className="maker-stage relative flex h-[404px] items-center justify-center rounded-[24px] border border-foreground/[0.06]">
        <Segmented size="sm" className="absolute left-1/2 top-3 -translate-x-1/2" items={["Normal", "Official", "Yours"]} value="Yours" />
        <Hero scale={3.5} className="mt-9" />
      </section>
      <div className="flex items-center justify-between">
        <button type="button" className="flex h-11 items-center gap-2.5 rounded-full pr-3">
          <Avatar size={36} />
          <span className="text-[15px] font-medium">Charizard</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        </button>
        <IconButton label="Effects and more">
          <Ellipsis className="h-5 w-5" />
        </IconButton>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {PARTS.map((p) => {
          const on = p.id === "wings";
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 rounded-full border pl-3 pr-4 text-[14px]",
                on ? "border-foreground/20 bg-foreground/[0.1] text-foreground" : "border-foreground/[0.07] text-foreground/70"
              )}
            >
              <Dot color={p.color} size={18} />
              {p.name}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3 pt-1">
        <Button variant="outline" className="h-12 rounded-full shadow-none active:shadow-none">
          <Dices className="h-4 w-4" aria-hidden /> Randomise
        </Button>
        <Button className="h-12 rounded-full shadow-none active:shadow-none">
          <Share className="h-4 w-4" aria-hidden /> Share
        </Button>
      </div>
    </div>
  );
}
