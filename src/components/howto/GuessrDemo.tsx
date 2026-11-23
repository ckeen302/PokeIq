"use client";

import { GUESSR_DEMO_MAP, GUESSR_DEMO_SHOT } from "./guessr-demo-assets";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Expand, Flag as FlagIcon, Maximize2, MapPin as MapPinIcon, MapPinned, Minus, MousePointer2, Pin, Plus, Shrink, X } from "lucide-react";
import { GEO_FALLOFF, GEO_MAX_ROUND_SCORE } from "@/lib/geo-types";
import { cn } from "@/lib/utils";
import { BAR_BTN, ExitButton, FullscreenButton, GuessButton, HudDials, Notch, PHONE_QUERY, RoundBadge, ValueDial, dockWidth } from "@/components/geo/GameShell";
import { Flag, GuessPin, LINE_DRAW_MS } from "@/components/geo/GeoMap";
import { ShotCarousel } from "@/components/geo/ShotCarousel";
import { HowToHelpButton } from "@/components/geo/GeoHowToButton";
import { DemoFrame, useDemoFrame } from "./shared";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import geoHowto from "@/messages/geo-howto";
import { useGeoNames, type GeoLocal } from "@/lib/geo-i18n-client";

/**
 * PokéGuessr's how-to demo: the real game screen, shrunk into the pop-up. A
 * round and its result are laid out at a fixed window size (a 1024×640
 * desktop, or a 375×667 phone where the game uses its phone layout) with the
 * game's own HUD parts (the notch, the dials, the round badge, the Guess
 * button, the screenshot) and its map look, then scaled to the card's width.
 * The map is the game's Paldea crop, drawn with the atlas's town markers,
 * labels, pin, flag and line rules from fixed data, so the demo fetches nothing
 * but the round's screenshot and that crop. No place is named before the result.
 */

/** The round's screenshot: a small static copy (the pop-up shows it about 380 px wide), not the 1280 px original. */
const SHOT = GUESSR_DEMO_SHOT;
/** Paldea's map: the world map's crop (world pixels, 1:1). Its places below are in the crop's pixels. */
const MAP = { src: GUESSR_DEMO_MAP, w: 614, h: 564, squarePx: 28 };
/** The map's width over its height, as the game sizes its dock (mapAspect). */
const ASPECT = MAP.w / MAP.h;
/** Levincia: its pin (where the flag stands) and its area, from the game's data. */
const ANSWER = { x: 514.8, y: 300 };
const AREA: [number, number][] = [
  [507, 275], [513, 275], [505, 280], [513, 280], [521, 280], [498, 280], [497, 287], [505, 287], [513, 287], [521, 287], [529, 287], [537, 287], [497, 296],
  [505, 296], [513, 296], [521, 296], [529, 296], [537, 296], [497, 304], [505, 304], [513, 304], [521, 304], [529, 304], [537, 303], [498, 311], [505, 311],
  [513, 311], [521, 311], [529, 311], [535, 311], [498, 320], [505, 320], [513, 320], [521, 320], [529, 320], [534, 320], [499, 325], [505, 325], [511, 325],
];
/** The demo's pin, west of the town. */
const GUESS = { x: 448, y: 342 };
/** Scored as the game scores a pin: the distance to the nearest point of the place's area, on GeoGuessr's curve. */
const PX = Math.min(...AREA.map(([x, y]) => Math.hypot(GUESS.x - x, GUESS.y - y)));
const SCORE = PX <= MAP.squarePx / 2 ? GEO_MAX_ROUND_SCORE : Math.round(GEO_MAX_ROUND_SCORE * Math.exp((-GEO_FALLOFF * PX) / Math.hypot(MAP.w, MAP.h)));
const SQUARES = Math.round((PX / MAP.squarePx) * 10) / 10;
const VERDICT = SCORE >= GEO_MAX_ROUND_SCORE ? "spotOn" : SCORE >= 4000 ? "close" : SCORE >= 2500 ? "notBad" : SCORE >= 1000 ? "near" : "wayOff";

