import { SITE_URL } from "@/lib/site";
import { Mp4Muxer, aacConfig } from "@/lib/sizes/mp4";
import { finishingOrder, resolveBracket } from "./bracket";
import { slotKeys } from "./blind";
import {
  COLORS, background, drawBlind, drawChampion, drawMon, drawTierList, drawTop, easeOut, easeOutBack, ellipsis, fitText, loadPictures, roundRect,
  type Fonts, type Pictures,
} from "./render";
import type { ToolState } from "./state";
import type { Mon } from "./types";

/**
 * The replay video: a vertical 1080 × 1920 MP4 (TikTok, Reels, Shorts) of the result being made. A tier list fills
 * in tier by tier, a top list counts down to the #1 reveal, a bracket walks round by round to its champion and a blind
 * ranking replays each reveal and placement. Frames are drawn one at a time at full quality and encoded with WebCodecs
 * (H.264, and AAC or Opus for the optional sound, synthesised offline), muxed by the site's own MP4 writer, the way
 * the Professor's Lab story video is; a browser without WebCodecs records a WebM in real time instead.
 */

const W = 1080;
const H = 1920;
const FPS = 30;
const HOST = new URL(SITE_URL).host;

export interface VideoInput {
  state: ToolState;
  byKey: ReadonlyMap<string, Mon>;
  title: string;
  subtitle: string;
  entrants: string[];
  drawn: string[];
}

export interface VideoOptions {
  input: VideoInput;
  sound: boolean;
  fonts: Fonts;
  labels(round: number, count: number): string;
  text: { made: string; champion: string; runnerUp: string; you: string; friend: string; mode: string; vs: string };
  signal: AbortSignal;
  onProgress(p: number): void;
}

type Sfx = "pop" | "flip" | "tick" | "win" | "fanfare" | "whoosh";

