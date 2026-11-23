import * as THREE from "three";
import { rng } from "../geo";

/**
 * Nimbasa's facades and signs, drawn on canvases at load time (original
 * artwork, no text anywhere): modern buildings of pale panels and glass with
 * windows lit warm, cool or dark, ground floors of bright glass shopfronts
 * under glowing sign bands and marquee bulbs, and a sheet of neon signs
 * (bolts, stars, notes, hearts, a little wheel and a coaster's wave) for the
 * rooftops and the blade signs over the promenade. Each atlas comes as a
 * colour map and a light map (what glows at night).
 *
 * Facade atlas (1024 × 1024 at scale 1):
 *   x 0–512      four upper columns, 128 px (3.6 m) wide, each eight floors (3.4 m) from the bottom up
 *   x 512–1024   eight shopfronts, 128 × 156 px (3.6 × 4.4 m), in two rows from the top
 *   x 512–1024, y 320–1024   a tower's window grid (tiles 128 × 128 px: 3.6 × 3.6 m)
 */

export const BAY_M = 3.6;
export const GROUND_M = 4.4;
export const FLOOR_M = 3.4;
export const MAX_FLOORS = 8;
const PX = 128 / BAY_M;

export const ATLAS = {
  /** Upper column `i` (0–3), `floors` from the bottom; flipped left to right when `flip`. */
  upper(i: number, floors: number, flip = false) {
    const u0 = (i % 4) * 0.125, u1 = u0 + 0.125;
    return { u0: flip ? u1 : u0, u1: flip ? u0 : u1, v0: 0, v1: (floors * FLOOR_M * PX) / 1024 };
  },
  shop(i: number) {
    const col = i % 4, row = Math.floor(i / 4) % 2;
    return { u0: 0.5 + col * 0.125, u1: 0.625 + col * 0.125, v0: 1 - ((row + 1) * 156) / 1024, v1: 1 - (row * 156) / 1024 };
  },
  SHOPS: 8,
  COLUMNS: 4,
  /** A tower's window tile (repeat it by world metres / 3.6 within this region). */
  tower: { u0: 0.5, u1: 1, v0: 0, v1: 704 / 1024 },
};

export const NEON = ["#ff3f9e", "#2fd9ff", "#ffd23a", "#9b6bff", "#ff7a2f", "#3dffa0"];

interface Pen { col: CanvasRenderingContext2D; emi: CanvasRenderingContext2D }

function rect(p: Pen, x: number, y: number, w: number, h: number, col: string, glow: string | null = null) {
  p.col.fillStyle = col;
  p.col.fillRect(x, y, w, h);
  p.emi.fillStyle = glow ?? "#000";
  p.emi.fillRect(x, y, w, h);
}

/** A window: glass with a lit room (warm, cool or a colour), or dark; a frame round it. */
function windowPane(p: Pen, x: number, y: number, w: number, h: number, r: () => number, frame = "#d9dce6") {
  rect(p, x - 2, y - 2, w + 4, h + 4, frame);
  const k = r();
  const lit = k < 0.36 ? "#ffcf86" : k < 0.46 ? "#bfe2ff" : k < 0.5 ? NEON[Math.floor(r() * NEON.length)] : null;
  if (lit) {
    const dim = 0.55 + r() * 0.45;
    p.col.fillStyle = lit;
    p.col.fillRect(x, y, w, h);
    p.emi.globalAlpha = dim;
    p.emi.fillStyle = lit;
    p.emi.fillRect(x, y, w, h);
    p.emi.globalAlpha = 1;
    // A curtain or a lamp: a little variety inside.
    if (r() < 0.5) {
      p.col.fillStyle = "rgba(60,40,30,0.35)";
      const cw = w * (0.2 + r() * 0.3);
      p.col.fillRect(r() < 0.5 ? x : x + w - cw, y, cw, h);
      p.emi.fillStyle = "rgba(0,0,0,0.5)";
      p.emi.fillRect(r() < 0.5 ? x : x + w - cw, y, cw, h);
    }
  } else {
    const g = p.col.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#2a3150");
    g.addColorStop(1, "#151a2e");
    p.col.fillStyle = g;
    p.col.fillRect(x, y, w, h);
    p.emi.fillStyle = "#000";
    p.emi.fillRect(x, y, w, h);
  }
}

