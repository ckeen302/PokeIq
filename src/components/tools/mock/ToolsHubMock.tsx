"use client";

/* eslint-disable @next/next/no-img-element -- MOCK: pre-recoloured sprites */
/* MOCK ONLY: /tools, the Tools hub, with the Shiny Studio as its first (featured) tool. */

import { ArrowRight, Sparkles } from "lucide-react";
import Link from "@/components/ui/Link";
import { HudHeading } from "@/components/game/HudHeading";
import { buttonVariants } from "@/components/ui/button";
import { A, PokeballMark, RAMPS, RampSwatch, Twinkle } from "./studio-parts";

type Vars = React.CSSProperties & Record<`--${string}`, string>;

const PIXELS: [string, string, string, number][] = [
  // left, top, colour, size
  ["62%", "22%", RAMPS.wings.yours[0], 14],
  ["70%", "58%", RAMPS.flame.yours[1], 10],
  ["78%", "30%", RAMPS.belly.yours[0], 18],
  ["86%", "64%", RAMPS.body.yours[0], 12],
  ["91%", "18%", RAMPS.flame.yours[2], 10],
  ["66%", "78%", "#ff9ad5", 8],
  ["95%", "46%", RAMPS.wings.yours[1], 8],
  ["74%", "12%", "#9a74f8", 8],
  ["82%", "84%", RAMPS.wings.yours[0], 6],
  ["58%", "44%", RAMPS.flame.yours[1], 6],
  ["88%", "36%", "#ff9ad5", 6],
];

export function ToolsHubMock() {
  return (
    <div className="mx-auto max-w-6xl space-y-10 max-sm:space-y-6" data-testid="tools-page">
      <section className="tools-hero dark-scope relative -mx-4 -mt-8 overflow-hidden border-b border-screen/25 sm:mx-0 sm:mt-0 sm:rounded-2xl sm:border">
        <div className="tools-floor" aria-hidden />
        {PIXELS.map(([left, top, c, s], i) => (
          <span
            key={i}
            className="tools-pixel absolute max-sm:hidden"
            style={{ left, top, width: s, height: s, background: c, boxShadow: `0 0 18px ${c}`, animationDelay: `${-i * 0.7}s` } as Vars}
            aria-hidden
          />
        ))}
        <div className="relative space-y-3 px-5 py-10 sm:px-10 sm:py-10 lg:px-14 lg:py-11">
          <p className="hud-label flex items-center gap-2 text-screen max-sm:hidden">
            <span className="led h-1.5 w-1.5 text-success" aria-hidden /> PokéIQ // Tools
          </p>
          <h1 className="tools-title font-display text-6xl font-bold uppercase leading-[0.9] tracking-tight sm:text-[88px]">Tools</h1>
          <p className="max-w-xl text-lg text-foreground/80">Make your own Pokémon creations, right in your browser, and share them with a link.</p>
        </div>
      </section>

      <section className="space-y-6" aria-labelledby="tools-list">
        <HudHeading index={1} id="tools-list" title="Create" aside="Free, no download" />
        <article className="lab-card group" style={{ "--lab-accent": "190 95% 62%" } as Vars} data-testid="tool-card-shiny-studio">
          <div className="tools-glow grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <Link href="/tools/shiny-studio" tabIndex={-1} aria-hidden className="screen tools-art dark-scope relative block aspect-video overflow-hidden lg:aspect-auto lg:min-h-[400px]">
              <FeaturedArt />
            </Link>
            <div className="flex flex-col justify-center gap-4 p-5 sm:p-8 lg:p-10">
              <p className="hud-label flex items-center gap-2 text-[hsl(190_95%_62%)]">
                Custom shiny maker
                <span className="rounded border border-primary/60 bg-primary/15 px-1.5 py-1 font-pixel text-[10px] uppercase leading-none tracking-wider text-primary">New</span>
              </p>
              <h2 className="font-display text-3xl font-bold uppercase leading-none tracking-tight sm:text-5xl">
                <Link href="/tools/shiny-studio" className="hover:text-[hsl(190_95%_62%)]">
                  Shiny Studio
                </Link>
              </h2>
              <p className="text-muted-foreground sm:text-lg">
                Pick a Pokémon, click a part and paint it your way. The shading stays, so your shiny looks like it came straight out of the games. Then share it with a link.
              </p>
              <ul className="flex flex-wrap gap-2" aria-label="Highlights">
                {["Pixel and HD", "Click to paint", "Keeps the shading", "Share a link", "PNG and GIF"].map((t) => (
                  <li key={t} className="rounded-sm border border-foreground/10 bg-background/50 px-2 py-1 font-pixel text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                    {t}
                  </li>
                ))}
              </ul>
              <div className="pt-1">
                <Link href="/tools/shiny-studio" className={buttonVariants({ size: "lg" })}>
                  Open the studio <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </div>
            </div>
          </div>
        </article>
      </section>
      <style>{TOOLS_CSS}</style>
    </div>
  );
}

