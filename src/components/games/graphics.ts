import { badgeName, dexTag } from "@/lib/sizes/badges";
import { drawClockBug, drawFastForward, drawLaneIntro, drawNameTags, drawPhotoFinish, drawReplayBug, drawStartCall, gameText, roundRect, type Rect } from "@/components/race/graphics";
import { leaderAt, formatTime, spotsAt } from "@/lib/race/race";
import { raceTimeAt, shotAt, shotProgress } from "@/lib/race/broadcast";
import type { Athlete } from "@/lib/games/athlete";
import type { Overlay, Show } from "./show/types";
import type { SprintExtras } from "./show/sprint";

/**
 * The broadcast graphics of the Games, drawn on a 2D canvas so the page and
 * the exported video share them exactly. The sprints use the Race's own
 * graphics (lane intros, the clock bug, the start calls, the photo finish);
 * every other event draws the show's overlay: the event bug, the title
 * card, lower thirds with the stats that matter, the big mark ("8.21 m",
 * "FOUL", "NEW LEADER"), the live results board, the replay bug, the
 * commentary line and name tags.
 */

const INK = "#101a2c";

export interface Gfx {
  font: string;
  scale: number;
  /** Space taken by the page's bars (px). */
  top: number;
  bottom: number;
  phone: boolean;
  /** Areas the name tags keep out of (the camera controls). */
  avoid?: Rect[];
}

const shadow = (g: CanvasRenderingContext2D, blur: number) => { g.shadowColor = "rgba(0,0,0,0.4)"; g.shadowBlur = blur; g.shadowOffsetY = blur * 0.25; };
const noShadow = (g: CanvasRenderingContext2D) => { g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0; };

function fit(g: CanvasRenderingContext2D, text: string, px: number, font: string, room: number): number {
  g.font = `800 ${px}px ${font}`;
  const w = g.measureText(text).width;
  return w > room ? px * (room / w) : px;
}

const easeOut = (k: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);

/** The corner bug: the event and its round. Returns its area. */
export function drawBug(g: CanvasRenderingContext2D, W: number, title: string, sub: string, o: Gfx): Rect {
  const s = Math.min(W * 0.05, 24) * o.scale;
  const x = Math.max(12, W * 0.02), y = o.top;
  g.save();
  g.textBaseline = "middle";
  g.textAlign = "left";
  const t = title.toUpperCase(), u = sub.toUpperCase();
  g.font = `800 ${s * 0.62}px ${o.font}`;
  const w1 = g.measureText(t).width;
  g.font = `800 ${s * 0.5}px ${o.font}`;
  const w2 = u ? g.measureText(u).width : 0;
  const w = Math.min(W * 0.62, Math.max(w1, w2) + s * 1.3);
  const h = u ? s * 1.85 : s * 1.25;
  shadow(g, 8);
  roundRect(g, x, y, w, h, 4);
  g.fillStyle = "rgba(10,18,40,0.88)";
  g.fill();
  noShadow(g);
  g.fillStyle = "#ffd21f";
  g.fillRect(x, y, s * 0.22, h);
  g.fillStyle = "#ffffff";
  g.font = `800 ${fit(g, t, s * 0.62, o.font, w - s * 0.8)}px ${o.font}`;
  g.fillText(t, x + s * 0.5, y + s * 0.62);
  if (u) {
    g.fillStyle = "#ffd21f";
    g.font = `800 ${fit(g, u, s * 0.48, o.font, w - s * 0.8)}px ${o.font}`;
    g.fillText(u, x + s * 0.5, y + s * 1.35);
  }
  g.restore();
  return { x: x - 4, y: y - 4, w: w + 8, h: h + 8 };
}

