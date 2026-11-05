import * as THREE from "three";
import { col, makeGlow, makeParticles, merge, placed, ramp, rng } from "@/components/world-history/scene/kit";
import { makeCanvasPanel } from "@/components/world-history/scene/props";
import { lights, lookAt, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { drawCritter, makeSilhouette, makeWords } from "../story-kit";
import { bag, shots, STOCK } from "./base";

/**
 * II. Game Freak. A neon arcade at night, cabinets of little pixel invaders
 * either side; at the end of the aisle, a desk under a lamp where a
 * handmade magazine of tips types itself out (original mock pages, not
 * scans). A second silhouette joins and an ink line draws itself. Then the
 * pages lift off the stack and swirl at the camera (slow motion), settle
 * into a sign on a door, GAME FREAK, and the door opens into white light.
 */

const TIPS = ["GAME FREAK", "TIPS & SECRETS", "", "Where the bonus hides", "Clear stage 4 without a miss", "The high-score route", "Reader letters", "Next issue: more secrets"];

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tArc = B("arcade"), tZine = B("zine"), tSugi = B("sugimori"), tPages = B("pages"), tStudio = B("studio");
  scene.background = col("#05030a");
  scene.fog = new THREE.FogExp2(col("#0a0614"), 0.03);
  const L = lights(scene, { sky: "#8a6ad0", ground: "#1a0c28", fill: 0.7, key: "#ff5ad0", keyK: 1.1, keyPos: [0, 6, 10], rim: "#3ff0ff", rimK: 0.9, rimPos: [0, 3, 30] });

  // ---- The arcade: an aisle of cabinets with screens of little invaders.
  // Carpet with the neon confetti that glows under the black lights.
  const carpetTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d")!; const cr = rng(21);
    g.fillStyle = "#0b0814"; g.fillRect(0, 0, 256, 256);
    const hues = ["#ff3fb0", "#3ff0ff", "#ffe23f", "#7a5cff"];
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = g.fillStyle = hues[i % 4]; g.lineWidth = 3;
      const x = cr() * 256, y = cr() * 256, s2 = 6 + cr() * 10, k = i % 3;
      g.beginPath();
      if (k === 0) { g.moveTo(x, y - s2); g.lineTo(x + s2, y + s2); g.lineTo(x - s2, y + s2); g.closePath(); g.stroke(); }
      else if (k === 1) { g.moveTo(x - s2, y); for (let q = 0; q <= 4; q++) g.lineTo(x - s2 + q * s2 / 2, y + (q % 2 ? -s2 / 2 : s2 / 2)); g.stroke(); }
      else { g.arc(x, y, s2 * 0.4, 0, Math.PI * 2); g.fill(); }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 14); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const floorMat = new THREE.MeshStandardMaterial({ color: col("#ffffff"), map: carpetTex, emissive: col("#ffffff"), emissiveMap: carpetTex, emissiveIntensity: 0.06, roughness: 0.85 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 60).rotateX(-Math.PI / 2), floorMat);
  floor.position.set(0, 0, 4);
  scene.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: col("#0e0a16"), roughness: 0.9 });
  const shell = new THREE.Mesh(merge([
    placed(new THREE.PlaneGeometry(26, 4), [-3.9, 2, 12], Math.PI / 2),
    placed(new THREE.PlaneGeometry(26, 4), [3.9, 2, 12], -Math.PI / 2),
    placed(new THREE.PlaneGeometry(8, 26).rotateX(Math.PI / 2), [0, 3.95, 12]),
  ]), wallMat);
  scene.add(shell);
  D.add({ dispose: () => { floor.geometry.dispose(); floorMat.dispose(); carpetTex.dispose(); shell.geometry.dispose(); wallMat.dispose(); } });
  // A cabinet's side profile (front faces +z): kick plate, control panel, a screen leaning back, the marquee box.
  const prof = new THREE.Shape([[-0.55, 0], [0.38, 0], [0.38, 0.86], [0.56, 0.98], [0.5, 1.06], [0.3, 1.1], [0.1, 1.86], [0.26, 1.9], [0.26, 2.32], [-0.55, 2.32]].map(([a, b]) => new THREE.Vector2(a, b)));
  const cabG = new THREE.ExtrudeGeometry(prof, { depth: 1.16, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.58, 0, 0);
  const cabMat = new THREE.MeshStandardMaterial({ color: col("#3a3050"), roughness: 0.4, metalness: 0.1 });
  const marquee = new THREE.MeshBasicMaterial({ color: col("#ff3fb0", 2.2) });
  const marqueeC = new THREE.MeshBasicMaterial({ color: col("#3ff0ff", 2.2) });
  const btnMat = new THREE.MeshBasicMaterial({ color: col("#ffe0f0", 1.4) });
  const cabs: THREE.BufferGeometry[] = [], mqA: THREE.BufferGeometry[] = [], mqB: THREE.BufferGeometry[] = [], btns: THREE.BufferGeometry[] = [];
  const screens: ReturnType<typeof makeCanvasPanel>[] = [];
  const at = (side: number, z: number, lx: number, ly: number, lz: number): [number, number, number] => [side * 3 + side * -lz, ly, z + side * lx];
  for (let i = 0; i < 7; i++) {
    for (const side of [-1, 1]) {
      const z = 20 - i * 2.0;
      const rot = -side * Math.PI / 2;
      cabs.push(placed(cabG.clone(), [side * 3, 0, z], rot));
      (((i + (side > 0 ? 1 : 0)) % 2) ? mqA : mqB).push(placed(new THREE.PlaneGeometry(1.02, 0.3), at(side, z, 0, 2.11, 0.27), rot));
      for (const bx of [0.14, 0.26, 0.38]) btns.push(placed(new THREE.SphereGeometry(0.028, 8, 6), at(side, z, bx, 1.04, 0.45), rot));
      btns.push(placed(new THREE.SphereGeometry(0.04, 10, 8), at(side, z, -0.25, 1.1, 0.44), rot));
      const seed = i * 2 + (side > 0 ? 1 : 0);
      const sc = D.add(makeCanvasPanel({
        w: 0.92, h: 0.7, px: [128, 104], emissive: 1.8,
        draw(g, w, h, t) {
          g.fillStyle = "#050814";
          g.fillRect(0, 0, w, h);
          const hue = [300, 180, 120, 40][seed % 4];
          for (let k = 0; k < 10; k++) {
            const x = ((k % 5) * 22 + 10 + Math.sin(t * 1.5 + seed) * 8) | 0, y = (Math.floor(k / 5) * 22 + 10 + ((t * 6) % 22)) | 0;
            drawCritter(g, x, y, 16, seed * 31 + (k % 3), `hsl(${hue} 90% 60%)`);
          }
          g.fillStyle = "#ffffff";
          g.fillRect((w / 2 + Math.sin(t * 2 + seed) * 30) | 0, h - 12, 10, 6);
          // Scanlines.
          g.fillStyle = "rgba(0,0,0,0.35)";
          for (let yy = 0; yy < h; yy += 3) g.fillRect(0, yy, w, 1);
        },
      }));
      sc.mesh.position.set(...at(side, z, 0, 1.48, 0.215));
      sc.mesh.rotation.set(0, rot, 0, "YXZ");
      sc.mesh.rotateX(-0.27);
      scene.add(sc.mesh);
      screens.push(sc);
    }
  }
  const cabMesh = new THREE.Mesh(merge(cabs), cabMat);
  const mqMeshA = new THREE.Mesh(merge(mqA), marquee), mqMeshB = new THREE.Mesh(merge(mqB), marqueeC), btnMesh = new THREE.Mesh(merge(btns), btnMat);
  [...cabs, ...mqA, ...mqB, ...btns].forEach((g) => g.dispose());
  scene.add(cabMesh, mqMeshA, mqMeshB, btnMesh);
  D.add({ dispose: () => { [cabMesh, mqMeshA, mqMeshB, btnMesh].forEach((m) => m.geometry.dispose()); cabG.dispose(); cabMat.dispose(); marquee.dispose(); marqueeC.dispose(); btnMat.dispose(); } });
  // The screens' colour spilling onto the carpet (a soft wet sheen), and a glow at each screen.
  const spillTex = (() => {
    const c = document.createElement("canvas"); c.width = 64; c.height = 512;
    const g = c.getContext("2d")!;
    for (let i = 0; i < 7; i++) {
      const y = ((20 - i * 2) + 6) / 26 * 512;
      const gr = g.createRadialGradient(10, y, 0, 10, y, 44);
      const hue = [300, 180, 120, 40][(i * 2) % 4];
      gr.addColorStop(0, `hsla(${hue},90%,60%,0.9)`); gr.addColorStop(1, `hsla(${hue},90%,60%,0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 64, 512);
    }
    return new THREE.CanvasTexture(c);
  })();
  const spillMat = new THREE.MeshBasicMaterial({ map: spillTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: col("#ffffff", 0.2) });
  const spill = new THREE.Mesh(merge([
    placed(new THREE.PlaneGeometry(2.2, 26).rotateX(-Math.PI / 2), [-1.5, 0.01, 7]),
    placed(new THREE.PlaneGeometry(2.2, 26).rotateX(-Math.PI / 2), [1.5, 0.01, 7], 0, [-1, 1, 1]),
  ]), spillMat);
  spillMat.side = THREE.DoubleSide;
  scene.add(spill);
  D.add({ dispose: () => { spill.geometry.dispose(); spillMat.dispose(); spillTex.dispose(); } });
  // Neon tubes along the ceiling edges, framing the aisle.
  const tubes = [new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 15), new THREE.MeshBasicMaterial({ color: col("#ff3fb0", 1.4) })), new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 15), new THREE.MeshBasicMaterial({ color: col("#3ff0ff", 1.4) }))];
  tubes[0].position.set(-2.3, 3.8, 14);
  tubes[1].position.set(2.3, 3.8, 14);
  tubes.forEach((t) => scene.add(t));
  D.add({ dispose: () => tubes.forEach((t) => { t.geometry.dispose(); (t.material as THREE.Material).dispose(); }) });
  const haze = D.add(makeParticles({ count: Math.round(500 * ctx.q.particles) + 40, shape: "box", center: [0, 2, 13], extent: [3, 1.8, 9], velocity: [0, 0.04, 0], spread: [0.05, 0.03, 0.05], life: 12, size: [0.03, 0.06], colors: ["#ff7ad0", "#7af0ff", "#ffffff"], intensity: 1.1, turbulence: 0.5 }));
  scene.add(haze.points);

  // ---- The desk at the end of the aisle, under a lamp.
  const deskZ = -2;
  const wood = new THREE.MeshStandardMaterial({ color: col("#4a2e18"), roughness: 0.6 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 1.6), wood);
  desk.position.set(0, 1.0, deskZ);
  const legs = [-1.4, 1.4].map((x) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 1.4), wood); l.position.set(x, 0.5, deskZ); return l; });
  scene.add(desk, ...legs);
  D.add({ dispose: () => { desk.geometry.dispose(); legs.forEach((l) => l.geometry.dispose()); wood.dispose(); } });
  // An anglepoise lamp: base, two arms, a shade tipped at the page, a small hot bulb.
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r0: number) => { const g = new THREE.CylinderGeometry(r0, r0, a.distanceTo(b), 8); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return g; };
  const lb = new THREE.Vector3(1.1, 1.06, deskZ - 0.45), le = new THREE.Vector3(1.22, 1.62, deskZ - 0.6), lh = new THREE.Vector3(0.82, 1.86, deskZ - 0.25);
  const lampMetal = new THREE.MeshStandardMaterial({ color: col("#2c5a3c"), roughness: 0.35, metalness: 0.55 });
  const shadeG = new THREE.ConeGeometry(0.17, 0.24, 24, 1, true).translate(0, -0.06, 0);
  shadeG.rotateZ(0.55); shadeG.rotateX(-0.25); shadeG.translate(lh.x, lh.y, lh.z);
  const lampMesh = new THREE.Mesh(merge([placed(new THREE.CylinderGeometry(0.13, 0.15, 0.035, 20), [lb.x, lb.y - 0.035, lb.z]), rod(lb, le, 0.014), rod(le, lh, 0.012), placed(new THREE.SphereGeometry(0.03, 10, 8), [le.x, le.y, le.z]), shadeG]), lampMetal);
  lampMetal.side = THREE.DoubleSide;
  scene.add(lampMesh);
  D.add({ dispose: () => { lampMesh.geometry.dispose(); shadeG.dispose(); lampMetal.dispose(); } });
  const bulbAt: [number, number, number] = [lh.x - 0.06, lh.y - 0.1, lh.z + 0.02];
  const lamp = new THREE.SpotLight(col("#ffcf8a"), 0, 7, 0.75, 0.55, 1.3);
  lamp.position.set(...bulbAt);
  lamp.target.position.set(0.1, 1.0, deskZ + 0.1);
  scene.add(lamp, lamp.target);
  const lampGlow = D.add(makeGlow({ pos: bulbAt, size: 0.42, color: "#ffd9a0", intensity: 0 }));
  scene.add(lampGlow.sprite);
  // The room: a plaster back wall lit by the lamp, a night window over Tokyo, a shelf of back issues.
  const plaster = new THREE.MeshStandardMaterial({ color: col("#7a6450"), roughness: 0.95 });
  const backZ = deskZ - 3.42;
  const room = new THREE.Mesh(merge([
    placed(new THREE.PlaneGeometry(3.6, 3.9), [-2.75, 1.95, backZ]),
    placed(new THREE.PlaneGeometry(3.6, 3.9), [2.75, 1.95, backZ]),
    placed(new THREE.PlaneGeometry(1.9, 0.9), [0, 3.45, backZ]),
    placed(new THREE.PlaneGeometry(7.4, 3.9), [-3.9, 1.95, backZ + 3.7], Math.PI / 2),
    placed(new THREE.PlaneGeometry(7.4, 3.9), [3.9, 1.95, backZ + 3.7], -Math.PI / 2),
  ]), plaster);
  scene.add(room);
  const winTex = (() => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 200;
    const g = c.getContext("2d")!; const wr = rng(8);
    const gr = g.createLinearGradient(0, 0, 0, 200); gr.addColorStop(0, "#0a1030"); gr.addColorStop(0.7, "#2a2650"); gr.addColorStop(1, "#5a3a5a");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 200);
    for (let b = 0; b < 16; b++) {
      const x = b * 17 + wr() * 6, bw = 12 + wr() * 12, bh = 40 + wr() * 110;
      g.fillStyle = "#06060e"; g.fillRect(x, 200 - bh, bw, bh);
      for (let yy = 200 - bh + 6; yy < 196; yy += 7) for (let xx = x + 2; xx < x + bw - 3; xx += 5) if (wr() < 0.3) { g.fillStyle = wr() < 0.8 ? "#ffd38a" : "#8ad8ff"; g.fillRect(xx, yy, 2, 3); }
    }
    g.fillStyle = "#ff4f9a"; g.fillRect(40, 120, 18, 4); g.fillStyle = "#3ff0ff"; g.fillRect(180, 96, 4, 22);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const winMat = new THREE.MeshBasicMaterial({ map: winTex, color: col("#ffffff", 1.1), toneMapped: false });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.33), winMat);
  win.position.set(-2.5, 2.0, backZ + 0.02);
  scene.add(win);
  const sashMat = new THREE.MeshStandardMaterial({ color: col("#2a1c12"), roughness: 0.7 });
  const shelfMat = new THREE.MeshStandardMaterial({ color: col("#5a3a22"), roughness: 0.75 });
  const br = rng(33);
  const spines: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 3; row++) for (let x = 1.75; x < 3.45;) { const w2 = 0.04 + br() * 0.05, h2 = 0.24 + br() * 0.12; spines.push(placed(new THREE.BoxGeometry(w2, h2, 0.2), [x + w2 / 2, 0.92 + row * 0.55 + h2 / 2, backZ + 0.14], 0, [1, 1, 1], 0, (br() - 0.5) * 0.05)); x += w2 + 0.006; }
  const spineMat = new THREE.MeshStandardMaterial({ color: col("#ffffff"), roughness: 0.8, vertexColors: false });
  const sash = new THREE.Mesh(merge([
    placed(new THREE.BoxGeometry(1.84, 0.07, 0.06), [-2.5, 2.68, backZ + 0.04]), placed(new THREE.BoxGeometry(1.84, 0.07, 0.06), [-2.5, 1.32, backZ + 0.04]),
    placed(new THREE.BoxGeometry(0.07, 1.4, 0.06), [-3.39, 2.0, backZ + 0.04]), placed(new THREE.BoxGeometry(0.07, 1.4, 0.06), [-1.61, 2.0, backZ + 0.04]),
    placed(new THREE.BoxGeometry(0.04, 1.33, 0.04), [-2.5, 2.0, backZ + 0.05]), placed(new THREE.BoxGeometry(1.7, 0.04, 0.04), [-2.5, 2.0, backZ + 0.05]),
  ]), sashMat);
  const shelf = new THREE.Mesh(merge([0, 1, 2, 3].map((row) => placed(new THREE.BoxGeometry(1.8, 0.04, 0.26), [2.6, 0.9 + row * 0.55, backZ + 0.13]))), shelfMat);
  const books = new THREE.Mesh(merge(spines), spineMat);
  spines.forEach((g) => g.dispose());
  // Back issues in faded paper colours.
  { const n = books.geometry.getAttribute("position").count; const cAttr = new Float32Array(n * 3); const pal = [[0.55, 0.42, 0.3], [0.42, 0.18, 0.16], [0.2, 0.28, 0.36], [0.62, 0.55, 0.4], [0.3, 0.36, 0.22]]; for (let v = 0; v < n; v += 36) { const c2 = pal[Math.floor(br() * pal.length)]; for (let k = 0; k < 36 && v + k < n; k++) cAttr.set(c2, (v + k) * 3); } books.geometry.setAttribute("color", new THREE.BufferAttribute(cAttr, 3)); spineMat.vertexColors = true; }
  scene.add(sash, shelf, books);
  const wash = new THREE.PointLight(col("#ffb870"), 0, 7.5, 1.4);
  wash.position.set(0.2, 2.5, backZ + 1.4);
  scene.add(wash);
  const deskTop = new THREE.Mesh(new THREE.PlaneGeometry(7.8, 6.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#3a2618"), roughness: 0.8 }));
  deskTop.position.set(0, 0.003, backZ + 3.2);
  scene.add(deskTop);
  D.add({ dispose: () => { room.geometry.dispose(); plaster.dispose(); win.geometry.dispose(); winMat.dispose(); winTex.dispose(); sash.geometry.dispose(); sashMat.dispose(); shelf.geometry.dispose(); shelfMat.dispose(); books.geometry.dispose(); spineMat.dispose(); deskTop.geometry.dispose(); (deskTop.material as THREE.Material).dispose(); } });
  // The paper stack and the page that types itself.
  const paperMat = new THREE.MeshStandardMaterial({ color: col("#b8ae96"), roughness: 0.9 });
  const stack = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.86), paperMat);
  stack.position.set(-0.9, 1.16, deskZ);
  scene.add(stack);
  D.add({ dispose: () => { stack.geometry.dispose(); paperMat.dispose(); } });
  let typed = -1;
  const page = D.add(makeCanvasPanel({
    w: 0.62, h: 0.86, px: [360, 500], basic: false, emissive: 0.08,
    draw(g, w, h, k) {
      g.fillStyle = "#e6dcc2";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#1c140c";
      const chars = Math.floor(k * 220);
      let left = chars;
      TIPS.forEach((line, i) => {
        if (left <= 0) return;
        const show = line.slice(0, left);
        left -= line.length + 4;
        g.font = i === 0 ? `700 40px ${ctx.font}` : i === 1 ? `600 22px ${ctx.font}` : `500 22px ${ctx.font}`;
        g.fillText(show, 26, 60 + i * 44 + (i > 1 ? 20 : 0));
      });
      g.strokeStyle = "rgba(28,20,12,0.5)";
      g.strokeRect(14, 14, w - 28, h - 28);
    },
  }));
  page.mesh.rotation.x = -Math.PI / 2;
  page.mesh.position.set(-0.05, 1.06, deskZ + 0.1);
  scene.add(page.mesh);
  // The second page, where an ink line draws itself (an original doodle).
  let inked = -1;
  // A flowing ink flourish that loops across the page (an original doodle), and the pen that draws it.
  const inkPt = (u: number): [number, number] => [360 * (0.14 + 0.72 * u) + 26 * Math.cos(u * 38), 500 * (0.5 + 0.2 * Math.sin(u * 7.5) + 0.05 * Math.sin(u * 19)) + 30 * Math.sin(u * 38)];
  const ink = D.add(makeCanvasPanel({
    w: 0.62, h: 0.86, px: [360, 500], basic: false, emissive: 0.08,
    draw(g, w, h, k) {
      g.fillStyle = "#e6dcc2";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#140c06";
      g.lineCap = "round";
      const n = Math.floor(k * 300);
      for (let i = 1; i <= n; i++) {
        const [x0, y0] = inkPt((i - 1) / 300), [x1, y1] = inkPt(i / 300);
        g.lineWidth = 2.5 + 3.5 * Math.abs(Math.sin(i / 300 * 38 + 0.6));
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    },
  }));
  ink.mesh.rotation.x = -Math.PI / 2;
  ink.mesh.position.set(0.75, 1.06, deskZ + 0.1);
  scene.add(ink.mesh);
  const penMat = new THREE.MeshStandardMaterial({ color: col("#141014"), roughness: 0.3, metalness: 0.6 });
  const penG = new THREE.CylinderGeometry(0.009, 0.004, 0.17, 8).translate(0, 0.085, 0);
  const pen = new THREE.Mesh(penG, penMat);
  pen.rotation.set(-0.5, 0, 0.35);
  scene.add(pen);
  D.add({ dispose: () => { penG.dispose(); penMat.dispose(); } });
  const writer = D.add(makeSilhouette({ height: 1.75, pose: "seated", rim: "#ffcf8a" }));
  writer.mesh.position.set(-0.35, 0.34, deskZ - 0.9);
  scene.add(writer.mesh);
  const artist = D.add(makeSilhouette({ height: 1.72, pose: "seated", rim: "#ffcf8a" }));
  scene.add(artist.mesh);

  // ---- The pages that lift and swirl at the camera.
  const N = Math.round(90 * Math.max(0.5, ctx.q.particles));
  const pageGeo = new THREE.PlaneGeometry(0.24, 0.33);
  const leaf = makeCanvasPanel({ w: 1, h: 1, px: [128, 176], basic: false, emissive: 0.18, draw(g, w, h) { g.fillStyle = "#e6dcc2"; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(30,20,10,0.6)"; for (let y = 22; y < h - 10; y += 12) g.fillRect(12, y, 40 + ((y * 37) % 60), 3); } });
  const leafMat = leaf.mat.clone() as THREE.MeshStandardMaterial;
  leafMat.side = THREE.DoubleSide;
  D.add({ dispose: () => { leaf.dispose(); leafMat.dispose(); pageGeo.dispose(); } });
  const swirl = new THREE.InstancedMesh(pageGeo, leafMat, N);
  swirl.frustumCulled = false;
  scene.add(swirl);
  const pr = rng(4);
  const seeds = Array.from({ length: N }, () => [pr(), pr(), pr(), pr()]);
  const fwd = new THREE.Vector3();
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3(1, 1, 1);

  // ---- The door: the pages settle into its sign, and it opens into light.
  const doorZ = deskZ - 3.2;
  const frameMat = new THREE.MeshStandardMaterial({ color: col("#24180e"), roughness: 0.7 });
  const doorFrame = new THREE.Mesh(merge([placed(new THREE.BoxGeometry(0.16, 3.1, 0.22), [-1.03, 1.55, doorZ - 0.1]), placed(new THREE.BoxGeometry(0.16, 3.1, 0.22), [1.03, 1.55, doorZ - 0.1]), placed(new THREE.BoxGeometry(2.22, 0.16, 0.22), [0, 3.08, doorZ - 0.1])]), frameMat);
  scene.add(doorFrame);
  const doorPivot = new THREE.Group();
  doorPivot.position.set(-0.95, 0, doorZ);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.0, 0.08), new THREE.MeshStandardMaterial({ color: col("#6a4428"), roughness: 0.5 }));
  door.position.set(0.95, 1.5, 0);
  doorPivot.add(door);
  scene.add(doorPivot);
  const light = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: col("#fff6e0", 3), toneMapped: false }));
  light.position.set(0, 1.6, backZ - 2.2);
  scene.add(light);
  D.add({ dispose: () => { doorFrame.geometry.dispose(); frameMat.dispose(); door.geometry.dispose(); (door.material as THREE.Material).dispose(); light.geometry.dispose(); (light.material as THREE.Material).dispose(); } });
  const sign = D.add(makeWords({ text: "GAME FREAK", font: ctx.font, w: 1.6, color: "#ffe9c0", glow: "#ffb860", weight: 700 }));
  sign.mesh.position.set(0.95, 2.35, 0.06);
  doorPivot.add(sign.mesh);

  // Shots: down the arcade aisle; cut to the desk; the vortex of pages; a hard cut to the door as the sign forms.
  const cam = shots([
    [0, [
      { t: 0, pos: [0, 1.7, 26], look: [0, 1.6, 14], fov: 46 },
      { t: tArc + 3, pos: [0.3, 1.65, 18], look: [-0.2, 1.5, 8], fov: 44 },
      { t: tZine - 0.3, pos: [0.15, 1.62, 13.5], look: [-0.1, 1.5, 4], fov: 44 },
    ]],
    [tZine - 0.3, [
      { t: tZine - 0.3, pos: [-0.7, 2.45, deskZ + 2.3], look: [0, 1.06, deskZ + 0.1], fov: 40 },
      { t: tZine + 3, pos: [-0.3, 2.3, deskZ + 1.6], look: [0, 1.06, deskZ + 0.1], fov: 38 },
      { t: tSugi + 3.5, pos: [0.8, 2.25, deskZ + 1.4], look: [0.6, 1.06, deskZ + 0.1], fov: 36 },
      { t: tPages - 0.25, pos: [0.85, 2.2, deskZ + 1.5], look: [0.5, 1.1, deskZ], fov: 37 },
    ]],
    [tPages - 0.25, [
      { t: tPages - 0.25, pos: [0, 1.95, deskZ + 2.9], look: [0, 1.4, deskZ], fov: 44 },
      { t: tPages + 4.5, pos: [0.2, 1.8, deskZ + 2.1], look: [0, 1.6, deskZ - 1], fov: 48 },
      { t: tStudio + 0.6, pos: [0.15, 1.85, deskZ + 1.7], look: [0.1, 1.75, deskZ - 1.4], fov: 48 },
    ]],
    [tStudio + 0.6, [
      { t: tStudio + 0.6, pos: [0.05, 2.0, deskZ + 0.9], look: [0.2, 1.95, doorZ], fov: 40 },
      { t: tStudio + 1.6, pos: [0, 2.0, deskZ + 0.5], look: [0.2, 1.93, doorZ], fov: 43 },
      { t: end, pos: [0, 1.6, doorZ + 0.9], look: [0, 1.5, doorZ - 1], fov: 52 },
    ]],
  ]);

  return {
    scene,
    portalScale: 1.2,
    camera: cam,
    orbit: (t) => ({ target: cam(t).look, limits: { yaw0: 0, yawSpan: 0.9, minPitch: -0.1, maxPitch: 1.0, minDist: 0.8, maxDist: 20 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const deskOn = ramp(t, tZine - 1.6, tZine + 0.6);
      // The arcade dims as we reach the desk; the lamp comes on.
      screens.forEach((s) => { s.redraw(ambient); (s.mat as THREE.MeshBasicMaterial).color.setScalar(1.8 * (1 - deskOn * 0.7)); });
      marquee.color.copy(col("#ff3fb0", 2.2 * (1 - deskOn * 0.75)));
      marqueeC.color.copy(col("#3ff0ff", 2.2 * (1 - deskOn * 0.75)));
      tubes.forEach((tb, i) => (tb.material as THREE.MeshBasicMaterial).color.copy(col(i ? "#3ff0ff" : "#ff3fb0", 1.4 * (1 - deskOn * 0.8))));
      haze.u.uTime.value = ambient;
      haze.u.uPixel.value = px;
      haze.u.uOpacity.value = 1 - deskOn * 0.6;
      L.key.intensity = 1.1 * (1 - deskOn);
      if (L.rim) L.rim.intensity = 0.9 * (1 - deskOn);
      L.hemi.intensity = 0.7 - deskOn * 0.4;
      lamp.intensity = 2.7 * deskOn;
      lampGlow.set("#ffd9a0", 2.2 * deskOn);
      (scene.fog as THREE.FogExp2).color.copy(col("#0a0614").lerp(col("#120a06"), deskOn));
      // Typing, and the ink line.
      const ty = Math.round(ramp(t, tZine + 0.4, tZine + 4.5) * 60) / 60;
      if (ty !== typed) { typed = ty; page.redraw(ty); }
      const ik = Math.round(ramp(t, tSugi + 1.2, tSugi + 4.2) * 60) / 60;
      if (ik !== inked) { inked = ik; ink.redraw(ik); }
      const join = ramp(t, tSugi - 0.4, tSugi + 1.2);
      artist.mesh.position.set(0.55 + (1 - join) * 2.4, 0.34, deskZ - 0.9);
      artist.mesh.visible = join > 0.01;
      writer.setRim("#ffcf8a", 0.35);
      artist.setRim("#ffcf8a", 0.35);
      wash.intensity = 16 * deskOn;
      winMat.color.copy(col("#ffffff", 1.1 * deskOn + 0.05));
      // The pages: off the stack, a swirl at the camera, then into the sign.
      const lift = ramp(t, tPages - 0.2, tPages + 1.2);
      const settle = ramp(t, tStudio - 0.4, tStudio + 1.6);
      cam.getWorldDirection(fwd);
      const C = cam.position.clone().addScaledVector(fwd, 0.9);
      const S0 = new THREE.Vector3(-0.9, 1.3, deskZ);
      const flow = Math.max(0, t - (tPages - 0.2)) * 0.5;
      for (let i = 0; i < N; i++) {
        const [a, b, c, d] = seeds[i];
        let u = flow - d * 0.6;
        const on = u > 0 ? 1 : 0;
        u = u > 0 ? u % 1 : 0;
        const ue = u * u * (3 - 2 * u);
        const th = a * Math.PI * 2 + u * 7 + t * 0.9;
        const rad = 0.06 + 1.25 * Math.pow(u, 1.4) * (0.7 + 0.6 * b);
        p4.copy(S0).lerp(C, ue);
        p4.x += Math.cos(th) * rad;
        p4.y += Math.sin(th) * rad * 0.75 + Math.sin(u * Math.PI) * 0.5;
        p4.z += Math.sin(th) * rad * 0.3;
        if (!on) p4.set(S0.x + (a - 0.5) * 0.1, 1.27 + d * 0.04, S0.z + (b - 0.5) * 0.1);
        const target = new THREE.Vector3((a - 0.5) * 1.5, 2.35 + (b - 0.5) * 0.35, doorZ + 0.08);
        p4.lerp(target, settle);
        const spin = on * Math.min(1, u * 6);
        e4.set(-Math.PI / 2 * (1 - spin) + spin * (a * 6 + t * (1.2 + c)), spin * (b * 4 + t * 0.8), spin * c * 3);
        q4.setFromEuler(e4);
        s4.setScalar(Math.max(0.001, (1 - settle) * (0.75 + 0.35 * c) * (on ? 1 - Math.max(0, u - 0.9) * 10 : lift > 0 ? 1 : 0)));
        m4.compose(p4, q4, s4);
        swirl.setMatrixAt(i, m4);
      }
      swirl.instanceMatrix.needsUpdate = true;
      swirl.visible = lift > 0.001 && settle < 0.999;
      // The pen follows the ink line's end.
      const [pcx, pcy] = inkPt(Math.max(0.001, ik));
      pen.position.set(0.75 + (pcx / 360 - 0.5) * 0.62, 1.065, deskZ + 0.1 + (pcy / 500 - 0.5) * 0.86);
      pen.visible = t > tSugi && t < tPages;
      // The sign glows, the door opens into white light.
      const signOn = ramp(t, tStudio + 0.6, tStudio + 1.8);
      sign.mat.color.copy(col("#ffffff", 0.15 + 0.85 * signOn));
      doorPivot.rotation.y = ramp(t, tStudio + 2.6, end - 0.4) * 1.45;
    },
    look: (t) =>
      lookAt(t, { ...STOCK.warm, saturation: 1.15 }, {
        exposure: [[0, 0.9], [tZine, 0.85], [tStudio + 2, 0.9], [end, 1.5]],
        chroma: [[0, 0.5], [tZine - 0.5, 0.4], [tZine + 1, 0.05]],
        bloom: [[0, 1.0], [tZine + 1, 0.6], [tPages + 1, 0.8], [tStudio + 1, 0.7], [end, 1.4]],
        gain: [[0, [1.02, 0.95, 1.05]], [tZine + 1, [1.12, 1.0, 0.82]]],
        flash: [[end - 1.4, 0], [end, 0.85]],
        grain: [[0, 0.06], [end, 0.05]],
      }),
    dispose() { D.dispose(); swirl.dispose(); },
  };
};
