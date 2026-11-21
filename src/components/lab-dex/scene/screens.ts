import * as THREE from "three";
import { TYPE_COLORS } from "@/lib/pokemon/type-colors";
import type { LabMon } from "@/lib/lab-dex/types";

/**
 * What the lab's walls show: research screens drawn into canvases (the
 * specimen index, a biometric scan, a genome strand, a habitat map, the
 * type matrix), the wall's own panels, pod nameplates and the table's
 * caption ring. Drawn once in the site's fonts.
 */

export interface LabFonts {
  display: string;
  pixel: string;
  body: string;
}

const CYAN = "#7ee8ff";
const CYAN_DIM = "rgba(126,232,255,0.35)";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const rnd = (k: number) => {
  const v = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

function frame(g: CanvasRenderingContext2D, w: number, h: number, title: string, fonts: LabFonts, code: string) {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#081a2c");
  bg.addColorStop(1, "#040b16");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // Scanlines and a faint grid.
  g.fillStyle = "rgba(126,232,255,0.035)";
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  g.strokeStyle = "rgba(126,232,255,0.06)";
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y < h; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  // Title bar.
  g.fillStyle = "rgba(126,232,255,0.1)";
  g.fillRect(24, 22, w - 48, 44);
  g.fillStyle = CYAN;
  g.fillRect(24, 22, 6, 44);
  g.font = `700 26px ${fonts.display}`;
  g.textBaseline = "middle";
  g.fillText(title, 44, 45);
  g.font = `400 14px ${fonts.pixel}`;
  g.textAlign = "right";
  g.fillStyle = CYAN_DIM;
  g.fillText(code, w - 36, 45);
  g.textAlign = "left";
  // Corner brackets.
  g.strokeStyle = CYAN;
  g.lineWidth = 3;
  const b = 26;
  for (const [x, y, dx, dy] of [[8, 8, 1, 1], [w - 8, 8, -1, 1], [8, h - 8, 1, -1], [w - 8, h - 8, -1, -1]]) {
    g.beginPath(); g.moveTo(x, y + dy * b); g.lineTo(x, y); g.lineTo(x + dx * b, y); g.stroke();
  }
}

/** The specimen index: the Pokémon round the one on the table, in the wheel's order, types and base stat totals. */
export function drawIndex(c: HTMLCanvasElement, rows: (LabMon | null)[], selected: number, fonts: LabFonts) {
  const W = 1024, H = 576;
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  frame(g, W, H, "SPECIMEN INDEX", fonts, "LIVE FEED");
  rows.slice(0, 12).forEach((e, i) => {
    const y = 92 + i * 38;
    if (i === selected) { g.fillStyle = "rgba(126,232,255,0.16)"; g.fillRect(24, y, W - 48, 36); g.fillStyle = CYAN; g.fillRect(24, y, 6, 36); }
    else if (i % 2 === 0) { g.fillStyle = "rgba(126,232,255,0.05)"; g.fillRect(24, y, W - 48, 36); }
    if (!e) return;
    g.textBaseline = "middle";
    g.font = `400 15px ${fonts.pixel}`;
    g.fillStyle = CYAN_DIM;
    g.fillText(`No.${String(e.species).padStart(4, "0")}`, 40, y + 19);
    g.font = `600 21px ${fonts.display}`;
    g.fillStyle = "#e8fbff";
    g.fillText(e.name.toUpperCase().slice(0, 22), 160, y + 19);
    e.types.forEach((t, k) => { g.fillStyle = TYPE_COLORS[t] ?? "#888"; g.fillRect(480 + k * 74, y + 9, 66, 18); });
    g.fillStyle = "rgba(126,232,255,0.16)";
    g.fillRect(650, y + 13, 250, 10);
    g.fillStyle = CYAN;
    g.fillRect(650, y + 13, Math.min(250, (250 * e.bst) / 780), 10);
    g.font = `600 18px ${fonts.display}`;
    g.fillStyle = "#e8fbff";
    g.textAlign = "right";
    g.fillText(String(e.bst), W - 40, y + 19);
    g.textAlign = "left";
  });
}

/** A biometric scan: waveforms, a radar sweep, readouts. */
function scanScreen(fonts: LabFonts, seed: number) {
  const W = 1024, H = 576;
  const { c, g } = canvas(W, H);
  frame(g, W, H, "BIOMETRIC SCAN", fonts, `CH-${seed}`);
  const lanes = [
    { c: CYAN, f: 0.035, a: 34 },
    { c: "#ff9f5a", f: 0.06, a: 22 },
    { c: "#b48cff", f: 0.02, a: 28 },
  ];
  lanes.forEach((l, k) => {
    const y0 = 140 + k * 120;
    g.strokeStyle = "rgba(126,232,255,0.12)";
    g.beginPath(); g.moveTo(40, y0); g.lineTo(600, y0); g.stroke();
    g.strokeStyle = l.c;
    g.lineWidth = 2.5;
    g.shadowColor = l.c;
    g.shadowBlur = 10;
    g.beginPath();
    for (let x = 40; x <= 600; x += 2) {
      const t = x + seed * 40;
      const spike = Math.exp(-Math.pow(((t % 180) - 90) / 6, 2)) * 1.6;
      const y = y0 - l.a * (Math.sin(t * l.f) * 0.6 + Math.sin(t * l.f * 2.7) * 0.25 + spike * (k === 0 ? 1 : 0.3));
      if (x === 40) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.shadowBlur = 0;
    g.font = `400 13px ${fonts.pixel}`;
    g.fillStyle = CYAN_DIM;
    g.fillText(["PULSE", "THERMAL", "NEURAL"][k], 40, y0 - 48);
  });
  // Radar.
  const cx = 820, cy = 300, R = 160;
  g.strokeStyle = "rgba(126,232,255,0.25)";
  g.lineWidth = 1.5;
  for (let r = 40; r <= R; r += 40) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
  for (let a = 0; a < 6; a++) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a * Math.PI / 3) * R, cy + Math.sin(a * Math.PI / 3) * R); g.stroke(); }
  const sw = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  sw.addColorStop(0, "rgba(126,232,255,0.5)");
  sw.addColorStop(1, "rgba(126,232,255,0)");
  g.fillStyle = sw;
  g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, -0.9, -0.2); g.closePath(); g.fill();
  for (let i = 0; i < 7; i++) {
    const a = rnd(seed * 7 + i) * Math.PI * 2, r = 30 + rnd(seed * 9 + i) * (R - 40);
    g.fillStyle = i === 2 ? "#ff9f5a" : CYAN;
    g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4, 0, Math.PI * 2); g.fill();
  }
  g.font = `700 40px ${fonts.display}`;
  g.fillStyle = "#e8fbff";
  g.fillText("98.6%", 40, 520);
  g.font = `400 13px ${fonts.pixel}`;
  g.fillStyle = CYAN_DIM;
  g.fillText("SYNC STABILITY", 40, 478);
  g.fillText("SAMPLE RATE 2.4 kHz", 260, 520);
  return tex(c);
}

