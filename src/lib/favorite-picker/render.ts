import { artUrl, type ArtStyle } from "@/lib/tier-list/art";
import { COLORS, background, drawMon, ellipsis, fitText, loadImage, roundRect, type Fonts, type Pictures } from "@/lib/tier-list/render";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { TYPES, type Mon, type TypeName } from "@/lib/tier-list/types";

/**
 * The picker's pictures, drawn on a canvas in the browser for the PNG downloads: the favorite with the top 10, and
 * the type chart, each square (Reddit, Discord) or tall (Stories, TikTok). The Tier List Maker's drawing kit and
 * look; no watermark.
 */

export type Size = "square" | "tall";
export const SIZES: Record<Size, { w: number; h: number }> = { square: { w: 1080, h: 1080 }, tall: { w: 1080, h: 1920 } };

export interface PicSlot {
  mon: Mon;
  shiny: boolean;
}

/** Loads each slot's picture in its own colours (a few at a time), falling back like the page does. */
export async function loadSlotPictures(slots: readonly PicSlot[], art: ArtStyle): Promise<Pictures & { slot(s: PicSlot): HTMLImageElement | null }> {
  const out = new Map<string, HTMLImageElement | null>();
  const id = (s: PicSlot) => `${s.mon.k}:${s.shiny ? 1 : 0}`;
  const queue = [...new Map(slots.map((s) => [id(s), s])).values()];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      let img = await loadImage(artUrl(s.mon, art, s.shiny));
      if (!img) img = await loadImage(artUrl(s.mon, art === "hd" ? "pixel" : "hd", s.shiny));
      if (!img && s.shiny) img = await loadImage(artUrl(s.mon, art, false));
      out.set(id(s), img);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  const slot = (s: PicSlot) => out.get(id(s)) ?? null;
  return { slot, get: (m) => out.get(`${m.k}:0`) ?? out.get(`${m.k}:1`) ?? null };
}

/** drawMon for one slot (its own colours). */
function drawSlot(g: CanvasRenderingContext2D, pics: { slot(s: PicSlot): HTMLImageElement | null }, s: PicSlot, x: number, y: number, w: number, h: number, pad?: number) {
  const img = pics.slot(s);
  drawMon(g, { get: () => img }, s.mon, x, y, w, h, pad);
}

const GOLD = COLORS.gold;
const MEDAL = [COLORS.gold, COLORS.silver, COLORS.bronze];

function heading(g: CanvasRenderingContext2D, W: number, eyebrow: string, title: string, f: Fonts, pad: number, scale: number, center = false): number {
  g.textBaseline = "alphabetic";
  g.textAlign = center ? "center" : "left";
  const x = center ? W / 2 : pad;
  g.fillStyle = GOLD;
  g.font = `700 ${Math.round(26 * scale)}px ${f.display}`;
  g.fillText(ellipsis(g, eyebrow.toUpperCase(), W - pad * 2), x, pad + 26 * scale);
  g.fillStyle = COLORS.text;
  const s = fitText(g, title, W - pad * 2, Math.round(64 * scale), 700, f.display, 22);
  g.fillText(ellipsis(g, title, W - pad * 2), x, pad + 26 * scale + 14 * scale + s * 0.95);
  return pad + 26 * scale + 14 * scale + s * 0.95 + 28 * scale;
}

function glow(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  gr.addColorStop(0, "rgba(246,201,74,0.34)");
  gr.addColorStop(1, "rgba(246,201,74,0)");
  g.fillStyle = gr;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
}

export interface ResultDrawing {
  eyebrow: string;
  topLabel: string;
  from: string;
  top: PicSlot[];
}

