"use client";

/**
 * Pokémon Hunt's marks on the PokéGuessr map (drawn inside GeoMap's SVG
 * layer, in screen pixels): the numbered pins a player drops, and the real
 * spots the reveal pops in, each with a small "game · method" tag.
 * Presentation only: GeoMap places them; the hunt game says where.
 */

/** The pins' colours, by number: blue like PokéGuessr's own pin, then two that read apart from it and from the map. */
export const HUNT_PIN_COLORS = ["#3a8dde", "#e2306f", "#f39c12"] as const;
export const huntPinColor = (i: number) => HUNT_PIN_COLORS[i % HUNT_PIN_COLORS.length];

/**
 * A numbered pin: PokéGuessr's teardrop with the pin's number in its head.
 * The pin being moved (`active`) wears a yellow halo; a new position replays the drop.
 */
export function HuntPinMark({ x, y, n, active, delay = 0, dim }: { x: number; y: number; n: number; active?: boolean; delay?: number; dim?: boolean }) {
  const r = 12;
  const color = huntPinColor(n - 1);
  return (
    <g transform={`translate(${x} ${y})`} opacity={dim ? 0.55 : 1} data-testid={`hunt-pin-${n}`} data-active={active ? "true" : undefined}>
      <g className="geo-drop" style={{ animationDelay: `${delay}s` }}>
        <ellipse cy={1} rx={5.5} ry={2.2} fill="rgba(0,0,0,0.35)" />
        {active && <circle cy={-r * 1.75} r={r * 1.25} fill="none" stroke="#ffd23c" strokeWidth={3} className="hunt-halo" />}
        <path d={`M0 0 L${-r * 0.82} ${-r * 1.35} A${r} ${r} 0 1 1 ${r * 0.82} ${-r * 1.35} Z`} fill={color} stroke="#120f24" strokeWidth={2} strokeLinejoin="round" />
        <circle cy={-r * 1.75} r={r * 0.68} fill="#fff" />
        <text y={-r * 1.75} dy="0.36em" textAnchor="middle" fontSize={12} fontWeight={800} fill="#120f24" style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}>
          {n}
        </text>
      </g>
    </g>
  );
}

const TAG_FONT = "700 10.5px system-ui, sans-serif";
let ctx: CanvasRenderingContext2D | null | undefined;
/** A tag's width in px (measured once the page is in a browser; a fair guess before). */
export function tagWidth(tag: string): number {
  if (ctx === undefined) ctx = typeof document === "undefined" ? undefined : (document.createElement("canvas").getContext("2d") ?? null);
  if (ctx) {
    ctx.font = TAG_FONT;
    return Math.ceil(ctx.measureText(tag).width) + 12;
  }
  return 12 + tag.length * 6.2;
}

/**
 * Which spots' tags to draw, and on which side: found spots first, then the
 * rest; a tag that would overlap one already placed is left off (the round's
 * result lists every spot anyway). A tag that would run off the right edge goes left.
 */
export function spotTagPlacement(spots: { x: number; y: number; tag?: string; found?: boolean }[], width: number): { show: boolean; left: boolean }[] {
  const placed: [number, number, number, number][] = [];
  const out = spots.map(() => ({ show: false, left: false }));
  const order = spots.map((_, i) => i).sort((a, b) => Number(!!spots[b].found) - Number(!!spots[a].found));
  for (const i of order) {
    const s = spots[i];
    if (!s.tag) continue;
    const w = tagWidth(s.tag);
    for (const left of width && s.x + 16 + w > width - 4 ? [true, false] : [false, true]) {
      const box: [number, number, number, number] = left ? [s.x - 16 - w, s.y - 10, s.x - 12, s.y + 10] : [s.x + 12, s.y - 10, s.x + 16 + w, s.y + 10];
      // Never off the map's edge.
      if (width && (box[0] < 2 || box[2] > width - 2)) continue;
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      // Flags count as taken room too.
      if (spots.some((o, k) => k !== i && o.x > box[0] - 11 && o.x < box[2] + 11 && o.y > box[1] - 11 && o.y < box[3] + 11)) continue;
      placed.push(box);
      out[i] = { show: true, left };
      break;
    }
  }
  return out;
}

export interface HuntSpotMarkProps {
  x: number;
  y: number;
  /** "Red/Blue · Super Rod": the game and the method, never shown before the reveal. */
  tag?: string;
  /** Pops in after this long (seconds): the reveal brings the spots in region by region. */
  delay?: number;
  /** A player's pin is linked to this spot (it scored). */
  found?: boolean;
  /** Draw the tag (the map hides tags that would sit on top of another). */
  showTag?: boolean;
  /** The tag sits to the left of the flag (it would run off the right edge). */
  tagLeft?: boolean;
}

/**
 * A real spot: PokéGuessr's black-and-yellow answer flag, a little smaller (a
 * Pokémon can have many), ringed green when a pin found it, with its tag.
 */
export function HuntSpotMark({ x, y, tag, delay = 0, found, showTag = true, tagLeft }: HuntSpotMarkProps) {
  const w = tag ? tagWidth(tag) : 0;
  return (
    <g transform={`translate(${x} ${y})`} data-testid="hunt-map-spot" data-found={found ? "true" : undefined}>
      <g className="hunt-pop" style={{ animationDelay: `${delay}s` }}>
        {found && <circle r={15} fill="none" stroke="#9be15d" strokeWidth={3} />}
        <circle r={11} fill="#120f24" stroke="#fff" strokeWidth={2} />
        <path d="M-3.4 6V-6" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
        <path d="M-2.6 -6h8.6l-2.2 2.8L6 -0.5h-8.6z" fill="#ffd23c" />
        {tag && showTag && (
          <g transform={`translate(${tagLeft ? -16 - w : 16} -9)`}>
            <rect width={w} height={18} rx={4} fill="rgba(18,15,36,0.88)" stroke={found ? "#9be15d" : "rgba(255,255,255,0.35)"} strokeWidth={1} />
            <text x={6} y={12.5} fill="#fff" style={{ font: TAG_FONT }}>
              {tag}
            </text>
          </g>
        )}
      </g>
    </g>
  );
}
