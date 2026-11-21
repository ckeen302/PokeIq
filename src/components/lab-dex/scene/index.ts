import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ReliefProvider, contactShadowTexture, type FigureHandle, type FigureUrls } from "@/components/sizes/scene/figures";
import { createPost } from "@/components/sizes/scene/post";
import { holoScan, type HoloScan, type LabTime } from "./holo";
import { createMirror } from "./mirror";
import { ROOM, buildCables, buildRoom, type FloorUniforms } from "./room";
import { TABLE_TOP, buildPod, buildTable, holoTint, type Pod } from "./lab";
import type { LabFonts } from "./screens";
import { labItem, type LabEntry } from "../roster";

/**
 * The Professor's Lab: a 3D Pokédex. A round research lab, a ring of
 * capsule pods (the wheel) round a holo-table, the selected Pokémon on the
 * table. Figures are /pokedex/sizes' own: the HOME render on a relief mesh
 * from its baked depth map (ReliefProvider), drawn through the same post
 * chain (HDR, MSAA, depth of field, bloom, filmic tone mapping).
 */

export type Shot = "hero" | "wide" | "select";

export interface LabSceneOptions {
  roster: LabEntry[];
  /** Index (in roster) of the Pokémon on the table. */
  selected: number;
  shot: Shot;
  fonts: LabFonts;
  urls: FigureUrls;
  /** Turn of the wheel off the selected slot, in slots (0.5: the camera looks between two pods; between 0 and 0.5: caught mid-spin). */
  spin?: number;
}

export interface LabScene {
  ready: Promise<void>;
  render(t: number): void;
  resize(w: number, h: number): void;
  /** Screen position (CSS px) of a world point, for overlay callouts. */
  project(p: THREE.Vector3): { x: number; y: number };
  dispose(): void;
}

const STEP = (Math.PI * 2) / ROOM.pods;

interface ShotSpec {
  az: number;
  dist: number;
  y: number;
  target: [number, number, number];
  fov: number;
  /** Shift of the picture (share of its width): the hero sits off centre, clear of the panels. */
  shiftX: number;
  aperture: number;
}

const SHOTS: Record<Shot, ShotSpec> = {
  hero: { az: 0.5, dist: 11.2, y: 1.2, target: [0, 2.0, 0], fov: 29, shiftX: 0.0, aperture: 9 },
  wide: { az: 0.42, dist: 15.7, y: 6.6, target: [0, 0.9, 0], fov: 50, shiftX: 0, aperture: 3 },
  select: { az: -0.42, dist: 9.6, y: 1.35, target: [0, 1.45, 0], fov: 31, shiftX: 0.0, aperture: 9 },
};

/** The lab as seen in reflections: a dark drum, its ring lamps, the screens' cyan, a warm lamp or two, the table's colour below. */
function labEnvironment(renderer: THREE.WebGLRenderer, tableColor: THREE.Color): THREE.Texture {
  const env = new THREE.Scene();
  const add = (geo: THREE.BufferGeometry, color: THREE.Color, side: THREE.Side = THREE.FrontSide) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side }));
    env.add(m);
    return m;
  };
  add(new THREE.SphereGeometry(40, 32, 16), new THREE.Color(0.01, 0.014, 0.025), THREE.BackSide);
  add(new THREE.TorusGeometry(7.6, 0.25, 8, 64).rotateX(Math.PI / 2).translate(0, 8, 0), new THREE.Color(5, 5.6, 6.5));
  add(new THREE.TorusGeometry(11.6, 0.2, 8, 64).rotateX(Math.PI / 2).translate(0, 8, 0), new THREE.Color(0.6, 1.7, 2.2));
  add(new THREE.CircleGeometry(1.6, 32).rotateX(Math.PI / 2).translate(0, 7, 0), new THREE.Color(5, 4.6, 4.2));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const p = add(new THREE.PlaneGeometry(5, 2.5), new THREE.Color(0.25, 0.85, 1.2));
    p.position.set(Math.sin(a) * 15, 3.6, Math.cos(a) * 15);
    p.lookAt(0, 3.6, 0);
  }
  // Two big soft panels: a cool key and a warm one, so metal has something to show.
  const k1 = add(new THREE.PlaneGeometry(8, 5), new THREE.Color(3.2, 3.4, 3.8));
  k1.position.set(-9, 7, 9);
  k1.lookAt(0, 1, 0);
  const k2 = add(new THREE.PlaneGeometry(6, 3), new THREE.Color(2.4, 1.5, 0.9));
  k2.position.set(10, 4, -8);
  k2.lookAt(0, 1, 0);
  add(new THREE.CircleGeometry(3, 32).rotateX(-Math.PI / 2).translate(0, 0.1, 0), tableColor.clone().multiplyScalar(1.5));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.03);
  pmrem.dispose();
  env.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  return rt.texture;
}

