import * as THREE from "three";
import { buildReliefMesh, type ReliefMap } from "@/lib/sizes/relief";
import { GROUNDED, poseFor } from "@/lib/race/gait";
import { runnerAt, type Race, type RaceLane } from "@/lib/race/race";
import { lanePoint } from "@/lib/race/track";
import type { Entrant } from "@/lib/race/types";
import { LAYER } from "./stadium";
import { puffTexture } from "./textures";

/**
 * The eight runners: each Pokémon's HOME render on a relief mesh (the
 * Sizes figures, lib/sizes/relief), moved down its lane by the race model
 * and animated by its gait (lib/race/gait): bob, lean, squash, bounds,
 * hops, wingbeats, a body wave for serpents, rolling for balls.
 *
 * Relief figures are solid from the front and three quarters but flat
 * edge-on, so each figure turns towards the camera, at most a little past
 * its running direction, and its art is mirrored so it always faces the
 * way it runs. Shadows are soft blobs cast away from each of the four
 * floodlight masts, as on a floodlit track. Heavy runners raise puffs of
 * rubber dust at each footfall and shake the camera.
 */

export interface RunnerUrls {
  art(id: number, size: 256 | 512): string;
  relief(e: Entrant): string;
}

export interface RunnerOptions {
  texSize: 256 | 512;
  segments: number;
  anisotropy: number;
}

export interface Figure {
  lane: RaceLane;
  root: THREE.Group;
  lean: THREE.Group;
  yaw: THREE.Group;
  spin: THREE.Group;
  body: THREE.Mesh;
  /** Flat cut-out for the photo-finish camera. */
  cut: THREE.Mesh;
  uniforms: { uWave: { value: number }; uWaveK: { value: number }; uWavePhase: { value: number } };
  mirrored: boolean;
  lastStep: number;
  dispose(): void;
}

export interface Footfall {
  x: number;
  z: number;
  kg: number;
}

async function fetchBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function bitmapPixels(bmp: ImageBitmap): ReliefMap {
  const cv = document.createElement("canvas");
  cv.width = bmp.width;
  cv.height = bmp.height;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, bmp.width, bmp.height);
  return { w: bmp.width, h: bmp.height, data: img.data, channels: 4 };
}

const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

/** Crisp, slightly richer HOME renders, and the serpent's body wave. */
function figureMaterial(tex: THREE.Texture, texSize: number, uniforms: Figure["uniforms"]): THREE.MeshStandardMaterial {
  // Some HOME renders are partly see-through (Pheromosa, ghosts): a low cut-off keeps them solid.
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.28, roughness: 0.58, metalness: 0, envMapIntensity: 0.85 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTexel = { value: 1 / texSize };
    s.uniforms.uWave = uniforms.uWave;
    s.uniforms.uWaveK = uniforms.uWaveK;
    s.uniforms.uWavePhase = uniforms.uWavePhase;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWave;\nuniform float uWaveK;\nuniform float uWavePhase;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.y += uWave * sin(transformed.x * uWaveK - uWavePhase) * (0.35 + 0.65 * smoothstep(0.0, 0.5, abs(transformed.x)));");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTexel;")
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          vec4 c0 = texture2D(map, vMapUv);
          vec4 n1 = texture2D(map, vMapUv + vec2(uTexel, 0.0)), n2 = texture2D(map, vMapUv - vec2(uTexel, 0.0));
          vec4 n3 = texture2D(map, vMapUv + vec2(0.0, uTexel)), n4 = texture2D(map, vMapUv - vec2(0.0, uTexel));
          // Sharpen inside the figure only: next to the cut-out edge the neighbours are transparent.
          float inside = min(min(n1.a, n2.a), min(n3.a, n4.a));
          vec3 blur = (n1.rgb + n2.rgb + n3.rgb + n4.rgb) * 0.25;
          vec3 sharp = clamp(c0.rgb + (c0.rgb - blur) * 0.45 * smoothstep(0.85, 1.0, inside), 0.0, 1.0);
          float l = dot(sharp, vec3(0.299, 0.587, 0.114));
          sharp = clamp(mix(vec3(l), sharp, 1.08), 0.0, 1.0);
          diffuseColor *= vec4(sharp, c0.a);
        #endif`
      );
  };
  m.customProgramCacheKey = () => "race-figure";
  return m;
}