/** The opening card: big gradient letters, a line under them. */
export function drawTitle(g: CanvasRenderingContext2D, W: number, H: number, text: string, sub: string, k: number, o: Gfx) {
  const a = Math.min(1, k * 4, (1 - k) * 5);
  g.save();
  g.globalAlpha = Math.max(0, a);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const big = Math.min(W * 0.1, 76) * o.scale * 0.9;
  const words = text.toUpperCase();
  const px = fit(g, words, big, o.font, W * 0.9);
  const y = H * 0.36;
  const fill = g.createLinearGradient(0, y - px, 0, y + px);
  fill.addColorStop(0, "#fff27a");
  fill.addColorStop(1, "#ffb000");
  g.translate(0, (1 - easeOut(k * 3)) * 14);
  gameText(g, words, W / 2, y, px, o.font, fill, "#0d1626", px * 0.18);
  if (sub) {
    const spx = fit(g, sub.toUpperCase(), Math.min(W * 0.042, 24) * o.scale, o.font, W * 0.86);
    gameText(g, sub.toUpperCase(), W / 2, y + px * 0.95, spx, o.font, "#9fd8ff", "#0d1626", spx * 0.2);
  }
  g.restore();
}

/** A lower third: the Sizes-style name banner with the #Dex tag, the stat line under it, the attempt tag. */
export function drawLower(g: CanvasRenderingContext2D, W: number, H: number, a: Athlete | undefined, name: string, line: string, tag: string | undefined, k: number, o: Gfx) {
  const s = Math.min(W * 0.075, H * 0.065, 54) * o.scale;
  const nm = badgeName(name);
  g.save();
  g.textBaseline = "middle";
  g.textAlign = "center";
  const namePx = s * 0.74;
  g.font = `800 ${namePx}px ${o.font}`;
  const bw = Math.min(W * 0.8, Math.max(s * 3.2, g.measureText(nm).width + s * 1.1));
  const tagW = tag ? Math.max(s * 2.1, (g.font = `800 ${s * 0.36}px ${o.font}`, g.measureText(tag.toUpperCase()).width + s * 0.8)) : 0;
  const total = bw + (tag ? tagW + s * 0.15 : 0);
  const fitK = Math.min(1, (W - s * 0.6) / total);
  const ease = easeOut(k * 1.8);
  const out = k > 0.88 ? (k - 0.88) / 0.12 : 0;
  g.translate(W / 2, H - o.bottom - s * 1.9 * fitK);
  g.scale(fitK, fitK);
  g.globalAlpha = Math.max(0, 1 - out);
  g.translate((1 - ease) * -W * 0.2, out * s * 0.5);
  let x = -total / 2;
  const y = 0;
  if (a) {
    const tagH = s * 0.48;
    const dt = dexTag(a.entrant.species);
    g.font = `800 ${tagH * 0.72}px ${o.font}`;
    const tw = g.measureText(dt).width + tagH * 0.7;
    roundRect(g, x + s * 0.1, y - tagH * 0.42, tw, tagH, tagH * 0.22);
    const gradT = g.createLinearGradient(0, y - tagH, 0, y);
    gradT.addColorStop(0, "#ff5a3c");
    gradT.addColorStop(1, "#c42515");
    g.fillStyle = gradT;
    g.fill();
    gameText(g, dt, x + s * 0.1 + tw / 2, y - tagH * 0.42 + tagH * 0.53, tagH * 0.72, o.font, "#ffffff", INK, tagH * 0.16);
  }
  const bh = s;
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
  const px = fit(g, nm, namePx, o.font, bw - s * 0.6);
  gameText(g, nm, x + bw / 2, by + bh * 0.54, px, o.font, gradN, INK, px * 0.22);
  const sub = line.toUpperCase();
  const spx = fit(g, sub, s * 0.3, o.font, Math.max(bw, W * 0.7) / fitK);
  gameText(g, sub, x + bw / 2, by + bh + s * 0.34, spx, o.font, "#ffffff", INK, spx * 0.22);
  if (tag) {
    x += bw + s * 0.15;
    shadow(g, s * 0.2);
    roundRect(g, x, by, tagW, bh, s * 0.16);
    const gradH = g.createLinearGradient(0, by, 0, by + bh);
    gradH.addColorStop(0, "#3a414b");
    gradH.addColorStop(1, "#171b21");
    g.fillStyle = gradH;
    g.fill();
    noShadow(g);
    g.lineWidth = Math.max(1.5, s * 0.06);
    g.strokeStyle = "#eef3f7";
    g.stroke();
    const tpx = fit(g, tag.toUpperCase(), s * 0.36, o.font, tagW * 0.86);
    gameText(g, tag.toUpperCase(), x + tagW / 2, by + bh * 0.52, tpx, o.font, "#ffd21f", INK, tpx * 0.2);
  }
  g.restore();
}

