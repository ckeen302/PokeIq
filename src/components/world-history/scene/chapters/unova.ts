import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeBeam, makeCloudLayer, makeFlames, makeGlow, makeLightning, makeParticles, makeRing, makeSky, makeTerrain, noise2, ramp, rng, strikeAt } from "../kit";
import { makeCrystals, makeRobed } from "../props";
import type { ChapterBuilder, Look } from "../types";
import { hitCurve } from "../figures";
import { cine, craft, figureStyle, floatFigure, lights, loadFigures, lookAt, place, pointPixel, shake, spike } from "./common";

/**
 * VI. Truth and Ideals. A new land rising out of the mist under one
 * dragon, a shadow rimmed in both white fire and blue lightning, with two
 * brothers beneath it. The brothers argue; the light divides; the dragon
 * tears in two (slow motion), Reshiram and Zekrom. The twins end it. Their
 * sons start it again, and the land burns with fire and lightning. Last,
 * an ice field and the speculation: a third dragon, a husk left over.
 */

const RESHIRAM = 643, ZEKROM = 644, KYUREM = 646;
const ICE: Vec3 = [520, 0, 0];

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tOne = B("one"), tBro = B("brothers"), tSplit = B("split"), tCeased = B("ceased"), tSons = B("sons"), tHusk = B("husk");
  const end = ctx.timing.anim;
  const tTear = tSplit + 1.5;
  const cutIce = tHusk - 0.4;
  const scene = new THREE.Scene();
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));
  const nz = noise2(73);
  const r = rng(5);

  // ---- Sky and air.
  const sky = makeSky({ top: "#0c1230", horizon: "#a0605a", bottom: "#0a0a14", nebulaA: "#6a7ac0", nebulaB: "#c08a6a", nebula: 0.3, nebulaScale: 1.3, stars: 0.03, sunDir: [-0.85, 0.05, -0.5], sunColor: "#e09060", sunSize: 500, sunGlow: 0.25 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  const fog = new THREE.FogExp2(col("#2a2438"), 0.0055);
  scene.fog = fog;
  const mist = makeCloudLayer({ size: 600, y: 1.5, color: "#a898b8", shadow: "#3a3050", density: 0.6, scale: 0.012, speed: [1, 0, 0.4], intensity: 0.45 });
  scene.add(mist.mesh);
  disposers.push(mist.dispose);
  const smokeSky = makeCloudLayer({ size: 800, y: 60, color: "#4a2a24", shadow: "#0a0606", density: 0.7, scale: 0.008, speed: [3, 0, 1], intensity: 0.9 });
  scene.add(smokeSky.mesh);
  disposers.push(smokeSky.dispose);

  // ---- The new land: a plateau among hills.
  const hills = (x: number, z: number) => {
    const plateau = Math.exp(-((x * x) / 240 + ((z - 2) * (z - 2)) / 160));
    return nz.fbm(x * 0.02 + 1, z * 0.02) * 16 - 7 + Math.pow(Math.abs(x) / 90, 2) * 12 + plateau * 7 * (1 - Math.exp(-(x * x + z * z) / 60) * 0.0);
  };
  const H0 = hills(0, 4);
  const gh = (x: number, z: number) => hills(x, z) - H0;
  const land = makeTerrain({
    size: [360, 300], segments: Math.round(q.grid * 0.7), height: (x, z) => gh(x, z - 60),
    color: (h, slope) => (slope > 0.45 ? [0.24, 0.22, 0.2] : h > -2 ? [0.2, 0.3, 0.14] : [0.16, 0.24, 0.12]),
    lava: { color: "#ff6a1a", scale: 0.06, width: 0.05, intensity: 0 },
    center: [0, 0, -60], roughness: 0.92,
  });
  scene.add(land.mesh);
  disposers.push(land.dispose);

  // ---- The twin heroes (later, their sons).
  const heroes = [makeRobed({ height: 1.85, color: "#e8e2d8", emissive: "#ffd8a0", emissiveK: 0 }), makeRobed({ height: 1.8, color: "#2a2c3a", emissive: "#6aa8ff", emissiveK: 0 })];
  const HERO: Vec3[] = [[-1.6, gh(-1.6, 4), 4], [1.6, gh(1.6, 4), 4]];
  heroes.forEach((h, i) => { h.mesh.position.set(...HERO[i]); h.mesh.rotation.y = i ? -0.9 : 0.9; scene.add(h.mesh); disposers.push(h.dispose); });
  const sons = [makeRobed({ height: 1.75, color: "#c8b8a8", emissive: "#ff8a40", emissiveK: 0.2 }), makeRobed({ height: 1.75, color: "#1a1c2a", emissive: "#4a8aff", emissiveK: 0.2 })];
  const SON: Vec3[] = [[-6, gh(-6, 10), 10], [6, gh(6, 10), 10]];
  sons.forEach((h, i) => { h.mesh.position.set(...SON[i]); h.mesh.rotation.y = i ? -0.7 : 0.7; scene.add(h.mesh); disposers.push(h.dispose); });

  // ---- Truth and ideals: warm and cold light on either side.
  const warm = makeGlow({ pos: [-60, 20, -80], size: 70, color: "#ffb070", intensity: 0 });
  const cold = makeGlow({ pos: [60, 20, -80], size: 70, color: "#4a8aff", intensity: 0 });
  [warm, cold].forEach((g) => { scene.add(g.sprite); disposers.push(g.dispose); });
  const warmLight = new THREE.PointLight(col("#ffb070"), 0, 60, 1);
  warmLight.position.set(-10, 6, 0);
  const coldLight = new THREE.PointLight(col("#5a9aff"), 0, 60, 1);
  coldLight.position.set(10, 6, 0);
  scene.add(warmLight, coldLight);

  // ---- The tearing: fire to one side, lightning to the other.
  const DRAGON: Vec3 = [0, gh(0, -14) + 4, -14];
  const RES_TO: Vec3 = [-13, gh(-13, -12) + 3, -12], ZEK_TO: Vec3 = [13, gh(13, -12) + 3, -12];
  const tearRing = makeRing({ color: "#ffffff", intensity: 1.6, thickness: 0.04 });
  tearRing.mesh.position.set(DRAGON[0], DRAGON[1] + 7, DRAGON[2]);
  tearRing.mesh.scale.setScalar(40);
  scene.add(tearRing.mesh);
  disposers.push(tearRing.dispose);
  const whiteFire = makeParticles({ count: P(1800), shape: "sphere", center: RES_TO, extent: [5, 6, 3], velocity: [0, 3, 0], spread: [1.5, 1.5, 1.5], life: 1.8, size: [0.15, 0.5], colors: ["#ffffff", "#ffd090", "#ff6a20"], intensity: 1.2, turbulence: 1.2, flicker: 0.3, seed: 2 });
  const sparks = makeParticles({ count: P(1400), shape: "sphere", center: ZEK_TO, extent: [5, 6, 3], velocity: [0, 0, 0], spread: [4, 4, 4], life: 0.6, size: [0.05, 0.16], colors: ["#ffffff", "#9ad0ff", "#3a6aff"], intensity: 1.4, flicker: 0.8, seed: 3 });
  [whiteFire, sparks].forEach((p) => { scene.add(p.points); disposers.push(p.dispose); });
  const zbolts = [makeLightning({ color: "#8ac0ff", width: 0.22, intensity: 6, branches: 3 }), makeLightning({ color: "#b8d8ff", width: 0.18, intensity: 5, branches: 2 })];
  zbolts.forEach((b) => { scene.add(b.mesh); disposers.push(b.dispose); });
  const lastZ = [-1, -1];

  // ---- The sons' war: the land burns.
  const firePts: Vec3[] = [];
  for (let i = 0; i < 90; i++) {
    const x = -8 - r() * 120, z = 10 - r() * 160;
    firePts.push([x, gh(x, z) + 0.1, z]);
  }
  const fires = makeFlames({ points: firePts, size: [2, 5.5], intensity: 2.4, seed: 7 });
  scene.add(fires.mesh);
  disposers.push(fires.dispose);
  const breath = makeBeam({ from: [RES_TO[0] + 1, RES_TO[1] + 8, RES_TO[2] + 1], to: [-30, gh(-30, -50), -50], radius: 1.2, color: "#ffc070", intensity: 3 });
  scene.add(breath.mesh);
  disposers.push(breath.dispose);
  const storms = [makeLightning({ color: "#a8c8ff", width: 0.7, intensity: 7, branches: 5 }), makeLightning({ color: "#d0e0ff", width: 0.55, intensity: 6, branches: 4 })];
  storms.forEach((b) => { scene.add(b.mesh); disposers.push(b.dispose); });
  const lastS = [-1, -1];
  const embers = makeParticles({ count: P(2200), shape: "box", center: [-40, 10, -50], extent: [60, 10, 60], velocity: [2, 3, 0], spread: [1, 1, 1], life: 5, size: [0.1, 0.3], colors: ["#ffe6a0", "#ff8a30", "#ff3a10"], intensity: 1.6, turbulence: 1.4, flicker: 0.6, seed: 8 });
  const blast = makeParticles({ count: P(1600), shape: "sphere", center: [-30, gh(-30, -50) + 2, -50], extent: [3, 2, 3], velocity: [0, 10, 0], spread: [12, 8, 12], gravity: [0, -6, 0], life: 2.2, size: [0.3, 1], colors: ["#fff0c0", "#ff8a30", "#5a2010"], intensity: 2.2, seed: 9 });
  [embers, blast].forEach((p) => { scene.add(p.points); disposers.push(p.dispose); });

  // ---- The ice field.
  const iceLand = makeTerrain({
    size: [220, 200], segments: Math.round(q.grid * 0.45),
    height: (x, z) => nz.fbm(x * 0.03 + 6, z * 0.03) * 8 - 3 + Math.max(0, -z - 20) * 0.35,
    color: (h, slope) => (slope > 0.5 ? [0.42, 0.5, 0.6] : [0.72, 0.8, 0.9]),
    center: [ICE[0], -1, ICE[2] - 30], roughness: 0.5,
  });
  scene.add(iceLand.mesh);
  disposers.push(iceLand.dispose);
  const spots: { pos: Vec3; h: number; r?: number }[] = [];
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2, d = 7 + r() * 40;
    spots.push({ pos: [ICE[0] + Math.cos(a) * d, -1.2, ICE[2] - 10 + Math.sin(a) * d * 0.6], h: 1.5 + r() * 6 * (d < 20 ? 1 : 0.6) });
  }
  const crystals = makeCrystals({ spots, colors: ["#1a3a5a", "#bfe8ff"], glow: 0.9, seed: 4 });
  scene.add(crystals.mesh);
  disposers.push(crystals.dispose);
  const snow = makeParticles({ count: P(2400), shape: "box", center: [ICE[0], 7, ICE[2]], extent: [30, 9, 26], velocity: [1.6, -1.4, 0.4], spread: [0.4, 0.3, 0.4], life: 8, size: [0.03, 0.09], colors: ["#ffffff", "#dfeaff", "#b8ccff"], intensity: 1.3, turbulence: 0.8, seed: 10 });
  scene.add(snow.points);
  disposers.push(snow.dispose);
  const frost = makeGlow({ pos: [ICE[0], 6, ICE[2] - 12], size: 26, color: "#8ad0ff", intensity: 0 });
  scene.add(frost.sprite);
  disposers.push(frost.dispose);

  // ---- Light.
  const L = lights(scene, { sky: "#b8a8d8", ground: "#2a2018", fill: 0.6, key: "#ffe0c0", keyK: 1.6, keyPos: [-10, 30, 40], rim: "#8ab8ff", rimK: 0.8, rimPos: [20, 20, -60] });

  // ---- Figures.
  const figs = await loadFigures(ctx, [RESHIRAM, ZEKROM, KYUREM]);
  const res = figs.get(RESHIRAM), zek = figs.get(ZEKROM), kyu = figs.get(KYUREM);
  place(res, DRAGON, 13, 0, scene);
  place(zek, [DRAGON[0], DRAGON[1], DRAGON[2] - 0.6], 13, 0, scene);
  figureStyle(res, { rim: "#fff2d8", rimK: 1.2, glow: "#ffd8a0", glowK: 0.03, edge: "#ffffff" });
  figureStyle(zek, { rim: "#7ab8ff", rimK: 1.2, glow: "#4a8aff", glowK: 0.03, edge: "#9ad0ff" });
  const KY: Vec3 = [ICE[0], -0.5, ICE[2] - 12];
  place(kyu, KY, 9, 0, scene);
  figureStyle(kyu, { rim: "#bfe8ff", rimK: 1.8, glow: "#6ab8ff", glowK: 0.06, edge: "#e0f4ff", dissolve: 0, shadow: 0.35 });
  const sh = craft(ctx, L, {
    radius: 30, center: DRAGON,
    receive: [land.mesh, iceLand.mesh],
    figures: [[res, { ground: DRAGON[1] - 4, alive: 0.9, depth: 1.5 }], [zek, { ground: DRAGON[1] - 4, alive: 0.9, depth: 1.5 }], [kyu, { ground: KY[1], alive: 0.4, depth: 1.4 }]],
    detail: [[land.mesh.material, { kind: "ground", scale: 0.7, bump: 1.3 }], [iceLand.mesh.material, { kind: "stone", scale: 0.9, bump: 0.6, rough: 0.4 }]],
  });

  const keys: Key[] = [
    { t: 0, pos: [0, 30, 92], look: [0, 6, -20], fov: 50 },
    { t: tOne, pos: [10, 11, 46], look: [0, 8, -14], fov: 46 },
    { t: tBro - 1.4, pos: [1, 4.5, 24], look: [0, 6, -12], fov: 44 },
    { t: tBro, pos: [0, 2.2, 12.5], look: [0, 1.8, 3.5], fov: 40 },
    { t: tSplit - 1.6, pos: [-3, 2.6, 10.5], look: [0, 4, -8], fov: 42 },
    { t: tSplit, pos: [0, 4, 27], look: [0, 8, -13], fov: 50 },
    { t: tTear + 1.9, pos: [0, 5, 35], look: [0, 7, -12], fov: 54 },
    { t: tCeased, pos: [0, 3, 23], look: [0, 5, -9], fov: 50 },
    { t: tSons - 0.8, pos: [0, 6.5, 31], look: [0, 6, -10], fov: 50 },
    { t: tSons, pos: [0, 15, 54], look: [0, 4, -12], fov: 54 },
    { t: tSons + 4, pos: [-15, 6.5, 31], look: [-4, 6, -14], fov: 50 },
    { t: cutIce, pos: [-18, 7, 32], look: [-2, 6, -14], fov: 50 },
    { t: cutIce + 0.01, pos: [ICE[0] - 2, 3, ICE[2] + 22], look: [ICE[0], 5, ICE[2] - 10], fov: 46 },
    { t: end, pos: [ICE[0] + 4, 2.4, ICE[2] + 15], look: [ICE[0], 4.6, ICE[2] - 12], fov: 42 },
  ];

  const sonsK = (t: number) => ramp(t, tSons - 0.3, tSons + 1.5);
  const V0 = new THREE.Vector3(), V1 = new THREE.Vector3();

  return {
    scene,
    portalScale: 4,
    camera: (t) => shake(poseOnPath(keys, t), t, [{ at: tTear, k: 0.18, dur: 2.2 }, { at: tSons + 0.5, k: 0.12, dur: 3 }, { at: tSons + 3.5, k: 0.1, dur: 2 }]),
    orbit: (t) => ({ target: t < cutIce ? [0, 5, -10] : [ICE[0], 4, ICE[2] - 12], limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.15, maxPitch: 1.0, minDist: 3, maxDist: 160 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const ice = t >= cutIce;
      const rise = ramp(t, 0, tOne + 4);
      const argue = ramp(t, tBro + 0.5, tSplit) * (1 - ramp(t, tCeased, tCeased + 2.5));
      const tear = ramp(t, tTear - 0.2, tTear + 2.4);
      const sk = sonsK(t);
      // Sky.
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      if (ice) {
        sky.u.uTop.value.copy(col("#0a1630")); sky.u.uHorizon.value.copy(col("#5a7aa0")); sky.u.uBottom.value.copy(col("#0a1220"));
        sky.u.uSunGlow.value = 0; sky.u.uSunColor.value.copy(col("#000000")); sky.u.uNeb.value = 0.2; sky.u.uStars.value = 0.03;
        fog.color.copy(col("#8aa8c8")); fog.density = 0.02;
      } else {
        const war = sk;
        sky.u.uTop.value.copy(col("#0c1230").lerp(col("#080404"), war));
        sky.u.uHorizon.value.copy(col("#a0605a").lerp(col("#7a2a10"), war));
        sky.u.uBottom.value.copy(col("#0a0a14"));
        sky.u.uSunGlow.value = 0.25 * (1 - war);
        sky.u.uSunColor.value.copy(col("#e09060", 0.8 * (1 - war)));
        sky.u.uNeb.value = 0.3 * (1 - war);
        sky.u.uStars.value = 0.03 * (1 - war);
        fog.color.copy(col("#2a2438").lerp(col("#2a120c"), war));
        fog.density = 0.0055 - rise * 0.002 + war * 0.003;
      }
      mist.u.uTime.value = ambient;
      mist.u.uOpacity.value = ice ? 0 : 1 - rise * 0.75;
      smokeSky.u.uTime.value = ambient;
      smokeSky.u.uOpacity.value = ice ? 0 : sk;
      // The land rises out of the mist.
      land.mesh.position.y = -6 * (1 - rise);
      land.u.uTime.value = ambient;
      land.u.uLavaK.value = 2.2 * sk;
      // The heroes, then their sons.
      heroes.forEach((h, i) => {
        h.mesh.visible = !ice && t < tSons - 0.2;
        h.mesh.position.y = HERO[i][1] - 6 * (1 - rise);
        (h.mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.06 + argue * 0.25;
      });
      sons.forEach((h) => { h.mesh.visible = !ice && t >= tSons - 0.2; });
      warm.set("#ffb070", ice ? 0 : 0.12 * argue + 0.06 * tear * (1 - sk) + sk * 0.08);
      cold.set("#4a8aff", ice ? 0 : 0.12 * argue + 0.06 * tear * (1 - sk) + sk * 0.08);
      warmLight.intensity = ice ? 0 : 3 * argue + 3 * sk;
      coldLight.intensity = ice ? 0 : 3 * argue + 3 * sk;
      // The one dragon: a shadow edged in both lights; then two.
      const sep = 1 - Math.pow(1 - tear, 3);
      if (res) {
        const p = V0.set(...DRAGON).lerp(V1.set(...RES_TO), sep);
        floatFigure(res, [p.x, p.y, p.z], ambient, 0.25, 0, 0.45 * sep, 0.04);
        // The split: both halves snap away from the seam and shudder, then the wings catch up.
        figureStyle(res, { dissolve: ice ? 0 : ramp(t, 0.5, tOne + 1.5), shadow: 0.85 * (1 - ramp(t, tTear, tTear + 1.8)), glowK: 0.03 + 0.15 * spike(t, tTear, 0.1, 1.2) + argue * 0.04, hit: hitCurve(t, tTear, 1.2), flex: 0.3 + 0.7 * spike(t, tTear, 0.1, 1.8) });
      }
      if (zek) {
        const p = V0.set(DRAGON[0], DRAGON[1], DRAGON[2] - 0.6).lerp(V1.set(...ZEK_TO), sep);
        floatFigure(zek, [p.x, p.y, p.z], ambient, 0.25, 1.3, -0.45 * sep, 0.04);
        figureStyle(zek, { dissolve: ice ? 0 : ramp(t, 0.5, tOne + 1.5), shadow: 0.85 * (1 - ramp(t, tTear, tTear + 1.8)), glowK: 0.03 + 0.15 * spike(t, tTear, 0.1, 1.2) + argue * 0.04, hit: hitCurve(t, tTear + 0.06, 1.2), flex: 0.3 + 0.7 * spike(t, tTear, 0.1, 1.8) });
      }
      sh.follow(ice ? KY : DRAGON, ice ? 12 : 30);
      tearRing.u.uK.value = ramp(t, tTear, tTear + 1.8);
      tearRing.u.uTime.value = ambient;
      tearRing.mesh.visible = !ice && t > tTear && t < tTear + 1.9;
      tearRing.mesh.quaternion.copy(cam.quaternion);
      const fight = ice ? 0 : Math.max(ramp(t, tTear, tTear + 1) * (1 - ramp(t, tCeased - 0.5, tCeased + 1)), sk);
      for (const p of [whiteFire, sparks, embers, blast, snow]) { p.u.uTime.value = ambient; p.u.uPixel.value = px; }
      whiteFire.u.uCenter.value.set(RES_TO[0], RES_TO[1] + 6, RES_TO[2] + 1);
      whiteFire.u.uOpacity.value = fight;
      sparks.u.uCenter.value.set(ZEK_TO[0], ZEK_TO[1] + 6, ZEK_TO[2] + 1);
      sparks.u.uOpacity.value = fight;
      [strikeAt(ambient, 0.7, 4), strikeAt(ambient + 0.3, 0.9, 6)].forEach((s, i) => {
        const b = zbolts[i];
        if (s.level > 0 && fight > 0.1 && s.id !== lastZ[i]) {
          lastZ[i] = s.id;
          const rr = rng(s.id * 7 + i + 3);
          b.strike([ZEK_TO[0] + (rr() - 0.5) * 6, ZEK_TO[1] + 6 + rr() * 6, ZEK_TO[2] + 1], [ZEK_TO[0] + (rr() - 0.5) * 12, ZEK_TO[1] + (rr() - 0.5) * 4, ZEK_TO[2] + 2], s.id * 3 + i, cam.position);
        }
        b.u.uAlpha.value = fight > 0.1 ? s.level * fight : 0;
      });
      // The war.
      fires.u.uTime.value = ambient;
      fires.u.uOpacity.value = ice ? 0 : ramp(t, tSons + 0.4, tSons + 3);
      breath.mesh.visible = !ice && sk > 0.01 && t < cutIce;
      breath.u.uTime.value = ambient;
      breath.u.uOpacity.value = sk * (0.6 + 0.4 * Math.sin(ambient * 6)) * (t > tSons + 0.3 ? 1 : 0);
      blast.u.uOpacity.value = ice ? 0 : ramp(t, tSons + 0.3, tSons + 0.8);
      embers.u.uOpacity.value = ice ? 0 : sk;
      [strikeAt(t, 0.9, 11), strikeAt(t + 0.4, 1.3, 13)].forEach((s, i) => {
        const b = storms[i];
        if (s.level > 0 && sk > 0.2 && s.id !== lastS[i]) {
          lastS[i] = s.id;
          const rr = rng(s.id * 11 + i + 9);
          const x = 10 + rr() * 90, z = -10 - rr() * 120;
          b.strike([x, 60, z], [x, gh(x, z), z], s.id * 5 + i, cam.position);
        }
        b.u.uAlpha.value = !ice && sk > 0.2 ? s.level : 0;
      });
      // The ice.
      crystals.u.uTime.value = ambient;
      crystals.mesh.visible = ice;
      iceLand.mesh.visible = ice;
      snow.u.uOpacity.value = ice ? 1 : 0;
      frost.set("#8ad0ff", ice ? 0.35 * ramp(t, cutIce + 1, cutIce + 3) : 0);
      if (kyu) {
        kyu.group.position.set(KY[0], KY[1] + Math.sin(ambient * 0.4) * 0.1, KY[2]);
        figureStyle(kyu, { dissolve: ice ? 0.15 + 0.6 * ramp(t, cutIce + 0.8, cutIce + 4.5) : 0, shadow: 0.45 });
      }
      // Light.
      if (ice) { L.key.color.copy(col("#c8e0ff")); L.key.intensity = 1.2; L.hemi.intensity = 0.7; L.key.position.set(ICE[0] - 20, 30, 30); }
      else { L.key.color.copy(col("#ffe0c0").lerp(col("#ff8a50"), sk)); L.key.intensity = 1.6 - argue * 0.6; L.hemi.intensity = 0.6 - argue * 0.25 - sk * 0.2; L.key.position.set(-10, 30, 40); }
    },
    look(t) {
      const ice = t >= cutIce;
      const L0: Look = lookAt(
        t,
        { bloom: 0.8, bloomRadius: 0.6 },
        {
          exposure: [[0, 0.95], [tOne, 1.0], [tTear, 1.02], [tSons, 0.95], [cutIce, 1.0], [end, 0.98]],
          fade: [[cutIce - 0.45, 0], [cutIce - 0.08, 1], [cutIce + 0.12, 1], [cutIce + 0.7, 0]],
          gain: [[0, [1.04, 0.98, 1.02]], [tBro, [1.02, 0.98, 1.02]], [tTear, [1.04, 1.0, 1.04]], [tSons, [1.14, 0.94, 0.86]], [cutIce, [1.14, 0.94, 0.86]], [cutIce + 0.1, [0.9, 1.0, 1.14]]],
          saturation: [[0, 1.08], [tSons, 1.15], [cutIce, 1.1], [cutIce + 0.1, 0.8]],
          contrast: [[0, 1.04], [tBro, 1.08], [tSons, 1.15], [cutIce + 0.1, 1.04]],
          chroma: [[tTear - 0.05, 0], [tTear + 0.1, 0.6], [tTear + 1.4, 0], [tSons + 0.3, 0.2], [cutIce, 0.1], [cutIce + 0.1, 0]],
          vignette: [[0, 0.38], [tBro, 0.5], [tCeased, 0.36], [tSons, 0.55], [cutIce + 0.1, 0.45]],
          bloom: [[0, 0.8], [tTear, 0.95], [tCeased, 0.85], [tSons, 1.0], [cutIce + 0.1, 0.85]],
          bloomThreshold: [[0, 0.82], [tTear - 0.2, 0.82], [tTear, 1.0], [tTear + 1.8, 0.84]],
        }
      );
      L0.flash = Math.min(0.3, 0.2 * spike(t, tTear, 0.05, 0.3) + (ice ? 0 : 0.08 * sonsK(t) * strikeAt(t, 0.9, 11).level));
      if (!ice && t > tTear - 0.3 && t < tCeased + 2) L0.rays = { pos: [DRAGON[0], DRAGON[1] + 7, DRAGON[2]], color: [1.0, 0.95, 0.9], strength: 0.25 * spike(t, tTear, 0.2, 1.6) + 0.08 };
      else if (ice) L0.rays = { pos: [ICE[0], 6, ICE[2] - 12], color: [0.7, 0.88, 1.0], strength: 0.3 * ramp(t, cutIce + 1, cutIce + 3) };
      const fog: Look["fog"] = ice
        ? { color: [0.4, 0.48, 0.6], density: 0.012, height: -0.5, falloff: 0.2, sky: 0.4 }
        : t > tSons ? { color: [0.16, 0.07, 0.05], density: 0.004, height: -2, falloff: 0.06, sky: 0.3 }
        : { color: [0.12, 0.1, 0.16], density: 0.004, height: -2, falloff: 0.06, sky: 0.25 };
      return cine(L0, { fog, dof: { focus: ice ? KY : [DRAGON[0], DRAGON[1] + 5, DRAGON[2]], k: 0.25 }, streak: 0.15 + 0.3 * spike(t, tTear, 0.05, 1.5) });
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};