/** A genome strand: a double helix, base pairs, sequence text. */
function genomeScreen(fonts: LabFonts) {
  const W = 1024, H = 576;
  const { c, g } = canvas(W, H);
  frame(g, W, H, "GENOME SEQUENCE", fonts, "SEQ 0006-A");
  const y0 = 300;
  for (let x = 50; x < 974; x += 14) {
    const p = x * 0.022;
    const a = Math.sin(p) * 110, b = Math.sin(p + Math.PI) * 110;
    const front = Math.cos(p) > 0;
    g.strokeStyle = `rgba(126,232,255,${0.12 + 0.2 * Math.abs(Math.cos(p))})`;
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y0 + a); g.lineTo(x, y0 + b); g.stroke();
    g.fillStyle = front ? CYAN : "rgba(126,232,255,0.4)";
    g.beginPath(); g.arc(x, y0 + a, front ? 5 : 3.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = !front ? "#ff9f5a" : "rgba(255,159,90,0.45)";
    g.beginPath(); g.arc(x, y0 + b, !front ? 5 : 3.5, 0, Math.PI * 2); g.fill();
  }
  g.font = `400 13px ${fonts.pixel}`;
  const bases = "ACGT";
  for (let row = 0; row < 3; row++) {
    let s = "";
    for (let i = 0; i < 64; i++) s += bases[Math.floor(rnd(row * 97 + i) * 4)];
    g.fillStyle = row === 1 ? CYAN : CYAN_DIM;
    g.fillText(s.replace(/(.{8})/g, "$1 "), 40, 470 + row * 26);
  }
  return tex(c);
}

