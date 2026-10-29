"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Maximize2, Minus, Plus } from "lucide-react";
import { WORLD_REGION, type GeoRegionInfo } from "@/lib/geo-types";
import { createAtlas, loadAtlas, type AtlasData, type AtlasEngine, type AtlasView, type Box } from "@/components/atlas/atlas-engine";
import { preloadImage } from "@/lib/preload";
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
  /** Duels: the trainer's colour for their pin and line. */
  color?: string;
  /** The trainer's avatar, shown inside the pin. */
  image?: string;
}

export interface FitTiming {
  /** Wait this long (ms) before the camera moves, so the line can draw first. */
  delay?: number;
  /** The camera's move, in ms (eased out). */
  duration?: number;
}

interface Props {
  region: GeoRegionInfo;
  /** The pin being placed this round. */
  pick?: MapPin | null;
  /** The player's avatar in their pin. */
  pinImage?: string;
  /** Rounds to reveal: the true area, its flag, and a line from the guess. */
  revealed?: RevealedRound[];
  /** When a reveal's camera moves (default: at once, the engine's glide). */
  fit?: FitTiming;
  onPick?: (pin: MapPin) => void;
  /** Hide the zoom buttons (a dock adds its own cluster). */
  controls?: boolean;
  className?: string;
  /** Fill the parent instead of keeping the map's aspect ratio. */
  fill?: boolean;
  /** Other trainers' pins shown live (a team duel's teammates): their colour, avatar and name. */
  others?: (MapPin & { color?: string; image?: string; label?: string })[];
}

export const WORLD_MAP = "/geo/maps/world.webp";
/** A small copy of the whole world, shown while the big map loads on the world map itself. */
const WORLD_THUMB = "/geo/maps/world-thumb.webp";
/** The world map has been decoded on this page (every map after the first draws it at once). */
let worldMapReady = false;
/** How long the first paint waits for the region's crop before the map goes on without it. */
const CROP_WAIT_MS = 1500;
/** The engine frames a locked region with this much room around it (atlas-engine's home view). */
const LOCKED_ROOM = 1.04;
/** A reveal never zooms closer than this many world pixels across (a handful of towns). */
const REVEAL_MIN_BOX = 260;
/** The line draws itself over this long before the camera moves. */
export const LINE_DRAW_MS = 600;

/** A map's width over its height as drawn (very tall or wide maps sit in a box of sensible proportions). */
export function mapAspect(region: Pick<GeoRegionInfo, "map">): number {
  const [x0, y0, x1, y1] = region.map.box;
  return Math.min(2.4, Math.max(1, (x1 - x0) / (y1 - y0)));
}

/**
 * The guess map is the world atlas, labels and all: the whole world, or framed
 * on one region (the rest dimmed). Scroll or the buttons to zoom, drag to pan,
 * click to drop the pin. Pins are normalised to the map's box; a revealed
 * round draws a dashed line from the guess to the answer, then zooms to fit
 * them both.
 */
