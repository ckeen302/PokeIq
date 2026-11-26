import { COLORS, ellipsis, fitText, loadImage, roundRect, type Fonts } from "@/lib/tier-list/render";

/**
 * The hunt's share picture (1080 × 1350, for posts and stories), drawn on a canvas in the browser: the shiny big on a
 * gold glow, its name, and the hunt's numbers. The Tier List Maker's drawing kit and colours; no watermark beyond the
 * site's name at the foot.
 */

export const CARD = { w: 1080, h: 1350 };
const GOLD = COLORS.gold;

export interface CardText {
  eyebrow: string;
  title: string;
  subtitle: string;
  stats: { label: string; value: string }[];
  footer: string;
}

/** The first of the pictures that loads with CORS (so the canvas can be saved). */
export async function loadFirst(srcs: readonly string[]): Promise<HTMLImageElement | null> {
  for (const s of srcs) {
    const img = await loadImage(s);
    if (img) return img;
  }
  return null;
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = GOLD;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x + r * 0.12, y - r * 0.12, x + r, y);
  g.quadraticCurveTo(x + r * 0.12, y + r * 0.12, x, y + r);
  g.quadraticCurveTo(x - r * 0.12, y + r * 0.12, x - r, y);
  g.quadraticCurveTo(x - r * 0.12, y - r * 0.12, x, y - r);
  g.fill();
  g.restore();
}

export function drawCard(g: CanvasRenderingContext2D, d: CardText, art: HTMLImageElement | null, f: Fonts) {
  const { w: W, h: H } = CARD;
  const pad = 80;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, COLORS.bg2);
  bg.addColorStop(1, COLORS.bg);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // Gold glow and rays behind the shiny.
  const cx = W / 2, cy = 500;
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 520);
  glow.addColorStop(0, "rgba(246,201,74,0.34)");
  glow.addColorStop(0.45, "rgba(246,201,74,0.10)");
  glow.addColorStop(1, "rgba(246,201,74,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.save();
  g.translate(cx, cy);
  for (let i = 0; i < 18; i++) {
    g.rotate((Math.PI * 2) / 18);
    const ray = g.createLinearGradient(0, 0, 0, -520);
    ray.addColorStop(0, "rgba(246,201,74,0.12)");
    ray.addColorStop(1, "rgba(246,201,74,0)");
    g.fillStyle = ray;
    g.beginPath();
    g.moveTo(-14, 0);
    g.lineTo(-46, -520);
    g.lineTo(46, -520);
    g.lineTo(14, 0);
    g.fill();
  }
  g.restore();
  const violet = g.createRadialGradient(W, 0, 0, W, 0, 700);
  violet.addColorStop(0, "rgba(164,126,251,0.22)");
  violet.addColorStop(1, "rgba(164,126,251,0)");
  g.fillStyle = violet;
  g.fillRect(0, 0, W, H);
  g.fillStyle = GOLD;
  g.fillRect(0, 0, W, 10);

  // Eyebrow
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = GOLD;
  g.font = `700 30px ${f.display}`;
  g.fillText(ellipsis(g, d.eyebrow.toUpperCase(), W - pad * 2), cx, 118);

  // The shiny
  if (art?.naturalWidth) {
    const box = 560;
    const pixel = art.src.includes("/sprites/pokemon/shiny/");
    let s = Math.min(box / art.naturalWidth, box / art.naturalHeight);
    if (pixel && s >= 1) s = Math.floor(s);
    const dw = art.naturalWidth * s, dh = art.naturalHeight * s;
    g.save();
    g.imageSmoothingEnabled = !pixel;
    g.imageSmoothingQuality = "high";
    g.shadowColor = "rgba(0,0,0,0.45)";
    g.shadowBlur = 40;
    g.shadowOffsetY = 24;
    g.drawImage(art, cx - dw / 2, cy - dh / 2, dw, dh);
    g.restore();
  }
  star(g, 250, 290, 30, 0.9);
  star(g, 840, 340, 22, 0.75);
  star(g, 200, 660, 16, 0.6);
  star(g, 880, 700, 34, 0.85);
  star(g, 600, 200, 14, 0.55);

  // Title and subtitle
  g.fillStyle = COLORS.text;
  const ts = fitText(g, d.title, W - pad * 2, 84, 700, f.display, 40);
  g.font = `700 ${ts}px ${f.display}`;
  g.fillText(ellipsis(g, d.title, W - pad * 2), cx, 880);
  g.fillStyle = COLORS.muted;
  g.font = `500 32px ${f.body}`;
  g.fillText(ellipsis(g, d.subtitle, W - pad * 2), cx, 934);

  // Stats
  const n = d.stats.length;
  const gap = 18;
  const top = 990;
  const bw = (W - pad * 2 - gap * (n - 1)) / n;
  const bh = 168;
  d.stats.forEach((st, i) => {
    const x = pad + i * (bw + gap);
    roundRect(g, x, top, bw, bh, 28);
    g.fillStyle = "rgba(255,255,255,0.06)";
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.08)";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = COLORS.muted;
    g.font = `600 24px ${f.body}`;
    g.fillText(ellipsis(g, st.label.toUpperCase(), bw - 24), x + bw / 2, top + 58);
    g.fillStyle = i === 0 ? GOLD : COLORS.text;
    const vs = fitText(g, st.value, bw - 28, 52, 700, f.display, 24);
    g.font = `700 ${vs}px ${f.display}`;
    g.fillText(st.value, x + bw / 2, top + 126);
  });

  // Footer
  g.font = `700 34px ${f.display}`;
  const brandW = g.measureText("POKÉIQ").width;
  g.textAlign = "left";
  g.fillStyle = COLORS.text;
  const bx = cx - brandW / 2;
  g.fillText("POKÉ", bx, H - 70);
  g.fillStyle = COLORS.pink;
  g.fillText("IQ", bx + g.measureText("POKÉ").width, H - 70);
  g.textAlign = "center";
  g.fillStyle = COLORS.muted;
  g.font = `500 24px ${f.body}`;
  g.fillText(ellipsis(g, d.footer, W - pad * 2), cx, H - 32);
}
