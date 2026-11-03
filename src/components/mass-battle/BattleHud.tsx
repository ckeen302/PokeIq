"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Clapperboard, Crown, Expand, Gauge, Info, Map as MapIcon, Minus, Move3d, Pause, Play, Plus, RotateCcw, Settings2, Share2, SkipForward, Trophy, Volume2, VolumeX } from "lucide-react";
import { fmt } from "@/lib/mass-battle/copy";
import { cn } from "@/lib/utils";

/**
 * The battle's heads-up display and playback controls: the two armies'
 * counters (with a trail showing the losses that just happened), the
 * boss's health bar, the battle clock, the kill feed of big moments, and
 * along the bottom play and pause (and a step a tick at a time while
 * paused), replay, the speed (¼× to 4×), the camera (the director, a free
 * camera, top-down), zoom, and an options menu (the director's slow
 * motion, damage numbers, the HUD itself).
 */

export type CamMode = "director" | "free" | "top";

export interface HudState {
  left: [number, number];
  start: [number, number];
  boss: { name: string; hp: number; max: number; side: 0 | 1 } | null;
  t: number;
  shot: string;
}

export interface FeedEntry {
  id: number;
  text: string;
  tone: "a" | "b" | "gold";
}

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
const speedLabel = (s: number) => (s === 0.25 ? "¼" : s === 0.5 ? "½" : String(s));

/** A bar that shows its value and, fading behind it, where it was a moment ago. */
function TrailBar({ value, className, tone, flip }: { value: number; className?: string; tone: string; flip?: boolean }) {
  const [trail, setTrail] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (value >= trail) {
      setTrail(value);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTrail(value), 450);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, trail]);
  const v = Math.max(0, Math.min(1, value)), tr = Math.max(v, Math.min(1, trail));
  return (
    <div className={cn("mb-bar", flip && "scale-x-[-1]", className)}>
      <i className="mb-trail" style={{ transform: `scaleX(${tr})` }} />
      <i className={tone} style={{ transform: `scaleX(${v})` }} />
    </div>
  );
}

function clock(t: number) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

/**
 * The HUD fed straight from the render loop: `bind` hands the loop a setter, so the counters, the bars and the clock
 * update without re-rendering the page around them.
 */
export function LiveHud({ bind, ...rest }: { bind(set: ((h: HudState) => void) | null): void; names: [string, string]; hideCount: boolean; phase: string; feed: FeedEntry[]; visible: boolean }) {
  const [hud, setHud] = useState<HudState | null>(null);
  useEffect(() => {
    bind(setHud);
    return () => bind(null);
  }, [bind]);
  return hud ? <BattleHud hud={hud} {...rest} /> : null;
}

