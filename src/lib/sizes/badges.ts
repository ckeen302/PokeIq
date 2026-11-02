import { TYPE_COLORS } from "@/lib/pokemon/type-colors";
import { formatFeet, type SizeKind } from "./types";
import { typePath } from "./type-icons";

/**
 * The game-style badges over each figure on /pokedex/sizes (and in the
 * videos): a small "#0250" tag, a big outlined name banner, a square
 * height box ("3.8 / meter height", feet underneath, "+" for a Gigantamax
 * minimum, "(Length)" for the long ones) and the types as round icons with
 * their names. Drawn on a 2D canvas so the live page and the exported
 * video share them exactly. Layout is pure (unit-tested); drawing needs a
 * canvas.
 */

export interface BadgeInfo {
  name: string;
  /** National Dex number (0: a real-world reference, no tag). */
  dex: number;
  kind: SizeKind;
  m: number;
  length: boolean;
  min: boolean;
  types: string[];
}

/** The number in the height box: "3.8", "0.1", "14.5", "100", "1.71". */
export function badgeNumber(m: number, min: boolean): string {
  const s = m >= 100 ? String(Math.round(m)) : m < 10 ? (Math.round(m * 100) / 100).toString() : (Math.round(m * 10) / 10).toString();
  return `${s}${min ? "+" : ""}`;
}

