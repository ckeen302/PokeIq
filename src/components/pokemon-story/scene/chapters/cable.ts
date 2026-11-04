import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeGlow, makeParticles, makeRing, ramp } from "@/components/world-history/scene/kit";
import { lights, lookAt, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { drawCritter, makeCable, makeDevice, makeSilhouette, makeWords } from "../story-kit";
import { bag, STOCK } from "./base";

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

/** The table setup, shared with Chapter XI's callback (same Game Boys, same cable, same orbit). */
export function cableTable(scene: THREE.Object3D, o: { font: string }) {
  const D = bag();
  const table = new THREE.Mesh(new THREE.BoxGeometry(9, 0.2, 5), new THREE.MeshStandardMaterial({ color: col("#17110c"), roughness: 0.35, metalness: 0.1 }));
  table.position.set(0, -0.1, 0);
  scene.add(table);
  D.add({ dispose: () => { table.geometry.dispose(); (table.material as THREE.Material).dispose(); } });
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
  const cable = D.add(makeCable({ from: [pa.x, 0.1, pa.z], to: [pb.x, 0.1, pb.z], sag: -0.05, radius: 0.04, coils: 0.5, color: "#2c2c34", glow: "#c8ff5a" }));
  cable.mesh.position.y = 0.02;
  scene.add(cable.mesh);
  const glowA = D.add(makeGlow({ pos: [-2.6, 0.5, 0.0], size: 1.3, color: "#b8e05a", intensity: 0.3 }));
  const glowB = D.add(makeGlow({ pos: [2.6, 0.5, 0.0], size: 1.3, color: "#b8e05a", intensity: 0.3 }));
  scene.add(glowA.sprite, glowB.sprite);
  const lamp = new THREE.SpotLight(col("#ffe2b0"), 30, 18, 0.7, 0.5, 1.4);
  lamp.position.set(0, 7, 2);
  lamp.target.position.set(0, 0, 0);
  scene.add(lamp, lamp.target);
  return {
    cable, gbA, gbB, state, lamp,
    /** The orbit both chapters use: slow, low, round the table. */
    orbit(t: number, r = 7.5): { pos: Vec3; look: Vec3 } {
      const a = 0.35 + t * 0.05;
      return { pos: [Math.sin(a) * r, 2.6 + Math.sin(t * 0.2) * 0.2, Math.cos(a) * r], look: [0, 0.2, 0] };
    },
    redraw(ambient: number) {
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
  const T = D.add(cableTable(scene, { font: ctx.font }));

  // The creature of light: a cluster of motes riding the cable's curve.
  const motes = D.add(makeParticles({ count: 220, shape: "sphere", center: [0, 0, 0], extent: [0.28, 0.2, 0.28], velocity: [0, 0, 0], spread: [0.05, 0.05, 0.05], life: 1.6, size: [0.02, 0.05], colors: ["#ffffff", "#d8ff7a", "#9bbc0f"], intensity: 1.8, turbulence: 0.12, fadeIn: 0.1, fadeOut: 0.4 }));
  scene.add(motes.points);
  const head = D.add(makeGlow({ pos: [0, 0, 0], size: 1.1, color: "#e6ff9a", intensity: 0 }));
  scene.add(head.sprite);
  const trail = D.add(makeParticles({ count: 300, shape: "sphere", center: [0, 0, 0], extent: [0.08, 0.08, 0.08], velocity: [0, 0.25, 0], spread: [0.15, 0.15, 0.15], life: 1.2, size: [0.01, 0.025], colors: ["#e6ff9a", "#9bbc0f", "#2a4a10"], intensity: 2.2, turbulence: 0.2 }));
  scene.add(trail.points);

  // The room around the table: three backlit figures.
  const people = [[-4.2, -3.2, 0.7], [0, -4.6, 0], [4.2, -3.2, -0.7]].map(([x, z, ry]) => {
    const s = D.add(makeSilhouette({ height: 1.8, rim: "#e8ffd0" }));
    s.mesh.position.set(x, -0.2, z);
    s.mesh.rotation.y = ry;
    scene.add(s.mesh);
    return s;
  });
  const back = D.add(makeGlow({ pos: [0, 2.5, -9], size: 18, color: "#b8e09a", intensity: 0 }));
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
  const keys: Key[] = [
    { t: 0, ...tight(0), fov: 40 },
    { t: tCrawl - 0.4, ...tight(tCrawl - 0.4), fov: 38 },
    // Tracking the creature along the wire: the camera rides beside its head.
    ...[0.02, 0.25, 0.5, 0.75, 0.98].map((u): Key => {
      const at = tCrawl + 0.6 + (tTrade + 0.3 - tCrawl - 0.6) * u;
      const p = T.cable.curve.getPointAt(u);
      return { t: at, pos: [p.x - 0.5, 1.7, p.z + 3.0], look: [p.x + 0.3, 0.12, p.z], fov: 34 };
    }),
    { t: tTrade + 0.9, pos: [3.4, 1.4, 3.0], look: [2.3, 0.2, 0.2], fov: 34 },
    { t: tTrade + 4, pos: [0, 2.6, 5.4], look: [0, 0.3, 0], fov: 40 },
    { t: tPitch + 1.5, pos: [0, 4.2, 11], look: [0, 1.4, -1], fov: 46 },
    { t: tName, pos: [0, 3.2, 7.6], look: [0, 2.7, 0], fov: 40 },
    { t: end, pos: [0, 2.9, 5.2], look: [0, 2.8, 0], fov: 38 },
  ];

  const pt = new THREE.Vector3();
  return {
    scene,
    portalScale: 1,
    camera: (t) => poseOnPath(keys, t),
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
      head.set("#e6ff9a", 0.8 * alive);
      // The screens: a creature on the left, it arrives on the right; then they trade places.
      T.state.left = t > tGB + 1.5 ? 1 : -1;
      T.state.right = run >= 1 ? 1 : -1;
      T.state.flash = Math.max(0, 1 - Math.abs(t - (tTrade + 0.35)) * 3) * 0.9;
      T.state.swap = ramp(t, tTrade + 1.2, tTrade + 3.2);
      T.redraw(ambient);
      // The room: figures backlit, the capsule above.
      const room = ramp(t, tPitch - 0.5, tPitch + 1.6);
      people.forEach((p) => { p.mesh.visible = room > 0.01; p.setRim("#e8ffd0", 2.2 * room); });
      back.set("#b8e09a", 0.22 * room);
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
        bloom: [[0, 0.85], [tCrawl + 0.5, 1.4], [tTrade + 0.5, 1.4], [tTrade + 3, 0.9], [tName, 0.8], [tName + 1.6, 1.2], [end, 0.9]],
        saturation: [[0, 0.95], [end, 1.1]],
        fade: [[0, 0.5], [1.2, 0]],
      }),
    dispose() { D.dispose(); },
  };
};