/** The atlas's town markers on Paldea (c: city, t: town). */
const MARKERS: [x: number, y: number, kind: "c" | "t"][] = [
  [119.8, 485.1, "t"], [468, 401.1, "t"], [315.2, 529.1, "t"], [198.1, 272.4, "c"], [189.7, 414.9, "t"], [514.8, 300.1, "c"],
  [307, 478.6, "t"], [257.8, 232.2, "c"], [305.8, 404.3, "c"], [345.8, 126.5, "c"], [77.7, 251.4, "c"], [397, 278.3, "t"],
];
/** The atlas's places the result's camera can show (t: town, r: route, l: landmark), with the buildings inside some. Drawn only on the result. */
const PLACES: [kind: "t" | "r" | "l", name: string, x: number, y: number, inside?: string[]][] = [
  ["l", "Alfornada Cavern", 121, 473], ["t", "Alfornada", 120, 485], ["t", "Artazon", 468, 401], ["l", "Asado Desert", 138, 274], ["t", "Cabo Poco", 315, 529],
  ["t", "Cascarrafa", 198, 272], ["l", "Casseroya Lake", 162, 131], ["l", "Colonnade Hollow", 166, 226], ["t", "Cortondo", 190, 415], ["l", "Dalizapa Passage", 338, 234],
  ["l", "East Paldean Sea", 578, 341], ["r", "East Province (Area One)", 467, 367, ["Schedar Squad's Base"]], ["r", "East Province (Area Three)", 474, 254],
  ["r", "East Province (Area Two)", 490, 316], ["l", "Glaseado Mountain", 341, 141], ["l", "Great Crater of Paldea", 311, 318, ["Zero Gate", "Area Zero", "Zero Lab", "Area Zero Underdepths"]],
  ["l", "Inlet Grotto", 318, 503], ["t", "Levincia", 515, 300], ["t", "Los Platos", 307, 479], ["t", "Medali", 258, 232], ["t", "Mesagoza", 306, 404, ["Naranja / Uva Academy"]],
  ["t", "Montenevera", 346, 126], ["l", "Naranja and Uva Academy", 307, 388], ["r", "North Province (Area One)", 450, 119],
  ["r", "North Province (Area Two)", 513, 191, ["Caph Squad's Base", "Firescourge Shrine"]], ["l", "Poco Path", 312, 514], ["l", "Pokémon League", 259, 365],
  ["l", "South Paldean Sea", 327, 514], ["r", "South Province (Area Five)", 408, 459], ["r", "South Province (Area Four)", 228, 480],
  ["r", "South Province (Area One)", 326, 480, ["Grasswither Shrine"]], ["r", "South Province (Area Six)", 123, 484], ["r", "South Province (Area Three)", 392, 398],
  ["r", "South Province (Area Two)", 224, 406], ["l", "Tagtree Thicket", 413, 219, ["Navi Squad's Base"]], ["r", "West Province (Area One)", 138, 351, ["Segin Squad's Base", "Icerend Shrine"]],
  ["r", "West Province (Area Three)", 256, 214], ["r", "West Province (Area Two)", 123, 230], ["t", "Zapapico", 397, 278],
];
/** The region's own name, at the atlas's spot for it. */
const REGION = { name: "Paldea", x: 297, y: 318 };

// The atlas engine's constants (atlas-engine.ts).
const SEA = "#165c96";
/** The sea outside a region's map, under the engine's dimming (rgba(6, 14, 28, 0.6)). */
const DIM_SEA = "rgb(12 45 77)";
const REF_SCALE = 0.2;
/** A region's map is framed with this much room around it; a result frames at least this many map pixels, with 1.5× room. */
const LOCKED_ROOM = 1.04;
const REVEAL_MIN_BOX = 260;
const FIT_MS = 800;
const SCORE_COUNT_MS = 1000;

interface View {
  s: number;
  tx: number;
  ty: number;
}
type Box = [number, number, number, number];
const fitTo = ([x0, y0, x1, y1]: Box, w: number, h: number, room = 1): View => {
  const s = Math.min(w / ((x1 - x0) * room), h / ((y1 - y0) * room));
  return { s, tx: w / 2 - ((x0 + x1) / 2) * s, ty: h / 2 - ((y0 + y1) / 2) * s };
};
const home = (w: number, h: number) => fitTo([0, 0, MAP.w, MAP.h], w, h, LOCKED_ROOM);
/** The result's camera: the guess and the flag, at least REVEAL_MIN_BOX across (the engine's fitBox). */
function revealView(w: number, h: number): View {
  const cx = (GUESS.x + ANSWER.x) / 2;
  const cy = (GUESS.y + ANSWER.y) / 2;
  const bw = Math.max(Math.abs(GUESS.x - ANSWER.x), REVEAL_MIN_BOX);
  const bh = Math.max(Math.abs(GUESS.y - ANSWER.y), REVEAL_MIN_BOX);
  return fitTo([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], w, h, 1.5);
}

