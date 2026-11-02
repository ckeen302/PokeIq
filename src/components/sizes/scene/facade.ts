import * as THREE from "three";
import { rng } from "./geo";

/**
 * The Haussmann facade atlas, drawn on canvases at load time: two upper
 * bays (five storeys of tall French windows with stone surrounds,
 * pediments, balconettes and string courses), six ground-floor shopfronts
 * and a mansard dormer. Drawn three times in step: colour, a height field
 * (turned into the normal map) and roughness / metalness / occlusion.
 * Original artwork; nothing is traced.
 *
 * Atlas (1024 × 1024 at scale 1):
 *   x 0–512, y 0–1024       upper bays A and B (3.6 m × 16.1 m each)
 *   x 512–1024, y 0–864     shopfronts, 2 × 3 (3.6 m × 4.4 m each)
 *   x 512–640, y 864–992    dormer front (1.8 m × 1.8 m)
 */

export const BAY_M = 3.6;
export const GROUND_M = 4.4;
/** Floor heights above the ground floor, bottom to top, then the frieze under the cornice. */
export const FLOORS_M = [3.3, 3.1, 3.0, 3.0, 2.9];
export const FRIEZE_M = 0.8;
export const UPPER_M = FLOORS_M.reduce((a, b) => a + b, 0) + FRIEZE_M;
/** Floors (0 = first floor above the shops) that carry a continuous balcony. */
export const BALCONY_FLOORS = [0, 4];

export const ATLAS = {
  upper: (bay: 0 | 1) => ({ u0: bay * 0.25, u1: bay * 0.25 + 0.25, v0: 0, v1: 1 }),
  shop: (i: number) => {
    const col = i % 2, row = Math.floor(i / 2) % 3;
    return { u0: 0.5 + col * 0.25, u1: 0.75 + col * 0.25, v0: 1 - ((row + 1) * 288) / 1024, v1: 1 - (row * 288) / 1024 };
  },
  dormer: { u0: 0.5, u1: 0.625, v0: 1 - 992 / 1024, v1: 1 - 864 / 1024 },
  SHOPS: 6,
};

interface Ctxs { col: CanvasRenderingContext2D; hgt: CanvasRenderingContext2D; orm: CanvasRenderingContext2D }

/** Paint a rect on all three maps: colour, height (0..1), roughness, metalness, occlusion. */
function paint(c: Ctxs, x: number, y: number, w: number, h: number, color: string, height: number, rough = 0.85, metal = 0, ao = 1) {
  c.col.fillStyle = color;
  c.col.fillRect(x, y, w, h);
  const hv = Math.round(Math.max(0, Math.min(1, height)) * 255);
  c.hgt.fillStyle = `rgb(${hv},${hv},${hv})`;
  c.hgt.fillRect(x, y, w, h);
  c.orm.fillStyle = `rgb(${Math.round(ao * 255)},${Math.round(rough * 255)},${Math.round(metal * 255)})`;
  c.orm.fillRect(x, y, w, h);
}

/** Darken (occlusion) a band: shadows under ledges and inside reveals. */
function shade(c: Ctxs, x: number, y: number, w: number, h: number, k: number, vertical: "down" | "up" | "left" | "right" = "down") {
  const g = vertical === "down" ? c.col.createLinearGradient(0, y, 0, y + h) : vertical === "up" ? c.col.createLinearGradient(0, y + h, 0, y) : vertical === "right" ? c.col.createLinearGradient(x, 0, x + w, 0) : c.col.createLinearGradient(x + w, 0, x, 0);
  g.addColorStop(0, `rgba(30,22,14,${k})`);
  g.addColorStop(1, "rgba(30,22,14,0)");
  c.col.fillStyle = g;
  c.col.fillRect(x, y, w, h);
}