/** One floor of an upper column (y is the floor's top). */
function upperFloor(p: Pen, ox: number, y: number, variant: number, r: () => number) {
  const W = 128, H = Math.round(FLOOR_M * PX);
  // Pale wall (tinted per building by its vertex colour).
  rect(p, ox, y, W, H, "#f4f2f0");
  if (variant === 0) {
    // Two punched windows with a coloured spandrel under them.
    rect(p, ox, y + H - 18, W, 14, "#d6dbe8");
    for (const wx of [14, 70]) windowPane(p, ox + wx, y + 16, 44, H - 44, r);
  } else if (variant === 1) {
    // A ribbon window the whole width, a slim panel band over it.
    rect(p, ox, y, W, 16, "#e2e5ee");
    for (let k = 0; k < 4; k++) windowPane(p, ox + 3 + k * 31.5, y + 22, 27, H - 40, r, "#c9cfdc");
  } else if (variant === 2) {
    // Curtain wall: glass floor to floor, slim mullions.
    for (let k = 0; k < 3; k++) windowPane(p, ox + 4 + k * 41.3, y + 6, 37, H - 16, r, "#8b93a8");
    rect(p, ox, y + H - 8, W, 8, "#9aa2b8");
  } else {
    // Homes: a tall window and a balcony door, a coloured balcony front.
    windowPane(p, ox + 12, y + 18, 40, H - 38, r);
    windowPane(p, ox + 70, y + 12, 44, H - 20, r);
    const bc = ["#ff8fb8", "#7fd6ff", "#ffe07a", "#b9a2ff"][Math.floor(r() * 4)];
    rect(p, ox + 62, y + H - 30, 60, 22, bc);
    rect(p, ox + 62, y + H - 32, 60, 3, "#ffffff");
  }
  // A shadow line under each floor slab.
  p.col.fillStyle = "rgba(40,40,60,0.18)";
  p.col.fillRect(ox, y, W, 4);
}

/** A ground-floor shopfront: glass lit from inside, a door, a glowing sign band in a neon colour, sometimes marquee bulbs. */
function shopfront(p: Pen, ox: number, oy: number, i: number, r: () => number) {
  const W = 128, H = 156;
  const neon = NEON[i % NEON.length];
  rect(p, ox, oy, W, H, "#3a3c4c");
  // Sign band.
  rect(p, ox, oy + 4, W, 30, "#1b1530");
  p.emi.save();
  p.col.save();
  for (const c of [p.col, p.emi]) {
    c.strokeStyle = neon;
    c.fillStyle = neon;
    c.lineWidth = 4;
    c.shadowColor = neon;
    c.shadowBlur = 8;
  }
  const kind = i % 4;
  for (const c of [p.col, p.emi]) {
    c.beginPath();
    if (kind === 0) { for (let k = 0; k < 7; k++) { c.moveTo(ox + 12 + k * 16, oy + 12); c.lineTo(ox + 20 + k * 16, oy + 26); } }
    else if (kind === 1) { c.rect(ox + 8, oy + 10, W - 16, 18); }
    else if (kind === 2) { for (let k = 0; k < 6; k++) c.arc(ox + 18 + k * 18.5, oy + 19, 5, 0, Math.PI * 2); }
    else { c.moveTo(ox + 8, oy + 19); for (let k = 0; k <= 10; k++) c.lineTo(ox + 8 + k * 11.2, oy + 19 + (k % 2 ? -7 : 7)); }
    if (kind === 2) c.fill(); else c.stroke();
  }
  p.emi.restore();
  p.col.restore();
  // Marquee bulbs round the band on every other shop.
  if (i % 2 === 0) {
    for (let k = 0; k < 13; k++) {
      for (const yy of [oy + 3, oy + 35]) {
        p.col.fillStyle = "#fff3c2";
        p.col.beginPath(); p.col.arc(ox + 5 + k * 9.8, yy, 2.2, 0, Math.PI * 2); p.col.fill();
        p.emi.fillStyle = "#ffe6a0";
        p.emi.beginPath(); p.emi.arc(ox + 5 + k * 9.8, yy, 2.4, 0, Math.PI * 2); p.emi.fill();
      }
    }
  }
  // Glass: warm or cool light, shelves and silhouettes inside, a door.
  const warm = r() < 0.65;
  const gx = ox + 6, gy = oy + 42, gw = W - 12, gh = H - 48;
  const g = p.col.createLinearGradient(0, gy, 0, gy + gh);
  g.addColorStop(0, warm ? "#ffe2a8" : "#d2f0ff");
  g.addColorStop(1, warm ? "#f5a860" : "#7cc4f0");
  p.col.fillStyle = g;
  p.col.fillRect(gx, gy, gw, gh);
  p.emi.fillStyle = warm ? "#ffcf8a" : "#b8e4ff";
  p.emi.fillRect(gx, gy, gw, gh);
  for (let k = 0; k < 4; k++) {
    const sx = gx + 6 + r() * (gw - 30), sh = 14 + r() * 26;
    const c = NEON[Math.floor(r() * NEON.length)];
    p.col.fillStyle = c;
    p.col.fillRect(sx, gy + gh - sh - 6, 10 + r() * 14, sh);
  }
  p.col.fillStyle = "rgba(30,30,50,0.55)";
  p.col.fillRect(gx, gy + gh * 0.55, gw, 3);
  // Mullions and the door.
  rect(p, gx + gw / 3, gy, 3, gh, "#2b2d3a");
  rect(p, gx + (2 * gw) / 3, gy, 3, gh, "#2b2d3a");
  const dx = i % 3 === 0 ? gx + 4 : gx + gw - 34;
  rect(p, dx, gy + 16, 30, gh - 16, "#2b2d3a");
  p.col.fillStyle = warm ? "#ffd59a" : "#bfe6ff";
  p.col.fillRect(dx + 3, gy + 19, 24, gh - 22);
  p.emi.fillStyle = warm ? "#e0a060" : "#80b8e0";
  p.emi.fillRect(dx + 3, gy + 19, 24, gh - 22);
}

