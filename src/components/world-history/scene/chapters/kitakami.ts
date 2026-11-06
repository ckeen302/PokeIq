import * as THREE from "three";
import { handheld, poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeCloudLayer, makeGlow, makeParticles, makeRing, makeSky, makeTerrain, noise2, ramp, rng, stoneMaterial } from "../kit";
import { makeFoliage, makeHouses, makeLanterns } from "../props";
import type { ChapterBuilder, Look } from "../types";
import { actionCurve, hitCurve } from "../figures";
import { cine, craft, figureStyle, floatFigure, lights, loadFigures, lookAt, place, pointPixel, shake, spike } from "./common";

/**
 * VII. The Ogre's True Story. A moonlit valley in Kitakami under lantern
 * light. The monument's version: three stone heroes. The mask maker's
 * version: a man and an ogre from a foreign land, four masks; three
 * greedy Pokémon steal three of them; the ogre dons the last and defeats
 * them. The village believes the monument. The mask maker, who knew,
 * is left alone on the hill.
 */

const OKIDOGI = 1014, MUNKIDORI = 1015, FEZANDIPITI = 1016, OGERPON = 1017;
const THREE_ARTS = [OKIDOGI, MUNKIDORI, FEZANDIPITI];
const RIDGE: Vec3 = [34, 0, -64];
const HUT: Vec3 = [-26, 0, 8];

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tMon = B("monument"), tMasks = B("masks"), tStole = B("stole"), tDon = B("donned"), tThought = B("thought"), tHer = B("heretic");
  const end = ctx.timing.anim;
  const cuts = [tMasks - 0.4, tStole - 0.4, tThought - 0.4, tHer - 0.4];
  const scene = new THREE.Scene();
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));
  const nz = noise2(29);
  const r = rng(13);

  // ---- Night sky with a moon.
  const sky = makeSky({ top: "#03061a", horizon: "#1a2448", bottom: "#020308", nebulaA: "#1a3a7a", nebulaB: "#3a1a5a", nebula: 0.3, nebulaScale: 1.5, stars: 0.12, sunDir: [-0.35, 0.32, -1], sunColor: "#dfe6ff", sunSize: 2600, sunGlow: 0.35 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  const fog = new THREE.FogExp2(col("#070b18"), 0.009);
  scene.fog = fog;
  const mist = makeCloudLayer({ size: 500, y: 1.2, color: "#5a6a9a", shadow: "#141a30", density: 0.35, scale: 0.02, speed: [1, 0, 0.3], intensity: 0.22 });
  scene.add(mist.mesh);
  disposers.push(mist.dispose);

  // ---- The valley, the mountain beyond.
  const valley = (x: number, z: number) => {
    const ridge = Math.exp(-(((x - RIDGE[0]) ** 2) / 900 + ((z - RIDGE[2]) ** 2) / 700)) * 8;
    const hill = Math.exp(-(((x - HUT[0]) ** 2) / 300 + ((z - HUT[2]) ** 2) / 300)) * 3.5;
    const mount = Math.exp(-((x * x) / 9000 + ((z + 190) ** 2) / 5000)) * 70;
    const flat = Math.exp(-((x * x + (z + 2) * (z + 2)) / 500));
    return (nz.fbm(x * 0.02 + 3, z * 0.02) * 6 - 3) * (1 - flat) + ridge + hill + mount + Math.pow(Math.abs(x) / 80, 2) * 14;
  };
  const H0 = valley(0, -2);
  const gh = (x: number, z: number) => valley(x, z) - H0;
  const land = makeTerrain({
    size: [420, 440], segments: Math.round(q.grid * 0.75), height: (x, z) => gh(x, z - 120),
    color: (h, slope) => (slope > 0.5 ? [0.2, 0.2, 0.2] : h > 30 ? [0.28, 0.3, 0.34] : [0.12, 0.2, 0.12]),
    center: [0, 0, -120], roughness: 0.95,
  });
  scene.add(land.mesh);
  disposers.push(land.dispose);
  const RIDGE_AT: Vec3 = [RIDGE[0], gh(RIDGE[0], RIDGE[2]), RIDGE[2]];
  const HUT_AT: Vec3 = [HUT[0], gh(HUT[0], HUT[2]), HUT[2]];

  // ---- Trees, the monument, the village, the mask maker's house.
  const treePts: Vec3[] = [];
  for (let i = 0; i < 700; i++) {
    const x = (r() - 0.5) * 260, z = 30 - r() * 260;
    if (Math.hypot(x, z + 2) < 16 || Math.abs(x - 7) < 3 || gh(x, z) > 14) continue;
    treePts.push([x, gh(x, z) + 1.2 + r() * 2, z]);
  }
  const trees = makeFoliage({ points: treePts, size: [3, 6], colors: ["#0e2a1a", "#2a4a2a"], seed: 3, light: 0.5 });
  scene.add(trees.mesh);
  disposers.push(trees.dispose);
  const stoneMat = stoneMaterial({ color: "#6a6a68", roughness: 0.85, dirt: 0.5 });
  const pedestals = [-3.2, 0, 3.2].map((x, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.8), stoneMat);
    m.position.set(x, gh(x, -6) + 0.55, -6 - (i === 1 ? 0.8 : 0));
    scene.add(m);
    return m;
  });
  disposers.push(() => { pedestals.forEach((p) => p.geometry.dispose()); stoneMat.dispose(); });
  const STATUE: Vec3[] = pedestals.map((p) => [p.position.x, p.position.y + 0.55, p.position.z]);
  const houses = makeHouses({
    spots: [[-12, 2], [-16, -8], [16, -4], [20, -14], [-8, -16], [-14, 12], [-20, -20], [24, 2]].map(([x, z], i) => ({ pos: [x, gh(x, z) - 0.2, z] as Vec3, rot: (i % 3) * 0.4 - 0.3, size: [4.5, 3, 4] as Vec3 })),
    wall: "#5a4a3a", roof: "#2a2a32", window: "#ffb060", windowK: 2.2,
  });
  scene.add(houses.group);
  disposers.push(houses.dispose);
  const hut = makeHouses({ spots: [{ pos: [HUT_AT[0], HUT_AT[1] - 0.2, HUT_AT[2] - 2], rot: 0.5, size: [3.6, 2.6, 3.2] }], wall: "#4a3c30", roof: "#22222a", window: "#ffb060", windowK: 1.4 });
  scene.add(hut.group);
  disposers.push(hut.dispose);
  const pathPts: Vec3[] = [];
  for (let z = 26; z > -60; z -= 5) pathPts.push([4.6, gh(4.6, z) + 1.6, z]);
  for (const [x, z] of [[-5.6, -6.5], [5.6, -6.5]] as [number, number][]) pathPts.push([x, gh(x, z) + 1.4, z]);
  const lanterns = makeLanterns({ points: pathPts, color: "#ffa850", size: 0.14, intensity: 3, seed: 4 });
  scene.add(lanterns.group);
  disposers.push(lanterns.dispose);
  const procPts: Vec3[] = [];
  for (let i = 0; i < 26; i++) { const x = (r() - 0.5) * 16, z = 2 + r() * 14; procPts.push([x, gh(x, z) + 1.3, z]); }
  const procession = makeLanterns({ points: procPts, color: "#ffcf80", size: 0.1, intensity: 3, seed: 5 });
  scene.add(procession.group);
  disposers.push(procession.dispose);
  const hutLamp = makeLanterns({ points: [[HUT_AT[0] + 1.4, HUT_AT[1] + 1.6, HUT_AT[2] + 0.6]], color: "#ffb060", size: 0.14, intensity: 3, seed: 6 });
  scene.add(hutLamp.group);
  disposers.push(hutLamp.dispose);
  const fireflies = makeParticles({ count: P(700), shape: "box", center: [0, 2.5, -10], extent: [40, 2.5, 40], velocity: [0, 0.1, 0], spread: [0.4, 0.3, 0.4], life: 8, size: [0.03, 0.07], colors: ["#e8ff9a", "#b8ff6a", "#ffe08a"], intensity: 2.4, turbulence: 0.8, flicker: 0.7, seed: 7 });
  scene.add(fireflies.points);
  disposers.push(fireflies.dispose);

  // On the ridge: dark brush framing the fight in the foreground, and fireflies stirred up around it.
  const brushPts: Vec3[] = [];
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    const x = RIDGE_AT[0] - 2 + side * (5.5 + r() * 5), z = RIDGE_AT[2] + 9 + r() * 6;
    brushPts.push([x, gh(x, z) + 0.6 + r() * 1.4, z]);
  }
  const brush = makeFoliage({ points: brushPts, size: [1.6, 3.2], colors: ["#040a08", "#0c1a12"], seed: 9, light: 0.25 });
  scene.add(brush.mesh);
  disposers.push(brush.dispose);
  const ridgeFlies = makeParticles({ count: P(420), shape: "box", center: [RIDGE_AT[0] - 1, RIDGE_AT[1] + 2, RIDGE_AT[2] + 3], extent: [10, 2.5, 7], velocity: [0, 0.15, 0], spread: [0.5, 0.3, 0.5], life: 6, size: [0.03, 0.07], colors: ["#d8ff9a", "#9affd0", "#ffe08a"], intensity: 3, turbulence: 0.9, flicker: 0.8, seed: 17 });
  scene.add(ridgeFlies.points);
  disposers.push(ridgeFlies.dispose);

  // ---- People: the man, the mask maker.
  const man = new THREE.Group();
  const manBody = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.34, 1.6, 12), new THREE.MeshStandardMaterial({ color: col("#3a3240"), roughness: 0.8 }));
  manBody.position.y = 0.8;
  const manHead = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), manBody.material);
  manHead.position.y = 1.75;
  man.add(manBody, manHead);
  scene.add(man);
  const maker = man.clone();
  maker.position.set(HUT_AT[0] + 2.2, HUT_AT[1], HUT_AT[2] + 1.2);
  maker.rotation.y = 0.8;
  scene.add(maker);
  disposers.push(() => { manBody.geometry.dispose(); manHead.geometry.dispose(); (manBody.material as THREE.Material).dispose(); });

  // ---- The four masks.
  const MASK_COL = ["#3ad0a0", "#ff5a3a", "#4a8aff", "#a8a8a0"];
  const maskGeo = new THREE.CircleGeometry(0.28, 20);
  const masks = MASK_COL.map((c) => {
    const m = new THREE.Mesh(maskGeo, new THREE.MeshBasicMaterial({ color: col(c, 2.2), side: THREE.DoubleSide, toneMapped: false }));
    const g = makeGlow({ pos: [0, 0, 0], size: 1.6, color: c, intensity: 0.8 });
    m.add(g.sprite);
    scene.add(m);
    disposers.push(() => { (m.material as THREE.Material).dispose(); g.dispose(); });
    return m;
  });
  disposers.push(() => maskGeo.dispose());
  const clash = makeRing({ color: "#7affd0", intensity: 1.6, thickness: 0.05 });
  clash.mesh.position.set(RIDGE_AT[0] - 2, RIDGE_AT[1] + 2.5, RIDGE_AT[2] + 4);
  clash.mesh.scale.setScalar(8);
  scene.add(clash.mesh);
  disposers.push(clash.dispose);
  const leaves = makeParticles({ count: P(900), shape: "sphere", center: [RIDGE_AT[0] - 2, RIDGE_AT[1] + 2, RIDGE_AT[2] + 4], extent: [2, 2, 2], velocity: [0, 1, 0], spread: [7, 4, 7], gravity: [0, -2, 0], life: 2.6, size: [0.05, 0.14], colors: ["#cfffe8", "#3ad0a0", "#1a6a4a"], intensity: 2.4, burst: true, fadeOut: 0.5, seed: 8 });
  scene.add(leaves.points);
  disposers.push(leaves.dispose);

  // ---- Light.
  const L = lights(scene, { sky: "#4a5aa8", ground: "#0a100c", fill: 0.3, key: "#a8c0ff", keyK: 1.5, keyPos: [-30, 40, -60], rim: "#ffa860", rimK: 0.45, rimPos: [10, 6, 20] });
  const lampLight = new THREE.PointLight(col("#ffa850"), 4, 26, 1.2);
  lampLight.position.set(0, 3, -2);
  scene.add(lampLight);

  // ---- Figures.
  const figs = await loadFigures(ctx, [...THREE_ARTS, OGERPON]);
  const trio = THREE_ARTS.map((a) => figs.get(a));
  const oger = figs.get(OGERPON);
  const THIEF: Vec3[] = [[RIDGE_AT[0] - 7, RIDGE_AT[1] - 0.3, RIDGE_AT[2] - 1], [RIDGE_AT[0] - 1, RIDGE_AT[1] + 0.2, RIDGE_AT[2] - 3], [RIDGE_AT[0] + 5, RIDGE_AT[1] + 0.8, RIDGE_AT[2] - 1]];
  trio.forEach((f, i) => { place(f, STATUE[i], 2.2, 0, scene); figureStyle(f, { rim: "#cfd8ff", rimK: 1.2, edge: "#ff5a5a", stone: 1 }); });
  place(oger, [7, 0, -40], 1.25, 0, scene);
  figureStyle(oger, { rim: "#9affd8", rimK: 2.2, glow: "#3ad0a0", glowK: 0.04, edge: "#cfffe8" });
  const sh = craft(ctx, L, {
    radius: 14, center: RIDGE_AT,
    receive: [land.mesh, ...pedestals],
    cast: [...pedestals, man],
    figures: [...trio.map((f) => [f, { alive: 0 }] as [typeof f, { alive: number }]), [oger, { alive: 1.1 }]],
    detail: [[land.mesh.material, { kind: "ground", scale: 1.2, bump: 1.2 }], [stoneMat, { kind: "stone", scale: 2.4, bump: 1 }]],
  });

  const keys: Key[] = [
    { t: 0, pos: [0, 6, 30], look: [0, 2.4, -6], fov: 46 },
    { t: tMon, pos: [4.2, 2.3, 6.2], look: [0, 2.4, -6.5], fov: 40 },
    { t: cuts[0], pos: [-4.2, 2.0, 5.2], look: [0, 2.3, -6.5], fov: 40 },
    { t: cuts[0] + 0.01, pos: [12, 2.4, 16], look: [7, 1.4, 2], fov: 42 },
    { t: cuts[1], pos: [12.5, 2.4, 14], look: [7, 1.4, 6], fov: 42 },
    { t: cuts[1] + 0.01, pos: [RIDGE_AT[0] - 6, RIDGE_AT[1] + 3, RIDGE_AT[2] + 13], look: [RIDGE_AT[0] - 1, RIDGE_AT[1] + 2.2, RIDGE_AT[2] - 2], fov: 44 },
    { t: tDon, pos: [RIDGE_AT[0] - 4.2, RIDGE_AT[1] + 1.9, RIDGE_AT[2] + 10.5], look: [RIDGE_AT[0] - 1.2, RIDGE_AT[1] + 1.9, RIDGE_AT[2] - 0.5], fov: 42 },
    { t: tDon + 3.4, pos: [RIDGE_AT[0] - 6, RIDGE_AT[1] + 2.4, RIDGE_AT[2] + 11.5], look: [RIDGE_AT[0] - 1, RIDGE_AT[1] + 2, RIDGE_AT[2] - 1], fov: 46 },
    { t: cuts[2], pos: [RIDGE_AT[0] - 9, RIDGE_AT[1] + 4, RIDGE_AT[2] + 18], look: [RIDGE_AT[0] - 1, RIDGE_AT[1] + 2, RIDGE_AT[2] - 1], fov: 50 },
    { t: cuts[2] + 0.01, pos: [0, 3.2, 12], look: [0, 2.3, -6], fov: 44 },
    { t: cuts[3], pos: [5, 2.5, 7], look: [0, 2.3, -6], fov: 40 },
    { t: cuts[3] + 0.01, pos: [HUT_AT[0] + 8, HUT_AT[1] + 2.4, HUT_AT[2] + 10], look: [HUT_AT[0] + 1, HUT_AT[1] + 1.6, HUT_AT[2]], fov: 40 },
    { t: end, pos: [HUT_AT[0] + 18, HUT_AT[1] + 9, HUT_AT[2] + 30], look: [HUT_AT[0] + 10, HUT_AT[1] + 1, HUT_AT[2] - 8], fov: 50 },
  ];

  const ogerPos = new THREE.Vector3(), tmp = new THREE.Vector3();

  return {
    scene,
    portalScale: 3,
    // A handheld camera on the ridge: we're in the fight with the ogre.
    camera: (t) => shake(handheld(poseOnPath(keys, t), t, t >= cuts[1] && t < cuts[2] ? 1.0 : 0.35, 7), t, [{ at: tDon + 1.6, k: 0.1, dur: 1.6 }, { at: tDon + 3.2, k: 0.08 }]),
    orbit: (t) => ({ target: t < cuts[0] || (t >= cuts[2] && t < cuts[3]) ? [0, 2.3, -6] : t < cuts[1] ? [7, 1.3, 2] : t < cuts[2] ? [RIDGE_AT[0] - 1, RIDGE_AT[1] + 2, RIDGE_AT[2] - 1] : [HUT_AT[0] + 1, HUT_AT[1] + 1.6, HUT_AT[2]], limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.15, maxPitch: 1.0, minDist: 2, maxDist: 120 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const statues = t < cuts[1] || t >= cuts[2];
      const ridge = t >= cuts[1] && t < cuts[2];
      brush.mesh.visible = ridge;
      ridgeFlies.u.uOpacity.value = ridge ? 1 : 0;
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      mist.u.uTime.value = ambient;
      trees.u.uTime.value = ambient;
      fireflies.u.uTime.value = ambient;
      fireflies.u.uPixel.value = px;
      ridgeFlies.u.uTime.value = ambient;
      ridgeFlies.u.uPixel.value = px;
      brush.u.uTime.value = ambient;
      lanterns.update(ambient, 0, px);
      procession.update(ambient, 0, px);
      hutLamp.update(ambient, 0, px);
      procession.group.visible = t >= cuts[2] && t < cuts[3];
      // The three: stone heroes on the monument; alive (and greedy) on the ridge.
      trio.forEach((f, i) => {
        if (!f) return;
        f.setHeight(statues ? 2.2 : 2.8);
        if (statues) {
          f.group.position.set(...STATUE[i]);
          f.group.rotation.y = [0.25, 0, -0.25][i];
          figureStyle(f, { dissolve: 1, stone: 1, shadow: 0, alive: 0, hit: 0 });
          f.setContact(0.5, STATUE[i][1]);
        } else {
          const beaten = ramp(t, tDon + 2.4 + i * 0.25, tDon + 4.2 + i * 0.25);
          floatFigure(f, [THIEF[i][0] + beaten * (i - 1) * 2, THIEF[i][1], THIEF[i][2] - beaten * 3], ambient, 0.05, i, [0.4, 0, -0.4][i], 0.05);
          figureStyle(f, { dissolve: ramp(t, cuts[1] + 0.3 + i * 0.3, tStole + 1.4 + i * 0.3) * (1 - beaten), stone: 0, shadow: 0.25, alive: 0.9, hit: hitCurve(t, tDon + 1.65 + i * 0.12, 1.0) });
          f.setContact(0.5, THIEF[i][1]);
        }
      });
      // The man and the ogre, walking in from far away; the four masks.
      const walk = ramp(t, cuts[0], cuts[1] + 0.5);
      ogerPos.set(7.6, 0, -34 + walk * 36);
      ogerPos.y = gh(ogerPos.x, ogerPos.z);
      man.visible = t >= cuts[0] && t < cuts[1];
      man.position.set(6.2, gh(6.2, ogerPos.z + 0.6), ogerPos.z + 0.6);
      if (oger) {
        if (t < cuts[1]) {
          oger.group.position.copy(ogerPos);
          oger.group.position.y += Math.abs(Math.sin(ambient * 4)) * 0.06;
          oger.group.rotation.y = -0.2;
        } else {
          oger.group.position.set(RIDGE_AT[0] - 2 + ramp(t, tDon, tDon + 1.6) * 0, RIDGE_AT[1] + 0.1, RIDGE_AT[2] + 6 - ramp(t, tDon + 0.6, tDon + 1.8) * 4);
          oger.group.rotation.y = 0;
        }
        const on = t >= cuts[0] && t < cuts[2];
        // The strike: a coiled crouch, the swing, the follow-through.
        figureStyle(oger, { dissolve: on ? 1 : 0, glowK: 0.04 + 0.5 * ramp(t, tDon - 0.2, tDon + 0.8) * (ridge ? 1 : 0) + 0.4 * spike(t, tDon + 1.6, 0.1, 1), act: ridge ? actionCurve(t, tDon + 1.6, { pre: 0.7, post: 0.9 }) : 0, flex: ridge ? 0.5 : 0 });
        oger.setContact(0.6, t < cuts[1] ? ogerPos.y : RIDGE_AT[1] + 0.1);
        sh.follow(t < cuts[1] ? [ogerPos.x, ogerPos.y, ogerPos.z] : RIDGE_AT, t < cuts[1] ? 8 : 14);
      }
      masks.forEach((m, i) => {
        const orbitA = ambient * 0.9 + (i / 4) * Math.PI * 2;
        const around = tmp.set(ogerPos.x + Math.cos(orbitA) * 1.1, ogerPos.y + 1.6 + Math.sin(ambient * 2 + i) * 0.1, ogerPos.z + Math.sin(orbitA) * 1.1);
        if (t < cuts[1]) {
          m.visible = t >= cuts[0] + 0.6;
          m.position.copy(around);
        } else if (t < cuts[2]) {
          m.visible = true;
          if (i === 0) {
            // The one the ogre keeps: it goes onto its face.
            const on = ramp(t, tDon - 0.4, tDon + 0.4);
            const o = oger?.group.position ?? tmp;
            m.position.set(o.x + 1.2 * (1 - on), o.y + 1.5 + 0.2 * (1 - on), o.z + 0.4 + 0.6 * on);
            m.scale.setScalar(1 - on * 0.4);
          } else {
            const th = THIEF[i - 1];
            const grab = ramp(t, tStole + 0.4 + i * 0.4, tStole + 1.8 + i * 0.4);
            m.position.set(RIDGE_AT[0] - 2 + (th[0] - RIDGE_AT[0] + 2) * grab, RIDGE_AT[1] + 2.2 + (th[1] + 2.4 - RIDGE_AT[1] - 2.2) * grab, RIDGE_AT[2] + 6 + (th[2] - RIDGE_AT[2] - 6) * grab);
            m.visible = t < tDon + 3.2 + i * 0.25;
          }
        } else m.visible = false;
        m.quaternion.copy(cam.quaternion);
      });
      clash.u.uK.value = ramp(t, tDon + 1.6, tDon + 3);
      clash.u.uTime.value = ambient;
      clash.mesh.visible = ridge && t > tDon + 1.6 && t < tDon + 3.1;
      clash.mesh.quaternion.copy(cam.quaternion);
      leaves.u.uTime.value = Math.max(0, t - (tDon + 1.6));
      leaves.u.uPixel.value = px;
      leaves.u.uOpacity.value = ridge && t > tDon + 1.6 ? 1 : 0;
      // The heretic: alone on the hill, the village lights below.
      maker.visible = t >= cuts[3];
      const lonely = ramp(t, cuts[3], end);
      L.key.intensity = 0.9 - lonely * 0.3;
      L.hemi.intensity = 0.45;
      lampLight.position.set(...(t >= cuts[3] ? ([HUT_AT[0] + 1.4, HUT_AT[1] + 2.2, HUT_AT[2] + 1] as Vec3) : ridge ? ([RIDGE_AT[0] - 2, RIDGE_AT[1] + 3, RIDGE_AT[2] + 5] as Vec3) : ([0, 3, -2] as Vec3)));
      lampLight.color.copy(ridge ? col("#7affd0") : col("#ffa850"));
      lampLight.intensity = ridge ? 3 + 8 * spike(t, tDon + 1.6, 0.1, 1) + 4 * ramp(t, tDon - 0.2, tDon + 0.8) : 4;
      fog.density = t >= cuts[3] ? 0.012 + lonely * 0.006 : 0.012;
    },
    look(t) {
      const L0: Look = lookAt(
        t,
        { bloom: 0.85, bloomRadius: 0.62 },
        {
          exposure: [[0, 1.0], [end, 0.95]],
          fade: cuts.flatMap((c) => [[c - 0.45, 0], [c - 0.08, 1], [c + 0.12, 1], [c + 0.7, 0]] as [number, number][]),
          gain: [[0, [0.95, 0.98, 1.1]], [tMasks, [1.02, 0.98, 1.0]], [tStole, [0.92, 1.0, 1.08]], [tThought, [1.0, 0.97, 1.02]], [tHer, [0.92, 0.96, 1.08]], [end, [0.9, 0.95, 1.1]]],
          saturation: [[0, 1.12], [tStole, 1.22], [tThought, 1.05], [tHer, 0.9], [end, 0.8]],
          contrast: [[0, 1.12], [tStole, 1.18], [tHer, 1.08]],
          chroma: [[tDon + 1.55, 0], [tDon + 1.7, 0.2], [tDon + 2.6, 0]],
          vignette: [[0, 0.45], [tStole, 0.5], [tHer, 0.55], [end, 0.6]],
          bloom: [[0, 0.85], [tDon, 1.05], [tDon + 3, 0.85]],
        }
      );
      L0.flash = 0.12 * spike(t, tDon + 1.6, 0.05, 0.5);
      // Moonlit mist only in the hollows below the ridge, a cool blue that keeps the night dark.
      const fog: Look["fog"] = { color: [0.02, 0.035, 0.07], density: 0.004, height: RIDGE_AT[1] - 3, falloff: 0.35, sun: { dir: [-0.3, 0.3, -0.9], color: [0.05, 0.08, 0.16] }, sky: 0.1 };
      return cine(L0, { fog, dof: { focus: t >= cuts[1] && t < cuts[2] ? [RIDGE_AT[0] - 2, RIDGE_AT[1] + 1, RIDGE_AT[2] + 3] : [7.6, 1, 0], k: 0.4 }, streak: 0.15 + 0.3 * spike(t, tDon + 1.6, 0.05, 1.2), streakColor: [0.5, 1.0, 0.85], black: 0.05, split: { shadows: [-0.015, 0.0, 0.035], highlights: [0.035, 0.015, -0.02] } });
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};
