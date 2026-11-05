import { badgeSize, dexTag as dexTagText, drawBadge, layoutBadges, type BadgeInfo, type Placement } from "@/lib/sizes/badges";
import { HEIGHT_ORDER, badgeStat, type Order } from "@/lib/sizes/order";
import type { SizeItem } from "@/lib/sizes/types";
import type { Anchor } from "./scene";

/**
 * Draws the badges over a frame of the scene: the framed figure's badge
 * first and biggest, then its nearest neighbours that have room. Shared by
 * the live page's overlay canvas and the video recorder.
 */

/** A figure's badge; in a stat or weight order it also carries the line's value. */
export const badgeInfo = (i: SizeItem, order: Order = HEIGHT_ORDER): BadgeInfo => ({ name: i.name, dex: i.kind === "ref" ? 0 : i.species, kind: i.kind, m: i.m, length: i.length, min: i.min, types: i.types, stat: badgeStat(i, order) });

export interface OverlayOptions {
  /** Font family for the badges (the page's display font). */
  font: string;
  /** Badge scale (phones and videos use bigger badges). */
  scale: number;
  max: number;
  /** Space kept clear at the top and bottom (px), for page controls. */
  top: number;
  bottom: number;
  /** The line's order (its value joins each badge); Height by default. */
  order?: Order;
}

type Cand = { key: string; x: number; y: number; sh: number; info: BadgeInfo; focus: boolean };
type Bitmap = { key: string; dpr: number; canvas: HTMLCanvasElement; pad: number; w: number; h: number; s: number };

function candidates(anchors: Anchor[], focusKey: string | null, byKey: Map<string, SizeItem>, order?: Order): Cand[] {
  const focusDist = anchors.find((a) => a.item.key === focusKey)?.dist ?? Infinity;
  const out: Cand[] = [];
  for (const a of anchors) {
    if (a.item.key !== focusKey && a.dist >= focusDist * 2.2) continue;
    const it = byKey.get(a.item.key);
    if (it) out.push({ key: a.item.key, x: a.x, y: a.y, sh: a.sh, info: badgeInfo(it, order), focus: a.item.key === focusKey });
  }
  return out;
}

/** Draws every badge afresh (the video recorder, which renders each frame once). */
export function drawBadges(g: CanvasRenderingContext2D, anchors: Anchor[], focusKey: string | null, byKey: Map<string, SizeItem>, w: number, h: number, o: OverlayOptions) {
  const measure = (t: string, px: number) => { g.font = `800 ${px}px ${o.font}`; return g.measureText(t).width; };
  const cands = candidates(anchors, focusKey, byKey, o.order);
  const places = layoutBadges(cands, { w, h, top: o.top, bottom: o.bottom }, measure, { max: o.max, minSh: h * 0.12, scale: o.scale });
  for (const p of places) {
    const c = cands.find((x) => x.key === p.key);
    if (c) drawBadge(g, c.info, p, o.font);
  }
}

/** A cached badge is reused while the size it's needed at stays within this share of the size it was drawn at (drawn scaled to fit). */
const REUSE = 0.03;
/** Close enough to count as drawn at its own size. */
const EXACT = 0.004;
const MAX_CACHED = 40;

/**
 * The live page's badge layer. Drawing a badge (gradients, outlined text,
 * soft shadows) costs far more than copying one, so each badge is drawn once
 * into its own small canvas per size step and copied into the overlay each
 * frame; text widths are measured once per name; and the overlay isn't
 * touched at all on a frame whose badges sit exactly where they did.
 */
export class BadgeLayer {
  private widths = new Map<string, number>();
  private bitmaps = new Map<string, Bitmap>();
  private spare: HTMLCanvasElement[] = [];
  private lastSig = "";
  private still = 0;
  private crisp = true;
  private probe: CanvasRenderingContext2D | null = null;
  private order: Order = HEIGHT_ORDER;

  constructor(private font: string) {}

  /** The line's order: its value joins every badge (the cached ones are drawn again). */
  setOrder(order: Order) {
    if (order.by === this.order.by && order.dir === this.order.dir) return;
    this.order = order;
    this.bitmaps.clear();
    this.lastSig = "";
  }

  /** Fonts that load late change every width: start over. */
  reset(font = this.font) {
    this.font = font;
    this.widths.clear();
    this.bitmaps.clear();
    this.spare = [];
    this.lastSig = "";
  }

  private measure = (t: string, px: number) => {
    let w100 = this.widths.get(t);
    if (w100 === undefined) {
      this.probe ??= document.createElement("canvas").getContext("2d");
      if (!this.probe) return t.length * px * 0.6;
      this.probe.font = `800 100px ${this.font}`;
      w100 = this.probe.measureText(t).width;
      this.widths.set(t, w100);
    }
    return (w100 * px) / 100;
  };