/** The type matrix: 18 × 18 cells, coloured by attacking type, brighter where it's super effective. */
function matrixScreen(fonts: LabFonts) {
  const W = 1024, H = 576;
  const { c, g } = canvas(W, H);
  frame(g, W, H, "TYPE MATRIX", fonts, "18 × 18");
  const types = Object.keys(TYPE_COLORS);
  const s = 24, x0 = 300, y0 = 96;
  types.forEach((t, i) => {
    g.fillStyle = TYPE_COLORS[t];
    g.fillRect(x0 - 30, y0 + i * s + 3, 20, s - 6);
    g.fillRect(x0 + i * s + 3, y0 - 30, s - 6, 20);
    for (let j = 0; j < types.length; j++) {
      const v = rnd(i * 31 + j * 7);
      const a = v > 0.82 ? 0.95 : v < 0.12 ? 0.08 : 0.28;
      g.globalAlpha = a;
      g.fillStyle = v > 0.82 ? TYPE_COLORS[t] : CYAN;
      g.fillRect(x0 + j * s + 2, y0 + i * s + 2, s - 4, s - 4);
    }
    g.globalAlpha = 1;
  });
  g.font = `700 34px ${fonts.display}`;
  g.fillStyle = "#e8fbff";
  g.fillText("×2", 60, 200);
  g.fillText("×½", 60, 280);
  g.fillText("×0", 60, 360);
  g.font = `400 13px ${fonts.pixel}`;
  g.fillStyle = CYAN_DIM;
  g.fillText("SUPER EFFECTIVE", 60, 160);
  g.fillText("NOT VERY", 60, 240);
  g.fillText("NO EFFECT", 60, 320);
  return tex(c);
}

