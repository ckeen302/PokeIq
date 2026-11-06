import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { NOISE, col, makeCloudLayer, makeConverge, makeGlow, makeOcean, makeParticles, makeShaft, makeSky, makeTerrain, noise2, ramp, stoneMaterial } from "../kit";
import { makeCanvasPanel } from "../props";
import { withDetail } from "../materials";
import type { ChapterBuilder, Look } from "../types";
import { actionCurve } from "../figures";
import { cine, craft, figureStyle, floatFigure, lights, loadFigures, lookAt, place, pointPixel, shake } from "./common";

/**
 * II. The Giant Who Moved Continents. A primordial sea at dusk: Regigigas
 * hauls a landmass on ropes of light; three figures take shape out of
 * clay, ice and magma; then the Sealed Chamber, where braille in the
 * stone remembers the people who sealed them away.
 */

const GIGAS = 486, ROCK = 377, ICE = 378, STEEL = 379;
const CAVE: Vec3 = [400, 0, 0];

/** Braille cells (Grade 1) for the inscription, drawn as raised dots. */
const BRAILLE: Record<string, number[]> = {
  a: [1], b: [1, 2], c: [1, 4], d: [1, 4, 5], e: [1, 5], f: [1, 2, 4], g: [1, 2, 4, 5], h: [1, 2, 5], i: [2, 4], j: [2, 4, 5], k: [1, 3], l: [1, 2, 3], m: [1, 3, 4], n: [1, 3, 4, 5], o: [1, 3, 5], p: [1, 2, 3, 4], q: [1, 2, 3, 4, 5], r: [1, 2, 3, 5], s: [2, 3, 4], t: [2, 3, 4, 5], u: [1, 3, 6], v: [1, 2, 3, 6], w: [2, 4, 5, 6], x: [1, 3, 4, 6], y: [1, 3, 4, 5, 6], z: [1, 3, 5, 6], ",": [2], ".": [2, 5, 6],
};

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tTowed = B("towed"), tHisui = B("hisui"), tShaped = B("shaped"), tSealed = B("sealed"), tLong = B("long-ago");
  const end = ctx.timing.anim;
  const cut = tSealed - 0.35;
  const scene = new THREE.Scene();
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));

  // ---- The primordial sea at dusk.
  const sky = makeSky({ top: "#081028", horizon: "#e8703a", bottom: "#0a0a14", nebulaA: "#3a2a6a", nebulaB: "#a04a3a", nebula: 0.35, nebulaScale: 1.2, stars: 0.025, sunDir: [-0.65, 0.05, -1], sunColor: "#ffb070", sunSize: 700, sunGlow: 0.34 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  scene.fog = new THREE.FogExp2(col("#2a2238"), 0.0032);
  const ocean = makeOcean({ size: 900, segments: q.grid, waves: [{ dir: [1, 0.3], steep: 0.16, length: 38 }, { dir: [-0.4, 1], steep: 0.12, length: 22 }, { dir: [0.7, -0.8], steep: 0.08, length: 11 }, { dir: [0.2, 1], steep: 0.05, length: 6 }], deep: "#06182a", shallow: "#1d4b5c", sky: "#c87a5a", sun: [-0.65, 0.05, -1], sunColor: "#e8a060", foam: 0.35 });
  scene.add(ocean.mesh);
  disposers.push(ocean.dispose);
  ocean.u.uFogColor.value.copy(col("#2a2238"));
  ocean.u.uFogDensity.value = 0.0045;
  const nz = noise2(5);
  const island = (cx: number, cz: number, r: number, h: number) => (x: number, z: number) => {
    const d = Math.hypot(x - cx, z - cz) / r;
    const m = Math.max(0, 1 - d * d);
    return -3 + m * (h * (0.55 + nz.fbm(x * 0.03, z * 0.03) * 0.9)) - (1 - m) * 2;
  };
  const rockColor = (h: number, slope: number): [number, number, number] => {
    const c = h < 0.5 ? [0.18, 0.16, 0.14] : slope > 0.5 ? [0.32, 0.29, 0.26] : [0.24, 0.3, 0.16];
    return c as [number, number, number];
  };
  const land = makeTerrain({ size: [120, 80], segments: Math.round(q.grid * 0.6), height: island(0, 0, 55, 22), color: rockColor, center: [0, 0, -95] });
  scene.add(land.mesh);
  disposers.push(land.dispose);
  const land2 = makeTerrain({ size: [90, 70], segments: Math.round(q.grid * 0.5), height: island(0, 0, 42, 16), color: rockColor, center: [-80, 0, -150] });
  scene.add(land2.mesh);
  disposers.push(land2.dispose);
  const shore = makeTerrain({ size: [70, 30], segments: Math.round(q.grid * 0.4), height: (x, z) => -2.5 + Math.max(0, 1 - (Math.abs(x) / 34) ** 2) * Math.max(0, 1 - ((z + 2) / 13) ** 2) * 3.4 + nz.fbm(x * 0.2, z * 0.2) * 0.4, color: (h) => (h > 0.4 ? [0.36, 0.33, 0.28] : [0.2, 0.19, 0.17]), center: [0, 0, 20] });
  scene.add(shore.mesh);
  disposers.push(shore.dispose);
  const mist = makeCloudLayer({ size: 600, y: 2.5, color: "#c89098", shadow: "#2a1a38", density: 0.35, scale: 0.01, speed: [1.5, 0, 0.6], intensity: 0.16 });
  scene.add(mist.mesh);
  disposers.push(mist.dispose);

  // ---- Light.
  const L = lights(scene, { sky: "#8a9ae0", ground: "#3a2014", fill: 0.62, key: "#ffb070", keyK: 2.6, keyPos: [-20, 12, -60], rim: "#6a90ff", rimK: 0.8, rimPos: [30, 20, 40] });

  // ---- Figures.
  const figs = await loadFigures(ctx, [GIGAS, ROCK, ICE, STEEL]);
  const gigas = figs.get(GIGAS);
  const regis = [figs.get(ROCK), figs.get(ICE), figs.get(STEEL)];
  const GIG: Vec3 = [0, -4.5, -18];
  const SPOTS: Vec3[] = [[-7, 0.4, 19], [0, 0.6, 21], [7, 0.4, 19]];
  place(gigas, GIG, 22, 0, scene);
  figureStyle(gigas, { rim: "#ffb070", rimK: 1.7, glow: "#ffe2a0", glowK: 0.02 });
  regis.forEach((f, i) => { place(f, SPOTS[i], 3.8, [0.3, 0, -0.3][i], scene); figureStyle(f, { rim: ["#ffb070", "#a8e8ff", "#c8d0ff"][i], rimK: 1.2, edge: ["#ff9a50", "#bff4ff", "#e0e6ff"][i], dissolve: 0 }); });
  // Shadows from the low sun behind the titan fall toward us across the land; the three stand on the shore.
  const sh = craft(ctx, L, {
    radius: 30, center: [GIG[0], 0, GIG[2]],
    receive: [land.mesh, land2.mesh, shore.mesh],
    figures: [[gigas, { ground: null, alive: 0.7, depth: 1.5 }], ...regis.map((f) => [f, { ground: 0.4, alive: 0.5 }] as [typeof f, { ground: number; alive: number }])],
    detail: [[land.mesh.material, { kind: "stone", scale: 0.6, bump: 1.4 }], [land2.mesh.material, { kind: "stone", scale: 0.6, bump: 1.4 }], [shore.mesh.material, { kind: "ground", scale: 1.1 }]],
  });
  const motes = regis.map((f, i) => {
    if (!f) return null;
    const c = makeConverge(f.points, { radius: 1.5, colors: [["#ffd2a0", "#a86a3a"], ["#ffffff", "#7fdcff"], ["#fff0c8", "#ff6a20"]][i] as [string, string], size: [0.02, 0.06], intensity: 2, spin: 1.2 });
    f.group.add(c.points);
    disposers.push(c.dispose);
    return c;
  });
  const elements = [
    makeParticles({ count: P(500), shape: "sphere", center: SPOTS[0], extent: [3, 3, 3], velocity: [0, 0.4, 0], life: 3, size: [0.05, 0.14], colors: ["#d8a070", "#8a5a30", "#3a2a1a"], intensity: 1.4, pull: 1.5, seed: 1 }),
    makeParticles({ count: P(500), shape: "sphere", center: SPOTS[1], extent: [3, 3, 3], velocity: [0, 0.3, 0], life: 3, size: [0.04, 0.12], colors: ["#ffffff", "#a8ecff", "#5ab8ff"], intensity: 2, pull: 1.5, seed: 2 }),
    makeParticles({ count: P(500), shape: "sphere", center: SPOTS[2], extent: [3, 3, 3], velocity: [0, 1.2, 0], life: 2.4, size: [0.04, 0.12], colors: ["#fff2b0", "#ff8a30", "#ff3010"], intensity: 2.6, pull: 1.5, flicker: 0.5, seed: 3 }),
  ];
  elements.forEach((e) => { scene.add(e.points); disposers.push(e.dispose); });

  // Sea spray thrown up around the titan's legs as it hauls.
  const spray = makeParticles({ count: P(900), shape: "disc", center: [GIG[0], 0.5, GIG[2] + 2], extent: [14, 0.5, 6], velocity: [0, 3.2, 1.2], spread: [1.2, 1.4, 1.2], gravity: [0, -3, 0], life: 2.2, size: [0.12, 0.4], colors: ["#fff4e8", "#ffd8b0", "#c8d8e8"], intensity: 1.3, turbulence: 0.6, seed: 31 });
  scene.add(spray.points);
  disposers.push(spray.dispose);

  // ---- Ropes of light from its hands to the landmass.
  const ropeU = { uTime: { value: 0 }, uOpacity: { value: 0 } };
  const ropeMat = new THREE.ShaderMaterial({
    uniforms: ropeU,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime, uOpacity; varying vec2 vUv; void main(){ float pulse = 0.6 + 0.4 * sin(vUv.x * 40.0 - uTime * 4.0); float core = 1.0 - abs(vUv.y - 0.5) * 2.0; vec3 c = mix(vec3(0.3, 0.8, 1.0), vec3(0.85, 1.0, 1.0), pulse * core) * (1.8 + pulse) * (0.4 + core); gl_FragColor = vec4(c * uOpacity, uOpacity); }`,
  });
  const ropes: THREE.Mesh[] = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), ropeMat);
    m.frustumCulled = false;
    scene.add(m);
    return m;
  });
  disposers.push(() => { ropes.forEach((r) => r.geometry.dispose()); ropeMat.dispose(); });
  const setRope = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= sag;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    m.geometry.dispose();
    m.geometry = new THREE.TubeGeometry(curve, 48, 0.6, 8, false);
  };

  // ---- The Sealed Chamber.
  const cave = new THREE.Group();
  cave.position.set(...CAVE);
  scene.add(cave);
  const caveMat = stoneMaterial({ color: "#4a4038", roughness: 0.95, dirt: 0.6 });
  caveMat.side = THREE.BackSide;
  withDetail(caveMat, { kind: "stone", scale: 1.4, bump: 1.1 });
  const room = new THREE.Mesh(new THREE.BoxGeometry(34, 16, 34), caveMat);
  room.position.set(0, 7.5, 0);
  cave.add(room);
  disposers.push(() => { room.geometry.dispose(); caveMat.dispose(); });
  const text = "in this cave we have lived. we owe all to the pokemon. but, we sealed the pokemon away. we feared it.";
  const wall = makeCanvasPanel({
    w: 18, h: 5.4, px: [2048, 614],
    draw(g, w, h) {
      g.fillStyle = "#000000";
      g.fillRect(0, 0, w, h);
      const words = text.split(" ");
      const cell = 44, dot = 6.5;
      let x = 70, y = 90;
      for (const word of words) {
        if (x + word.length * cell > w - 60) { x = 70; y += cell * 2.2; }
        for (const ch of word) {
          const dots = BRAILLE[ch] ?? [];
          for (const d of dots) {
            const cx = x + (d > 3 ? 14 : 0), cy = y + ((d - 1) % 3) * 14;
            const grad = g.createRadialGradient(cx, cy, 0, cx, cy, dot * 2.4);
            grad.addColorStop(0, "rgba(255,226,150,1)");
            grad.addColorStop(0.4, "rgba(255,190,90,0.6)");
            grad.addColorStop(1, "rgba(255,160,60,0)");
            g.fillStyle = grad;
            g.beginPath();
            g.arc(cx, cy, dot * 2.4, 0, Math.PI * 2);
            g.fill();
          }
          x += cell;
        }
        x += cell * 0.8;
      }
    },
    emissive: 2,
  });
  wall.mesh.position.set(0, 6.5, -16.6);
  (wall.mat as THREE.MeshBasicMaterial).blending = THREE.AdditiveBlending;
  (wall.mat as THREE.MeshBasicMaterial).transparent = true;
  cave.add(wall.mesh);
  disposers.push(wall.dispose);
  const caveShaft = makeShaft({ from: [CAVE[0] + 4, 16, CAVE[2] - 6], to: [CAVE[0], 0, CAVE[2] - 8], r0: 0.8, r1: 4.5, color: "#ffe2b0", intensity: 0.18, noise: 0.5 });
  scene.add(caveShaft.mesh);
  disposers.push(caveShaft.dispose);
  const caveDust = makeParticles({ count: P(500), shape: "box", center: [CAVE[0], 6, CAVE[2] - 6], extent: [12, 6, 8], velocity: [0.03, -0.02, 0], spread: [0.05, 0.05, 0.05], life: 16, size: [0.02, 0.05], colors: ["#ffe6b8", "#ffd090", "#b8a0ff"], intensity: 1.6, turbulence: 0.5 });
  scene.add(caveDust.points);
  disposers.push(caveDust.dispose);
  const caveLight = new THREE.PointLight(col("#ffcf90"), 0, 40, 1.4);
  caveLight.position.set(CAVE[0], 9, CAVE[2] - 4);
  scene.add(caveLight);
  const sealed: Vec3[] = [[CAVE[0] - 7, 0, CAVE[2] - 12], [CAVE[0], 0, CAVE[2] - 13], [CAVE[0] + 7, 0, CAVE[2] - 12]];
  const glow = makeGlow({ pos: [CAVE[0], 6, CAVE[2] - 15], size: 18, color: "#ffb860", intensity: 0.4 });
  scene.add(glow.sprite);
  disposers.push(glow.dispose);

  const keys: Key[] = [
    { t: 0, pos: [0, 8, 96], look: [0, 10, -20], fov: 48 },
    { t: tTowed, pos: [10, 2.4, 33], look: [-1, 10.5, -20], fov: 46 },
    { t: tHisui, pos: [-30, 26, 42], look: [-12, 2, -70], fov: 50 },
    { t: tHisui + 4, pos: [-18, 15, 38], look: [-6, 5, -52], fov: 48 },
    { t: tShaped, pos: [3, 3.2, 35], look: [0, 2.8, 19], fov: 44 },
    { t: cut, pos: [0, 2.6, 30], look: [0, 2.5, 19], fov: 42 },
    { t: cut + 0.01, pos: [CAVE[0], 3, CAVE[2] + 15], look: [CAVE[0], 4.5, CAVE[2] - 12], fov: 46 },
    { t: tLong, pos: [CAVE[0] - 2, 2.2, CAVE[2] + 4], look: [CAVE[0], 2.6, CAVE[2] - 13], fov: 42 },
    { t: end, pos: [CAVE[0] + 2, 4, CAVE[2] + 16], look: [CAVE[0], 4.5, CAVE[2] - 12], fov: 46 },
  ];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let lastRope = -1;

  return {
    scene,
    portalScale: 6,
    camera: (t) => shake(poseOnPath(keys, t), t, [{ at: tTowed + 0.8, k: 0.06 }, { at: tHisui + 2, k: 0.08, dur: 2 }]),
    orbit: (t) => ({ target: t < cut ? (t < tShaped ? [0, 10, -20] : [0, 2.5, 19]) : [CAVE[0], 3, CAVE[2] - 12], limits: { yaw0: 0, yawSpan: 1.0, minPitch: -0.2, maxPitch: 1.0, minDist: 4, maxDist: 160 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      ocean.u.uTime.value = ambient;
      mist.u.uTime.value = ambient;
      // The landmass is towed in, then bound to the other.
      const tow = ramp(t, tTowed - 1, tHisui + 5);
      land.mesh.position.set(0, -tow * 0.5, -95 + tow * 30);
      land2.mesh.position.set(-80 + tow * 32, 0, -150 + tow * 52);
      if (gigas) {
        // Each heave: the titan sinks its weight into the pull, leans back, and the ropes take the strain.
        const heave = [0.6, 2.6, 4.6].reduce((a, d) => a + actionCurve(t, tTowed + d, { pre: 0.7, post: 0.9 }), 0);
        gigas.group.position.set(GIG[0], GIG[1] + Math.sin(ambient * 0.5) * 0.2 + heave * 0.25, GIG[2] + tow * 2);
        gigas.group.rotation.y = Math.sin(ambient * 0.3) * 0.03;
        figureStyle(gigas, { act: heave * 0.8, lean: -0.05 * ramp(t, tTowed - 0.5, tTowed + 0.5) * (1 - ramp(t, tShaped - 1, tShaped)) + heave * 0.03, flex: 0.3 });
      }
      sh.follow(t > cut ? [CAVE[0], 2, CAVE[2] - 8] : t > tShaped - 0.5 ? [0, 0.5, 19] : [GIG[0], 0, GIG[2] + 6], t > cut ? 16 : t > tShaped - 0.5 ? 14 : 30);
      spray.u.uTime.value = ambient;
      spray.u.uPixel.value = px;
      spray.u.uOpacity.value = t < cut ? ramp(t, tTowed - 1, tTowed) * (1 - ramp(t, tShaped - 1, tShaped)) : 0;
      ropeU.uTime.value = ambient;
      ropeU.uOpacity.value = ramp(t, tTowed - 1.5, tTowed) * (1 - ramp(t, tShaped - 1, tShaped + 1));
      const step = Math.floor(t * 20);
      if (step !== lastRope && gigas && ropeU.uOpacity.value > 0) {
        lastRope = step;
        const s = gigas.group.scale.x;
        [-1, 1].forEach((side, i) => {
          a.set(GIG[0] + side * gigas.width * 0.42 * s, GIG[1] + gigas.height * 0.52 * s, GIG[2] + tow * 2 + 1);
          b.set(land.mesh.position.x + side * 18, 4, land.mesh.position.z + 30);
          setRope(ropes[i], a, b, 6 - tow * 4);
        });
      }
      ropes.forEach((r) => (r.visible = ropeU.uOpacity.value > 0.001));
      // The three take shape.
      regis.forEach((f, i) => {
        const k = ramp(t, tShaped + i * 0.5, tShaped + 2.6 + i * 0.5);
        const inCave = t > cut;
        const base: Vec3 = inCave ? sealed[i] : SPOTS[i];
        if (f) {
          figureStyle(f, { dissolve: inCave ? 1 : k, stone: inCave ? 0.25 + 0.75 * ramp(t, tLong - 0.5, tLong + 2.5) : 0 });
          floatFigure(f, base, ambient, inCave ? 0 : 0.04, i, [0.3, 0, -0.3][i] * (inCave ? 0.3 : 1), inCave ? 0 : 0.03);
          f.setContact(inCave ? 0.7 : 0.5, base[1]);
        }
        const m = motes[i];
        if (m) { m.u.uForm.value = k; m.u.uTime.value = ambient; m.u.uPixel.value = px; m.u.uOpacity.value = inCave ? 0 : 1 - ramp(t, tShaped + 3 + i * 0.5, tShaped + 4.5 + i * 0.5); }
        elements[i].u.uTime.value = ambient;
        elements[i].u.uPixel.value = px;
        elements[i].u.uOpacity.value = inCave ? 0 : ramp(t, tShaped - 0.5 + i * 0.5, tShaped + 0.5 + i * 0.5) * (1 - ramp(t, tShaped + 3 + i * 0.5, tShaped + 4.5 + i * 0.5));
      });
      // The chamber.
      caveDust.u.uTime.value = ambient;
      caveDust.u.uPixel.value = px;
      caveShaft.u.uTime.value = ambient;
      const braille = ramp(t, tSealed + 0.2, tSealed + 2.6);
      (wall.mat as THREE.MeshBasicMaterial).color.copy(col("#ffffff", 0.2 + 1.6 * braille * (0.85 + 0.15 * Math.sin(ambient * 1.7))));
      caveLight.intensity = t > cut ? 34 * (1 - ramp(t, tLong + 0.5, end) * 0.5) : 0;
      glow.set("#ffb860", t > cut ? 0.35 * braille : 0);
      L.key.intensity = t > cut ? 0.4 : 2.6;
      L.hemi.intensity = t > cut ? 0.45 : 0.62;
    },
    look(t) {
      const inCave = t > cut;
      const fog: Look["fog"] = inCave
        ? { color: [0.1, 0.075, 0.05], density: 0.02, height: 0, falloff: 0.18, sky: 0 }
        : { color: [0.22, 0.12, 0.09], density: 0.0016, height: -2, falloff: 0.08, sun: { dir: [-0.54, 0.04, -0.84], color: [0.3, 0.15, 0.05] }, sky: 0.1 };
      const focus: Vec3 = inCave ? [CAVE[0], 3, CAVE[2] - 12] : t > tShaped - 0.5 ? [0, 2.5, 19] : [GIG[0], 10, GIG[2]];
      return cine(lookAt(
        t,
        { bloom: 0.75, bloomRadius: 0.6 },
        {
          exposure: [[0, 0.95], [cut - 0.4, 1.0], [cut + 0.6, 1.05], [end, 0.95]],
          fade: [[cut - 0.45, 0], [cut - 0.1, 1], [cut + 0.15, 1], [cut + 0.7, 0]],
          gain: [[0, [1.08, 0.98, 0.9]], [cut, [1.06, 0.98, 0.9]], [cut + 0.2, [1.0, 0.92, 0.82]], [end, [0.98, 0.9, 0.82]]],
          saturation: [[0, 1.1], [cut, 1.1], [cut + 0.2, 0.9], [tLong + 2, 0.75]],
          vignette: [[0, 0.4], [cut + 0.2, 0.6]],
          bloom: [[0, 0.75], [tSealed + 1, 1.0]],
          contrast: [[0, 1.12], [cut, 1.12], [cut + 0.2, 1.06]],
          rays: [[0, 0.12], [cut - 0.2, 0.12], [cut, 0]],
        },
        // Shafts from the low sun behind the titan.
        { pos: [-650, 50, -1000], color: [1.0, 0.7, 0.4] }
      ), { fog, dof: { focus, k: 0.3 }, streak: inCave ? 0.2 : 0.14, streakColor: [1.0, 0.75, 0.5], black: inCave ? 0.03 : 0.05 });
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};

export const GLSL = NOISE;
