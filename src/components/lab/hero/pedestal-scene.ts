import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ReliefProvider } from "@/components/sizes/scene/figures";
import { SCENE_URLS } from "@/components/sizes/scene-item";
import type { SceneItem } from "@/components/sizes/scene/figures";

/**
 * The /lab hero's one live figure: a Pokémon's relief figure (the same mesh
 * the Professor's Lab and /pokedex/sizes build from its HOME render and baked
 * depth map) turning slowly a little either way, lit like a lab specimen.
 * The pedestal, beam and motes around it are the page's own CSS; this canvas
 * holds the figure alone, on a transparent background, drawn where the
 * poster stands so the two can cross-fade.
 */

export interface PedestalScene {
  /** Resolves once the first frame with the figure is drawn. */
  ready: Promise<void>;
  setRunning(on: boolean): void;
  setLight(light: boolean): void;
  resize(): void;
  dispose(): void;
}

const FOV = 18;

export function createPedestalScene(canvas: HTMLCanvasElement, item: SceneItem, opts: { light: boolean; maxDpr: number }): PedestalScene {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "low-power", stencil: false });
  renderer.setClearColor(0x000000, 0);
  // No tone mapping: the figure keeps the HOME render's own colours (the poster's).
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.36;

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 50);

  // Light: a soft key from the front left, two rims behind in the lab's violet and pink, a glow from the pedestal below.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x2a1f4a, 0.22);
  const key = new THREE.DirectionalLight(0xfff4ea, 0.85);
  key.position.set(-1.6, 2.2, 3);
  const rimL = new THREE.DirectionalLight(0xa78bfa, 2.6);
  rimL.position.set(-2.4, 1.4, -2.2);
  const rimR = new THREE.DirectionalLight(0xff5fa2, 2.0);
  rimR.position.set(2.4, 1.0, -2.0);
  const under = new THREE.PointLight(0xb69bff, 0.5, 3, 2);
  under.position.set(0, -0.08, 0.5);
  scene.add(hemi, key, rimL, rimR, under);

  const turn = new THREE.Group();
  scene.add(turn);

  const setLight = (light: boolean) => {
    // By day the rims are pale lavender and blush and the figure sits in brighter, softer light.
    rimL.color.set(light ? 0xc9b6ff : 0xa78bfa);
    rimR.color.set(light ? 0xffb3d1 : 0xff5fa2);
    rimL.intensity = light ? 1.8 : 2.6;
    rimR.intensity = light ? 1.4 : 2.0;
    hemi.intensity = light ? 0.3 : 0.22;
    hemi.groundColor.set(light ? 0xe9e2ff : 0x2a1f4a);
    under.color.set(light ? 0xd9ccff : 0xb69bff);
    scene.environmentIntensity = light ? 0.42 : 0.36;
  };
  setLight(opts.light);

  let W = 1, H = 1;
  const resize = () => {
    W = Math.max(1, canvas.clientWidth);
    H = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr));
    renderer.setSize(W, H, false);
    // The figure is 1 unit tall, standing at the origin. The canvas's CSS puts its feet at --foot (share of the
    // canvas height from the top) and its height at --fig (share of the canvas height): the camera frames it the same.
    const cs = getComputedStyle(canvas);
    const foot = parseFloat(cs.getPropertyValue("--foot")) || 0.9;
    const fig = parseFloat(cs.getPropertyValue("--fig")) || 0.8;
    const ppu = fig * H;
    const d = H / ppu / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    const yc = (foot * H - H / 2) / ppu;
    camera.aspect = W / H;
    camera.position.set(0, yc, d);
    camera.lookAt(0, yc, 0);
    camera.near = Math.max(0.05, d - 3);
    camera.far = d + 3;
    camera.updateProjectionMatrix();
    draw();
  };

  let running = false, raf = 0, t0 = performance.now(), clock = 0, disposed = false;
  let fig: { object: THREE.Object3D; dispose(): void } | null = null;
  const draw = () => {
    if (disposed) return;
    turn.rotation.y = Math.sin(clock * 0.32) * 0.62;
    renderer.render(scene, camera);
  };
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    clock += Math.min(0.05, (now - t0) / 1000);
    t0 = now;
    draw();
  };
  const setRunning = (on: boolean) => {
    if (on === running || disposed) return;
    running = on;
    if (on) { t0 = performance.now(); raf = requestAnimationFrame(frame); }
    else cancelAnimationFrame(raf);
  };

  const abort = new AbortController();
  const provider = new ReliefProvider(SCENE_URLS, { anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()), sharpen: 0.95, texSize: 512, coverage: true });
  const ready = provider.load(item, 0, abort.signal, { priority: "low" }).then((h) => {
    if (disposed) { h.dispose(); throw new DOMException("aborted", "AbortError"); }
    // Normalise: 1 unit tall, feet on y = 0, centred on its visible box (as the poster is).
    const box = new THREE.Box3().setFromObject(h.object);
    const size = box.getSize(new THREE.Vector3());
    const s = 1 / Math.max(1e-6, size.y);
    const holder = new THREE.Group();
    h.object.position.x -= (box.min.x + size.x / 2);
    h.object.position.y -= box.min.y;
    h.object.position.z -= (box.min.z + size.z / 2);
    holder.add(h.object);
    holder.scale.setScalar(s);
    turn.add(holder);
    fig = h;
    resize();
  });

  resize();
  return {
    ready,
    setRunning,
    setLight: (l) => { setLight(l); draw(); },
    resize,
    dispose() {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(raf);
      fig?.dispose();
      envRT.dispose();
      renderer.dispose();
    },
  };
}
