/**
 * A small GIF89a decoder (frames composited to RGBA, with disposal and transparency) and encoder (palette ≤ 256,
 * LZW, looping) for the Shiny Pokémon Maker's animated sprites and GIF downloads. No dependencies.
 */

export interface RgbaFrame {
  rgba: Uint8ClampedArray;
  delay: number; // ms
}
export interface DecodedGif {
  width: number;
  height: number;
  frames: RgbaFrame[];
}

/** Frames as slot indices (−1 transparent), ready to recolour. */
export interface GifFrames {
  width: number;
  height: number;
  frames: { pixels: Int16Array; delay: number }[];
  total: number;
}

function lzwDecode(data: Uint8Array, minCode: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, mask = (1 << codeSize) - 1, next = eoi + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), lengths = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; lengths[i] = 1; }
  let o = 0, prev = -1, buf = 0, bits = 0;
  const stack = new Uint8Array(4097);
  for (let i = 0; i < data.length && o < size; ) {
    while (bits < codeSize && i < data.length) { buf |= data[i++] << bits; bits += 8; }
    if (bits < codeSize) break;
    const code = buf & mask;
    buf >>>= codeSize; bits -= codeSize;
    if (code === clear) { codeSize = minCode + 1; mask = (1 << codeSize) - 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    let c = code;
    if (code >= next) {
      // KwKwK: the previous string plus its own first character.
      if (prev < 0) break;
      c = prev;
    }
    let sp = 0;
    while (c >= 0 && sp < 4097) { stack[sp++] = suffix[c]; c = prefix[c]; }
    const first = stack[sp - 1];
    while (sp && o < size) out[o++] = stack[--sp];
    if (code >= next && o < size) out[o++] = first;
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev; suffix[next] = first; lengths[next] = lengths[prev] + 1; next++;
      if (next > mask && codeSize < 12) { codeSize++; mask = (1 << codeSize) - 1; }
    }
    prev = code;
  }
  return out;
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== "GIF89a" && sig !== "GIF87a") throw new Error("not a GIF");
  const W = bytes[6] | (bytes[7] << 8), H = bytes[8] | (bytes[9] << 8);
  const flags = bytes[10];
  let p = 13;
  let gct: Uint8Array | null = null;
  if (flags & 0x80) { const n = 3 << ((flags & 7) + 1); gct = bytes.subarray(p, p + n); p += n; }
  const frames: RgbaFrame[] = [];
  const canvas = new Uint8ClampedArray(W * H * 4);
  let delay = 100, transparent = -1, disposal = 0;
  while (p < bytes.length) {
    const b = bytes[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[p++];
      if (label === 0xf9) {
        const pk = bytes[p + 1];
        disposal = (pk >> 2) & 7;
        delay = (bytes[p + 2] | (bytes[p + 3] << 8)) * 10 || 100;
        transparent = pk & 1 ? bytes[p + 4] : -1;
      }
      while (bytes[p] !== 0 && p < bytes.length) p += bytes[p] + 1;
      p++;
      continue;
    }
    if (b !== 0x2c) throw new Error("bad GIF block");
    const x = bytes[p] | (bytes[p + 1] << 8), y = bytes[p + 2] | (bytes[p + 3] << 8);
    const w = bytes[p + 4] | (bytes[p + 5] << 8), h = bytes[p + 6] | (bytes[p + 7] << 8);
    const lf = bytes[p + 8];
    p += 9;
    let ct = gct;
    if (lf & 0x80) { const n = 3 << ((lf & 7) + 1); ct = bytes.subarray(p, p + n); p += n; }
    const interlaced = !!(lf & 0x40);
    const minCode = bytes[p++];
    const chunks: Uint8Array[] = [];
    let len = 0;
    while (bytes[p] !== 0 && p < bytes.length) { const n = bytes[p]; chunks.push(bytes.subarray(p + 1, p + 1 + n)); len += n; p += n + 1; }
    p++;
    const data = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) { data.set(c, o); o += c.length; }
    const idx = lzwDecode(data, minCode, w * h);
    const before = disposal === 3 ? canvas.slice() : null;
    const rows: number[] = [];
    if (interlaced) { for (const [s, st] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let r = s; r < h; r += st) rows.push(r); }
    else for (let r = 0; r < h; r++) rows.push(r);
    for (let i = 0; i < h; i++) {
      const ry = y + rows[i];
      if (ry >= H) continue;
      for (let cx = 0; cx < w; cx++) {
        const v = idx[i * w + cx];
        if (v === transparent || !ct) continue;
        const rx = x + cx;
        if (rx >= W) continue;
        const q = (ry * W + rx) * 4;
        canvas[q] = ct[v * 3]; canvas[q + 1] = ct[v * 3 + 1]; canvas[q + 2] = ct[v * 3 + 2]; canvas[q + 3] = 255;
      }
    }
    frames.push({ rgba: canvas.slice(), delay: Math.max(20, delay) });
    if (disposal === 2) for (let r = y; r < Math.min(H, y + h); r++) canvas.fill(0, (r * W + x) * 4, (r * W + Math.min(W, x + w)) * 4);
    else if (disposal === 3 && before) canvas.set(before);
    transparent = -1; disposal = 0; delay = 100;
  }
  return { width: W, height: H, frames };
}

