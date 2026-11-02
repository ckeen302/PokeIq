import { drawBadge, layoutBadges, type BadgeInfo } from "@/lib/sizes/badges";
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

export function drawBadges(g: CanvasRenderingContext2D, anchors: Anchor[], focusKey: string | null, byKey: Map<string, SizeItem>, w: number, h: number, o: OverlayOptions) {
  const focusDist = anchors.find((a) => a.item.key === focusKey)?.dist ?? Infinity;
  const measure = (t: string, px: number) => { g.font = `800 ${px}px ${o.font}`; return g.measureText(t).width; };
  const cands = anchors
    .filter((a) => a.item.key === focusKey || a.dist < focusDist * 2.2)
    .flatMap((a) => {
      const it = byKey.get(a.item.key);
      return it ? [{ key: a.item.key, x: a.x, y: a.y, sh: a.sh, info: badgeInfo(it), focus: a.item.key === focusKey }] : [];
    });
  const places = layoutBadges(cands, { w, h, top: o.top, bottom: o.bottom }, measure, { max: o.max, minSh: h * 0.12, scale: o.scale });
  for (const p of places) {
    const c = cands.find((x) => x.key === p.key);
    if (c) drawBadge(g, c.info, p, o.font);
  }
}
