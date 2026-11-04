import * as THREE from "three";
import { poseOnPath, type Key } from "@/lib/world-history/camera";
import { col, makeGlow, makeParticles, ramp, rng } from "@/components/world-history/scene/kit";
import { makeCanvasPanel } from "@/components/world-history/scene/props";
import { lights, lookAt, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { drawCritter, makeSilhouette, makeWords } from "../story-kit";
import { bag, STOCK } from "./base";

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
  const L = lights(scene, { sky: "#6a4aa0", ground: "#120818", fill: 0.35, key: "#ff5ad0", keyK: 0.6, keyPos: [0, 6, 10] });

  // ---- The arcade: an aisle of cabinets with screens of little invaders.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#0c0a14"), roughness: 0.15, metalness: 0.4 }));
  floor.position.set(0, 0, 4);
  scene.add(floor);
  D.add({ dispose: () => { floor.geometry.dispose(); (floor.material as THREE.Material).dispose(); } });
  const cabMat = new THREE.MeshStandardMaterial({ color: col("#16121e"), roughness: 0.6 });
  const cabGeo = new THREE.BoxGeometry(1.3, 2.4, 1.1);
  const marquee = new THREE.MeshBasicMaterial({ color: col("#ff3fb0", 2.2) });
  const marqueeC = new THREE.MeshBasicMaterial({ color: col("#3ff0ff", 2.2) });
  const mqGeo = new THREE.BoxGeometry(1.2, 0.22, 0.05);
  D.add({ dispose: () => { cabMat.dispose(); cabGeo.dispose(); marquee.dispose(); marqueeC.dispose(); mqGeo.dispose(); } });
  const screens: ReturnType<typeof makeCanvasPanel>[] = [];
  for (let i = 0; i < 7; i++) {
    for (const side of [-1, 1]) {
      const z = 20 - i * 2.2;
      const cab = new THREE.Mesh(cabGeo, cabMat);
      cab.position.set(side * 3, 1.2, z);
      cab.rotation.y = -side * Math.PI / 2;
      scene.add(cab);
      const mq = new THREE.Mesh(mqGeo, (i + (side > 0 ? 1 : 0)) % 2 ? marquee : marqueeC);
      mq.position.set(side * 2.42, 2.25, z);
      mq.rotation.y = -side * Math.PI / 2;
      scene.add(mq);
      const seed = i * 2 + (side > 0 ? 1 : 0);
      const sc = D.add(makeCanvasPanel({
        w: 0.9, h: 0.72, px: [128, 104], emissive: 1.8,
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
        },
      }));
      sc.mesh.position.set(side * 2.43, 1.55, z);
      sc.mesh.rotation.set(-0.25 * 0, -side * Math.PI / 2, 0);
      scene.add(sc.mesh);
      screens.push(sc);
    }
  }
  // Neon tubes along the ceiling.
  const tubes = [new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 18), new THREE.MeshBasicMaterial({ color: col("#ff3fb0", 3) })), new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 18), new THREE.MeshBasicMaterial({ color: col("#3ff0ff", 3) }))];
  tubes[0].position.set(-1.4, 3.6, 13);
  tubes[1].position.set(1.4, 3.6, 13);
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
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.35, 20, 1, true), new THREE.MeshStandardMaterial({ color: col("#2a5a3a"), roughness: 0.5, side: THREE.DoubleSide, emissive: col("#ffd890"), emissiveIntensity: 0.2 }));
  lampShade.position.set(0.9, 1.9, deskZ - 0.2);
  scene.add(lampShade);
  D.add({ dispose: () => { lampShade.geometry.dispose(); (lampShade.material as THREE.Material).dispose(); } });
  const lamp = new THREE.SpotLight(col("#ffd08a"), 0, 9, 0.9, 0.6, 1.2);
  lamp.position.set(0.9, 1.85, deskZ - 0.2);
  lamp.target.position.set(0, 1.0, deskZ);
  scene.add(lamp, lamp.target);
  const lampGlow = D.add(makeGlow({ pos: [0.9, 1.75, deskZ - 0.2], size: 1.6, color: "#ffd08a", intensity: 0 }));
  scene.add(lampGlow.sprite);
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
  const ink = D.add(makeCanvasPanel({
    w: 0.62, h: 0.86, px: [360, 500], basic: false, emissive: 0.08,
    draw(g, w, h, k) {
      g.fillStyle = "#e6dcc2";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#140c06";
      g.lineWidth = 5;
      g.lineCap = "round";
      g.beginPath();
      const n = Math.floor(k * 240);
      for (let i = 0; i <= n; i++) {
        const u = i / 240;
        const a = u * Math.PI * 6.5;
        const r = 40 + u * 110;
        const x = w / 2 + Math.cos(a) * r * 0.9 + Math.sin(u * 30) * 4, y = h / 2 + Math.sin(a) * r * 0.7;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    },
  }));
  ink.mesh.rotation.x = -Math.PI / 2;
  ink.mesh.position.set(0.75, 1.06, deskZ + 0.1);
  scene.add(ink.mesh);
  const writer = D.add(makeSilhouette({ height: 1.75, pose: "seated", rim: "#ffcf8a" }));
  writer.mesh.position.set(-0.3, 0, deskZ - 0.85);
  scene.add(writer.mesh);
  const artist = D.add(makeSilhouette({ height: 1.72, pose: "seated", rim: "#ffcf8a" }));
  scene.add(artist.mesh);

  // ---- The pages that lift and swirl at the camera.
  const N = Math.round(90 * Math.max(0.5, ctx.q.particles));
  const pageGeo = new THREE.PlaneGeometry(0.3, 0.42);
  const leaf = makeCanvasPanel({ w: 1, h: 1, px: [128, 176], basic: false, emissive: 0.18, draw(g, w, h) { g.fillStyle = "#e6dcc2"; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(30,20,10,0.6)"; for (let y = 22; y < h - 10; y += 12) g.fillRect(12, y, 40 + ((y * 37) % 60), 3); } });
  const leafMat = leaf.mat.clone() as THREE.MeshStandardMaterial;
  leafMat.side = THREE.DoubleSide;
  D.add({ dispose: () => { leaf.dispose(); leafMat.dispose(); pageGeo.dispose(); } });
  const swirl = new THREE.InstancedMesh(pageGeo, leafMat, N);
  swirl.frustumCulled = false;
  scene.add(swirl);
  const pr = rng(4);
  const seeds = Array.from({ length: N }, () => [pr(), pr(), pr(), pr()]);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3(1, 1, 1);

  // ---- The door: the pages settle into its sign, and it opens into light.
  const doorZ = deskZ - 3.2;
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.4, 0.2), new THREE.MeshStandardMaterial({ color: col("#1a120c"), roughness: 0.7 }));
  doorFrame.position.set(0, 1.7, doorZ - 0.15);
  scene.add(doorFrame);
  const doorPivot = new THREE.Group();
  doorPivot.position.set(-0.95, 0, doorZ);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.0, 0.08), new THREE.MeshStandardMaterial({ color: col("#5a3a22"), roughness: 0.55 }));
  door.position.set(0.95, 1.5, 0);
  doorPivot.add(door);
  scene.add(doorPivot);
  const light = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3.0), new THREE.MeshBasicMaterial({ color: col("#fff6e0", 3) }));
  light.position.set(0, 1.5, doorZ - 0.12);
  scene.add(light);
  D.add({ dispose: () => { doorFrame.geometry.dispose(); (doorFrame.material as THREE.Material).dispose(); door.geometry.dispose(); (door.material as THREE.Material).dispose(); light.geometry.dispose(); (light.material as THREE.Material).dispose(); } });
  const sign = D.add(makeWords({ text: "GAME FREAK", font: ctx.font, w: 1.6, color: "#ffe9c0", glow: "#ffb860", weight: 700 }));
  sign.mesh.position.set(0.95, 2.35, 0.06);
  doorPivot.add(sign.mesh);

  const keys: Key[] = [
    { t: 0, pos: [0, 1.7, 26], look: [0, 1.6, 14], fov: 46 },
    { t: tArc + 3, pos: [0.3, 1.65, 18], look: [-0.2, 1.5, 8], fov: 44 },
    { t: tZine - 0.3, pos: [0, 2.0, 6], look: [0, 1.2, deskZ], fov: 42 },
    { t: tZine + 3, pos: [-0.3, 2.3, deskZ + 1.6], look: [0, 1.06, deskZ + 0.1], fov: 38 },
    { t: tSugi + 3.5, pos: [0.8, 2.25, deskZ + 1.4], look: [0.6, 1.06, deskZ + 0.1], fov: 36 },
    { t: tPages, pos: [0, 2.0, deskZ + 2.6], look: [0, 1.4, deskZ], fov: 44 },
    { t: tPages + 4.5, pos: [0.2, 1.8, deskZ + 2.1], look: [0, 1.6, deskZ - 1], fov: 48 },
    { t: tStudio + 1, pos: [0, 1.8, deskZ + 0.6], look: [0.2, 1.9, doorZ], fov: 44 },
    { t: end, pos: [0, 1.6, doorZ + 0.9], look: [0, 1.5, doorZ - 1], fov: 52 },
  ];

  return {
    scene,
    portalScale: 1.2,
    camera: (t) => poseOnPath(keys, t),
    orbit: (t) => ({ target: poseOnPath(keys, t).look, limits: { yaw0: 0, yawSpan: 0.9, minPitch: -0.1, maxPitch: 1.0, minDist: 0.8, maxDist: 20 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const deskOn = ramp(t, tZine - 1.6, tZine + 0.6);
      // The arcade dims as we reach the desk; the lamp comes on.
      screens.forEach((s) => { s.redraw(ambient); (s.mat as THREE.MeshBasicMaterial).color.setScalar(1.8 * (1 - deskOn * 0.7)); });
      marquee.color.copy(col("#ff3fb0", 2.2 * (1 - deskOn * 0.75)));
      marqueeC.color.copy(col("#3ff0ff", 2.2 * (1 - deskOn * 0.75)));
      tubes.forEach((tb, i) => (tb.material as THREE.MeshBasicMaterial).color.copy(col(i ? "#3ff0ff" : "#ff3fb0", 3 * (1 - deskOn * 0.8))));
      haze.u.uTime.value = ambient;
      haze.u.uPixel.value = px;
      haze.u.uOpacity.value = 1 - deskOn * 0.6;
      L.key.intensity = 0.6 * (1 - deskOn);
      lamp.intensity = 2.6 * deskOn;
      lampGlow.set("#ffd08a", 1.6 * deskOn);
      (scene.fog as THREE.FogExp2).color.copy(col("#0a0614").lerp(col("#120a06"), deskOn));
      // Typing, and the ink line.
      const ty = Math.round(ramp(t, tZine + 0.4, tZine + 4.5) * 60) / 60;
      if (ty !== typed) { typed = ty; page.redraw(ty); }
      const ik = Math.round(ramp(t, tSugi + 1.2, tSugi + 4.2) * 60) / 60;
      if (ik !== inked) { inked = ik; ink.redraw(ik); }
      const join = ramp(t, tSugi - 0.4, tSugi + 1.2);
      artist.mesh.position.set(1.0 + (1 - join) * 2.4, 0, deskZ - 0.85);
      artist.mesh.visible = join > 0.01;
      writer.setRim("#ffcf8a", 1.2 + deskOn);
      artist.setRim("#ffcf8a", 1.2 + deskOn);
      // The pages: off the stack, a swirl at the camera, then into the sign.
      const lift = ramp(t, tPages - 0.2, tPages + 2.6);
      const settle = ramp(t, tStudio - 0.4, tStudio + 1.6);
      const camPos = cam.position;
      for (let i = 0; i < N; i++) {
        const [a, b, c, d] = seeds[i];
        const k = Math.max(0, Math.min(1, lift * 1.3 - d * 0.3));
        const th = a * Math.PI * 2 + t * (0.8 + b);
        const rad = 0.3 + k * (0.8 + b * 1.6);
        const from = new THREE.Vector3(-0.9 + (a - 0.5) * 0.2, 1.2 + i * 0.002, deskZ + (b - 0.5) * 0.2);
        const sw = new THREE.Vector3(Math.cos(th) * rad, 1.5 + (c - 0.5) * 1.6 * k + Math.sin(t * 1.3 + a * 9) * 0.2, deskZ + 0.6 + Math.sin(th) * rad * 0.7 + k * (camPos.z - deskZ - 1.6) * (0.25 + 0.4 * c));
        p4.copy(from).lerp(sw, k);
        // Settle onto the sign's spot on the door.
        const target = new THREE.Vector3((a - 0.5) * 1.5, 2.35 + (b - 0.5) * 0.35, doorZ + 0.08);
        p4.lerp(target, settle);
        e4.set(-Math.PI / 2 * (1 - k) + k * (a * 6 + t * (1 + c)), k * (b * 4 + t * 0.7), k * c * 3);
        q4.setFromEuler(e4);
        s4.setScalar(Math.max(0.001, (1 - settle) * (0.8 + 0.4 * c)));
        m4.compose(p4, q4, s4);
        swirl.setMatrixAt(i, m4);
      }
      swirl.instanceMatrix.needsUpdate = true;
      swirl.visible = lift > 0.001 && settle < 0.999;
      // The sign glows, the door opens into white light.
      const signOn = ramp(t, tStudio + 0.6, tStudio + 1.8);
      sign.mat.color.copy(col("#ffffff", 0.15 + 0.85 * signOn));
      doorPivot.rotation.y = -ramp(t, tStudio + 2.6, end - 0.4) * 1.5;
      doorFrame.visible = door.visible = light.visible = t > tPages - 1;
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
