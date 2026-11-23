"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Species } from "@/lib/shiny-maker/data";
import { DATA_BASE } from "@/lib/shiny-maker/data";
import { FINISHES, type Design } from "@/lib/shiny-maker/design";
import type { View } from "@/lib/shiny-maker/recolor";
import { homeRenderUrl } from "@/lib/pokemon/art";
import type { FigureHandle } from "./PixelFigure";
import { webglProbe } from "@/lib/gl/probe";

export const HD_SIZE = 512;
export type PaintedKind = "hd" | "art";
const ART_RAW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork";
/** Where each painted style's pictures come from, and its size (the masks were built at this size). */
export const PAINTED: Record<PaintedKind, { size: number; normal: (id: number) => string; shiny: (id: number) => string; normalCors: boolean; mask: (id: number) => string }> = {
  hd: { size: HD_SIZE, normal: (id) => `/sizes/art/512/${id}.webp`, shiny: (id) => homeRenderUrl(id, true), normalCors: false, mask: (id) => `${DATA_BASE}/hd/${id}.png` },
  art: { size: 475, normal: (id) => `${ART_RAW}/${id}.png`, shiny: (id) => `${ART_RAW}/shiny/${id}.png`, normalCors: true, mask: (id) => `${DATA_BASE}/art/${id}.png` },
};
const MAX_PARTS = 8;

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;

/** The recolour of recolor.ts, per pixel: the same transform, finishes and chroma-only gamut mapping. */
const FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uN, uS, uL;
uniform int uView, uFinish, uHover, uHasShiny;
uniform vec2 uPx;
uniform float uTime;
uniform vec3 uRefN[${MAX_PARTS}], uRefS[${MAX_PARTS}];
uniform vec4 uTgt[${MAX_PARTS}];
uniform int uCustom[${MAX_PARTS}], uSrc[${MAX_PARTS}], uOutline[${MAX_PARTS}];

