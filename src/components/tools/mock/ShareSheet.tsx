"use client";

/* eslint-disable @next/next/no-img-element -- MOCK: pre-recoloured sprites */
/* MOCK ONLY: the share sheet over the studio, with the 1200×630 share card. */

import { Check, Copy, Download, Film, Link2, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { A, PokeballMark, RAMPS, RampSwatch, Twinkle } from "./studio-parts";

const SCALE = 0.6;

export function ShareSheet() {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" role="dialog" aria-modal aria-labelledby="share-title">
      <div className="absolute inset-0 bg-[hsl(246_42%_3%/0.72)] backdrop-blur-[3px]" />
      <div className="hud relative w-[1120px] overflow-hidden rounded-xl border border-screen/30 bg-card shadow-[0_40px_120px_rgb(0_0_0/0.7),0_0_0_1px_rgb(255_255_255/0.03)]">
        {/* Device strip, like the Pokédex entry */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-[hsl(338_80%_50%)] to-[hsl(272_68%_48%)] px-5 py-2.5 shadow-[inset_0_-2px_0_rgb(0_0_0/0.25)]">
          <img src="/logo.svg" alt="" width={20} height={20} className="h-5 w-5" aria-hidden />
          <span className="led h-1.5 w-1.5 text-white/90" aria-hidden />
          <span className="led h-1.5 w-1.5 text-warning" aria-hidden />
          <span className="led h-1.5 w-1.5 text-success" aria-hidden />
          <span className="font-pixel text-[10px] uppercase tracking-widest text-white/90">Shiny Studio // Share</span>
          <button type="button" aria-label="Close" className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-white/80 hover:bg-white/15 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_330px] gap-6 p-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="hud-label">Share card · 1200 × 630</p>
              <div role="group" aria-label="Card layout" className="inline-flex rounded-full border border-foreground/10 bg-foreground/[0.04] p-0.5">
                {["Side by side", "Yours only"].map((m, i) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={i === 0}
                    className={cn(
                      "flex h-7 items-center rounded-full px-3 font-display text-[11px] font-semibold uppercase tracking-[0.08em]",
                      i === 0 ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]" : "text-muted-foreground"
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-foreground/15 shadow-[0_20px_50px_rgb(0_0_0/0.5)]" style={{ width: 1200 * SCALE, height: 630 * SCALE }}>
              <div style={{ width: 1200, height: 630, transform: `scale(${SCALE})`, transformOrigin: "0 0" }}>
                <ShareCard />
              </div>
            </div>
          </div>

          <div className="flex flex-col">
            <h2 id="share-title" className="font-display text-2xl font-bold uppercase leading-none tracking-tight">
              Show it off
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">The link rebuilds this exact design, so anyone can open it in the studio and remix it.</p>

            <div className="mt-5 space-y-1.5">
              <p className="hud-label">Link</p>
              <div className="flex gap-1.5">
                <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-shade/40 px-2.5">
                  <Link2 className="h-4 w-4 shrink-0 text-screen" />
                  <span className="truncate font-mono text-[12.5px] text-foreground/90">playpokeiq.com/tools/shiny-studio/charizard#p.Kx4eQ2</span>
                </div>
                <Button size="sm" className="h-10 px-3.5">
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
            </div>

            <div className="mt-5 space-y-1.5">
              <p className="hud-label">Download</p>
              <div className="grid gap-1.5">
                <DownloadRow icon={<Download className="h-4 w-4" />} title="PNG image" hint="The share card, or just your Pokémon on a clear background" />
                <DownloadRow icon={<Film className="h-4 w-4" />} title="Animated GIF" hint="Your Pokémon's idle animation with the sparkle" />
              </div>
            </div>

            <div className="mt-5 space-y-2 rounded-md border border-foreground/10 bg-shade/25 p-3">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm">Put my name on the card</span>
                <Switch on />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm">Show the official shiny</span>
                <Switch on />
              </label>
            </div>

            <div className="mt-auto flex gap-2 pt-5">
              <Button variant="outline" className="flex-1">
                <Share2 className="h-4 w-4" /> More…
              </Button>
              <Button variant="success" className="flex-1">
                <Check className="h-4 w-4" /> Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DownloadRow({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <button type="button" className="group flex items-center gap-3 rounded-md border border-foreground/10 bg-shade/25 p-2.5 text-left transition-colors hover:border-screen/50">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-screen/15 text-screen">{icon}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block font-display text-[13px] font-bold uppercase tracking-[0.08em]">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span className="text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden>
        →
      </span>
    </button>
  );
}

function Switch({ on }: { on?: boolean }) {
  return (
    <span className={cn("relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-foreground/15")} aria-hidden>
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-[18px]" : "translate-x-0.5")} />
    </span>
  );
}

/** The 1200×630 card itself (what the PNG download and the link preview would be). */
export function ShareCard() {
  return (
    <div className="share-card relative h-full w-full overflow-hidden font-sans text-white">
      <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_76%_50%,rgb(0_227_245/0.18),transparent_70%),radial-gradient(50%_60%_at_8%_100%,hsl(340_86%_60%/0.18),transparent_70%),linear-gradient(180deg,#0b0a22,#120f30_60%,#0a0920)]" />
      <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] [background-size:40px_40px]" />
      <PokeballMark className="right-[60px] top-1/2 h-[560px] w-[560px] -translate-y-1/2 text-white/[0.05]" />

      {/* Left: identity */}
      <div className="absolute bottom-[48px] left-[64px] top-[48px] flex w-[560px] flex-col justify-between">
      <div className="flex items-center gap-3">
        <img src="/logo.svg" alt="" className="h-11 w-11 drop-shadow-[0_0_14px_hsl(340_86%_60%/0.5)]" />
        <span className="font-display text-[30px] font-bold uppercase tracking-[0.08em]">
          Poké<span className="text-[hsl(340_86%_60%)]">IQ</span>
        </span>
        <span className="ml-2 rounded-[4px] border border-white/25 px-2.5 py-1.5 font-pixel text-[13px] uppercase leading-none tracking-[0.14em] text-white/80">Shiny Studio</span>
      </div>

      <div>
        <p className="font-pixel text-[16px] uppercase tracking-[0.16em] text-[#8ff4ff]">Custom shiny · No.0006</p>
        <h3 className="mt-3 font-display text-[66px] font-bold uppercase leading-[0.9] tracking-tight">
          <span className="share-grad">Obsidian Ember</span>
          <br />
          Charizard
        </h3>
        <div className="mt-5 flex items-center gap-3">
          <RampSwatch ramp={[RAMPS.body.yours[1], RAMPS.belly.yours[0], RAMPS.wings.yours[0], RAMPS.flame.yours[1]]} className="h-6 w-[120px]" rounded="rounded-[5px]" />
          <span className="font-display text-[22px] font-semibold tracking-wide text-white/80">Designed by Blaze</span>
        </div>
      </div>

      {/* Normal → Official → Yours */}
      <div className="flex items-end gap-4">
        <MiniCard src={`${A}/px-normal.png`} label="Normal" />
        <MiniCard src={`${A}/px-official.png`} label="Official shiny" />
        <span className="mb-[46px] font-display text-[34px] text-white/40">→</span>
      </div>
      </div>

      {/* Yours */}
      <div className="absolute right-[40px] top-[40px] h-[550px] w-[550px]">
        <div className="absolute left-[18%] right-[14%] top-[86%] h-[8%] rounded-[50%] bg-[radial-gradient(closest-side,rgb(0_0_0/0.7),transparent)]" />
        <img
          src={`${A}/px-yours.png`}
          alt=""
          className="absolute inset-0 h-full w-full [image-rendering:pixelated] [filter:drop-shadow(0_0_26px_rgb(0_227_245/0.35))_drop-shadow(0_18px_20px_rgb(0_0_0/0.55))]"
        />
        <Twinkle className="h-14 w-14" color="#8ff4ff" style={{ left: "6%", top: "8%" }} />
        <Twinkle className="h-7 w-7" color="#ffe29a" style={{ left: "1%", top: "22%" }} />
        <Twinkle className="h-9 w-9" color="#ffffff" style={{ left: "88%", top: "60%" }} />
        <Twinkle className="h-10 w-10" color="#ffe29a" style={{ left: "42%", top: "-2%" }} />
        <span className="absolute right-[2%] top-[4%] rounded-[5px] border-2 border-[#ffe29a]/80 bg-[#ffe29a]/15 px-3 py-2 font-pixel text-[15px] uppercase leading-none tracking-[0.14em] text-[#ffe29a]">Yours</span>
      </div>

      <div className="absolute bottom-[26px] right-[48px] font-pixel text-[13px] uppercase tracking-[0.16em] text-white/45">playpokeiq.com/tools</div>
      <style>{`.share-grad{background:linear-gradient(90deg,#ffe29a,#fa7a2c 45%,#8ff4ff);-webkit-background-clip:text;background-clip:text;color:transparent}`}</style>
    </div>
  );
}

function MiniCard({ src, label }: { src: string; label: string }) {
  return (
    <div className="w-[132px] overflow-hidden rounded-[10px] border-2 border-white/15 bg-white/[0.04]">
      <div className="relative h-[96px] bg-[radial-gradient(circle_at_50%_65%,rgb(238_129_48/0.25),transparent_70%)]">
        <img src={src} alt="" className="absolute inset-0 m-auto h-[118%] w-[118%] -translate-x-[8%] translate-y-[-4%] object-contain [image-rendering:pixelated]" />
      </div>
      <div className="bg-black/35 py-2 text-center font-pixel text-[11px] uppercase tracking-[0.14em] text-white/70">{label}</div>
    </div>
  );
}
