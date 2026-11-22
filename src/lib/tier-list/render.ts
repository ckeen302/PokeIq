import { artUrl, isPixelUrl, type ArtStyle } from "./art";
import { finishingOrder, resolveBracket, roundLabel, type Resolved } from "./bracket";
import type { TierRow, TopState } from "./state";
import type { Mon } from "./types";

/**
 * The maker's pictures, drawn on a canvas in the browser: a tier list, a top list, a blind ranking (one or two runs),
 * a bracket's champion and the full bracket. The same drawings make the PNG downloads and the video's frames. Crisp at
 * any size: pixel sprites scale with whole pixels, HD renders smoothly. No watermark.
 */

export type Aspect = "square" | "wide" | "vertical";
export const ASPECTS: Record<Aspect, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  wide: { w: 1920, h: 1080 },
  vertical: { w: 1080, h: 1920 },
};

export interface Fonts {
  display: string;
  body: string;
}

export const COLORS = {
  bg: "#0a0918",
  bg2: "#14112b",
  panel: "rgba(255,255,255,0.045)",
  line: "rgba(255,255,255,0.08)",
  text: "#f6f5fc",
  muted: "#a4a0ba",
  pink: "#f1417c",
  violet: "#a47efb",
  gold: "#f6c94a",
  silver: "#c9d2e0",
  bronze: "#e09a5f",
};

export interface Pictures {
  get(m: Mon): HTMLImageElement | null;
}

const cache = new Map<string, Promise<HTMLImageElement | null>>();

/** A picture that a canvas may read (fetched with CORS); null if it doesn't load. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = cache.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    cache.set(src, p);
    void p.then((img) => !img && cache.delete(src));
  }
  return p;
}

/** Loads every picture the drawing needs (a few at a time), falling back to the other style when one is missing. */
export async function loadPictures(mons: readonly Mon[], art: ArtStyle, shiny: boolean, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<Pictures> {
  const out = new Map<string, HTMLImageElement | null>();
  const unique = [...new Map(mons.map((m) => [m.k, m])).values()];
  let done = 0;
  const queue = unique.slice();
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      if (signal?.aborted) return;
      let img = await loadImage(artUrl(m, art, shiny));
      if (!img) img = await loadImage(artUrl(m, art === "hd" ? "pixel" : "hd", shiny));
      if (!img && shiny) img = await loadImage(artUrl(m, art, false));
      out.set(m.k, img);
      onProgress?.(++done / unique.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(12, unique.length) }, worker));
  return { get: (m) => out.get(m.k) ?? null };
}

/** Draws a Pokémon's picture inside a box, uncropped (pixel art with whole-pixel scaling when it fits). */
export function drawMon(g: CanvasRenderingContext2D, pics: Pictures, m: Mon, x: number, y: number, w: number, h: number, pad = 0.06) {
  const img = pics.get(m);
  if (!img || !img.naturalWidth) return;
  const px = isPixelUrl(img.src);
  const bw = w * (1 - pad * 2), bh = h * (1 - pad * 2);
  let s = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
  // Pixel sprites sit in a padded 96 px canvas: let them fill the box, at a whole-number scale when enlarged.
  if (px) {
    s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    if (s >= 1) s = Math.floor(s);
  }
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  g.save();
  g.imageSmoothingEnabled = !px;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  g.restore();
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

export function background(g: CanvasRenderingContext2D, W: number, H: number) {
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, COLORS.bg2);
  grad.addColorStop(1, COLORS.bg);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.5, H * 0.1, 0, W * 0.5, H * 0.1, Math.max(W, H) * 0.7);
  glow.addColorStop(0, "rgba(164,126,251,0.16)");
  glow.addColorStop(1, "rgba(164,126,251,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
}

