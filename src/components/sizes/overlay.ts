import { badgeSize, dexTag as dexTagText, drawBadge, layoutBadges, type BadgeInfo, type Placement } from "@/lib/sizes/badges";
import type { SizeItem } from "@/lib/sizes/types";
import type { Anchor } from "./scene";

/**
 * Draws the badges over a frame of the scene: the framed figure's badge
 * first and biggest, then its nearest neighbours that have room. Shared by
 * the live page's overlay canvas and the video recorder.
 */

export const badgeInfo = (i: SizeItem): BadgeInfo => ({ name: i.name, dex: i.kind === "ref" ? 0 : i.species, kind: i.kind, m: i.m, length: i.length, min: i.min, types: i.types });

export interface OverlayOptions {
  /** Font family for the badges (the page's display font). */
  font: string;
  /** Badge scale (phones and videos use bigger badges). */
  scale: number;
  max: number;
  /** Space kept clear at the top and bottom (px), for page controls. */
  top: number;
  bottom: number;
}

type Cand = { key: string; x: number; y: number; sh: number; info: BadgeInfo; focus: boolean };

function candidates(anchors: Anchor[], focusKey: string | null, byKey: Map<string, SizeItem>): Cand[] {
  const focusDist = anchors.find((a) => a.item.key === focusKey)?.dist ?? Infinity;
  const out: Cand[] = [];
  for (const a of anchors) {
    if (a.item.key !== focusKey && a.dist >= focusDist * 2.2) continue;
    const it = byKey.get(a.item.key);
    if (it) out.push({ key: a.item.key, x: a.x, y: a.y, sh: a.sh, info: badgeInfo(it), focus: a.item.key === focusKey });
  }
  return out;
}

/** Draws every badge afresh (the video recorder, which renders each frame once). */
export function drawBadges(g: CanvasRenderingContext2D, anchors: Anchor[], focusKey: string | null, byKey: Map<string, SizeItem>, w: number, h: number, o: OverlayOptions) {
  const measure = (t: string, px: number) => { g.font = `800 ${px}px ${o.font}`; return g.measureText(t).width; };
  const cands = candidates(anchors, focusKey, byKey);
  const places = layoutBadges(cands, { w, h, top: o.top, bottom: o.bottom }, measure, { max: o.max, minSh: h * 0.12, scale: o.scale });
  for (const p of places) {
    const c = cands.find((x) => x.key === p.key);
    if (c) drawBadge(g, c.info, p, o.font);
  }
}

/** Badge scales are rendered on a grid of steps this fine (about 2%), then drawn at their exact size. */
const STEPS_PER_OCTAVE = 32;
const MAX_CACHED = 48;

/**
 * The live page's badge layer. Drawing a badge (gradients, outlined text,
 * soft shadows) costs far more than copying one, so each badge is drawn once
 * into its own small canvas per size step and copied into the overlay each
 * frame; text widths are measured once per name; and the overlay isn't
 * touched at all on a frame whose badges sit exactly where they did.
 */
export class BadgeLayer {
  private widths = new Map<string, number>();
  private bitmaps = new Map<string, { canvas: HTMLCanvasElement; pad: number; w: number; h: number; s: number }>();
  private lastSig = "";
  private probe: CanvasRenderingContext2D | null = null;

  constructor(private font: string) {}

  /** Fonts that load late change every width: start over. */
  reset(font = this.font) {
    this.font = font;
    this.widths.clear();
    this.bitmaps.clear();
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

  private bitmap(key: string, info: BadgeInfo, s: number, dpr: number) {
    const step = Math.round(Math.log2(Math.max(1, s)) * STEPS_PER_OCTAVE);
    const id = `${key}|${step}|${dpr}`;
    let b = this.bitmaps.get(id);
    if (b) {
      // Most recently used last.
      this.bitmaps.delete(id);
      this.bitmaps.set(id, b);
      return b;
    }
    const sq = Math.pow(2, step / STEPS_PER_OCTAVE);
    const { w, h } = badgeSize(info, sq, this.measure);
    const pad = Math.ceil(sq * 0.45);
    // The dex tag (and "(LENGTH)") may run past a short name's banner.
    const th = sq * 0.5;
    const tagW = info.dex ? sq * 0.1 + this.measure(dexTagText(info.dex), th * 0.72) + th * 0.7 + (info.length ? sq * 0.1 + this.measure("(LENGTH)", th * 0.6) + th * 0.6 : 0) : 0;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil((Math.max(w, tagW) + pad * 2) * dpr);
    canvas.height = Math.ceil((h + pad * 2) * dpr);
    const g = canvas.getContext("2d");
    if (g) {
      g.scale(dpr, dpr);
      drawBadge(g, info, { x: pad, y: pad, s: sq, alpha: 1, w }, this.font);
    }
    b = { canvas, pad, w, h, s: sq };
    this.bitmaps.set(id, b);
    if (this.bitmaps.size > MAX_CACHED) this.bitmaps.delete(this.bitmaps.keys().next().value!);
    return b;
  }

  /** Lays out and draws this frame's badges; returns false when nothing changed (the overlay was left as it was). */
  draw(g: CanvasRenderingContext2D, anchors: Anchor[], focusKey: string | null, byKey: Map<string, SizeItem>, w: number, h: number, dpr: number, o: Omit<OverlayOptions, "font">): boolean {
    const cands = candidates(anchors, focusKey, byKey);
    const places = layoutBadges(cands, { w, h, top: o.top, bottom: o.bottom }, this.measure, { max: o.max, minSh: h * 0.12, scale: o.scale });
    const sig = signature(places, w, h);
    if (sig === this.lastSig) return false;
    this.lastSig = sig;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of places) {
      const c = cands.find((x) => x.key === p.key);
      if (!c) continue;
      const b = this.bitmap(p.key, c.info, p.s, dpr);
      const k = p.s / b.s;
      g.globalAlpha = p.alpha;
      g.drawImage(b.canvas, p.x - b.pad * k, p.y - b.pad * k, (b.w + b.pad * 2) * k, (b.h + b.pad * 2) * k);
    }
    g.globalAlpha = 1;
    return true;
  }

  /** Forgets the last frame (the overlay was cleared or resized). */
  invalidate() {
    this.lastSig = "";
  }
}

const signature = (places: Placement[], w: number, h: number) => `${w}x${h};${places.map((p) => `${p.key}:${p.x.toFixed(1)},${p.y.toFixed(1)},${p.s.toFixed(2)},${p.alpha.toFixed(2)}`).join(";")}`;