/** The big mark after an attempt (beside a standings board, in the space left of it). */
export function drawMark(g: CanvasRenderingContext2D, W: number, H: number, text: string, sub: string | undefined, tone: "good" | "bad" | "lead" | "plain", k: number, o: Gfx, besideBoard = false) {
  // On a wide screen the board takes the right of the frame: the mark centres in what's left.
  const room = besideBoard && !o.phone ? W - Math.min(W * 0.36, 420 * o.scale) - Math.max(14, W * 0.02) * 2 : W;
  const s = Math.min(room * 0.11, 84) * o.scale;
  g.save();
  g.globalAlpha = Math.min(1, k * 5, (1 - k) * 6 + 0.15);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const y = H * (o.phone ? 0.3 : 0.27);
  const pop = 1 + 0.18 * Math.exp(-k * 14);
  g.translate(room / 2, y);
  g.scale(pop, pop);
  const fill = g.createLinearGradient(0, -s, 0, s);
  if (tone === "bad") { fill.addColorStop(0, "#ff8a7a"); fill.addColorStop(1, "#e0262b"); }
  else if (tone === "lead") { fill.addColorStop(0, "#b6ffcf"); fill.addColorStop(1, "#21d07a"); }
  else { fill.addColorStop(0, "#fff27a"); fill.addColorStop(1, "#ffb000"); }
  const px = fit(g, text, s, o.font, room * 0.9);
  gameText(g, text, 0, 0, px, o.font, fill, "#0d1626", px * 0.16);
  if (sub) {
    const spx = fit(g, sub.toUpperCase(), s * 0.3, o.font, room * 0.86);
    gameText(g, sub.toUpperCase(), 0, px * 0.78, spx, o.font, tone === "lead" ? "#b6ffcf" : "#ffffff", "#0d1626", spx * 0.2);
  }
  g.restore();
}

