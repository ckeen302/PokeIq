import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeCloudLayer, makeConverge, makeGlow, makeLightning, makeOcean, makeParticles, makeRing, makeShaft, makeSky, makeStreaks, makeTerrain, noise2, ramp, rng, strikeAt } from "../kit";
import { makeLanterns, makeMeteor } from "../props";
import type { ChapterBuilder, Look } from "../types";
import { billboard, figureStyle, lights, loadFigures, lookAt, place, pointPixel, shake, spike } from "./common";

/**
 * III. The Primal Clash. A drowned world in a storm: Primal Groudon raises
 * burning land on one side, Primal Kyogre heaves the sea up on the other,
 * lightning between them. The clouds tear open in emerald light and
 * Rayquaza descends (in slow motion) and the storm breaks. A cut to a
 * night of falling meteoroids: one strikes the sea and raises the crater
 * that became Sootopolis; above it, Rayquaza Mega Evolves; then dawn and
 * a thousand years of peace.
 */

const GROUDON = 10078, KYOGRE = 10077, RAY = 384, MEGA = 10079;
const IMPACT: Vec3 = [16, 0, -84];
const RQ_NIGHT: Vec3 = [12, 27, -86];

const lerpC = (out: THREE.Color, a: THREE.Color, b: THREE.Color, k: number) => out.copy(a).lerp(b, k);

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tClash = B("clash"), tRay = B("rayquaza"), tSoot = B("sootopolis"), tPeace = B("peace");
  const end = ctx.timing.anim;
  const tCalm = tRay + 3.0;
  const cut = tSoot - 0.45;
  const tImpact = tSoot + 2.4;
  const tMega = tSoot + 6.2;
  const scene = new THREE.Scene();
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));
  const nz = noise2(23);

  // ---- Sky: storm, then night, then dawn.
  const sky = makeSky({ top: "#0a0e18", horizon: "#3c2a2c", bottom: "#05060a", nebulaA: "#20283a", nebulaB: "#3a1a14", nebula: 0.0, stars: 0.05, sunDir: [0.9, 0.05, -0.45], sunColor: "#000000", sunSize: 500, sunGlow: 0 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  const SKY = {
    storm: [col("#0a0e18"), col("#3c2a2c"), col("#05060a")],
    calm: [col("#16243a"), col("#5a6a78"), col("#0a0e14")],
    night: [col("#02040c"), col("#141c38"), col("#020308")],
    dawn: [col("#18305a"), col("#c0603a"), col("#101220")],
  };
  const fog = new THREE.FogExp2(col("#1a1a22"), 0.006);
  scene.fog = fog;
  const FOG = { storm: col("#1c1a20"), calm: col("#323e4a"), night: col("#060914"), dawn: col("#5a4450") };

  // ---- The sea, swelling around Kyogre.
  const ocean = makeOcean({ size: 1000, segments: q.grid, waves: [{ dir: [1, 0.25], steep: 0.2, length: 34 }, { dir: [-0.3, 1], steep: 0.15, length: 19 }, { dir: [0.8, -0.6], steep: 0.1, length: 9 }, { dir: [0.1, 1], steep: 0.06, length: 5 }], deep: "#03101c", shallow: "#14414e", sky: "#4a5868", sun: [0.9, 0.05, -0.45], sunColor: "#000000", foam: 0.6, amp: 1.5 });
  scene.add(ocean.mesh);
  disposers.push(ocean.dispose);

  // ---- Groudon's land: a volcanic shore veined with lava.
  const volcano = (x: number, z: number) => {
    const d = Math.hypot(x + 4, z + 6) / 42;
    const m = Math.max(0, 1 - d * d);
    return -5 + m * (15 + nz.fbm(x * 0.05, z * 0.05) * 11) + nz.fbm(x * 0.17, z * 0.17) * 2.2 * m;
  };
  const land = makeTerrain({
    size: [100, 90], segments: Math.round(q.grid * 0.6), height: volcano,
    color: (h, slope) => (h < 0.3 ? [0.06, 0.05, 0.05] : slope > 0.45 ? [0.13, 0.1, 0.09] : [0.09, 0.075, 0.07]),
    lava: { color: "#ff5216", scale: 0.07, width: 0.055, intensity: 6 },
    center: [-44, 0, -36], roughness: 0.85,
  });
  scene.add(land.mesh);
  disposers.push(land.dispose);
  const GROU_L: [number, number] = [18, 8];
  const GROU: Vec3 = [-44 + GROU_L[0], volcano(GROU_L[0], GROU_L[1]) - 0.6, -36 + GROU_L[1]];
  const KYO: Vec3 = [27, -5.5, -30];

  // ---- Storm ceiling, rain, lightning.
  const clouds = makeCloudLayer({ size: 700, y: 46, color: "#4a4a58", shadow: "#0c0c14", density: 0.75, scale: 0.012, speed: [3, 0, 1.5], intensity: 0.75 });
  scene.add(clouds.mesh);
  disposers.push(clouds.dispose);
  clouds.u.uHoleGlow.value.copy(col("#3cffa0", 1.4));
  const rain = makeStreaks({ count: P(3200), center: [0, 18, 6], extent: [70, 22, 60], velocity: [-5, -38, -2], life: 0.9, length: 2.6, width: 0.025, color: "#a8b8d8", intensity: 0.4 });
  scene.add(rain.mesh);
  disposers.push(rain.dispose);
  const bolts = [makeLightning({ color: "#bcd0ff", width: 0.45, intensity: 7, branches: 5 }), makeLightning({ color: "#ffd2a8", width: 0.4, intensity: 6, branches: 4 })];
  bolts.forEach((b) => { scene.add(b.mesh); disposers.push(b.dispose); });
  const lastBolt = [-1, -1];

  // ---- Fire and water.
  const peak: Vec3 = [-48, volcano(-4, -6) + 2, -42];
  const fountain = makeParticles({ count: P(1600), shape: "cylinder", center: peak, extent: [4, 1, 4], velocity: [2, 17, 1], spread: [5, 4, 5], gravity: [0, -9.8, 0], life: 2.6, size: [0.18, 0.5], colors: ["#fff2b0", "#ff7a20", "#ff2a08"], intensity: 3.2, flicker: 0.35, seed: 4 });
  const embers = makeParticles({ count: P(1400), shape: "box", center: [-26, 8, -30], extent: [24, 6, 14], velocity: [1.5, 2.2, 0.5], spread: [1, 1, 1], life: 5, size: [0.05, 0.14], colors: ["#ffe6a0", "#ff8a30", "#ff3a10"], intensity: 2.6, turbulence: 1.4, flicker: 0.6, seed: 5 });
  const steam = makeParticles({ count: P(700), shape: "box", center: [-6, 1, -30], extent: [5, 0.5, 16], velocity: [0.6, 3, 0], spread: [0.8, 1, 0.8], life: 5, size: [1.4, 3.8], colors: ["#b8bcc8", "#7a8090", "#40444e"], intensity: 0.32, turbulence: 0.6, additive: false, seed: 6 });
  const spray = makeParticles({ count: P(900), shape: "disc", center: [KYO[0], 0.5, KYO[2] + 2], extent: [18, 1, 12], velocity: [0, 10, 0], spread: [5, 4, 5], gravity: [0, -9.8, 0], life: 2.1, size: [0.14, 0.42], colors: ["#ffffff", "#c8ecff", "#6aa0c8"], intensity: 0.8, seed: 7 });
  [fountain, embers, steam, spray].forEach((p) => { scene.add(p.points); disposers.push(p.dispose); });
  const lavaLight = new THREE.PointLight(col("#ff5a20"), 60, 90, 1.6);
  lavaLight.position.set(-30, 14, -26);
  scene.add(lavaLight);
  const seaLight = new THREE.PointLight(col("#4aa8ff"), 30, 80, 1.6);
  seaLight.position.set(24, 12, -18);
  scene.add(seaLight);

  // ---- Light.
  const L = lights(scene, { sky: "#8090b0", ground: "#1a1210", fill: 0.45, key: "#c8d4ff", keyK: 1.1, keyPos: [10, 30, 30], rim: "#ffb080", rimK: 1.0, rimPos: [-30, 10, -60] });

  // ---- Rayquaza's descent.
  const shaft = makeShaft({ from: [0, 100, -36], to: [0, 0, -36], r0: 3.5, r1: 18, color: "#6dffb4", intensity: 0.3, noise: 0.6 });
  scene.add(shaft.mesh);
  disposers.push(shaft.dispose);
  const halo = makeGlow({ pos: [0, 24, -36], size: 60, color: "#4affa8", intensity: 0 });
  scene.add(halo.sprite);
  disposers.push(halo.dispose);
  const wave = makeRing({ color: "#7affc0", intensity: 3, thickness: 0.05 });
  wave.mesh.rotation.x = -Math.PI / 2;
  wave.mesh.position.set(0, 1.2, -34);
  wave.mesh.scale.setScalar(150);
  scene.add(wave.mesh);
  disposers.push(wave.dispose);

  // ---- The night of meteoroids and the crater.
  const shower = makeStreaks({ count: P(220), center: [-40, 150, -260], extent: [220, 50, 80], velocity: [34, -62, 24], life: 2.6, length: 34, width: 0.7, color: "#ffa868", intensity: 2.2, seed: 9 });
  scene.add(shower.mesh);
  disposers.push(shower.dispose);
  const meteor = makeMeteor({ size: 3.4, color: "#ff8a3a", trail: 90 });
  scene.add(meteor.group, meteor.sparks.points);
  disposers.push(meteor.dispose);
  const M0 = new THREE.Vector3(-150, 190, -330), M1 = new THREE.Vector3(...IMPACT);
  const mdir = M1.clone().sub(M0).normalize();
  const impactRing = makeRing({ color: "#ffb070", intensity: 3.5, thickness: 0.06 });
  impactRing.mesh.rotation.x = -Math.PI / 2;
  impactRing.mesh.position.set(IMPACT[0], 1.5, IMPACT[2]);
  impactRing.mesh.scale.setScalar(160);
  scene.add(impactRing.mesh);
  disposers.push(impactRing.dispose);
  const debris = makeParticles({ count: P(1800), shape: "sphere", center: [IMPACT[0], 2, IMPACT[2]], extent: [4, 2, 4], velocity: [0, 22, 0], spread: [22, 14, 22], gravity: [0, -9.8, 0], life: 4.2, size: [0.25, 0.9], colors: ["#ffe0b0", "#ff7a30", "#4a2a1a"], intensity: 1.3, burst: true, fadeOut: 0.5, seed: 10 });
  scene.add(debris.points);
  disposers.push(debris.dispose);
  const column = makeParticles({ count: P(500), shape: "disc", center: [IMPACT[0], 1, IMPACT[2]], extent: [16, 1, 16], velocity: [0, 5, 0], spread: [2, 2, 2], life: 6, size: [2, 6], colors: ["#7a7278", "#4a4450", "#2a2430"], intensity: 0.16, turbulence: 0.8, additive: false, seed: 11 });
  scene.add(column.points);
  disposers.push(column.dispose);
  const craterH = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    const ridge = Math.exp(-(((r - 21) / 5.5) ** 2));
    return -4 + ridge * (12 + nz.fbm(x * 0.09 + 3, z * 0.09) * 9) + Math.exp(-(((r - 21) / 9) ** 2)) * 2;
  };
  const crater = makeTerrain({
    size: [80, 80], segments: Math.round(q.grid * 0.55), height: craterH,
    color: (h, slope) => (h < 0 ? [0.08, 0.08, 0.09] : slope > 0.5 ? [0.3, 0.27, 0.26] : h > 9 ? [0.2, 0.26, 0.16] : [0.24, 0.22, 0.2]),
    lava: { color: "#ff6a20", scale: 0.12, width: 0.05, intensity: 4 },
    center: [IMPACT[0], 0, IMPACT[2]], roughness: 0.9,
  });
  scene.add(crater.mesh);
  disposers.push(crater.dispose);
  const rimPts: Vec3[] = [];
  const rr = rng(31);
  for (let i = 0; i < 34; i++) {
    const a = Math.PI * 0.15 + (i / 34) * Math.PI * 0.7 + (rr() - 0.5) * 0.05;
    const x = Math.cos(a) * 20.5, z = Math.sin(a) * 20.5;
    rimPts.push([IMPACT[0] + x, craterH(x, z) + 0.5, IMPACT[2] + z]);
  }
  const torches = makeLanterns({ points: rimPts, color: "#ffb060", size: 0.22, intensity: 5, seed: 3 });
  scene.add(torches.group);
  disposers.push(torches.dispose);
  const burst = makeParticles({ count: P(1200), shape: "sphere", center: RQ_NIGHT, extent: [2, 2, 2], velocity: [0, 0, 0], spread: [12, 12, 12], life: 2.6, size: [0.08, 0.26], colors: ["#fff6d8", "#ffd86a", "#6dffb4"], intensity: 0.8, burst: true, fadeOut: 0.7, seed: 12 });
  scene.add(burst.points);
  disposers.push(burst.dispose);
  const megaRing = makeRing({ color: "#ffe0a0", intensity: 1.1, thickness: 0.035 });
  megaRing.mesh.position.set(...RQ_NIGHT);
  megaRing.mesh.scale.setScalar(36);
  scene.add(megaRing.mesh);
  disposers.push(megaRing.dispose);
  const megaGlow = makeGlow({ pos: RQ_NIGHT, size: 34, color: "#8affc8", intensity: 0 });
  scene.add(megaGlow.sprite);
  disposers.push(megaGlow.dispose);

  // ---- Figures.
  const figs = await loadFigures(ctx, [GROUDON, KYOGRE, RAY, MEGA]);
  const groudon = figs.get(GROUDON), kyogre = figs.get(KYOGRE), ray = figs.get(RAY), mega = figs.get(MEGA);
  place(groudon, GROU, 17, 0.55, scene);
  figureStyle(groudon, { rim: "#ff8a40", rimK: 1.6, glow: "#ff6a20", glowK: 0.05, edge: "#ff9a40" });
  place(kyogre, KYO, 19, -0.5, scene);
  figureStyle(kyogre, { rim: "#7ad0ff", rimK: 1.6, glow: "#3aa8ff", glowK: 0.05, edge: "#9fe8ff" });
  place(ray, [0, 90, -36], 24, 0, scene);
  figureStyle(ray, { rim: "#9affc8", rimK: 1.8, glow: "#3cff9a", glowK: 0.06, edge: "#d8ffe8" });
  place(mega, RQ_NIGHT, 26, 0, scene);
  figureStyle(mega, { rim: "#ffe6a0", rimK: 1.6, glow: "#6dffb4", glowK: 0.08, edge: "#ffffff", dissolve: 0 });
  const megaMotes = mega ? makeConverge(mega.points, { radius: 3, colors: ["#fff4c8", "#6dffb4"], size: [0.025, 0.07], intensity: 1.2, spin: 1.6 }) : null;
  if (mega && megaMotes) { mega.group.add(megaMotes.points); disposers.push(megaMotes.dispose); }

  /** Rayquaza's height above the sea as it descends through the storm. */
  const rayY = (t: number) => 92 - 68 * (1 - Math.pow(1 - ramp(t, tRay + 0.2, tCalm + 0.2), 2.4));
  const rayNight = (t: number, out: THREE.Vector3) => {
    const k = 1 - Math.pow(1 - ramp(t, cut + 0.2, tMega - 2.2), 2);
    return out.set(70 + (RQ_NIGHT[0] - 70) * k, 95 + (RQ_NIGHT[1] - 95) * k, -150 + (RQ_NIGHT[2] + 150) * k);
  };
  const rayPos = new THREE.Vector3();

  const keys: Key[] = [
    { t: 0, pos: [34, 22, 86], look: [0, 12, -30], fov: 50 },
    { t: tClash, pos: [-2, 7, 38], look: [-16, 12, -30], fov: 46 },
    { t: tClash + 3.4, pos: [-10, 4, 8], look: [-26, 15, -30], fov: 44 },
    { t: tClash + 4.7, pos: [6, 3.4, 6], look: [24, 9, -30], fov: 46 },
    { t: tRay - 1.6, pos: [15, 2.6, 10], look: [27, 7, -30], fov: 44 },
    { t: tRay, pos: [0, 3, 24], look: [0, 16, -34], fov: 52 },
    { t: tRay + 1.7, pos: [0, 3.6, 21], look: [0, 33, -36], fov: 56 },
    { t: tCalm, pos: [0, 6, 31], look: [0, 22, -36], fov: 52 },
    { t: tCalm + 2.5, pos: [10, 14, 64], look: [0, 15, -36], fov: 48 },
    { t: cut, pos: [12, 15, 72], look: [0, 15, -36], fov: 48 },
    { t: cut + 0.01, pos: [-34, 5, 44], look: [10, 46, -160], fov: 52 },
    { t: tImpact - 0.7, pos: [-24, 6, 30], look: [16, 12, -84], fov: 46 },
    { t: tImpact + 1.6, pos: [-12, 9, 18], look: [16, 6, -84], fov: 46 },
    { t: tMega - 1.6, pos: [-2, 8, -24], look: [12, 26, -86], fov: 44 },
    { t: tMega + 1.6, pos: [4, 11, -38], look: [12, 28, -86], fov: 42 },
    { t: tPeace, pos: [-6, 10, -28], look: [12, 25, -86], fov: 46 },
    { t: end, pos: [-34, 17, 22], look: [12, 20, -86], fov: 50 },
  ];
  const sunPos: Vec3 = [800, 45, -400];

  const lightning = (t: number) => (t > tCalm ? 0 : Math.max(strikeAt(t, 1.5, 3).level, strikeAt(t + 0.7, 2.3, 8).level * 0.8) * (t < tCalm - 0.6 ? 1 : 0));

  return {
    scene,
    portalScale: 6,
    camera: (t) => shake(poseOnPath(keys, t), t, [{ at: tClash + 0.6, k: 0.05 }, { at: tClash + 4.2, k: 0.08 }, { at: tCalm, k: 0.12, dur: 2 }, { at: tImpact, k: 0.3, dur: 2.4 }, { at: tMega, k: 0.06 }]),
    orbit: (t) => ({ target: t < cut ? [0, 12, -30] : [12, 18, -84], limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.15, maxPitch: 1.0, minDist: 6, maxDist: 200 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const night = t > cut;
      const calm = ramp(t, tCalm - 0.2, tCalm + 2.6);
      const dawn = ramp(t, tPeace - 1.2, tPeace + 3.2);
      // Sky and fog.
      const [top, hor, bot] = [sky.u.uTop.value, sky.u.uHorizon.value, sky.u.uBottom.value];
      if (!night) {
        lerpC(top, SKY.storm[0], SKY.calm[0], calm); lerpC(hor, SKY.storm[1], SKY.calm[1], calm); lerpC(bot, SKY.storm[2], SKY.calm[2], calm);
        lerpC(fog.color, FOG.storm, FOG.calm, calm);
      } else {
        lerpC(top, SKY.night[0], SKY.dawn[0], dawn); lerpC(hor, SKY.night[1], SKY.dawn[1], dawn); lerpC(bot, SKY.night[2], SKY.dawn[2], dawn);
        lerpC(fog.color, FOG.night, FOG.dawn, dawn);
      }
      sky.u.uStars.value = night ? 0.05 * (1 - dawn) : 0;
      sky.u.uSunColor.value.copy(col("#ffb070", dawn * 0.75));
      sky.u.uSunGlow.value = dawn * 0.32;
      fog.density = night ? 0.0035 : 0.0062 - calm * 0.002;
      ocean.u.uFogColor.value.copy(fog.color);
      ocean.u.uFogDensity.value = fog.density;
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      // The sea: the storm's waves, Kyogre's swell, then calm.
      ocean.u.uTime.value = ambient;
      const rough = night ? 0.5 - dawn * 0.15 : 1.5 - calm * 0.9;
      ocean.u.uAmp.value = rough;
      const sw = ocean.u.uSwell.value;
      if (!night) sw.set(KYO[0], KYO[2] + 4, 26, (3.4 + Math.sin(ambient * 0.7) * 0.6) * (1 - calm));
      else sw.set(IMPACT[0], IMPACT[2], 70, 2.6 * spike(t, tImpact + 0.2, 0.3, 2.2));
      ocean.u.uSky.value.copy(night ? col("#26324e").lerp(col("#c08870"), dawn) : col("#4a5868").lerp(col("#7a8a98"), calm));
      ocean.u.uSunColor.value.copy(col("#ffb070", dawn * 0.9));
      ocean.u.uFoam.value = night ? 0.3 : 0.6 - calm * 0.3;
      // Lightning.
      const lv = lightning(t);
      [strikeAt(t, 1.5, 3), strikeAt(t + 0.7, 2.3, 8)].forEach((s, i) => {
        const b = bolts[i];
        if (s.level > 0 && t < tCalm - 0.6 && s.id !== lastBolt[i]) {
          lastBolt[i] = s.id;
          const r = rng(s.id * 31 + i * 7 + 1);
          const x = -40 + r() * 80, z = -70 + r() * 50;
          b.strike([x + (r() - 0.5) * 10, 46, z], [x, x < -6 ? 6 : 0, z + (r() - 0.5) * 6], s.id + i * 1000, cam.position);
        }
        b.u.uAlpha.value = t < tCalm - 0.6 ? s.level : 0;
      });
      sky.u.uFlash.value = lv * 0.3;
      ocean.u.uFlash.value = lv * 0.35;
      clouds.u.uFlash.value = lv * 0.45;
      land.u.uFlash.value = lv * 0.3;
      // Clouds: the ceiling tears open for Rayquaza, then thins.
      clouds.u.uTime.value = ambient;
      clouds.u.uOpacity.value = night ? 0 : 1 - calm * 0.45;
      clouds.u.uHole.value.set(0, -36, 30 * Math.pow(ramp(t, tRay - 0.3, tRay + 1.8), 0.7) + calm * 30);
      // Rain and storm motion.
      rain.u.uTime.value = ambient;
      rain.u.uOpacity.value = night ? 0 : 1 - calm;
      // Fire.
      land.u.uTime.value = ambient;
      land.u.uLavaK.value = night ? 0 : 6 - calm * 3.8;
      for (const p of [fountain, embers, steam, spray]) { p.u.uTime.value = ambient; p.u.uPixel.value = px; }
      fountain.u.uOpacity.value = night ? 0 : 1 - calm;
      embers.u.uOpacity.value = night ? 0 : 1 - calm * 0.7;
      steam.u.uOpacity.value = night ? 0 : 1 - calm * 0.5;
      spray.u.uOpacity.value = night ? 0 : 1 - calm;
      lavaLight.intensity = night ? 0 : (60 - calm * 40) * (0.85 + 0.15 * Math.sin(ambient * 5.3));
      seaLight.intensity = night ? 0 : 30 * (1 - calm);
      L.key.intensity = night ? 0.5 + dawn * 1.6 : 1.1 + lv * 2.2;
      L.key.color.copy(night ? col("#9ab0ff").lerp(col("#ffc890"), dawn) : col("#c8d4ff"));
      L.key.position.set(...(night ? ([400, 40, -200] as Vec3) : ([10, 30, 30] as Vec3)));
      L.hemi.intensity = night ? 0.25 + dawn * 0.45 : 0.45 + calm * 0.2;
      // The titans: they rage, then sink away when the storm breaks.
      const fade = 1 - ramp(t, tCalm + 0.8, tCalm + 3.6);
      if (groudon) {
        groudon.group.position.set(GROU[0], GROU[1] + Math.sin(ambient * 0.9) * 0.15, GROU[2]);
        groudon.group.rotation.y = 0.55 + Math.sin(ambient * 0.4) * 0.03;
        figureStyle(groudon, { dissolve: night ? 0 : fade, glowK: 0.05 + lv * 0.1 });
      }
      if (kyogre) {
        kyogre.group.position.set(KYO[0], KYO[1] + Math.sin(ambient * 0.7) * 0.8 * (1 - calm), KYO[2]);
        kyogre.group.rotation.y = -0.5 + Math.sin(ambient * 0.5) * 0.04;
        figureStyle(kyogre, { dissolve: night ? 0 : fade, glowK: 0.05 + lv * 0.1 });
      }
      // Rayquaza: down through the storm; later over the new crater; then Mega Evolution.
      if (!night) rayPos.set(0, rayY(t), -36 + ramp(t, tRay, tCalm) * 2);
      else rayNight(t, rayPos);
      const desc = ramp(t, tRay - 0.4, tRay + 1.2);
      shaft.u.uTime.value = ambient;
      shaft.u.uOpacity.value = night ? 0 : desc * (1 - ramp(t, tCalm + 1, tCalm + 3.4) * 0.8);
      halo.sprite.position.copy(rayPos);
      halo.set("#4affa8", night ? 0 : desc * (0.35 + 0.5 * spike(t, tCalm, 0.1, 1.2)) * (1 - calm * 0.6));
      wave.u.uK.value = ramp(t, tCalm, tCalm + 2.4);
      wave.u.uTime.value = ambient;
      wave.u.uOpacity.value = t > tCalm && !night ? 1 : 0;
      wave.mesh.visible = wave.u.uOpacity.value > 0;
      if (ray) {
        ray.group.position.set(rayPos.x, rayPos.y + Math.sin(ambient * 1.1) * 0.3, rayPos.z);
        ray.group.rotation.y = Math.sin(ambient * 0.4) * 0.08 + (night ? -0.25 : 0);
        figureStyle(ray, { dissolve: night ? 1 - ramp(t, tMega - 0.4, tMega + 0.25) : ramp(t, tRay - 0.6, tRay + 0.1), glowK: 0.06 + 0.2 * spike(t, tCalm, 0.1, 1.4) });
      }
      // The meteoroids: a shower, then one that strikes.
      shower.u.uTime.value = ambient;
      shower.u.uOpacity.value = night ? ramp(t, cut, cut + 1) * (1 - ramp(t, tMega - 3, tMega - 1)) : 0;
      const fall = ramp(t, cut + 0.3, tImpact);
      const flying = night && t < tImpact;
      meteor.group.visible = flying;
      meteor.sparks.points.visible = flying;
      if (flying) {
        const k = fall * fall;
        meteor.at(M0.clone().lerp(M1, k), mdir.clone().negate());
        meteor.u.uTime.value = ambient;
        meteor.sparks.u.uTime.value = ambient;
        meteor.sparks.u.uPixel.value = px;
      }
      impactRing.u.uK.value = ramp(t, tImpact, tImpact + 2.6);
      impactRing.u.uTime.value = ambient;
      impactRing.mesh.visible = night && t > tImpact && t < tImpact + 2.7;
      debris.u.uTime.value = Math.max(0, t - tImpact);
      debris.u.uPixel.value = px;
      debris.u.uOpacity.value = night && t > tImpact ? 1 : 0;
      column.u.uTime.value = ambient;
      column.u.uPixel.value = px;
      column.u.uOpacity.value = night ? ramp(t, tImpact, tImpact + 0.8) * (1 - ramp(t, tMega - 2, tPeace)) : 0;
      // The land born of the impact.
      const rise = night ? 1 - Math.pow(1 - ramp(t, tImpact + 0.1, tImpact + 2.2), 3) : 0;
      crater.mesh.visible = rise > 0.001;
      crater.mesh.scale.set(1, Math.max(0.001, rise), 1);
      crater.mesh.position.y = -3 * (1 - rise);
      crater.u.uTime.value = ambient;
      crater.u.uLavaK.value = 4 * (1 - ramp(t, tImpact + 1, tPeace)) + 0.0;
      // People on the rim, come to meet it.
      const people = night ? ramp(t, tMega - 3.2, tMega - 1.6) : 0;
      torches.group.visible = people > 0.001;
      (torches.mesh.material as THREE.MeshBasicMaterial).color.copy(col("#ffb060", 5 * people));
      torches.update(ambient, 0, px);
      // Mega Evolution.
      if (megaMotes) {
        megaMotes.u.uForm.value = ramp(t, tMega - 1.1, tMega + 0.7);
        megaMotes.u.uTime.value = ambient;
        megaMotes.u.uPixel.value = px;
        megaMotes.u.uOpacity.value = night ? ramp(t, tMega - 1.2, tMega - 0.8) * (1 - ramp(t, tMega + 0.8, tMega + 2)) : 0;
      }
      if (mega) {
        mega.group.position.set(RQ_NIGHT[0], RQ_NIGHT[1] + Math.sin(ambient * 0.8) * 0.4, RQ_NIGHT[2]);
        mega.group.rotation.y = -0.2 + Math.sin(ambient * 0.35) * 0.06;
        figureStyle(mega, { dissolve: night ? ramp(t, tMega - 0.05, tMega + 1.2) : 0, glowK: 0.06 + 0.2 * spike(t, tMega, 0.08, 1.2) });
      }
      burst.u.uTime.value = Math.max(0, t - tMega);
      burst.u.uPixel.value = px;
      burst.u.uOpacity.value = night && t > tMega ? 1 : 0;
      megaRing.u.uK.value = ramp(t, tMega, tMega + 1.6);
      megaRing.u.uTime.value = ambient;
      megaRing.mesh.visible = night && t > tMega && t < tMega + 1.7;
      billboard(megaRing.mesh, cam);
      megaGlow.set("#8affc8", night ? 0.15 * ramp(t, tMega - 1, tMega) * (0.6 + 0.4 * (1 - ramp(t, tMega + 0.5, tMega + 3))) + dawn * 0.05 : 0);
    },
    look(t) {
      const night = t > cut;
      const lv = lightning(t);
      const L0: Look = lookAt(
        t,
        { bloom: 0.8, bloomRadius: 0.62 },
        {
          exposure: [[0, 0.92], [tCalm, 0.95], [tCalm + 2, 1.02], [cut, 1.0], [cut + 0.6, 1.0], [tPeace, 1.0], [end, 1.0]],
          fade: [[cut - 0.5, 0], [cut - 0.08, 1], [cut + 0.12, 1], [cut + 0.8, 0]],
          gain: [[0, [0.92, 0.98, 1.1]], [tCalm, [0.95, 1.02, 1.05]], [tCalm + 2, [0.98, 1.04, 1.02]], [cut, [0.98, 1.04, 1.02]], [cut + 0.1, [0.9, 0.96, 1.14]], [tPeace - 1, [0.95, 0.98, 1.08]], [tPeace + 3, [1.1, 1.0, 0.9]]],
          lift: [[0, [0.012, 0.006, 0.004]], [cut, [0.004, 0.008, 0.008]], [cut + 0.1, [0.0, 0.004, 0.014]], [tPeace + 3, [0.012, 0.008, 0.006]]],
          saturation: [[0, 1.0], [tCalm, 1.1], [cut, 1.05], [tPeace + 3, 1.15]],
          contrast: [[0, 1.12], [tCalm + 2, 1.05], [cut + 0.2, 1.1], [end, 1.04]],
          chroma: [[tCalm - 0.05, 0], [tCalm, 0.35], [tCalm + 0.8, 0], [tImpact - 0.05, 0], [tImpact, 0.5], [tImpact + 1, 0], [tMega - 0.05, 0], [tMega, 0.3], [tMega + 0.8, 0]],
          vignette: [[0, 0.45], [tCalm + 2, 0.32], [cut + 0.2, 0.5], [end, 0.36]],
          bloom: [[0, 0.75], [tRay, 0.9], [tCalm + 2, 0.75], [cut, 0.8], [tMega, 0.95], [tMega + 3, 0.8]],
        }
      );
      L0.flash = Math.min(0.4, lv * 0.12 + 0.25 * spike(t, tCalm, 0.05, 0.35) + 0.4 * spike(t, tImpact, 0.03, 0.25) + 0.18 * spike(t, tMega, 0.05, 0.3));
      // Light shafts: from Rayquaza in the storm, from the Mega Evolution, from the dawn sun.
      if (!night && t > tRay - 0.5) L0.rays = { pos: [0, rayY(t), -36], color: [0.45, 1.0, 0.7], strength: 0.55 * ramp(t, tRay - 0.5, tRay + 1) * (1 - ramp(t, tCalm + 1.5, cut) * 0.7) };
      else if (night && t > tMega - 1 && t < tPeace) L0.rays = { pos: RQ_NIGHT, color: [1.0, 0.9, 0.65], strength: 0.25 * ramp(t, tMega - 1, tMega) * (1 - ramp(t, tMega + 2, tPeace)) };
      else if (night && t >= tPeace - 0.5) L0.rays = { pos: sunPos, color: [1.0, 0.78, 0.55], strength: 0.2 * ramp(t, tPeace - 0.5, tPeace + 3) };
      return L0;
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};
