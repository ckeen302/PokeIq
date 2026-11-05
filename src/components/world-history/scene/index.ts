import * as THREE from "three";
import { fovFor, lerp, type OrbitLimits, type Pose, type Vec3 } from "@/lib/world-history/camera";
import type { Film, FilmState } from "@/lib/world-history/timing";
import type { Chapter } from "@/lib/world-history/types";
import { createFigureFactory, FIGURE_CLOCK, type FigureFactory } from "./figures";
import { buildHall, type Hall } from "./hall";
import { createPost, type Post } from "./post";
import { BASE_LOOK, QUALITY, type ChapterBuilder, type ChapterRig, type Look, type Quality } from "./types";

export type { Quality } from "./types";

/**
 * The 3D side of The History of the Pokémon World, used by the page and by
 * the video recorder. The caller owns the clock and says where the film is
 * (a chapter at an anim time, or the hall between two); the scene draws
 * that frame. Chapters are built on demand (each one's code loads only
 * then), their shaders compiled before they're first seen, and dropped
 * when the film is far from them.
 *
 * Built to never show a broken frame: a lost WebGL context draws nothing
 * (the page shows its loading state) and comes back on restore; a quality
 * switch builds and compiles the new post chain before swapping it in; a
 * chapter that fails to build is retried.
 */

const BUILDERS: Record<string, () => Promise<{ build: ChapterBuilder }>> = {
  creation: () => import("./chapters/creation"),
  giants: () => import("./chapters/giants"),
  hoenn: () => import("./chapters/hoenn"),
  kalos: () => import("./chapters/kalos"),
  galar: () => import("./chapters/galar"),
  unova: () => import("./chapters/unova"),
  kitakami: () => import("./chapters/kitakami"),
  johto: () => import("./chapters/johto"),
  hisui: () => import("./chapters/hisui"),
  alola: () => import("./chapters/alola"),
  kanto: () => import("./chapters/kanto"),
  paldea: () => import("./chapters/paldea"),
};

/** A film's hall grade at a moment in the hall (from −1: the prologue; to = count: the epilogue). */
export type HallLook = (h: { from: number; to: number; k: number }) => Look;

export interface SceneOptions {
  quality: Quality;
  film: Film;
  /** The chapters (World History's, or another film's with the same id, figures and accent). */
  chapters: Chapter[];
  /** Another film's chapter builders, hall and hall grade (default: World History's). */
  builders?: Record<string, () => Promise<{ build: ChapterBuilder }>>;
  hall?: (renderer: THREE.WebGLRenderer) => Hall;
  hallLook?: HallLook;
  /** The serif for plaques. */
  font: string;
  /** A still of each chapter for its doorway (until it's loaded). */
  poster?: (id: string) => string;
  /** Fixed drawing size (exports); otherwise the host's. */
  size?: { w: number; h: number };
}

export interface FrameInput {
  state: FilmState;
  ambient: number;
  /** Free look in a chapter (lens as designed for 16:9). */
  look?: Pose | null;
  /** A video's light-burst cut from one chapter into another. */
  cut?: { from: { index: number; anim: number }; to: { index: number; anim: number }; k: number } | null;
}

export interface FrameInfo {
  /** The camera drawn (lens as designed for 16:9). */
  pose: Pose;
  /** In a chapter: what free look orbits, and its limits. */
  orbit: { target: Vec3; limits: OrbitLimits } | null;
  /** Whether everything the frame needed was loaded. */
  complete: boolean;
  /** The WebGL context is lost (nothing was drawn). */
  lost?: boolean;
}

