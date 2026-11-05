import * as THREE from "three";
import { poseOnPath, type Key } from "@/lib/world-history/camera";
import { col, makeGlow, makeParticles, merge, ramp, rng } from "@/components/world-history/scene/kit";
import { makeCanvasPanel } from "@/components/world-history/scene/props";
import { lights, loadFigures, lookAt, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { makeCritterWall, makeSilhouette } from "../story-kit";
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

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tHard = B("hard"), tMasuda = B("masuda"), tPika = B("pikachu"), t151 = B("151"), tMew = B("mew");
  scene.background = col("#04050a");
  scene.fog = new THREE.FogExp2(col("#070912"), 0.025);
  const L = lights(scene, { sky: "#6a7aaa", ground: "#14141c", fill: 0.6, key: "#aab8e8", keyK: 0.5, keyPos: [-4, 6, 6] });

  // The room: floor, back wall with windows, desks.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#14161e"), roughness: 0.7 }));
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 10), new THREE.MeshStandardMaterial({ color: col("#1c1e28"), roughness: 0.9 }));
  wall.position.set(0, 5, -5);
  scene.add(floor, wall);
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

  // The lamp moving from desk to desk.
  const lamp = new THREE.SpotLight(col("#ffd590"), 12, 10, 0.85, 0.6, 1.2);
  lamp.position.set(-4.5, 2.4, -1.4);
  lamp.target.position.set(-4.5, 0.9, -1.5);
  scene.add(lamp, lamp.target);
  const lampGlow = D.add(makeGlow({ pos: [-4.5, 2.3, -1.4], size: 1.4, color: "#ffd590", intensity: 1 }));
  scene.add(lampGlow.sprite);

  // Masuda's desk: a keyboard, notes rising, a waveform on a screen.
  const kb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: col("#d8d4cc"), roughness: 0.5 }));
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
  const wall151 = D.add(makeCritterWall({ count: 151, cols: 17, cell: 0.42, center: [0, 3.0, 0.6], colors: ["#ffe7a8", "#ffcf6a"], seed: 5 }));
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
      winMat.color.copy(col("#2a3460").lerp(col("#c0d0f0"), yk > 0 && yk < 1 ? day * 0.7 : 0));
      // The lamp moves to each desk in turn.
      lamp.position.x = -4.5 + 4.5 * ramp(t, tMasuda - 0.8, tMasuda + 0.2) + 4.5 * ramp(t, tPika - 0.8, tPika + 0.2);
      lamp.target.position.x = lamp.position.x;
      lampGlow.sprite.position.x = lamp.position.x;
      people.forEach((p, i) => p.setRim("#9fb0ff", 0.6 + 1.2 * (Math.abs([-4.5, 0, 4.5][i] - lamp.position.x) < 1 ? 1 : 0)));
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
      wall151.u.uFill.value = ramp(t, t151 + 0.8, t151 + 4.2) * 1.1;
      wall151.u.uTime.value = ambient;
      wall151.u.uDim.value = 0.62 * (1 - 0.7 * ramp(t, tMew - 0.4, tMew + 0.8));
      wall151.mesh.visible = t > t151;
      // Mew floats out from behind the grid.
      const mk = ramp(t, tMew + 0.3, tMew + 1.8);
      if (mew) { mew.move([6.2 + (1 - mk) * 1.2, 2.3 + Math.sin(ambient * 1.4) * 0.12, 1.2], -0.5 + Math.sin(ambient * 0.9) * 0.2); mew.set(mk, ambient, viewH, cam, 0.12, 0.05); }
      mewGlow.set("#ff8ad0", 0.4 * ramp(t, tMew, tMew + 0.8));
      sparkles.u.uTime.value = ambient;
      sparkles.u.uPixel.value = px;
      sparkles.u.uOpacity.value = ramp(t, tMew + 0.5, tMew + 1.5);
      L.key.intensity = 0.5 + 0.5 * ramp(t, t151, t151 + 3);
    },
    look: (t) =>
      lookAt(t, { ...STOCK.warm }, {
        exposure: [[0, 0.85], [t151, 0.9], [t151 + 3, 1.0], [end, 1.0]],
        gain: [[0, [0.86, 0.94, 1.12]], [tPika, [0.95, 0.97, 1.02]], [t151 + 2, [1.1, 1.0, 0.84]], [tMew + 1, [1.06, 0.96, 1.0]]],
        saturation: [[0, 0.75], [tPika, 0.9], [t151 + 2, 1.1]],
        bloom: [[0, 0.7], [tPika + 3, 0.9], [t151 + 1, 1.15], [t151 + 4, 0.95], [end, 0.95]],
        grain: [[0, 0.08], [end, 0.06]],
      }),
    dispose() { D.dispose(); },
  };
};
