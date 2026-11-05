import * as THREE from "three";
import { poseOnPath, type Key } from "@/lib/world-history/camera";
import { col, makeGlow, makeParticles, makeShaft, merge, placed, ramp, rng } from "@/components/world-history/scene/kit";
import { makeCanvasPanel } from "@/components/world-history/scene/props";
import { lights, loadFigures, lookAt, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { drawCritter, makeDeskLamp, makeSilhouette } from "../story-kit";
import type { Vec3 } from "@/lib/world-history/camera";
import { bag, heroFigure, STOCK } from "./base";

/**
 * IV. Six Years. A small studio late at night: one desk lamp, a calendar
 * flipping from 1990 to 1995 while the windows cycle night and day. Notes
 * rise from a keyboard and a waveform plays (Masuda). On a monitor, dots
 * are punched in one by one, as Atsuko Nishida made Pikachu straight on the
 * screen, and Pikachu rises out of it in gold. Then the pages burst into
 * motes that form a wall of 151 small glowing shapes (slow motion); the
 * wall dims, and off to one side a pink glow: Mew.
 */

/**
 * The wall of 151: dark glass tiles, each with one small creature drawn in
 * warm light and a thin lit edge. The tiles fly up out of the burst of pages
 * and land in a sweep from the top left, each flaring once as it lands, so
 * the forming is the moment; filled, every icon still reads (no bloom blob).
 */
function makeDexWall(o: { count: number; cols: number; cell: number; center: Vec3; from: Vec3; spread: Vec3; seed: number }) {
  const atlas = document.createElement("canvas");
  atlas.width = atlas.height = 512;
  const g = atlas.getContext("2d")!;
  for (let i = 0; i < 64; i++) drawCritter(g, (i % 8) * 64 + 10, Math.floor(i / 8) * 64 + 10, 44, o.seed * 97 + i * 13, "#ffffff");
  const tex = new THREE.CanvasTexture(atlas);
  tex.magFilter = THREE.NearestFilter;
  const base = new THREE.PlaneGeometry(o.cell * 0.9, o.cell * 0.9);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  const rows = Math.ceil(o.count / o.cols);
  const off = new Float32Array(o.count * 4), from = new Float32Array(o.count * 4);
  const r = rng(o.seed);
  for (let i = 0; i < o.count; i++) {
    const cx = i % o.cols, cy = Math.floor(i / o.cols);
    const order = 0.8 * ((cx / (o.cols - 1)) * 0.55 + (cy / Math.max(1, rows - 1)) * 0.45) + 0.2 * r();
    off.set([(cx - (o.cols - 1) / 2) * o.cell, ((rows - 1) / 2 - cy) * o.cell, i % 64, order * 0.86], i * 4);
    from.set([o.from[0] + (r() - 0.5) * o.spread[0], o.from[1] + (r() - 0.5) * o.spread[1], o.from[2] + (r() - 0.5) * o.spread[2], r()], i * 4);
  }
  geo.setAttribute("aOff", new THREE.InstancedBufferAttribute(off, 4));
  geo.setAttribute("aFrom", new THREE.InstancedBufferAttribute(from, 4));
  geo.instanceCount = o.count;
  const u = { uFill: { value: 0 }, uTime: { value: 0 }, uTex: { value: tex }, uDim: { value: 1 }, uScale: { value: 1 }, uCenter: { value: new THREE.Vector3(...o.center) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 aOff; attribute vec4 aFrom; uniform float uFill, uTime, uScale; uniform vec3 uCenter;
      varying vec2 vUv; varying vec2 vQ; varying float vOn; varying float vFlash; varying float vSeed;
      void main(){
        float k = clamp((uFill - aOff.w) / 0.14, 0.0, 1.0);
        float e = k * k * (3.0 - 2.0 * k);
        vec3 target = uCenter + vec3(aOff.xy * uScale, 0.0);
        vec3 c = mix(aFrom.xyz, target, e);
        c.y += sin(e * 3.14159) * (0.5 + aFrom.w * 0.6);
        c.y += sin(uTime * 1.1 + aFrom.w * 30.0) * 0.012 * e;
        float spin = (1.0 - e) * (2.5 + aFrom.w * 3.0);
        vec3 q = position * (0.25 + 0.75 * e) * mix(1.0, uScale, e);
        vec3 p = c + vec3(q.x * cos(spin), q.y, q.x * sin(spin));
        vUv = (vec2(mod(aOff.z, 8.0), 7.0 - floor(aOff.z / 8.0)) + uv) / 8.0;
        vQ = uv;
        vOn = step(0.001, k);
        vFlash = smoothstep(0.75, 1.0, k) * (1.0 - clamp((uFill - aOff.w - 0.14) / 0.12, 0.0, 1.0));
        vSeed = aFrom.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex; uniform float uDim, uTime;
      varying vec2 vUv; varying vec2 vQ; varying float vOn; varying float vFlash; varying float vSeed;
      void main(){
        if (vOn < 0.5) discard;
        vec2 d = abs(vQ - 0.5);
        float edge = smoothstep(0.43, 0.47, max(d.x, d.y));
        float icon = texture2D(uTex, vUv).a;
        vec3 glass = mix(vec3(0.012, 0.016, 0.035), vec3(0.05, 0.045, 0.06), vQ.y);
        vec3 warm = mix(vec3(1.0, 0.78, 0.42), vec3(1.0, 0.9, 0.62), vSeed);
        float breathe = 0.9 + 0.1 * sin(uTime * 1.7 + vSeed * 40.0);
        vec3 c = glass + warm * edge * 0.32 + warm * icon * 0.78 * breathe;
        c = c * uDim + vec3(1.0, 0.9, 0.7) * vFlash * (0.6 * icon + 0.5 * edge + 0.12);
        gl_FragColor = vec4(c, 0.94);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, u, dispose() { geo.dispose(); base.dispose(); mat.dispose(); tex.dispose(); } };
}

/** Moonlight on the floor: each window's shape, mullions and all, laid out where its shaft lands. */
function windowPatchTexture() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(1, "rgba(255,255,255,0.35)");
  g.fillStyle = gr;
  g.fillRect(10, 10, 108, 108);
  g.clearRect(61, 10, 6, 108); g.clearRect(10, 50, 108, 5);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tHard = B("hard"), tMasuda = B("masuda"), tPika = B("pikachu"), t151 = B("151"), tMew = B("mew");
  scene.background = col("#04050a");
  scene.fog = new THREE.FogExp2(col("#070912"), 0.025);
  const L = lights(scene, { sky: "#7a86b0", ground: "#2a2420", fill: 1.05, key: "#aab8e8", keyK: 0.6, keyPos: [-4, 6, 6] });

  // The room: floor, back wall with windows, desks.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#5a5048"), roughness: 0.45, metalness: 0.1 }));
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 10), new THREE.MeshStandardMaterial({ color: col("#a8a4b4"), roughness: 0.9 }));
  wall.position.set(0, 5, -5);
  const sides = new THREE.Mesh(merge([placed(new THREE.PlaneGeometry(14, 10), [-9.5, 5, 2], Math.PI / 2), placed(new THREE.PlaneGeometry(14, 10), [9.5, 5, 2], -Math.PI / 2)]), wall.material as THREE.Material);
  scene.add(floor, wall, sides);
  D.add({ dispose: () => sides.geometry.dispose() });
  // A lived-in back wall: a dark wainscot rail, a pinboard of sketches, shelves of binders, a ceiling.
  const woodMat = new THREE.MeshStandardMaterial({ color: col("#4a3626"), roughness: 0.7 });
  const room = new THREE.Mesh(merge([
    placed(new THREE.BoxGeometry(30, 1.1, 0.06), [0, 0.55, -4.95]), placed(new THREE.BoxGeometry(30, 0.08, 0.1), [0, 1.12, -4.92]),
    placed(new THREE.BoxGeometry(2.6, 0.05, 0.36), [7.6, 2.0, -4.8]), placed(new THREE.BoxGeometry(2.6, 0.05, 0.36), [7.6, 2.7, -4.8]),
    placed(new THREE.BoxGeometry(2.6, 0.05, 0.36), [-8.0, 2.3, -4.8]),
    placed(new THREE.BoxGeometry(3.2, 0.06, 0.06), [-0.2, 5.0, -4.9]), placed(new THREE.BoxGeometry(30, 0.3, 0.3), [0, 6.2, -4.85]),
  ]), woodMat);
  const binderMat = new THREE.MeshStandardMaterial({ color: col("#ffffff"), roughness: 0.6, vertexColors: true });
  const bg: THREE.BufferGeometry[] = [], bc: number[] = [];
  const brr = rng(23);
  for (const [x0, y0, n] of [[6.4, 2.02, 12], [6.4, 2.72, 10], [-9.2, 2.32, 11]] as [number, number, number][]) {
    let x = x0;
    for (let i = 0; i < n; i++) {
      const w = 0.12 + brr() * 0.08, h = 0.42 + brr() * 0.2;
      const geo = placed(new THREE.BoxGeometry(w, h, 0.3), [x + w / 2, y0 + h / 2 + 0.03, -4.8], 0, [1, 1, 1], 0, brr() < 0.15 ? 0.2 : 0);
      bg.push(geo);
      const cc = col(["#8a2a24", "#2a4a7a", "#d8c8a0", "#3a5a3a", "#6a4a2a"][Math.floor(brr() * 5)]);
      for (let k = 0; k < geo.getAttribute("position").count; k++) bc.push(cc.r, cc.g, cc.b);
      x += w + 0.01;
    }
  }
  const binders = new THREE.Mesh(merge(bg), binderMat);
  binders.geometry.setAttribute("color", new THREE.Float32BufferAttribute(bc, 3));
  const board = D.add(makeCanvasPanel({
    w: 2.4, h: 1.5, px: [384, 240], basic: false, emissive: 0.08,
    draw(g, w, h) {
      g.fillStyle = "#8a6a44"; g.fillRect(0, 0, w, h);
      const rr = rng(31);
      for (let i = 0; i < 14; i++) {
        const x = 12 + rr() * (w - 90), y = 10 + rr() * (h - 90), pw = 50 + rr() * 30, ph = 60 + rr() * 20;
        g.save(); g.translate(x + pw / 2, y + ph / 2); g.rotate((rr() - 0.5) * 0.2);
        g.fillStyle = "#efe8d8"; g.fillRect(-pw / 2, -ph / 2, pw, ph);
        g.strokeStyle = "#3a3a4a"; g.lineWidth = 2;
        drawCritter(g, -18, -ph / 2 + 8, 36, 300 + i * 7, "#4a4a5a");
        for (let l = 0; l < 3; l++) { g.beginPath(); g.moveTo(-pw / 2 + 6, ph / 2 - 20 + l * 6); g.lineTo(pw / 2 - 8 - rr() * 10, ph / 2 - 20 + l * 6); g.stroke(); }
        g.fillStyle = "#c83a2a"; g.beginPath(); g.arc(0, -ph / 2 + 3, 3, 0, 7); g.fill();
        g.restore();
      }
    },
  }));
  board.mesh.position.set(-4.6, 4.5, -4.92);
  board.mesh.scale.setScalar(0.85);
  const patchTex = windowPatchTexture();
  const patchMat = new THREE.MeshBasicMaterial({ map: patchTex, color: col("#5a70c0"), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const patches = new THREE.Mesh(merge([-6, -2.6, 2.6, 6].map((x) => placed(new THREE.PlaneGeometry(2.0, 2.3).rotateX(-Math.PI / 2), [x + 0.9, 0.012, -0.3], 0.12))), patchMat);
  scene.add(room, binders, board.mesh, patches);
  D.add({ dispose: () => { room.geometry.dispose(); woodMat.dispose(); binders.geometry.dispose(); binderMat.dispose(); patches.geometry.dispose(); patchMat.dispose(); patchTex.dispose(); } });
  // The wall of 151 lights the room warm as it forms.
  const wallLight = new THREE.PointLight(col("#ffc878"), 0, 16, 1.4);
  wallLight.position.set(0, 3.0, 2.0);
  scene.add(wallLight);
  // The view through the glass: a night skyline with a few lit windows (painted once).
  const view = document.createElement("canvas");
  view.width = 256; view.height = 128;
  {
    const g = view.getContext("2d")!;
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, "#5a78b0"); grd.addColorStop(1, "#c8d4f0");
    g.fillStyle = grd; g.fillRect(0, 0, 256, 128);
    const r = rng(11);
    for (let x = 0; x < 256;) {
      const bw = 10 + r() * 22, bh = 30 + r() * 70;
      g.fillStyle = "#1a1e2c"; g.fillRect(x, 128 - bh, bw, bh);
      g.fillStyle = "#ffd890";
      for (let wy = 128 - bh + 5; wy < 124; wy += 7) for (let wx = x + 3; wx < x + bw - 3; wx += 5) if (r() < 0.22) g.fillRect(wx, wy, 2, 3);
      x += bw + 1;
    }
  }
  const viewTex = new THREE.CanvasTexture(view);
  viewTex.colorSpace = THREE.SRGBColorSpace;
  const winMat = new THREE.MeshBasicMaterial({ color: col("#1a2a50"), map: viewTex });
  D.add({ dispose: () => viewTex.dispose() });
  const wins = [-6, -2.6, 2.6, 6].map((x) => { const w = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.0), winMat); w.position.set(x, 3.4, -4.95); scene.add(w); return w; });
  // Frames and mullions, so they read as windows of a small office at night.
  const frameMat = new THREE.MeshStandardMaterial({ color: col("#2a2c36"), roughness: 0.6 });
  const bars: THREE.BufferGeometry[] = [];
  for (const x of [-6, -2.6, 2.6, 6]) {
    for (const [w, h, dx, dy] of [[2.4, 0.12, 0, 1.05], [2.4, 0.16, 0, -1.05], [0.12, 2.2, -1.14, 0], [0.12, 2.2, 1.14, 0], [0.07, 2.0, 0, 0], [2.2, 0.07, 0, 0.25]] as [number, number, number, number][]) {
      bars.push(new THREE.BoxGeometry(w, h, 0.08).translate(x + dx, 3.4 + dy, -4.9));
    }
  }
  const frames = new THREE.Mesh(merge(bars), frameMat);
  scene.add(frames);
  D.add({ dispose: () => { floor.geometry.dispose(); (floor.material as THREE.Material).dispose(); wall.geometry.dispose(); (wall.material as THREE.Material).dispose(); winMat.dispose(); wins.forEach((w) => w.geometry.dispose()); frames.geometry.dispose(); bars.forEach((b) => b.dispose()); frameMat.dispose(); } });
  const deskMat = new THREE.MeshStandardMaterial({ color: col("#3a2a1c"), roughness: 0.6 });
  const deskGeo = new THREE.BoxGeometry(2.6, 0.08, 1.3);
  const desks = [-4.5, 0, 4.5].map((x) => { const d = new THREE.Mesh(deskGeo, deskMat); d.position.set(x, 0.95, -1.5); scene.add(d); return d; });
  D.add({ dispose: () => { deskGeo.dispose(); deskMat.dispose(); } });
  void desks;
  const people = [-4.5, 0, 4.5].map((x) => { const s = D.add(makeSilhouette({ height: 1.75, pose: "seated", rim: "#9fb0ff" })); s.mesh.position.set(x, 0, -0.6); s.mesh.rotation.y = Math.PI; scene.add(s.mesh); return s; });

  // The calendar on the wall, flipping through the years.
  let year = -1;
  const cal = D.add(makeCanvasPanel({
    w: 1.1, h: 1.4, px: [220, 280], basic: false, emissive: 0.2,
    draw(g, w, h, y) {
      g.fillStyle = "#e8e2d4"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#b8302a"; g.fillRect(0, 0, w, 60);
      g.fillStyle = "#ffffff"; g.font = `700 44px ${ctx.font}`; g.textAlign = "center"; g.fillText(String(y), w / 2, 46);
      g.fillStyle = "#2a2a2a";
      for (let i = 0; i < 30; i++) g.fillRect(18 + (i % 6) * 32, 82 + Math.floor(i / 6) * 36, 22, 22);
    },
  }));
  cal.mesh.position.set(-0.2, 3.6, -4.9);
  scene.add(cal.mesh);

  // A lamp on every desk; one light, moving from desk to desk as the work does.
  const lampAt = [-4.5 + 0.95, 0 + 0.95, 4.5 - 1.0];
  const bulbs = lampAt.map((x, i) => {
    const lp = D.add(makeDeskLamp({ color: ["#2c5a3c", "#5a2c2c", "#2c3a5a"][i] }));
    lp.group.position.set(x, 0.99, -1.95);
    if (i === 2) lp.group.scale.x = -1;
    scene.add(lp.group);
    lp.group.updateMatrixWorld(true);
    return lp.bulb.clone().applyMatrix4(lp.group.matrixWorld);
  });
  const lamp = new THREE.SpotLight(col("#ffd590"), 9, 8, 0.8, 0.55, 1.1);
  lamp.position.copy(bulbs[0]);
  lamp.target.position.set(-4.5, 0.9, -1.4);
  scene.add(lamp, lamp.target);
  const lampGlow = D.add(makeGlow({ pos: [bulbs[0].x, bulbs[0].y, bulbs[0].z], size: 0.42, color: "#ffe2a8", intensity: 1 }));
  scene.add(lampGlow.sprite);
  // The first desk's clutter: a dark CRT and stacks of sketches and printouts.
  const clutterMat = new THREE.MeshStandardMaterial({ color: col("#cfc9bc"), roughness: 0.65 });
  const paperMat = new THREE.MeshStandardMaterial({ color: col("#e4dccb"), roughness: 0.9 });
  const crt = new THREE.Mesh(merge([placed(new THREE.BoxGeometry(1.0, 0.82, 0.7), [-4.95, 1.42, -1.85]), placed(new THREE.BoxGeometry(0.5, 0.06, 0.4), [-4.95, 1.0, -1.85])]), clutterMat);
  const papers = new THREE.Mesh(merge([placed(new THREE.BoxGeometry(0.42, 0.14, 0.58), [-3.85, 1.06, -1.2], 0.2), placed(new THREE.BoxGeometry(0.42, 0.08, 0.58), [-3.4, 1.03, -1.35], -0.3), placed(new THREE.BoxGeometry(0.42, 0.22, 0.58), [5.6, 1.1, -1.3], 0.1)]), paperMat);
  const crtFace = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.6), new THREE.MeshBasicMaterial({ color: col("#24304a") }));
  crtFace.position.set(-4.95, 1.44, -1.49);
  scene.add(crt, papers, crtFace);
  D.add({ dispose: () => { crt.geometry.dispose(); papers.geometry.dispose(); clutterMat.dispose(); paperMat.dispose(); crtFace.geometry.dispose(); (crtFace.material as THREE.Material).dispose(); } });
  // Moonlight (and, as the years pass, daylight) falling through the windows.
  const shafts = [-6, -2.6, 2.6, 6].map((x) => { const sh = D.add(makeShaft({ from: [x, 3.4, -4.85], to: [x + 1.2, 0, 0.6], r0: 1.0, r1: 1.7, color: "#8aa8ff", intensity: 0.085, noise: 0.5 })); scene.add(sh.mesh); return sh; });
  const dust = D.add(makeParticles({ count: Math.round(380 * ctx.q.particles) + 40, shape: "box", center: [0, 2.0, -1], extent: [7, 1.8, 3], velocity: [0.03, 0.01, 0], spread: [0.02, 0.02, 0.02], life: 14, size: [0.01, 0.025], colors: ["#dfe6ff", "#ffe6c0", "#c8d0e8"], intensity: 1.0, turbulence: 0.5, fadeIn: 0.3, fadeOut: 0.3, seed: 61 }));
  scene.add(dust.points);

  // Masuda's desk: a keyboard, notes rising, a waveform on a screen.
  const kb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: col("#9a968e"), roughness: 0.6 }));
  kb.position.set(0, 1.02, -1.2);
  scene.add(kb);
  D.add({ dispose: () => { kb.geometry.dispose(); (kb.material as THREE.Material).dispose(); } });
  const notes = D.add(makeParticles({ count: 160, shape: "box", center: [0, 1.3, -1.2], extent: [0.7, 0.05, 0.2], velocity: [0, 0.6, 0], spread: [0.2, 0.2, 0.1], life: 2.6, size: [0.03, 0.06], colors: ["#bfe0ff", "#ffe6a0", "#ffffff"], intensity: 2.2, turbulence: 0.25 }));
  scene.add(notes.points);
  const wave = D.add(makeCanvasPanel({
    w: 1.0, h: 0.7, px: [200, 140], emissive: 1.4,
    draw(g, w, h, t) {
      g.fillStyle = "#06101a"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#7fe0ff"; g.lineWidth = 3; g.beginPath();
      for (let x = 0; x < w; x += 2) { const y = h / 2 + Math.sin(x * 0.12 + t * 6) * 18 * Math.sin(x * 0.02 + t) + Math.sin(x * 0.5 - t * 9) * 5; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    },
  }));
  wave.mesh.position.set(0, 1.5, -1.95);
  scene.add(wave.mesh);

  // Nishida's monitor: dots punched in one by one.
  let dots = -1;
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.0, 0.6), new THREE.MeshStandardMaterial({ color: col("#cfc9bc"), roughness: 0.6 }));
  monitor.position.set(4.5, 1.5, -1.9);
  scene.add(monitor);
  D.add({ dispose: () => { monitor.geometry.dispose(); (monitor.material as THREE.Material).dispose(); } });
  const pix = D.add(makeCanvasPanel({
    w: 1.0, h: 0.78, px: [160, 124], emissive: 0.85,
    draw(g, w, h, k) {
      g.fillStyle = "#101418"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(255,255,255,0.06)";
      for (let x = 0; x < w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y < h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      // An original little pixel head (pointed ears, round face, cheeks), dot by dot, row by row.
      const ART = [
        "..K..........K..",
        "..YK........KY..",
        "..YYK......KYY..",
        "..YYY......YYY..",
        "...YYYYYYYYYY...",
        "..YYYYYYYYYYYY..",
        ".YYYKYYYYYYKYYY.",
        ".YYKKYYYYYYKKYY.",
        ".RRYYYYKKYYYYRR.",
        ".RRYYYYYYYYYYRR.",
        "..YYYYKKKKYYYY..",
        "...YYYYYYYYYY...",
        "....YYYYYYYY....",
      ];
      const C: Record<string, string> = { Y: "#ffd83a", K: "#2a1a10", R: "#e8503a" };
      const total = ART.join("").replace(/\./g, "").length;
      let n = Math.floor(k * total);
      for (let j = 0; j < ART.length && n > 0; j++) for (let i = 0; i < 16 && n > 0; i++) {
        const ch = ART[j][i];
        if (ch === ".") continue;
        g.fillStyle = C[ch];
        g.fillRect(16 + i * 8, 10 + j * 8, 8, 8);
        n--;
      }
    },
  }));
  pix.mesh.position.set(4.5, 1.5, -1.59);
  scene.add(pix.mesh);

  const figs = await loadFigures(ctx, [25, 151]);
  const pika = heroFigure(figs.get(25), { pos: [4.5, 1.05, -1.1], height: 1.25, accent: "#ffd83a", scene });
  const mew = heroFigure(figs.get(151), { pos: [6.2, 2.3, 1.2], height: 1.1, rotY: -0.5, accent: "#ff9ad0", scene });
  if (pika) D.add(pika);
  if (mew) D.add(mew);
  const pikaGlow = D.add(makeGlow({ pos: [4.5, 1.7, -1.1], size: 3, color: "#ffd060", intensity: 0 }));
  const mewGlow = D.add(makeGlow({ pos: [6.2, 2.8, 1.2], size: 2.2, color: "#ff8ad0", intensity: 0 }));
  scene.add(pikaGlow.sprite, mewGlow.sprite);
  const sparkles = D.add(makeParticles({ count: 200, shape: "sphere", center: [6.2, 2.8, 1.2], extent: [1, 1, 1], velocity: [0, 0.2, 0], spread: [0.3, 0.3, 0.3], life: 2.4, size: [0.02, 0.05], colors: ["#ffffff", "#ffb0e0", "#ff7ac0"], intensity: 2.4, turbulence: 0.4, flicker: 0.5 }));
  scene.add(sparkles.points);

  // The burst of pages into motes, and the wall of 151.
  const burst = D.add(makeParticles({ count: Math.round(1600 * ctx.q.particles) + 200, shape: "box", center: [0, 1.4, -1.5], extent: [5, 0.3, 0.6], velocity: [0, 1.2, 1.4], spread: [1.4, 0.9, 0.8], life: 3.2, size: [0.02, 0.05], colors: ["#ffffff", "#ffe6b0", "#ffd27a"], intensity: 2.4, burst: true, turbulence: 0.6 }));
  scene.add(burst.points);
  const wall151 = D.add(makeDexWall({ count: 151, cols: 17, cell: 0.42, center: [0, 3.0, 0.6], from: [0, 1.6, -1.4], spread: [9, 0.8, 1.2], seed: 5 }));
  scene.add(wall151.mesh);

  const keys: Key[] = [
    { t: 0, pos: [-6.5, 2.0, 4.2], look: [-3.5, 1.4, -1.5], fov: 44 },
    { t: tHard + 4, pos: [-4.0, 2.2, 3.4], look: [-2.0, 2.2, -3], fov: 44 },
    { t: tMasuda, pos: [-1.2, 1.9, 2.6], look: [0, 1.3, -1.5], fov: 40 },
    { t: tMasuda + 3, pos: [0.8, 1.8, 1.6], look: [0, 1.4, -1.6], fov: 36 },
    { t: tPika, pos: [3.4, 1.85, 1.3], look: [4.5, 1.5, -1.6], fov: 34 },
    { t: tPika + 4.2, pos: [3.6, 1.8, 1.9], look: [4.5, 1.5, -1.2], fov: 36 },
    { t: t151 + 0.4, pos: [0.6, 2.4, 5.8], look: [0, 2.4, -0.5], fov: 46 },
    { t: t151 + 5, pos: [0, 3.0, 8.4], look: [0, 3.0, 0], fov: 50 },
    { t: tMew - 0.1, pos: [0.4, 3.0, 8.0], look: [0.5, 3.0, 0], fov: 48 },
    { t: tMew + 0.6, pos: [3.4, 2.7, 5.6], look: [6.0, 2.6, 1.2], fov: 40 },
    { t: end, pos: [4.2, 2.6, 4.8], look: [6.2, 2.7, 1.2], fov: 36 },
  ];

  return {
    scene,
    portalScale: 1.2,
    camera: (t) => poseOnPath(keys, t),
    orbit: (t) => ({ target: poseOnPath(keys, t).look, limits: { yaw0: 0, yawSpan: 1.0, minPitch: -0.05, maxPitch: 1.1, minDist: 1, maxDist: 22 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      // Years pass: the calendar flips 1990 → 1995 and the windows cycle night and day.
      const yk = ramp(t, tHard + 0.5, tMasuda - 0.3);
      const y = 1990 + Math.min(5, Math.floor(yk * 6));
      if (y !== year) { year = y; cal.redraw(y); }
      const day = 0.5 + 0.5 * Math.sin(yk * Math.PI * 12);
      winMat.color.copy(col("#7a84a8").lerp(col("#f0f4ff"), yk > 0 && yk < 1 ? day * 0.85 : 0).multiplyScalar(1 - 0.75 * ramp(t, t151 + 0.5, t151 + 2.5)));
      // The lamp moves to each desk in turn.
      // The light moves to each desk in turn (a quick dim and up, as one lamp goes off and the next comes on).
      const s1 = ramp(t, tMasuda - 0.8, tMasuda + 0.2), s2 = ramp(t, tPika - 0.8, tPika + 0.2);
      const at = s2 > 0 ? 2 : s1 > 0 ? 1 : 0;
      const kk = at === 2 ? s2 : at === 1 ? s1 : 1;
      const on = Math.min(1, Math.abs(kk - 0.5) * 2.2);
      const bp = bulbs[kk < 0.5 ? at - 1 : at] ?? bulbs[0];
      lamp.position.copy(bp);
      lamp.target.position.set(bp.x + (at === 2 && kk >= 0.5 ? 0.6 : -0.6), 0.95, -1.4);
      lamp.intensity = 6 * on;
      lampGlow.sprite.position.copy(bp);
      lampGlow.set("#ffe2a8", 1.8 * on);
      const deskX = [-4.5, 0, 4.5][kk < 0.5 ? Math.max(0, at - 1) : at];
      people.forEach((p, i) => p.setRim("#9fb0ff", 0.5 + 1.0 * (Math.abs([-4.5, 0, 4.5][i] - deskX) < 1 ? 1 : 0)));
      shafts.forEach((sh, i) => { sh.u.uTime.value = ambient; sh.u.uOpacity.value = (0.55 + 0.45 * (yk > 0 && yk < 1 ? day : 0)) * (1 - ramp(t, t151, t151 + 1.5) * 0.7) * (0.85 + 0.15 * Math.sin(ambient * 0.4 + i)); });
      dust.u.uTime.value = ambient;
      dust.u.uPixel.value = px;
      notes.u.uTime.value = ambient;
      notes.u.uPixel.value = px;
      notes.u.uOpacity.value = ramp(t, tMasuda + 0.4, tMasuda + 1.4) * (1 - ramp(t, t151, t151 + 1));
      wave.redraw(ambient);
      (wave.mat as THREE.MeshBasicMaterial).color.setScalar(1.4 * ramp(t, tMasuda, tMasuda + 0.8));
      const dk = Math.round(ramp(t, tPika + 0.2, tPika + 2.6) * 160) / 160;
      if (dk !== dots) { dots = dk; pix.redraw(dk); }
      // Pikachu rises out of the screen in gold.
      const rise = ramp(t, tPika + 2.4, tPika + 4.2);
      if (pika) { pika.move([4.5, 1.05 + rise * 0.1, -1.55 + rise * 0.6]); pika.set(rise * (1 - ramp(t, t151 - 0.2, t151 + 0.6)), ambient, viewH, cam, 0.04, 0.08 * rise); }
      pikaGlow.set("#ffd060", 0.45 * rise * (1 - ramp(t, t151, t151 + 1)));
      // The burst, the wall of 151.
      burst.u.uTime.value = Math.max(0, t - t151 - 0.3);
      burst.u.uPixel.value = px;
      burst.u.uOpacity.value = t > t151 + 0.3 ? 1 - ramp(t, t151 + 2.5, t151 + 3.5) : 0;
      const fill = Math.max(0, Math.min(1, (t - t151 - 0.6) / 3.8));
      wall151.u.uFill.value = fill * 1.02;
      // On a portrait screen the wall shrinks about its centre to fit the frame's width at its final framing (distance 7.8, fov 50); 1 on desktop.
      wall151.u.uScale.value = Math.min(1, (2 * Math.tan((25 * Math.PI) / 180) * 7.8 * cam.aspect * 0.92) / (17 * 0.42));
      wall151.u.uTime.value = ambient;
      wall151.u.uDim.value = 1 - 0.65 * ramp(t, tMew - 0.4, tMew + 0.8);
      wallLight.intensity = 5.5 * ramp(t, t151 + 0.8, t151 + 4.4) * (1 - 0.6 * ramp(t, tMew - 0.4, tMew + 0.8));
      wall151.mesh.visible = t > t151;
      // Mew floats out from behind the grid.
      const mk = ramp(t, tMew + 0.3, tMew + 1.8);
      if (mew) { mew.move([6.2 + (1 - mk) * 1.2, 2.3 + Math.sin(ambient * 1.4) * 0.12, 1.2], -0.5 + Math.sin(ambient * 0.9) * 0.2); mew.set(mk, ambient, viewH, cam, 0.12, 0.05); }
      mewGlow.set("#ff8ad0", 0.4 * ramp(t, tMew, tMew + 0.8));
      sparkles.u.uTime.value = ambient;
      sparkles.u.uPixel.value = px;
      sparkles.u.uOpacity.value = ramp(t, tMew + 0.5, tMew + 1.5);
      // The room falls back into the dark as the wall of shapes lights it.
      const wallUp = ramp(t, t151 + 0.3, t151 + 2.5) * (1 - 0.6 * ramp(t, tMew - 0.4, tMew + 1));
      L.key.intensity = 0.6 * (1 - 0.5 * wallUp);
      L.hemi.intensity = 1.05 * (1 - 0.45 * wallUp);
      patchMat.color.copy(col("#5a70c0").multiplyScalar((0.55 + 0.45 * (yk > 0 && yk < 1 ? day : 0)) * (1 - 0.6 * wallUp)));
    },
    look: (t) =>
      lookAt(t, { ...STOCK.warm }, {
        exposure: [[0, 0.85], [t151, 0.9], [t151 + 3, 1.0], [end, 1.0]],
        gain: [[0, [0.86, 0.94, 1.12]], [tPika, [0.95, 0.97, 1.02]], [t151 + 2, [1.1, 1.0, 0.84]], [tMew + 1, [1.06, 0.96, 1.0]]],
        saturation: [[0, 0.75], [tPika, 0.9], [t151 + 2, 1.1]],
        bloom: [[0, 0.7], [tPika + 3, 0.9], [t151 + 0.5, 0.75], [t151 + 4, 0.6], [tMew, 0.8], [end, 0.85]],
        bloomThreshold: [[0, 0.72], [t151, 0.72], [t151 + 1, 0.92], [tMew, 0.92], [tMew + 1, 0.75]],
        grain: [[0, 0.08], [end, 0.06]],
      }),
    dispose() { D.dispose(); },
  };
};
