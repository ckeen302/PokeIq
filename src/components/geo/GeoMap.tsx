"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Maximize2, Minus, Plus } from "lucide-react";
import { WORLD_REGION, type GeoRegionInfo } from "@/lib/geo-types";
import { createAtlas, loadAtlas, screenOf, wrapMod, wrapShifts, type AtlasData, type AtlasEngine, type AtlasView, type Box } from "@/components/atlas/atlas-engine";
import { preloadImage } from "@/lib/preload";
import { cn } from "@/lib/utils";
import { crowdColor, type GeoCrowdRound } from "@/lib/geo-crowd";
import { useT } from "@/i18n/client";
import geoNs from "@/messages/geo";
import geoNamesNs from "@/messages/geo-names";
import { localMap } from "@/lib/geo-i18n";
import { dockHome } from "./dock-size";
import { HuntPinMark, HuntSpotMark, MapRepeat, huntPinColor, spotTagPlacement, useMarkId } from "@/components/hunt/map-marks";

export interface MapPin {
  x: number;
  y: number;
}

export interface RevealedRound {
  guess: MapPin | null;
  /** The place's area and pin; a spot-scored shot also has the exact point it was taken, where the flag goes. */
  answer: { pin: [number, number]; mask: [number, number][]; spot?: [number, number] };
  /** A name or number over the guess pin (a duel's round, a party's trainer). */
  label?: string;
  /** The end of a game: the round's number on its answer flag, GeoGuessr's numbered flags. */
  flag?: string;
  /** Duels: the trainer's colour for their pin and line. */
  color?: string;
  /** The trainer's avatar, shown inside the pin. */
  image?: string;
  /** The guess pin was already standing there (the result showed it while the answer was on its way): no drop. */
  still?: boolean;
}

export interface FitTiming {
  /** Wait this long (ms) before the camera moves, so the line can draw first. */
  delay?: number;
  /** The camera's move, in ms (eased out). */
  duration?: number;
  /** Screen px along the top and bottom kept clear of the pins (the end screen's tracker and buttons sit there). */
  pad?: { top: number; bottom: number };
  /** With no round picked, frame the whole map, centred and uncut (the world, or a region's own crop), as GeoGuessr's breakdown does, not just the pins. */
  whole?: boolean;
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
  /**
   * Open on the land rather than the whole map. A map of the whole world
   * (the world, a themed map) starts with its regions filling the card (true,
   * the phone card), or all of them in view as large as the box allows
   * ("fit", the desktop dock); a region's map is that region.
   */
  land?: boolean | "fit";
  /** The Daily's crowd map: where everyone pinned this round, as a heat cloud under the pins. */
  density?: Pick<GeoCrowdRound, "cells" | "cw" | "ch" | "max"> | null;
  /** Hold the map's pictures back (a phone's first round loads its screenshot first). */
  defer?: boolean;
  /** The round: the guess map stays mounted from round to round, and a new one starts it where it started. */
  round?: number;
  /** Pokémon Hunt: the numbered pins (slot i is pin i + 1; null is a slot not placed yet). Drawn instead of `pick`. */
  picks?: (MapPin | null)[];
  /** Pokémon Hunt: the pin a tap moves (it wears a halo). */
  activePick?: number;
  /** Pokémon Hunt: a tap on (or right by) a placed pin picks that pin up instead of moving the active one. */
  onPickSelect?: (i: number) => void;
  /** Pokémon Hunt's reveal: every real spot, as flags with a "game · method" tag, popping in after `delay` seconds. */
  spots?: HuntMapSpot[];
  /** Pokémon Hunt's reveal: each pin's dashed line to the spot it scored against (`spot` indexes `spots`). */
  links?: HuntMapLink[];
  /** The end of a game's breakdown: the camera frames this revealed round alone (the others stay drawn). */
  focus?: number | null;
}

export interface HuntMapSpot extends MapPin {
  tag?: string;
  /** The place's area (the map's 0–1 coordinates), shaded under the flag. */
  mask?: [number, number][];
  delay?: number;
  found?: boolean;
}
export interface HuntMapLink {
  pin: MapPin;
  spot: number;
  /** The pin's number (1-based). */
  n: number;
  delay?: number;
}

/** A tap this close (screen px) to a placed hunt pin's tip or head picks it up. */
const PICK_GRAB_PX = 26;
/** A wrapping world map draws its pins, flags, lines and areas on every copy of the map this close (CSS px) to the screen, or nearer. */
const WRAP_OVERLAY_MARGIN = 160;