export function GeoMap({ region, pick, pinImage, revealed = [], fit, onPick, controls = true, className, fill, others = [] }: Props) {
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
  const aspect = mapAspect(region);
  const toWorld = (x: number, y: number): [number, number] => [x0 + x * bw, y0 + y * bh];
  const locked = region.id !== WORLD_REGION;
  /**
   * First paint: the region's own crop of the map (a few dozen KB), or a small
   * copy of the world, drawn over the canvas until the 580 KB world map has
   * been decoded; then it fades out over the same pixels, with no jump. Once
   * the world map is in, later maps on the page skip all this.
   */
  const crop = locked ? region.map.src : WORLD_THUMB;
  const [cover, setCover] = useState<"shown" | "fading" | "gone">(() => (worldMapReady ? "gone" : "shown"));
  const [cropPainted, setCropPainted] = useState(worldMapReady);

  useEffect(() => {
    pickRef.current = onPick;
  });

  useEffect(() => {
    loadAtlas()
      .then(setAtlas)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (worldMapReady) return;
    let off = false;
    // The crop is decoded and given a frame to paint before the world map is asked for.
    const painted = preloadImage(crop).then(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    void Promise.race([painted, new Promise<void>((r) => setTimeout(r, CROP_WAIT_MS))]).then(() => {
      if (!off) setCropPainted(true);
    });
    return () => {
      off = true;
    };
  }, [crop]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!atlas || !canvas || !stage || !cropPainted) return;
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
    // The engine is loading the world map now; once it's decoded and drawn, the crop fades out over it.
    let off = false;
    let fade = 0;
    if (!worldMapReady) {
      void preloadImage(WORLD_MAP).then(() => {
        worldMapReady = true;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (off) return;
            setCover("fading");
            fade = window.setTimeout(() => !off && setCover("gone"), 350);
          })
        );
      });
    }
    return () => {
      off = true;
      window.clearTimeout(fade);
      e.destroy();
      engine.current = null;
    };
  }, [atlas, cropPainted, region.id, x0, y0, x1, y1]);

  // A revealed round zooms to show the guess and the answer together, once the line has drawn.
  const revealKey = revealed.map((r) => `${r.guess?.x},${r.guess?.y},${r.answer.pin}`).join("|");
  const fitDelay = fit?.delay ?? 0;
  const fitDuration = fit?.duration;
  useEffect(() => {
    const e = engine.current;
    if (!e || !revealed.length) return;
    const pts = revealed.flatMap((r) => [toWorld(...r.answer.pin), ...(r.guess ? [toWorld(r.guess.x, r.guess.y)] : [])]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const box: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setTimeout(() => void engine.current?.fitBox(box, REVEAL_MIN_BOX, fitDuration), reduced ? 0 : fitDelay);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the revealed rounds or the map change
  }, [revealKey, atlas]);

  const toScreen = (x: number, y: number): [number, number] => {
    const [wx, wy] = toWorld(x, y);
    return view ? [wx * view.s + view.tx, wy * view.s + view.ty] : [0, 0];
  };
  // The answer's area: a dot of radius 6 world px on every area point (8 px apart), so they join into one patch at any zoom.
  const areaR = view ? Math.max(3, 6 * view.s) : 3;
  const maskId = useId();

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative w-full touch-none select-none overflow-hidden bg-[#165c96]",
        fill ? "h-full" : "rounded-md border-2 border-foreground/20",
        onPick ? "cursor-crosshair" : "cursor-grab",
        className
      )}
      style={fill ? undefined : { aspectRatio: `${aspect}` }}
      role={onPick ? "application" : "img"}
      aria-label={onPick ? `Map of ${region.name}: click where you think this is. Scroll to zoom, drag to move.` : `Map of ${region.name}`}
      data-testid="geo-map"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {cover !== "gone" && (
        // Before the engine reports a view, the crop sits where the engine will frame the region (centred, with its room around it).
        <div
          className={cn("pointer-events-none absolute transition-opacity duration-300", cover === "fading" ? "opacity-0" : "opacity-100")}
          style={view ? { left: x0 * view.s + view.tx, top: y0 * view.s + view.ty, width: bw * view.s, height: bh * view.s } : { inset: locked ? `${((1 - 1 / LOCKED_ROOM) / 2) * 100}%` : 0 }}
          data-testid="geo-map-cover"
          aria-hidden
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- the region's crop of the world map, first paint */}
          <img src={crop} alt="" className={cn("h-full w-full", view ? "max-w-none" : "object-contain")} draggable={false} />
        </div>
      )}
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
            const mask = `${maskId}-${i}`;
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
                {g && (
                  <>
                    {/* The dashed line is revealed by a solid line drawing itself underneath it. */}
                    <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
                      <line className="geo-line" pathLength={1} x1={g[0]} y1={g[1]} x2={ax} y2={ay} stroke="#fff" strokeWidth={6} strokeLinecap="round" style={{ animationDelay: `${0.1 + i * 0.12}s` }} />
                    </mask>
                    <line mask={`url(#${mask})`} x1={g[0]} y1={g[1]} x2={ax} y2={ay} strokeWidth={2.5} strokeDasharray="5 5" strokeLinecap="round" stroke={r.color ?? "#120f24"} data-testid="geo-reveal-line" />
                  </>
                )}
                <Flag x={ax} y={ay} />
                {g && <GuessPin x={g[0]} y={g[1]} label={r.label} color={r.color} image={r.image} delay={0.12 * i} />}
              </g>
            );
          })}
          {others.map((o, i) => {
            const [ox, oy] = toScreen(o.x, o.y);
            return <GuessPin key={`${i}:${o.x},${o.y}`} x={ox} y={oy} color={o.color} image={o.image} label={o.label} />;
          })}
          {/* Keyed by position so every new pin replays the drop. */}
          {pick && <GuessPin key={`${pick.x},${pick.y}`} x={toScreen(pick.x, pick.y)[0]} y={toScreen(pick.x, pick.y)[1]} image={pinImage} />}
        </svg>
      )}
      {controls && (
        <div className="absolute right-1.5 top-1.5 z-[2] flex flex-col gap-1">
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
      )}
    </div>
  );
}

