import * as THREE from "three";
import { poseOnPath, type Key, type Pose } from "@/lib/world-history/camera";
import type { Chapter } from "@/lib/pokemon-story/types";
import { col, makeGlow, makeParticles, makeShaft, merge, placed, ramp } from "@/components/world-history/scene/kit";
import { ARCH_SPACING, OPENING_BOTTOM, OPENING_H, OPENING_Y, type Hall } from "@/components/world-history/scene/hall";
import { makeDevice, makeFirefly, makeGlassCase, type Device, type DeviceKind } from "./story-kit";

/**
 * The Archive: the hall between the Story's chapters. The same doorway
 * portals as World History's museum (each chapter is rendered live behind
 * its doorway, from a camera that moves with yours, so the film walks from
 * one exhibit into the next without a cut), re-themed warm: wooden floors,
 * brass rails, plaques with the year, and glass cases between the doorways
 * holding each era's hardware, from the Game Boy to the Switch 2. In the
 * prologue the lamps come up one by one behind a single firefly; in the
 * epilogue they dim again.
 */

const PORTAL_Z = 0.06;
const xOf = (i: number) => i * ARCH_SPACING;

/** What stands in the case after doorway i (the hardware of the eras either side). */
const CASES: (DeviceKind | "jar" | "zine" | "cards" | null)[] = ["jar", "zine", "gb", "cards", "gbc", "gba", "ds", "3ds", "switch", "switch2"];