/** The favorite big, then the rest of the top list (numbered) beside it (square) or under it (tall). */
export function drawResult(g: CanvasRenderingContext2D, W: number, H: number, d: ResultDrawing, pics: { slot(s: PicSlot): HTMLImageElement | null }, f: Fonts) {
  const scale = W / 1080;
  const pad = Math.round(64 * scale);
  background(g, W, H);
  const [fav, ...rest] = d.top;
  if (!fav) return;
  const tall = H > W * 1.3;
  const top = heading(g, W, d.eyebrow, fav.mon.n, f, pad, scale, tall);
  const list = rest.slice(0, 9);
  if (tall) {
    const big = Math.min(W - pad * 2, H * 0.42);
    const cx = W / 2, cy = top + big / 2;
    glow(g, cx, cy, big * 0.62);
    drawSlot(g, pics, fav, cx - big / 2, cy - big / 2, big, big, 0.02);
    let y = top + big + 40 * scale;
    if (list.length) {
      g.fillStyle = COLORS.muted;
      g.textAlign = "left";
      g.font = `600 ${Math.round(26 * scale)}px ${f.body}`;
      g.fillText(d.topLabel, pad, y);
      y += 22 * scale;
      const cols = 3, gap = Math.round(14 * scale);
      const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
      const avail = H - y - pad - (d.from ? 40 * scale : 0);
      const ch = Math.min(cw * 0.92, (avail - gap * 2) / 3);
      list.forEach((s, i) => cell(g, pics, s, i + 2, pad + (i % cols) * (cw + gap), y + Math.floor(i / cols) * (ch + gap), cw, ch, f, scale));
    }
    footer(g, W, H, d.from, f, pad, scale);
    return;
  }
  const colW = list.length ? (W - pad * 2) * 0.52 : W - pad * 2;
  const avail = H - top - pad - (d.from ? 40 * scale : 0);
  const big = Math.min(colW, avail);
  const bx = pad + (colW - big) / 2, by = top + (avail - big) / 2;
  glow(g, bx + big / 2, by + big / 2, big * 0.6);
  drawSlot(g, pics, fav, bx, by, big, big, 0.02);
  if (list.length) {
    const x = pad + colW + 28 * scale, w = W - pad - x;
    const gap = Math.round(8 * scale);
    const rh = Math.min(96 * scale, (avail - gap * (list.length - 1)) / list.length);
    const y0 = top + (avail - (rh * list.length + gap * (list.length - 1))) / 2;
    list.forEach((s, i) => row(g, pics, s, i + 2, x, y0 + i * (rh + gap), w, rh, f, scale));
  }
  footer(g, W, H, d.from, f, pad, scale);
}

function rankColor(rank: number) {
  return MEDAL[rank - 1] ?? COLORS.muted;
}

function row(g: CanvasRenderingContext2D, pics: { slot(s: PicSlot): HTMLImageElement | null }, s: PicSlot, rank: number, x: number, y: number, w: number, h: number, f: Fonts, scale: number) {
  roundRect(g, x, y, w, h, 18 * scale);
  g.fillStyle = COLORS.panel;
  g.fill();
  g.fillStyle = rankColor(rank);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `700 ${Math.round(32 * scale)}px ${f.display}`;
  g.fillText(String(rank), x + 34 * scale, y + h / 2);
  drawSlot(g, pics, s, x + 62 * scale, y + 4 * scale, h - 8 * scale, h - 8 * scale);
  g.fillStyle = COLORS.text;
  g.textAlign = "left";
  const nx = x + 62 * scale + h + 6 * scale;
  const fs = fitText(g, s.mon.n, x + w - nx - 16 * scale, Math.round(30 * scale), 600, f.body, 14);
  g.font = `600 ${fs}px ${f.body}`;
  g.fillText(ellipsis(g, s.mon.n, x + w - nx - 16 * scale), nx, y + h / 2);
}

