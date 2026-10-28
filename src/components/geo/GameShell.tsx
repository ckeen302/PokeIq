"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronsDown, Maximize, Minimize, Pin, PinOff, Shrink, Expand, X, Map as MapIcon } from "lucide-react";
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

/** True below Tailwind's `md` (phones): the map becomes a bottom sheet there. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
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

  if (phone) return <MapSheet map={map} button={button} extra={extra} hasPin={hasPin} testId={testId} />;

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

/** The phone layout: a pill opens the map as a bottom sheet, dragged by its handle to resize or close. */
function MapSheet({ map, button, extra, hasPin, testId }: { map: (o: { fill: boolean }) => React.ReactNode; button: React.ReactNode; extra?: React.ReactNode; hasPin: boolean; testId: string }) {
  const [open, setOpen] = useState(false);
  const [vh, setVh] = useState(70);
  const drag = useRef<{ y: number; vh: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, vh };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    setVh(Math.max(20, Math.min(92, drag.current.vh + (dy / window.innerHeight) * 100)));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (vh < 30) {
      setOpen(false);
      setVh(70);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="geo-map-pill"
        className={cn(
          "absolute bottom-5 left-1/2 z-10 flex h-14 -translate-x-1/2 items-center gap-2 rounded-full px-6 font-display text-lg font-bold uppercase tracking-wide text-white shadow-xl transition-[transform,opacity] duration-[250ms]",
          hasPin ? "bg-[#4cbb17]" : "bg-[#1e1a3f]/95 ring-2 ring-white/15",
          open && "pointer-events-none translate-y-6 opacity-0"
        )}
        aria-expanded={open}
      >
        <MapIcon className="h-5 w-5" aria-hidden /> Guess
      </button>
      <div
        data-testid={testId}
        data-open={open ? "true" : undefined}
        className={cn("absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl bg-[#14112b] shadow-[0_-12px_40px_rgba(0,0,0,0.5)] transition-transform duration-[250ms] ease-out", open ? "translate-y-0" : "translate-y-full")}
        style={{ height: `${vh}vh` }}
        role="dialog"
        aria-label="Guess map"
        aria-hidden={!open}
      >
        <div className="flex shrink-0 items-center justify-between px-3 pt-2" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} style={{ touchAction: "none" }}>
          <span className="w-9" />
          <span className="h-1.5 w-12 rounded-full bg-white/30" aria-hidden />
          <button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10" aria-label="Close the map">
            <ChevronsDown className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md px-2 pb-2">{map({ fill: true })}</div>
        {extra && <div className="shrink-0 px-2 pb-2">{extra}</div>}
        <div className="shrink-0 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">{button}</div>
      </div>
    </>
  );
}

/** The Guess button under the map: grey until a pin is down, then green; Space submits. */
export function GuessButton({ hasPin, disabled, busy, label, onClick, testId = "geo-guess" }: { hasPin: boolean; disabled?: boolean; busy?: boolean; label?: string; onClick: () => void; testId?: string }) {
  const off = disabled || !hasPin;
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
      {hasPin && !busy && !label && <kbd aria-hidden className="ml-1 hidden rounded border border-white/40 px-1.5 text-[10px] font-normal normal-case sm:inline">Space</kbd>}
    </button>
  );
}
