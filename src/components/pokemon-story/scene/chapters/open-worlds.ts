import * as THREE from "three";
import type { Key, Vec3 } from "@/lib/world-history/camera";
import { NOISE, col, makeCloudLayer, makeGlow, makeParticles, makeShaft, makeSky, makeTerrain, merge, noise2, placed, ramp, rng } from "@/components/world-history/scene/kit";
import { lights, loadFigures, lookAt, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { bowlPoints, makeCrowd, makeSilhouette, makeStadium, makeStreetLamps, makeTowers, makeWords, type TowerSpec } from "../story-kit";
import { bag, heroFigure, shots, stageAt, STOCK, type Hero } from "./base";
import { makeVillage } from "./red-green";

/**
 * X. Open Worlds, the most varied chapter, each stretch joined by a whoosh
 * and a flash. Chapter V's village again in modern light, Pikachu and Eevee
 * walking side by side. A stadium of cheering lights, Zacian and Zamazenta
 * facing off in a swirl of red energy. Gold confetti and a gold 25 the
 * camera flies through, into misty Hisui at sunrise, a wooden village and
 * Arceus glowing on a far peak. The widest shot of the film: a long, fast
 * glide over open hills beside Koraidon and Miraidon. Back in the stadium,
 * golden confetti hanging in the air and Pikachu in a spotlight (slow
 * motion). A road into the sunset, Pikachu and a trainer walking away, two
 * new figures on the horizon walking toward us. And Lumiose at night.
 */

const AT = { home: 0, stadium: 400, hisui: 800, paldea: 1200, road: 1700, lumiose: 2100 };

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tHome = B("home"), tGalar = B("galar"), t25 = B("twenty-five"), tHisui = B("hisui"), tOpen = B("open"), tChamp = B("champion"), tBye = B("farewell"), tLum = B("lumiose");
  const P = ctx.q.particles;
  const r = rng(10);

  const sky = D.add(makeSky({ top: "#4a8ae8", horizon: "#ffe8c8", bottom: "#4a6a3a", sunDir: [-0.9, 0.3, 0.3], sunColor: "#fff0d0", sunSize: 900, sunGlow: 0.25 }));
  scene.add(sky.mesh);
  scene.fog = new THREE.FogExp2(col("#cfdcea"), 0.004);
  const fog = scene.fog as THREE.FogExp2;
  const L = lights(scene, { sky: "#cfe4ff", ground: "#5a7a3a", fill: 0.7, key: "#fff0d8", keyK: 1.6, keyPos: [-12, 10, 6], rim: "#ffd0a0", rimK: 0.6 });

  // Clouds over Kanto and Paldea.
  const clouds = D.add(makeCloudLayer({ size: 1400, y: 90, color: "#ffffff", shadow: "#b8c4d8", density: 0.36, scale: 0.006, speed: [1, 0, 0.4], intensity: 1.05 }));
  scene.add(clouds.mesh);
  // ---- A. Kanto again: Chapter V's village in modern light.
  const V = D.add(makeVillage(scene, 2, [-12, 10, 6]));

  // ---- B/F. The stadium: crowds, spotlights, and confetti that can hang in the air.
  const S0: Vec3 = [AT.stadium, 0, 0];
  const stadium = D.add(makeStadium({ inner: 12, outer: 30, height: 12, pitch: "#3a7a3a", stand: "#2a2e40" }));
  stadium.group.position.set(...S0);
  scene.add(stadium.group);
  const crowd = D.add(makeCrowd({ points: bowlPoints({ inner: 13, outer: 30, height: 12, count: Math.round(5000 * P) + 600, center: S0 }), colors: ["#ffe8c0", "#ff8a8a"], size: 0.22, intensity: 1.3 }));
  scene.add(crowd.points);
  const beams = [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + 0.6; const s = D.add(makeShaft({ from: [AT.stadium + Math.cos(a) * 26, 22, Math.sin(a) * 22], to: [AT.stadium, 0, 0], r0: 0.4, r1: 3.2, color: "#fff4e0", intensity: 0.6, noise: 0.4 })); scene.add(s.mesh); return s; });
  const spot = new THREE.SpotLight(col("#fff4e0"), 0, 40, 0.32, 0.5, 1.2);
  spot.position.set(AT.stadium, 22, 4);
  spot.target.position.set(AT.stadium, 0, 0);
  scene.add(spot, spot.target);
  const stadLight = new THREE.PointLight(col("#ffe8d0"), 0, 70, 1.2);
  stadLight.position.set(AT.stadium, 18, 0);
  scene.add(stadLight);
  const swirl = D.add(makeParticles({ count: Math.round(900 * P) + 120, shape: "cylinder", center: [AT.stadium, 3, 0], extent: [7, 3, 7], velocity: [0, 0.8, 0], spread: [0.3, 0.5, 0.3], life: 2.6, size: [0.05, 0.14], colors: ["#ffffff", "#ff5a6a", "#d0102a"], intensity: 2.2, turbulence: 0.6, swirl: 1.6 }));
  scene.add(swirl.points);
  // Gold confetti as instanced flakes, positions a pure function of the clock (it can hang still).
  const nConf = Math.round(700 * P) + 120;
  const conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.12), new THREE.MeshStandardMaterial({ color: col("#f2c96b"), metalness: 0.9, roughness: 0.25, emissive: col("#7a5a10"), emissiveIntensity: 0.5, side: THREE.DoubleSide }), nConf);
  const confSeed = Array.from({ length: nConf }, () => [r(), r(), r(), r()]);
  scene.add(conf);
  D.add({ dispose: () => { conf.geometry.dispose(); (conf.material as THREE.Material).dispose(); conf.dispose(); } });
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), s4 = new THREE.Vector3(1, 1, 1);
  const placeConfetti = (center: Vec3, spread: Vec3, clock: number) => {
    for (let i = 0; i < nConf; i++) {
      const [a, b, c, d] = confSeed[i];
      const y = center[1] + spread[1] - ((clock * (0.6 + d * 0.6) + a * spread[1] * 2) % (spread[1] * 2));
      v4.set(center[0] + (b - 0.5) * spread[0] * 2 + Math.sin(clock * 1.3 + a * 9) * 0.3, y, center[2] + (c - 0.5) * spread[2] * 2);
      e4.set(clock * (2 + a * 3) + b * 6, clock * (1 + c * 2) + d * 6, a * 3);
      m4.compose(v4, q4.setFromEuler(e4), s4);
      conf.setMatrixAt(i, m4);
    }
    conf.instanceMatrix.needsUpdate = true;
  };

  // ---- C. The gold 25.
  const ring25 = new THREE.Mesh(new THREE.TorusGeometry(5, 0.35, 16, 96), new THREE.MeshStandardMaterial({ color: col("#f2c96b"), metalness: 1, roughness: 0.2, emissive: col("#a07a20"), emissiveIntensity: 0.8 }));
  ring25.position.set(AT.hisui, 6, 60);
  scene.add(ring25);
  D.add({ dispose: () => { ring25.geometry.dispose(); (ring25.material as THREE.Material).dispose(); } });
  const words25 = D.add(makeWords({ text: "25", font: ctx.font, w: 5.2, color: "#f2c96b", glow: "#a07a20", px: 200, weight: 800 }));
  words25.mat.color.setScalar(1.0);
  words25.mesh.position.set(AT.hisui, 6, 60.2);
  scene.add(words25.mesh);
  const gold = D.add(makeParticles({ count: Math.round(700 * P) + 100, shape: "box", center: [AT.hisui, 7, 64], extent: [9, 6, 6], velocity: [0, -0.8, 0], spread: [0.5, 0.4, 0.5], life: 4, size: [0.04, 0.1], colors: ["#fff0c0", "#f2c96b", "#c08a20"], intensity: 2, turbulence: 0.7, flicker: 0.5 }));
  scene.add(gold.points);

  // ---- D. Hisui at sunrise: mist, a wooden village, Arceus on a far peak.
  const nzH = noise2(6);
  const hisuiLand = D.add(makeTerrain({ size: [300, 300], segments: 110, height: (x, z) => { const d = Math.hypot(x, z); const peak = Math.max(0, 1 - Math.hypot(x - 10, z + 110) / 50) * 55; return (d < 18 ? 0 : (d - 18) * 0.05) + nzH.fbm(x * 0.02, z * 0.02, 4) * 7 + peak; }, color: (h) => (h > 30 ? [0.7, 0.72, 0.78] : [0.24, 0.36, 0.2]) }));
  hisuiLand.mesh.position.set(AT.hisui, 0, 0);
  scene.add(hisuiLand.mesh);
  const hutWood = new THREE.MeshStandardMaterial({ color: col("#9a7450"), roughness: 0.9 });
  const hutRoof = new THREE.MeshStandardMaterial({ color: col("#3a2a1a"), roughness: 0.9 });
  const walls: THREE.BufferGeometry[] = [], roofsG: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3, d = 9 + r() * 5;
    const x = AT.hisui + Math.cos(a) * d, z = Math.sin(a) * d - 4;
    if (z > 4 && Math.abs(x - AT.hisui) < 5) continue;
    const w = 2.6 + r(), h = 1.8 + r() * 0.5;
    walls.push(new THREE.BoxGeometry(w, h, w * 0.8).rotateY(-a).translate(x, h / 2, z));
    roofsG.push(new THREE.ConeGeometry(w * 0.85, 1.6, 4).rotateY(Math.PI / 4 - a).translate(x, h + 0.8, z));
  }
  const huts = new THREE.Group();
  const hw = merge(walls), hr = merge(roofsG);
  huts.add(new THREE.Mesh(hw, hutWood), new THREE.Mesh(hr, hutRoof));
  scene.add(huts);
  walls.forEach((g) => g.dispose()); roofsG.forEach((g) => g.dispose());
  D.add({ dispose: () => { hw.dispose(); hr.dispose(); hutWood.dispose(); hutRoof.dispose(); } });
  const mist = D.add(makeParticles({ count: Math.round(500 * P) + 80, shape: "box", center: [AT.hisui, 2, -10], extent: [40, 1.5, 30], velocity: [0.3, 0, 0], spread: [0.2, 0.05, 0.2], life: 9, size: [1.2, 3], colors: ["#ffffff", "#ffe8d8", "#d8e0f0"], intensity: 0.12, turbulence: 0.2, additive: true }));
  scene.add(mist.points);
  const halo = D.add(makeGlow({ pos: [AT.hisui + 10, 62, -110], size: 30, color: "#fff4c0", intensity: 0 }));
  scene.add(halo.sprite);

  // ---- E. Paldea: open hills, as wide as the film gets.
  const nzP = noise2(12);
  const paldea = D.add(makeTerrain({ size: [900, 900], segments: 200, height: (x, z) => nzP.fbm(x * 0.006, z * 0.006, 5) * 46 + Math.sin(x * 0.01) * 6, color: (h, slope, x, z) => {
    const k = Math.max(0, Math.min(1, (h + 10) / 50));
    const n = nzP.fbm(x * 0.05 + 40, z * 0.05, 2);
    if (slope > 0.32 || h > 30) return [0.5 + n * 0.1, 0.46 + n * 0.08, 0.38];
    return [0.42 - k * 0.18 + n * 0.1, 0.58 - k * 0.14 + n * 0.08, 0.2 - k * 0.06 + n * 0.02];
  } }));
  paldea.mesh.position.set(AT.paldea, -10, -200);
  scene.add(paldea.mesh);
  // Meadow texture close up: world-space noise breaks the vertex colours into patches of lighter and darker grass.
  {
    const m = paldea.mesh.material as THREE.MeshStandardMaterial;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, rr) => {
      prev.call(m, sh, rr);
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>\n{ float pn = whFbm3(vTerrW * 0.08); float pm = whNoise(vTerrW * 0.9); diffuseColor.rgb *= (0.78 + 0.4 * pn) * (0.93 + 0.14 * pm); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.6, 0.3), smoothstep(0.62, 0.8, whNoise(vTerrW * 0.21)) * 0.35); }`);
      if (!sh.fragmentShader.includes("whFbm3(")) sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\n${NOISE}`);
    };
    m.customProgramCacheKey = () => "story-paldea-meadow";
  }
  const groundAt = (x: number, z: number) => nzP.fbm((x - AT.paldea) * 0.006, (z + 200) * 0.006, 5) * 46 + Math.sin((x - AT.paldea) * 0.01) * 6 - 10;
  // Rocks and stands of trees along the glide, for scale and parallax.
  const rp = rng(44);
  const rockG: THREE.BufferGeometry[] = [], trunkG: THREE.BufferGeometry[] = [], crownG: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 260; i++) {
    const x = AT.paldea + (rp() - 0.5) * 130, z = 20 - rp() * 300;
    if (Math.abs(x - AT.paldea) < 22) continue;
    const s0 = 0.4 + rp() * rp() * 2.6;
    rockG.push(placed(new THREE.DodecahedronGeometry(1, 0), [x, groundAt(x, z) + s0 * 0.25, z], rp() * 6, [s0 * (1 + rp()), s0 * 0.6, s0], rp() * 0.5));
  }
  for (let c = 0; c < 46; c++) {
    const cx = AT.paldea + (rp() < 0.5 ? -1 : 1) * (18 + rp() * 90), cz = 10 - rp() * 320;
    for (let k = 0; k < 4 + Math.floor(rp() * 7); k++) {
      const x = cx + (rp() - 0.5) * 14, z = cz + (rp() - 0.5) * 14, s0 = 0.8 + rp() * 0.8, y0 = groundAt(x, z);
      trunkG.push(placed(new THREE.CylinderGeometry(0.25, 0.4, 3, 6), [x, y0 + 1.5 * s0, z], 0, [s0, s0, s0]));
      crownG.push(placed(new THREE.IcosahedronGeometry(2.2, 1), [x, y0 + (3.6 + rp()) * s0, z], rp() * 3, [s0 * 1.1, s0 * (0.9 + rp() * 0.4), s0 * 1.1]));
    }
  }
  const rockMat = new THREE.MeshStandardMaterial({ color: col("#9a9488"), roughness: 0.95, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: col("#4a3424"), roughness: 0.9 });
  const crownMat = new THREE.MeshStandardMaterial({ color: col("#3e6a2a"), roughness: 0.85, flatShading: true });
  const rocks = new THREE.Mesh(merge(rockG), rockMat), ptrunks = new THREE.Mesh(merge(trunkG), trunkMat), pcrowns = new THREE.Mesh(merge(crownG), crownMat);
  const paldeaProps = new THREE.Group();
  paldeaProps.add(rocks, ptrunks, pcrowns);
  scene.add(paldeaProps);
  D.add({ dispose: () => { rocks.geometry.dispose(); ptrunks.geometry.dispose(); pcrowns.geometry.dispose(); rockMat.dispose(); trunkMat.dispose(); crownMat.dispose(); } });

  // ---- G. A road into the sunset.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(4, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#8a7a6a"), roughness: 0.9 }));
  road.position.set(AT.road, 0.02, -180);
  const fields = new THREE.Mesh(new THREE.PlaneGeometry(500, 500).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#5a6a2a"), roughness: 1 }));
  fields.position.set(AT.road, 0, -180);
  scene.add(road, fields);
  D.add({ dispose: () => { road.geometry.dispose(); (road.material as THREE.Material).dispose(); fields.geometry.dispose(); (fields.material as THREE.Material).dispose(); } });
  const trainer = D.add(makeSilhouette({ height: 1.6, pose: "walk", child: true, rim: "#ffb070" }));
  scene.add(trainer.mesh);
  const newcomers = [0, 1].map(() => { const s = D.add(makeSilhouette({ height: 1.5, pose: "walk", child: true, rim: "#ffd0a0" })); scene.add(s.mesh); return s; });
  const sunset = D.add(makeGlow({ pos: [AT.road, 6, -330], size: 120, color: "#ff8a3a", intensity: 0 }));
  scene.add(sunset.sprite);

  // ---- H. Lumiose at night: stone blocks with mansard-high cornices along avenues that radiate from a tall lit tower, sodium lamps down every avenue and round every ring.
  const LUM = AT.lumiose, AVE = 8, RINGS = [13, 29, 45, 61];
  const lspecs: TowerSpec[] = [];
  const rl = rng(31);
  for (let band = 0; band < 3; band++) {
    const r0 = RINGS[band] + 3, r1 = RINGS[band + 1] - 3;
    for (let rr = r0 + 2.5; rr < r1; rr += 6.5) {
      for (let a = 0; a < Math.PI * 2; a += 5.6 / rr) {
        const sector = (a / (Math.PI * 2)) * AVE;
        const off = Math.abs(sector - Math.round(sector)) * ((Math.PI * 2) / AVE) * rr;
        if (off < 3.2) continue;
        const h = band === 0 ? 7 + rl() * 3 : band === 1 ? 6 + rl() * 4 + (rl() < 0.12 ? 8 : 0) : 6 + rl() * 10 * rl();
        lspecs.push({ x: LUM + Math.cos(a) * rr, z: Math.sin(a) * rr, w: 4.6 + rl() * 1.2, d: 5.2, h, rot: -a + Math.PI / 2, kind: rl() < 0.75 ? 2 : 1 });
      }
    }
  }
  const lumi = D.add(makeTowers({ towers: lspecs, seed: 33, haze: "#3a3040", hazeHigh: "#0e1428", fog: 0.008, street: "#ffa050", moon: [0.4, 0.5, 0.6] }));
  lumi.u.uBody.value = 0.36;
  lumi.u.uSky.value.copy(col("#2a3a5a"));
  scene.add(lumi.mesh);
  const lumLamps: Vec3[] = [];
  for (let k = 0; k < AVE; k++) { const a = (k / AVE) * Math.PI * 2; for (let rr = 6; rr < 64; rr += 3.6) for (const sd of [-1, 1]) lumLamps.push([LUM + Math.cos(a) * rr - Math.sin(a) * 2.2 * sd, 0, Math.sin(a) * rr + Math.cos(a) * 2.2 * sd]); }
  for (const R of RINGS) for (let a = 0; a < Math.PI * 2; a += 3.8 / R) for (const sd of [-1, 1]) lumLamps.push([LUM + Math.cos(a) * (R + 2.0 * sd), 0, Math.sin(a) * (R + 2.0 * sd)]);
  const lumLight = D.add(makeStreetLamps({ points: lumLamps, height: 3.0, color: "#ffb060", size: 0.6, pools: 0.55 }));
  scene.add(lumLight.group);
  const pave = new THREE.Mesh(new THREE.CircleGeometry(90, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#1a1816"), roughness: 0.85 }));
  pave.position.set(LUM, 0.01, 0);
  scene.add(pave);
  D.add({ dispose: () => { pave.geometry.dispose(); (pave.material as THREE.Material).dispose(); } });
  const towerParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; towerParts.push(new THREE.CylinderGeometry(0.25, 0.6, 40, 6).translate(0, 20, 0).rotateZ(0.04).rotateY(a).translate(AT.lumiose + Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6)); }
  for (let y = 4; y < 40; y += 4) towerParts.push(new THREE.TorusGeometry(2.0 - y * 0.03, 0.12, 6, 24).rotateX(Math.PI / 2).translate(AT.lumiose, y, 0));
  const towerGeo = merge(towerParts);
  towerParts.forEach((g) => g.dispose());
  const towerMat = new THREE.MeshStandardMaterial({ color: col("#d8e0f0"), metalness: 0.8, roughness: 0.3, emissive: col("#ffe8a0"), emissiveIntensity: 0.55 });
  const tower = new THREE.Mesh(towerGeo, towerMat);
  scene.add(tower);
  D.add({ dispose: () => { towerGeo.dispose(); towerMat.dispose(); } });
  const towerGlow = D.add(makeGlow({ pos: [AT.lumiose, 40, 0], size: 14, color: "#ffe8a0", intensity: 0 }));
  scene.add(towerGlow.sprite);
  const avenues = D.add(makeParticles({ count: Math.round(1400 * P) + 200, shape: "disc", center: [AT.lumiose, 0.3, 0], extent: [58, 0.1, 58], velocity: [0, 0, 0], spread: [0.05, 0, 0.05], life: 6, size: [0.08, 0.2], colors: ["#ffffff", "#ffd890", "#ff9a5a"], intensity: 1.1, flicker: 0.4 }));
  scene.add(avenues.points);

  // ---- The figures.
  const figs = await loadFigures(ctx, [25, 133, 888, 889, 493, 1007, 1008]);
  const hero = (dex: number, pos: Vec3, h: number, accent: string, rotY = 0) => { const x = heroFigure(figs.get(dex), { pos, height: h, accent, scene, rotY }); if (x) D.add(x); return x; };
  const pika = hero(25, [0, 0, 20], 0.95, "#ffcb05", Math.PI);
  const eevee = hero(133, [1.2, 0, 20], 0.95, "#ffd8a0", Math.PI);
  const zacian = hero(888, [AT.stadium - 7, 0, 0], 5, "#5ab8ff", Math.PI / 2 - 0.2);
  const zamazenta = hero(889, [AT.stadium + 7, 0, 0], 5, "#ff5a6a", -Math.PI / 2 + 0.2);
  const arceus = hero(493, [AT.hisui + 10, 54, -100], 20, "#fff4c0", 0);
  const koraidon = hero(1007, [AT.paldea, 0, 0], 3.2, "#ff5a3a", Math.PI);
  const miraidon = hero(1008, [AT.paldea, 0, 0], 3.2, "#9a6aff", Math.PI);
  const setH = (h: Hero | null, k: number, pos: Vec3 | null, rotY: number | undefined, ambient: number, viewH: number, cam: THREE.PerspectiveCamera, bob = 0.04, glow = 0.06) => {
    if (!h) return;
    if (pos) h.move(pos, rotY);
    h.fig.group.visible = k > 0.001;
    h.set(k, ambient, viewH, cam, bob, glow);
  };

  // ---- The camera: one stretch per stage.
  const glideZ = (t: number) => -(t - tOpen) * 26;
  const glideKeys: Key[] = [0, 0.25, 0.5, 0.75, 1].map((u) => {
    const t = tOpen - 0.2 + u * (tChamp - tOpen);
    const z = glideZ(t), x = AT.paldea + Math.sin(u * 3) * 8;
    // Low, behind and beside the runners, looking past them to the horizon (sky in the top third).
    const cx = x + 0.4, cz = z + 9;
    const ch = Math.max(groundAt(cx, cz), groundAt(cx, cz - 4), groundAt(cx, cz - 9)) + 3.4 + u * 1.2;
    return { t, pos: [cx, ch, cz], look: [x + 0.4, ch - 2.8, z - 34], fov: 50 + u * 4 };
  });
  const camera = shots([
    [0, [
      { t: 0, pos: [3, 2.6, 30], look: [0, 1, 16], fov: 44 },
      { t: tGalar, pos: [2.2, 1.6, 22], look: [0.4, 0.7, 12], fov: 44 },
    ]],
    [tGalar - 0.15, [
      // Already inside the bowl, over the stands (never through the outer wall).
      { t: tGalar - 0.15, pos: [AT.stadium, 17, 26], look: [AT.stadium, 2, 0], fov: 48 },
      { t: tGalar + 3, pos: [AT.stadium + 5, 6.5, 17], look: [AT.stadium, 3, 0], fov: 44 },
      { t: t25, pos: [AT.stadium - 3, 4, 13], look: [AT.stadium, 3, 0], fov: 44 },
    ]],
    [t25 - 0.15, [
      { t: t25 - 0.15, pos: [AT.hisui, 6, 80], look: [AT.hisui, 6, 60], fov: 44 },
      { t: t25 + 3.6, pos: [AT.hisui, 6, 63], look: [AT.hisui, 6, 50], fov: 46 },
      { t: tHisui, pos: [AT.hisui, 6, 52], look: [AT.hisui, 5, 20], fov: 50 },
      { t: tHisui + 3, pos: [AT.hisui + 2, 5, 22], look: [AT.hisui + 6, 30, -100], fov: 46 },
      { t: tOpen, pos: [AT.hisui + 3, 5, 16], look: [AT.hisui + 9, 46, -110], fov: 42 },
    ]],
    [tOpen - 0.2, glideKeys],
    [tChamp - 0.15, [
      { t: tChamp - 0.15, pos: [AT.stadium + 0.6, 2.2, 9], look: [AT.stadium, 1.2, 0], fov: 40 },
      { t: tChamp + 3, pos: [AT.stadium + 0.2, 1.4, 4.2], look: [AT.stadium, 0.8, 0], fov: 38 },
      { t: tBye, pos: [AT.stadium, 1.2, 3.4], look: [AT.stadium, 0.8, 0], fov: 36 },
    ]],
    [tBye - 0.15, [
      { t: tBye - 0.15, pos: [AT.road + 0.6, 1.4, 6], look: [AT.road, 1, -10], fov: 42 },
      { t: tLum, pos: [AT.road + 0.3, 2.4, 9], look: [AT.road, 1.4, -30], fov: 40 },
    ]],
    [tLum - 0.15, [
      { t: tLum - 0.15, pos: [AT.lumiose + 40, 30, 70], look: [AT.lumiose, 14, 0], fov: 46 },
      { t: end, pos: [AT.lumiose + 10, 22, 44], look: [AT.lumiose, 20, 0], fov: 46 },
    ]],
  ]);
  // Paldea's sun: low, ahead and to the right of the glide, so the hills model and the runners are rimmed.
  const PSUN: Vec3 = [0.72, 0.3, -0.62];
  const starts = [0, tGalar - 0.15, t25 - 0.15, tOpen - 0.2, tChamp - 0.15, tBye - 0.15, tLum - 0.15];
  const SK: [string, string, string, number, string, number, number, number][] = [
    // top, horizon, bottom, fog density, fog colour, key, hemi, exposure-ish
    ["#4a8ae8", "#ffe8c8", "#4a6a3a", 0.004, "#cfdcea", 1.6, 0.7, 1],
    ["#060812", "#1a1a3a", "#020204", 0.0, "#000000", 0.25, 0.25, 1],
    ["#3a4a7a", "#ffb08a", "#2a2a3a", 0.0045, "#b8a0a0", 1.5, 0.6, 1],
    ["#2f7ae0", "#d8ecff", "#5a7a3a", 0.0014, "#c8dcf4", 2.5, 0.55, 1],
    ["#030408", "#0a0a18", "#000000", 0.0, "#000000", 0.1, 0.12, 1],
    ["#3a2a5a", "#ff8a3a", "#2a1a10", 0.004, "#ff9a6a", 0.8, 0.5, 1],
    ["#060a1e", "#3a2c48", "#000000", 0.004, "#1a1628", 0.1, 0.2, 1],
  ];

  return {
    scene,
    portalScale: 1.5,
    camera,
    orbit: (t) => ({ target: camera(t).look, limits: { yaw0: 0, yawSpan: 1.0, minPitch: -0.1, maxPitch: 1.2, minDist: 1, maxDist: 80 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const st = stageAt(starts, t);
      sky.follow(cam);
      const [top, hor, bot, fd, fc, kk, hk] = SK[st];
      sky.u.uTop.value.copy(col(top)); sky.u.uHorizon.value.copy(col(hor)); sky.u.uBottom.value.copy(col(bot));
      sky.u.uSunGlow.value = st === 0 ? 0.25 : st === 3 ? 0.22 : 0;
      sky.u.uSunDir.value.set(...(st === 3 ? PSUN : [-0.9, 0.3, 0.3] as Vec3)).normalize();
      fog.density = fd; fog.color.copy(col(fc));
      clouds.mesh.visible = st === 0 || st === 3;
      clouds.mesh.position.set(cam.position.x, 90, cam.position.z);
      clouds.u.uTime.value = ambient;
      L.key.intensity = kk; L.hemi.intensity = hk;
      // A low sun from the side over Paldea, so the hills model; the usual key elsewhere.
      if (st === 3) L.key.position.set(cam.position.x + PSUN[0] * 130, cam.position.y + PSUN[1] * 130, cam.position.z + PSUN[2] * 130); else L.key.position.set(-12, 10, 6);
      L.key.target.position.set(st === 3 ? cam.position.x : 0, st === 3 ? cam.position.y - 10 : 0, st === 3 ? cam.position.z : 0);
      L.key.target.updateMatrixWorld();

      // A. Pikachu and Eevee walk side by side down the lane.
      V.windows(V.spots.map(() => 0.15));
      const walk = (t - tHome) * 0.7;
      const inStadium = st === 1 || st === 4;
      if (st === 0) {
        const z = 18 - walk;
        setH(pika, ramp(t, tHome - 1, tHome + 0.6), [-0.55, Math.abs(Math.sin(ambient * 6)) * 0.05, z], Math.PI, ambient, viewH, cam, 0.0, 0.04);
        setH(eevee, ramp(t, tHome - 0.8, tHome + 0.8), [0.55, Math.abs(Math.sin(ambient * 6 + 1)) * 0.05, z + 0.2], Math.PI, ambient, viewH, cam, 0.0, 0.04);
      } else if (st === 4) {
        setH(pika, 1, [AT.stadium, 0, 0], 0.15, ambient, viewH, cam, 0.0, 0.1);
        setH(eevee, 0, null, undefined, ambient, viewH, cam);
      } else if (st === 5) {
        const away = (t - tBye) * 0.9;
        setH(pika, 1, [AT.road - 0.5, Math.abs(Math.sin(ambient * 6)) * 0.04, -2 - away], 0, ambient, viewH, cam, 0, 0.06);
        setH(eevee, 0, null, undefined, ambient, viewH, cam);
      } else { setH(pika, 0, null, undefined, ambient, viewH, cam); setH(eevee, 0, null, undefined, ambient, viewH, cam); }

      // B. The stadium, Zacian and Zamazenta in red energy.
      stadium.group.visible = crowd.points.visible = inStadium;
      crowd.u.uTime.value = ambient; crowd.u.uPixel.value = px;
      crowd.u.uCheer.value = st === 1 ? 1 : 1 - ramp(t, tChamp + 1, tChamp + 3);
      crowd.u.uK.value = st === 4 ? 1.3 * (1 - 0.6 * ramp(t, tChamp + 1, tChamp + 3)) : 1.3;
      beams.forEach((b) => { b.u.uOpacity.value = st === 1 ? 1 : 0; b.u.uTime.value = ambient; });
      stadLight.intensity = st === 1 ? 90 : st === 4 ? 12 : 0;
      spot.intensity = st === 4 ? 120 : 0;
      const face = st === 1 ? ramp(t, tGalar + 0.4, tGalar + 2) : 0;
      setH(zacian, face, null, undefined, ambient, viewH, cam, 0.05, 0.1);
      setH(zamazenta, face, null, undefined, ambient, viewH, cam, 0.05, 0.1);
      swirl.u.uTime.value = ambient; swirl.u.uPixel.value = px; swirl.u.uOpacity.value = face;
      // Confetti: falling through the 25, hanging still for the champion.
      if (st === 4) {
        const hang = ramp(t, tChamp + 0.6, tChamp + 1.4) * (1 - ramp(t, tChamp + 4.5, tChamp + 5.5));
        placeConfetti([AT.stadium, 4, 0], [6, 4, 4], tChamp + (t - tChamp) * (1 - hang * 0.97));
      }
      conf.visible = st === 4;

      // C. The 25: gold confetti and a ring to fly through.
      const g25 = st === 2 && t < tHisui + 1;
      ring25.visible = words25.mesh.visible = g25;
      ring25.rotation.z = ambient * 0.3;
      words25.mat.opacity = 1 - ramp(t, t25 + 2.6, t25 + 3.4);
      gold.u.uTime.value = ambient; gold.u.uPixel.value = px; gold.u.uOpacity.value = g25 ? 1 - ramp(t, t25 + 3, tHisui) : 0;
      // D. Hisui.
      hisuiLand.mesh.visible = huts.visible = st === 2;
      mist.u.uTime.value = ambient; mist.u.uPixel.value = px; mist.u.uOpacity.value = st === 2 ? ramp(t, tHisui - 1, tHisui + 1) : 0;
      const ark = st === 2 ? ramp(t, tHisui + 1, tHisui + 3) : 0;
      setH(arceus, ark, null, undefined, ambient, viewH, cam, 0.2, 0.3);
      halo.set("#fff4c0", 0.6 * ark);

      // E. The glide: Koraidon and Miraidon run alongside.
      paldea.mesh.visible = paldeaProps.visible = st === 3;
      if (st === 3) {
        const z = glideZ(t);
        const kx = AT.paldea + Math.sin(((t - tOpen) / (tChamp - tOpen)) * 3) * 8;
        const bound = Math.abs(Math.sin(ambient * 5)) * 0.5;
        setH(koraidon, ramp(t, tOpen - 0.2, tOpen + 0.8), [kx - 1.7, groundAt(kx - 1.7, z) + bound, z], Math.PI, ambient, viewH, cam, 0, 0.05);
        setH(miraidon, ramp(t, tOpen, tOpen + 1), [kx + 2.5, groundAt(kx + 2.5, z + 2) + 0.6 + bound * 0.4, z + 2], Math.PI, ambient, viewH, cam, 0, 0.05);
      } else { setH(koraidon, 0, null, undefined, ambient, viewH, cam); setH(miraidon, 0, null, undefined, ambient, viewH, cam); }

      // G. The road into the sunset.
      road.visible = fields.visible = st === 5;
      const away = (t - tBye) * 0.9;
      trainer.mesh.visible = st === 5;
      trainer.mesh.position.set(AT.road + 0.5, 0, -2 - away);
      trainer.mesh.rotation.y = Math.PI;
      trainer.setRim("#ffb070", 2);
      newcomers.forEach((n, i) => { const k = ramp(t, tBye + 2.2, tBye + 3.4); n.mesh.visible = st === 5 && k > 0; n.mesh.position.set(AT.road + (i ? 0.6 : -0.6), 0, -70 + (t - tBye) * 1.4); n.setRim("#ffd0a0", 2.4 * k); });
      sunset.set("#ff8a3a", st === 5 ? 0.6 : 0);

      // H. Lumiose.
      const lum = st === 6;
      lumi.mesh.visible = tower.visible = lumLight.group.visible = pave.visible = lum;
      lumi.u.uTime.value = ambient;
      lumLight.u.uPixel.value = px;
      towerGlow.set("#ffe8a0", lum ? 0.3 + 0.1 * Math.sin(ambient * 2) : 0);
      avenues.u.uTime.value = ambient; avenues.u.uPixel.value = px; avenues.u.uOpacity.value = lum ? 0.25 : 0;
      V.town.visible = st === 0;
      V.extras.visible = st === 0;
      V.grass.u.uTime.value = ambient;
    },
    look: (t) =>
      lookAt(t, { ...STOCK.modern }, {
        exposure: [[0, 1.0], [tGalar, 0.95], [t25, 1.0], [tOpen, 1.0], [tChamp, 0.95], [tBye, 1.0], [tLum, 1.0], [end, 1.0]],
        contrast: [[0, 1.06], [tGalar - 0.2, 1.06], [tGalar, 1.18], [t25 - 0.2, 1.18], [t25, 1.06], [tChamp - 0.2, 1.06], [tChamp, 1.2], [tBye - 0.2, 1.2], [tBye, 1.06], [end, 1.06]],
        bloom: [[0, 0.8], [tGalar, 0.95], [t25, 1.05], [tHisui, 0.95], [tOpen, 0.8], [tChamp, 1.05], [tBye, 1.0], [tLum, 1.1], [end, 1.1]],
        bloomThreshold: [[0, 0.78], [end, 0.78]],
        flash: [tGalar, t25, tOpen, tChamp, tBye, tLum].flatMap((x): [number, number][] => [[x - 0.2, 0], [x - 0.12, 0.35], [x + 0.25, 0]]),
        fade: [[0, 0.5], [1.0, 0]],
        rays: [[tOpen - 0.3, 0], [tOpen - 0.2, 0.1], [tChamp - 0.2, 0.1], [tChamp - 0.15, 0]],
      }, (() => { const c = camera(t).pos; return { pos: [c[0] + PSUN[0] * 600, c[1] + PSUN[1] * 600, c[2] + PSUN[2] * 600] as Vec3, color: [1.0, 0.9, 0.7] as Vec3 }; })()),
    dispose() { D.dispose(); },
  };
};