function cell(g: CanvasRenderingContext2D, pics: { slot(s: PicSlot): HTMLImageElement | null }, s: PicSlot, rank: number, x: number, y: number, w: number, h: number, f: Fonts, scale: number) {
  roundRect(g, x, y, w, h, 22 * scale);
  g.fillStyle = COLORS.panel;
  g.fill();
  const nameH = 44 * scale;
  drawSlot(g, pics, s, x + 10 * scale, y + 10 * scale, w - 20 * scale, h - nameH - 14 * scale);
  g.fillStyle = rankColor(rank);
  g.textAlign = "left";
  g.textBaseline = "top";
  g.font = `700 ${Math.round(30 * scale)}px ${f.display}`;
  g.fillText(String(rank), x + 16 * scale, y + 12 * scale);
  g.fillStyle = COLORS.text;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const fs = fitText(g, s.mon.n, w - 20 * scale, Math.round(26 * scale), 600, f.body, 12);
  g.font = `600 ${fs}px ${f.body}`;
  g.fillText(ellipsis(g, s.mon.n, w - 20 * scale), x + w / 2, y + h - nameH / 2 - 4 * scale);
}

function footer(g: CanvasRenderingContext2D, W: number, H: number, text: string, f: Fonts, pad: number, scale: number) {
  if (!text) return;
  g.fillStyle = COLORS.muted;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = `500 ${Math.round(22 * scale)}px ${f.body}`;
  g.fillText(ellipsis(g, text, W - pad * 2), W / 2, H - pad * 0.6);
}

export interface ChartDrawing {
  title: string;
  typeName(t: TypeName): string;
  slots: Partial<Record<TypeName, PicSlot>>;
}

/** The type chart: a cell per type, its name on the type's colour, six across (square) or three across (tall). */
export function drawChart(g: CanvasRenderingContext2D, W: number, H: number, d: ChartDrawing, pics: { slot(s: PicSlot): HTMLImageElement | null }, f: Fonts) {
  const scale = W / 1080;
  const pad = Math.round(48 * scale);
  background(g, W, H);
  g.fillStyle = COLORS.text;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  const ts = fitText(g, d.title, W - pad * 2, Math.round(54 * scale), 700, f.display, 20);
  g.font = `700 ${ts}px ${f.display}`;
  g.fillText(ellipsis(g, d.title, W - pad * 2), W / 2, pad + ts * 0.9);
  const top = pad + ts * 0.9 + 30 * scale;
  const tall = H > W * 1.3;
  const cols = tall ? 3 : 6, rows = TYPES.length / cols;
  const gap = Math.round(12 * scale);
  const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
  const ch = (H - top - pad - gap * (rows - 1)) / rows;
  TYPES.forEach((ty, i) => {
    const x = pad + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (ch + gap);
    const band = Math.round((tall ? 46 : 36) * scale);
    g.save();
    roundRect(g, x, y, cw, ch, 20 * scale);
    g.fillStyle = COLORS.panel;
    g.fill();
    g.clip();
    g.fillStyle = typeColor(ty);
    g.fillRect(x, y, cw, band);
    g.restore();
    g.fillStyle = typeTextColor(ty);
    g.textAlign = "center";
    g.textBaseline = "middle";
    const name = d.typeName(ty);
    const fs = fitText(g, name, cw - 12 * scale, Math.round((tall ? 26 : 20) * scale), 700, f.body, 10);
    g.font = `700 ${fs}px ${f.body}`;
    g.fillText(ellipsis(g, name, cw - 10 * scale), x + cw / 2, y + band / 2 + 1);
    const s = d.slots[ty];
    const nameH = Math.round((tall ? 50 : 36) * scale);
    if (s) {
      drawSlot(g, pics, s, x + 6 * scale, y + band + 4 * scale, cw - 12 * scale, ch - band - nameH - 6 * scale);
      g.fillStyle = COLORS.text;
      const ns = fitText(g, s.mon.n, cw - 12 * scale, Math.round((tall ? 26 : 19) * scale), 600, f.body, 10);
      g.font = `600 ${ns}px ${f.body}`;
      g.fillText(ellipsis(g, s.mon.n, cw - 10 * scale), x + cw / 2, y + ch - nameH / 2 - 2 * scale);
    } else {
      g.strokeStyle = COLORS.line;
      g.lineWidth = 2 * scale;
      g.setLineDash([8 * scale, 8 * scale]);
      const r = Math.min(cw, ch - band) * 0.3;
      g.beginPath();
      g.arc(x + cw / 2, y + band + (ch - band) / 2, r, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
  });
}
