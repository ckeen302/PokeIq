import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeCloudLayer, makeGlow, makeParticles, makeShaft, makeSky, makeTerrain, merge, noise2, placed, ramp, rng, stoneMaterial } from "../kit";
import { makeCanvasPanel, makeFoliage, makePage } from "../props";
import type { ChapterBuilder, Look } from "../types";
import { figureStyle, floatFigure, lights, loadFigures, lookAt, place, pointPixel, shake, spike } from "./common";

/**
 * XI. The Mansion Journals. A jungle at dawn, shafts of light through the
 * canopy, and something pink among the trees: Mew. Then a laboratory at
 * night: a tank glowing green with a shape inside, flickering monitors,
 * and the journal pages on the desk in the game's own words. The tank
 * breaks (slow motion). Last, the Pokédex's different account.
 */

const MEW = 151, MEWTWO = 150;
const LAB: Vec3 = [320, 0, 0];

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tJungle = B("jungle"), tMew = B("mew"), tBirth = B("birth"), tPower = B("powerful"), tCreated = B("created");
  const end = ctx.timing.anim;
  const cutLab = tBirth - 0.4;
  const tBreak = tPower + 1.5;
  const scene = new THREE.Scene();
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));
  const nz = noise2(103);
  const r = rng(51);
  const font = ctx.font;

  // ---- The jungle.
  const sky = makeSky({ top: "#3a6a5a", horizon: "#e8d8a0", bottom: "#0a1a10", nebula: 0, stars: 0, sunDir: [0.3, 0.6, -0.7], sunColor: "#fff0c0", sunSize: 300, sunGlow: 0.5 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  const fog = new THREE.FogExp2(col("#4a6a50"), 0.035);
  scene.fog = fog;
  const ground = makeTerrain({
    size: [120, 120], segments: Math.round(q.grid * 0.4),
    height: (x, z) => nz.fbm(x * 0.06, z * 0.06) * 2.4 - 1 + Math.max(0, Math.abs(x) - 10) * 0.08,
    color: (h) => (h > 0.6 ? [0.12, 0.2, 0.08] : [0.08, 0.14, 0.06]),
    center: [0, 0, -20], roughness: 0.95,
  });
  scene.add(ground.mesh);
  disposers.push(ground.dispose);
  const trunks: THREE.BufferGeometry[] = [];
  const canopy: Vec3[] = [];
  const under: Vec3[] = [];
  for (let i = 0; i < 60; i++) {
    const x = (r() - 0.5) * 70, z = 10 - r() * 70;
    if (Math.abs(x - 1) < 4 && z < 4 && z > -12) continue;
    const h = 12 + r() * 14;
    trunks.push(placed(new THREE.CylinderGeometry(0.25 + r() * 0.2, 0.5 + r() * 0.4, h, 7), [x, h / 2 - 0.5, z], r() * 3, [1, 1, 1], (r() - 0.5) * 0.12, (r() - 0.5) * 0.12));
    for (let k = 0; k < 5; k++) canopy.push([x + (r() - 0.5) * 7, h - 2 + r() * 5, z + (r() - 0.5) * 7]);
  }
  for (let i = 0; i < 260; i++) { const x = (r() - 0.5) * 60, z = 12 - r() * 60; if (Math.abs(x - 1) < 3 && z < 2 && z > -10) continue; under.push([x, 0.6 + r() * 1.6, z]); }
  const trunkMat = new THREE.MeshStandardMaterial({ color: col("#3a2a1c"), roughness: 0.95 });
  const trunkMesh = new THREE.Mesh(merge(trunks), trunkMat);
  scene.add(trunkMesh);
  disposers.push(() => { trunkMesh.geometry.dispose(); trunkMat.dispose(); });
  const leaves = makeFoliage({ points: canopy, size: [5, 9], colors: ["#0e3a1a", "#3a7a2a"], seed: 3, light: 0.8 });
  const ferns = makeFoliage({ points: under, size: [1.4, 2.6], colors: ["#14401a", "#4a8a3a"], seed: 4, light: 0.9 });
  scene.add(leaves.mesh, ferns.mesh);
  disposers.push(leaves.dispose, ferns.dispose);
  const shafts = [[-6, -10], [3, -6], [9, -16], [-12, -22]].map(([x, z], i) => {
    const sh = makeShaft({ from: [x + 4, 26, z - 3], to: [x, 0, z], r0: 0.6, r1: 2.6 + i * 0.4, color: "#fff0c0", intensity: 0.22, noise: 0.6 });
    scene.add(sh.mesh);
    disposers.push(sh.dispose);
    return sh;
  });
  const mist = makeCloudLayer({ size: 160, y: 1.0, color: "#c8e0c0", shadow: "#4a6a4a", density: 0.5, scale: 0.04, speed: [0.6, 0, 0.3], intensity: 0.55 });
  scene.add(mist.mesh);
  disposers.push(mist.dispose);
  const pollen = makeParticles({ count: P(900), shape: "box", center: [0, 4, -8], extent: [16, 4, 14], velocity: [0.1, 0.05, 0], spread: [0.1, 0.1, 0.1], life: 12, size: [0.02, 0.05], colors: ["#fff8d0", "#e8ffb0", "#ffd0f0"], intensity: 1.6, turbulence: 0.5, seed: 5 });
  scene.add(pollen.points);
  disposers.push(pollen.dispose);
  const MEW_AT: Vec3 = [1, 3.1, -6];
  const mewGlow = makeGlow({ pos: MEW_AT, size: 2.6, color: "#ffa8e0", intensity: 0 });
  scene.add(mewGlow.sprite);
  disposers.push(mewGlow.dispose);
  const sparkle = makeParticles({ count: P(300), shape: "sphere", center: MEW_AT, extent: [0.9, 0.9, 0.9], velocity: [0, 0.2, 0], spread: [0.2, 0.2, 0.2], life: 2.4, size: [0.02, 0.05], colors: ["#ffffff", "#ffc8f0", "#ff8ad8"], intensity: 2.2, swirl: 0.8, seed: 6 });
  scene.add(sparkle.points);
  disposers.push(sparkle.dispose);

  // ---- The laboratory.
  const lab = new THREE.Group();
  lab.position.set(...LAB);
  scene.add(lab);
  const wallMat = stoneMaterial({ color: "#7a808c", roughness: 0.7, dirt: 0.5 });
  wallMat.side = THREE.BackSide;
  const room = new THREE.Mesh(new THREE.BoxGeometry(26, 8, 22), wallMat);
  room.position.set(0, 3.6, -2);
  lab.add(room);
  const metal = new THREE.MeshStandardMaterial({ color: col("#5a5e66"), metalness: 0.8, roughness: 0.35 });
  const deskGeo = merge([
    placed(new THREE.BoxGeometry(5, 0.12, 1.6), [-4, 0.95, -1]),
    placed(new THREE.BoxGeometry(0.1, 0.95, 1.4), [-6.3, 0.47, -1]),
    placed(new THREE.BoxGeometry(0.1, 0.95, 1.4), [-1.7, 0.47, -1]),
    placed(new THREE.BoxGeometry(6, 0.12, 1.4), [5, 0.95, -4]),
    placed(new THREE.CylinderGeometry(2.2, 2.4, 0.6, 32), [0, 0.3, -6]),
    placed(new THREE.CylinderGeometry(2.0, 2.2, 0.5, 32), [0, 5.75, -6]),
    placed(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), [-3, 3, -8.5], 0, [1, 1, 1], 0.3),
    placed(new THREE.CylinderGeometry(0.1, 0.1, 6, 8), [3.2, 3, -8.2], 0, [1, 1, 1], -0.25),
  ]);
  const desk = new THREE.Mesh(deskGeo, metal);
  lab.add(desk);
  disposers.push(() => { room.geometry.dispose(); wallMat.dispose(); deskGeo.dispose(); metal.dispose(); });
  // The tank: glass with a green glow.
  const tankU = { uTime: { value: 0 }, uGlow: { value: 1 }, uCrack: { value: 0 } };
  const tankMat = new THREE.ShaderMaterial({
    uniforms: tankU,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uGlow, uCrack; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float bub = step(0.985, fract(sin(dot(floor(vec2(atan(vP.z, vP.x) * 8.0, vP.y * 6.0 - uTime * 2.0)), vec2(12.9898, 78.233))) * 43758.5453));
        vec3 liquid = vec3(0.15, 0.9, 0.5) * (0.25 + 0.2 * sin(vP.y * 3.0 - uTime * 1.5));
        vec3 c = liquid * uGlow + vec3(0.7, 1.0, 0.9) * pow(f, 3.0) * 0.8 + vec3(0.6, 1.0, 0.8) * bub * uGlow;
        float crack = uCrack * step(0.6, fract(sin(dot(floor(vP.xy * vec2(6.0, 3.0)), vec2(7.1, 31.7))) * 9137.0));
        float a = (0.28 + 0.5 * pow(f, 2.0)) * (1.0 - crack);
        gl_FragColor = vec4(c, a);
      }`,
  });
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 5, 40, 1, true), tankMat);
  tank.position.set(0, 3.1, -6);
  lab.add(tank);
  disposers.push(() => { tank.geometry.dispose(); tankMat.dispose(); });
  const tankLight = new THREE.PointLight(col("#5aff9a"), 8, 16, 1.4);
  tankLight.position.set(LAB[0], 3, LAB[2] - 4);
  scene.add(tankLight);
  const bubbles = makeParticles({ count: P(300), shape: "cylinder", center: [LAB[0], 3, LAB[2] - 6], extent: [1.6, 2.4, 1.6], velocity: [0, 0.8, 0], spread: [0.1, 0.2, 0.1], life: 3, size: [0.02, 0.06], colors: ["#e0fff0", "#9affc8", "#5affa0"], intensity: 1.6, seed: 7 });
  scene.add(bubbles.points);
  disposers.push(bubbles.dispose);
  const shards = makeParticles({ count: P(1600), shape: "cylinder", center: [LAB[0], 3, LAB[2] - 6], extent: [1.9, 2.4, 1.9], velocity: [0, 1, 0], spread: [7, 4, 7], gravity: [0, -9.8, 0], life: 2.2, size: [0.03, 0.1], colors: ["#ffffff", "#c8ffe8", "#8affc8"], intensity: 2, burst: true, fadeOut: 0.4, seed: 8 });
  const psychic = makeParticles({ count: P(1200), shape: "sphere", center: [LAB[0], 3, LAB[2] - 6], extent: [3.2, 3.2, 3.2], velocity: [0, 0.3, 0], spread: [0.3, 0.3, 0.3], life: 2.6, size: [0.04, 0.12], colors: ["#ffffff", "#d08aff", "#7a3aff"], intensity: 2, swirl: 1.4, turbulence: 0.6, seed: 9 });
  [shards, psychic].forEach((p) => { scene.add(p.points); disposers.push(p.dispose); });
  // Monitors: waveforms and readouts, flickering.
  const monitor = (seed: number) => makeCanvasPanel({
    w: 1.6, h: 1.0, px: [320, 200], emissive: 1.4,
    draw(g, w, h, t) {
      const rr = rng(seed * 997 + Math.floor(t * 5));
      const alarm = t > 1000;
      g.fillStyle = alarm ? "#1a0404" : "#02100a";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = alarm ? "#ff4a3a" : "#5affa0";
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = h * 0.5 + Math.sin(x * 0.05 + t * 4 + seed) * h * 0.18 * (alarm ? 2 : 1) + (rr() - 0.5) * (alarm ? 30 : 6);
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = alarm ? "rgba(255,90,70,0.85)" : "rgba(90,255,160,0.7)";
      for (let i = 0; i < 6; i++) g.fillRect(12, 14 + i * 12, 30 + rr() * 90, 5);
      g.fillStyle = "rgba(0,0,0,0.25)";
      for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    },
  });
  const MON: [Vec3, number][] = [[[-5.2, 1.6, -1.6], 0.2], [[-3.4, 1.6, -1.7], 0], [[4, 1.6, -4.6], -0.1], [[5.8, 1.6, -4.5], -0.2], [[-8, 2.6, -9.6], 0.3], [[7.6, 2.6, -9.6], -0.3]];
  const monitors = MON.map(([p, ry], i) => {
    const m = monitor(i + 1);
    m.mesh.position.set(...p);
    m.mesh.rotation.y = ry;
    lab.add(m.mesh);
    disposers.push(m.dispose);
    return m;
  });
  // The journal pages, in the game's words.
  const lines = (id: string) => (ctx.chapter.beats.find((b) => b.id === id)?.quote ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const pages = ["jungle", "mew", "birth", "powerful"].map((id, i) => {
    const pg = makePage({ lines: lines(id), font, w: 0.9 });
    pg.mesh.position.set(-5.6 + i * 1.05, 1.02, -0.9 + (i % 2) * 0.12);
    pg.mesh.rotation.set(-Math.PI / 2, 0, (i - 1.5) * 0.12);
    lab.add(pg.mesh);
    disposers.push(pg.dispose);
    return pg;
  });
  const lamp = new THREE.PointLight(col("#ffd8a0"), 4, 8, 1.4);
  lamp.position.set(LAB[0] - 4, 2.6, LAB[2] - 0.6);
  scene.add(lamp);
  // Fluorescent strips on the ceiling (they flicker once things go wrong).
  const stripMat = new THREE.MeshBasicMaterial({ color: col("#d8ecff", 1.6), toneMapped: false });
  const stripGeo = merge([-8, -2, 4].map((z) => placed(new THREE.BoxGeometry(9, 0.08, 0.35), [0, 7.5, z])));
  const strips = new THREE.Mesh(stripGeo, stripMat);
  lab.add(strips);
  const ceil = [new THREE.PointLight(col("#bcd8ff"), 0, 40, 1.0), new THREE.PointLight(col("#bcd8ff"), 0, 40, 1.0)];
  ceil[0].position.set(LAB[0] - 6, 7, LAB[2] - 3);
  ceil[1].position.set(LAB[0] + 6, 7, LAB[2] - 3);
  scene.add(...ceil);
  disposers.push(() => { stripGeo.dispose(); stripMat.dispose(); });
  const alarm = new THREE.PointLight(col("#ff2a2a"), 0, 30, 1.2);
  alarm.position.set(LAB[0], 7, LAB[2] - 2);
  scene.add(alarm);

  // ---- Light.
  const L = lights(scene, { sky: "#c8ffd8", ground: "#1a2a14", fill: 0.6, key: "#fff0c8", keyK: 1.6, keyPos: [10, 30, -10], rim: "#8ab0ff", rimK: 0.4, rimPos: [-10, 10, 20] });

  // ---- Figures.
  const figs = await loadFigures(ctx, [MEW, MEWTWO]);
  const mew = figs.get(MEW), two = figs.get(MEWTWO);
  place(mew, MEW_AT, 1.1, -0.2, scene);
  figureStyle(mew, { rim: "#ffd0f0", rimK: 1.4, glow: "#ff9ad8", glowK: 0.08, edge: "#ffffff", dissolve: 0 });
  const TWO: Vec3 = [LAB[0], 0.7, LAB[2] - 6];
  place(two, TWO, 3.4, 0, scene);
  figureStyle(two, { rim: "#d0a8ff", rimK: 1.6, glow: "#8a4aff", glowK: 0.06, edge: "#e8d0ff", shadow: 0.7 });

  const keys: Key[] = [
    { t: 0, pos: [0, 3, 24], look: [0, 4.5, -10], fov: 46 },
    { t: tJungle, pos: [2.5, 2.6, 13], look: [0.5, 3.6, -8], fov: 44 },
    { t: tMew - 0.5, pos: [1.8, 3, 2.5], look: [1, 3.2, -6], fov: 40 },
    { t: tMew + 1, pos: [1.6, 3.2, -1.2], look: [1, 3.2, -6], fov: 38 },
    { t: cutLab, pos: [-1.2, 3.6, -2], look: [1, 3.3, -6], fov: 38 },
    { t: cutLab + 0.01, pos: [LAB[0] + 4.5, 2.6, LAB[2] + 6.5], look: [LAB[0], 2.6, LAB[2] - 6], fov: 42 },
    { t: tBirth + 2.4, pos: [LAB[0] - 3, 1.9, LAB[2] + 1.2], look: [LAB[0] - 4.2, 0.95, LAB[2] - 1.2], fov: 38 },
    { t: tPower - 0.4, pos: [LAB[0] - 1.2, 1.9, LAB[2] + 1.6], look: [LAB[0] - 2.8, 1.0, LAB[2] - 1.1], fov: 38 },
    { t: tPower + 0.4, pos: [LAB[0] + 2, 2.3, LAB[2] + 3.4], look: [LAB[0], 2.7, LAB[2] - 6], fov: 40 },
    { t: tBreak + 2.6, pos: [LAB[0], 2.1, LAB[2] + 7.4], look: [LAB[0], 2.7, LAB[2] - 6], fov: 46 },
    { t: tCreated, pos: [LAB[0] - 3.4, 3, LAB[2] + 10], look: [LAB[0], 2.5, LAB[2] - 5], fov: 46 },
    { t: end, pos: [LAB[0] + 3.2, 4, LAB[2] + 14], look: [LAB[0], 2.6, LAB[2] - 5], fov: 50 },
  ];

  return {
    scene,
    portalScale: 1.4,
    camera: (t) => shake(poseOnPath(keys, t), t, [{ at: tBreak, k: 0.08, dur: 2.4 }]),
    orbit: (t) => ({ target: t < cutLab ? [1, 3.2, -6] : [LAB[0], 2.6, LAB[2] - 6], limits: { yaw0: 0, yawSpan: 1.0, minPitch: -0.2, maxPitch: 0.9, minDist: 1.5, maxDist: 30 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const inLab = t >= cutLab;
      const broken = t >= tBreak;
      const rage = ramp(t, tPower - 0.3, tBreak) * (1 - ramp(t, tCreated, end) * 0.6);
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      fog.color.copy(inLab ? col("#0a0c10") : col("#4a6a50"));
      fog.density = inLab ? 0.016 : 0.035;
      leaves.u.uTime.value = ambient;
      ferns.u.uTime.value = ambient;
      mist.u.uTime.value = ambient;
      shafts.forEach((sh, i) => { sh.u.uTime.value = ambient + i; sh.u.uOpacity.value = inLab ? 0 : 1; });
      for (const p of [pollen, sparkle, bubbles, shards, psychic]) { p.u.uTime.value = ambient; p.u.uPixel.value = px; }
      pollen.u.uOpacity.value = inLab ? 0 : 1;
      // Mew among the trees.
      const seen = ramp(t, tJungle + 2, tMew + 0.6);
      const mx = MEW_AT[0] + Math.sin(ambient * 0.7) * 0.25, my = MEW_AT[1] + Math.sin(ambient * 1.3) * 0.15;
      if (mew) { floatFigure(mew, [mx, my, MEW_AT[2]], ambient, 0, 0, -0.2 + Math.sin(ambient * 0.5) * 0.2, 0); figureStyle(mew, { dissolve: inLab ? 0 : ramp(t, tMew - 0.8, tMew + 0.4) }); }
      mewGlow.sprite.position.set(mx, my + 0.5, MEW_AT[2]);
      mewGlow.set("#ffa8e0", inLab ? 0 : seen * 0.35);
      sparkle.u.uCenter.value.set(mx, my + 0.5, MEW_AT[2]);
      sparkle.u.uOpacity.value = inLab ? 0 : seen;
      // The lab: the tank, Mewtwo, the monitors, the pages.
      tankU.uTime.value = ambient;
      tankU.uGlow.value = 1 + rage * 0.6;
      tankU.uCrack.value = ramp(t, tBreak - 0.6, tBreak);
      tank.visible = inLab && !broken;
      bubbles.u.uOpacity.value = inLab && !broken ? 1 : 0;
      shards.u.uTime.value = Math.max(0, t - tBreak);
      shards.u.uOpacity.value = broken && t < tBreak + 2.4 ? 1 : 0;
      psychic.u.uOpacity.value = inLab ? ramp(t, tPower, tBreak) : 0;
      tankLight.intensity = inLab ? (broken ? 2 : 8 + rage * 6) : 0;
      if (two) {
        floatFigure(two, [TWO[0], TWO[1] + (broken ? ramp(t, tBreak, tBreak + 2) * 0.6 : 0), TWO[2]], ambient, broken ? 0.06 : 0.02, 0, 0, 0.02);
        figureStyle(two, { dissolve: inLab ? 1 : 0, shadow: broken ? 0.05 : 0.7 - rage * 0.3, glowK: 0.06 + rage * 0.2 + 0.3 * spike(t, tBreak, 0.1, 1.2) });
      }
      const alarmOn = t > tPower + 0.2;
      monitors.forEach((m, i) => {
        if (Math.floor(ambient * 5) !== Math.floor((ambient - 0.017) * 5) || i === 0) m.redraw(alarmOn ? 1000 + ambient : ambient);
        const flick = 0.75 + 0.25 * Math.sin(ambient * 30 + i * 7) * Math.sin(ambient * 7.3 + i);
        (m.mat as THREE.MeshBasicMaterial).color.copy(col("#ffffff", (broken ? 0.9 + 0.5 * Math.max(0, Math.sin(ambient * 13 + i * 3)) : 1.4) * flick));
      });
      alarm.intensity = alarmOn ? 6 * Math.max(0, Math.sin(ambient * 6)) : 0;
      const buzz = broken ? (Math.sin(ambient * 37) * Math.sin(ambient * 11.3) > 0.2 ? 0.25 : 1) : 1;
      strips.visible = inLab;
      stripMat.color.copy(col("#d8ecff", 1.6 * buzz));
      ceil.forEach((c) => (c.intensity = inLab ? 40 * buzz : 0));
      pages.forEach((pg, i) => { pg.mesh.visible = inLab; (pg.mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + 0.25 * ramp(t, [tJungle, tMew, tBirth, tPower][i], [tJungle, tMew, tBirth, tPower][i] + 1); });
      lamp.intensity = inLab ? 6 * (0.9 + 0.1 * Math.sin(ambient * 17)) : 0;
      // Light.
      L.key.intensity = inLab ? 0.25 : 1.6;
      L.hemi.intensity = inLab ? 0.35 : 0.6;
      L.hemi.color.copy(inLab ? col("#8ab0ff") : col("#c8ffd8"));
    },
    look(t) {
      const inLab = t >= cutLab;
      const L0: Look = lookAt(
        t,
        { bloom: 0.8, bloomRadius: 0.6 },
        {
          exposure: [[0, 1.0], [cutLab, 1.0], [cutLab + 0.1, 1.05], [end, 1.0]],
          fade: [[cutLab - 0.45, 0], [cutLab - 0.08, 1], [cutLab + 0.12, 1], [cutLab + 0.7, 0]],
          gain: [[0, [1.0, 1.04, 0.92]], [cutLab, [1.0, 1.04, 0.92]], [cutLab + 0.1, [0.92, 1.04, 1.02]], [tPower, [0.96, 0.96, 1.08]], [tBreak, [1.04, 0.92, 1.1]], [tCreated, [1.0, 0.94, 1.08]]],
          saturation: [[0, 1.1], [cutLab + 0.1, 0.95], [tBreak, 1.1], [end, 0.95]],
          contrast: [[0, 1.04], [cutLab + 0.1, 1.12], [end, 1.1]],
          chroma: [[tPower, 0.05], [tBreak - 0.05, 0.2], [tBreak + 0.1, 0.7], [tBreak + 1.6, 0.25], [end, 0.15]],
          vignette: [[0, 0.38], [cutLab + 0.1, 0.55], [end, 0.6]],
          bloom: [[0, 0.8], [cutLab + 0.1, 0.9], [tBreak, 1.05], [end, 0.9]],
        }
      );
      L0.flash = 0.25 * spike(t, tBreak, 0.04, 0.3);
      if (!inLab) L0.rays = { pos: [40, 70, -90], color: [1.0, 0.95, 0.75], strength: 0.45 };
      else if (t > tPower) L0.rays = { pos: [LAB[0], 2.6, LAB[2] - 6], color: [0.8, 0.6, 1.0], strength: 0.4 * ramp(t, tPower, tBreak) };
      return L0;
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};