  private bitmap(key: string, info: BadgeInfo, s: number, dpr: number, tolerance: number) {
    // Any copy drawn near this size will do: as a figure drifts across the frame its badge's size wanders, and redrawing it each time would cost more than it saves.
    let best: { id: string; b: Bitmap } | null = null;
    for (const [id, b] of this.bitmaps) {
      if (b.key !== key || b.dpr !== dpr) continue;
      const off = Math.abs(b.s / s - 1);
      if (off <= tolerance && (!best || off < Math.abs(best.b.s / s - 1))) best = { id, b };
    }
    if (best) {
      // Most recently used last.
      this.bitmaps.delete(best.id);
      this.bitmaps.set(best.id, best.b);
      return best.b;
    }
    const { w, h } = badgeSize(info, s, this.measure);
    const pad = Math.ceil(s * 0.45);
    // The dex tag (and "(LENGTH)") may run past a short name's banner.
    const th = s * 0.5;
    const tagW = info.dex ? s * 0.1 + this.measure(dexTagText(info.dex), th * 0.72) + th * 0.7 + (info.length ? s * 0.1 + this.measure("(LENGTH)", th * 0.6) + th * 0.6 : 0) : 0;
    // Reuse an evicted canvas when there is one.
    const canvas = this.spare.pop() ?? document.createElement("canvas");
    canvas.width = Math.ceil((Math.max(w, tagW) + pad * 2) * dpr);
    canvas.height = Math.ceil((h + pad * 2) * dpr);
    const g = canvas.getContext("2d");
    if (g) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBadge(g, info, { x: pad, y: pad, s, alpha: 1, w }, this.font);
    }
    const b: Bitmap = { key, dpr, canvas, pad, w, h, s };
    this.bitmaps.set(`${key}|${s.toFixed(3)}|${dpr}`, b);
    if (this.bitmaps.size > MAX_CACHED) {
      const [oldest, old] = this.bitmaps.entries().next().value!;
      this.bitmaps.delete(oldest);
      if (this.spare.length < 8) this.spare.push(old.canvas);
    }
    return b;
  }

  /** Lays out and draws this frame's badges; returns false when nothing changed (the overlay was left as it was). */
  draw(g: CanvasRenderingContext2D, anchors: Anchor[], focusKey: string | null, byKey: Map<string, SizeItem>, w: number, h: number, dpr: number, o: Omit<OverlayOptions, "font">): boolean {
    const cands = candidates(anchors, focusKey, byKey, this.order);
    const places = layoutBadges(cands, { w, h, top: o.top, bottom: o.bottom }, this.measure, { max: o.max, minSh: h * 0.12, scale: o.scale });
    const sig = signature(places, w, h);
    if (sig === this.lastSig) {
      // Still for a moment: redraw any badge that was copied a little off its size, so text at rest is pixel-sharp.
      if (!this.crisp && ++this.still >= 6) this.crisp = this.paint(g, places, cands, dpr, EXACT);
      return false;
    }
    this.lastSig = sig;
    this.still = 0;
    this.crisp = this.paint(g, places, cands, dpr, REUSE);
    return true;
  }

  /** Paints the placed badges; true when every one was copied at (about) its own size. */
  private paint(g: CanvasRenderingContext2D, places: Placement[], cands: Cand[], dpr: number, tolerance: number): boolean {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    let exact = true;
    for (const p of places) {
      const c = cands.find((x) => x.key === p.key);
      if (!c) continue;
      const b = this.bitmap(p.key, c.info, p.s, dpr, tolerance);
      const k = p.s / b.s;
      if (Math.abs(k - 1) > EXACT) exact = false;
      g.globalAlpha = p.alpha;
      const dx = p.x - b.pad * k, dy = p.y - b.pad * k;
      // At its own size a badge lands on whole device pixels, so its text is copied pixel for pixel, not resampled.
      if (Math.abs(k - 1) <= EXACT) g.drawImage(b.canvas, Math.round(dx * dpr) / dpr, Math.round(dy * dpr) / dpr, b.canvas.width / dpr, b.canvas.height / dpr);
      else g.drawImage(b.canvas, dx, dy, (b.canvas.width / dpr) * k, (b.canvas.height / dpr) * k);
    }
    g.globalAlpha = 1;
    return exact;
  }

  /** Forgets the last frame (the overlay was cleared or resized). */
  invalidate() {
    this.lastSig = "";
  }
}

const signature = (places: Placement[], w: number, h: number) => `${w}x${h};${places.map((p) => `${p.key}:${p.x.toFixed(1)},${p.y.toFixed(1)},${p.s.toFixed(2)},${p.alpha.toFixed(2)}`).join(";")}`;