interface Plan {
  seconds: number;
  draw(g: CanvasRenderingContext2D, t: number): void;
  sfx: { t: number; kind: Sfx; pitch?: number }[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function titleCard(g: CanvasRenderingContext2D, o: VideoOptions, k: number) {
  const f = o.fonts;
  background(g, W, H);
  g.save();
  g.globalAlpha = clamp01(k * 3);
  g.textAlign = "center";
  g.fillStyle = COLORS.pink;
  g.font = `700 40px ${f.display}`;
  g.fillText(o.text.mode.toUpperCase(), W / 2, H * 0.42);
  g.fillStyle = COLORS.text;
  const s = fitText(g, o.input.title, W - 140, 104, 700, f.display, 40);
  g.font = `700 ${s}px ${f.display}`;
  const y = H * 0.42 + 40 + s * 1.1 - (1 - easeOut(clamp01(k * 2))) * -40;
  g.fillText(ellipsis(g, o.input.title, W - 120), W / 2, y);
  if (o.input.subtitle && o.input.subtitle !== o.input.title) {
    g.fillStyle = COLORS.muted;
    g.font = `500 40px ${f.body}`;
    g.fillText(ellipsis(g, o.input.subtitle, W - 160), W / 2, y + 74);
  }
  g.restore();
}

function endCard(g: CanvasRenderingContext2D, o: VideoOptions, k: number) {
  g.save();
  g.fillStyle = `rgba(10,9,24,${0.82 * clamp01(k * 2.5)})`;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = clamp01(k * 2.5);
  g.textAlign = "center";
  g.fillStyle = COLORS.muted;
  g.font = `500 40px ${o.fonts.body}`;
  g.fillText(o.text.made, W / 2, H * 0.47);
  g.fillStyle = COLORS.text;
  g.font = `700 62px ${o.fonts.display}`;
  g.fillText(`${HOST}/tools/tier-list`, W / 2, H * 0.47 + 84);
  g.restore();
}

// ---- Tier list: fills in tier by tier.
function tierPlan(o: VideoOptions, pics: Pictures): Plan {
  const s = o.input.state;
  const rows = s.tier.rows;
  const total = rows.reduce((n, r) => n + r.items.length, 0);
  const per = Math.max(0.09, Math.min(0.45, 16 / Math.max(1, total)));
  const rowPause = 0.45;
  const intro = 1.8;
  const times: { row: number; count: number; t: number }[] = [];
  let t = intro + 0.3;
  const sfx: Plan["sfx"] = [];
  rows.forEach((r, i) => {
    times.push({ row: i, count: 0, t });
    sfx.push({ t, kind: "whoosh" });
    t += rowPause;
    r.items.forEach((_, j) => {
      times.push({ row: i, count: j + 1, t });
      if (per >= 0.14 || j % 2 === 0) sfx.push({ t, kind: "pop", pitch: 1 + (rows.length - i) * 0.06 });
      t += per;
    });
  });
  const full = t + 0.2;
  const seconds = full + 3.4;
  return {
    seconds,
    sfx: [...sfx, { t: full, kind: "fanfare" }],
    draw(g, now) {
      if (now < intro) return titleCard(g, o, now / intro);
      let cur = times[0];
      for (const x of times) if (x.t <= now) cur = x;
      const counts = rows.map((r, i) => (i < cur.row ? r.items.length : i === cur.row ? cur.count : 0));
      const pop = clamp01((now - cur.t) / Math.max(0.12, Math.min(per, 0.3)));
      drawTierList(g, W, H, { title: o.input.title, subtitle: o.input.subtitle, rows, byKey: o.input.byKey, reveal: { counts, pop, rowsShown: cur.row + 1 } }, pics, o.fonts);
      if (now > full + 1.6) endCard(g, o, (now - full - 1.6) / 1.2);
    },
  };
}

// ---- Top N: a countdown to the #1 reveal.
function topPlan(o: VideoOptions, pics: Pictures): Plan {
  const s = o.input.state;
  const items = s.top.items.map((k) => o.input.byKey.get(k)).filter((m): m is Mon => !!m);
  const n = items.length;
  const per = n <= 5 ? 2.3 : n <= 10 ? 1.8 : 1.15;
  const intro = 1.8;
  const sfx: Plan["sfx"] = [];
  const slots = items.map((_, i) => n - 1 - i); // countdown order: last place first
  let t = intro;
  const starts: number[] = [];
  slots.forEach((rank) => {
    starts.push(t);
    const isOne = rank === 0;
    sfx.push({ t: t + (isOne ? 1.2 : 0.05), kind: isOne ? "win" : "pop", pitch: 1 + (n - rank) * 0.04 });
    if (isOne) sfx.push({ t, kind: "tick" }, { t: t + 0.4, kind: "tick" }, { t: t + 0.8, kind: "tick" });
    t += isOne ? 3.2 : per;
  });
  const listAt = t;
  const seconds = t + 4;
  sfx.push({ t: listAt, kind: "fanfare" });
  return {
    seconds,
    sfx,
    draw(g, now) {
      if (now < intro) return titleCard(g, o, now / intro);
      if (now >= listAt) {
        drawTop(g, W, H, { title: o.input.title, subtitle: o.input.subtitle, top: s.top, byKey: o.input.byKey }, pics, o.fonts);
        if (now > listAt + 2.4) endCard(g, o, (now - listAt - 2.4) / 1.2);
        return;
      }
      let i = 0;
      while (i + 1 < starts.length && starts[i + 1] <= now) i++;
      const rank = slots[i];
      const m = items[rank];
      const k = now - starts[i];
      const isOne = rank === 0;
      background(g, W, H);
      const medal = rank === 0 ? COLORS.gold : rank === 1 ? COLORS.silver : rank === 2 ? COLORS.bronze : COLORS.violet;
      const reveal = isOne ? clamp01((k - 1.2) / 0.5) : 1;
      const glow = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.7);
      glow.addColorStop(0, `${medal}${isOne ? Math.round(80 * reveal + 20).toString(16).padStart(2, "0") : "55"}`);
      glow.addColorStop(1, `${medal}00`);
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      g.textAlign = "center";
      g.fillStyle = medal;
      const enter = easeOutBack(clamp01(k / 0.45));
      g.font = `700 ${Math.round(150 + 40 * (isOne ? 1 : 0))}px ${o.fonts.display}`;
      g.save();
      g.globalAlpha = clamp01(k / 0.25);
      g.fillText(`#${rank + 1}`, W / 2, H * 0.2);
      g.restore();
      const size = W * 0.78;
      g.save();
      g.translate(W / 2, H * 0.47);
      const sc = isOne ? 0.85 + 0.15 * easeOutBack(reveal) : 0.7 + 0.3 * enter;
      g.scale(sc, sc);
      if (isOne && reveal < 1) {
        // A silhouette first, then the reveal.
        const off = document.createElement("canvas");
        off.width = off.height = Math.round(size);
        const og = off.getContext("2d")!;
        drawMon(og, pics, m, 0, 0, size, size, 0.02);
        og.globalCompositeOperation = "source-in";
        og.fillStyle = "#06050f";
        og.fillRect(0, 0, size, size);
        g.drawImage(off, -size / 2, -size / 2);
        g.globalAlpha = reveal;
      }
      drawMon(g, pics, m, -size / 2, -size / 2, size, size, 0.02);
      g.restore();
      g.save();
      g.globalAlpha = isOne ? reveal : clamp01((k - 0.15) / 0.3);
      g.fillStyle = COLORS.text;
      const fs = fitText(g, m.n, W - 120, 92, 700, o.fonts.display, 36);
      g.font = `700 ${fs}px ${o.fonts.display}`;
      g.fillText(m.n, W / 2, H * 0.47 + size / 2 + 110);
      const cap = s.top.captions[m.k];
      if (cap) {
        g.fillStyle = COLORS.muted;
        g.font = `500 44px ${o.fonts.body}`;
        g.fillText(ellipsis(g, cap, W - 140), W / 2, H * 0.47 + size / 2 + 190);
      }
      g.restore();
    },
  };
}

// ---- Bracket: round by round to the champion.
function bracketPlan(o: VideoOptions, pics: Pictures): Plan {
  const s = o.input.state;
  const res = resolveBracket(o.input.entrants, s.bracket.picks);
  const intro = 1.8;
  const sfx: Plan["sfx"] = [];
  type Seg = { t0: number; t1: number; round: number; kind: "duels" | "mosaic"; matches: number[] };
  const segs: Seg[] = [];
  let t = intro;
  res.rounds.forEach((round, r) => {
    const played = round.map((m, i) => (m.bye || !m.winner ? -1 : i)).filter((i) => i >= 0);
    if (!played.length) return;
    if (played.length > 4) {
      segs.push({ t0: t, t1: t + 2.2, round: r, kind: "mosaic", matches: played });
      sfx.push({ t, kind: "whoosh" }, { t: t + 0.9, kind: "pop" });
      t += 2.2;
    } else {
      for (const i of played) {
        const d = r === res.rounds.length - 1 ? 2.8 : 1.5;
        segs.push({ t0: t, t1: t + d, round: r, kind: "duels", matches: [i] });
        sfx.push({ t: t + 0.05, kind: "whoosh" }, { t: t + d * 0.55, kind: "win", pitch: 1 + r * 0.08 });
        t += d;
      }
    }
  });
  const champAt = t;
  const seconds = t + 4.6;
  sfx.push({ t: champAt + 0.2, kind: "fanfare" });
  const order = finishingOrder(res);
  const champ = res.champion ? o.input.byKey.get(res.champion) : undefined;
  const runner = order[1] ? o.input.byKey.get(order[1]) : undefined;
  return {
    seconds,
    sfx,
    draw(g, now) {
      if (now < intro) return titleCard(g, o, now / intro);
      if (now >= champAt) {
        if (champ) drawChampion(g, W, H, { title: o.input.title, label: o.text.champion, champion: champ, runnerUp: runner, runnerLabel: o.text.runnerUp }, pics, o.fonts, clamp01((now - champAt) / 0.9));
        if (now > champAt + 3.2) endCard(g, o, (now - champAt - 3.2) / 1.2);
        return;
      }
      const seg = segs.find((x) => now >= x.t0 && now < x.t1) ?? segs[segs.length - 1];
      const k = (now - seg.t0) / (seg.t1 - seg.t0);
      background(g, W, H);
      g.textAlign = "center";
      g.fillStyle = COLORS.pink;
      g.font = `700 56px ${o.fonts.display}`;
      g.fillText(o.labels(seg.round, res.rounds.length).toUpperCase(), W / 2, 190);
      const round = res.rounds[seg.round];
      if (seg.kind === "mosaic") {
        // Everyone who went through, in a grid; the ones who went out fade.
        const entrants = seg.matches.flatMap((i) => [round[i].a, round[i].b]).filter((x): x is string => !!x);
        const cols = Math.ceil(Math.sqrt(entrants.length * (W / (H - 400))));
        const cell = Math.min(160, (W - 80) / cols);
        const rows = Math.ceil(entrants.length / cols);
        const x0 = (W - cols * cell) / 2, y0 = 260 + Math.max(0, (H - 360 - rows * cell) / 2);
        const fadeK = clamp01((k - 0.35) / 0.3);
        entrants.forEach((key, j) => {
          const m = o.input.byKey.get(key);
          if (!m) return;
          const won = round.some((mm) => mm.winner === key);
          g.save();
          g.globalAlpha = won ? 1 : 1 - 0.8 * fadeK;
          const sc = won ? 1 + 0.08 * Math.sin(fadeK * Math.PI) : 1 - 0.15 * fadeK;
          const cx = x0 + (j % cols) * cell + cell / 2, cy = y0 + Math.floor(j / cols) * cell + cell / 2;
          g.translate(cx, cy);
          g.scale(sc, sc);
          drawMon(g, pics, m, -cell / 2, -cell / 2, cell, cell, 0.04);
          g.restore();
        });
        return;
      }
      const m = round[seg.matches[0]];
      const a = m.a ? o.input.byKey.get(m.a) : undefined, b = m.b ? o.input.byKey.get(m.b) : undefined;
      const decide = clamp01((k - 0.5) / 0.18);
      [a, b].forEach((mon, side) => {
        if (!mon) return;
        const won = m.winner === mon.k;
        const enter = easeOutBack(clamp01(k / 0.25));
        const y = side === 0 ? H * 0.3 : H * 0.72;
        const size = W * 0.46;
        g.save();
        g.globalAlpha = won ? 1 : 1 - 0.7 * decide;
        const sc = (0.6 + 0.4 * enter) * (won ? 1 + 0.12 * decide : 1 - 0.12 * decide);
        g.translate(W / 2 + (side ? 1 : -1) * (1 - enter) * W * 0.4, y);
        g.scale(sc, sc);
        if (won && decide > 0) {
          roundRect(g, -size * 0.62, -size * 0.56, size * 1.24, size * 1.24, 48);
          g.fillStyle = `rgba(241,65,124,${0.18 * decide})`;
          g.fill();
        }
        drawMon(g, pics, mon, -size / 2, -size / 2, size, size, 0.02);
        g.fillStyle = COLORS.text;
        g.textAlign = "center";
        g.font = `700 ${fitText(g, mon.n, W - 160, 64, 700, o.fonts.display, 28)}px ${o.fonts.display}`;
        g.fillText(mon.n, 0, size / 2 + 40);
        g.restore();
      });
      g.fillStyle = COLORS.muted;
      g.font = `700 60px ${o.fonts.display}`;
      g.textBaseline = "middle";
      g.fillText(o.text.vs.toUpperCase(), W / 2, H * 0.515);
      g.textBaseline = "alphabetic";
    },
  };
}

// ---- Blind ranking: each reveal and where it went.
function blindPlan(o: VideoOptions, pics: Pictures): Plan {
  const s = o.input.state;
  const slots = s.blind.slots;
  const n = slots.length;
  const order = Array.from({ length: n }, (_, i) => slots.indexOf(i)); // reveal i went to slot order[i]
  const intro = 1.8;
  const per = n <= 5 ? 2.4 : 1.7;
  const sfx: Plan["sfx"] = [];
  for (let i = 0; i < n; i++) {
    const t0 = intro + i * per;
    sfx.push({ t: t0 + 0.1, kind: "flip" }, { t: t0 + per * 0.7, kind: "pop", pitch: 1 + (n - order[i]) * 0.05 });
  }
  const doneAt = intro + n * per;
  const seconds = doneAt + 4;
  sfx.push({ t: doneAt, kind: "fanfare" });
  const keysAt = (count: number) => slots.map((v) => (v >= 0 && v < count ? o.input.drawn[v] ?? null : null));
  return {
    seconds,
    sfx,
    draw(g, now) {
      if (now < intro) return titleCard(g, o, now / intro);
      if (now >= doneAt) {
        const runs = [{ name: s.blind.name || o.text.you, keys: slotKeys(slots, o.input.drawn) }];
        if (s.blind.vs) runs.push({ name: s.blind.vs.name || o.text.friend, keys: slotKeys(s.blind.vs.slots, o.input.drawn) });
        drawBlind(g, W, H, { title: o.input.title, subtitle: o.input.subtitle, runs, byKey: o.input.byKey }, pics, o.fonts);
        if (now > doneAt + 2.4) endCard(g, o, (now - doneAt - 2.4) / 1.2);
        return;
      }
      const i = Math.min(n - 1, Math.floor((now - intro) / per));
      const k = (now - intro - i * per) / per;
      const placedK = clamp01((k - 0.62) / 0.2);
      background(g, W, H);
      // The slots, lower part.
      const listTop = H * 0.5;
      const rowH = Math.min(120, (H - listTop - 60 - (n - 1) * 10) / n);
      const keys = keysAt(i + (placedK >= 1 ? 1 : 0));
      keys.forEach((key, j) => {
        const y = listTop + j * (rowH + 10);
        roundRect(g, 60, y, W - 120, rowH, 18);
        g.fillStyle = j === order[i] && placedK > 0 ? `rgba(241,65,124,${0.25 * (1 - placedK) + 0.06})` : COLORS.panel;
        g.fill();
        g.fillStyle = j < 3 ? [COLORS.gold, COLORS.silver, COLORS.bronze][j] : COLORS.muted;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `700 ${Math.round(rowH * 0.42)}px ${o.fonts.display}`;
        g.fillText(String(j + 1), 110, y + rowH / 2);
        const m = key ? o.input.byKey.get(key) : undefined;
        if (m) {
          drawMon(g, pics, m, 160, y + 4, rowH - 8, rowH - 8, 0.02);
          g.fillStyle = COLORS.text;
          g.textAlign = "left";
          g.font = `700 ${Math.round(rowH * 0.36)}px ${o.fonts.display}`;
          g.fillText(ellipsis(g, m.n, W - 160 - rowH - 100), 160 + rowH + 10, y + rowH / 2);
        }
        g.textBaseline = "alphabetic";
      });
      // The card: flips over, then flies to its slot.
      const m = o.input.byKey.get(o.input.drawn[i]);
      if (!m || placedK >= 1) return;
      const flip = clamp01(k / 0.25);
      const cw = 520, ch = 680;
      const target = { x: 160 + (rowH - 8) / 2, y: listTop + order[i] * (rowH + 10) + rowH / 2 };
      const cx = W / 2 + (target.x - W / 2) * easeOut(placedK);
      const cy = H * 0.26 + (target.y - H * 0.26) * easeOut(placedK);
      const sc = 1 - 0.8 * easeOut(placedK);
      g.save();
      g.translate(cx, cy);
      g.scale(sc * Math.abs(Math.cos(flip * Math.PI)) || 0.001, sc);
      roundRect(g, -cw / 2, -ch / 2, cw, ch, 40);
      if (flip < 0.5) {
        const grad = g.createLinearGradient(-cw / 2, -ch / 2, cw / 2, ch / 2);
        grad.addColorStop(0, "#2a2350");
        grad.addColorStop(1, "#120f26");
        g.fillStyle = grad;
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.7)";
        g.textAlign = "center";
        g.font = `700 200px ${o.fonts.display}`;
        g.fillText("?", 0, 70);
      } else {
        g.fillStyle = "#1b1736";
        g.fill();
        drawMon(g, pics, m, -cw / 2 + 30, -ch / 2 + 30, cw - 60, ch - 170, 0.02);
        g.fillStyle = COLORS.text;
        g.textAlign = "center";
        g.font = `700 ${fitText(g, m.n, cw - 60, 58, 700, o.fonts.display, 24)}px ${o.fonts.display}`;
        g.fillText(m.n, 0, ch / 2 - 60);
      }
      g.restore();
    },
  };
}