/** LZW-compresses palette indices for a GIF image block. */
function lzwEncode(idx: Uint8Array, minCode: number): number[] {
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, next = eoi + 1;
  const out: number[] = [];
  let buf = 0, bits = 0;
  const emit = (c: number) => { buf |= c << bits; bits += codeSize; while (bits >= 8) { out.push(buf & 255); buf >>>= 8; bits -= 8; } };
  let dict = new Map<number, number>();
  emit(clear);
  let w = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i];
    const key = (w << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) { w = hit; continue; }
    emit(w);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      codeSize = minCode + 1;
      next = eoi + 1;
    }
    w = k;
  }
  emit(w);
  emit(eoi);
  if (bits) out.push(buf & 255);
  return out;
}

/**
 * Encodes RGBA frames (each W × H, alpha 0 or 255) as a looping GIF. Colours beyond 255 are merged to the nearest
 * kept colour (pixel-art sprites have few).
 */
export function encodeGif(width: number, height: number, frames: { rgba: Uint8ClampedArray; delay: number }[]): Uint8Array {
  const counts = new Map<number, number>();
  for (const f of frames) for (let i = 0; i < f.rgba.length; i += 4) if (f.rgba[i + 3] >= 128) {
    const c = (f.rgba[i] << 16) | (f.rgba[i + 1] << 8) | f.rgba[i + 2];
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const palette = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 255).map(([c]) => c);
  const lookup = new Map<number, number>(palette.map((c, i) => [c, i + 1]));
  const nearest = (c: number) => {
    let best = 1, bd = Infinity;
    palette.forEach((p, i) => {
      const d = (((p >> 16) & 255) - ((c >> 16) & 255)) ** 2 + (((p >> 8) & 255) - ((c >> 8) & 255)) ** 2 + ((p & 255) - (c & 255)) ** 2;
      if (d < bd) { bd = d; best = i + 1; }
    });
    lookup.set(c, best);
    return best;
  };
  let bitsPer = 1;
  while (1 << bitsPer < palette.length + 1) bitsPer++;
  const tableSize = 1 << bitsPer;
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 255, (v >> 8) & 255);
  out.push(...Array.from("GIF89a", (c) => c.charCodeAt(0)));
  u16(width); u16(height);
  out.push(0x80 | 0x70 | (bitsPer - 1), 0, 0);
  for (let i = 0; i < tableSize; i++) {
    const c = i === 0 ? 0 : palette[i - 1] ?? 0;
    out.push((c >> 16) & 255, (c >> 8) & 255, c & 255);
  }
  // Loop forever.
  out.push(0x21, 0xff, 11, ...Array.from("NETSCAPE2.0", (c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  const minCode = Math.max(2, bitsPer);
  for (const f of frames) {
    out.push(0x21, 0xf9, 4, (2 << 2) | 1);
    u16(Math.max(2, Math.round(f.delay / 10)));
    out.push(0, 0);
    out.push(0x2c); u16(0); u16(0); u16(width); u16(height); out.push(0);
    const idx = new Uint8Array(width * height);
    for (let i = 0, j = 0; j < idx.length; i += 4, j++) {
      if (f.rgba[i + 3] < 128) continue;
      const c = (f.rgba[i] << 16) | (f.rgba[i + 1] << 8) | f.rgba[i + 2];
      idx[j] = lookup.get(c) ?? nearest(c);
    }
    out.push(minCode);
    const data = lzwEncode(idx, minCode);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}
