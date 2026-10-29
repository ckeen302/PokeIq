import type { EmblemId, ExpressionId, EyesId } from "@/lib/trainer/config";

/**
 * Drawn faces and emblems: small canvases the 3D trainer wears as
 * textures. The face canvas covers the front of the head, 256 px per
 * radian both ways (2 rad across, 1.3 rad down from 0.95 rad below the top
 * of the head), so shapes drawn here keep their proportions on the sphere.
 */

const PX = 256;
const W = 512;
const H = 333;
/** The head's equator on the canvas. */
const EQ = (Math.PI / 2 - 0.95) * PX;

export interface FaceSpec {
  eyes: EyesId;
  expr: ExpressionId;
  iris: string;
  skin: string;
  brow: string;
}

const INK = "#2a1a1c";

function mix(hex: string, toward: string, k: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(toward.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** Eye geometry, from the eye shape and the expression. */
function eyeShape(eyes: EyesId, expr: ExpressionId) {
  let w = 27;
  let h = 35;
  // The upper lid as a line: its height at the inner and outer corners (from the centre, up is negative).
  let lidIn = -h;
  let lidOut = -h;
  let arc = true;
  if (eyes === "focused") {
    h = 31;
    lidIn = lidOut = -h * 0.55;
    arc = false;
  } else if (eyes === "sharp") {
    w = 29;
    h = 29;
    lidIn = -h * 0.35;
    lidOut = -h * 0.85;
    arc = false;
  }
  const lid = { determined: [0.35, 0.05], smug: [0.4, 0.35], sleepy: [0.55, 0.5], calm: [0.15, 0.15], happy: [0, 0], surprised: [-0.1, -0.1] }[expr];
  if (lid[0] > 0 || lid[1] > 0) {
    lidIn = Math.max(lidIn, -h + h * 2 * lid[0] * 0.75);
    lidOut = Math.max(lidOut, -h + h * 2 * lid[1] * 0.75);
    arc = false;
  }
  return { w, h: expr === "surprised" ? h * 1.08 : h, lidIn, lidOut, arc, small: expr === "surprised" };
}

function drawEye(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, f: FaceSpec) {
  g.lineCap = "round";
  g.lineJoin = "round";
  if (f.eyes === "happy" || f.eyes === "squint") {
    g.strokeStyle = INK;
    g.lineWidth = 9;
    g.beginPath();
    if (f.eyes === "happy") {
      g.moveTo(cx - 25, cy + 8);
      g.quadraticCurveTo(cx, cy - 24, cx + 25, cy + 8);
    } else {
      g.moveTo(cx - 27, cy + 2);
      g.quadraticCurveTo(cx, cy - 5, cx + 27, cy + 2);
    }
    g.stroke();
    return;
  }
  const e = eyeShape(f.eyes, f.expr);
  const inner = cx - s * e.w;
  const outer = cx + s * e.w;
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, e.w, e.h, 0, 0, Math.PI * 2);
  g.clip();
  // White, then the iris (darker at the top), pupil and two highlights.
  g.fillStyle = "#ffffff";
  g.fillRect(cx - e.w - 2, cy - e.h - 2, e.w * 2 + 4, e.h * 2 + 4);
  const ir = e.small ? 0.66 : 0.86;
  const ix = cx - s * 2;
  const grad = g.createLinearGradient(0, cy - e.h, 0, cy + e.h);
  grad.addColorStop(0, mix(f.iris, "#000000", 0.55));
  grad.addColorStop(0.55, f.iris);
  grad.addColorStop(1, mix(f.iris, "#ffffff", 0.35));
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(ix, cy + 1, e.w * ir, e.h * ir * 0.98, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = mix(f.iris, "#000000", 0.75);
  g.beginPath();
  g.ellipse(ix, cy + 2, e.w * ir * 0.45, e.h * ir * 0.5, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.ellipse(ix - 8, cy - e.h * 0.32, 7.5, 9.5, -0.3, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(ix + 8, cy + e.h * 0.38, 3.8, 0, Math.PI * 2);
  g.fill();
  // The upper lid (skin) for heavy-lidded and narrowed looks.
  if (!e.arc) {
    g.fillStyle = f.skin;
    g.beginPath();
    g.moveTo(inner - s * 4, cy - e.h - 4);
    g.lineTo(outer + s * 4, cy - e.h - 4);
    g.lineTo(outer + s * 4, cy + e.lidOut);
    g.lineTo(inner - s * 4, cy + e.lidIn);
    g.closePath();
    g.fill();
  }
  g.restore();
  // Lash line.
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = f.eyes === "lashes" ? 10 : 8;
  g.beginPath();
  if (e.arc) {
    g.ellipse(cx, cy, e.w + 1, e.h + 1, 0, Math.PI * 1.08, Math.PI * 1.92);
  } else {
    const yIn = cy + e.lidIn;
    const yOut = cy + e.lidOut;
    g.moveTo(inner, yIn + 3);
    g.lineTo(outer + s * 3, yOut);
  }
  g.stroke();
  // A flick at the outer corner (and lashes).
  const yOuter = e.arc ? cy - e.h * 0.35 : cy + e.lidOut;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(outer, yOuter + 2);
  g.lineTo(outer + s * 11, yOuter - 6);
  g.stroke();
  if (f.eyes === "lashes") {
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(outer - s * 3, yOuter - 8);
    g.lineTo(outer + s * 9, yOuter - 19);
    g.stroke();
  }
  // Lower lid, a short soft line.
  g.strokeStyle = mix(INK, f.skin, 0.45);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx - e.w * 0.45, cy + e.h + 1);
  g.lineTo(cx + e.w * 0.45, cy + e.h + 1);
  g.stroke();
}

function drawBrow(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, f: FaceSpec) {
  // Inner and outer heights (up is negative) and the arch.
  const shapes: Record<ExpressionId, [number, number, number]> = {
    happy: [-4, -2, -6],
    determined: [10, -6, 0],
    smug: s > 0 ? [-6, -8, -6] : [2, 0, -2],
    calm: [0, 0, -3],
    sleepy: [-2, 6, -2],
    surprised: [-12, -10, -8],
  };
  const [yi0, yo0, arch] = shapes[f.expr];
  let yi = yi0;
  let yo = yo0;
  if (f.eyes === "sharp" && f.expr !== "surprised") {
    yi += 4;
    yo -= 2;
  }
  g.strokeStyle = f.brow;
  g.lineCap = "round";
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(cx - s * 20, cy + yi);
  g.quadraticCurveTo(cx + s * 3, cy + Math.min(yi, yo) + arch, cx + s * 26, cy + yo);
  g.stroke();
}

function drawMouth(g: CanvasRenderingContext2D, cx: number, cy: number, f: FaceSpec) {
  const lip = "#6e2a2c";
  g.save();
  g.translate(cx, cy);
  g.scale(1.35, 1.35);
  g.translate(-cx, -cy);
  drawMouthShape(g, cx, cy, f, lip);
  g.restore();
}

function drawMouthShape(g: CanvasRenderingContext2D, cx: number, cy: number, f: FaceSpec, lip: string) {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = lip;
  g.fillStyle = "#8a3236";
  switch (f.expr) {
    case "happy":
      g.beginPath();
      g.moveTo(cx - 17, cy - 4);
      g.quadraticCurveTo(cx, cy, cx + 17, cy - 4);
      g.quadraticCurveTo(cx, cy + 26, cx - 17, cy - 4);
      g.fill();
      g.fillStyle = "#f07c86";
      g.beginPath();
      g.ellipse(cx, cy + 9, 8, 4.5, 0, 0, Math.PI * 2);
      g.fill();
      return;
    case "determined":
      g.beginPath();
      g.moveTo(cx - 18, cy - 4);
      g.lineTo(cx + 18, cy - 6);
      g.quadraticCurveTo(cx + 6, cy + 14, cx - 18, cy - 4);
      g.fill();
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.moveTo(cx - 15, cy - 3);
      g.lineTo(cx + 15, cy - 5);
      g.lineTo(cx + 12, cy);
      g.lineTo(cx - 12, cy + 1);
      g.closePath();
      g.fill();
      return;
    case "smug":
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(cx - 12, cy + 2);
      g.quadraticCurveTo(cx + 4, cy + 6, cx + 15, cy - 6);
      g.stroke();
      return;
    case "calm":
      g.lineWidth = 4.5;
      g.beginPath();
      g.moveTo(cx - 9, cy);
      g.quadraticCurveTo(cx, cy + 5, cx + 9, cy);
      g.stroke();
      return;
    case "sleepy":
      g.beginPath();
      g.ellipse(cx, cy + 2, 5, 4, 0, 0, Math.PI * 2);
      g.fill();
      return;
    case "surprised":
      g.beginPath();
      g.ellipse(cx, cy + 3, 9, 12, 0, 0, Math.PI * 2);
      g.fill();
      return;
  }
}

/** The face canvas: eyes, brows, a hint of a nose, mouth and blush. */
export function faceTexture(f: FaceSpec): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const eyeY = EQ + 28;
  for (const s of [-1, 1]) {
    const cx = W / 2 + s * 90;
    // Blush.
    const blush = g.createRadialGradient(W / 2 + s * 140, eyeY + 36, 0, W / 2 + s * 140, eyeY + 36, 24);
    blush.addColorStop(0, "rgba(255,120,130,0.42)");
    blush.addColorStop(1, "rgba(255,120,130,0)");
    g.fillStyle = blush;
    g.fillRect(W / 2 + s * 140 - 30, eyeY + 6, 60, 60);
    drawEye(g, cx, eyeY, s, f);
    drawBrow(g, cx, eyeY - 52, s, f);
  }
  g.fillStyle = mix(f.skin, "#7a3a2a", 0.35);
  g.beginPath();
  g.ellipse(W / 2, eyeY + 36, 3.5, 2.5, 0, 0, Math.PI * 2);
  g.fill();
  drawMouth(g, W / 2, eyeY + 62, f);
  return c;
}

/** An emblem on a transparent canvas, in `fg` (with `bg` for cut-outs). */
export function drawEmblem(kind: EmblemId, fg: string, bg: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = fg;
  g.strokeStyle = fg;
  g.lineJoin = "round";
  g.lineCap = "round";
  const p = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  };
  switch (kind) {
    case "badge":
      g.beginPath();
      g.arc(64, 64, 46, 0, Math.PI * 2);
      g.fill();
      break;
    case "ball":
      g.lineWidth = 12;
      g.beginPath();
      g.arc(64, 64, 50, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(14, 64);
      g.lineTo(114, 64);
      g.stroke();
      g.beginPath();
      g.arc(64, 64, 17, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = bg;
      g.beginPath();
      g.arc(64, 64, 8, 0, Math.PI * 2);
      g.fill();
      break;
    case "star": {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 24 : 56;
        pts.push([64 + Math.cos(a) * r, 68 + Math.sin(a) * r]);
      }
      p(pts);
      break;
    }
    case "bolt":
      p([
        [74, 8],
        [30, 72],
        [60, 72],
        [50, 120],
        [98, 52],
        [68, 52],
      ]);
      break;
    case "flame":
      g.beginPath();
      g.moveTo(64, 8);
      g.bezierCurveTo(104, 50, 112, 76, 96, 102);
      g.bezierCurveTo(84, 122, 44, 122, 32, 102);
      g.bezierCurveTo(20, 80, 34, 60, 46, 48);
      g.bezierCurveTo(48, 64, 56, 70, 62, 72);
      g.bezierCurveTo(56, 50, 58, 30, 64, 8);
      g.fill();
      break;
    case "drop":
      g.beginPath();
      g.moveTo(64, 8);
      g.bezierCurveTo(90, 48, 104, 66, 104, 84);
      g.arc(64, 84, 40, 0, Math.PI);
      g.bezierCurveTo(24, 66, 38, 48, 64, 8);
      g.fill();
      break;
    case "leaf":
      g.beginPath();
      g.moveTo(20, 108);
      g.bezierCurveTo(20, 40, 60, 14, 112, 14);
      g.bezierCurveTo(112, 70, 84, 108, 20, 108);
      g.fill();
      g.strokeStyle = bg;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(26, 102);
      g.quadraticCurveTo(60, 60, 100, 26);
      g.stroke();
      break;
    case "letter":
      g.font = "900 118px Arial Black, Arial, Helvetica, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("R", 66, 70);
      break;
    case "none":
      break;
  }
  return c;
}