export interface HistoryScene {
  canvas: HTMLCanvasElement;
  ready: Promise<void>;
  prepare(index: number): Promise<void>;
  isReady(index: number): boolean;
  /** Whether any chapter is still being built (frame times are not representative). */
  busy(): boolean;
  /** The WebGL context is lost and not restored yet. */
  readonly lost: boolean;
  retain(indices: number[]): void;
  frame(f: FrameInput): FrameInfo;
  resize(w: number, h: number): void;
  setQuality(q: Quality): void;
  readonly quality: Quality;
  stats(): { calls: number; tris: number; loaded: number[] };
  /** Checks (automated runs): how many pixels of the last frame's HDR picture are NaN or infinite, before any scrub. */
  probe(): { bad: number; total: number };
  dispose(): void;
}

export const HALL_LOOK: Look = { ...BASE_LOOK, exposure: 1.05, bloom: 0.75, bloomThreshold: 0.78, gain: [1.05, 0.98, 0.9], lift: [0.012, 0.008, 0.02], saturation: 0.95, contrast: 1.08, vignette: 0.5, grain: 0.035 };
const HALL_FOV = 50;

function blendLook(a: Look, b: Look, k: number): Look {
  const v = (x: Vec3, y: Vec3): Vec3 => [lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)];
  return {
    exposure: lerp(a.exposure, b.exposure, k),
    bloom: lerp(a.bloom, b.bloom, k),
    bloomRadius: lerp(a.bloomRadius, b.bloomRadius, k),
    bloomThreshold: lerp(a.bloomThreshold, b.bloomThreshold, k),
    gain: v(a.gain, b.gain),
    lift: v(a.lift, b.lift),
    saturation: lerp(a.saturation, b.saturation, k),
    contrast: lerp(a.contrast, b.contrast, k),
    vignette: lerp(a.vignette, b.vignette, k),
    chroma: lerp(a.chroma, b.chroma, k),
    flash: lerp(a.flash, b.flash, k),
    fade: lerp(a.fade, b.fade, k),
    grain: lerp(a.grain, b.grain, k),
    rays: k < 0.5 ? (a.rays ? { ...a.rays, strength: a.rays.strength * (1 - k * 2) } : undefined) : b.rays ? { ...b.rays, strength: b.rays.strength * (k * 2 - 1) } : undefined,
    // Opt-in effects: the tone curve blends; the lens ones fade with their side.
    tone: (b.tone && b.tone !== "aces" ? b.tone : a.tone),
    toneMix: lerp(toneK(a), toneK(b), k),
    streak: lerp(a.streak ?? 0, b.streak ?? 0, k),
    streakColor: k < 0.5 ? a.streakColor : b.streakColor,
    fringe: lerp(a.fringe ?? 0, b.fringe ?? 0, k),
    fog: k < 0.5 ? (a.fog ? { ...a.fog, density: a.fog.density * (1 - k * 2) } : undefined) : b.fog ? { ...b.fog, density: b.fog.density * (k * 2 - 1) } : undefined,
    dof: k < 0.5 ? (a.dof ? { ...a.dof, k: a.dof.k * (1 - k * 2) } : undefined) : b.dof ? { ...b.dof, k: b.dof.k * (k * 2 - 1) } : undefined,
    mblur: k < 0.5 ? a.mblur : b.mblur,
    whip: k < 0.5 ? a.whip : b.whip,
  };
}

const toneK = (l: Look) => (l.tone && l.tone !== "aces" ? l.toneMix ?? 1 : 0);

/** A chapter's depth effects (fog, focus, blur) only exist inside it: they ease in and out over its first and last moments, so the hall (which has no such depth) never pops against them. */
function lensEdge(l: Look, k: number): Look {
  if (k >= 1 || (!l.fog && !l.dof && !l.mblur)) return l;
  return { ...l, fog: l.fog ? { ...l.fog, density: l.fog.density * k } : undefined, dof: l.dof ? { ...l.dof, k: l.dof.k * k } : undefined, mblur: (l.mblur ?? 0) * k };
}
/** Hall frames: nothing that needs the chapter's depth. */
const flat = (l: Look): Look => (l.fog || l.dof || l.mblur || l.whip ? { ...l, fog: undefined, dof: undefined, mblur: undefined, whip: undefined } : l);