function plaqueTexture(c: Chapter, font: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 320;
  const g = cv.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, "#3a2514");
  grad.addColorStop(1, "#1c1009");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 320);
  g.strokeStyle = "rgba(226,178,96,0.85)";
  g.lineWidth = 6;
  g.strokeRect(14, 14, 996, 292);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = c.accent;
  g.font = `600 44px ${font}`;
  g.fillText(`${c.numeral}  ·  ${c.year}  ·  ${c.title.toUpperCase()}`, 512, 72, 960);
  g.fillStyle = "#fbf1de";
  g.font = `600 92px ${font}`;
  g.fillText(c.title, 512, 165, 960);
  g.fillStyle = "rgba(251,241,222,0.72)";
  g.font = `italic 500 46px ${font}`;
  g.fillText(`${c.when} · ${c.place}`, 512, 252, 960);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function posterTexture(c: Chapter, font: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 512;
  const g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(256, 210, 10, 256, 256, 380);
  grad.addColorStop(0, c.accent);
  grad.addColorStop(0.5, "#2a170c");
  grad.addColorStop(1, "#080402");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.globalAlpha = 0.88;
  g.fillStyle = "#fff6e6";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `600 150px ${font}`;
  g.fillText(c.numeral, 256, 230);
  g.font = `600 52px ${font}`;
  g.fillText(c.year, 256, 360);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Warm wooden planks, drawn once. */
function woodTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 512;
  const g = cv.getContext("2d")!;
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 8; i++) {
    const y = i * 64;
    const l = 22 + r() * 8;
    g.fillStyle = `hsl(${28 + r() * 6} 30% ${l}%)`;
    g.fillRect(0, y, 512, 64);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(40,20,8,${0.05 + r() * 0.08})`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      const yy = y + r() * 64;
      g.moveTo(0, yy);
      g.bezierCurveTo(170, yy + (r() - 0.5) * 8, 340, yy + (r() - 0.5) * 8, 512, yy + (r() - 0.5) * 6);
      g.stroke();
    }
    g.fillStyle = "rgba(12,6,2,0.55)";
    g.fillRect(0, y, 512, 2);
    g.fillRect(((i * 197) % 400) + 60, y, 2, 64);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A tiny bug jar and a stack of paper, for the first two cases. */
function smallExhibit(kind: "jar" | "zine" | "cards"): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], rot = 0) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(...pos);
    mesh.rotation.y = rot;
    group.add(mesh);
    geos.push(g);
    if (!mats.includes(m)) mats.push(m);
  };
  if (kind === "jar") {
    add(new THREE.CylinderGeometry(0.3, 0.3, 0.72, 24, 1, true), new THREE.MeshStandardMaterial({ color: col("#d8f0e0"), transparent: true, opacity: 0.28, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }), [0, 0.36, 0]);
    add(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 24), new THREE.MeshStandardMaterial({ color: col("#8a6a3a"), roughness: 0.6, metalness: 0.4 }), [0, 0.76, 0]);
    add(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: col("#e6ff8a", 4) }), [0.08, 0.3, 0.05]);
    add(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: col("#e6ff8a", 3) }), [-0.1, 0.45, -0.04]);
  } else if (kind === "zine") {
    const paper = new THREE.MeshStandardMaterial({ color: col("#efe4c8"), roughness: 0.9 });
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.62, 0.025, 0.86), paper, [Math.sin(i * 2.3) * 0.03, 0.02 + i * 0.03, Math.cos(i * 1.7) * 0.03], Math.sin(i) * 0.08);
    add(new THREE.BoxGeometry(0.3, 0.01, 0.06), new THREE.MeshStandardMaterial({ color: col("#9aa0aa"), metalness: 1, roughness: 0.3 }), [0, 0.2, -0.3]);
  } else {
    const back = new THREE.MeshStandardMaterial({ color: col("#2856c8"), roughness: 0.5 });
    const gold = new THREE.MeshStandardMaterial({ color: col("#f2c94c"), roughness: 0.4, metalness: 0.3 });
    for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.44, 0.01, 0.62), i % 2 ? gold : back, [i * 0.04 - 0.08, 0.01 + i * 0.012, 0], 0.15 * i - 0.3);
  }
  return { group, dispose() { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); } };
}

export function buildArchive(chapters: Chapter[], font: string, renderer?: THREE.WebGLRenderer): Hall {
  const scene = new THREE.Scene();
  scene.background = col("#080503");
  scene.fog = new THREE.FogExp2(col("#0d0805"), 0.007);
  const n = chapters.length;
  const disposers: (() => void)[] = [];
  const len = n * ARCH_SPACING + 160;
  const mid = xOf(n - 1) / 2;

  // A warm environment for the brass and glass.
  if (renderer) {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: col("#140b06"), side: THREE.BackSide })));
    const lampM = new THREE.MeshBasicMaterial({ color: col("#ffcf8a", 6) });
    for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 0.5), lampM); m.position.set(-40 + i * 9, 18, -20 + (i % 2) * 40); env.add(m); }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(env, 0.03);
    pmrem.dispose();
    env.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.8;
  }

  const hemi = new THREE.HemisphereLight(col("#ffd9b0"), col("#2a160a"), 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(col("#ffd9a0"), 1.3);
  key.position.set(20, 30, 25);
  scene.add(key, key.target);
  const lamps: THREE.PointLight[] = [];
  for (let i = 0; i < n; i += 2) {
    const lamp = new THREE.PointLight(col("#ffd9a8"), 80, 34, 1.7);
    lamp.position.set(xOf(i) + ARCH_SPACING / 2, 11.5, 9);
    scene.add(lamp);
    lamps.push(lamp);
  }

  // Floor: warm oak planks, a long runner, a brass rail along the front.
  const wood = woodTexture();
  wood.repeat.set(len / 6, 90 / 6);
  const floorMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.5, metalness: 0.05 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(len, 90).rotateX(-Math.PI / 2), floorMat);
  floor.position.set(mid, 0, 30);
  scene.add(floor);
  const runner = new THREE.Mesh(new THREE.PlaneGeometry(len - 60, 3.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#3a1e16"), roughness: 0.95 }));
  runner.position.set(mid, 0.01, 13);
  scene.add(runner);
  const brass = new THREE.MeshStandardMaterial({ color: col("#c99a48"), roughness: 0.28, metalness: 1, emissive: col("#3a2408"), emissiveIntensity: 0.3 });
  const railGeo: THREE.BufferGeometry[] = [];
  railGeo.push(placed(new THREE.CylinderGeometry(0.07, 0.07, len - 60, 10).rotateZ(Math.PI / 2), [mid, 1.05, 5.2]));
  for (let x = xOf(-1); x <= xOf(n); x += 3) railGeo.push(placed(new THREE.CylinderGeometry(0.05, 0.06, 1.05, 8), [x, 0.52, 5.2]));
  const rail = new THREE.Mesh(merge(railGeo), brass);
  scene.add(rail);

  // Walls: warm plaster above dark wainscoting; wooden pilasters between doorways; a ceiling with beams.
  const wallMat = new THREE.MeshStandardMaterial({ color: col("#3a2a1e"), roughness: 0.85 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, 30), wallMat);
  wall.position.set(mid, 15, -0.4);
  scene.add(wall);
  const woodDark = new THREE.MeshStandardMaterial({ color: col("#2a170c"), roughness: 0.5, metalness: 0.05, map: wood });
  const wains = new THREE.Mesh(new THREE.BoxGeometry(len, 1.6, 0.3), woodDark);
  wains.position.set(mid, 0.8, -0.2);
  scene.add(wains);
  const pil: THREE.BufferGeometry[] = [];
  for (let i = -1; i <= n; i++) {
    const x = xOf(i) + ARCH_SPACING / 2;
    pil.push(placed(new THREE.BoxGeometry(1.4, 14.5, 1.0), [x, 7.25, 0.4]));
    pil.push(placed(new THREE.BoxGeometry(1.9, 0.5, 1.3), [x, 14.6, 0.4]));
  }
  const pilasters = new THREE.Mesh(merge(pil), woodDark);
  scene.add(pilasters);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(len, 90).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#140b06"), roughness: 0.9 }));
  ceiling.position.set(mid, 17, 30);
  scene.add(ceiling);
  const beams: THREE.BufferGeometry[] = [];
  for (let i = -1; i <= n; i++) beams.push(placed(new THREE.BoxGeometry(0.8, 0.8, 40), [xOf(i) + ARCH_SPACING / 2, 16.6, 20]));
  const beamMesh = new THREE.Mesh(merge(beams), woodDark);
  scene.add(beamMesh);

  // Doorways: a brass frame round each portal, a plinth, a plaque and its lamp.
  const plinthMat = new THREE.MeshStandardMaterial({ color: col("#2a170c"), roughness: 0.45, map: wood });
  const portalGeo = new THREE.PlaneGeometry(1, 1);
  interface Door { frame: THREE.Group; portal: THREE.Mesh; mat: THREE.ShaderMaterial; glow: ReturnType<typeof makeGlow>; shaft: ReturnType<typeof makeShaft>; plaque: THREE.Mesh }
  const doors: Door[] = [];
  let aspect = 16 / 9;
  const frameParts = (w: number) => {
    const h = OPENING_H, t = 0.36;
    return merge([
      placed(new THREE.BoxGeometry(w + t * 2, t, 0.45), [0, h / 2 + t / 2, 0]),
      placed(new THREE.BoxGeometry(w + t * 2, t, 0.45), [0, -h / 2 - t / 2, 0]),
      placed(new THREE.BoxGeometry(t, h, 0.45), [-w / 2 - t / 2, 0, 0]),
      placed(new THREE.BoxGeometry(t, h, 0.45), [w / 2 + t / 2, 0, 0]),
    ]);
  };
  chapters.forEach((c, i) => {
    const frame = new THREE.Group();
    frame.position.set(xOf(i), OPENING_Y, 0.2);
    frame.add(new THREE.Mesh(frameParts(OPENING_H * aspect), brass));
    scene.add(frame);
    const posterTex = posterTexture(c, font);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uLive: { value: null }, uIsLive: { value: 0 }, uPoster: { value: posterTex }, uRes: { value: new THREE.Vector2(1, 1) }, uAspect: { value: aspect }, uPosterAspect: { value: 1 }, uTime: { value: 0 }, uAccent: { value: col(c.accent) }, uWake: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uLive, uPoster; uniform float uIsLive, uAspect, uPosterAspect, uTime, uWake; uniform vec2 uRes; uniform vec3 uAccent; varying vec2 vUv;
        void main(){
          vec3 c;
          if (uIsLive > 0.5) c = texture2D(uLive, gl_FragCoord.xy / uRes).rgb;
          else {
            vec2 uv = vUv - 0.5;
            float r = uAspect / uPosterAspect;
            if (r > 1.0) uv.y /= r; else uv.x *= r;
            c = texture2D(uPoster, uv + 0.5).rgb * 0.85 * uWake;
            c += uAccent * 0.06 * (0.5 + 0.5 * sin(uTime * 0.7)) * uWake;
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
    const glow = makeGlow({ pos: [xOf(i), OPENING_Y + OPENING_H / 2 + 3.3, 1.2], size: 3.2, color: "#ffcf86", intensity: 1.6 });
    scene.add(glow.sprite);
    const shaft = makeShaft({ from: [xOf(i), 16.8, 5], to: [xOf(i), 0.5, 2.2], r0: 0.6, r1: 3.2, color: "#ffc77e", intensity: 0.05, noise: 0.7 });
    scene.add(shaft.mesh);
    disposers.push(() => { shaft.dispose(); glow.dispose(); plaqueTex.dispose(); (plaque.material as THREE.Material).dispose(); plaque.geometry.dispose(); mat.dispose(); (frame.children[0] as THREE.Mesh).geometry.dispose(); posterTex.dispose(); });
    doors.push({ frame, portal, mat, glow, shaft, plaque });
  });

  // Glass cases between the doorways, each era's hardware inside, softly lit.
  const caseGlows: ReturnType<typeof makeGlow>[] = [];
  const devices: Device[] = [];
  CASES.slice(0, Math.max(0, n - 1)).forEach((what, i) => {
    if (!what) return;
    const gc = makeGlassCase({ w: 1.8, h: 1.5, d: 1.2 });
    const x = xOf(i) + ARCH_SPACING / 2;
    gc.group.position.set(x, 0, 3.1);
    scene.add(gc.group);
    disposers.push(() => gc.dispose());
    if (what === "jar" || what === "zine" || what === "cards") {
      const ex = smallExhibit(what);
      ex.group.position.copy(gc.shelf);
      gc.group.add(ex.group);
      disposers.push(() => ex.dispose());
    } else {
      const d = makeDevice(what, { screenK: 0.9 });
      const s = 0.95 / Math.max(d.size[0], d.size[1]);
      d.group.scale.setScalar(s);
      d.group.position.set(0, gc.shelf.y + (d.size[1] * s) / 2 + 0.12, 0);
      d.group.rotation.x = -0.12;
      gc.group.add(d.group);
      devices.push(d);
      disposers.push(() => d.dispose());
    }
    const g = makeGlow({ pos: [x, 1.9, 3.1], size: 2.6, color: "#ffdca0", intensity: 0.45 });
    scene.add(g.sprite);
    caseGlows.push(g);
    disposers.push(() => g.dispose());
  });

  // Dust in the lamplight, and the prologue's firefly.
  const dust = makeParticles({ count: 900, shape: "box", center: [mid, 6, 9], extent: [len / 2 - 50, 6, 9], velocity: [0.05, -0.02, 0], spread: [0.08, 0.05, 0.08], life: 22, size: [0.03, 0.07], colors: ["#ffe6b0", "#ffd38a", "#fff0c8"], intensity: 1.3, turbulence: 0.6, fadeIn: 0.2, fadeOut: 0.3 });
  scene.add(dust.points);
  disposers.push(() => dust.dispose());
  const firefly = makeFirefly({ size: 0.28 });
  scene.add(firefly.group);
  disposers.push(() => firefly.dispose());

  const endWall = new THREE.Mesh(new THREE.PlaneGeometry(90, 30), wallMat);
  endWall.rotation.y = Math.PI / 2;
  endWall.position.set(xOf(-1) - 30, 15, 30);
  scene.add(endWall);

  const layout = () => {
    doors.forEach((d) => {
      const w = OPENING_H * aspect;
      const fm = d.frame.children[0] as THREE.Mesh;
      fm.geometry.dispose();
      fm.geometry = frameParts(w);
      d.portal.scale.set(w, OPENING_H, 1);
      d.mat.uniforms.uAspect.value = aspect;
      (d.frame.userData.plinth as THREE.Mesh).scale.set(w + 2.4, OPENING_BOTTOM + 0.4, 1.6);
    });
  };
  layout();

  // Where the film is in the hall, as the camera functions are asked (the prologue lights the lamps).
  let phase: { kind: "pro" | "walk" | "epi"; k: number } = { kind: "walk", k: 1 };
  const ref = (i: number, fov: number): Pose => {
    const d = (OPENING_H / 2) / Math.tan((fov * Math.PI) / 360) * 0.985;
    return { pos: [xOf(i), OPENING_Y, PORTAL_Z + d], look: [xOf(i), OPENING_Y, PORTAL_Z], fov };
  };

  return {
    scene,
    count: n,
    setAspect(a) {
      const next = Math.max(0.42, Math.min(2.4, a));
      if (Math.abs(next - aspect) < 1e-3) return;
      aspect = next;
      layout();
    },
    ref,
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
      dust.u.uPixel.value = 900 / (2 * Math.tan((cam.fov * Math.PI) / 360));
      // Lamps: in the prologue they come up one by one down the gallery; in the epilogue they dim.
      const k = phase.k;
      doors.forEach((d, i) => {
        let on = 1;
        if (phase.kind === "pro") on = ramp(k, 0.12 + i * 0.045, 0.26 + i * 0.045);
        else if (phase.kind === "epi") on = 1 - ramp(k, 0.55 + (n - 1 - i) * 0.03, 0.75 + (n - 1 - i) * 0.03) * 0.75;
        d.glow.set(i === 0 && phase.kind === "pro" ? "#e8f08a" : "#ffcf86", 1.6 * on);
        d.shaft.u.uOpacity.value = on;
        d.shaft.u.uTime.value = ambient;
        d.mat.uniforms.uTime.value = ambient;
        d.mat.uniforms.uWake.value = 0.15 + 0.85 * on;
        (d.plaque.material as THREE.MeshBasicMaterial).color.copy(col("#ffffff", 0.08 + 0.87 * on));
      });
      const all = phase.kind === "pro" ? ramp(k, 0.1, 0.6) : phase.kind === "epi" ? 1 - ramp(k, 0.5, 1) * 0.7 : 1;
      lamps.forEach((l) => { l.intensity = 80 * all; });
      hemi.intensity = 0.25 + 0.65 * all;
      key.intensity = 1.3 * all;
      caseGlows.forEach((g) => g.set("#ffdca0", 0.45 * (phase.kind === "epi" ? 1.4 : all)));
      // The firefly drifts across the dark at the very start, then toward the first doorway.
      const fk = phase.kind === "pro" ? k : 2;
      if (fk <= 1) {
        const p = poseOnPath([
          { t: 0, pos: [xOf(-1) - 10, 5.8, 21], look: [0, 0, 0], fov: 1 },
          { t: 0.35, pos: [xOf(-1) - 2, 6.4, 17], look: [0, 0, 0], fov: 1 },
          { t: 0.75, pos: [xOf(0) - 1.6, OPENING_Y + 1.2, 6], look: [0, 0, 0], fov: 1 },
          { t: 1, pos: [xOf(0), OPENING_Y + 0.4, 1.2], look: [0, 0, 0], fov: 1 },
        ], fk).pos;
        firefly.set([p[0] + Math.sin(ambient * 1.3) * 0.25, p[1] + Math.sin(ambient * 2.1) * 0.18, p[2]], 1 - ramp(fk, 0.85, 1), ambient);
      } else firefly.set([0, -50, 0], 0, ambient);
      devices.forEach((d) => d.screen.mesh.material instanceof THREE.MeshBasicMaterial && (d.screen.mesh.material.color.copy(col("#ffffff", 0.9 * (phase.kind === "pro" ? all : 1)))));
    },
    prologue(k, fovIn, hallFov) {
      phase = { kind: "pro", k };
      const r = ref(0, fovIn);
      const keys: Key[] = [
        { t: 0, pos: [xOf(-1) - 16, 5.6, 24], look: [xOf(2), 4.4, 0], fov: hallFov },
        { t: 0.42, pos: [xOf(-1) + 1, 5.2, 18.5], look: [xOf(1), 4.4, 0], fov: hallFov - 2 },
        { t: 0.76, pos: [xOf(0) - 2.4, OPENING_Y + 0.8, r.pos[2] + 7], look: [xOf(0), OPENING_Y, 0], fov: (hallFov - 2 + fovIn) / 2 },
        { t: 1, pos: r.pos, look: r.look, fov: fovIn },
      ];
      return poseOnPath(keys, k);
    },
    transition(i, k, fovOut, fovIn, hallFov) {
      phase = { kind: "walk", k };
      const a = ref(i, fovOut), b = ref(i + 1, fovIn);
      const midX = (xOf(i) + xOf(i + 1)) / 2;
      const keys: Key[] = [
        { t: 0, ...a },
        { t: 0.3, pos: [xOf(i) + 1.2, OPENING_Y + 0.7, a.pos[2] + 9.5], look: [xOf(i) + 3.5, OPENING_Y - 0.6, 0], fov: (fovOut + hallFov) / 2 },
        { t: 0.55, pos: [midX, OPENING_Y + 0.6, Math.max(a.pos[2], b.pos[2]) + 11], look: [midX + 1, 2.2, 3], fov: hallFov },
        { t: 0.8, pos: [xOf(i + 1) - 1, OPENING_Y + 0.45, b.pos[2] + 6.5], look: [xOf(i + 1), OPENING_Y, 0], fov: (hallFov + fovIn) / 2 },
        { t: 1, ...b },
      ];
      return poseOnPath(keys, k);
    },
    epilogue(i, k, fovOut, hallFov) {
      phase = { kind: "epi", k };
      const a = ref(i, fovOut);
      const keys: Key[] = [
        { t: 0, ...a },
        { t: 0.35, pos: [xOf(i) - 1.5, OPENING_Y + 1.6, a.pos[2] + 13], look: [xOf(i) - 4, OPENING_Y, 0], fov: hallFov },
        { t: 1, pos: [xOf(i) + 10, 12.5, 46], look: [xOf(i) - 70, 3, 0], fov: hallFov + 4 },
      ];
      return poseOnPath(keys, k);
    },
    dispose() {
      disposers.forEach((d) => d());
      [floor, runner, wall, ceiling, pilasters, wains, beamMesh, rail, endWall].forEach((m) => m.geometry.dispose());
      [floorMat, wallMat, woodDark, brass, plinthMat, runner.material as THREE.Material, ceiling.material as THREE.Material].forEach((m) => m.dispose());
      wood.dispose();
      portalGeo.dispose();
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.name === "plinth") m.geometry.dispose(); });
      scene.environment?.dispose();
    },
  };
}
