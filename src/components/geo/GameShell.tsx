"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Minimize } from "lucide-react";

export interface FullscreenApi {
  fs: boolean;
  toggle: () => void;
}

/**
 * The game container. "Full screen" puts all of it (picture, mini-map, HUD,
 * round results) into browser full screen; where the Fullscreen API is missing
 * or refused it becomes a fixed overlay instead. Esc or the button leaves.
 * Nothing is remembered.
 */
export function GameShell({ children }: { children: (api: FullscreenApi) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);

  const exit = useCallback(() => {
    setFs(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  const enter = useCallback(async () => {
    setFs(true);
    try {
      await ref.current?.requestFullscreen();
    } catch {
      // Overlay fallback: already fixed inset-0.
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFs(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) setFs(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  return (
    <div ref={ref} data-testid="geo-shell" data-fullscreen={fs ? "true" : undefined} className={fs ? "fixed inset-0 z-[60] overflow-auto bg-background" : undefined}>
      {children({ fs, toggle: () => (fs ? exit() : void enter()) })}
    </div>
  );
}

/** The frame's top-right button. */
export function FullscreenButton({ fs, onClick }: { fs: boolean; onClick: () => void }) {
  const Icon = fs ? Minimize : Maximize;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="geo-fullscreen"
      className="absolute right-3 top-3 z-[4] flex h-9 w-9 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
      aria-label={fs ? "Exit full screen" : "Full screen"}
      aria-pressed={fs}
      title={fs ? "Exit full screen (Esc)" : "Full screen"}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** Classes for the mini-map block: docked bottom-right on desktop, and always in full screen. */
export const dockClass = (fs: boolean) =>
  fs
    ? "group absolute bottom-4 right-4 z-10 w-[min(24rem,calc(100%-2rem))] space-y-2 transition-[width] duration-200 focus-within:w-[min(46rem,calc(100%-2rem))] hover:w-[min(46rem,calc(100%-2rem))]"
    : "group mt-3 space-y-2 lg:absolute lg:bottom-4 lg:right-4 lg:z-10 lg:mt-0 lg:w-[24rem] lg:transition-[width] lg:duration-200 lg:focus-within:w-[46rem] lg:hover:w-[46rem]";
