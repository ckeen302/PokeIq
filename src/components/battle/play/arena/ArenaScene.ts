import * as THREE from "three";
import { BACKDROP_H, BACKDROP_W, groundSpots, toNdc, type ArenaField, type ArenaKind, type GroundSpot } from "./layout";
import { webglAvailable } from "./webgl";

/**
 * The battle's 3D arena, drawn behind Showdown's 2D stage: a championship
 * stadium at dusk (Random Battle, the ladder and most formats), a Battle
 * Frontier hall (Factory and Tower), a wider night arena (doubles) and an
 * outdoor field (custom rules). Built from code only (no models or image
 * files), lit cheaply, and sized to the stage: the canvas covers the
 * backdrop layer (640×450 in stage pixels; Earthquake shakes it), and its
 * two platforms are cast from the exact screen points the sprites stand on
 * (layout.ts), so the Pokémon stand on them.
 *
 * Field state shows in 3D: rain, snow and sand particles, harsh-sun rays
 * with a warm grade, a glowing terrain floor and Trick Room's warped
 * lattice. The crowd's camera flashes go off now and then, and in a burst
 * on a big moment (cheer()).
 *
 * Adaptive quality, as on the globe and the timeline: the frame time is
 * watched; slow frames step the pixel ratio, crowd and particles down, and a
 * device that can't keep up even then gets the CSS backdrop instead
 * (failed("slow")).
 */

export interface ArenaOptions {
  kind: ArenaKind;
  /** Pokémon a side (1 singles, 2 doubles). */
  active: number;
  field: ArenaField;
  /** The stage's CSS scale (its on-screen width / 640). */
  scale: number;
  /** Pins the quality level (0–3); null lets the frame-time monitor choose. */
  quality: number | null;
}

export interface ArenaCallbacks {
  ready(): void;
  failed(reason: "context" | "slow"): void;
  quality?(q: number): void;
}

export interface ArenaApi {
  setField(field: ArenaField): void;
  setScale(scale: number): void;
  /** The crowd reacts: a burst of camera flashes (a crit, a KO). */
  cheer(power?: number): void;
  dispose(): void;
}

const QUALITY = [
  { pr: 0.75, crowd: 0, particles: 0.25, fps: 30 },
  { pr: 1.25, crowd: 0.5, particles: 0.5, fps: 30 },
  { pr: 1.75, crowd: 1, particles: 0.8, fps: 60 },
  { pr: 2, crowd: 1, particles: 1, fps: 60 },
] as const;
const FRAME_BUDGET_MS = 1000 / 30;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Colour, independent of three's colour-management flag (other scenes on the site turn it off)
// ---------------------------------------------------------------------------

const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** An sRGB hex as a linear colour, the same whatever THREE.ColorManagement is set to. */
function lin(hex: number, k = 1) {
  return new THREE.Color().setRGB(s2l(((hex >> 16) & 255) / 255) * k, s2l(((hex >> 8) & 255) / 255) * k, s2l((hex & 255) / 255) * k, THREE.LinearSRGBColorSpace);
}

interface Palette {
  skyTop: number;
  skyMid: number;
  skyHorizon: number;
  sun: number;
  fog: number;
  near: number;
  far: number;
  stripA: number;
  stripB: number;
  stands: number;
  standsAlt: number;
  floorA: number;
  floorB: number;
  hemiSky: number;
  hemiGround: number;
  key: number;
}