// ---- Sound: short synthesised effects, mixed offline.
async function renderSfx(plan: Plan, rate: number): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === "undefined") return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(plan.seconds * rate), rate);
  const master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);
  const noise = ctx.createBuffer(1, rate, rate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const tone = (t: number, f: number, d: number, type: OscillatorType, v: number, slide = 1) => {
    const o = ctx.createOscillator();
    const gn = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * slide, t + d);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(v, t + 0.008);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(gn).connect(master);
    o.start(t);
    o.stop(t + d + 0.02);
  };
  const hiss = (t: number, d: number, from: number, to: number, v: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + d);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(v, t + d * 0.3);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(bp).connect(gn).connect(master);
    src.start(t);
    src.stop(t + d + 0.02);
  };
  for (const e of plan.sfx) {
    const p = e.pitch ?? 1;
    if (e.t >= plan.seconds) continue;
    if (e.kind === "pop") tone(e.t, 520 * p, 0.12, "sine", 0.5, 1.9);
    else if (e.kind === "tick") tone(e.t, 1400, 0.05, "square", 0.12);
    else if (e.kind === "flip") hiss(e.t, 0.22, 900, 3200, 0.35);
    else if (e.kind === "whoosh") hiss(e.t, 0.35, 400, 1800, 0.22);
    else if (e.kind === "win") {
      tone(e.t, 660 * p, 0.18, "triangle", 0.4, 1.5);
      tone(e.t + 0.07, 990 * p, 0.22, "triangle", 0.3, 1.2);
    }
    else if (e.kind === "fanfare") [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(e.t + i * 0.09, f, 0.9 - i * 0.1, "triangle", 0.32));
  }
  return ctx.startRendering();
}