export function BattleHud({ hud, names, hideCount, phase, feed, visible }: { hud: HudState; names: [string, string]; hideCount: boolean; phase: string; feed: FeedEntry[]; visible: boolean }) {
  if (!visible) return null;
  const boss = hud.boss;
  return (
    <div className="pointer-events-none absolute inset-0 z-[3] p-2.5 sm:p-4" data-testid="mb-hud">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        {([0, 1] as const).map((s) => {
          const share = hud.left[s] / Math.max(1, hud.start[s]);
          return (
            <div key={s} className={cn("mb-panel w-[40%] max-w-[320px] px-2.5 py-1.5 sm:px-3 sm:py-2", s === 1 ? "mb-panel-b order-3 text-right" : "mb-panel-a order-1")} data-testid={`mb-army-${s}`}>
              <div className={cn("flex items-baseline justify-between gap-2", s === 1 && "flex-row-reverse")}>
                <span className="truncate font-display text-[11px] font-bold uppercase tracking-wide text-white/90 sm:text-sm">{names[s]}</span>
                <span className="mb-count font-display text-base font-bold tabular-nums leading-none sm:text-2xl" data-testid={`mb-left-${s}`}>
                  {hideCount && s === 0 ? "?" : fmt(hud.left[s])}
                </span>
              </div>
              <TrailBar value={hideCount && s === 0 ? 1 : share} tone={s === 0 ? "mb-a" : "mb-b"} flip={s === 1} className="mt-1" />
              <div className={cn("mt-1 flex items-center gap-2 font-pixel text-[8px] uppercase tracking-wider text-white/55 sm:text-[9px]", s === 1 && "flex-row-reverse")}>
                <span>KOs {fmt(hud.start[1 - s] - hud.left[1 - s])}</span>
              </div>
            </div>
          );
        })}
        <div className="order-2 flex flex-col items-center pt-0.5">
          <span className="mb-vs font-display text-[11px] font-bold uppercase tracking-[0.2em] text-white/80 sm:text-xs">vs</span>
          {phase !== "ready" && <span className="mt-0.5 font-pixel text-[9px] tabular-nums text-white/70 sm:text-[10px]" data-testid="mb-clock">{clock(hud.t)}</span>}
        </div>
      </div>
      {boss && phase !== "ready" && (
        <div className="mx-auto mt-2 w-[min(460px,78%)] space-y-1 text-center" data-testid="mb-boss">
          <div className="flex items-center justify-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider sm:text-base">
            <Crown className="h-3.5 w-3.5 text-[#ffd84a] sm:h-4 sm:w-4" aria-hidden />
            {boss.name}
          </div>
          <TrailBar value={boss.hp / Math.max(1, boss.max)} tone="mb-boss-fill" className="mb-boss h-[9px] sm:h-[12px]" />
          <div className="font-pixel text-[8px] tabular-nums text-white/70 sm:text-[9px]">{fmt(boss.hp)} / {fmt(boss.max)} HP</div>
        </div>
      )}
      {feed.length > 0 && (
        // Phones: the latest big moment, over the controls.
        <div className="absolute inset-x-0 bottom-[6.25rem] flex justify-center px-6 sm:hidden" aria-hidden>
          <span key={feed[feed.length - 1].id} className={cn("mb-feed-item max-w-full truncate rounded-md px-2.5 py-1 text-center font-display text-[11px] font-semibold", feed[feed.length - 1].tone === "gold" ? "mb-feed-gold" : feed[feed.length - 1].tone === "a" ? "mb-feed-a" : "mb-feed-b")}>{feed[feed.length - 1].text}</span>
        </div>
      )}
      <ol className="mb-feed absolute right-2.5 top-[5.5rem] hidden w-[min(340px,40%)] space-y-1.5 sm:right-4 sm:top-28 sm:block" aria-live="polite" data-testid="mb-feed">
        {feed.map((f) => (
          <li key={f.id} className={cn("mb-feed-item rounded-md px-2.5 py-1.5 text-right font-display text-xs font-semibold", f.tone === "gold" ? "mb-feed-gold" : f.tone === "a" ? "mb-feed-a" : "mb-feed-b")}>
            {f.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface ControlsProps {
  phase: string;
  paused: boolean;
  speed: number;
  cam: CamMode;
  slowmo: boolean;
  hudOn: boolean;
  numbersOn: boolean;
  muted: boolean;
  quality: string;
  showResult: boolean;
  onResult(): void;
  onPlay(): void;
  onStep(): void;
  onReplay(): void;
  onSpeed(s: number): void;
  onCam(m: CamMode): void;
  onZoom(f: number): void;
  onSlowmo(): void;
  onHud(): void;
  onNumbers(): void;
  onMute(): void;
  onHow(): void;
  onShare(): void;
  onVideo(): void;
  onFullscreen(): void;
}

const CAM_NEXT: Record<CamMode, CamMode> = { director: "free", free: "top", top: "director" };
const CAM_LABEL: Record<CamMode, string> = { director: "Director", free: "Free camera", top: "Top-down" };

export function BattleControls(p: ControlsProps) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);
  const chip = "mb-chip pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-white/85 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd84a] disabled:opacity-40 sm:px-3";
  const on = "mb-chip-on";
  const nextSpeed = () => {
    const i = SPEEDS.indexOf(p.speed as (typeof SPEEDS)[number]);
    const order = [1, 2, 4, 0.25, 0.5];
    const k = order.indexOf(i >= 0 ? SPEEDS[i] : 1);
    p.onSpeed(order[(k + 1) % order.length]);
  };
  const CamIcon = p.cam === "top" ? MapIcon : p.cam === "free" ? Move3d : Camera;
  return (
    <div className="absolute inset-x-0 bottom-0 z-[6] flex flex-wrap items-end justify-between gap-2 p-2.5 sm:p-4" data-testid="mb-controls">
      <div className="flex flex-wrap items-center gap-1.5">
        {p.showResult && (
          <button type="button" onClick={p.onResult} className={cn(chip, on)} data-testid="mb-show-result">
            <Trophy className="h-4 w-4" aria-hidden /> Result
          </button>
        )}
        <button type="button" onClick={p.onPlay} className={chip} aria-label={p.phase === "ready" ? "Start" : p.paused ? "Play" : "Pause"} data-testid="mb-play" disabled={p.phase === "done"}>
          {p.phase === "playing" && !p.paused ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </button>
        {p.paused && p.phase === "playing" && (
          <button type="button" onClick={p.onStep} className={chip} aria-label="Step forward" data-testid="mb-step">
            <SkipForward className="h-4 w-4" aria-hidden />
          </button>
        )}
        <button type="button" onClick={p.onReplay} className={chip} aria-label="Replay" data-testid="mb-restart"><RotateCcw className="h-4 w-4" aria-hidden /></button>
        <button type="button" onClick={nextSpeed} className={cn(chip, "min-w-[2.6rem] justify-center tabular-nums", p.speed !== 1 && on)} aria-label={`Speed ${p.speed}×`} title="Speed (1–5 keys)" data-testid="mb-speed">
          <Gauge className="hidden h-4 w-4 sm:block" aria-hidden />
          {speedLabel(p.speed)}×
        </button>
        <button type="button" onClick={() => p.onCam(CAM_NEXT[p.cam])} className={cn(chip, p.cam === "director" && on)} data-testid="mb-camera" data-mode={p.cam} aria-pressed={p.cam === "director"} aria-label={`Camera: ${CAM_LABEL[p.cam]}`} title="Camera: director, free, top-down (C)">
          <CamIcon className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">{CAM_LABEL[p.cam]}</span>
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <button type="button" onClick={() => p.onZoom(1 / 1.45)} className={chip} aria-label="Zoom in" data-testid="mb-zoom-in"><Plus className="h-4 w-4" aria-hidden /></button>
        <button type="button" onClick={() => p.onZoom(1.45)} className={chip} aria-label="Zoom out" data-testid="mb-zoom-out"><Minus className="h-4 w-4" aria-hidden /></button>
        <div className="relative" ref={menuRef}>
          <button type="button" onClick={() => setMenu((m) => !m)} className={cn(chip, menu && on)} aria-label="Options" aria-expanded={menu} data-testid="mb-options"><Settings2 className="h-4 w-4" aria-hidden /></button>
          {menu && (
            <div className="mb-menu pointer-events-auto absolute bottom-11 right-0 w-56 space-y-1 rounded-lg p-2 text-left" role="menu" data-testid="mb-options-menu">
              {([
                ["Slow motion", p.slowmo, p.onSlowmo, "mb-slowmo", "S"],
                ["Damage numbers", p.numbersOn, p.onNumbers, "mb-numbers", "D"],
                ["Show the HUD", p.hudOn, p.onHud, "mb-hud-toggle", "H"],
              ] as const).map(([label, value, fn, id, key]) => (
                <button key={id} type="button" role="menuitemcheckbox" aria-checked={value} onClick={fn} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-white/85 hover:bg-white/10" data-testid={id}>
                  <span>{label} <span className="ml-1 font-pixel text-[8px] text-white/40">{key}</span></span>
                  <span className={cn("mb-switch", value && "mb-switch-on")} aria-hidden />
                </button>
              ))}
              <div className="px-2 pt-1 font-pixel text-[8px] uppercase tracking-wider text-white/40" data-testid="mb-quality-label">Quality · {p.quality}</div>
            </div>
          )}
        </div>
        <button type="button" onClick={p.onMute} className={chip} aria-label={p.muted ? "Sound on" : "Sound off"} data-testid="mb-sound">{p.muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}</button>
        <button type="button" onClick={p.onHow} className={chip} aria-label="How it works" data-testid="mb-how"><Info className="h-4 w-4" aria-hidden /></button>
        <button type="button" onClick={p.onShare} className={chip} aria-label="Share" data-testid="mb-share"><Share2 className="h-4 w-4" aria-hidden /></button>
        <button type="button" onClick={p.onVideo} className={chip} aria-label="Make a video" data-testid="mb-video"><Clapperboard className="h-4 w-4" aria-hidden /><span className="hidden lg:inline">Video</span></button>
        <button type="button" onClick={p.onFullscreen} className={cn(chip, "hidden sm:inline-flex")} aria-label="Full screen"><Expand className="h-4 w-4" aria-hidden /></button>
      </div>
    </div>
  );
}
