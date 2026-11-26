"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { HubGlobeApi, HubRegion } from "./scene";

/**
 * The landing's live planet (scene.ts), loaded once the page is idle: until then (and if WebGL can't run) a still of
 * the same first frame (public/geo/hub-globe.webp, made from the scene) holds its place, so nothing jumps when the
 * live one takes over.
 */

/** The main regions, at their atlas points (public/atlas/atlas.json, tier 1), never moved. */
export const HUB_REGIONS: HubRegion[] = [
  { name: "Kanto", x: 4114, y: 1328 },
  { name: "Johto", x: 3463, y: 1335 },
  { name: "Hoenn", x: 3020, y: 1894 },
  { name: "Sinnoh", x: 3948, y: 500 },
  { name: "Unova", x: 578, y: 1349 },
  { name: "Kalos", x: 2327, y: 628 },
  { name: "Alola", x: 5076, y: 2039 },
  { name: "Galar", x: 1489, y: 773 },
  { name: "Paldea", x: 2204, y: 1386 },
];

/** The disc's share of the canvas (the rest is the atmosphere's glow). */
export const HUB_GLOBE_FRAC = 0.8;

const LABEL_CSS = `
.hg-label { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: default; white-space: nowrap; border-radius: 4px; padding: 3px 6px;
  font-family: var(--font-display, inherit); font-weight: 700; font-size: 10px; line-height: 1; letter-spacing: .16em; text-transform: uppercase;
  color: rgb(255 255 255 / .94); background: rgb(18 15 36 / .58); box-shadow: 0 0 0 1px rgb(255 255 255 / .2), 0 2px 8px rgb(0 0 0 / .35);
  backdrop-filter: blur(2px); will-change: transform, opacity; transition: background-color .3s, color .3s, box-shadow .3s; }
.hg-label.hg-lit { background: #ffd23c; color: #2a1a00; box-shadow: 0 0 0 1px rgb(255 243 196 / .7), 0 2px 12px rgb(0 0 0 / .45); }
.hg-label.hg-dim { color: rgb(255 255 255 / .6); }
@media (min-width: 768px) { .hg-label { font-size: 11px; padding: 4px 7px } }
.hg-pin { position: absolute; left: 0; top: 0; margin: -16px 0 0 -6px; filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / .6)); will-change: transform, opacity; }
.hg-pin > svg { transform: translate(50%, 50%) }
`;

export function HubGlobe({
  mode = "spin",
  focus,
  spots,
  paused,
  label,
  className,
}: {
  mode?: "spin" | "tour";
  focus: string | null;
  spots?: [number, number][];
  paused?: boolean;
  label(name: string): string;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const api = useRef<HubGlobeApi | null>(null);
  const [live, setLive] = useState(false);
  const labelRef = useRef(label);
  labelRef.current = label;
  const [facing, setFacing] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    let made: HubGlobeApi | null = null;
    const start = () => {
      import("./scene")
        .then(({ createHubGlobe }) => {
          if (gone || !host.current || !layer.current) return;
          made = createHubGlobe(host.current, layer.current, {
            regions: HUB_REGIONS,
            label: (n) => labelRef.current(n),
            frac: HUB_GLOBE_FRAC,
            mode,
            onReady: () => !gone && setLive(true),
            onFailed: () => {
              made?.dispose();
              made = null;
              api.current = null;
              if (!gone) setLive(false);
            },
            onFacing: (n) => !gone && setFacing(n),
          });
          api.current = made;
          (window as unknown as { __hubGlobe?: HubGlobeApi | null }).__hubGlobe = made;
        })
        .catch(() => {});
    };
    // After the page's own first paint and work: the still is there until then.
    const idle = typeof requestIdleCallback === "function";
    const id = idle ? requestIdleCallback(start, { timeout: 1200 }) : window.setTimeout(start, 300);
    return () => {
      gone = true;
      if (idle) cancelIdleCallback(id);
      else clearTimeout(id);
      made?.dispose();
      api.current = null;
    };
  }, [mode]);

  const lit = hovered ?? focus;
  useEffect(() => api.current?.focus(lit), [lit, live]);
  useEffect(() => api.current?.setPins(spots ?? []), [spots, live]);
  useEffect(() => api.current?.setPaused(!!paused), [paused, live]);

  return (
    <div className={cn("absolute inset-0", className)} data-live={live || undefined} data-focus={lit ?? undefined}>
      <style>{LABEL_CSS}</style>
      {/* eslint-disable-next-line @next/next/no-img-element -- the still is the scene's own first frame, sized by its box */}
      <img
        src="/geo/hub-globe.webp"
        alt=""
        fetchPriority="high"
        className={cn("pointer-events-none absolute inset-0 h-full w-full select-none transition-opacity duration-700", live ? "opacity-0" : "opacity-100")}
        draggable={false}
      />
      <div
        ref={host}
        className="pointer-events-auto absolute inset-0 cursor-grab touch-pan-y rounded-full"
        data-testid="geo-home-globe"
      >
        <div
          ref={layer}
          className={cn("pointer-events-none absolute inset-0 transition-opacity duration-500", live ? "opacity-100" : "opacity-0")}
          onPointerOver={(e) => {
            const r = (e.target as HTMLElement).dataset?.region;
            if (r) setHovered(r);
          }}
          onPointerOut={(e) => {
            if ((e.target as HTMLElement).dataset?.region) setHovered(null);
          }}
        />
      </div>
      {mode === "tour" && (
        // The tour's dial: the region the world faces now, and a dot for each (west to east) to turn to it.
        <div className={cn("pointer-events-auto absolute inset-x-0 top-[90.5%] flex flex-col items-center gap-1.5 transition-opacity duration-500", live ? "opacity-100" : "opacity-0")} data-testid="geo-home-dial">
          <p className="font-display text-[11px] font-bold uppercase italic leading-none tracking-[0.22em] text-[#ffd23c] [text-shadow:0_1px_0_#120f24] md:text-sm" aria-live="polite">
            {facing ? label(facing) : "\u00a0"}
          </p>
          <div className="flex gap-1.5">
            {[...HUB_REGIONS].sort((a, b) => a.x - b.x).map((r) => (
              <button
                key={r.name}
                type="button"
                aria-label={label(r.name)}
                title={label(r.name)}
                onClick={() => api.current?.face(r.name)}
                className={cn("h-1.5 rounded-full transition-all duration-300", facing === r.name ? "w-5 bg-[#ffd23c]" : "w-1.5 bg-white/35 hover:bg-white/70")}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
