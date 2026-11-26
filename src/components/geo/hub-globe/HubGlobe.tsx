"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { angleFacing, START_LON } from "./project";
import { createOverlay, type HubRegion, type Overlay } from "./overlay";
import type { HubGlobeApi } from "./scene";

/**
 * The landing's live planet (scene.ts: the World globe's world, three.js, loaded once the page is idle). Until it's
 * drawn, and wherever WebGL can't run, a still of its first frame holds the place (public/geo/hub-globe.webp, by day
 * hub-globe-day.webp, drawn by the scene itself), with the names on it, so nothing jumps when the live one takes over.
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

const CSS = `
.hg-poster { background: url(/geo/hub-globe.webp) center / 100% 100% no-repeat }
html.light .hg-poster { background-image: url(/geo/hub-globe-day.webp) }
.hg-grab { cursor: grab; touch-action: pan-y; -webkit-tap-highlight-color: transparent }
.hg-grab[data-dragging] { cursor: grabbing }
/* The World globe's region labels (.gl-lb.region), smaller. */
.hg-label { position: absolute; left: 0; top: 0; cursor: grab; touch-action: pan-y; user-select: none; white-space: nowrap; border-radius: 2px; padding: 2px 6px;
  font: 700 9px var(--font-display), sans-serif; letter-spacing: .16em; text-transform: uppercase; line-height: 1.3;
  color: hsl(var(--foreground)); background: hsl(var(--card) / .8); border: 1px solid hsl(var(--screen));
  will-change: transform, opacity; transition: background-color .25s, color .25s, border-color .25s, box-shadow .25s; }
.hg-label.hg-lit { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: #fff; box-shadow: 0 0 14px hsl(var(--primary) / .6) }
.hg-label.hg-dim { color: hsl(var(--foreground) / .6); border-color: hsl(var(--screen) / .5) }
@media (min-width: 768px) { .hg-label { font-size: 11px; padding: 2px 8px } }
.hg-pin { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform, opacity }
.hg-pin > svg { display: block; filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / .6)); transform-origin: 50% 100%; animation: hg-pin .55s cubic-bezier(.3,.9,.4,1) both }
@keyframes hg-pin { 0% { transform: translateY(-70%) scale(.2); opacity: 0 } 55% { transform: translateY(6%) scale(1.12, .88); opacity: 1 } 78% { transform: translateY(-8%) } 100% { transform: none; opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .hg-pin > svg { animation: none } .hg-label { transition: none } }
`;

type Debug = { __hubGlobe?: HubGlobeApi | null };

export function HubGlobe({
  focus,
  spots,
  paused,
  label,
  className,
}: {
  /** What a hovered mode points at: a region (an atlas name), the whole world, or nothing. */
  focus: string | "world" | null;
  /** Today's Daily, played: roughly where its places were ([longitude, latitude]). */
  spots?: [number, number][];
  /** A game is open over the hub: no frames. */
  paused?: boolean;
  label(name: string): string;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const grab = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const overlay = useRef<Overlay | null>(null);
  const api = useRef<HubGlobeApi | null>(null);
  const [live, setLive] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const labelRef = useRef(label);
  labelRef.current = label;

  // The names (and pins), placed on the poster at once; the live globe moves them once it's drawn.
  useEffect(() => {
    const ov = createOverlay(layer.current!, { regions: HUB_REGIONS, label: (n) => labelRef.current(n), frac: HUB_GLOBE_FRAC, onHover: setHovered });
    overlay.current = ov;
    const el = host.current!;
    ov.place(angleFacing(START_LON), 0);
    const ro = new ResizeObserver(() => ov.resize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => {
      ro.disconnect();
      ov.dispose();
      overlay.current = null;
    };
  }, []);

  useEffect(() => {
    let gone = false;
    let made: HubGlobeApi | null = null;
    let tries = 0;
    const start = () => {
      if (gone || !host.current || !grab.current || !overlay.current) return;
      tries++;
      import("./scene")
        .then(({ createHubGlobe }) => {
          if (gone || !host.current || !grab.current || !overlay.current) return;
          made = createHubGlobe(host.current, grab.current, {
            frac: HUB_GLOBE_FRAC,
            overlay: overlay.current,
            onReady: () => !gone && setLive(true),
            onFailed: () => {
              made?.dispose();
              made = api.current = null;
              if (gone) return;
              setLive(false);
              // Back on the poster, the names where it shows them; a lost context gets one fresh start.
              overlay.current?.place(angleFacing(START_LON), 0);
              if (tries < 2) start();
            },
          });
          api.current = made;
          if (new URLSearchParams(location.search).has("hubglobe")) (window as Debug).__hubGlobe = made;
        })
        .catch(() => {});
    };
    // After the page's own first paint and work: the poster is there until then.
    const idle = typeof requestIdleCallback === "function";
    const id = idle ? requestIdleCallback(start, { timeout: 1200 }) : window.setTimeout(start, 300);
    return () => {
      gone = true;
      if (idle) cancelIdleCallback(id);
      else clearTimeout(id);
      made?.dispose();
      api.current = null;
    };
  }, []);

  const lit = hovered ?? focus;
  useEffect(() => {
    // A name pointed at lights where it is (the globe doesn't turn away from the pointer); a mode turns to its region.
    api.current?.focus(lit, !hovered);
    overlay.current?.light(lit && lit !== "world" ? lit : null, !!lit && lit !== "world");
  }, [lit, hovered, live]);
  // (By value: a new array of the same spots doesn't drop the pins in again.)
  const spotKey = JSON.stringify(spots ?? []);
  useEffect(() => overlay.current?.setPins(JSON.parse(spotKey)), [spotKey]);
  useEffect(() => api.current?.setPaused(!!paused), [paused, live]);

  return (
    <div className={cn("absolute inset-0", className)} data-live={live || undefined} data-focus={lit ?? undefined}>
      <style>{CSS}</style>
      <div className={cn("hg-poster pointer-events-none absolute inset-0 transition-opacity duration-700", live && "opacity-0")} aria-hidden />
      <div ref={host} className="pointer-events-none absolute inset-0" />
      {/* The disc: drag it to turn the world (only the disc, so the cards round it keep every click). */}
      <div
        ref={grab}
        className={cn("absolute rounded-full", live ? "hg-grab pointer-events-auto" : "pointer-events-none")}
        style={{ inset: `${((1 - HUB_GLOBE_FRAC) / 2) * 100}%` }}
        data-testid="geo-home-globe"
        aria-hidden
      />
      <div ref={layer} className="pointer-events-none absolute inset-0 [&>.hg-label]:pointer-events-auto" data-hg-layer="" />
    </div>
  );
}