export const WORLD_MAP = "/geo/maps/world.webp";
/** A small copy of the whole world, shown while the big map loads on the world map itself. */
export const WORLD_THUMB = "/geo/maps/world-thumb.webp";
/** The world map has been decoded on this page (every map after the first draws it at once). */
let worldMapReady = false;
/** How long the first paint waits for the region's crop before the map goes on without it. */
const CROP_WAIT_MS = 1500;
/** The engine frames a locked region with this much room around it (atlas-engine's home view). */
const LOCKED_ROOM = 1.04;
/** A reveal never zooms closer than this many world pixels across (a handful of towns). */
const REVEAL_MIN_BOX = 260;
/** The line draws itself over this long before the camera moves (globals.css's .geo-line: 0.05 s, then 0.45 s). */
export const LINE_DRAW_MS = 400;

/** Where a revealed round's flag stands: the exact spot when the shot has one, else the place's pin. */
const flagAt = (answer: RevealedRound["answer"]): [number, number] => answer.spot ?? answer.pin;

/** World pixels of sea kept around the land when a phone's map card opens on it. */
const LAND_MARGIN = 90;

/** The box around every place on the atlas (the land), with a little sea around it. */
function landBox(atlas: AtlasData): Box {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of atlas.places) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return [Math.max(0, x0 - LAND_MARGIN), Math.max(0, y0 - LAND_MARGIN), Math.min(atlas.W, x1 + LAND_MARGIN), Math.min(atlas.H, y1 + LAND_MARGIN)];
}

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
export function GeoMap({ region, pick, pinImage, revealed = [], fit, onPick, controls = true, className, fill, others = [], land = false, density, defer = false, round, picks, activePick, onPickSelect, spots, links, focus = null }: Props) {
  const t = useT(geoNs);
  const geoNames = useT(geoNamesNs);
  const mapName = localMap(geoNames, region);
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
  // Only a region's own crop is locked (framed, the rest dimmed). The world and every map drawn on the whole world (a themed map,
  // like the Weekly's) are the same whole world: one crop, one zoom, the same names and dots.
  const locked = region.id !== WORLD_REGION && region.map.src !== WORLD_MAP;
  /**
   * First paint: the region's own crop of the map (a few dozen KB), or a small
   * copy of the world, drawn over the canvas until the 580 KB world map has
   * been decoded; then it fades out over the same pixels, with no jump. Once
   * the world map is in, later maps on the page skip all this.
   */
  const crop = locked ? region.map.src : WORLD_THUMB;
  const [cover, setCover] = useState<"shown" | "fading" | "gone">(() => (worldMapReady ? "gone" : "shown"));
  const [cropPainted, setCropPainted] = useState(worldMapReady);
  /** What to do once the engine has drawn the map sharp (set by the engine's effect). */
  const sharpRef = useRef<() => void>(() => undefined);

  /** The hunt's pins and the view as they stand, for telling a tap on a pin from a tap on the map. */
  const huntRef = useRef<{ picks?: (MapPin | null)[]; onPickSelect?: (i: number) => void; view: AtlasView | null }>({ view: null });
  useEffect(() => {
    pickRef.current = onPick;
    huntRef.current = { picks, onPickSelect, view };
  });

  useEffect(() => {
    loadAtlas()
      .then(setAtlas)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (worldMapReady || defer) return;
    let off = false;
    // The crop is decoded and given a frame to paint before the world map is asked for.
    const painted = preloadImage(crop).then(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    void Promise.race([painted, new Promise<void>((r) => setTimeout(r, CROP_WAIT_MS))]).then(() => {
      if (!off) setCropPainted(true);
    });
    return () => {
      off = true;
    };
  }, [crop, defer]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!atlas || !canvas || !stage || !cropPainted) return;
    const box: Box = [x0, y0, x1, y1];
    // A map of the whole world (the world itself, a themed map) opens on its land, filling the card.
    const wholeWorld = x0 <= 0 && y0 <= 0 && x1 >= atlas.W && y1 >= atlas.H;
    const e = createAtlas(canvas, stage, atlas, WORLD_MAP, {
      bounds: locked ? box : undefined,
      // "fit" (the desktop dock): zoomed in like GeoGuessr's, the same zoom when the box grows, and never further out than the land
      // filling the box; true (the phone card): the land fills the card.
      home: land && wholeWorld ? dockHome(landBox(atlas), land === "fit") : undefined,
      // GeoGuessr's small, thin names: they label a region without covering it.
      quietLabels: true,
      // GeoGuessr's: a map of the whole world drags left and right forever (a region's map stays framed on it).
      wrapX: !locked,
      onTap: (wx, wy) => {
        const x = (wx - x0) / (x1 - x0);
        const y = (wy - y0) / (y1 - y0);
        // A hunt pin under the tap (its tip, or its head just above) is picked up rather than a new spot pinned.
        const h = huntRef.current;
        if (h.picks && h.onPickSelect && h.view) {
          const s = h.view.s;
          // The open dock's whole world is drawn taller (k), so screen distance up and down is k times more.
          const sy = s * (h.view.k ?? 1);
          let near = -1;
          let best = PICK_GRAB_PX;
          h.picks.forEach((p, i) => {
            if (!p) return;
            // On a wrapping map the pin's nearest copy to the tap (the tap is on the map itself, its x in [0, W)).
            const ddx = x0 + p.x * (x1 - x0) - wx;
            const dx = (locked ? ddx : wrapMod(ddx + atlas.W / 2, atlas.W) - atlas.W / 2) * s;
            const dy = (y0 + p.y * (y1 - y0) - wy) * sy;
            const d = Math.min(Math.hypot(dx, dy), Math.hypot(dx, dy + 21));
            if (d < best) {
              best = d;
              near = i;
            }
          });
          if (near >= 0) return h.onPickSelect(near);
        }
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) pickRef.current?.({ x, y });
      },
      onView: setView,
      // The guess map stays readable small: dots come in as you zoom, once there's room for them.
      spacedDots: true,
      // The first paint's crop fades out once the map is drawn as sharp as the view needs.
      onSharp: () => sharpRef.current(),
    });
    engine.current = e;
    // The engine is loading the world map now (off the main thread, the copy this view needs); once it's drawn, the crop fades out over it.
    let off = false;
    let fade = 0;
    sharpRef.current = () => {
      if (off || worldMapReady) return;
      worldMapReady = true;
      setCover("fading");
      fade = window.setTimeout(() => !off && setCover("gone"), 350);
    };
    return () => {
      off = true;
      window.clearTimeout(fade);
      e.destroy();
      engine.current = null;
    };
  }, [atlas, cropPainted, region.id, locked, x0, y0, x1, y1, land]);

  // A new round on the same map: back to where it started.
  const firstRound = useRef(round);
  useEffect(() => {
    if (round === firstRound.current) return;
    firstRound.current = round;
    engine.current?.recenter();
  }, [round]);

  // A revealed round zooms to show the guess and the answer together, once the line has drawn (a focused one, it alone).
  const framed = focus !== null && revealed[focus] ? [revealed[focus]] : revealed;
  const fitWhole = !!fit?.whole && framed === revealed;
  const revealKey = [...framed.map((r) => `${r.guess?.x},${r.guess?.y},${flagAt(r.answer)}`), ...(spots ?? []).map((p) => `${p.x},${p.y}`), ...(links ?? []).map((l) => `${l.pin.x},${l.pin.y}`), `${density?.cells.length ?? ""}`, `${fitWhole}`].join("|");
  const fitDelay = fit?.delay ?? 0;
  const fitDuration = fit?.duration;
  const fitPad = fit?.pad;
  useEffect(() => {
    const e = engine.current;
    if (!e || !(revealed.length || spots?.length)) return;
    const pts = framed.flatMap((r) => [toWorld(...flagAt(r.answer)),...(r.guess ? [toWorld(r.guess.x, r.guess.y)] : [])]);
    // A hunt's reveal frames every real spot and every pin.
    for (const p of [...(spots ?? []), ...(links ?? []).map((l) => l.pin)]) pts.push(toWorld(p.x, p.y));
    // A crowd map frames the busiest cells too (those holding most of the pins).
    if (density) {
      const total = density.cells.reduce((s, c) => s + c[2], 0);
      let held = 0;
      for (const [x, y, n] of density.cells) {
        if (held >= total * 0.7) break;
        pts.push(toWorld(x, y));
        held += n;
      }
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const box: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    // GeoGuessr's breakdown: the whole map, centred and none of it cut off (the world, or a region's own crop), not just
    // the pins, which on one side would push the map off-centre.
    if (fitWhole && atlas) [box[0], box[1], box[2], box[3]] = locked ? [x0, y0, x1, y1] : [0, 0, atlas.W, atlas.H];
    // Room kept clear at the top and bottom: the box grows into them, so the pins sit in what's left between.
    const stageH = stageRef.current?.clientHeight ?? 0;
    if (fitPad && stageH > fitPad.top + fitPad.bottom + 80) {
      const h = Math.max(box[3] - box[1], REVEAL_MIN_BOX);
      const free = stageH - fitPad.top - fitPad.bottom;
      box[1] -= (h * fitPad.top) / free;
      box[3] += (h * fitPad.bottom) / free;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setTimeout(() => void engine.current?.fitBox(box, REVEAL_MIN_BOX, fitDuration, fitWhole ? 1 : undefined), reduced ? 0 : fitDelay);
    return () => window.clearTimeout(id);
    // The engine is made once the first paint's crop is in (cropPainted): a reveal that is the page's first map (Region Streak,
    // say) fits then, not before, when there's no engine yet to move.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the revealed rounds or the map change
  }, [revealKey, atlas, cropPainted]);

  /**
   * A map of the whole world wraps sideways: its overlays are drawn on each
   * copy of the map near the screen (world-px shifts, left to right), always
   * the map itself and the copy either side, so dragging never mounts (and
   * replays) one in view. A guess and its answer are always on one copy, so
   * their line is the straight line the score is measured along.
   */
  const period = atlas?.W ?? 0;
  const wraps = !locked && period > 0;
  const stageW = stageRef.current?.clientWidth ?? 0;
  // The map's own copy last, so it's drawn on top (and its pins stay the last in the layer, where the page's checks look).
  const copies = !wraps || !view ? [0] : [...new Set([-period, 0, period, ...wrapShifts(view, stageW, period, WRAP_OVERLAY_MARGIN)])].sort((a, b) => Number(a === 0) - Number(b === 0) || a - b);
  /** The map's 0–1 point on screen, on the copy `off` world px to the side. */
  const toScreenOn = (off: number) => (x: number, y: number): [number, number] => {
    const [wx, wy] = toWorld(x, y);
    return view ? screenOf(view, wx + off, wy) : [0, 0];
  };
  /** The map's box as drawn now, in px from the map's top-left (left, top, right, bottom): it can run past the edges. */
  const drawnBox = view ? [...screenOf(view, x0, y0), ...screenOf(view, x1, y1)] : null;
  // The answer's area: a dot of radius 6 world px on every area point (8 px apart), so they join into one patch at any zoom.
  const areaR = view ? Math.max(3, 6 * view.s) : 3;
  const maskId = useId();
  /** Where a tap places a pin, in px from the map's top-left (left, top, right, bottom): the map's box as framed now (it can run past the edges). */
  const pickArea = onPick && drawnBox ? drawnBox.map(Math.round).join(",") : undefined;

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
      aria-label={onPick ? t("map.pickLabel", { map: mapName }) : t("map.label", { map: mapName })}
      data-testid="geo-map"
      // The map takes taps once it has loaded and been sized (until then a tap does nothing).
      data-ready={view ? "true" : undefined}
      data-pick-area={pickArea}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {cover !== "gone" &&
        !defer &&
        // A wrapping map's first paint covers the copies beside it too.
        (drawnBox ? copies : [0]).map((off) => (
          // Before the engine reports a view, the crop sits where the engine will frame the region (centred, with its room around it).
          <div
            key={off}
            className={cn("pointer-events-none absolute transition-opacity duration-300", cover === "fading" ? "opacity-0" : "opacity-100")}
            style={drawnBox ? { left: drawnBox[0] + off * (view?.s ?? 0), top: drawnBox[1], width: drawnBox[2] - drawnBox[0], height: drawnBox[3] - drawnBox[1] } : { inset: locked ? `${((1 - 1 / LOCKED_ROOM) / 2) * 100}%` : 0 }}
            data-testid={off ? undefined : "geo-map-cover"}
            aria-hidden
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the region's crop of the world map, first paint */}
            <img src={crop} alt="" className={cn("h-full w-full", view ? "max-w-none" : "object-contain")} draggable={false} />
          </div>
        ))}
      {!atlas && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
          {failed ? t("map.failed") : <Loader2 className="h-5 w-5 animate-spin" aria-label={t("map.loading")} />}
        </div>
      )}
      {view && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {copies.map((off) => {
            const ts = toScreenOn(off);
            // The map's own copy carries the test ids; each repeat has its own mask and filter ids.
            const repeat = off !== 0;
            const cid = repeat ? `${maskId}-c${Math.round(off / period)}` : maskId;
            return (
              <MapRepeat.Provider key={off} value={repeat}>
                {density && density.cells.length > 0 && <Density density={density} toScreen={ts} cell={Math.max(density.cw * bw, density.ch * bh) * view.s} id={cid} />}
                {revealed.map((r, i) => {
                  const [ax, ay] = ts(...flagAt(r.answer));
                  const g = r.guess ? ts(r.guess.x, r.guess.y) : null;
                  // Duels reveal each trainer's guess as its own round on one shared answer: draw its area once.
                  const again = i > 0 && revealed[i - 1].answer === r.answer;
                  const mask = `${cid}-${i}`;
                  return (
                    <g key={i}>
                      <g className="geo-area" display={again ? "none" : undefined}>
                        {/* Faded as one layer, so overlapping dots read as one even patch. */}
                        <g opacity={0.5}>
                          {r.answer.mask.map(([x, y], k) => {
                            const [mx, my] = ts(x, y);
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
                          <line mask={`url(#${mask})`} x1={g[0]} y1={g[1]} x2={ax} y2={ay} strokeWidth={2.5} strokeDasharray="5 5" strokeLinecap="round" stroke={r.color ?? "#120f24"} data-testid={repeat ? undefined : "geo-reveal-line"} />
                        </>
                      )}
                      <Flag x={ax} y={ay} n={r.flag} />
                      {g && <GuessPin x={g[0]} y={g[1]} label={r.label} color={r.color} image={r.image} delay={0.12 * i} still={r.still} />}
                    </g>
                  );
                })}
                {others.map((o, i) => {
                  const [ox, oy] = ts(o.x, o.y);
                  return (
                    <g key={`${i}:${o.x},${o.y}`} data-testid={repeat ? undefined : "geo-other-pin"}>
                      <GuessPin x={ox} y={oy} color={o.color} image={o.image} label={o.label} />
                    </g>
                  );
                })}
                {/* Pokémon Hunt's reveal: the lines first, then the spots, then the pins on top. */}
                {spots && (
                  <HuntSpots spots={spots} links={links ?? []} toScreen={ts} width={stageRef.current?.clientWidth ?? 0} maskId={cid} areaR={areaR} />
                )}
                {picks?.map((p, i) => {
                  if (!p) return null;
                  const [px, py] = ts(p.x, p.y);
                  return <HuntPinMark key={`${i}:${p.x},${p.y}`} x={px} y={py} n={i + 1} active={i === activePick} />;
                })}
                {/* Keyed by position so every new pin replays the drop. */}
                {pick && !picks && <GuessPin key={`${pick.x},${pick.y}`} x={ts(pick.x, pick.y)[0]} y={ts(pick.x, pick.y)[1]} image={pinImage} />}
              </MapRepeat.Provider>
            );
          })}
        </svg>
      )}
      {controls && (
        <div className="absolute right-1.5 top-1.5 z-[2] flex flex-col gap-1" data-map-controls>
          {[
            { label: t("map.zoomIn"), icon: <Plus className="h-3.5 w-3.5" />, act: () => engine.current?.zoomBy(1.6) },
            { label: t("map.zoomOut"), icon: <Minus className="h-3.5 w-3.5" />, act: () => engine.current?.zoomBy(1 / 1.6) },
            { label: t("map.whole"), icon: <Maximize2 className="h-3 w-3" />, act: () => engine.current?.reset() },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={b.act}
              aria-label={b.label}
              title={b.label}
              className="tap flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
            >
              {b.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pokémon Hunt's reveal layer: each pin's line to its spot drawing itself, the spots' flags and tags, and the numbered pins. */
function HuntSpots({ spots, links, toScreen, width, maskId, areaR }: { spots: HuntMapSpot[]; links: HuntMapLink[]; toScreen: (x: number, y: number) => [number, number]; width: number; maskId: string; areaR: number }) {
  const at = spots.map((p) => toScreen(p.x, p.y));
  const tags = spotTagPlacement(spots.map((p, i) => ({ x: at[i][0], y: at[i][1], tag: p.tag, found: p.found })), width);
  const layerId = useMarkId("hunt-reveal-layer");
  const linkId = useMarkId("hunt-link");
  return (
    <g data-testid={layerId}>
      {/* Each place's area, faint (green where a pin found it), fading in with its flag. */}
      {spots.map((p, i) =>
        p.mask?.length ? (
          <g key={`a${i}`} className="geo-area" style={{ animationDelay: `${p.delay ?? 0}s` }}>
            <g opacity={p.found ? 0.45 : 0.25}>
              {p.mask.map(([x, y], k) => {
                const [mx, my] = toScreen(x, y);
                return <circle key={k} cx={mx} cy={my} r={areaR} className={p.found ? "fill-success" : "fill-white"} />;
              })}
            </g>
          </g>
        ) : null
      )}
      {links.map((l, i) => {
        const s = at[l.spot];
        if (!s) return null;
        const [gx, gy] = toScreen(l.pin.x, l.pin.y);
        const mask = `${maskId}-hunt-${i}`;
        return (
          <g key={`l${i}`}>
            <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
              <line className="geo-line" pathLength={1} x1={gx} y1={gy} x2={s[0]} y2={s[1]} stroke="#fff" strokeWidth={6} strokeLinecap="round" style={{ animationDelay: `${l.delay ?? 0}s` }} />
            </mask>
            <line mask={`url(#${mask})`} x1={gx} y1={gy} x2={s[0]} y2={s[1]} strokeWidth={2.5} strokeDasharray="5 5" strokeLinecap="round" stroke={huntPinColor(l.n - 1)} data-testid={linkId} />
          </g>
        );
      })}
      {/* Unfound spots under found ones, so a found spot's tag is never covered. */}
      {spots
        .map((p, i) => ({ p, i }))
        .sort((a, b) => Number(!!a.p.found) - Number(!!b.p.found))
        .map(({ p, i }) => (
          <HuntSpotMark key={`s${i}`} x={at[i][0]} y={at[i][1]} tag={p.tag} delay={p.delay} found={p.found} showTag={tags[i].show} tagLeft={tags[i].left} />
        ))}
      {links.map((l) => {
        const [gx, gy] = toScreen(l.pin.x, l.pin.y);
        return <HuntPinMark key={`p${l.n}`} x={gx} y={gy} n={l.n} delay={Math.max(0, (l.delay ?? 0) - 0.2)} />;
      })}
    </g>
  );
}

/**
 * The crowd's heat cloud: each grid cell a soft glow, bigger and hotter the
 * more trainers pinned there, blurred together into one cloud at any zoom.
 */
function Density({ density, toScreen, cell, id }: { density: NonNullable<Props["density"]>; toScreen: (x: number, y: number) => [number, number]; cell: number; id: string }) {
  const blur = Math.max(2, Math.min(18, cell * 0.45));
  const testId = useMarkId("geo-crowd-layer");
  return (
    <g data-testid={testId}>
      <filter id={`${id}-heat`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation={blur} />
      </filter>
      <g filter={`url(#${id}-heat)`} opacity={0.92}>
        {/* Quietest first, so the busiest cells glow on top. */}
        {[...density.cells].reverse().map(([x, y, n], i) => {
          const share = n / Math.max(1, density.max);
          const [cx, cy] = toScreen(x, y);
          return <circle key={i} cx={cx} cy={cy} r={Math.max(4, cell * (0.55 + 0.75 * Math.sqrt(share)))} fill={crowdColor(share)} opacity={0.35 + 0.55 * share} />;
        })}
      </g>
    </g>
  );
}

/**
 * The guess marker: a teardrop pin (GeoGuessr's) with the trainer's avatar
 * inside, or a Poké Ball for a guest, dropping in. The tip is the guess.
 */
export function GuessPin({ x, y, label, color = "#3a8dde", image, delay = 0, still = false }: { x: number; y: number; label?: string; color?: string; image?: string; delay?: number; still?: boolean }) {
  const r = 11;
  const id = useId();
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={still ? undefined : "geo-drop"} style={still ? undefined : { animationDelay: `${delay}s` }}>
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

/** The true location: a black disc with a white ring and a yellow flag, popping in after the line draws; `n`, the round's number on a badge. */
export function Flag({ x, y, n }: { x: number; y: number; n?: string }) {
  const numberId = useMarkId("geo-flag-number");
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="geo-flag">
        <circle r={13} fill="#120f24" stroke="#fff" strokeWidth={2} />
        <path d="M-4 7V-7" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
        <path d="M-3 -7h10l-2.5 3.2L7 -0.6h-10z" fill="#ffd23c" />
        {n && (
          <g transform="translate(11 -11)" data-testid={numberId}>
            <circle r={8} fill="#e5484d" stroke="#fff" strokeWidth={1.75} />
            <text y={3.6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#fff">
              {n}
            </text>
          </g>
        )}
      </g>
    </g>
  );
}
