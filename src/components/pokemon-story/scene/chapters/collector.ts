import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeGlow, makeParticles, makeShaft, makeSky, makeTerrain, merge, noise2, placed, ramp, rng, stoneMaterial } from "@/components/world-history/scene/kit";
import { makeCity } from "@/components/world-history/scene/props";
import { figureStyle, lights, loadFigures, lookAt, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { glassMaterial, makeFireflies, makeFirefly, makeGrass, makeSilhouette } from "../story-kit";
import { bag, STOCK } from "./base";

/**
 * I. The Collector. Machida in the 1970s at golden hour: knee-high grass in
 * the wind, a pond, woods with light coming through; a boy's silhouette
 * with a net; a stone that tips to show what slept under it; fireflies, and
 * the jar (slow motion). Then the seasons turn, the grass sinks, the city
 * rises and the colour drains, until one firefly is left above an empty
 * street, and for a moment its glow outlines a Caterpie.
 */

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tFields = B("fields"), tBug = B("dr-bug"), tLearn = B("learned"), tJar = B("jar"), tPaved = B("paved"), tKept = B("kept");

  scene.fog = new THREE.FogExp2(col("#6a4028"), 0.0062);
  const sky = D.add(makeSky({ top: "#2f3d78", horizon: "#e8904a", bottom: "#2a1a0e", sunDir: [0.15, 0.06, -1], sunColor: "#ffd27a", sunSize: 1400, sunGlow: 0.55, nebula: 0 }));
  scene.add(sky.mesh);
  const L = lights(scene, { sky: "#ffd9a8", ground: "#3a2410", fill: 0.7, key: "#ffc070", keyK: 2.4, keyPos: [10, 6, -30], rim: "#ffdca0", rimK: 1.2, rimPos: [-8, 5, -25] });

  // Rolling fields with a pond.
  const nz = noise2(3);
  const pond = { x: -5, z: -3, r: 4.2 };
  const height = (x: number, z: number) => {
    const d = Math.hypot(x - pond.x, z - pond.z);
    const bowl = d < pond.r + 2 ? -0.35 * (1 - ramp(d, pond.r - 1, pond.r + 2)) : 0;
    return nz.fbm(x * 0.03, z * 0.03, 4) * 3 - 1.2 + bowl + Math.max(0, -z - 40) * 0.04;
  };
  const terrain = D.add(makeTerrain({ size: [220, 220], segments: ctx.q.grid, height, color: (h) => { const k = Math.max(0, Math.min(1, (h + 1.5) / 3)); return [0.2 + 0.12 * k, 0.24 + 0.1 * k, 0.08]; } }));
  scene.add(terrain.mesh);
  const pondMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSky: { value: col("#ffc070") }, uTop: { value: col("#2f3d78") }, uDeep: { value: col("#2a2418") }, uSun: { value: col("#ffd27a") }, uFade: { value: 1 } },
    transparent: true,
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFade; uniform vec3 uSky, uTop, uDeep, uSun; varying vec3 vW;
      void main(){
        vec2 p = vW.xz - vec2(${pond.x.toFixed(1)}, ${pond.z.toFixed(1)});
        float r = length(p);
        // Ripples spreading from a few points (a fish, a skater), never a hard ring.
        float rip = 0.0;
        for (int i = 0; i < 3; i++) {
          vec2 c0 = vec2(sin(float(i) * 2.1) * 1.6, cos(float(i) * 1.7) * 1.4);
          float d = length(p - c0);
          float ph = fract(uTime * 0.18 + float(i) * 0.33);
          rip += sin(clamp(d - ph * 3.5, -0.6, 0.6) * 10.5) * (1.0 - ph) * smoothstep(0.6, 0.0, abs(d - ph * 3.5));
        }
        float edge = 1.0 - smoothstep(${(pond.r - 1.4).toFixed(1)}, ${pond.r.toFixed(1)}, r);
        vec3 v = normalize(cameraPosition - vW);
        vec3 n = normalize(vec3(rip * 0.06, 1.0, rip * 0.05));
        vec3 rd = reflect(-v, n);
        float up = clamp(rd.y, 0.0, 1.0);
        vec3 sky = mix(uSky * 1.25, uTop, sqrt(up));
        float fy = clamp(1.0 - max(dot(v, n), 0.0), 0.0, 1.0);
        float fres = 0.12 + 0.88 * fy * fy * fy * fy;
        // The sun's glitter: a long streak toward the camera.
        vec3 sd = normalize(vec3(0.15, 0.05, -1.0));
        float g = max(dot(rd, sd), 0.0);
        float glint = g * g; glint *= glint; glint *= glint; glint *= glint; glint *= glint;
        vec3 c = mix(uDeep, sky, fres) + uSun * glint * 3.0;
        gl_FragColor = vec4(c, edge * 0.95 * uFade);
      }`,
  });
  const pondMesh = new THREE.Mesh(new THREE.CircleGeometry(pond.r + 0.2, 48).rotateX(-Math.PI / 2), pondMat);
  pondMesh.position.set(pond.x, Math.max(-0.25, height(pond.x, pond.z) + 0.06), pond.z);
  scene.add(pondMesh);
  D.add({ dispose: () => { pondMesh.geometry.dispose(); pondMat.dispose(); } });

  // Tall grass, clear of the pond.
  const grass = D.add(makeGrass({ count: Math.round(26000 * ctx.q.particles) + 3000, center: [0, 0, 2], size: [46, 40], height: [0.5, 1.15], base: "#0c1206", tip: "#a89a44", seed: 3, clear: { x: pond.x, z: pond.z, r: pond.r } }));
  grass.mesh.position.y = 0;
  scene.add(grass.mesh);
  // The blades stand on the terrain: sample its height under the grass centre (the field is gentle).
  grass.mesh.position.y = height(0, 2) * 0.6;
  grass.u.uSunDir.value.set(0.15, 0.06, -1).normalize();
  grass.u.uSun.value.copy(col("#ffb860"));

  // Woods behind, with light coming through.
  // Woods: one mesh for trunks, one for crowns (clusters of lumps), with a gap where the sun goes down behind the jar.
  const trees = new THREE.Group();
  const r = rng(12);
  const trunkMat = new THREE.MeshStandardMaterial({ color: col("#24160a"), roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: col("#34401a"), roughness: 0.85 });
  const trunkG: THREE.BufferGeometry[] = [], crownG: THREE.BufferGeometry[] = [];
  const sunGap = (x: number, z: number) => Math.abs(x - 0.15 * (9 - z)) < 7 + (9 - z) * 0.08;
  for (let i = 0, made = 0; i < 160 && made < 64; i++) {
    const x = (r() - 0.5) * 140, z = -24 - r() * 52;
    if (sunGap(x, z)) continue;
    made++;
    const s = 0.75 + r() * 1.0;
    const y0 = height(x, z);
    trunkG.push(placed(new THREE.CylinderGeometry(0.22, 0.42, 7, 7), [x, y0 + 3.5 * s, z], 0, [s, s, s], (r() - 0.5) * 0.08));
    const lumps = 3 + Math.floor(r() * 3);
    for (let j = 0; j < lumps; j++) {
      const a = r() * Math.PI * 2, d = r() * 1.9 * s;
      crownG.push(placed(new THREE.IcosahedronGeometry(1.9 + r() * 1.2, 1), [x + Math.cos(a) * d, y0 + (6.4 + r() * 2.6) * s, z + Math.sin(a) * d * 0.6], r() * 3, [s * (1 + r() * 0.3), s * (0.8 + r() * 0.4), s]));
    }
  }
  const trunkMesh = new THREE.Mesh(merge(trunkG), trunkMat);
  const crownMesh = new THREE.Mesh(merge(crownG), leafMat);
  trunkG.concat(crownG).forEach((g) => g.dispose());
  trees.add(trunkMesh, crownMesh);
  scene.add(trees);
  D.add({ dispose: () => { trunkMesh.geometry.dispose(); crownMesh.geometry.dispose(); trunkMat.dispose(); leafMat.dispose(); } });
  // Gold dust hanging in the low sun.
  const dust = D.add(makeParticles({ count: Math.round(520 * ctx.q.particles) + 60, shape: "box", center: [0, 2.2, 2], extent: [16, 2.2, 12], velocity: [0.05, 0.02, 0], spread: [0.04, 0.03, 0.04], life: 12, size: [0.012, 0.03], colors: ["#ffe2a0", "#ffd080", "#ffb860"], intensity: 1.5, turbulence: 0.6, fadeIn: 0.3, fadeOut: 0.3, seed: 41 }));
  scene.add(dust.points);
  const shafts = [-14, -3, 9].map((x, i) => D.add(makeShaft({ from: [x, 22, -34], to: [x * 0.6 + 2, -0.5, 2 - i * 3], r0: 1.2, r1: 5, color: "#ffd690", intensity: 0.085, noise: 0.8 })));
  shafts.forEach((s) => scene.add(s.mesh));

  // Beetles: small dark clusters climbing the stems (drawn normally, not as light).
  const beetles = D.add(makeParticles({ count: Math.round(260 * ctx.q.particles) + 40, shape: "box", center: [1, 0.5, 4], extent: [7, 0.4, 4], velocity: [0, 0.08, 0], spread: [0.02, 0.04, 0.02], life: 9, size: [0.05, 0.09], colors: ["#120c06", "#1a1208", "#0c0804"], intensity: 1, additive: false, fadeIn: 0.2, fadeOut: 0.2, seed: 5 }));
  scene.add(beetles.points);

  // The boy with his net, backlit.
  const boy = D.add(makeSilhouette({ height: 1.35, pose: "net", child: true, rim: "#ffcf7a" }));
  scene.add(boy.mesh);

  // The stone that tips over, and what was sleeping under it.
  const stoneMat = stoneMaterial({ color: "#a08c72", roughness: 0.92, dirt: 0.6 });
  const stoneGeo = new THREE.DodecahedronGeometry(0.46, 2);
  stoneGeo.scale(1.25, 0.78, 1);
  { const pa = stoneGeo.getAttribute("position"); const nz2 = noise2(9); for (let i = 0; i < pa.count; i++) { const k = 1 + nz2.fbm(pa.getX(i) * 3, pa.getZ(i) * 3 + pa.getY(i) * 2, 3) * 0.22; pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k, pa.getZ(i) * k); } stoneGeo.computeVertexNormals(); }
  const stone = new THREE.Mesh(stoneGeo, stoneMat);
  const stonePivot = new THREE.Group();
  stonePivot.position.set(2.6, height(2.6, 5) * 0.6 + 0.05, 5);
  stone.position.set(-0.6, 0.28, 0);
  stonePivot.add(stone);
  scene.add(stonePivot);
  D.add({ dispose: () => { stoneGeo.dispose(); stoneMat.dispose(); } });
  const beetleGlow = D.add(makeGlow({ pos: [2.0, stonePivot.position.y + 0.12, 5], size: 0.9, color: "#cfff7a", intensity: 0 }));
  scene.add(beetleGlow.sprite);
  const beetleBody = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8).scale(1, 0.55, 1.5), new THREE.MeshStandardMaterial({ color: col("#1b2a10"), emissive: col("#9fe04a"), emissiveIntensity: 0, roughness: 0.3, metalness: 0.5 }));
  beetleBody.position.set(2.0, stonePivot.position.y + 0.07, 5);
  scene.add(beetleBody);
  D.add({ dispose: () => { beetleBody.geometry.dispose(); (beetleBody.material as THREE.Material).dispose(); } });

  const found = D.add(makeParticles({ count: 40, shape: "disc", center: [2.0, stonePivot.position.y + 0.1, 5], extent: [0.25, 0.05, 0.25], velocity: [0, 0.35, 0], spread: [0.12, 0.1, 0.12], life: 2.6, size: [0.01, 0.025], colors: ["#f2ff9a", "#cfff7a", "#9fe04a"], intensity: 2.4, turbulence: 0.25, seed: 17 }));
  scene.add(found.points);

  // Fireflies over the field at dusk.
  const swarm = D.add(makeFireflies({ count: Math.round(420 * ctx.q.particles) + 60, center: [0, 1.6, 2], extent: [18, 1.4, 12], seed: 7 }));
  scene.add(swarm.points);

  // The jar, close in the foreground, with fireflies inside.
  const jarAt: Vec3 = [0, 0.85, 9];
  // It stands on an old fence post above the grass.
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.6, 10), new THREE.MeshStandardMaterial({ color: col("#3a2814"), roughness: 0.95 }));
  post.position.set(jarAt[0], jarAt[1] - 0.8, jarAt[2]);
  scene.add(post);
  D.add({ dispose: () => { post.geometry.dispose(); (post.material as THREE.Material).dispose(); } });
  const jar = new THREE.Group();
  jar.position.set(...jarAt);
  const glass = glassMaterial({ edge: "#ffe2a8", k: 1.1 });
  const prof = [[0.2, 0.0], [0.27, 0.0], [0.31, 0.02], [0.33, 0.08], [0.335, 0.5], [0.325, 0.62], [0.28, 0.72], [0.22, 0.78], [0.215, 0.84], [0.232, 0.86], [0.232, 0.9]].map(([x, y]) => new THREE.Vector2(x, y));
  const jarBody = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), glass);
  jarBody.position.y = 0.0;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.07, 32), new THREE.MeshStandardMaterial({ color: col("#9a7440"), metalness: 0.75, roughness: 0.35 }));
  lid.position.y = 0.92;
  const rimLight = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.006, 6, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: col("#ffd890", 0.9) }));
  rimLight.position.y = 0.955;
  jar.add(jarBody, lid, rimLight);
  scene.add(jar);
  D.add({ dispose: () => { jarBody.geometry.dispose(); lid.geometry.dispose(); rimLight.geometry.dispose(); glass.dispose(); (lid.material as THREE.Material).dispose(); (rimLight.material as THREE.Material).dispose(); } });
  const inJar = D.add(makeParticles({ count: 34, shape: "box", center: [jarAt[0], jarAt[1] + 0.4, jarAt[2]], extent: [0.2, 0.26, 0.2], velocity: [0, 0.015, 0], spread: [0.03, 0.02, 0.03], life: 9, size: [0.035, 0.07], colors: ["#e6ff8a", "#f6ffb0", "#ffe27a"], intensity: 4.2, turbulence: 0.1, flicker: 0.35, fadeIn: 0.08, fadeOut: 0.08, seed: 9 }));
  inJar.u.uTurb.value = 0.08;
  inJar.u.uVel.value.set(0, 0.004, 0);
  scene.add(inJar.points);
  const jarGlow = D.add(makeGlow({ pos: [jarAt[0], jarAt[1] + 0.4, jarAt[2]], size: 0.9, color: "#e8ff9a", intensity: 0 }));
  scene.add(jarGlow.sprite);
  // Out-of-focus fireflies between the lens and the jar (the slow-motion bokeh).
  const bokeh = [[-0.55, 1.75, 10.4, 0.28], [0.75, 1.05, 10.1, 0.22], [-0.25, 0.75, 10.9, 0.34], [0.95, 1.95, 9.6, 0.18], [-1.1, 1.3, 9.2, 0.2]].map(([x, y, z, s]) => { const g = D.add(makeGlow({ pos: [x, y, z], size: s, color: "#e6ff8a", intensity: 0 })); scene.add(g.sprite); return g; });

  // The city that grows over the fields, and the road it leaves.
  // Blocks either side of a street (the camera's path stays clear).
  const blocks = ([[-27, 2, 15], [27, 6, 15], [-24, -40, 18], [24, -44, 18], [0, -70, 20]] as [number, number, number][]).map(([x, z, rad], i) => D.add(makeCity({ center: [x, -0.2, z], radius: rad, count: 46, height: [5, 24], color: "#7a4a1e", seed: 6 + i })));
  const city = { u: blocks[0].u, all: blocks };
  const cityGroup = new THREE.Group();
  blocks.forEach((b) => cityGroup.add(b.mesh));
  scene.add(cityGroup);
  const roadMat = new THREE.MeshStandardMaterial({ color: col("#2a2a2e"), roughness: 0.85, transparent: true, opacity: 0 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 80).rotateX(-Math.PI / 2), roadMat);
  road.position.set(0, 0.35, 0);
  scene.add(road);
  D.add({ dispose: () => { road.geometry.dispose(); roadMat.dispose(); } });
  const lampAt = [[3.9, -14], [-3.9, -7], [3.9, 0], [-3.9, 6]];
  const poleMat = new THREE.MeshStandardMaterial({ color: col("#141418"), roughness: 0.6, metalness: 0.4 });
  const poles = new THREE.Mesh(merge(lampAt.flatMap(([x, z]) => [placed(new THREE.CylinderGeometry(0.06, 0.09, 4.4, 6), [x, 2.55, z]), placed(new THREE.BoxGeometry(0.9, 0.08, 0.16), [x - Math.sign(x) * 0.4, 4.7, z])])), poleMat);
  scene.add(poles);
  const poolMat = new THREE.MeshBasicMaterial({ map: (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })(), color: col("#ffb860", 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const pools = new THREE.Mesh(merge(lampAt.map(([x, z]) => placed(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), [x - Math.sign(x) * 0.8, 0.37, z]))), poolMat);
  scene.add(pools);
  D.add({ dispose: () => { poles.geometry.dispose(); poleMat.dispose(); pools.geometry.dispose(); poolMat.map?.dispose(); poolMat.dispose(); } });
  const lampGlows = lampAt.map(([x, z]) => { const g = D.add(makeGlow({ pos: [x - Math.sign(x) * 0.8, 4.62, z], size: 1.2, color: "#ffcf80", intensity: 0 })); scene.add(g.sprite); return g; });

  // The last firefly, and the shape it outlines.
  const last = D.add(makeFirefly({ size: 0.4 }));
  scene.add(last.group);
  const figs = await loadFigures(ctx, [10]);
  const cat = figs.get(10);
  if (cat) {
    cat.setHeight(0.78);
    cat.group.position.set(0.3, 1.18, 10.0);
    scene.add(cat.group);
    figureStyle(cat, { shadow: 1, rim: "#e6ff8a", rimK: 2.2, dissolve: 0, edge: "#e6ff8a" });
  }

  const skyDay = { top: col("#2f3d78"), hor: col("#e8904a"), bot: col("#2a1a0e") };
  const skyGrey = { top: col("#2a2d36"), hor: col("#6c6460"), bot: col("#18171a") };
  const skyNight = { top: col("#0b1024"), hor: col("#3a2a2a"), bot: col("#0a0808") };

  const keys: Key[] = [
    { t: 0, pos: [-12, 1.05, 16], look: [-5, 0.9, 4], fov: 46 },
    { t: tFields + 2, pos: [-7, 1.0, 12], look: [-2, 1.0, 0], fov: 44 },
    { t: tBug, pos: [-3, 1.0, 10.5], look: [0, 0.9, 2], fov: 42 },
    { t: tLearn - 0.4, pos: [0.5, 1.4, 9.5], look: [2, 0.4, 5], fov: 40 },
    { t: tLearn + 3, pos: [2.9, 0.75, 7.0], look: [2.1, 0.2, 5], fov: 34 },
    { t: tJar - 0.2, pos: [1.3, 1.6, 11.6], look: [0, 1.25, 8.8], fov: 36 },
    { t: tJar + 4.5, pos: [0.55, 1.4, 10.6], look: [0, 1.3, 9], fov: 30 },
    { t: tPaved + 0.5, pos: [0, 3, 16], look: [0, 2, 4], fov: 44 },
    { t: tKept - 0.4, pos: [0, 12, 30], look: [0, 4, -2], fov: 48 },
    { t: tKept + 1.5, pos: [0.4, 2.0, 15], look: [0.2, 1.8, 9], fov: 40 },
    { t: end, pos: [0.3, 1.7, 12.6], look: [0.3, 1.55, 10], fov: 36 },
  ];
  const lastPath: Key[] = [
    { t: tKept - 0.5, pos: [6, 5, 0], look: [0, 0, 0], fov: 1 },
    { t: tKept + 2, pos: [1.5, 2.6, 7], look: [0, 0, 0], fov: 1 },
    { t: tKept + 4.5, pos: [0.3, 1.75, 10.2], look: [0, 0, 0], fov: 1 },
    { t: end, pos: [0.25, 1.7, 11.2], look: [0, 0, 0], fov: 1 },
  ];

  return {
    scene,
    portalScale: 1.4,
    camera: (t) => poseOnPath(keys, t),
    orbit: (t) => {
      const p = poseOnPath(keys, t);
      return { target: p.look, limits: { yaw0: 0, yawSpan: 1.0, minPitch: -0.05, maxPitch: 1.1, minDist: 1.2, maxDist: 40 } };
    },
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      const paved = ramp(t, tPaved - 0.2, tPaved + 4.2);
      const dusk = ramp(t, tLearn + 1, tJar + 1);
      const night = ramp(t, tKept - 1, tKept + 2);
      // Sky: golden hour → dusk → grey city → night.
      const top = skyDay.top.clone().lerp(skyNight.top, dusk * 0.6).lerp(skyGrey.top, paved * 0.8).lerp(skyNight.top, night);
      const hor = skyDay.hor.clone().lerp(col("#ff8a4a"), dusk * 0.7).lerp(skyGrey.hor, paved).lerp(skyNight.hor, night);
      const bot = skyDay.bot.clone().lerp(skyGrey.bot, paved).lerp(skyNight.bot, night);
      sky.u.uTop.value.copy(top);
      sky.u.uHorizon.value.copy(hor);
      sky.u.uBottom.value.copy(bot);
      sky.u.uSunGlow.value = 0.55 * (1 - paved * 0.85);
      sky.u.uSunDir.value.set(0.15, 0.06 - dusk * 0.05, -1).normalize();
      (scene.fog as THREE.FogExp2).color.copy(hor.clone().multiplyScalar(0.45));
      L.key.intensity = 2.4 * (1 - paved * 0.6) * (1 - night * 0.6);
      L.hemi.intensity = 0.7 * (1 - night * 0.5);
      grass.u.uTime.value = ambient;
      grass.u.uSink.value = paved;
      grass.u.uSat.value = 1 - paved * 0.7;
      grass.mesh.visible = paved < 0.999;
      pondMat.uniforms.uTime.value = ambient;
      pondMat.uniforms.uSky.value.copy(hor);
      pondMat.uniforms.uTop.value.copy(top);
      dust.u.uTime.value = ambient;
      dust.u.uPixel.value = px;
      dust.u.uOpacity.value = (1 - paved) * (1 - dusk * 0.55);
      trees.scale.y = Math.max(0.001, 1 - paved * 0.92);
      trees.visible = paved < 0.995;
      pondMat.uniforms.uFade.value = 1 - ramp(t, tPaved, tPaved + 2.5);
      shafts.forEach((s, i) => { s.u.uTime.value = ambient; s.u.uOpacity.value = (1 - dusk * 0.7) * (1 - paved) * (0.7 + 0.3 * Math.sin(ambient * 0.3 + i)); });
      beetles.u.uTime.value = ambient;
      beetles.u.uPixel.value = px;
      beetles.u.uOpacity.value = ramp(t, tBug - 0.5, tBug + 1) * (1 - ramp(t, tJar, tJar + 2));
      // The boy crosses the frame with his net during "Dr. Bug".
      const walk = ramp(t, tBug - 0.6, tBug + 5);
      boy.mesh.position.set(-6 + walk * 9, height(0, 1.5) * 0.6, 1.4 + Math.sin(walk * 3) * 0.3);
      boy.mesh.rotation.y = Math.PI / 2 - 0.25;
      boy.mesh.visible = t > tBug - 1 && t < tLearn + 1.5;
      boy.setRim("#ffcf7a", 1.8);
      // The stone tips over to show the beetle sleeping under it.
      const tip = ramp(t, tLearn + 1.2, tLearn + 2.6);
      stonePivot.rotation.z = tip * 1.9;
      const gone = 1 - ramp(t, tJar - 1.2, tJar - 0.2);
      beetleGlow.set("#cfff7a", 2.6 * tip * gone * (0.8 + 0.2 * Math.sin(ambient * 3)));
      (beetleBody.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.8 * tip;
      beetleBody.visible = stonePivot.visible = paved < 0.6;
      found.u.uTime.value = ambient;
      found.u.uPixel.value = px;
      found.u.uOpacity.value = ramp(t, tLearn + 1.8, tLearn + 2.8) * gone;
      // Fireflies rise as dusk falls, then go out one by one as the city grows.
      swarm.u.uTime.value = ambient;
      swarm.u.uPixel.value = px;
      const fade = 1 - ramp(t, tPaved + 0.5, tPaved + 4);
      swarm.u.uOpacity.value = ramp(t, tLearn + 1.6, tLearn + 4) * fade;
      // The jar catches the sunset; the fireflies in it glow.
      const jarOn = ramp(t, tJar - 1.2, tJar) * (1 - ramp(t, tPaved - 0.5, tPaved + 1));
      jar.visible = post.visible = jarOn > 0.01;
      inJar.u.uTime.value = ambient;
      inJar.u.uPixel.value = px;
      inJar.u.uOpacity.value = jarOn;
      jarGlow.set("#e8ff9a", 0.6 * jarOn * (0.85 + 0.15 * Math.sin(ambient * 2.3)));
      bokeh.forEach((g, i) => g.set("#e6ff8a", 0.55 * jarOn * ramp(t, tJar - 0.4, tJar + 0.6) * (0.6 + 0.4 * Math.sin(ambient * (1.3 + i * 0.4) + i * 2))));
      // The city rises around the camera; the road takes the field.
      cityGroup.scale.set(1, Math.max(0.001, paved), 1);
      cityGroup.visible = paved > 0.001;
      city.all.forEach((b) => { b.u.uLit.value = 0.1 + night * 0.22; b.u.uTime.value = ambient; });
      poles.visible = paved > 0.4;
      poles.scale.y = Math.max(0.001, ramp(paved, 0.4, 1));
      poolMat.color.copy(col("#ffb860", 0.32 * ramp(t, tKept - 0.5, tKept + 1.2)));
      roadMat.opacity = ramp(t, tPaved + 1.5, tPaved + 4);
      lampGlows.forEach((g, i) => g.set("#ffcf80", 0.9 * ramp(t, tKept - 0.5 + i * 0.4, tKept + 0.5 + i * 0.4)));
      terrain.mesh.visible = true;
      // The last firefly drifts toward us, and for a few frames its glow outlines a Caterpie.
      const lk = ramp(t, tKept - 0.5, tKept + 0.5) * (1 - ramp(t, end - 0.8, end));
      last.set(poseOnPath(lastPath, Math.max(tKept - 0.5, t)).pos, lk, ambient);
      if (cat) {
        // Its glow outlines the shape for a moment: a dark silhouette, lit only at the rim.
        const show = ramp(t, tKept + 3.6, tKept + 4.1) * (1 - ramp(t, tKept + 5.6, tKept + 6.4));
        figureStyle(cat, { dissolve: show > 0.001 ? 1 : 0, rimK: 2.2 * show, glowK: 0, shadow: 1 });
        cat.group.rotation.y = -0.12 + Math.sin(ambient * 0.5) * 0.05;
      }
    },
    look: (t) =>
      lookAt(t, { ...STOCK.film70s, lift: [0.024, 0.014, 0.005], contrast: 1.12 }, {
        exposure: [[0, 0.82], [tJar, 0.9], [tJar + 3, 1.0], [tPaved + 1, 0.9], [tKept, 0.85], [end, 0.9]],
        bloom: [[0, 0.6], [tJar - 0.5, 0.75], [tJar + 1.5, 1.05], [tJar + 4, 0.8], [tPaved + 2, 0.55], [tKept + 3, 0.9], [end, 0.8]],
        saturation: [[0, 0.95], [tPaved, 0.95], [tPaved + 3.5, 0.35], [tKept + 2, 0.45], [end, 0.6]],
        gain: [[0, [1.12, 1.0, 0.8]], [tPaved, [1.12, 1.0, 0.8]], [tPaved + 3.5, [0.98, 0.98, 1.0]], [tKept + 3, [1.06, 1.0, 0.88]]],
        rays: [[0, 0.5], [tLearn, 0.6], [tJar, 0.35], [tPaved + 2, 0]],
        fade: [[0, 0.6], [1.2, 0], [end - 0.6, 0], [end, 0.25]],
        grain: [[0, 0.12], [end, 0.1]],
      }, { pos: [30, 8, -200], color: [1, 0.82, 0.55] }),
    dispose() {
      D.dispose();
      figs.forEach((f) => f.dispose());
    },
  };
};

