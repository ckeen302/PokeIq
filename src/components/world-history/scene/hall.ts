import * as THREE from "three";
import { poseOnPath, type Key, type Pose } from "@/lib/world-history/camera";
import type { Chapter } from "@/lib/world-history/types";
import { col, keyed, makeGlow, makeParticles, makeShaft, merge, placed, stoneMaterial } from "./kit";

/**
 * The museum hall between the exhibits: a long, dark gallery of marble and
 * gold where every chapter is a doorway in the wall, lit from above, with a
 * plaque. The doorways are true portals: when a chapter is loaded, its
 * doorway shows that chapter rendered from a camera that moves with yours
 * (so the diorama stands behind the door, in perspective). At a doorway's
 * reference point the opening fills the screen exactly, which is how the
 * film walks out of one exhibit and into the next without a cut.
 */

export const ARCH_SPACING = 18;
export const OPENING_H = 6.4;
export const OPENING_BOTTOM = 1.7;
export const OPENING_Y = OPENING_BOTTOM + OPENING_H / 2;
const PORTAL_Z = 0.06;

export interface Hall {
  scene: THREE.Scene;
  /** Sets the openings' aspect (the screen's) so a doorway exactly fills it at its reference point. */
  setAspect(aspect: number): void;
  /** The camera pose that frames doorway i exactly, for a vertical fov (degrees). */
  ref(i: number, fov: number): Pose;
  /** Doorway i's opening corners (world), for visibility and coverage. */
  corners(i: number): THREE.Vector3[];
  /** Shows a live render in doorway i (null: its poster). */
  setLive(i: number, tex: THREE.Texture | null, res?: THREE.Vector2): void;
  setPoster(i: number, tex: THREE.Texture): void;
  update(ambient: number, cam: THREE.PerspectiveCamera): void;
  /** Camera for the prologue (k 0..1), a transition from i to i+1, and the epilogue. */
  prologue(k: number, fovIn: number, aspect: number): Pose;
  transition(i: number, k: number, fovOut: number, fovIn: number, hallFov: number): Pose;
  epilogue(i: number, k: number, fovOut: number, hallFov: number): Pose;
  count: number;
  dispose(): void;
}

function plaqueTexture(c: Chapter, font: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 320;
  const g = cv.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, "#1b1530");
  grad.addColorStop(1, "#0b0814");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 320);
  g.strokeStyle = "rgba(242,201,107,0.75)";
  g.lineWidth = 6;
  g.strokeRect(14, 14, 996, 292);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = c.accent;
  g.font = `600 44px ${font}`;
  g.fillText(`${c.numeral}  ·  ${c.region.toUpperCase()}`, 512, 72);
  g.fillStyle = "#f6f1e3";
  g.font = `600 92px ${font}`;
  g.fillText(c.title, 512, 165, 960);
  g.fillStyle = "rgba(246,241,227,0.72)";
  g.font = `italic 500 46px ${font}`;
  g.fillText(c.when, 512, 252, 960);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A poster for a doorway whose chapter isn't loaded: its colours, numeral and name, until a still of the scene arrives. */