/** Dust in the air (lit where the lamps' shafts are) and, round the table, motes in the Pokémon's colour rising. */
function motes(color: THREE.Color, count: number, around: { r: number; y0: number; y1: number }, size: number, seed: number, strength: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const sz = new Float32Array(count);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rnd()) * around.r, a = rnd() * Math.PI * 2;
    pos[i * 3] = Math.sin(a) * r;
    pos[i * 3 + 1] = around.y0 + rnd() * (around.y1 - around.y0);
    pos[i * 3 + 2] = Math.cos(a) * r;
    sz[i] = size * (0.4 + rnd() * rnd() * 1.6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("size", new THREE.BufferAttribute(sz, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uScale: { value: 600 }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      attribute float size; uniform float uScale; varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uScale / max(0.5, -mv.z);
        vFade = smoothstep(0.3, 1.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength; varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 2.2) * vFade;
        gl_FragColor = vec4(uColor * a * uStrength, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 5;
  return p;
}

export function createLabScene(host: HTMLElement, opts: LabSceneOptions): LabScene {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", stencil: false, preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  let W = Math.max(1, host.clientWidth), H = Math.max(1, host.clientHeight);
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(W, H, false);

  const shot = SHOTS[opts.shot];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.006, 0.008, 0.016);
  scene.fog = new THREE.FogExp2(new THREE.Color(0.012, 0.017, 0.03), 0.026);
  const camera = new THREE.PerspectiveCamera(shot.fov, W / H, 0.1, 80);
  const camPos = new THREE.Vector3(Math.sin(shot.az) * shot.dist, shot.y, Math.cos(shot.az) * shot.dist);
  const target = new THREE.Vector3(...shot.target);
  camera.position.copy(camPos);
  camera.lookAt(target);

  const time: LabTime = { value: 0 };
  const hero = opts.roster[opts.selected];
  const heroType = hero.types[0];
  const selColor = holoTint(heroType);

  scene.environment = labEnvironment(renderer, selColor);
  scene.environmentIntensity = 0.55;

  // ---- The room and the wheel.
  const ringPhase = shot.az - opts.selected * STEP + (opts.spin ?? 0) * STEP;
  const floorUniforms: FloorUniforms = {
    tRefl: { value: null },
    uMirror: { value: new THREE.Matrix4() },
    uReflOn: { value: 1 },
    uRingPhase: { value: ringPhase },
    uSel: { value: opts.selected },
    uSelCol: { value: selColor },
    uPodCol: { value: opts.roster.map((e) => holoTint(e.types[0])) },
  };
  const room = buildRoom(scene, opts.roster, opts.fonts, time, floorUniforms, shot.az + Math.PI);
  const podAngles = opts.roster.map((_, i) => ringPhase + i * STEP);
  const cableGeos = buildCables(room.group, podAngles.filter((a) => Math.cos(a - shot.az) < 0.3));
  const table = buildTable(hero, time, opts.fonts);
  scene.add(table.group);
  const pods: Pod[] = opts.roster.map((e, i) => {
    const p = buildPod(e, podAngles[i], i === opts.selected, time, opts.fonts, selColor);
    scene.add(p.group);
    return p;
  });

  // ---- Light: a warm key from the front left, a cyan rim behind left, a rim in the type's colour behind right, the table's glow from below.
  const polar = (az: number, r: number, y: number) => new THREE.Vector3(Math.sin(az) * r, y, Math.cos(az) * r);
  scene.add(new THREE.HemisphereLight(0x8fb0ff, 0x06080d, 0.45));
  // A soft fill from beside the camera, so what the key can't reach isn't black.
  const fill = new THREE.SpotLight("#cfe0ff", 30, 0, 0.45, 1, 2);
  fill.position.copy(polar(shot.az + 0.35, 6.5, 2.4));
  fill.target.position.set(0, 1.5, 0);
  scene.add(fill, fill.target);
  const key = new THREE.SpotLight("#ffe9d6", 115, 0, 0.36, 0.75, 2);
  key.position.copy(polar(shot.az - 1.05, 7.2, 7.0));
  key.target.position.set(0, 1.6, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 20;
  scene.add(key, key.target);
  const rimA = new THREE.SpotLight("#59d4ff", 260, 0, 0.5, 0.6, 2);
  rimA.position.copy(polar(shot.az + Math.PI - 1.05, 5.2, 4.6));
  rimA.target.position.set(0, 1.7, 0);
  rimA.castShadow = true;
  rimA.shadow.mapSize.set(1024, 1024);
  rimA.shadow.bias = -0.0004;
  scene.add(rimA, rimA.target);
  const rimB = new THREE.SpotLight(selColor.clone().lerp(new THREE.Color("#ffffff"), 0.15), 140, 0, 0.5, 0.6, 2);
  rimB.position.copy(polar(shot.az + Math.PI + 1.1, 5.0, 3.4));
  rimB.target.position.set(0, 1.5, 0);
  scene.add(rimB, rimB.target);
  const under = new THREE.PointLight(selColor, 2, 6, 2);
  under.position.copy(polar(shot.az, 1.9, TABLE_TOP + 0.35));
  scene.add(under);
  // The rig's downlight on the table.
  const down = new THREE.SpotLight("#fff3e6", 60, 0, 0.32, 0.8, 2);
  down.position.set(0, ROOM.height - 1.5, 0);
  down.target.position.set(0, 0, 0);
  scene.add(down, down.target);

  // ---- Haze and motes.
  scene.add(motes(new THREE.Color(0.7, 0.85, 1.0), 1400, { r: 13, y0: 0.2, y1: 7.5 }, 0.022, 7, 0.55));
  scene.add(motes(selColor.clone().lerp(new THREE.Color("#ffffff"), 0.3), 140, { r: 1.6, y0: TABLE_TOP + 0.1, y1: 3.8 }, 0.035, 11, 1.4));

  // ---- Floor reflection.
  const mirror = createMirror(Math.round((W * pr) / 2), Math.round((H * pr) / 2));
  floorUniforms.tRefl.value = mirror.texture;

  // ---- Post: /pokedex/sizes' chain (HDR + MSAA, depth of field, bloom, grade), tuned for a dark room.
  const post = createPost(renderer, scene, camera, W, H, { msaa: 4, ao: false, aoSamples: 8, dof: true, dofSamples: 32, bloom: true });
  post.setSize(W, H);
  for (const p of post.composer.passes) {
    if (p instanceof UnrealBloomPass) {
      p.strength = 0.45;
      p.radius = 0.5;
      p.threshold = 1.0;
    }
    const fin = (p as unknown as { finish?: THREE.ShaderMaterial }).finish;
    if (fin) {
      fin.uniforms.vignette.value = 0.42;
      fin.uniforms.saturation.value = 1.08;
      fin.uniforms.warmth.value = 0.02;
    }
  }

  // ---- Figures: the sizes scene's relief figures.
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const relief = new ReliefProvider(opts.urls, { anisotropy: maxAniso, sharpen: 0.5, texSize: 512, coverage: true, segments: 120 });
  const ac = new AbortController();
  const handles: FigureHandle[] = [];
  const shadowTex = contactShadowTexture();
  const blobMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.75 });
  blobMat.polygonOffset = true;
  blobMat.polygonOffsetFactor = -2;
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const yawTo = (from: THREE.Vector3) => Math.atan2(camPos.x - from.x, camPos.z - from.z);
  const scan: HoloScan = {
    color: { value: selColor.clone().multiplyScalar(1.0) },
    feetY: { value: TABLE_TOP },
    scanY: { value: TABLE_TOP + (opts.shot === "select" ? 0.95 : 1.25) },
    amount: { value: 1 },
    band: { value: opts.shot === "select" ? 1 : 0 },
  };

  const place = (h: FigureHandle, parent: THREE.Object3D, item: { w: number }) => {
    parent.add(h.object);
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.scale.set(item.w * 0.85, 1, Math.max(0.25, h.depth * 2.4));
    blob.position.y = 0.006;
    blob.renderOrder = 1;
    parent.add(blob);
    handles.push(h);
  };

  const heroItem = labItem(hero, { hero: true });
  const heroTurn = new THREE.Group();
  heroTurn.position.set(0, TABLE_TOP, 0);
  heroTurn.rotation.y = yawTo(heroTurn.position) * 0.72;
  scene.add(heroTurn);
  const loads: Promise<unknown>[] = [];
  loads.push(
    relief.load(heroItem, 0, ac.signal, { priority: "high" }).then((h) => {
      for (const m of h.materials) holoScan(m, scan, time);
      place(h, heroTurn, heroItem);
    })
  );
  opts.roster.forEach((e, i) => {
    const pod = pods[i];
    pod.turn.rotation.y = yawTo(pod.spot);
    if (i === opts.selected) return;
    const item = labItem(e);
    loads.push(relief.load(item, 0, ac.signal).then((h) => place(h, pod.turn, item)));
  });

  const ready = Promise.all(loads).then(() => {
    // Compile everything before the first real frame.
    renderer.setRenderTarget(post.target);
    renderer.compile(scene, camera);
    renderer.setRenderTarget(null);
  });

  // The picture's offset (hero off centre).
  const applyOffset = () => {
    camera.aspect = W / H;
    if (shot.shiftX) camera.setViewOffset(W, H, -shot.shiftX * W, 0, W, H);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  applyOffset();

  const hide = [room.floor];
  const focus = camPos.distanceTo(new THREE.Vector3(0, shot.target[1], 0));

  return {
    ready,
    render(t) {
      time.value = t;
      mirror.update(renderer, scene, camera, hide);
      floorUniforms.uMirror.value.copy(mirror.matrix);
      post.frame(camera, focus, shot.aperture * pr, 0.1);
      post.render();
    },
    resize(w, h) {
      W = Math.max(1, w);
      H = Math.max(1, h);
      renderer.setSize(W, H, false);
      post.setSize(W, H);
      mirror.setSize(Math.round((W * pr) / 2), Math.round((H * pr) / 2));
      applyOffset();
    },
    project(p) {
      const v = p.clone().project(camera);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
    },
    dispose() {
      ac.abort();
      handles.forEach((h) => h.dispose());
      pods.forEach((p) => p.dispose());
      table.dispose();
      room.dispose();
      cableGeos.forEach((g) => g.dispose());
      mirror.dispose();
      post.dispose();
      shadowTex.dispose();
      blobMat.dispose();
      blobGeo.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
