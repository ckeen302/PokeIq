import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeCloudLayer, makeGlow, makeLightning, makeParticles, makePortal, makeRing, makeSky, makeTerrain, merge, noise2, placed, ramp, rng, strikeAt } from "../kit";
import { makeFoliage, makeHouses, makePagoda, makeRuins } from "../props";
import type { ChapterBuilder, Look } from "../types";
import { figureStyle, floatFigure, lights, loadFigures, lookAt, place, pointPixel, shake, spike } from "./common";

/**
 * IX. Almighty Sinnoh. Hisui at dawn: a young village under a great
 * mountain. The ruins of Celestica in the snow, its people long gone.
 * Two clans and their banners, each with its own "almighty Sinnoh" seen
 * as a vast apparition. Then the rift tears open the sky above the
 * mountain (slow motion), a shadow behind it; Arceus's light; the rift
 * closes and the land is given a new name.
 */

const DIALGA_O = 10245, PALKIA_O = 10246, GIRATINA_O = 10007, ARCEUS = 493;
const CEL: Vec3 = [-170, 0, -150];
const RIFT: Vec3 = [0, 120, -250];

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tEra = B("era"), tCel = B("celestica"), tDia = B("diamond"), tPearl = B("pearl"), tRift = B("rift"), tCreator = B("creator"), tName = B("name");
  const end = ctx.timing.anim;
  const cutCel = tCel - 0.4, cutClans = tDia - 0.4;
  const tTear = tRift + 1.4;
  const tClose = tCreator + 2.4;
  const scene = new THREE.Scene();
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));
  const nz = noise2(83);
  const r = rng(29);

  // ---- Sky.
  const sky = makeSky({ top: "#2a4a7a", horizon: "#d89a78", bottom: "#1a1c24", nebulaA: "#6a2a8a", nebulaB: "#ff3a6a", nebula: 0, nebulaScale: 1.2, stars: 0, sunDir: [0.7, 0.06, -0.8], sunColor: "#ffd0a0", sunSize: 600, sunGlow: 0.6, swirl: 0 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  const fog = new THREE.FogExp2(col("#c8b8b0"), 0.004);
  scene.fog = fog;

  // ---- The land: plains, a village, the great mountain.
  const plains = (x: number, z: number) => {
    const mount = Math.exp(-((x * x) / 7000 + ((z + 270) ** 2) / 5000)) * 150 + Math.exp(-(((x + 140) ** 2) / 9000 + ((z + 230) ** 2) / 4000)) * 80;
    const cel = Math.exp(-(((x - CEL[0]) ** 2) / 1600 + ((z - CEL[2]) ** 2) / 1600)) * 30;
    return nz.fbm(x * 0.01 + 5, z * 0.01) * 16 - 6 + mount + cel + nz.fbm(x * 0.04, z * 0.04) * 3 * (mount / 150 + 0.2);
  };
  const H0 = plains(0, 0);
  const gh = (x: number, z: number) => (plains(x, z) - H0) * Math.min(1, 0.15 + Math.hypot(x, z) / 70);
  const land = makeTerrain({
    size: [700, 600], segments: Math.round(q.grid * 0.85), height: (x, z) => gh(x, z - 200),
    color: (h, slope) => (h > 34 ? (slope > 0.55 ? [0.5, 0.5, 0.54] : [0.88, 0.9, 0.95]) : slope > 0.45 ? [0.3, 0.28, 0.24] : [0.24, 0.32, 0.14]),
    center: [0, 0, -200], roughness: 0.9,
  });
  scene.add(land.mesh);
  disposers.push(land.dispose);
  const CEL_AT: Vec3 = [CEL[0], gh(CEL[0], CEL[2]), CEL[2]];

  // ---- The village.
  const spots: { pos: Vec3; rot: number; size: Vec3 }[] = [];
  for (let i = 0; i < 22; i++) {
    const a = r() * Math.PI * 2, d = 9 + r() * 22;
    const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.8 - 6;
    spots.push({ pos: [x, gh(x, z) - 0.2, z], rot: a + Math.PI / 2, size: [4.2, 2.6, 3.6] });
  }
  const village = makeHouses({ spots, wall: "#8a6a4a", roof: "#4a3a32", window: "#ffc070", windowK: 1.6 });
  scene.add(village.group);
  disposers.push(village.dispose);
  const hall = makePagoda({ tiers: 4, base: 9, height: 16, wall: "#9a7a5a", roof: "#3a3a4a", trim: "#d8a548" });
  hall.group.position.set(0, gh(0, -6), -6);
  scene.add(hall.group);
  disposers.push(hall.dispose);
  const treePts: Vec3[] = [];
  for (let i = 0; i < 520; i++) {
    const x = (r() - 0.5) * 260, z = 40 - r() * 170;
    if (Math.hypot(x, z + 6) < 36 || Math.hypot(x + 40, z + 40) < 16 || Math.hypot(x - 40, z + 40) < 16) continue;
    if (gh(x, z) > 10 || Math.hypot(x, z) > 130) continue;
    treePts.push([x, gh(x, z) + 2 + r() * 2, z]);
  }
  const trees = makeFoliage({ points: treePts, size: [4, 7.5], colors: ["#1e3a24", "#4a6a3a"], seed: 8, light: 1.0 });
  scene.add(trees.mesh);
  disposers.push(trees.dispose);

  // ---- Celestica: ruins in the snow, lights going out.
  const ruins = makeRuins({ center: CEL_AT, radius: 18, columns: 30, arches: 3, color: "#8a8478", seed: 13, height: [2, 7], heightAt: gh });
  scene.add(ruins.mesh);
  disposers.push(ruins.dispose);
  const snow = makeParticles({ count: P(2200), shape: "box", center: [CEL_AT[0], CEL_AT[1] + 7, CEL_AT[2]], extent: [26, 9, 22], velocity: [1.2, -1.3, 0.3], spread: [0.4, 0.3, 0.4], life: 9, size: [0.03, 0.09], colors: ["#ffffff", "#e6eeff", "#c8d4ff"], intensity: 1.3, turbulence: 0.8, seed: 3 });
  const ghosts = makeParticles({ count: P(160), shape: "box", center: [CEL_AT[0], CEL_AT[1] + 1.6, CEL_AT[2]], extent: [12, 0.6, 10], velocity: [0, 0.15, 0], spread: [0.05, 0.05, 0.05], life: 6, size: [0.3, 0.6], colors: ["#ffd8a0", "#ffb070", "#ff9050"], intensity: 1.6, flicker: 0.4, seed: 4 });
  [snow, ghosts].forEach((p) => { scene.add(p.points); disposers.push(p.dispose); });

  // ---- The clans' banners.
  const pole = new THREE.CylinderGeometry(0.08, 0.1, 7, 6);
  const cloth = new THREE.PlaneGeometry(1.6, 3.6, 1, 6);
  cloth.translate(0.85, 1.6, 0);
  const banner = (color: string, at: Vec3[]) => {
    const poles = merge(at.map((p) => placed(pole.clone(), [p[0], p[1] + 3.5, p[2]])));
    const cloths = merge(at.map((p, i) => placed(cloth.clone(), [p[0], p[1] + 3.2, p[2]], 0.3 * (i % 2 ? 1 : -1))));
    const pm = new THREE.MeshStandardMaterial({ color: col("#3a2a20"), roughness: 0.8 });
    const cm = new THREE.MeshStandardMaterial({ color: col(color), roughness: 0.7, emissive: col(color), emissiveIntensity: 0.25, side: THREE.DoubleSide });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(poles, pm), new THREE.Mesh(cloths, cm));
    scene.add(g);
    disposers.push(() => { poles.dispose(); cloths.dispose(); pm.dispose(); cm.dispose(); });
    return { g, cm };
  };
  const ring = (cx: number, cz: number, n: number) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; const x = cx + Math.cos(a) * 7, z = cz + Math.sin(a) * 5; return [x, gh(x, z), z] as Vec3; });
  const blue = banner("#3a6ad8", ring(-44, -40, 7));
  const pink = banner("#e86aa8", ring(44, -40, 7));
  disposers.push(() => { pole.dispose(); cloth.dispose(); });
  const DIA_AT: Vec3 = [-34, 26, -150], PAL_AT: Vec3 = [34, 26, -150];
  const diaGlow = makeGlow({ pos: [DIA_AT[0], DIA_AT[1] + 20, DIA_AT[2]], size: 120, color: "#4a8aff", intensity: 0 });
  const palGlow = makeGlow({ pos: [PAL_AT[0], PAL_AT[1] + 20, PAL_AT[2]], size: 120, color: "#ff8ac8", intensity: 0 });
  [diaGlow, palGlow].forEach((g) => { scene.add(g.sprite); disposers.push(g.dispose); });

  // ---- The rift.
  const clouds = makeCloudLayer({ size: 900, y: 95, color: "#3a2a4a", shadow: "#0a0610", density: 0.7, scale: 0.008, speed: [2, 0, 1], intensity: 0.9 });
  clouds.mesh.position.set(0, 95, -200);
  clouds.u.uHoleGlow.value.copy(col("#ff4aa0", 1.6));
  scene.add(clouds.mesh);
  disposers.push(clouds.dispose);
  const rift = makePortal({ radius: 60, inner: "#1a0a2a", outer: "#ff3a8a", intensity: 2.0, tear: 0.55 });
  rift.mesh.position.set(...RIFT);
  scene.add(rift.mesh);
  disposers.push(rift.dispose);
  const riftBolts = [makeLightning({ color: "#d07aff", width: 0.8, intensity: 6, branches: 4 }), makeLightning({ color: "#ff8ac8", width: 0.7, intensity: 5, branches: 3 })];
  riftBolts.forEach((b) => { scene.add(b.mesh); disposers.push(b.dispose); });
  const lastBolt = [-1, -1];
  const riftDust = makeParticles({ count: P(1800), shape: "shell", center: RIFT, extent: [70, 40, 20], velocity: [0, 0, 0], life: 3, size: [0.4, 1.2], colors: ["#ffd0f0", "#c07aff", "#5a2aff"], intensity: 2.2, pull: 18, swirl: 0.4, seed: 6 });
  scene.add(riftDust.points);
  disposers.push(riftDust.dispose);
  const ARC: Vec3 = [0, 74, -190];
  const halo = makeRing({ color: "#ffe2a0", intensity: 1.6, thickness: 0.04 });
  halo.mesh.position.set(...ARC);
  halo.mesh.scale.setScalar(40);
  scene.add(halo.mesh);
  disposers.push(halo.dispose);
  const arcGlow = makeGlow({ pos: ARC, size: 70, color: "#ffd890", intensity: 0 });
  scene.add(arcGlow.sprite);
  disposers.push(arcGlow.dispose);

  // ---- Light.
  const L = lights(scene, { sky: "#c8d0ff", ground: "#2a2418", fill: 0.6, key: "#ffd8b0", keyK: 1.8, keyPos: [80, 30, -100], rim: "#8ab0ff", rimK: 0.5, rimPos: [-40, 30, 60] });

  // ---- Figures.
  const figs = await loadFigures(ctx, [DIALGA_O, PALKIA_O, GIRATINA_O, ARCEUS]);
  const dia = figs.get(DIALGA_O), pal = figs.get(PALKIA_O), gir = figs.get(GIRATINA_O), arc = figs.get(ARCEUS);
  place(dia, DIA_AT, 46, 0.25, scene);
  figureStyle(dia, { rim: "#8ab8ff", rimK: 2, glow: "#3a6aff", glowK: 0.25, edge: "#cfe0ff", dissolve: 0 });
  place(pal, PAL_AT, 46, -0.25, scene);
  figureStyle(pal, { rim: "#ffb8e0", rimK: 2, glow: "#ff6ab0", glowK: 0.25, edge: "#ffe0f0", dissolve: 0 });
  const GI: Vec3 = [RIFT[0], RIFT[1] - 22, RIFT[2] - 8];
  place(gir, GI, 44, 0, scene);
  figureStyle(gir, { rim: "#ff4a6a", rimK: 2.4, glow: "#2a0010", glowK: 0.1, edge: "#ff6a8a", dissolve: 0, shadow: 0.5 });
  place(arc, ARC, 20, 0, scene);
  figureStyle(arc, { rim: "#fff0c0", rimK: 1.0, glow: "#ffe0a0", glowK: 0.04, edge: "#ffffff", dissolve: 0 });

  const keys: Key[] = [
    { t: 0, pos: [34, 32, 96], look: [0, 30, -220], fov: 50 },
    { t: tEra, pos: [14, 9, 44], look: [0, 8, -20], fov: 46 },
    { t: cutCel, pos: [-8, 6, 30], look: [0, 6, -10], fov: 46 },
    { t: cutCel + 0.01, pos: [CEL_AT[0] + 3, CEL_AT[1] + 4, CEL_AT[2] + 28], look: [CEL_AT[0], CEL_AT[1] + 3, CEL_AT[2]], fov: 44 },
    { t: cutClans, pos: [CEL_AT[0] - 8, CEL_AT[1] + 3, CEL_AT[2] + 15], look: [CEL_AT[0] + 2, CEL_AT[1] + 3, CEL_AT[2] - 6], fov: 44 },
    { t: cutClans + 0.01, pos: [-50, 4.5, -16], look: [-34, 34, -150], fov: 50 },
    { t: tPearl - 0.4, pos: [-30, 6, -12], look: [-20, 36, -150], fov: 50 },
    { t: tPearl, pos: [50, 4.5, -16], look: [34, 34, -150], fov: 50 },
    { t: tRift - 0.4, pos: [30, 6, -12], look: [20, 40, -150], fov: 50 },
    { t: tRift, pos: [0, 8, 30], look: [0, 92, -240], fov: 58 },
    { t: tTear + 2.2, pos: [0, 22, -64], look: [0, 108, -245], fov: 52 },
    { t: tCreator, pos: [0, 30, -92], look: [0, 74, -185], fov: 46 },
    { t: tName - 0.6, pos: [-6, 34, -100], look: [0, 76, -190], fov: 46 },
    { t: tName, pos: [12, 7, 32], look: [0, 10, -30], fov: 46 },
    { t: end, pos: [26, 17, 72], look: [0, 22, -170], fov: 52 },
  ];

  return {
    scene,
    portalScale: 7,
    camera: (t) => shake(poseOnPath(keys, t), t, [{ at: tTear, k: 0.22, dur: 2.6 }, { at: tClose, k: 0.1, dur: 1.6 }]),
    orbit: (t) => ({ target: t < cutCel || t >= tName ? [0, 8, -20] : t < cutClans ? [CEL_AT[0], CEL_AT[1] + 3, CEL_AT[2]] : t < tRift ? [0, 30, -150] : [0, 90, -230], limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.15, maxPitch: 1.1, minDist: 4, maxDist: 260 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const cel = t >= cutCel && t < cutClans;
      const dark = ramp(t, tRift - 0.6, tRift + 1.2) * (1 - ramp(t, tClose, tName + 1));
      const open = ramp(t, tRift + 0.2, tTear + 0.6) * (1 - ramp(t, tClose - 0.4, tClose + 1.4));
      const godA = ramp(t, cutClans + 0.6, tDia + 1.8) * (1 - ramp(t, tRift - 0.5, tRift + 1));
      const godB = ramp(t, tPearl - 0.2, tPearl + 1.4) * (1 - ramp(t, tRift - 0.5, tRift + 1));
      const arcK = ramp(t, tCreator - 0.4, tCreator + 1.4) * (1 - ramp(t, tName, tName + 2));
      const healed = ramp(t, tClose, tName + 1);
      // Sky.
      const top = sky.u.uTop.value, hor = sky.u.uHorizon.value;
      if (cel) { top.copy(col("#6a7a90")); hor.copy(col("#c8ccd4")); fog.color.copy(col("#b8bcc8")); fog.density = 0.028; sky.u.uSunGlow.value = 0.1; }
      else {
        top.copy(col("#2a4a7a").lerp(col("#100820"), dark).lerp(col("#3a5a90"), healed));
        hor.copy(col("#d89a78").lerp(col("#5a2a5a"), dark).lerp(col("#d8a080"), healed));
        fog.color.copy(col("#c8b8b0").lerp(col("#2a1a30"), dark).lerp(col("#d8c0b0"), healed));
        fog.density = 0.004 + dark * 0.001;
        sky.u.uSunGlow.value = 0.3 * (1 - dark);
      }
      sky.u.uSunColor.value.copy(col("#ffd0a0", 1 - dark));
      sky.u.uNeb.value = dark * 0.8;
      sky.u.uSwirl.value = dark * 1.5;
      sky.u.uStars.value = dark * 0.04;
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      trees.u.uTime.value = ambient;
      // Celestica.
      for (const p of [snow, ghosts, riftDust]) { p.u.uTime.value = ambient; p.u.uPixel.value = px; }
      snow.u.uOpacity.value = cel ? 1 : 0;
      ghosts.u.uOpacity.value = cel ? 1 - ramp(t, tCel + 1, tCel + 4.5) : 0;
      // The clans and their deities: vast apparitions over the mountains.
      blue.cm.emissiveIntensity = 0.25 + godA * 0.6;
      pink.cm.emissiveIntensity = 0.25 + godB * 0.6;
      if (dia) { floatFigure(dia, DIA_AT, ambient, 0.6, 0, 0.25, 0.03); figureStyle(dia, { dissolve: godA * 0.85, glowK: 0.25 }); }
      if (pal) { floatFigure(pal, PAL_AT, ambient, 0.6, 1, -0.25, 0.03); figureStyle(pal, { dissolve: godB * 0.85, glowK: 0.25 }); }
      diaGlow.set("#4a8aff", godA * 0.5);
      palGlow.set("#ff8ac8", godB * 0.5);
      // The rift: torn open, a shadow behind it, lightning.
      clouds.u.uTime.value = ambient;
      clouds.u.uOpacity.value = dark;
      clouds.mesh.visible = dark > 0.001;
      clouds.u.uHole.value.set(RIFT[0], RIFT[2], 70 * open);
      rift.u.uTime.value = ambient;
      rift.u.uOpen.value = Math.max(0.001, open);
      rift.mesh.visible = open > 0.001;
      rift.mesh.quaternion.copy(cam.quaternion);
      riftDust.u.uOpacity.value = open;
      if (gir) { floatFigure(gir, GI, ambient, 0.8, 2, 0, 0.04); figureStyle(gir, { dissolve: ramp(t, tTear, tTear + 2.5) * (1 - ramp(t, tClose - 0.6, tClose + 0.6)) * 0.9, shadow: 0.5 }); }
      [strikeAt(t, 1.1, 21), strikeAt(t + 0.5, 1.6, 23)].forEach((s, i) => {
        const b = riftBolts[i];
        if (s.level > 0 && open > 0.4 && s.id !== lastBolt[i]) {
          lastBolt[i] = s.id;
          const rr = rng(s.id * 17 + i);
          const a = rr() * Math.PI * 2;
          b.strike([RIFT[0] + Math.cos(a) * 34, RIFT[1] + Math.sin(a) * 20, RIFT[2] + 4], [RIFT[0] + Math.cos(a) * 80 + (rr() - 0.5) * 30, RIFT[1] - 60 - rr() * 30, RIFT[2] + 20], s.id * 3 + i, cam.position);
        }
        b.u.uAlpha.value = open > 0.4 ? s.level * open : 0;
      });
      // Arceus.
      if (arc) { floatFigure(arc, ARC, ambient, 0.5, 0, 0, 0.03); figureStyle(arc, { dissolve: arcK, glowK: 0.04 + 0.15 * spike(t, tClose, 0.2, 1.4) }); }
      halo.u.uK.value = 0.35 + 0.05 * Math.sin(ambient * 1.2);
      halo.u.uTime.value = ambient;
      halo.u.uOpacity.value = arcK * (1 - ramp(t, tName - 0.5, tName + 1));
      halo.mesh.visible = arcK > 0.001;
      halo.mesh.quaternion.copy(cam.quaternion);
      arcGlow.set("#ffd890", arcK * 0.2 + spike(t, tClose, 0.2, 1.2) * 0.3);
      // Light.
      L.key.intensity = cel ? 1.0 : 1.8 * (1 - dark * 0.6) + arcK * 1.2;
      L.key.color.copy(cel ? col("#dfe6ff") : col("#ffd8b0").lerp(col("#c08aff"), dark).lerp(col("#ffe0a0"), arcK));
      L.hemi.intensity = cel ? 0.8 : 0.6 - dark * 0.2;
    },
    look(t) {
      const cel = t >= cutCel && t < cutClans;
      const L0: Look = lookAt(
        t,
        { bloom: 0.8, bloomRadius: 0.6 },
        {
          exposure: [[0, 1.02], [tRift, 0.98], [tCreator, 1.05], [end, 1.05]],
          fade: [cutCel, cutClans].flatMap((c) => [[c - 0.45, 0], [c - 0.08, 1], [c + 0.12, 1], [c + 0.7, 0]] as [number, number][]),
          gain: [[0, [1.08, 1.0, 0.94]], [cutCel, [1.08, 1.0, 0.94]], [cutCel + 0.1, [0.94, 0.98, 1.08]], [cutClans, [0.94, 0.98, 1.08]], [cutClans + 0.1, [0.98, 0.98, 1.06]], [tPearl, [1.06, 0.97, 1.02]], [tRift, [1.02, 0.92, 1.1]], [tCreator, [1.1, 1.0, 0.9]], [tName + 1, [1.08, 1.0, 0.94]]],
          saturation: [[0, 1.08], [cutCel + 0.1, 0.75], [cutClans + 0.1, 1.1], [tRift, 1.15], [tName, 1.08]],
          contrast: [[0, 1.04], [tRift, 1.14], [tName, 1.04]],
          chroma: [[tTear - 0.05, 0], [tTear + 0.2, 0.8], [tTear + 2, 0.35], [tClose, 0.3], [tClose + 1, 0]],
          vignette: [[0, 0.35], [tRift, 0.55], [tName, 0.38]],
          bloom: [[0, 0.8], [tRift, 1.0], [tCreator, 1.15], [tName + 1, 0.85]],
        }
      );
      L0.flash = Math.min(0.5, 0.35 * spike(t, tTear, 0.05, 0.6) + 0.35 * spike(t, tClose, 0.1, 0.7));
      if (!cel && t > tCreator - 0.5 && t < tName + 2) L0.rays = { pos: ARC, color: [1.0, 0.9, 0.65], strength: 0.3 * ramp(t, tCreator - 0.5, tCreator + 1) * (1 - ramp(t, tName, tName + 2)) };
      else if (!cel && t > tRift && t < tCreator) L0.rays = { pos: RIFT, color: [1.0, 0.55, 0.85], strength: 0.45 * ramp(t, tRift + 0.5, tTear + 1) };
      else if (!cel && (t < cutCel || t >= tName + 2)) L0.rays = { pos: [560, 50, -640], color: [1.0, 0.85, 0.65], strength: 0.3 };
      return L0;
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};
