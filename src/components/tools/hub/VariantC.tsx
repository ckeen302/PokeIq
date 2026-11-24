"use client";

/* eslint-disable @next/next/no-img-element -- the tools' own small pictures */
import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import Link from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import type { HubData, HubTool, ToolId } from "./data";
import { ShinyCycle } from "./ShinyCycle";
import { BallStage, Chips, PickerCrown, TierFill, TIERS } from "./previews";
import { HubHeading, OpenPill } from "./parts";

/**
 * Direction C, "Workshop": a stage like a game's mode select. One tool at a
 * time stands on the stage, big (its live picture, its name in huge italics,
 * its features and Open), and the others wait in a select bar under it.
 * Pointing at one in the bar brings it on stage; left alone, the stage moves
 * on by itself, the bar's timer showing when. Every tool is still a plain
 * link in the bar.
 */

type Vars = React.CSSProperties & Record<`--${string}`, string>;
const DUR = 7000;

export function VariantC({ data }: { data: HubData }) {
  const [cur, setCur] = useState(0);
  const [hold, setHold] = useState(false);
  const [round, setRound] = useState(0);
  const [still, setStill] = useState(false);
  useEffect(() => setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  useEffect(() => {
    if (hold || still) return;
    const id = window.setTimeout(() => setCur((c) => (c + 1) % data.tools.length), DUR);
    return () => window.clearTimeout(id);
  }, [cur, hold, still, round, data.tools.length]);
  const tool = data.tools[cur];

  return (
    <div className="mx-auto max-w-6xl" data-testid="tools-page" data-variant="c">
      <HubHeading title={data.title} free={data.free} className="mb-5 sm:mb-6" />
      <div
        onMouseEnter={() => setHold(true)}
        onMouseLeave={() => {
          setHold(false);
          setRound((r) => r + 1);
        }}
      >
        {/* The stage. */}
        <section
          className="th-tile rounded-3xl transition-[border-color,box-shadow] duration-500"
          style={{ "--ac": tool.accent, "--sx": "74%", "--sy": "42%" } as Vars}
          data-hover-probe
        >
          <span className="th-scene" />
          <span className="th-floor" />
          <div className="relative grid md:h-[clamp(290px,calc(100svh-23rem),450px)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            {/* On a phone the words keep one height whichever tool is on stage, so the bar under them never jumps. */}
            <div key={tool.id} className="th-enter-up relative z-10 flex flex-col justify-center gap-3 p-5 pt-1 max-md:order-2 max-md:min-h-[250px] max-md:justify-start md:gap-4 md:p-10 lg:pl-12">
              <Chips items={tool.tags} />
              <h2 className="font-display text-[34px] font-bold uppercase italic leading-[0.9] tracking-tight text-white [text-shadow:0_4px_24px_rgb(0_0_0/0.5)] md:text-5xl md:leading-[0.88] lg:text-[72px]">{tool.title}</h2>
              <p className="max-w-md text-[15px] text-white/80 md:text-lg">{tool.subtitle}</p>
              <Link href={tool.href} className="group mt-1 w-fit rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`${tool.testId}-open`}>
                <OpenPill label={data.open} big />
              </Link>
            </div>
            <div key={`${tool.id}-art`} className="th-enter relative h-[230px] max-md:order-1 md:h-auto" aria-hidden>
              {tool.id !== "tier" && <span className="th-pedestal bottom-[4%] w-[min(78%,440px)] md:bottom-[7%]" />}
              <StagePicture id={tool.id} data={data} />
            </div>
          </div>
        </section>

        {/* The select bar: every tool, a plain link; pointing at one puts it on stage. */}
        <nav className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
          {data.tools.map((t, i) => (
            <Link
              key={t.id}
              href={t.href}
              onMouseEnter={() => setCur(i)}
              onFocus={() => setCur(i)}
              className={cn(
                "th-tile group flex h-[68px] items-center gap-2.5 rounded-xl pl-1.5 pr-3 transition-transform focus-visible:ring-2 focus-visible:ring-ring md:h-[76px] md:gap-3 md:pl-2",
                i === cur && "-translate-y-0.5 !border-[hsl(var(--ac)/0.7)] shadow-[0_0_0_1px_hsl(var(--ac)/0.35),0_12px_30px_-10px_hsl(var(--ac)/0.45)]"
              )}
              style={{ "--ac": t.accent, "--sx": "18%", "--sy": "50%" } as Vars}
              aria-current={i === cur ? "true" : undefined}
              data-testid={t.testId}
            >
              <span className={cn("th-scene transition-opacity", i === cur ? "opacity-100" : "opacity-60")} />
              <Thumb tool={t} />
              <span className={cn("font-display text-[13px] font-bold uppercase italic leading-[1.05] tracking-tight md:text-[15px]", i === cur ? "text-white" : "text-white/70 group-hover:text-white")}>{t.title}</span>
              {i === cur && !hold && !still && (
                <span key={`${cur}-${round}`} className="th-timer absolute inset-x-0 bottom-0 h-[3px] bg-[hsl(var(--ac))]" style={{ "--dur": `${DUR}ms` } as Vars} aria-hidden />
              )}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function StagePicture({ id, data }: { id: ToolId; data: HubData }) {
  switch (id) {
    case "shiny":
      return (
        <ShinyCycle
          {...data.shiny}
          interval={2000}
          className="absolute inset-0"
          figureClassName="absolute left-1/2 top-[3%] h-[74%] -translate-x-1/2 md:top-[6%] md:h-[84%]"
          hudClassName="absolute bottom-[3%] left-1/2 -translate-x-1/2 rounded-md border border-white/10 bg-black/45 px-2.5 py-2 backdrop-blur md:bottom-auto md:left-auto md:right-[5%] md:top-[6%] md:translate-x-0"
        />
      );
    case "ball":
      return (
        <>
          <BallStage className="absolute left-1/2 top-[2%] aspect-square h-[80%] -translate-x-1/2 md:top-[4%]" priority />
        </>
      );
    case "tier":
      return (
        <div className="absolute inset-0 flex items-center justify-center px-4">
          <div className="[--tile:2.3rem] [transform:perspective(900px)_rotateY(-14deg)_rotateX(6deg)] md:[--tile:2.6rem] lg:[--tile:3.4rem]">
            <TierFill rows={4} perRow={4} period={6} />
          </div>
        </div>
      );
    case "picker":
      return (
        <div className="absolute inset-0 flex items-end justify-center pb-[6%]">
          <PickerCrown size="clamp(8.5rem, 21vw, 16rem)" />
        </div>
      );
  }
}

/** A tool's small picture in the select bar. */
function Thumb({ tool }: { tool: HubTool }) {
  const box = "relative flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/30 ring-1 ring-inset ring-white/10 md:h-[58px] md:w-[58px]";
  switch (tool.id) {
    case "shiny":
      return (
        <span className={box} aria-hidden>
          <img src="/shiny-maker/hub.png" alt="" width={74} height={80} className="th-px h-[88%] w-auto transition-transform duration-300 group-hover:scale-110" />
        </span>
      );
    case "ball":
      return (
        <span className={box} aria-hidden>
          <img src="/pokeball-maker/hub.webp" alt="" width={64} height={64} className="h-[96%] w-[96%] object-contain transition-transform duration-300 group-hover:rotate-[-10deg] group-hover:scale-110" />
        </span>
      );
    case "tier":
      return (
        <span className={cn(box, "flex-col items-stretch justify-center gap-[3px] p-1.5")} aria-hidden>
          {TIERS.slice(0, 3).map((r, i) => (
            <span key={r.label} className="flex h-[10px] gap-[3px] md:h-[11px]">
              <span className="w-[10px] rounded-[2px] md:w-[11px]" style={{ background: r.color }} />
              {Array.from({ length: 3 - i }, (_, k) => (
                <span key={k} className="w-[10px] rounded-[2px] bg-white/25 transition-colors group-hover:bg-white/45 md:w-[11px]" />
              ))}
            </span>
          ))}
        </span>
      );
    case "picker":
      return (
        <span className={box} aria-hidden>
          <img src="/sizes/art/256/94.webp" alt="" width={64} height={64} loading="lazy" className="mt-2 h-[82%] w-[82%] object-contain transition-transform duration-300 group-hover:scale-110" />
          <Crown className="absolute left-1/2 top-[3px] h-3.5 w-3.5 -translate-x-1/2 text-[hsl(44_96%_62%)]" strokeWidth={2.4} />
        </span>
      );
  }
}
