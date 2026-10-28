"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Minus, Plus } from "lucide-react";
import { WORLD_REGION, type GeoRegionInfo } from "@/lib/geo-types";
import { createAtlas, loadAtlas, type AtlasData, type AtlasEngine, type AtlasView, type Box } from "@/components/atlas/atlas-engine";
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
  /** Duels: the trainer's colour for their ball and line. */
  color?: string;
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

const WORLD_MAP = "/geo/maps/world.webp";
/** A reveal never zooms closer than this many world pixels across (a handful of towns). */
const REVEAL_MIN_BOX = 260;

/**
 * The guess map is the world atlas, labels and all: the whole world, or framed
 * on one region (the rest dimmed). Scroll or the buttons to zoom, drag to pan,
 * click to drop the pin. Pins are normalised to the map's box; a revealed
 * round zooms to fit the guess and the answer.
 */
export function GeoMap({ region, pick, revealed = [], onPick, className }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<AtlasEngine | null>(null);
  const pickRef = useRef(onPick);
  const [atlas, setAtlas] = useState<AtlasData | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<AtlasView | null>(null);
  const [x0, y0, x1, y1] = region.map.box;
  const bw = x1 - x0;
  const bh = y1 - y0;
  // Very tall or wide maps sit in a box of sensible proportions.
  const aspect = Math.min(2.4, Math.max(1, bw / bh));
  const toWorld = (x: number, y: number): [number, number] => [x0 + x * bw, y0 + y * bh];

  useEffect(() => {
    pickRef.current = onPick;
  });

  useEffect(() => {
    // The world map is the biggest download: start it now, alongside the atlas, not after it.
    new window.Image().src = WORLD_MAP;
    loadAtlas()
      .then(setAtlas)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!atlas || !canvas || !stage) return;
    const box: Box = [x0, y0, x1, y1];
    const e = createAtlas(canvas, stage, atlas, WORLD_MAP, {
      bounds: region.id === WORLD_REGION ? undefined : box,
      onTap: (wx, wy) => {
        const x = (wx - x0) / (x1 - x0);
        const y = (wy - y0) / (y1 - y0);
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) pickRef.current?.({ x, y });
      },
      onView: setView,
    });
    engine.current = e;
    return () => {
      e.destroy();
      engine.current = null;
    };
  }, [atlas, region.id, x0, y0, x1, y1]);

  // A revealed round zooms to show the guess and the answer together.
  const revealKey = revealed.map((r) => `${r.guess?.x},${r.guess?.y},${r.answer.pin}`).join("|");
  useEffect(() => {
    const e = engine.current;
    if (!e || !revealed.length) return;
    const pts = revealed.flatMap((r) => [toWorld(...r.answer.pin), ...(r.guess ? [toWorld(r.guess.x, r.guess.y)] : [])]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    void e.fitBox([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], REVEAL_MIN_BOX);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the revealed rounds or the map change
  }, [revealKey, atlas]);

  const toScreen = (x: number, y: number): [number, number] => {
    const [wx, wy] = toWorld(x, y);
    return view ? [wx * view.s + view.tx, wy * view.s + view.ty] : [0, 0];
  };
  // The answer's area: a dot of radius 6 world px on every area point (8 px apart), so they join into one patch at any zoom.
  const areaR = view ? Math.max(3, 6 * view.s) : 3;

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative w-full touch-none select-none overflow-hidden rounded-md border-2 border-foreground/20 bg-[#165c96]",
        onPick ? "cursor-crosshair" : "cursor-grab",
        className
      )}
      style={{ aspectRatio: `${aspect}` }}
      role={onPick ? "application" : "img"}
      aria-label={onPick ? `Map of ${region.name}: click where you think this is. Scroll to zoom, drag to move.` : `Map of ${region.name}`}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {!atlas && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
          {failed ? "Couldn't load the map. Try reloading." : <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading the map" />}
        </div>
      )}
      {view && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {revealed.map((r, i) => {
            const [ax, ay] = toScreen(r.answer.pin[0], r.answer.pin[1]);
            const g = r.guess ? toScreen(r.guess.x, r.guess.y) : null;
            // Duels reveal each trainer's guess as its own round on one shared answer: draw its area once.
            const again = i > 0 && revealed[i - 1].answer === r.answer;
            return (
              <g key={i}>
                <g className="geo-area" display={again ? "none" : undefined}>
                  {/* Faded as one layer, so overlapping dots read as one even patch. */}
                  <g opacity={0.5}>
                    {r.answer.mask.map(([x, y], k) => {
                      const [mx, my] = toScreen(x, y);
                      return <circle key={k} cx={mx} cy={my} r={areaR} className="fill-success" />;
                    })}
                  </g>
                </g>
                {g && <line className="geo-line" pathLength={1} x1={g[0]} y1={g[1]} x2={ax} y2={ay} strokeWidth={2.5} strokeLinecap="round" stroke={r.color ?? "#120f24"} />}
                <Flag x={ax} y={ay} />
                {g && <Ball x={g[0]} y={g[1]} label={r.label} color={r.color} />}
              </g>
            );
          })}
          {/* Keyed by position so every new pin replays the drop. */}
          {pick && <Ball key={`${pick.x},${pick.y}`} x={toScreen(pick.x, pick.y)[0]} y={toScreen(pick.x, pick.y)[1]} />}
        </svg>
      )}
      <div className="absolute right-1.5 top-1.5 flex flex-col gap-1">
        {[
          { label: "Zoom in", icon: <Plus className="h-3.5 w-3.5" />, act: () => engine.current?.zoomBy(1.6) },
          { label: "Zoom out", icon: <Minus className="h-3.5 w-3.5" />, act: () => engine.current?.zoomBy(1 / 1.6) },
          { label: "Show the whole map", icon: <Maximize2 className="h-3 w-3" />, act: () => engine.current?.reset() },
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
function Ball({ x, y, label, color = "#e2306f" }: { x: number; y: number; label?: string; color?: string }) {
  const r = 8;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="geo-drop">
        <circle r={r} fill="#fff" stroke="#120f24" strokeWidth={2} />
        <path d={`M${-r} 0a${r} ${r} 0 0 1 ${2 * r} 0z`} fill={color} stroke="#120f24" strokeWidth={2} />
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