/** A tower's window grid: one 3.6 m bay by one 3.6 m floor per tile. */
function towerTile(p: Pen, ox: number, oy: number, r: () => number) {
  rect(p, ox, oy, 128, 128, "#c9cddb");
  windowPane(p, ox + 10, oy + 14, 108, 96, r, "#aeb4c6");
  rect(p, ox, oy + 120, 128, 8, "#b5bacb");
}

export interface NimbasaMaps {
  map: THREE.Texture;
  emissive: THREE.Texture;
  dispose(): void;
}

export function facadeAtlas(scale: 1 | 2, anisotropy: number): NimbasaMaps {
  const S = 1024 * scale;
  const mk = () => { const c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d")!; g.scale(scale, scale); return { c, g }; };
  const col = mk(), emi = mk();
  emi.g.fillStyle = "#000";
  emi.g.fillRect(0, 0, 1024, 1024);
  const p: Pen = { col: col.g, emi: emi.g };
  const r = rng(4242);
  const FH = FLOOR_M * PX;
  for (let i = 0; i < 4; i++) for (let f = 0; f < MAX_FLOORS; f++) upperFloor(p, i * 128, 1024 - (f + 1) * FH, i, r);
  // The top of the columns (above eight floors) stays plain wall.
  rect(p, 0, 0, 512, 1024 - MAX_FLOORS * FH, "#f4f2f0");
  for (let i = 0; i < 8; i++) shopfront(p, 512 + (i % 4) * 128, Math.floor(i / 4) * 156, i, r);
  for (let y = 320; y < 1024; y += 128) for (let x = 512; x < 1024; x += 128) towerTile(p, x, y, r);
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  const map = tex(col.c, true), emissive = tex(emi.c, true);
  return { map, emissive, dispose() { map.dispose(); emissive.dispose(); } };
}

/** A repeating tower texture (window grid), for the city's taller blocks: colour and light. */
export function towerTexture(anisotropy: number): NimbasaMaps {
  const mk = () => { const c = document.createElement("canvas"); c.width = c.height = 256; return { c, g: c.getContext("2d")! }; };
  const col = mk(), emi = mk();
  const p: Pen = { col: col.g, emi: emi.g };
  const r = rng(99);
  // Two by two windows per tile (each 3.6 m), at half size.
  col.g.scale(0.5, 0.5);
  emi.g.scale(0.5, 0.5);
  for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 128) towerTile(p, x, y, r);
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    return t;
  };
  const map = tex(col.c), emissive = tex(emi.c);
  return { map, emissive, dispose() { map.dispose(); emissive.dispose(); } };
}