async function pickVideoCodec(): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42002a"]) {
    const cfg: VideoEncoderConfig = { codec, width: W, height: H, bitrate: 8_000_000, framerate: FPS, avc: { format: "avc" }, latencyMode: "quality" };
    try {
      if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
    } catch {
      /* next */
    }
  }
  return null;
}

async function pickAudioCodec(rate: number): Promise<{ cfg: AudioEncoderConfig; codec: "aac" | "opus" } | null> {
  if (typeof AudioEncoder === "undefined") return null;
  for (const [codec, kind] of [["mp4a.40.2", "aac"], ["opus", "opus"]] as const) {
    const cfg: AudioEncoderConfig = { codec, sampleRate: rate, numberOfChannels: 2, bitrate: 128_000 };
    try {
      if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, codec: kind };
    } catch {
      /* next */
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const copy = (d: AllowSharedBufferSource) => (d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength)));

function keysOf(x: VideoInput): string[] {
  const s = x.state;
  if (s.mode === "tier") return s.tier.rows.flatMap((r) => r.items);
  if (s.mode === "top") return s.top.items;
  if (s.mode === "bracket") return x.entrants;
  return x.drawn;
}

export function videoPlan(o: VideoOptions, pics: Pictures): Plan {
  const m = o.input.state.mode;
  return m === "tier" ? tierPlan(o, pics) : m === "top" ? topPlan(o, pics) : m === "bracket" ? bracketPlan(o, pics) : blindPlan(o, pics);
}