/** The live results board (right on a wide screen, under the action on a phone). */
export function drawBoard(g: CanvasRenderingContext2D, W: number, H: number, title: string, rows: NonNullable<Overlay["board"]>["rows"], k: number, o: Gfx, full = false) {
  let s = Math.min(W * (o.phone ? 0.045 : 0.022), 22) * o.scale;
  if (o.phone) {
    // A phone's (and a vertical video's) board keeps out of the picture: docked low, above the controls.
    // Beside the action it is short (the podium places and the row being talked about); alone it shrinks to fit the screen.
    if (!full) {
      const top = rows.filter((r, i) => i < 3 || r.hi);
      rows = top.length < rows.length ? top.slice(0, 4) : rows;
      s *= 0.86;
    } else {
      const room = H - o.top - o.bottom - 12;
      s = Math.max(9.5, Math.min(s, room / (rows.length * 1.5 + 2.6)));
      const fits = Math.max(3, Math.floor((room - s * 2.6) / (s * 1.5)));
      if (rows.length > fits) {
        const hi = rows.findIndex((r) => r.hi);
        rows = hi >= fits ? [...rows.slice(0, fits - 1), rows[hi]] : rows.slice(0, fits);
      }
    }
  }
  const rowsN = rows.length;
  const rowH = s * 1.5;
  const w = full ? Math.min(W - 24, 640 * o.scale) : o.phone ? W - 24 : Math.min(W * 0.36, 420 * o.scale);
  const h = rowH * rowsN + s * 2.6;
  const x = full ? (W - w) / 2 : o.phone ? 12 : W - w - Math.max(14, W * 0.02);
  const y = o.phone ? Math.max(o.top + 6, H - o.bottom - h - 6) : full ? Math.max(o.top + 8, (H - h) / 2 - s) : Math.max(o.top + 70, H * 0.22);
  g.save();
  const a = Math.min(1, k * 4);
  g.globalAlpha = a;
  g.translate((1 - easeOut(k * 3)) * (full ? 0 : 30), 0);
  shadow(g, 18);
  roundRect(g, x, y, w, h, 8 * o.scale);
  g.fillStyle = "rgba(8,14,32,0.92)";
  g.fill();
  noShadow(g);
  g.fillStyle = "#ffd21f";
  g.fillRect(x, y, w, 4 * o.scale);
  g.textBaseline = "middle";
  g.textAlign = "left";
  const tt = title.toUpperCase();
  gameText(g, tt, x + s * 0.8, y + s * 1.25, fit(g, tt, s * 0.82, o.font, w - s * 1.6), o.font, "#ffffff", "#0d1626", s * 0.12);
  rows.forEach((r, i) => {
    const reveal = Math.min(1, Math.max(0, k * (rowsN + 3) - i * 0.6));
    if (reveal <= 0) return;
    const ry = y + s * 2.3 + i * rowH;
    g.globalAlpha = a * reveal;
    if (r.hi) { g.fillStyle = "rgba(255,210,31,0.16)"; g.fillRect(x + 4, ry, w - 8, rowH); }
    else if (i % 2 === 0) { g.fillStyle = "rgba(255,255,255,0.04)"; g.fillRect(x + 4, ry, w - 8, rowH); }
    const mid = ry + rowH / 2;
    const medal = r.plain ? undefined : ["#ffd21f", "#d9e1ea", "#e6a15c"][Number(r.place) - 1];
    if (medal) {
      g.fillStyle = medal;
      g.beginPath();
      g.arc(x + s * 1.05, mid, s * 0.55, 0, Math.PI * 2);
      g.fill();
    }
    g.textAlign = "center";
    g.fillStyle = medal ? INK : "rgba(255,255,255,0.8)";
    g.font = `800 ${s * 0.72}px ${o.font}`;
    g.fillText(r.place, x + s * 1.05, mid + 1);
    g.textAlign = "left";
    g.fillStyle = r.hi ? "#ffd21f" : "#ffffff";
    const nm = badgeName(r.name);
    g.font = `800 ${fit(g, nm, s * 0.74, o.font, w * 0.55)}px ${o.font}`;
    g.fillText(nm, x + s * 2.1, mid + 1);
    g.textAlign = "right";
    g.fillStyle = r.hi ? "#ffd21f" : "#ffffff";
    g.font = `800 ${fit(g, r.mark, s * 0.78, o.font, w * 0.3)}px ${o.font}`;
    g.fillText(r.mark, x + w - s * 0.8, mid + 1);
    if (r.note) {
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.font = `700 ${s * 0.5}px ${o.font}`;
      g.fillText(r.note, x + w - s * 0.8, mid + s * 0.62);
    }
  });
  g.restore();
}