float toLin(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float fromLin(float c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
vec3 rgb2lab(vec3 c) {
  vec3 l = vec3(toLin(c.r), toLin(c.g), toLin(c.b));
  vec3 lms = vec3(0.4122214708 * l.r + 0.5363325363 * l.g + 0.0514459929 * l.b,
                  0.2119034982 * l.r + 0.6806995451 * l.g + 0.1073969566 * l.b,
                  0.0883024619 * l.r + 0.2817188376 * l.g + 0.6299787005 * l.b);
  lms = sign(lms) * pow(abs(lms), vec3(1.0 / 3.0));
  return vec3(0.2104542553 * lms.x + 0.793617785 * lms.y - 0.0040720468 * lms.z,
              1.9779984951 * lms.x - 2.428592205 * lms.y + 0.4505937099 * lms.z,
              0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.808675766 * lms.z);
}
vec3 lab2lin(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.291485548 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
              -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
              -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}
vec3 lab2lch(vec3 c) { float h = degrees(atan(c.z, c.y)); return vec3(c.x, length(c.yz), h < 0.0 ? h + 360.0 : h); }
bool inside(vec3 v) { return all(greaterThanEqual(v, vec3(-0.0001))) && all(lessThanEqual(v, vec3(1.0001))); }
vec3 lch2rgb(vec3 c) {
  float L = clamp(c.x, 0.0, 1.0), r = radians(c.z);
  vec2 d = vec2(cos(r), sin(r));
  float C = max(c.y, 0.0);
  vec3 lin = lab2lin(vec3(L, C * d));
  if (!inside(lin)) {
    float lo = 0.0, hi = C;
    for (int i = 0; i < 12; i++) { float mid = (lo + hi) * 0.5; if (inside(lab2lin(vec3(L, mid * d)))) lo = mid; else hi = mid; }
    lin = lab2lin(vec3(L, lo * d));
  }
  lin = clamp(lin, 0.0, 1.0);
  return vec3(fromLin(lin.r), fromLin(lin.g), fromLin(lin.b));
}
float hueDiff(float a, float b) { float d = mod(b - a + 540.0, 360.0) - 180.0; return d; }
float toward(float h, float t, float amt) { float d = hueDiff(h, t); return h + sign(d) * min(abs(d), amt); }
float softL(float l, float x) {
  if (x >= 0.0) { float room = 0.985 - l; return room <= 0.001 ? l : l + room * (1.0 - exp(-x / room)); }
  float room = l - 0.04; return room <= 0.001 ? l : l - room * (1.0 - exp(x / room));
}
vec3 xform(vec3 src, vec3 ref, vec4 t) {
  float d = src.x - ref.x;
  float l = softL(t.x, d * t.w);
  bool grey = ref.y < 0.03;
  float ratio = grey ? 1.0 - min(0.55, abs(d) * 1.1) : clamp(src.y / ref.y, 0.25, 1.8);
  float c = t.y * ratio;
  float own = smoothstep(0.02, 0.06, min(src.y, ref.y)) * hueDiff(ref.z, src.z);
  float moved = grey ? 1.0 : min(1.0, abs(hueDiff(ref.z, t.z)) / 30.0);
  float h = t.z + own;
  float warm = 30.0 * abs(l - t.x) * moved;
  if (warm > 0.01) h = l > t.x ? toward(h, 80.0, warm) : toward(h, 265.0, warm);
  return vec3(l, c, mod(h + 720.0, 360.0));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 finish(vec3 c, vec2 q) {
  if (uFinish == 1) { float l = clamp(0.52 + (c.x - 0.52) * 1.45 + 0.02, 0.08, 0.97); return vec3(l, c.y * (0.9 - 0.65 * smoothstep(0.62, 0.95, l)), c.z); }
  if (uFinish == 2) return vec3(min(0.95, 0.8 + (c.x - 0.62) * 0.45), min(c.y * 0.6, 0.1), c.z);
  if (uFinish == 3) return vec3(c.x + (0.5 - q.y) * 0.06, c.y * 1.05, mod(c.z + (q.y - 0.5) * 80.0 + 360.0, 360.0));
  if (uFinish == 4) {
    float band = mod((q.x * 0.8 + q.y * 1.1) * 360.0 + uTime * 70.0, 360.0);
    float mixv = 0.4 + 0.25 * smoothstep(0.55, 0.9, c.x);
    return vec3(min(0.96, c.x + 0.04), max(c.y * 0.7, 0.11 * mixv + c.y * (1.0 - mixv)), mod(c.z + hueDiff(c.z, band) * mixv + 360.0, 360.0));
  }
  if (uFinish == 5) {
    vec2 cell = floor(q * 150.0);
    float r = hash(cell);
    if (r < 0.03) { float tw = uTime > 0.0 ? 0.5 + 0.5 * sin(uTime * 2.4 + r * 400.0) : 1.0; if (tw > 0.35) return vec3(0.86 + 0.1 * tw, 0.03, 250.0); }
    float sw = sin(q.x * 6.5 + q.y * 4.0 + sin(q.y * 9.0) * 0.8);
    return vec3(0.16 + c.x * 0.42 + sw * 0.03, 0.07 + 0.06 * (0.5 + 0.5 * sw), mod(285.0 + sw * 35.0 + (c.z - 285.0) * 0.15 + 720.0, 360.0));
  }
  return c;
}
int labelAt(vec2 p) { return int(texture(uL, p).r * 255.0 + 0.5) - 1; }
void main() {
  vec4 n = texture(uN, uv);
  vec4 s = uHasShiny == 1 ? texture(uS, uv) : n;
  if (uView == 0) { o = n; return; }
  if (uView == 1) { o = s; return; }
  int lab = labelAt(uv);
  vec3 rgb = n.rgb;
  float a = n.a;
  if (lab >= 0 && lab < ${MAX_PARTS}) {
    bool shinySrc = uSrc[lab] == 1;
    vec4 srcPx = shinySrc ? s : n;
    rgb = srcPx.rgb;
    bool fin = uFinish != 0 && uOutline[lab] == 0;
    if (uCustom[lab] == 1 || fin) {
      vec3 c = lab2lch(rgb2lab(srcPx.rgb));
      if (uCustom[lab] == 1) c = xform(c, shinySrc ? uRefS[lab] : uRefN[lab], uTgt[lab]);
      if (fin) c = finish(c, uv);
      rgb = lch2rgb(c);
    }
    if (lab == uHover) {
      vec2 px = uPx;
      bool edge = labelAt(uv + vec2(px.x, 0.0)) != lab || labelAt(uv - vec2(px.x, 0.0)) != lab || labelAt(uv + vec2(0.0, px.y)) != lab || labelAt(uv - vec2(0.0, px.y)) != lab;
      if (edge) { rgb = vec3(1.0); a = 1.0; }
    }
  }
  o = vec4(rgb, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
  return sh;
}

async function bitmap(url: string, cors: boolean, N: number): Promise<ImageBitmap> {
  const res = await fetch(url, cors ? { mode: "cors" } : undefined);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none", resizeWidth: N, resizeHeight: N, resizeQuality: "high" });
}

interface HdAssets { normal: ImageBitmap; shiny: ImageBitmap | null; labels: ImageBitmap; labelData: Uint8Array; size: number }
const assets = new Map<string, Promise<HdAssets>>();
export function loadHd(id: number, kind: PaintedKind = "hd"): Promise<HdAssets> {
  const key = `${kind}:${id}`;
  const cfg = PAINTED[kind], N = cfg.size;
  let p = assets.get(key);
  if (!p) {
    p = (async () => {
      const [normal, shiny, labels] = await Promise.all([
        bitmap(cfg.normal(id), cfg.normalCors, N),
        bitmap(cfg.shiny(id), true, N).catch(() => null),
        fetch(cfg.mask(id)).then((r) => { if (!r.ok) throw new Error("mask"); return r.blob(); }).then((b) => createImageBitmap(b, { premultiplyAlpha: "none", colorSpaceConversion: "none" })),
      ]);
      // The labels on the CPU too, for picking a part under the pointer.
      const c = document.createElement("canvas");
      c.width = N; c.height = N;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(labels, 0, 0);
      const data = ctx.getImageData(0, 0, N, N).data;
      const labelData = new Uint8Array(N * N);
      for (let i = 0; i < labelData.length; i++) labelData[i] = data[i * 4];
      return { normal, shiny, labels, labelData, size: N };
    })();
    p.catch(() => assets.delete(key));
    assets.set(key, p);
  }
  return p;
}

export function hasWebGL2(): boolean {
  return webglProbe();
}

/** The Pokémon painted (its HOME render, or its official artwork), recoloured per part in a WebGL 2 shader. */
export const HdFigure = forwardRef<FigureHandle, {
  kind: PaintedKind;
  sp: Species;
  design: Design;
  view: View;
  size: number;
  hover: number;
  motion: boolean;
  label: string;
  onReady?: () => void;
  onFail: () => void;
}>(function HdFigure({ kind, sp, design, view, size, hover, motion, label, onReady, onFail }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<HdAssets | null>(null);
  const gl = useRef<{ gl: WebGL2RenderingContext; prog: WebGLProgram; tex: WebGLTexture[]; u: Record<string, WebGLUniformLocation | null> } | null>(null);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useImperativeHandle(ref, () => ({
    partAt(cx, cy) {
      const el = canvas.current;
      if (!el || !data) return -1;
      const r = el.getBoundingClientRect();
      const N = data.size;
      const x = Math.floor(((cx - r.left) / r.width) * N), y = Math.floor(((cy - r.top) / r.height) * N);
      if (x < 0 || y < 0 || x >= N || y >= N) return -1;
      return data.labelData[y * N + x] - 1;
    },
  }), [data]);

  useEffect(() => {
    let live = true;
    setData(null);
    loadHd(sp.id, kind).then((d) => live && setData(d), () => live && failRef.current());
    return () => { live = false; };
  }, [sp.id, kind]);

  // Set up WebGL once the pictures are in.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !data) return;
    const g = el.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!g) { failRef.current(); return; }
    try {
      const prog = g.createProgram()!;
      g.attachShader(prog, compile(g, g.VERTEX_SHADER, VERT));
      g.attachShader(prog, compile(g, g.FRAGMENT_SHADER, FRAG));
      g.linkProgram(prog);
      if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog) ?? "link");
      g.useProgram(prog);
      const buf = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
      const loc = g.getAttribLocation(prog, "p");
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
      g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE);
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const tex = [data.normal, data.shiny ?? data.normal, data.labels].map((img, i) => {
        const t = g.createTexture()!;
        g.activeTexture(g.TEXTURE0 + i);
        g.bindTexture(g.TEXTURE_2D, t);
        const filter = i === 2 ? g.NEAREST : g.LINEAR;
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, filter);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, filter);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
        return t;
      });
      const names = ["uPx", "uN", "uS", "uL", "uView", "uFinish", "uHover", "uHasShiny", "uTime", "uRefN", "uRefS", "uTgt", "uCustom", "uSrc", "uOutline"];
      const u = Object.fromEntries(names.map((n) => [n, g.getUniformLocation(prog, n)]));
      g.uniform1i(u.uN, 0); g.uniform1i(u.uS, 1); g.uniform1i(u.uL, 2);
      gl.current = { gl: g, prog, tex, u };
      readyRef.current?.();
    } catch (e) {
      console.warn("[shiny-maker] HD unavailable:", e);
      failRef.current();
    }
    return () => {
      const cur = gl.current;
      if (cur) { cur.tex.forEach((t) => cur.gl.deleteTexture(t)); cur.gl.deleteProgram(cur.prog); }
      gl.current = null;
    };
  }, [data]);

  // Draw on every change (and keep drawing while holo or galaxy shimmers).
  useEffect(() => {
    const cur = gl.current;
    if (!cur || !data) return;
    const { gl: g, u } = cur;
    const refs = (kind === "art" ? sp.art : sp.hd) ?? [];
    const n = Math.min(MAX_PARTS, design.parts.length);
    const refN = new Float32Array(MAX_PARTS * 3), refS = new Float32Array(MAX_PARTS * 3), tgt = new Float32Array(MAX_PARTS * 4);
    const custom = new Int32Array(MAX_PARTS), src = new Int32Array(MAX_PARTS), outline = new Int32Array(MAX_PARTS);
    for (let i = 0; i < n; i++) {
      const r = refs[i] ?? [0.5, 0, 0, 0.5, 0, 0];
      refN.set(r.slice(0, 3), i * 3);
      refS.set(r.slice(3, 6), i * 3);
      const st = design.parts[i];
      src[i] = st.src === 1 && data.shiny ? 1 : 0;
      outline[i] = sp.parts[i]?.o ? 1 : 0;
      let col = st.col;
      // Without the shiny render, an untouched shiny part is drawn by moving the normal one to the shiny's colour.
      if (!col && st.src === 1 && !data.shiny) col = { l: r[3], c: r[4], h: r[5], k: 1 };
      if (col) { custom[i] = 1; tgt.set([col.l, col.c, col.h, col.k], i * 4); }
    }
    g.uniform3fv(u.uRefN, refN); g.uniform3fv(u.uRefS, refS); g.uniform4fv(u.uTgt, tgt);
    g.uniform1iv(u.uCustom, custom); g.uniform1iv(u.uSrc, src); g.uniform1iv(u.uOutline, outline);
    g.uniform1i(u.uView, view === "normal" ? 0 : view === "official" ? (data.shiny ? 1 : 2) : 2);
    if (view === "official" && !data.shiny) {
      // Official without the shiny render: every part as the shiny's colour.
      for (let i = 0; i < n; i++) { const r = refs[i] ?? [0.5, 0, 0, 0.5, 0, 0]; custom[i] = 1; src[i] = 0; tgt.set([r[3], r[4], r[5], 1], i * 4); }
      g.uniform4fv(u.uTgt, tgt); g.uniform1iv(u.uCustom, custom); g.uniform1iv(u.uSrc, src);
    }
    g.uniform1i(u.uFinish, view === "yours" ? FINISHES.indexOf(design.finish) : 0);
    g.uniform1i(u.uHover, view === "yours" ? hover : -1);
    g.uniform1i(u.uHasShiny, data.shiny ? 1 : 0);
    g.uniform2f(u.uPx, 2 / data.size, 2 / data.size);
    g.viewport(0, 0, data.size, data.size);
    const shimmer = motion && view === "yours" && (design.finish === "holo" || design.finish === "galaxy");
    const draw = (t: number) => { g.uniform1f(u.uTime, t); g.drawArrays(g.TRIANGLE_STRIP, 0, 4); };
    if (!shimmer) { draw(0.6); return; }
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => { draw(0.6 + (now - t0) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [data, sp, design, view, hover, motion, kind]);

  return (
    <canvas
      ref={canvas}
      width={data?.size ?? PAINTED[kind].size}
      height={data?.size ?? PAINTED[kind].size}
      role="img"
      aria-label={label}
      className="block transition-opacity duration-300"
      style={{ width: size, height: size, opacity: data ? 1 : 0 }}
      data-testid="sm-hd-canvas"
    />
  );
});
