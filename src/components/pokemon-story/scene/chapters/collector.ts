import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeGlow, makeParticles, makeShaft, makeSky, makeTerrain, noise2, ramp, rng } from "@/components/world-history/scene/kit";
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

  scene.fog = new THREE.FogExp2(col("#7a5030"), 0.009);
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
    uniforms: { uTime: { value: 0 }, uSky: { value: col("#ffc070") }, uDeep: { value: col("#1d2a2a") }, uFade: { value: 1 } },
    transparent: true,
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFade; uniform vec3 uSky, uDeep; varying vec3 vW;
      void main(){
        vec2 p = vW.xz - vec2(${pond.x.toFixed(1)}, ${pond.z.toFixed(1)});
        float r = length(p);
        float ring = 0.5 + 0.5 * sin(r * 7.0 - uTime * 2.2);
        float edge = smoothstep(${pond.r.toFixed(1)}, ${(pond.r - 0.8).toFixed(1)}, r);
        vec3 v = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(v.y, 0.0), 3.0);
        vec3 c = mix(uDeep, uSky * 1.4, 0.35 + 0.65 * fres) + uSky * ring * 0.08;
        gl_FragColor = vec4(c, edge * 0.92 * uFade);
      }`,
  });
  const pondMesh = new THREE.Mesh(new THREE.CircleGeometry(pond.r + 0.2, 48).rotateX(-Math.PI / 2), pondMat);
  pondMesh.position.set(pond.x, -0.25, pond.z);
  scene.add(pondMesh);
  D.add({ dispose: () => { pondMesh.geometry.dispose(); pondMat.dispose(); } });

  // Tall grass, clear of the pond.
  const grass = D.add(makeGrass({ count: Math.round(26000 * ctx.q.particles) + 3000, center: [0, 0, 2], size: [46, 40], height: [0.5, 1.15], base: "#16200a", tip: "#8f8436", seed: 3, clear: { x: pond.x, z: pond.z, r: pond.r } }));
  grass.mesh.position.y = 0;
  scene.add(grass.mesh);
  // The blades stand on the terrain: sample its height under the grass centre (the field is gentle).
  grass.mesh.position.y = height(0, 2) * 0.6;

  // Woods behind, with light coming through.
  const trees = new THREE.Group();
  const r = rng(12);
  const trunkMat = new THREE.MeshStandardMaterial({ color: col("#2a1a0c"), roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: col("#2c3a16"), roughness: 0.9 });
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, 6, 8);
  const crown = new THREE.IcosahedronGeometry(3, 1);
  for (let i = 0; i < 46; i++) {
    const x = (r() - 0.5) * 120, z = -26 - r() * 40;
    const s = 0.8 + r() * 0.9;
    const t = new THREE.Mesh(trunk, trunkMat);
    t.position.set(x, height(x, z) + 3 * s, z);
    t.scale.setScalar(s);
    const c = new THREE.Mesh(crown, leafMat);
    c.position.set(x, height(x, z) + 7 * s, z);
    c.scale.set(s * (1 + r() * 0.4), s * (0.9 + r() * 0.5), s);
    trees.add(t, c);
  }
  scene.add(trees);
  D.add({ dispose: () => { trunk.dispose(); crown.dispose(); trunkMat.dispose(); leafMat.dispose(); } });
  const shafts = [-14, -3, 9].map((x, i) => D.add(makeShaft({ from: [x, 22, -34], to: [x * 0.6 + 2, -0.5, 2 - i * 3], r0: 1.2, r1: 5, color: "#ffd690", intensity: 0.06, noise: 0.8 })));
  shafts.forEach((s) => scene.add(s.mesh));

  // Beetles: small dark clusters climbing the stems (drawn normally, not as light).
  const beetles = D.add(makeParticles({ count: Math.round(260 * ctx.q.particles) + 40, shape: "box", center: [1, 0.5, 4], extent: [7, 0.4, 4], velocity: [0, 0.08, 0], spread: [0.02, 0.04, 0.02], life: 9, size: [0.05, 0.09], colors: ["#120c06", "#1a1208", "#0c0804"], intensity: 1, additive: false, fadeIn: 0.2, fadeOut: 0.2, seed: 5 }));
  scene.add(beetles.points);

  // The boy with his net, backlit.
  const boy = D.add(makeSilhouette({ height: 1.35, pose: "net", child: true, rim: "#ffcf7a" }));
  scene.add(boy.mesh);

  // The stone that tips over, and what was sleeping under it.
  const stoneMat = new THREE.MeshStandardMaterial({ color: col("#5a5046"), roughness: 0.95 });
  const stoneGeo = new THREE.DodecahedronGeometry(0.55, 1);
  stoneGeo.scale(1.3, 0.55, 1);
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
  const jarBody = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.9, 32, 1, true), glass);
  jarBody.position.y = 0.45;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.09, 32), new THREE.MeshStandardMaterial({ color: col("#8b6a3c"), metalness: 0.6, roughness: 0.4 }));
  lid.position.y = 0.94;
  const rimLight = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.012, 6, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: col("#ffd890", 3) }));
  rimLight.position.y = 0.88;
  jar.add(jarBody, lid, rimLight);
  scene.add(jar);
  D.add({ dispose: () => { jarBody.geometry.dispose(); lid.geometry.dispose(); rimLight.geometry.dispose(); glass.dispose(); (lid.material as THREE.Material).dispose(); (rimLight.material as THREE.Material).dispose(); } });
  const inJar = D.add(makeFireflies({ count: 14, center: [jarAt[0], jarAt[1] + 0.45, jarAt[2]], extent: [0.18, 0.28, 0.18], seed: 9, intensity: 2.2 }));
  inJar.u.uSize0.value = 0.012;
  inJar.u.uSize1.value = 0.024;
  inJar.u.uTurb.value = 0.12;
  inJar.u.uVel.value.set(0, 0.02, 0);
  scene.add(inJar.points);
  const jarGlow = D.add(makeGlow({ pos: [jarAt[0], jarAt[1] + 0.5, jarAt[2]], size: 0.8, color: "#e8ff9a", intensity: 0 }));
  scene.add(jarGlow.sprite);

  // The city that grows over the fields, and the road it leaves.
  // Blocks either side of a street (the camera's path stays clear).
  const blocks = ([[-27, 2, 15], [27, 6, 15], [-24, -40, 18], [24, -44, 18], [0, -70, 20]] as [number, number, number][]).map(([x, z, rad], i) => D.add(makeCity({ center: [x, -0.2, z], radius: rad, count: 46, height: [5, 24], color: "#b08a5a", seed: 6 + i })));
  const city = { u: blocks[0].u, all: blocks };
  const cityGroup = new THREE.Group();
  blocks.forEach((b) => cityGroup.add(b.mesh));
  scene.add(cityGroup);
  const roadMat = new THREE.MeshStandardMaterial({ color: col("#2a2a2e"), roughness: 0.85, transparent: true, opacity: 0 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 80).rotateX(-Math.PI / 2), roadMat);
  road.position.set(0, 0.35, 0);
  scene.add(road);
  D.add({ dispose: () => { road.geometry.dispose(); roadMat.dispose(); } });
  const lampGlows = [-12, -4, 4].map((z) => { const g = D.add(makeGlow({ pos: [3.8, 4.2, z], size: 3, color: "#ffcf80", intensity: 0 })); scene.add(g.sprite); return g; });

  // The last firefly, and the shape it outlines.
  const last = D.add(makeFirefly({ size: 0.32 }));
  scene.add(last.group);
  const figs = await loadFigures(ctx, [10]);
  const cat = figs.get(10);
  if (cat) {
    cat.setHeight(1.1);
    cat.group.position.set(0.3, 1.5, 10.2);
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
      beetleGlow.set("#cfff7a", 2.2 * tip * (0.8 + 0.2 * Math.sin(ambient * 3)));
      (beetleBody.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4 * tip;
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
      jarGlow.set("#e8ff9a", 0.7 * jarOn * (0.85 + 0.15 * Math.sin(ambient * 2.3)));
      // The city rises around the camera; the road takes the field.
      cityGroup.scale.set(1, Math.max(0.001, paved), 1);
      cityGroup.visible = paved > 0.001;
      city.all.forEach((b) => { b.u.uLit.value = 0.22 + night * 0.12; b.u.uTime.value = ambient; });
      roadMat.opacity = ramp(t, tPaved + 1.5, tPaved + 4);
      lampGlows.forEach((g, i) => g.set("#ffcf80", 1.2 * ramp(t, tKept - 0.5 + i * 0.4, tKept + 0.5 + i * 0.4)));
      terrain.mesh.visible = true;
      // The last firefly drifts toward us, and for a few frames its glow outlines a Caterpie.
      const lk = ramp(t, tKept - 0.5, tKept + 0.5) * (1 - ramp(t, end - 0.8, end));
      last.set(poseOnPath(lastPath, Math.max(tKept - 0.5, t)).pos, lk, ambient);
      if (cat) {
        // Its glow outlines the shape for a moment: a dark silhouette, lit only at the rim.
        const show = ramp(t, tKept + 3.6, tKept + 4.1) * (1 - ramp(t, tKept + 5.6, tKept + 6.4));
        figureStyle(cat, { dissolve: show > 0.001 ? 1 : 0, rimK: 2.2 * show, glowK: 0, shadow: 1 });
        cat.group.rotation.y = -0.4 + Math.sin(ambient * 0.5) * 0.05;
      }
    },
    look: (t) =>
      lookAt(t, { ...STOCK.film70s }, {
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

