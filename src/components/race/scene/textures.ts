import * as THREE from "three";

/**
 * Canvas textures drawn by the page itself (and the crowd's colours): the
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

/** The crowd's colours: skin tones, hair, and shirts (caps take a shirt colour). */
export const CROWD_SKIN = ["#f1c7a5", "#e0ac83", "#c68a62", "#a86f4c", "#7d4f33", "#5c3a26", "#f6d9c1", "#d9a07a"];
export const CROWD_HAIR = ["#1d1611", "#2f2219", "#4a3324", "#7a5332", "#c99a5b", "#e3c27c", "#9a9a9a", "#d8d2c8", "#8e3a1e", "#111111"];
export const CROWD_SHIRT = ["#d7263d", "#f46036", "#ffd23f", "#3bceac", "#0ead69", "#2e86ab", "#1b4965", "#ffffff", "#f2f2f2", "#222222", "#6a4c93", "#e76f51", "#fca311", "#14213d", "#e5e5e5", "#ff006e", "#3a86ff", "#8338ec", "#06d6a0", "#ef476f", "#118ab2", "#073b4c", "#ffb703", "#fb8500"];

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
