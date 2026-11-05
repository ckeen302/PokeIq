import * as THREE from "three";
import type { Key, Vec3 } from "@/lib/world-history/camera";
import { NOISE, col, makeGlow, makeParticles, makeRing, makeSky, merge, ramp, rng } from "@/components/world-history/scene/kit";
import { makeCanvasPanel } from "@/components/world-history/scene/props";
import { lights, loadFigures, lookAt, pointPixel, spike } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { drawCritter, makeFirefly, makeGrass } from "../story-kit";
import { bag, heroFigure, shots, STOCK, type Hero } from "./base";

/**
 * IX. Outside, the film's emotional peak. A flat map grid with tiny pixel
 * creatures blinking on it, a playful prototype. The map tilts up into a
 * glowing wireframe city at dusk. Then, from above, rivers of player-lights
 * flow down every street into the parks (slow motion), phones glowing. At
 * street level, Magikarp shimmers up by a fountain, Pidgey on a rooftop,
 * Eevee in the park grass, each in a spawn ring. A park full of lights
 * seen from above becomes one huge ball. And the single firefly from
 * Chapter I drifts through the city lights and lands on Pikachu's ear.
 */

const N = 9, BLOCK = 8, STREET = 2.4, CELL = BLOCK + STREET;
const HALF = (N * CELL) / 2;
/** Block centres; two of them are parks, one a plaza with a fountain. */
const blockAt = (i: number, j: number): Vec3 => [-HALF + CELL * (i + 0.5), 0, -HALF + CELL * (j + 0.5)];
const PARK_A = [3, 5], PARK_B = [6, 2], PLAZA = [4, 3];
const isPark = (i: number, j: number) => (i === PARK_A[0] && j === PARK_A[1]) || (i === PARK_B[0] && j === PARK_B[1]);

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tApril = B("april"), tLaunch = B("launch"), tParks = B("parks"), tWild = B("wild"), tTogether = B("together"), tOutside = B("outside");
  const P = ctx.q.particles;
  const r = rng(16);

  const sky = D.add(makeSky({ top: "#0a1a2a", horizon: "#ff9a6a", bottom: "#050a10" }));
  scene.add(sky.mesh);
  scene.fog = new THREE.FogExp2(col("#0a1420"), 0.008);
  const L = lights(scene, { sky: "#9ad8ff", ground: "#0a1a14", fill: 0.6, key: "#ffd8b0", keyK: 1.0, keyPos: [-20, 18, 10] });

  // ---- The map: blocks, streets, two parks, a plaza; drawn once.
  const mapPx = 1024;
  const map = D.add(makeCanvasPanel({
    w: N * CELL, h: N * CELL, px: [mapPx, mapPx], emissive: 1.0,
    draw(g, w, h) {
      const s = w / (N * CELL);
      g.fillStyle = "#1c2a36"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const x = (i * CELL + STREET / 2) * s, y = (j * CELL + STREET / 2) * s, b = BLOCK * s;
        g.fillStyle = isPark(i, j) ? "#2f6a3a" : i === PLAZA[0] && j === PLAZA[1] ? "#4a5a6a" : "#101a22";
        g.fillRect(x, y, b, b);
      }
      g.strokeStyle = "rgba(120,255,190,0.35)"; g.lineWidth = 2;
      for (let k = 0; k <= N; k++) { const p = k * CELL * s; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
      // A river across one corner.
      g.strokeStyle = "#1a4a7a"; g.lineWidth = 26; g.beginPath(); g.moveTo(0, h * 0.86); g.bezierCurveTo(w * 0.3, h * 0.8, w * 0.5, h * 0.98, w, h * 0.9); g.stroke();
    },
  }));
  map.mesh.rotation.x = -Math.PI / 2;
  map.mesh.position.y = 0.01;
  scene.add(map.mesh);
  // The pixel creatures that blink on the prototype map.
  const iconGeo = new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2);
  const icons = Array.from({ length: 16 }, (_, k) => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 32;
    const g = cv.getContext("2d")!;
    drawCritter(g, 2, 2, 28, 300 + k * 17, ["#ffcb05", "#ff5a8a", "#5ad1ff", "#7aff9a"][k % 4]);
    const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, color: col("#ffffff", 1.6) });
    const mesh = new THREE.Mesh(iconGeo, m);
    mesh.position.set(-HALF + r() * N * CELL, 0.2, -HALF + r() * N * CELL);
    scene.add(mesh);
    D.add({ dispose: () => { m.dispose(); tex.dispose(); } });
    return { mesh, m, phase: r() * 6 };
  });
  D.add({ dispose: () => iconGeo.dispose() });

  // ---- The city rising out of it: dark towers with glowing green edges.
  const boxes: THREE.BufferGeometry[] = [];
  const roofs: Vec3[] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (isPark(i, j) || (i === PLAZA[0] && j === PLAZA[1])) continue;
    const [cx, , cz] = blockAt(i, j);
    for (let k = 0; k < 2; k++) {
      const w = 2.6 + r() * 1.2, d = 2.6 + r() * 1.2, h = 3 + r() * r() * 16;
      const x = cx + (k ? 1.8 : -1.8) + (r() - 0.5), z = cz + (r() - 0.5) * 3;
      boxes.push(new THREE.BoxGeometry(w, h, d).translate(x, h / 2, z));
      roofs.push([x, h, z]);
    }
  }
  const cityGeo = merge(boxes);
  boxes.forEach((b) => b.dispose());
  // Facades: dark glass and concrete with a grid of windows, some lit warm, some cool (phone and TV light), lit more as night falls.
  const cityU = { uLit: { value: 0 }, uTime: { value: 0 }, uSky: { value: col("#2a6a6a") } };
  const cityMat = new THREE.ShaderMaterial({
    uniforms: cityU,
    vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vN; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uLit, uTime; uniform vec3 uSky; varying vec3 vW; varying vec3 vN;
      void main(){
        float top = step(0.5, abs(vN.y));
        vec2 f = abs(vN.x) > 0.5 ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y);
        vec2 g = f * vec2(1.6, 1.25);
        vec2 cell = floor(g), q = fract(g);
        float win = step(0.2, q.x) * step(q.x, 0.8) * step(0.22, q.y) * step(q.y, 0.78);
        float h = whHash(vec3(cell, floor(vW.x * 0.3) * 7.0 + floor(vW.z * 0.3)));
        float on = step(0.72, h) * win * (1.0 - top);
        vec3 warm = vec3(1.0, 0.72, 0.4), cool = vec3(0.55, 0.85, 1.0);
        vec3 lit = mix(warm, cool, step(0.92, h)) * (0.32 + 0.22 * whNoise(vec3(cell * 0.7, uTime * 0.15)));
        float shade = top > 0.5 ? 0.9 : (abs(vN.x) > 0.5 ? 0.55 : 0.75);
        vec3 base = vec3(0.035, 0.05, 0.065) * shade + uSky * 0.05 * (1.0 - top) * clamp(vW.y * 0.05, 0.0, 1.0);
        vec3 c = base + lit * on * uLit + vec3(0.02, 0.03, 0.035) * win * (1.0 - top);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const cityMesh = new THREE.Mesh(cityGeo, cityMat);
  const edgeGeo = new THREE.EdgesGeometry(cityGeo, 20);
  const edgeMat = new THREE.LineBasicMaterial({ color: col("#4aff9a", 1.1), transparent: true, opacity: 0, toneMapped: false });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  const city = new THREE.Group();
  city.add(cityMesh, edges);
  scene.add(city);
  D.add({ dispose: () => { cityGeo.dispose(); cityMat.dispose(); edgeGeo.dispose(); edgeMat.dispose(); } });
  // Lit windows: points on the faces of the towers.
  const winPos: number[] = [];
  for (const [x, h, z] of roofs) for (let k = 0; k < Math.round(h * 2.2); k++) { const a = r() * Math.PI * 2; winPos.push(x + Math.cos(a) * 1.5, 0.6 + r() * (h - 0.8), z + Math.sin(a) * 1.5); }
  const winGeo = new THREE.BufferGeometry();
  winGeo.setAttribute("position", new THREE.Float32BufferAttribute(winPos, 3));
  const winMat = new THREE.PointsMaterial({ color: col("#ffd890", 1.4), size: 0.22, transparent: true, opacity: 0, depthWrite: false });
  const windows = new THREE.Points(winGeo, winMat);
  city.add(windows);
  D.add({ dispose: () => { winGeo.dispose(); winMat.dispose(); } });

  // ---- The parks: grass, a fountain in the plaza.
  const [ax, , az] = blockAt(PARK_A[0], PARK_A[1]);
  const [bx, , bz] = blockAt(PARK_B[0], PARK_B[1]);
  const [fx, , fz] = blockAt(PLAZA[0], PLAZA[1]);
  const grassA = D.add(makeGrass({ count: Math.round(5000 * P) + 800, center: [ax, 0, az], size: [BLOCK, BLOCK], height: [0.25, 0.6], base: "#1a3a22", tip: "#6aba5a", seed: 3 }));
  scene.add(grassA.mesh);
  const basinMat = new THREE.MeshStandardMaterial({ color: col("#8a9aa8"), roughness: 0.5 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.6, 32), basinMat);
  basin.position.set(fx, 0.3, fz);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.0, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#3a8ac0"), roughness: 0.6, metalness: 0, emissive: col("#2a8ac8"), emissiveIntensity: 0.9 }));
  pool.position.set(fx, 0.55, fz);
  scene.add(basin, pool);
  const lampAt: Vec3[] = [[fx - 3.6, 0, fz - 3.6], [fx + 3.6, 0, fz - 3.6], [fx - 3.6, 0, fz + 3.6]];
  const lampMat = new THREE.MeshStandardMaterial({ color: col("#1a1e24"), roughness: 0.5, metalness: 0.5 });
  const lampPosts = new THREE.Mesh(merge(lampAt.map((p) => new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6).translate(p[0], 1.7, p[2]))), lampMat);
  scene.add(lampPosts);
  const lampGlows = lampAt.map((p) => { const g2 = D.add(makeGlow({ pos: [p[0], 3.45, p[2]], size: 1.3, color: "#ffd8a0", intensity: 0 })); scene.add(g2.sprite); return g2; });
  const plazaLight = new THREE.PointLight(col("#ffd8a0"), 0, 16, 1.4);
  plazaLight.position.set(fx, 3.2, fz + 1);
  scene.add(plazaLight);
  const fountainGlow = D.add(makeGlow({ pos: [fx, 0.9, fz], size: 4.5, color: "#7ac8ff", intensity: 0 }));
  scene.add(fountainGlow.sprite);
  D.add({ dispose: () => { lampPosts.geometry.dispose(); lampMat.dispose(); } });
  D.add({ dispose: () => { basin.geometry.dispose(); basinMat.dispose(); pool.geometry.dispose(); (pool.material as THREE.Material).dispose(); } });
  const spray = D.add(makeParticles({ count: Math.round(300 * P) + 40, shape: "disc", center: [fx, 0.8, fz], extent: [0.3, 0.1, 0.3], velocity: [0, 2.6, 0], spread: [0.5, 0.3, 0.5], gravity: [0, -4, 0], life: 1.3, size: [0.03, 0.06], colors: ["#ffffff", "#bfe8ff", "#7ac8ff"], intensity: 1.6 }));
  scene.add(spray.points);

  // ---- Rivers of player-lights: each walks the streets (along x, then z) into a park.
  const nFlow = Math.round(6500 * P) + 800;
  const fStart = new Float32Array(nFlow * 3), fEnd = new Float32Array(nFlow * 3), fSeed = new Float32Array(nFlow);
  for (let k = 0; k < nFlow; k++) {
    const toA = r() < 0.5;
    const [px, , pz] = toA ? [ax, 0, az] : [bx, 0, bz];
    // Start on a street line (between blocks).
    const sx = -HALF + CELL * Math.floor(r() * (N + 1)) + (r() - 0.5) * STREET * 0.6;
    const sz = -HALF + r() * N * CELL;
    fStart.set([sx, 0.35, sz], k * 3);
    fEnd.set([px + (r() - 0.5) * BLOCK * 0.9, 0.35, pz + (r() - 0.5) * BLOCK * 0.9], k * 3);
    fSeed[k] = r();
  }
  const flowGeo = new THREE.BufferGeometry();
  flowGeo.setAttribute("position", new THREE.BufferAttribute(fStart, 3));
  flowGeo.setAttribute("aEnd", new THREE.BufferAttribute(fEnd, 3));
  flowGeo.setAttribute("aSeed", new THREE.BufferAttribute(fSeed, 1));
  const flowU = { uK: { value: 0 }, uShow: { value: 0 }, uTime: { value: 0 }, uPixel: { value: 600 }, uSize: { value: 0.5 } };
  const flowMat = new THREE.ShaderMaterial({
    uniforms: flowU,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aEnd; attribute float aSeed; uniform float uK, uTime, uPixel, uSize, uShow; varying float vA; varying float vS;
      void main(){
        float k = clamp(uK * 1.35 - aSeed * 0.35, 0.0, 1.0);
        // Along the street first (z), then across into the park (x).
        float a = clamp(k * 2.0, 0.0, 1.0), b = clamp(k * 2.0 - 1.0, 0.0, 1.0);
        vec3 p = vec3(position.x, position.y, mix(position.z, aEnd.z, a));
        p.x = mix(p.x, aEnd.x, b);
        p.y += abs(sin(uTime * 6.0 + aSeed * 40.0)) * 0.05;
        vS = aSeed;
        vA = uShow * (0.55 + 0.45 * sin(uTime * 3.0 + aSeed * 30.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * uPixel / -mv.z, 2.0, 16.0);
      }`,
    fragmentShader: /* glsl */ `varying float vA; varying float vS; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a * vA; vec3 c = (vS < 0.55 ? vec3(0.55, 1.0, 0.8) : vS < 0.85 ? vec3(0.8, 0.95, 1.0) : vec3(1.0, 0.85, 0.55)) * 2.6; gl_FragColor = vec4(c * a, a); }`,
  });
  const flow = new THREE.Points(flowGeo, flowMat);
  flow.frustumCulled = false;
  scene.add(flow);
  D.add({ dispose: () => { flowGeo.dispose(); flowMat.dispose(); } });

  // ---- The crowd in the park that, from above, is one ball.
  const nBall = Math.round(2400 * P) + 500;
  const RB = BLOCK * 0.48;
  const bStart = new Float32Array(nBall * 3), bEnd = new Float32Array(nBall * 3), bCol = new Float32Array(nBall * 3);
  for (let k = 0; k < nBall; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * RB;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    bEnd.set([bx + x, 0.4, bz + z], k * 3);
    const sa = r() * Math.PI * 2, sd = RB + 2 + r() * 14;
    bStart.set([bx + Math.cos(sa) * sd, 0.4, bz + Math.sin(sa) * sd], k * 3);
    // The ball's pattern seen from above (north half red, south half white, a dark band, a button).
    const rr = Math.hypot(x, z);
    const c = rr < RB * 0.16 ? [1, 1, 1] : rr < RB * 0.26 || Math.abs(z) < RB * 0.07 ? [0.05, 0.06, 0.08] : z < 0 ? [1.0, 0.08, 0.06] : [1, 1, 1];
    bCol.set(c, k * 3);
  }
  const ballGeo = new THREE.BufferGeometry();
  ballGeo.setAttribute("position", new THREE.BufferAttribute(bStart, 3));
  ballGeo.setAttribute("aEnd", new THREE.BufferAttribute(bEnd, 3));
  ballGeo.setAttribute("aCol", new THREE.BufferAttribute(bCol, 3));
  const ballU = { uK: { value: 0 }, uShow: { value: 0 }, uTime: { value: 0 }, uPixel: { value: 600 }, uSize: { value: 0.3 } };
  const ballMat = new THREE.ShaderMaterial({
    uniforms: ballU,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aEnd; attribute vec3 aCol; uniform float uK, uTime, uPixel, uSize, uShow; varying vec3 vC; varying float vA;
      void main(){
        float h = fract(sin(dot(aEnd.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float k = clamp(uK * 1.3 - h * 0.3, 0.0, 1.0);
        float e = k * k * (3.0 - 2.0 * k);
        vec3 p = mix(position, aEnd, e);
        vC = mix(vec3(0.6, 1.0, 0.85), aCol, e);
        vA = uShow * (0.7 + 0.3 * sin(uTime * 2.5 + h * 40.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * uPixel / -mv.z, 1.5, 12.0);
      }`,
    fragmentShader: /* glsl */ `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA; gl_FragColor = vec4(vC * 0.9 * a, a); }`,
  });
  const ball = new THREE.Points(ballGeo, ballMat);
  ball.frustumCulled = false;
  scene.add(ball);
  D.add({ dispose: () => { ballGeo.dispose(); ballMat.dispose(); } });

  // ---- The spawns, and Pikachu with the firefly.
  const figs = await loadFigures(ctx, [129, 16, 133, 25]);
  // Pidgey's rooftop: the tallest tower close to the plaza, so the camera can look across at it over the others.
  // Pidgey's rooftop: the tallest tower near the plaza, so a camera just above it sees over every other roof.
  const near = roofs.filter((p) => Math.hypot(p[0] - fx, p[2] - fz) < 16);
  const roof = (near.length ? near : roofs).reduce((best, p) => (p[1] > best[1] ? p : best));
  const SP: { dex: number; pos: Vec3; h: number; accent: string; at: number }[] = [
    { dex: 129, pos: [fx + 0.4, 0.62, fz + 0.2], h: 1.1, accent: "#ff9a5a", at: 0.4 },
    { dex: 16, pos: [roof[0], roof[1], roof[2]], h: 1.0, accent: "#ffd8a0", at: 2.1 },
    { dex: 133, pos: [ax + 1.2, 0, az + 2.6], h: 0.95, accent: "#ffd8a0", at: 3.4 },
  ];
  const spawns = SP.map((s) => {
    const h = heroFigure(figs.get(s.dex), { pos: s.pos, height: s.h, accent: s.accent, scene, rotY: 0.3 });
    if (h) D.add(h);
    const ring = D.add(makeRing({ color: "#7affc0", intensity: 2, thickness: 0.08 }));
    ring.mesh.rotation.x = -Math.PI / 2;
    ring.mesh.position.set(s.pos[0], s.pos[1] + 0.04, s.pos[2]);
    scene.add(ring.mesh);
    return { ...s, hero: h, ring };
  });
  const PK: Vec3 = [ax - 1.4, 0, az + 1.4];
  const pika = heroFigure(figs.get(25), { pos: PK, height: 0.95, accent: "#ffcb05", scene, rotY: 0.5 });
  if (pika) D.add(pika);
  const fly = D.add(makeFirefly({ size: 0.16 }));
  scene.add(fly.group);
  const warm = D.add(makeGlow({ pos: [PK[0], 1, PK[2]], size: 3, color: "#ffd890", intensity: 0 }));
  scene.add(warm.sprite);

  const keys: Key[] = [
    { t: 0, pos: [0.1, 78, 6], look: [0, 0, 0], fov: 44 },
    { t: tApril + 4, pos: [0.1, 66, 10], look: [0, 0, 0], fov: 44 },
    { t: tLaunch + 0.6, pos: [0, 58, 16], look: [0, 0, 0], fov: 46 },
    { t: tLaunch + 4.4, pos: [-6, 24, 46], look: [0, 4, 0], fov: 48 },
    { t: tParks, pos: [-2, 44, 40], look: [2, 0, -2], fov: 48 },
    { t: tParks + 5, pos: [8, 56, 26], look: [4, 0, -4], fov: 48 },
    { t: tWild - 0.4, pos: [fx + 9, 3.2, fz + 10], look: [fx, 1, fz], fov: 46 },
    { t: tWild + 1.2, pos: [fx + 4, 1.6, fz + 5.2], look: [fx, 0.9, fz], fov: 44 },
  ];
  // Three quick shots for the spawns (cuts, so the camera never flies through a tower): fountain, rooftop, park.
  const roofShot: Key[] = [
    { t: tWild + 1.9, pos: [roof[0] - 2.9, roof[1] + 1.7, roof[2] + 3.4], look: [roof[0], roof[1] + 0.55, roof[2]], fov: 40 },
    { t: tWild + 3.2, pos: [roof[0] - 2.3, roof[1] + 1.4, roof[2] + 2.8], look: [roof[0], roof[1] + 0.55, roof[2]], fov: 38 },
  ];
  const keys2: Key[] = [
    { t: tWild + 3.2, pos: [ax + 3.2, 1.3, az + 4.7], look: [ax + 1.2, 0.5, az + 2.6], fov: 44 },
    { t: tWild + 4.6, pos: [ax + 2.7, 1.15, az + 4.4], look: [ax + 1.2, 0.5, az + 2.6], fov: 42 },
    // Rise straight up out of the park before the long move to the crowd (keeps the spline from swinging wide).
    { t: tWild + 5.0, pos: [ax + 2.6, 2.2, az + 4.3], look: [ax + 1.2, 0.6, az + 2.6], fov: 42 },
    { t: tTogether - 0.4, pos: [ax + 3, 14, az + 2], look: [(ax + bx) / 2, 0, (az + bz) / 2], fov: 46 },
    { t: tTogether + 0.4, pos: [bx + 6, 22, bz + 24], look: [bx, 0, bz], fov: 46 },
    { t: tTogether + 3.6, pos: [bx + 0.2, 36, bz + 4], look: [bx, 0, bz], fov: 44 },
    { t: tOutside - 0.4, pos: [bx + 0.1, 44, bz + 2.5], look: [bx, 0, bz], fov: 44 },
    { t: tOutside, pos: [ax + 2, 9, az + 16], look: [ax, 1, az], fov: 46 },
    { t: tOutside + 4, pos: [PK[0] + 2.2, 1.4, PK[2] + 4], look: [PK[0], 0.7, PK[2]], fov: 40 },
    { t: end, pos: [PK[0] + 1.1, 1.0, PK[2] + 2.2], look: [PK[0], 0.75, PK[2]], fov: 36 },
  ];
  const camera = shots([[0, keys], [tWild + 1.9, roofShot], [tWild + 3.2, keys2]]);
  // The firefly's path: from across the city, through the lights, to the tip of an ear.
  const ffPath = new THREE.CatmullRomCurve3([new THREE.Vector3(ax + 14, 5, az - 10), new THREE.Vector3(ax + 7, 3.5, az - 2), new THREE.Vector3(PK[0] + 2.5, 2.2, PK[2] + 1), new THREE.Vector3(PK[0] + 0.8, 1.4, PK[2] + 0.6), new THREE.Vector3(PK[0] + 0.25, 0.98, PK[2] + 0.15)]);
  const ffp = new THREE.Vector3();
  const setHero = (h: Hero | null, k: number, ambient: number, viewH: number, cam: THREE.PerspectiveCamera) => { if (!h) return; h.fig.group.visible = k > 0.001; h.set(k, ambient, viewH, cam, 0.03, 0.08); };

  return {
    scene,
    portalScale: 1.6,
    camera,
    orbit: (t) => ({ target: camera(t).look, limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.05, maxPitch: 1.4, minDist: 1, maxDist: 100 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      sky.follow(cam);
      const dusk = ramp(t, tLaunch, tParks);
      sky.u.uTop.value.copy(col("#1a3a5a").lerp(col("#040a14"), dusk));
      sky.u.uHorizon.value.copy(col("#ffb08a").lerp(col("#2a6a6a"), dusk));
      L.key.intensity = 1.0 * (1 - dusk * 0.7);
      // The prototype map: icons blink; then the city rises out of it.
      const proto = 1 - ramp(t, tLaunch + 0.4, tLaunch + 2);
      icons.forEach((ic) => { ic.mesh.visible = proto > 0.01; ic.m.opacity = proto * (Math.sin(ambient * 4 + ic.phase) > -0.2 ? 1 : 0.15); });
      (map.mat as THREE.MeshBasicMaterial).color.setScalar(0.9 - 0.45 * dusk);
      const rise = ramp(t, tLaunch + 0.6, tLaunch + 4.0);
      const e = rise * rise * (3 - 2 * rise);
      city.scale.y = Math.max(0.001, e);
      city.visible = rise > 0;
      edgeMat.opacity = Math.min(1, rise * 2) * (0.75 - 0.4 * ramp(t, tParks, tParks + 3));
      cityU.uLit.value = ramp(t, tLaunch + 2.5, tParks + 1);
      cityU.uTime.value = ambient;
      winMat.opacity = ramp(t, tLaunch + 3, tParks) * 0.35;
      spray.u.uTime.value = ambient; spray.u.uPixel.value = px; spray.u.uOpacity.value = rise;
      const street = ramp(t, tParks + 2, tWild - 0.5) * (1 - ramp(t, tTogether, tTogether + 1));
      lampGlows.forEach((g2) => g2.set("#ffd8a0", 1.1 * street));
      plazaLight.intensity = 14 * street;
      fountainGlow.set("#7ac8ff", 0.35 * street);
      // The rivers of light.
      flowU.uK.value = ramp(t, tParks + 0.4, tWild - 0.6);
      flowU.uShow.value = ramp(t, tParks - 0.4, tParks + 0.8) * (1 - ramp(t, tTogether - 1, tTogether));
      flowU.uTime.value = ambient; flowU.uPixel.value = px;
      // The spawns.
      spawns.forEach((s) => {
        const k = ramp(t, tWild + s.at, tWild + s.at + 0.8);
        setHero(s.hero, k * (1 - ramp(t, tTogether, tTogether + 0.6)), ambient, viewH, cam);
        s.ring.u.uK.value = ramp(t, tWild + s.at - 0.1, tWild + s.at + 1.0);
        s.ring.u.uOpacity.value = t > tWild + s.at - 0.1 && t < tWild + s.at + 1.0 ? 1 - ramp(t, tWild + s.at + 0.5, tWild + s.at + 1.0) : 0;
        s.ring.u.uTime.value = ambient;
        s.ring.mesh.scale.setScalar(1.4);
      });
      // The ball of lights.
      ballU.uK.value = ramp(t, tTogether + 0.4, tTogether + 4.0);
      ballU.uShow.value = ramp(t, tTogether - 0.6, tTogether + 0.6) * (1 - ramp(t, tOutside + 0.5, tOutside + 2));
      ballU.uTime.value = ambient; ballU.uPixel.value = px;
      // Pikachu, and the firefly landing on its ear.
      setHero(pika, ramp(t, tOutside - 0.5, tOutside + 1), ambient, viewH, cam);
      if (pika) pika.fig.group.position.y = PK[1];
      const fk = ramp(t, tOutside + 0.6, tOutside + 6.2);
      const ek = 1 - (1 - fk) * (1 - fk);
      ffPath.getPointAt(Math.min(1, ek), ffp);
      if (fk < 1) { ffp.x += Math.sin(ambient * 1.9) * 0.15 * (1 - fk); ffp.y += Math.sin(ambient * 2.3) * 0.12 * (1 - fk); }
      fly.set([ffp.x, ffp.y, ffp.z], t > tOutside + 0.4 ? 1 : 0, ambient);
      warm.sprite.position.set(ffp.x, ffp.y, ffp.z);
      warm.set("#ffd890", 0.5 * spike(t, tOutside + 6.1, 0.15, 1.6) + 0.15 * ramp(t, tOutside + 5, tOutside + 6.2));
      grassA.u.uTime.value = ambient;
    },
    look: (t) =>
      lookAt(t, { ...STOCK.modern, saturation: 1.15 }, {
        exposure: [[0, 1.0], [tLaunch + 3, 0.95], [tParks, 1.0], [tWild, 1.05], [tOutside, 0.95], [end, 1.0]],
        bloom: [[0, 0.85], [tLaunch + 2, 1.0], [tParks + 1, 1.25], [tWild, 0.95], [tTogether + 3, 0.95], [tOutside + 2, 1.0], [end, 1.1]],
        bloomThreshold: [[0, 0.75], [end, 0.75]],
        gain: [[0, [1, 1, 1]], [tParks, [0.92, 1.04, 1.04]], [tOutside + 3, [0.95, 1.02, 1.02]], [end, [1.1, 1.0, 0.86]]],
        fade: [[0, 0.5], [1.0, 0]],
      }),
    dispose() { D.dispose(); },
  };
};
