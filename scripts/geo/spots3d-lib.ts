/**
 * Exact spots for the 3D remakes' shots, by flattening: Brilliant Diamond /
 * Shining Pearl (and the other fixed-camera remakes) look at the ground from
 * one fixed, axis-aligned camera that follows the player, so a shot is a
 * perspective view of the same tile layout the sprite game's area map shows.
 * The view is undone (the shot is resampled onto the ground plane, top-down,
 * at a few pixels per tile), and the flat picture is then matched against the
 * sprite game's map of the shot's own place. The spot is the player's tile
 * (the camera's target). Pure functions only: scripts/geo/spots3d.ts does
 * the files.
 */

/** An image as floats, `ch` channels per pixel (row-major). */
export interface Raster {
  w: number;
  h: number;
  ch: number;
  data: Float32Array;
  /** 1 where the pixel is part of the picture (0: transparent, outside the shot, a text box). */
  valid?: Uint8Array;
}

/**
 * The ground-to-screen mapping of an axis-aligned camera that looks down at
 * the player: ground (X, Y) in tiles from the player's tile centre (Y grows
 * towards the viewer) lands on the reference screen (`width` px wide) at
 *   u = width/2 + a·X / (1 − c·Y),   v = v0 + b·Y / (1 − c·Y).
 * `a` is a tile's width on screen at the player's row, `b` its depth there,
 * `c` the perspective (0 is an orthographic view), `v0` the player's tile centre.
 */
export interface Camera {
  width: number;
  height: number;
  a: number;
  b: number;
  c: number;
  v0: number;
}

export function groundToScreen(cam: Camera, X: number, Y: number): [number, number] {
  const w = 1 - cam.c * Y;
  return [cam.width / 2 + (cam.a * X) / w, cam.v0 + (cam.b * Y) / w];
}

export function screenToGround(cam: Camera, u: number, v: number): [number, number] {
  // v − v0 = b·Y / (1 − c·Y)  ⇒  Y = (v − v0) / (b + c·(v − v0)).
  const dv = v - cam.v0;
  const Y = dv / (cam.b + cam.c * dv);
  const X = ((u - cam.width / 2) * (1 - cam.c * Y)) / cam.a;
  return [X, Y];
}

/** Bilinear sample of every channel at (x, y), or null outside the picture (or on an invalid pixel). */
function sample(img: Raster, x: number, y: number, out: Float32Array): boolean {
  if (x < 0 || y < 0 || x > img.w - 1 || y > img.h - 1) return false;
  const x0 = Math.min(Math.floor(x), img.w - 2);
  const y0 = Math.min(Math.floor(y), img.h - 2);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = y0 * img.w + x0;
  if (img.valid && !(img.valid[i00] && img.valid[i00 + 1] && img.valid[i00 + img.w] && img.valid[i00 + img.w + 1])) return false;
  for (let k = 0; k < img.ch; k++) {
    const p = (i: number) => img.data[i * img.ch + k];
    out[k] = (p(i00) * (1 - fx) + p(i00 + 1) * fx) * (1 - fy) + (p(i00 + img.w) * (1 - fx) + p(i00 + img.w + 1) * fx) * fy;
  }
  return true;
}

/**
 * Box-filters a raster down by an integer factor (an output pixel is valid
 * when most of its block is).
 */
export function shrink(img: Raster, f: number): Raster {
  const w = Math.floor(img.w / f);
  const h = Math.floor(img.h / f);
  const data = new Float32Array(w * h * img.ch);
  const valid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0;
      const acc = new Float64Array(img.ch);
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = (y * f + dy) * img.w + x * f + dx;
          if (img.valid && !img.valid[i]) continue;
          n++;
          for (let k = 0; k < img.ch; k++) acc[k] += img.data[i * img.ch + k];
        }
      const o = y * w + x;
      if (n * 2 > f * f) {
        valid[o] = 1;
        for (let k = 0; k < img.ch; k++) data[o * img.ch + k] = acc[k] / n;
      }
    }
  return { w, h, ch: img.ch, data, valid };
}

/**
 * The shot seen from straight above: `px` pixels per tile, covering the
 * ground the shot shows (its bounding box in tiles), with the player's tile
 * centre at `origin` (in output pixels). The shot is first shrunk so a
 * sample is never much finer than the ground it covers.
 */