function stoneCourses(c: Ctxs, x: number, y: number, w: number, h: number, pxPerM: number, seed: number, rusticated = false) {
  const r = rng(seed);
  const course = (rusticated ? 0.55 : 0.48) * pxPerM;
  let row = 0;
  for (let yy = y; yy < y + h; yy += course, row++) {
    // Block-to-block tone variation.
    const blockW = (rusticated ? 1.6 : 1.25) * pxPerM;
    const off = row % 2 ? blockW / 2 : 0;
    for (let xx = x - off; xx < x + w; xx += blockW) {
      const t = 0.94 + r() * 0.08;
      c.col.fillStyle = `rgba(${Math.round(236 * t)},${Math.round(226 * t)},${Math.round(204 * t)},0.55)`;
      const bx = Math.max(x, xx), bw = Math.min(x + w, xx + blockW) - bx;
      if (bw > 0) c.col.fillRect(bx, yy, bw, Math.min(course, y + h - yy));
      if (!rusticated && xx > x && xx < x + w) {
        c.col.fillStyle = "rgba(120,104,80,0.35)";
        c.col.fillRect(xx, yy, 1, Math.min(course, y + h - yy));
        c.hgt.fillStyle = "rgb(112,112,112)";
        c.hgt.fillRect(xx, yy, 1, Math.min(course, y + h - yy));
      }
    }
    if (yy > y) {
      const jh = rusticated ? 5 : 1.5;
      c.col.fillStyle = rusticated ? "rgba(70,58,42,0.55)" : "rgba(120,104,80,0.45)";
      c.col.fillRect(x, yy - jh / 2, w, jh);
      c.hgt.fillStyle = rusticated ? "rgb(40,40,40)" : "rgb(100,100,100)";
      c.hgt.fillRect(x, yy - jh / 2, w, jh);
      if (rusticated) shade(c, x, yy + jh / 2, w, 4, 0.25);
    }
  }
}