export async function loadFigure(renderer: THREE.WebGLRenderer, lane: RaceLane, urls: RunnerUrls, o: RunnerOptions, signal: AbortSignal): Promise<Figure> {
  const e = lane.entrant;
  const [bx, by, bw, bh, size] = e.box;
  const [artBmp, reliefBmp] = await Promise.all([fetchBitmap(urls.art(e.art, o.texSize), signal), fetchBitmap(urls.relief(e), signal)]);
  if (signal.aborted) { artBmp.close(); reliefBmp.close(); throw new DOMException("aborted", "AbortError"); }
  const map = bitmapPixels(reliefBmp);
  reliefBmp.close();
  await nextFrame();
  const rm = buildReliefMesh(map, { x: bx, y: by, w: bw, h: bh, size }, o.segments);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(rm.position, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(rm.normal, 3));
  const uv = new Float32Array(rm.uv.length);
  for (let i = 0; i < uv.length; i += 2) { uv[i] = rm.uv[i]; uv[i + 1] = 1 - rm.uv[i + 1]; }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(rm.index, 1));
  geo.computeBoundingSphere();
  const tex = new THREE.Texture(artBmp as unknown as HTMLImageElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = o.anisotropy;
  tex.needsUpdate = true;
  // Upload now (while the crane shot plays), not on the first frame it's drawn.
  renderer.initTexture(tex);
  const uniforms = { uWave: { value: 0 }, uWaveK: { value: 9 }, uWavePhase: { value: 0 } };
  const mat = figureMaterial(tex, artBmp.width, uniforms);
  const body = new THREE.Mesh(geo, mat);
  const s = lane.h / rm.height;
  body.scale.setScalar(s);
  body.layers.set(LAYER.MAIN);
  body.castShadow = false;
  const spin = new THREE.Group();
  const yaw = new THREE.Group();
  const lean = new THREE.Group();
  const root = new THREE.Group();
  // Balls roll about their middle.
  if (e.motion === "roll") { spin.position.y = lane.h / 2; body.position.y = -lane.h / 2; }
  spin.add(body);
  yaw.add(spin);
  lean.add(yaw);
  root.add(lean);
  // Photo-finish cut-out: the render on a plane, facing +z, mirrored so the head leads.
  const L = Math.max(bw, bh);
  const cgeo = new THREE.PlaneGeometry(bw / L, bh / L);
  cgeo.translate(0, bh / L / 2, 0);
  const cuv = cgeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < cuv.count; i++) {
    const u = cuv.getX(i), v = cuv.getY(i);
    cuv.setXY(i, (bx + u * bw) / size, (by + (1 - v) * bh) / size);
  }
  const cmat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.28, side: THREE.DoubleSide });
  const cut = new THREE.Mesh(cgeo, cmat);
  cut.scale.set(-lane.h / (bh / L), lane.h / (bh / L), 1);
  cut.layers.set(LAYER.PF);
  return {
    lane,
    root,
    lean,
    yaw,
    spin,
    body,
    cut,
    uniforms,
    mirrored: false,
    lastStep: 0,
    dispose() {
      geo.dispose();
      mat.dispose();
      cgeo.dispose();
      cmat.dispose();
      tex.dispose();
      artBmp.close();
    },
  };
}

/** Start blocks for the runners that sprint from them. */
function startBlocks(race: Race): { group: THREE.Group; dispose(): void } {
  const g = new THREE.Group();
  const rail = new THREE.BoxGeometry(0.07, 0.05, 0.78);
  const plate = new THREE.BoxGeometry(0.13, 0.2, 0.05);
  const railMat = new THREE.MeshStandardMaterial({ color: "#2e3238", roughness: 0.5, metalness: 0.6 });
  const plateMat = new THREE.MeshStandardMaterial({ color: "#c9302c", roughness: 0.6 });
  for (const r of race.lanes) {
    if (r.entrant.motion !== "run") continue;
    const p = lanePoint(r.lane, race.distance, 0);
    const blk = new THREE.Group();
    blk.position.set(p.x - p.dx * 0.55, 0, p.z - p.dz * 0.55);
    blk.rotation.y = Math.atan2(p.dx, p.dz);
    const rr = new THREE.Mesh(rail, railMat);
    rr.position.y = 0.025;
    blk.add(rr);
    for (const [dx, dz] of [[-0.09, 0.16], [0.09, -0.18]]) {
      const pl = new THREE.Mesh(plate, plateMat);
      pl.position.set(dx, 0.1, dz);
      pl.rotation.x = -0.75;
      blk.add(pl);
    }
    g.add(blk);
  }
  return { group: g, dispose() { rail.dispose(); plate.dispose(); railMat.dispose(); plateMat.dispose(); } };
}

