import * as THREE from "three";

/**
 * Canvas textures drawn by the page itself: the crowd's sprite sheet, the
 * LED boards round the track, lane numbers, the glow of a lamp, the
 * trackside clock. Nothing here is taken from any game or brand.
 */

/** A small seeded random generator (the same crowd on every visit). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

const SKIN = ["#f1c7a5", "#e0ac83", "#c68a62", "#a86f4c", "#7d4f33", "#5c3a26", "#f6d9c1", "#d9a07a"];
const HAIR = ["#1d1611", "#2f2219", "#4a3324", "#7a5332", "#c99a5b", "#e3c27c", "#9a9a9a", "#d8d2c8", "#8e3a1e", "#111111"];
const SHIRT = ["#d7263d", "#f46036", "#ffd23f", "#3bceac", "#0ead69", "#2e86ab", "#1b4965", "#ffffff", "#f2f2f2", "#222222", "#6a4c93", "#e76f51", "#fca311", "#14213d", "#e5e5e5", "#ff006e", "#3a86ff", "#8338ec", "#06d6a0", "#ef476f", "#118ab2", "#073b4c", "#ffb703", "#fb8500"];
const FLAG = [["#d7263d", "#ffffff"], ["#2e86ab", "#ffd23f"], ["#0ead69", "#ffffff"], ["#14213d", "#fca311"], ["#ff006e", "#3a86ff"], ["#ffd23f", "#d7263d"]];

export const CROWD_COLS = 8;
export const CROWD_ROWS = 4;

/**
 * The crowd's sprite sheet: CROWD_COLS × CROWD_ROWS / 2 cells of spectators
 * (`perCell` side by side, seated, seen from the field), drawn twice: arms
 * down (top half) and the same people cheering, arms up (bottom half).
 */