/** A habitat map: contour lines and survey pins. */
function mapScreen(fonts: LabFonts) {
  const W = 1024, H = 576;
  const { c, g } = canvas(W, H);
  frame(g, W, H, "HABITAT SURVEY", fonts, "GRID 7-C");
  const blobs = [[300, 300, 160], [620, 250, 120], [760, 400, 90], [470, 430, 70]];
  for (const [bx, by, br] of blobs) {
    for (let k = 1; k <= 6; k++) {
      const r = (br * k) / 6;
      g.strokeStyle = `rgba(126,232,255,${0.08 + 0.06 * k})`;
      g.lineWidth = k === 6 ? 2.5 : 1.2;
      g.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
        const w = 1 + 0.18 * Math.sin(a * 3 + bx) + 0.1 * Math.sin(a * 7 + by);
        const x = bx + Math.cos(a) * r * w * 1.3, y = by + Math.sin(a) * r * w * 0.8;
        if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  const pins: [number, number, string][] = [[280, 290, "#7ac74c"], [640, 230, "#ee8130"], [780, 410, "#6390f0"], [470, 440, "#f7d02c"], [380, 200, "#a33ea1"]];
  for (const [x, y, col] of pins) {
    g.fillStyle = col;
    g.shadowColor = col;
    g.shadowBlur = 16;
    g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.stroke();
  }
  return tex(c);
}

/** The wall's screens: the live specimen index first (its canvas is redrawn as the wheel turns), then the rest. */
export function wallScreens(fonts: LabFonts): { textures: THREE.Texture[]; index: { canvas: HTMLCanvasElement; texture: THREE.Texture } } {
  const c = document.createElement("canvas");
  drawIndex(c, [], -1, fonts);
  const index = { canvas: c, texture: tex(c) };
  return { textures: [index.texture, scanScreen(fonts, 3), genomeScreen(fonts), matrixScreen(fonts), mapScreen(fonts), scanScreen(fonts, 8)], index };
}

/** A console's small monitor: bars and a line graph. */
export function miniScreen(seed: number, fonts: LabFonts): THREE.Texture {
  const W = 256, H = 160;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#06111f";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(126,232,255,0.12)";
  g.fillRect(0, 0, W, 22);
  g.font = `400 10px ${fonts.pixel}`;
  g.fillStyle = CYAN;
  g.fillText(`UNIT ${String(seed).padStart(2, "0")}`, 8, 15);
  for (let i = 0; i < 9; i++) {
    const h = 20 + rnd(seed * 13 + i) * 90;
    g.fillStyle = i === 4 ? "#ff9f5a" : CYAN;
    g.globalAlpha = 0.85;
    g.fillRect(12 + i * 26, H - 12 - h, 16, h);
  }
  g.globalAlpha = 1;
  return tex(c);
}

/** The wall: panels with seams, vents and labels (colour), light slits and status lamps (emissive). */
export function wallPanel(): { map: THREE.Texture; emissive: THREE.Texture } {
  const W = 512, H = 1024;
  const a = canvas(W, H), e = canvas(W, H);
  const g = a.g, k = e.g;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#151b26");
  grad.addColorStop(0.5, "#1b2230");
  grad.addColorStop(1, "#10151e");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  k.fillStyle = "#000";
  k.fillRect(0, 0, W, H);
  // Seams (8 m tall: 128 px a metre).
  const seam = (y: number) => { g.fillStyle = "#07090d"; g.fillRect(0, y, W, 4); g.fillStyle = "rgba(255,255,255,0.05)"; g.fillRect(0, y + 4, W, 1); };
  for (const y of [H - 0.6 * 128, H - 2.2 * 128, H - 5.4 * 128, H - 6.9 * 128]) seam(y);
  g.fillStyle = "#07090d";
  g.fillRect(0, 0, 4, H);
  g.fillRect(W - 4, 0, 4, H);
  // Vents low on the wall.
  for (let y = H - 2.0 * 128; y < H - 0.8 * 128; y += 10) { g.fillStyle = "#0a0d13"; g.fillRect(60, y, 392, 5); }
  // Light slits at the panel's edges, status lamps.
  const slit = k.createLinearGradient(0, H - 5.4 * 128, 0, H - 2.2 * 128);
  slit.addColorStop(0, "rgba(90,200,255,0)");
  slit.addColorStop(0.5, "rgba(90,200,255,0.9)");
  slit.addColorStop(1, "rgba(90,200,255,0)");
  k.fillStyle = slit;
  k.fillRect(10, H - 5.4 * 128, 5, 3.2 * 128);
  k.fillRect(W - 15, H - 5.4 * 128, 5, 3.2 * 128);
  k.fillStyle = "rgba(90,200,255,0.75)";
  k.fillRect(0, H - 0.62 * 128, W, 3);
  k.fillRect(0, H - 6.93 * 128, W, 2);
  for (let i = 0; i < 4; i++) { k.fillStyle = i === 1 ? "#ffb347" : "#58ffa0"; k.fillRect(40 + i * 16, H - 2.45 * 128, 8, 8); }
  const map = tex(a.c), emissive = tex(e.c);
  for (const t of [map, emissive]) { t.wrapS = THREE.RepeatWrapping; t.repeat.set(24, 1); }
  return { map, emissive };
}

/** A pod's nameplate: dex number, name, a stripe in each type's colour (drawn into `c`; `t` is its texture when redrawing). */
export function nameplate(c: HTMLCanvasElement, e: LabMon | null, fonts: LabFonts, on: boolean, t?: THREE.Texture): THREE.Texture {
  const W = 512, H = 128;
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  if (e) {
    g.fillStyle = on ? "rgba(14,30,48,0.96)" : "rgba(8,16,28,0.92)";
    g.fillRect(0, 0, W, H);
    g.strokeStyle = on ? "#ffffff" : CYAN_DIM;
    g.lineWidth = 3;
    g.strokeRect(2, 2, W - 4, H - 4);
    e.types.forEach((ty, i) => { g.fillStyle = TYPE_COLORS[ty] ?? "#888"; g.fillRect(0, (i * H) / e.types.length, 14, H / e.types.length); });
    g.font = `400 20px ${fonts.pixel}`;
    g.fillStyle = CYAN;
    g.textBaseline = "middle";
    g.fillText(`No.${String(e.species).padStart(4, "0")}`, 36, 38);
    let size = 46;
    const name = e.name.toUpperCase();
    g.font = `700 ${size}px ${fonts.display}`;
    while (size > 22 && g.measureText(name).width > W - 56) { size -= 2; g.font = `700 ${size}px ${fonts.display}`; }
    g.fillStyle = "#f2fbff";
    g.fillText(name, 36, 88);
  }
  if (t) { t.needsUpdate = true; return t; }
  return tex(c);
}

/** The caption that turns round the holo-table's rim (drawn into `c`; `t` is its texture when redrawing). */
export function captionBand(c: HTMLCanvasElement, e: LabMon | null, fonts: LabFonts, t?: THREE.Texture): THREE.Texture {
  const H = 96;
  const g0 = c.getContext("2d")!;
  const font = `400 34px ${fonts.pixel}`;
  g0.font = font;
  const text = e
    ? `No.${String(e.species).padStart(4, "0")}  ·  ${e.name.toUpperCase()}  ·  ${e.types.map((ty) => ty.toUpperCase()).join(" / ")}  ·  ${e.genus.toUpperCase()}  ·  BST ${e.bst}  ·  `
    : "PROFESSOR'S LAB  ·  SPECIMEN PROJECTOR  ·  ";
  const w = g0.measureText(text).width;
  // A whole number of repeats round the ring, so the seam doesn't show (a fixed width, so the texture's size never changes).
  const W = 4096;
  const n = Math.max(1, Math.round(W / w));
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  g.font = font;
  g.textBaseline = "middle";
  g.fillStyle = "#ffffff";
  g.save();
  g.scale(W / (w * n), 1);
  for (let k = 0; k < n; k++) g.fillText(text, k * w, H / 2);
  g.restore();
  if (t) { t.needsUpdate = true; return t; }
  const nt = tex(c);
  nt.wrapS = THREE.RepeatWrapping;
  return nt;
}

/** A radial stripe texture (liquid in the specimen tubes: bright at the bottom). */
export function liquidGradient(): THREE.Texture {
  const { c, g } = canvas(4, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.08, "#b0b0b0");
  grad.addColorStop(0.6, "#7a7a7a");
  grad.addColorStop(1, "#e6e6e6");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return tex(c);
}

