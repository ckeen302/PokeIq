"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { cn } from "@/lib/utils";

export interface MapPin {
  x: number;
  y: number;
}

export interface RevealedRound {
  guess: MapPin | null;
  answer: { pin: [number, number]; mask: [number, number][] };
  /** Round number shown on the markers in the end-of-game summary. */
  label?: string;
}

interface Props {
  region: GeoRegionInfo;
  /** The pin being placed this round. */
  pick?: MapPin | null;
  /** Rounds to reveal: the true area, its flag, and a line from the guess. */
  revealed?: RevealedRound[];
  onPick?: (pin: MapPin) => void;
  className?: string;
}

/** Zoom (1 = whole map fits) and the map point at the centre of the view, normalised. */
interface View {
  k: number;
  cx: number;
  cy: number;
}

const MAX_ZOOM = 12;
const FIT: View = { k: 1, cx: 0.5, cy: 0.5 };
/** Pointer travel (px) before a press counts as a drag rather than a click. */
const DRAG_SLOP = 5;

/**
 * A region's map, GeoGuessr-style: scroll or the buttons to zoom, drag to pan,
 * click to drop the guess pin. Markers keep their on-screen size at any zoom,
 * and a revealed round zooms to fit the guess and the answer.
 */
export function GeoMap({ region, pick, revealed = [], onPick, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { width: W, height: H, pixelArt } = region.map;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>(FIT);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  // Very tall or wide maps sit in a box of sensible proportions.
  const aspect = Math.min(2.4, Math.max(1, W / H));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = size.w && size.h ? Math.min(size.w / W, size.h / H) : 0;

  /** Keeps the map covering the box (or centred, on an axis where it's smaller). */
  const clamp = (v: View): View => {
    const k = Math.min(MAX_ZOOM, Math.max(1, v.k));
    const s = fit * k;
    const cx = W * s <= size.w ? 0.5 : Math.min(1 - size.w / (2 * W * s), Math.max(size.w / (2 * W * s), v.cx));
    const cy = H * s <= size.h ? 0.5 : Math.min(1 - size.h / (2 * H * s), Math.max(size.h / (2 * H * s), v.cy));
    return { k, cx, cy };
  };
  const v = fit ? clamp(view) : view;
  const s = fit * v.k;
  const ox = size.w / 2 - v.cx * W * s;
  const oy = size.h / 2 - v.cy * H * s;
  const toScreen = (x: number, y: number): [number, number] => [ox + x * W * s, oy + y * H * s];

  /** Zoom by `factor`, keeping the map point under screen (px, py) in place. */
  const zoomAt = (factor: number, px = size.w / 2, py = size.h / 2) => {
    setView((cur) => {
      const c = clamp(cur);
      const s0 = fit * c.k;
      const o0x = size.w / 2 - c.cx * W * s0;
      const o0y = size.h / 2 - c.cy * H * s0;
      const mx = (px - o0x) / s0;
      const my = (py - o0y) / s0;
      const k = Math.min(MAX_ZOOM, Math.max(1, c.k * factor));
      const s1 = fit * k;
      return clamp({ k, cx: (size.w / 2 - (px - mx * s1)) / (W * s1), cy: (size.h / 2 - (py - my * s1)) / (H * s1) });
    });
  };

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // A revealed round zooms to show the guess and the answer together; a new round starts zoomed out.
  const revealKey = revealed.map((r) => `${r.guess?.x},${r.guess?.y},${r.answer.pin}`).join("|");
  useEffect(() => {
    if (!revealed.length || !fit) {
      setView(FIT);
      return;
    }
    const pts = revealed.flatMap((r) => [r.answer.pin as [number, number], ...(r.guess ? [[r.guess.x, r.guess.y] as [number, number]] : [])]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // Fit the box with room for the markers; never closer than ~a town's width.
    const bw = Math.max((x1 - x0) * W, 90);
    const bh = Math.max((y1 - y0) * H, 90);
    const k = Math.min(size.w / (bw * 1.5), size.h / (bh * 1.6)) / fit;
    setView(clamp({ k, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the revealed rounds or the box size change
  }, [revealKey, fit]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, view: v, moved: false };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    d.moved = true;
    const s0 = fit * d.view.k;
    setView(clamp({ k: d.view.k, cx: d.view.cx - dx / (W * s0), cy: d.view.cy - dy / (H * s0) }));
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !onPick || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - ox) / (W * s);
    const y = (e.clientY - rect.top - oy) / (H * s);
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onPick({ x, y });
  }

  // The answer's area: dots sized like a town on the map, never smaller than a few pixels.
  const areaR = Math.max(3, (pixelArt ? Math.max(W, H) * 0.014 : 14) * s);

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      className={cn(
        "relative w-full touch-none select-none overflow-hidden rounded-md border-2 border-foreground/20 bg-[#165c96]",
        onPick ? "cursor-crosshair" : "cursor-grab",
        className
      )}
      style={{ aspectRatio: `${aspect}` }}
      role={onPick ? "application" : "img"}
      aria-label={onPick ? `Map of ${region.name}: click where you think this is. Scroll to zoom, drag to move.` : `Map of ${region.name}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the map is transformed by hand for zoom and pan */}
      <img
        src={region.map.src}
        alt=""
        draggable={false}
        className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
        style={{
          width: W,
          height: H,
          transform: `translate(${ox}px, ${oy}px) scale(${s})`,
          imageRendering: pixelArt ? "pixelated" : "auto",
          visibility: fit ? "visible" : "hidden",
        }}
      />
      {fit > 0 && (
        <svg width={size.w} height={size.h} className="pointer-events-none absolute inset-0" aria-hidden>
          {region.map.markers?.map(([x, y, w, h, city], i) => {
            // Specks from afar, full-size buildings up close.
            const min = Math.min(city ? 7 : 6, (city ? 3 : 2.2) * Math.sqrt(v.k));
            const mw = Math.max(w * W * s, min);
            const mh = Math.max(h * H * s, min);
            const [sx, sy] = toScreen(x, y);
            return (
              <rect
                key={`m${i}`}
                x={sx - mw / 2}
                y={sy - mh / 2}
                width={mw}
                height={mh}
                rx={Math.min(3, mw / 4)}
                fill={city ? "#e2475b" : "#4d7ee8"}
                stroke={city ? "#6e1626" : "#1d3878"}
                strokeWidth={Math.min(2, mw / 4)}
              />
            );
          })}
          {revealed.map((r, i) => {
            const [ax, ay] = toScreen(r.answer.pin[0], r.answer.pin[1]);
            const g = r.guess ? toScreen(r.guess.x, r.guess.y) : null;
            return (
              <g key={i}>
                <g className="geo-area">
                  {r.answer.mask.map(([x, y], k) => {
                    const [mx, my] = toScreen(x, y);
                    return <circle key={k} cx={mx} cy={my} r={areaR} className="fill-success/60" />;
                  })}
                </g>
                {g && <line className="geo-line" pathLength={1} x1={g[0]} y1={g[1]} x2={ax} y2={ay} strokeWidth={2.5} strokeLinecap="round" stroke="#120f24" />}
                <Flag x={ax} y={ay} />
                {g && <Ball x={g[0]} y={g[1]} label={r.label} />}
              </g>
            );
          })}
          {/* Keyed by position so every new pin replays the drop. */}
          {pick && <Ball key={`${pick.x},${pick.y}`} x={toScreen(pick.x, pick.y)[0]} y={toScreen(pick.x, pick.y)[1]} />}
        </svg>
      )}
      <div className="absolute right-1.5 top-1.5 flex flex-col gap-1">
        {[
          { label: "Zoom in", icon: <Plus className="h-3.5 w-3.5" />, act: () => zoomAt(1.6) },
          { label: "Zoom out", icon: <Minus className="h-3.5 w-3.5" />, act: () => zoomAt(1 / 1.6) },
          { label: "Show the whole map", icon: <Maximize2 className="h-3 w-3" />, act: () => setView(FIT) },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={b.act}
            aria-label={b.label}
            title={b.label}
            className="flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
          >
            {b.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The guess marker: a tiny Poké Ball that drops in. */
function Ball({ x, y, label }: { x: number; y: number; label?: string }) {
  const r = 8;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="geo-drop">
        <circle r={r} fill="#fff" stroke="#120f24" strokeWidth={2} />
        <path d={`M${-r} 0a${r} ${r} 0 0 1 ${2 * r} 0z`} fill="#e2306f" stroke="#120f24" strokeWidth={2} />
        <circle r={2.6} fill="#fff" stroke="#120f24" strokeWidth={1.4} />
        {label && (
          <text y={-r - 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff" stroke="#120f24" strokeWidth={3} paintOrder="stroke">
            {label}
          </text>
        )}
      </g>
    </g>
  );
}

/** The true location: a green flag that pops up after the line draws. */
function Flag({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="geo-flag">
        <circle r={4} fill="#120f24" />
        <path d="M0 0V-20" stroke="#120f24" strokeWidth={2.4} />
        <path d="M0 -20l13 4.6l-13 4.6z" className="fill-success" stroke="#120f24" strokeWidth={1.4} />
      </g>
    </g>
  );
}