/**
 * The guess marker: a teardrop pin (GeoGuessr's) with the trainer's avatar
 * inside, or a Poké Ball for a guest, dropping in. The tip is the guess.
 */
function GuessPin({ x, y, label, color = "#3a8dde", image, delay = 0 }: { x: number; y: number; label?: string; color?: string; image?: string; delay?: number }) {
  const r = 11;
  const id = useId();
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="geo-drop" style={{ animationDelay: `${delay}s` }}>
        <ellipse cy={1} rx={5} ry={2} fill="rgba(0,0,0,0.35)" />
        {/* The teardrop: a circle at the top and a point at the origin. */}
        <path d={`M0 0 L${-r * 0.82} ${-r * 1.35} A${r} ${r} 0 1 1 ${r * 0.82} ${-r * 1.35} Z`} fill={color} stroke="#120f24" strokeWidth={2} strokeLinejoin="round" />
        <circle cy={-r * 1.75} r={r * 0.72} fill="#fff" />
        {image ? (
          <>
            <clipPath id={id}>
              <circle cy={-r * 1.75} r={r * 0.66} />
            </clipPath>
            <image href={image} x={-r * 0.66} y={-r * 1.75 - r * 0.66} width={r * 1.32} height={r * 1.32} clipPath={`url(#${id})`} preserveAspectRatio="xMidYMid slice" />
          </>
        ) : (
          <g transform={`translate(0 ${-r * 1.75})`}>
            <circle r={r * 0.55} fill="#fff" stroke="#120f24" strokeWidth={1.4} />
            <path d={`M${-r * 0.55} 0a${r * 0.55} ${r * 0.55} 0 0 1 ${r * 1.1} 0z`} fill="#e2306f" stroke="#120f24" strokeWidth={1.4} />
            <circle r={2} fill="#fff" stroke="#120f24" strokeWidth={1} />
          </g>
        )}
        {label && (
          <text y={-r * 2.75 - 3} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff" stroke="#120f24" strokeWidth={3} paintOrder="stroke">
            {label}
          </text>
        )}
      </g>
    </g>
  );
}

/** The true location: a black disc with a white ring and a yellow flag, popping in after the line draws. */
function Flag({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="geo-flag">
        <circle r={13} fill="#120f24" stroke="#fff" strokeWidth={2} />
        <path d="M-4 7V-7" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
        <path d="M-3 -7h10l-2.5 3.2L7 -0.6h-10z" fill="#ffd23c" />
      </g>
    </g>
  );
}