export function posterTexture(c: Chapter, font: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 512;
  const g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(256, 200, 10, 256, 256, 380);
  grad.addColorStop(0, c.accent);
  grad.addColorStop(0.45, "#1a1030");
  grad.addColorStop(1, "#05030a");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.globalAlpha = 0.85;
  g.fillStyle = "#fff8e8";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `600 150px ${font}`;
  g.fillText(c.numeral, 256, 240);
  g.font = `600 44px ${font}`;
  g.fillText(c.region.toUpperCase(), 256, 360);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildHall(chapters: Chapter[], font: string): Hall {
  const scene = new THREE.Scene();
  scene.background = col("#05040a");
  scene.fog = new THREE.FogExp2(col("#07050d"), 0.012);
  const n = chapters.length;
  const xOf = (i: number) => i * ARCH_SPACING;
  const disposers: (() => void)[] = [];

  // Light: a dim cool fill, warm key from above the doorways.
  scene.add(new THREE.HemisphereLight(col("#8a7fb8"), col("#1a1208"), 0.35));
  const key = new THREE.DirectionalLight(col("#ffd9a0"), 1.1);
  key.position.set(20, 30, 25);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(col("#7aa0ff"), 0.45);
  rim.position.set(-30, 10, -10);
  scene.add(rim);

  // Floor: dark polished stone with a long runner down the middle.
  const floorMat = new THREE.MeshStandardMaterial({ color: col("#0d0b12"), roughness: 0.22, metalness: 0.15 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(n * ARCH_SPACING + 160, 90).rotateX(-Math.PI / 2), floorMat);
  floor.position.set(xOf(n - 1) / 2, 0, 30);
  scene.add(floor);
  const runner = new THREE.Mesh(new THREE.PlaneGeometry(n * ARCH_SPACING + 100, 3.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#3a0d16"), roughness: 0.9 }));
  runner.position.set(xOf(n - 1) / 2, 0.01, 13);
  scene.add(runner);

  // The back wall, a ceiling and a far wall.
  const wallMat = stoneMaterial({ color: "#2a2433", roughness: 0.75, dirt: 0.35 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(n * ARCH_SPACING + 160, 30), wallMat);
  wall.position.set(xOf(n - 1) / 2, 15, -0.4);
  scene.add(wall);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(n * ARCH_SPACING + 160, 90).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#0a0810"), roughness: 0.9 }));
  ceiling.position.set(xOf(n - 1) / 2, 17, 30);
  scene.add(ceiling);

  // Columns between the doorways, with capitals and bases.
  const colGeo: THREE.BufferGeometry[] = [];
  for (let i = -1; i <= n; i++) {
    const x = xOf(i) + ARCH_SPACING / 2;
    colGeo.push(placed(new THREE.CylinderGeometry(0.85, 0.95, 14.5, 24, 1), [x, 7.25, 1.2]));
    colGeo.push(placed(new THREE.BoxGeometry(2.6, 0.7, 2.6), [x, 14.6, 1.2]));
    colGeo.push(placed(new THREE.BoxGeometry(2.6, 0.6, 2.6), [x, 0.3, 1.2]));
  }
  const columns = new THREE.Mesh(merge(colGeo), stoneMaterial({ color: "#3b3346", roughness: 0.45, dirt: 0.25 }));
  scene.add(columns);
  // A cornice along the wall.
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(n * ARCH_SPACING + 160, 0.8, 1.6), stoneMaterial({ color: "#3b3346", roughness: 0.5, dirt: 0.2 }));
  cornice.position.set(xOf(n - 1) / 2, 15.2, 0.6);
  scene.add(cornice);

  // Each doorway: a gold frame around a portal plane, a plinth, a plaque and a lamp.
  const gold = new THREE.MeshStandardMaterial({ color: col("#c9a24a"), roughness: 0.32, metalness: 1, emissive: col("#3a2508"), emissiveIntensity: 0.4 });
  const plinthMat = stoneMaterial({ color: "#2f2838", roughness: 0.5, dirt: 0.2 });
  const portalGeo = new THREE.PlaneGeometry(1, 1);
  interface Door { frame: THREE.Group; portal: THREE.Mesh; mat: THREE.ShaderMaterial; plaque: THREE.Mesh; posterTex: THREE.Texture; glow: ReturnType<typeof makeGlow> }
  const doors: Door[] = [];
  let aspect = 16 / 9;
  const frameParts = (w: number) => {
    const h = OPENING_H, t = 0.42;
    const geos = [
      placed(new THREE.BoxGeometry(w + t * 2, t, 0.5), [0, h / 2 + t / 2, 0]),
      placed(new THREE.BoxGeometry(w + t * 2, t, 0.5), [0, -h / 2 - t / 2, 0]),
      placed(new THREE.BoxGeometry(t, h, 0.5), [-w / 2 - t / 2, 0, 0]),
      placed(new THREE.BoxGeometry(t, h, 0.5), [w / 2 + t / 2, 0, 0]),
      placed(new THREE.BoxGeometry(w + t * 3.4, 0.16, 0.7), [0, h / 2 + t + 0.08, 0]),
      placed(new THREE.BoxGeometry(w + t * 3.4, 0.16, 0.7), [0, -h / 2 - t - 0.08, 0]),
    ];
    return merge(geos);
  };
  chapters.forEach((c, i) => {
    const frame = new THREE.Group();
    frame.position.set(xOf(i), OPENING_Y, 0.2);
    const frameMesh = new THREE.Mesh(frameParts(OPENING_H * aspect), gold);
    frame.add(frameMesh);
    scene.add(frame);
    const posterTex = posterTexture(c, font);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uLive: { value: null }, uIsLive: { value: 0 }, uPoster: { value: posterTex }, uRes: { value: new THREE.Vector2(1, 1) }, uAspect: { value: aspect }, uPosterAspect: { value: 1 }, uTime: { value: 0 }, uAccent: { value: col(c.accent) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uLive, uPoster; uniform float uIsLive, uAspect, uPosterAspect, uTime; uniform vec2 uRes; uniform vec3 uAccent; varying vec2 vUv;
        void main(){
          vec3 c;
          if (uIsLive > 0.5) c = texture2D(uLive, gl_FragCoord.xy / uRes).rgb;
          else {
            vec2 uv = vUv - 0.5;
            float r = uAspect / uPosterAspect;
            if (r > 1.0) uv.y /= r; else uv.x *= r;
            c = texture2D(uPoster, uv + 0.5).rgb * 0.85;
            c += uAccent * 0.05 * (0.5 + 0.5 * sin(uTime * 0.7));
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const portal = new THREE.Mesh(portalGeo, mat);
    portal.position.set(xOf(i), OPENING_Y, PORTAL_Z);
    portal.scale.set(OPENING_H * aspect, OPENING_H, 1);
    scene.add(portal);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), plinthMat);
    plinth.name = "plinth";
    plinth.position.set(xOf(i), OPENING_BOTTOM / 2 - 0.2, 0.8);
    frame.userData.plinth = plinth;
    scene.add(plinth);
    const plaqueTex = plaqueTexture(c, font);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.31), new THREE.MeshBasicMaterial({ map: plaqueTex, toneMapped: false, color: col("#ffffff", 0.95) }));
    plaque.position.set(xOf(i), OPENING_Y + OPENING_H / 2 + 1.55, 0.3);
    scene.add(plaque);
    const glow = makeGlow({ pos: [xOf(i), OPENING_Y + OPENING_H / 2 + 3.3, 1.2], size: 3.2, color: "#ffd38a", intensity: 1.6 });
    scene.add(glow.sprite);
    const shaft = makeShaft({ from: [xOf(i), 16.8, 6], to: [xOf(i), 0, 2.2], r0: 0.9, r1: 4.6, color: "#ffcf8a", intensity: 0.16, noise: 0.6 });
    scene.add(shaft.mesh);
    disposers.push(() => { shaft.dispose(); glow.dispose(); plaqueTex.dispose(); (plaque.material as THREE.Material).dispose(); plaque.geometry.dispose(); mat.dispose(); frameMesh.geometry.dispose(); posterTex.dispose(); });
    doors.push({ frame, portal, mat, plaque, posterTex, glow });
  });
  const layout = () => {
    doors.forEach((d) => {
      const w = OPENING_H * aspect;
      const fm = d.frame.children[0] as THREE.Mesh;
      fm.geometry.dispose();
      fm.geometry = frameParts(w);
      d.portal.scale.set(w, OPENING_H, 1);
      d.mat.uniforms.uAspect.value = aspect;
      const plinth = d.frame.userData.plinth as THREE.Mesh;
      plinth.scale.set(w + 2.4, OPENING_BOTTOM + 0.4, 1.6);
    });
  };
  layout();

  // Dust in the lamplight, the length of the hall.
  const dust = makeParticles({ count: 900, shape: "box", center: [xOf(n - 1) / 2, 6, 9], extent: [n * ARCH_SPACING / 2 + 30, 6, 9], velocity: [0.05, -0.02, 0], spread: [0.08, 0.05, 0.08], life: 22, size: [0.03, 0.07], colors: ["#ffe6b0", "#ffd38a", "#c9a0ff"], intensity: 1.4, turbulence: 0.6, fadeIn: 0.2, fadeOut: 0.3 });
  scene.add(dust.points);
  disposers.push(() => dust.dispose());

  // The entrance: a far wall with a great window of night sky.
  const endWall = new THREE.Mesh(new THREE.PlaneGeometry(90, 30), wallMat);
  endWall.rotation.y = Math.PI / 2;
  endWall.position.set(xOf(-1) - 30, 15, 30);
  scene.add(endWall);

  const fwd = new THREE.Vector3();
  return {
    scene,
    count: n,
    setAspect(a) {
      const next = Math.max(0.42, Math.min(2.4, a));
      if (Math.abs(next - aspect) < 1e-3) return;
      aspect = next;
      layout();
    },
    ref(i, fov) {
      const d = (OPENING_H / 2) / Math.tan((fov * Math.PI) / 360) * 0.985;
      return { pos: [xOf(i), OPENING_Y, PORTAL_Z + d], look: [xOf(i), OPENING_Y, PORTAL_Z], fov };
    },
    corners(i) {
      const w = OPENING_H * aspect, x = xOf(i);
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => new THREE.Vector3(x + (sx * w) / 2, OPENING_Y + (sy * OPENING_H) / 2, PORTAL_Z));
    },
    setLive(i, tex, res) {
      const d = doors[i];
      if (!d) return;
      d.mat.uniforms.uIsLive.value = tex ? 1 : 0;
      d.mat.uniforms.uLive.value = tex;
      if (res) d.mat.uniforms.uRes.value.copy(res);
    },
    setPoster(i, tex) {
      const d = doors[i];
      if (!d) return;
      d.mat.uniforms.uPoster.value = tex;
      const img = tex.image as { width?: number; height?: number } | undefined;
      d.mat.uniforms.uPosterAspect.value = img?.width && img?.height ? img.width / img.height : 1;
    },
    update(ambient, cam) {
      dust.u.uTime.value = ambient;
      dust.setPixel(1, 1);
      dust.u.uPixel.value = (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? 900 / (2 * Math.tan(((cam.fov) * Math.PI) / 360)) : 600;
      doors.forEach((d) => { d.mat.uniforms.uTime.value = ambient; });
      cam.getWorldDirection(fwd);
    },
    prologue(k, fovIn) {
      const r = this.ref(0, fovIn);
      const keys: Key[] = [
        { t: 0, pos: [xOf(-1) - 18, 6.2, 26], look: [xOf(3), 4.2, 0], fov: 48 },
        { t: 0.42, pos: [xOf(-1) + 2, 5.2, 19], look: [xOf(1), 4.4, 0], fov: 46 },
        { t: 0.76, pos: [xOf(0) - 2.4, OPENING_Y + 0.8, r.pos[2] + 7], look: [xOf(0), OPENING_Y, 0], fov: (46 + fovIn) / 2 },
        { t: 1, pos: r.pos, look: r.look, fov: fovIn },
      ];
      return poseOnPath(keys, k);
    },
    transition(i, k, fovOut, fovIn, hallFov) {
      const a = this.ref(i, fovOut), b = this.ref(i + 1, fovIn);
      const mid = (xOf(i) + xOf(i + 1)) / 2;
      const keys: Key[] = [
        { t: 0, ...a },
        { t: 0.3, pos: [xOf(i) + 1.2, OPENING_Y + 0.7, a.pos[2] + 9.5], look: [xOf(i) + 3.5, OPENING_Y - 0.2, 0], fov: (fovOut + hallFov) / 2 },
        { t: 0.55, pos: [mid, OPENING_Y + 1.4, Math.max(a.pos[2], b.pos[2]) + 12], look: [xOf(i + 1) - 2, OPENING_Y, 0], fov: hallFov },
        { t: 0.8, pos: [xOf(i + 1) - 1, OPENING_Y + 0.45, b.pos[2] + 6.5], look: [xOf(i + 1), OPENING_Y, 0], fov: (hallFov + fovIn) / 2 },
        { t: 1, ...b },
      ];
      return poseOnPath(keys, k);
    },
    epilogue(i, k, fovOut, hallFov) {
      const a = this.ref(i, fovOut);
      const keys: Key[] = [
        { t: 0, ...a },
        { t: 0.35, pos: [xOf(i) - 1.5, OPENING_Y + 1.6, a.pos[2] + 13], look: [xOf(i) - 4, OPENING_Y, 0], fov: hallFov },
        { t: 1, pos: [xOf(i) + 10, 13.5, 48], look: [xOf(i) - 70, 3.5, 0], fov: hallFov + 4 },
      ];
      return poseOnPath(keys, k);
    },
    dispose() {
      disposers.forEach((d) => d());
      [floor, runner, wall, ceiling, columns, cornice, endWall].forEach((m) => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
      gold.dispose();
      plinthMat.dispose();
      portalGeo.dispose();
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.name === "plinth") m.geometry.dispose(); });
    },
  };
}

/** The hall's own grade, and how a doorway's coverage of the screen blends toward its chapter's. */
export const HALL_EXPOSURE = keyed;