// ---------------------------------------------------------------------------
// The map: GeoMap's look (the atlas canvas and its overlay) from fixed data
// ---------------------------------------------------------------------------

interface Label {
  text: string;
  x: number;
  y: number;
  size: number;
  font: string;
  weight: number;
  color: string;
  track: number;
}

let measurer: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();
function textWidth(text: string, font: string): number {
  const key = `${text}|${font}`;
  let w = widths.get(key);
  if (w === undefined) {
    measurer ??= document.createElement("canvas").getContext("2d");
    if (!measurer) return text.length * 7;
    measurer.font = font;
    w = measurer.measureText(text).width;
    widths.set(key, w);
  }
  return w;
}

/** The atlas's labels for a view, placed by its rules: by priority, each skipped if it would overlap one already placed. */
function labelsFor(view: View, w: number, h: number, names: GeoLocal): Label[] {
  const { s, tx, ty } = view;
  const f = s / REF_SCALE;
  const css = getComputedStyle(document.body);
  const display = css.getPropertyValue("--font-display").trim() || "'Chakra Petch'";
  const sans = css.getPropertyValue("--font-body").trim() || "Inter";
  const pixel = css.getPropertyValue("--font-pixel").trim() || "Silkscreen";
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const out: Label[] = [];
  const fits = (x: number, y: number, bw: number, bh: number) => {
    if (x + bw < 0 || y + bh < 0 || x > w || y > h) return false;
    for (const b of boxes) if (x < b.x + b.w && x + bw > b.x && y < b.y + b.h && y + bh > b.y) return false;
    boxes.push({ x, y, w: bw, h: bh });
    return true;
  };
  const label = (text: string, wx: number, wy: number, family: string, weight: number, size: number, dy: number, color: string, track = 0, dx = 0, keepIn = false) => {
    let x = wx * s + tx + dx;
    const y = wy * s + ty + dy;
    const font = `${weight} ${size}px ${family}`;
    const lines = text.split("\n");
    const lineH = size + 2;
    const tw = Math.max(...lines.map((l) => textWidth(l, font) + track * l.length));
    const padX = Math.max(3, size * 0.4);
    const padY = Math.max(1, size * 0.15);
    if (keepIn && x >= 0 && x <= w && tw + 2 * padX < w) x = Math.min(w - tw / 2 - padX, Math.max(tw / 2 + padX, x));
    if (!fits(x - tw / 2 - padX, y - size - padY, tw + 2 * padX, size + 6 + (lines.length - 1) * lineH + 2 * padY)) return false;
    lines.forEach((line, i) => out.push({ text: line, x, y: y + i * lineH, size, font: family, weight, color, track }));
    return true;
  };
  if (f < 4.5) {
    const size = Math.round(Math.max(20 * 0.7, Math.min(20 * 1.7, 20 * Math.pow(f, 0.35))));
    const spots: [number, number][] = [[0, 0], [0, -size * 1.25], [0, size * 1.35], [-size * 2.6, 0], [size * 2.6, 0]];
    spots.some(([dx, dy]) => label(names.region(REGION.name).toUpperCase(), REGION.x, REGION.y, `${display}, ${sans}, sans-serif`, 700, size, size / 3 + dy, "#ffffff", 2, dx, true));
  }
  if (f >= 2.2) for (const [k, name, x, y] of PLACES) if (k === "t") label(names.place(name), x, y, `${sans}, system-ui`, 600, f > 4 ? 13 : 11, -12, "#ffffff");
  if (f >= 3.6) {
    const spots: [number, number][] = [[0, 4], [0, 22], [0, -14], [34, 4], [-34, 4]];
    for (const [k, name, x, y] of PLACES) {
      if (k !== "r") continue;
      const text = names.place(name).replace(/^(.+?) ?[(（](.+)[)）]$/, "$1\n$2");
      spots.some(([dx, dy]) => label(text, x, y, `${pixel}, monospace`, 400, 10, dy, "#ffe2b5", 0, dx));
    }
    for (const [k, name, x, y] of PLACES) if (k === "l") label(names.place(name), x, y, `${sans}, system-ui`, 600, 11, -10, "#cfe0ff");
  }
  if (f >= 6) for (const [, , x, y, inside] of PLACES) inside?.forEach((b, i) => label(names.place(b), x, y, `${sans}, system-ui`, 500, 11, 18 + i * 14, "#c9f2dc"));
  return out;
}

