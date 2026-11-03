import * as THREE from "three";
import { PF_CAM, type PhotoFrame } from "@/lib/race/broadcast";
import type { CamPose } from "@/lib/race/director";
import type { Race } from "@/lib/race/race";
import { buildCrowd, type Crowd } from "./crowd";
import { createPost, stadiumEnvironment, type Post } from "./post";
import { poolDepth, poolModes } from "@/lib/race/pool";
import { buildPool, setPoolModes, type Pool } from "./pool";
import { loadFigure, makeRunners, type Footfall, type Runners, type RunnerUrls } from "./runners";
import { LAYER, buildStadium, type Stadium, type StadiumUrls } from "./stadium";

/**
 * The 3D scene behind /pokedex/race and its videos: PokéIQ Stadium at
 * night with the runners on the track. The page (or the video recorder)
 * owns the clock and the director; the scene draws a frame for a race time
 * and a camera pose, shakes the camera when heavy runners land, feeds the
 * big screens, and develops the photo-finish image. Loaded only on this
 * page.
 */

/** "draft" is for automated checks on machines without a GPU: never offered to people. */
export type Quality = "draft" | "low" | "medium" | "high" | "export";

interface Spec {
  pr: number;
  post: boolean;
  msaa: number;
  bloom: boolean;
  /** Share of the seats with a spectator in them. */
  crowd: number;
  flashes: number;
  beams: boolean;
  /** Feed the big screens every n frames (0: a still card). */
  screenEvery: number;
  texSize: 256 | 512;
  segments: number;
  aniso: number;
  pf: { w: number; h: number; perFrame: number };
}

export const QUALITY: Record<Quality, Spec> = {
  draft: { pr: 1, post: false, msaa: 0, bloom: false, crowd: 0.25, flashes: 150, beams: false, screenEvery: 0, texSize: 256, segments: 40, aniso: 1, pf: { w: 360, h: 200, perFrame: 90 } },
  low: { pr: 1, post: false, msaa: 0, bloom: false, crowd: 0.4, flashes: 500, beams: false, screenEvery: 0, texSize: 256, segments: 56, aniso: 2, pf: { w: 480, h: 240, perFrame: 40 } },
  medium: { pr: 1.25, post: true, msaa: 4, bloom: true, crowd: 0.93, flashes: 1200, beams: false, screenEvery: 3, texSize: 512, segments: 80, aniso: 4, pf: { w: 640, h: 300, perFrame: 40 } },
  high: { pr: 1.6, post: true, msaa: 4, bloom: true, crowd: 0.93, flashes: 2000, beams: false, screenEvery: 2, texSize: 512, segments: 110, aniso: 8, pf: { w: 800, h: 360, perFrame: 60 } },
  export: { pr: 1, post: true, msaa: 4, bloom: true, crowd: 0.93, flashes: 2400, beams: false, screenEvery: 1, texSize: 512, segments: 120, aniso: 8, pf: { w: 900, h: 400, perFrame: 900 } },
};

export interface SceneUrls extends RunnerUrls, StadiumUrls {}

export interface SceneOptions {
  quality: Quality;
  urls: SceneUrls;
  font: string;
  /** Fixed drawing size (exports); otherwise the host's size. */
  size?: { w: number; h: number };
}

export interface FrameInput {
  /** Race clock (s after the gun; ≤ 0 before it). */
  raceT: number;
  /** Show clock (s), for idle motion and the crowd. */
  showT: number;
  pose: CamPose;
  pre: "idle" | "marks" | "set" | "race";
  /** 0 calm … 1 the finish (crowd motion and flashes). */
  excitement: number;
  /** The trackside clock's text. */
  clock: string;
  /** 0..1: the replay's grade. */
  replay: number;
  /** What the big screens show (null: the stadium card). */
  screen: CamPose | null;
  /** The lane being introduced (its neighbours step out of the shot). */
  focus?: number;
}