/** Sign sheet (1024 × 1024): twelve wide signs (256 × 128 px, two to one) in the top three rows of 256 px, then eight blade signs (128 × 256 px, one to two). */
export const SIGNS = {
  wide: (i: number) => { const c = i % 4, rr = Math.floor(i / 4) % 3; return { u0: c * 0.25 + 0.004, u1: c * 0.25 + 0.246, v0: 1 - (rr * 256 + 190) / 1024, v1: 1 - (rr * 256 + 66) / 1024 }; },
  WIDE: 12,
  blade: (i: number) => { const c = i % 8; return { u0: c * 0.125, u1: c * 0.125 + 0.125, v0: 0, v1: 0.25 }; },
  BLADES: 8,
};

/** The neon signs (glowing shapes on dark panels, with a bulb border on some). */
export function signSheet(anisotropy: number): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1024;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#120c24";
  g.fillRect(0, 0, 1024, 1024);
  const glowLine = (color: string, w: number, draw: () => void, fill = false) => {
    g.save();
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = w;
    g.lineJoin = "round";
    g.lineCap = "round";
    for (const [blur, a] of [[22, 0.6], [8, 0.9], [0, 1]] as const) {
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.globalAlpha = a;
      g.beginPath();
      draw();
      if (fill) g.fill(); else g.stroke();
    }
    g.restore();
    // A white-hot core.
    if (!fill) {
      g.save();
      g.strokeStyle = "rgba(255,255,255,0.85)";
      g.lineWidth = Math.max(1, w * 0.35);
      g.lineJoin = "round";
      g.lineCap = "round";
      g.beginPath();
      draw();
      g.stroke();
      g.restore();
    }
  };
  const star = (cx: number, cy: number, r: number) => { for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (i) g.lineTo(x, y); else g.moveTo(x, y); } };
  const bolt = (cx: number, cy: number, s: number) => { const p = [[0.15, -1], [-0.45, 0.1], [0, 0.1], [-0.2, 1], [0.5, -0.2], [0.05, -0.2], [0.3, -1]]; p.forEach(([x, y], i) => (i ? g.lineTo(cx + x * s, cy + y * s) : g.moveTo(cx + x * s, cy + y * s))); g.closePath(); };
  const heart = (cx: number, cy: number, s: number) => { g.moveTo(cx, cy + s * 0.8); g.bezierCurveTo(cx - s * 1.4, cy - s * 0.2, cx - s * 0.6, cy - s * 1.2, cx, cy - s * 0.4); g.bezierCurveTo(cx + s * 0.6, cy - s * 1.2, cx + s * 1.4, cy - s * 0.2, cx, cy + s * 0.8); };
  const note = (cx: number, cy: number, s: number) => { g.moveTo(cx - s * 0.5, cy + s * 0.6); g.arc(cx - s * 0.7, cy + s * 0.6, s * 0.22, 0, Math.PI * 2); g.moveTo(cx - s * 0.48, cy + s * 0.6); g.lineTo(cx - s * 0.48, cy - s * 0.7); g.lineTo(cx + s * 0.6, cy - s * 0.9); g.lineTo(cx + s * 0.6, cy + s * 0.4); g.moveTo(cx + s * 0.82, cy + s * 0.4); g.arc(cx + s * 0.6, cy + s * 0.4, s * 0.22, 0, Math.PI * 2); };
  const wheel = (cx: number, cy: number, s: number) => { g.moveTo(cx + s, cy); g.arc(cx, cy, s, 0, Math.PI * 2); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s); } g.moveTo(cx - s * 0.5, cy + s * 1.35); g.lineTo(cx, cy); g.lineTo(cx + s * 0.5, cy + s * 1.35); };
  const wave = (x0: number, cy: number, w: number, s: number) => { g.moveTo(x0, cy + s * 0.6); for (let i = 1; i <= 40; i++) { const t = i / 40; g.lineTo(x0 + t * w, cy + Math.sin(t * Math.PI * 3) * s * (0.4 + 0.6 * t) * -1 + s * 0.2); } };
  const bulbs = (x: number, y: number, w: number, h: number, color: string) => {
    g.save();
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 8;
    const step = 14;
    for (let k = x + 8; k < x + w - 4; k += step) for (const yy of [y + 7, y + h - 7]) { g.beginPath(); g.arc(k, yy, 3.2, 0, Math.PI * 2); g.fill(); }
    for (let k = y + 7 + step; k < y + h - 10; k += step) for (const xx of [x + 8, x + w - 8]) { g.beginPath(); g.arc(xx, k, 3.2, 0, Math.PI * 2); g.fill(); }
    g.restore();
  };
  const cells: ((x: number, y: number) => void)[] = [
    (x, y) => { glowLine(NEON[2], 7, () => bolt(x + 128, y + 64, 46), true); bulbs(x, y, 256, 128, "#ffe8a0"); },
    (x, y) => { glowLine(NEON[0], 6, () => heart(x + 128, y + 66, 40)); glowLine(NEON[1], 4, () => { g.rect(x + 20, y + 18, 216, 92); }); },
    (x, y) => { glowLine(NEON[1], 6, () => star(x + 70, y + 64, 40)); glowLine(NEON[2], 6, () => star(x + 186, y + 64, 40)); },
    (x, y) => { glowLine(NEON[3], 6, () => note(x + 128, y + 64, 46)); bulbs(x, y, 256, 128, "#ffd0f0"); },
    (x, y) => { glowLine(NEON[5], 5, () => wheel(x + 128, y + 54, 38)); },
    (x, y) => { glowLine(NEON[4], 7, () => wave(x + 24, y + 64, 208, 38)); glowLine(NEON[2], 4, () => { g.moveTo(x + 24, y + 108); g.lineTo(x + 232, y + 108); }); },
    (x, y) => { for (let k = 0; k < 5; k++) glowLine(NEON[k], 6, () => { g.moveTo(x + 40 + k * 44, y + 26); g.lineTo(x + 20 + k * 44, y + 64); g.lineTo(x + 40 + k * 44, y + 102); }); },
    (x, y) => { glowLine(NEON[0], 6, () => { g.arc(x + 128, y + 64, 44, 0, Math.PI * 2); }); glowLine(NEON[2], 6, () => { g.arc(x + 128, y + 64, 22, 0, Math.PI * 2); }); },
    (x, y) => { glowLine(NEON[1], 7, () => bolt(x + 80, y + 64, 44), true); glowLine(NEON[1], 7, () => bolt(x + 176, y + 64, 44), true); },
    (x, y) => { glowLine(NEON[2], 5, () => { for (let k = 0; k < 3; k++) { g.moveTo(x + 40 + k * 70, y + 100); g.lineTo(x + 70 + k * 70, y + 28); g.lineTo(x + 100 + k * 70, y + 100); } }); bulbs(x, y, 256, 128, "#fff0c0"); },
    (x, y) => { glowLine(NEON[3], 6, () => heart(x + 80, y + 66, 32)); glowLine(NEON[0], 6, () => heart(x + 176, y + 66, 32)); },
    (x, y) => { glowLine(NEON[5], 6, () => note(x + 80, y + 64, 38)); glowLine(NEON[1], 6, () => star(x + 182, y + 64, 36)); },
  ];
  cells.forEach((draw, i) => {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 256;
    // Each wide sign is a 256 × 256 cell drawn in its middle 128 rows, on a dark panel with a rim.
    g.fillStyle = "#1a1233";
    g.fillRect(x + 2, y + 64, 252, 128);
    draw(x, y + 64);
  });
  // Blade signs: tall dark strips with a column of shapes and bulbs.
  for (let i = 0; i < 8; i++) {
    const x = i * 128, y = 768;
    g.fillStyle = "#1a1233";
    g.fillRect(x + 4, y + 2, 120, 252);
    const c = NEON[i % NEON.length];
    for (let k = 0; k < 4; k++) {
      const cy = y + 34 + k * 62;
      if (i % 3 === 0) glowLine(c, 5, () => star(x + 64, cy, 22));
      else if (i % 3 === 1) glowLine(c, 5, () => { g.arc(x + 64, cy, 20, 0, Math.PI * 2); });
      else glowLine(c, 5, () => heart(x + 64, cy, 18));
    }
    g.save();
    g.fillStyle = "#fff0c0";
    g.shadowColor = "#ffd27a";
    g.shadowBlur = 6;
    for (let k = y + 10; k < y + 250; k += 14) for (const xx of [x + 12, x + 116]) { g.beginPath(); g.arc(xx, k, 2.8, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}