/** Name tags over athletes (no lane box: the field events have none). */
export function drawTags(g: CanvasRenderingContext2D, tags: { name: string; x: number; y: number }[], o: Gfx) {
  const s = 14 * (o.phone ? 0.9 : 1) * Math.min(1.6, o.scale);
  g.save();
  g.textBaseline = "middle";
  g.textAlign = "center";
  const cw = g.canvas.width / (g.getTransform().a || 1);
  const placed: Rect[] = [];
  for (const t of tags) {
    const nm = badgeName(t.name);
    g.font = `800 ${s}px ${o.font}`;
    const w = g.measureText(nm).width + s * 1.2, h = s * 1.6;
    const x = Math.max(4, Math.min(cw - w - 4, t.x - w / 2));
    const y = t.y - h - s * 0.4;
    const r = { x, y, w, h };
    if (y < o.top || placed.some((p) => p.x < x + w && p.x + p.w > x && p.y < y + h && p.y + p.h > y) || (o.avoid ?? []).some((p) => p.x < x + w && p.x + p.w > x && p.y < y + h && p.y + p.h > y)) continue;
    placed.push(r);
    shadow(g, 6);
    roundRect(g, x, y, w, h, 4);
    g.fillStyle = "rgba(10,18,40,0.82)";
    g.fill();
    noShadow(g);
    g.fillStyle = "#ffd21f";
    g.beginPath();
    g.moveTo(x + w / 2 - s * 0.3, y + h);
    g.lineTo(x + w / 2 + s * 0.3, y + h);
    g.lineTo(x + w / 2, y + h + s * 0.35);
    g.closePath();
    g.fill();
    g.fillStyle = "#ffffff";
    g.fillText(nm, x + w / 2, y + h / 2 + 1);
  }
  g.restore();
}

/** The commentary line, under the bug at the top. */
export function drawCaption(g: CanvasRenderingContext2D, W: number, H: number, text: string, o: Gfx) {
  const s = Math.min(W * 0.034, 17) * o.scale;
  g.save();
  g.textAlign = "center";
  g.textBaseline = "middle";
  const px = fit(g, text, s, o.font, W * 0.9);
  const y = o.top + (o.phone ? 78 : 26) + px;
  void H;
  g.font = `800 ${px}px ${o.font}`;
  const w = g.measureText(text).width + px * 1.6;
  roundRect(g, W / 2 - w / 2, y - px * 0.85, w, px * 1.7, px * 0.4);
  g.fillStyle = "rgba(10,18,40,0.72)";
  g.fill();
  gameText(g, text, W / 2, y + 1, px, o.font, "#ffffff", "#0d1626", px * 0.16);
  g.restore();
}

export interface Head { key: string; x: number; y: number; by: number; visible: boolean }

/** Every graphic of one frame of a non-sprint show. */
export function drawOverlay(g: CanvasRenderingContext2D, W: number, H: number, ov: Overlay, heads: Head[], byKey: ReadonlyMap<string, Athlete>, o: Gfx) {
  const avoid: Rect[] = [...(o.avoid ?? [])];
  if (ov.bug) avoid.push(drawBug(g, W, ov.bug.title, ov.bug.sub, o));
  if (ov.replay) drawReplayBug(g, W, H, { font: o.font, scale: o.scale, top: o.top + (ov.bug ? 0 : 0) });
  // (On a phone the venue's own sign already says it: only the line under it stays.)
  if (ov.title) drawTitle(g, W, H, o.phone && ov.title.signed ? ov.title.sub : ov.title.text, o.phone && ov.title.signed ? "" : ov.title.sub, ov.title.k, o);
  if (ov.tags?.length) {
    const tags = heads.filter((h) => ov.tags!.includes(h.key) && h.visible && h.by - h.y > 18).map((h) => ({ name: ov.tagText?.[h.key] ?? byKey.get(h.key)?.name ?? h.key, x: h.x, y: h.y }));
    if (tags.length) drawTags(g, tags, { ...o, avoid });
  }
  if (ov.board) drawBoard(g, W, H, ov.board.title, ov.board.rows, ov.board.k, o, !ov.lower && !ov.mark);
  if (ov.mark) drawMark(g, W, H, ov.mark.text, ov.mark.sub, ov.mark.tone, ov.mark.k, o, !!ov.board);
  if (ov.caption && !ov.board) drawCaption(g, W, H, ov.caption, o);
  if (ov.lower) drawLower(g, W, H, byKey.get(ov.lower.key), ov.lower.name, ov.lower.line, ov.lower.tag, ov.lower.k, o);
}

