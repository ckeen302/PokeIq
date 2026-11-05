import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Key, Vec3 } from "@/lib/world-history/camera";
import { col, makeGlow, makeLightning, makeParticles, makeRing, makeShaft, makeSky, makeStreaks, merge, placed, ramp, rng } from "@/components/world-history/scene/kit";
import { makeCanvasPanel, makeCity } from "@/components/world-history/scene/props";
import { lights, loadFigures, lookAt, pointPixel, spike } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { drawCritter, makeArcs, makeCardBurst, makeGlobe, makeSilhouette, makeWords, spherePoint } from "../story-kit";
import { bag, heroFigure, shots, stageAt, STOCK } from "./base";

/**
 * VI. Pokémania, the fastest chapter: a run of short shots joined by cuts.
 * A booster pack tears and hundreds of holo cards burst round the camera
 * (slow motion). An old CRT flicks on in a dark room, a child sat in front
 * of it, and Pikachu steps out of the screen in yellow sparks; it stands
 * centre frame with little arcs crackling round it. A storefront builds
 * itself from blocks, its sign lights, a queue forms. A cinema: a projector
 * beam through dust and Mewtwo rising in it. A globe of points lights
 * outward from Japan, arcs flying to every continent, Pikachu on top. Then a
 * hard cut: GOTTA CATCH 'EM ALL, stamped in with a ring of light.
 */

