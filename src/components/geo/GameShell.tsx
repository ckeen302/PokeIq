"use client";

import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from "react";
import { Check, Expand, Hourglass, MapPinned, Maximize, Minimize, Pin, PinOff, Shrink, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FullscreenApi {
  /** Browser full screen (the game already fills the window). */
  fs: boolean;
  toggle: () => void;
}

/**
 * The game's frame: a round or a round result takes the whole window (no
 * site chrome), GeoGuessr style. Browser full screen is an extra on top.
 * Escape (or the back button) hands control back to the hub through `onExit`;
 * while in browser full screen, Escape only leaves that.
 */
export function GameShell({ children, onExit, className }: { children: (api: FullscreenApi) => React.ReactNode; onExit?: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const exitRef = useRef(onExit);
  useEffect(() => {
    exitRef.current = onExit;
  });

  const exit = useCallback(() => {
    setFs(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  const enter = useCallback(async () => {
    setFs(true);
    try {
      await ref.current?.requestFullscreen();
    } catch {
      // No Fullscreen API (or refused): the frame already fills the window.
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFs(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.fullscreenElement) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select")) return;
      // An open dialog (the zoomed screenshot, the phone's map sheet) takes Escape first.
      if (document.querySelector('[role="dialog"]:not([aria-hidden="true"])')) return;
      exitRef.current?.();
    };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the game is up.
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  return (
    <div
      ref={ref}
      data-testid="geo-shell"
      data-fullscreen={fs ? "true" : undefined}
      className={cn("geo-frame fixed inset-0 z-[60] overflow-hidden bg-[#0f0d1f] text-white", className)}
    >
      {children({ fs, toggle: () => (fs ? exit() : void enter()) })}
    </div>
  );
}

/** The frame's top-right button: browser full screen. */
export function FullscreenButton({ fs, onClick, className }: { fs: boolean; onClick: () => void; className?: string }) {
  const Icon = fs ? Minimize : Maximize;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="geo-fullscreen"
      className={cn("hud-btn", className)}
      aria-label={fs ? "Exit full screen" : "Full screen"}
      aria-pressed={fs}
      title={fs ? "Exit full screen (Esc)" : "Full screen"}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** The frame's top-left button: back to the hub. */
export function ExitButton({ onClick, label = "Back to PokéGuessr", testId = "geo-exit" }: { onClick: () => void; label?: string; testId?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} className="hud-btn" aria-label={label} title={`${label} (Esc)`}>
      <X className="h-4 w-4" />
    </button>
  );
}

/**
 * The top-centre notch: a navy trapezoid holding the round, the mode and
 * whatever else the HUD needs to say, with the countdown pill hung under it.
 */
export function Notch({ children, below, className, wide }: { children: React.ReactNode; below?: React.ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={cn("pointer-events-none absolute left-1/2 top-0 z-20 flex -translate-x-1/2 flex-col items-center", className)}>
      <div className={cn("geo-notch pointer-events-auto flex min-h-[3.4rem] items-center justify-center gap-3 px-8 pb-2 pt-1.5 sm:min-h-[3.9rem]", wide ? "min-w-[min(28rem,92vw)]" : "min-w-[min(21rem,56vw)]")} data-testid="geo-notch">
        {children}
      </div>
      {below && <div className="pointer-events-auto mt-2">{below}</div>}
    </div>
  );
}

/**
 * The countdown pill: mm:ss with a ring that drains along the pill's edge.
 * Purple, then red and flashing for the urgent seconds.
 */
export function CountdownPill({ ms, totalMs, urgentMs = 10_000, testId, className, label }: { ms: number; totalMs: number; urgentMs?: number; testId?: string; className?: string; label?: string }) {
  const left = Math.max(0, ms);
  const s = Math.ceil(left / 1000);
  const frac = totalMs > 0 ? Math.min(1, left / totalMs) : 0;
  const urgent = left <= urgentMs && left > 0;
  return (
    <div
      className={cn("geo-pill relative flex h-12 w-[7.5rem] items-center justify-center rounded-full bg-[#1e1a3f] text-white shadow-lg", urgent && "geo-pill-urgent", className)}
      role="timer"
      aria-live={urgent ? "polite" : "off"}
      aria-label={label ?? `${s} seconds left`}
      data-urgent={urgent ? "true" : undefined}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 120 48" fill="none" aria-hidden>
        <rect x="2" y="2" width="116" height="44" rx="22" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
        <rect
          x="2"
          y="2"
          width="116"
          height="44"
          rx="22"
          pathLength={1}
          stroke={urgent ? "#ff5a5a" : "#8b7cff"}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="1"
          strokeDashoffset={1 - frac}
          className="transition-[stroke-dashoffset] duration-300 ease-linear"
        />
      </svg>
      <span className={cn("font-display text-[1.35rem] font-bold tabular-nums", urgent && "text-[#ff5a5a]")} data-testid={testId}>
        {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The mini-map dock
// ---------------------------------------------------------------------------

export const MAP_SIZES = ["s", "m", "l", "xl"] as const;
export type MapSize = (typeof MAP_SIZES)[number];
/** Each step's width; the map's own aspect gives the height. XL is a share of the window. */
const SIZE_HEIGHT: Record<MapSize, number> = { s: 200, m: 300, l: 430, xl: 0 };
/** The dock's width for a size step and the map's aspect ratio: S 280×200 on a 1.4 map, wider for the world; XL is a share of the window. */
export const dockWidth = (size: MapSize, aspect: number): string =>
  size === "xl" ? `min(60vw, calc(49vh * ${aspect}), calc(100% - 2rem))` : `min(${Math.round(SIZE_HEIGHT[size] * aspect)}px, calc(100% - 2rem))`;
const SIZE_KEY = "pokeiq:geo-map-size";
const STICKY_KEY = "pokeiq:geo-map-sticky";
/** The map shrinks back this long after the pointer leaves (unless pinned). */
const COLLAPSE_MS = 600;

function readSize(): MapSize {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    return (MAP_SIZES as readonly string[]).includes(v ?? "") ? (v as MapSize) : "s";
  } catch {
    return "s";
  }
}
function readSticky(): boolean {
  try {
    return localStorage.getItem(STICKY_KEY) === "1";
  } catch {
    return false;
  }
}
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts the game.
  }
};

/** Phones: below Tailwind's `md`, or a touch screen on its side (short and coarse). The map becomes the corner minimap there. */
export const PHONE_QUERY = "(max-width: 767px), (pointer: coarse) and (max-height: 520px)";
export function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/**
 * The guess map's dock. Desktop: bottom-right over the picture, half
 * transparent until the pointer (or focus) reaches it, when it grows a size
 * step in 250 ms; S/M/L/XL steps and a pin that keeps it open are remembered.
 * The Guess button sits full width under the map. Phone: a "Guess" pill
 * opens the map as a full-width bottom sheet, dragged to resize or close,
 * with the Guess bar pinned to its foot.
 */
export function MapDock({
  map,
  button,
  extra,
  hasPin,
  aspect = 1.4,
  tools,
  testId = "geo-dock",
}: {
  /** The map; `fill` asks it to fill the phone sheet instead of keeping its aspect. */
  map: (o: { fill: boolean }) => React.ReactNode;
  /** The map's width over its height: each size step keeps its height, so wide maps get a wider dock. */
  aspect?: number;
  /** The Guess button (full width). */
  button: React.ReactNode;
  /** Anything between the map and the button (the game picker). */
  extra?: React.ReactNode;
  /** A pin is down: the phone pill turns green. */
  hasPin: boolean;
  /** Phones: the round's buttons for the left of the bottom bar (round icon buttons, BAR_BTN). Ones marked data-keep stay while the map is up. */
  tools?: React.ReactNode;
  testId?: string;
}) {
  const phone = usePhone();
  const [size, setSize] = useState<MapSize>("s");
  const [sticky, setSticky] = useState(false);
  const [hot, setHot] = useState(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    setSize(readSize());
    setSticky(readSticky());
    return () => window.clearTimeout(leaveTimer.current);
  }, []);

  const chooseSize = (next: MapSize) => {
    setSize(next);
    remember(SIZE_KEY, next);
  };
  const toggleSticky = () => {
    setSticky((s) => {
      remember(STICKY_KEY, s ? "0" : "1");
      return !s;
    });
  };
  const warm = () => {
    window.clearTimeout(leaveTimer.current);
    setHot(true);
  };
  const cool = () => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHot(false), COLLAPSE_MS);
  };

  if (phone) return <PhoneMap map={map} button={button} extra={extra} hasPin={hasPin} tools={tools} testId={testId} />;

  const open = hot || sticky;
  // Open: one step up from the chosen size (XL is the top: it stays, so the button under it never flickers).
  const shown: MapSize = open ? MAP_SIZES[Math.min(MAP_SIZES.length - 1, MAP_SIZES.indexOf(size) + 1)] : size;
  const idx = MAP_SIZES.indexOf(size);
  const control = "flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75 disabled:opacity-35 disabled:hover:bg-black/55";
  return (
    <div
      data-testid={testId}
      data-size={shown}
      data-open={open ? "true" : undefined}
      data-sticky={sticky ? "true" : undefined}
      className={cn("geo-dock absolute bottom-4 right-4 z-10 flex flex-col gap-2 transition-[width,opacity] duration-[250ms] ease-out", open ? "opacity-100" : "opacity-50 hover:opacity-100")}
      style={{ width: dockWidth(shown, aspect) }}
      onPointerOver={warm}
      onPointerLeave={cool}
      onFocusCapture={warm}
      onBlurCapture={cool}
    >
      <div className="relative rounded-md shadow-2xl">
        {map({ fill: false })}
        <div className="absolute left-1.5 top-1.5 z-[2] flex flex-col gap-1" role="group" aria-label="Map size">
          <button type="button" className={control} onClick={() => chooseSize(MAP_SIZES[Math.min(MAP_SIZES.length - 1, idx + 1)])} disabled={idx >= MAP_SIZES.length - 1} aria-label="Bigger map" title="Bigger map" data-testid="geo-map-grow">
            <Expand className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={control} onClick={() => chooseSize(MAP_SIZES[Math.max(0, idx - 1)])} disabled={idx <= 0} aria-label="Smaller map" title="Smaller map" data-testid="geo-map-shrink">
            <Shrink className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={cn(control, sticky && "bg-[#6c5ce7] hover:bg-[#7d6ff0]")} onClick={toggleSticky} aria-pressed={sticky} aria-label={sticky ? "Unpin the map" : "Keep the map open"} title={sticky ? "Unpin the map" : "Keep the map open"} data-testid="geo-map-pin">
            {sticky ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {extra}
      {button}
    </div>
  );
}

/** A round icon button in the phone's bottom bar. */
export const BAR_BTN =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#4a3f9e] text-white shadow-[inset_0_-3px_0_rgba(0,0,0,0.25)] ring-1 ring-white/15 transition-[background-color,transform] active:scale-95 [-webkit-tap-highlight-color:transparent] hover:bg-[#5a4fb8]";

/**
 * The phone layout, GeoGuessr's: a solid bar along the bottom with the round's
 * tools on the left and one big map button on the right. The map button opens
 * the map as a large rounded card over the picture (the picture still shows
 * around it), under a "Tap the map" label; the map button turns into a round
 * check that guesses, dimmed until a pin is down. Tapping outside the card,
 * its close button or Escape puts it away. The map stays mounted, so the pin
 * and the zoom carry over.
 */
function PhoneMap({ map, button, extra, hasPin, tools, testId }: { map: (o: { fill: boolean }) => React.ReactNode; button: React.ReactNode; extra?: React.ReactNode; hasPin: boolean; tools?: React.ReactNode; testId: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  // The Guess button, drawn as the bar's big round check.
  const check = isValidElement<GuessButtonProps>(button) ? cloneElement(button, { round: true }) : button;
  return (
    <>
      {/* A tap on the picture around the card puts the map away. */}
      {open && <button type="button" className="absolute inset-x-0 top-0 z-[14] cursor-default" style={{ bottom: "var(--geo-bar)" }} onClick={() => setOpen(false)} aria-label="Back to the picture" tabIndex={-1} />}
      <div
        data-testid={testId}
        data-open={open ? "true" : undefined}
        data-phone="true"
        className={cn(
          "absolute inset-x-3 z-[15] transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none",
          open ? "visible translate-y-0 scale-100 opacity-100" : "pointer-events-none invisible translate-y-4 scale-[0.97] opacity-0"
        )}
        style={{ top: "calc(env(safe-area-inset-top) + 6.5rem)", bottom: "calc(var(--geo-bar) + 0.75rem)", marginLeft: "env(safe-area-inset-left)", marginRight: "env(safe-area-inset-right)" }}
        role="dialog"
        aria-label="Guess map"
        aria-hidden={!open}
      >
        <div className="relative h-full overflow-hidden rounded-[1.75rem] bg-[#165c96] shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-4 ring-[#a99cff]/80">
          {map({ fill: true })}
          <button type="button" onClick={() => setOpen(false)} data-testid="geo-map-collapse" className="absolute left-2.5 top-2.5 z-[3] flex h-9 w-9 items-center justify-center rounded-full bg-[#1e1a3f]/90 text-white shadow-lg ring-1 ring-white/20" aria-label="Back to the picture">
            <X className="h-4 w-4" />
          </button>
          {extra && <div className="absolute inset-x-2 bottom-2 z-[3]">{extra}</div>}
        </div>
        <p className="pointer-events-none absolute left-1/2 top-0 z-[4] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#1e1a3f] px-4 py-2 font-display text-sm font-bold italic text-white shadow-lg ring-2 ring-[#a99cff]/70" data-testid="geo-map-hint">
          {hasPin ? "Tap again to move your pin" : "Tap the map to place your guess"}
        </p>
      </div>

      {/* The bottom bar: the round's tools, and the big map button (the check, once the map is up). */}
      <div
        className="geo-bar absolute inset-x-0 bottom-0 z-[16] flex items-center gap-2.5 border-t-2 border-[#a99cff]/50 bg-gradient-to-b from-[#2d2766] to-[#1e1a3f] px-4"
        style={{ height: "var(--geo-bar)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "max(1rem, env(safe-area-inset-left))", paddingRight: "max(1rem, env(safe-area-inset-right))" }}
        data-testid="geo-bar"
      >
        <div className={cn("flex min-w-0 flex-1 items-center gap-2.5", open && "[&>:not([data-keep])]:hidden")}>{tools}</div>
        {open ? (
          check
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            data-testid="geo-map-pill"
            className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#62d42a] to-[#3f9e12] text-white shadow-[0_4px_16px_rgba(76,187,23,0.45),inset_0_-4px_0_rgba(0,0,0,0.2)] ring-4 ring-[#1e1a3f] outline outline-2 outline-[#a99cff]/60 transition-transform active:scale-95 [-webkit-tap-highlight-color:transparent]"
            aria-label={hasPin ? "Open the map to move your pin or guess" : "Open the map to place your pin"}
            aria-expanded={false}
          >
            <MapPinned className="h-7 w-7" aria-hidden />
            {hasPin && <span className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-[#ffd23c] ring-2 ring-[#1e1a3f]" aria-hidden data-testid="geo-map-pinned" />}
          </button>
        )}
      </div>
    </>
  );
}

/** The Guess button under the map: grey until a pin is down, then green; Space submits. */
export interface GuessButtonProps {
  hasPin: boolean;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  onClick: () => void;
  testId?: string;
  /** The phone bar's big round check (MapDock sets it). */
  round?: boolean;
}

export function GuessButton({ hasPin, disabled, busy, label, onClick, testId = "geo-guess", round }: GuessButtonProps) {
  const off = disabled || !hasPin;
  if (round) {
    const name = label ?? (hasPin ? "Guess" : "Place your pin on the map first");
    return (
      <button
        type="button"
        disabled={off}
        onClick={onClick}
        data-testid={testId}
        aria-label={name}
        title={name}
        className={cn(
          "flex h-16 w-16 shrink-0 items-center justify-center rounded-full ring-4 ring-[#1e1a3f] outline outline-2 transition-[background-color,transform,opacity,box-shadow] duration-200 [-webkit-tap-highlight-color:transparent]",
          off
            ? "cursor-not-allowed bg-[#2d2766] text-white/35 outline-white/15"
            : "bg-gradient-to-b from-[#62d42a] to-[#3f9e12] text-white shadow-[0_4px_16px_rgba(76,187,23,0.45),inset_0_-4px_0_rgba(0,0,0,0.2)] outline-[#a99cff]/60 active:scale-95"
        )}
      >
        {busy ? (
          <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-white/40 border-t-white" aria-hidden />
        ) : label ? (
          <Hourglass className="h-7 w-7" aria-hidden />
        ) : (
          <Check className="h-8 w-8" strokeWidth={3.5} aria-hidden />
        )}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={off}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex h-12 w-full items-center justify-center gap-2 rounded-md font-display text-base font-bold uppercase tracking-wider shadow-lg transition-[background-color,transform,opacity] duration-200",
        off ? "cursor-not-allowed bg-black/60 text-white/50 backdrop-blur" : "bg-[#4cbb17] text-white hover:bg-[#58d01c] active:scale-[0.98]"
      )}
    >
      {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> : null}
      {label ?? (hasPin ? "Guess" : "Place your pin on the map")}
      {hasPin && !busy && !label && <kbd aria-hidden className="ml-1 hidden rounded border border-white/40 px-1.5 text-[10px] font-normal normal-case sm:inline [@media(pointer:coarse)]:!hidden">Space</kbd>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The phone's round HUD (GeoGuessr's layout): dials top-left, the round badge top-right
// ---------------------------------------------------------------------------

/** The top-left capsule that holds the phone's round dials. */
export function HudDials({ children }: { children: React.ReactNode }) {
  return (
    <div className="geo-safe-tl absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-[#1e1a3f]/55 p-1.5 shadow-lg ring-1 ring-white/10 backdrop-blur" data-testid="geo-dials">
      {children}
    </div>
  );
}

const DIAL = "relative flex h-[3.75rem] w-[3.75rem] flex-col items-center justify-center rounded-full bg-[#1e1a3f] text-white ring-2 ring-[#a99cff]/70 shadow-[inset_0_2px_8px_rgba(0,0,0,0.5)]";

/** The countdown as a dial: m:ss inside a ring that drains, red for the urgent seconds. */
export function TimerDial({ ms, totalMs, urgentMs = 10_000, testId }: { ms: number; totalMs: number; urgentMs?: number; testId?: string }) {
  const left = Math.max(0, ms);
  const s = Math.ceil(left / 1000);
  const frac = totalMs > 0 ? Math.min(1, left / totalMs) : 0;
  const urgent = left <= urgentMs && left > 0;
  return (
    <div className={cn(DIAL, urgent && "geo-pill-urgent")} role="timer" aria-live={urgent ? "polite" : "off"} aria-label={`${s} seconds left`} data-urgent={urgent ? "true" : undefined}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 60 60" fill="none" aria-hidden>
        <circle cx="30" cy="30" r="25" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
        <circle cx="30" cy="30" r="25" pathLength={1} stroke={urgent ? "#ff5a5a" : "#8b7cff"} strokeWidth="4" strokeLinecap="round" strokeDasharray="1" strokeDashoffset={1 - frac} className="transition-[stroke-dashoffset] duration-300 ease-linear" />
      </svg>
      <span className={cn("font-display text-base font-bold tabular-nums leading-none", urgent && "text-[#ff5a5a]")} data-testid={testId}>
        {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
      </span>
    </div>
  );
}

/** A number on a dial, with a small word under it (the score so far, the streak). */
export function ValueDial({ value, unit, tone = "#9be15d", testId }: { value: React.ReactNode; unit: string; tone?: string; testId?: string }) {
  return (
    <div className={DIAL} data-testid={testId}>
      <span className="font-display text-[0.95rem] font-bold tabular-nums leading-none" style={{ color: tone }}>
        {value}
      </span>
      <span className="mt-0.5 font-pixel text-[7px] uppercase leading-none tracking-wider text-white/60">{unit}</span>
    </div>
  );
}

/** The top-right round badge: the word, then the number in a pin-shaped tag. */
export function RoundBadge({ label = "Round", value, of, mode, testId }: { label?: string; value: React.ReactNode; of?: number; mode?: string; testId?: string }) {
  return (
    <div className="geo-safe-tr absolute right-3 top-3 z-20 flex max-w-[55%] flex-col items-end gap-1">
      <div className="flex h-11 items-center gap-2 rounded-xl bg-[#1e1a3f]/95 pl-3.5 pr-2 shadow-lg ring-2 ring-[#a99cff]/40" data-testid={testId}>
        <span className="font-display text-base font-bold uppercase italic tracking-wide text-[#c8bfff]">{label}</span>
        <span className="flex h-7 min-w-7 items-center justify-center rounded-full rounded-br-sm bg-[#6c5ce7] px-1.5 font-display text-sm font-bold text-white shadow-inner">{value}</span>
        {of !== undefined && <span className="font-display text-xs font-semibold text-white/50">/{of}</span>}
      </div>
      {/* The map and the mode (Daily #, Weekly #, difficulty), small under the badge. */}
      {mode && (
        <span className="max-w-full truncate rounded-md bg-[#1e1a3f]/70 px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-[#c8bfff] backdrop-blur" data-testid="geo-round-mode">
          {mode}
        </span>
      )}
    </div>
  );
}