/** A French window: stone surround, recessed glass in white frames with small panes, optional curtains. */
function frenchWindow(c: Ctxs, cx: number, top: number, ww: number, wh: number, pxPerM: number, opts: { pediment?: "tri" | "seg" | "cornice" | "key" | null; balconette?: boolean; curtain?: number; open?: boolean }) {
  const sur = 0.2 * pxPerM;
  const x = cx - ww / 2;
  // Surround (raised, lighter).
  paint(c, x - sur, top - sur, ww + sur * 2, wh + sur * 1.2, "#f1e8d3", 0.72, 0.8);
  shade(c, x - sur, top + wh, ww + sur * 2, sur * 0.6, 0.18);
  // Reveal: deep shadow inside the opening, darker at the top and left (sun from upper left).
  paint(c, x, top, ww, wh, "#2a2e33", 0.12, 0.5, 0, 0.55);
  // Glass.
  const inset = 0.07 * pxPerM;
  const gx = x + inset, gy = top + inset, gw = ww - inset * 2, gh = wh - inset;
  const sky = c.col.createLinearGradient(0, gy, 0, gy + gh);
  sky.addColorStop(0, "#5d7a95");
  sky.addColorStop(0.45, "#33495c");
  sky.addColorStop(1, "#1d2731");
  c.col.fillStyle = sky;
  c.col.fillRect(gx, gy, gw, gh);
  c.hgt.fillStyle = "rgb(20,20,20)";
  c.hgt.fillRect(gx, gy, gw, gh);
  c.orm.fillStyle = "rgb(230,22,110)";
  c.orm.fillRect(gx, gy, gw, gh);
  // Curtains behind the glass.
  if (opts.curtain) {
    c.col.fillStyle = `rgba(236,230,214,${opts.curtain})`;
    c.col.fillRect(gx, gy + gh * 0.04, gw * 0.3, gh * 0.93);
    c.col.fillRect(gx + gw * 0.7, gy + gh * 0.04, gw * 0.3, gh * 0.93);
    c.orm.fillStyle = "rgb(230,170,20)";
    c.orm.fillRect(gx, gy + gh * 0.04, gw * 0.3, gh * 0.93);
    c.orm.fillRect(gx + gw * 0.7, gy + gh * 0.04, gw * 0.3, gh * 0.93);
  }
  // Frames: outer frame, centre stile, transoms (petits bois).
  const fr = Math.max(2, 0.06 * pxPerM);
  const frame = (fx: number, fy: number, fw: number, fh: number) => paint(c, fx, fy, fw, fh, "#f4f1ea", 0.32, 0.55);
  frame(gx, gy, gw, fr);
  frame(gx, gy, fr, gh);
  frame(gx + gw - fr, gy, fr, gh);
  frame(cx - fr * 0.7, gy, fr * 1.4, gh);
  const panes = wh > 1.9 * pxPerM ? 4 : 3;
  for (let k = 1; k < panes; k++) frame(gx, gy + (gh * k) / panes - fr * 0.3, gw, fr * 0.6);
  shade(c, gx, gy, gw, gh * 0.25, 0.35);
  shade(c, gx, gy, gw * 0.18, gh, 0.25, "right");
  // Balconette: black wrought iron across the lower part.
  if (opts.balconette) {
    const bh = 0.95 * pxPerM, by = top + wh - bh;
    paint(c, x - sur * 0.4, by, ww + sur * 0.8, fr * 0.9, "#1b1d1f", 0.6, 0.45, 0.6);
    paint(c, x - sur * 0.4, top + wh - fr, ww + sur * 0.8, fr, "#1b1d1f", 0.6, 0.45, 0.6);
    const n = 9;
    for (let k = 0; k <= n; k++) paint(c, x - sur * 0.3 + ((ww + sur * 0.6) * k) / n, by, Math.max(1.5, fr * 0.35), bh, "#1b1d1f", 0.58, 0.45, 0.6);
    c.col.strokeStyle = "#1b1d1f";
    c.col.lineWidth = Math.max(1.5, fr * 0.35);
    for (let k = 0; k < n; k += 2) {
      const sx = x - sur * 0.3 + ((ww + sur * 0.6) * (k + 1)) / n;
      c.col.beginPath();
      c.col.arc(sx, by + bh * 0.5, bh * 0.16, 0, Math.PI * 2);
      c.col.stroke();
    }
  }
  // Ornament above.
  const ped = opts.pediment;
  if (ped === "tri" || ped === "seg") {
    const pw = ww + sur * 3, ph = 0.55 * pxPerM, py = top - sur - ph * 0.25;
    c.col.fillStyle = "#f3ead6";
    c.hgt.fillStyle = "rgb(205,205,205)";
    for (const ctx of [c.col, c.hgt]) {
      ctx.beginPath();
      if (ped === "tri") {
        ctx.moveTo(cx - pw / 2, py);
        ctx.lineTo(cx, py - ph);
        ctx.lineTo(cx + pw / 2, py);
      } else {
        ctx.moveTo(cx - pw / 2, py);
        ctx.quadraticCurveTo(cx, py - ph * 1.6, cx + pw / 2, py);
      }
      ctx.closePath();
      ctx.fill();
    }
    paint(c, cx - pw / 2, py, pw, sur * 0.7, "#efe5cf", 0.8, 0.8);
    shade(c, cx - pw / 2, py + sur * 0.7, pw, sur, 0.28);
  } else if (ped === "cornice") {
    const pw = ww + sur * 3;
    paint(c, cx - pw / 2, top - sur * 1.9, pw, sur * 0.9, "#f3ead6", 0.82, 0.8);
    shade(c, cx - pw / 2, top - sur, pw, sur * 0.8, 0.3);
  } else if (ped === "key") {
    c.col.fillStyle = "#f3ead6";
    c.col.beginPath();
    c.col.moveTo(cx - sur * 0.8, top - sur);
    c.col.lineTo(cx + sur * 0.8, top - sur);
    c.col.lineTo(cx + sur * 0.55, top + sur * 0.3);
    c.col.lineTo(cx - sur * 0.55, top + sur * 0.3);
    c.col.fill();
  }
  if (opts.open) {
    // A casement opened inwards: the right half shows the dark room.
    paint(c, cx + fr, gy + fr, gw / 2 - fr * 2, gh - fr, "#1a1714", 0.08, 0.9, 0, 0.5);
  }
}