export interface HeadAnchor {
  lane: number;
  /** CSS pixels. */
  x: number;
  y: number;
  /** Bottom of the figure (px), and whether it's in front of the camera and on screen. */
  by: number;
  visible: boolean;
  dist: number;
}

export interface RaceScene {
  canvas: HTMLCanvasElement;
  ready: Promise<void>;
  setRace(race: Race, signal: AbortSignal, onProgress?: (k: number) => void): Promise<void>;
  /** Draws a frame; returns the heavy footfalls it saw (with their distance from the camera, for the sound). */
  frame(f: FrameInput): { kg: number; dist: number }[];
  heads(): HeadAnchor[];
  /** What the big screens show between races: a title and a line under it (the winner after the race). */
  setCard(title: string, sub: string): void;
  /** Develops the photo-finish image over a race-time window, a few columns per call; resolves with the image. */
  photoFinish(frame: PhotoFrame): { step(): boolean; result(): HTMLCanvasElement | null; progress(): number };
  resize(w: number, h: number): void;
  setQuality(q: Quality): void;
  readonly quality: Quality;
  stats(): { calls: number; tris: number; crowd: number };
  internals(): { scene: THREE.Scene; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera };
  dispose(): void;
}

export function createRaceScene(host: HTMLElement, opts: SceneOptions): RaceScene {
  let quality = opts.quality;
  let Q = QUALITY[quality];
  const Q0 = Q;
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.post && quality !== "draft", alpha: false, powerPreference: "high-performance", stencil: false, preserveDrawingBuffer: !!opts.size });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x05070c);
  const sizeOf = () => opts.size ?? { w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) };
  let { w: W, h: H } = sizeOf();
  renderer.setPixelRatio(opts.size ? 1 : Math.min(window.devicePixelRatio || 1, Q.pr));
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color(0.02, 0.025, 0.04), 0.0016);
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 6000);
  camera.layers.enable(LAYER.MAIN);
  camera.layers.enable(LAYER.SCREEN);
  camera.layers.enable(LAYER.CROWD);
  const screenCam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 3000);
  screenCam.layers.enable(LAYER.MAIN);
  const pfCam = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  pfCam.layers.set(LAYER.BASE);
  pfCam.layers.enable(LAYER.PF);

  // ---- Lights: the floodlights' key and fill, the night sky and the red track's bounce.
  scene.add(new THREE.HemisphereLight(0x9fb3e0, 0x5a2a22, 0.5));
  const stadium: Stadium = buildStadium({ urls: opts.urls, font: opts.font, q: { beams: Q0.beams, liveScreens: Q0.screenEvery > 0, anisotropy: Math.min(Q0.aniso, renderer.capabilities.getMaxAnisotropy()) }, upload: (t) => renderer.initTexture(t) });
  scene.add(stadium.group);
  const lightAt = (m: THREE.Vector3, color: number, k: number) => {
    const l = new THREE.DirectionalLight(color, k);
    l.position.copy(m);
    l.target.position.set(m.x * 0.1, 0, m.z * 0.1);
    scene.add(l, l.target);
    return l;
  };
  lightAt(stadium.masts[0], 0xfff2e2, 2.1);
  lightAt(stadium.masts[2], 0xe6edff, 1.4);
  lightAt(stadium.masts[1], 0xffffff, 0.75);
  lightAt(stadium.masts[3], 0xffffff, 0.6);
  scene.environment = stadiumEnvironment(renderer);
  scene.environmentIntensity = 0.9;

  const crowd: Crowd = buildCrowd({ occupancy: Q0.crowd, flashes: Q0.flashes });
  scene.add(crowd.group);

  // ---- Big screens: the live race from their own camera, or a still card.
  const card = document.createElement("canvas");
  card.width = 512;
  card.height = 288;
  const cardTex = new THREE.CanvasTexture(card);
  cardTex.colorSpace = THREE.SRGBColorSpace;
  const drawCard = (title: string, sub: string) => {
    const g = card.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 288);
    grad.addColorStop(0, "#0b1a3a");
    grad.addColorStop(1, "#04070f");
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 288);
    g.fillStyle = "#ffd23f";
    g.fillRect(0, 252, 512, 6);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.font = `700 58px ${opts.font}`;
    g.fillText("POKÉIQ STADIUM", 256, 104);
    g.font = `700 30px ${opts.font}`;
    g.fillStyle = "#ffd23f";
    g.fillText(title.toUpperCase(), 256, 164, 480);
    g.fillStyle = "#9fd8ff";
    g.font = `700 22px ${opts.font}`;
    g.fillText(sub.toUpperCase(), 256, 206, 480);
    cardTex.needsUpdate = true;
  };
  drawCard("Race night", "");
  let screenRT: THREE.WebGLRenderTarget | null = null;
  const feedScreens = (on: boolean) => {
    if (on && !screenRT) {
      screenRT = new THREE.WebGLRenderTarget(512, 288, { type: THREE.HalfFloatType });
      screenRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    }
    if (!on && screenRT) { screenRT.dispose(); screenRT = null; }
  };
  feedScreens(Q.screenEvery > 0);
  stadium.screenMaterial.map = cardTex;

  // ---- Post.
  let post: Post | null = Q.post ? createPost(renderer, scene, camera, W, H, { msaa: Q.msaa, bloom: Q.bloom }) : null;

  // ---- Runners (and the pool lanes of any swimmers).
  let runners: Runners | null = null;
  let pool: Pool | null = null;

  async function setRace(r: Race, signal: AbortSignal, onProgress?: (k: number) => void) {
    const figs = [];
    let done = 0;
    // Load all at once (network in parallel), build one at a time.
    const jobs = r.lanes.map((lane) => loadFigure(renderer, lane, opts.urls, { texSize: Q0.texSize, segments: Q0.segments, anisotropy: Math.min(Q0.aniso, renderer.capabilities.getMaxAnisotropy()) }, signal).then((f) => { done++; onProgress?.(done / r.lanes.length); return f; }));
    for (const j of jobs) {
      try { figs.push(await j); } catch (e) { if (signal.aborted) { figs.forEach((f) => f.dispose()); throw e; } }
    }
    if (signal.aborted) { figs.forEach((f) => f.dispose()); throw new DOMException("aborted", "AbortError"); }
    if (runners) { scene.remove(runners.group, runners.pfGroup); runners.dispose(); }
    if (pool) { scene.remove(pool.group); pool.dispose(); pool = null; }
    // Swimmers race in a water channel set into their lane, built now so nothing pops in.
    const swimLanes = r.lanes.filter((l) => l.entrant.motion === "swim");
    const modes = poolModes(swimLanes.map((l) => l.lane), r.distance);
    setPoolModes(stadium.pool, modes);
    if (swimLanes.length) {
      pool = buildPool(swimLanes.map((l) => l.lane), r.distance, modes, poolDepth(swimLanes.map((l) => l.h)), stadium.pool, scene.environment, LAYER.BASE);
      scene.add(pool.group);
    }
    runners = makeRunners(r, figs, stadium.masts, pool);
    scene.add(runners.group, runners.pfGroup);
    drawCard(`${r.distance} m`, r.order.slice(0, 3).map((x) => x.entrant.name).join(" · "));
    // Compile every shader now, so the first frames of the show don't stall.
    runners.update(0, 0, camera, "idle");
    await renderer.compileAsync(scene, camera).catch(() => undefined);
  }

  // ---- Camera shake from heavy footfalls.
  const impulses: { t: number; a: number }[] = [];
  const camPos = new THREE.Vector3();
  let frameNo = 0;

  function frame(f: FrameInput): { kg: number; dist: number }[] {
    frameNo++;
    const { pose } = f;
    camera.position.set(...pose.pos);
    camera.fov = pose.fov;
    camera.aspect = W / H;
    camera.near = Math.max(0.05, Math.min(1.5, camera.position.distanceTo(new THREE.Vector3(...pose.target)) * 0.02));
    camera.updateProjectionMatrix();
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld();
    let steps: Footfall[] = [];
    if (runners) steps = runners.update(f.raceT, f.showT, camera, f.pre, f.focus);
    camera.getWorldPosition(camPos);
    const heard: { kg: number; dist: number }[] = [];
    for (const s of steps) {
      const d = Math.hypot(s.x - camPos.x, s.z - camPos.z);
      heard.push({ kg: s.kg, dist: d });
      // A heavyweight thundering past close to the camera shakes it hard; far away, a tremor.
      const k = Math.sqrt(s.kg / 300);
      impulses.push({ t: f.showT, a: Math.min(0.022, 0.0012 * k / (1 + d / 30) + 0.0055 * k / (1 + (d / 9) * (d / 9))) });
    }
    while (impulses.length && f.showT - impulses[0].t > 0.6) impulses.shift();
    let shake = 0;
    for (const im of impulses) shake += im.a * Math.exp(-(f.showT - im.t) / 0.12);
    if (shake > 0) {
      camera.rotateX(shake * Math.sin(f.showT * 83));
      camera.rotateY(shake * 0.6 * Math.sin(f.showT * 71 + 1.3));
      camera.updateMatrixWorld();
    }
    crowd.update(f.showT, f.excitement);
    stadium.update(f.showT, camera);
    stadium.clock.draw(f.clock, "");
    // Feed the big screens.
    if (screenRT && f.screen && Q.screenEvery > 0 && frameNo % Q.screenEvery === 0) {
      screenCam.position.set(...f.screen.pos);
      screenCam.fov = f.screen.fov;
      screenCam.updateProjectionMatrix();
      screenCam.lookAt(...f.screen.target);
      screenCam.updateMatrixWorld();
      if (runners) runners.update(f.raceT, f.showT, screenCam, f.pre);
      renderer.setRenderTarget(screenRT);
      renderer.render(scene, screenCam);
      renderer.setRenderTarget(null);
      if (runners) runners.update(f.raceT, f.showT, camera, f.pre, f.focus);
      if (stadium.screenMaterial.map !== screenRT.texture) { stadium.screenMaterial.map = screenRT.texture; stadium.screenMaterial.needsUpdate = true; }
    } else if ((!f.screen || !screenRT) && stadium.screenMaterial.map !== cardTex) {
      stadium.screenMaterial.map = cardTex;
      stadium.screenMaterial.needsUpdate = true;
    }
    if (post) {
      post.setReplay(f.replay);
      post.render();
    } else {
      renderer.render(scene, camera);
    }
    return heard;
  }

  const v = new THREE.Vector3();
  function heads(): HeadAnchor[] {
    if (!runners) return [];
    return runners.heads().map((h) => {
      v.copy(h.pos).project(camera);
      const x = (v.x * 0.5 + 0.5) * W, y = (1 - (v.y * 0.5 + 0.5)) * H;
      const front = v.z < 1;
      const b = new THREE.Vector3(h.pos.x, h.pos.y - h.h * 1.02, h.pos.z).project(camera);
      return { lane: h.lane, x, y, by: (1 - (b.y * 0.5 + 0.5)) * H, visible: front && x > -40 && x < W + 40 && y > -80 && y < H + 40, dist: camera.position.distanceTo(h.pos) };
    });
  }

  function photoFinish(frame: PhotoFrame) {
    const { from, to } = frame;
    const { w: PW, h: PH, perFrame } = Q0.pf;
    const rt = new THREE.WebGLRenderTarget(PW, PH, { type: THREE.HalfFloatType });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    // The slit, high in the front of the main stand a hair past the line, aimed as the broadcast plan frames it.
    pfCam.fov = THREE.MathUtils.radToDeg(frame.bottom - frame.top) * 1.06;
    pfCam.aspect = 1 / PH;
    pfCam.near = 0.5;
    pfCam.far = 400;
    pfCam.position.set(PF_CAM.x, PF_CAM.y, PF_CAM.z);
    pfCam.rotation.set(0, 0, 0);
    pfCam.rotateX(-(frame.top + frame.bottom) / 2);
    pfCam.updateProjectionMatrix();
    pfCam.updateMatrixWorld();
    let col = 0;
    let out: HTMLCanvasElement | null = null;
    const develop = () => {
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: { t: { value: rt.texture } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: /* glsl */ `uniform sampler2D t; varying vec2 vUv;
          vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
          void main(){ vec3 c = texture2D(t, vUv).rgb * 1.3; c = aces(c);
            c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.08);
            c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); gl_FragColor = vec4(c, 1.0); }`,
        depthTest: false,
        depthWrite: false,
      }));
      const dst = new THREE.WebGLRenderTarget(PW, PH);
      const s = new THREE.Scene();
      s.add(quad);
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      renderer.setRenderTarget(dst);
      renderer.render(s, cam);
      const px = new Uint8Array(PW * PH * 4);
      renderer.readRenderTargetPixels(dst, 0, 0, PW, PH, px);
      renderer.setRenderTarget(null);
      const cv = document.createElement("canvas");
      cv.width = PW;
      cv.height = PH;
      const g = cv.getContext("2d")!;
      const img = g.createImageData(PW, PH);
      for (let y = 0; y < PH; y++) img.data.set(px.subarray((PH - 1 - y) * PW * 4, (PH - y) * PW * 4), y * PW * 4);
      g.putImageData(img, 0, 0);
      quad.geometry.dispose();
      (quad.material as THREE.Material).dispose();
      dst.dispose();
      rt.dispose();
      return cv;
    };
    return {
      step() {
        if (out) return true;
        if (!runners) return false;
        const fogWas = scene.fog;
        scene.fog = null;
        const clear = renderer.getClearColor(new THREE.Color());
        renderer.setClearColor(0x14161c);
        const end = Math.min(PW, col + perFrame);
        for (; col < end; col++) {
          const t = from + ((col + 0.5) / PW) * (to - from);
          runners.posePhoto(t);
          rt.viewport.set(col, 0, 1, PH);
          rt.scissor.set(col, 0, 1, PH);
          rt.scissorTest = true;
          renderer.setRenderTarget(rt);
          renderer.render(scene, pfCam);
        }
        renderer.setRenderTarget(null);
        renderer.setClearColor(clear);
        scene.fog = fogWas;
        if (col >= PW) out = develop();
        return !!out;
      },
      result: () => out,
      progress: () => col / PW,
    };
  }

  function resize(w: number, h: number) {
    W = w;
    H = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post?.setSize(w, h);
  }

  function setQuality(next: Quality) {
    if (next === quality) return;
    quality = next;
    Q = QUALITY[next];
    if (!opts.size) renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
    renderer.setSize(W, H, false);
    post?.dispose();
    post = Q.post ? createPost(renderer, scene, camera, W, H, { msaa: Q.msaa, bloom: Q.bloom }) : null;
    feedScreens(Q.screenEvery > 0);
  }

  const ready = Promise.resolve();

  return {
    canvas,
    ready,
    setRace,
    frame,
    heads,
    setCard: drawCard,
    photoFinish,
    resize,
    setQuality,
    get quality() { return quality; },
    stats: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, crowd: crowd.count }),
    internals: () => ({ scene, renderer, camera }),
    dispose() {
      runners?.dispose();
      pool?.dispose();
      stadium.dispose();
      crowd.dispose();
      post?.dispose();
      screenRT?.dispose();
      cardTex.dispose();
      scene.environment?.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
