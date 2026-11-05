import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { NOISE, col, keyed, makeConverge, makeGlow, makeLightning, makeParticles, makePortal, makeRing, makeSky, ramp, rng, strikeAt } from "../kit";
import type { ChapterBuilder } from "../types";
import { actionCurve, hitCurve } from "../figures";
import { billboard, cine, craft, figureStyle, floatFigure, lights, loadFigures, lookAt, place, pointPixel, shake, spike } from "./common";

/**
 * I. The Original One. Sinnoh's creation myth: a churning chaos; an Egg
 * that cracks open into light; the Original One with its golden ring;
 * galaxies; Dialga with rings of time that beat like a heart, Palkia with
 * space rushing outward; the three living things; a world gathering out
 * of matter and spirit; the Original One's sleep; and its raging third in
 * a reversed rift.
 */

const ARCEUS = 493, DIALGA = 483, PALKIA = 484, UXIE = 480, MESPRIT = 481, AZELF = 482, GIRATINA = 487;

export const build: ChapterBuilder = async (ctx) => {
  const { q } = ctx;
  const B = (id: string) => ctx.beat(id);
  const tEgg = B("egg"), tArceus = B("arceus"), tTS = B("time-space"), tThree = B("three"), tSpirit = B("spirit"), tSleep = B("sleep"), tThird = B("third"), tBan = B("banished");
  const tCrack0 = tEgg + 1.5, tBurst = tEgg + 3.6;
  const end = ctx.timing.anim;

  const scene = new THREE.Scene();
  scene.background = col("#000000");
  const disposers: (() => void)[] = [];
  const P = (n: number) => Math.max(40, Math.round(n * q.particles));

  // ---- The void and the chaos.
  const sky = makeSky({ top: "#060312", horizon: "#120726", bottom: "#030109", nebulaA: "#5a24a8", nebulaB: "#0f7aa0", nebula: 1.25, nebulaScale: 1.7, stars: 0, swirl: 2.2 });
  scene.add(sky.mesh);
  disposers.push(sky.dispose);
  const vortex = makeParticles({ count: P(7000), shape: "shell", center: [0, 2, 0], extent: [70, 30, 70], life: 9, size: [0.12, 0.5], colors: ["#3fd8ff", "#9b6bff", "#ffffff"], intensity: 1.6, swirl: 0.55, pull: 1.6, turbulence: 1.2, fadeIn: 0.25, fadeOut: 0.2, seed: 3 });
  scene.add(vortex.points);
  disposers.push(vortex.dispose);
  const haze = makeParticles({ count: P(500), shape: "sphere", center: [0, 2, 0], extent: [55, 22, 55], life: 14, size: [2.5, 7], colors: ["#2a1360", "#103a66", "#2a1360"], intensity: 0.35, swirl: 0.25, turbulence: 3, fadeIn: 0.3, fadeOut: 0.3, seed: 8 });
  scene.add(haze.points);
  disposers.push(haze.dispose);

  // ---- The Egg.
  const eggU = { uCrack: { value: 0 }, uGlow: { value: 1 }, uTime: { value: 0 }, uOpacity: { value: 1 } };
  const eggMat = new THREE.ShaderMaterial({
    uniforms: eggU,
    transparent: true,
    vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uCrack, uGlow, uTime, uOpacity; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      vec2 cells(vec3 p){
        vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
        for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++){
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 o = vec3(whHash(i + g), whHash(i + g + 11.7), whHash(i + g + 23.1));
          float d = length(g + o - f);
          if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        return vec2(d1, d2);
      }
      void main(){
        float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.0);
        vec3 pearl = mix(vec3(0.92, 0.9, 1.0), vec3(1.0, 0.86, 0.62), 0.5 + 0.5 * sin(dot(vP, vec3(3.0, 5.0, 2.0)) + uTime * 0.3));
        vec3 irid = 0.5 + 0.5 * cos(6.2831 * (f * 1.2 + vec3(0.0, 0.33, 0.67)));
        vec3 c = pearl * (0.55 + 0.45 * whFbm3(vP * 3.0)) * 1.4 + irid * f * 1.6;
        c += vec3(1.0, 0.8, 0.45) * uGlow * 0.45 * (0.6 + 0.4 * sin(uTime * 2.4));
        vec2 v = cells(vP * 3.2);
        float spread = smoothstep(-1.0, 1.0, (vP.y + 0.4) * 1.2 + (uCrack * 3.2 - 1.6));
        float crack = smoothstep(0.08, 0.0, v.y - v.x) * spread * step(0.01, uCrack);
        c += vec3(1.0, 0.78, 0.35) * crack * (6.0 + 10.0 * uCrack);
        gl_FragColor = vec4(c, uOpacity);
      }`,
  });
  const eggGeo = new THREE.SphereGeometry(1, 96, 64);
  const egg = new THREE.Mesh(eggGeo, eggMat);
  egg.position.set(0, 2.6, 0);
  scene.add(egg);
  disposers.push(() => { eggGeo.dispose(); eggMat.dispose(); });
  const eggGlow = makeGlow({ pos: [0, 2.6, 0], size: 9, color: "#ffd890", intensity: 1.4 });
  scene.add(eggGlow.sprite);
  disposers.push(eggGlow.dispose);

  // Shell shards for the burst.
  const SHARDS = 140;
  const shardGeo = new THREE.TetrahedronGeometry(0.32, 0);
  shardGeo.scale(1, 0.25, 1);
  const shardMat = new THREE.MeshStandardMaterial({ color: col("#f3eefc"), roughness: 0.35, metalness: 0.1, emissive: col("#ffcf7a"), emissiveIntensity: 1.6 });
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, SHARDS);
  const r = rng(41);
  const shardDir: THREE.Vector3[] = [], shardSpin: THREE.Vector3[] = [];
  for (let i = 0; i < SHARDS; i++) {
    const d = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
    shardDir.push(d.multiplyScalar(4 + r() * 10));
    shardSpin.push(new THREE.Vector3(r() * 6, r() * 6, r() * 6));
  }
  shards.visible = false;
  scene.add(shards);
  disposers.push(() => { shardGeo.dispose(); shardMat.dispose(); });
  const burst = makeParticles({ count: P(900), shape: "sphere", center: [0, 2.6, 0], extent: [0.8, 1.1, 0.8], velocity: [0, 0, 0], spread: [26, 26, 26], life: 4, size: [0.03, 0.08], colors: ["#ffffff", "#ffd27a", "#ff7ad9"], intensity: 0.7, fadeIn: 0.01, fadeOut: 0.6, burst: true, seed: 5 });
  scene.add(burst.points);
  disposers.push(burst.dispose);
  const shock = makeRing({ color: "#ffe2a6", intensity: 4, thickness: 0.05 });
  shock.mesh.position.set(0, 2.6, 0);
  shock.mesh.scale.setScalar(26);
  scene.add(shock.mesh);
  disposers.push(shock.dispose);

  // ---- Galaxies (appear as the world is made).
  const galaxies: THREE.Points[] = [];
  const galMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uPixel: { value: 600 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `attribute vec3 color; attribute float size; uniform float uPixel; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * uPixel / -mv.z, 0.0, 6.0); }`,
    fragmentShader: /* glsl */ `uniform float uOpacity; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * a * uOpacity, a * uOpacity); }`,
  });
  const galaxy = (center: Vec3, radius: number, tilt: [number, number], arms: number, hue: [string, string], seed: number, count: number) => {
    const rr = rng(seed);
    const pos = new Float32Array(count * 3), colr = new Float32Array(count * 3), size = new Float32Array(count);
    const core = col(hue[0]), edge = col(hue[1]);
    for (let i = 0; i < count; i++) {
      const k = Math.pow(rr(), 0.6);
      const arm = Math.floor(rr() * arms);
      const ang = arm * ((Math.PI * 2) / arms) + k * 5.5 + (rr() - 0.5) * 0.5 * (1 - k * 0.5);
      const rad = k * radius;
      pos.set([Math.cos(ang) * rad + (rr() - 0.5) * radius * 0.06, (rr() - 0.5) * radius * 0.04 * (1 - k), Math.sin(ang) * rad + (rr() - 0.5) * radius * 0.06], i * 3);
      const c = core.clone().lerp(edge, k).multiplyScalar(1.2 + (1 - k) * 2.5);
      colr.set([c.r, c.g, c.b], i * 3);
      size[i] = (0.6 + rr() * 1.6) * radius * 0.012;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colr, 3));
    g.setAttribute("size", new THREE.BufferAttribute(size, 1));
    const pts = new THREE.Points(g, galMat);
    pts.position.set(...center);
    pts.rotation.set(tilt[0], 0, tilt[1]);
    pts.frustumCulled = false;
    scene.add(pts);
    galaxies.push(pts);
    disposers.push(() => g.dispose());
  };
  galaxy([-160, 70, -320], 120, [1.0, 0.3], 2, ["#fff1d6", "#6a8cff"], 1, P(9000));
  galaxy([210, -30, -380], 90, [0.6, -0.5], 3, ["#ffe0f0", "#c05cff"], 2, P(6000));
  galaxy([40, 150, -520], 70, [1.3, 0.1], 2, ["#fff8e0", "#4fd0ff"], 3, P(4000));
  disposers.push(() => galMat.dispose());

  // ---- Light.
  const L = lights(scene, { sky: "#7a6cff", ground: "#1a0e2a", fill: 0.55, key: "#ffe2b0", keyK: 1.6, keyPos: [6, 14, 18], rim: "#7ab8ff", rimK: 1.2, rimPos: [-8, 10, -18] });
  const arceusLight = new THREE.PointLight(col("#ffd38a"), 0, 60, 1.6);
  arceusLight.position.set(0, 6, -3);
  scene.add(arceusLight);

  // ---- The figures.
  const figs = await loadFigures(ctx, [ARCEUS, DIALGA, PALKIA, UXIE, MESPRIT, AZELF, GIRATINA]);
  const arceus = figs.get(ARCEUS), dialga = figs.get(DIALGA), palkia = figs.get(PALKIA);
  const lake = [figs.get(UXIE), figs.get(MESPRIT), figs.get(AZELF)];
  const giratina = figs.get(GIRATINA);
  const ARC: Vec3 = [0, 0.1, 0], DIA: Vec3 = [-7.6, -2.4, 0.6], PAL: Vec3 = [7.6, -2.4, 0.6];
  const LAKE: Vec3[] = [[-2.8, -3.2, 4.2], [0, -3.9, 5], [2.8, -3.2, 4.2]];
  // The raging third hangs upside down beneath the new world: its other side.
  const GIR: Vec3 = [0, -53, -8];
  place(arceus, ARC, 5.4, 0, scene);
  place(dialga, DIA, 5.8, 0.42, scene);
  place(palkia, PAL, 5.8, -0.42, scene);
  lake.forEach((f, i) => place(f, LAKE[i], 1.55, [0.35, 0, -0.35][i], scene));
  place(giratina, GIR, 11, 0, scene);
  if (giratina) giratina.group.rotation.z = Math.PI;
  figureStyle(arceus, { rim: "#ffd27a", rimK: 0.9, glow: "#ffcf80", glowK: 0.06, edge: "#fff2c0", dissolve: 0 });
  figureStyle(dialga, { rim: "#8fd8ff", rimK: 1.2, glow: "#6fb6ff", glowK: 0.08, edge: "#a8e8ff", dissolve: 0 });
  figureStyle(palkia, { rim: "#ffb0e8", rimK: 1.2, glow: "#ff9ad6", glowK: 0.08, edge: "#ffd0f0", dissolve: 0 });
  lake.forEach((f, i) => figureStyle(f, { rim: ["#fff08a", "#ff9ae0", "#8ac8ff"][i], rimK: 1.4, glow: ["#fff08a", "#ff9ae0", "#8ac8ff"][i], glowK: 0.25, edge: "#ffffff", dissolve: 0 }));
  figureStyle(giratina, { rim: "#ff3355", rimK: 2.0, glow: "#3a0018", glowK: 0.12, edge: "#ff4060", dissolve: 0, shadow: 0.3 });
  // In the void: alive and solid, no ground to shadow.
  craft(ctx, L, { radius: 1, figures: [arceus, dialga, palkia, ...lake, giratina].map((f) => [f, { ground: null, alive: 0.8 }]) });

  // Motes that gather into each figure.
  const converge = (f: typeof arceus, colors: [string, string], radius: number) => {
    if (!f) return null;
    const c = makeConverge(f.points, { radius, colors, size: [0.02, 0.06], intensity: 2.2, spin: 1.4 });
    f.group.add(c.points);
    disposers.push(c.dispose);
    return c;
  };
  const arcMotes = converge(arceus, ["#ffffff", "#ffd27a"], 1.6);
  const diaMotes = converge(dialga, ["#d8f4ff", "#5ab0ff"], 1.4);
  const palMotes = converge(palkia, ["#fff0fa", "#ff7ad0"], 1.4);
  const lakeMotes = lake.map((f, i) => converge(f, ["#ffffff", ["#fff08a", "#ff9ae0", "#8ac8ff"][i]], 1.2));

  // Arceus's golden ring and halo.
  const ringMat = new THREE.MeshBasicMaterial({ color: col("#ffcf6a", 3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Group();
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(3.9, 0.07, 12, 160), ringMat);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.025, 8, 160), ringMat);
  ring.add(ringA, ringB);
  ring.position.set(0, 3.1, -0.8);
  scene.add(ring);
  disposers.push(() => { ringA.geometry.dispose(); ringB.geometry.dispose(); ringMat.dispose(); });
  const halo = makeGlow({ pos: [0, 3.2, -2.2], size: 12, color: "#ffcf80", intensity: 0 });
  scene.add(halo.sprite);
  disposers.push(halo.dispose);

  // Dialga's rings of time (ticked, turning, beating like a heart) and Palkia's widening space.
  const timeU = { uTime: { value: 0 }, uBeat: { value: 0 }, uOpacity: { value: 0 } };
  const timeMat = new THREE.ShaderMaterial({
    uniforms: timeU,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uBeat, uOpacity; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
        float k = 0.0;
        for (int i = 0; i < 3; i++){
          float R = 0.42 + float(i) * 0.2; float sp = (float(i) - 1.0) * 0.6 + 0.25;
          float bx = (r - R) / 0.008, tx = (r - R - 0.03) / 0.018;
          float band = exp(-bx * bx);
          float ticks = step(0.92, fract((a + uTime * sp) / 6.2831853 * (24.0 + float(i) * 12.0))) * exp(-tx * tx);
          k += band * 0.9 + ticks;
        }
        k *= 0.6 + uBeat * 1.4;
        vec3 c = mix(vec3(0.45, 0.8, 1.0), vec3(1.0), uBeat * 0.5);
        gl_FragColor = vec4(c * k * 2.5 * uOpacity, k * uOpacity);
      }`,
  });
  const timeRings = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), timeMat);
  timeRings.position.set(DIA[0] + 0.3, DIA[1] + 3.2, DIA[2] - 0.6);
  timeRings.rotation.y = 0.42;
  scene.add(timeRings);
  disposers.push(() => { timeRings.geometry.dispose(); timeMat.dispose(); });
  const spaceOut = makeParticles({ count: P(2400), shape: "sphere", center: [PAL[0], PAL[1] + 3, PAL[2] - 1], extent: [2, 2, 2], life: 5, size: [0.05, 0.16], colors: ["#ffffff", "#ffb6ea", "#9a7bff"], intensity: 2, pull: -9, fadeIn: 0.1, fadeOut: 0.5, seed: 21 });
  scene.add(spaceOut.points);
  disposers.push(spaceOut.dispose);
  const gridU = { uK: { value: 0 }, uOpacity: { value: 0 }, uTime: { value: 0 } };
  const gridMat = new THREE.ShaderMaterial({
    uniforms: gridU,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uK, uOpacity, uTime; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
        vec2 g = abs(fract(p * 9.0 / max(0.15, uK)) - 0.5);
        float line = smoothstep(0.035, 0.0, min(g.x, g.y));
        float fade = (1.0 - smoothstep(0.55 * uK, uK, r)) * smoothstep(0.0, 0.2, uK);
        gl_FragColor = vec4(vec3(1.0, 0.6, 0.9) * line * fade * 1.6 * uOpacity, line * fade * uOpacity);
      }`,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), gridMat);
  grid.position.set(PAL[0] + 2, PAL[1] + 3, PAL[2] - 6);
  grid.rotation.y = -0.42;
  scene.add(grid);
  disposers.push(() => { grid.geometry.dispose(); gridMat.dispose(); });

  // The three living things arrive as lights.
  const lakeLights = ["#fff08a", "#ff9ae0", "#8ac8ff"].map((c) => {
    const g = makeGlow({ pos: [0, 3, 0], size: 2.2, color: c, intensity: 0 });
    scene.add(g.sprite);
    disposers.push(g.dispose);
    return g;
  });

  // ---- A world: matter, then oceans and lands, then spirit rising from it.
  const W0: Vec3 = [0, -30, -6];
  const worldU = { uLife: { value: 0 }, uForm: { value: 0 }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0.3, 1, 0.5).normalize() } };
  const worldMat = new THREE.ShaderMaterial({
    uniforms: worldU,
    vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uLife, uForm, uTime; uniform vec3 uSun; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 d = normalize(vP);
        float form = whFbm(d * 2.6 + 4.0);
        if (form > uForm * 1.2) discard;
        float h = whFbm(d * 3.1) + 0.12 * whNoise(d * 18.0);
        vec3 molten = mix(vec3(0.18, 0.06, 0.04), vec3(1.6, 0.5, 0.12), smoothstep(0.45, 0.7, whNoise(d * 9.0 + uTime * 0.1)));
        vec3 ocean = mix(vec3(0.02, 0.08, 0.25), vec3(0.06, 0.25, 0.5), smoothstep(0.3, 0.5, h));
        vec3 land = mix(vec3(0.16, 0.35, 0.12), vec3(0.45, 0.38, 0.22), smoothstep(0.55, 0.75, h));
        land = mix(land, vec3(0.95), smoothstep(0.78, 0.92, abs(d.y)));
        vec3 alive = h > 0.52 ? land : ocean;
        vec3 c = mix(molten, alive, uLife);
        float clouds = smoothstep(0.55, 0.75, whFbm(d * 5.0 + vec3(uTime * 0.02, 0.0, 0.0))) * uLife;
        c = mix(c, vec3(1.0), clouds * 0.7);
        float lit = clamp(dot(normalize(vN), uSun) * 0.8 + 0.25, 0.05, 1.0);
        float rim = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 3.0);
        c = c * lit + vec3(0.35, 0.6, 1.0) * rim * 1.4 * uLife + molten * (1.0 - uLife) * 0.6;
        float edge = smoothstep(uForm * 1.2 - 0.05, uForm * 1.2, form);
        c += vec3(1.0, 0.7, 0.4) * edge * 4.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const worldGeo = new THREE.SphereGeometry(17, 96, 64);
  const world = new THREE.Mesh(worldGeo, worldMat);
  world.position.set(...W0);
  scene.add(world);
  disposers.push(() => { worldGeo.dispose(); worldMat.dispose(); });
  const matter = makeParticles({ count: P(3000), shape: "shell", center: W0, extent: [40, 40, 40], life: 4, size: [0.08, 0.3], colors: ["#ffb070", "#ff8040", "#ffd8a0"], intensity: 1.8, pull: 6, swirl: 0.3, fadeIn: 0.2, fadeOut: 0.2, seed: 33 });
  scene.add(matter.points);
  disposers.push(matter.dispose);
  const spirit = makeParticles({ count: P(1800), shape: "shell", center: W0, extent: [17.5, 17.5, 17.5], velocity: [0, 0.8, 0], life: 7, size: [0.06, 0.2], colors: ["#bfffea", "#ffe9a8", "#d7b8ff"], intensity: 2, pull: -1.2, turbulence: 1.5, fadeIn: 0.2, fadeOut: 0.5, seed: 44 });
  scene.add(spirit.points);
  disposers.push(spirit.dispose);

  // ---- The other side: a reversed rift with red lightning.
  const rift = makePortal({ radius: 20, inner: "#12001f", outer: "#a0103a", intensity: 2.2 });
  rift.mesh.position.set(GIR[0], GIR[1] - 3, GIR[2] - 9);
  scene.add(rift.mesh);
  disposers.push(rift.dispose);
  const bolt = makeLightning({ color: "#ff3060", width: 0.22, intensity: 5, branches: 3 });
  scene.add(bolt.mesh);
  disposers.push(bolt.dispose);
  let lastBolt = -1;

  // ---- Camera.
  const keys: Key[] = [
    { t: 0, pos: [0, 7, 74], look: [0, 2, 0], fov: 50 },
    { t: tEgg - 1.5, pos: [4, 4.5, 38], look: [0, 2.4, 0], fov: 46 },
    { t: tCrack0, pos: [1.6, 3.0, 15], look: [0, 2.6, 0], fov: 40 },
    { t: tBurst, pos: [0.6, 2.8, 10.5], look: [0, 2.7, 0], fov: 38 },
    { t: tBurst + 2.4, pos: [-3.5, 3.6, 16], look: [0, 3.1, 0], fov: 42 },
    { t: tArceus + 3, pos: [-8.5, 4.6, 15], look: [0, 3.4, 0], fov: 42 },
    { t: tTS, pos: [3, 5, 25], look: [0, 2.2, 0], fov: 46 },
    { t: tTS + 4.5, pos: [0, 3.2, 33], look: [0, 1, 0], fov: 48 },
    { t: tThree, pos: [2, 0.4, 21], look: [0, -1.4, 3], fov: 44 },
    { t: tSpirit, pos: [0, 6, 31], look: [0, -4, 0], fov: 48 },
    { t: tSpirit + 5, pos: [0, 15, 50], look: [0, -15, -4], fov: 52 },
    { t: tSleep + 2, pos: [7, 9, 54], look: [0, -9, -4], fov: 52 },
    { t: tThird, pos: [0, -16, 70], look: [0, -36, -6], fov: 50 },
    { t: tThird + 3.4, pos: [0, -61, 40], look: [0, -54, -10], fov: 46 },
    { t: tBan + 2.5, pos: [-4, -59, 27], look: [0, -53.5, -10], fov: 42 },
    { t: end, pos: [0, -34, 98], look: [0, -40, -6], fov: 50 },
  ];
  const hits = [{ at: tBurst, k: 0.12, dur: 2.5 }, { at: tTS + 0.5, k: 0.03 }, { at: tThird + 0.4, k: 0.05 }];

  return {
    scene,
    portalScale: 5,
    camera: (t) => shake(poseOnPath(keys, t), t, hits),
    orbit: (t) => {
      const target: Vec3 = t < tTS ? [0, 3, 0] : t < tSpirit ? [0, 0.5, 1] : t < tThird ? [0, -8, -3] : [0, -52, -8];
      return { target, limits: { yaw0: 0, yawSpan: 1.0, minPitch: -0.5, maxPitch: 1.0, minDist: 5, maxDist: 140 } };
    },
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      sky.follow(cam);
      sky.u.uTime.value = ambient;
      const made = ramp(t, tBurst, tBurst + 6);
      sky.u.uSwirl.value = 2.2 - 1.9 * made;
      sky.u.uStars.value = 0.06 * made;
      sky.u.uNeb.value = 1.25 - 0.5 * made;
      sky.u.uFlash.value = spike(t, tBurst, 0.05, 0.35) * 0.5;
      for (const ps of [vortex, haze, burst, matter, spirit, spaceOut]) ps.u.uPixel.value = px;
      vortex.u.uTime.value = ambient;
      vortex.u.uOpacity.value = 1 - 0.85 * made;
      haze.u.uTime.value = ambient;
      haze.u.uOpacity.value = 1 - 0.7 * made;
      // The Egg appears, glows, cracks and bursts.
      const appear = ramp(t, tEgg - 0.4, tEgg + 1.2);
      const burstK = t >= tBurst ? 1 : 0;
      egg.visible = appear > 0 && !burstK;
      egg.scale.set(1.25 * appear, 1.62 * appear, 1.25 * appear);
      egg.rotation.set(Math.sin(ambient * 0.4) * 0.12, ambient * 0.25, Math.sin(ambient * 0.3) * 0.08);
      eggU.uTime.value = ambient;
      eggU.uCrack.value = ramp(t, tCrack0, tBurst);
      eggU.uGlow.value = 0.6 + ramp(t, tCrack0, tBurst) * 1.0;
      eggGlow.sprite.visible = appear > 0;
      eggGlow.set("#ffd890", (0.7 + 0.5 * ramp(t, tCrack0, tBurst)) * appear * (1 - ramp(t, tBurst, tBurst + 0.45)) + 0.12 * appear * (1 - ramp(t, tBurst, tBurst + 2.5)));
      eggGlow.sprite.scale.setScalar(6 + 4 * spike(t, tBurst, 0.05, 0.4));
      // Shards fly.
      const sd = t - tBurst;
      shards.visible = sd > 0 && sd < 6;
      if (shards.visible) {
        const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
        for (let i = 0; i < SHARDS; i++) {
          const k = 1 - Math.exp(-sd * 1.1);
          const p = shardDir[i].clone().multiplyScalar(k * 1.6).add(new THREE.Vector3(0, 2.6, 0));
          e.set(shardSpin[i].x * sd, shardSpin[i].y * sd, shardSpin[i].z * sd);
          qq.setFromEuler(e);
          const sc = Math.max(0.001, 1 - sd / 6);
          m.compose(p, qq, new THREE.Vector3(sc, sc, sc));
          shards.setMatrixAt(i, m);
        }
        shards.instanceMatrix.needsUpdate = true;
        shardMat.emissiveIntensity = 1.6 * Math.exp(-sd * 0.6);
      }
      burst.u.uTime.value = Math.max(0, sd);
      burst.u.uOpacity.value = sd > 0 && sd < 4.2 ? 1 : 0;
      shock.u.uK.value = Math.min(1, Math.max(0, sd) / 2.6);
      shock.u.uOpacity.value = sd > 0 && sd < 2.6 ? 1 : 0;
      shock.u.uTime.value = ambient;
      billboard(shock.mesh, cam);
      // Arceus forms in the light, then sleeps.
      const formA = ramp(t, tBurst + 0.05, tBurst + 2.8);
      const sleep = ramp(t, tSleep + 0.6, tSleep + 4.2);
      if (arceus) {
        // The Original One rises out of the burst: a gathering, a release, a settle.
        figureStyle(arceus, { dissolve: Math.min(formA, 1 - sleep * 0.999), glowK: 0.06 + 0.35 * spike(t, tBurst + 1, 0.4, 1.5), act: actionCurve(t, tBurst + 1.6, { pre: 0.6, post: 1.2 }), flex: 0.5 * spike(t, tBurst + 1.6, 0.1, 1.5) });
        floatFigure(arceus, [ARC[0], ARC[1] + sleep * 2.5, ARC[2]], ambient, 0.12, 0, 0, 0.08);
      }
      if (arcMotes) { arcMotes.u.uForm.value = formA; arcMotes.u.uTime.value = ambient; arcMotes.u.uPixel.value = px; arcMotes.u.uOpacity.value = 1 - ramp(t, tBurst + 2.2, tBurst + 3.6); }
      ringMat.opacity = ramp(t, tBurst + 0.6, tBurst + 3) * (1 - sleep);
      ring.rotation.z = ambient * 0.12;
      ringB.rotation.z = -ambient * 0.2;
      ring.position.y = 3.1 + sleep * 2.5;
      halo.set("#ffcf80", (0.42 + 0.08 * Math.sin(ambient * 1.3)) * ramp(t, tBurst, tBurst + 2) * (1 - sleep * 0.85));
      halo.sprite.position.y = 3.2 + sleep * 2.5;
      arceusLight.intensity = 14 * ramp(t, tBurst, tBurst + 1.5) * (1 - sleep * 0.8);
      galMat.uniforms.uOpacity.value = ramp(t, tBurst + 1, tBurst + 7);
      galMat.uniforms.uPixel.value = px;
      galaxies.forEach((g, i) => { g.rotation.y = ambient * (0.006 + i * 0.002); });
      // Time and space.
      const formD = ramp(t, tTS + 0.2, tTS + 2.8), formP = ramp(t, tTS + 0.8, tTS + 3.4);
      if (dialga) { figureStyle(dialga, { dissolve: formD }); floatFigure(dialga, DIA, ambient, 0.1, 1.1, 0.42, 0.05); }
      if (palkia) { figureStyle(palkia, { dissolve: formP }); floatFigure(palkia, PAL, ambient, 0.1, 2.3, -0.42, 0.05); }
      if (diaMotes) { diaMotes.u.uForm.value = formD; diaMotes.u.uTime.value = ambient; diaMotes.u.uPixel.value = px; diaMotes.u.uOpacity.value = 1 - ramp(t, tTS + 3, tTS + 5); }
      if (palMotes) { palMotes.u.uForm.value = formP; palMotes.u.uTime.value = ambient; palMotes.u.uPixel.value = px; palMotes.u.uOpacity.value = 1 - ramp(t, tTS + 3.5, tTS + 5.5); }
      const beat = Math.pow(Math.max(0, Math.sin(ambient * Math.PI * 1.1)), 18);
      timeU.uTime.value = ambient;
      timeU.uBeat.value = beat;
      timeU.uOpacity.value = ramp(t, tTS + 1.2, tTS + 3) * (1 - ramp(t, tThird - 1, tThird + 1) * 0.7);
      timeRings.scale.setScalar(1 + beat * 0.05);
      spaceOut.u.uTime.value = ambient;
      spaceOut.u.uOpacity.value = ramp(t, tTS + 1.6, tTS + 3.5) * (1 - ramp(t, tThird - 1, tThird + 1) * 0.8);
      gridU.uK.value = ramp(t, tTS + 1.2, tTS + 6.5);
      gridU.uOpacity.value = ramp(t, tTS + 1.2, tTS + 2.4) * (1 - ramp(t, tThird - 1, tThird + 1) * 0.8);
      // The three living things.
      lake.forEach((f, i) => {
        const go = ramp(t, tThree + i * 0.35, tThree + 1.6 + i * 0.35);
        const form = ramp(t, tThree + 1.4 + i * 0.3, tThree + 3 + i * 0.3);
        const from = new THREE.Vector3(0, 4.2, 0), to = new THREE.Vector3(LAKE[i][0], LAKE[i][1] + 0.8, LAKE[i][2]);
        const p = from.lerp(to, go);
        p.y += Math.sin(go * Math.PI) * 2.2;
        lakeLights[i].sprite.position.copy(p);
        lakeLights[i].set(["#fff08a", "#ff9ae0", "#8ac8ff"][i], 2.2 * ramp(t, tThree - 0.2, tThree + 0.4) * (1 - form * 0.75));
        if (f) { figureStyle(f, { dissolve: form }); floatFigure(f, LAKE[i], ambient, 0.18, i * 1.7, [0.35, 0, -0.35][i], 0.1); }
        const m = lakeMotes[i];
        if (m) { m.u.uForm.value = form; m.u.uTime.value = ambient; m.u.uPixel.value = px; m.u.uOpacity.value = 1 - ramp(t, tThree + 3.5, tThree + 5); }
      });
      // The world.
      const wForm = ramp(t, tSpirit - 0.5, tSpirit + 3.2), wLife = ramp(t, tSpirit + 3, tSpirit + 6.5);
      world.visible = wForm > 0.001;
      worldU.uForm.value = wForm;
      worldU.uLife.value = wLife;
      worldU.uTime.value = ambient;
      world.rotation.y = ambient * 0.03;
      matter.u.uTime.value = ambient;
      matter.u.uOpacity.value = ramp(t, tSpirit - 1, tSpirit) * (1 - ramp(t, tSpirit + 3, tSpirit + 4.5));
      spirit.u.uTime.value = ambient;
      spirit.u.uOpacity.value = ramp(t, tSpirit + 5, tSpirit + 7) * (1 - ramp(t, tThird, tThird + 2) * 0.6);
      // The raging third, on the other side.
      const open = ramp(t, tThird - 0.3, tThird + 2.4) * (1 - ramp(t, tBan + 2.5, end) * 0.75);
      rift.mesh.visible = open > 0.01;
      rift.u.uOpen.value = 0.15 + 0.85 * open;
      rift.u.uTime.value = ambient;
      const formG = ramp(t, tThird + 0.8, tThird + 3.6);
      const sink = ramp(t, tBan + 1.5, end);
      if (giratina) {
        figureStyle(giratina, { dissolve: formG * (1 - sink * 0.35), shadow: 0.3 + sink * 0.3, hit: hitCurve(t, tBan + 0.4, 1.1), flex: 0.6 + 0.4 * ramp(t, tThird, tThird + 2) });
        giratina.group.position.set(GIR[0] + Math.sin(ambient * 0.5) * 0.3, GIR[1] - sink * 6 + Math.sin(ambient * 0.7) * 0.25, GIR[2]);
      }
      const st = strikeAt(ambient, 1.7, 7);
      const live = t > tThird + 1 && t < end - 1;
      bolt.u.uAlpha.value = live ? st.level : 0;
      if (live && st.id !== lastBolt && st.level > 0) {
        lastBolt = st.id;
        const rr = rng(st.id * 13 + 1);
        const a: Vec3 = [GIR[0] + (rr() - 0.5) * 30, GIR[1] + 8 + rr() * 3, GIR[2] - 4];
        const b: Vec3 = [GIR[0] + (rr() - 0.5) * 22, GIR[1] - 14 - rr() * 5, GIR[2] - 3];
        bolt.strike(a, b, st.id, cam.position);
      }
      L.key.intensity = 1.6 * (1 - ramp(t, tThird - 1, tThird + 1) * 0.6);
      L.rim!.color.copy(col(t > tThird ? "#ff4060" : "#7ab8ff"));
    },
    look(t) {
      // Focus: the egg, then Arceus, then the pair of time and space, then the rift below.
      const focus: Vec3 = t < tTS ? [0, 3, 0] : t < tThird ? [0, 0, 0.6] : [0, -40, -8];
      return cine(lookAt(
        t,
        { bloomRadius: 0.62 },
        {
          exposure: [[0, 0.9], [tEgg, 1], [tBurst, 1.05], [tBurst + 3, 1.0], [tThird, 0.95], [end, 0.9]],
          bloom: [[0, 0.85], [tCrack0, 1.0], [tBurst, 1.1], [tBurst + 2, 0.95], [tThird, 1.05], [end, 0.9]],
          bloomThreshold: [[0, 0.82], [tCrack0, 0.95], [tBurst + 0.4, 1.05], [tBurst + 2.4, 0.86]],
          flash: [[tBurst - 0.02, 0], [tBurst, 0.24], [tBurst + 0.2, 0.05], [tBurst + 0.6, 0]],
          saturation: [[0, 1.15], [tBurst + 2, 1.08], [tThird, 0.95]],
          chroma: [[0, 0.12], [tBurst, 0.45], [tBurst + 1.5, 0.06], [tThird, 0.12], [tThird + 1.5, 0.3]],
          vignette: [[0, 0.5], [tBurst, 0.3], [tThird, 0.55]],
          rays: [[tBurst - 0.1, 0], [tBurst + 0.3, 0.65], [tBurst + 3, 0.4], [tSleep + 1, 0.32], [tSleep + 4, 0]],
          gain: [[0, [0.88, 0.95, 1.12]], [tBurst, [1.1, 1.0, 0.9]], [tThird, [0.95, 0.85, 1.05]], [end, [0.95, 0.9, 1.08]]],
          lift: [[0, [0.01, 0.0, 0.03]], [tThird, [0.03, 0.0, 0.02]]],
        },
        { pos: [0, 3.2, -0.5], color: [1.0, 0.85, 0.55] }
      ), { streak: 0.2 + 0.45 * spike(t, tBurst, 0.1, 2.4), streakColor: [1.0, 0.8, 0.55], dof: { focus, k: 0.3 }, fringe: 0.5 });
    },
    dispose() {
      disposers.forEach((d) => d());
      figs.forEach((f) => f.dispose());
    },
  };
};

export const KEYED = keyed;
