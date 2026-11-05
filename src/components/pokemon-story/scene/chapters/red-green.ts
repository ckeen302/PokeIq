import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeCloudLayer, makeGlow, makeSky, makeTerrain, merge, noise2, placed, ramp, rng, stoneMaterial } from "@/components/world-history/scene/kit";
import { makeCanvasPanel } from "@/components/world-history/scene/props";
import { lights, loadFigures, lookAt, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { drawCritter, makeBall, makeDevice, makeGrass, makeThreads } from "../story-kit";
import { bag, heroFigure, STOCK } from "./base";

/**
 * V. Red and Green. A Game Boy's screen fills the frame with a pixel title;
 * the camera pushes through it and the pixels become blocks, then a soft 3D
 * village in early morning. For a moment the sky flickers back to four
 * shades of green. Three balls on a lab table pop open in turn (slow
 * motion) and the three starters appear, rimmed green, orange and blue.
 * Mew zips over; lights pass from house to house on glowing threads; the
 * camera rises over the village at dusk as windows light up. A blue
 * cartridge glides in and a single card spins off it.
 */

/** A gable-roofed house facing the village green: walls, a pitched roof, a chimney, a door and lit windows. */
function gableHouse(o: { w: number; h: number; d: number }) {
  const { w, h, d } = o;
  const walls = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const tri = new THREE.Shape([new THREE.Vector2(-d * 0.6, 0), new THREE.Vector2(d * 0.6, 0), new THREE.Vector2(0, d * 0.46)]);
  const roof = new THREE.ExtrudeGeometry(tri, { depth: w * 1.08, bevelEnabled: false }).translate(0, 0, -w * 0.54).rotateY(Math.PI / 2).translate(0, h, 0);
  const gable = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, d * 0.38)]));
  const g1 = gable.clone().rotateY(Math.PI / 2).translate(w / 2 + 0.001, h, 0), g2 = gable.clone().rotateY(-Math.PI / 2).translate(-w / 2 - 0.001, h, 0);
  gable.dispose();
  const chimney = new THREE.BoxGeometry(0.35, 1.1, 0.35).translate(w * 0.28, h + d * 0.3, -d * 0.12);
  const door = new THREE.PlaneGeometry(0.55, 1.0).translate(0, 0.5, d / 2 + 0.01);
  const wins = [-w * 0.3, w * 0.3].map((x) => new THREE.PlaneGeometry(0.5, 0.5).translate(x, h * 0.6, d / 2 + 0.01));
  return { body: merge([walls, g1, g2, chimney]), roof, door, wins: merge(wins) };
}