export function flatten(shot: Raster, cam: Camera, px: number, reach?: { up: number; down: number; side: number }): { flat: Raster; origin: [number, number] } {
  const scale = shot.w / cam.width;
  const corners = [
    screenToGround(cam, 0, 0),
    screenToGround(cam, cam.width, 0),
    screenToGround(cam, 0, cam.height),
    screenToGround(cam, cam.width, cam.height),
  ];
  // Only as far from the player as `reach` (tiles): the far side of a shot is small, and hills and roofs stand up there.
  const minX = Math.max(Math.floor(Math.min(...corners.map((c) => c[0]))), -(reach?.side ?? Infinity));
  const maxX = Math.min(Math.ceil(Math.max(...corners.map((c) => c[0]))), reach?.side ?? Infinity);
  const minY = Math.max(Math.floor(Math.min(...corners.map((c) => c[1]))), -(reach?.up ?? Infinity));
  const maxY = Math.min(Math.ceil(Math.max(...corners.map((c) => c[1]))), reach?.down ?? Infinity);
  const w = (maxX - minX) * px;
  const h = (maxY - minY) * px;
  const data = new Float32Array(w * h * shot.ch);
  const valid = new Uint8Array(w * h);
  // A ground pixel covers about a/px screen pixels at the player's row: shrink by about half that.
  const f = Math.max(1, Math.floor((cam.a * scale) / px / 2));
  const src = f > 1 ? shrink(shot, f) : shot;
  const k = scale / f;
  const buf = new Float32Array(shot.ch);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [u, v] = groundToScreen(cam, minX + (x + 0.5) / px, minY + (y + 0.5) / px);
      if (u < 0 || v < 0 || u >= cam.width || v >= cam.height) continue;
      if (!sample(src, u * k - 0.5, v * k - 0.5, buf)) continue;
      const o = y * w + x;
      valid[o] = 1;
      data.set(buf, o * shot.ch);
    }
  return { flat: { w, h, ch: shot.ch, data, valid }, origin: [-minX * px, -minY * px] };
}

/**
 * Colour features that survive the change of art style (a 3D render against
 * pixel art): two opponent-colour axes (red–green, yellow–blue) and a damped
 * brightness. Input RGB 0–255.
 */
export function features(rgb: Raster): Raster {
  const n = rgb.w * rgb.h;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = rgb.data[i * rgb.ch];
    const g = rgb.data[i * rgb.ch + 1];
    const b = rgb.data[i * rgb.ch + 2];
    data[i * 3] = r - g;
    data[i * 3 + 1] = (r + g) / 2 - b;
    data[i * 3 + 2] = 0.5 * ((r + g + b) / 3);
  }
  return { w: rgb.w, h: rgb.h, ch: 3, data, valid: rgb.valid };
}

export interface Peak {
  x: number;
  y: number;
  score: number;
}

/**
 * Masked normalized cross-correlation of the template against the map, for
 * every placement that puts the template's `anchor` (the player) on a valid
 * map pixel and keeps at least `minCover` of the template's valid pixels on
 * valid map pixels (the far side of a shot can look past the map's edge).
 * Scores are indexed by the anchor's map pixel (−∞ where not computed).
 */