function drawUpperBay(c: Ctxs, ox: number, S: number, variant: 0 | 1) {
  const W = 256 * S, H = 1024 * S;
  const pxPerMx = W / BAY_M, pxPerM = H / UPPER_M;
  paint(c, ox, 0, W, H, "#e9dfc8", 0.5, 0.88);
  stoneCourses(c, ox, 0, W, H, pxPerM, 11 + variant, false);
  const r = rng(101 + variant * 7);
  // Frieze and modillions under the main cornice.
  const fz = FRIEZE_M * pxPerM;
  paint(c, ox, 0, W, fz, "#ece2cc", 0.62, 0.85);
  for (let k = 0; k < 6; k++) paint(c, ox + (k + 0.25) * (W / 6), fz * 0.15, W / 18, fz * 0.55, "#f4ecd9", 0.8, 0.8);
  shade(c, ox, 0, W, fz * 0.6, 0.35);
  // Floors from the top down.
  let y = fz;
  const floorsTopDown = [...FLOORS_M].reverse();
  floorsTopDown.forEach((fh, k) => {
    const floor = FLOORS_M.length - 1 - k; // 0 = first floor
    const hpx = fh * pxPerM;
    // String course at the floor's base.
    const sc = 0.22 * pxPerM;
    paint(c, ox, y + hpx - sc, W, sc, "#efe6d0", 0.68, 0.82);
    shade(c, ox, y + hpx, W, sc * 0.9, 0.22);
    const ww = 1.3 * pxPerMx;
    const wh = [2.35, 2.2, 2.1, 2.0, 1.75][floor] * pxPerM;
    const top = y + hpx - sc - wh - 0.06 * pxPerM;
    const ped = (["tri", "cornice", "key", "key", null] as const)[floor];
    const pedB = (["seg", "cornice", "key", null, null] as const)[floor];
    frenchWindow(c, ox + W / 2, top, ww, wh, pxPerM, {
      pediment: variant ? pedB : ped,
      balconette: floor === 1 || floor === 2 || floor === 3,
      curtain: r() < 0.6 ? 0.55 + r() * 0.35 : 0,
      open: r() < 0.12,
    });
    y += hpx;
  });
  // Pilaster hints at the bay edges.
  shade(c, ox, 0, 3 * S, H, 0.12, "right");
  shade(c, ox + W - 3 * S, 0, 3 * S, H, 0.12, "left");
}

const SHOP_FRAMES = ["#5b1a1e", "#1f3b2c", "#1d2b44", "#3a3a3a", "#6b4a1e", "#2f2a3d"];