/** The village (shared with Chapter X's return to Kanto). The side toward +z is left open: the camera walks in from there. */
export function makeVillage(scene: THREE.Object3D, seed = 2) {
  const r = rng(seed);
  const spots: { pos: Vec3; rot: number; size: Vec3 }[] = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    // Around the green, on the arc away from the open side.
    const a = Math.PI / 2 + 0.75 + (i / (N - 1)) * (Math.PI * 2 - 1.5) + (r() - 0.5) * 0.12;
    const d = 10 + r() * 5 + (i % 2) * 3;
    const x = Math.cos(a) * d, z = Math.sin(a) * d - 4;
    spots.push({ pos: [x, 0, z], rot: Math.atan2(-x, -(z + 4)), size: [2.8 + r() * 1.2, 2.0 + r() * 0.6, 2.4 + r() * 0.6] });
  }
  const ROOFS = ["#b8443a", "#3a6a9a", "#4a7f4a", "#b8783a", "#7a5a9a"];
  const wallMat = stoneMaterial({ color: "#efe2cc", roughness: 0.9, dirt: 0.25 });
  const doorMat = new THREE.MeshStandardMaterial({ color: col("#5a3a22"), roughness: 0.8 });
  const roofMats = ROOFS.map((c) => new THREE.MeshStandardMaterial({ color: col(c), roughness: 0.7 }));
  const geos: THREE.BufferGeometry[] = [];
  const houses = spots.map((sp, i) => {
    const G = gableHouse({ w: sp.size[0], h: sp.size[1], d: sp.size[2] });
    geos.push(G.body, G.roof, G.door, G.wins);
    const winMat = new THREE.MeshBasicMaterial({ color: col("#ffd890", 0.25) });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(G.body, wallMat), new THREE.Mesh(G.roof, roofMats[i % ROOFS.length]), new THREE.Mesh(G.door, doorMat), new THREE.Mesh(G.wins, winMat));
    group.position.set(...sp.pos);
    group.rotation.y = sp.rot;
    scene.add(group);
    return { group, winMat };
  });
  // Grounding: a soft shadow under every house, and a low hedge along its front.
  const shadowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!; const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, "rgba(0,0,0,0.7)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: col("#1a2a10") });
  const shadowGeo = merge(spots.map((sp) => placed(new THREE.PlaneGeometry(sp.size[0] * 1.9, sp.size[2] * 1.9).rotateX(-Math.PI / 2), [sp.pos[0], 0.03, sp.pos[2]], sp.rot)));
  const hedgeMat = new THREE.MeshStandardMaterial({ color: col("#3a6a2a"), roughness: 0.95 });
  const hedgeGeo = merge(spots.flatMap((sp) => { const c = Math.cos(sp.rot), sn = Math.sin(sp.rot); const f = sp.size[2] / 2 + 1.0; return [-1, 1].map((side) => { const lx = side * (sp.size[0] * 0.42 + 0.2); return placed(new THREE.BoxGeometry(sp.size[0] * 0.5, 0.55, 0.45), [sp.pos[0] + lx * c + f * sn, 0.27, sp.pos[2] - lx * sn + f * c], sp.rot); }); }));
  const extras = new THREE.Group();
  extras.add(new THREE.Mesh(shadowGeo, shadowMat), new THREE.Mesh(hedgeGeo, hedgeMat));
  scene.add(extras);
  const grass = makeGrass({ count: 16000, center: [0, 0, -2], size: [44, 40], height: [0.1, 0.28], base: "#3a6a2a", tip: "#b4d86a", seed: 9, clear: { x: 0, z: -4, r: 6.2 } });
  grass.u.uWind.value = 0.4;
  grass.u.uSunDir.value.set(-0.9, 0.28, 0.35).normalize();
  extras.add(grass.mesh);
  const nz = noise2(seed);
  const terrain = makeTerrain({ size: [220, 220], segments: 90, height: (x, z) => { const d = Math.hypot(x, z + 4); return d < 24 ? 0 : (d - 24) * 0.12 + nz.fbm(x * 0.03, z * 0.03, 3) * 5; }, color: (h) => [0.26 + h * 0.008, 0.46 + h * 0.006, 0.2] });
  scene.add(terrain.mesh);
  const path = new THREE.Mesh(new THREE.RingGeometry(4, 5.6, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#d6c08e"), roughness: 0.95 }));
  path.position.set(0, 0.02, -4);
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 30).rotateX(-Math.PI / 2), path.material);
  lane.position.set(0, 0.015, 16);
  scene.add(path, lane);
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(1.1, 3.4, 8), new THREE.MeshStandardMaterial({ color: col("#2f6a32"), roughness: 0.9 }), 70);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 1, 6), new THREE.MeshStandardMaterial({ color: col("#5a3a22"), roughness: 0.9 }), 70);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, dd = 22 + r() * 22;
    const x = Math.cos(a) * dd, z = Math.sin(a) * dd - 4;
    const open = Math.abs(x) < 6 && z > 0;
    const s = open ? 0.0001 : 0.8 + r() * 0.6;
    m.makeScale(s, s, s).setPosition(x, 2.2 * s, z);
    trees.setMatrixAt(i, m);
    m.makeScale(s, s, s).setPosition(x, 0.5 * s, z);
    trunks.setMatrixAt(i, m);
  }
  scene.add(trees, trunks);
  return {
    houses, spots, extras, grass,
    windows(k: number[]) { houses.forEach((h, i) => h.winMat.color.copy(col("#ffd890", 0.25 + 3.0 * (k[i] ?? 0)))); },
    dispose() {
      geos.forEach((g) => g.dispose());
      shadowGeo.dispose(); shadowMat.dispose(); shadowTex.dispose(); hedgeGeo.dispose(); hedgeMat.dispose(); grass.dispose();
      houses.forEach((h) => h.winMat.dispose());
      [wallMat, doorMat, ...roofMats].forEach((x) => x.dispose());
      terrain.dispose(); path.geometry.dispose(); lane.geometry.dispose(); (path.material as THREE.Material).dispose();
      [trees, trunks].forEach((t) => { t.geometry.dispose(); (t.material as THREE.Material).dispose(); t.dispose(); });
    },
  };
}