/** Shrinks text to fit a width (down to a floor), then trims it with an ellipsis. */
export function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight: number, family: string, min = 12): number {
  let s = size;
  g.font = `${weight} ${s}px ${family}`;
  while (s > min && g.measureText(text).width > maxW) {
    s -= 1;
    g.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

export function ellipsis(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.3 ? "#16131f" : "#ffffff";
}

function header(g: CanvasRenderingContext2D, W: number, title: string, sub: string, f: Fonts, pad: number, scale: number): number {
  g.fillStyle = COLORS.text;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  const s = fitText(g, title, W - pad * 2, Math.round(58 * scale), 700, f.display, 20);
  g.fillText(ellipsis(g, title, W - pad * 2), pad, pad + s * 0.9);
  let y = pad + s * 0.9;
  if (sub) {
    g.fillStyle = COLORS.muted;
    g.font = `500 ${Math.round(24 * scale)}px ${f.body}`;
    y += Math.round(36 * scale);
    g.fillText(ellipsis(g, sub, W - pad * 2), pad, y);
  }
  return y + Math.round(30 * scale);
}

export interface TierLayout {
  tile: number;
  gap: number;
  labelW: number;
  rows: { y: number; h: number; perLine: number }[];
}

/** The biggest tile size at which every tier fits in the area. */
export function layoutTiers(rows: readonly TierRow[], w: number, h: number, scale: number): TierLayout {
  const gap = Math.max(3, Math.round(6 * scale));
  const labelW = Math.round(120 * scale);
  const inner = (pad: number) => w - labelW - pad * 2;
  const fits = (tile: number) => {
    const pad = Math.max(4, Math.round(tile * 0.08));
    const perLine = Math.max(1, Math.floor((inner(pad) + gap) / (tile + gap)));
    let y = 0;
    const out: TierLayout["rows"] = [];
    for (const r of rows) {
      const lines = Math.max(1, Math.ceil(r.items.length / perLine));
      const rh = lines * tile + (lines - 1) * gap + pad * 2;
      out.push({ y, h: rh, perLine });
      y += rh + gap;
    }
    return { ok: y - gap <= h, out };
  };
  let lo = 8, hi = Math.round(Math.min(200 * scale, (h - gap * rows.length) / Math.max(1, rows.length)));
  let best = fits(lo).out;
  let bestTile = lo;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = fits(mid);
    if (r.ok) {
      best = r.out;
      bestTile = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return { tile: bestTile, gap, labelW, rows: best };
}

export interface TierDrawing {
  title: string;
  subtitle: string;
  rows: TierRow[];
  byKey: ReadonlyMap<string, Mon>;
  /** For the video: how many tiles of each row to show, and the newest tile's pop (0…1). */
  reveal?: { counts: number[]; pop: number; rowsShown: number };
}

export function drawTierList(g: CanvasRenderingContext2D, W: number, H: number, d: TierDrawing, pics: Pictures, f: Fonts) {
  const scale = Math.min(W, H) / 1080;
  const pad = Math.round(56 * scale);
  background(g, W, H);
  // Measure the header, lay the board out under it, then centre the two together (a short list on a tall picture).
  const probe = document.createElement("canvas").getContext("2d") ?? g;
  const top = header(probe, W, d.title, d.subtitle, f, pad, scale);
  const avail = H - top - pad;
  const L = layoutTiers(d.rows, W - pad * 2, avail, scale);
  const last = L.rows[L.rows.length - 1];
  const used = last ? last.y + last.h : 0;
  g.save();
  g.translate(0, Math.max(0, Math.round((avail - used) / 2)));
  header(g, W, d.title, d.subtitle, f, pad, scale);
  const r0 = Math.round(16 * scale);
  d.rows.forEach((row, i) => {
    const lay = L.rows[i];
    if (!lay) return;
    const shownRow = !d.reveal || i < d.reveal.rowsShown;
    const y = top + lay.y;
    g.save();
    g.globalAlpha = shownRow ? 1 : 0.35;
    roundRect(g, pad, y, W - pad * 2, lay.h, r0);
    g.fillStyle = COLORS.panel;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = row.color;
    g.fillRect(pad, y, L.labelW, lay.h);
    g.restore();
    g.fillStyle = inkOn(row.color);
    g.textAlign = "center";
    g.textBaseline = "middle";
    const label = row.label || " ";
    const big = label.length <= 3;
    const fs = fitText(g, label, L.labelW - 16 * scale, Math.round((big ? 54 : 26) * scale), 700, f.display, 10);
    g.font = `700 ${fs}px ${f.display}`;
    g.fillText(ellipsis(g, label, L.labelW - 12 * scale), pad + L.labelW / 2, y + lay.h / 2);
    g.restore();
    const ipad = Math.max(4, Math.round(L.tile * 0.08));
    const count = d.reveal ? d.reveal.counts[i] ?? 0 : row.items.length;
    row.items.slice(0, count).forEach((k, j) => {
      const m = d.byKey.get(k);
      if (!m) return;
      const col = j % lay.perLine, line = Math.floor(j / lay.perLine);
      const x = pad + L.labelW + ipad + col * (L.tile + L.gap);
      const yy = y + ipad + line * (L.tile + L.gap);
      const isNew = d.reveal && i === d.reveal.rowsShown - 1 && j === count - 1;
      const s = isNew ? 0.6 + 0.4 * easeOutBack(d.reveal!.pop) : 1;
      g.save();
      g.globalAlpha = isNew ? Math.min(1, d.reveal!.pop * 2) : 1;
      const cx = x + L.tile / 2, cy = yy + L.tile / 2;
      g.translate(cx, cy);
      g.scale(s, s);
      roundRect(g, -L.tile / 2, -L.tile / 2, L.tile, L.tile, Math.round(L.tile * 0.16));
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fill();
      drawMon(g, pics, m, -L.tile / 2, -L.tile / 2, L.tile, L.tile);
      g.restore();
    });
  });
  g.restore();
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export interface TopDrawing {
  title: string;
  subtitle: string;
  top: TopState;
  byKey: ReadonlyMap<string, Mon>;
}

const MEDALS = [COLORS.gold, COLORS.silver, COLORS.bronze];

/** A top list: the top three on a podium, the rest in numbered columns, each with its caption. */
export function drawTop(g: CanvasRenderingContext2D, W: number, H: number, d: TopDrawing, pics: Pictures, f: Fonts) {
  const scale = Math.min(W, H) / 1080;
  const pad = Math.round(56 * scale);
  background(g, W, H);
  let y = header(g, W, d.title, d.subtitle, f, pad, scale);
  const items = d.top.items.map((k) => d.byKey.get(k)).filter((m): m is Mon => !!m);
  const podium = items.slice(0, 3);
  const rest = items.slice(3);
  const restRows = rest.length;
  const wideCols = W > H ? 2 : 1;
  const listRows = Math.ceil(restRows / wideCols);
  const avail = H - y - pad;
  const podiumH = Math.round(restRows ? Math.min(avail * 0.56, 560 * scale) : avail);
  const order = podium.length === 3 ? [1, 0, 2] : podium.map((_, i) => i);
  const colW = (W - pad * 2 - (order.length - 1) * 20 * scale) / Math.max(1, order.length);
  order.forEach((i, slot) => {
    const m = podium[i];
    if (!m) return;
    const h = podiumH * (i === 0 ? 1 : i === 1 ? 0.86 : 0.76);
    const x = pad + slot * (colW + 20 * scale);
    const yy = y + podiumH - h;
    roundRect(g, x, yy, colW, h, 28 * scale);
    const grad = g.createRadialGradient(x + colW / 2, yy + h * 0.4, 0, x + colW / 2, yy + h * 0.4, colW * 0.8);
    grad.addColorStop(0, `${MEDALS[i]}44`);
    grad.addColorStop(1, "rgba(255,255,255,0.03)");
    g.fillStyle = grad;
    g.fill();
    g.fillStyle = MEDALS[i];
    g.font = `700 ${Math.round(40 * scale)}px ${f.display}`;
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText(`#${i + 1}`, x + 20 * scale, yy + 16 * scale);
    const cap = d.top.captions[m.k];
    const nameH = (cap ? 70 : 44) * scale;
    drawMon(g, pics, m, x + 10 * scale, yy + 60 * scale, colW - 20 * scale, h - 70 * scale - nameH);
    g.fillStyle = COLORS.text;
    g.textAlign = "center";
    const ns = fitText(g, m.n, colW - 24 * scale, Math.round(30 * scale), 700, f.display, 12);
    g.font = `700 ${ns}px ${f.display}`;
    g.fillText(ellipsis(g, m.n, colW - 24 * scale), x + colW / 2, yy + h - nameH - 4 * scale);
    if (cap) {
      g.fillStyle = COLORS.muted;
      g.font = `500 ${Math.round(19 * scale)}px ${f.body}`;
      g.fillText(ellipsis(g, cap, colW - 24 * scale), x + colW / 2, yy + h - nameH + ns + 2 * scale);
    }
  });
  y += podiumH + 24 * scale;
  if (!restRows) return;
  const listW = (W - pad * 2 - (wideCols - 1) * 24 * scale) / wideCols;
  const rowH = Math.min(96 * scale, (H - pad - y - (listRows - 1) * 10 * scale) / listRows);
  rest.forEach((m, j) => {
    const col = Math.floor(j / listRows), line = j % listRows;
    const x = pad + col * (listW + 24 * scale);
    const yy = y + line * (rowH + 10 * scale);
    roundRect(g, x, yy, listW, rowH, 16 * scale);
    g.fillStyle = COLORS.panel;
    g.fill();
    g.fillStyle = COLORS.muted;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.round(Math.min(34 * scale, rowH * 0.42))}px ${f.display}`;
    g.fillText(String(j + 4), x + 40 * scale, yy + rowH / 2);
    drawMon(g, pics, m, x + 76 * scale, yy + 4, rowH - 8, rowH - 8, 0.02);
    g.textAlign = "left";
    g.fillStyle = COLORS.text;
    const tx = x + 76 * scale + rowH + 8 * scale;
    const cap = d.top.captions[m.k];
    const fs = Math.round(Math.min(28 * scale, rowH * 0.34));
    g.font = `700 ${fs}px ${f.display}`;
    g.fillText(ellipsis(g, m.n, x + listW - tx - 16 * scale), tx, yy + rowH / 2 - (cap ? fs * 0.45 : 0));
    if (cap) {
      g.fillStyle = COLORS.muted;
      g.font = `500 ${Math.round(fs * 0.68)}px ${f.body}`;
      g.fillText(ellipsis(g, cap, x + listW - tx - 16 * scale), tx, yy + rowH / 2 + fs * 0.6);
    }
  });
}

export interface BlindDrawing {
  title: string;
  subtitle: string;
  runs: { name: string; keys: (string | null)[] }[];
  byKey: ReadonlyMap<string, Mon>;
}

/** A blind ranking, or two of the same draw side by side. */
export function drawBlind(g: CanvasRenderingContext2D, W: number, H: number, d: BlindDrawing, pics: Pictures, f: Fonts) {
  const scale = Math.min(W, H) / 1080;
  const pad = Math.round(56 * scale);
  background(g, W, H);
  const y = header(g, W, d.title, d.subtitle, f, pad, scale);
  const n = d.runs[0]?.keys.length ?? 0;
  const cols = d.runs.length;
  const colW = (W - pad * 2 - (cols - 1) * 28 * scale) / cols;
  const headH = cols > 1 ? 44 * scale : 0;
  const twoCol = cols === 1 && W > H && n > 5;
  const perCol = twoCol ? Math.ceil(n / 2) : n;
  const rowH = Math.min(150 * scale, (H - y - pad - headH - (perCol - 1) * 10 * scale) / perCol);
  d.runs.forEach((run, c) => {
    const x0 = pad + c * (colW + 28 * scale);
    if (cols > 1) {
      g.fillStyle = c === 0 ? COLORS.pink : COLORS.violet;
      g.font = `700 ${Math.round(28 * scale)}px ${f.display}`;
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillText(ellipsis(g, run.name, colW), x0, y);
    }
    const subW = twoCol ? (colW - 24 * scale) / 2 : colW;
    run.keys.forEach((k, i) => {
      const sc = twoCol ? Math.floor(i / perCol) : 0;
      const line = twoCol ? i % perCol : i;
      const x = x0 + sc * (subW + 24 * scale);
      const yy = y + headH + line * (rowH + 10 * scale);
      roundRect(g, x, yy, subW, rowH, 16 * scale);
      g.fillStyle = COLORS.panel;
      g.fill();
      g.fillStyle = i < 3 ? MEDALS[i] : COLORS.muted;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `700 ${Math.round(Math.min(40 * scale, rowH * 0.42))}px ${f.display}`;
      g.fillText(String(i + 1), x + 40 * scale, yy + rowH / 2);
      const m = k ? d.byKey.get(k) : null;
      if (!m) return;
      drawMon(g, pics, m, x + 80 * scale, yy + 4, rowH - 8, rowH - 8, 0.02);
      g.fillStyle = COLORS.text;
      g.textAlign = "left";
      const fs = Math.round(Math.min(30 * scale, rowH * 0.36));
      g.font = `700 ${fs}px ${f.display}`;
      g.fillText(ellipsis(g, m.n, x + subW - (x + 80 * scale + rowH + 8 * scale) - 12 * scale), x + 80 * scale + rowH + 4 * scale, yy + rowH / 2);
    });
  });
}

export interface BracketDrawing {
  title: string;
  entrants: string[];
  picks: number[];
  byKey: ReadonlyMap<string, Mon>;
  labels: (roundIndex: number, roundCount: number) => string;
  /** Light theme colours for the on-screen view. */
  light?: boolean;
  /** The on-screen view draws on the page's own background. */
  transparent?: boolean;
}

export interface BracketGeometry {
  W: number;
  H: number;
  colW: number;
  rowH: number;
  gapX: number;
  top: number;
  pad: number;
}

/** The full bracket's size: one column per round, the first round's entrants stacked. */
export function bracketGeometry(entrants: number): BracketGeometry {
  const res = resolveBracket(Array.from({ length: entrants }, (_, i) => String(i)), []);
  const rounds = res.rounds.length;
  const first = res.rounds[0]?.length ?? 1;
  const rowH = first > 256 ? 22 : first > 64 ? 30 : 40;
  const colW = first > 256 ? 170 : 220;
  const gapX = 36;
  const pad = 48;
  const top = 140;
  const H = Math.max(720, top + first * (rowH * 2 + 14) + pad);
  const W = pad * 2 + rounds * colW + (rounds - 1) * gapX + colW;
  return { W, H, colW, rowH, gapX, top, pad };
}

/** The full bracket: every round as a column, winners bright and losers dimmed, the champion at the end. */
export function drawBracket(g: CanvasRenderingContext2D, d: BracketDrawing, pics: Pictures, f: Fonts, geo = bracketGeometry(d.entrants.length)): Resolved {
  const res = resolveBracket(d.entrants, d.picks);
  const { W, H, colW, rowH, gapX, top, pad } = geo;
  const ink = d.light ? "#1d1a2e" : COLORS.text;
  const mutedInk = d.light ? "#615d78" : COLORS.muted;
  const panel = d.light ? "rgba(20,16,40,0.05)" : COLORS.panel;
  const line = d.light ? "rgba(20,16,40,0.18)" : "rgba(255,255,255,0.16)";
  if (d.transparent) g.clearRect(0, 0, W, H);
  else if (d.light) {
    g.fillStyle = "#f6f4fc";
    g.fillRect(0, 0, W, H);
  } else background(g, W, H);
  g.fillStyle = ink;
  g.font = `700 44px ${f.display}`;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillText(ellipsis(g, d.title, W - pad * 2), pad, pad + 40);
  const first = res.rounds[0]?.length ?? 1;
  const slotH = (H - top - pad) / first;
  const centers: number[][] = [];
  res.rounds.forEach((round, r) => {
    const x = pad + r * (colW + gapX);
    g.fillStyle = mutedInk;
    g.font = `600 18px ${f.body}`;
    g.fillText(d.labels(r, res.rounds.length), x, top - 22);
    const span = slotH * 2 ** r;
    centers[r] = [];
    round.forEach((m, i) => {
      const cy = top + span * i + span / 2;
      centers[r].push(cy);
      const boxH = rowH * 2 + 2;
      const y = cy - boxH / 2;
      // Connector from the two matches that fed this one.
      if (r > 0) {
        const px = x - gapX;
        const a = centers[r - 1][i * 2], b = centers[r - 1][i * 2 + 1];
        g.strokeStyle = line;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px, a);
        g.lineTo(px + gapX / 2, a);
        g.lineTo(px + gapX / 2, b);
        g.lineTo(px, b);
        g.moveTo(px + gapX / 2, cy);
        g.lineTo(x, cy);
        g.stroke();
      }
      if (m.bye && r === 0) {
        g.globalAlpha = 0.6;
      }
      roundRect(g, x, y, colW, boxH, 10);
      g.fillStyle = panel;
      g.fill();
      g.globalAlpha = 1;
      [m.a, m.b].forEach((k, side) => {
        const yy = y + side * (rowH + 2);
        const mon = k ? d.byKey.get(k) : null;
        const won = !!m.winner && m.winner === k;
        const lost = !!m.winner && !!k && m.winner !== k;
        g.globalAlpha = lost ? 0.38 : 1;
        if (won && !m.bye) {
          roundRect(g, x, yy, colW, rowH, 10);
          g.fillStyle = d.light ? "rgba(241,65,124,0.12)" : "rgba(241,65,124,0.16)";
          g.fill();
        }
        if (mon) {
          drawMon(g, pics, mon, x + 4, yy + 2, rowH - 4, rowH - 4, 0);
          g.fillStyle = ink;
          g.font = `${won ? 700 : 500} ${Math.round(rowH * 0.42)}px ${f.body}`;
          g.textBaseline = "middle";
          g.fillText(ellipsis(g, mon.n, colW - rowH - 12), x + rowH + 4, yy + rowH / 2);
          g.textBaseline = "alphabetic";
        }
        g.globalAlpha = 1;
      });
    });
  });
  // The champion, after the final.
  const last = res.rounds.length;
  const cx = pad + last * (colW + gapX);
  const fc = centers[last - 1]?.[0] ?? H / 2;
  const champ = res.champion ? d.byKey.get(res.champion) : null;
  g.strokeStyle = line;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx - gapX, fc);
  g.lineTo(cx, fc);
  g.stroke();
  roundRect(g, cx, fc - colW / 2, colW, colW, 24);
  const grad = g.createRadialGradient(cx + colW / 2, fc, 0, cx + colW / 2, fc, colW * 0.7);
  grad.addColorStop(0, "rgba(246,201,74,0.35)");
  grad.addColorStop(1, "rgba(246,201,74,0.04)");
  g.fillStyle = grad;
  g.fill();
  if (champ) {
    drawMon(g, pics, champ, cx + 16, fc - colW / 2 + 16, colW - 32, colW - 70);
    g.fillStyle = ink;
    g.textAlign = "center";
    g.font = `700 ${fitText(g, champ.n, colW - 20, 24, 700, f.display)}px ${f.display}`;
    g.fillText(ellipsis(g, champ.n, colW - 20), cx + colW / 2, fc + colW / 2 - 20);
    g.textAlign = "left";
  }
  return res;
}

export interface ChampionDrawing {
  title: string;
  label: string;
  champion: Mon;
  runnerUp?: Mon | null;
  runnerLabel: string;
}

/** The champion card: the winner big, with a gold glow. */
export function drawChampion(g: CanvasRenderingContext2D, W: number, H: number, d: ChampionDrawing, pics: Pictures, f: Fonts, t = 1) {
  const scale = Math.min(W, H) / 1080;
  background(g, W, H);
  const cx = W / 2, cy = H * 0.48;
  const R = Math.min(W, H) * 0.42;
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.3);
  glow.addColorStop(0, `rgba(246,201,74,${0.42 * t})`);
  glow.addColorStop(1, "rgba(246,201,74,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.fillStyle = COLORS.gold;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = `700 ${Math.round(34 * scale)}px ${f.display}`;
  g.fillText(d.label.toUpperCase(), cx, H * 0.12);
  g.fillStyle = COLORS.muted;
  g.font = `500 ${Math.round(26 * scale)}px ${f.body}`;
  g.fillText(ellipsis(g, d.title, W - 80 * scale), cx, H * 0.12 + 44 * scale);
  const s = 0.7 + 0.3 * easeOutBack(Math.min(1, t));
  g.save();
  g.globalAlpha = Math.min(1, t * 1.6);
  g.translate(cx, cy);
  g.scale(s, s);
  drawMon(g, pics, d.champion, -R, -R, R * 2, R * 2, 0.02);
  g.restore();
  g.fillStyle = COLORS.text;
  const fs = fitText(g, d.champion.n, W - 120 * scale, Math.round(76 * scale), 700, f.display, 20);
  g.font = `700 ${fs}px ${f.display}`;
  g.fillText(d.champion.n, cx, cy + R + fs * 0.6);
  if (d.runnerUp) {
    g.fillStyle = COLORS.muted;
    g.font = `500 ${Math.round(26 * scale)}px ${f.body}`;
    g.fillText(`${d.runnerLabel}: ${d.runnerUp.n}`, cx, cy + R + fs * 0.6 + 52 * scale);
  }
}

export { finishingOrder, roundLabel };

export function canvasBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((r) => c.toBlob((b) => r(b), "image/png"));
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function fileSlug(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "pokemon";
}

/** The page's own fonts (next/font's families), for the canvas. */
export function pageFonts(): Fonts {
  const cs = getComputedStyle(document.documentElement);
  const display = cs.getPropertyValue("--font-display").trim() || "system-ui";
  const body = cs.getPropertyValue("--font-body").trim() || "system-ui";
  return { display: `${display}, ${body}, system-ui, sans-serif`, body: `${body}, system-ui, sans-serif` };
}