/** The size of an element as laid out (a transform doesn't change it), kept up to date. */
function useLayoutSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (w: number, h: number) => setSize((o) => (o.w === w && o.h === h ? o : { w, h }));
    set(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(([e]) => set(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/**
 * GeoMap with a fixed picture: the region's map framed as the game frames it,
 * the atlas's markers, the pin being placed, and on a result the area, the
 * line drawing itself, the flag and the camera fitting both, with the labels.
 */
function DemoMap({ pick, reveal, fill, reduced }: { pick?: boolean; reveal?: boolean; fill?: boolean; reduced: boolean }) {
  const [ref, { w, h }] = useLayoutSize<HTMLDivElement>();
  const maskId = useId();
  const names = useGeoNames();
  /** The camera's move on a result: 0 framed on the region, 1 on the guess and the flag. */
  const [t, setT] = useState(reveal && reduced ? 1 : 0);
  useEffect(() => {
    if (!reveal || reduced) return;
    let raf = 0;
    const id = window.setTimeout(() => {
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / FIT_MS);
        setT(1 - Math.pow(1 - k, 3));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, LINE_DRAW_MS);
    return () => {
      window.clearTimeout(id);
      cancelAnimationFrame(raf);
    };
  }, [reveal, reduced]);
  const ready = w > 0 && h > 0;
  let view: View = { s: 0, tx: 0, ty: 0 };
  if (ready) {
    const a = home(w, h);
    view = a;
    if (reveal && t > 0) {
      // The engine's glide: the scale on a log curve, the centre in a straight line.
      const b = revealView(w, h);
      const ac = [(w / 2 - a.tx) / a.s, (h / 2 - a.ty) / a.s];
      const bc = [(w / 2 - b.tx) / b.s, (h / 2 - b.ty) / b.s];
      const s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * t);
      view = { s, tx: w / 2 - (ac[0] + (bc[0] - ac[0]) * t) * s, ty: h / 2 - (ac[1] + (bc[1] - ac[1]) * t) * s };
    }
  }
  const { s, tx, ty } = view;
  const at = (x: number, y: number): [number, number] => [x * s + tx, y * s + ty];
  const f = s / REF_SCALE;
  const labels = ready && reveal ? labelsFor(view, w, h, names) : [];
  const [gx, gy] = at(GUESS.x, GUESS.y);
  const [ax, ay] = at(ANSWER.x, ANSWER.y);
  return (
    <div
      ref={ref}
      className={cn("relative w-full select-none overflow-hidden", fill ? "h-full" : "rounded-md border-2 border-foreground/20")}
      style={{ background: DIM_SEA, ...(fill ? {} : { aspectRatio: `${ASPECT}` }) }}
    >
      {ready && (
        <>
          {/* The region's own map, undimmed (the world around it is the dimmed sea). */}
          <div className="absolute" style={{ left: tx, top: ty, width: MAP.w * s, height: MAP.h * s, background: SEA }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the game's own map crop */}
            <img src={MAP.src} alt="" className="h-full w-full max-w-none" draggable={false} />
          </div>
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            {MARKERS.map(([x, y, kind], i) => {
              const city = kind === "c";
              const px = f < 1.6 ? (city ? 5 : 4) : f < 3 ? (city ? 8 : 6) : city ? 10 : 8;
              const m = Math.max(9 * s, px);
              const [cx, cy] = at(x, y);
              return (
                <g key={i}>
                  <rect x={cx - m / 2 - 2.5} y={cy - m / 2 - 2.5} width={m + 5} height={m + 5} rx={3} fill={city ? "#6e1626" : "#1d3878"} />
                  <rect x={cx - m / 2} y={cy - m / 2} width={m} height={m} rx={2} fill={city ? "#e2475b" : "#4d7ee8"} />
                  <rect x={cx - m / 2} y={cy - m / 2} width={m} height={m * 0.32} fill="rgba(255,255,255,.35)" />
                </g>
              );
            })}
            {labels.map((l, i) => (
              <text
                key={i}
                x={l.x}
                y={l.y}
                textAnchor="middle"
                fontFamily={l.font}
                fontWeight={l.weight}
                fontSize={l.size}
                letterSpacing={l.track}
                fill={l.color}
                stroke="rgba(8,18,32,.88)"
                strokeWidth={Math.max(3, l.size / 4)}
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {l.text}
              </text>
            ))}
            {/* GeoMap's overlay: the answer's area, the dashed line drawing itself, the flag, the pin. */}
            {reveal && (
              <>
                <g className="geo-area">
                  <g opacity={0.5}>
                    {AREA.map(([x, y], k) => (
                      <circle key={k} cx={at(x, y)[0]} cy={at(x, y)[1]} r={Math.max(3, 6 * s)} className="fill-success" />
                    ))}
                  </g>
                </g>
                <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
                  <line className="geo-line" pathLength={1} x1={gx} y1={gy} x2={ax} y2={ay} stroke="#fff" strokeWidth={6} strokeLinecap="round" style={{ animationDelay: "0.1s" }} />
                </mask>
                <line mask={`url(#${maskId})`} x1={gx} y1={gy} x2={ax} y2={ay} strokeWidth={2.5} strokeDasharray="5 5" strokeLinecap="round" stroke="#120f24" />
                <Flag x={ax} y={ay} />
              </>
            )}
            {(pick || reveal) && <GuessPin x={gx} y={gy} />}
          </svg>
        </>
      )}
    </div>
  );
}

/** The map's zoom buttons (GeoMap's, top-right). */
function ZoomButtons() {
  return (
    <div className="absolute right-1.5 top-1.5 z-[2] flex flex-col gap-1">
      {[<Plus key="in" className="h-3.5 w-3.5" />, <Minus key="out" className="h-3.5 w-3.5" />, <Maximize2 key="all" className="h-3 w-3" />].map((icon) => (
        <span key={icon.key} className="tap flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur">
          {icon}
        </span>
      ))}
    </div>
  );
}

const noop = () => undefined;

// ---------------------------------------------------------------------------
// The round
// ---------------------------------------------------------------------------

/** The desktop round, as GeoGame lays it out: exit and full screen, the notch, the score chip, the map dock with Guess under it. */
function DesktopRound({ open, pinned, pressed, reduced }: { open: boolean; pinned: boolean; pressed: boolean; reduced: boolean }) {
  const t = useT(geoHowto);
  return (
    <div className="relative h-full">
      <div className="absolute inset-0">
        <ShotCarousel views={[SHOT]} index={0} onIndex={noop} onZoom={noop} fs dock />
      </div>
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
        <ExitButton onClick={noop} testId="howto-demo-exit" />
        <FullscreenButton fs={false} onClick={noop} />
      </div>
      <Notch>
        <div className="min-w-0 text-center">
          <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">
            {t("demo.round", { n: 1 })}<span className="text-white/50">/5</span>
          </div>
        </div>
      </Notch>
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
        <div className="flex h-9 items-center gap-2 rounded-md bg-black/55 px-3 backdrop-blur">
          <span className="hud-label hidden !text-white/60 sm:inline">{t("demo.score")}</span>
          <span className="font-display text-base font-bold tabular-nums text-[#9be15d]">0</span>
        </div>
        <HowToHelpButton className="hud-btn !hidden !p-0 !text-white sm:!flex" />
      </div>
      {/* MapDock: half see-through until the pointer reaches it, when it grows a size step (S to M) in 250 ms. */}
      <div
        className={cn("absolute bottom-4 right-4 z-10 flex flex-col gap-2 ease-out", reduced ? "" : "transition-[width,opacity] duration-[250ms]", open ? "opacity-100" : "opacity-50")}
        style={{ width: dockWidth(open ? "m" : "s", ASPECT) }}
      >
        <div className="relative rounded-md shadow-2xl">
          <DemoMap pick={pinned} reduced={reduced} />
          <div className="absolute left-1.5 top-1.5 z-[2] flex flex-col gap-1">
            {[<Expand key="grow" className="h-3.5 w-3.5" />, <Shrink key="shrink" className="h-3.5 w-3.5" />, <Pin key="pin" className="h-3.5 w-3.5" />].map((icon) => (
              <span key={icon.key} className={cn("tap flex h-7 w-7 items-center justify-center rounded bg-black/55 text-white backdrop-blur", icon.key === "shrink" && "opacity-35")}>
                {icon}
              </span>
            ))}
          </div>
          <ZoomButtons />
        </div>
        <div className={cn("transition-transform duration-150", pressed && "scale-[0.97] brightness-110")}>
          <GuessButton hasPin={pinned} onClick={noop} testId="howto-demo-guess" />
        </div>
      </div>
    </div>
  );
}

/** The phone round, GeoGame's phone layout: the dials and round badge, the bottom bar, and the map opening as a large card. */
function PhoneRound({ open, pinned, pressed, reduced }: { open: boolean; pinned: boolean; pressed: boolean; reduced: boolean }) {
  const t = useT(geoHowto);
  return (
    <div className="relative h-full">
      <div className="absolute inset-0" style={{ bottom: "var(--geo-bar)" }}>
        <ShotCarousel views={[SHOT]} index={0} onIndex={noop} onZoom={noop} fs dock />
      </div>
      <HudDials>
        <ValueDial value="0" unit="pts" />
      </HudDials>
      <RoundBadge value={1} of={5} />
      {/* PhoneMap: the card over the picture, under its "Tap the map" label. */}
      <div
        className={cn(
          "absolute inset-x-3 z-[15] ease-out",
          reduced ? "" : "transition-[opacity,transform,visibility] duration-200",
          open ? "visible translate-y-0 scale-100 opacity-100" : "invisible translate-y-4 scale-[0.97] opacity-0"
        )}
        style={{ top: "6.5rem", bottom: "calc(var(--geo-bar) + 0.75rem)" }}
      >
        <div className="relative h-full overflow-hidden rounded-[1.75rem] bg-[#165c96] shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-4 ring-[#a99cff]/80">
          <DemoMap pick={pinned} fill reduced={reduced} />
          <ZoomButtons />
          <span className="absolute left-2.5 top-2.5 z-[3] flex h-9 w-9 items-center justify-center rounded-full bg-[#1e1a3f]/90 text-white shadow-lg ring-1 ring-white/20">
            <X className="h-4 w-4" />
          </span>
        </div>
        <p className="absolute left-1/2 top-0 z-[4] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#1e1a3f] px-4 py-2 font-display text-sm font-bold italic text-white shadow-lg ring-2 ring-[#a99cff]/70">
          {pinned ? t("demo.tapMove") : t("demo.tapPlace")}
        </p>
      </div>
      <div className="absolute inset-x-0 bottom-0 z-[16] flex items-center gap-2.5 border-t-2 border-[#a99cff]/50 bg-gradient-to-b from-[#2d2766] to-[#1e1a3f] px-4" style={{ height: "var(--geo-bar)" }}>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className={BAR_BTN}>
            <X className="h-5 w-5" />
          </span>
          {!open && (
            <>
              <HowToHelpButton className={cn(BAR_BTN, "!p-0 !text-white")} />
              <FullscreenButton fs={false} onClick={noop} className={cn(BAR_BTN, "!h-11 !w-11 !rounded-full !bg-[#4a3f9e] !backdrop-blur-none")} />
            </>
          )}
        </div>
        {open ? (
          <div className={cn("transition-transform duration-150", pressed && "scale-95")}>
            <GuessButton hasPin={pinned} onClick={noop} round testId="howto-demo-guess" />
          </div>
        ) : (
          <span className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#62d42a] to-[#3f9e12] text-white shadow-[0_4px_16px_rgba(76,187,23,0.45),inset_0_-4px_0_rgba(0,0,0,0.2)] outline outline-2 outline-[#a99cff]/60 ring-4 ring-[#1e1a3f]">
            <MapPinned className="h-7 w-7" aria-hidden />
            {pinned && <span className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-[#ffd23c] ring-2 ring-[#1e1a3f]" aria-hidden />}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The round's result (GeoGame's RoundReveal)
// ---------------------------------------------------------------------------

/** The score counting up, eased out, after `delay` (GeoGame's useCountUp). */
function useCountUp(value: number, ms: number, delay: number, reduced: boolean): number {
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) return setShown(value);
    let raf = 0;
    const id = window.setTimeout(() => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        setShown(Math.round(value * (1 - (1 - t) ** 3)));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(id);
      cancelAnimationFrame(raf);
    };
  }, [value, ms, delay, reduced]);
  return shown;
}

function Reveal({ reduced }: { reduced: boolean }) {
  const t = useT(geoHowto);
  const names = useGeoNames();
  const fmt = (n: number) => formatNumber(n, t.locale);
  const countDelay = reduced ? 0 : LINE_DRAW_MS + FIT_MS * 0.6;
  const shown = useCountUp(SCORE, SCORE_COUNT_MS, countDelay, reduced);
  const bar = { initial: { width: reduced ? `${(SCORE / GEO_MAX_ROUND_SCORE) * 100}%` : 0 }, animate: { width: `${(SCORE / GEO_MAX_ROUND_SCORE) * 100}%` }, transition: { duration: reduced ? 0 : SCORE_COUNT_MS / 1000, delay: reduced ? 0 : countDelay / 1000, ease: "easeOut" as const } };
  const rise = (delay: number) => ({ initial: reduced ? false : { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay: reduced ? 0 : delay, ease: [0.2, 0.8, 0.2, 1] as const } });
  return (
    <div className="relative flex h-full flex-col md:block">
      <div className="relative min-h-0 flex-1 md:absolute md:inset-x-0 md:bottom-[6.75rem] md:top-0">
        <DemoMap reveal fill reduced={reduced} />
      </div>
      <div className="absolute left-3 top-3 z-20">
        <ExitButton onClick={noop} testId="howto-demo-exit" />
      </div>
      <Notch>
        <div className="text-center">
          <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl">{t("demo.round", { n: 1 })}</div>
          <div className="mt-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{names.region("Paldea")}</div>
        </div>
      </Notch>
      <motion.div {...rise(0.15)} className="relative z-20 shrink-0 border-t-4 border-[#a99cff] bg-[#1e1a3f]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur md:absolute md:inset-x-0 md:bottom-0">
        <div className="mx-auto grid max-w-6xl items-center gap-3 px-4 pb-3 pt-3 sm:gap-6 sm:px-6 md:grid-cols-[1fr_auto_1fr]">
          <div className="min-w-0 text-center md:text-left">
            <p className="hud-label !text-[#c8bfff]">{t(`demo.${VERDICT}`)}</p>
            <p className="geo-glow font-display text-4xl font-bold italic tabular-nums sm:text-5xl">
              {fmt(shown)} <span className="text-lg not-italic text-white/60">{t("demo.pts")}</span>
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="meter h-2 flex-1 !bg-black/40">
                <motion.div className="h-full bg-[#9be15d]" {...bar} />
              </div>
              <span className="font-pixel text-[9px] text-white/50">{fmt(GEO_MAX_ROUND_SCORE)}</span>
            </div>
          </div>
          <motion.div {...rise(reduced ? 0 : (LINE_DRAW_MS + FIT_MS) / 1000)} className="flex min-w-0 flex-col items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border-2 border-[#a99cff] bg-[#4cbb17] px-4 py-1.5 font-display text-sm font-bold uppercase italic tracking-wide text-white shadow-lg">
              <MapPinIcon className="h-4 w-4" aria-hidden />
              {t("demo.squares", { d: t.locale === "en" ? SQUARES.toFixed(1) : formatNumber(SQUARES, t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
            </span>
            {/* LearnCard: the place, its region and game, with the round's screenshot as its artwork. */}
            <div className="flex min-w-0 items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- the same screenshot, as a thumbnail */}
              <img src={SHOT} alt="" className="mt-0.5 h-12 w-16 shrink-0 rounded border border-white/20 object-cover" />
              <div className="min-w-0">
                <p className="truncate font-display text-base font-bold uppercase leading-tight max-md:whitespace-normal max-md:text-sm">{names.place("Levincia")}</p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/70">
                  <span>{names.region("Paldea")}</span>
                  <span className="rounded-sm border border-white/30 px-1.5 py-0.5 text-[11px] text-white">{t("demo.game", { game: names.game("Scarlet / Violet") })}</span>
                  <span className="inline-flex items-center gap-1 underline underline-offset-2">{t("demo.atlas")}</span>
                </p>
              </div>
            </div>
          </motion.div>
          <div className="flex flex-col items-center gap-1.5 md:items-end">
            <span className="flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-md bg-[#4cbb17] px-6 font-display text-base font-bold uppercase tracking-wider text-white shadow-lg">
              {t("demo.next")}
              <kbd aria-hidden className="ml-1 hidden rounded border border-white/40 px-1.5 text-[10px] font-normal normal-case sm:inline [@media(pointer:coarse)]:!hidden">
                {t("demo.space")}
              </kbd>
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-white/60">
              <FlagIcon className="h-3.5 w-3.5" aria-hidden /> {t("demo.report")}
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The demo
// ---------------------------------------------------------------------------

/** The window the game is laid out in, before it's scaled down: a desktop, or a phone (at most this tall in the pop-up). */
const DESKTOP = { w: 1024, h: 640 };
const PHONE = { w: 375, h: 667, maxH: 340 };

/** Desktop: 0 the round, the pointer on the picture; 1 it glides to the map; 2 the map grows, the pointer aims; 3 click: the pin drops; 4 to Guess; 5 pressed; 6 the result (held). */
const DESKTOP_MS = [1300, 900, 1000, 900, 800, 400, 5200];
/** Phone: 0 the round; 1 tap the map button; 2 the map card opens; 3 tap: the pin drops; 4 to the check; 5 pressed; 6 the result (held). */
const PHONE_MS = [1300, 350, 1100, 900, 800, 400, 5200];

const subscribePhone = (on: () => void) => {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
};

/** Where the pointer (desktop) or the finger (phone) is, in the laid-out window's pixels, for each frame. */
function desktopPointer(f: number): { x: number; y: number } {
  const { w: W, h: H } = DESKTOP;
  const m = 327; // the dock at M
  const mapH = m / ASPECT;
  const left = W - 16 - m;
  const top = H - 16 - (mapH + 8 + 48);
  const v = home(m - 4, mapH - 4);
  const guess = { x: left + 2 + v.tx + GUESS.x * v.s, y: top + 2 + v.ty + GUESS.y * v.s };
  if (f === 0) return { x: W * 0.42, y: H * 0.46 };
  if (f === 1) return { x: W - 16 - 109, y: H - 16 - 56 - 100 };
  if (f === 2 || f === 3) return guess;
  return { x: left + m / 2 + 20, y: H - 16 - 24 };
}
function phonePointer(f: number): { x: number; y: number } {
  const { w: W, h: H } = PHONE;
  const button = { x: W - 16 - 32, y: H - 40 };
  if (f <= 1 || f >= 4) return button;
  const cw = W - 24;
  const ch = H - 104 - 92;
  const v = home(cw, ch);
  return { x: 12 + v.tx + GUESS.x * v.s, y: 104 + v.ty + GUESS.y * v.s };
}

export function GuessrDemo() {
  const t = useT(geoHowto);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const reduced = !!useReducedMotion();
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  const f = useDemoFrame(phone ? PHONE_MS : DESKTOP_MS);
  const screen = phone ? PHONE : DESKTOP;
  const [ref, { w: room }] = useLayoutSize<HTMLDivElement>();
  const scale = room ? Math.min(room / screen.w, phone ? PHONE.maxH / PHONE.h : Infinity) : 0;
  const result = f >= 6;
  const pressed = f === 5;
  const point = phone ? phonePointer(f) : desktopPointer(f);
  const tapping = phone ? f === 1 || f === 3 || f === 5 : f === 3 || f === 5;
  return (
    <DemoFrame
      label={t(phone ? "demo.labelPhone" : "demo.labelDesktop", { score: fmt(SCORE), max: fmt(GEO_MAX_ROUND_SCORE) })}
    >
      <div ref={ref} className="w-full" style={{ height: screen.h * scale }}>
        {scale > 0 && (
          <div
            className={cn("relative mx-auto overflow-hidden shadow-lg ring-1 ring-white/10", phone ? "rounded-[1.1rem] ring-2 ring-foreground/20" : "rounded-md")}
            style={{ width: screen.w * scale, height: screen.h * scale }}
            data-testid="howto-demo-screen"
          >
            {/* The game's frame (GameShell), at the window's own size, scaled down. Nothing in it can be clicked or focused. */}
            <div
              inert
              className="pointer-events-none absolute left-0 top-0 origin-top-left overflow-hidden bg-[#0f0d1f] text-white [&_.geo-notch]:!border-t-0 [&_.geo-safe-tl]:!m-0 [&_.geo-safe-tr]:!m-0"
              style={{ width: screen.w, height: screen.h, transform: `scale(${scale})`, "--geo-bar": phone ? "5rem" : "0px" } as React.CSSProperties}
            >
              {result ? (
                <Reveal key="result" reduced={reduced} />
              ) : phone ? (
                <PhoneRound open={f >= 2} pinned={f >= 3} pressed={pressed} reduced={reduced} />
              ) : (
                <DesktopRound open={f >= 2} pinned={f >= 3} pressed={pressed} reduced={reduced} />
              )}
            </div>
            {!reduced && !result && (
              <motion.span
                className="pointer-events-none absolute left-0 top-0 z-10"
                initial={false}
                animate={{ x: point.x * scale, y: point.y * scale, scale: tapping ? 0.8 : 1 }}
                transition={{ x: { duration: 0.7, ease: "easeInOut" }, y: { duration: 0.7, ease: "easeInOut" }, scale: { duration: 0.15 } }}
              >
                {phone ? (
                  <span className="block h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/45 shadow-[0_0_0_2px_rgba(255,255,255,0.85),0_2px_8px_rgba(0,0,0,0.5)]" />
                ) : (
                  // The arrow's tip, not its box, on the point.
                  <MousePointer2 className="-ml-[3px] -mt-[3px] h-5 w-5 fill-white text-black drop-shadow" aria-hidden />
                )}
              </motion.span>
            )}
          </div>
        )}
      </div>
    </DemoFrame>
  );
}