function FeaturedArt() {
  return (
    <span className="absolute inset-0 block">
      <span className="absolute inset-0 bg-[radial-gradient(48%_62%_at_62%_54%,rgb(0_227_245/0.2),transparent_72%),radial-gradient(40%_50%_at_20%_80%,rgb(238_129_48/0.2),transparent_70%)]" />
      <span className="tools-card-floor" />
      <PokeballMark className="left-[34%] top-1/2 h-[96%] w-[60%] -translate-y-1/2 text-white/[0.05]" />

      {/* Normal and official, small, on the left */}
      <span className="absolute left-[5%] top-1/2 flex -translate-y-1/2 flex-col gap-3">
        <SmallCard src={`${A}/px-normal.png`} label="Normal" />
        <SmallCard src={`${A}/px-official.png`} label="Official" />
      </span>
      <span className="absolute left-[27%] top-1/2 -translate-y-1/2 font-display text-3xl text-white/35" aria-hidden>
        →
      </span>

      {/* Yours, big */}
      <span className="absolute left-[57%] top-[50%] block aspect-square h-[96%] -translate-x-1/2 -translate-y-1/2">
        <span className="absolute left-[18%] right-[14%] top-[85%] h-[8%] rounded-[50%] bg-[radial-gradient(closest-side,rgb(0_0_0/0.65),transparent)]" />
        <img src={`${A}/px-yours.png`} alt="" className="studio-hub-sprite absolute inset-0 h-full w-full [image-rendering:pixelated]" />
        <Twinkle className="tools-tw h-10 w-10" color="#8ff4ff" style={{ left: "6%", top: "8%" }} />
        <Twinkle className="tools-tw h-5 w-5 [animation-delay:-0.8s]" color="#ffe29a" style={{ left: "1%", top: "22%" }} />
        <Twinkle className="tools-tw h-6 w-6 [animation-delay:-1.4s]" color="#fff" style={{ left: "86%", top: "58%" }} />
        <Twinkle className="tools-tw h-7 w-7 [animation-delay:-0.4s]" color="#ffe29a" style={{ left: "42%", top: "-1%" }} />
      </span>

      {/* Part chips, like stickers from the editor */}
      <span className="absolute right-[4%] top-[12%] flex flex-col items-end gap-2">
        <Chip ramp={RAMPS.wings.yours} label="Wings" active />
        <Chip ramp={RAMPS.flame.yours} label="Flame" />
        <Chip ramp={RAMPS.body.yours} label="Body" />
      </span>

      <span className="hud-label absolute bottom-3 left-3 z-[3] flex items-center gap-1.5 rounded-sm bg-black/55 px-2 py-1.5 text-white/90 backdrop-blur-sm">
        <Sparkles className="h-3 w-3 text-warning" /> Obsidian Ember · Charizard
      </span>
    </span>
  );
}

function SmallCard({ src, label }: { src: string; label: string }) {
  return (
    <span className="block w-[104px] overflow-hidden rounded-md border border-white/15 bg-black/25 backdrop-blur-sm">
      <span className="relative block h-[78px]">
        <img src={src} alt="" className="absolute inset-0 m-auto h-[120%] w-[120%] -translate-x-[8%] -translate-y-[6%] object-contain [image-rendering:pixelated]" />
      </span>
      <span className="block bg-black/40 py-1 text-center font-pixel text-[8px] uppercase tracking-[0.14em] text-white/70">{label}</span>
    </span>
  );
}

