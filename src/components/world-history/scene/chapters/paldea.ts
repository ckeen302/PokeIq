import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeCloudLayer, makeConverge, makeGlow, makeParticles, makePortal, makeRing, makeSky, makeTerrain, merge, noise2, placed, ramp, rng, stoneMaterial } from "../kit";
import { makeCrystals, makeHouses, makeLanterns } from "../props";
import type { ChapterBuilder, Look } from "../types";
import { figureStyle, floatFigure, lights, loadFigures, lookAt, place, pointPixel, shake, spike } from "./common";

/**
 * XII. Area Zero. Paldea at sunset under an empire's walls; beyond them
 * the Great Crater, a sea of cloud with a glow far below. The nations
 * unite and the land fills with lights. A line of torches goes down
 * the crater wall and does not come back. Then the descent: through the
 * clouds into a cavern of crystal and the Pokémon cloaked in light. At
 * the bottom a machine of light that brought a Pokémon from the ancient
 * past and the far future, and keeps drawing more (slow motion as their
 * shadows step out of it).
 */

const TERAPAGOS = 1024, KORAIDON = 1007, MIRAIDON = 1008;
const PARADOX = [984, 1005, 990, 1006];
const CR: Vec3 = [0, 0, -420];
const ZERO: Vec3 = [800, 0, 0];

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tEmpire = B("empire"), tTreasure = B("treasure"), tUnited = B("united"), tHeath = B("heath"), tTera = B("tera"), tMachine = B("machine"), tParadox = B("paradox");
  const end = ctx.timing.anim;
  const cutZero = tMachine - 0.4;
  const tStep = tParadox + 1.2;
  const scene = new THREE.Scene();
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));
  const nz = noise2(131);
  const r = rng(67);

  // ---- Sky.
  const sky = makeSky({ top: "#2a3a6a", horizon: "#ff9a5a", bottom: "#1a1418", nebula: 0, stars: 0, sunDir: [-0.8, 0.05, -0.6], sunColor: "#ffb070", sunSize: 600, sunGlow: 0.35 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  const fog = new THREE.FogExp2(col("#8a6a6a"), 0.0025);
  scene.fog = fog;

  // ---- The land and the Great Crater.
  const crater = (x: number, z: number) => {
    const d = Math.hypot(x - CR[0], z - CR[2]);
    const rim = Math.exp(-(((d - 170) / 26) ** 2)) * 26;
    const hole = d < 170 ? -130 * Math.pow(1 - d / 170, 0.35) : 0;
    return rim + hole;
  };
  const plains = (x: number, z: number) => nz.fbm(x * 0.006 + 3, z * 0.006) * 30 - 10 + nz.fbm(x * 0.03, z * 0.03) * 3;
  const H0 = plains(0, 0) + crater(0, 0);
  const gh = (x: number, z: number) => plains(x, z) + crater(x, z) - H0;
  const land = makeTerrain({
    size: [1200, 1100], segments: Math.round(q.grid * 1.0), height: (x, z) => gh(x, z - 300),
    color: (h, slope) => (h < -60 ? [0.22, 0.2, 0.26] : slope > 0.5 ? [0.36, 0.28, 0.22] : h > 14 ? [0.42, 0.36, 0.22] : [0.3, 0.32, 0.16]),
    center: [0, 0, -300], roughness: 0.95,
  });
  scene.add(land.mesh);
  disposers.push(land.dispose);
  const cloudSea = makeCloudLayer({ size: 340, y: -40, color: "#f0e0e8", shadow: "#8a7a9a", density: 0.85, scale: 0.012, speed: [1.5, 0, 0.6], intensity: 0.9, center: [CR[0], 0, CR[2]] });
  scene.add(cloudSea.mesh);
  disposers.push(cloudSea.dispose);
  const deepGlow = makeGlow({ pos: [CR[0], -70, CR[2]], size: 180, color: "#9ad8ff", intensity: 0 });
  scene.add(deepGlow.sprite);
  disposers.push(deepGlow.dispose);

  // ---- The empire: walls and towers on the plateau; a town; the lights of a united land.
  const walls: THREE.BufferGeometry[] = [];
  const WR = 26;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    walls.push(placed(new THREE.BoxGeometry(10.5, 7, 2), [Math.cos(a) * WR, 3.5, Math.sin(a) * WR], -a + Math.PI / 2));
    walls.push(placed(new THREE.CylinderGeometry(2.2, 2.6, 11, 12), [Math.cos(a + 0.2) * WR, 5.5, Math.sin(a + 0.2) * WR]));
    walls.push(placed(new THREE.ConeGeometry(2.8, 4, 12), [Math.cos(a + 0.2) * WR, 13, Math.sin(a + 0.2) * WR]));
  }
  walls.push(placed(new THREE.BoxGeometry(18, 16, 14), [0, 8, -4]), placed(new THREE.CylinderGeometry(4, 4.5, 30, 16), [0, 15, -4]), placed(new THREE.ConeGeometry(5.5, 9, 16), [0, 34.5, -4]));
  const wallMat = stoneMaterial({ color: "#c8b08a", roughness: 0.8, dirt: 0.35 });
  const palace = new THREE.Mesh(merge(walls), wallMat);
  palace.position.y = gh(0, 0) - 0.5;
  scene.add(palace);
  disposers.push(() => { palace.geometry.dispose(); wallMat.dispose(); });
  const townSpots: { pos: Vec3; rot: number; size: Vec3 }[] = [];
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, d = 34 + r() * 40;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z < -60) continue;
    townSpots.push({ pos: [x, gh(x, z) - 0.2, z], rot: a, size: [4, 3, 3.6] });
  }
  const town = makeHouses({ spots: townSpots, wall: "#d8c0a0", roof: "#a04a30", window: "#ffc070", windowK: 1.6 });
  scene.add(town.group);
  disposers.push(town.dispose);
  const torchPts: Vec3[] = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + 0.2; torchPts.push([Math.cos(a) * WR, gh(0, 0) + 12, Math.sin(a) * WR]); }
  const torches = makeLanterns({ points: torchPts, color: "#ffb050", size: 0.5, intensity: 4, seed: 3 });
  scene.add(torches.group);
  disposers.push(torches.dispose);
  const landPts: Vec3[] = [];
  for (let i = 0; i < 420; i++) {
    const x = (r() - 0.5) * 900, z = 200 - r() * 700;
    if (Math.hypot(x - CR[0], z - CR[2]) < 200) continue;
    landPts.push([x, gh(x, z) + 1.5, z]);
  }
  const lights2 = makeLanterns({ points: landPts, color: "#ffc070", size: 0.5, intensity: 3, seed: 4 });
  scene.add(lights2.group);
  disposers.push(lights2.dispose);
  // Heath's expedition: torches going down the crater wall.
  const pathPts: Vec3[] = [];
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * 0.3 + 0.05 * i, d = 168 - i * 4;
    const x = CR[0] + Math.cos(a) * d, z = CR[2] + Math.sin(a) * d;
    pathPts.push([x, gh(x, z) + 1, z]);
  }
  const expedition = makeLanterns({ points: pathPts, color: "#ffcf80", size: 0.6, intensity: 5, seed: 5 });
  scene.add(expedition.group);
  disposers.push(expedition.dispose);

  // ---- Area Zero: crystals in the depths.
  const deep: Vec3 = [CR[0], gh(CR[0], CR[2]) + 0.5, CR[2]];
  const spots: { pos: Vec3; h: number; r?: number }[] = [];
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2, d = 6 + Math.pow(r(), 0.7) * 70;
    const x = deep[0] + Math.cos(a) * d, z = deep[2] + Math.sin(a) * d;
    spots.push({ pos: [x, gh(x, z) - 0.5, z], h: 2 + r() * 12 * (1 - d / 90), r: 0.5 + r() * 1.4 });
  }
  const crystals = makeCrystals({ spots, colors: ["#2a3a6a", "#bff0ff"], glow: 1.1, seed: 7 });
  scene.add(crystals.mesh);
  disposers.push(crystals.dispose);
  const teraMotes = makeParticles({ count: P(1400), shape: "box", center: [deep[0], deep[1] + 12, deep[2]], extent: [60, 12, 60], velocity: [0, 0.4, 0], spread: [0.2, 0.2, 0.2], life: 9, size: [0.08, 0.22], colors: ["#ffffff", "#9af0ff", "#ffb8f0"], intensity: 2, turbulence: 0.6, seed: 8 });
  scene.add(teraMotes.points);
  disposers.push(teraMotes.dispose);

  // ---- Zero Lab: the time machine.
  const zLand = makeTerrain({
    size: [200, 200], segments: Math.round(q.grid * 0.4),
    height: (x, z) => nz.fbm(x * 0.05 + 9, z * 0.05) * 3 - 1 + Math.max(0, -z - 30) * 0.6 + Math.max(0, Math.abs(x) - 40) * 0.5,
    color: () => [0.16, 0.16, 0.24], center: [ZERO[0], 0, ZERO[2] - 30], roughness: 0.6,
  });
  scene.add(zLand.mesh);
  disposers.push(zLand.dispose);
  const zSpots: { pos: Vec3; h: number; r?: number }[] = [];
  for (let i = 0; i < 50; i++) {
    const a = r() * Math.PI * 2, d = 12 + r() * 50;
    zSpots.push({ pos: [ZERO[0] + Math.cos(a) * d, -1, ZERO[2] - 10 + Math.sin(a) * d * 0.7], h: 3 + r() * 9, r: 0.6 + r() });
  }
  const zCrystals = makeCrystals({ spots: zSpots, colors: ["#1a2a5a", "#9ae0ff"], glow: 0.8, seed: 9 });
  scene.add(zCrystals.mesh);
  disposers.push(zCrystals.dispose);
  const MACH: Vec3 = [ZERO[0], 6.5, ZERO[2] - 6];
  const ringMat = new THREE.MeshStandardMaterial({ color: col("#2a2c38"), metalness: 0.9, roughness: 0.25, emissive: col("#7ae0ff"), emissiveIntensity: 0.4 });
  const ringGeo = merge([new THREE.TorusGeometry(6.2, 0.55, 16, 64), placed(new THREE.TorusGeometry(7.2, 0.18, 8, 64), [0, 0, 0.4]), placed(new THREE.BoxGeometry(2.4, 6, 2.4), [-6.8, -4.5, 0]), placed(new THREE.BoxGeometry(2.4, 6, 2.4), [6.8, -4.5, 0])]);
  const machine = new THREE.Mesh(ringGeo, ringMat);
  machine.position.set(...MACH);
  scene.add(machine);
  disposers.push(() => { ringGeo.dispose(); ringMat.dispose(); });
  const gate = makePortal({ radius: 6, inner: "#cfefff", outer: "#7ae0ff", intensity: 1.3, tear: 0 });
  gate.mesh.position.set(MACH[0], MACH[1], MACH[2] + 0.05);
  scene.add(gate.mesh);
  disposers.push(gate.dispose);
  const pulse = makeRing({ color: "#bff4ff", intensity: 1.2, thickness: 0.04 });
  pulse.mesh.position.set(MACH[0], MACH[1], MACH[2] + 0.2);
  pulse.mesh.scale.setScalar(22);
  scene.add(pulse.mesh);
  disposers.push(pulse.dispose);
  const zLight = new THREE.PointLight(col("#8ae8ff"), 0, 50, 1.2);
  zLight.position.set(MACH[0], MACH[1], MACH[2] + 4);
  scene.add(zLight);
  const motes = makeParticles({ count: P(900), shape: "box", center: [ZERO[0], 5, ZERO[2]], extent: [20, 6, 12], velocity: [0, 0.3, 0.2], spread: [0.2, 0.2, 0.2], life: 8, size: [0.04, 0.1], colors: ["#ffffff", "#9af0ff", "#ffb8f0"], intensity: 1.8, turbulence: 0.6, seed: 10 });
  scene.add(motes.points);
  disposers.push(motes.dispose);

  // ---- Light.
  const L = lights(scene, { sky: "#ffd0b0", ground: "#2a2018", fill: 0.6, key: "#ffb880", keyK: 1.9, keyPos: [-200, 30, -150], rim: "#8ab0ff", rimK: 0.4, rimPos: [40, 30, 60] });

  // ---- Figures.
  const figs = await loadFigures(ctx, [TERAPAGOS, KORAIDON, MIRAIDON, ...PARADOX]);
  const tera = figs.get(TERAPAGOS), kor = figs.get(KORAIDON), mir = figs.get(MIRAIDON);
  const paradox = PARADOX.map((a) => figs.get(a));
  const TP: Vec3 = [deep[0] + 6, deep[1] + 1, deep[2] + 10];
  place(tera, TP, 3.2, 0, scene);
  figureStyle(tera, { rim: "#bff4ff", rimK: 1.8, glow: "#9af0ff", glowK: 0.2, edge: "#ffffff", dissolve: 0 });
  const KO: Vec3 = [MACH[0] - 4.2, 0, MACH[2] + 6], MI: Vec3 = [MACH[0] + 4.2, 0, MACH[2] + 6];
  place(kor, KO, 4, 0.35, scene);
  figureStyle(kor, { rim: "#ffb08a", rimK: 1.6, glow: "#ff6a3a", glowK: 0.05, edge: "#ffd8b0", dissolve: 0 });
  place(mir, MI, 4, -0.35, scene);
  figureStyle(mir, { rim: "#a8c8ff", rimK: 1.6, glow: "#6a8aff", glowK: 0.05, edge: "#d8e8ff", dissolve: 0 });
  const formK = kor ? makeConverge(kor.points, { radius: 2, colors: ["#fff0d8", "#ff8a5a"], size: [0.02, 0.06], intensity: 2, spin: 1.2 }) : null;
  const formM = mir ? makeConverge(mir.points, { radius: 2, colors: ["#e8f0ff", "#6a9aff"], size: [0.02, 0.06], intensity: 2, spin: 1.2, seed: 5 }) : null;
  if (kor && formK) { kor.group.add(formK.points); disposers.push(formK.dispose); }
  if (mir && formM) { mir.group.add(formM.points); disposers.push(formM.dispose); }
  const PX: Vec3[] = [[MACH[0] - 9, 0, MACH[2] + 2], [MACH[0] - 3, 0, MACH[2] - 1], [MACH[0] + 3, 0, MACH[2] - 1], [MACH[0] + 9, 0, MACH[2] + 2]];
  const PXRIM = ["#ff9a5a", "#ff7a6a", "#7ae0ff", "#9ab8ff"];
  paradox.forEach((f, i) => { place(f, PX[i], [3.4, 3.6, 3.2, 3.6][i], [0.4, 0.15, -0.15, -0.4][i], scene); figureStyle(f, { rim: PXRIM[i], rimK: 2.4, edge: PXRIM[i], shadow: 0.92, dissolve: 0 }); });

  const keys: Key[] = [
    { t: 0, pos: [44, 22, 74], look: [0, 12, -20], fov: 48 },
    { t: tEmpire, pos: [40, 18, 70], look: [0, 12, -10], fov: 46 },
    { t: tTreasure - 0.6, pos: [20, 22, 50], look: [0, 16, -40], fov: 46 },
    { t: tTreasure + 1.4, pos: [0, 34, 10], look: [0, -30, -420], fov: 46 },
    { t: tUnited - 0.6, pos: [0, 70, -130], look: [0, -40, -420], fov: 50 },
    { t: tUnited, pos: [-90, 70, 90], look: [0, 0, -120], fov: 54 },
    { t: tHeath - 0.6, pos: [90, 80, 110], look: [0, 0, -140], fov: 54 },
    { t: tHeath, pos: [-40, 50, -200], look: [90, -20, -290], fov: 48 },
    { t: tTera - 0.6, pos: [10, 18, -236], look: [0, -70, -370], fov: 48 },
    { t: tTera + 1.2, pos: [0, -30, -300], look: [0, -95, -410], fov: 56 },
    { t: cutZero, pos: [deep[0] + 22, deep[1] + 6, deep[2] + 40], look: [TP[0], TP[1] + 1.6, TP[2]], fov: 44 },
    { t: cutZero + 0.01, pos: [ZERO[0], 3, ZERO[2] + 20], look: [ZERO[0], 5, ZERO[2] - 4], fov: 46 },
    { t: tParadox - 0.6, pos: [ZERO[0] - 6, 2.6, ZERO[2] + 13], look: [ZERO[0], 3.6, ZERO[2] - 4], fov: 44 },
    { t: tParadox + 0.6, pos: [ZERO[0], 2.4, ZERO[2] + 17], look: [ZERO[0], 4, ZERO[2] - 4], fov: 48 },
    { t: end, pos: [ZERO[0] + 2, 5.5, ZERO[2] + 30], look: [ZERO[0], 4.2, ZERO[2] - 4], fov: 52 },
  ];

  return {
    scene,
    portalScale: 8,
    camera: (t) => shake(poseOnPath(keys, t), t, [{ at: tStep, k: 0.06, dur: 2 }]),
    orbit: (t) => ({ target: t >= cutZero ? [ZERO[0], 4, ZERO[2] - 4] : t >= tTera ? [TP[0], TP[1] + 1.6, TP[2]] : t >= tTreasure ? [0, -20, -400] : [0, 12, -10], limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.15, maxPitch: 1.1, minDist: 4, maxDist: 400 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const zero = t >= cutZero;
      const inside = t >= tTera && !zero;
      const night = ramp(t, tUnited - 0.5, tUnited + 2);
      // Sky.
      const top = sky.u.uTop.value, hor = sky.u.uHorizon.value;
      if (zero || inside) { top.copy(col("#06081a")); hor.copy(col("#1a2a4a")); fog.color.copy(col("#1a2238")); fog.density = zero ? 0.02 : 0.01; sky.u.uSunGlow.value = 0; sky.u.uSunColor.value.copy(col("#000000")); sky.u.uStars.value = 0; }
      else {
        top.copy(col("#2a3a6a").lerp(col("#0a0e24"), night));
        hor.copy(col("#ff9a5a").lerp(col("#4a2a4a"), night));
        fog.color.copy(col("#8a6a6a").lerp(col("#1a1428"), night));
        fog.density = 0.0025;
        sky.u.uSunGlow.value = 0.35 * (1 - night);
        sky.u.uSunColor.value.copy(col("#ffb070", 1 - night));
        sky.u.uStars.value = 0.05 * night;
      }
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      cloudSea.u.uTime.value = ambient;
      cloudSea.u.uOpacity.value = zero ? 0 : 1 - ramp(t, tTera, tTera + 1.2);
      deepGlow.set("#9ad8ff", zero ? 0 : ramp(t, tTreasure, tTreasure + 2) * 0.25 * (1 - ramp(t, tTera, tTera + 1)));
      // The empire, then the lights of a united land.
      torches.update(ambient, 0, px);
      lights2.update(ambient, 0, px);
      (lights2.mesh.material as THREE.MeshBasicMaterial).color.copy(col("#ffc070", 3 * ramp(t, tUnited, tUnited + 4)));
      lights2.group.visible = !zero && !inside && t > tUnited - 0.2;
      town.group.visible = !zero;
      expedition.update(ambient, 0, px);
      const go = ramp(t, tHeath, tHeath + 3.4);
      expedition.group.visible = !zero && !inside && t > tHeath - 0.2;
      (expedition.mesh.material as THREE.MeshBasicMaterial).color.copy(col("#ffcf80", 5 * (1 - ramp(t, tHeath + 3.2, tTera - 0.3))));
      expedition.group.position.set(0, -go * 30, 0);
      // The depths.
      crystals.u.uTime.value = ambient;
      crystals.mesh.visible = !zero;
      teraMotes.u.uTime.value = ambient;
      teraMotes.u.uPixel.value = px;
      teraMotes.u.uOpacity.value = inside ? 1 : 0;
      if (tera) { floatFigure(tera, TP, ambient, 0.15, 0, 0, 0.05); figureStyle(tera, { dissolve: inside ? ramp(t, tTera + 0.6, tTera + 2.4) : 0, glowK: 0.2 + 0.1 * Math.sin(ambient * 1.5) }); }
      // Zero Lab: the machine pulls in the past and the future.
      zLand.mesh.visible = zero;
      zCrystals.mesh.visible = zero;
      zCrystals.u.uTime.value = ambient;
      machine.visible = zero;
      const charge = zero ? ramp(t, cutZero + 0.3, tMachine + 1) : 0;
      gate.mesh.visible = charge > 0.001;
      gate.u.uOpen.value = Math.max(0.001, charge);
      gate.u.uTime.value = ambient;
      ringMat.emissiveIntensity = 0.3 + charge * 0.9 + 0.4 * spike(t, tStep, 0.1, 1.2);
      machine.rotation.z = ambient * 0.05;
      const pk = (ambient * 0.5) % 1;
      pulse.u.uK.value = pk;
      pulse.u.uTime.value = ambient;
      pulse.u.uOpacity.value = charge * (1 - pk);
      pulse.mesh.visible = charge > 0.001;
      zLight.intensity = zero ? 6 * charge + 6 * spike(t, tStep, 0.1, 1.2) : 0;
      motes.u.uTime.value = ambient;
      motes.u.uPixel.value = px;
      motes.u.uOpacity.value = zero ? 1 : 0;
      const kf = ramp(t, tMachine - 0.2, tMachine + 2.2), mf = ramp(t, tMachine + 0.6, tMachine + 3);
      if (kor) { floatFigure(kor, KO, ambient, 0.03, 0, 0.35, 0.02); figureStyle(kor, { dissolve: zero ? kf : 0 }); }
      if (mir) { floatFigure(mir, MI, ambient, 0.03, 1, -0.35, 0.02); figureStyle(mir, { dissolve: zero ? mf : 0 }); }
      if (formK) { formK.u.uForm.value = kf; formK.u.uTime.value = ambient; formK.u.uPixel.value = px; formK.u.uOpacity.value = zero ? 1 - ramp(t, tMachine + 2, tMachine + 3) : 0; }
      if (formM) { formM.u.uForm.value = mf; formM.u.uTime.value = ambient; formM.u.uPixel.value = px; formM.u.uOpacity.value = zero ? 1 - ramp(t, tMachine + 2.8, tMachine + 3.8) : 0; }
      paradox.forEach((f, i) => {
        if (!f) return;
        const k = ramp(t, tStep + i * 0.5, tStep + 1.6 + i * 0.5);
        const p = PX[i];
        f.group.position.set(p[0] + (MACH[0] - p[0]) * (1 - k) * 0.7, p[1], p[2] + (MACH[2] - p[2]) * (1 - k) * 0.7 + Math.sin(ambient * 0.6 + i) * 0.03);
        figureStyle(f, { dissolve: zero ? k : 0, shadow: 0.92 - ramp(t, end - 3, end) * 0.25 });
      });
      // Light.
      if (zero || inside) { L.key.intensity = 0.4; L.hemi.intensity = inside ? 0.6 : 0.4; L.hemi.color.copy(col("#8ab8ff")); }
      else { L.key.intensity = 1.9 * (1 - night * 0.8); L.hemi.intensity = 0.6 - night * 0.3; L.hemi.color.copy(col("#ffd0b0").lerp(col("#6a7ab0"), night)); }
    },
    look(t) {
      const zero = t >= cutZero;
      const inside = t >= tTera && !zero;
      const L0: Look = lookAt(
        t,
        { bloom: 0.85, bloomRadius: 0.62 },
        {
          exposure: [[0, 1.0], [tUnited, 1.0], [tTera, 1.0], [cutZero, 1.0], [end, 1.0]],
          fade: [[cutZero - 0.45, 0], [cutZero - 0.08, 1], [cutZero + 0.12, 1], [cutZero + 0.7, 0]],
          gain: [[0, [1.1, 1.0, 0.9]], [tUnited, [1.06, 0.98, 0.96]], [tUnited + 2, [0.96, 0.96, 1.08]], [tTera, [0.94, 1.0, 1.1]], [cutZero, [0.94, 1.0, 1.1]], [tParadox, [0.96, 0.98, 1.1]]],
          saturation: [[0, 1.12], [tTera, 1.15], [cutZero, 1.05], [tStep, 1.12]],
          contrast: [[0, 1.05], [tTera, 1.08], [cutZero, 1.1]],
          chroma: [[tTera, 0.1], [tTera + 2, 0.25], [cutZero, 0.1], [tStep - 0.05, 0.1], [tStep + 0.2, 0.5], [tStep + 2, 0.2]],
          vignette: [[0, 0.36], [tUnited + 2, 0.42], [tTera, 0.5], [cutZero, 0.55]],
          bloom: [[0, 0.85], [tTera, 1.0], [cutZero, 0.95], [tStep, 1.05], [end, 0.95]],
        }
      );
      L0.flash = 0.18 * spike(t, tStep, 0.08, 0.4);
      if (zero) L0.rays = { pos: MACH, color: [0.75, 0.95, 1.0], strength: 0.3 * ramp(t, cutZero + 0.3, tMachine + 1) };
      else if (inside) L0.rays = { pos: [TP[0], TP[1] + 1.6, TP[2]], color: [0.75, 0.95, 1.0], strength: 0.35 };
      else L0.rays = { pos: [-800, 50, -600], color: [1.0, 0.8, 0.6], strength: 0.3 * (1 - ramp(t, tUnited, tUnited + 2)) };
      return L0;
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};