interface Slot {
  promise: Promise<void>;
  rig: ChapterRig | null;
  ac: AbortController;
  failed?: boolean;
}

/** A chapter that failed to build is tried again after these delays (ms), then left to the hall. */
const RETRY_MS = [1500, 5000];

export function createHistoryScene(host: HTMLElement, opts: SceneOptions): HistoryScene {
  let quality = opts.quality;
  let Q = QUALITY[quality];
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", stencil: false, preserveDrawingBuffer: !!opts.size });
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  // Shadows: only lights a chapter marks castShadow draw any (see light.ts), so this costs nothing until one does.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const sizeOf = () => opts.size ?? { w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) };
  let { w: W, h: H } = sizeOf();
  const prOf = () => (opts.size ? Math.min(1, Q.pr) : Math.min(window.devicePixelRatio || 1, Q.pr));
  let PR = prOf();
  renderer.setPixelRatio(PR);
  renderer.setSize(W, H, false);
  let post: Post = createPost(renderer, W, H, PR, Q);
  let figures: FigureFactory = createFigureFactory(renderer, { segments: Q.segments, texSize: Q.texSize, anisotropy: Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy()) });

  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 3000);
  const portalCam = new THREE.PerspectiveCamera(45, W / H, 0.1, 3000);
  const helper = new THREE.PerspectiveCamera();
  const hall: Hall = opts.hall ? opts.hall(renderer) : buildHall(opts.chapters, opts.font, renderer);
  const builders = opts.builders ?? BUILDERS;
  const hallLook: HallLook = opts.hallLook ?? ((h) => (h.from < 0 ? { ...HALL_LOOK, fade: Math.max(0, 0.7 - h.k * 1.8) } : HALL_LOOK));
  hall.setAspect(W / H);
  const n = opts.chapters.length;
  const slots = new Map<number, Slot>();
  const attempts = new Map<number, number>();
  let lost = false;
  let disposed = false;
  let lastPose: Pose = { pos: [0, 2, 10], look: [0, 2, 0], fov: HALL_FOV };
  const film = opts.film;

  // Doorway stills.
  if (opts.poster) {
    const loader = new THREE.TextureLoader();
    opts.chapters.forEach((c, i) => {
      loader.load(opts.poster!(c.id), (tex) => { tex.colorSpace = THREE.SRGBColorSpace; hall.setPoster(i, tex); }, undefined, () => undefined);
    });
  }

  const effFov = (fov: number) => fovFor(fov, W / H);
  const setCam = (cam: THREE.PerspectiveCamera, p: Pose, design = true) => {
    cam.position.set(...p.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(...p.look);
    if (p.roll) cam.rotateZ(p.roll);
    cam.fov = design ? effFov(p.fov) : p.fov;
    cam.aspect = W / H;
    const d = Math.hypot(p.pos[0] - p.look[0], p.pos[1] - p.look[1], p.pos[2] - p.look[2]);
    cam.near = Math.max(0.05, Math.min(1, d * 0.01));
    cam.far = 4000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  };
  const matrixOf = (p: Pose) => {
    helper.position.set(...p.pos);
    helper.up.set(0, 1, 0);
    helper.lookAt(...p.look);
    if (p.roll) helper.rotateZ(p.roll);
    helper.updateMatrixWorld();
    return helper.matrixWorld.clone();
  };

  function prepare(index: number): Promise<void> {
    if (index < 0 || index >= n) return Promise.resolve();
    const have = slots.get(index);
    if (have) return have.promise;
    const c = opts.chapters[index];
    const ac = new AbortController();
    const slot: Slot = { promise: Promise.resolve(), rig: null, ac };
    slot.promise = (async () => {
      try {
        const mod = await builders[c.id]();
        if (ac.signal.aborted) return;
        const timing = film.chapters[index];
        const rig = await mod.build({
          renderer,
          q: Q,
          chapter: c,
          timing,
          beat: (id) => timing.beats.find((b) => b.id === id)?.anim ?? 0,
          figures,
          font: opts.font,
          signal: ac.signal,
        });
        if (ac.signal.aborted) { rig.dispose(); return; }
        // Compile every shader now, so the first frame of the chapter doesn't stall.
        setCam(portalCam, rig.camera(0));
        rig.update(0, 0, portalCam, H * PR);
        await compileFor(rig.scene, portalCam);
        if (ac.signal.aborted) { rig.dispose(); return; }
        slot.rig = rig;
      } catch (e) {
        slot.failed = true;
        if (ac.signal.aborted) return;
        console.error("[world-history] chapter failed", c.id, e);
        // Try again later (a network blip, a busy GPU): the slot is dropped, so the next prepare() rebuilds it.
        const tries = (attempts.get(index) ?? 0) + 1;
        attempts.set(index, tries);
        if (tries <= RETRY_MS.length) setTimeout(() => { if (slots.get(index) === slot) slots.delete(index); }, RETRY_MS[tries - 1]);
      }
    })();
    slots.set(index, slot);
    return slot.promise;
  }

  /**
   * Compiles a scene's programs ahead of use. Programs depend on where they
   * draw (the HDR target, not the screen), so compile with that target bound,
   * or the first real frame would compile them again.
   */
  async function compileFor(scene: THREE.Object3D, cam: THREE.Camera, target: THREE.WebGLRenderTarget | null = post.target) {
    if (lost) return;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const done = renderer.compileAsync(scene, cam).catch(() => undefined);
    renderer.setRenderTarget(prev);
    await done;
  }

  function retain(indices: number[]) {
    const keep = new Set(indices);
    for (const [i, s] of slots) {
      if (keep.has(i)) continue;
      s.ac.abort();
      s.rig?.dispose();
      slots.delete(i);
    }
  }

  const rigOf = (i: number) => (i >= 0 && i < n ? slots.get(i)?.rig ?? null : null);

  const ndc = new THREE.Vector3();
  const raysUv = (look: Look, cam: THREE.PerspectiveCamera): [number, number] | null => {
    if (!look.rays) return null;
    ndc.set(...look.rays.pos).project(cam);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1.6 || Math.abs(ndc.y) > 1.6) return null;
    return [ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5];
  };

  const renderRig = (rig: ChapterRig, anim: number, ambient: number, pose: Pose, design: boolean, target: THREE.WebGLRenderTarget, cam: THREE.PerspectiveCamera) => {
    setCam(cam, pose, design);
    rig.update(anim, ambient, cam, H * PR);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(rig.scene, cam);
  };

  /** Covered share of the screen by doorway i's opening (0..1), and whether any of it shows. */
  const coverage = (i: number, cam: THREE.PerspectiveCamera) => {
    const pts = hall.corners(i).map((p) => p.clone().project(cam));
    if (pts.some((p) => p.z > 1)) return { share: 0, visible: false };
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.max(-1, Math.min(...xs)), x1 = Math.min(1, Math.max(...xs));
    const y0 = Math.max(-1, Math.min(...ys)), y1 = Math.min(1, Math.max(...ys));
    if (x1 <= x0 || y1 <= y0) return { share: 0, visible: false };
    return { share: ((x1 - x0) * (y1 - y0)) / 4, visible: true };
  };

  const rel = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  const tPos = new THREE.Vector3(), tQuat = new THREE.Quaternion(), tScale = new THREE.Vector3();
  /** The chapter's camera behind doorway i: its doorway pose, moved as the hall camera moves relative to the doorway. */
  const portalPose = (i: number, chapterPose: Pose, doorFov: number) => {
    const rig = rigOf(i);
    const s = rig?.portalScale ?? 4;
    const ref = hall.ref(i, doorFov);
    rel.copy(matrixOf(ref)).invert().multiply(camera.matrixWorld);
    rel.decompose(tPos, tQuat, tScale);
    tPos.multiplyScalar(s);
    tmp.compose(tPos, tQuat, new THREE.Vector3(1, 1, 1));
    const m = matrixOf(chapterPose).multiply(tmp);
    m.decompose(tPos, tQuat, tScale);
    portalCam.position.copy(tPos);
    portalCam.quaternion.copy(tQuat);
    portalCam.fov = camera.fov;
    portalCam.aspect = W / H;
    portalCam.near = 0.1;
    portalCam.far = 4000;
    portalCam.updateProjectionMatrix();
    portalCam.updateMatrixWorld();
  };

  /**
   * Where the camera was a shutter's length earlier (a 180° shutter at 24 fps), for motion blur: from the film's own
   * camera path, so it is the same at any frame rate and in an export. Null across a cut (a jump), so a cut never smears.
   */
  const SHUTTER = 1 / 48;
  const prevCam = new THREE.PerspectiveCamera();
  const prevVP = new THREE.Matrix4();
  const prevViewProj = (rig: ChapterRig, anim: number, pose: Pose): THREE.Matrix4 | null => {
    if (anim < SHUTTER) return null;
    const p = rig.camera(anim - SHUTTER);
    const moved = Math.hypot(p.pos[0] - pose.pos[0], p.pos[1] - pose.pos[1], p.pos[2] - pose.pos[2]);
    const span = Math.max(1, Math.hypot(pose.pos[0] - pose.look[0], pose.pos[1] - pose.look[1], pose.pos[2] - pose.look[2]));
    const da = [p.look[0] - p.pos[0], p.look[1] - p.pos[1], p.look[2] - p.pos[2]], db = [pose.look[0] - pose.pos[0], pose.look[1] - pose.pos[1], pose.look[2] - pose.pos[2]];
    const cos = (da[0] * db[0] + da[1] * db[1] + da[2] * db[2]) / Math.max(1e-6, Math.hypot(...da) * Math.hypot(...db));
    if (moved > span * 0.25 || cos < 0.94) return null;
    setCam(prevCam, p, true);
    return prevVP.multiplyMatrices(prevCam.projectionMatrix, prevCam.matrixWorldInverse);
  };

  const res = new THREE.Vector2();
  function frame(f: FrameInput): FrameInfo {
    if (lost || renderer.getContext().isContextLost()) return { pose: lastPose, orbit: null, complete: false, lost: true };
    const info = draw(f);
    lastPose = info.pose;
    return info;
  }

  function draw(f: FrameInput): FrameInfo {
    const s = f.state;
    renderer.setClearColor(0x000000, 1);
    // ---- A video cut: two chapters mixed with a burst of light.
    if (f.cut) {
      const a = rigOf(f.cut.from.index), b = rigOf(f.cut.to.index);
      if (a && b) {
        const pa = a.camera(f.cut.from.anim), pb = b.camera(f.cut.to.anim);
        renderRig(a, f.cut.from.anim, f.ambient, pa, true, post.aux(0), portalCam);
        renderRig(b, f.cut.to.anim, f.ambient, pb, true, post.aux(1), camera);
        post.mix(f.cut.k, Math.sin(Math.PI * f.cut.k));
        const la = a.look(f.cut.from.anim), lb = b.look(f.cut.to.anim);
        post.finish(flat(blendLook(la, lb, f.cut.k)), null, f.ambient);
        return { pose: pb, orbit: null, complete: true };
      }
    }
    // ---- Inside a chapter.
    if (s.kind === "chapter") {
      const rig = rigOf(s.index);
      if (rig) {
        const pose = f.look ?? rig.camera(s.anim);
        FIGURE_CLOCK.value = f.ambient;
        renderRig(rig, s.anim, f.ambient, pose, true, post.target, camera);
        const end = film.chapters[s.index].anim;
        const look = lensEdge(rig.look(s.anim), Math.min(1, s.anim / 0.8, Math.max(0, end - s.anim) / 0.8));
        post.finish(look, raysUv(look, camera), f.ambient, { camera, prevViewProj: !f.look && Q.lens && look.mblur ? prevViewProj(rig, s.anim, pose) : null });
        return { pose, orbit: rig.orbit(s.anim), complete: true };
      }
      // Not loaded yet: wait a few steps back from its doorway, in the hall.
      const ref = s.index > 0 ? hall.transition(s.index - 1, 0.82, effFov(40), effFov(40), effFov(HALL_FOV)) : hall.prologue(0.78, effFov(40), effFov(HALL_FOV));
      setCam(camera, ref, false);
      hall.update(f.ambient, camera);
      renderer.setRenderTarget(post.target);
      renderer.clear();
      renderer.render(hall.scene, camera);
      post.finish(flat(hallLook({ from: s.index - 1, to: s.index, k: 0.82 })), null, f.ambient);
      return { pose: { ...ref, fov: 40 }, orbit: null, complete: false };
    }
    // ---- The hall: the prologue, a walk between two doorways, the epilogue.
    const h = s.hall;
    const from = h.from >= 0 ? h.from : -1, to = h.to < n ? h.to : -1;
    const ra = rigOf(from), rb = rigOf(to);
    const fa = from >= 0 ? film.chapters[from] : null;
    const exitAnim = fa ? fa.anim + Math.min(1.5, s.k * 2) : 0;
    const poseA = ra && fa ? ra.camera(fa.anim) : null;
    const poseB = rb ? rb.camera(0) : null;
    const fovOut = effFov(poseA?.fov ?? 40), fovIn = effFov(poseB?.fov ?? 40);
    const hallFov = effFov(HALL_FOV);
    const hp = from < 0 ? hall.prologue(s.k, fovIn, hallFov) : to < 0 ? hall.epilogue(from, s.k, fovOut, hallFov) : hall.transition(from, s.k, fovOut, fovIn, hallFov);
    setCam(camera, hp, false);
    res.set(Math.round(W * PR), Math.round(H * PR));
    let look = hallLook({ from: h.from, to: h.to, k: s.k });
    let complete = true;
    const doors: [number, ChapterRig | null, Pose | null, number, number, 0 | 1][] = [
      [from, ra, poseA, fovOut, exitAnim, 0],
      [to, rb, poseB, fovIn, 0, 1],
    ];
    for (const [i, rig, pose, doorFov, anim, auxI] of doors) {
      if (i < 0) continue;
      const cov = coverage(i, camera);
      if (!rig || !pose) {
        hall.setLive(i, null);
        if (cov.share > 0.5) complete = false;
        continue;
      }
      if (!cov.visible) { hall.setLive(i, null); continue; }
      portalPose(i, pose, doorFov);
      const target = post.aux(auxI);
      FIGURE_CLOCK.value = f.ambient;
      rig.update(anim, f.ambient, portalCam, H * PR);
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(rig.scene, portalCam);
      hall.setLive(i, target.texture, res);
      const w = Math.min(1, Math.max(0, (cov.share - 0.25) / 0.7));
      look = blendLook(look, rig.look(anim), w);
    }
    hall.update(f.ambient, camera);
    renderer.setRenderTarget(post.target);
    renderer.clear();
    renderer.render(hall.scene, camera);
    post.finish(flat(look), null, f.ambient);
    // The rest of the doorways show their stills again.
    for (let i = 0; i < n; i++) if (i !== from && i !== to) hall.setLive(i, null);
    return { pose: { ...hp, fov: HALL_FOV }, orbit: null, complete };
  }

  function resize(w: number, h: number) {
    W = w;
    H = h;
    renderer.setSize(w, h, false);
    post.setSize(w, h, PR);
    hall.setAspect(w / h);
  }

  /**
   * A new quality: chapters built from now on use it at once; the post chain
   * (render targets, bloom, shafts) is built and its shaders compiled first,
   * while the old one keeps drawing, then swapped in between two frames.
   */
  let qGen = 0;
  const quad = new THREE.PlaneGeometry(2, 2);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  async function warmPost(p: Post) {
    if (lost) return;
    const onTarget = new THREE.Scene(), onScreen = new THREE.Scene();
    for (const m of p.materials.target) onTarget.add(Object.assign(new THREE.Mesh(quad, m), { frustumCulled: false }));
    for (const m of p.materials.screen) onScreen.add(Object.assign(new THREE.Mesh(quad, m), { frustumCulled: false }));
    renderer.initRenderTarget(p.target);
    await Promise.all([compileFor(onTarget, ortho, p.target), compileFor(onScreen, ortho, null)]);
  }
  function setQuality(next: Quality) {
    if (next === quality) return;
    quality = next;
    Q = QUALITY[next];
    figures = createFigureFactory(renderer, { segments: Q.segments, texSize: Q.texSize, anisotropy: Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy()) });
    const gen = ++qGen;
    const q = Q;
    const np = createPost(renderer, W, H, prOf(), q);
    void warmPost(np).then(() => {
      if (gen !== qGen || disposed) { np.dispose(); return; }
      PR = prOf();
      renderer.setPixelRatio(PR);
      renderer.setSize(W, H, false);
      np.setSize(W, H, PR);
      const old = post;
      post = np;
      old.dispose();
      // Doorways may still point at the old chain's portal targets.
      for (let i = 0; i < n; i++) hall.setLive(i, null);
    });
  }

  // ---- A lost context draws nothing until it is restored; three.js then rebuilds its GPU objects on use, and we recompile what's built.
  const onLost = () => { lost = true; };
  const onRestored = () => {
    lost = false;
    for (let i = 0; i < n; i++) hall.setLive(i, null);
    void compileFor(hall.scene, camera);
    for (const s of slots.values()) if (s.rig) void compileFor(s.rig.scene, camera);
    void warmPost(post);
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  const ready = (async () => {
    setCam(camera, hall.prologue(0, effFov(40), effFov(HALL_FOV)), false);
    await compileFor(hall.scene, camera);
  })();

  function probe() {
    if (lost) return { bad: -1, total: 0 };
    const w = post.target.width, h = post.target.height;
    const rt = new THREE.WebGLRenderTarget(w, h);
    const mat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: post.target.texture } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D tScene; varying vec2 vUv;
        bool bad(float v){ return (floatBitsToUint(v) & 0x7f800000u) == 0x7f800000u; }
        void main(){ vec4 c = texture2D(tScene, vUv); gl_FragColor = vec4(bad(c.r) || bad(c.g) || bad(c.b) || bad(c.a) ? 1.0 : 0.0, 0.0, 0.0, 1.0); }`,
    });
    const sc = new THREE.Scene();
    const m = new THREE.Mesh(quad, mat);
    m.frustumCulled = false;
    sc.add(m);
    renderer.setRenderTarget(rt);
    renderer.render(sc, ortho);
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    renderer.setRenderTarget(null);
    let bad = 0;
    for (let i = 0; i < buf.length; i += 4) if (buf[i] > 127) bad++;
    rt.dispose();
    mat.dispose();
    return { bad, total: w * h };
  }

  return {
    canvas,
    ready,
    probe,
    prepare,
    isReady: (i) => !!rigOf(i) || !!slots.get(i)?.failed,
    busy: () => [...slots.values()].some((s) => !s.rig && !s.failed),
    get lost() { return lost; },
    retain,
    frame,
    resize,
    setQuality,
    get quality() { return quality; },
    stats: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, loaded: [...slots.entries()].filter(([, s]) => s.rig).map(([i]) => i) }),
    dispose() {
      disposed = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      quad.dispose();
      for (const s of slots.values()) { s.ac.abort(); s.rig?.dispose(); }
      slots.clear();
      hall.dispose();
      post.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
