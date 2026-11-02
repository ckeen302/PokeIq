import { TYPE_COLORS } from "@/lib/pokemon/type-colors";
import { badgeName, dexTag, shadeHex } from "@/lib/sizes/badges";
import { typePath } from "@/lib/sizes/type-icons";
import { MOTION_LABEL } from "@/lib/race/gait";
import { formatGap, formatTime, kmh, type Race, type RaceLane } from "@/lib/race/race";

/**
 * The broadcast graphics, drawn on a 2D canvas so the live page and the
 * exported video share them exactly: the lane introductions (in the Sizes
 * badge style: a red #0000 tag, the blue name banner with its outlined
 * yellow name, and a Speed box where Sizes has its height box), name tags
 * over the runners, the clock bug with the leader's speed, the starter's
 * calls, the fast-forward and replay bugs, the photo-finish image with its
 * time scale, and the results board.
 */

const INK = "#101a2c";

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Outlined game text (the Sizes badges' style). */
export function gameText(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, font: string, fill: string | CanvasGradient, outline = INK, ow = px * 0.2) {
  g.font = `800 ${px}px ${font}`;
  g.lineJoin = "round";
  g.miterLimit = 2;
  g.strokeStyle = outline;
  g.lineWidth = ow;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

const shadow = (g: CanvasRenderingContext2D, blur: number) => { g.shadowColor = "rgba(0,0,0,0.4)"; g.shadowBlur = blur; g.shadowOffsetY = blur * 0.25; };
const noShadow = (g: CanvasRenderingContext2D) => { g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0; };

function fitPx(g: CanvasRenderingContext2D, text: string, px: number, font: string, room: number): number {
  g.font = `800 ${px}px ${font}`;
  const w = g.measureText(text).width;
  return w > room ? px * (room / w) : px;
}

function typeBall(g: CanvasRenderingContext2D, t: string, cx: number, cy: number, d: number, s: number) {
  const col = TYPE_COLORS[t] ?? "#888888";
  shadow(g, s * 0.16);
  g.beginPath();
  g.arc(cx, cy, d / 2, 0, Math.PI * 2);
  const grad = g.createRadialGradient(cx - d * 0.18, cy - d * 0.2, d * 0.05, cx, cy, d * 0.55);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.18, col);
  grad.addColorStop(1, shadeHex(col, -0.38));
  g.fillStyle = grad;
  g.fill();
  noShadow(g);
  g.lineWidth = Math.max(1.5, s * 0.06);
  g.strokeStyle = "#ffffff";
  g.stroke();
  const path = typePath(t);
  if (path) {
    g.save();
    const k = (d * 0.6) / 24;
    g.translate(cx - 12 * k, cy - 12 * k);
    g.scale(k, k);
    g.fillStyle = "#ffffff";
    g.fill(path, "evenodd");
    g.restore();
  }
}

export interface Graphics {
  font: string;
  /** Overall scale (phones and videos use bigger graphics). */
  scale: number;
}

/**
 * The lane introduction: a lower third with the lane number, the #Dex tag,
 * the name banner, the base Speed box and the types. `k` animates it in
 * (0 → 1) and out.
 */
export function drawLaneIntro(g: CanvasRenderingContext2D, W: number, H: number, r: RaceLane, k: number, o: Graphics & { bottom: number }) {
  const e = r.entrant;
  const s = Math.min(W * 0.085, H * 0.07, 64) * o.scale;
  const name = badgeName(e.name);
  const namePx = s * 0.74;
  g.save();
  g.textBaseline = "middle";
  g.textAlign = "center";
  const nameW = Math.min(W * 0.62, fitPx(g, name, namePx, o.font, W) && g.measureText(name).width + s * 1.0);
  const laneW = s * 1.25;
  const spdW = s * 1.9;
  const typesW = e.types.length * s * 1.05;
  const total = laneW + s * 0.15 + Math.max(nameW, s * 3) + s * 0.15 + spdW + (typesW ? s * 0.2 + typesW : 0);
  const room = W - s * 0.6;
  const fit = Math.min(1, room / total);
  g.translate(W / 2, H - o.bottom - s * 1.9 * fit);
  g.scale(fit, fit);
  const ease = 1 - Math.pow(1 - Math.min(1, k * 1.6), 3);
  const out = k > 0.86 ? (k - 0.86) / 0.14 : 0;
  g.globalAlpha = Math.max(0, 1 - out);
  g.translate((1 - ease) * -W * 0.25, out * s * 0.6);
  let x = -total / 2;
  const y = 0;
  // Lane number.
  shadow(g, s * 0.2);
  roundRect(g, x, y, laneW, s * 1.4, s * 0.16);
  g.fillStyle = "#ffffff";
  g.fill();
  noShadow(g);
  g.fillStyle = INK;
  g.font = `800 ${s * 0.95}px ${o.font}`;
  g.fillText(String(r.lane), x + laneW / 2, y + s * 0.62);
  g.font = `800 ${s * 0.2}px ${o.font}`;
  g.fillText("LANE", x + laneW / 2, y + s * 1.18);
  x += laneW + s * 0.15;
  // Dex tag over the banner.
  const tagH = s * 0.48;
  const tag = dexTag(e.species);
  g.font = `800 ${tagH * 0.72}px ${o.font}`;
  const tw = g.measureText(tag).width + tagH * 0.7;
  roundRect(g, x + s * 0.1, y - tagH * 0.62, tw, tagH, tagH * 0.22);
  const gradT = g.createLinearGradient(0, y - tagH, 0, y);
  gradT.addColorStop(0, "#ff5a3c");
  gradT.addColorStop(1, "#c42515");
  g.fillStyle = gradT;
  g.fill();
  g.lineWidth = Math.max(1, s * 0.03);
  g.strokeStyle = "#ffd9cf";
  g.stroke();
  gameText(g, tag, x + s * 0.1 + tw / 2, y - tagH * 0.62 + tagH * 0.53, tagH * 0.72, o.font, "#ffffff", INK, tagH * 0.16);
  // Name banner.
  const bw = Math.max(nameW, s * 3);
  const bh = s * 1.0;
  const by = y + s * 0.2;
  shadow(g, s * 0.22);
  roundRect(g, x, by, bw, bh, s * 0.2);
  const gradB = g.createLinearGradient(0, by, 0, by + bh);
  gradB.addColorStop(0, "#5cc6ff");
  gradB.addColorStop(0.5, "#2b9be8");
  gradB.addColorStop(1, "#1b6fc0");
  g.fillStyle = gradB;
  g.fill();
  noShadow(g);
  g.lineWidth = Math.max(1.5, s * 0.07);
  g.strokeStyle = "#e9f7ff";
  g.stroke();
  roundRect(g, x + s * 0.06, by + s * 0.06, bw - s * 0.12, bh * 0.42, s * 0.14);
  g.fillStyle = "rgba(255,255,255,0.16)";
  g.fill();
  const gradN = g.createLinearGradient(0, by + bh * 0.18, 0, by + bh * 0.82);
  gradN.addColorStop(0, "#fff27a");
  gradN.addColorStop(0.55, "#ffd21f");
  gradN.addColorStop(1, "#ff9d00");
  const px = fitPx(g, name, namePx, o.font, bw - s * 0.6);
  gameText(g, name, x + bw / 2, by + bh * 0.54, px, o.font, gradN, INK, px * 0.22);
  // Under the banner: how it moves and its top speed.
  const sub = `${MOTION_LABEL[e.motion].toUpperCase()} · ${kmh(r.runner.vmax).toFixed(0)} KM/H TOP`;
  const spx = fitPx(g, sub, s * 0.3, o.font, bw);
  gameText(g, sub, x + bw / 2, by + bh + s * 0.32, spx, o.font, "#ffffff", INK, spx * 0.22);
  x += bw + s * 0.15;
  // Speed box.
  const hb = s * 1.4;
  shadow(g, s * 0.2);
  roundRect(g, x, y, spdW, hb, s * 0.16);
  const gradH = g.createLinearGradient(0, y, 0, y + hb);
  gradH.addColorStop(0, "#3a414b");
  gradH.addColorStop(1, "#171b21");
  g.fillStyle = gradH;
  g.fill();
  noShadow(g);
  g.lineWidth = Math.max(1.5, s * 0.06);
  g.strokeStyle = "#eef3f7";
  g.stroke();
  const spe = String(e.stats.spe);
  const npx = fitPx(g, spe, s * 0.78, o.font, spdW * 0.84);
  gameText(g, spe, x + spdW / 2, y + hb * 0.4, npx, o.font, "#ffffff", INK, npx * 0.16);
  const upx = fitPx(g, "BASE SPEED", s * 0.24, o.font, spdW * 0.9);
  gameText(g, "BASE SPEED", x + spdW / 2, y + hb * 0.78, upx, o.font, "#ffd21f", INK, upx * 0.2);
  x += spdW + s * 0.2;
  // Types.
  e.types.forEach((t, i) => {
    const d = s * 0.9;
    typeBall(g, t, x + i * s * 1.05 + d / 2, y + d / 2 + s * 0.05, d, s);
    const label = t.toUpperCase();
    const lpx = fitPx(g, label, s * 0.27, o.font, s * 1.0);
    gameText(g, label, x + i * s * 1.05 + d / 2, y + d + s * 0.3, lpx, o.font, shadeHex(TYPE_COLORS[t] ?? "#888888", 0.25), INK, lpx * 0.24);
  });
  g.restore();
}

/** Small name tags over the runners during the race: lane box and name. */
export function drawNameTags(g: CanvasRenderingContext2D, tags: { lane: number; name: string; x: number; y: number; lead: boolean }[], o: Graphics) {
  const s = 15 * o.scale;
  g.save();
  g.textBaseline = "middle";
  g.textAlign = "left";
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  // Keep tags inside the frame (the canvas may be drawn at device scale).
  const cw = g.canvas.width / (g.getTransform().a || 1);
  for (const t of [...tags].sort((a, b) => Number(b.lead) - Number(a.lead))) {
    const name = badgeName(t.name);
    g.font = `800 ${s}px ${o.font}`;
    const nw = g.measureText(name).width;
    const w = s * 1.5 + nw + s * 0.8, h = s * 1.55;
    const x = Math.max(4, Math.min(cw - w - 4, t.x - w / 2));
    let y = t.y - h - s * 0.5;
    // Nudge up once past a tag already placed; in a tight pack, leave the rest untagged (the leader's tag goes first).
    const hits = (yy: number) => placed.find((p) => x < p.x + p.w && x + w > p.x && yy < p.y + p.h && yy + h > p.y);
    const hit = hits(y);
    if (hit) y = hit.y - h - 2;
    if (hit && hits(y)) continue;
    placed.push({ x, y, w, h });
    shadow(g, 6);
    roundRect(g, x, y, w, h, 4);
    g.fillStyle = t.lead ? "rgba(255,210,31,0.95)" : "rgba(10,18,40,0.82)";
    g.fill();
    noShadow(g);
    roundRect(g, x + 3, y + 3, s * 1.2, h - 6, 3);
    g.fillStyle = t.lead ? INK : "#ffffff";
    g.fill();
    g.fillStyle = t.lead ? "#ffd21f" : INK;
    g.textAlign = "center";
    g.font = `800 ${s * 0.95}px ${o.font}`;
    g.fillText(String(t.lane), x + 3 + s * 0.6, y + h / 2 + 1);
    g.textAlign = "left";
    g.fillStyle = t.lead ? INK : "#ffffff";
    g.font = `800 ${s}px ${o.font}`;
    g.fillText(name, x + s * 1.5 + s * 0.15, y + h / 2 + 1);
  }
  g.restore();
}

/** The clock bug, top left: race and distance, the running time and the leader's speed. */
export function drawClockBug(g: CanvasRenderingContext2D, W: number, H: number, o: Graphics & { top: number; title: string; time: string; leader?: { name: string; v: number } | null; live: boolean }) {
  const s = Math.min(W * 0.05, 26) * o.scale;
  const x = Math.max(12, W * 0.02), y = o.top;
  g.save();
  g.textBaseline = "middle";
  const title = o.title.toUpperCase();
  g.font = `800 ${s * 0.62}px ${o.font}`;
  const tw = Math.min(W * 0.5, g.measureText(title).width + s * 1.2);
  shadow(g, 8);
  roundRect(g, x, y, tw, s * 1.25, 4);
  g.fillStyle = "rgba(10,18,40,0.88)";
  g.fill();
  noShadow(g);
  g.fillStyle = "#ffd21f";
  g.fillRect(x, y, s * 0.22, s * 1.25);
  g.fillStyle = "#ffffff";
  g.textAlign = "left";
  g.font = `800 ${fitPx(g, title, s * 0.62, o.font, tw - s * 0.8)}px ${o.font}`;
  g.fillText(title, x + s * 0.5, y + s * 0.65);
  const cy = y + s * 1.25 + 4;
  const cw = s * 4.6;
  shadow(g, 8);
  roundRect(g, x, cy, cw, s * 1.7, 4);
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.fill();
  noShadow(g);
  g.fillStyle = INK;
  g.textAlign = "right";
  g.font = `800 ${s * 1.25}px ${o.font}`;
  g.fillText(o.time, x + cw - s * 0.35, cy + s * 0.9);
  if (o.live) {
    g.fillStyle = "#e0262b";
    g.beginPath();
    g.arc(x + s * 0.45, cy + s * 0.85, s * 0.17, 0, Math.PI * 2);
    g.fill();
  }
  if (o.leader && o.leader.v > 0.05) {
    const lw = s * 6.2;
    const lx = x + cw + 4;
    shadow(g, 8);
    roundRect(g, lx, cy, lw, s * 1.7, 4);
    g.fillStyle = "rgba(10,18,40,0.86)";
    g.fill();
    noShadow(g);
    g.textAlign = "left";
    g.fillStyle = "#9fd8ff";
    g.font = `800 ${s * 0.42}px ${o.font}`;
    g.fillText(badgeName(o.leader.name).slice(0, 18), lx + s * 0.35, cy + s * 0.45);
    g.fillStyle = "#ffffff";
    g.font = `800 ${s * 0.78}px ${o.font}`;
    g.fillText(`${kmh(o.leader.v).toFixed(1)} km/h`, lx + s * 0.35, cy + s * 1.15);
  }
  g.restore();
}

/** "On your marks…", "Set…", the gun. */
export function drawStartCall(g: CanvasRenderingContext2D, W: number, H: number, text: string, k: number, o: Graphics) {
  const s = Math.min(W * 0.09, 72) * o.scale;
  g.save();
  g.globalAlpha = Math.min(1, k * 4, (1 - k) * 4 + 0.2);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const fill = g.createLinearGradient(0, H * 0.3 - s, 0, H * 0.3 + s);
  fill.addColorStop(0, "#fff27a");
  fill.addColorStop(1, "#ffb000");
  const px = fitPx(g, text, s, o.font, W * 0.9);
  gameText(g, text, W / 2, H * 0.3, px, o.font, fill, "#0d1626", px * 0.16);
  g.restore();
}

/** The fast-forward bug: "▶▶ ×42", with a caption about who the camera follows. */
export function drawFastForward(g: CanvasRenderingContext2D, W: number, H: number, rate: number, caption: string, o: Graphics & { top: number }) {
  const s = Math.min(W * 0.06, 34) * o.scale;
  g.save();
  g.textBaseline = "middle";
  g.textAlign = "right";
  const txt = `▶▶ ×${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}`;
  g.font = `800 ${s}px ${o.font}`;
  const w = g.measureText(txt).width + s;
  const x = Math.max(12, W * 0.02) + w, y = o.top;
  shadow(g, 8);
  roundRect(g, x - w, y, w, s * 1.5, 6);
  g.fillStyle = "rgba(224,38,43,0.92)";
  g.fill();
  noShadow(g);
  g.fillStyle = "#ffffff";
  g.fillText(txt, x - s * 0.5, y + s * 0.78);
  if (caption) {
    const cpx = fitPx(g, caption, s * 0.62, o.font, W * 0.8);
    g.textAlign = "center";
    gameText(g, caption, W / 2, H * 0.78, cpx, o.font, "#ffffff", "#0d1626", cpx * 0.2);
  }
  g.restore();
}

/** The replay bug. */
export function drawReplayBug(g: CanvasRenderingContext2D, W: number, H: number, o: Graphics & { top: number }) {
  const s = Math.min(W * 0.05, 26) * o.scale;
  g.save();
  g.textBaseline = "middle";
  g.textAlign = "center";
  const x = Math.max(12, W * 0.02), y = o.top;
  shadow(g, 8);
  roundRect(g, x, y, s * 4.2, s * 1.4, 4);
  g.fillStyle = "rgba(255,210,31,0.95)";
  g.fill();
  noShadow(g);
  g.fillStyle = INK;
  g.font = `800 ${s * 0.72}px ${o.font}`;
  g.fillText("REPLAY", x + s * 2.1, y + s * 0.72);
  g.restore();
}

/**
 * The photo-finish image: the slit-scan of the finish line, time running
 * left to right, with a hairline at each runner's crossing (lane and time)
 * and the time scale underneath.
 */
export function drawPhotoFinish(g: CanvasRenderingContext2D, W: number, H: number, img: CanvasImageSource & { width: number; height: number }, race: Race, win: { from: number; to: number }, k: number, o: Graphics & { top: number; bottom: number }) {
  const pad = Math.max(10, W * 0.03);
  const titleH = Math.min(44, W * 0.07) * o.scale;
  const availW = W - pad * 2, availH = H - o.top - o.bottom - titleH - 40 * o.scale;
  const ar = img.width / img.height;
  let iw = availW, ih = iw / ar;
  if (ih > availH) { ih = availH; iw = ih * ar; }
  const x = (W - iw) / 2, y = o.top + titleH + (availH - ih) / 2;
  g.save();
  const a = Math.min(1, k * 3);
  g.globalAlpha = a;
  g.fillStyle = "rgba(4,7,15,0.72)";
  g.fillRect(0, 0, W, H);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const tpx = titleH * 0.62;
  gameText(g, "PHOTO FINISH", W / 2, y - titleH * 0.6, tpx, o.font, "#ffd21f", "#0d1626", tpx * 0.18);
  shadow(g, 18);
  g.drawImage(img, x, y, iw, ih);
  noShadow(g);
  g.strokeStyle = "rgba(255,255,255,0.8)";
  g.lineWidth = 1.5;
  g.strokeRect(x, y, iw, ih);
  const tx = (t: number) => x + ((t - win.from) / (win.to - win.from)) * iw;
  // Time scale: ticks every 0.01 s, labels every 0.1 s.
  const span = win.to - win.from;
  const step = span > 3 ? 0.5 : span > 1.2 ? 0.1 : 0.05;
  const minor = step / 5;
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.font = `700 ${11 * o.scale}px ${o.font}`;
  for (let t = Math.ceil(win.from / minor) * minor; t <= win.to; t += minor) {
    const px = tx(t);
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    g.fillRect(px, y + ih, 1, major ? 9 : 4);
    if (major) g.fillText(formatTime(t, 2), px, y + ih + 20 * o.scale);
  }
  // Crossings.
  const reveal = Math.min(1, Math.max(0, (k - 0.15) / 0.6));
  race.order.forEach((r, i) => {
    if (r.time < win.from || r.time > win.to) return;
    if (i / Math.max(1, race.order.length) > reveal) return;
    const px = tx(r.time);
    g.strokeStyle = i === 0 ? "#ffd21f" : "rgba(255,255,255,0.9)";
    g.lineWidth = i === 0 ? 2 : 1;
    g.beginPath();
    g.moveTo(px, y);
    g.lineTo(px, y + ih);
    g.stroke();
    const label = `${r.lane} · ${formatTime(r.time, 3)}`;
    g.font = `800 ${12 * o.scale}px ${o.font}`;
    const lw = g.measureText(label).width + 10;
    const ly = y + 6 + (i % 3) * 18 * o.scale;
    roundRect(g, px - lw / 2, ly, lw, 16 * o.scale, 3);
    g.fillStyle = i === 0 ? "#ffd21f" : "rgba(10,18,40,0.9)";
    g.fill();
    g.fillStyle = i === 0 ? INK : "#ffffff";
    g.fillText(label, px, ly + 8.5 * o.scale);
  });
  // The next finisher, still to come beyond the right edge (bottom corner, clear of the crossing labels).
  const next = race.order.find((r) => r.time > win.to);
  if (next && reveal > 0.5) {
    const label = `${next.lane} · ${formatTime(next.time, 3)}`;
    g.font = `800 ${12 * o.scale}px ${o.font}`;
    const lw = g.measureText(label).width + 10;
    const ah = 16 * o.scale, aw = ah * 0.55;
    const lx = x + iw - 6 - aw - lw, ly = y + ih - 6 - ah;
    roundRect(g, lx, ly, lw + aw + 2, ah, 3);
    g.fillStyle = "rgba(10,18,40,0.9)";
    g.fill();
    g.fillStyle = "#ffffff";
    g.fillText(label, lx + lw / 2, ly + 8.5 * o.scale);
    g.beginPath();
    g.moveTo(lx + lw - 1, ly + ah * 0.25);
    g.lineTo(lx + lw - 1 + aw * 0.75, ly + ah / 2);
    g.lineTo(lx + lw - 1, ly + ah * 0.75);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** The results board (video and canvas): place, lane, name, time, gap, base Speed. */
export function drawResults(g: CanvasRenderingContext2D, W: number, H: number, race: Race, times: Map<RaceLane, string>, title: string, k: number, o: Graphics & { top: number; bottom: number }) {
  const rows = race.order;
  const pad = Math.max(12, W * 0.04);
  const rowH = Math.min(58 * o.scale, (H - o.top - o.bottom - 90 * o.scale) / Math.max(rows.length, 1));
  const w = Math.min(W - pad * 2, 760 * o.scale);
  const x = (W - w) / 2;
  const total = rowH * rows.length + 70 * o.scale;
  const y0 = o.top + Math.max(0, (H - o.top - o.bottom - total) / 2);
  g.save();
  g.globalAlpha = Math.min(1, k * 3);
  g.fillStyle = "rgba(4,7,15,0.55)";
  g.fillRect(0, 0, W, H);
  shadow(g, 20);
  roundRect(g, x, y0, w, total, 10 * o.scale);
  g.fillStyle = "rgba(8,14,32,0.94)";
  g.fill();
  noShadow(g);
  g.fillStyle = "#ffd21f";
  g.fillRect(x, y0, w, 6 * o.scale);
  g.textBaseline = "middle";
  g.textAlign = "left";
  const hpx = fitPx(g, title.toUpperCase(), 22 * o.scale, o.font, w - 40);
  gameText(g, title.toUpperCase(), x + 18 * o.scale, y0 + 34 * o.scale, hpx, o.font, "#ffffff", "#0d1626", hpx * 0.15);
  const cols = { place: x + 16 * o.scale, lane: x + w * 0.12, name: x + w * 0.2, time: x + w * 0.72, gap: x + w * 0.86, spe: x + w - 14 * o.scale };
  rows.forEach((r, i) => {
    const reveal = Math.min(1, Math.max(0, k * (rows.length + 2) - i));
    if (reveal <= 0) return;
    const y = y0 + 64 * o.scale + i * rowH;
    g.globalAlpha = Math.min(1, k * 3) * reveal;
    if (i % 2 === 0) { g.fillStyle = "rgba(255,255,255,0.05)"; g.fillRect(x + 6, y, w - 12, rowH); }
    const mid = y + rowH / 2;
    const px = Math.min(rowH * 0.42, 24 * o.scale);
    const medal = ["#ffd21f", "#d9e1ea", "#e6a15c"][r.place - 1];
    if (medal) {
      g.fillStyle = medal;
      g.beginPath();
      g.arc(cols.place + px * 0.6, mid, px * 0.62, 0, Math.PI * 2);
      g.fill();
    }
    g.textAlign = "center";
    g.fillStyle = medal ? INK : "#ffffff";
    g.font = `800 ${px * 0.86}px ${o.font}`;
    g.fillText(String(r.place), cols.place + px * 0.6, mid + 1);
    g.fillStyle = "rgba(255,255,255,0.6)";
    g.font = `700 ${px * 0.7}px ${o.font}`;
    g.fillText(String(r.lane), cols.lane, mid + 1);
    g.textAlign = "left";
    g.fillStyle = "#ffffff";
    const nm = badgeName(r.entrant.name);
    g.font = `800 ${fitPx(g, nm, px * 0.86, o.font, cols.time - cols.name - 16)}px ${o.font}`;
    g.fillText(nm, cols.name, mid + 1);
    g.textAlign = "right";
    g.fillStyle = r.place === 1 ? "#ffd21f" : "#ffffff";
    g.font = `800 ${px * 0.86}px ${o.font}`;
    g.fillText(times.get(r) ?? formatTime(r.time), cols.time + w * 0.08, mid + 1);
    g.fillStyle = "rgba(255,255,255,0.6)";
    g.font = `700 ${px * 0.62}px ${o.font}`;
    const gap = formatGap(r.gap);
    if (W > 520 || !gap.includes(":")) g.fillText(gap, cols.gap + w * 0.06, mid + 1);
    g.fillStyle = "#9fd8ff";
    g.font = `800 ${px * 0.7}px ${o.font}`;
    g.fillText(`${r.entrant.stats.spe}`, cols.spe, mid + 1);
  });
  g.globalAlpha = Math.min(1, k * 3);
  g.textAlign = "right";
  g.fillStyle = "rgba(255,255,255,0.45)";
  g.font = `700 ${11 * o.scale}px ${o.font}`;
  g.fillText("SPEED = BASE SPEED", x + w - 14 * o.scale, y0 + 34 * o.scale);
  g.restore();
}
