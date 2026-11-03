import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeCloudLayer, makeConverge, makeFlames, makeLightning, makeParticles, makeRing, makeSky, makeStreaks, makeTerrain, noise2, ramp, rng } from "../kit";
import { makeCanvasPanel, makeFoliage, makeHouses, makePagoda, makeRuins } from "../props";
import type { ChapterBuilder, Look } from "../types";
import { figureStyle, floatFigure, lights, loadFigures, lookAt, place, pointPixel, shake, spike } from "./common";

/**
 * VIII. The Burned Tower. First the Ruins of Alph in the morning mist,
 * older than anyone knows. Then Ecruteak at dusk: two towers, and a
 * silver Pokémon roosting on one. A storm: lightning strikes the tower,
 * it burns for days, rain puts it out. In the ashes three Pokémon lie
 * dead; a rainbow-coloured Pokémon descends (slow motion) and they rise
 * again. Then both great birds leave, never to return.
 */

const LUGIA = 249, HOOH = 250, RAIKOU = 243, ENTEI = 244, SUICUNE = 245;
const ALPH: Vec3 = [-420, 0, 0];
const BT: Vec3 = [-14, 0, -40];
const TT: Vec3 = [30, 0, -78];

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tAlph = B("alph"), tTowers = B("towers"), tLugia = B("lugia"), tFire = B("fire"), tDead = B("perished"), tBeasts = B("beasts"), tFlew = B("flew");
  const end = ctx.timing.anim;
  const cutTowers = tTowers - 0.4;
  const tStrike = tFire + 0.9;
  const tRain = tFire + 5.2;
  const tDescend = tDead + 1.4;
  const scene = new THREE.Scene();
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));
  const nz = noise2(61);
  const r = rng(17);

  // ---- Sky.
  const sky = makeSky({ top: "#3a5a8a", horizon: "#e8c8a8", bottom: "#1a1a24", nebulaA: "#000000", nebulaB: "#000000", nebula: 0, stars: 0, sunDir: [0.95, 0.06, -0.35], sunColor: "#ffd8a8", sunSize: 600, sunGlow: 0.4 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  const fog = new THREE.FogExp2(col("#b8b0b0"), 0.02);
  scene.fog = fog;
  const clouds = makeCloudLayer({ size: 800, y: 70, color: "#5a5a6a", shadow: "#101018", density: 0.8, scale: 0.01, speed: [3, 0, 1.4], intensity: 0.8 });
  scene.add(clouds.mesh);
  disposers.push(clouds.dispose);

  // ---- The Ruins of Alph: stone chambers in the mist.
  const alphLand = makeTerrain({
    size: [160, 140], segments: Math.round(q.grid * 0.4),
    height: (x, z) => nz.fbm(x * 0.03 + 7, z * 0.03) * 5 - 1.5 + Math.max(0, -z - 30) * 0.3,
    color: (h, slope) => (slope > 0.4 ? [0.3, 0.28, 0.24] : [0.24, 0.32, 0.16]),
    center: [ALPH[0], 0, ALPH[2] - 30], roughness: 0.95,
  });
  scene.add(alphLand.mesh);
  disposers.push(alphLand.dispose);
  const alphRuins = makeRuins({ center: [ALPH[0], -0.3, ALPH[2] - 14], radius: 26, columns: 26, arches: 3, color: "#8a8270", seed: 11, height: [1.5, 5] });
  scene.add(alphRuins.mesh);
  disposers.push(alphRuins.dispose);
  const glyphs = makeCanvasPanel({
    w: 10, h: 3.2, px: [1024, 328], basic: false, emissive: 0.6,
    draw(g, w, h) {
      g.fillStyle = "#5a5446";
      g.fillRect(0, 0, w, h);
      const rr = rng(23);
      for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(30,24,16,${rr() * 0.12})`; g.fillRect(rr() * w, rr() * h, 3, 3); }
      g.strokeStyle = "rgba(255,226,170,0.85)";
      g.lineWidth = 6;
      g.lineCap = "round";
      // Abstract carved marks (not letters): arcs, bars and rings in a frieze.
      for (let i = 0; i < 14; i++) {
        const cx = 50 + i * 70, cy = h / 2;
        g.beginPath();
        const k = Math.floor(rr() * 4);
        if (k === 0) { g.arc(cx, cy, 20, rr() * 3, rr() * 3 + 4); }
        else if (k === 1) { g.moveTo(cx - 18, cy - 24); g.lineTo(cx + 18, cy + 24); g.moveTo(cx + 18, cy - 24); g.lineTo(cx - 6, cy); }
        else if (k === 2) { g.arc(cx, cy - 10, 10, 0, Math.PI * 2); g.moveTo(cx, cy); g.lineTo(cx, cy + 28); }
        else { g.moveTo(cx - 20, cy + 20); g.quadraticCurveTo(cx, cy - 40, cx + 20, cy + 20); }
        g.stroke();
      }
    },
  });
  glyphs.mesh.position.set(ALPH[0], 2.6, ALPH[2] - 20);
  scene.add(glyphs.mesh);
  disposers.push(glyphs.dispose);
  const alphMotes = makeParticles({ count: P(500), shape: "box", center: [ALPH[0], 3, ALPH[2] - 10], extent: [16, 3, 12], velocity: [0.1, 0.05, 0], spread: [0.1, 0.1, 0.1], life: 12, size: [0.03, 0.07], colors: ["#fff4d8", "#ffe0a0", "#c8d8ff"], intensity: 1.4, turbulence: 0.4, seed: 2 });
  scene.add(alphMotes.points);
  disposers.push(alphMotes.dispose);

  // ---- Ecruteak: two towers, the town, the hills.
  const hills = (x: number, z: number) => nz.fbm(x * 0.012 + 2, z * 0.012) * 26 - 8 + Math.pow(Math.max(0, -z - 90) / 60, 2) * 30;
  const H0 = hills(0, 0);
  const gh = (x: number, z: number) => (hills(x, z) - H0) * Math.min(1, Math.hypot(x - 6, z + 50) / 90);
  const land = makeTerrain({
    size: [500, 420], segments: Math.round(q.grid * 0.7), height: (x, z) => gh(x, z - 100),
    color: (h, slope) => (slope > 0.45 ? [0.24, 0.22, 0.2] : h > 12 ? [0.2, 0.26, 0.14] : [0.18, 0.24, 0.12]),
    center: [0, 0, -100], roughness: 0.95,
  });
  scene.add(land.mesh);
  disposers.push(land.dispose);
  const brass = makePagoda({ tiers: 9, base: 13, height: 34, wall: "#8a6a4a", roof: "#5a3a2a", trim: "#d8a548" });
  brass.group.position.set(BT[0], gh(BT[0], BT[2]), BT[2]);
  scene.add(brass.group);
  disposers.push(brass.dispose);
  const burned = makePagoda({ tiers: 3, base: 13, height: 11, wall: "#2a221e", roof: "#1a1614", trim: "#3a2a20" });
  burned.group.position.copy(brass.group.position);
  scene.add(burned.group);
  disposers.push(burned.dispose);
  const tin = makePagoda({ tiers: 9, base: 14, height: 40, wall: "#c8b8a0", roof: "#8a2a2a", trim: "#ffd27a", glow: "#ffd27a" });
  tin.group.position.set(TT[0], gh(TT[0], TT[2]), TT[2]);
  scene.add(tin.group);
  disposers.push(tin.dispose);
  const houseSpots: { pos: Vec3; rot: number; size: Vec3 }[] = [];
  for (let i = 0; i < 26; i++) {
    const x = -40 + r() * 80, z = 10 - r() * 50;
    if (Math.hypot(x - BT[0], z - BT[2]) < 14 || (Math.abs(x - BT[0]) < 14 && z > BT[2] && z < BT[2] + 42)) continue;
    houseSpots.push({ pos: [x, gh(x, z) - 0.2, z], rot: Math.floor(r() * 4) * (Math.PI / 2) + (r() - 0.5) * 0.2, size: [4 + r() * 2, 2.6, 3.5 + r()] });
  }
  const town = makeHouses({ spots: houseSpots, wall: "#8a7a64", roof: "#3a2a2a", window: "#ffb060", windowK: 2 });
  scene.add(town.group);
  disposers.push(town.dispose);
  const treePts: Vec3[] = [];
  for (let i = 0; i < 260; i++) {
    const x = (r() - 0.5) * 240, z = 30 - r() * 140;
    if (Math.hypot(x - BT[0], z - BT[2]) < 18 || Math.hypot(x - TT[0], z - TT[2]) < 20 || (Math.abs(x) < 40 && z > -50 && z < 12)) continue;
    treePts.push([x, gh(x, z) + 1.5 + r() * 2, z]);
  }
  const trees = makeFoliage({ points: treePts, size: [3.4, 6.5], colors: ["#3a2a12", "#c86a2a"], seed: 5, light: 0.9 });
  scene.add(trees.mesh);
  disposers.push(trees.dispose);

  // ---- The storm and the fire.
  const bolt = makeLightning({ color: "#e0e8ff", width: 0.9, intensity: 8, branches: 6 });
  scene.add(bolt.mesh);
  disposers.push(bolt.dispose);
  const BT_TOP: Vec3 = [BT[0], brass.group.position.y + 36, BT[2]];
  const firePts: Vec3[] = [];
  for (let i = 0; i < 9; i++) {
    const y = brass.group.position.y + (i + 0.5) * (34 / 9);
    const w = 13 * (1 - (i / 9) * 0.55) * 0.38;
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + i; firePts.push([BT[0] + Math.cos(a) * w, y, BT[2] + Math.sin(a) * w]); }
  }
  const fire = makeFlames({ points: firePts, size: [3.5, 8], intensity: 3.4, seed: 7 });
  scene.add(fire.mesh);
  disposers.push(fire.dispose);
  const embers = makeParticles({ count: P(2400), shape: "cylinder", center: [BT[0], 20, BT[2]], extent: [7, 16, 7], velocity: [1.5, 6, 0.5], spread: [2, 2, 2], life: 4, size: [0.1, 0.3], colors: ["#ffe6a0", "#ff8a30", "#ff3a10"], intensity: 2.8, turbulence: 1.5, flicker: 0.6, seed: 8 });
  const smoke = makeParticles({ count: P(800), shape: "cylinder", center: [BT[0], 30, BT[2]], extent: [6, 10, 6], velocity: [2, 5, 0.5], spread: [1.5, 1, 1.5], life: 9, size: [8, 18], colors: ["#3a302c", "#1e1a18", "#0c0a0a"], intensity: 0.45, turbulence: 0.7, additive: false, seed: 9 });
  [embers, smoke].forEach((p) => { scene.add(p.points); disposers.push(p.dispose); });
  const rain = makeStreaks({ count: P(3000), center: [0, 20, -20], extent: [60, 22, 50], velocity: [-3, -36, -1], life: 0.9, length: 2.4, width: 0.025, color: "#a8b8d8", intensity: 0.45, seed: 10 });
  scene.add(rain.mesh);
  disposers.push(rain.dispose);
  const fireLight = new THREE.PointLight(col("#ff6a28"), 0, 120, 1);
  fireLight.position.set(BT[0] + 6, 16, BT[2] + 14);
  scene.add(fireLight);

  // ---- The rainbow.
  const bowGeo = new THREE.RingGeometry(32, 40, 96, 1, 0, Math.PI);
  const bowMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uOpacity; varying vec2 vP;
      void main(){
        float k = clamp((length(vP) - 32.0) / 8.0, 0.0, 1.0);
        vec3 c = 0.5 + 0.5 * cos(6.2831 * (k * 0.85 + vec3(0.0, 0.33, 0.67)));
        float edge = smoothstep(0.0, 0.15, k) * smoothstep(1.0, 0.85, k);
        gl_FragColor = vec4(c * edge * uOpacity * 1.4, edge * uOpacity);
      }`,
  });
  const rainbow = new THREE.Mesh(bowGeo, bowMat);
  rainbow.position.set(BT[0] + 2, gh(BT[0], BT[2]) - 4, BT[2] - 30);
  scene.add(rainbow);
  disposers.push(() => { bowGeo.dispose(); bowMat.dispose(); });
  const plumes = makeParticles({ count: P(1600), shape: "sphere", center: [BT[0], 16, BT[2] + 8], extent: [6, 4, 4], velocity: [0, -1.2, 0], spread: [1.5, 1, 1.5], life: 3.4, size: [0.08, 0.22], colors: ["#ff6a3a", "#ffd24a", "#6affa8"], intensity: 2.4, turbulence: 1, seed: 12 });
  scene.add(plumes.points);
  disposers.push(plumes.dispose);
  const reviveRing = makeRing({ color: "#ffe6a0", intensity: 3, thickness: 0.06 });
  reviveRing.mesh.rotation.x = -Math.PI / 2;
  reviveRing.mesh.position.set(BT[0], gh(BT[0], BT[2] + 10) + 0.3, BT[2] + 10);
  reviveRing.mesh.scale.setScalar(30);
  scene.add(reviveRing.mesh);
  disposers.push(reviveRing.dispose);

  // ---- Light.
  const L = lights(scene, { sky: "#ffd8b0", ground: "#2a2018", fill: 0.6, key: "#ffc890", keyK: 1.8, keyPos: [60, 20, -80], rim: "#8ab0ff", rimK: 0.5, rimPos: [-30, 20, 40] });

  // ---- Figures.
  const figs = await loadFigures(ctx, [LUGIA, HOOH, RAIKOU, ENTEI, SUICUNE]);
  const lugia = figs.get(LUGIA), hooh = figs.get(HOOH);
  const beasts = [figs.get(RAIKOU), figs.get(ENTEI), figs.get(SUICUNE)];
  const LU: Vec3 = [BT[0], brass.group.position.y + 35.5, BT[2] + 1];
  place(lugia, LU, 8, 0.2, scene);
  figureStyle(lugia, { rim: "#d8e8ff", rimK: 1.4, glow: "#a8c8ff", glowK: 0.04, edge: "#ffffff" });
  const HO: Vec3 = [BT[0] + 1, gh(BT[0], BT[2]) + 13, BT[2] + 6];
  place(hooh, HO, 10, 0, scene);
  figureStyle(hooh, { rim: "#ffe0a0", rimK: 2.2, glow: "#ffb04a", glowK: 0.25, edge: "#fff0c0", dissolve: 0 });
  const BEAST: Vec3[] = [[BT[0] - 5, 0, BT[2] + 12], [BT[0], 0, BT[2] + 13], [BT[0] + 5, 0, BT[2] + 12]].map(([x, , z]) => [x, gh(x, z), z] as Vec3);
  beasts.forEach((f, i) => { place(f, BEAST[i], 2.4, [0.3, 0, -0.3][i], scene); figureStyle(f, { rim: "#ffe6c0", rimK: 1.3, edge: "#ffb050", shadow: 1, dissolve: 0 }); });
  const revive = beasts.map((f, i) => {
    if (!f) return null;
    const c = makeConverge(f.points, { radius: 1.6, colors: [["#ffe08a", "#ffd24a"], ["#ff8a5a", "#ff5a2a"], ["#8affe8", "#4ad8ff"]][i] as [string, string], size: [0.02, 0.05], intensity: 2.2, spin: 1.3, seed: i + 4 });
    f.group.add(c.points);
    disposers.push(c.dispose);
    return c;
  });

  /** A point `h` above the ground at x, z (Ecruteak's ground rolls). */
  const up = (x: number, z: number, h: number): Vec3 => [x, gh(x, z) + h, z];
  const BEASTS_AT = up(BT[0], BT[2] + 12.5, 1.4);
  const keys: Key[] = [
    { t: 0, pos: [ALPH[0] + 2, 4.5, ALPH[2] + 26], look: [ALPH[0], 2.2, ALPH[2] - 8], fov: 46 },
    { t: tAlph, pos: [ALPH[0] - 3, 3, ALPH[2] + 14], look: [ALPH[0] + 1, 2.4, ALPH[2] - 14], fov: 44 },
    { t: cutTowers, pos: [ALPH[0] - 1, 2.6, ALPH[2] + 6], look: [ALPH[0], 2.6, ALPH[2] - 20], fov: 44 },
    { t: cutTowers + 0.01, pos: up(10, 30, 6), look: [6, 19, -58], fov: 50 },
    { t: tLugia - 1.4, pos: up(-4, 30, 5), look: [-12, 22, -40], fov: 46 },
    { t: tLugia, pos: up(-4, 16, 6), look: [BT[0], 34, BT[2]], fov: 44 },
    { t: tFire - 0.8, pos: up(6, 6, 12), look: [BT[0], 32, BT[2]], fov: 42 },
    { t: tFire, pos: up(22, 34, 6), look: [BT[0], 18, BT[2]], fov: 48 },
    { t: tRain, pos: up(10, 20, 4.5), look: [BT[0], 14, BT[2]], fov: 50 },
    { t: tDead - 0.5, pos: up(4, 4, 4), look: [BT[0], gh(BT[0], BT[2]) + 6, BT[2]], fov: 48 },
    { t: tDead, pos: up(BT[0] + 9, BT[2] + 26, 3), look: BEASTS_AT, fov: 44 },
    { t: tDescend + 1.6, pos: up(BT[0] + 7, BT[2] + 28, 2.6), look: [BT[0], gh(BT[0], BT[2]) + 20, BT[2] + 4], fov: 56 },
    { t: tBeasts, pos: up(BT[0] + 2, BT[2] + 25, 3), look: BEASTS_AT, fov: 46 },
    { t: tFlew - 1, pos: up(BT[0] - 3, BT[2] + 27, 2.8), look: BEASTS_AT, fov: 46 },
    { t: tFlew, pos: up(2, 22, 6), look: [-2, 50, -90], fov: 58 },
    { t: end, pos: up(8, 52, 10), look: [0, 66, -130], fov: 56 },
  ];

  const lugiaPos = new THREE.Vector3(), hoohPos = new THREE.Vector3();
  const hoohLight = new THREE.PointLight(col("#ffb860"), 0, 40, 1.2);
  scene.add(hoohLight);

  return {
    scene,
    portalScale: 4,
    camera: (t) => shake(poseOnPath(keys, t), t, [{ at: tStrike, k: 0.22, dur: 2 }, { at: tDescend + 1.2, k: 0.05 }]),
    orbit: (t) => ({ target: t < cutTowers ? [ALPH[0], 2.4, ALPH[2] - 14] : t < tDead - 0.5 || t >= tFlew ? [BT[0], 18, BT[2]] : BEASTS_AT, limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.15, maxPitch: 1.0, minDist: 3, maxDist: 160 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const alph = t < cutTowers;
      const storm = ramp(t, tFire - 0.6, tFire + 0.6) * (1 - ramp(t, tDead - 1, tDead + 2));
      const burning = ramp(t, tStrike, tStrike + 1.2) * (1 - ramp(t, tRain + 1, tDead - 0.5));
      const rainK = ramp(t, tRain - 0.5, tRain + 0.8) * (1 - ramp(t, tDead - 1.5, tDead));
      const night = ramp(t, tDead - 1, tDead) * (1 - ramp(t, tFlew - 1, tFlew + 3));
      const dawn = ramp(t, tFlew - 1, tFlew + 4);
      const bow = ramp(t, tDescend - 0.5, tDescend + 2) * (1 - ramp(t, tFlew + 2, end));
      // Sky by phase.
      const top = sky.u.uTop.value, hor = sky.u.uHorizon.value, bot = sky.u.uBottom.value;
      if (alph) { top.copy(col("#6a88a8")); hor.copy(col("#d8c8b0")); bot.copy(col("#2a2a2a")); sky.u.uSunGlow.value = 0.3; sky.u.uSunColor.value.copy(col("#fff0d0", 0.6)); fog.color.copy(col("#a8a49c")); fog.density = 0.014; }
      else {
        top.copy(col("#1e2a58").lerp(col("#0e1018"), storm).lerp(col("#06080e"), night).lerp(col("#3a5a90"), dawn));
        hor.copy(col("#e07a48").lerp(col("#3a3a44"), storm).lerp(col("#2a2030"), night).lerp(col("#e0a080"), dawn));
        bot.copy(col("#1a1a24"));
        sky.u.uSunGlow.value = 0.7 * (1 - storm) * (1 - night) + dawn * 0.4;
        sky.u.uSunColor.value.copy(col("#ffc080", (1 - storm) * (1 - night) + dawn));
        fog.color.copy(col("#a08070").lerp(col("#2a2a30"), storm).lerp(col("#14121a"), night).lerp(col("#d0b0a0"), dawn));
        fog.density = 0.006 + storm * 0.006 + rainK * 0.006;
      }
      sky.u.uStars.value = alph ? 0 : night * 0.04;
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      clouds.u.uTime.value = ambient;
      clouds.u.uOpacity.value = alph ? 0 : storm;
      alphLand.mesh.visible = alph;
      alphRuins.mesh.visible = alph;
      glyphs.mesh.visible = alph;
      (glyphs.mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + 0.3 * ramp(t, tAlph, tAlph + 3) * (0.8 + 0.2 * Math.sin(ambient * 1.3));
      for (const p of [alphMotes, embers, smoke, plumes]) { p.u.uTime.value = ambient; p.u.uPixel.value = px; }
      alphMotes.u.uOpacity.value = alph ? 1 : 0;
      trees.u.uTime.value = ambient;
      // The towers: the Brass Tower burns down to its base.
      const gone = t > tRain + 1.2;
      brass.group.visible = !alph && !gone;
      burned.group.visible = !alph && gone;
      (brass.wallMat as THREE.MeshStandardMaterial).color.copy(col("#8a6a4a").lerp(col("#2a1a14"), burning));
      // Lightning strikes its top.
      bolt.u.uAlpha.value = t > tStrike && t < tStrike + 0.5 ? spike(t, tStrike, 0.02, 0.12) : 0;
      if (t > tStrike && t < tStrike + 0.5) bolt.strike([BT[0] + 10, 72, BT[2] - 8], BT_TOP, 7, cam.position);
      fire.u.uTime.value = ambient;
      fire.u.uOpacity.value = burning;
      embers.u.uOpacity.value = burning;
      smoke.u.uOpacity.value = Math.max(burning, ramp(t, tRain, tRain + 1) * (1 - ramp(t, tDead, tBeasts)) * 0.8);
      rain.u.uTime.value = ambient;
      rain.u.uOpacity.value = rainK;
      fireLight.intensity = 60 * burning * (0.8 + 0.2 * Math.sin(ambient * 7) * Math.sin(ambient * 3.1));
      // Lugia on the Brass Tower; at the end both birds leave.
      const away = ramp(t, tFlew + 0.5, end - 0.5);
      if (lugia) {
        if (t < tStrike) lugiaPos.set(LU[0], LU[1] + Math.sin(ambient * 0.8) * 0.2, LU[2]);
        else lugiaPos.set(LU[0] - 4 - away * 30, LU[1] + 6 + away * 40, LU[2] - 10 - away * 110);
        lugia.group.position.copy(lugiaPos);
        lugia.setHeight(t > tFlew ? 8 + away * 6 : 8);
        lugia.group.rotation.y = 0.2 + Math.sin(ambient * 0.4) * 0.05;
        const show = t < tStrike + 0.3 ? 1 - ramp(t, tStrike, tStrike + 0.3) : t > tFlew ? ramp(t, tFlew, tFlew + 1) * (1 - ramp(t, end - 2, end)) : 0;
        figureStyle(lugia, { dissolve: alph ? 0 : show });
      }
      if (hooh) {
        const d = 1 - Math.pow(1 - ramp(t, tDescend - 0.6, tDescend + 3), 2.2);
        if (t < tFlew) hoohPos.set(HO[0], HO[1] + 50 * (1 - d) + Math.sin(ambient * 0.9) * 0.3, HO[2] - 10 * (1 - d));
        else hoohPos.set(HO[0] + 6 + away * 30, HO[1] + 14 + away * 46, HO[2] - 6 - away * 110);
        hooh.group.position.copy(hoohPos);
        hooh.setHeight(t > tFlew ? 10 + away * 6 : 10);
        hoohLight.position.set(hoohPos.x, hoohPos.y + 6, hoohPos.z + 8);
        hoohLight.intensity = alph ? 0 : 20 * ramp(t, tDescend - 0.8, tDescend + 0.6) * (1 - ramp(t, tFlew, tFlew + 2));
        hooh.group.rotation.y = Math.sin(ambient * 0.4) * 0.06;
        figureStyle(hooh, { dissolve: alph ? 0 : ramp(t, tDescend - 0.8, tDescend + 0.6) * (1 - ramp(t, end - 2, end)), glowK: 0.1 + 0.3 * ramp(t, tBeasts - 0.5, tBeasts + 1) * (1 - ramp(t, tBeasts + 3, tFlew)) });
      }
      plumes.u.uCenter.value.set(hoohPos.x, hoohPos.y - 2, hoohPos.z + 1);
      plumes.u.uOpacity.value = alph ? 0 : ramp(t, tDescend - 0.4, tDescend + 1) * (1 - ramp(t, tFlew + 1, end));
      bowMat.uniforms.uOpacity.value = alph ? 0 : bow * 0.32;
      rainbow.quaternion.copy(cam.quaternion);
      // The three: dead in the ashes, then alive again.
      const life = ramp(t, tBeasts - 0.6, tBeasts + 1.6);
      beasts.forEach((f, i) => {
        if (!f) return;
        const there = !alph && t > tDead - 0.3;
        floatFigure(f, BEAST[i], ambient, 0, i, [0.3, 0, -0.3][i], 0);
        figureStyle(f, { dissolve: there ? Math.max(0.55 * ramp(t, tDead - 0.3, tDead + 1.2), life) : 0, shadow: 1 - life, glowK: 0.25 * spike(t, tBeasts + 0.6, 0.3, 1.6) });
        const m = revive[i];
        if (m) { m.u.uForm.value = ramp(t, tBeasts - 1.2, tBeasts + 1); m.u.uTime.value = ambient; m.u.uPixel.value = px; m.u.uOpacity.value = there ? ramp(t, tBeasts - 1.4, tBeasts - 0.8) * (1 - ramp(t, tBeasts + 0.8, tBeasts + 2)) : 0; }
      });
      reviveRing.u.uK.value = ramp(t, tBeasts + 0.2, tBeasts + 2.2);
      reviveRing.u.uTime.value = ambient;
      reviveRing.mesh.visible = !alph && t > tBeasts + 0.2 && t < tBeasts + 2.3;
      // Light.
      L.key.intensity = alph ? 1.4 : 1.8 * (1 - storm * 0.7) * (1 - night * 0.6) + dawn * 0.6 + bow * 0.8;
      L.key.color.copy(alph ? col("#fff0d8") : col("#ffc890").lerp(col("#c8d0ff"), storm).lerp(col("#ffd8a0"), bow));
      L.hemi.intensity = alph ? 0.8 : 0.6 - storm * 0.2 - night * 0.2 + dawn * 0.2;
    },
    look(t) {
      const alph = t < cutTowers;
      const L0: Look = lookAt(
        t,
        { bloom: 0.8, bloomRadius: 0.6 },
        {
          exposure: [[0, 1.05], [cutTowers, 1.0], [tFire, 0.95], [tStrike + 1, 1.0], [tDead, 0.95], [tDescend + 1, 1.05], [end, 1.05]],
          fade: [[cutTowers - 0.45, 0], [cutTowers - 0.08, 1], [cutTowers + 0.12, 1], [cutTowers + 0.7, 0]],
          gain: [[0, [1.0, 1.0, 1.02]], [cutTowers, [1.0, 1.0, 1.02]], [cutTowers + 0.1, [1.1, 0.98, 0.9]], [tFire, [0.95, 0.98, 1.08]], [tStrike + 1, [1.12, 0.94, 0.84]], [tRain + 1, [0.92, 0.96, 1.08]], [tDead, [0.94, 0.94, 1.06]], [tDescend + 1, [1.08, 1.0, 0.94]], [end, [1.08, 1.0, 0.94]]],
          lift: [[0, [0.012, 0.012, 0.012]], [cutTowers, [0.012, 0.012, 0.012]], [cutTowers + 0.1, [0.01, 0.005, 0.0]]],
          saturation: [[0, 0.85], [cutTowers + 0.1, 1.1], [tRain + 1, 0.9], [tDead, 0.8], [tDescend + 1, 1.18], [end, 1.1]],
          contrast: [[0, 0.98], [cutTowers + 0.1, 1.06], [tStrike, 1.15], [tDead, 1.08], [end, 1.04]],
          chroma: [[tStrike - 0.05, 0], [tStrike, 0.6], [tStrike + 1, 0], [tBeasts, 0], [tBeasts + 0.6, 0.3], [tBeasts + 1.6, 0]],
          vignette: [[0, 0.35], [cutTowers + 0.1, 0.42], [tFire, 0.55], [tDead, 0.55], [tFlew, 0.38]],
          bloom: [[0, 0.75], [tStrike, 1.1], [tStrike + 2, 0.9], [tDescend, 1.05], [tBeasts + 1, 1.1], [end, 0.85]],
        }
      );
      L0.flash = Math.min(0.55, 0.55 * spike(t, tStrike, 0.02, 0.25) + 0.15 * spike(t, tBeasts + 0.6, 0.2, 0.8));
      if (alph) L0.rays = { pos: [ALPH[0] + 300, 40, ALPH[2] - 500], color: [1.0, 0.95, 0.85], strength: 0.25 };
      else if (t > tDescend - 0.6 && t < tFlew + 1) L0.rays = { pos: [BT[0] + 1, gh(BT[0], BT[2]) + 14, BT[2] + 6], color: [1.0, 0.85, 0.6], strength: 0.55 * ramp(t, tDescend - 0.6, tDescend + 1) };
      return L0;
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};