/** Soft blob shadows (instanced): one core under each runner and one away from each mast. */
function blobShadows(n: number): { mesh: THREE.InstancedMesh; dispose(): void } {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vUv; varying float vA;
      void main(){ vUv = uv; vA = instanceColor.r; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec2 vUv; varying float vA;
      void main(){ vec2 q = (vUv - 0.5) * 2.0; float d = dot(q, q); float a = exp(-d * 3.2) * vA * (1.0 - smoothstep(0.85, 1.0, d)); gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, dispose() { geo.dispose(); mat.dispose(); } };
}

/** Puffs of red rubber dust at heavy footfalls. */
function dustPuffs(n: number): { mesh: THREE.InstancedMesh; spawn(x: number, z: number, size: number, t: number): void; update(t: number, cam: THREE.Camera): void; dispose(): void } {
  const tex = puffTexture();
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(0.42, 0.24, 0.21) });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER.MAIN);
  const puffs = Array.from({ length: n }, () => ({ x: 0, z: 0, size: 0, t0: -99 }));
  let next = 0;
  const q = new THREE.Quaternion(), mtx = new THREE.Matrix4(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const update = (t: number, cam: THREE.Camera) => {
    cam.getWorldQuaternion(q);
    puffs.forEach((p, i) => {
      const age = t - p.t0;
      const k = age < 0 || age > 1.2 ? 0 : p.size * (0.5 + age * 1.6);
      v.set(p.x, k * 0.35, p.z);
      s.setScalar(k);
      mtx.compose(v, q, s);
      mesh.setMatrixAt(i, mtx);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  return {
    mesh,
    spawn(x, z, size, t) { puffs[next] = { x, z, size, t0: t }; next = (next + 1) % n; },
    update,
    dispose() { tex.dispose(); geo.dispose(); mat.dispose(); },
  };
}

export interface Runners {
  group: THREE.Group;
  pfGroup: THREE.Group;
  figures: Figure[];
  /** Pose every runner for race time `raceT`; returns the footfalls of heavy runners since the last call. */
  update(raceT: number, showT: number, cam: THREE.Camera, pre: "idle" | "marks" | "set" | "race"): Footfall[];
  /** Pose the photo-finish cut-outs (only) at race time t. */
  posePhoto(t: number): void;
  /** Screen anchor (top centre) of each runner, for name tags. */
  heads(): { lane: number; pos: THREE.Vector3; h: number }[];
  dispose(): void;
}

export function makeRunners(race: Race, figures: Figure[], masts: THREE.Vector3[]): Runners {
  const group = new THREE.Group();
  const pfGroup = new THREE.Group();
  for (const f of figures) { group.add(f.root); pfGroup.add(f.cut); }
  const blocks = startBlocks(race);
  blocks.group.traverse((o) => o.layers.set(LAYER.MAIN));
  group.add(blocks.group);
  const per = 1 + masts.length;
  const shadows = blobShadows(figures.length * per);
  shadows.mesh.layers.set(LAYER.MAIN);
  group.add(shadows.mesh);
  const dust = dustPuffs(40);
  group.add(dust.mesh);
  const camPos = new THREE.Vector3(), camRight = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const qLean = new THREE.Quaternion(), axis = new THREE.Vector3(), mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const headsOut: { lane: number; pos: THREE.Vector3; h: number }[] = figures.map((f) => ({ lane: f.lane.lane, pos: new THREE.Vector3(), h: f.lane.h }));
  let lastShow = 0;

  function update(raceT: number, showT: number, cam: THREE.Camera, pre: "idle" | "marks" | "set" | "race"): Footfall[] {
    const steps: Footfall[] = [];
    cam.getWorldPosition(camPos);
    camRight.setFromMatrixColumn(cam.matrixWorld, 0);
    const dtShow = showT - lastShow;
    lastShow = showT;
    figures.forEach((f, i) => {
      const r = f.lane;
      const e = r.entrant;
      const st = runnerAt(race, r, raceT);
      const p = st.point;
      const pose = poseFor(e.motion, { phase: st.phase, v: st.v, a: st.a, h: r.h, hip: r.hip, distance: st.x, time: raceT > 0 ? raceT : showT });
      // Before the gun: idle breathing, then the crouch on "Set".
      let lift = pose.lift, lean = pose.lean, squash = pose.squash;
      if (raceT <= 0) {
        const breath = Math.sin(showT * 2.1 + i * 1.7);
        squash = 0.012 * breath;
        if (e.motion === "run") {
          if (pre === "marks") { lean = 0.32; squash = -0.06; }
          if (pre === "set") { lean = 0.55; squash = -0.03; lift = 0.03 * r.h; }
        }
        if (e.motion === "hover") lift = pose.lift;
      }
      f.root.position.set(p.x, lift, p.z);
      // Lean (and pitch) about the axis across the running direction.
      axis.set(p.dx, 0, p.dz).cross(up).normalize();
      qLean.setFromAxisAngle(axis, -(lean + pose.pitch));
      f.lean.quaternion.copy(qLean);
      // Face the camera, turned a little towards the running direction; mirror so the art faces the way it runs.
      const cx = camPos.x - p.x, cz = camPos.z - p.z;
      const cl = Math.hypot(cx, cz) || 1;
      let nx = cx / cl + p.dx * 0.32, nz = cz / cl + p.dz * 0.32;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      f.yaw.rotation.y = Math.atan2(nx, nz);
      const side = p.dx * camRight.x + p.dz * camRight.z;
      if (side > 0.12) f.mirrored = true;
      else if (side < -0.12) f.mirrored = false;
      const flap = pose.flap;
      f.yaw.scale.set((f.mirrored ? -1 : 1) * flap * (1 - squash * 0.5), 1 + squash, 1 - squash * 0.5);
      // Balls roll the way they move on screen.
      f.spin.rotation.z = e.motion === "roll" ? pose.spin * (f.mirrored ? -1 : 1) : 0;
      // Serpents: a wave travels down the body, one per gait cycle (a slow ripple when still).
      f.uniforms.uWave.value = e.motion === "slither" ? 0.035 * Math.min(1, st.v / 2 + 0.25) : 0;
      f.uniforms.uWavePhase.value = (raceT > 0 ? st.phase : showT * 0.4) * Math.PI * 2 * (f.mirrored ? -1 : 1);
      headsOut[i].pos.set(p.x, lift + r.h * 1.02, p.z);
      // Footfalls of heavy grounded runners.
      const step = Math.floor(st.phase);
      if (raceT > 0 && step !== f.lastStep && GROUNDED.has(e.motion) && e.kg >= 150 && st.v > 0.2) steps.push({ x: p.x, z: p.z, kg: e.kg });
      f.lastStep = step;
      // Shadows: a core under the runner, and one away from each mast.
      const fade = Math.max(0, 1 - lift / (r.h * 0.8 + 0.6));
      const w = Math.max(0.25, r.w * 0.55);
      const base = i * per;
      quat.identity();
      pos.set(p.x, 0.012, p.z);
      scl.set(w * 1.1, 1, Math.max(0.3, w * 0.75));
      mtx.compose(pos, quat, scl);
      shadows.mesh.setMatrixAt(base, mtx);
      shadows.mesh.instanceColor!.setXYZ(base, 0.55 * fade, 0, 0);
      masts.forEach((m, k) => {
        const dx = p.x - m.x, dz = p.z - m.z;
        const dh = Math.hypot(dx, dz);
        const ux = dx / dh, uz = dz / dh;
        const len = Math.max(0.3, ((r.h + lift) * dh) / m.y);
        const off = (lift * dh) / m.y + len / 2;
        pos.set(p.x + ux * off * 0.9, 0.011, p.z + uz * off * 0.9);
        quat.setFromAxisAngle(up, Math.atan2(ux, uz));
        scl.set(w * 0.85, 1, len * 1.05);
        mtx.compose(pos, quat, scl);
        shadows.mesh.setMatrixAt(base + 1 + k, mtx);
        shadows.mesh.instanceColor!.setXYZ(base + 1 + k, 0.2 * fade, 0, 0);
      });
    });
    shadows.mesh.instanceMatrix.needsUpdate = true;
    shadows.mesh.instanceColor!.needsUpdate = true;
    for (const s of steps) dust.spawn(s.x + (Math.random() - 0.5) * 0.3, s.z + (Math.random() - 0.5) * 0.3, 0.35 * Math.cbrt(s.kg / 100), showT);
    dust.update(showT, cam);
    void dtShow;
    return steps;
  }

  function posePhoto(t: number) {
    for (const f of figures) {
      const st = runnerAt(race, f.lane, t);
      const pose = poseFor(f.lane.entrant.motion, { phase: st.phase, v: st.v, a: st.a, h: f.lane.h, hip: f.lane.hip, distance: st.x, time: t });
      f.cut.position.set(st.point.x, pose.lift, st.point.z);
      f.cut.updateMatrixWorld();
    }
  }

  return {
    group,
    pfGroup,
    figures,
    update,
    posePhoto,
    heads: () => headsOut,
    dispose() {
      figures.forEach((f) => f.dispose());
      blocks.dispose();
      shadows.dispose();
      dust.dispose();
    },
  };
}