/** The sprints: the Race's graphics on the Race's plan. */
export function drawSprint(g: CanvasRenderingContext2D, W: number, H: number, show: Show & SprintExtras, t: number, heads: Head[], photo: HTMLCanvasElement | null, o: Gfx & { title: string }) {
  const race = show.race!;
  const plan = show.racePlan;
  const st = t - show.pre;
  const ov = show.overlay(t);
  if (st < 0) {
    if (ov.mark) drawMark(g, W, H, ov.mark.text, ov.mark.sub, ov.mark.tone, ov.mark.k, o);
    else {
      const b = show.beats.find((x) => t >= x.t0 && t < x.t1);
      if (b?.title === "On your marks" || b?.title === "Set") drawStartCall(g, W, H, b.title.toUpperCase(), (t - b.t0) / (b.t1 - b.t0), { font: o.font, scale: o.scale });
    }
    return;
  }
  const shot = shotAt(plan, Math.min(st, plan.end));
  const k = shotProgress(shot, st);
  const raceT = raceTimeAt(plan, Math.min(st, plan.end));
  const gfx = { font: o.font, scale: o.scale };
  const ph = st >= plan.end ? "results" : shot.phase;
  if (ph === "crane") drawTitle(g, W, H, o.title, `${race.distance} m · PokéIQ Stadium`, k, o);
  else if (ph === "intro" && shot.lane != null) {
    const r = race.lanes.find((x) => x.lane === shot.lane);
    if (r) drawLaneIntro(g, W, H, r, k, { ...gfx, bottom: o.bottom });
  } else if (ph === "marks" || ph === "set") drawStartCall(g, W, H, ph === "marks" ? "ON YOUR MARKS" : "SET", k, gfx);
  if (ph === "race" || ph === "fast") {
    const lead = leaderAt(race, raceT);
    const v = spotsAt(race, raceT).find((x) => x.lane === lead.lane)?.v ?? 0;
    const bug = drawClockBug(g, W, H, { ...gfx, top: o.top, title: o.title, time: formatTime(Math.min(raceT, race.first), 2), leader: raceT < race.first ? { name: lead.entrant.name, v } : null, live: raceT < race.first });
    if (ph === "fast") {
      const r = race.lanes.find((x) => x.lane === shot.lane);
      drawFastForward(g, W, H, shot.rate, r ? (raceT > race.first ? `Meanwhile, ${r.entrant.name}…` : `${r.entrant.name} leads`) : "", { ...gfx, top: o.top + (o.phone ? 70 : 84) });
    }
    const laneOf = new Map(race.lanes.map((l) => [l.entrant.key, l.lane]));
    const tags = heads.filter((a) => a.visible && a.by - a.y > 20 && laneOf.has(a.key)).map((a) => ({ lane: laneOf.get(a.key)!, name: race.lanes.find((l) => l.entrant.key === a.key)!.entrant.name, x: a.x, y: a.y, lead: laneOf.get(a.key) === lead.lane }));
    if (tags.length) drawNameTags(g, tags, { ...gfx, scale: o.phone ? 0.85 : 1, top: o.phone ? 56 : 60, avoid: [bug, ...(o.avoid ?? [])] });
    if (raceT >= race.first && raceT < race.first + 3) {
      const w = show.headline;
      g.save();
      g.globalAlpha = Math.min(1, (raceT - race.first) * 3);
      drawStartCall(g, W, H, w.toUpperCase(), 0.5, { ...gfx, scale: gfx.scale * 0.7 });
      g.restore();
    }
  } else if (ph === "replay") drawReplayBug(g, W, H, { ...gfx, top: o.top });
  else if (ph === "photo") {
    if (photo) drawPhotoFinish(g, W, H, photo, race, show.photoFrame, k, { ...gfx, top: o.top, bottom: o.bottom });
    else drawStartCall(g, W, H, "PHOTO FINISH…", 0.5, gfx);
  } else if (ph === "results" && ov.board) drawBoard(g, W, H, ov.board.title, ov.board.rows, Math.min(1, (st - (plan.shots.find((s) => s.phase === "results")?.t0 ?? 0)) / 1.5), o, true);
}
