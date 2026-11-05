import * as THREE from "three";
import type { Key } from "@/lib/world-history/camera";
import { col, makeGlow, makeParticles, makeShaft, makeSky, makeTerrain, merge, noise2, placed, ramp, rng } from "@/components/world-history/scene/kit";
import { makeCity } from "@/components/world-history/scene/props";
import { lights, loadFigures, lookAt, pointPixel, spike } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { makeDevice, makeGlobe, makeStars } from "../story-kit";
import { bag, heroFigure, shots, stageAt, STOCK } from "./base";
import { drawTitleScreen } from "./red-green";

/**
 * VIII. Together. A night-side globe where every time zone lights at the
 * same instant and a single ring of light wraps the planet. A flat, folded
 * sheet opens like origami into Xerneas in full 3D, light running along the
 * seams (slow motion); Yveltal waits in the dark beside it. A waterfront
 * street at dusk, a parade of Pikachu bobbing in step under confetti. A
 * handheld's screen showing the title screen from Chapter V. Then a dive
 * under the water, light rippling down, and up onto a beach where Solgaleo
 * and Lunala hang in the sky as sun and moon.
 */

const AT = { globe: 0, fold: 70, street: 140, ds: 210, alola: 280 };

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tSame = B("same-day"), tFold = B("fold"), tOutbreak = B("outbreak"), tTwenty = B("twenty"), tAlola = B("alola");
  const P = ctx.q.particles;

  const sky = D.add(makeSky({ top: "#01030a", horizon: "#05102a", bottom: "#000000" }));
  scene.add(sky.mesh);
  const stars = D.add(makeStars({ count: 2200, radius: 600, center: [AT.globe, 0, 0] }));
  scene.add(stars.points);
  scene.fog = new THREE.FogExp2(col("#000000"), 0);
  const L = lights(scene, { sky: "#cfe8ff", ground: "#203040", fill: 0.6, key: "#fff4e0", keyK: 1.4, keyPos: [6, 12, 8], rim: "#9ad8ff", rimK: 0.8 });

  // ---- A. The night side of the planet lights all at once; a ring wraps it.
  const R = 6;
  const globe = D.add(makeGlobe({ radius: R, count: Math.round(11000 * Math.max(0.45, P)), land: "#3a5a8a", lit: "#9a7634", sea: "#030612", seed: 21 }));
  globe.group.position.set(AT.globe, 0, 0);
  globe.u.uSize.value = R * 0.0085;
  scene.add(globe.group);
  const wrap = new THREE.Mesh(new THREE.TorusGeometry(R * 1.04, 0.035, 8, 160), new THREE.MeshBasicMaterial({ color: col("#bff0ff", 3), transparent: true, opacity: 0, toneMapped: false }));
  wrap.position.set(AT.globe, 0, 0);
  scene.add(wrap);
  D.add({ dispose: () => { wrap.geometry.dispose(); (wrap.material as THREE.Material).dispose(); } });
  const wrapGlow = D.add(makeGlow({ pos: [AT.globe, 0, 0], size: R * 3.4, color: "#9ad8ff", intensity: 0 }));
  scene.add(wrapGlow.sprite);

  // ---- B. The fold: a folded sheet opens and Xerneas stands up out of it.
  const STRIPS = 8, SW = 0.62, SH = 4.6;
  // The sheet carries a flat pixel sprite of Xerneas (its own picture, sampled in big square pixels) across all the strips.
  const sheetU = { uMap: { value: null as THREE.Texture | null }, uOpacity: { value: 0 }, uAspect: { value: 1 }, uTint: { value: col("#5a9ad8") } };
  const sheetMat = new THREE.ShaderMaterial({
    uniforms: sheetU, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uOpacity, uAspect; uniform vec3 uTint; varying vec2 vUv;
      void main(){
        vec2 uv = vec2((vUv.x - 0.5) * uAspect + 0.5, vUv.y);
        vec2 cell = floor(uv * 44.0);
        vec2 q = (cell + 0.5) / 44.0;
        vec4 c = texture2D(uMap, q);
        float inside = step(0.0, uv.x) * step(uv.x, 1.0);
        float a = step(0.5, c.a) * inside;
        vec2 f = fract(uv * 44.0);
        float grid = step(0.08, f.x) * step(0.08, f.y);
        vec3 paper = uTint * 0.16;
        vec3 col = mix(paper, c.rgb * (0.75 + 0.25 * grid), a);
        gl_FragColor = vec4(col, uOpacity * mix(0.35, 1.0, a));
      }`,
  });
  const seamMat = new THREE.MeshBasicMaterial({ color: col("#e8fbff", 0.9), transparent: true, opacity: 1, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const stripGeo = new THREE.PlaneGeometry(SW, SH).translate(SW / 2, SH / 2, 0);
  const stripGeos = Array.from({ length: STRIPS }, (_, i) => { const g = stripGeo.clone(); const uv = g.getAttribute("uv"); for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / STRIPS); return g; });
  const seamGeo = new THREE.PlaneGeometry(0.018, SH).translate(0, SH / 2, 0.01);
  const sheet = new THREE.Group();
  sheet.position.set(AT.fold - (STRIPS * SW) / 2, 0, 0.6);
  scene.add(sheet);
  // An accordion: each strip hangs off the end of the one before.
  const strips: THREE.Group[] = [];
  let parent: THREE.Object3D = sheet;
  for (let i = 0; i < STRIPS; i++) {
    const g = new THREE.Group();
    if (i > 0) g.position.x = SW;
    g.add(new THREE.Mesh(stripGeos[i], sheetMat));
    const seam = new THREE.Mesh(seamGeo, seamMat);
    g.add(seam);
    parent.add(g);
    strips.push(g);
    parent = g;
  }
  D.add({ dispose: () => { stripGeo.dispose(); stripGeos.forEach((g) => g.dispose()); seamGeo.dispose(); sheetMat.dispose(); seamMat.dispose(); } });
  const foldGlow = D.add(makeGlow({ pos: [AT.fold, 2.4, 0.4], size: 9, color: "#9ad8ff", intensity: 0 }));
  scene.add(foldGlow.sprite);
  const foldFloor = new THREE.Mesh(new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#0a1424"), roughness: 0.95, metalness: 0 }));
  foldFloor.position.set(AT.fold, 0, 0);
  scene.add(foldFloor);
  D.add({ dispose: () => { foldFloor.geometry.dispose(); (foldFloor.material as THREE.Material).dispose(); } });
  const foldSpark = D.add(makeParticles({ count: Math.round(420 * P) + 60, shape: "box", center: [AT.fold, 2.3, 0.6], extent: [2.6, 2.3, 0.3], velocity: [0, 0.3, 0.2], spread: [0.3, 0.3, 0.3], life: 1.8, size: [0.015, 0.04], colors: ["#ffffff", "#bff0ff", "#ffd8f0"], intensity: 2.6, turbulence: 0.5, flicker: 0.6 }));
  scene.add(foldSpark.points);

  // ---- C. A waterfront street at dusk, and the parade.
  const nzS = noise2(4);
  const quay = new THREE.Mesh(new THREE.PlaneGeometry(90, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#5a5262"), roughness: 0.6, metalness: 0.05 }));
  quay.position.set(AT.street, 0, -2);
  // The bay holds the dusk: a gradient from the bright sky line to deep water, with a glitter of lamps.
  const bayTex = (() => { const c = document.createElement("canvas"); c.width = 64; c.height = 256; const g = c.getContext("2d")!; const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, "#0a1a34"); gr.addColorStop(0.7, "#3a3a6a"); gr.addColorStop(1, "#ff9a6a"); g.fillStyle = gr; g.fillRect(0, 0, 64, 256); return new THREE.CanvasTexture(c); })();
  bayTex.colorSpace = THREE.SRGBColorSpace;
  const bay = new THREE.Mesh(new THREE.PlaneGeometry(90, 60).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: bayTex, color: col("#ffffff", 0.7) }));
  D.add({ dispose: () => bayTex.dispose() });
  bay.position.set(AT.street, -0.4, 40);
  scene.add(quay, bay);
  D.add({ dispose: () => { quay.geometry.dispose(); (quay.material as THREE.Material).dispose(); bay.geometry.dispose(); (bay.material as THREE.Material).dispose(); } });
  void nzS;
  const towers = D.add(makeCity({ center: [AT.street, 0, -52], radius: 34, count: 46, height: [10, 40], color: "#8a6a48", seed: 12 }));
  scene.add(towers.mesh);
  const lamps = Array.from({ length: 10 }, (_, i) => { const g = D.add(makeGlow({ pos: [AT.street - 22 + i * 5, 3.2, 6.5], size: 1.1, color: "#ffd890", intensity: 0.9 })); scene.add(g.sprite); return g; });
  void lamps;
  const postMat = new THREE.MeshStandardMaterial({ color: col("#1a1a22"), roughness: 0.5, metalness: 0.5 });
  const posts = new THREE.Mesh(merge(Array.from({ length: 10 }, (_, i) => placed(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6), [AT.street - 22 + i * 5, 1.6, 6.5]))), postMat);
  const poolTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: col("#ffb860", 0.45), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const pools = new THREE.Mesh(merge(Array.from({ length: 10 }, (_, i) => placed(new THREE.PlaneGeometry(5.5, 5.5).rotateX(-Math.PI / 2), [AT.street - 22 + i * 5, 0.02, 5.2]))), poolMat);
  scene.add(posts, pools);
  D.add({ dispose: () => { posts.geometry.dispose(); postMat.dispose(); pools.geometry.dispose(); poolMat.dispose(); poolTex.dispose(); } });
  const confetti = D.add(makeParticles({ count: Math.round(700 * P) + 100, shape: "box", center: [AT.street, 5, 0], extent: [14, 2, 5], velocity: [0, -1.1, 0], spread: [0.6, 0.4, 0.6], life: 5, size: [0.04, 0.08], colors: ["#ffcb05", "#ff5a8a", "#5ad1ff"], intensity: 1.5, turbulence: 0.9, flicker: 0.4 }));
  scene.add(confetti.points);

  // ---- D. A handheld showing the title screen from Chapter V.
  const ds = D.add(makeDevice("3ds", { draw: drawTitleScreen(ctx.font), draw2: (g, w, h) => { g.fillStyle = "#1a1a22"; g.fillRect(0, 0, w, h); g.fillStyle = "#9bbc0f"; g.font = `600 ${Math.round(h * 0.16)}px ${ctx.font}`; g.textAlign = "center"; g.fillText("20 YEARS", w / 2, h * 0.58); }, px: [400, 240] }));
  ds.group.position.set(AT.ds, 1.2, 0);
  ds.group.scale.setScalar(2.2);
  scene.add(ds.group);
  const dsTable = new THREE.Mesh(new THREE.CircleGeometry(9, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#3a2a1e"), roughness: 0.5 }));
  dsTable.position.set(AT.ds, -0.46, 0);
  scene.add(dsTable);
  D.add({ dispose: () => { dsTable.geometry.dispose(); (dsTable.material as THREE.Material).dispose(); } });
  const dsLight = new THREE.PointLight(col("#fff0d8"), 0, 12, 1.5);
  dsLight.position.set(AT.ds + 2, 4, 5);
  scene.add(dsLight);
  const dsGlow = D.add(makeGlow({ pos: [AT.ds, 1.8, -1.5], size: 9, color: "#9bbc0f", intensity: 0 }));
  scene.add(dsGlow.sprite);

  // ---- E. Alola: under the water, then a beach under a sun and a moon.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(220, 220, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#2aa0c0"), roughness: 0.65, metalness: 0.0, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  water.position.set(AT.alola, 0, -20);
  scene.add(water);
  const nz = noise2(9);
  const beachH = (x: number, z: number) => { const d = -z; return Math.max(-3, Math.min(6, (d - 2) * 0.18 + nz.fbm(x * 0.05, z * 0.05, 3) * 1.2 + (d > 18 ? (d - 18) * 0.35 : 0))); };
  const beach = D.add(makeTerrain({ size: [120, 80], segments: 80, height: beachH, color: (h) => (h < 0.4 ? [0.9, 0.82, 0.6] : [0.28, 0.5, 0.22]) }));
  beach.mesh.position.set(AT.alola, -0.6, -30);
  scene.add(beach.mesh);
  D.add({ dispose: () => { water.geometry.dispose(); (water.material as THREE.Material).dispose(); } });
  const shafts = [-6, -2, 2, 6].map((x, i) => { const s = D.add(makeShaft({ from: [AT.alola + x, 0, 6 + i], to: [AT.alola + x * 1.4, -9, 2 + i], r0: 0.6, r1: 1.8, color: "#bff6ff", intensity: 0.9, noise: 0.8 })); s.mesh.renderOrder = 9; scene.add(s.mesh); return s; });
  const bubbles = D.add(makeParticles({ count: Math.round(260 * P) + 40, shape: "box", center: [AT.alola, -4, 6], extent: [6, 3, 4], velocity: [0, 1.0, 0], spread: [0.2, 0.3, 0.2], life: 3, size: [0.03, 0.08], colors: ["#ffffff", "#bff6ff", "#9ad8ff"], intensity: 1.6, turbulence: 0.6 }));
  scene.add(bubbles.points);
  // Light rippling through the water: caustics on the underside of the surface and on the sand.
  const causU = { uTime: { value: 0 }, uK: { value: 0 } };
  const causMat = new THREE.ShaderMaterial({
    uniforms: causU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uK; varying vec2 vP;
      void main(){
        vec2 p = vP * 1.4;
        float n1 = sin(p.x * 1.7 + uTime * 0.9 + 1.3 * sin(p.y * 1.3 + uTime * 0.6)) + sin(p.y * 1.9 - uTime * 0.7 + 1.1 * sin(p.x * 1.1 - uTime * 0.5));
        float n2 = sin((p.x - p.y) * 1.5 - uTime * 0.8 + sin(p.x * 0.7)) + sin((p.x + p.y) * 1.3 + uTime * 1.1);
        float c = (1.0 - smoothstep(0.0, 0.28, abs(n1))) * 0.7 + (1.0 - smoothstep(0.0, 0.22, abs(n2))) * 0.5;
        gl_FragColor = vec4(vec3(0.6, 0.95, 1.0) * c * uK, 1.0);
      }`,
  });
  const caus = new THREE.Mesh(merge([placed(new THREE.PlaneGeometry(60, 40).rotateX(-Math.PI / 2), [AT.alola, -0.06, 0]), placed(new THREE.PlaneGeometry(60, 40).rotateX(-Math.PI / 2), [AT.alola, -3.55, 2])]), causMat);
  caus.renderOrder = 9;
  scene.add(caus);
  D.add({ dispose: () => { caus.geometry.dispose(); causMat.dispose(); } });
  // Under the surface: the world seen through blue water.
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 16), new THREE.MeshBasicMaterial({ color: col("#0a5a80"), transparent: true, opacity: 0.8, side: THREE.BackSide, depthWrite: false, depthTest: false }));
  bubble.renderOrder = 8;
  scene.add(bubble);
  D.add({ dispose: () => { bubble.geometry.dispose(); (bubble.material as THREE.Material).dispose(); } });
  const palms = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: col("#7a5a3a"), roughness: 0.9 });
  const frondMat = new THREE.MeshStandardMaterial({ color: col("#3a9a3a"), roughness: 0.8, side: THREE.DoubleSide });
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 6, 8).translate(0, 3, 0);
  const leaf = new THREE.Shape();
  leaf.moveTo(0, 0); leaf.quadraticCurveTo(0.45, 1.2, 0.05, 3.2); leaf.quadraticCurveTo(-0.45, 1.2, 0, 0);
  const frondGeo = new THREE.ShapeGeometry(leaf, 8);
  { const pa = frondGeo.getAttribute("position"); for (let k = 0; k < pa.count; k++) { const y = pa.getY(k); pa.setZ(k, -0.06 * y * y); } frondGeo.computeVertexNormals(); }
  const pr = rng(4);
  for (let i = 0; i < 9; i++) {
    const p = new THREE.Group();
    p.add(new THREE.Mesh(trunkGeo, trunkMat));
    for (let k = 0; k < 9; k++) { const f = new THREE.Mesh(frondGeo, frondMat); f.position.y = 6; f.rotation.set(1.35 + pr() * 0.5, (k / 9) * Math.PI * 2 + pr() * 0.3, 0, "YXZ"); p.add(f); }
    const px0 = -26 + i * 6.5 + pr() * 2, pz0 = -36 - pr() * 8;
    p.position.set(AT.alola + px0, beachH(px0, pz0 + 30) - 0.7, pz0);
    p.rotation.z = (pr() - 0.5) * 0.3;
    palms.add(p);
  }
  scene.add(palms);
  D.add({ dispose: () => { trunkGeo.dispose(); frondGeo.dispose(); trunkMat.dispose(); frondMat.dispose(); } });
  const sunGlow = D.add(makeGlow({ pos: [AT.alola - 30, 22, -70], size: 46, color: "#ffb05a", intensity: 0 }));
  const moonGlow = D.add(makeGlow({ pos: [AT.alola + 30, 22, -70], size: 40, color: "#b8a0ff", intensity: 0 }));
  scene.add(sunGlow.sprite, moonGlow.sprite);

  // ---- The figures.
  const figs = await loadFigures(ctx, [716, 717, 25, 791, 792]);
  const xerneas = heroFigure(figs.get(716), { pos: [AT.fold + 0.6, 0, 0], height: 4.2, accent: "#9ad8ff", scene, rotY: -0.25 });
  const yveltal = heroFigure(figs.get(717), { pos: [AT.fold - 4.6, 0.2, -2.5], height: 4.0, accent: "#ff4a6a", scene, rotY: 0.5 });
  const solgaleo = heroFigure(figs.get(791), { pos: [AT.alola - 30, 14, -66], height: 16, accent: "#ffb05a", scene, rotY: 0.4 });
  const lunala = heroFigure(figs.get(792), { pos: [AT.alola + 30, 14, -66], height: 16, accent: "#b8a0ff", scene, rotY: -0.4 });
  [xerneas, yveltal, solgaleo, lunala].forEach((h) => h && D.add(h));
  const xFig = figs.get(716);
  const xScale = xFig ? xFig.group.scale.z : 1;
  const xMap = xFig ? (xFig.mesh.material as THREE.MeshStandardMaterial).map : null;
  if (xMap) {
    sheetU.uMap.value = xMap;
    const img = xMap.image as { width?: number; height?: number } | undefined;
    const texAspect = img && img.width && img.height ? img.width / img.height : 1;
    sheetU.uAspect.value = ((STRIPS * SW) / SH) / texAspect;
  }
  // The parade: copies of one Pikachu (sharing its mesh and material).
  const pika = figs.get(25);
  const parade: THREE.Group[] = [];
  if (pika) {
    pika.setHeight(0.9);
    pika.group.rotation.y = -Math.PI / 2;
    const { u } = pika;
    u.uDissolve.value = 1; u.uRim.value = 1.2; u.uRimColor.value.copy(col("#ffcb05"));
    for (let i = 0; i < 30; i++) {
      const g = i === 0 ? pika.group : pika.group.clone();
      scene.add(g);
      parade.push(g);
    }
    D.add({ dispose: () => pika.dispose() });
  }

  const orbitG = (k: number, t: number): Key => { const a = 0.4 + k * 1.2; return { t, pos: [AT.globe + Math.sin(a) * 17, 4 + k * 2, Math.cos(a) * 17], look: [AT.globe, 0, 0], fov: 40 }; };
  const camera = shots([
    [0, [orbitG(0, 0), orbitG(0.4, tSame + 2), orbitG(0.8, tSame + 5), orbitG(1, tFold)]],
    [tFold - 0.2, [
      { t: tFold - 0.2, pos: [AT.fold + 1.5, 2.4, 9.5], look: [AT.fold, 2.3, 0], fov: 40 },
      { t: tFold + 2.4, pos: [AT.fold + 0.6, 2.3, 7.2], look: [AT.fold, 2.3, 0], fov: 40 },
      { t: tOutbreak, pos: [AT.fold - 1.6, 2.6, 8.2], look: [AT.fold - 1, 2.4, 0], fov: 42 },
    ]],
    [tOutbreak - 0.2, [
      { t: tOutbreak - 0.2, pos: [AT.street - 10, 1.2, 6.5], look: [AT.street - 4, 0.9, 0.5], fov: 44 },
      { t: tTwenty, pos: [AT.street + 3, 1.3, 6.0], look: [AT.street + 8, 0.9, 0.5], fov: 44 },
    ]],
    [tTwenty - 0.2, [
      { t: tTwenty - 0.2, pos: [AT.ds + 0.4, 2.6, 6.2], look: [AT.ds, 2.0, 0], fov: 38 },
      { t: tAlola, pos: [AT.ds, 2.0, 5.4], look: [AT.ds, 1.6, 0], fov: 38 },
    ]],
    [tAlola - 0.2, [
      { t: tAlola - 0.2, pos: [AT.alola, 7, 18], look: [AT.alola, 0, 6], fov: 46 },
      { t: tAlola + 1.2, pos: [AT.alola, 0.6, 10], look: [AT.alola, -3, 2], fov: 50 },
      { t: tAlola + 2.4, pos: [AT.alola, -3.4, 6], look: [AT.alola, -2.5, -2], fov: 52 },
      { t: tAlola + 4.0, pos: [AT.alola, -0.6, 2], look: [AT.alola, 2, -12], fov: 52 },
      { t: tAlola + 5.4, pos: [AT.alola, 2.2, 0], look: [AT.alola, 8, -40], fov: 54 },
      { t: end, pos: [AT.alola, 2.6, -2], look: [AT.alola, 10, -50], fov: 56 },
    ]],
  ]);
  const starts = [0, tFold - 0.2, tOutbreak - 0.2, tTwenty - 0.2, tAlola - 0.2];
  const SKIES: [string, string, string][] = [
    ["#01030a", "#05102a", "#000000"],
    ["#02040c", "#0a1830", "#000000"],
    ["#1a2a6a", "#ff8a5a", "#100810"],
    ["#0a0a12", "#14141e", "#050508"],
    ["#3a6ac0", "#ffc08a", "#1a3a5a"],
  ];
  const fog = scene.fog as THREE.FogExp2;

  return {
    scene,
    portalScale: 1.5,
    camera,
    orbit: (t) => ({ target: camera(t).look, limits: { yaw0: 0, yawSpan: 1.0, minPitch: -0.2, maxPitch: 1.2, minDist: 1, maxDist: 40 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const st = stageAt(starts, t);
      sky.follow(cam);
      const [top, hor, bot] = SKIES[st];
      sky.u.uTop.value.copy(col(top)); sky.u.uHorizon.value.copy(col(hor)); sky.u.uBottom.value.copy(col(bot));
      stars.points.visible = st <= 1;
      L.key.intensity = [0.4, 0.5, 0.9, 0.6, 1.5][st];
      L.hemi.intensity = [0.2, 0.25, 0.85, 0.35, 0.8][st];
      posts.visible = pools.visible = st === 2;

      // A. Every time zone at the same instant.
      globe.group.rotation.y = -0.6 + t * 0.03;
      globe.u.uTime.value = ambient; globe.u.uPixel.value = px;
      const all = ramp(t, tSame + 0.9, tSame + 1.25);
      globe.u.uAll.value = all;
      globe.group.visible = st === 0;
      const wr = ramp(t, tSame + 1.2, tSame + 2.4);
      wrap.visible = st === 0 && wr > 0;
      wrap.rotation.set(Math.PI / 2 - 0.35, 0, 0.2);
      wrap.scale.setScalar(0.6 + 0.4 * wr);
      (wrap.material as THREE.MeshBasicMaterial).opacity = wr * (1 - 0.5 * ramp(t, tSame + 4, tFold));
      wrapGlow.set("#9ad8ff", st === 0 ? 0.25 * wr + 0.6 * spike(t, tSame + 1.0, 0.06, 0.9) : 0);

      // B. The sheet opens out of its folds; Xerneas gains its depth; seams of light.
      const open = ramp(t, tFold + 0.6, tFold + 3.0);
      const e = open * open * (3 - 2 * open);
      strips.forEach((g, i) => { g.rotation.y = i === 0 ? 0 : (i % 2 ? 1 : -1) * (1 - e) * 2.6; });
      sheet.rotation.y = (1 - e) * 0.4;
      sheet.position.x = AT.fold - (STRIPS * SW) / 2 + (1 - e) * 1.4;
      sheetU.uOpacity.value = st === 1 && xMap ? 1 - ramp(t, tFold + 2.2, tFold + 3.4) : 0;
      seamMat.opacity = st === 1 ? Math.sin(Math.PI * Math.min(1, ramp(t, tFold + 0.4, tFold + 3.8))) : 0;
      sheet.visible = st === 1 && t < tFold + 4;
      if (xerneas && xFig) {
        xerneas.set(st === 1 ? ramp(t, tFold + 1.2, tFold + 2.8) : 0, ambient, viewH, cam, 0.03, 0.1);
        xFig.group.scale.z = xScale * (0.02 + 0.98 * ramp(t, tFold + 1.6, tFold + 3.6));
        xFig.group.visible = st === 1;
      }
      if (yveltal) { yveltal.set(st === 1 ? ramp(t, tFold + 4, tFold + 5.4) : 0, ambient, viewH, cam, 0.05, 0.05); yveltal.fig.group.visible = st === 1; }
      foldGlow.set("#9ad8ff", st === 1 ? 0.12 + 0.3 * Math.sin(Math.PI * open) : 0);
      foldSpark.u.uTime.value = ambient; foldSpark.u.uPixel.value = px; foldSpark.u.uOpacity.value = st === 1 ? Math.sin(Math.PI * open) : 0;

      // C. The parade: rows of Pikachu bobbing in step, marching along the quay.
      const march = (t - tOutbreak) * 1.1;
      parade.forEach((g, i) => {
        const row = Math.floor(i / 3), lane = i % 3;
        const x = AT.street - 16 + row * 1.6 + march;
        const hop = Math.abs(Math.sin(ambient * 5.2)) * 0.18;
        g.position.set(x, hop, 0.2 + lane * 1.2);
        g.rotation.set(0, Math.PI / 2 + Math.sin(ambient * 5.2) * 0.12, Math.sin(ambient * 2.6) * 0.06);
        g.visible = st === 2;
      });
      if (pika) { pika.u.uTime.value = ambient; }
      confetti.u.uTime.value = ambient; confetti.u.uPixel.value = px;
      confetti.u.uCenter.value.set(AT.street - 4 + march * 0.8, 5, 1);
      confetti.u.uOpacity.value = st === 2 ? ramp(t, tOutbreak + 0.6, tOutbreak + 1.4) : 0;
      towers.u.uTime.value = ambient;
      towers.mesh.visible = st === 2;

      // D. The handheld and its title screen.
      ds.group.rotation.set(-0.15, Math.sin(ambient * 0.5) * 0.12, 0);
      ds.group.visible = dsTable.visible = st === 3;
      dsLight.intensity = st === 3 ? 30 : 0;
      dsGlow.set("#9bbc0f", st === 3 ? 0.25 + 0.4 * spike(t, tTwenty + 0.4, 0.1, 1.2) : 0);

      // E. Under the water and up onto the beach.
      const under = st === 4 && t > tAlola + 1.5 && t < tAlola + 3.7 ? 1 : 0;
      bubble.position.copy(cam.position);
      bubble.visible = under > 0;
      fog.color.copy(under ? col("#0a4a6a") : st === 4 ? col("#ffd8b0") : st === 2 ? col("#3a2a44") : col("#000000"));
      fog.density = under ? 0.09 : st === 4 ? 0.006 : st === 2 ? 0.01 : 0;
      water.visible = beach.mesh.visible = palms.visible = st === 4;
      shafts.forEach((s) => { s.u.uOpacity.value = under; s.u.uTime.value = ambient; s.mesh.visible = st === 4; });
      bubbles.u.uTime.value = ambient; bubbles.u.uPixel.value = px; bubbles.u.uOpacity.value = under;
      causU.uTime.value = ambient; causU.uK.value = under * 0.38;
      caus.visible = under > 0;
      const skyK = st === 4 ? ramp(t, tAlola + 3.6, tAlola + 5.6) : 0;
      sunGlow.set("#ffb05a", 0.6 * skyK); moonGlow.set("#b8a0ff", 0.55 * skyK);
      if (solgaleo) { solgaleo.set(skyK, ambient, viewH, cam, 0.2, 0.25); solgaleo.fig.group.visible = st === 4; }
      if (lunala) { lunala.set(skyK, ambient, viewH, cam, 0.2, 0.25); lunala.fig.group.visible = st === 4; }
    },
    look: (t) =>
      lookAt(t, { ...STOCK.modern }, {
        exposure: [[0, 0.95], [tSame + 1, 1.05], [tFold, 0.95], [tOutbreak, 1.0], [tAlola, 1.0], [end, 1.05]],
        bloom: [[0, 0.8], [tSame + 1.1, 1.1], [tSame + 3, 0.85], [tFold + 1, 1.0], [tOutbreak, 0.85], [tAlola + 4, 0.95], [end, 1.0]],
        bloomThreshold: [[0, 0.78], [end, 0.78]],
        flash: [[tSame + 0.9, 0], [tSame + 1.0, 0.25], [tSame + 1.5, 0], [tAlola + 3.9, 0], [tAlola + 4.1, 0.3], [tAlola + 4.6, 0]],
        fade: [[0, 0.5], [1.0, 0]],
      }),
    dispose() { D.dispose(); },
  };
};
