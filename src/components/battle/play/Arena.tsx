"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Backdrop } from "./Backdrop";
import type { ArenaApi } from "./arena/ArenaScene";
import type { ArenaField, ArenaKind } from "./arena/layout";

/**
 * The stage's backdrop: the 3D arena (three.js, loaded only once a battle
 * is on screen) or, without WebGL, under reduced motion and on devices that
 * can't keep up, the CSS backdrop. The CSS one also shows while the arena
 * loads, and the arena fades in over it. Drawn inside the backdrop layer
 * (Earthquake shakes it). `data-mode` says which one is up.
 */

export interface ArenaProps {
  kind: ArenaKind;
  active: number;
  field: ArenaField;
  /** The stage's CSS scale (the canvas draws at its on-screen size). */
  scale: number;
  /** The CSS backdrop's tint (terrain) and Trick Room. */
  tint?: string;
  trickRoom: boolean;
  /** The arena's handle for the crowd's reactions, or null on the CSS backdrop. */
  onApi?: (api: ArenaApi | null) => void;
}

/** A device this session has seen struggle (or lose its GL context) keeps the CSS backdrop. */
const SLOW_KEY = "pokeiq:battle:arena-slow";

type Mode = "css" | "loading" | "3d";

function cssOnly(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
    if (window.sessionStorage.getItem(SLOW_KEY) === "1") return true;
  } catch {
    // storage blocked: carry on
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) || (nav.deviceMemory && nav.deviceMemory <= 2)) return true;
  // ?arena=css forces the fallback (for checking it).
  return /[?&]arena=css\b/.test(window.location.search);
}

export const Arena = memo(function Arena({ kind, active, field, scale, tint, trickRoom, onApi }: ArenaProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<ArenaApi | null>(null);
  const [mode, setMode] = useState<Mode>("css");
  const [shown, setShown] = useState(false);
  const [quality, setQuality] = useState<number | null>(null);
  const latest = useRef({ field, scale, onApi });
  latest.current = { field, scale, onApi };

  useEffect(() => {
    if (cssOnly()) return;
    let live = true;
    setMode("loading");
    import("./arena/ArenaScene")
      .then(({ createArena }) => {
        if (!live || !host.current) return;
        // ?arenaq=0…3 pins the quality level (for checking each one).
        const pinned = /[?&]arenaq=([0-3])\b/.exec(window.location.search);
        const made = createArena(
          host.current,
          { kind, active, field: latest.current.field, scale: latest.current.scale, quality: pinned ? Number(pinned[1]) : null },
          {
            quality: (q) => live && setQuality(q),
            ready: () => {
              if (!live) return;
              setMode("3d");
              requestAnimationFrame(() => live && setShown(true));
            },
            failed: () => {
              try {
                window.sessionStorage.setItem(SLOW_KEY, "1");
              } catch {
                // not remembered
              }
              api.current = null;
              latest.current.onApi?.(null);
              if (live) {
                setShown(false);
                setMode("css");
              }
            },
          }
        );
        if (!made) {
          setMode("css");
          return;
        }
        api.current = made;
        latest.current.onApi?.(made);
      })
      .catch(() => live && setMode("css"));
    return () => {
      live = false;
      api.current?.dispose();
      api.current = null;
      latest.current.onApi?.(null);
    };
  }, [kind, active]);

  useEffect(() => {
    api.current?.setField(field);
  }, [field]);
  useEffect(() => {
    api.current?.setScale(scale);
  }, [scale]);

  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="battle-arena" data-mode={mode} data-kind={kind} data-q={quality ?? undefined} aria-hidden>
      {/* Under the canvas while it loads and fades in (and for good without it). */}
      <Backdrop trickRoom={trickRoom} tint={tint} />
      <div ref={host} className="absolute inset-0 transition-opacity duration-500" style={{ opacity: shown ? 1 : 0 }} />
      {mode === "3d" && <div className="battle-arena-vignette pointer-events-none absolute inset-0" />}
    </div>
  );
});
