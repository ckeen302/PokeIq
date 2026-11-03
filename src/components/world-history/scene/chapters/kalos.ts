import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeBeam, makeCloudLayer, makeConverge, makeFlames, makeGlow, makeParticles, makeRing, makeSky, makeStreaks, makeTerrain, merge, noise2, placed, ramp, rng, stoneMaterial, strikeAt } from "../kit";
import { makeMeadow, makeRobed, makeRuins } from "../props";
import type { ChapterBuilder, Look } from "../types";
import { figureStyle, lights, loadFigures, lookAt, place, pointPixel, shake, spike } from "./common";

/**
 * IV. The Ultimate Weapon. A kingdom burning at night, three thousand
 * years ago; a tall man and his Floette in a garden at dusk; the war
 * takes her. A great machine rises from the valley and opens like a
 * flower (slow motion), its light reaches the heavens and pours down,
 * burning everything to ash. In the ash the resurrected Floette leaves
 * him. Then the long years pass, flowers return, and so does she.
 */

const FLOETTE = 10061;

const lerpC = (out: THREE.Color, a: THREE.Color, b: THREE.Color, k: number) => out.copy(a).lerp(b, k);

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tWar = B("war"), tMan = B("man"), tWeapon = B("weapon"), tLight = B("light"), tLeft = B("left"), tAz = B("az");
  const end = ctx.timing.anim;
  const cutGarden = tMan - 0.4;
  const tFire = tLight - 0.2;
  const tAsh = tLight + 3.5;
  const scene = new THREE.Scene();
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));
  const nz = noise2(41);

  // ---- The land: a long valley under a hill with a castle.
  const hills = (x: number, z: number) => nz.fbm(x * 0.011 + 4, z * 0.011) * 22 - 7 + Math.pow(Math.abs(x) / 150, 2) * 34;
  const local = (x: number, z: number) => {
    const dW = Math.hypot(x, z - 5) / 70;
    return (hills(x, z) - hills(0, 100)) * Math.min(1, 0.25 + dW * dW);
  };
  const gh = (x: number, z: number) => local(x, z + 100);
  const land = makeTerrain({
    size: [560, 420], segments: Math.round(q.grid * 0.75), height: local,
    color: (h, slope) => (slope > 0.45 ? [0.2, 0.18, 0.16] : h > 10 ? [0.16, 0.2, 0.12] : [0.14, 0.17, 0.1]),
    center: [0, 0, -100], roughness: 0.95,
  });
  scene.add(land.mesh);
  disposers.push(land.dispose);
  const AZ_AT: Vec3 = [0, gh(0, 0), 0];

  // ---- Sky: a burning night, a dusk, the light, ash, a dawn.
  const sky = makeSky({ top: "#07050c", horizon: "#7a2a16", bottom: "#050304", nebulaA: "#3a1a14", nebulaB: "#1a0c0c", nebula: 0.35, nebulaScale: 1.6, stars: 0.02, sunDir: [-0.7, 0.05, -0.7], sunColor: "#000000", sunSize: 400, sunGlow: 0 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  const SKY = {
    war: [col("#07050c"), col("#7a2a16"), col("#050304")],
    dusk: [col("#1a1c3a"), col("#d0784a"), col("#0c0a10")],
    ash: [col("#2c2826"), col("#5c544e"), col("#1a1816")],
    dawn: [col("#2e4a82"), col("#d88a7c"), col("#221c28")],
  };
  const fog = new THREE.FogExp2(col("#2a1410"), 0.006);
  scene.fog = fog;
  const FOG = { war: col("#2a1410"), dusk: col("#4a3442"), ash: col("#3a3532"), dawn: col("#6a5058") };
  const smokeLayer = makeCloudLayer({ size: 900, y: 70, color: "#8a4430", shadow: "#5a2818", density: 0.4, scale: 0.008, speed: [2, 0, 1], intensity: 0.5 });
  scene.add(smokeLayer.mesh);
  disposers.push(smokeLayer.dispose);
  const heaven = makeCloudLayer({ size: 1400, y: 170, color: "#8a5a70", shadow: "#2a1a24", density: 0.6, scale: 0.005, speed: [1, 0, 0.5], intensity: 0.0 });
  heaven.mesh.position.set(0, 170, -95);
  heaven.u.uHoleGlow.value.copy(col("#ffc8e8", 1.0));
  scene.add(heaven.mesh);
  disposers.push(heaven.dispose);

  // ---- The kingdom: a castle on the hill, ruins down the valley, fires.
  const castle = new THREE.Group();
  const CX = -78, CZ = -160;
  castle.position.set(CX, gh(CX, CZ) - 1, CZ);
  const cparts: THREE.BufferGeometry[] = [placed(new THREE.BoxGeometry(18, 20, 13), [0, 10, 0])];
  for (const [x, z] of [[-11, -8], [11, -8], [-11, 8], [11, 8]] as [number, number][]) {
    cparts.push(placed(new THREE.CylinderGeometry(2.4, 2.8, 27, 14), [x, 13.5, z]));
    cparts.push(placed(new THREE.ConeGeometry(3.3, 8, 14), [x, 31, z]));
  }
  cparts.push(placed(new THREE.CylinderGeometry(3, 3.4, 36, 14), [0, 18, -2]), placed(new THREE.ConeGeometry(4.2, 11, 14), [0, 41.5, -2]));
  cparts.push(placed(new THREE.BoxGeometry(40, 9, 2), [0, 4.5, 16]), placed(new THREE.BoxGeometry(2, 9, 30), [-20, 4.5, 2]), placed(new THREE.BoxGeometry(2, 9, 30), [20, 4.5, 2]));
  const castleMat = stoneMaterial({ color: "#5a4c48", roughness: 0.85, dirt: 0.55 });
  const castleMesh = new THREE.Mesh(merge(cparts), castleMat);
  castle.add(castleMesh);
  castle.rotation.y = 0.5;
  scene.add(castle);
  disposers.push(() => { castleMesh.geometry.dispose(); castleMat.dispose(); });
  const ruins = makeRuins({ center: [14, 0, -70], radius: 70, columns: 80, arches: 7, color: "#6a5a50", seed: 8, height: [2, 9], heightAt: gh });
  scene.add(ruins.mesh);
  disposers.push(ruins.dispose);
  const r = rng(77);
  const firePts: Vec3[] = [];
  for (let i = 0; i < 64; i++) {
    const a = r() * Math.PI * 2, d = 20 + Math.sqrt(r()) * 120;
    const x = Math.cos(a) * d * 1.2 + 10, z = -80 + Math.sin(a) * d * 0.7;
    if (Math.hypot(x, z) < 26) continue;
    firePts.push([x, gh(x, z) + 0.2, z]);
  }
  for (const [x, z] of [[-11, -8], [11, -8], [-11, 8], [0, 16], [-20, 2], [6, 6]] as [number, number][]) {
    const c = Math.cos(0.5), s = Math.sin(0.5);
    firePts.push([CX + x * c + z * s, gh(CX, CZ) + (Math.abs(x) === 11 ? 26 : 9), CZ - x * s + z * c]);
  }
  const fires = makeFlames({ points: firePts, size: [3.6, 9], intensity: 2.6, seed: 5 });
  scene.add(fires.mesh);
  disposers.push(fires.dispose);
  const embers = makeParticles({ count: P(2400), shape: "box", center: [0, 10, -90], extent: [140, 10, 80], velocity: [2, 3.2, 0.5], spread: [1, 1, 1], life: 6, size: [0.1, 0.3], colors: ["#ffe6a0", "#ff8a30", "#ff3a10"], intensity: 2.6, turbulence: 1.4, flicker: 0.6, seed: 6 });
  const smoke = makeParticles({ count: P(260), shape: "box", center: [0, 10, -110], extent: [150, 6, 70], velocity: [2, 2.4, 0], spread: [1, 1, 1], life: 12, size: [18, 34], colors: ["#4a2c24", "#2e1c18", "#1a100c"], intensity: 0.22, turbulence: 0.5, additive: false, fadeIn: 0.3, fadeOut: 0.5, seed: 7 });
  [embers, smoke].forEach((p) => { scene.add(p.points); disposers.push(p.dispose); });
  const battle = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 1.4 + Math.PI * 1.3, d = 150 + r() * 120;
    const x = Math.cos(a) * d, z = -120 + Math.sin(a) * d * 0.6;
    const g = makeGlow({ pos: [x, gh(x, z) + 6 + r() * 10, z], size: 40 + r() * 40, color: ["#ffa040", "#60c8ff", "#c070ff", "#ff5050"][i % 4], intensity: 0 });
    scene.add(g.sprite);
    disposers.push(g.dispose);
    return { g, color: ["#ffa040", "#60c8ff", "#c070ff", "#ff5050"][i % 4], seed: i + 3 };
  });
  const fireLight = new THREE.PointLight(col("#ff6a28"), 0, 180, 1);
  fireLight.position.set(0, 18, -80);
  scene.add(fireLight);

  // ---- The garden: the man, his Floette, a meadow.
  const az = makeRobed({ height: 3.1, color: "#4a4054" });
  const gardenLight = new THREE.PointLight(col("#ffc8a0"), 0, 18, 1.2);
  gardenLight.position.set(3, 3.2, 6);
  scene.add(gardenLight);
  az.mesh.position.set(...AZ_AT);
  az.mesh.rotation.y = 0.35;
  scene.add(az.mesh);
  disposers.push(az.dispose);
  const flowerPts: Vec3[] = [];
  for (let i = 0; i < Math.round(9000 * Math.max(0.35, q.particles)); i++) {
    const a = r() * Math.PI * 2, d = 1.2 + Math.pow(r(), 0.7) * 46;
    const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.9 - 4;
    flowerPts.push([x, gh(x, z) + 0.12 + r() * 0.12, z]);
  }
  const meadow = makeMeadow({ points: flowerPts, colors: ["#e8334a", "#f5d142", "#f08a3a", "#4a7ae0", "#f4f0ea", "#e8334a"], size: [0.06, 0.12], center: AZ_AT, intensity: 0.85 });
  scene.add(meadow.points);
  disposers.push(meadow.dispose);
  const petals = makeParticles({ count: P(500), shape: "sphere", center: [0, 1.6, 0], extent: [5, 2, 5], velocity: [0.4, 0.3, 0], spread: [0.4, 0.3, 0.4], life: 6, size: [0.05, 0.1], colors: ["#ff6a8a", "#ffd0dc", "#e8334a"], intensity: 1.6, turbulence: 0.8, swirl: 0.3, seed: 9 });
  scene.add(petals.points);
  disposers.push(petals.dispose);

  // ---- The ultimate weapon.
  const WPN: Vec3 = [0, gh(0, -95) - 1, -95];
  const weapon = new THREE.Group();
  weapon.position.set(...WPN);
  scene.add(weapon);
  const S = 1.4;
  weapon.scale.setScalar(S);
  const metal = new THREE.MeshStandardMaterial({ color: col("#2a2228"), metalness: 0.85, roughness: 0.3, emissive: col("#ff5aa8"), emissiveIntensity: 0 });
  const petalU = { uVein: { value: 0 }, uVeinColor: { value: col("#ff8ad0") } };
  const petalMat = new THREE.MeshStandardMaterial({ color: col("#2e2430"), metalness: 0.75, roughness: 0.26, emissive: col("#ff7ac0"), emissiveIntensity: 0, side: THREE.DoubleSide });
  petalMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, petalU);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vPetalUv;").replace("#include <uv_vertex>", "#include <uv_vertex>\nvPetalUv = uv;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPetalUv;\nuniform float uVein;\nuniform vec3 uVeinColor;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float vein = pow(abs(sin(vPetalUv.x * 3.14159 * 9.0)), 30.0) * smoothstep(0.0, 0.3, 1.0 - vPetalUv.y);
        float edge = smoothstep(0.55, 0.62, 1.0 - vPetalUv.y);
        totalEmissiveRadiance += uVeinColor * (vein * 2.2 + edge * 1.6) * uVein;`);
  };
  petalMat.customProgramCacheKey = () => "wh-kalos-petal";
  const body = new THREE.Mesh(merge([
    placed(new THREE.CylinderGeometry(10, 12.5, 3.2, 32), [0, 1.6, 0]),
    placed(new THREE.CylinderGeometry(7, 9, 2.4, 32), [0, 4.2, 0]),
    placed(new THREE.CylinderGeometry(1.6, 2.6, 26, 18), [0, 18, 0]),
    placed(new THREE.CylinderGeometry(2.8, 1.8, 3, 18), [0, 29.5, 0]),
    placed(new THREE.SphereGeometry(3.2, 28, 18), [0, 31, 0]),
  ]), metal);
  weapon.add(body);
  const PETALS = 14;
  const petalGeo = new THREE.SphereGeometry(1, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.6);
  petalGeo.translate(0, -1, 0);
  petalGeo.scale(1.7, -11, 0.45);
  const petalPivots = Array.from({ length: PETALS }, (_, i) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, 31, 0);
    pivot.rotation.y = (i / PETALS) * Math.PI * 2;
    const tilt = new THREE.Group();
    const m = new THREE.Mesh(petalGeo, petalMat);
    m.position.z = 2.4;
    tilt.add(m);
    pivot.add(tilt);
    weapon.add(pivot);
    return tilt;
  });
  const core = makeGlow({ pos: [0, 31.5, 0], size: 16, color: "#ffd0ec", intensity: 0 });
  weapon.add(core.sprite);
  const charge = makeRing({ color: "#ff9ad8", intensity: 2.4, thickness: 0.05 });
  charge.mesh.rotation.x = -Math.PI / 2;
  charge.mesh.position.set(0, 31.5, 0);
  charge.mesh.scale.setScalar(16);
  weapon.add(charge.mesh);
  disposers.push(() => { body.geometry.dispose(); petalGeo.dispose(); metal.dispose(); petalMat.dispose(); core.dispose(); charge.dispose(); });
  const coreAt: Vec3 = [WPN[0], WPN[1] + 31.5 * S, WPN[2]];
  const gather = makeParticles({ count: P(2200), shape: "shell", center: coreAt, extent: [90, 40, 90], velocity: [0, 0, 0], life: 2.6, size: [0.1, 0.28], colors: ["#ffffff", "#ffb8e0", "#b8d8ff"], intensity: 1.6, pull: 34, swirl: 0.5, seed: 10 });
  const dust = makeParticles({ count: P(1200), shape: "disc", center: [WPN[0], WPN[1] + 1, WPN[2]], extent: [16, 1, 16], velocity: [0, 4, 0], spread: [3, 2, 3], gravity: [0, -3, 0], life: 3, size: [1.2, 3.4], colors: ["#6a5a50", "#4a3e38", "#2a2420"], intensity: 0.5, additive: false, seed: 11 });
  [gather, dust].forEach((p) => { scene.add(p.points); disposers.push(p.dispose); });
  const beam = makeBeam({ from: coreAt, to: [coreAt[0], 330, coreAt[2]], radius: 2.2, color: "#ffd0ea", intensity: 2 });
  scene.add(beam.mesh);
  disposers.push(beam.dispose);
  const pour = makeStreaks({ count: P(1100), center: [0, 110, -90], extent: [260, 50, 190], velocity: [0, -170, 0], life: 0.85, length: 44, width: 0.45, color: "#ffd0ea", intensity: 1.6, seed: 12 });
  scene.add(pour.mesh);
  disposers.push(pour.dispose);
  const burn = makeRing({ color: "#ffe8f4", intensity: 3, thickness: 0.06 });
  burn.mesh.rotation.x = -Math.PI / 2;
  burn.mesh.position.set(WPN[0], WPN[1] + 2, WPN[2]);
  burn.mesh.scale.setScalar(420);
  scene.add(burn.mesh);
  disposers.push(burn.dispose);
  const ash = makeParticles({ count: P(2400), shape: "box", center: [0, 10, -10], extent: [40, 10, 40], velocity: [0.4, -0.7, 0.2], spread: [0.3, 0.2, 0.3], life: 12, size: [0.04, 0.12], colors: ["#e8e4e0", "#b8b2ac", "#8a8480"], intensity: 1.0, turbulence: 0.5, additive: false, seed: 13 });
  scene.add(ash.points);
  disposers.push(ash.dispose);

  // ---- Light.
  const L = lights(scene, { sky: "#ffb080", ground: "#2a1410", fill: 0.4, key: "#ff9a5a", keyK: 1.2, keyPos: [-60, 30, -80], rim: "#6a8aff", rimK: 0.5, rimPos: [40, 30, 60] });

  // ---- Floette.
  const figs = await loadFigures(ctx, [FLOETTE]);
  const floette = figs.get(FLOETTE);
  place(floette, [0.9, 1.6, 0.6], 0.95, -0.3, scene);
  figureStyle(floette, { rim: "#ffd0e0", rimK: 1.6, glow: "#ff8ab0", glowK: 0.12, edge: "#ffffff", dissolve: 0 });
  const fGlow = makeGlow({ pos: [0.9, 2, 0.6], size: 1.3, color: "#ff9ac0", intensity: 0 });
  scene.add(fGlow.sprite);
  disposers.push(fGlow.dispose);
  const reform = floette ? makeConverge(floette.points, { radius: 1.2, colors: ["#ffffff", "#ff9ac0"], size: [0.01, 0.025], intensity: 2.2, spin: 1.4 }) : null;
  if (floette && reform) { floette.group.add(reform.points); disposers.push(reform.dispose); }
  const FL = new THREE.Vector3();
  const TO_WAR = new THREE.Vector3(14, 12, -70), AWAY = new THREE.Vector3(8, 6, -42), FROM = new THREE.Vector3(-9, 5, -30);
  const floettePos = (t: number, ambient: number): number => {
    // Returns presence (0..1) and writes the position into FL.
    const home = FL.set(0.95 + Math.sin(ambient * 0.9) * 0.08, AZ_AT[1] + 1.75 + Math.sin(ambient * 1.6) * 0.07, 0.55);
    if (t < cutGarden) return 0;
    if (t < tAsh) {
      const go = ramp(t, tMan + 2.4, tWeapon - 0.6);
      home.lerp(TO_WAR, go * go);
      return 1 - ramp(t, tWeapon - 2, tWeapon - 0.6);
    }
    if (t < tAz) {
      const leave = ramp(t, tLeft + 0.2, tAz - 0.6);
      home.lerp(AWAY, leave * leave);
      return ramp(t, tAsh + 0.8, tAsh + 2.4) * (1 - ramp(t, tAz - 1.6, tAz - 0.6));
    }
    const back = 1 - ramp(t, tAz + 1.2, tAz + 4.8);
    home.lerp(FROM, back * back);
    return ramp(t, tAz + 0.8, tAz + 1.8);
  };

  const keys: Key[] = [
    { t: 0, pos: [36, 44, 130], look: [-10, 10, -100], fov: 50 },
    { t: tWar, pos: [20, 26, 76], look: [-24, 14, -110], fov: 46 },
    { t: cutGarden, pos: [-12, 14, 30], look: [-46, 18, -130], fov: 44 },
    { t: cutGarden + 0.01, pos: [2.8, 2.0, 6.6], look: [0.3, 1.7, 0], fov: 36 },
    { t: tMan + 2.6, pos: [-2.2, 1.7, 5.6], look: [0.5, 1.9, -1], fov: 36 },
    { t: tWeapon - 0.6, pos: [-3.2, 2.6, 7.4], look: [3, 6, -40], fov: 44 },
    { t: tWeapon + 2.0, pos: [-10, 7, -14], look: [0, 33, -95], fov: 48 },
    { t: tWeapon + 4.4, pos: [16, 12, -36], look: [0, 42, -95], fov: 44 },
    { t: tFire - 0.6, pos: [30, 6, -20], look: [0, 46, -95], fov: 52 },
    { t: tFire + 0.8, pos: [46, 10, 6], look: [0, 90, -95], fov: 58 },
    { t: tFire + 1.9, pos: [64, 42, 84], look: [0, 20, -100], fov: 55 },
    { t: tAsh - 0.05, pos: [70, 46, 94], look: [0, 18, -100], fov: 55 },
    { t: tAsh, pos: [3.6, 1.9, 7.2], look: [0.4, 1.7, 0], fov: 38 },
    { t: tLeft, pos: [5, 2.4, 10], look: [1.2, 2.6, -10], fov: 42 },
    { t: tAz - 0.3, pos: [6.4, 3.4, 14], look: [4, 5, -30], fov: 46 },
    { t: tAz, pos: [-3.6, 1.8, 6.8], look: [0.3, 1.8, 0], fov: 38 },
    { t: end, pos: [-7.5, 3.6, 16], look: [0, 2.2, -4], fov: 44 },
  ];
  const sunPos: Vec3 = [-500, 40, -500];

  return {
    scene,
    portalScale: 5,
    camera: (t) => shake(poseOnPath(keys, t), t, [{ at: tWeapon, k: 0.08, dur: 3 }, { at: tFire, k: 0.18, dur: 2.4 }, { at: tFire + 1.2, k: 0.12, dur: 2 }]),
    orbit: (t) => ({ target: t < cutGarden ? [-20, 10, -100] : t < tWeapon - 0.6 || t >= tAsh ? [0.5, 1.8, 0] : [0, 34, -95], limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.15, maxPitch: 1.0, minDist: 2, maxDist: 220 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const war = t < cutGarden;
      const ashen = t >= tAsh && t < tAz;
      const dawn = ramp(t, tAz - 0.2, tAz + 3);
      const glowUp = ramp(t, tWeapon + 2.4, tFire);
      const burning = ramp(t, tFire + 0.8, tAsh - 0.4);
      // Sky and fog.
      const [top, hor, bot] = [sky.u.uTop.value, sky.u.uHorizon.value, sky.u.uBottom.value];
      const set3 = (a: THREE.Color[], b: THREE.Color[], k: number) => { lerpC(top, a[0], b[0], k); lerpC(hor, a[1], b[1], k); lerpC(bot, a[2], b[2], k); };
      if (war) { set3(SKY.war, SKY.war, 0); fog.color.copy(FOG.war); }
      else if (t < tAsh) { set3(SKY.dusk, SKY.war, ramp(t, tWeapon - 1, tWeapon + 3) * 0.7); lerpC(fog.color, FOG.dusk, FOG.war, ramp(t, tWeapon - 1, tWeapon + 3) * 0.7); }
      else if (t < tAz) { set3(SKY.ash, SKY.ash, 0); fog.color.copy(FOG.ash); }
      else { set3(SKY.ash, SKY.dawn, dawn); lerpC(fog.color, FOG.ash, FOG.dawn, dawn); }
      fog.density = war ? 0.0055 : ashen ? 0.012 : t >= tAz ? 0.012 - dawn * 0.007 : 0.0045;
      sky.u.uNeb.value = war ? 0.35 : 0;
      sky.u.uStars.value = war ? 0.02 : 0;
      sky.u.uSunColor.value.copy(col("#ffb8a0", t >= tAz ? dawn * 0.7 : !war && t < tWeapon ? 0.5 : 0));
      sky.u.uSunGlow.value = t >= tAz ? dawn * 0.32 : !war && t < tWeapon ? 0.3 : 0;
      sky.u.uFlash.value = burning * 0.35 + spike(t, tFire + 0.6, 0.15, 0.6) * 0.3;
      sky.u.uFlashColor.value.copy(col("#ffe0f0"));
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      smokeLayer.u.uTime.value = ambient;
      smokeLayer.u.uOpacity.value = t < tAsh ? (war ? 1 : 0.6) : 0;
      heaven.u.uTime.value = ambient;
      heaven.u.uIntensity.value = 0.9 * ramp(t, tFire + 0.4, tFire + 0.9) * (1 - ramp(t, tAsh - 0.6, tAsh));
      heaven.u.uOpacity.value = heaven.u.uIntensity.value > 0 ? 1 : 0;
      heaven.u.uHole.value.set(0, -95, 6 + 520 * Math.pow(ramp(t, tFire + 0.5, tAsh - 0.8), 1.4));
      // The war.
      fires.u.uTime.value = ambient;
      fires.u.uOpacity.value = t < tAsh ? (war ? 1 : 0.7) * (1 - burning) : 0;
      fires.u.uIntensity.value = 3.2;
      for (const p of [embers, smoke, petals, gather, dust, ash]) { p.u.uPixel.value = px; p.u.uTime.value = ambient; }
      embers.u.uOpacity.value = t < tAsh ? (war ? 1 : 0.5) : 0;
      smoke.u.uOpacity.value = t < tAsh ? (war ? 1 : 0.6) : 0;
      battle.forEach((b, i) => {
        const s = strikeAt(ambient + i * 0.37, 1.1 + (i % 3) * 0.4, b.seed);
        b.g.set(b.color, t < tWeapon + 2 ? s.level * (war ? 1.4 : 0.6) : 0);
      });
      fireLight.intensity = t < tAsh ? (war ? 60 : 24) * (0.8 + 0.2 * Math.sin(ambient * 7.1) * Math.sin(ambient * 3.3)) : 0;
      // Light on the scene.
      if (war) { L.key.color.copy(col("#ff9a5a")); L.key.intensity = 1.0; L.hemi.intensity = 0.35; L.hemi.color.copy(col("#ff8a5a")); }
      else if (t < tAsh) { L.key.color.copy(col("#ffb888")); L.key.intensity = 1.6 + burning * 1.6; L.hemi.intensity = 0.5 + burning * 0.4; L.hemi.color.copy(col("#ffb8a0")); }
      else { L.key.color.copy(col("#fff0e6")); L.key.intensity = ashen ? 0.8 : 0.8 + dawn * 1.2; L.hemi.intensity = 0.7; L.hemi.color.copy(ashen ? col("#d0ccc8") : col("#d0ccc8").lerp(col("#ffd8d0"), dawn)); }
      L.key.position.set(...(war ? ([-60, 30, -80] as Vec3) : ([-200, 40, -160] as Vec3)));
      land.u.uFlash.value = burning * 0.7;
      // The garden and the meadow.
      meadow.u.uPixel.value = px;
      meadow.u.uTime.value = ambient;
      meadow.u.uBloom.value = t < tFire + 1 ? 1e4 : t < tAz ? 0 : -6 + ramp(t, tAz + 0.4, tAz + 6) * 70;
      petals.u.uOpacity.value = t > tAz + 3 ? ramp(t, tAz + 3, tAz + 5) : 0;
      // The weapon rises out of the valley, opens and fires.
      const rise = 1 - Math.pow(1 - ramp(t, tWeapon - 0.6, tWeapon + 2.4), 3);
      weapon.visible = t > tWeapon - 0.8 && t < tAsh;
      weapon.position.y = WPN[1] - 46 * S * (1 - rise);
      const open = ramp(t, tWeapon + 2.2, tWeapon + 4.6);
      const ease = open * open * (3 - 2 * open);
      petalPivots.forEach((p, i) => { p.rotation.x = 0.1 + ease * (1.12 + Math.sin(i * 2.1) * 0.05); });
      petalU.uVein.value = glowUp * (0.8 + 0.2 * Math.sin(ambient * 6)) + spike(t, tFire, 0.1, 1.2) * 1.5;
      charge.u.uK.value = 0.55 + 0.1 * Math.sin(ambient * 2);
      charge.u.uTime.value = ambient;
      charge.u.uOpacity.value = glowUp * (1 - ramp(t, tFire + 0.5, tFire + 2));
      charge.mesh.visible = charge.u.uOpacity.value > 0.001;
      metal.emissiveIntensity = glowUp * 0.12;
      petalMat.emissiveIntensity = glowUp * 0.25;
      core.set("#ffd0ec", glowUp * 0.9 + spike(t, tFire, 0.08, 0.8) * 1.2);
      gather.u.uOpacity.value = t > tWeapon + 2.4 && t < tFire + 0.3 ? ramp(t, tWeapon + 2.4, tWeapon + 4) : 0;
      dust.u.uOpacity.value = t > tWeapon - 0.6 && t < tWeapon + 3.6 ? 1 - ramp(t, tWeapon + 2, tWeapon + 3.6) : 0;
      const fire = ramp(t, tFire, tFire + 0.55);
      beam.mesh.visible = t > tFire && t < tAsh - 0.3;
      beam.mesh.scale.set(1 + spike(t, tFire, 0.1, 1) * 0.8, Math.max(0.001, fire), 1 + spike(t, tFire, 0.1, 1) * 0.8);
      beam.u.uTime.value = ambient;
      beam.u.uOpacity.value = 1 - ramp(t, tAsh - 1.2, tAsh - 0.3);
      pour.u.uTime.value = ambient;
      pour.u.uOpacity.value = t < tAsh ? ramp(t, tFire + 0.7, tFire + 1.3) : 0;
      burn.u.uK.value = ramp(t, tFire + 0.9, tAsh - 0.3);
      burn.u.uTime.value = ambient;
      burn.mesh.visible = t > tFire + 0.9 && t < tAsh;
      // Ash, and the man.
      ash.u.uOpacity.value = ashen ? 0.8 : t >= tAz ? 0.8 * (1 - ramp(t, tAz, tAz + 2)) : 0;
      (az.mat as THREE.MeshStandardMaterial).color.copy(ashen ? col("#5a5458") : col("#4a4054"));
      gardenLight.intensity = war ? 0 : t < tWeapon ? 4 : ashen ? 2.4 : t >= tAz ? 3 : 0;
      gardenLight.color.copy(ashen ? col("#d8d0d0") : col("#ffc8a0"));
      // Floette.
      const present = floettePos(t, ambient);
      if (floette) {
        floette.group.position.copy(FL);
        floette.group.rotation.y = -0.3 + Math.sin(ambient * 0.6) * 0.2;
        const forming = t >= tAsh && t < tAsh + 2.6;
        figureStyle(floette, { dissolve: forming ? ramp(t, tAsh + 1.2, tAsh + 2.4) * present : present, glowK: ashen || t >= tAz ? 0.3 : 0.12 });
      }
      if (reform) {
        reform.u.uForm.value = ramp(t, tAsh + 0.4, tAsh + 2.2);
        reform.u.uTime.value = ambient;
        reform.u.uPixel.value = px;
        reform.u.uOpacity.value = t >= tAsh && t < tAsh + 3 ? 1 - ramp(t, tAsh + 2.2, tAsh + 3) : 0;
      }
      fGlow.sprite.position.set(FL.x, FL.y + 0.25, FL.z);
      fGlow.set("#ff9ac0", present * (ashen || t >= tAz ? 0.55 : 0.3));
    },
    look(t) {
      const ashen = t >= tAsh && t < tAz;
      const L0: Look = lookAt(
        t,
        { bloom: 0.85, bloomRadius: 0.62 },
        {
          exposure: [[0, 0.95], [cutGarden, 1.0], [tWeapon, 1.0], [tFire, 1.0], [tAsh - 0.6, 1.05], [tAsh - 0.05, 1.3], [tAsh, 1.05], [tAsh + 1, 1.0], [tAz, 1.0], [end, 1.02]],
          fade: [[cutGarden - 0.45, 0], [cutGarden - 0.08, 1], [cutGarden + 0.12, 1], [cutGarden + 0.7, 0], [tAz - 0.6, 0], [tAz - 0.12, 1], [tAz + 0.1, 1], [tAz + 0.9, 0]],
          gain: [[0, [1.16, 0.93, 0.8]], [cutGarden, [1.16, 0.93, 0.8]], [cutGarden + 0.1, [1.08, 0.97, 0.94]], [tWeapon + 2, [1.06, 0.94, 1.08]], [tFire, [1.04, 0.96, 1.06]], [tAsh, [1.0, 0.99, 0.98]], [tAz, [1.0, 0.99, 0.98]], [tAz + 3, [1.07, 0.98, 1.0]]],
          lift: [[0, [0.012, 0.004, 0.0]], [tAsh - 0.1, [0.012, 0.004, 0.0]], [tAsh, [0.014, 0.013, 0.012]], [tAz, [0.014, 0.013, 0.012]], [tAz + 3, [0.01, 0.006, 0.01]]],
          saturation: [[0, 1.1], [tAsh - 0.1, 1.05], [tAsh, 0.3], [tAz, 0.3], [tAz + 4, 1.12]],
          contrast: [[0, 1.12], [cutGarden + 0.1, 1.04], [tAsh, 1.04], [tAz, 1.04], [tAz + 3, 1.04]],
          chroma: [[tFire - 0.05, 0], [tFire + 0.1, 0.45], [tFire + 1.4, 0.15], [tAsh - 0.2, 0.3], [tAsh, 0]],
          vignette: [[0, 0.5], [cutGarden + 0.1, 0.42], [tFire, 0.5], [tAsh, 0.3], [tAz + 3, 0.38]],
          bloom: [[0, 0.85], [tWeapon + 2, 0.95], [tFire, 1.05], [tAsh, 0.75], [tAz + 2, 0.85]],
        }
      );
      const white = ramp(t, tAsh - 0.55, tAsh - 0.05);
      L0.flash = t < tAsh ? Math.min(0.92, 0.22 * spike(t, tFire, 0.05, 0.3) + white * white * 0.92) : 0.5 * (1 - ramp(t, tAsh, tAsh + 0.9));
      if (!ashen && t > tWeapon + 2 && t < tAsh) L0.rays = { pos: coreAt, color: [1.0, 0.82, 0.92], strength: 0.7 * ramp(t, tWeapon + 2.4, tFire) * (1 - ramp(t, tFire + 1.6, tAsh)) };
      else if (t >= tAz) L0.rays = { pos: sunPos, color: [1.0, 0.82, 0.78], strength: 0.25 * ramp(t, tAz + 0.5, tAz + 4) };
      return L0;
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};
