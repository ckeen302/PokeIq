/**
 * Sticker glyphs: a symbol for each type (our own simple drawings, not the games' icons), a few emblems, and the
 * letters and digits. Drawn white into one 8 × 8 atlas canvas in the browser; the ball's shader tints and places
 * them, so a sticker is a glyph number, a place, a size, a turn and a colour.
 */

export const TYPE_GLYPHS = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"] as const;
export const SYMBOL_GLYPHS = ["star", "heart", "crown", "sparkle", "moon", "sun", "paw", "note", "shield", "gem"] as const;
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const DIGITS = "0123456789";

export const GLYPH_COUNT = TYPE_GLYPHS.length + SYMBOL_GLYPHS.length + LETTERS.length + DIGITS.length;
export const ATLAS_GRID = 8;
export const GLYPH_PX = 128;

export const glyphIndex = {
  type: (t: string) => Math.max(0, TYPE_GLYPHS.indexOf(t as (typeof TYPE_GLYPHS)[number])),
  symbol: (s: (typeof SYMBOL_GLYPHS)[number]) => TYPE_GLYPHS.length + SYMBOL_GLYPHS.indexOf(s),
  letter: (c: string) => TYPE_GLYPHS.length + SYMBOL_GLYPHS.length + Math.max(0, LETTERS.indexOf(c.toUpperCase())),
  digit: (c: string) => TYPE_GLYPHS.length + SYMBOL_GLYPHS.length + LETTERS.length + Math.max(0, DIGITS.indexOf(c)),
};

/** What a glyph is, for its label: a type, a symbol, or a character. */
export function glyphInfo(i: number): { kind: "type" | "symbol" | "char"; key: string } {
  if (i < TYPE_GLYPHS.length) return { kind: "type", key: TYPE_GLYPHS[i] };
  i -= TYPE_GLYPHS.length;
  if (i < SYMBOL_GLYPHS.length) return { kind: "symbol", key: SYMBOL_GLYPHS[i] };
  i -= SYMBOL_GLYPHS.length;
  return { kind: "char", key: (LETTERS + DIGITS)[i] ?? "A" };
}

type Ctx = CanvasRenderingContext2D;

function star(g: Ctx, cx: number, cy: number, r: number, inner: number, points = 5, turn = -Math.PI / 2) {
  g.beginPath();
  for (let k = 0; k < points * 2; k++) {
    const a = turn + (k * Math.PI) / points;
    const rr = k % 2 ? r * inner : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

function heart(g: Ctx, cx: number, cy: number, s: number) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.9);
  g.bezierCurveTo(cx - s * 1.2, cy + s * 0.1, cx - s * 1.0, cy - s * 0.95, cx, cy - s * 0.35);
  g.bezierCurveTo(cx + s * 1.0, cy - s * 0.95, cx + s * 1.2, cy + s * 0.1, cx, cy + s * 0.9);
  g.fill();
}