export function crowdAtlas(perCell: number): THREE.Texture {
  const cw = 128, ch = 128;
  const [c, g] = canvas(cw * CROWD_COLS, ch * CROWD_ROWS);
  const half = CROWD_ROWS / 2;
  for (let cell = 0; cell < CROWD_COLS * half; cell++) {
    const cx = (cell % CROWD_COLS) * cw, cy = Math.floor(cell / CROWD_COLS) * ch;
    for (const up of [false, true]) {
      const r = rng(cell * 977 + 13);
      const oy = cy + (up ? half * ch : 0);
      const pw = cw / perCell;
      for (let p = 0; p < perCell; p++) {
        const skin = SKIN[Math.floor(r() * SKIN.length)];
        const hair = HAIR[Math.floor(r() * HAIR.length)];
        const shirt = SHIRT[Math.floor(r() * SHIRT.length)];
        const px = cx + p * pw + pw / 2 + (r() - 0.5) * pw * 0.12;
        const scale = (0.86 + r() * 0.18) * Math.min(1, 2.2 / perCell + 0.3);
        const headR = pw * 0.17 * scale;
        const shoulderY = oy + ch * (0.58 + (r() - 0.5) * 0.05);
        const bodyW = pw * 0.62 * scale;
        const prop = r();
        // Torso.
        g.fillStyle = shirt;
        g.beginPath();
        g.moveTo(px - bodyW / 2, oy + ch);
        g.lineTo(px - bodyW / 2, shoulderY + headR * 0.4);
        g.quadraticCurveTo(px - bodyW / 2, shoulderY, px - bodyW * 0.3, shoulderY);
        g.lineTo(px + bodyW * 0.3, shoulderY);
        g.quadraticCurveTo(px + bodyW / 2, shoulderY, px + bodyW / 2, shoulderY + headR * 0.4);
        g.lineTo(px + bodyW / 2, oy + ch);
        g.closePath();
        g.fill();
        // A darker lower half (lap, seat back) so rows read apart.
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.fillRect(px - bodyW / 2, oy + ch * 0.86, bodyW, ch * 0.14);
        // Arms: down at the sides, or raised (cheering), sometimes waving a flag or holding up a phone.
        g.strokeStyle = shirt;
        g.lineCap = "round";
        g.lineWidth = Math.max(2, pw * 0.11 * scale);
        if (up) {
          const reach = ch * (0.3 + r() * 0.1);
          for (const s of [-1, 1]) {
            g.beginPath();
            g.moveTo(px + s * bodyW * 0.42, shoulderY + 2);
            g.lineTo(px + s * bodyW * (0.55 + r() * 0.25), shoulderY - reach);
            g.stroke();
            g.fillStyle = skin;
            g.beginPath();
            g.arc(px + s * bodyW * (0.55 + r() * 0.2), shoulderY - reach - 2, g.lineWidth * 0.55, 0, Math.PI * 2);
            g.fill();
          }
          if (prop < 0.22) {
            const [a, b] = FLAG[Math.floor(r() * FLAG.length)];
            const fx = px + bodyW * 0.62, fy = shoulderY - reach - pw * 0.05;
            g.fillStyle = a;
            g.fillRect(fx, fy - pw * 0.32, pw * 0.42, pw * 0.15);
            g.fillStyle = b;
            g.fillRect(fx, fy - pw * 0.17, pw * 0.42, pw * 0.15);
          }
        } else {
          for (const s of [-1, 1]) {
            g.beginPath();
            g.moveTo(px + s * bodyW * 0.45, shoulderY + 4);
            g.lineTo(px + s * bodyW * 0.4, oy + ch * 0.9);
            g.stroke();
          }
        }
        if (prop > 0.86) {
          // A phone held up to film: a small bright screen.
          const hx = px + (r() - 0.5) * bodyW * 0.6, hy = shoulderY - ch * (up ? 0.32 : 0.06);
          g.fillStyle = "#1c1c1c";
          g.fillRect(hx - pw * 0.06, hy - pw * 0.1, pw * 0.12, pw * 0.2);
          g.fillStyle = "#cfe6ff";
          g.fillRect(hx - pw * 0.045, hy - pw * 0.085, pw * 0.09, pw * 0.15);
        }
        // Neck and head.
        g.fillStyle = skin;
        g.fillRect(px - headR * 0.35, shoulderY - headR * 0.6, headR * 0.7, headR * 0.8);
        g.beginPath();
        g.arc(px, shoulderY - headR * 1.25, headR, 0, Math.PI * 2);
        g.fill();
        // Hair, or a cap.
        if (r() < 0.18) {
          g.fillStyle = SHIRT[Math.floor(r() * SHIRT.length)];
          g.beginPath();
          g.arc(px, shoulderY - headR * 1.35, headR * 1.02, Math.PI, 0);
          g.fill();
          g.fillRect(px - headR * 1.3, shoulderY - headR * 1.4, headR * 1.3, headR * 0.25);
        } else {
          g.fillStyle = hair;
          g.beginPath();
          g.arc(px, shoulderY - headR * 1.4, headR * 0.98, Math.PI * 1.05, Math.PI * 1.95);
          g.lineTo(px + headR * 0.95, shoulderY - headR * 1.15);
          g.lineTo(px - headR * 0.95, shoulderY - headR * 1.15);
          g.fill();
        }
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** A soft round glow for lamps (additive). */
export function glowTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.08, "rgba(255,252,240,0.9)");
  grad.addColorStop(0.25, "rgba(220,230,255,0.28)");
  grad.addColorStop(0.6, "rgba(170,190,255,0.06)");
  grad.addColorStop(1, "rgba(150,170,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A horizontal lens streak (the anamorphic flare of a broadcast lens at night). */
export function streakTexture(): THREE.Texture {
  const [c, g] = canvas(256, 32);
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, "rgba(140,170,255,0)");
  grad.addColorStop(0.5, "rgba(230,240,255,0.9)");
  grad.addColorStop(1, "rgba(140,170,255,0)");
  g.fillStyle = grad;
  for (let y = 0; y < 32; y++) {
    g.globalAlpha = Math.exp(-Math.pow((y - 15.5) / 3.2, 2));
    g.fillRect(0, y, 256, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft dust / granule puff. */
export function puffTexture(): THREE.Texture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.3)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * The LED ribbon round the track (and on the tier fascia): a long strip
 * of messages in the stadium's colours, scrolled by the shader.
 */
export function ledBoardTexture(font: string): THREE.Texture {
  const W = 4096, H = 128;
  const [c, g] = canvas(W, H);
  const panels: { bg: string; fg: string; text: string; accent?: string }[] = [
    { bg: "#0b1a3a", fg: "#ffffff", text: "POKÉIQ STADIUM", accent: "#ffd23f" },
    { bg: "#d7263d", fg: "#ffffff", text: "RACE NIGHT" },
    { bg: "#101010", fg: "#ffd23f", text: "POKÉIQ" },
    { bg: "#1b4965", fg: "#ffffff", text: "WHO IS FASTEST?" },
    { bg: "#ffd23f", fg: "#14213d", text: "POKÉIQ" },
    { bg: "#0b1a3a", fg: "#3bceac", text: "100 M · 200 M · 400 M" },
    { bg: "#6a4c93", fg: "#ffffff", text: "MAKE YOUR OWN RACE" },
    { bg: "#101010", fg: "#ffffff", text: "POKÉIQ STADIUM" },
  ];
  const pw = W / panels.length;
  panels.forEach((p, i) => {
    const x = i * pw;
    g.fillStyle = p.bg;
    g.fillRect(x, 0, pw, H);
    if (p.accent) {
      g.fillStyle = p.accent;
      g.fillRect(x, H - 14, pw, 14);
    }
    g.fillStyle = p.fg;
    g.font = `700 ${H * 0.56}px ${font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    let px = H * 0.56;
    while (g.measureText(p.text).width > pw * 0.88 && px > 20) { px -= 4; g.font = `700 ${px}px ${font}`; }
    g.fillText(p.text, x + pw / 2, H * 0.52);
  });
  // LED pixel grid.
  g.fillStyle = "rgba(0,0,0,0.28)";
  for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Lane numbers painted on the track: 1 to 8 in a row (white on transparent). */
export function laneNumbersTexture(font: string): THREE.Texture {
  const [c, g] = canvas(1024, 160);
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `700 140px ${font}`;
  for (let i = 0; i < 8; i++) g.fillText(String(i + 1), 64 + i * 128, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A thin painted line (white, 5 cm down the middle of a 0.4 m quad, along its length), mip-mapped so it never shimmers. */
export function paintLineTexture(): THREE.Texture {
  const [c, g] = canvas(64, 4);
  g.fillStyle = "#ffffff";
  g.fillRect(28, 0, 8, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The trackside clock: big yellow LED digits on black (redrawn when the time changes). */
export class ClockFace {
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private last = "";
  constructor(private font: string) {
    const [c, g] = canvas(512, 160);
    this.g = g;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw("0.00", "");
  }
  draw(time: string, label: string) {
    const key = `${time}|${label}`;
    if (key === this.last) return;
    this.last = key;
    const g = this.g;
    g.fillStyle = "#050505";
    g.fillRect(0, 0, 512, 160);
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.font = `700 112px ${this.font}`;
    g.fillStyle = "#ffcc1a";
    g.shadowColor = "#ffb000";
    g.shadowBlur = 18;
    g.fillText(time, 492, 84);
    g.shadowBlur = 0;
    if (label) {
      g.textAlign = "left";
      g.font = `700 30px ${this.font}`;
      g.fillStyle = "#ffffff";
      g.fillText(label, 18, 30);
    }
    this.texture.needsUpdate = true;
  }
}
