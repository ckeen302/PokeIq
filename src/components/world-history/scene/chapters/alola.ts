import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeBeam, makeGlow, makeOcean, makeParticles, makePortal, makeRing, makeSky, makeTerrain, noise2, ramp, rng } from "../kit";
import { makeCity, makeCrystals } from "../props";
import type { ChapterBuilder, Look } from "../types";
import { figureStyle, floatFigure, lights, loadFigures, lookAt, place, pointPixel, shake, spike } from "./common";

/**
 * X. The Blinding One. Underwater volcanoes raise the islands of Alola out
 * of the sea. Far away, in Ultra Megalopolis, people draw on the light of
 * a radiant Pokémon; it runs wild and swallows the city's light (slow
 * motion as the towers go dark). It comes to Alola through a wormhole and
 * the four guardians meet it. Last, the theory: power pouring out of the
 * wormhole into the islands.
 */

const NECROZMA = 800, KOKO = 785, LELE = 786, BULU = 787, FINI = 788;
const CITY: Vec3 = [700, 0, 0];
const HOLE: Vec3 = [0, 74, -150];

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tIslands = B("islands"), tGreed = B("greed"), tStole = B("stole"), tTapu = B("tapu"), tZ = B("z");
  const end = ctx.timing.anim;
  const cutCity = tGreed - 0.4, cutBack = tTapu - 0.4;
  const tDrain = tStole + 1.6;
  const scene = new THREE.Scene();
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));
  const nz = noise2(97);
  const r = rng(41);

  // ---- Sky and sea.
  const sky = makeSky({ top: "#1a2a4a", horizon: "#d08060", bottom: "#0a1424", nebulaA: "#8a4aff", nebulaB: "#2affd0", nebula: 0, nebulaScale: 1.2, stars: 0, sunDir: [0.9, 0.05, -0.4], sunColor: "#ffc890", sunSize: 600, sunGlow: 0.35 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  const fog = new THREE.FogExp2(col("#8a7a8a"), 0.004);
  scene.fog = fog;
  const ocean = makeOcean({ size: 900, segments: q.grid, waves: [{ dir: [1, 0.2], steep: 0.12, length: 30 }, { dir: [-0.3, 1], steep: 0.1, length: 16 }, { dir: [0.7, -0.6], steep: 0.06, length: 8 }, { dir: [0.1, 1], steep: 0.04, length: 4 }], deep: "#04203a", shallow: "#1a6a8a", sky: "#a07a7a", sun: [0.9, 0.05, -0.4], sunColor: "#ffc890", foam: 0.3 });
  scene.add(ocean.mesh);
  disposers.push(ocean.dispose);

  // ---- The islands rise from underwater eruptions.
  const ISL: { c: Vec3; r: number; h: number; at: number }[] = [
    { c: [-70, 0, -90], r: 34, h: 26, at: 0.2 },
    { c: [10, 0, -140], r: 44, h: 44, at: 1.6 },
    { c: [74, 0, -100], r: 30, h: 22, at: 3.0 },
    { c: [26, 0, -46], r: 20, h: 14, at: 4.2 },
  ];
  const isles = ISL.map((I, i) => {
    const hf = (x: number, z: number) => {
      const d = Math.hypot(x, z) / I.r;
      const m = Math.max(0, 1 - d * d);
      return -6 + m * I.h * (0.7 + nz.fbm(x * 0.06 + i * 9, z * 0.06) * 0.6) + nz.fbm(x * 0.2, z * 0.2) * 1.5 * m;
    };
    const t = makeTerrain({
      size: [I.r * 2.4, I.r * 2.4], segments: Math.round(q.grid * 0.4), height: hf,
      color: (h, slope) => (h < 1 ? [0.75, 0.68, 0.5] : slope > 0.5 ? [0.3, 0.26, 0.22] : [0.16, 0.34, 0.12]),
      lava: { color: "#ff5a1a", scale: 0.09, width: 0.045, intensity: 2.5 },
      center: I.c, roughness: 0.9,
    });
    scene.add(t.mesh);
    disposers.push(t.dispose);
    const top: Vec3 = [I.c[0], hf(0, 0) + 1, I.c[2]];
    const plume = makeParticles({ count: P(700), shape: "cylinder", center: top, extent: [3, 1, 3], velocity: [0, 14, 0], spread: [4, 3, 4], gravity: [0, -9.8, 0], life: 2.4, size: [0.3, 0.8], colors: ["#fff2b0", "#ff7a20", "#ff2a08"], intensity: 3, flicker: 0.4, seed: 10 + i });
    const steam = makeParticles({ count: P(160), shape: "disc", center: [I.c[0], 0.5, I.c[2]], extent: [I.r * 0.9, 0.5, I.r * 0.9], velocity: [0.5, 4, 0], spread: [1, 1.5, 1], life: 6, size: [6, 14], colors: ["#d8d0d8", "#b0a8b0", "#888088"], intensity: 0.18, turbulence: 0.6, additive: false, fadeIn: 0.3, fadeOut: 0.5, seed: 20 + i });
    scene.add(plume.points, steam.points);
    disposers.push(plume.dispose, steam.dispose);
    return { t, plume, steam, top, hf };
  });
  const PEAK = isles.map((s) => [s.top[0], s.top[1] - 1, s.top[2]] as Vec3);

  // ---- Ultra Megalopolis: towers of light around a central tower.
  const city = makeCity({ center: CITY, radius: 110, count: 190, height: [12, 80], color: "#ffe8a0", seed: 7 });
  scene.add(city.mesh);
  disposers.push(city.dispose);
  const towerMat = new THREE.MeshStandardMaterial({ color: col("#1a1c26"), metalness: 0.8, roughness: 0.3, emissive: col("#ffe6a0"), emissiveIntensity: 0.6 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 7, 130, 8), towerMat);
  tower.position.set(CITY[0], 65, CITY[2]);
  scene.add(tower);
  disposers.push(() => { tower.geometry.dispose(); towerMat.dispose(); });
  const N_CITY: Vec3 = [CITY[0], 156, CITY[2]];
  const feeds = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    const b = makeBeam({ from: [CITY[0] + Math.cos(a) * 60, 40, CITY[2] + Math.sin(a) * 60], to: N_CITY, radius: 0.6, color: "#fff2c0", intensity: 1.2 });
    scene.add(b.mesh);
    disposers.push(b.dispose);
    return b;
  });
  const prism = makeParticles({ count: P(1600), shape: "sphere", center: N_CITY, extent: [24, 24, 24], velocity: [0, 0, 0], spread: [3, 3, 3], life: 3, size: [0.4, 1.2], colors: ["#ffffff", "#ffe08a", "#8ad8ff"], intensity: 1.0, swirl: 0.3, seed: 5 });
  const swallow = makeParticles({ count: P(3000), shape: "shell", center: N_CITY, extent: [200, 120, 200], velocity: [0, 0, 0], life: 2.4, size: [0.5, 1.4], colors: ["#fff6d0", "#ffd27a", "#8ac8ff"], intensity: 1.2, pull: 90, swirl: 0.6, seed: 6 });
  [prism, swallow].forEach((p) => { scene.add(p.points); disposers.push(p.dispose); });
  const nGlow = makeGlow({ pos: N_CITY, size: 40, color: "#fff0c0", intensity: 0 });
  scene.add(nGlow.sprite);
  disposers.push(nGlow.dispose);
  const drainRing = makeRing({ color: "#ffe8a0", intensity: 1.5, thickness: 0.04 });
  drainRing.mesh.position.set(...N_CITY);
  drainRing.mesh.scale.setScalar(120);
  scene.add(drainRing.mesh);
  disposers.push(drainRing.dispose);

  // ---- The wormhole over Alola, the guardians' light, the power that pours out.
  const hole = makePortal({ radius: 26, inner: "#0a0614", outer: "#8affe8", intensity: 1.6, tear: 0 });
  hole.mesh.position.set(...HOLE);
  scene.add(hole.mesh);
  disposers.push(hole.dispose);
  const TAPU_COL = ["#ffd84a", "#ff8ac8", "#ffb04a", "#8a9aff"];
  const N_ALOLA: Vec3 = [HOLE[0], HOLE[1] - 14, HOLE[2] + 12];
  const tapuBeams = PEAK.map((p, i) => {
    const b = makeBeam({ from: [p[0], p[1] + 6, p[2]], to: N_ALOLA, radius: 0.45, color: TAPU_COL[i], intensity: 1.0 });
    scene.add(b.mesh);
    disposers.push(b.dispose);
    return b;
  });
  const pour = makeParticles({ count: P(2600), shape: "cylinder", center: [HOLE[0], HOLE[1] - 30, HOLE[2] + 8], extent: [22, 30, 8], velocity: [0, -9, 0], spread: [3, 2, 3], life: 4, size: [0.2, 0.6], colors: ["#ffffff", "#8affe8", "#ff8ad8"], intensity: 1.2, turbulence: 1, seed: 8 });
  scene.add(pour.points);
  disposers.push(pour.dispose);
  const zSpots: { pos: Vec3; h: number; r?: number }[] = [];
  isles.forEach((s, i) => {
    for (let k = 0; k < 6; k++) {
      const a = r() * Math.PI * 2, d = 3 + r() * ISL[i].r * 0.45;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      zSpots.push({ pos: [ISL[i].c[0] + x, s.hf(x, z) - 0.2, ISL[i].c[2] + z], h: 1.6 + r() * 2.4, r: 0.45 });
    }
  });
  const zCrystals = makeCrystals({ spots: zSpots, colors: ["#3a2a6a", "#bff8ff"], glow: 1.2, seed: 9 });
  scene.add(zCrystals.mesh);
  disposers.push(zCrystals.dispose);

  // ---- Light.
  const L = lights(scene, { sky: "#ffd8c0", ground: "#1a2a3a", fill: 0.6, key: "#ffc890", keyK: 1.8, keyPos: [80, 30, -120], rim: "#8ab0ff", rimK: 0.6, rimPos: [-40, 30, 60] });

  // ---- Figures.
  const figs = await loadFigures(ctx, [NECROZMA, KOKO, LELE, BULU, FINI]);
  const nec = figs.get(NECROZMA);
  const tapus = [figs.get(KOKO), figs.get(LELE), figs.get(BULU), figs.get(FINI)];
  place(nec, N_CITY, 30, 0, scene);
  figureStyle(nec, { rim: "#ffffff", rimK: 1.2, glow: "#ffe8a0", glowK: 0.15, edge: "#ffffff" });
  tapus.forEach((f, i) => { place(f, [PEAK[i][0], PEAK[i][1] + 0.5, PEAK[i][2]], 5.5, 0, scene); figureStyle(f, { rim: TAPU_COL[i], rimK: 1.8, glow: TAPU_COL[i], glowK: 0.08, edge: "#ffffff", dissolve: 0 }); });

  const keys: Key[] = [
    { t: 0, pos: [0, 7, 70], look: [0, 6, -90], fov: 50 },
    { t: tIslands, pos: [24, 16, 44], look: [0, 6, -90], fov: 50 },
    { t: cutCity, pos: [-10, 22, 30], look: [0, 12, -100], fov: 50 },
    { t: cutCity + 0.01, pos: [CITY[0], 22, CITY[2] + 150], look: [CITY[0], 80, CITY[2] - 40], fov: 52 },
    { t: tStole - 0.6, pos: [CITY[0] + 44, 44, CITY[2] + 96], look: [CITY[0], 140, CITY[2]], fov: 46 },
    { t: tStole + 1, pos: [CITY[0] + 18, 34, CITY[2] + 76], look: [CITY[0], 146, CITY[2]], fov: 50 },
    { t: cutBack, pos: [CITY[0], 64, CITY[2] + 170], look: [CITY[0], 80, CITY[2] - 40], fov: 56 },
    { t: cutBack + 0.01, pos: [4, 9, 44], look: [0, 40, -130], fov: 54 },
    { t: tTapu + 3.4, pos: [-24, 7, -4], look: [4, 34, -120], fov: 50 },
    { t: tZ, pos: [12, 12, 52], look: [0, 38, -130], fov: 52 },
    { t: end, pos: [32, 20, 92], look: [0, 22, -100], fov: 54 },
  ];

  return {
    scene,
    portalScale: 6,
    camera: (t) => shake(poseOnPath(keys, t), t, [{ at: tIslands + 0.3, k: 0.08, dur: 2 }, { at: tIslands + 1.8, k: 0.12, dur: 2 }, { at: tDrain, k: 0.1, dur: 2.4 }, { at: tTapu + 1.6, k: 0.08, dur: 2 }]),
    orbit: (t) => ({ target: t >= cutCity && t < cutBack ? [CITY[0], 100, CITY[2]] : [0, 20, -110], limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.15, maxPitch: 1.1, minDist: 6, maxDist: 260 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const inCity = t >= cutCity && t < cutBack;
      const night = t >= cutBack;
      const drain = ramp(t, tDrain - 0.3, tDrain + 2.6);
      const dawn = ramp(t, tZ + 1, end);
      // Sky.
      const top = sky.u.uTop.value, hor = sky.u.uHorizon.value;
      if (inCity) { top.copy(col("#0e0a26").lerp(col("#000000"), drain)); hor.copy(col("#4a3424").lerp(col("#0a0a12"), drain)); fog.color.copy(col("#2a2030").lerp(col("#020204"), drain)); fog.density = 0.002; sky.u.uSunGlow.value = 0; sky.u.uStars.value = 0.02 * (1 - drain); }
      else if (!night) { top.copy(col("#1a2a4a")); hor.copy(col("#d08060")); fog.color.copy(col("#5a4a5a")); fog.density = 0.0035; sky.u.uSunGlow.value = 0.35; sky.u.uStars.value = 0; }
      else { top.copy(col("#04060e").lerp(col("#1e3a6a"), dawn)); hor.copy(col("#1a1a3a").lerp(col("#d89080"), dawn)); fog.color.copy(col("#0a0a1a").lerp(col("#5a4a5a"), dawn)); fog.density = 0.0035; sky.u.uSunGlow.value = dawn * 0.35; sky.u.uStars.value = 0.05 * (1 - dawn); }
      sky.u.uSunColor.value.copy(col("#ffc890", inCity ? 0 : night ? dawn : 1));
      sky.u.uNeb.value = night ? 0.4 * (1 - dawn) : 0;
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      ocean.mesh.visible = !inCity;
      ocean.u.uTime.value = ambient;
      ocean.u.uFogColor.value.copy(fog.color);
      ocean.u.uFogDensity.value = fog.density;
      ocean.u.uSky.value.copy(night ? col("#1a2240").lerp(col("#c89a8a"), dawn) : col("#c89a8a"));
      ocean.u.uSunColor.value.copy(col("#ffc890", night ? dawn : 1));
      // Islands: each rises with an eruption.
      isles.forEach((s, i) => {
        const k = ramp(t, tIslands - 2 + ISL[i].at, tIslands + 1.6 + ISL[i].at);
        const ease = 1 - Math.pow(1 - k, 3);
        s.t.mesh.visible = !inCity;
        s.t.mesh.position.y = -22 * (1 - ease);
        s.t.u.uTime.value = ambient;
        s.t.u.uLavaK.value = 2.5 * (1 - ramp(t, tIslands + 3 + ISL[i].at, cutCity)) + (night ? 0.4 : 0);
        s.plume.u.uTime.value = ambient;
        s.plume.u.uPixel.value = px;
        s.plume.u.uCenter.value.set(s.top[0], s.top[1] - 22 * (1 - ease), s.top[2]);
        s.plume.u.uOpacity.value = inCity || night ? 0 : ramp(t, tIslands - 2 + ISL[i].at, tIslands - 1.4 + ISL[i].at) * (1 - ramp(t, tIslands + 3.5 + ISL[i].at, cutCity));
        s.steam.u.uTime.value = ambient;
        s.steam.u.uPixel.value = px;
        s.steam.u.uOpacity.value = inCity || night ? 0 : ramp(t, tIslands - 2 + ISL[i].at, tIslands - 1 + ISL[i].at) * (1 - ramp(t, cutCity - 2, cutCity));
      });
      // The city and its light, then the light swallowed.
      city.mesh.visible = inCity;
      tower.visible = inCity;
      city.u.uTime.value = ambient;
      city.u.uLit.value = 1 - drain;
      towerMat.emissiveIntensity = 0.6 * (1 - drain);
      feeds.forEach((b, i) => {
        b.mesh.visible = inCity && drain < 0.98;
        b.u.uTime.value = ambient + i;
        b.u.uOpacity.value = (0.5 + 0.5 * ramp(t, tStole, tDrain)) * (1 - drain);
      });
      for (const p of [prism, swallow, pour]) { p.u.uTime.value = ambient; p.u.uPixel.value = px; }
      prism.u.uOpacity.value = inCity ? 1 - drain * 0.8 : 0;
      swallow.u.uOpacity.value = inCity ? ramp(t, tDrain - 0.4, tDrain + 0.4) * (1 - ramp(t, tDrain + 2.6, cutBack)) : 0;
      nGlow.sprite.position.set(...(night ? N_ALOLA : N_CITY));
      nGlow.set(night ? "#c8a0ff" : "#fff0c0", inCity ? 0.25 * (1 - drain) + 0.12 * spike(t, tDrain, 0.1, 1) : night ? 0.12 * ramp(t, tTapu, tTapu + 2) : 0);
      drainRing.u.uK.value = 1 - ramp(t, tDrain - 0.2, tDrain + 2.2);
      drainRing.u.uTime.value = ambient;
      drainRing.mesh.visible = inCity && t > tDrain - 0.2 && t < tDrain + 2.2;
      drainRing.mesh.quaternion.copy(cam.quaternion);
      // Necrozma: radiant in the city; dark and prismatic over Alola.
      if (nec) {
        if (inCity) floatFigure(nec, N_CITY, ambient, 0.8, 0, 0, 0.03);
        else {
          const come = ramp(t, cutBack + 0.4, tTapu + 2.2);
          nec.group.position.set(N_ALOLA[0], N_ALOLA[1] + Math.sin(ambient * 0.7) * 0.6, N_ALOLA[2] - 30 * (1 - come));
          nec.group.rotation.y = Math.sin(ambient * 0.3) * 0.05;
        }
        figureStyle(nec, { dissolve: inCity ? 1 : night ? ramp(t, cutBack + 0.4, tTapu + 1.6) * (1 - ramp(t, tZ + 3, end - 0.5) * 0.85) : 0, shadow: inCity ? drain * 0.85 : 0.75, glowK: inCity ? 0.15 * (1 - drain) + 0.04 : 0.04, rimK: inCity ? 1.2 : 1.8 });
      }
      // The wormhole and the guardians.
      const open = night ? ramp(t, cutBack + 0.2, tTapu + 1) : 0;
      hole.mesh.visible = open > 0.001;
      hole.u.uOpen.value = Math.max(0.001, open);
      hole.u.uTime.value = ambient;
      hole.mesh.quaternion.copy(cam.quaternion);
      tapus.forEach((f, i) => {
        if (!f) return;
        floatFigure(f, [PEAK[i][0], PEAK[i][1] + 0.5, PEAK[i][2]], ambient, 0.3, i, 0, 0.05);
        figureStyle(f, { dissolve: night ? ramp(t, tTapu + i * 0.3, tTapu + 1.4 + i * 0.3) : 0, glowK: 0.08 + 0.3 * ramp(t, tTapu + 1.6, tTapu + 2.4) * (1 - ramp(t, tZ, tZ + 2)) });
      });
      tapuBeams.forEach((b, i) => {
        const k = night ? ramp(t, tTapu + 1.6 + i * 0.2, tTapu + 2.4 + i * 0.2) * (1 - ramp(t, tZ - 0.5, tZ + 1)) : 0;
        b.mesh.visible = k > 0.001;
        b.u.uOpacity.value = k;
        b.u.uTime.value = ambient + i;
      });
      pour.u.uOpacity.value = night ? ramp(t, tZ, tZ + 1.6) : 0;
      zCrystals.mesh.visible = night;
      zCrystals.u.uTime.value = ambient;
      zCrystals.u.uGlow.value = night ? 0.2 + 1.2 * ramp(t, tZ + 0.8, tZ + 3) : 0;
      // Light.
      L.key.intensity = inCity ? 1.2 * (1 - drain * 0.8) : night ? 0.5 + dawn * 1.2 : 1.8;
      L.key.color.copy(inCity ? col("#fff0d0") : night ? col("#a8b0ff").lerp(col("#ffc890"), dawn) : col("#ffc890"));
      L.hemi.intensity = inCity ? 0.5 * (1 - drain * 0.7) : night ? 0.3 + dawn * 0.3 : 0.6;
    },
    look(t) {
      const inCity = t >= cutCity && t < cutBack;
      const L0: Look = lookAt(
        t,
        { bloom: 0.85, bloomRadius: 0.62 },
        {
          exposure: [[0, 1.0], [cutCity, 1.0], [tDrain, 1.05], [tDrain + 2.6, 0.95], [cutBack, 1.0], [end, 1.04]],
          fade: [cutCity, cutBack].flatMap((c) => [[c - 0.45, 0], [c - 0.08, 1], [c + 0.12, 1], [c + 0.7, 0]] as [number, number][]),
          gain: [[0, [1.08, 1.0, 0.94]], [cutCity, [1.08, 1.0, 0.94]], [cutCity + 0.1, [1.04, 1.0, 0.98]], [tDrain + 2, [0.9, 0.95, 1.1]], [cutBack + 0.1, [0.92, 0.96, 1.1]], [tZ, [1.0, 0.98, 1.06]], [end, [1.06, 1.0, 0.96]]],
          saturation: [[0, 1.12], [tDrain, 1.1], [tDrain + 2.6, 0.6], [cutBack + 0.1, 1.05], [end, 1.12]],
          contrast: [[0, 1.05], [tDrain, 1.12], [cutBack, 1.08], [end, 1.04]],
          chroma: [[tDrain - 0.05, 0], [tDrain + 0.2, 0.7], [tDrain + 2, 0.2], [cutBack, 0.1], [tTapu, 0.35], [tZ + 2, 0.15]],
          vignette: [[0, 0.36], [tDrain, 0.55], [cutBack, 0.5], [end, 0.38]],
          bloom: [[0, 0.85], [cutCity + 0.1, 0.9], [tDrain + 2, 0.75], [tTapu + 2, 0.85], [end, 0.85]],
        }
      );
      L0.flash = Math.min(0.4, 0.35 * spike(t, tDrain, 0.1, 0.8) + 0.12 * spike(t, tTapu + 2, 0.2, 1));
      if (inCity) L0.rays = { pos: N_CITY, color: [1.0, 0.95, 0.8], strength: 0.35 * (1 - ramp(t, tDrain, tDrain + 2)) };
      else if (t >= cutBack) L0.rays = { pos: HOLE, color: [0.7, 1.0, 0.95], strength: 0.25 * ramp(t, cutBack + 0.4, tTapu + 1.5) };
      else L0.rays = { pos: [900, 40, -400], color: [1.0, 0.85, 0.6], strength: 0.2 };
      return L0;
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};