/** A pixel title screen (shared with Chapter VIII's callback): the film's own, two words and a little creature. */
export function drawTitleScreen(font: string) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.fillStyle = "#9bbc0f"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#0f380f";
    g.font = `700 ${Math.round(h * 0.13)}px ${font}`;
    g.textAlign = "center";
    g.fillText("POCKET", w / 2, h * 0.24);
    g.fillText("MONSTERS", w / 2, h * 0.38);
    drawCritter(g, w / 2 - h * 0.17, h * 0.47, h * 0.34, 41, "#306230");
    g.font = `600 ${Math.round(h * 0.07)}px ${font}`;
    g.fillText("RED · GREEN", w / 2, h * 0.92);
  };
}

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tLaunch = B("launch"), tOld = B("old"), tThree = B("three"), tMew = B("mew-rumour"), tWord = B("word"), tBlue = B("blue");

  const sky = D.add(makeSky({ top: "#3f86e0", horizon: "#e4ecf6", bottom: "#4a6a3a", sunDir: [-0.9, 0.28, 0.35], sunColor: "#fff0d0", sunSize: 900, sunGlow: 0.3 }));
  scene.add(sky.mesh);
  scene.fog = new THREE.FogExp2(col("#cfdcea"), 0.0045);
  const clouds = D.add(makeCloudLayer({ size: 700, y: 70, color: "#ffffff", shadow: "#c8b8c8", density: 0.34, scale: 0.008, speed: [1, 0, 0.3], intensity: 1.05 }));
  scene.add(clouds.mesh);
  const L = lights(scene, { sky: "#cfe4ff", ground: "#5a7a3a", fill: 0.7, key: "#fff0d8", keyK: 1.6, keyPos: [-12, 10, 6], rim: "#ffd0a0", rimK: 0.8 });
  const V = D.add(makeVillage(scene));

  // The Game Boy whose screen we push through.
  const gb = D.add(makeDevice("gb", { draw: drawTitleScreen(ctx.font), px: [320, 288] }));
  gb.group.scale.setScalar(6);
  gb.group.position.set(0, 2.2 - 6 * 1.48 * 0.2, 26);
  scene.add(gb.group);
  // Pixels that turn into blocks as we pass through.
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshStandardMaterial({ color: col("#6a9a2a"), emissive: col("#9bbc0f"), emissiveIntensity: 0.6, roughness: 0.6 }), 400);
  scene.add(blocks);
  D.add({ dispose: () => { blocks.geometry.dispose(); (blocks.material as THREE.Material).dispose(); blocks.dispose(); } });
  const br = rng(7);
  const bseed = Array.from({ length: 400 }, () => [br(), br(), br()]);
  const m4 = new THREE.Matrix4();

  // The lab table and three balls.
  const tableMat = new THREE.MeshStandardMaterial({ color: col("#7a5236"), roughness: 0.5 });
  const table = new THREE.Mesh(merge([placed(new THREE.BoxGeometry(4.2, 0.1, 1.6), [0, 0.95, 2]), ...[[-1.95, -0.65], [1.95, -0.65], [-1.95, 0.65], [1.95, 0.65]].map(([x, z]) => placed(new THREE.BoxGeometry(0.1, 0.9, 0.1), [x, 0.45, 2 + z]))]), tableMat);
  const clothMat = new THREE.MeshStandardMaterial({ color: col("#f4f0e6"), roughness: 0.85 });
  const cloth = new THREE.Mesh(merge([placed(new THREE.BoxGeometry(3.9, 0.012, 1.3), [0, 1.006, 2]), placed(new THREE.BoxGeometry(3.9, 0.32, 0.012), [0, 0.85, 2.655])]), clothMat);
  scene.add(table, cloth);
  D.add({ dispose: () => { table.geometry.dispose(); tableMat.dispose(); cloth.geometry.dispose(); clothMat.dispose(); } });
  // A halo of each starter's colour behind it as it forms.
  const halos = ["#5aff8a", "#ff9a3a", "#5ab8ff"].map((c, i) => { const g = D.add(makeGlow({ pos: [(i - 1) * 1.2, 1.5, 1.7], size: 2.2, color: c, intensity: 0 })); scene.add(g.sprite); return g; });
  const balls = [-1.2, 0, 1.2].map((x) => { const b = D.add(makeBall({ radius: 0.17 })); b.group.position.set(x, 1.18, 2); b.group.rotation.y = 0; scene.add(b.group); return b; });
  const figs = await loadFigures(ctx, [1, 4, 7, 151]);
  const RIM = ["#5aff8a", "#ff9a3a", "#5ab8ff"];
  const starters = [1, 4, 7].map((a, i) => heroFigure(figs.get(a), { pos: [(i - 1) * 1.2, 1.02, 2.1], height: 0.9, accent: RIM[i], scene }));
  starters.forEach((s) => s && D.add(s));
  const mew = heroFigure(figs.get(151), { pos: [0, 9, -2], height: 2.8, accent: "#ff9ad0", scene });
  if (mew) D.add(mew);
  const mewTrail = D.add(makeGlow({ pos: [0, 9, -2], size: 4, color: "#ff9ad0", intensity: 0 }));
  scene.add(mewTrail.sprite);

  // Word of mouth: threads of light from house to house.
  const tr = rng(5);
  const pairs: [Vec3, Vec3][] = [];
  for (let i = 0; i < V.spots.length; i++) for (let k = 0; k < 2; k++) {
    const j = Math.floor(tr() * V.spots.length);
    if (j === i) continue;
    const a = V.spots[i].pos, b = V.spots[j].pos;
    pairs.push([[a[0], 3.4, a[2]], [b[0], 3.4, b[2]]]);
  }
  const threads = D.add(makeThreads({ pairs, lift: 3, color: "#ffd890", per: 50, size: 0.12 }));
  scene.add(threads.points);

  // The blue cartridge, and the card that spins off it.
  // A plain cartridge: a body with a notched top corner, grip ridges and a blank label with a little creature.
  const cartShape = new THREE.Shape([[-0.285, -0.325], [0.285, -0.325], [0.285, 0.24], [0.2, 0.325], [-0.285, 0.325]].map(([x, y]) => new THREE.Vector2(x, y)));
  const cartGeo = merge([new THREE.ExtrudeGeometry(cartShape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }).translate(0, 0, -0.04), ...[0, 1, 2, 3].map((i) => placed(new THREE.BoxGeometry(0.4, 0.012, 0.012), [0, -0.2 - i * 0.03, 0.055]))]);
  const cart = new THREE.Mesh(cartGeo, new THREE.MeshStandardMaterial({ color: col("#2a5ad8"), roughness: 0.3, metalness: 0.05, emissive: col("#1a3a9a"), emissiveIntensity: 0.5 }));
  const label = makeCanvasPanel({ w: 0.42, h: 0.34, px: [168, 136], emissive: 0.9, draw(g, w, h) { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#6aa8ff"); gr.addColorStop(1, "#1a4ab8"); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = "#ffffff"; g.fillRect(8, 8, w - 16, 4); drawCritter(g, w / 2 - 34, 30, 68, 91, "#eaf2ff"); } });
  label.mesh.position.set(0, 0.07, 0.066);
  cart.add(label.mesh);
  D.add(label);
  scene.add(cart);
  const cardTex = makeCanvasPanel({ w: 0.42, h: 0.58, px: [128, 176], emissive: 1.0, draw(g, w, h) { g.fillStyle = "#f2c94c"; g.fillRect(0, 0, w, h); g.fillStyle = "#e85a3a"; g.fillRect(7, 7, w - 14, h - 14); g.fillStyle = "#fff8e0"; g.fillRect(14, 24, w - 28, 64); drawCritter(g, 36, 28, 56, 77, "#3a2a8a"); } });
  D.add(cardTex);
  scene.add(cardTex.mesh);
  D.add({ dispose: () => { cartGeo.dispose(); (cart.material as THREE.Material).dispose(); } });

  const R = 6.2;
  const arc = (k: number): Key => { const a = -0.8 + k * 1.6; return { t: tThree + 0.4 + k * 4.6, pos: [Math.sin(a) * 4.6, 1.75, 2 + Math.cos(a) * 4.6], look: [0, 1.35, 2], fov: 38 }; };
  const keys: Key[] = [
    { t: 0, pos: [0, 2.2, 26 + R * 1.6], look: [0, 2.2, 26], fov: 40 },
    { t: tLaunch + 0.6, pos: [0, 2.2, 26 + R * 0.9], look: [0, 2.2, 26], fov: 40 },
    { t: tLaunch + 2.4, pos: [0, 2.2, 24], look: [0, 2.0, 10], fov: 46 },
    { t: tOld + 1, pos: [0, 2.6, 16], look: [0, 1.6, 2], fov: 46 },
    { t: tThree, pos: [0, 2.2, 7], look: [0, 1.25, 2], fov: 42 },
    arc(0), arc(0.5), arc(1),
    { t: tMew + 0.6, pos: [0, 6, 18], look: [0, 6, -2], fov: 50 },
    { t: tWord + 0.5, pos: [0, 14, 30], look: [0, 1, -4], fov: 50 },
    { t: tBlue, pos: [0, 17, 31], look: [0, 1.5, -4], fov: 50 },
    { t: tBlue + 1.8, pos: [0.2, 5.2, 11.5], look: [0, 3.3, 4], fov: 42 },
    { t: end, pos: [0.4, 3.7, 7.6], look: [0, 3.3, 4], fov: 38 },
  ];
  const dayTop = col("#3f86e0"), duskTop = col("#2a2e6a"), dayHor = col("#e4ecf6"), duskHor = col("#ff8a5a");

  return {
    scene,
    portalScale: 1.6,
    camera: (t) => poseOnPath(keys, t),
    orbit: (t) => ({ target: poseOnPath(keys, t).look, limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.05, maxPitch: 1.2, minDist: 1.5, maxDist: 60 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      sky.follow(cam);
      const dusk = ramp(t, tWord - 1, tWord + 3);
      sky.u.uTop.value.copy(dayTop.clone().lerp(duskTop, dusk));
      sky.u.uHorizon.value.copy(dayHor.clone().lerp(duskHor, dusk));
      L.key.intensity = 1.6 * (1 - dusk * 0.7);
      clouds.u.uTime.value = ambient;
      clouds.u.uColor.value.copy(col("#ffffff").lerp(col("#ffb08a"), dusk));
      clouds.u.uShadow.value.copy(col("#c8b8c8").lerp(col("#4a3a6a"), dusk));
      V.grass.u.uTime.value = ambient;
      V.grass.u.uLight.value = 1 - dusk * 0.6;
      L.hemi.intensity = 0.7 * (1 - dusk * 0.5);
      (scene.fog as THREE.FogExp2).color.copy(col("#cfdcea").lerp(col("#5a4a6a"), dusk));
      // Through the screen: the Game Boy falls behind; its pixels become blocks that settle as the village.
      const through = ramp(t, tLaunch + 1.2, tLaunch + 2.6);
      gb.group.visible = through < 0.98;
      gb.screen.redraw(ambient);
      for (let i = 0; i < 400; i++) {
        const [a, b, c] = bseed[i];
        const k = Math.max(0, Math.min(1, (through - 0.2) * 1.5 - c * 0.3));
        const sx = (a - 0.5) * 2.6, sy = (b - 0.5) * 2.4 + 2.2;
        const tx = (a - 0.5) * 30, tz = (c - 0.5) * 24 - 4;
        const x = sx + (tx - sx) * k, y = sy + (0.2 - sy) * k + Math.sin(k * Math.PI) * 3, z = 25 + (tz - 25) * k;
        const s = through > 0 && k < 1 ? 1 - k * k : 0.0001;
        m4.makeScale(s, s, s).setPosition(x, y, z);
        blocks.setMatrixAt(i, m4);
      }
      blocks.instanceMatrix.needsUpdate = true;
      blocks.visible = through > 0 && through < 1;
      // The starters: each ball pops in turn and its Pokémon forms out of light.
      starters.forEach((s, i) => {
        const at = tThree + 0.9 + i * 1.2;
        const k = ramp(t, at, at + 0.5);
        balls[i].open(k, RIM[i]);
        balls[i].group.visible = t < tMew + 1;
        const form = ramp(t, at + 0.2, at + 1.4) * (1 - ramp(t, tMew + 0.5, tMew + 1.5));
        s?.set(form, ambient, viewH, cam, 0.03, 0.05);
        halos[i].set(RIM[i], (0.5 * form + 0.9 * Math.max(0, 1 - Math.abs(t - at - 0.4) * 1.6)) * (1 - ramp(t, tMew, tMew + 1)));
      });
      // Mew zips across the top of the frame.
      const mz = ramp(t, tMew + 0.2, tMew + 2.6);
      const mp: Vec3 = [-12 + mz * 24, 6.2 + Math.sin(mz * 9) * 0.7, 3 + Math.sin(mz * 4) * 1.5];
      if (mew) { mew.move(mp, Math.PI / 2 * (mz < 1 ? 1 : 0)); mew.set(mz > 0 && mz < 1 ? 1 : 0, ambient, viewH, cam, 0.02, 0.4); }
      mewTrail.sprite.position.set(...mp);
      mewTrail.set("#ff9ad0", mz > 0 && mz < 1 ? 1.2 : 0);
      // The word spreads house to house, and windows light up across the village.
      threads.u.uGrow.value = ramp(t, tMew + 2, tWord + 4);
      threads.u.uTime.value = ambient;
      threads.u.uPixel.value = px;
      V.windows(V.spots.map((_, i) => ramp(t, tWord - 0.5 + i * 0.25, tWord + 0.5 + i * 0.25)));
      // Blue: the cartridge glides in; a card spins off it.
      const glide = ramp(t, tBlue + 0.6, tBlue + 1.8);
      cart.visible = glide > 0;
      cart.position.set(-2 + glide * 2, 3.3, 4);
      cart.rotation.y = (1 - glide) * 0.8;
      const spin = ramp(t, tBlue + 2.0, end);
      cardTex.mesh.visible = spin > 0;
      cardTex.mesh.position.set(0.1 + spin * 1.4, 3.3 + spin * 0.5, 4.1 + spin * 1.2);
      cardTex.mesh.rotation.set(spin * 0.4, spin * 7, spin * 0.3);
    },
    look: (t) => {
      const L0 = lookAt(t, { ...STOCK.pop, saturation: 1.15 }, {
        exposure: [[0, 0.95], [tLaunch + 2.5, 0.88], [tWord + 2, 0.9], [end, 0.95]],
        bloom: [[0, 0.9], [tLaunch + 2.6, 0.7], [tThree + 1, 0.95], [tMew, 0.75], [tWord + 2, 1.0]],
        flash: [[tLaunch + 1.8, 0], [tLaunch + 2.1, 0.7], [tLaunch + 2.6, 0]],
      });
      // "Old": for a moment the world flickers back to four shades of green.
      const g = t > tOld + 0.8 && t < tOld + 2.2 && Math.sin((t - tOld) * 22) > -0.6 ? 1 : 0;
      if (g) return { ...L0, saturation: 0, gain: [0.62, 0.78, 0.18], contrast: 1.5, lift: [0.06, 0.12, 0.03] };
      return L0;
    },
    dispose() { D.dispose(); },
  };
};