/** "HO OH", "MR. MIME", "GIGANTAMAX CHARIZARD" (game style: no hyphens, upper case). */
export function badgeName(name: string): string {
  return name.replace(/-/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

export const dexTag = (dex: number) => `#${String(dex).padStart(4, "0")}`;

/** Badge geometry at scale s (the name banner's height in px). */
export function badgeSize(info: BadgeInfo, s: number, measure: (text: string, px: number) => number): { w: number; h: number; banner: number } {
  const nameW = measure(badgeName(info.name), s * 0.74) + s * 0.9;
  const typesW = info.types.length * s * 1.12;
  const lowerW = s * 1.62 + (info.types.length ? s * 0.22 + typesW : 0);
  const banner = Math.max(nameW, lowerW, s * 2.6);
  const h = (info.dex ? s * 0.5 : 0) + s + s * 0.16 + s * 1.62;
  return { w: banner, h, banner };
}

export interface Placement { key: string; x: number; y: number; s: number; alpha: number; w: number; h: number }

/**
 * Where badges go this frame: biggest figures first, each centred over its
 * figure's top (kept inside the frame, pinned under the top edge when the
 * figure is taller than the view), skipping any that would overlap a badge
 * already placed. Scale follows the figure's size on screen.
 */
export function layoutBadges(
  cands: { key: string; x: number; y: number; sh: number; info: BadgeInfo; focus: boolean }[],
  frame: { w: number; h: number; top: number; bottom: number },
  measure: (text: string, px: number) => number,
  opts: { max: number; minSh: number; scale: number }
): Placement[] {
  const placed: Placement[] = [];
  const sorted = [...cands].sort((a, b) => Number(b.focus) - Number(a.focus) || b.sh - a.sh);
  const unit = Math.min(frame.w, frame.h * 1.25);
  const scaleOf = (sh: number) => Math.max(unit * 0.032, Math.min(unit * 0.082, sh * 0.13)) * opts.scale;
  const focus = sorted.find((c) => c.focus);
  // The framed figure's badge leads; the others stay smaller than it, however close they stand.
  const lead = focus ? scaleOf(focus.sh) * 1.12 : Infinity;
  for (const c of sorted) {
    if (placed.length >= opts.max || (c.sh < opts.minSh && !c.focus)) continue;
    const s = c.focus ? lead : Math.min(scaleOf(c.sh), lead * 0.74);
    const { w, h } = badgeSize(c.info, s, measure);
    const gap = s * 0.35;
    let x = c.x - w / 2;
    let y = c.y - gap - h;
    const margin = s * 0.3;
    x = Math.max(margin, Math.min(frame.w - margin - w, x));
    y = Math.max(frame.top + margin, Math.min(frame.h - frame.bottom - h - margin, y));
    // Fade in as the figure grows on screen.
    const alpha = c.focus ? 1 : Math.max(0, Math.min(1, (c.sh - opts.minSh) / (opts.minSh * 0.6)));
    const box = { x, y, w, h };
    const clash = placed.some((p) => {
      const ox = Math.max(0, Math.min(p.x + p.w, box.x + box.w) - Math.max(p.x, box.x));
      const oy = Math.max(0, Math.min(p.y + p.h, box.y + box.h) - Math.max(p.y, box.y));
      return ox * oy > 0.08 * Math.min(p.w * p.h, box.w * box.h);
    });
    if (clash) continue;
    placed.push({ key: c.key, x, y, s, alpha, w, h });
  }
  return placed;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Outlined game text: a thick dark outline, a fattening stroke in the fill, then the fill. */
function gameText(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, font: string, fill: string | CanvasGradient, outline: string, ow: number) {
  g.font = `800 ${px}px ${font}`;
  g.lineJoin = "round";
  g.miterLimit = 2;
  g.strokeStyle = outline;
  g.lineWidth = ow;
  g.strokeText(text, x, y);
  g.strokeStyle = fill;
  g.lineWidth = Math.max(1, px * 0.05);
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

/** Draws one badge with its top-left at (x, y). */
export function drawBadge(g: CanvasRenderingContext2D, info: BadgeInfo, p: { x: number; y: number; s: number; alpha: number; w: number }, font: string) {
  const { s } = p;
  let { y } = p;
  const x = p.x;
  g.save();
  g.globalAlpha = p.alpha;
  g.textBaseline = "middle";
  g.textAlign = "center";
  const ink = "#101a2c";
  const shadow = (blur: number) => { g.shadowColor = "rgba(0,0,0,0.35)"; g.shadowBlur = blur; g.shadowOffsetY = blur * 0.25; };
  const noShadow = () => { g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0; };
  // #0250 tag (and "(Length)").
  if (info.dex) {
    const th = s * 0.5;
    const tag = dexTag(info.dex);
    g.font = `800 ${th * 0.72}px ${font}`;
    const tw = g.measureText(tag).width + th * 0.7;
    const gradT = g.createLinearGradient(0, y, 0, y + th);
    gradT.addColorStop(0, "#ff5a3c");
    gradT.addColorStop(1, "#c42515");
    shadow(s * 0.12);
    roundRect(g, x + s * 0.1, y, tw, th, th * 0.22);
    g.fillStyle = gradT;
    g.fill();
    noShadow();
    g.lineWidth = Math.max(1, s * 0.035);
    g.strokeStyle = "#ffd9cf";
    g.stroke();
    gameText(g, tag, x + s * 0.1 + tw / 2, y + th * 0.53, th * 0.72, font, "#ffffff", ink, th * 0.16);
    if (info.length) {
      const lt = "(LENGTH)";
      g.font = `800 ${th * 0.6}px ${font}`;
      const lw = g.measureText(lt).width + th * 0.6;
      roundRect(g, x + s * 0.2 + tw, y, lw, th, th * 0.22);
      g.fillStyle = "rgba(16,26,44,0.82)";
      g.fill();
      gameText(g, lt, x + s * 0.2 + tw + lw / 2, y + th * 0.53, th * 0.6, font, "#ffe066", ink, th * 0.12);
    }
    y += th * 0.92;
  }
  // Name banner.
  const bw = p.w, bh = s;
  shadow(s * 0.22);
  roundRect(g, x, y, bw, bh, s * 0.2);
  const gradB = g.createLinearGradient(0, y, 0, y + bh);
  const ref = !info.dex;
  gradB.addColorStop(0, ref ? "#7d8a99" : "#5cc6ff");
  gradB.addColorStop(0.5, ref ? "#5b6776" : "#2b9be8");
  gradB.addColorStop(1, ref ? "#46505c" : "#1b6fc0");
  g.fillStyle = gradB;
  g.fill();
  noShadow();
  g.lineWidth = Math.max(1.5, s * 0.075);
  g.strokeStyle = "#e9f7ff";
  g.stroke();
  roundRect(g, x + s * 0.06, y + s * 0.06, bw - s * 0.12, bh * 0.42, s * 0.14);
  g.fillStyle = "rgba(255,255,255,0.16)";
  g.fill();
  const name = badgeName(info.name);
  const gradN = g.createLinearGradient(0, y + bh * 0.18, 0, y + bh * 0.82);
  gradN.addColorStop(0, "#fff27a");
  gradN.addColorStop(0.55, "#ffd21f");
  gradN.addColorStop(1, "#ff9d00");
  // Shrink long names to fit the banner.
  let px = s * 0.74;
  g.font = `800 ${px}px ${font}`;
  const room = bw - s * 0.7;
  const tw0 = g.measureText(name).width;
  if (tw0 > room) px *= room / tw0;
  gameText(g, name, x + bw / 2, y + bh * 0.54, px, font, gradN, ink, px * 0.22);
  y += bh + s * 0.16;
  // Height box.
  const hb = s * 1.62, hw = s * 1.62;
  shadow(s * 0.2);
  roundRect(g, x, y, hw, hb, s * 0.16);
  const gradH = g.createLinearGradient(0, y, 0, y + hb);
  gradH.addColorStop(0, "#3a414b");
  gradH.addColorStop(1, "#171b21");
  g.fillStyle = gradH;
  g.fill();
  noShadow();
  g.lineWidth = Math.max(1.5, s * 0.07);
  g.strokeStyle = "#eef3f7";
  g.stroke();
  const num = badgeNumber(info.m, info.min);
  let npx = s * 0.78;
  g.font = `800 ${npx}px ${font}`;
  const nw = g.measureText(num).width;
  if (nw > hw * 0.86) npx *= (hw * 0.86) / nw;
  gameText(g, num, x + hw / 2, y + hb * 0.36, npx, font, "#ffffff", ink, npx * 0.16);
  const unit = info.length ? "meter length" : "meter height";
  let upx = s * 0.27;
  g.font = `800 ${upx}px ${font}`;
  const uw = g.measureText(unit).width;
  if (uw > hw * 0.9) upx *= (hw * 0.9) / uw;
  gameText(g, unit, x + hw / 2, y + hb * 0.68, upx, font, "#ffd21f", ink, upx * 0.2);
  g.font = `700 ${s * 0.21}px ${font}`;
  g.fillStyle = "#c8d3de";
  g.fillText(`${formatFeet(info.m)}${info.min ? "+" : ""}`, x + hw / 2, y + hb * 0.88);
  // Types.
  info.types.forEach((t, k) => {
    const d = s * 1.0;
    const cx = x + hw + s * 0.22 + k * s * 1.12 + d / 2;
    const cy = y + d / 2 + s * 0.02;
    const col = TYPE_COLORS[t] ?? "#888888";
    shadow(s * 0.18);
    g.beginPath();
    g.arc(cx, cy, d / 2, 0, Math.PI * 2);
    const gradC = g.createRadialGradient(cx - d * 0.18, cy - d * 0.2, d * 0.05, cx, cy, d * 0.55);
    gradC.addColorStop(0, "#ffffff");
    gradC.addColorStop(0.18, col);
    gradC.addColorStop(1, shadeHex(col, -0.38));
    g.fillStyle = gradC;
    g.fill();
    noShadow();
    g.lineWidth = Math.max(1.5, s * 0.07);
    g.strokeStyle = "#ffffff";
    g.stroke();
    const path = typePath(t);
    if (path) {
      g.save();
      const k2 = (d * 0.6) / 24;
      g.translate(cx - 12 * k2, cy - 12 * k2);
      g.scale(k2, k2);
      g.fillStyle = "#ffffff";
      g.shadowColor = "rgba(0,0,0,0.35)";
      g.shadowBlur = 2;
      g.fill(path, "evenodd");
      g.restore();
    }
    const label = t.toUpperCase();
    let lpx = s * 0.3;
    g.font = `800 ${lpx}px ${font}`;
    const lw = g.measureText(label).width;
    if (lw > s * 1.08) lpx *= (s * 1.08) / lw;
    gameText(g, label, cx, y + d + s * 0.34, lpx, font, shadeHex(col, 0.25), ink, lpx * 0.24);
  });
  g.restore();
}

/** Lighten (k > 0) or darken (k < 0) a hex colour. */
export function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  if (k >= 0) { r += (255 - r) * k; gg += (255 - gg) * k; b += (255 - b) * k; } else { r *= 1 + k; gg *= 1 + k; b *= 1 + k; }
  return `#${[r, gg, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}