export function nccMap(map: Raster, tpl: Raster, anchor: [number, number], minCover = 0.4, window?: { x0: number; y0: number; x1: number; y1: number }): ScoreMap {
  const ch = map.ch;
  const pts: number[] = [];
  for (let y = 0; y < tpl.h; y++) for (let x = 0; x < tpl.w; x++) if (!tpl.valid || tpl.valid[y * tpl.w + x]) pts.push(x - anchor[0], y - anchor[1]);
  const nv = pts.length / 2;
  const { w, h } = map;
  const score = new Float32Array(w * h).fill(-Infinity);
  if (nv === 0) return { w, h, score };
  const tv = new Float32Array(nv * ch);
  for (let i = 0; i < nv; i++) for (let k = 0; k < ch; k++) tv[i * ch + k] = tpl.data[((pts[2 * i + 1] + anchor[1]) * tpl.w + pts[2 * i] + anchor[0]) * ch + k];
  const st = new Float64Array(ch);
  const stt = new Float64Array(ch);
  const sr = new Float64Array(ch);
  const srr = new Float64Array(ch);
  const str = new Float64Array(ch);
  const wy0 = Math.max(0, window?.y0 ?? 0);
  const wy1 = Math.min(h, window?.y1 ?? h);
  const wx0 = Math.max(0, window?.x0 ?? 0);
  const wx1 = Math.min(w, window?.x1 ?? w);
  for (let ay = wy0; ay < wy1; ay++)
    for (let ax = wx0; ax < wx1; ax++) {
      if (map.valid && !map.valid[ay * w + ax]) continue;
      st.fill(0);
      stt.fill(0);
      sr.fill(0);
      srr.fill(0);
      str.fill(0);
      let n = 0;
      for (let i = 0; i < nv; i++) {
        const mx = ax + pts[2 * i];
        const my = ay + pts[2 * i + 1];
        if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
        const mi = my * w + mx;
        if (map.valid && !map.valid[mi]) continue;
        n++;
        for (let k = 0; k < ch; k++) {
          const t = tv[i * ch + k];
          const r = map.data[mi * ch + k];
          st[k] += t;
          stt[k] += t * t;
          sr[k] += r;
          srr[k] += r * r;
          str[k] += t * r;
        }
      }
      if (n < nv * minCover) continue;
      let num = 0;
      let den = 0;
      for (let k = 0; k < ch; k++) {
        const cov = str[k] - (st[k] * sr[k]) / n;
        const vt = stt[k] - (st[k] * st[k]) / n;
        const vr = srr[k] - (sr[k] * sr[k]) / n;
        num += cov;
        den += Math.sqrt(Math.max(vt, 1e-9) * Math.max(vr, 1e-9));
      }
      score[ay * w + ax] = num / den;
    }
  return { w, h, score };
}

/** Match scores by the anchor's map pixel. */
export interface ScoreMap {
  w: number;
  h: number;
  score: Float32Array;
}

/** The best offset, and the best one at least `apart` pixels from it (the runner-up that makes a match ambiguous). */
export function topTwo(m: ScoreMap, apart: number): [Peak | null, Peak | null] {
  let best: Peak | null = null;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const s = m.score[y * m.w + x];
      if (s > (best?.score ?? -Infinity)) best = { x, y, score: s };
    }
  if (!best) return [null, null];
  let second: Peak | null = null;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const s = m.score[y * m.w + x];
      if (s <= (second?.score ?? -Infinity)) continue;
      if (Math.hypot(x - best.x, y - best.y) < apart) continue;
      second = { x, y, score: s };
    }
  return [best, second];
}

/** Whether a match is confident and unique: a strong best, clearly ahead of any other place. */
export function confident(best: Peak | null, second: Peak | null, gate: { min: number; margin: number }): boolean {
  if (!best || best.score < gate.min) return false;
  return !second || best.score - second.score >= gate.margin;
}

/** A 0–1 confidence for the data file, from the score and its lead. */
export function confidenceOf(best: Peak, second: Peak | null): number {
  const lead = second ? best.score - second.score : best.score;
  return Math.round(Math.min(1, Math.max(0, 0.5 * best.score + 2 * lead)) * 100) / 100;
}

/**
 * Hides a message box from the match: if the box's usual place (a share of
 * the screen) is mostly flat white or flat dark, that band is marked invalid.
 */
export function maskTextBox(shot: Raster, box: { x0: number; x1: number; y0: number; y1: number }): boolean {
  const X0 = Math.floor(box.x0 * shot.w);
  const X1 = Math.floor(box.x1 * shot.w);
  const Y0 = Math.floor(box.y0 * shot.h);
  const Y1 = Math.floor(box.y1 * shot.h);
  let flat = 0;
  let n = 0;
  for (let y = Y0 + Math.floor((Y1 - Y0) * 0.3); y < Y1 - Math.floor((Y1 - Y0) * 0.2); y += 2)
    for (let x = X0 + Math.floor((X1 - X0) * 0.1); x < X1 - Math.floor((X1 - X0) * 0.1); x += 2) {
      const i = (y * shot.w + x) * shot.ch;
      const r = shot.data[i];
      const g = shot.data[i + 1];
      const b = shot.data[i + 2];
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (spread < 28 && (Math.min(r, g, b) > 200 || Math.max(r, g, b) < 70)) flat++;
      n++;
    }
  if (n === 0 || flat / n < 0.55) return false;
  const valid = shot.valid ?? new Uint8Array(shot.w * shot.h).fill(1);
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) valid[y * shot.w + x] = 0;
  shot.valid = valid;
  return true;
}