export async function makeVideo(o: VideoOptions): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  const mons = keysOf(o.input).map((k) => o.input.byKey.get(k)).filter((m): m is Mon => !!m);
  const pics = await loadPictures(mons, o.input.state.art, o.input.state.shiny, (p) => o.onProgress(p * 0.1), o.signal);
  if (o.signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const plan = videoPlan(o, pics);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d", { alpha: false })!;
  const N = Math.ceil(plan.seconds * FPS);
  const rate = 48000;
  const mix = o.sound ? await renderSfx(plan, rate) : null;

  const vcfg = await pickVideoCodec();
  if (vcfg) {
    let failure: unknown = null;
    let description: Uint8Array | null = null;
    const chunks: { data: Uint8Array; ts: number; dur: number; key: boolean }[] = [];
    const enc = new VideoEncoder({
      output(chunk, meta) {
        if (meta?.decoderConfig?.description && !description) description = copy(meta.decoderConfig.description);
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({ data, ts: chunk.timestamp, dur: chunk.duration ?? 1e6 / FPS, key: chunk.type === "key" });
      },
      error(e) {
        failure = e;
      },
    });
    enc.configure(vcfg);
    const audioChunks: { data: Uint8Array; ts: number; dur: number }[] = [];
    let audioDesc: Uint8Array | undefined;
    const acodec = mix ? await pickAudioCodec(rate) : null;
    if (acodec && mix) {
      const aenc = new AudioEncoder({
        output(chunk, meta) {
          if (meta?.decoderConfig?.description && !audioDesc) audioDesc = copy(meta.decoderConfig.description);
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          audioChunks.push({ data, ts: chunk.timestamp, dur: chunk.duration ?? 0 });
        },
        error(e) {
          failure = e;
        },
      });
      aenc.configure(acodec.cfg);
      const L = mix.getChannelData(0), R = mix.getChannelData(1);
      for (let at = 0; at < mix.length; at += 4800) {
        const n = Math.min(4800, mix.length - at);
        const planar = new Float32Array(n * 2);
        planar.set(L.subarray(at, at + n), 0);
        planar.set(R.subarray(at, at + n), n);
        const ad = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / rate) * 1e6), data: planar });
        aenc.encode(ad);
        ad.close();
      }
      await aenc.flush();
      aenc.close();
    }
    for (let i = 0; i < N; i++) {
      if (o.signal.aborted) {
        enc.close();
        throw new DOMException("Cancelled", "AbortError");
      }
      if (failure) throw failure;
      plan.draw(g, i / FPS);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      enc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      while (enc.encodeQueueSize > 4) await sleep(1);
      if (i % 3 === 0) o.onProgress(0.1 + 0.88 * ((i + 1) / N));
    }
    await enc.flush();
    enc.close();
    if (failure) throw failure;
    if (!description) throw new Error("The video encoder gave no decoder configuration");
    const mux = new Mp4Muxer(
      { width: W, height: H, description },
      acodec && audioChunks.length ? { codec: acodec.codec, sampleRate: rate, channels: 2, description: audioDesc ?? (acodec.codec === "aac" ? aacConfig(rate, 2) : undefined) } : undefined
    );
    for (const c of chunks) mux.addVideo(c.data, c.ts, c.dur, c.key);
    for (const c of audioChunks) mux.addAudio(c.data, c.ts, c.dur);
    o.onProgress(1);
    return { blob: new Blob([mux.finalize() as BlobPart], { type: "video/mp4" }), ext: "mp4" };
  }

  // No WebCodecs: record in real time.
  if (typeof MediaRecorder === "undefined" || !canvas.captureStream) throw new Error("This browser can't record video");
  const mime = ["video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
  const stream = canvas.captureStream(FPS);
  let actx: AudioContext | null = null;
  if (mix) {
    actx = new AudioContext({ sampleRate: rate });
    const dest = actx.createMediaStreamDestination();
    const src = actx.createBufferSource();
    src.buffer = mix;
    src.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    src.start();
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) parts.push(e.data);
  };
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(250);
  const t0 = performance.now();
  for (;;) {
    if (o.signal.aborted) {
      rec.stop();
      void actx?.close();
      throw new DOMException("Cancelled", "AbortError");
    }
    const t = (performance.now() - t0) / 1000;
    if (t >= plan.seconds) break;
    plan.draw(g, t);
    o.onProgress(0.1 + 0.9 * (t / plan.seconds));
    await new Promise((r) => requestAnimationFrame(r));
  }
  rec.stop();
  await done;
  void actx?.close();
  const mp4 = mime.startsWith("video/mp4");
  return { blob: new Blob(parts, { type: mp4 ? "video/mp4" : "video/webm" }), ext: mp4 ? "mp4" : "webm" };
}