function Chip({ ramp, label, active }: { ramp: string[]; label: string; active?: boolean }) {
  return (
    <span
      className={
        "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 backdrop-blur-md " +
        (active ? "border-[hsl(340_86%_60%/0.7)] bg-[hsl(340_86%_60%/0.18)] shadow-[0_0_20px_hsl(340_86%_60%/0.35)]" : "border-white/15 bg-black/40")
      }
    >
      <RampSwatch ramp={ramp} className="h-6 w-6" rounded="rounded-full" />
      <span className="font-display text-[12px] font-bold uppercase tracking-[0.08em] text-white">{label}</span>
    </span>
  );
}

const TOOLS_CSS = `
.tools-art::after{display:none}
.tools-hero{background:
  radial-gradient(50% 90% at 82% 40%, rgb(0 227 245 / .16), transparent 70%),
  radial-gradient(45% 70% at 64% 70%, rgb(250 122 44 / .14), transparent 70%),
  radial-gradient(55% 55% at 8% 100%, hsl(var(--primary) / .16), transparent 70%),
  linear-gradient(180deg, hsl(250 50% 5%), hsl(252 46% 8%) 62%, hsl(252 50% 5%));}
.tools-floor{position:absolute;left:-60%;right:-60%;bottom:-1px;height:46%;transform-origin:50% 100%;transform:perspective(420px) rotateX(64deg);
  background-image:linear-gradient(hsl(var(--screen) / .36) 1.5px,transparent 1.5px),linear-gradient(90deg,hsl(var(--screen) / .28) 1.5px,transparent 1.5px);
  background-size:64px 64px;animation:tools-floor 2.6s linear infinite;-webkit-mask-image:linear-gradient(to bottom,transparent 0%,#000 60%);mask-image:linear-gradient(to bottom,transparent 0%,#000 60%);}
@keyframes tools-floor{to{background-position:0 64px,0 0}}
.tools-title{text-shadow:0 0 28px hsl(var(--screen) / .45);background:linear-gradient(90deg,#fff 0%,#fff 40%,#ffe29a 70%,#8ff4ff);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 22px rgb(143 244 255 / .3))}
.tools-pixel{border-radius:2px;animation:tools-pixel 6s ease-in-out infinite alternate}
@keyframes tools-pixel{from{translate:0 -8px;rotate:-8deg}to{translate:0 10px;rotate:10deg}}
.tools-card-floor{position:absolute;left:-30%;right:-30%;bottom:-1px;height:30%;transform-origin:50% 100%;transform:perspective(380px) rotateX(62deg);
  background-image:linear-gradient(rgb(143 244 255 / .22) 1px,transparent 1px),linear-gradient(90deg,rgb(143 244 255 / .18) 1px,transparent 1px);background-size:52px 52px;
  -webkit-mask-image:linear-gradient(to bottom,transparent,#000 70%);mask-image:linear-gradient(to bottom,transparent,#000 70%)}
.studio-hub-sprite{filter:drop-shadow(0 0 22px rgb(0 227 245 / .3)) drop-shadow(0 16px 18px rgb(0 0 0 / .5));animation:tools-bob 3.4s ease-in-out infinite}
@keyframes tools-bob{0%,100%{translate:0 0}50%{translate:0 -7px}}
.tools-tw{animation:tools-tw 2.2s ease-in-out infinite}
@keyframes tools-tw{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.7) rotate(20deg)}}
.tools-glow{transition:box-shadow .25s,border-color .25s}
.lab-card:hover .tools-glow{border-color:hsl(var(--lab-accent) / .6);box-shadow:0 0 0 1px hsl(var(--lab-accent) / .35),0 0 40px hsl(var(--lab-accent) / .18)}
@media (prefers-reduced-motion: reduce){.tools-floor,.tools-pixel,.studio-hub-sprite,.tools-tw{animation:none!important}}
`;
