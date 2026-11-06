import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeBeam, makeCloudLayer, makeGlow, makeLightning, makeParticles, makeRing, makeSky, makeSunburst, makeTerrain, merge, noise2, placed, ramp, rng, stoneMaterial, strikeAt } from "../kit";
import { makeMeteor, makeRobed } from "../props";
import type { ChapterBuilder, Look } from "../types";
import { actionCurve } from "../figures";
import { cine, craft, figureStyle, floatFigure, lights, loadFigures, lookAt, place, pointPixel, shake, spike } from "./common";

/**
 * V. The Darkest Day. Night over ancient Galar: a meteorite falls (slow
 * motion through the impact) and something stirs in the crater. Ages
 * later a black storm with red pillars of light covers the land. The
 * legend's lone hero stands as a statue, which gives way to what the
 * ruins say: two young heroes, and a sword and shield that were
 * Pokémon. Then the Crown Tundra under an aurora, where Calyrex once
 * reigned.
 */

const ETERNATUS = 890, ZACIAN = 10188, ZAMAZENTA = 10189, CALYREX = 898;
const CRATER: Vec3 = [24, 0, -130];
const CAL: Vec3 = [700, 0, 0];

const lerpC = (out: THREE.Color, a: THREE.Color, b: THREE.Color, k: number) => out.copy(a).lerp(b, k);

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tMet = B("meteorite"), tStorm = B("storm"), tHero = B("hero"), tTwo = B("two"), tCal = B("calyrex");
  const end = ctx.timing.anim;
  const tImpact = tMet + 1.75;
  const cutStatue = tHero - 0.4;
  const cutTundra = tCal - 0.4;
  const scene = new THREE.Scene();
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));
  const nz = noise2(57);
  const r = rng(91);

  // ---- Sky: a clear night, the black storm, a breaking dawn; the tundra's aurora.
  const sky = makeSky({ top: "#040814", horizon: "#1a2a44", bottom: "#030408", nebulaA: "#2a3a6a", nebulaB: "#6a2a5a", nebula: 0.25, nebulaScale: 1.4, stars: 0.06, sunDir: [0.2, 0.08, -1], sunColor: "#000000", sunSize: 600, sunGlow: 0, swirl: 0 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  const SKY = {
    night: [col("#040814"), col("#1a2a44"), col("#030408")],
    storm: [col("#040103"), col("#2a050a"), col("#010101")],
    dawn: [col("#22365e"), col("#c87a4a"), col("#141420")],
    tundra: [col("#06102a"), col("#2a4a6a"), col("#0a1020")],
  };
  const fog = new THREE.FogExp2(col("#0a1220"), 0.004);
  scene.fog = fog;

  // ---- The moor.
  const moor = (x: number, z: number) => nz.fbm(x * 0.008 + 2, z * 0.008) * 30 - 10 + nz.fbm(x * 0.05, z * 0.05) * 2;
  const craterCut = (x: number, z: number) => {
    const d = Math.hypot(x - CRATER[0], z - CRATER[2]);
    return -Math.max(0, 1 - (d / 26) ** 2) * 14 + Math.exp(-(((d - 26) / 6) ** 2)) * 5;
  };
  const base = (x: number, z: number) => (moor(x, z) - moor(0, 0)) * Math.min(1, Math.hypot(x, z) / 60);
  const gh = (x: number, z: number) => base(x, z) + craterCut(x, z);
  const land = makeTerrain({
    size: [700, 560], segments: Math.round(q.grid * 0.8), height: (x, z) => gh(x, z - 120),
    color: (h, slope, x, z) => {
      const d = Math.hypot(x - CRATER[0], z - 120 - CRATER[2]);
      if (d < 30) return [0.12, 0.08, 0.09];
      return slope > 0.4 ? [0.22, 0.2, 0.18] : h > 6 ? [0.2, 0.22, 0.13] : [0.14, 0.2, 0.1];
    },
    lava: { color: "#ff1f5a", scale: 0.09, width: 0.05, intensity: 0, below: -2 },
    center: [0, 0, -120], roughness: 0.95,
  });
  scene.add(land.mesh);
  disposers.push(land.dispose);

  // ---- The meteorite.
  const meteor = makeMeteor({ size: 3, color: "#ff6a8a", trail: 90 });
  scene.add(meteor.group, meteor.sparks.points);
  disposers.push(meteor.dispose);
  const M0 = new THREE.Vector3(-260, 240, -420), M1 = new THREE.Vector3(CRATER[0], gh(CRATER[0], CRATER[2]) + 1, CRATER[2]);
  const mdir = M1.clone().sub(M0).normalize();
  const shock = makeRing({ color: "#ffb0c8", intensity: 3.4, thickness: 0.05 });
  shock.mesh.rotation.x = -Math.PI / 2;
  shock.mesh.position.set(CRATER[0], 3, CRATER[2]);
  shock.mesh.scale.setScalar(260);
  scene.add(shock.mesh);
  disposers.push(shock.dispose);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), new THREE.MeshBasicMaterial({ color: col("#ff8ab0", 0.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  dome.position.copy(M1);
  scene.add(dome);
  disposers.push(() => { dome.geometry.dispose(); (dome.material as THREE.Material).dispose(); });
  const debris = makeParticles({ count: P(2000), shape: "sphere", center: [CRATER[0], 4, CRATER[2]], extent: [5, 3, 5], velocity: [0, 26, 0], spread: [30, 18, 30], gravity: [0, -9.8, 0], life: 5, size: [0.35, 1.2], colors: ["#ffd8c0", "#ff6a50", "#3a1a1a"], intensity: 1.3, burst: true, fadeOut: 0.5, seed: 3 });
  const craterGlow = makeParticles({ count: P(900), shape: "disc", center: [CRATER[0], -6, CRATER[2]], extent: [18, 2, 18], velocity: [0, 3, 0], spread: [1, 1, 1], life: 4, size: [0.15, 0.45], colors: ["#ffb0d0", "#ff3a7a", "#8a0a3a"], intensity: 2.4, turbulence: 0.9, flicker: 0.4, seed: 4 });
  [debris, craterGlow].forEach((p) => { scene.add(p.points); disposers.push(p.dispose); });
  // The impact itself: a burst of light with rays, a fireball, a column of smoke and dust, and standing stones in the foreground for scale.
  const blast = makeSunburst({ size: 260, color: "#ff8ab8", core: "#fff0f6", intensity: 0, rays: 13, coreK: 0.7, seed: 5 });
  blast.mesh.position.set(CRATER[0], 6, CRATER[2]);
  scene.add(blast.mesh);
  disposers.push(blast.dispose);
  const fireball = makeGlow({ pos: [CRATER[0], 8, CRATER[2]], size: 70, color: "#ffc0d8", intensity: 0 });
  scene.add(fireball.sprite);
  disposers.push(fireball.dispose);
  const plume = makeParticles({ count: P(260), shape: "sphere", center: [CRATER[0], 4, CRATER[2]], extent: [6, 3, 6], velocity: [0, 16, 0], spread: [16, 7, 16], gravity: [0, -2.5, 0], life: 7, size: [7, 18], colors: ["#3a1420", "#5a2232", "#1e0a12"], intensity: 0.55, additive: false, burst: true, fadeIn: 0.05, fadeOut: 0.6, seed: 14 });
  scene.add(plume.points);
  disposers.push(plume.dispose);
  const megalithMat = stoneMaterial({ color: "#3a3638", roughness: 0.9, dirt: 0.6 });
  const MEG: [number, number, number, number][] = [[-9, -46, 7, 0.2], [-5, -47, 5.5, -0.1], [15, -42, 8.5, 0.35], [19, -58, 6, -0.2], [-16, -64, 6.5, 0.1]];
  const megaliths = new THREE.Mesh(merge(MEG.map(([x, z, h, a]) => placed(new THREE.BoxGeometry(2.2, h, 1.4), [x, gh(x, z) + h / 2 - 0.6, z], a, [1, 1, 1], 0, a * 0.15))), megalithMat);
  scene.add(megaliths);
  disposers.push(() => { megaliths.geometry.dispose(); megalithMat.dispose(); });
  const redLight = new THREE.PointLight(col("#ff2a6a"), 0, 300, 1);
  redLight.position.set(CRATER[0], 6, CRATER[2] + 6);
  scene.add(redLight);

  // ---- The Darkest Day: a black vortex with a red eye, pillars of red light, red lightning.
  const storm = makeCloudLayer({ size: 1100, y: 95, color: "#2a0a14", shadow: "#000000", density: 0.85, scale: 0.007, speed: [4, 0, 2], intensity: 1 });
  storm.mesh.position.set(CRATER[0], 95, CRATER[2]);
  storm.u.uHoleGlow.value.copy(col("#ff1f4a", 0.9));
  scene.add(storm.mesh);
  disposers.push(storm.dispose);
  const PIL: Vec3[] = [];
  for (let i = 0; i < 9; i++) {
    const x = -220 + (i / 8) * 440 + (r() - 0.5) * 40, z = -150 - r() * 160;
    PIL.push([x, gh(x, z) - 1, z]);
  }
  const pillars = PIL.map((p, i) => {
    const b = makeBeam({ from: p, to: [p[0], 260, p[2]], radius: 2 + (i % 3) * 0.8, color: "#ff1838", intensity: 1.1 });
    scene.add(b.mesh);
    disposers.push(b.dispose);
    return b;
  });
  const surge = makeParticles({ count: P(1800), shape: "cylinder", center: [0, 30, -230], extent: [260, 30, 90], velocity: [0, 9, 0], spread: [1, 3, 1], life: 5, size: [0.25, 0.7], colors: ["#ffb0c0", "#ff2a4a", "#6a0a1a"], intensity: 1.2, turbulence: 1.2, seed: 5 });
  scene.add(surge.points);
  disposers.push(surge.dispose);
  const bolts = [makeLightning({ color: "#ff4a6a", width: 0.9, intensity: 6, branches: 5 }), makeLightning({ color: "#ff8aa0", width: 0.7, intensity: 5, branches: 4 })];
  bolts.forEach((b) => { scene.add(b.mesh); disposers.push(b.dispose); });
  const lastBolt = [-1, -1];

  // ---- The legend: a statue of one hero.
  const SPOT: Vec3 = [0, gh(0, 0), 0];
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 2.2, 8), stoneMaterial({ color: "#7a746c", roughness: 0.8, dirt: 0.4 }));
  pedestal.position.set(SPOT[0], SPOT[1] + 1.1, SPOT[2]);
  scene.add(pedestal);
  disposers.push(() => { pedestal.geometry.dispose(); (pedestal.material as THREE.Material).dispose(); });
  const statue = makeRobed({ height: 5.2, color: "#8a847a", sword: true, shield: true, stone: true });
  statue.mesh.position.set(SPOT[0], SPOT[1] + 2.2, SPOT[2]);
  scene.add(statue.mesh);
  disposers.push(statue.dispose);
  const crumble = makeParticles({ count: P(2400), shape: "cylinder", center: [SPOT[0], SPOT[1] + 4.8, SPOT[2]], extent: [1.4, 2.6, 1.4], velocity: [0, 1.2, 0], spread: [2.4, 1.6, 2.4], gravity: [0, -4, 0], life: 3, size: [0.04, 0.12], colors: ["#fff4d8", "#c8b89a", "#8a7a64"], intensity: 1.6, burst: true, fadeOut: 0.6, seed: 6 });
  scene.add(crumble.points);
  disposers.push(crumble.dispose);
  // What the ruins say: two youths.
  const youths = [makeRobed({ height: 1.75, color: "#3a4a8a", emissive: "#6a8aff", emissiveK: 0 }), makeRobed({ height: 1.7, color: "#8a3a4a", emissive: "#ff8a6a", emissiveK: 0 })];
  youths.forEach((y, i) => {
    y.mesh.position.set(SPOT[0] + (i ? 1.4 : -1.4), SPOT[1], SPOT[2] + 3.4);
    y.mesh.rotation.y = i ? -0.2 : 0.2;
    (y.mat as THREE.MeshStandardMaterial).transparent = true;
    scene.add(y.mesh);
    disposers.push(y.dispose);
  });
  const goldRing = makeRing({ color: "#ffe2a0", intensity: 2, thickness: 0.05 });
  goldRing.mesh.rotation.x = -Math.PI / 2;
  goldRing.mesh.position.set(SPOT[0], SPOT[1] + 0.3, SPOT[2] + 2);
  goldRing.mesh.scale.setScalar(70);
  scene.add(goldRing.mesh);
  disposers.push(goldRing.dispose);
  const motes = makeParticles({ count: P(900), shape: "box", center: [SPOT[0], SPOT[1] + 3, SPOT[2] + 2], extent: [9, 3, 5], velocity: [0, 0.4, 0], spread: [0.2, 0.2, 0.2], life: 6, size: [0.03, 0.08], colors: ["#fff6d8", "#ffd27a", "#8ab8ff"], intensity: 1.8, turbulence: 0.6, seed: 7 });
  scene.add(motes.points);
  disposers.push(motes.dispose);

  // ---- The Crown Tundra.
  const tundra = makeTerrain({
    size: [240, 200], segments: Math.round(q.grid * 0.5),
    height: (x, z) => nz.fbm(x * 0.02 + 9, z * 0.02) * 12 - 4 + Math.max(0, -z - 40) * 0.25,
    color: (h, slope) => (slope > 0.5 ? [0.5, 0.55, 0.62] : [0.82, 0.86, 0.92]),
    center: [CAL[0], -2, CAL[2] - 40], roughness: 0.75,
  });
  scene.add(tundra.mesh);
  disposers.push(tundra.dispose);
  const snow = makeParticles({ count: P(2600), shape: "box", center: [CAL[0], 6, CAL[2]], extent: [26, 8, 22], velocity: [0.6, -1.1, 0.2], spread: [0.3, 0.2, 0.3], life: 9, size: [0.03, 0.08], colors: ["#ffffff", "#dfe8ff", "#b8c8ff"], intensity: 1.3, turbulence: 0.6, seed: 8 });
  const crownMotes = makeParticles({ count: P(500), shape: "sphere", center: [CAL[0], 3, CAL[2]], extent: [2.4, 2.4, 2.4], velocity: [0, 0.3, 0], spread: [0.2, 0.2, 0.2], life: 4, size: [0.03, 0.07], colors: ["#e8fff0", "#7affc8", "#b88aff"], intensity: 1.2, swirl: 0.6, seed: 9 });
  [snow, crownMotes].forEach((p) => { scene.add(p.points); disposers.push(p.dispose); });
  const calGlow = makeGlow({ pos: [CAL[0], 3, CAL[2]], size: 5, color: "#9affd0", intensity: 0 });
  scene.add(calGlow.sprite);
  disposers.push(calGlow.dispose);

  // ---- Light.
  const L = lights(scene, { sky: "#7a90d0", ground: "#141018", fill: 0.6, key: "#a8c0ff", keyK: 1.1, keyPos: [-40, 50, 40], rim: "#ff8ab0", rimK: 0.4, rimPos: [30, 20, -80] });

  // ---- Figures.
  const figs = await loadFigures(ctx, [ETERNATUS, ZACIAN, ZAMAZENTA, CALYREX]);
  const eter = figs.get(ETERNATUS), zac = figs.get(ZACIAN), zam = figs.get(ZAMAZENTA), cal = figs.get(CALYREX);
  const ET: Vec3 = [CRATER[0], gh(CRATER[0], CRATER[2]) - 2, CRATER[2]];
  place(eter, ET, 16, 0.2, scene);
  figureStyle(eter, { rim: "#ff3a7a", rimK: 2, glow: "#ff1f5a", glowK: 0.15, edge: "#ff8ab0", dissolve: 0, shadow: 0.55 });
  const ZA: Vec3 = [SPOT[0] - 4.2, SPOT[1], SPOT[2] + 1.6], ZM: Vec3 = [SPOT[0] + 4.2, SPOT[1], SPOT[2] + 1.6];
  place(zac, ZA, 3.3, 0.35, scene);
  figureStyle(zac, { rim: "#a8c8ff", rimK: 1.6, glow: "#ffd27a", glowK: 0.05, edge: "#fff0b0", dissolve: 0 });
  place(zam, ZM, 3.3, -0.35, scene);
  figureStyle(zam, { rim: "#ffb0a0", rimK: 1.6, glow: "#ffd27a", glowK: 0.05, edge: "#fff0b0", dissolve: 0 });
  const CA: Vec3 = [CAL[0], 1.2, CAL[2]];
  const sh = craft(ctx, L, {
    radius: 40, center: [CRATER[0], 0, CRATER[2]],
    receive: [land.mesh, tundra.mesh, pedestal],
    cast: [pedestal],
    figures: [[eter, { ground: null, alive: 0.8, depth: 1.5 }], [zac, { ground: SPOT[1], alive: 0.9 }], [zam, { ground: SPOT[1], alive: 0.9 }], [cal, { ground: 0, alive: 1 }]],
    detail: [[land.mesh.material, { kind: "ground", scale: 0.8, bump: 1.3 }], [tundra.mesh.material, { kind: "ground", scale: 1.2, bump: 0.8, tint: 0.05 }], [pedestal.material as THREE.Material, { kind: "stone", scale: 2, bump: 0.9 }]],
  });
  place(cal, CA, 2.4, 0, scene);
  figureStyle(cal, { rim: "#c8ffe8", rimK: 1.0, glow: "#7affc8", glowK: 0.04 });

  const keys: Key[] = [
    { t: 0, pos: [0, 16, 86], look: [-30, 46, -200], fov: 52 },
    { t: tMet, pos: [-6, 11, 58], look: [-10, 28, -170], fov: 50 },
    { t: tImpact - 0.3, pos: [0, 5.5, -26], look: [21, 12, -125], fov: 48 },
    { t: tImpact + 1.6, pos: [5, 5.5, -40], look: [22, 14, -125], fov: 46 },
    { t: tStorm - 0.6, pos: [16, 7, -72], look: [24, 10, -128], fov: 46 },
    { t: tStorm, pos: [0, 34, 130], look: [14, 42, -150], fov: 56 },
    { t: tStorm + 4, pos: [-24, 10, 52], look: [20, 34, -150], fov: 52 },
    { t: cutStatue, pos: [-30, 8, 40], look: [20, 30, -150], fov: 52 },
    { t: cutStatue + 0.01, pos: [1.5, 2.2, 15], look: [0, 6.2, 0], fov: 40 },
    { t: tTwo - 0.6, pos: [4, 1.6, 9.5], look: [0, 6.5, 0], fov: 38 },
    { t: tTwo + 0.4, pos: [0, 2.4, 12.5], look: [0, 2.6, 0], fov: 42 },
    { t: cutTundra, pos: [-3.4, 2.8, 14], look: [0, 2.4, 0], fov: 42 },
    { t: cutTundra + 0.01, pos: [CAL[0] + 1, 2.2, CAL[2] + 8.5], look: [CAL[0], 2.6, CAL[2]], fov: 38 },
    { t: end, pos: [CAL[0] + 3.4, 3.4, CAL[2] + 12], look: [CAL[0], 3, CAL[2]], fov: 42 },
  ];

  const stormK = (t: number) => ramp(t, tStorm - 0.8, tStorm + 1.6) * (1 - ramp(t, tTwo - 0.2, tTwo + 2.4));
  const lightning = (t: number) => (stormK(t) > 0.3 && t < tTwo ? Math.max(strikeAt(t, 1.3, 5).level, strikeAt(t + 0.5, 1.9, 9).level * 0.8) : 0);

  return {
    scene,
    portalScale: 5,
    camera: (t) => shake(poseOnPath(keys, t), t, [{ at: tImpact, k: 0.45, dur: 2.6 }, { at: tStorm + 0.6, k: 0.08, dur: 2 }, { at: tTwo, k: 0.05 }]),
    orbit: (t) => ({ target: t < tStorm ? [CRATER[0], 6, CRATER[2]] : t < cutStatue ? [10, 30, -150] : t < cutTundra ? [0, 3, 0] : [CAL[0], 2.6, CAL[2]], limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.15, maxPitch: 1.0, minDist: 3, maxDist: 220 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const tund = t >= cutTundra;
      const sk = stormK(t);
      const dawn = ramp(t, tTwo - 0.4, tTwo + 3);
      const lv = lightning(t);
      // Sky.
      const [top, hor, bot] = [sky.u.uTop.value, sky.u.uHorizon.value, sky.u.uBottom.value];
      if (tund) { lerpC(top, SKY.tundra[0], SKY.tundra[0], 0); lerpC(hor, SKY.tundra[1], SKY.tundra[1], 0); lerpC(bot, SKY.tundra[2], SKY.tundra[2], 0); }
      else if (t < tTwo - 0.4) { lerpC(top, SKY.night[0], SKY.storm[0], sk); lerpC(hor, SKY.night[1], SKY.storm[1], sk); lerpC(bot, SKY.night[2], SKY.storm[2], sk); }
      else { lerpC(top, SKY.storm[0], SKY.dawn[0], dawn); lerpC(hor, SKY.storm[1], SKY.dawn[1], dawn); lerpC(bot, SKY.storm[2], SKY.dawn[2], dawn); }
      sky.u.uNebA.value.copy(tund ? col("#2aff9a") : col("#2a3a6a"));
      sky.u.uNebB.value.copy(tund ? col("#8a4aff") : col("#6a2a5a"));
      sky.u.uNeb.value = tund ? 0.9 : 0.25 * (1 - sk);
      sky.u.uNebScale.value = tund ? 0.9 : 1.4;
      sky.u.uStars.value = tund ? 0.05 : 0.06 * (1 - sk) * (1 - dawn);
      sky.u.uSunColor.value.copy(t < tStorm && !tund ? col("#cfd8ff", 0.6 * (1 - sk)) : col("#ffb878", tund ? 0 : dawn * 0.7));
      sky.u.uSunSize.value = t < tStorm && !tund ? 3000 : 600;
      sky.u.uSunDir.value.set(...((t < tStorm && !tund ? [-0.5, 0.35, -1] : [0.85, 0.08, -0.5]) as Vec3)).normalize();
      sky.u.uSunGlow.value = tund ? 0 : dawn * 0.22;
      sky.u.uFlash.value = lv * 0.3 + spike(t, tImpact, 0.03, 0.3) * 0.3;
      sky.u.uFlashColor.value.copy(t > tStorm - 1 ? col("#ff4a6a") : col("#ffd0e0"));
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      fog.color.copy(tund ? col("#1a2a44") : col("#0a1220").lerp(col("#1a0408"), sk).lerp(col("#6a5a5a"), dawn));
      fog.density = tund ? 0.012 : 0.004 + sk * 0.002;
      // The meteorite and the impact (slow motion through it).
      const fall = ramp(t, tMet - 0.6, tImpact);
      const flying = t < tImpact && t > tMet - 0.6;
      meteor.group.visible = flying;
      meteor.sparks.points.visible = flying;
      if (flying) {
        meteor.at(M0.clone().lerp(M1, fall * fall), mdir.clone().negate());
        meteor.u.uTime.value = ambient;
        meteor.sparks.u.uTime.value = ambient;
        meteor.sparks.u.uPixel.value = px;
      }
      const after = t - tImpact;
      shock.u.uK.value = ramp(t, tImpact, tImpact + 3.2);
      shock.u.uTime.value = ambient;
      shock.mesh.visible = after > 0 && after < 3.3 && !tund;
      const dk = ramp(t, tImpact, tImpact + 1.4);
      dome.visible = after > 0 && after < 1.5;
      dome.scale.setScalar(4 + dk * 60);
      (dome.material as THREE.MeshBasicMaterial).opacity = (1 - dk) * (1 - dk) * 0.45;
      const bk = after > 0 && !tund ? spike(t, tImpact, 0.04, 1.4) : 0;
      blast.mesh.visible = bk > 0.002;
      blast.u.uIntensity.value = 0.8 * bk;
      blast.u.uK.value = 0.35 + 0.65 * ramp(t, tImpact, tImpact + 1.2);
      blast.u.uTime.value = ambient;
      blast.mesh.quaternion.copy(cam.quaternion);
      fireball.set("#ffb0d0", 0.9 * bk + 0.25 * ramp(t, tImpact, tImpact + 0.3) * (1 - ramp(t, tImpact + 0.6, tImpact + 3)));
      fireball.sprite.scale.setScalar(40 + 50 * ramp(t, tImpact, tImpact + 1.5));
      plume.u.uTime.value = Math.max(0, after);
      plume.u.uPixel.value = px;
      plume.u.uOpacity.value = after > 0 && t < tStorm + 1 && !tund ? 1 - ramp(t, tStorm - 1, tStorm + 1) : 0;
      megaliths.visible = !tund && t < cutStatue;
      debris.u.uTime.value = Math.max(0, after);
      debris.u.uPixel.value = px;
      debris.u.uOpacity.value = after > 0 && t < tStorm + 2 ? 1 : 0;
      const smoulder = after > 0 && !tund ? ramp(t, tImpact + 0.6, tImpact + 2.4) : 0;
      craterGlow.u.uTime.value = ambient;
      craterGlow.u.uPixel.value = px;
      craterGlow.u.uOpacity.value = smoulder * (1 - ramp(t, tTwo - 0.5, tTwo + 2));
      land.u.uTime.value = ambient;
      land.u.uLavaK.value = 5 * smoulder * (1 - ramp(t, tTwo, tTwo + 3)) + sk * 2;
      land.u.uFlash.value = spike(t, tImpact, 0.04, 0.5) * 0.6 + lv * 0.2;
      redLight.intensity = tund ? 0 : 40 * smoulder * (0.85 + 0.15 * Math.sin(ambient * 4)) + sk * 30 + 400 * (after > 0 ? spike(t, tImpact, 0.04, 1.2) : 0);
      redLight.color.copy(col("#ff2a6a").lerp(col("#ffd0e0"), after > 0 ? spike(t, tImpact, 0.04, 0.8) : 0));
      // Inside it, something.
      if (eter) {
        const emerge = ramp(t, tImpact + 1.2, tStorm - 1.2);
        eter.group.position.set(ET[0], ET[1] + emerge * 4 + Math.sin(ambient * 0.7) * 0.3, ET[2]);
        figureStyle(eter, { dissolve: tund || t > tStorm + 1.4 ? 0 : emerge * (1 - ramp(t, tStorm - 0.2, tStorm + 1.4)), glowK: 0.15 + 0.1 * Math.sin(ambient * 3), act: actionCurve(t, tStorm - 0.6, { pre: 1.0, post: 1.2 }), flex: 0.7 });
      }
      // The black storm and the red pillars.
      storm.mesh.visible = sk > 0.001 && !tund;
      storm.mesh.rotation.y = ambient * 0.03;
      storm.u.uTime.value = ambient;
      storm.u.uOpacity.value = sk;
      storm.u.uFlash.value = lv;
      storm.u.uHole.value.set(CRATER[0], CRATER[2], 34 + Math.sin(ambient * 0.5) * 3);
      pillars.forEach((p, i) => {
        const k = ramp(t, tStorm + 0.4 + i * 0.35, tStorm + 1.4 + i * 0.35) * (1 - ramp(t, tTwo - 0.3 + i * 0.1, tTwo + 1.2 + i * 0.1));
        p.mesh.visible = k > 0.001 && !tund;
        p.mesh.scale.set(1, Math.max(0.001, k), 1);
        p.u.uTime.value = ambient + i;
        p.u.uOpacity.value = k * (0.75 + 0.25 * Math.sin(ambient * 3 + i));
      });
      surge.u.uTime.value = ambient;
      surge.u.uPixel.value = px;
      surge.u.uOpacity.value = tund ? 0 : sk;
      [strikeAt(t, 1.3, 5), strikeAt(t + 0.5, 1.9, 9)].forEach((s, i) => {
        const b = bolts[i];
        if (s.level > 0 && sk > 0.3 && s.id !== lastBolt[i]) {
          lastBolt[i] = s.id;
          const rr = rng(s.id * 13 + i * 5 + 2);
          const x = -120 + rr() * 260, z = -260 + rr() * 160;
          b.strike([x, 92, z], [x + (rr() - 0.5) * 30, gh(x, z), z + (rr() - 0.5) * 20], s.id + i * 500, cam.position);
        }
        b.u.uAlpha.value = sk > 0.3 && t < tTwo ? s.level : 0;
      });
      // The statue, then the two.
      const reveal = ramp(t, tTwo - 0.25, tTwo + 1.4);
      const plaza = t >= cutStatue && !tund;
      statue.mesh.visible = plaza && t < tTwo - 0.1;
      pedestal.visible = plaza;
      crumble.u.uTime.value = Math.max(0, t - (tTwo - 0.15));
      crumble.u.uPixel.value = px;
      crumble.u.uOpacity.value = t > tTwo - 0.15 && t < tTwo + 3.2 && !tund ? 1 : 0;
      youths.forEach((y, i) => {
        const m = y.mat as THREE.MeshStandardMaterial;
        m.opacity = ramp(t, tTwo + 0.1 + i * 0.15, tTwo + 1.2 + i * 0.15);
        m.emissiveIntensity = 0.5 * spike(t, tTwo + 0.2, 0.2, 1.4) + 0.05;
        y.mesh.visible = m.opacity > 0.001 && plaza;
      });
      // The two break out of the stone: a crouch, a spring up, a settle into their stance.
      if (zac) { floatFigure(zac, ZA, ambient, 0.03, 0, 0.35, 0.02); figureStyle(zac, { dissolve: plaza ? reveal : 0, glowK: 0.05 + 0.3 * spike(t, tTwo + 0.3, 0.2, 1.4), act: actionCurve(t, tTwo + 0.35, { pre: 0.4, post: 0.8 }) }); }
      if (zam) { floatFigure(zam, ZM, ambient, 0.03, 1, -0.35, 0.02); figureStyle(zam, { dissolve: plaza ? ramp(t, tTwo - 0.1, tTwo + 1.6) : 0, glowK: 0.05 + 0.3 * spike(t, tTwo + 0.4, 0.2, 1.4), act: actionCurve(t, tTwo + 0.5, { pre: 0.4, post: 0.8 }) }); }
      goldRing.u.uK.value = ramp(t, tTwo, tTwo + 1.8);
      goldRing.u.uTime.value = ambient;
      goldRing.mesh.visible = t > tTwo && t < tTwo + 1.9 && !tund;
      motes.u.uTime.value = ambient;
      motes.u.uPixel.value = px;
      motes.u.uOpacity.value = !tund && t > cutStatue ? 0.5 + 0.5 * reveal : 0;
      // The tundra.
      snow.u.uTime.value = ambient;
      snow.u.uPixel.value = px;
      snow.u.uOpacity.value = tund ? 1 : 0;
      crownMotes.u.uTime.value = ambient;
      crownMotes.u.uPixel.value = px;
      crownMotes.u.uOpacity.value = tund ? ramp(t, cutTundra + 0.6, cutTundra + 2) : 0;
      calGlow.set("#9affd0", tund ? 0.15 + 0.04 * Math.sin(ambient * 1.3) : 0);
      if (cal) floatFigure(cal, CA, ambient, 0.12, 0.5, 0, 0.05);
      sh.follow(tund ? [CA[0], 0, CA[2]] : plaza ? [SPOT[0], SPOT[1], SPOT[2]] : [CRATER[0], 0, CRATER[2]], tund ? 9 : plaza ? 10 : 40);
      // Light.
      if (tund) { L.key.color.copy(col("#c8d8ff")); L.key.intensity = 1.4; L.hemi.intensity = 0.8; L.hemi.color.copy(col("#9ab8ff")); L.key.position.set(CAL[0] - 30, 40, 30); }
      else if (t < cutStatue) { L.key.color.copy(col("#a8c0ff").lerp(col("#ff4a6a"), sk)); L.key.intensity = 1.1 + lv * 1.6; L.hemi.intensity = 0.6 - sk * 0.25; L.hemi.color.copy(col("#7a90d0").lerp(col("#8a3040"), sk)); L.key.position.set(-40, 50, 40); }
      else { L.key.color.copy(col("#ff6a6a").lerp(col("#ffd8a0"), dawn)); L.key.intensity = 1.2 + dawn * 1.4; L.hemi.intensity = 0.35 + dawn * 0.4; L.hemi.color.copy(col("#8a90c0").lerp(col("#ffd0b0"), dawn)); L.key.position.set(60, 40, 40); }
    },
    look(t) {
      const tund = t >= cutTundra;
      const lv = lightning(t);
      const L0: Look = lookAt(
        t,
        { bloom: 0.8, bloomRadius: 0.6 },
        {
          exposure: [[0, 0.95], [tImpact, 1.0], [tStorm, 0.95], [cutStatue, 1.0], [tTwo, 1.05], [cutTundra, 1.0], [end, 1.02]],
          fade: [[cutStatue - 0.45, 0], [cutStatue - 0.08, 1], [cutStatue + 0.12, 1], [cutStatue + 0.7, 0], [cutTundra - 0.45, 0], [cutTundra - 0.08, 1], [cutTundra + 0.12, 1], [cutTundra + 0.7, 0]],
          gain: [[0, [0.92, 0.98, 1.12]], [tImpact, [1.06, 0.96, 1.04]], [tStorm, [1.14, 0.9, 0.92]], [cutStatue, [1.1, 0.94, 0.92]], [tTwo, [1.1, 1.0, 0.9]], [cutTundra - 0.1, [1.08, 1.0, 0.92]], [cutTundra, [0.92, 1.0, 1.12]]],
          lift: [[0, [0.0, 0.004, 0.012]], [tStorm, [0.01, 0.0, 0.002]], [cutTundra, [0.0, 0.008, 0.016]]],
          saturation: [[0, 1.05], [tStorm, 1.15], [tTwo, 1.12], [cutTundra, 1.0]],
          contrast: [[0, 1.08], [tStorm, 1.16], [tTwo, 1.05], [cutTundra, 1.02]],
          chroma: [[tImpact - 0.05, 0], [tImpact, 0.5], [tImpact + 1.2, 0], [tTwo - 0.05, 0], [tTwo + 0.2, 0.2], [tTwo + 1.2, 0]],
          vignette: [[0, 0.42], [tStorm, 0.55], [tTwo, 0.4], [cutTundra, 0.45]],
          bloom: [[0, 0.8], [tImpact, 1.0], [tImpact + 2, 0.85], [tStorm, 0.85], [tTwo, 0.9], [cutTundra, 0.9]],
        }
      );
      L0.flash = Math.min(0.35, 0.25 * spike(t, tImpact, 0.03, 0.22) + lv * 0.08 + 0.12 * spike(t, tTwo, 0.1, 0.5));
      if (!tund && t > tImpact && t < tStorm) L0.rays = { pos: [CRATER[0], 6, CRATER[2]], color: [1.0, 0.5, 0.7], strength: 0.6 * ramp(t, tImpact, tImpact + 0.4) * (1 - ramp(t, tStorm - 1, tStorm)) };
      else if (!tund && t > cutStatue) L0.rays = { pos: [700, 40, -400], color: [1.0, 0.86, 0.6], strength: 0.1 + 0.18 * ramp(t, tTwo - 0.3, tTwo + 1.5) };
      else if (tund) L0.rays = { pos: [CAL[0], 3, CAL[2]], color: [0.7, 1.0, 0.85], strength: 0.15 };
      const plaza = t >= cutStatue && !tund;
      const fog: Look["fog"] = tund
        ? { color: [0.4, 0.48, 0.6], density: 0.015, height: 0, falloff: 0.18, sky: 0.4 }
        : plaza ? { color: [0.42, 0.32, 0.28], density: 0.012, height: 0, falloff: 0.3, sun: { dir: [0.7, 0.45, 0.5], color: [0.5, 0.35, 0.2] }, sky: 0.3 }
        : t > tImpact ? { color: [0.1, 0.02, 0.04], density: 0.0025, height: 0, falloff: 0.05, sun: { dir: [0.16, 0.0, -0.99], color: [0.6, 0.12, 0.25] }, sky: 0.15 }
        : { color: [0.02, 0.025, 0.05], density: 0.0025, height: 0, falloff: 0.05, sky: 0.15 };
      const focus: Vec3 = tund ? CA : plaza ? [SPOT[0], SPOT[1] + 2, SPOT[2]] : [CRATER[0], 4, CRATER[2]];
      return cine(L0, { fog, dof: { focus, k: 0.25 }, streak: 0.15 + 0.35 * spike(t, tImpact, 0.03, 1.6), streakColor: [1.0, 0.55, 0.75], black: tund ? 0.03 : 0.05, bloomCap: 3.5 });
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};