function drawShop(c: Ctxs, ox: number, oy: number, S: number, i: number) {
  const W = 256 * S, H = 288 * S;
  const pxPerM = H / GROUND_M, pxX = W / BAY_M;
  paint(c, ox, oy, W, H, "#e3d8bf", 0.5, 0.9);
  stoneCourses(c, ox, oy, W, H, pxPerM, 31 + i, true);
  const frame = SHOP_FRAMES[i % SHOP_FRAMES.length];
  const kind = i % 3; // 0 shopfront, 1 café, 2 carriage door
  const pier = 0.35 * pxX;
  const top = oy + 0.55 * pxPerM;
  if (kind === 2) {
    // Porte-cochère: a tall arched wooden door in a rusticated surround.
    const dw = W - pier * 2.6, dx = ox + pier * 1.3, dy = oy + 0.5 * pxPerM, dh = H - 0.5 * pxPerM;
    c.col.fillStyle = "#e9dfc7";
    c.col.fillRect(dx - 6 * S, dy - 6 * S, dw + 12 * S, dh + 6 * S);
    paint(c, dx, dy + dw * 0.3, dw, dh - dw * 0.3, frame, 0.25, 0.6);
    for (const ctx of [c.col]) {
      ctx.fillStyle = frame;
      ctx.beginPath();
      ctx.ellipse(dx + dw / 2, dy + dw * 0.32, dw / 2, dw * 0.32, 0, Math.PI, 0);
      ctx.fill();
    }
    // Panels and a fanlight.
    paint(c, dx + dw * 0.08, dy + dw * 0.45, dw * 0.38, dh * 0.38, "rgba(0,0,0,0.25)", 0.2, 0.6);
    paint(c, dx + dw * 0.54, dy + dw * 0.45, dw * 0.38, dh * 0.38, "rgba(0,0,0,0.25)", 0.2, 0.6);
    paint(c, dx + dw * 0.08, dy + dh * 0.6, dw * 0.38, dh * 0.3, "rgba(0,0,0,0.22)", 0.2, 0.6);
    paint(c, dx + dw * 0.54, dy + dh * 0.6, dw * 0.38, dh * 0.3, "rgba(0,0,0,0.22)", 0.2, 0.6);
    paint(c, dx + dw / 2 - 1.5 * S, dy + dw * 0.3, 3 * S, dh - dw * 0.3, "#111", 0.15, 0.6);
    shade(c, dx, dy, dw, dh * 0.2, 0.4);
    return;
  }
  // Fascia (sign band, plain: no lettering).
  const fasciaH = 0.55 * pxPerM;
  paint(c, ox + pier * 0.6, top - fasciaH, W - pier * 1.2, fasciaH, frame, 0.62, 0.45);
  paint(c, ox + pier * 0.6, top - fasciaH, W - pier * 1.2, 2 * S, "#c8a24a", 0.7, 0.3, 0.8);
  paint(c, ox + pier * 0.6, top - 3 * S, W - pier * 1.2, 2 * S, "#c8a24a", 0.7, 0.3, 0.8);
  // Shop window and door.
  const gx = ox + pier, gw = W - pier * 2, gh = H - (top - oy) - 0.25 * pxPerM;
  paint(c, gx - 4 * S, top, gw + 8 * S, gh + 4 * S, frame, 0.42, 0.55);
  const glass = c.col.createLinearGradient(0, top, 0, top + gh);
  glass.addColorStop(0, "#6c859a");
  glass.addColorStop(0.5, "#2f3e4b");
  glass.addColorStop(1, "#1e2328");
  c.col.fillStyle = glass;
  c.col.fillRect(gx, top + 4 * S, gw, gh - 4 * S);
  c.hgt.fillStyle = "rgb(30,30,30)";
  c.hgt.fillRect(gx, top + 4 * S, gw, gh - 4 * S);
  c.orm.fillStyle = "rgb(230,25,100)";
  c.orm.fillRect(gx, top + 4 * S, gw, gh - 4 * S);
  // Warm interior glow and displays.
  const r = rng(71 + i);
  for (let k = 0; k < 5; k++) {
    c.col.fillStyle = kind === 1 ? `rgba(255,${190 + Math.round(r() * 40)},120,${0.12 + r() * 0.12})` : `rgba(${200 + Math.round(r() * 55)},${180 + Math.round(r() * 60)},${150 + Math.round(r() * 80)},${0.15 + r() * 0.15})`;
    c.col.fillRect(gx + r() * gw * 0.8, top + gh * (0.45 + r() * 0.35), gw * (0.1 + r() * 0.2), gh * (0.1 + r() * 0.25));
  }
  // Mullions and the door.
  const mull = (mx: number) => paint(c, mx, top, 3 * S, gh, frame, 0.42, 0.55);
  mull(gx + gw * 0.36);
  mull(gx + gw * 0.68);
  paint(c, gx + gw * 0.69, top + gh * 0.02, gw * 0.3, gh * 0.98, kind === 1 ? "#3a1c12" : frame, 0.35, 0.55);
  paint(c, gx + gw * 0.72, top + gh * 0.08, gw * 0.24, gh * 0.55, "#3b4c5a", 0.15, 0.12, 0.4);
  paint(c, gx, top + gh * 0.82, gw * 0.68, 3 * S, frame, 0.42, 0.55);
  shade(c, gx, top + 4 * S, gw, gh * 0.25, 0.4);
}

function drawDormer(c: Ctxs, ox: number, oy: number, S: number) {
  const W = 128 * S, H = 128 * S, pxPerM = W / 1.8;
  paint(c, ox, oy, W, H, "#e6dcc5", 0.55, 0.85);
  frenchWindow(c, ox + W / 2, oy + 0.35 * pxPerM, 0.85 * pxPerM, 1.25 * pxPerM, pxPerM, { pediment: null, curtain: 0.6 });
}

/** Normal map from a height canvas (Sobel), in tangent space for a quad facing out with u → right, v → up. */
function normalFromHeight(h: ImageData, strength: number): ImageData {
  const { width: w, height: hh, data } = h;
  const out = new ImageData(w, hh);
  const at = (x: number, y: number) => data[(Math.min(hh - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
      // Canvas y runs down, texture v up: a height rising downwards tilts the normal up.
      const nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      out.data[i] = Math.round((nx / l * 0.5 + 0.5) * 255);
      out.data[i + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      out.data[i + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
      out.data[i + 3] = 255;
    }
  }
  return out;
}

/** Fine stone grain over the colour map (cheap deterministic noise). */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const r = rng(5);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * 0.9));
  }
  ctx.putImageData(img, 0, 0);
}