/** Where each stage stands (far apart, so a cut is a clean change of place). */
const AT = { cards: 0, tv: 70, store: 140, cinema: 210, globe: 280, title: 360 };

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tCards = B("cards"), tAnime = B("anime"), tFace = B("face"), tCompany = B("company"), tMovie = B("movie"), tWorld = B("world"), tCatch = B("catch");
  const P = ctx.q.particles;

  const sky = D.add(makeSky({ top: "#2a0a3a", horizon: "#ff3d7a", bottom: "#14051e", stars: 0 }));
  scene.add(sky.mesh);
  const L = lights(scene, { sky: "#ffe0f0", ground: "#2a1030", fill: 0.7, key: "#fff0d8", keyK: 1.4, keyPos: [4, 8, 6] });

  // ---- A. The booster pack and the burst of cards.
  const foil = D.add(makeCanvasPanel({
    w: 1.1, h: 1.6, px: [220, 320], emissive: 1.1,
    draw(g, w, h) {
      const grd = g.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, "#ffcb05"); grd.addColorStop(0.45, "#ff5a8a"); grd.addColorStop(1, "#3a7bff");
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(255,255,255,0.18)";
      for (let i = -h; i < w; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 10, 0); g.lineTo(i + 10 + h, h); g.lineTo(i + h, h); g.fill(); }
      g.fillStyle = "#1a1030"; g.fillRect(0, 0, w, 26); g.fillRect(0, h - 26, w, 26);
      drawCritter(g, w / 2 - 50, h * 0.3, 100, 25, "#ffffff");
      g.fillStyle = "#ffffff"; g.font = `700 26px ${ctx.font}`; g.textAlign = "center"; g.fillText("BOOSTER", w / 2, h * 0.78);
    },
  }));
  const pack = new THREE.Group();
  pack.add(foil.mesh);
  const packTop = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.16), new THREE.MeshStandardMaterial({ color: col("#c8c0d0"), metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }));
  packTop.position.y = 0.88;
  pack.add(packTop);
  pack.position.set(AT.cards, 1.5, 0);
  scene.add(pack);
  D.add({ dispose: () => { packTop.geometry.dispose(); (packTop.material as THREE.Material).dispose(); } });
  const cards = D.add(makeCardBurst({ count: Math.round(260 * P) + 60, center: [AT.cards, 1.5, 0], radius: 3.6, size: 0.5, seed: 6 }));
  scene.add(cards.mesh);
  const packGlow = D.add(makeGlow({ pos: [AT.cards, 1.6, -0.6], size: 4.2, color: "#ffd0f0", intensity: 0 }));
  scene.add(packGlow.sprite);
  const speed = D.add(makeStreaks({ count: Math.round(220 * P) + 40, center: [AT.cards, 1.5, -6], extent: [8, 5, 10], velocity: [0, 0, 14], life: 1.2, length: 1.6, width: 0.025, color: "#ffd6f0", intensity: 1.4, seed: 4 }));
  scene.add(speed.mesh);
  const glitter = D.add(makeParticles({ count: Math.round(500 * P) + 80, shape: "sphere", center: [AT.cards, 1.5, 0], extent: [3.5, 3, 3.5], velocity: [0, 0.2, 0], spread: [0.4, 0.4, 0.4], life: 2.2, size: [0.015, 0.04], colors: ["#ffffff", "#ffe27a", "#ff9ad8"], intensity: 2.4, turbulence: 0.5, flicker: 0.6 }));
  scene.add(glitter.points);

  // ---- B. A dark room, an old TV, a child watching.
  const room = new THREE.Group();
  room.position.set(AT.tv, 0, 0);
  scene.add(room);
  const wood = new THREE.MeshStandardMaterial({ color: col("#3a2818"), roughness: 0.6 });
  const wallM = new THREE.MeshStandardMaterial({ color: col("#6a5a70"), roughness: 0.9 });
  const tvM = new THREE.MeshStandardMaterial({ color: col("#4a3a2c"), roughness: 0.45 });
  const blackM = new THREE.MeshStandardMaterial({ color: col("#121214"), roughness: 0.4 });
  const roomGeos = [new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.PlaneGeometry(30, 10), new RoundedBoxGeometry(2.3, 1.75, 1.6, 3, 0.18), new THREE.BoxGeometry(2.8, 0.55, 1.4), new THREE.BoxGeometry(1.75, 1.32, 0.05)];
  const [floorG, wallG, tvG, standG, bezelG] = roomGeos;
  const floor = new THREE.Mesh(floorG, wood);
  const wall = new THREE.Mesh(wallG, wallM);
  wall.position.set(0, 5, -2.5);
  const tv = new THREE.Mesh(tvG, tvM);
  tv.position.set(0, 1.45, -1.2);
  const stand = new THREE.Mesh(standG, wood);
  stand.position.set(0, 0.28, -1.2);
  const bezel = new THREE.Mesh(bezelG, blackM);
  bezel.position.set(-0.15, 1.5, -0.39);
  room.add(floor, wall, tv, stand, bezel);
  D.add({ dispose: () => { roomGeos.forEach((g) => g.dispose()); [wood, wallM, tvM, blackM].forEach((m) => m.dispose()); } });
  let screenState = -1;
  const crt = D.add(makeCanvasPanel({
    w: 1.6, h: 1.2, px: [256, 192], emissive: 0.75,
    draw(g, w, h, s) {
      // s: 0 off, 0..1 warming up (a bright line opening), 1+ on (a sunny field and a yellow spark), + a little roll.
      g.fillStyle = "#050607"; g.fillRect(0, 0, w, h);
      if (s <= 0) return;
      if (s < 1) {
        const open = s * h;
        g.fillStyle = "#cfe8ff"; g.fillRect(0, h / 2 - open / 2, w, Math.max(2, open));
      } else {
        const grd = g.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, "#6ac8ff"); grd.addColorStop(0.62, "#c8f0ff"); grd.addColorStop(0.63, "#5acb4a"); grd.addColorStop(1, "#2f8a2a");
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.fillStyle = "#fff6c0"; g.beginPath(); g.arc(w * 0.78, h * 0.22, 16, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#ffd83a";
        g.beginPath(); g.moveTo(w * 0.5, h * 0.25); g.lineTo(w * 0.42, h * 0.55); g.lineTo(w * 0.5, h * 0.55); g.lineTo(w * 0.45, h * 0.85); g.lineTo(w * 0.6, h * 0.45); g.lineTo(w * 0.52, h * 0.45); g.closePath(); g.fill();
      }
      g.fillStyle = "rgba(0,0,0,0.22)";
      for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    },
  }));
  crt.mesh.position.set(-0.15, 1.5, -0.36);
  room.add(crt.mesh);
  const tvGlow = D.add(makeGlow({ pos: [AT.tv - 0.15, 1.5, 0.2], size: 6, color: "#9ad8ff", intensity: 0 }));
  scene.add(tvGlow.sprite);
  const kid = D.add(makeSilhouette({ height: 1.25, pose: "seated", child: true, rim: "#bfe6ff" }));
  kid.mesh.position.set(AT.tv + 0.7, 0, 2.4);
  kid.mesh.rotation.y = Math.PI;
  scene.add(kid.mesh);
  const tvLight = new THREE.PointLight(col("#9ad8ff"), 0, 9, 1.6);
  tvLight.position.set(AT.tv - 0.15, 1.5, 0.6);
  scene.add(tvLight);
  const sparks = D.add(makeParticles({ count: Math.round(360 * P) + 60, shape: "sphere", center: [AT.tv, 1.2, 1.2], extent: [0.9, 0.9, 0.9], velocity: [0, 0.4, 0], spread: [0.8, 0.8, 0.8], life: 1.1, size: [0.015, 0.04], colors: ["#ffffff", "#fff27a", "#ffc800"], intensity: 3, turbulence: 0.8, flicker: 0.8 }));
  scene.add(sparks.points);
  const arcs = [0, 1, 2].map(() => { const l = D.add(makeLightning({ color: "#fff06a", width: 0.025, intensity: 4, branches: 1 })); scene.add(l.mesh); return l; });
  const halo = D.add(makeGlow({ pos: [AT.tv, 1.4, 1.6], size: 3.4, color: "#ffd83a", intensity: 0 }));
  scene.add(halo.sprite);
  const faceRing = D.add(makeRing({ color: "#ffe27a", intensity: 1.4, thickness: 0.05 }));
  faceRing.mesh.position.set(AT.tv, 0.05, 1.6);
  faceRing.mesh.rotation.x = -Math.PI / 2;
  scene.add(faceRing.mesh);

  // ---- C. The storefront building itself, a sign, a queue.
  const street = new THREE.Mesh(new THREE.PlaneGeometry(80, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#2a2a32"), roughness: 0.6, metalness: 0.2 }));
  street.position.set(AT.store, 0, 0);
  scene.add(street);
  D.add({ dispose: () => { street.geometry.dispose(); (street.material as THREE.Material).dispose(); } });
  const city = D.add(makeCity({ center: [AT.store, 0, -44], radius: 30, count: 40, height: [8, 26], color: "#8a6a48", seed: 7 }));
  scene.add(city.mesh);
  const BW = 10, BH = 5, BRICK = 0.5;
  const nx = Math.round(BW / BRICK), ny = Math.round(BH / BRICK);
  const bricks = new THREE.InstancedMesh(new THREE.BoxGeometry(BRICK * 0.96, BRICK * 0.96, 1.2), new THREE.MeshStandardMaterial({ color: col("#b89878"), roughness: 0.7 }), nx * ny);
  scene.add(bricks);
  D.add({ dispose: () => { bricks.geometry.dispose(); (bricks.material as THREE.Material).dispose(); bricks.dispose(); } });
  const br = rng(21);
  const brickSeed = Array.from({ length: nx * ny }, () => [br(), br(), br()]);
  const isWindow = (i: number, j: number) => j >= 1 && j <= 5 && ((i >= 1 && i <= 7) || (i >= 12 && i <= 18)) && !(j === 3);
  const isDoor = (i: number, j: number) => j <= 4 && i >= 9 && i <= 10;
  const storeWin = new THREE.Mesh(new THREE.PlaneGeometry(BW * 0.9, BH * 0.55), new THREE.MeshBasicMaterial({ color: col("#ffe8b0", 0), toneMapped: false }));
  storeWin.position.set(AT.store, 1.9, -0.55);
  scene.add(storeWin);
  D.add({ dispose: () => { storeWin.geometry.dispose(); (storeWin.material as THREE.Material).dispose(); } });
  const sign = D.add(makeWords({ text: "POKÉMON CENTER", font: ctx.font, w: 6.2, color: "#fff4d0", glow: "#ff3d5a", px: 110 }));
  sign.mesh.position.set(AT.store, BH + 0.7, 0.2);
  scene.add(sign.mesh);
  const signBand = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.6, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: col("#d8282f"), roughness: 0.4, emissive: col("#7a0a10"), emissiveIntensity: 0 }));
  signBand.position.set(AT.store, BH + 0.7, 0);
  scene.add(signBand);
  D.add({ dispose: () => { signBand.geometry.dispose(); (signBand.material as THREE.Material).dispose(); } });
  const queue = Array.from({ length: 16 }, (_, i) => {
    const s = D.add(makeSilhouette({ height: i % 3 === 0 ? 1.2 : 1.7, child: i % 3 === 0, rim: "#ffd8a0" }));
    s.mesh.position.set(AT.store + 1.5 + i * 0.72, 0, 1.6 + Math.sin(i * 1.7) * 0.15);
    s.mesh.rotation.y = -Math.PI / 2 + Math.sin(i) * 0.2;
    scene.add(s.mesh);
    return s;
  });
  const storeLight = new THREE.SpotLight(col("#ffe0b0"), 0, 26, 0.9, 0.6, 1.2);
  storeLight.position.set(AT.store, 9, 9);
  storeLight.target.position.set(AT.store, 2, 0);
  scene.add(storeLight, storeLight.target);

  // ---- D. The cinema: a raked hall of red velvet seats, an audience in silhouette, curtains, a glowing
  // screen that lights the room, a projector beam from the booth through dust, Mewtwo rising in it.
  const C = AT.cinema;
  const ROWS = 7, PER = 16;
  const rowY = (row: number) => row * 0.32, rowZ = (row: number) => 2.6 + row * 1.05;
  const hall = new THREE.Mesh(merge([
    // Stepped floor: one tread per row, and the flat front before the screen.
    ...Array.from({ length: ROWS + 2 }, (_, row) => placed(new THREE.BoxGeometry(18, 0.32, 1.05), [C, rowY(row) - 0.16, rowZ(row)])),
    placed(new THREE.BoxGeometry(18, 0.1, 12), [C, -0.05, -4]),
    // Side walls, ceiling, back wall with the booth window, the screen's black masking and stage.
    placed(new THREE.BoxGeometry(0.3, 10, 26), [C - 9, 5, 2]), placed(new THREE.BoxGeometry(0.3, 10, 26), [C + 9, 5, 2]),
    placed(new THREE.BoxGeometry(18, 0.3, 26), [C, 9.2, 2]),
    placed(new THREE.BoxGeometry(18, 10, 0.3), [C, 5, 13.2]),
    placed(new THREE.BoxGeometry(18, 10, 0.2), [C, 5, -8.25]),
    placed(new THREE.BoxGeometry(14.6, 0.7, 1.4), [C, 0.35, -7.5]),
  ]), new THREE.MeshStandardMaterial({ color: col("#2a1418"), roughness: 0.85 }));
  // Velvet drapes down both walls and framing the screen: folds as a wavy strip.
  const drape = (x0: number, z0: number, z1: number, h: number, alongX = false) => {
    const n = 48, g = new THREE.PlaneGeometry(1, h, n, 1);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5, y = pos.getY(i);
      const fold = Math.sin(u * n * 0.9) * 0.12;
      if (alongX) pos.setXYZ(i, x0 + (z0 + (z1 - z0) * u), y + h / 2, -7.9 + fold);
      else pos.setXYZ(i, x0 + fold * Math.sign(-x0 + C), y + h / 2, z0 + (z1 - z0) * u);
    }
    g.computeVertexNormals();
    return g;
  };
  const drapes = new THREE.Mesh(merge([drape(C - 8.75, -6, 12, 8.6), drape(C + 8.75, 12, -6, 8.6), drape(C - 8.6, 0, 1.9, 8.6, true), drape(C + 6.7, 0, 1.9, 8.6, true)]), new THREE.MeshStandardMaterial({ color: col("#6a1020"), roughness: 0.7, side: THREE.DoubleSide }));
  // Seats (backs and arms in one rounded shape) and the audience: head and shoulders, some seats empty.
  const seatGeo = new RoundedBoxGeometry(0.62, 0.95, 0.18, 2, 0.08);
  const seats = new THREE.InstancedMesh(seatGeo, new THREE.MeshStandardMaterial({ color: col("#7a1424"), roughness: 0.75 }), ROWS * PER);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: col("#08070a"), roughness: 0.6 }), ROWS * PER);
  const shoulders = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 12, 8), heads.material as THREE.Material, ROWS * PER);
  const m4 = new THREE.Matrix4();
  const ra = rng(77);
  let nh = 0;
  for (let row = 0; row < ROWS; row++) for (let c = 0; c < PER; c++) {
    const x = C + (c - (PER - 1) / 2) * 0.7, y = rowY(row), z = rowZ(row) + 0.35;
    // A centre aisle.
    const ax = x + (c >= PER / 2 ? 0.5 : -0.5);
    m4.makeTranslation(ax, y + 0.5, z);
    seats.setMatrixAt(row * PER + c, m4);
    if (ra() < 0.82) {
      const lean = (ra() - 0.5) * 0.12, hs = 0.9 + ra() * 0.25;
      m4.makeScale(hs, hs * 1.12, hs).setPosition(ax + lean, y + 1.35 + ra() * 0.08, z - 0.16);
      heads.setMatrixAt(nh, m4);
      m4.makeScale(1.0, 0.45, 0.5).setPosition(ax, y + 1.0, z - 0.1);
      shoulders.setMatrixAt(nh, m4);
      nh++;
    }
  }
  heads.count = shoulders.count = nh;
  // The screen: an original moving image (a violet sky, a swirl of light, a far ridge), masked in black.
  const screen = D.add(makeCanvasPanel({
    w: 13, h: 6, px: [520, 240], emissive: 0.95,
    draw(g, w, h, tt) {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, "#1a1040"); gr.addColorStop(0.6, "#5a3a9a"); gr.addColorStop(1, "#d8a0d0");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.save(); g.translate(w / 2, h * 0.45);
      for (let k = 0; k < 7; k++) { g.rotate(0.9 + tt * 0.15); g.strokeStyle = `rgba(230,200,255,${0.12 + k * 0.03})`; g.lineWidth = 6 - k * 0.6; g.beginPath(); g.ellipse(0, 0, 40 + k * 22, 16 + k * 8, 0, 0, Math.PI * 1.4); g.stroke(); }
      g.restore();
      g.fillStyle = "#120a20";
      g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 20) g.lineTo(x, h * 0.78 - Math.sin(x * 0.02) * 18 - Math.sin(x * 0.07) * 6); g.lineTo(w, h); g.fill();
    },
  }));
  screen.mesh.position.set(C, 3.9, -8.1);
  // The screen lights the room: a broad soft light from it into the seats, and two warm wall sconces.
  const screenLight = new THREE.SpotLight(col("#a890ff"), 0, 30, 0.9, 0.9, 1.0);
  screenLight.position.set(C, 3.9, -7.6);
  screenLight.target.position.set(C, 2.6, 8);
  const sconces = [-8.6, 8.6].flatMap((dx) => [-2, 5].map((z) => { const g2 = D.add(makeGlow({ pos: [C + dx * 0.98, 4.2, z], size: 1.1, color: "#ffb070", intensity: 0 })); scene.add(g2.sprite); return g2; }));
  const wallLights = [-8.2, 8.2].map((dx) => { const pl = new THREE.PointLight(col("#ffa060"), 0, 9, 1.2); pl.position.set(C + dx, 4.2, 1.5); scene.add(pl); return pl; });
  const booth = D.add(makeGlow({ pos: [C, 5.2, 13.0], size: 1.6, color: "#ffffff", intensity: 0 }));
  scene.add(booth.sprite);
  const cinema = new THREE.Group();
  cinema.add(hall, drapes, seats, heads, shoulders, screen.mesh, screenLight, screenLight.target);
  scene.add(cinema);
  D.add({ dispose: () => { hall.geometry.dispose(); (hall.material as THREE.Material).dispose(); drapes.geometry.dispose(); (drapes.material as THREE.Material).dispose(); seatGeo.dispose(); (seats.material as THREE.Material).dispose(); seats.dispose(); heads.geometry.dispose(); (heads.material as THREE.Material).dispose(); heads.dispose(); shoulders.geometry.dispose(); shoulders.dispose(); } });
  const beam = D.add(makeShaft({ from: [AT.cinema, 5.2, 13], to: [AT.cinema, 3.9, -8], r0: 0.12, r1: 3.0, color: "#cfc0ff", intensity: 0.28, noise: 0.6 }));
  scene.add(beam.mesh);
  const dust = D.add(makeParticles({ count: Math.round(500 * P) + 60, shape: "box", center: [AT.cinema, 3.8, 0], extent: [1.6, 1.2, 8], velocity: [0, 0.05, 0], spread: [0.1, 0.1, 0.1], life: 6, size: [0.01, 0.025], colors: ["#ffffff", "#e0d8ff", "#bfb0ff"], intensity: 1.6, turbulence: 0.3 }));
  scene.add(dust.points);
  const psychic = D.add(makeParticles({ count: Math.round(420 * P) + 60, shape: "sphere", center: [AT.cinema, 2.4, -4.5], extent: [1.6, 1.8, 1.0], velocity: [0, 0.5, 0], spread: [0.3, 0.5, 0.3], life: 2.4, size: [0.02, 0.05], colors: ["#ffffff", "#c88aff", "#7a3aff"], intensity: 2.6, turbulence: 0.6, swirl: 0.8 }));
  scene.add(psychic.points);
  const purple = D.add(makeGlow({ pos: [AT.cinema, 2.4, -4.8], size: 6, color: "#a060ff", intensity: 0 }));
  scene.add(purple.sprite);

  // ---- E. The globe, lighting outward from Japan.
  const R = 5;
  const globe = D.add(makeGlobe({ radius: R, count: Math.round(9000 * Math.max(0.4, P)), land: "#ffb84a", lit: "#ffd23a", sea: "#05081a", seed: 8 }));
  globe.group.position.set(AT.globe, 0, 0);
  scene.add(globe.group);
  const atmo = D.add(makeGlow({ pos: [AT.globe, 0, -1], size: R * 2.9, color: "#ffb84a", intensity: 0 }));
  scene.add(atmo.sprite);
  const japan = new THREE.Vector3(0.42, 0.55, 0.72).normalize();
  globe.u.uFrom.value.copy(japan);
  const gr = rng(13);
  const pairs: [Vec3, Vec3][] = Array.from({ length: 18 }, () => [[japan.x, japan.y, japan.z], spherePoint(gr, 0.8)]);
  const worldArcs = D.add(makeArcs({ radius: R, pairs, color: "#ffe27a", perArc: 70, lift: 0.45 }));
  worldArcs.points.position.set(AT.globe, 0, 0);
  scene.add(worldArcs.points);

  // ---- F. The title, stamped in.
  const title1 = D.add(makeWords({ text: "GOTTA CATCH", font: ctx.font, w: 7.4, color: "#fff8e0", glow: "#ff9a05", px: 150, weight: 800 }));
  const title2 = D.add(makeWords({ text: "’EM ALL", font: ctx.font, w: 5.0, color: "#fff8e0", glow: "#ffcb05", px: 150, weight: 800 }));
  title1.mesh.position.set(AT.title, 0.75, 0);
  title2.mesh.position.set(AT.title, -0.75, 0);
  scene.add(title1.mesh, title2.mesh);
  const stampRing = D.add(makeRing({ color: "#ffe27a", intensity: 2.2, thickness: 0.035 }));
  stampRing.mesh.position.set(AT.title, 0, -0.5);
  scene.add(stampRing.mesh);
  const confetti = D.add(makeParticles({ count: Math.round(500 * P) + 80, shape: "box", center: [AT.title, 3, -1], extent: [9, 2, 3], velocity: [0, -1.4, 0], spread: [0.6, 0.6, 0.6], life: 4, size: [0.04, 0.09], colors: ["#ffcb05", "#ff3d5a", "#3a9bff"], intensity: 1.6, turbulence: 0.8, flicker: 0.4 }));
  scene.add(confetti.points);
  const titleGlow = D.add(makeGlow({ pos: [AT.title, 0, -2], size: 16, color: "#ffcb05", intensity: 0 }));
  scene.add(titleGlow.sprite);

  // ---- The figures: one Pikachu, moved from the TV to the globe; Mewtwo in the cinema.
  const figs = await loadFigures(ctx, [25, 150]);
  const pika = heroFigure(figs.get(25), { pos: [AT.tv, 0, 0.2], height: 1.05, accent: "#ffcb05", scene });
  const mewtwo = heroFigure(figs.get(150), { pos: [AT.cinema, 0.8, -4.5], height: 3.0, accent: "#b070ff", scene });
  if (pika) D.add(pika);
  if (mewtwo) D.add(mewtwo);

  // ---- The camera: shots and cuts.
  const orbitFace = (k: number): Key => { const a = -0.7 + k * 1.5; return { t: tFace + 0.2 + k * (tCompany - tFace - 0.2), pos: [AT.tv + Math.sin(a) * 3.0, 1.25 + k * 0.2, 1.6 + Math.cos(a) * 3.0], look: [AT.tv, 0.75, 1.6], fov: 38 }; };
  const camera = shots([
    [0, [
      { t: 0, pos: [AT.cards + 0.4, 1.7, 6.5], look: [AT.cards, 1.5, 0], fov: 40 },
      { t: tCards, pos: [AT.cards + 0.2, 1.6, 4.2], look: [AT.cards, 1.5, 0], fov: 42 },
      { t: tCards + 1.2, pos: [AT.cards, 1.55, 2.6], look: [AT.cards, 1.5, -1], fov: 56 },
      { t: tCards + 4, pos: [AT.cards - 0.6, 1.8, 1.4], look: [AT.cards + 0.4, 1.4, -2], fov: 58 },
      { t: tAnime, pos: [AT.cards - 0.9, 1.9, 0.6], look: [AT.cards + 0.6, 1.3, -2], fov: 58 },
    ]],
    [tAnime - 0.25, [
      { t: tAnime - 0.25, pos: [AT.tv + 1.4, 1.5, 6.2], look: [AT.tv - 0.1, 1.3, -0.5], fov: 40 },
      { t: tAnime + 1.4, pos: [AT.tv + 0.2, 1.45, 3.4], look: [AT.tv - 0.15, 1.45, -0.4], fov: 36 },
      { t: tAnime + 3.2, pos: [AT.tv + 0.1, 1.2, 3.0], look: [AT.tv, 1.0, 0.6], fov: 38 },
      { t: tFace, pos: [AT.tv + 1.2, 1.2, 4.0], look: [AT.tv, 0.8, 1.4], fov: 38 },
      orbitFace(0), orbitFace(0.5), orbitFace(1),
    ]],
    [tCompany, [
      { t: tCompany, pos: [AT.store - 3, 2.2, 15], look: [AT.store, 3, 0], fov: 46 },
      { t: tCompany + 4, pos: [AT.store + 2, 2.0, 12.5], look: [AT.store + 1, 2.8, 0], fov: 44 },
      { t: tMovie, pos: [AT.store + 7, 1.6, 8], look: [AT.store + 3, 2.2, 0], fov: 42 },
    ]],
    [tMovie - 0.2, [
      { t: tMovie - 0.2, pos: [AT.cinema + 0.5, 3.4, 11], look: [AT.cinema, 3.2, -6], fov: 44 },
      { t: tMovie + 2.6, pos: [AT.cinema, 2.6, 4.2], look: [AT.cinema, 2.6, -4.5], fov: 40 },
      { t: tWorld, pos: [AT.cinema - 0.4, 2.2, 2.4], look: [AT.cinema, 2.9, -4.5], fov: 36 },
    ]],
    [tWorld - 0.2, [
      { t: tWorld - 0.2, pos: [AT.globe + 3.2, 5.8, 8.5], look: [AT.globe + 0.4, 4.9, 0], fov: 38 },
      { t: tWorld + 2.4, pos: [AT.globe + 4, 5, 14], look: [AT.globe, 2.6, 0], fov: 42 },
      { t: tCatch, pos: [AT.globe + 2.5, 4, 22], look: [AT.globe, 1, 0], fov: 44 },
    ]],
    [tCatch, [
      { t: tCatch, pos: [AT.title, 0, 9.5], look: [AT.title, 0, 0], fov: 44 },
      { t: end, pos: [AT.title, 0.1, 8.2], look: [AT.title, 0, 0], fov: 44 },
    ]],
  ]);
  const starts = [0, tAnime - 0.25, tCompany, tMovie - 0.2, tWorld - 0.2, tCatch];
  const SKIES: [string, string, string, number][] = [
    ["#07030f", "#3a0f4a", "#040208", 0],
    ["#08060c", "#140e1c", "#040306", 0],
    ["#1b2a6a", "#ff9a5a", "#201018", 0],
    ["#020203", "#06040c", "#000000", 0],
    ["#010208", "#0a1230", "#000000", 0.05],
    ["#140800", "#7a3a00", "#0a0400", 0],
  ];
  const KEYK = [0.9, 0.1, 0.35, 0.05, 0.5, 0.6];
  const HEMI = [0.5, 0.1, 0.3, 0.05, 0.25, 0.4];
  const cam0 = new THREE.Vector3();

  return {
    scene,
    portalScale: 1.4,
    camera,
    orbit: (t) => ({ target: camera(t).look, limits: { yaw0: 0, yawSpan: 0.9, minPitch: -0.1, maxPitch: 1.1, minDist: 1, maxDist: 30 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const st = stageAt(starts, t);
      sky.follow(cam);
      const [top, hor, bot, stars] = SKIES[st];
      sky.u.uTop.value.copy(col(top)); sky.u.uHorizon.value.copy(col(hor)); sky.u.uBottom.value.copy(col(bot));
      sky.u.uStars.value = stars;
      sky.u.uTime.value = ambient;
      L.key.intensity = KEYK[st];
      L.hemi.intensity = HEMI[st];
      cam0.copy(cam.position);

      // A. The pack tears; the cards burst and fan round the camera.
      const tear = ramp(t, tCards + 0.25, tCards + 0.7);
      packTop.position.set(-tear * 1.6, 0.88 + tear * 2.2, -tear * 0.6);
      packTop.rotation.z = tear * 2.4;
      pack.visible = st === 0;
      pack.rotation.y = Math.sin(ambient * 0.8) * 0.15 * (1 - tear);
      foil.mesh.scale.setScalar(1 - 0.7 * ramp(t, tCards + 0.6, tCards + 1.6));
      cards.u.uBurst.value = ramp(t, tCards + 0.5, tCards + 3.6);
      cards.u.uTime.value = ambient;
      cards.mesh.visible = st === 0 && t > tCards + 0.4;
      packGlow.set("#ffc0e8", 0.14 + 0.32 * spike(t, tCards + 0.55, 0.08, 0.9));
      speed.u.uTime.value = ambient;
      speed.u.uOpacity.value = st === 0 ? ramp(t, tCards + 0.6, tCards + 1.4) * 0.7 : 0;
      glitter.u.uTime.value = ambient; glitter.u.uPixel.value = px;
      glitter.u.uOpacity.value = st === 0 ? 0.6 * ramp(t, tCards + 0.5, tCards + 1.5) : 0;

      // B. The TV flicks on; Pikachu steps out of it.
      const on = ramp(t, tAnime + 0.1, tAnime + 0.6);
      const s = t < tAnime ? 0 : on < 1 ? on : 1 + Math.floor(ambient * 6) / 600;
      const sk = Math.round(s * 30) / 30;
      if (sk !== screenState) { screenState = sk; crt.redraw(s); }
      const tvOn = st === 1 ? on : 0;
      tvGlow.set("#9ad8ff", 0.3 * tvOn);
      tvLight.intensity = 16 * tvOn;
      kid.setRim("#bfe6ff", 1.2 * tvOn);
      kid.mesh.visible = st === 1 && t < tFace;
      const out = ramp(t, tAnime + 1.8, tAnime + 3.4);
      const pAt: Vec3 = st <= 1 ? [AT.tv - 0.15 + out * 0.15, 0.95 - out * 0.95, -0.5 + out * 2.1] : [AT.globe, R - 0.05, 0];
      if (pika) {
        pika.move(pAt, st <= 1 ? Math.sin(ambient * 0.6) * 0.25 : 0.4);
        const show = st === 1 ? ramp(t, tAnime + 1.6, tAnime + 2.8) : st === 4 ? ramp(t, tWorld + 0.2, tWorld + 1.2) : 0;
        pika.fig.group.visible = show > 0.001;
        pika.set(show, ambient, viewH, cam, st === 4 ? 0.02 : 0.05, 0.1 * show);
        if (st === 4) pika.fig.setHeight(0.85);
        else pika.fig.setHeight(1.05);
      }
      sparks.u.uTime.value = ambient; sparks.u.uPixel.value = px;
      sparks.u.uCenter.value.set(AT.tv, 0.6 + (1 - out) * 0.6, 1.4 * out);
      sparks.u.uOpacity.value = st === 1 ? ramp(t, tAnime + 1.8, tAnime + 2.4) : 0;
      // Face: arcs crackle, a halo, a ring at its feet.
      const face = st === 1 ? ramp(t, tFace, tFace + 0.8) : 0;
      halo.sprite.position.set(AT.tv, 0.6, 1.6);
      halo.set("#ffd83a", 0.6 * face);
      arcs.forEach((a, i) => {
        const slot = Math.floor(ambient * 5 + i * 0.37);
        const r = rng(slot * 7 + i);
        const ang = r() * Math.PI * 2;
        const live = face > 0.5 && (slot + i) % 2 === 0;
        a.mesh.visible = live;
        if (live) a.strike([AT.tv + Math.cos(ang) * 0.5, 0.9 + r() * 0.3, 1.6 + Math.sin(ang) * 0.4], [AT.tv + Math.cos(ang + 0.8) * 0.85, 0.3 + r() * 0.6, 1.6 + Math.sin(ang + 0.8) * 0.7], slot, cam0);
        a.u.uAlpha.value = live ? 1 : 0;
      });
      faceRing.u.uK.value = ((ambient * 0.5) % 1);
      faceRing.u.uOpacity.value = face;
      faceRing.u.uTime.value = ambient;
      faceRing.mesh.scale.setScalar(1.8);

      // C. The storefront builds itself, brick by brick; the sign lights; a queue forms.
      const build = ramp(t, tCompany + 0.1, tCompany + 3.0);
      let n = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const [a, b, c] = brickSeed[n];
        const hole = isWindow(i, j) || isDoor(i, j);
        const k = Math.max(0, Math.min(1, (build * 1.6 - (j / ny) * 0.5 - a * 0.25) / 0.35));
        const e = 1 - (1 - k) * (1 - k);
        const tx = AT.store + (i - (nx - 1) / 2) * BRICK, ty = BRICK / 2 + j * BRICK, tz = -0.6;
        const fx = tx + (b - 0.5) * 18, fy = ty + 9 + c * 6, fz = tz + 8 + a * 6;
        const sc = hole || k <= 0 ? 0.0001 : 1;
        m4.makeRotationX((1 - e) * (a * 6)).setPosition(fx + (tx - fx) * e, fy + (ty - fy) * e, fz + (tz - fz) * e);
        m4.scale(new THREE.Vector3(sc, sc, sc));
        bricks.setMatrixAt(n++, m4);
      }
      bricks.instanceMatrix.needsUpdate = true;
      bricks.visible = st === 2;
      const lit = ramp(t, tCompany + 3.0, tCompany + 3.6);
      (storeWin.material as THREE.MeshBasicMaterial).color.copy(col("#ffe0a0", 0.7 * lit));
      (signBand.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 * lit;
      sign.mat.opacity = lit;
      sign.mesh.visible = lit > 0.01;
      signBand.scale.set(Math.max(0.001, ramp(t, tCompany + 2.4, tCompany + 3.0)), 1, 1);
      storeLight.intensity = st === 2 ? 10 * (0.4 + 0.6 * lit) : 0;
      queue.forEach((q, i) => { const k = ramp(t, tCompany + 3.4 + i * 0.22, tCompany + 3.8 + i * 0.22); q.mesh.visible = k > 0.01; q.mesh.scale.setScalar(Math.max(0.001, k)); q.setRim("#ffd8a0", 1.6); });
      city.u.uTime.value = ambient;

      // D. The cinema: the beam, the dust, Mewtwo rising.
      const cin = st === 3 ? 1 : 0;
      cinema.visible = cin > 0;
      if (cin) screen.redraw(ambient);
      const flick = 0.9 + 0.1 * Math.sin(ambient * 23) * Math.sin(ambient * 7.3);
      screenLight.intensity = cin * 150 * flick;
      wallLights.forEach((w) => (w.intensity = cin * 9));
      sconces.forEach((g2) => g2.set("#ffb070", 0.5 * cin));
      booth.set("#ffffff", 1.2 * cin);
      beam.u.uTime.value = ambient;
      beam.u.uOpacity.value = cin * (0.4 + 0.6 * ramp(t, tMovie - 0.2, tMovie + 0.6));
      dust.u.uTime.value = ambient; dust.u.uPixel.value = px; dust.u.uOpacity.value = cin;
      const rise = ramp(t, tMovie + 0.4, tMovie + 2.8);
      if (mewtwo) {
        mewtwo.move([AT.cinema, 0.6 + rise * 1.0, -4.5], Math.sin(ambient * 0.4) * 0.15);
        mewtwo.set(cin * ramp(t, tMovie + 0.3, tMovie + 1.8), ambient, viewH, cam, 0.06, 0.15 * rise);
        mewtwo.fig.group.visible = cin > 0;
      }
      psychic.u.uTime.value = ambient; psychic.u.uPixel.value = px; psychic.u.uOpacity.value = cin * rise;
      purple.set("#a060ff", 0.6 * cin * rise);

      // E. The globe turns; light spreads out of Japan; arcs fly.
      globe.group.rotation.y = -0.15 + (t - tWorld) * 0.05;
      worldArcs.points.rotation.y = globe.group.rotation.y;
      globe.u.uSpread.value = ramp(t, tWorld + 0.3, tWorld + 5.5) * 3.3;
      globe.u.uTime.value = ambient;
      globe.u.uPixel.value = px;
      globe.group.visible = st === 4;
      atmo.set("#ff9a3a", st === 4 ? 0.12 + 0.18 * ramp(t, tWorld + 0.3, tWorld + 4) : 0);
      worldArcs.u.uGrow.value = ramp(t, tWorld + 0.8, tWorld + 5.5);
      worldArcs.u.uTime.value = ambient; worldArcs.u.uPixel.value = px;
      worldArcs.points.visible = st === 4;

      // F. The title stamps in.
      const stamp = ramp(t, tCatch, tCatch + 0.18);
      const sc = 1 + (1 - stamp) * 0.6;
      title1.mesh.scale.setScalar(sc); title2.mesh.scale.setScalar(sc);
      title1.mat.opacity = title2.mat.opacity = stamp;
      title1.mat.color.setScalar(1.0); title2.mat.color.setScalar(1.0);
      title1.mesh.visible = title2.mesh.visible = st === 5;
      title2.mesh.position.y = -0.75 - (1 - ramp(t, tCatch + 0.12, tCatch + 0.3)) * 0.3;
      stampRing.u.uK.value = ramp(t, tCatch + 0.12, tCatch + 1.6);
      stampRing.u.uOpacity.value = st === 5 ? 1 - ramp(t, tCatch + 1.2, tCatch + 1.8) : 0;
      stampRing.u.uTime.value = ambient;
      stampRing.mesh.scale.setScalar(9);
      confetti.u.uTime.value = ambient; confetti.u.uPixel.value = px; confetti.u.uOpacity.value = st === 5 ? ramp(t, tCatch + 0.2, tCatch + 0.8) : 0;
      titleGlow.set("#ffcb05", st === 5 ? 0.18 + 0.5 * spike(t, tCatch + 0.15, 0.05, 0.6) : 0);
    },
    look: (t) =>
      lookAt(t, { ...STOCK.pop }, {
        exposure: [[0, 0.9], [tAnime - 0.3, 0.9], [tAnime, 0.8], [tCompany - 0.01, 0.8], [tCompany, 0.85], [tMovie, 0.85], [tWorld, 1.1], [end, 1.0]],
        bloom: [[0, 0.75], [tCards + 0.6, 0.95], [tCards + 3, 0.8], [tAnime, 0.7], [tWorld, 1.0], [tCatch, 0.9], [end, 0.85]],
        bloomThreshold: [[0, 0.86], [tAnime - 0.3, 0.86], [tAnime, 0.8], [end, 0.8]],
        chroma: [[0, 0.1], [tCompany - 0.01, 0.1], [tCompany, 0.9], [tCompany + 0.35, 0.12], [tCatch - 0.01, 0.12], [tCatch, 1.0], [tCatch + 0.4, 0.15], [end, 0.15]],
        flash: [[tAnime - 0.3, 0], [tAnime - 0.25, 0.35], [tAnime + 0.05, 0], [tMovie - 0.25, 0], [tMovie - 0.2, 0.3], [tMovie + 0.1, 0], [tWorld - 0.25, 0], [tWorld - 0.2, 0.35], [tWorld + 0.1, 0], [tCatch, 0], [tCatch + 0.12, 0.5], [tCatch + 0.5, 0]],
        saturation: [[0, 1.25], [end, 1.25]],
        fade: [[0, 0.5], [1.0, 0]],
      }),
    dispose() { D.dispose(); },
  };
};