const PALETTES: Record<ArenaKind, Palette> = {
  stadium: {
    skyTop: 0x170f45, skyMid: 0x7a2c7e, skyHorizon: 0xff8a52, sun: 0xffc27a, fog: 0x2a1748,
    near: 0xf0457f, far: 0xa78bfa, stripA: 0xff4f9a, stripB: 0x8f7bff,
    stands: 0x3a2c6e, standsAlt: 0x46367f, floorA: 0x2b2160, floorB: 0x1a1440,
    hemiSky: 0x9a8cff, hemiGround: 0x2a1530, key: 0xffc59a,
  },
  doubles: {
    skyTop: 0x050b24, skyMid: 0x0f2a52, skyHorizon: 0x2fb6c9, sun: 0x8ff0ff, fog: 0x0b1d38,
    near: 0xffa63d, far: 0x3ddcff, stripA: 0x38e1ff, stripB: 0xffb347,
    stands: 0x21365e, standsAlt: 0x2a4270, floorA: 0x16345a, floorB: 0x0d2140,
    hemiSky: 0x7fd8ff, hemiGround: 0x101a2a, key: 0xd6f4ff,
  },
  frontier: {
    skyTop: 0x05070f, skyMid: 0x0a1020, skyHorizon: 0x152240, sun: 0x9fe8ff, fog: 0x060a18,
    near: 0xffcf5a, far: 0x48e0ff, stripA: 0x48e0ff, stripB: 0xffcf5a,
    stands: 0x111a2e, standsAlt: 0x17223a, floorA: 0x111a2e, floorB: 0x080d1a,
    hemiSky: 0x8fb8ff, hemiGround: 0x0a0e18, key: 0xe6f2ff,
  },
  field: {
    skyTop: 0x3f86d8, skyMid: 0x8cc6f0, skyHorizon: 0xffe0a8, sun: 0xfff1c4, fog: 0xc7dcea,
    near: 0xffffff, far: 0xffffff, stripA: 0xffffff, stripB: 0xffffff,
    stands: 0x3e7a3a, standsAlt: 0x4f8f45, floorA: 0x5ea84a, floorB: 0x3f8a3a,
    hemiSky: 0xd8ecff, hemiGround: 0x4a7a3a, key: 0xfff0d0,
  },
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A soft round glow (white; tint it with the material colour). */
function glowTexture() {
  return canvasTexture(128, 128, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.6, "rgba(255,255,255,0.12)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  });
}

const hexCss = (hex: number, a = 1) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;

/** Mulberry32: the same arena every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Puts each shader chunk include on its own line (the shaders are written compactly). */
const INCLUDE = /#include <(\w+)>/g;

const COMMON_FRAG_TAIL = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export function createArena(host: HTMLElement, opts: ArenaOptions, cb: ArenaCallbacks): ArenaApi | null {
  if (!webglAvailable()) return null;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `position:absolute;left:0;top:0;width:${BACKDROP_W}px;height:${BACKDROP_H}px;display:block;`;
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch {
    canvas.remove();
    return null;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const kind = opts.kind;
  // The canvas is only the stage's size, so even phones start well up the scale; slow frames step it down.
  let quality = opts.quality ?? 2;
  const pal = PALETTES[kind];
  const R = rng(kind.length * 977 + opts.active * 31);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);
  const glow = keep(glowTexture());

  const scene = new THREE.Scene();
  scene.background = lin(pal.fog);
  scene.fog = new THREE.Fog(lin(pal.fog), kind === "frontier" ? 28 : 30, kind === "frontier" ? 110 : 140);
  const camera = new THREE.PerspectiveCamera(32, BACKDROP_W / BACKDROP_H, 0.1, 900);
  // A low broadcast camera behind your Pokémon: the horizon a seventh of the way down the stage.
  const CAM = new THREE.Vector3(0, 3.8, 14);
  const LOOK = new THREE.Vector3(0, 2.3, 0);
  camera.position.copy(CAM);
  camera.lookAt(LOOK);
  camera.updateMatrixWorld();

  // ---- where the platforms go: the sprites' feet cast onto the floor
  const ray = new THREE.Raycaster();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const cast = (x: number, y: number) => {
    const n = toNdc(x, y);
    ray.setFromCamera(new THREE.Vector2(n.x, n.y), camera);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(floor, out) ?? out.set(0, 0, 0);
  };
  const spots = groundSpots(opts.active);
  const platformOf = (s: GroundSpot) => {
    const centre = cast(s.x, s.y);
    const left = cast(s.x - s.width / 2, s.y);
    const right = cast(s.x + s.width / 2, s.y);
    return { centre, radius: left.distanceTo(right) / 2, across: right.clone().sub(left).normalize() };
  };
  const nearP = platformOf(spots.near);
  const farP = platformOf(spots.far);
  const mid = nearP.centre.clone().add(farP.centre).multiplyScalar(0.5);
  const axis = farP.centre.clone().sub(nearP.centre);
  const length = axis.length();
  axis.normalize();

  /** The arena's own frame: origin between the platforms, -Z towards the opponent. */
  const world = new THREE.Group();
  world.position.copy(mid);
  world.rotation.y = Math.atan2(-axis.x, -axis.z);
  scene.add(world);
  world.updateMatrixWorld();
  const toLocal = (v: THREE.Vector3) => world.worldToLocal(v.clone());
  const camLocal = toLocal(CAM);

  // ---- light
  const hemi = new THREE.HemisphereLight(lin(pal.hemiSky), lin(pal.hemiGround), kind === "field" ? 1.6 : 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(lin(pal.key), kind === "field" ? 2.2 : 1.4);
  key.position.set(-14, 22, -10);
  scene.add(key);
  const fillK = kind === "frontier" ? 0.45 : 1;
  const fill = new THREE.PointLight(lin(pal.near), 18 * fillK, 22, 1.4);
  fill.position.copy(nearP.centre).add(new THREE.Vector3(0, 3, 1));
  const fill2 = new THREE.PointLight(lin(pal.far), 14 * fillK, 22, 1.4);
  fill2.position.copy(farP.centre).add(new THREE.Vector3(0, 3, -1));
  if (kind !== "field") scene.add(fill, fill2);

  // ---- per-frame updaters
  const tickers: ((t: number, dt: number) => void)[] = [];
  const shaders: THREE.ShaderMaterial[] = [];
  const timeUniform = { value: 0 };

  const addShader = (m: THREE.ShaderMaterial) => {
    m.uniforms.uTime = timeUniform;
    shaders.push(keep(m));
    return m;
  };

  // ---- sky (outdoor arenas) or the hall's dark ceiling
  {
    const geo = keep(new THREE.SphereGeometry(600, 32, 16));
    const mat = addShader(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: lin(pal.skyTop) },
          uMid: { value: lin(pal.skyMid) },
          uHorizon: { value: lin(pal.skyHorizon) },
          uSun: { value: lin(pal.sun) },
          uSunDir: { value: new THREE.Vector3(-0.55, 0.12, -0.83).normalize() },
          uStars: { value: kind === "field" ? 0 : 1 },
          uTime: timeUniform,
        },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `
          uniform vec3 uTop, uMid, uHorizon, uSun, uSunDir; uniform float uStars, uTime; varying vec3 vDir;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          void main(){
            float h = clamp(vDir.y, -0.2, 1.0);
            // Dusk: a hot band at the horizon, through magenta, up to night.
            vec3 c = mix(uHorizon, uMid, smoothstep(-0.01, 0.075, h));
            c = mix(c, uTop, smoothstep(0.06, 0.32, h));
            float az = atan(vDir.z, vDir.x);
            float streak = sin(az * 9.0 + sin(az * 23.0) * 0.6) * 0.5 + 0.5;
            float band = smoothstep(0.012, 0.03, h) * smoothstep(0.075, 0.04, h);
            c = mix(c, uMid * 0.55, band * streak * 0.5 * uStars);
            float s = max(dot(vDir, uSunDir), 0.0);
            c += uSun * (pow(s, 24.0) * 0.9 + pow(s, 4.0) * 0.18) * smoothstep(-0.05, 0.1, h);
            vec2 g = floor(vec2(atan(vDir.z, vDir.x) * 180.0, h * 260.0));
            float star = step(0.9965, hash(g)) * smoothstep(0.12, 0.5, h) * uStars;
            c += vec3(star) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(g + 3.0) * 40.0));
            gl_FragColor = vec4(c, 1.0);
            ${COMMON_FRAG_TAIL}
          }`,
      })
    );
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10;
    scene.add(sky);
  }

  // ---- shared builders
  const ellipse = (a: number, b: number, t: number, y = 0) => new THREE.Vector3(Math.cos(t) * a, y, Math.sin(t) * b);

  /** A ring ribbon of light along an ellipse (LED strips), its colours chasing round. */
  function strip(
    a: number,
    b: number,
    y: number,
    height: number,
    colors: [number, number],
    opts2: { speed?: number; reps?: number; alpha?: number; facing?: "up" | "side"; lift?: (t: number) => number; hide?: (t: number) => boolean } = {}
  ) {
    const S = 160;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= S; i++) {
      const t = (i / S) * TAU;
      const p = ellipse(a, b, t, y + (opts2.lift?.(t) ?? 0));
      if (opts2.facing === "up") {
        const q = ellipse(a + height, b + height, t, y);
        pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
      } else {
        pos.push(p.x, p.y, p.z, p.x, p.y + height, p.z);
      }
      uv.push(i / S, 0, i / S, 1);
      if (i < S && !opts2.hide?.(((i + 0.5) / S) * TAU)) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = addShader(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: true,
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          uA: { value: lin(colors[0], 2.2) },
          uB: { value: lin(colors[1], 2.2) },
          uSpeed: { value: opts2.speed ?? 0.06 },
          uReps: { value: opts2.reps ?? 6 },
          uAlpha: { value: opts2.alpha ?? 1 },
          uFlash: flashUniform,
          uTime: timeUniform,
        },
        vertexShader: `varying vec2 vUv; #include <fog_pars_vertex>
          void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mvPosition; #include <fog_vertex> }`.replace(INCLUDE, "\n#include <$1>\n"),
        fragmentShader: `uniform vec3 uA, uB; uniform float uSpeed, uReps, uAlpha, uTime, uFlash; varying vec2 vUv; #include <fog_pars_fragment>
          void main(){
            float w = 0.5 + 0.5 * sin((vUv.x * uReps - uTime * uSpeed) * 6.2831);
            vec3 c = mix(uA, uB, w);
            float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
            float seg = 0.75 + 0.25 * step(0.5, fract(vUv.x * 240.0));
            gl_FragColor = vec4(c * (1.0 + uFlash * 1.5) * seg, (0.55 + 0.45 * edge) * uAlpha);
            ${COMMON_FRAG_TAIL}
            #include <fog_fragment>
          }`.replace(INCLUDE, "\n#include <$1>\n"),
      })
    );
    const mesh = new THREE.Mesh(geo, mat);
    world.add(mesh);
    return mesh;
  }

  /** An additive glow card that always faces the camera. */
  function glowSprite(color: number, size: number, k = 1.6, opacity = 1) {
    const m = keep(new THREE.SpriteMaterial({ map: glow, color: lin(color, k), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: true }));
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    return s;
  }

  /** A soft cone of light (floodlights, sun rays): bright at its source, fading out. */
  function lightCone(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, color: number, alpha: number) {
    const len = from.distanceTo(to);
    const geo = keep(new THREE.CylinderGeometry(r0, r1, len, 24, 1, true));
    geo.translate(0, -len / 2, 0);
    const mat = addShader(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: lin(color, 1.4) }, uAlpha: { value: alpha }, uTime: timeUniform },
        vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 uColor; uniform float uAlpha, uTime; varying float vY; varying vec3 vN; varying vec3 vV;
          void main(){
            float rim = pow(abs(dot(vN, vV)), 1.6);
            float a = uAlpha * pow(vY, 1.7) * rim * (0.92 + 0.08 * sin(uTime * 1.3));
            gl_FragColor = vec4(uColor, a);
            ${COMMON_FRAG_TAIL}
          }`,
      })
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
    return mesh;
  }

  const flashUniform = { value: 0 };

  // ---- the floor and the court
  const courtHalf = { x: kind === "doubles" ? 8.5 : 6.5, z: Math.max(8, length / 2 + 3.2) };
  const floorSize = kind === "field" ? 160 : kind === "frontier" ? 60 : 70;
  {
    const tex = keep(
      canvasTexture(1024, 1024, (g, w, h) => {
        const px = (x: number) => w / 2 + (x / floorSize) * w;
        const pz = (z: number) => h / 2 + (z / floorSize) * h;
        const sc = w / floorSize;
        if (kind === "field") {
          g.fillStyle = hexCss(pal.floorA);
          g.fillRect(0, 0, w, h);
          const rr = rng(7);
          for (let i = 0; i < 9000; i++) {
            g.fillStyle = rr() < 0.5 ? "rgba(30,80,30,0.25)" : "rgba(140,200,90,0.2)";
            g.fillRect(rr() * w, rr() * h, 2 + rr() * 3, 1 + rr() * 2);
          }
          // The worn battle court: a dirt oval between the platforms.
          const grad = g.createRadialGradient(px(0), pz(0), 0, px(0), pz(0), (courtHalf.z + 2) * sc);
          grad.addColorStop(0, "rgba(176,140,92,0.95)");
          grad.addColorStop(0.72, "rgba(160,126,80,0.85)");
          grad.addColorStop(1, "rgba(160,126,80,0)");
          g.save();
          g.translate(px(0), pz(0));
          g.scale((courtHalf.x + 1.5) / (courtHalf.z + 2), 1);
          g.translate(-px(0), -pz(0));
          g.fillStyle = grad;
          g.beginPath();
          g.arc(px(0), pz(0), (courtHalf.z + 2) * sc, 0, TAU);
          g.fill();
          g.restore();
          for (let i = 0; i < 2500; i++) {
            const a = rr() * TAU;
            const r = Math.sqrt(rr());
            g.fillStyle = rr() < 0.5 ? "rgba(120,92,58,0.35)" : "rgba(210,180,130,0.3)";
            g.fillRect(px(Math.cos(a) * r * courtHalf.x), pz(Math.sin(a) * r * courtHalf.z), 2, 2);
          }
          g.strokeStyle = "rgba(255,255,255,0.55)";
          g.lineWidth = 0.09 * sc;
          g.strokeRect(px(-courtHalf.x + 1), pz(-courtHalf.z + 1), (courtHalf.x - 1) * 2 * sc, (courtHalf.z - 1) * 2 * sc);
          g.beginPath();
          g.moveTo(px(-courtHalf.x + 1), pz(0));
          g.lineTo(px(courtHalf.x - 1), pz(0));
          g.stroke();
          g.beginPath();
          g.arc(px(0), pz(0), 2 * sc, 0, TAU);
          g.stroke();
          return;
        }
        const base = g.createRadialGradient(px(0), pz(0), 0, px(0), pz(0), w * 0.55);
        base.addColorStop(0, hexCss(pal.floorA));
        base.addColorStop(1, hexCss(pal.floorB));
        g.fillStyle = base;
        g.fillRect(0, 0, w, h);
        // Fine tiles.
        g.strokeStyle = kind === "frontier" ? "rgba(140,200,255,0.07)" : "rgba(255,255,255,0.045)";
        g.lineWidth = 1;
        const step = (kind === "frontier" ? 2 : 1.5) * sc;
        for (let x = (w / 2) % step; x < w; x += step) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, h);
          g.stroke();
        }
        for (let y = (h / 2) % step; y < h; y += step) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y);
          g.stroke();
        }
        // The court: a lighter field, its lines and the centre ball.
        g.fillStyle = kind === "frontier" ? "rgba(72,224,255,0.05)" : "rgba(255,255,255,0.05)";
        g.fillRect(px(-courtHalf.x), pz(-courtHalf.z), courtHalf.x * 2 * sc, courtHalf.z * 2 * sc);
        const line = kind === "frontier" ? "rgba(120,230,255,0.75)" : "rgba(255,255,255,0.7)";
        g.strokeStyle = line;
        g.lineWidth = 0.08 * sc;
        g.strokeRect(px(-courtHalf.x), pz(-courtHalf.z), courtHalf.x * 2 * sc, courtHalf.z * 2 * sc);
        g.lineWidth = 0.05 * sc;
        g.strokeRect(px(-courtHalf.x + 0.5), pz(-courtHalf.z + 0.5), (courtHalf.x - 0.5) * 2 * sc, (courtHalf.z - 0.5) * 2 * sc);
        g.beginPath();
        g.moveTo(px(-courtHalf.x), pz(0));
        g.lineTo(px(courtHalf.x), pz(0));
        g.stroke();
        g.lineWidth = 0.08 * sc;
        g.beginPath();
        g.arc(px(0), pz(0), 2.2 * sc, 0, TAU);
        g.stroke();
        g.beginPath();
        g.arc(px(0), pz(0), 0.55 * sc, 0, TAU);
        g.stroke();
        // The two halves' colours, faint.
        for (const [z0, col] of [
          [0, pal.near],
          [-courtHalf.z, pal.far],
        ] as const) {
          const gr = g.createLinearGradient(0, pz(z0), 0, pz(z0 + courtHalf.z));
          gr.addColorStop(z0 === 0 ? 1 : 0, hexCss(col, 0.12));
          gr.addColorStop(z0 === 0 ? 0 : 1, hexCss(col, 0.02));
          g.fillStyle = gr;
          g.fillRect(px(-courtHalf.x), pz(z0), courtHalf.x * 2 * sc, courtHalf.z * sc);
        }
        if (kind === "frontier") {
          // The runway of light from one platform to the other.
          g.strokeStyle = "rgba(255,207,90,0.55)";
          g.lineWidth = 0.05 * sc;
          for (const x of [-1.4, 1.4]) {
            g.beginPath();
            g.moveTo(px(x), pz(-courtHalf.z));
            g.lineTo(px(x), pz(courtHalf.z));
            g.stroke();
          }
        }
      })
    );
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = keep(
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: kind === "frontier" ? 0.34 : kind === "field" ? 0.95 : 0.55,
        metalness: kind === "frontier" ? 0.55 : 0.1,
        color: lin(0xffffff),
      })
    );
    const geo = keep(new THREE.PlaneGeometry(floorSize, floorSize));
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    world.add(mesh);
  }

  // ---- the platforms (and their glow), where the sprites stand
  const platforms: { glow: THREE.Mesh; ring: THREE.Mesh; color: number }[] = [];
  function platform(p: { centre: THREE.Vector3; radius: number; across: THREE.Vector3 }, color: number, near: boolean) {
    const group = new THREE.Group();
    const c = toLocal(p.centre);
    group.position.copy(c);
    // Doubles: a long platform under both Pokémon (stretched along the screen's horizontal).
    const stretch = opts.active > 1 ? 1.45 : 1;
    const across = p.across.clone().transformDirection(new THREE.Matrix4().copy(world.matrixWorld).invert());
    group.rotation.y = Math.atan2(-across.z, across.x);
    const r = p.radius / stretch;
    const top = keep(
      canvasTexture(512, 512, (g, w) => {
        const cx = w / 2;
        const base = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
        if (kind === "field") {
          base.addColorStop(0, "#c9bfae");
          base.addColorStop(0.8, "#a59a88");
          base.addColorStop(1, "#7d7465");
        } else {
          base.addColorStop(0, hexCss(color, 0.38));
          base.addColorStop(0.7, hexCss(color, 0.16));
          base.addColorStop(1, hexCss(color, 0.32));
        }
        g.fillStyle = kind === "field" ? "#a59a88" : "#1a1530";
        g.beginPath();
        g.arc(cx, cx, cx, 0, TAU);
        g.fill();
        g.fillStyle = base;
        g.fill();
        const ink = kind === "field" ? "rgba(70,60,48,0.55)" : hexCss(color, 0.9);
        g.strokeStyle = ink;
        g.lineWidth = 6;
        g.beginPath();
        g.arc(cx, cx, cx * 0.94, 0, TAU);
        g.stroke();
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cx, cx * 0.62, 0, TAU);
        g.stroke();
        g.globalAlpha = 0.6;
        g.beginPath();
        g.moveTo(cx * 0.06, cx);
        g.lineTo(cx * 0.72, cx);
        g.moveTo(cx * 1.28, cx);
        g.lineTo(cx * 1.94, cx);
        g.stroke();
        g.beginPath();
        g.arc(cx, cx, cx * 0.22, 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
        if (kind === "field") {
          const rr = rng(near ? 3 : 4);
          for (let i = 0; i < 900; i++) {
            g.fillStyle = rr() < 0.5 ? "rgba(60,50,40,0.18)" : "rgba(255,255,255,0.12)";
            const a = rr() * TAU;
            const d = Math.sqrt(rr()) * cx;
            g.fillRect(cx + Math.cos(a) * d, cx + Math.sin(a) * d, 3, 3);
          }
        }
      })
    );
    const lift = 0.16;
    const body = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(r, r * 1.04, lift, 64)),
      keep(new THREE.MeshStandardMaterial({ color: lin(kind === "field" ? 0x8a8070 : 0x1d1838), roughness: kind === "field" ? 0.9 : 0.35, metalness: kind === "field" ? 0 : 0.6 }))
    );
    body.position.y = lift / 2;
    const face = new THREE.Mesh(keep(new THREE.CircleGeometry(r * 0.995, 64)), keep(new THREE.MeshStandardMaterial({ map: top, roughness: 0.5, metalness: 0.2, emissive: lin(kind === "field" ? 0x000000 : color), emissiveIntensity: kind === "field" ? 0 : 0.18, emissiveMap: kind === "field" ? null : top })));
    face.rotation.x = -Math.PI / 2;
    face.position.y = lift + 0.002;
    // The rim: a band of light round the edge.
    const ring = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(r * 1.045, r * 1.045, 0.05, 96, 1, true)),
      keep(new THREE.MeshBasicMaterial({ color: lin(kind === "field" ? 0xfff2c8 : color, kind === "field" ? 0.4 : 2.4), transparent: true, opacity: kind === "field" ? 0.0 : 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    );
    ring.position.y = lift * 0.75;
    // The glow on the floor round it.
    const glowMesh = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(r * 4.2, r * 4.2)),
      keep(new THREE.MeshBasicMaterial({ map: glow, color: lin(kind === "field" ? 0x000000 : color, 1.2), transparent: true, opacity: kind === "field" ? 0 : 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
    );
    glowMesh.rotation.x = -Math.PI / 2;
    glowMesh.position.y = 0.01;
    // Field: a soft dark shadow ring on the grass instead of a glow.
    if (kind === "field") {
      const shade = new THREE.Mesh(
        keep(new THREE.PlaneGeometry(r * 2.8, r * 2.8)),
        keep(new THREE.MeshBasicMaterial({ map: glow, color: lin(0x000000), transparent: true, opacity: 0.35, depthWrite: false }))
      );
      shade.rotation.x = -Math.PI / 2;
      shade.position.y = 0.008;
      group.add(shade);
    }
    group.add(glowMesh, body, face, ring);
    group.scale.set(stretch, 1, 1);
    world.add(group);
    platforms.push({ glow: glowMesh, ring, color });
  }
  platform(nearP, pal.near, true);
  platform(farP, pal.far, false);

  // ---- the arena round the court
  const crowdSpots: THREE.Vector3[] = [];
  let crowdMesh: THREE.InstancedMesh | null = null;

  if (kind === "stadium" || kind === "doubles") buildBowl();
  if (kind === "frontier") buildHall();
  if (kind === "field") buildField();

  function buildBowl() {
    const A0 = kind === "doubles" ? 16 : 13;
    const B0 = Math.max(courtHalf.z + 4, length / 2 + 8) + (kind === "doubles" ? 2 : 0);
    const rows = kind === "doubles" ? 13 : 12;
    const tread = 1.05;
    const rise = 0.62;
    const wall = 1.3;
    const S = 144;
    /** The far end (behind the opponent) is a low terrace, so the dusk sky shows over it: rows there rise less. */
    const FAR_T = -Math.PI / 2;
    const heightAt = (t: number) => {
      const d = Math.abs(Math.atan2(Math.sin(t - FAR_T), Math.cos(t - FAR_T)));
      const u = Math.min(1, Math.max(0, (d - 0.35) / 0.8));
      return 0.22 + 0.78 * u * u * (3 - 2 * u);
    };
    /** Behind the camera: left out (never in view, and too close to the lens). */
    const camT = Math.atan2(camLocal.z / B0, camLocal.x / A0);
    const hidden = (t: number) => Math.abs(Math.atan2(Math.sin(t - camT), Math.cos(t - camT))) < 0.95;
    const pos: number[] = [];
    const col: number[] = [];
    const cA = lin(pal.stands);
    const cB = lin(pal.standsAlt);
    const cWall = lin(0x120d26);
    const quad = (p: THREE.Vector3[], c: THREE.Color) => {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(p[i].x, p[i].y, p[i].z);
        col.push(c.r, c.g, c.b);
      }
    };
    const at = (a: number, b: number, t: number, y: number) => ellipse(a, b, t, y);
    const rowY = (r: number, t: number) => wall + r * rise * heightAt(t);
    for (let i = 0; i < S; i++) {
      const t0 = (i / S) * TAU;
      const t1 = ((i + 1) / S) * TAU;
      if (hidden((t0 + t1) / 2)) continue;
      quad([at(A0, B0, t0, 0), at(A0, B0, t1, 0), at(A0, B0, t1, wall), at(A0, B0, t0, wall)], cWall);
      for (let r = 0; r < rows; r++) {
        const a = A0 + r * tread;
        const b = B0 + r * tread;
        const c = r % 2 ? cA : cB;
        quad([at(a, b, t0, rowY(r, t0)), at(a, b, t1, rowY(r, t1)), at(a + tread, b + tread, t1, rowY(r, t1)), at(a + tread, b + tread, t0, rowY(r, t0))], c);
        quad([at(a + tread, b + tread, t0, rowY(r, t0)), at(a + tread, b + tread, t1, rowY(r, t1)), at(a + tread, b + tread, t1, rowY(r + 1, t1)), at(a + tread, b + tread, t0, rowY(r + 1, t0))], cWall);
      }
      const ao = A0 + rows * tread;
      const bo = B0 + rows * tread;
      const y0 = rowY(rows, t0);
      const y1 = rowY(rows, t1);
      const k0 = heightAt(t0);
      const k1 = heightAt(t1);
      // The back wall and the roof's lip (only where the stands are tall).
      quad([at(ao, bo, t0, y0), at(ao, bo, t1, y1), at(ao, bo, t1, y1 + 3.2 * k1), at(ao, bo, t0, y0 + 3.2 * k0)], cWall);
      if (k0 > 0.6 && k1 > 0.6) quad([at(ao, bo, t0, y0 + 3.2 * k0), at(ao, bo, t1, y1 + 3.2 * k1), at(ao - 3.5, bo - 3.5, t1, y1 + 4.4 * k1), at(ao - 3.5, bo - 3.5, t0, y0 + 4.4 * k0)], cWall);
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide, emissive: lin(pal.stands), emissiveIntensity: 0.35 }));
    world.add(new THREE.Mesh(geo, mat));

    // LED strips: round the court wall and along a tier.
    strip(A0 - 0.02, B0 - 0.02, 0.35, 0.55, [pal.stripA, pal.stripB], { speed: 0.05, reps: 5 });
    strip(A0 + 4 * tread + 0.02, B0 + 4 * tread + 0.02, wall + 4 * rise, 0.14, [pal.stripB, pal.stripA], { speed: -0.04, reps: 3, alpha: 0.7, lift: (t) => (heightAt(t) - 1) * 4 * rise, hide: hidden });
    const ao = A0 + rows * tread;
    const bo = B0 + rows * tread;
    strip(ao - 3.4, bo - 3.4, 0, 0.2, [pal.stripA, pal.stripB], { speed: 0.03, reps: 8, alpha: 0.9, lift: (t) => rowY(rows, t) + 4.3 * heightAt(t), hide: (t) => hidden(t) || heightAt(t) < 0.62 });

    // The crowd: silhouettes on every row, in the colours of a crowd.
    const spots: THREE.Vector3[] = [];
    for (let r = 0; r < rows; r++) {
      const a = A0 + r * tread + tread * 0.45;
      const b = B0 + r * tread + tread * 0.45;
      const per = Math.round((TAU * Math.sqrt((a * a + b * b) / 2)) / 0.5);
      for (let i = 0; i < per; i++) {
        if (R() < 0.1) continue;
        const t = ((i + R() * 0.4) / per) * TAU;
        if (hidden(t)) continue;
        spots.push(ellipse(a, b, t, rowY(r, t)));
      }
    }
    buildCrowd(spots);

    // Floodlights on towers round the rim.
    const towers = kind === "doubles" ? 6 : 4;
    for (let i = 0; i < towers; i++) {
      const t = (i / towers) * TAU + Math.PI / towers;
      if (hidden(t)) continue;
      const base = ellipse(ao + 1.5, bo + 1.5, t, 0);
      // Over the low far end, the light rigs sit low enough to be in shot.
      const h = rowY(rows, t) + 3.2 * heightAt(t) + (Math.sin(t) < 0 ? 2.2 : 8);
      const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.22, 0.32, h, 8)), keep(new THREE.MeshStandardMaterial({ color: lin(0x15112a), roughness: 0.7 })));
      pole.position.set(base.x, h / 2, base.z);
      world.add(pole);
      const head = new THREE.Vector3(base.x * 0.97, h + 0.6, base.z * 0.97);
      const bank = new THREE.Mesh(keep(new THREE.BoxGeometry(3.2, 1.8, 0.3)), keep(new THREE.MeshBasicMaterial({ color: lin(0xfff4e0, 3), fog: true })));
      bank.position.copy(head);
      bank.lookAt(mid);
      world.add(bank);
      const glowS = glowSprite(0xfff1d6, 9, 1.8, 0.9);
      glowS.position.copy(head);
      world.add(glowS);
      world.add(lightCone(head, new THREE.Vector3(base.x * 0.25, 0, base.z * 0.25), 1.2, 7.5, 0xfff0d8, 0.07));
    }
    // A city skyline on the horizon past the low far end, its windows lit for the evening.
    {
      const winTex = keep(
        canvasTexture(64, 128, (g, w, h) => {
          g.fillStyle = "#000";
          g.fillRect(0, 0, w, h);
          const rr = rng(5);
          for (let y = 4; y < h - 2; y += 6) for (let x = 3; x < w - 2; x += 5) if (rr() < 0.16) {
            g.fillStyle = rr() < 0.75 ? "#c99a62" : "#6f8fb8";
            g.fillRect(x, y, 2, 3);
          }
        })
      );
      winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
      const n = 46;
      const box = keep(new THREE.BoxGeometry(1, 1, 1));
      box.translate(0, 0.5, 0);
      const city = new THREE.InstancedMesh(box, keep(new THREE.MeshBasicMaterial({ color: lin(0x120c26), map: winTex, fog: false })), n);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < n; i++) {
        const t = FAR_T + (i / (n - 1) - 0.5) * 2.6 + (R() - 0.5) * 0.04;
        const d = 230 + R() * 90;
        dummy.position.set(Math.cos(t) * d, -0.5, Math.sin(t) * d);
        dummy.scale.set(6 + R() * 12, 4 + R() * R() * 26, 6 + R() * 10);
        dummy.lookAt(0, 0, 0);
        dummy.updateMatrix();
        city.setMatrixAt(i, dummy.matrix);
      }
      // Windows glow over the dark: the texture adds light, the colour keeps the towers dark.
      (city.material as THREE.MeshBasicMaterial).onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", "diffuseColor.rgb += texture2D( map, vMapUv ).rgb * 0.9;");
      };
      world.add(city);
    }
    // The giant screen over the low far end, against the sky.
    const screenW = 9;
    const screenH = screenW * 0.42;
    const screen = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(screenW, screenH)),
      addShader(
        new THREE.ShaderMaterial({
          fog: true,
          uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uA: { value: lin(pal.stripA, 1.3) }, uB: { value: lin(pal.stripB, 1.3) }, uFlash: flashUniform, uTime: timeUniform },
          vertexShader: `varying vec2 vUv; #include <fog_pars_vertex>
            void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mvPosition; #include <fog_vertex> }`.replace(INCLUDE, "\n#include <$1>\n"),
          fragmentShader: `uniform vec3 uA, uB; uniform float uTime, uFlash; varying vec2 vUv; #include <fog_pars_fragment>
            void main(){
              vec2 p = vUv * vec2(48.0, 20.0);
              vec2 cell = fract(p) - 0.5;
              float led = smoothstep(0.55, 0.25, length(cell));
              float wave = 0.5 + 0.5 * sin(vUv.x * 7.0 - uTime * 0.8 + sin(vUv.y * 5.0 + uTime * 0.5));
              vec2 c = vUv - 0.5; c.x *= 2.4;
              float r = length(c);
              float ball = smoothstep(0.235, 0.22, r) - smoothstep(0.2, 0.185, r);
              ball += step(abs(c.y), 0.014) * step(r, 0.22) * step(0.06, r) + (smoothstep(0.065, 0.055, r) - smoothstep(0.04, 0.03, r));
              vec3 col = mix(uA, uB, wave) * 0.6 + vec3(1.0) * clamp(ball, 0.0, 1.0) * 0.95;
              col *= (0.35 + 0.65 * led) * (0.9 + uFlash);
              gl_FragColor = vec4(col, 1.0);
              ${COMMON_FRAG_TAIL}
              #include <fog_fragment>
            }`.replace(INCLUDE, "\n#include <$1>\n"),
        })
      )
    );
    const st = FAR_T - 0.45;
    const sp = ellipse(ao - 1.5, bo - 1.5, st, rowY(rows, st) + 3.2 * heightAt(st) + screenH / 2 + 0.6);
    screen.position.copy(sp);
    screen.lookAt(mid.clone().setY(2));
    world.add(screen);
    const frame = new THREE.Mesh(keep(new THREE.BoxGeometry(screenW + 0.5, screenH + 0.5, 0.4)), keep(new THREE.MeshStandardMaterial({ color: lin(0x0b0918), roughness: 0.6 })));
    frame.position.copy(sp);
    frame.quaternion.copy(screen.quaternion);
    frame.translateZ(-0.25);
    world.add(frame);
    for (const dx of [-screenW / 3, screenW / 3]) {
      const strut = new THREE.Mesh(keep(new THREE.BoxGeometry(0.35, sp.y, 0.35)), keep(new THREE.MeshStandardMaterial({ color: lin(0x0b0918), roughness: 0.8 })));
      strut.position.copy(sp);
      strut.quaternion.copy(screen.quaternion);
      strut.translateX(dx);
      strut.translateZ(-0.5);
      strut.position.y = sp.y / 2 - screenH / 4;
      world.add(strut);
    }
    const sg = glowSprite(pal.stripB, 20, 0.8, 0.35);
    sg.position.copy(sp);
    world.add(sg);
  }

  function buildHall() {
    const W = 12;
    const L = 26;
    const H = 13;
    const panels = keep(
      canvasTexture(256, 256, (g, w, h) => {
        g.fillStyle = "#0d1526";
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "rgba(120,180,255,0.16)";
        g.lineWidth = 2;
        for (let x = 0; x <= w; x += 64) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, h);
          g.stroke();
        }
        for (let y = 0; y <= h; y += 128) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y);
          g.stroke();
        }
        g.fillStyle = "rgba(72,224,255,0.5)";
        g.fillRect(0, 118, w, 3);
        g.fillStyle = "rgba(255,207,90,0.35)";
        g.fillRect(0, 246, w, 2);
      })
    );
    panels.wrapS = panels.wrapT = THREE.RepeatWrapping;
    panels.repeat.set(6, 2);
    const wallMat = keep(new THREE.MeshStandardMaterial({ color: lin(0xb8c8e8), map: panels, emissive: lin(0xffffff), emissiveMap: panels, emissiveIntensity: 0.55, roughness: 0.5, metalness: 0.3 }));
    const panelMat = keep(new THREE.MeshStandardMaterial({ color: lin(0x16213a), roughness: 0.3, metalness: 0.7 }));
    // Side walls and the far wall.
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(L * 2, H)), wallMat);
      wall.position.set(s * W, H / 2, 0);
      wall.rotation.y = -s * Math.PI / 2;
      world.add(wall);
    }
    const back = new THREE.Mesh(keep(new THREE.PlaneGeometry(W * 2, H)), wallMat);
    back.position.set(0, H / 2, -L);
    world.add(back);
    // Columns with light strips down their inner faces.
    for (const s of [-1, 1]) {
      for (let z = -L + 3; z < L; z += 5) {
        const col = new THREE.Mesh(keep(new THREE.BoxGeometry(1.2, H, 1.2)), panelMat);
        col.position.set(s * (W - 0.8), H / 2, z);
        world.add(col);
        const led = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.16, H - 1.5)), keep(new THREE.MeshBasicMaterial({ color: lin(pal.stripA, 2.4), fog: true })));
        led.position.set(s * (W - 1.42), H / 2, z);
        led.rotation.y = -s * Math.PI / 2;
        world.add(led);
        for (const y of [1.2, H * 0.55]) {
          const g2 = glowSprite(pal.stripA, y > 2 ? 3.2 : 2.4, 1, y > 2 ? 0.28 : 0.4);
          g2.position.set(s * (W - 1.6), y, z);
          world.add(g2);
        }
      }
      // A balcony with a few spectators.
      const balcony = new THREE.Mesh(keep(new THREE.BoxGeometry(2.4, 0.3, L * 2)), panelMat);
      balcony.position.set(s * (W - 2.2), 5.2, 0);
      world.add(balcony);
      const rail = new THREE.Mesh(keep(new THREE.PlaneGeometry(L * 2, 0.08)), keep(new THREE.MeshBasicMaterial({ color: lin(pal.stripB, 2.2), fog: true })));
      rail.position.set(s * (W - 3.38), 6.1, 0);
      rail.rotation.y = -s * Math.PI / 2;
      world.add(rail);
    }
    const spots: THREE.Vector3[] = [];
    for (const s of [-1, 1]) for (let z = -L + 2; z < L - 6; z += 0.55) if (R() < 0.55) spots.push(new THREE.Vector3(s * (W - 2.0 - R() * 0.6), 5.35, z));
    buildCrowd(spots, 0.85);
    // The far wall: a great arch and the Frontier's ring emblem.
    const arch = new THREE.Mesh(keep(new THREE.TorusGeometry(7.2, 0.14, 8, 96, Math.PI)), keep(new THREE.MeshBasicMaterial({ color: lin(pal.stripB, 2.4), fog: true })));
    arch.position.set(0, 3.2, -L + 0.2);
    world.add(arch);
    const arch2 = new THREE.Mesh(keep(new THREE.TorusGeometry(6.4, 0.06, 6, 96, Math.PI)), keep(new THREE.MeshBasicMaterial({ color: lin(pal.stripA, 2.2), fog: true })));
    arch2.position.set(0, 3.2, -L + 0.25);
    world.add(arch2);
    const emblem = new THREE.Group();
    for (const [rad, w2, c] of [
      [2.6, 0.12, pal.stripA],
      [2.1, 0.05, pal.stripB],
      [1.2, 0.09, pal.stripA],
    ] as const) {
      const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(rad, w2, 8, 96)), keep(new THREE.MeshBasicMaterial({ color: lin(c, 2.4), fog: true })));
      emblem.add(ring);
    }
    const bar = new THREE.Mesh(keep(new THREE.PlaneGeometry(5.2, 0.12)), keep(new THREE.MeshBasicMaterial({ color: lin(pal.stripA, 2.4), fog: true })));
    emblem.add(bar);
    emblem.position.set(0, 6.4, -L + 0.3);
    world.add(emblem);
    tickers.push((t) => {
      emblem.rotation.z = Math.sin(t * 0.25) * 0.05;
    });
    const eg = glowSprite(pal.stripA, 12, 1, 0.5);
    eg.position.copy(emblem.position);
    world.add(eg);
    // Ceiling light panels.
    for (let z = -L + 3; z < L; z += 4) {
      const panel = new THREE.Mesh(keep(new THREE.PlaneGeometry(W * 1.2, 0.5)), keep(new THREE.MeshBasicMaterial({ color: lin(0xdff4ff, 2.2), fog: true })));
      panel.position.set(0, H - 0.3, z);
      panel.rotation.x = Math.PI / 2;
      world.add(panel);
    }
    const ceiling = new THREE.Mesh(keep(new THREE.PlaneGeometry(W * 2, L * 2)), wallMat);
    ceiling.position.set(0, H, 0);
    ceiling.rotation.x = Math.PI / 2;
    world.add(ceiling);
    // Floor inlays: two rails of light down the hall.
    for (const x of [-W + 3.2, W - 3.2]) {
      const inlay = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.1, L * 2)), keep(new THREE.MeshBasicMaterial({ color: lin(pal.stripA, 2), fog: true })));
      inlay.rotation.x = -Math.PI / 2;
      inlay.position.set(x, 0.012, 0);
      world.add(inlay);
    }
    // Overhead spots onto each platform.
    for (const p of [nearP, farP]) {
      const c = toLocal(p.centre);
      world.add(lightCone(new THREE.Vector3(c.x, H - 0.4, c.z), new THREE.Vector3(c.x, 0, c.z), 0.4, p.radius * 1.15, 0xdff4ff, 0.09));
    }
  }

  function buildField() {
    // Trees in a loose ring, rolling hills behind them, a few clouds.
    const trunkGeo = keep(new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6));
    const crownGeo = keep(new THREE.ConeGeometry(1.4, 3.6, 8));
    const crownGeo2 = keep(new THREE.IcosahedronGeometry(1.5, 0));
    const trees: THREE.Vector3[] = [];
    for (let i = 0; i < 90; i++) {
      const t = R() * TAU;
      const d = 22 + R() * 30;
      const p = new THREE.Vector3(Math.cos(t) * d * 0.9, 0, Math.sin(t) * d);
      if (p.distanceTo(new THREE.Vector3(camLocal.x, 0, camLocal.z)) < 14) continue;
      trees.push(p);
    }
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, keep(new THREE.MeshStandardMaterial({ color: lin(0x6b4a2e), roughness: 1 })), trees.length);
    const pine = new THREE.InstancedMesh(crownGeo, keep(new THREE.MeshStandardMaterial({ color: lin(0x2f6b3a), roughness: 0.9, flatShading: true })), trees.length);
    const round = new THREE.InstancedMesh(crownGeo2, keep(new THREE.MeshStandardMaterial({ color: lin(0x4f8f3e), roughness: 0.9, flatShading: true })), trees.length);
    const dummy = new THREE.Object3D();
    let np = 0;
    let nr = 0;
    trees.forEach((p, i) => {
      const s = 0.8 + R() * 0.9;
      dummy.position.set(p.x, 0.8 * s, p.z);
      dummy.scale.setScalar(s);
      dummy.rotation.set(0, R() * TAU, 0);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);
      if (R() < 0.55) {
        dummy.position.y = (1.6 + 1.6) * s;
        dummy.updateMatrix();
        pine.setMatrixAt(np++, dummy.matrix);
      } else {
        dummy.position.y = (1.6 + 1.0) * s;
        dummy.updateMatrix();
        round.setMatrixAt(nr++, dummy.matrix);
      }
    });
    pine.count = np;
    round.count = nr;
    world.add(trunkMesh, pine, round);
    // Hills.
    const hillMat = keep(new THREE.MeshStandardMaterial({ color: lin(0x5d9a55), roughness: 1, flatShading: true }));
    for (let i = 0; i < 9; i++) {
      const t = (i / 9) * TAU + R() * 0.3;
      const hill = new THREE.Mesh(keep(new THREE.SphereGeometry(18 + R() * 14, 10, 6, 0, TAU, 0, Math.PI / 2)), hillMat);
      hill.scale.y = 0.35 + R() * 0.25;
      hill.position.set(Math.cos(t) * 80, -1, Math.sin(t) * 80);
      world.add(hill);
    }
    // Clouds: flat glowing cards.
    const cloudTex = keep(
      canvasTexture(256, 128, (g, w, h) => {
        g.fillStyle = "rgba(255,255,255,0.9)";
        const rr = rng(11);
        for (let i = 0; i < 14; i++) {
          const x = w * (0.2 + rr() * 0.6);
          const y = h * (0.45 + rr() * 0.25);
          const r2 = h * (0.15 + rr() * 0.2);
          const grad = g.createRadialGradient(x, y, 0, x, y, r2);
          grad.addColorStop(0, "rgba(255,255,255,0.85)");
          grad.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = grad;
          g.fillRect(x - r2, y - r2, r2 * 2, r2 * 2);
        }
      })
    );
    const clouds: THREE.Sprite[] = [];
    for (let i = 0; i < 8; i++) {
      const m = keep(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.85, fog: false }));
      const s = new THREE.Sprite(m);
      const t = -Math.PI / 2 + (R() - 0.5) * 2.6;
      s.position.set(Math.cos(t) * 160, 30 + R() * 25, Math.sin(t) * 160);
      s.scale.set(60 + R() * 40, 26 + R() * 10, 1);
      world.add(s);
      clouds.push(s);
    }
    tickers.push((t) => clouds.forEach((c, i) => (c.position.x += Math.sin(t * 0.02 + i) * 0.004)));
    // A wooden fence round the court.
    const postGeo = keep(new THREE.BoxGeometry(0.16, 0.9, 0.16));
    const postMat = keep(new THREE.MeshStandardMaterial({ color: lin(0x8a6440), roughness: 1 }));
    const posts: THREE.Vector3[] = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * TAU;
      const p = ellipse(courtHalf.x + 6, courtHalf.z + 5, t, 0.45);
      if (p.distanceTo(new THREE.Vector3(camLocal.x, 0.45, camLocal.z)) < 6) continue;
      posts.push(p);
    }
    const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    posts.forEach((p, i) => {
      dummy.position.copy(p);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      postMesh.setMatrixAt(i, dummy.matrix);
    });
    world.add(postMesh);
    const rail = new THREE.Mesh(keep(new THREE.TorusGeometry(1, 0.035, 4, 128)), postMat);
    rail.rotation.x = Math.PI / 2;
    rail.scale.set(courtHalf.x + 6, courtHalf.z + 5, 1);
    rail.position.y = 0.75;
    world.add(rail);
  }

  /** Crowd silhouettes (instanced cards facing the court), and the flashes of their cameras. */
  function buildCrowd(spots: THREE.Vector3[], scale = 1) {
    if (!spots.length) return;
    const tex = keep(
      canvasTexture(64, 96, (g) => {
        g.fillStyle = "#fff";
        g.beginPath();
        g.arc(32, 26, 14, 0, TAU);
        g.fill();
        g.beginPath();
        g.moveTo(6, 96);
        g.quadraticCurveTo(6, 46, 32, 44);
        g.quadraticCurveTo(58, 46, 58, 96);
        g.fill();
      })
    );
    const geo = keep(new THREE.PlaneGeometry(0.46 * scale, 0.7 * scale));
    geo.translate(0, 0.35 * scale, 0);
    const mat = keep(new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    const dummy = new THREE.Object3D();
    // A crowd in every colour, a little dimmed by the dusk.
    const tones = [0xd8475f, 0x4f7fe0, 0xf2c14e, 0x52b788, 0xf08a3c, 0xb06ad8, 0xe8e2f0, 0x3a3a52, 0x6bc6e8, 0xff7aa8, 0x2e2e40, 0x8f6b4a];
    spots.forEach((p, i) => {
      dummy.position.copy(p);
      dummy.lookAt(0, p.y, 0);
      const s = 0.85 + R() * 0.3;
      dummy.scale.set(s, s * (0.9 + R() * 0.2), s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, lin(tones[Math.floor(R() * tones.length)], (kind === "frontier" ? 0.35 : 0.5) + R() * 0.25));
      crowdSpots.push(p.clone().add(new THREE.Vector3(0, 0.55 * scale, 0)));
    });
    // A few shuffled to the front of the instance list, so lower quality keeps an even spread.
    world.add(mesh);
    crowdMesh = mesh;
  }

  // ---- camera flashes from the crowd
  const FLASHES = 64;
  const flashGeo = keep(new THREE.BufferGeometry());
  const flashPos = new Float32Array(FLASHES * 3);
  const flashVal = new Float32Array(FLASHES);
  flashGeo.setAttribute("position", new THREE.BufferAttribute(flashPos, 3));
  flashGeo.setAttribute("aFlash", new THREE.BufferAttribute(flashVal, 1));
  const flashMat = addShader(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: glow }, uScale: { value: 1 }, uTime: timeUniform },
      vertexShader: `attribute float aFlash; varying float vF; uniform float uScale;
        void main(){ vF = aFlash; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = aFlash * 340.0 * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying float vF; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * 2.5, t.a * vF); ${COMMON_FRAG_TAIL} }`,
    })
  );
  const flashes = new THREE.Points(flashGeo, flashMat);
  flashes.frustumCulled = false;
  if (crowdSpots.length) world.add(flashes);
  let cheerLeft = 0;
  const fire = (i: number) => {
    const p = crowdSpots[Math.floor(R() * crowdSpots.length)];
    flashPos.set([p.x, p.y, p.z], i * 3);
    flashVal[i] = 0.7 + R() * 0.5;
  };
  tickers.push((_t, dt) => {
    if (!crowdSpots.length) return;
    const rate = (kind === "frontier" ? 0.8 : 3.2) + cheerLeft * 60;
    cheerLeft = Math.max(0, cheerLeft - dt);
    for (let i = 0; i < FLASHES; i++) {
      if (flashVal[i] > 0) flashVal[i] = Math.max(0, flashVal[i] - dt * 9);
      else if (Math.random() < (rate * dt) / FLASHES) fire(i);
    }
    flashGeo.attributes.position.needsUpdate = true;
    flashGeo.attributes.aFlash.needsUpdate = true;
  });

  // ---- platform glow breathing
  tickers.push((t) => {
    platforms.forEach((p, i) => {
      const m = p.glow.material as THREE.MeshBasicMaterial;
      if (kind !== "field") m.opacity = 0.42 + 0.12 * Math.sin(t * 1.4 + i * 1.7) + flashUniform.value * 0.3;
    });
  });

  // ---------------------------------------------------------------------------
  // Field effects
  // ---------------------------------------------------------------------------

  /** A full-screen colour grade (weather tints), drawn last. */
  const gradeMat = keep(
    new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTint: { value: lin(0xffffff) }, uAmount: { value: 0 }, uWarm: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform vec3 uTint; uniform float uAmount, uWarm; varying vec2 vUv;
        void main(){
          float sun = smoothstep(1.2, 0.0, distance(vUv, vec2(0.92, 1.05)));
          gl_FragColor = vec4(uTint, uAmount * (0.55 + 0.45 * (1.0 - vUv.y)) + uWarm * sun * 0.35);
          ${COMMON_FRAG_TAIL}
        }`,
    })
  );
  const grade = new THREE.Mesh(keep(new THREE.PlaneGeometry(2, 2)), gradeMat);
  grade.frustumCulled = false;
  grade.renderOrder = 100;
  scene.add(grade);

  type Fx = { obj: THREE.Object3D; mat: THREE.ShaderMaterial; level: number; target: number };
  const fx: Partial<Record<string, Fx>> = {};
  const VOL = { x: 34, y: 16, z: 40 };
  const volCentre = mid.clone().add(new THREE.Vector3(0, 0, 2));

  function particleCount(base: number) {
    return Math.max(60, Math.round(base * QUALITY[quality].particles));
  }

  function makeRain(): Fx {
    const n = 2200;
    const a = new Float32Array(n * 2 * 4);
    for (let i = 0; i < n; i++) {
      const x = (R() - 0.5) * VOL.x;
      const y = R() * VOL.y;
      const z = (R() - 0.5) * VOL.z;
      a.set([x, y, z, 0, x, y, z, 1], i * 8);
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(a, 4));
    const mat = addShader(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uLevel: { value: 0 }, uOrigin: { value: volCentre }, uH: { value: VOL.y }, uHeavy: { value: 0 }, uTime: timeUniform },
        vertexShader: `attribute vec4 aSeed; uniform float uTime, uH, uHeavy; uniform vec3 uOrigin; varying float vA;
          void main(){
            float speed = 22.0 + uHeavy * 8.0;
            float y = mod(aSeed.y - uTime * speed, uH);
            vec3 p = uOrigin + vec3(aSeed.x - y * 0.12, y - 1.0, aSeed.z);
            p += vec3(0.12, -1.0, 0.0) * aSeed.w * (0.55 + uHeavy * 0.3);
            vA = mix(0.0, 1.0, aSeed.w);
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: `uniform float uLevel; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.62, 0.74, 1.0), (0.15 + 0.35 * vA) * uLevel); ${COMMON_FRAG_TAIL} }`,
      })
    );
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    geo.setDrawRange(0, particleCount(n) * 2);
    scene.add(lines);
    return { obj: lines, mat, level: 0, target: 0 };
  }

  function makePoints(n: number, opts3: { color: number; size: number; speed: number; drift: number; sideways: number; additive: boolean }): Fx {
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) seed.set([(R() - 0.5) * VOL.x, R() * VOL.y, (R() - 0.5) * VOL.z, R()], i * 4);
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    const mat = addShader(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: opts3.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uLevel: { value: 0 },
          uOrigin: { value: volCentre },
          uVol: { value: new THREE.Vector3(VOL.x, VOL.y, VOL.z) },
          uColor: { value: lin(opts3.color, opts3.additive ? 1.4 : 1) },
          uSize: { value: opts3.size },
          uSpeed: { value: opts3.speed },
          uDrift: { value: opts3.drift },
          uSide: { value: opts3.sideways },
          uScale: { value: 1 },
          uMap: { value: glow },
          uTime: timeUniform,
        },
        vertexShader: `attribute vec4 aSeed; uniform float uTime, uSize, uSpeed, uDrift, uSide, uScale; uniform vec3 uOrigin, uVol; varying float vS;
          void main(){
            float y = mod(aSeed.y - uTime * uSpeed * (0.7 + aSeed.w * 0.6), uVol.y);
            float x = mod(aSeed.x + uVol.x * 0.5 + uTime * uSide * (0.8 + aSeed.w * 0.4), uVol.x) - uVol.x * 0.5;
            vec3 p = uOrigin + vec3(x + sin(uTime * 0.9 + aSeed.w * 30.0) * uDrift, y - 1.0, aSeed.z + cos(uTime * 0.7 + aSeed.w * 20.0) * uDrift);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            vS = aSeed.w;
            gl_PointSize = uSize * (0.6 + aSeed.w * 0.8) * 300.0 * uScale / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; uniform float uLevel; varying float vS;
          void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uColor, t.a * uLevel * (0.55 + 0.45 * vS)); ${COMMON_FRAG_TAIL} }`,
      })
    );
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    geo.setDrawRange(0, particleCount(n));
    scene.add(pts);
    return { obj: pts, mat, level: 0, target: 0 };
  }

  function makeSun(): Fx {
    const group = new THREE.Group();
    const mat = addShader(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uLevel: { value: 0 }, uColor: { value: lin(0xffd38a, 1.3) }, uTime: timeUniform },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `uniform float uLevel, uTime; uniform vec3 uColor; varying vec2 vUv;
          void main(){
            float across = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
            float along = pow(vUv.y, 1.4);
            float shimmer = 0.75 + 0.25 * sin(uTime * 0.8 + vUv.x * 9.0);
            gl_FragColor = vec4(uColor, across * along * uLevel * 0.22 * shimmer);
            ${COMMON_FRAG_TAIL}
          }`,
      })
    );
    const src = new THREE.Vector3(-24, 30, -30).add(mid);
    for (let i = 0; i < 7; i++) {
      const len = 70;
      const geo = keep(new THREE.PlaneGeometry(2.5 + i * 0.8, len));
      geo.translate(0, -len / 2, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(src);
      const target = mid.clone().add(new THREE.Vector3((i - 3) * 4.5, 0, (i % 3) * 3 - 2));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target.sub(src).normalize());
      m.rotateY(i * 0.6);
      group.add(m);
    }
    const sunGlow = glowSprite(0xffe0a0, 46, 1.6, 0);
    sunGlow.position.copy(src);
    group.add(sunGlow);
    tickers.push((t) => {
      group.rotation.y = Math.sin(t * 0.05) * 0.01;
      (sunGlow.material as THREE.SpriteMaterial).opacity = mat.uniforms.uLevel.value * 0.85;
    });
    scene.add(group);
    return { obj: group, mat, level: 0, target: 0 };
  }

  const TERRAIN_COLOR: Record<string, [number, number]> = {
    electric: [0xffc400, 0xfff07a],
    grassy: [0x5ee07a, 0xc8ff9a],
    psychic: [0xff5fd0, 0x9b7bff],
    misty: [0xffb8e6, 0xffffff],
  };

  function makeTerrain(): Fx {
    const geo = keep(new THREE.PlaneGeometry(courtHalf.x * 2 + 4, courtHalf.z * 2 + 4, 1, 1));
    geo.rotateX(-Math.PI / 2);
    const mat = addShader(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        // Normal blending: the terrain's own colour, not washed out by the floor under it.
        blending: THREE.NormalBlending,
        uniforms: { uLevel: { value: 0 }, uMode: { value: 0 }, uA: { value: lin(0xffffff) }, uB: { value: lin(0xffffff) }, uTime: timeUniform },
        vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `uniform float uLevel, uMode, uTime; uniform vec3 uA, uB; varying vec2 vUv; varying vec3 vP;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
            return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
          float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 7.1; a *= .5; } return s; }
          void main(){
            vec2 p = vP.xz;
            vec2 q = (vUv - 0.5) * 2.0;
            float mask = smoothstep(1.0, 0.55, max(abs(q.x), abs(q.y)));
            float v = 0.0; vec3 col = uA;
            if (uMode < 0.5) {
              // Electric: crackling veins that flicker.
              float n = fbm(p * 0.55 + vec2(uTime * 0.6, -uTime * 0.4));
              float vein = 1.0 - smoothstep(0.0, 0.035, abs(n - 0.5));
              float n2 = fbm(p * 1.1 - vec2(uTime * 0.9, uTime * 0.2));
              vein += 0.6 * (1.0 - smoothstep(0.0, 0.03, abs(n2 - 0.5)));
              float flicker = 0.7 + 0.3 * step(0.5, fract(sin(floor(uTime * 12.0)) * 43758.5));
              float hum = 0.5 + 0.5 * sin(length(p) * 1.4 - uTime * 3.0);
              v = vein * flicker + 0.14 + 0.08 * hum;
              col = mix(uA, uB, vein * 0.7);
            } else if (uMode < 1.5) {
              // Grassy: soft green light breathing through blades.
              float n = fbm(p * 0.8 + uTime * 0.08);
              float blades = 0.5 + 0.5 * sin(p.x * 9.0 + n * 6.0) * sin(p.y * 7.0 - n * 5.0);
              v = 0.28 + 0.4 * n + 0.18 * blades;
              col = mix(uA, uB, n);
            } else if (uMode < 2.5) {
              // Psychic: rings rippling out from the centre, swirling.
              float r = length(p);
              float a = atan(p.y, p.x);
              float w = 0.5 + 0.5 * sin(r * 1.6 - uTime * 2.2 + sin(a * 3.0 + uTime) * 0.8);
              v = 0.2 + 0.55 * pow(w, 3.0);
              col = mix(uA, uB, 0.5 + 0.5 * sin(a * 2.0 + uTime * 0.6));
            } else {
              // Misty: pale clouds drifting over the floor.
              float n = fbm(p * 0.35 + vec2(uTime * 0.12, uTime * 0.05));
              v = 0.18 + 0.6 * smoothstep(0.35, 0.8, n);
              col = mix(uA, uB, n);
            }
            gl_FragColor = vec4(col * (0.9 + v * 0.8), clamp(v * 1.1, 0.0, 0.95) * mask * uLevel);
            ${COMMON_FRAG_TAIL}
          }`,
      })
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.03;
    mesh.renderOrder = 2;
    world.add(mesh);
    return { obj: mesh, mat, level: 0, target: 0 };
  }

  function makeTrickRoom(): Fx {
    const w = courtHalf.x + 2;
    const h = 9;
    const l = courtHalf.z + 2;
    const pts: number[] = [];
    const seg = (a: THREE.Vector3, b: THREE.Vector3, n = 12) => {
      for (let i = 0; i < n; i++) {
        const p = a.clone().lerp(b, i / n);
        const q = a.clone().lerp(b, (i + 1) / n);
        pts.push(p.x, p.y, p.z, q.x, q.y, q.z);
      }
    };
    const step = 1.6;
    for (let x = -w; x <= w + 0.01; x += step) {
      seg(new THREE.Vector3(x, 0, -l), new THREE.Vector3(x, h, -l));
      seg(new THREE.Vector3(x, h, -l), new THREE.Vector3(x, h, l), 20);
      seg(new THREE.Vector3(x, 0, -l), new THREE.Vector3(x, 0, l), 20);
    }
    for (let z = -l; z <= l + 0.01; z += step) {
      for (const s of [-1, 1]) seg(new THREE.Vector3(s * w, 0, z), new THREE.Vector3(s * w, h, z));
      seg(new THREE.Vector3(-w, h, z), new THREE.Vector3(w, h, z));
      seg(new THREE.Vector3(-w, 0, z), new THREE.Vector3(w, 0, z));
    }
    for (let y = 0; y <= h + 0.01; y += step) {
      seg(new THREE.Vector3(-w, y, -l), new THREE.Vector3(w, y, -l));
      for (const s of [-1, 1]) seg(new THREE.Vector3(s * w, y, -l), new THREE.Vector3(s * w, y, l), 20);
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = addShader(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uLevel: { value: 0 }, uA: { value: lin(0xff5fd0, 1.8) }, uB: { value: lin(0x5ff0ff, 1.8) }, uTime: timeUniform },
        vertexShader: `uniform float uTime; varying float vT; varying float vD;
          void main(){
            vec3 p = position;
            float k = sin(p.y * 0.5 + uTime * 1.1) * 0.6 + sin(p.z * 0.35 - uTime * 0.8) * 0.6;
            p.x += k * sign(p.x) * 0.5;
            p.z += sin(p.x * 0.4 + uTime * 0.9) * 0.45;
            p.y += sin(p.z * 0.3 + p.x * 0.3 + uTime) * 0.3;
            vT = 0.5 + 0.5 * sin(p.z * 0.25 + p.y * 0.3 + uTime * 0.7);
            vec4 mv = modelViewMatrix * vec4(p, 1.);
            vD = -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `uniform float uLevel; uniform vec3 uA, uB; varying float vT; varying float vD;
          void main(){ gl_FragColor = vec4(mix(uA, uB, vT), uLevel * 0.8 * smoothstep(70.0, 8.0, vD)); ${COMMON_FRAG_TAIL} }`,
      })
    );
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    world.add(lines);
    return { obj: lines, mat, level: 0, target: 0 };
  }

  const fogBase = (scene.fog as THREE.Fog).color.clone();
  const hemiBase = hemi.color.clone();
  const keyBase = key.color.clone();
  const fogNearBase = (scene.fog as THREE.Fog).near;
  const fogFarBase = (scene.fog as THREE.Fog).far;
  let field = opts.field;
  let gradeTarget = { tint: lin(0xffffff), amount: 0, warm: 0 };
  const WARM = lin(0xffc27a);
  const COOL = lin(0x8fa8d8);

  function want(id: string, make: () => Fx, on: boolean) {
    if (on && !fx[id]) fx[id] = make();
    const f = fx[id];
    if (f) f.target = on ? 1 : 0;
  }

  function applyField(f: ArenaField) {
    field = f;
    want("rain", makeRain, f.weather === "rain");
    if (fx.rain) fx.rain.mat.uniforms.uHeavy.value = f.heavy ? 1 : 0;
    want("snow", () => makePoints(1400, { color: 0xffffff, size: 0.14, speed: 1.3, drift: 0.6, sideways: 0.4, additive: false }), f.weather === "snow");
    want("sand", () => makePoints(2200, { color: 0xe8b46a, size: 0.08, speed: 0.6, drift: 0.3, sideways: 9, additive: false }), f.weather === "sand");
    want("sun", makeSun, f.weather === "sun");
    want("terrain", makeTerrain, !!f.terrain);
    if (f.terrain && fx.terrain) {
      const [a, b] = TERRAIN_COLOR[f.terrain];
      fx.terrain.mat.uniforms.uMode.value = ["electric", "grassy", "psychic", "misty"].indexOf(f.terrain);
      fx.terrain.mat.uniforms.uA.value = lin(a, 1.3);
      fx.terrain.mat.uniforms.uB.value = lin(b, 1.5);
    }
    want("trickroom", makeTrickRoom, f.trickRoom);
    gradeTarget =
      f.weather === "rain"
        ? { tint: lin(0x1a2a4a), amount: 0.28, warm: 0 }
        : f.weather === "sun"
          ? { tint: lin(0xff9a3a), amount: f.heavy ? 0.16 : 0.1, warm: 1 }
          : f.weather === "sand"
            ? { tint: lin(0xb07a3a), amount: 0.26, warm: 0 }
            : f.weather === "snow"
              ? { tint: lin(0xcfe4ff), amount: 0.14, warm: 0 }
              : f.trickRoom
                ? { tint: lin(0x5a1a6a), amount: 0.16, warm: 0 }
                : { tint: lin(0xffffff), amount: 0, warm: 0 };
  }
  applyField(opts.field);
  // Field effects ease in and out.
  tickers.push((_t, dt) => {
    const k = Math.min(1, dt * 2.2);
    for (const f of Object.values(fx)) {
      if (!f) continue;
      f.level += (f.target - f.level) * k;
      f.mat.uniforms.uLevel.value = f.level;
      f.obj.visible = f.level > 0.003;
    }
    const g = gradeMat.uniforms;
    (g.uTint.value as THREE.Color).lerp(gradeTarget.tint, k);
    g.uAmount.value += (gradeTarget.amount - g.uAmount.value) * k;
    g.uWarm.value += (gradeTarget.warm - g.uWarm.value) * k;
    const fogC = (scene.fog as THREE.Fog).color;
    const w = fx.sun?.level ?? 0;
    const wet = fx.rain?.level ?? 0;
    const dust = fx.sand?.level ?? 0;
    fogC.copy(fogBase).lerp(WARM, w * 0.25).lerp(COOL, wet * 0.35).lerp(lin(0xb98a50), dust * 0.55);
    (scene.background as THREE.Color).copy(fogC);
    (scene.fog as THREE.Fog).near = fogNearBase * (1 - dust * 0.6 - wet * 0.3);
    (scene.fog as THREE.Fog).far = fogFarBase * (1 - dust * 0.55 - wet * 0.25);
    hemi.color.copy(hemiBase).lerp(WARM, w * 0.5).lerp(COOL, wet * 0.4);
    key.color.copy(keyBase).lerp(WARM, w * 0.6);
    key.intensity = (kind === "field" ? 2.2 : 1.4) * (1 + w * 0.6 - wet * 0.35);
  });

  // ---------------------------------------------------------------------------
  // Sizing, quality and the loop
  // ---------------------------------------------------------------------------

  let scale = opts.scale || 1;
  function applySize() {
    const pr = Math.min(window.devicePixelRatio || 1, QUALITY[quality].pr);
    const w = Math.max(64, Math.round(BACKDROP_W * scale * pr));
    const h = Math.max(48, Math.round(BACKDROP_H * scale * pr));
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    canvas.style.width = `${BACKDROP_W}px`;
    canvas.style.height = `${BACKDROP_H}px`;
    const s = h / BACKDROP_H;
    flashMat.uniforms.uScale.value = s;
    for (const f of Object.values(fx)) if (f?.mat.uniforms.uScale) f.mat.uniforms.uScale.value = s;
    for (const id of ["rain", "snow", "sand"]) {
      const f = fx[id];
      if (!f) continue;
      const geo = (f.obj as THREE.Points).geometry;
      const total = (geo.getAttribute("aSeed") as THREE.BufferAttribute).count;
      geo.setDrawRange(0, id === "rain" ? Math.round(total * QUALITY[quality].particles) : Math.round(total * QUALITY[quality].particles));
    }
    if (crowdMesh) {
      const total = (crowdMesh.instanceMatrix as THREE.InstancedBufferAttribute).count;
      crowdMesh.count = Math.round(total * QUALITY[quality].crowd);
      crowdMesh.visible = crowdMesh.count > 0;
    }
  }
  applySize();
  cb.quality?.(quality);

  let ftEma = FRAME_BUDGET_MS;
  let slowFor = 0;
  let fastFor = 0;
  let lastQChange = 0;
  let warm = 0;
  let floorSlowFor = 0;
  let dead = false;
  let raf = 0;
  let last = performance.now();
  let lastRender = 0;
  let lastMonitor = performance.now();
  const start = last;
  let visible = true;
  let readyFired = false;

  function monitor(now: number) {
    const raw = now - lastMonitor;
    lastMonitor = now;
    if (opts.quality !== null) return;
    if (warm < 20 || raw > 500) {
      warm++;
      return;
    }
    ftEma = ftEma * 0.85 + raw * 0.15;
    const budget = 1000 / QUALITY[quality].fps;
    if (ftEma > budget * 1.6) {
      slowFor += raw;
      fastFor = 0;
    } else if (ftEma < budget * 1.05) {
      fastFor += raw;
      slowFor = 0;
    } else {
      slowFor = 0;
      fastFor = 0;
    }
    if (slowFor > 900 && quality > 0 && now - lastQChange > 1000) {
      quality--;
      slowFor = 0;
      lastQChange = now;
      applySize();
      cb.quality?.(quality);
    } else if (fastFor > 8000 && quality < 3 && (window.devicePixelRatio || 1) > QUALITY[quality].pr && now - lastQChange > 6000) {
      quality++;
      fastFor = 0;
      lastQChange = now;
      applySize();
      cb.quality?.(quality);
    }
    // Still too slow at the lowest setting: the CSS backdrop is kinder to this device.
    if (quality === 0 && ftEma > 1000 / 14) floorSlowFor += raw;
    else floorSlowFor = 0;
    if (floorSlowFor > 2500) {
      cb.failed("slow");
      dispose();
    }
  }

  const camOffset = new THREE.Vector3();
  function frame(now: number) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    if (!visible) {
      last = now;
      lastMonitor = now;
      return;
    }
    const minGap = 1000 / QUALITY[quality].fps - 2;
    if (now - lastRender < minGap) return;
    lastRender = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = (now - start) / 1000;
    timeUniform.value = t;
    flashUniform.value = Math.max(0, flashUniform.value - dt * 3);
    // A gentle sway round the point between the platforms: the court barely moves, the stands drift.
    camOffset.set(Math.sin(t * 0.21) * 0.22, Math.sin(t * 0.17 + 1) * 0.07, Math.cos(t * 0.13) * 0.12);
    camera.position.copy(CAM).add(camOffset);
    camera.lookAt(LOOK.x + camOffset.x * 0.85, LOOK.y + camOffset.y * 0.85, LOOK.z);
    for (const tick of tickers) tick(t, dt);
    renderer.render(scene, camera);
    if (!readyFired) {
      readyFired = true;
      cb.ready();
    }
    monitor(now);
  }
  raf = requestAnimationFrame(frame);

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting) && document.visibilityState === "visible";
  });
  io.observe(host);
  const onVis = () => {
    visible = document.visibilityState === "visible";
  };
  document.addEventListener("visibilitychange", onVis);
  const onLost = (e: Event) => {
    e.preventDefault();
    if (dead) return;
    cb.failed("context");
    dispose();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  function dispose() {
    if (dead) return;
    dead = true;
    cancelAnimationFrame(raf);
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    canvas.removeEventListener("webglcontextlost", onLost);
    for (const d of disposables) d.dispose();
    crowdMesh?.dispose();
    renderer.dispose();
    canvas.remove();
  }

  return {
    setField(f) {
      if (!dead && (f.weather !== field.weather || f.heavy !== field.heavy || f.terrain !== field.terrain || f.trickRoom !== field.trickRoom)) applyField(f);
    },
    setScale(s) {
      if (dead || !s || Math.abs(s - scale) < 0.001) return;
      scale = s;
      applySize();
    },
    cheer(power = 1) {
      if (dead) return;
      cheerLeft = Math.max(cheerLeft, 0.6 * power);
      flashUniform.value = Math.min(1, 0.5 * power);
    },
    dispose,
  };
}
