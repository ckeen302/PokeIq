import * as THREE from "three";
import type { Key, Vec3 } from "@/lib/world-history/camera";
import { NOISE, col, makeGlow, makeParticles, makeRing, makeShaft, placed, ramp, rng } from "@/components/world-history/scene/kit";
import { lights, lookAt, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { drawCritter, makeCable, makeDevice, makeSilhouette, makeWords, mergeWithAttr } from "../story-kit";
import { bag, shots, STOCK } from "./base";

/**
 * III. The Cable, the film's signature shot. Two Game Boys on a dark table,
 * their screens lit pea-green, a link cable coiled between. A creature made
 * of light crawls along the wire (slow motion), lighting it behind like a
 * fuse, and pops into the other screen as pixels; little sprites trade
 * places. Then the room pulls back to three backlit silhouettes and a
 * half-red, half-white capsule turning above the table; the letters of
 * CAPSULE MONSTERS rearrange into POCKET MONSTERS and the capsule clicks
 * shut into a ball with a ring of light.
 */

/**
 * The room round the table, at the table's (giant) scale: a plaster back wall
 * with a night window onto a city, a bookcase of spines and boxes, side walls
 * and a picture rail, all in one draw call. The lamp over the table lights it
 * with a soft falloff (analytic, no extra scene light), so the room fades into
 * the dark instead of stopping at a black void; a cool spill comes from the
 * window. Its floor line sits at the dark floor that hides the figures' legs.
 */
function makeLampRoom(o: { lamp: Vec3; floor: number }) {
  const r = rng(13);
  const F = o.floor, list: [THREE.BufferGeometry, [number, number, number, number]][] = [];
  const box = (w: number, h: number, d: number, p: Vec3, c: [number, number, number], e = 0) => list.push([placed(new THREE.BoxGeometry(w, h, d), p), [c[0], c[1], c[2], e]]);
  const plaster: [number, number, number] = [0.3, 0.25, 0.2], wood: [number, number, number] = [0.2, 0.12, 0.07];
  const BZ = -15, TOP = 17, WX0 = -15, WX1 = -4, WY0 = 3.5, WY1 = 12;
  // The back wall, around a window opening.
  box(WX0 + 26, TOP - F, 0.6, [(-26 + WX0) / 2, (F + TOP) / 2, BZ], plaster);
  box(26 - WX1, TOP - F, 0.6, [(26 + WX1) / 2, (F + TOP) / 2, BZ], plaster);
  box(WX1 - WX0, WY0 - F, 0.6, [(WX0 + WX1) / 2, (F + WY0) / 2, BZ], plaster);
  box(WX1 - WX0, TOP - WY1, 0.6, [(WX0 + WX1) / 2, (WY1 + TOP) / 2, BZ], plaster);
  // The window: frame, mullions, a sill.
  for (const x of [WX0, (WX0 + WX1) / 2, WX1]) box(0.35, WY1 - WY0, 0.5, [x, (WY0 + WY1) / 2, BZ + 0.2], wood);
  for (const y of [WY0, (WY0 + WY1) / 2 + 0.8, WY1]) box(WX1 - WX0 + 0.35, 0.35, 0.5, [(WX0 + WX1) / 2, y, BZ + 0.2], wood);
  box(WX1 - WX0 + 1.6, 0.3, 1.4, [(WX0 + WX1) / 2, WY0 - 0.2, BZ + 0.7], wood);
  // Skirting and a picture rail.
  box(52, 0.8, 0.3, [0, F + 0.4, BZ + 0.4], wood);
  box(52, 0.25, 0.3, [0, TOP - 3, BZ + 0.4], wood);
  // A bookcase to the right of the window: uprights, shelves, spines and a few boxes.
  const BX0 = 2, BX1 = 18, shelves = [F + 0.4, 2.6, 6.4, 10.2, 14];
  box(0.4, 14 - F + 0.4, 2.2, [BX0, (F + 14) / 2, BZ + 1.2], wood); box(0.4, 14 - F + 0.4, 2.2, [BX1, (F + 14) / 2, BZ + 1.2], wood);
  for (const y of shelves) box(BX1 - BX0, 0.3, 2.2, [(BX0 + BX1) / 2, y, BZ + 1.2], wood);
  const spineC: [number, number, number][] = [[0.36, 0.12, 0.1], [0.14, 0.2, 0.32], [0.38, 0.3, 0.14], [0.16, 0.26, 0.16], [0.42, 0.38, 0.3], [0.3, 0.18, 0.28]];
  for (let k = 0; k < shelves.length - 1; k++) {
    let x = BX0 + 0.4;
    while (x < BX1 - 0.8) {
      if (r() < 0.12) { const bw = 1.4 + r(); box(bw, 1.2 + r(), 1.6, [x + bw / 2, shelves[k] + 0.15 + 0.8, BZ + 1.2], [0.3, 0.28, 0.24]); x += bw + 0.2; continue; }
      const w = 0.25 + r() * 0.35, hh = 2.1 + r() * 1.2, c = spineC[Math.floor(r() * spineC.length)];
      const t = r() < 0.08 ? 0.25 : 0;
      list.push([placed(new THREE.BoxGeometry(w, hh, 1.5), [x + w / 2, shelves[k] + 0.15 + hh / 2, BZ + 1.2], 0, [1, 1, 1], 0, t), [c[0] * (0.8 + r() * 0.4), c[1], c[2], 0]]);
      x += w + 0.03 + t * 0.5;
    }
  }
  // Side walls, set at an angle so the orbit always finds a wall.
  box(0.6, TOP - F, 34, [-26, (F + TOP) / 2, BZ + 17], plaster);
  box(0.6, TOP - F, 34, [26, (F + TOP) / 2, BZ + 17], plaster);
  // The night outside the window (emissive: 1).
  list.push([placed(new THREE.PlaneGeometry(WX1 - WX0, WY1 - WY0), [(WX0 + WX1) / 2, (WY0 + WY1) / 2, BZ - 0.1]), [0, 0, 0, 1]]);
  const geo = mergeWithAttr(list);
  list.forEach(([g]) => g.dispose());
  // The view: a deep blue sky with a city line and a few lit windows.
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 192;
  const g = cv.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 192); gr.addColorStop(0, "#060a1e"); gr.addColorStop(0.75, "#16244a"); gr.addColorStop(1, "#2a2a44");
  g.fillStyle = gr; g.fillRect(0, 0, 256, 192);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`; g.fillRect(r() * 256, r() * 100, 1, 1); }
  let x = 0;
  while (x < 256) { const w = 10 + r() * 24, hh = 30 + r() * 70; g.fillStyle = "#05060c"; g.fillRect(x, 192 - hh, w, hh); for (let wy = 192 - hh + 4; wy < 188; wy += 6) for (let wx = x + 2; wx < x + w - 3; wx += 5) if (r() < 0.16) { g.fillStyle = r() < 0.8 ? "#e8a050" : "#9ab8ff"; g.fillRect(wx, wy, 2, 3); } x += w + 1; }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const u = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uLamp: { value: new THREE.Vector3(...o.lamp) }, uLampC: { value: col("#ffd8a0") }, uK: { value: 1 }, uView: { value: tex }, uWin: { value: new THREE.Vector4(WX0, WY0, WX1, WY1) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    fog: true,
    vertexShader: /* glsl */ `#include <fog_pars_vertex>
      attribute vec4 aB; varying vec4 vB; varying vec3 vW; varying vec3 vN;
      void main(){ vB = aB; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `${NOISE}
      #include <fog_pars_fragment>
      uniform vec3 uLamp, uLampC; uniform float uK; uniform sampler2D uView; uniform vec4 uWin;
      varying vec4 vB; varying vec3 vW; varying vec3 vN;
      void main(){
        vec3 c;
        if (vB.w > 0.5) {
          vec2 uv = vec2((vW.x - uWin.x) / (uWin.z - uWin.x), (vW.y - uWin.y) / (uWin.w - uWin.y));
          c = texture2D(uView, uv).rgb * 0.9;
        } else {
          vec3 n = normalize(vN);
          vec3 d = uLamp - vW;
          float dist = length(d);
          float lamb = max(dot(n, d / max(dist, 1e-3)), 0.0);
          float fall = 1.0 / (1.0 + dist * dist * 0.012);
          // Plaster grain, and a cool spill from the window across the wall.
          vec3 alb = vB.rgb * (0.88 + 0.24 * whNoise(vW * 0.6));
          float spill = exp(-abs(vW.x - (uWin.x + uWin.z) * 0.5) * 0.12) * exp(-max(0.0, uWin.y - vW.y) * 0.2) * step(n.z, 0.5);
          c = alb * (uLampC * uK * (0.1 + 1.1 * lamb) * fall + vec3(0.08, 0.1, 0.18) * (0.12 + 0.5 * spill));
        }
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, u, dispose() { geo.dispose(); mat.dispose(); tex.dispose(); } };
}

/** The table setup, shared with Chapter XI's callback (same Game Boys, same cable, same orbit). */
export function cableTable(scene: THREE.Object3D) {
  const D = bag();
  // A dark wooden table, a lamp hung low over it with dust in its cone (all in one group, so a callback can hide it).
  const extras = new THREE.Group();
  scene.add(extras);
  const grainTex = (() => {
    const c = document.createElement("canvas"); c.width = 512; c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#3a2516"; g.fillRect(0, 0, 512, 64);
    for (let i = 0; i < 90; i++) { const y = (i * 37) % 64; g.strokeStyle = `rgba(${i % 2 ? 20 : 70},${i % 2 ? 12 : 44},${i % 2 ? 6 : 24},0.5)`; g.lineWidth = 1 + (i % 3); g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 512; x += 16) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.5, 4); return t;
  })();
  const tableMat = new THREE.MeshStandardMaterial({ color: col("#ffffff"), map: grainTex, roughness: 0.32, metalness: 0.05 });
  const table = new THREE.Mesh(new THREE.BoxGeometry(9, 0.2, 5), tableMat);
  table.position.set(0, -0.1, 0);
  extras.add(table);
  const shadeMat = new THREE.MeshStandardMaterial({ color: col("#1c2a1c"), roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide, emissive: col("#ffe2b0"), emissiveIntensity: 0.05 });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.7, 32, 1, true), shadeMat);
  shade.position.set(0, 7.35, 1.0);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 6, 6), shadeMat);
  cord.position.set(0, 10.7, 1.0);
  extras.add(shade, cord);
  const bulb = D.add(makeGlow({ pos: [0, 7.0, 1.0], size: 1.2, color: "#fff0d0", intensity: 1.6 }));
  extras.add(bulb.sprite);
  const cone = D.add(makeShaft({ from: [0, 7.0, 1.0], to: [0, -0.1, 0.2], r0: 0.9, r1: 4.2, color: "#ffe2b0", intensity: 0.05, noise: 0.6 }));
  extras.add(cone.mesh);
  const dust = D.add(makeParticles({ count: 260, shape: "cylinder", center: [0, 3.2, 0.5], extent: [2.4, 3, 2.2], velocity: [0.02, -0.01, 0], spread: [0.02, 0.02, 0.02], life: 14, size: [0.012, 0.03], colors: ["#fff0d0", "#ffe2b0", "#c8b890"], intensity: 1.3, turbulence: 0.5, fadeIn: 0.3, fadeOut: 0.3, seed: 77 }));
  extras.add(dust.points);
  const room = D.add(makeLampRoom({ lamp: [0, 7.0, 1.0], floor: -1.1 }));
  extras.add(room.mesh);
  D.add({ dispose: () => { table.geometry.dispose(); tableMat.dispose(); grainTex.dispose(); shade.geometry.dispose(); cord.geometry.dispose(); shadeMat.dispose(); } });
  // The screens: who is on each, drawn from the clock.
  const state = { left: -1, right: -1, flash: 0, swap: 0 };
  const drawScreen = (side: 0 | 1) => (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.fillStyle = "#9bbc0f";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#8bac0f";
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    const sw = state.swap;
    const a = side === 0 ? 1 - sw : sw;
    const b = 1 - a;
    if (state.left >= 0) drawCritter(g, 18 + a * 88, 46, 40, 11, "#0f380f");
    if (state.right >= 0) drawCritter(g, 18 + b * 88, 46, 40, 23, "#306230");
    if (state.flash > 0) { g.fillStyle = `rgba(230,255,200,${state.flash})`; g.fillRect(0, 0, w, h); }
  };
  const gbA = makeDevice("gb", { draw: drawScreen(0) });
  const gbB = makeDevice("gb", { draw: drawScreen(1) });
  D.add(gbA);
  D.add(gbB);
  for (const [gb, x, ry] of [[gbA, -2.6, 0.3], [gbB, 2.6, -0.3]] as [typeof gbA, number, number][]) {
    gb.group.rotation.set(-Math.PI / 2 + 0.18, 0, ry);
    gb.group.position.set(x, 0.16, 0.2);
    gb.group.scale.setScalar(1.6);
    scene.add(gb.group);
  }
  gbA.group.updateMatrixWorld(true);
  gbB.group.updateMatrixWorld(true);
  const pa = gbA.port.clone().applyMatrix4(gbA.group.matrixWorld);
  const pb = gbB.port.clone().applyMatrix4(gbB.group.matrixWorld);
  const cable = D.add(makeCable({ from: [pa.x, 0.1, pa.z], to: [pb.x, 0.1, pb.z], sag: -0.05, radius: 0.04, coils: 0.5, color: "#7a7a84", glow: "#c8ff5a", bow: [0, 0, -1.1] }));
  cable.mesh.position.y = 0.02;
  scene.add(cable.mesh);
  const glowA = D.add(makeGlow({ pos: [-2.6, 0.5, 0.0], size: 1.3, color: "#b8e05a", intensity: 0.3 }));
  const glowB = D.add(makeGlow({ pos: [2.6, 0.5, 0.0], size: 1.3, color: "#b8e05a", intensity: 0.3 }));
  scene.add(glowA.sprite, glowB.sprite);
  const lamp = new THREE.SpotLight(col("#ffe2b0"), 30, 20, 0.62, 0.55, 0.9);
  lamp.position.set(0, 7, 1.0);
  lamp.target.position.set(0, 0, 0);
  scene.add(lamp, lamp.target);
  return {
    cable, gbA, gbB, state, lamp, extras, room,
    /** The orbit both chapters use: slow, low, round the table. */
    orbit(t: number, r = 7.5): { pos: Vec3; look: Vec3 } {
      const a = 0.35 + t * 0.05;
      return { pos: [Math.sin(a) * r, 2.6 + Math.sin(t * 0.2) * 0.2, Math.cos(a) * r], look: [0, 0.2, 0] };
    },
    redraw(ambient: number, viewH = 900, cam?: THREE.PerspectiveCamera) {
      dust.u.uTime.value = ambient;
      cone.u.uTime.value = ambient;
      if (cam) dust.u.uPixel.value = viewH / (2 * Math.tan((cam.fov * Math.PI) / 360));
      gbA.screen.redraw(ambient);
      gbB.screen.redraw(ambient);
      cable.u.uTime.value = ambient;
    },
    dispose() { D.dispose(); },
  };
}

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tGB = B("game-boy"), tCrawl = B("crawl"), tTrade = B("trade"), tPitch = B("pitch"), tName = B("name");
  scene.background = col("#030403");
  scene.fog = new THREE.FogExp2(col("#050806"), 0.02);
  lights(scene, { sky: "#3a4a30", ground: "#0a0a08", fill: 0.4, key: "#ffe2b0", keyK: 0.5, keyPos: [3, 8, 6] });
  const T = D.add(cableTable(scene));

  // The creature of light: a cluster of motes riding the cable's curve.
  const motes = D.add(makeParticles({ count: 260, shape: "sphere", center: [0, 0, 0], extent: [0.36, 0.13, 0.15], velocity: [0, 0, 0], spread: [0.05, 0.05, 0.05], life: 1.6, size: [0.02, 0.045], colors: ["#ffffff", "#d8ff7a", "#9bbc0f"], intensity: 1.3, turbulence: 0.12, fadeIn: 0.1, fadeOut: 0.4 }));
  scene.add(motes.points);
  const head = D.add(makeGlow({ pos: [0, 0, 0], size: 0.75, color: "#e6ff9a", intensity: 0 }));
  scene.add(head.sprite);
  const trail = D.add(makeParticles({ count: 300, shape: "sphere", center: [0, 0, 0], extent: [0.08, 0.08, 0.08], velocity: [0, 0.25, 0], spread: [0.15, 0.15, 0.15], life: 1.2, size: [0.01, 0.025], colors: ["#e6ff9a", "#9bbc0f", "#2a4a10"], intensity: 1.4, turbulence: 0.2 }));
  scene.add(trail.points);

  // The room around the table: three backlit figures.
  // At this scale the Game Boys are huge: the people are seen from the chest up, looming round the table.
  const people = [[-7.2, -5.2, 0.75], [0, -8.2, 0], [7.2, -5.2, -0.75]].map(([x, z, ry]) => {
    const s = D.add(makeSilhouette({ height: 13, pose: "lean", rim: "#e8ffd0", color: "#040604" }));
    s.mesh.position.set(x, -7.4, z);
    s.mesh.rotation.y = ry;
    scene.add(s.mesh);
    return s;
  });
  // A dark floor behind the table edge, so the figures read from the chest up.
  const floorMat = new THREE.MeshBasicMaterial({ color: col("#030403") });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 48).rotateX(-Math.PI / 2), floorMat);
  floor.position.set(0, -1.1, -9);
  scene.add(floor);
  D.add({ dispose: () => { floor.geometry.dispose(); floorMat.dispose(); } });
  const back = D.add(makeGlow({ pos: [0, 3.5, -14], size: 30, color: "#b8e09a", intensity: 0 }));
  scene.add(back.sprite);

  // The capsule: two halves that close into a ball.
  const capsule = new THREE.Group();
  capsule.position.set(0, 2.4, 0);
  const red = new THREE.MeshStandardMaterial({ color: col("#e3262f"), roughness: 0.25, metalness: 0.1, emissive: col("#5a0a0e"), emissiveIntensity: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: col("#f4f1ea"), roughness: 0.25, metalness: 0.05, emissive: col("#3a3a3a"), emissiveIntensity: 0.4 });
  const band = new THREE.MeshStandardMaterial({ color: col("#141414"), roughness: 0.4 });
  const topHalf = new THREE.Mesh(new THREE.SphereGeometry(0.55, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), red);
  const botHalf = new THREE.Mesh(new THREE.SphereGeometry(0.55, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.565, 0.565, 0.07, 40, 1, true), band);
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 24).rotateX(Math.PI / 2), white);
  button.position.set(0, 0, 0.56);
  capsule.add(topHalf, botHalf, ring, button);
  scene.add(capsule);
  D.add({ dispose: () => { [topHalf, botHalf, ring, button].forEach((m) => m.geometry.dispose()); red.dispose(); white.dispose(); band.dispose(); } });
  const capGlow = D.add(makeGlow({ pos: [0, 2.4, 0], size: 3, color: "#ffe6c0", intensity: 0 }));
  scene.add(capGlow.sprite);
  const burst = D.add(makeRing({ color: "#e8ffb0", intensity: 1.6, thickness: 0.05 }));
  burst.mesh.position.set(0, 2.4, 0);
  scene.add(burst.mesh);

  // The letters: CAPSULE MONSTERS → POCKET MONSTERS (shared letters move, the rest fade).
  const from = "CAPSULE MONSTERS", to = "POCKET MONSTERS";
  const W = 0.36;
  const xs = (s: string, i: number) => (i - (s.length - 1) / 2) * W;
  const letters: { m: ReturnType<typeof makeWords>; a: number; b: number; inA: boolean; inB: boolean }[] = [];
  const usedA = new Set<number>();
  for (let j = 0; j < to.length; j++) {
    const ch = to[j];
    if (ch === " ") continue;
    let i = -1;
    for (let k = 0; k < from.length; k++) if (!usedA.has(k) && from[k] === ch) { i = k; break; }
    if (i >= 0) usedA.add(i);
    const m = D.add(makeWords({ text: ch, font: ctx.font, w: 0.5, color: "#f4ffe0", glow: "#9bbc0f", px: 96 }));
    letters.push({ m, a: i >= 0 ? xs(from, i) : xs(to, j), b: xs(to, j), inA: i >= 0, inB: true });
    scene.add(m.mesh);
  }
  for (let k = 0; k < from.length; k++) {
    if (usedA.has(k) || from[k] === " ") continue;
    const m = D.add(makeWords({ text: from[k], font: ctx.font, w: 0.5, color: "#f4ffe0", glow: "#9bbc0f", px: 96 }));
    letters.push({ m, a: xs(from, k), b: xs(from, k), inA: true, inB: false });
    scene.add(m.mesh);
  }
  const lettersY = 3.6;

  const tight = (t: number) => T.orbit(t);
  const track = [0.02, 0.25, 0.5, 0.75, 0.98].map((u): Key => {
    const at = tCrawl + 0.6 + (tTrade + 0.3 - tCrawl - 0.6) * u;
    const p = T.cable.curve.getPointAt(u);
    return { t: at, pos: [p.x - 0.75, 3.05, p.z + 0.95], look: [p.x + 0.45, 0.08, p.z - 0.1], fov: 40 };
  });
  // Shots: the orbit of the table; cut to the top-down crawl beside the creature's head; cut low on the
  // second screen for the trade; cut wide to the room for the pitch, then push in on the capsule.
  const cam = shots([
    [0, [{ t: 0, ...tight(0), fov: 40 }, { t: tCrawl - 0.4, ...tight(tCrawl - 0.4), fov: 38 }]],
    [tCrawl - 0.4, [{ ...track[0], t: tCrawl - 0.4 }, ...track]],
    [tTrade + 0.5, [
      { t: tTrade + 0.5, pos: [3.6, 1.3, 3.2], look: [2.3, 0.2, 0.2], fov: 33 },
      { t: tTrade + 0.9, pos: [3.4, 1.4, 3.0], look: [2.3, 0.2, 0.2], fov: 34 },
      { t: tTrade + 4, pos: [0, 2.6, 5.4], look: [0, 0.3, 0], fov: 40 },
      { t: tPitch, pos: [0, 2.7, 5.6], look: [0, 0.4, 0], fov: 40 },
    ]],
    [tPitch, [
      { t: tPitch, pos: [0, 3.6, 9.4], look: [0, 1.2, -0.8], fov: 45 },
      { t: tPitch + 1.5, pos: [0, 4.2, 11], look: [0, 1.4, -1], fov: 46 },
      { t: tName, pos: [0, 3.2, 7.6], look: [0, 2.7, 0], fov: 40 },
      { t: end, pos: [0, 2.9, 5.2], look: [0, 2.8, 0], fov: 38 },
    ]],
  ]);

  const pt = new THREE.Vector3();
  return {
    scene,
    portalScale: 1,
    camera: cam,
    orbit: () => ({ target: [0, 0.6, 0], limits: { yaw0: 0, yawSpan: 1.25, minPitch: 0.02, maxPitch: 1.2, minDist: 2, maxDist: 20 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      // The crawl: the head runs the length of the cable; the cable lights behind it.
      const run = ramp(t, tCrawl + 0.6, tTrade + 0.3);
      T.cable.u.uFuse.value = run;
      T.cable.u.uHead.value = run > 0 && run < 1 ? run : -1;
      const alive = run > 0 && run < 1 ? 1 : 0;
      T.cable.curve.getPointAt(Math.min(0.999, run), pt);
      pt.y += 0.14;
      motes.u.uCenter.value.copy(pt);
      motes.u.uTime.value = ambient;
      motes.u.uPixel.value = px;
      motes.u.uOpacity.value = alive;
      trail.u.uCenter.value.copy(pt);
      trail.u.uTime.value = ambient;
      trail.u.uPixel.value = px;
      trail.u.uOpacity.value = alive * 0.8;
      head.sprite.position.copy(pt);
      head.set("#e6ff9a", 0.6 * alive);
      // The screens: a creature on the left, it arrives on the right; then they trade places.
      T.state.left = t > tGB + 1.5 ? 1 : -1;
      T.state.right = run >= 1 ? 1 : -1;
      T.state.flash = Math.max(0, 1 - Math.abs(t - (tTrade + 0.35)) * 3) * 0.9;
      T.state.swap = ramp(t, tTrade + 1.2, tTrade + 3.2);
      T.redraw(ambient, viewH, cam);
      // The room: figures backlit, the capsule above.
      const room = ramp(t, tPitch - 0.5, tPitch + 1.6);
      people.forEach((p) => { p.mesh.visible = room > 0.01; p.setRim("#e8ffd0", 0.45 * room); });
      back.set("#c8e8a8", 0.62 * room);
      const cap = ramp(t, tPitch + 0.8, tPitch + 2.2);
      capsule.visible = cap > 0.01;
      capsule.scale.setScalar(Math.max(0.001, cap));
      capsule.rotation.y = ambient * 0.6;
      capsule.position.y = 2.4 + Math.sin(ambient * 1.2) * 0.06;
      const close = ramp(t, tName + 1.1, tName + 1.6);
      const gap = 0.32 * (1 - close);
      topHalf.position.y = gap / 2 + 0.035 * (1 - close);
      botHalf.position.y = -gap / 2 - 0.035 * (1 - close);
      ring.visible = button.visible = close > 0.5;
      capGlow.sprite.position.copy(capsule.position);
      capGlow.set("#ffe6c0", 0.5 * cap + 1.0 * Math.max(0, 1 - Math.abs(t - (tName + 1.6)) * 2));
      burst.u.uK.value = ramp(t, tName + 1.55, tName + 3.4);
      burst.u.uOpacity.value = t > tName + 1.55 ? 1 : 0;
      burst.u.uTime.value = ambient;
      burst.mesh.scale.setScalar(5);
      burst.mesh.quaternion.copy(cam.quaternion);
      // Letters rearrange.
      const show = ramp(t, tPitch + 1.6, tPitch + 2.6);
      const k = ramp(t, tName + 0.2, tName + 1.4);
      letters.forEach((l) => {
        const x = l.a + (l.b - l.a) * k;
        const a = show * (l.inA && l.inB ? 1 : l.inA ? 1 - k : k);
        l.m.mesh.position.set(x, lettersY + Math.sin(k * Math.PI) * (l.inA && l.inB ? 0.25 : 0), 0);
        l.m.mesh.quaternion.copy(cam.quaternion);
        l.m.mat.opacity = a;
        l.m.mesh.visible = a > 0.01;
      });
      T.lamp.intensity = 30 * (1 - room * 0.4);
    },
    look: (t) =>
      lookAt(t, { ...STOCK.warm, gain: [0.98, 1.04, 0.92] }, {
        exposure: [[0, 0.85], [tCrawl, 0.9], [tTrade, 1.0], [end, 1.05]],
        bloom: [[0, 0.85], [tCrawl + 0.5, 1.25], [tTrade + 0.3, 1.2], [tTrade + 2, 0.85], [tTrade + 3, 0.85], [tName, 0.8], [tName + 1.6, 1.2], [end, 0.9]],
        saturation: [[0, 0.95], [end, 1.1]],
        fade: [[0, 0.5], [1.2, 0]],
      }),
    dispose() { D.dispose(); },
  };
};