function crescent(g: Ctx, cx: number, cy: number, r: number) {
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.arc(cx + r * 0.45, cy - r * 0.25, r * 0.85, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Draws glyph `i` in white, centred in a box of `s` pixels at (x, y). */
export function drawGlyph(g: Ctx, i: number, x: number, y: number, s: number, font: string) {
  const info = glyphInfo(i);
  g.save();
  g.translate(x, y);
  g.scale(s / 128, s / 128);
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.lineCap = "round";
  g.lineJoin = "round";
  const c = 64;
  if (info.kind === "char") {
    g.font = `800 104px ${font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const m = g.measureText(info.key);
    const asc = m.actualBoundingBoxAscent || 74, desc = m.actualBoundingBoxDescent || 0;
    g.fillText(info.key, c, c + (asc - desc) / 2, 112);
    g.restore();
    return;
  }
  switch (info.key) {
    case "normal":
      g.lineWidth = 16;
      g.beginPath();
      g.arc(c, c, 38, 0, Math.PI * 2);
      g.stroke();
      break;
    case "fire":
      g.beginPath();
      g.moveTo(c, 10);
      g.bezierCurveTo(c + 40, 44, c + 46, 70, c + 34, 96);
      g.bezierCurveTo(c + 24, 118, c - 24, 118, c - 34, 96);
      g.bezierCurveTo(c - 44, 72, c - 30, 54, c - 18, 44);
      g.bezierCurveTo(c - 16, 60, c - 8, 66, c, 68);
      g.bezierCurveTo(c - 6, 46, c - 4, 26, c, 10);
      g.fill();
      break;
    case "water":
      g.beginPath();
      g.moveTo(c, 10);
      g.bezierCurveTo(c + 30, 50, c + 40, 66, c + 40, 82);
      g.arc(c, 82, 40, 0, Math.PI);
      g.bezierCurveTo(c - 40, 66, c - 30, 50, c, 10);
      g.fill();
      break;
    case "grass":
      g.beginPath();
      g.moveTo(c - 40, 104);
      g.bezierCurveTo(c - 50, 40, c + 10, 12, c + 46, 16);
      g.bezierCurveTo(c + 50, 60, c + 10, 110, c - 40, 104);
      g.fill();
      g.save();
      g.globalCompositeOperation = "destination-out";
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(c - 34, 98);
      g.quadraticCurveTo(c, 60, c + 36, 26);
      g.stroke();
      g.restore();
      break;
    case "electric":
      g.beginPath();
      g.moveTo(c + 14, 8);
      g.lineTo(c - 34, 72);
      g.lineTo(c - 2, 72);
      g.lineTo(c - 14, 120);
      g.lineTo(c + 36, 52);
      g.lineTo(c + 4, 52);
      g.closePath();
      g.fill();
      break;
    case "ice":
      g.lineWidth = 11;
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3;
        const dx = Math.cos(a) * 50, dy = Math.sin(a) * 50;
        g.beginPath();
        g.moveTo(c - dx, c - dy);
        g.lineTo(c + dx, c + dy);
        g.stroke();
        for (const sgn of [-1, 1]) {
          const bx = c + sgn * dx * 0.62, by = c + sgn * dy * 0.62;
          for (const side of [-1, 1]) {
            const b = a + side * 0.8 + (sgn < 0 ? Math.PI : 0);
            g.beginPath();
            g.moveTo(bx, by);
            g.lineTo(bx + Math.cos(b) * 18, by + Math.sin(b) * 18);
            g.stroke();
          }
        }
      }
      break;
    case "fighting":
      // An impact burst.
      star(g, c, c, 56, 0.55, 8, -Math.PI / 2 + 0.2);
      break;
    case "poison":
      for (const [x, y, r] of [[c - 18, 78, 28], [c + 24, 58, 22], [c - 6, 32, 14]] as const) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case "ground":
      g.beginPath();
      g.moveTo(c - 56, 100);
      g.lineTo(c - 14, 34);
      g.lineTo(c + 6, 62);
      g.lineTo(c + 22, 44);
      g.lineTo(c + 56, 100);
      g.closePath();
      g.fill();
      break;
    case "flying":
      g.beginPath();
      g.moveTo(c - 50, 96);
      g.bezierCurveTo(c - 40, 40, c + 10, 16, c + 52, 18);
      g.bezierCurveTo(c + 40, 34, c + 30, 40, c + 34, 46);
      g.bezierCurveTo(c + 20, 52, c + 14, 58, c + 18, 64);
      g.bezierCurveTo(c + 4, 70, c - 2, 76, c, 84);
      g.bezierCurveTo(c - 18, 86, c - 34, 90, c - 50, 96);
      g.fill();
      break;
    case "psychic":
      g.lineWidth = 12;
      g.beginPath();
      for (let k = 0; k <= 80; k++) {
        const a = k * 0.16, rr = 4 + k * 0.6;
        g.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
      }
      g.stroke();
      break;
    case "bug":
      g.beginPath();
      g.ellipse(c, 74, 38, 44, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(c - 10, 32);
      g.lineTo(c - 26, 10);
      g.moveTo(c + 10, 32);
      g.lineTo(c + 26, 10);
      g.stroke();
      g.save();
      g.globalCompositeOperation = "destination-out";
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(c, 32);
      g.lineTo(c, 118);
      g.stroke();
      g.restore();
      break;
    case "rock":
      g.beginPath();
      g.moveTo(c - 44, 96);
      g.lineTo(c - 52, 58);
      g.lineTo(c - 22, 26);
      g.lineTo(c + 22, 22);
      g.lineTo(c + 52, 54);
      g.lineTo(c + 42, 98);
      g.closePath();
      g.fill();
      break;
    case "ghost":
      g.beginPath();
      g.moveTo(c - 40, 110);
      g.lineTo(c - 40, 56);
      g.arc(c, 56, 40, Math.PI, 0);
      g.lineTo(c + 40, 110);
      for (let k = 0; k < 4; k++) g.quadraticCurveTo(c + 30 - k * 20, 94, c + 20 - k * 20, 110);
      g.closePath();
      g.fill();
      g.save();
      g.globalCompositeOperation = "destination-out";
      for (const x of [c - 15, c + 15]) {
        g.beginPath();
        g.ellipse(x, 56, 7, 11, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      break;
    case "dragon":
      // A fang.
      g.beginPath();
      g.moveTo(c - 40, 18);
      g.bezierCurveTo(c + 30, 18, c + 44, 60, c + 10, 116);
      g.bezierCurveTo(c + 12, 70, c - 6, 46, c - 40, 18);
      g.fill();
      break;
    case "dark":
      crescent(g, c - 4, c, 50);
      break;
    case "steel":
      g.beginPath();
      for (let k = 0; k < 6; k++) g.lineTo(c + Math.cos((k * Math.PI) / 3) * 52, c + Math.sin((k * Math.PI) / 3) * 52);
      g.closePath();
      g.fill();
      g.save();
      g.globalCompositeOperation = "destination-out";
      g.beginPath();
      g.arc(c, c, 20, 0, Math.PI * 2);
      g.fill();
      g.restore();
      break;
    case "fairy":
      star(g, c - 6, c + 6, 50, 0.3, 4);
      star(g, c + 36, 28, 16, 0.35, 4);
      break;
    case "star":
      star(g, c, c + 4, 58, 0.46);
      break;
    case "heart":
      heart(g, c, c - 4, 56);
      break;
    case "crown":
      g.beginPath();
      g.moveTo(c - 52, 100);
      g.lineTo(c - 56, 34);
      g.lineTo(c - 26, 62);
      g.lineTo(c, 24);
      g.lineTo(c + 26, 62);
      g.lineTo(c + 56, 34);
      g.lineTo(c + 52, 100);
      g.closePath();
      g.fill();
      break;
    case "sparkle":
      star(g, c, c, 60, 0.22, 4);
      break;
    case "moon":
      crescent(g, c - 6, c + 2, 48);
      break;
    case "sun":
      g.beginPath();
      g.arc(c, c, 30, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 10;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        g.beginPath();
        g.moveTo(c + Math.cos(a) * 42, c + Math.sin(a) * 42);
        g.lineTo(c + Math.cos(a) * 58, c + Math.sin(a) * 58);
        g.stroke();
      }
      break;
    case "paw":
      g.beginPath();
      g.ellipse(c, 82, 30, 25, 0, 0, Math.PI * 2);
      g.fill();
      for (const [x, y] of [[c - 40, 50], [c - 15, 30], [c + 15, 30], [c + 40, 50]] as const) {
        g.beginPath();
        g.ellipse(x, y, 12, 15, 0, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case "note":
      g.beginPath();
      g.ellipse(c - 18, 94, 22, 16, -0.4, 0, Math.PI * 2);
      g.fill();
      g.fillRect(c - 1, 18, 10, 78);
      g.beginPath();
      g.moveTo(c + 9, 18);
      g.quadraticCurveTo(c + 40, 30, c + 34, 58);
      g.quadraticCurveTo(c + 30, 40, c + 9, 40);
      g.fill();
      break;
    case "shield":
      g.beginPath();
      g.moveTo(c, 10);
      g.lineTo(c + 48, 26);
      g.bezierCurveTo(c + 48, 76, c + 30, 104, c, 118);
      g.bezierCurveTo(c - 30, 104, c - 48, 76, c - 48, 26);
      g.closePath();
      g.fill();
      break;
    case "gem":
      g.beginPath();
      g.moveTo(c - 50, 46);
      g.lineTo(c - 26, 18);
      g.lineTo(c + 26, 18);
      g.lineTo(c + 50, 46);
      g.lineTo(c, 112);
      g.closePath();
      g.fill();
      g.save();
      g.globalCompositeOperation = "destination-out";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(c - 50, 46);
      g.lineTo(c + 50, 46);
      g.stroke();
      g.restore();
      break;
  }
  g.restore();
}

/** The whole atlas on a canvas (white glyphs on transparent). */
export function drawAtlas(font: string, size = ATLAS_GRID * GLYPH_PX): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  const cell = size / ATLAS_GRID;
  for (let i = 0; i < GLYPH_COUNT; i++) {
    const x = (i % ATLAS_GRID) * cell, y = Math.floor(i / ATLAS_GRID) * cell;
    // A little margin so neighbours never bleed into each other's mips.
    drawGlyph(g, i, x + cell * 0.06, y + cell * 0.06, cell * 0.88, font);
  }
  return cv;
}
