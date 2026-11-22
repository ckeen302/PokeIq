"use client";

/* eslint-disable @next/next/no-img-element -- MOCK: pre-recoloured sprites */
/* MOCK ONLY: a static, non-working picture of the Shiny Studio editor for review. Nothing here is wired up. */

import {
  ArrowLeftRight,
  ChevronDown,
  Copy,
  Dices,
  Download,
  Eye,
  History,
  ImageDown,
  Link2,
  Lock,
  LockOpen,
  Pause,
  Pipette,
  Redo2,
  Search,
  Share2,
  Sparkles,
  SunMedium,
  Undo2,
  Wand2,
  X,
  ZoomIn,
  Film,
  PenLine,
  Layers,
  Shuffle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { cn } from "@/lib/utils";
import { hexOf } from "./oklch";
import {
  A,
  GradientSlider,
  HARMONIES,
  HarmonyChip,
  NOTICE,
  OklchWheel,
  PARTS,
  PRESETS,
  PokeballMark,
  RAMPS,
  RampSwatch,
  SEL,
  SEL_HEX,
  SpriteFrame,
  Twinkle,
} from "./studio-parts";
import { ShareSheet } from "./ShareSheet";
import { PhoneStudio } from "./PhoneStudio";

export type StudioView = "pixel" | "hd" | "share";

const FIRE = "#ee8130";
const FLYING = "#a98ff3";

export function ShinyStudioMock({ view }: { view: StudioView }) {
  const hd = view === "hd";
  return (
    <>
      <div className="lg:hidden">
        <PhoneStudio />
      </div>
      <div
        className="studio-mock -mt-4 mx-[calc(50%-50vw+20px)] grid h-[calc(100dvh-56px-36px)] min-h-[760px] grid-rows-[auto_minmax(0,1fr)] gap-3 max-lg:hidden"
        data-testid="shiny-studio-mock"
      >
        <Toolbar hd={hd} />
        <div className="grid min-h-0 grid-cols-[256px_minmax(0,1fr)_388px] gap-3">
          <LeftRail hd={hd} />
          <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-3">
            <Stage hd={hd} />
            <CompareStrip hd={hd} />
          </div>
          <RightPanel />
        </div>
      </div>
      {view === "share" && <ShareSheet />}
      <style>{STUDIO_CSS}</style>
    </>
  );
}

/* ---------------------------------------------------------------- Toolbar */

function IconBtn({ children, label, disabled, active }: { children: React.ReactNode; label: string; disabled?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-35",
        active && "bg-accent text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("rounded-[4px] border border-foreground/15 bg-shade/40 px-1.5 py-[3px] font-pixel text-[8px] uppercase leading-none tracking-[0.1em] text-muted-foreground shadow-[0_1px_0_hsl(var(--foreground)/0.12)]", className)}>
      {children}
    </kbd>
  );
}

function Toolbar({ hd }: { hd: boolean }) {
  return (
    <div className="flex h-[52px] items-center gap-3 rounded-lg border bg-card/80 px-3 pl-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <span className="studio-gem relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md" aria-hidden>
          <Sparkles className="h-4 w-4 text-white" strokeWidth={2.4} />
        </span>
        <div className="min-w-0 leading-none">
          <p className="hud-label flex items-center gap-1.5 text-screen">
            Tools <span className="text-muted-foreground/60">//</span> <span className="text-muted-foreground">Studio</span>
          </p>
          <h1 className="mt-1 font-display text-[19px] font-bold uppercase leading-none tracking-[0.04em]">
            Shiny <span className="studio-title-accent">Studio</span>
          </h1>
        </div>
        <span className="mx-1 h-7 w-px bg-foreground/10" aria-hidden />
        <button type="button" className="group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-foreground/10 hover:bg-shade/30">
          <RampSwatch ramp={[RAMPS.body.yours[1], RAMPS.wings.yours[0], RAMPS.flame.yours[1]]} className="h-4 w-7" rounded="rounded-[3px]" />
          <span className="font-display text-[14px] font-semibold tracking-wide">Obsidian Ember</span>
          <PenLine className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" aria-hidden />
        </button>
        <span className="hud-label hidden items-center gap-1.5 2xl:flex">
          <span className="led h-1.5 w-1.5 text-success" aria-hidden /> Saved
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <IconBtn label="Undo (Ctrl+Z)">
          <Undo2 className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Redo (Ctrl+Shift+Z)" disabled>
          <Redo2 className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="History">
          <History className="h-4 w-4" />
        </IconBtn>
        <span className="mx-1.5 h-6 w-px bg-foreground/10" aria-hidden />
        <Button variant="outline" size="sm" className="h-9 gap-2 pr-2">
          <Dices className="h-4 w-4 text-screen" /> Randomise <Kbd>Space</Kbd>
        </Button>
        <span className="mx-1.5 h-6 w-px bg-foreground/10" aria-hidden />
        <div role="group" aria-label="Mode" className="inline-flex shrink-0 rounded-full border border-foreground/10 bg-foreground/[0.04] p-0.5">
          {["Simple", "Expert"].map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={m === "Simple"}
              className={cn(
                "flex h-8 items-center rounded-full px-3.5 font-display text-[11px] font-semibold uppercase tracking-[0.08em]",
                m === "Simple" ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="mx-1.5 h-6 w-px bg-foreground/10" aria-hidden />
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-md border border-input bg-shade/40 pl-2.5 pr-2 font-display text-[13px] font-semibold uppercase tracking-[0.08em] transition-colors hover:border-screen/60"
        >
          <Eye className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="font-pixel text-[9px] font-normal tracking-[0.12em] text-muted-foreground">Vision</span>
          Typical
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.6} aria-hidden />
        </button>
        {hd && (
          <>
            <span className="mx-1.5 h-6 w-px bg-foreground/10" aria-hidden />
            <Button size="sm" className="h-9">
              <Share2 className="h-4 w-4" /> Share
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Left rail */

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-lg border bg-card/90", className)}>{children}</section>;
}

function PanelHead({ title, aside, index }: { title: string; aside?: React.ReactNode; index?: number }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3.5 pb-2.5 pt-3">
      <h2 className="flex items-baseline gap-2 font-display text-[13px] font-bold uppercase tracking-[0.1em]">
        {index !== undefined && <span className="font-pixel text-[9px] tracking-widest text-primary">{String(index).padStart(2, "0")} //</span>}
        {title}
      </h2>
      {aside}
    </div>
  );
}

function LeftRail({ hd }: { hd: boolean }) {
  return (
    <aside className="flex min-h-0 flex-col gap-3">
      <Panel className="hud">
        <PanelHead index={1} title="Pokémon" aside={<Kbd>/</Kbd>} />
        <div className="space-y-3 px-3.5 pb-3.5">
          <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-shade/40 px-2.5 text-sm text-muted-foreground">
            <Search className="h-4 w-4" aria-hidden />
            <span>Search Pokémon</span>
            <Dices className="ml-auto h-4 w-4 text-muted-foreground/80" aria-label="Random Pokémon" />
          </label>
          {/* Current Pokémon */}
          <div className="flex items-center gap-3 rounded-md border border-foreground/10 bg-shade/25 p-2">
            <span className="screen relative block h-[60px] w-[60px] shrink-0 rounded-md">
              <span className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 60%, ${FIRE}55, transparent 70%)` }} />
              <SpriteFrame src={`${A}/px-normal.png`} className="absolute inset-0 z-[1] scale-[1.25]" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <p className="hud-label text-screen">No.0006</p>
              <p className="font-display text-lg font-bold uppercase leading-none tracking-tight">Charizard</p>
              <div className="flex gap-1">
                <TypeBadge type="fire" size="sm" />
                <TypeBadge type="flying" size="sm" />
              </div>
            </div>
          </div>
          {/* Style */}
          <div className="space-y-1.5">
            <p className="hud-label">Style</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: "pixel", label: "Pixel", hint: "B/W sprite", src: `${A}/px-yours.png`, px: true },
                { id: "hd", label: "HD", hint: "HOME art", src: `${A}/hd-yours.png`, px: false },
              ].map((s) => {
                const on = (s.id === "hd") === hd;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    className={cn(
                      "group relative flex items-center gap-2 overflow-hidden rounded-md border p-1.5 pr-2 text-left transition-colors",
                      on ? "border-primary/60 bg-primary/[0.12] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]" : "border-foreground/10 bg-shade/25 hover:border-screen/50"
                    )}
                  >
                    <span className="relative block h-9 w-9 shrink-0 rounded-[5px] bg-black/30">
                      <SpriteFrame src={s.src} pixel={s.px} className="absolute inset-0" imgClassName={s.px ? "scale-125" : "scale-[1.35] translate-y-[-8%]"} />
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className={cn("block font-display text-[13px] font-bold uppercase tracking-[0.08em]", on ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
                      <span className="block whitespace-nowrap text-[10px] text-muted-foreground">{s.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="flex min-h-0 flex-1 flex-col">
        <PanelHead index={2} title="Start from" />
        <div className="grid grid-cols-3 gap-1.5 px-3.5">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="preset-tile group flex flex-col items-center gap-1 rounded-md border border-foreground/10 bg-shade/25 px-1 pb-1.5 pt-1 transition-colors hover:border-screen/50">
              <span className="relative block h-[72px] w-full overflow-hidden rounded-[5px] bg-[radial-gradient(circle_at_50%_70%,hsl(var(--screen)/0.16),transparent_70%)]">
                <SpriteFrame src={hd ? p.src : p.src} className="absolute inset-0" imgClassName="scale-[1.22] translate-y-[3%]" />
                {p.id === "official" && <Twinkle className="right-1 top-1 h-2.5 w-2.5" color="#ffe066" />}
              </span>
              <span className="w-full truncate text-center font-display text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground group-hover:text-foreground">
                {p.label}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-auto space-y-1.5 p-3.5 pt-3">
          <button type="button" className="group flex w-full items-center gap-2.5 rounded-md border border-dashed border-foreground/20 bg-shade/20 p-1.5 pr-2.5 text-left transition-colors hover:border-screen/60">
            <span className="relative block h-9 w-9 shrink-0 rounded-[5px] bg-black/30">
              <SpriteFrame src={`${A}/gengar.png`} className="absolute inset-0" imgClassName="scale-[1.3]" />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block font-display text-[12px] font-bold uppercase tracking-[0.08em]">Steal colours</span>
              <span className="block text-[11px] text-muted-foreground">from another Pokémon</span>
            </span>
            <Wand2 className="h-4 w-4 text-screen" aria-hidden />
          </button>
        </div>
      </Panel>
    </aside>
  );
}

/* ---------------------------------------------------------------- Stage */

/** Sprite coordinates (0–96) to a percentage of the 6× sprite box. */
const sp = (v: number) => `${(v / 96) * 100}%`;

function Stage({ hd }: { hd: boolean }) {
  return (
    <section
      className="screen studio-stage hud relative min-h-0 overflow-hidden rounded-lg border border-screen/25"
      aria-label="Stage"
      data-testid="studio-stage"
    >
      {/* Type-coloured backdrop (Fire / Flying) */}
      <div className="absolute inset-0" style={{ background: `radial-gradient(52% 58% at 50% 54%, ${FIRE}36, ${FLYING}1c 48%, transparent 74%)` }} aria-hidden />
      <div className="studio-floor" aria-hidden />
      <PokeballMark className="inset-0 m-auto h-[88%] w-[88%] text-foreground/[0.045]" />

      {/* HUD */}
      <div className="absolute left-3 top-3 z-[4] flex items-center gap-2">
        <span className="hud-label flex items-center gap-1.5 rounded-sm bg-black/45 px-2 py-1.5 text-screen backdrop-blur-sm">
          <span className="led h-1.5 w-1.5 text-success" aria-hidden /> {hd ? "HD · HOME render" : "Live sprite · Pixel"}
        </span>
      </div>
      <div className="absolute right-3 top-3 z-[4] flex items-center gap-2">
        <span className="hud-label flex items-center gap-1.5 rounded-sm border border-warning/50 bg-warning/10 px-2 py-1.5 text-warning backdrop-blur-sm">
          <Sparkles className="h-3 w-3" aria-hidden /> Yours
        </span>
      </div>

      {hd ? <HdCompare /> : <PixelArt />}

      {/* Stage controls */}
      <div className="absolute inset-x-3 bottom-3 z-[5] flex items-end justify-between gap-3">
        <div className="flex items-center gap-1 rounded-md border border-foreground/10 bg-black/45 p-1 backdrop-blur-md">
          <StageBtn label="Pause animation">
            <Pause className="h-3.5 w-3.5" />
          </StageBtn>
          <StageBtn label="Zoom">
            <ZoomIn className="h-3.5 w-3.5" />
          </StageBtn>
          <span className="px-1.5 font-pixel text-[9px] uppercase tracking-[0.12em] text-white/70">{hd ? "Fit" : "6×"}</span>
        </div>
        {!hd && (
          <p className="hud-label mb-2 hidden items-center gap-2 normal-case tracking-wider text-white/55 xl:flex">
            Click a part on the Pokémon to colour it
          </p>
        )}
        <div className="flex items-center gap-1 rounded-md border border-foreground/10 bg-black/45 p-1 backdrop-blur-md">
          <StageBtn label="Compare" active={hd}>
            <ArrowLeftRight className="h-3.5 w-3.5" />
            <span className="font-pixel text-[9px] uppercase tracking-[0.12em]">Compare</span>
          </StageBtn>
          <StageBtn label="Background">
            <Layers className="h-3.5 w-3.5" />
            <span className="font-pixel text-[9px] uppercase tracking-[0.12em]">Type</span>
          </StageBtn>
          <StageBtn label="Replay sparkle">
            <Sparkles className="h-3.5 w-3.5" />
          </StageBtn>
        </div>
      </div>
    </section>
  );
}

function StageBtn({ children, label, active }: { children: React.ReactNode; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-[5px] px-1.5 text-white/75 transition-colors hover:bg-white/10 hover:text-white",
        active && "bg-primary/25 text-white shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.6)]"
      )}
    >
      {children}
    </button>
  );
}

function PixelArt() {
  return (
    <div className="absolute left-1/2 top-[calc(50%-10px)] z-[2] aspect-square h-[min(576px,96%)] -translate-x-1/2 -translate-y-1/2">
      {/* Floor shadow + aura */}
      <div className="absolute left-[18%] right-[14%] top-[86%] h-[9%] rounded-[50%] bg-[radial-gradient(closest-side,rgb(0_0_0/0.6),transparent)]" aria-hidden />
      <div className="absolute inset-[12%] rounded-full bg-[radial-gradient(closest-side,rgb(0_227_245/0.16),transparent)] blur-xl" aria-hidden />
      <img src={`${A}/px-yours.png`} alt="Charizard in your colours" className="studio-sprite absolute inset-0 h-full w-full [image-rendering:pixelated]" draggable={false} />
      {/* Hovered part: Wings (membrane) */}
      <div className="absolute inset-0 mix-blend-screen" style={mask(`${A}/px-fill-wings.png`, "rgb(255 255 255 / 0.13)")} aria-hidden />
      <div className="studio-outline absolute inset-0" aria-hidden>
        <div className="absolute inset-0" style={mask(`${A}/px-line-wings.png`, "#fff")} />
      </div>
      {/* Hover label */}
      <div className="absolute z-[3] flex flex-col items-start" style={{ left: sp(60), top: sp(2.5) }}>
        <span className="flex items-center gap-2 rounded-md border border-white/25 bg-[hsl(250_45%_8%/0.88)] py-1.5 pl-1.5 pr-2.5 shadow-[0_8px_24px_rgb(0_0_0/0.5)] backdrop-blur-md">
          <RampSwatch ramp={RAMPS.wings.yours} className="h-5 w-5" />
          <span className="leading-tight">
            <span className="block font-display text-[12px] font-bold uppercase tracking-[0.08em] text-white">Wings</span>
            <span className="block font-pixel text-[8px] uppercase tracking-[0.12em] text-white/60">Membrane · Click to edit</span>
          </span>
        </span>
        <span className="ml-5 h-7 w-px bg-gradient-to-b from-white/80 to-white/0" aria-hidden />
      </div>
      {/* The pointer */}
      <svg viewBox="0 0 24 24" className="absolute z-[4] h-6 w-6 drop-shadow-[0_2px_3px_rgb(0_0_0/0.7)]" style={{ left: sp(67.5), top: sp(29) }} aria-hidden>
        <path d="M3 2l7.5 19 2.6-7.7L21 10.6z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      {/* Sparkle */}
      <Twinkle className="studio-tw h-9 w-9" color="#8ff4ff" style={{ left: sp(8), top: sp(10) }} />
      <Twinkle className="studio-tw h-4 w-4 [animation-delay:-1s]" color="#ffe29a" style={{ left: sp(3), top: sp(20) }} />
      <Twinkle className="studio-tw h-5 w-5 [animation-delay:-0.5s]" color="#ffffff" style={{ left: sp(88), top: sp(58) }} />
      <Twinkle className="studio-tw h-3 w-3 [animation-delay:-1.4s]" color="#8ff4ff" style={{ left: sp(84), top: sp(70) }} />
      <Twinkle className="studio-tw h-6 w-6 [animation-delay:-0.8s]" color="#ffe29a" style={{ left: sp(40), top: sp(0) }} />
      <Twinkle className="studio-tw h-3.5 w-3.5 [animation-delay:-0.3s]" color="#ffffff" style={{ left: sp(4), top: sp(66) }} />
    </div>
  );
}

function mask(url: string, background: string): React.CSSProperties {
  return {
    background,
    WebkitMaskImage: `url(${url})`,
    maskImage: `url(${url})`,
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
    imageRendering: "pixelated",
  };
}

const CUT = 47;

function HdCompare() {
  return (
    <div className="absolute inset-0 z-[2]">
      {/* Yours: the whole stage */}
      <div className="absolute inset-0">
        <HdArt src={`${A}/hd-yours.png`} glow />
      </div>
      {/* Normal: clipped to the left of the handle */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - CUT}% 0 0)` }}>
        <div className="absolute inset-0 bg-[hsl(250_45%_6%/0.35)]" />
        <HdArt src={`${A}/hd-normal.png`} />
      </div>
      {/* Side labels */}
      <span className="hud-label absolute top-14 z-[3] rounded-sm bg-black/50 px-2 py-1.5 text-white/85 backdrop-blur-sm" style={{ right: `calc(${100 - CUT}% + 14px)` }}>
        ◀ Normal
      </span>
      <span className="hud-label absolute top-14 z-[3] rounded-sm border border-warning/50 bg-black/50 px-2 py-1.5 text-warning backdrop-blur-sm" style={{ left: `calc(${CUT}% + 14px)` }}>
        Yours ▶
      </span>
      {/* Handle, mid-drag */}
      <div className="absolute inset-y-0 z-[4] w-0" style={{ left: `${CUT}%` }}>
        <div className="absolute inset-y-0 -left-px w-[2px] bg-white shadow-[0_0_12px_hsl(var(--screen)),0_0_2px_rgb(0_0_0/0.8)]" />
        <div className="absolute left-0 top-[52%] flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 scale-110 items-center justify-center rounded-full border-2 border-white bg-[hsl(250_45%_10%/0.85)] text-white shadow-[0_0_0_6px_hsl(var(--screen)/0.25),0_10px_28px_rgb(0_0_0/0.6)] backdrop-blur-md">
          <ArrowLeftRight className="h-5 w-5" strokeWidth={2.4} />
        </div>
        <span className="absolute left-0 top-[calc(52%+40px)] -translate-x-1/2 whitespace-nowrap rounded-sm bg-white px-1.5 py-1 font-pixel text-[8px] uppercase tracking-[0.12em] text-[hsl(250_45%_10%)]">
          Drag
        </span>
      </div>
      <Twinkle className="studio-tw h-8 w-8" color="#8ff4ff" style={{ left: "84%", top: "38%" }} />
      <Twinkle className="studio-tw h-4 w-4 [animation-delay:-1s]" color="#ffe29a" style={{ left: "77%", top: "18%" }} />
      <Twinkle className="studio-tw h-5 w-5 [animation-delay:-0.6s]" color="#fff" style={{ left: "60%", top: "84%" }} />
    </div>
  );
}

function HdArt({ src, glow }: { src: string; glow?: boolean }) {
  return (
    <div className="absolute left-1/2 top-[calc(50%-58px)] aspect-square h-[min(640px,108%)] -translate-x-1/2 -translate-y-1/2">
      <div className="absolute left-[16%] right-[12%] top-[90%] h-[7%] rounded-[50%] bg-[radial-gradient(closest-side,rgb(0_0_0/0.65),transparent)]" aria-hidden />
      <img
        src={src}
        alt=""
        className={cn("absolute inset-0 h-full w-full object-contain", glow ? "drop-shadow-[0_0_24px_rgb(0_227_245/0.22)]" : "drop-shadow-[0_18px_24px_rgb(0_0_0/0.45)]")}
        draggable={false}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Compare strip */

function CompareStrip({ hd }: { hd: boolean }) {
  const items = [
    { id: "normal", label: "Normal", src: hd ? `${A}/hd-normal.png` : `${A}/px-normal.png`, side: hd ? "L" : undefined },
    { id: "official", label: "Official", src: hd ? `${A}/hd-official.png` : `${A}/px-official.png` },
    { id: "yours", label: "Yours", src: hd ? `${A}/hd-yours.png` : `${A}/px-yours.png`, side: hd ? "R" : undefined, on: true },
  ];
  const official = Math.min(1, (hd ? NOTICE.hdOfficial : NOTICE.official) / 0.4);
  const yours = Math.min(1, (hd ? NOTICE.hdYours : NOTICE.yours) / 0.4);
  return (
    <section className="flex h-[124px] min-w-0 items-stretch gap-3 rounded-lg border bg-card/90 p-2.5" aria-label="Compare">
      <div className="flex gap-2">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            aria-pressed={!!it.on}
            className={cn(
              "group relative flex w-[92px] flex-col overflow-hidden rounded-md border text-left transition-colors",
              it.on ? "border-warning/70 shadow-[0_0_0_1px_hsl(var(--warning)/0.35),0_0_24px_hsl(var(--warning)/0.18)]" : "border-foreground/10 hover:border-screen/50"
            )}
          >
            <span className="screen relative block flex-1">
              <span className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 62%, ${FIRE}33, transparent 70%)` }} />
              <SpriteFrame src={it.src} pixel={!hd} className="absolute inset-0 z-[1]" imgClassName={hd ? "scale-[1.25] translate-y-[-9%]" : "scale-[1.15]"} />
              {it.on && <Twinkle className="right-1.5 top-1.5 z-[3] h-3 w-3" color="#ffe29a" />}
              {it.side && (
                <span className="absolute left-1.5 top-1.5 z-[3] flex h-4 w-4 items-center justify-center rounded-[3px] bg-white font-pixel text-[8px] leading-none text-[hsl(250_45%_10%)]">{it.side}</span>
              )}
            </span>
            <span className={cn("flex h-6 items-center justify-center bg-shade/40 font-display text-[10.5px] font-bold uppercase tracking-[0.08em]", it.on ? "text-warning" : "text-muted-foreground")}>
              {it.label}
            </span>
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5 border-l border-foreground/[0.07] pl-4 pr-1">
        <div className="flex items-baseline justify-between gap-3 whitespace-nowrap">
          <span className="font-display text-[12px] font-bold uppercase tracking-[0.1em]">How noticeable</span>
          <span className="font-display text-[12px] font-bold uppercase tracking-[0.08em] text-warning">Unmissable</span>
        </div>
        <div className="relative pt-4">
          <div className="meter h-3 !overflow-visible">
            <div className="absolute inset-y-0 left-0 rounded-sm bg-gradient-to-r from-screen/70 via-primary to-warning" style={{ width: `${yours * 100}%` }} />
          </div>
          <Marker at={official} label="Official" muted />
          <Marker at={yours} label="Yours" />
        </div>
        <div className="flex justify-between font-pixel text-[8px] uppercase tracking-[0.14em] text-muted-foreground/70">
          <span>Subtle</span>
          <span>Clear</span>
          <span>Unmissable</span>
        </div>
      </div>

      <div className="flex flex-col justify-center gap-2 border-l border-foreground/[0.07] pl-3">
        <Button size="sm" className="h-10 w-[136px]">
          <Share2 className="h-4 w-4" /> Share
        </Button>
        <Button variant="outline" size="sm" className="h-10 w-[136px] justify-between pr-2.5">
          <span className="flex items-center gap-2">
            <Download className="h-4 w-4" /> Download
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>
    </section>
  );
}

function Marker({ at, label, muted }: { at: number; label: string; muted?: boolean }) {
  return (
    <span className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${at * 100}%` }}>
      <span className={cn("mb-1 whitespace-nowrap font-pixel text-[8px] uppercase tracking-[0.12em]", muted ? "text-muted-foreground" : "text-foreground")}>{label}</span>
      <span className={cn("h-[18px] w-[3px] rounded-full", muted ? "bg-foreground/60" : "bg-white shadow-[0_0_8px_hsl(var(--warning))]")} />
    </span>
  );
}

/* ---------------------------------------------------------------- Right panel */

function RightPanel() {
  return (
    <aside className="studio-scroll flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card/90">
      <PanelHead index={3} title="Parts" aside={<span className="hud-label normal-case tracking-wider">or click one on the Pokémon</span>} />
      <div className="grid grid-cols-2 gap-1.5 px-3.5">
        {PARTS.map((p) => {
          const on = p.id === "wings";
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              className={cn(
                "group relative flex h-[38px] items-center gap-2 rounded-md border pl-1.5 pr-1 text-left transition-colors",
                on ? "border-primary/60 bg-primary/[0.12] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]" : "border-foreground/10 bg-shade/25 hover:border-screen/50",
                p.expert && "opacity-50"
              )}
            >
              <RampSwatch ramp={RAMPS[p.id].yours} className="h-6 w-6 shrink-0" />
              <span className="min-w-0 flex-1 leading-tight">
                <span className={cn("block truncate font-display text-[12px] font-bold uppercase tracking-[0.06em]", on ? "text-foreground" : "text-foreground/85")}>{p.short}</span>
                <span className="block truncate font-mono text-[10px] uppercase text-muted-foreground">{p.expert ? "Expert" : p.id === "wings" ? SEL_HEX : mean(RAMPS[p.id].yours)}</span>
              </span>
              <span
                className={cn(
                  "flex h-7 w-6 shrink-0 items-center justify-center rounded-[4px]",
                  p.locked ? "text-warning" : "text-muted-foreground/45 group-hover:text-muted-foreground"
                )}
                title={p.locked ? "Locked: Randomise skips it" : "Lock"}
              >
                {p.locked ? <Lock className="h-3.5 w-3.5" strokeWidth={2.4} /> : <LockOpen className="h-3.5 w-3.5" />}
              </span>
            </button>
          );
        })}
      </div>

      {/* Colour editor */}
      <div className="mx-3.5 mt-2.5 rounded-lg border border-foreground/10 bg-shade/20 p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEL_HEX, boxShadow: `0 0 10px ${SEL_HEX}` }} />
            <span className="font-display text-[13px] font-bold uppercase tracking-[0.08em]">Wings</span>
            <span className="hud-label normal-case tracking-wider">membrane</span>
          </div>
          <button type="button" className="flex items-center gap-1 font-pixel text-[9px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
            <Shuffle className="h-3 w-3" /> Reset part
          </button>
        </div>
        <div className="flex gap-3.5">
          <OklchWheel size={150} />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            {/* Shade ramp */}
            <div>
              <p className="hud-label mb-1.5">Shades</p>
              <div className="flex h-11 overflow-hidden rounded-md shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]">
                {RAMPS.wings.yours.map((c, i) => (
                  <span key={c} className="relative flex flex-1 items-end justify-start p-1" style={{ background: c }}>
                    <span className="font-pixel text-[7px] uppercase tracking-[0.1em] text-black/55">{i === 0 ? "Light" : "Shadow"}</span>
                  </span>
                ))}
              </div>
            </div>
            {/* Hex + eyedropper */}
            <div className="flex gap-1.5">
              <label className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-input bg-shade/40 px-2.5">
                <span className="font-mono text-sm text-muted-foreground">#</span>
                <span className="font-mono text-sm uppercase tracking-wide">{SEL_HEX.slice(1)}</span>
                <Copy className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              </label>
              <button type="button" aria-label="Eyedropper" title="Eyedropper: pick a colour from anywhere" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-shade/40 text-muted-foreground hover:border-screen/60 hover:text-foreground">
                <Pipette className="h-4 w-4" />
              </button>
            </div>
            <p className="font-mono text-[10.5px] tracking-tight text-muted-foreground">
              L {SEL.l.toFixed(2)} · C {SEL.c.toFixed(2)} · H {SEL.h}°
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-2.5">
          <GradientSlider
            label="Lightness"
            value={`${Math.round(SEL.l * 100)}%`}
            pct={SEL.l * 100}
            track={`linear-gradient(90deg in oklch, oklch(0.18 0.15 ${SEL.h}), oklch(0.6 0.15 ${SEL.h}), oklch(0.97 0.15 ${SEL.h}))`}
            thumb={SEL_HEX}
          />
          <GradientSlider
            label="Colour strength"
            value={`${Math.round((SEL.c / 0.22) * 100)}%`}
            pct={(SEL.c / 0.22) * 100}
            track={`linear-gradient(90deg in oklch, oklch(${SEL.l} 0 ${SEL.h}), oklch(${SEL.l} 0.22 ${SEL.h}))`}
            thumb={SEL_HEX}
          />
        </div>
        <div className="mt-3">
          <p className="hud-label mb-1.5">Harmony with the rest</p>
          <div className="grid grid-cols-2 gap-1.5 [&>button]:justify-start">
            {HARMONIES.map((h) => (
              <HarmonyChip key={h.id} label={h.label} hues={h.hues} active={h.id === "complement"} />
            ))}
          </div>
        </div>
      </div>

      {/* Finish & effects */}
      <div className="mt-2.5 px-3.5 pb-3">
        <p className="hud-label mb-1.5">Finish</p>
        <div className="grid grid-cols-6 gap-1.5">
          {FINISHES.map((f) => (
            <button key={f.id} type="button" aria-pressed={f.id === "none"} className="group flex flex-col items-center gap-1">
              <span
                className={cn(
                  "block h-7 w-full rounded-md border transition-colors",
                  f.id === "none" ? "border-primary/70 shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]" : "border-foreground/10 group-hover:border-screen/50"
                )}
                style={{ background: f.bg }}
              />
              <span className={cn("font-pixel text-[7.5px] uppercase tracking-[0.1em]", f.id === "none" ? "text-foreground" : "text-muted-foreground")}>{f.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Toggle on icon={<Sparkles className="h-3.5 w-3.5" />}>Sparkle</Toggle>
          <Toggle on icon={<SunMedium className="h-3.5 w-3.5" />}>Glow</Toggle>
          <button type="button" className="flex h-8 items-center gap-1.5 rounded-md border border-input bg-shade/40 pl-2 pr-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.08em]">
            <span className="font-pixel text-[8px] font-normal tracking-[0.12em] text-muted-foreground">BG</span> Type glow
            <ChevronDown className="h-3 w-3 text-muted-foreground" strokeWidth={2.6} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function mean(ramp: string[]) {
  const v = [1, 3, 5].map((i) => Math.round(ramp.reduce((t, c) => t + parseInt(c.slice(i, i + 2), 16), 0) / ramp.length));
  return "#" + v.map((x) => x.toString(16).padStart(2, "0")).join("");
}

const FINISHES = [
  { id: "none", label: "Flat", bg: `linear-gradient(135deg, ${RAMPS.wings.yours[0]}, ${RAMPS.wings.yours[1]})` },
  { id: "metallic", label: "Metal", bg: `linear-gradient(160deg, #6b5320 0%, #f5df9c 28%, #8f6c25 45%, #ffe9a8 62%, #6b5320 100%)` },
  { id: "pastel", label: "Pastel", bg: `linear-gradient(135deg, #ffd6e8, #d9e8ff 50%, #e3ffe0)` },
  { id: "galaxy", label: "Galaxy", bg: `radial-gradient(circle at 30% 30%, #fff 0 1px, transparent 2px), radial-gradient(circle at 70% 60%, #fff 0 1px, transparent 2px), radial-gradient(circle at 50% 80%, #c8b6ff 0 1px, transparent 2px), radial-gradient(120% 90% at 30% 20%, #7b3fe4, #1a1150 60%, #07051a)` },
  { id: "holo", label: "Holo", bg: `linear-gradient(120deg, #ff9ad5, #ffe29a 25%, #9affd8 50%, #9ac8ff 75%, #d59aff)` },
  { id: "gradient", label: "Fade", bg: `linear-gradient(180deg, ${RAMPS.wings.yours[0]}, ${RAMPS.flame.yours[2]})` },
];

function Toggle({ children, on, icon }: { children: React.ReactNode; on?: boolean; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md border px-2.5 font-display text-[11px] font-semibold uppercase tracking-[0.08em]",
        on ? "border-warning/60 bg-warning/10 text-warning" : "border-foreground/10 bg-shade/30 text-muted-foreground"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// Re-exported for the phone layout and share sheet.
export { Kbd, IconBtn };
export const ICONS = { Copy, Download, Film, ImageDown, Link2, X, Share2 };

const STUDIO_CSS = `
.studio-gem{background:linear-gradient(135deg,hsl(var(--primary)),hsl(var(--screen)));box-shadow:0 0 18px hsl(var(--primary)/.45),inset 0 1px 0 rgb(255 255 255/.35),inset 0 -2px 0 rgb(0 0 0/.25)}
.studio-title-accent{background:linear-gradient(90deg,#ffe29a,#8ff4ff);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 10px rgb(143 244 255/.35))}
.studio-stage::after{display:none}
.studio-stage .studio-floor{position:absolute;left:-40%;right:-40%;bottom:-1px;height:30%;transform-origin:50% 100%;transform:perspective(380px) rotateX(62deg);
  background-image:linear-gradient(hsl(var(--screen)/.28) 1px,transparent 1px),linear-gradient(90deg,hsl(var(--screen)/.22) 1px,transparent 1px);background-size:56px 56px;
  -webkit-mask-image:linear-gradient(to bottom,transparent,#000 70%);mask-image:linear-gradient(to bottom,transparent,#000 70%)}
.studio-sprite{filter:drop-shadow(0 0 1px rgb(143 244 255/.25)) drop-shadow(0 0 22px rgb(0 227 245/.22)) drop-shadow(0 16px 18px rgb(0 0 0/.5));animation:studio-bob 3.2s ease-in-out infinite}
.studio-outline{filter:drop-shadow(0 0 4px hsl(var(--primary))) drop-shadow(0 0 10px hsl(var(--primary)/.7));animation:studio-bob 3.2s ease-in-out infinite}
@keyframes studio-bob{0%,100%{translate:0 0}50%{translate:0 -6px}}
.studio-tw{animation:studio-tw 2.2s ease-in-out infinite}
@keyframes studio-tw{0%,100%{opacity:1;transform:scale(1) rotate(0)}50%{opacity:.55;transform:scale(.7) rotate(20deg)}}
.preset-tile img{transition:transform .2s}
.preset-tile:hover img{transform:scale(1.32) translateY(2%)}
@media (prefers-reduced-motion: reduce){.studio-sprite,.studio-outline,.studio-tw{animation:none!important}}
`;