export interface FacadeMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  orm: THREE.Texture;
  /** A horizontally tiling facade (two bays, shops to cornice: 7.2 m × 20.5 m) for the city blocks behind the boulevard. */
  mass: { map: THREE.Texture; normalMap: THREE.Texture; orm: THREE.Texture };
  dispose(): void;
}

/** Copies atlas regions into a tiling two-bay facade: upper bays over a shopfront and a carriage door. */
function massCanvas(src: HTMLCanvasElement, S: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = 512 * S;
  cv.height = 1024 * S;
  const g = cv.getContext("2d")!;
  const upperH = Math.round((UPPER_M / (UPPER_M + GROUND_M)) * 1024 * S);
  g.drawImage(src, 0, 0, 256 * S, 1024 * S, 0, 0, 256 * S, upperH);
  g.drawImage(src, 256 * S, 0, 256 * S, 1024 * S, 256 * S, 0, 256 * S, upperH);
  const shop = (i: number, dx: number) => {
    const col = i % 2, row = Math.floor(i / 2);
    g.drawImage(src, (512 + col * 256) * S, row * 288 * S, 256 * S, 288 * S, dx, upperH, 256 * S, 1024 * S - upperH);
  };
  shop(3, 0);
  shop(2, 256 * S);
  return cv;
}

/** Draws the atlas at `scale` (1 → 1024², 2 → 2048² for exports). */
export function facadeAtlas(scale: 1 | 2, anisotropy: number): FacadeMaps {
  const S = scale, N = 1024 * S;
  const mk = () => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = N;
    return cv;
  };
  const colC = mk(), hgtC = mk(), ormC = mk();
  const c: Ctxs = { col: colC.getContext("2d", { willReadFrequently: true })!, hgt: hgtC.getContext("2d", { willReadFrequently: true })!, orm: ormC.getContext("2d")! };
  paint(c, 0, 0, N, N, "#e6dcc5", 0.5, 0.9);
  drawUpperBay(c, 0, S, 0);
  drawUpperBay(c, 256 * S, S, 1);
  for (let i = 0; i < ATLAS.SHOPS; i++) drawShop(c, 512 * S + (i % 2) * 256 * S, Math.floor(i / 2) * 288 * S, S, i);
  drawDormer(c, 512 * S, 864 * S, S);
  grain(c.col, N, N, 9);
  const nrm = normalFromHeight(c.hgt.getImageData(0, 0, N, N), 2.2);
  hgtC.getContext("2d")!.putImageData(nrm, 0, 0);
  const tex = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  const map = tex(colC, true), normalMap = tex(hgtC, false), orm = tex(ormC, false);
  const tile = (t: THREE.Texture) => { t.wrapS = THREE.RepeatWrapping; return t; };
  const mass = { map: tile(tex(massCanvas(colC, S), true)), normalMap: tile(tex(massCanvas(hgtC, S), false)), orm: tile(tex(massCanvas(ormC, S), false)) };
  return { map, normalMap, orm, mass, dispose() { [map, normalMap, orm, mass.map, mass.normalMap, mass.orm].forEach((t) => t.dispose()); } };
}

/** The wrought-iron railing of a continuous balcony: an alpha texture (one bay wide, 1 m tall). */
export function railingTexture(anisotropy: number): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 72;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, 256, 72);
  g.strokeStyle = g.fillStyle = "#151617";
  g.fillRect(0, 0, 256, 7);
  g.fillRect(0, 64, 256, 8);
  g.lineWidth = 3;
  for (let x = 4; x < 256; x += 14) { g.beginPath(); g.moveTo(x, 6); g.lineTo(x, 66); g.stroke(); }
  g.lineWidth = 2.5;
  for (let x = 11; x < 256; x += 28) {
    g.beginPath(); g.arc(x, 24, 7, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(x, 46, 7, 0, Math.PI * 2); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

/** Striped café awning cloth. */
export function awningTexture(): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 64;
  const g = cv.getContext("2d")!;
  const pairs = [["#b3262d", "#f3ece0"], ["#1f5a3a", "#f1ebdc"], ["#1e2f57", "#efe9dc"], ["#8a2a4a", "#f3eadb"]];
  pairs.forEach(([a, b], row) => {
    for (let x = 0; x < 256; x += 16) {
      g.fillStyle = (x / 16) % 2 ? b : a;
      g.fillRect(x, row * 16, 16, 16);
    }
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
