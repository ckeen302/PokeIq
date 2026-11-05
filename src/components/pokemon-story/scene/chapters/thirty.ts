import * as THREE from "three";
import type { Key, Vec3 } from "@/lib/world-history/camera";
import { col, makeGlow, makeParticles, makeRing, makeSky, makeStreaks, makeTerrain, noise2, ramp, rng } from "@/components/world-history/scene/kit";
import { makeCity } from "@/components/world-history/scene/props";
import { lights, loadFigures, lookAt, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { drawCritter, makeDevice, makeFireflies, makeGlassCase, makeGlobe, makeGrass, makeSilhouette, makeStars } from "../story-kit";
import { bag, heroFigure, shots, stageAt, STOCK, type Hero } from "./base";
import { cableTable } from "./cable";

/**
 * XI. Thirty Years. A new console in a glass case with wind and waves
 * swirling round it. Then Chapter III's table again, the same two Game
 * Boys and the same cable under one lamp, the camera in the same orbit.
 * The cable glows and runs out of frame, and the camera follows it out
 * over a city and a coast to the world of light. More than a thousand
 * little shapes pour out of the light into a spiral galaxy (slow motion),
 * the first three and Mew in front and Pikachu at its heart. The galaxy
 * dissolves into fireflies, and the camera drops through them into
 * Chapter I's field at dusk: a child with a net in the grass, and on the
 * last line a ring of light.
 */

const AT = { table: 0, gallery: -90, city: 120, galaxy: 300, field: 500 };

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tThirty = B("thirty"), tThen = B("then"), tNow = B("now"), tThousand = B("thousand"), tYours = B("yours");
  const P = ctx.q.particles;
  const r = rng(30);

  const sky = D.add(makeSky({ top: "#0a0a14", horizon: "#1a1a2a", bottom: "#050508" }));
  scene.add(sky.mesh);
  const stars = D.add(makeStars({ count: 2400, radius: 700, center: [AT.galaxy, 0, 0] }));
  scene.add(stars.points);
  scene.fog = new THREE.FogExp2(col("#000000"), 0);
  const fog = scene.fog as THREE.FogExp2;
  const L = lights(scene, { sky: "#ffe8c0", ground: "#1a140a", fill: 0.5, key: "#fff0d8", keyK: 1.2, keyPos: [4, 8, 6] });

  // ---- A. The new console in a glass case; wind and waves round it.
  const gal = new THREE.Group();
  gal.position.set(AT.gallery, 0, 0);
  scene.add(gal);
  const glassCase = D.add(makeGlassCase({ w: 2.2, h: 1.5, d: 1.2 }));
  gal.add(glassCase.group);
  const sw2 = D.add(makeDevice("switch2", { draw: (g, w, h) => { const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, "#3a8aff"); grd.addColorStop(1, "#e8f4ff"); g.fillStyle = grd; g.fillRect(0, 0, w, h); }, screenK: 0.6 }));
  sw2.group.position.set(0, glassCase.shelf.y + 0.55, 0);
  sw2.group.rotation.x = -0.12;
  sw2.group.scale.setScalar(0.62);
  gal.add(sw2.group);
  const caseLamp = new THREE.SpotLight(col("#fff0d8"), 0, 8, 0.6, 0.5, 1.2);
  caseLamp.position.set(AT.gallery, 4.5, 2);
  caseLamp.target.position.set(AT.gallery, 1.4, 0);
  scene.add(caseLamp, caseLamp.target);
  const wind = D.add(makeStreaks({ count: Math.round(160 * P) + 40, center: [AT.gallery, 1.6, 0], extent: [2.8, 1.2, 2.2], velocity: [3.2, 0.4, 0], spread: [0.6, 0.4, 0.6], life: 1.4, length: 0.9, width: 0.02, color: "#ffffff", intensity: 1.4, seed: 7 }));
  scene.add(wind.mesh);
  const foam = D.add(makeParticles({ count: Math.round(500 * P) + 80, shape: "cylinder", center: [AT.gallery, 1.4, 0], extent: [2.2, 0.9, 2.2], velocity: [0, 0.3, 0], spread: [0.2, 0.3, 0.2], life: 2.4, size: [0.02, 0.06], colors: ["#ffffff", "#9ad8ff", "#3a8aff"], intensity: 2.0, turbulence: 0.6, swirl: 1.8 }));
  scene.add(foam.points);
  const galFloor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#3a2618"), roughness: 0.5 }));
  galFloor.position.set(AT.gallery, 0, 0);
  scene.add(galFloor);
  D.add({ dispose: () => { galFloor.geometry.dispose(); (galFloor.material as THREE.Material).dispose(); } });

  // ---- B. Chapter III's table: same Game Boys, same cable, same orbit.
  const T = D.add(cableTable(scene));
  T.state.left = 1; T.state.right = 1;

  // ---- C. Out over a city, a coast, to the world of light.
  const city = D.add(makeCity({ center: [AT.city, -30, -60], radius: 60, count: 140, height: [6, 30], color: "#8a6a48", seed: 41 }));
  scene.add(city.mesh);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 300).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#0a1a2a"), roughness: 0.3, metalness: 0.5 }));
  sea.position.set(AT.city, -30.2, -260);
  scene.add(sea);
  D.add({ dispose: () => { sea.geometry.dispose(); (sea.material as THREE.Material).dispose(); } });
  const world = D.add(makeGlobe({ radius: 40, count: Math.round(12000 * Math.max(0.45, P)), land: "#6a8aff", lit: "#ffe08a", sea: "#02040c", seed: 5 }));
  world.group.position.set(AT.city, -10, -480);
  world.u.uSize.value = 0.6;
  world.u.uAll.value = 1;
  scene.add(world.group);
  const trail = D.add(makeParticles({ count: Math.round(400 * P) + 60, shape: "sphere", center: [0, 0, 0], extent: [0.3, 0.3, 0.3], velocity: [0, 0, 0], spread: [0.3, 0.3, 0.3], life: 1.2, size: [0.03, 0.08], colors: ["#ffffff", "#e6ff9a", "#9bbc0f"], intensity: 2.4, turbulence: 0.4 }));
  scene.add(trail.points);
  const head = D.add(makeGlow({ pos: [0, 0, 0], size: 1.6, color: "#e6ff9a", intensity: 0 }));
  scene.add(head.sprite);

  // ---- D. The galaxy: over a thousand little shapes pouring in along spiral arms.
  const atlas = document.createElement("canvas");
  atlas.width = atlas.height = 512;
  const ag = atlas.getContext("2d")!;
  for (let i = 0; i < 64; i++) drawCritter(ag, (i % 8) * 64 + 6, Math.floor(i / 8) * 64 + 6, 52, 900 + i * 11, "#ffffff");
  const atlasTex = new THREE.CanvasTexture(atlas);
  atlasTex.magFilter = THREE.NearestFilter;
  const nGal = 1100;
  const gPos = new Float32Array(nGal * 3), gFrom = new Float32Array(nGal * 3), gSeed = new Float32Array(nGal * 2);
  for (let i = 0; i < nGal; i++) {
    const arm = i % 3, k = r();
    const rad = 2.4 + k * 26;
    const a = arm * ((Math.PI * 2) / 3) + rad * 0.22 + (r() - 0.5) * 0.5;
    gPos.set([AT.galaxy + Math.cos(a) * rad, (r() - 0.5) * (2.6 - k * 1.6), Math.sin(a) * rad], i * 3);
    const fa = r() * Math.PI * 2, fe = (r() - 0.5) * 1.4, fd = 70 + r() * 60;
    gFrom.set([AT.galaxy + Math.cos(fa) * Math.cos(fe) * fd, Math.sin(fe) * fd, Math.sin(fa) * Math.cos(fe) * fd], i * 3);
    gSeed.set([Math.floor(r() * 64), r()], i * 2);
  }
  const galGeo = new THREE.BufferGeometry();
  galGeo.setAttribute("position", new THREE.BufferAttribute(gPos, 3));
  galGeo.setAttribute("aFrom", new THREE.BufferAttribute(gFrom, 3));
  galGeo.setAttribute("aSeed", new THREE.BufferAttribute(gSeed, 2));
  const galU = { uK: { value: 0 }, uSpin: { value: 0 }, uShow: { value: 0 }, uTime: { value: 0 }, uPixel: { value: 600 }, uSize: { value: 0.6 }, uTex: { value: atlasTex }, uC: { value: new THREE.Vector3(AT.galaxy, 0, 0) } };
  const galMat = new THREE.ShaderMaterial({
    uniforms: galU,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aFrom; attribute vec2 aSeed; uniform float uK, uSpin, uTime, uPixel, uSize; uniform vec3 uC; varying float vCell; varying float vS; varying float vOn;
      void main(){
        float k = clamp(uK * 1.4 - aSeed.y * 0.4, 0.0, 1.0);
        float e = 1.0 - (1.0 - k) * (1.0 - k);
        vec3 rel = position - uC;
        float c = cos(uSpin), s = sin(uSpin);
        rel = vec3(rel.x * c - rel.z * s, rel.y, rel.x * s + rel.z * c);
        vec3 p = mix(aFrom, uC + rel, e);
        vCell = aSeed.x; vS = aSeed.y; vOn = k;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * uPixel / -mv.z, 2.0, 40.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex; uniform float uShow, uTime; varying float vCell; varying float vS; varying float vOn;
      void main(){
        vec2 pc = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
        vec2 uv = (vec2(mod(vCell, 8.0), 7.0 - floor(vCell / 8.0)) + pc) / 8.0;
        float a = texture2D(uTex, uv).a * uShow * (0.35 + 0.65 * vOn);
        vec3 tint = mix(vec3(1.0, 0.86, 0.5), vec3(0.6, 0.85, 1.0), vS) * (0.55 + 0.2 * sin(uTime * 2.0 + vS * 40.0));
        gl_FragColor = vec4(tint * a, a);
      }`,
  });
  const galaxy = new THREE.Points(galGeo, galMat);
  galaxy.frustumCulled = false;
  scene.add(galaxy);
  D.add({ dispose: () => { galGeo.dispose(); galMat.dispose(); atlasTex.dispose(); } });
  const core = D.add(makeGlow({ pos: [AT.galaxy, 0, 0], size: 22, color: "#ffe0a0", intensity: 0 }));
  scene.add(core.sprite);
  const dust = D.add(makeParticles({ count: Math.round(1400 * P) + 200, shape: "disc", center: [AT.galaxy, 0, 0], extent: [28, 0.8, 28], velocity: [0, 0, 0], spread: [0.05, 0.05, 0.05], life: 6, size: [0.05, 0.14], colors: ["#ffffff", "#ffe0a0", "#9ac8ff"], intensity: 0.5, swirl: 0.12, flicker: 0.5 }));
  scene.add(dust.points);

  // ---- E. Chapter I's field at dusk.
  const nz = noise2(3);
  const field = D.add(makeTerrain({ size: [200, 200], segments: 90, height: (x, z) => nz.fbm(x * 0.03, z * 0.03, 4) * 3 - 1.2 + Math.max(0, -z - 40) * 0.04, color: (h) => { const k = Math.max(0, Math.min(1, (h + 1.5) / 3)); return [0.2 + 0.12 * k, 0.24 + 0.1 * k, 0.08]; } }));
  field.mesh.position.set(AT.field, 0, 0);
  scene.add(field.mesh);
  const grass = D.add(makeGrass({ count: Math.round(16000 * P) + 2000, center: [AT.field, 0, 2], size: [40, 34], height: [0.5, 1.15], base: "#16200a", tip: "#8f8436", seed: 3 }));
  scene.add(grass.mesh);
  const groundY = (x: number, z: number) => nz.fbm((x - AT.field) * 0.03, z * 0.03, 4) * 3 - 1.2;
  const kid = D.add(makeSilhouette({ height: 1.35, pose: "net", child: true, rim: "#ffcf7a" }));
  kid.mesh.position.set(AT.field, groundY(AT.field, -2), -2);
  kid.mesh.rotation.y = 0.4;
  scene.add(kid.mesh);
  const flies = D.add(makeFireflies({ count: Math.round(420 * P) + 60, center: [AT.field, 1.8, 0], extent: [16, 2.6, 12], seed: 7 }));
  scene.add(flies.points);
  const fallFlies = D.add(makeFireflies({ count: Math.round(600 * P) + 80, center: [AT.galaxy, 0, 0], extent: [22, 4, 22], seed: 12 }));
  scene.add(fallFlies.points);
  const finalRing = D.add(makeRing({ color: "#ffe8b0", intensity: 2.2, thickness: 0.04 }));
  finalRing.mesh.position.set(AT.field, 0.8, -2);
  scene.add(finalRing.mesh);
  const dusk = D.add(makeGlow({ pos: [AT.field + 10, 4, -80], size: 70, color: "#ffb05a", intensity: 0 }));
  scene.add(dusk.sprite);

  // ---- The figures: Pikachu at the heart, the first three and Mew in front.
  const figs = await loadFigures(ctx, [25, 1, 4, 7, 151]);
  const front: { dex: number; pos: Vec3; h: number; accent: string }[] = [
    { dex: 25, pos: [AT.galaxy, -1.4, 0], h: 3.0, accent: "#ffcb05" },
    { dex: 1, pos: [AT.galaxy - 5.4, -1.8, 6], h: 2.2, accent: "#5aff8a" },
    { dex: 4, pos: [AT.galaxy - 1.8, -1.8, 7.5], h: 2.2, accent: "#ff9a3a" },
    { dex: 7, pos: [AT.galaxy + 1.8, -1.8, 7.5], h: 2.2, accent: "#5ab8ff" },
    { dex: 151, pos: [AT.galaxy + 5.4, -0.6, 6], h: 2.0, accent: "#ff9ad0" },
  ];
  const heroes: (Hero | null)[] = front.map((f) => { const h = heroFigure(figs.get(f.dex), { pos: f.pos, height: f.h, accent: f.accent, scene }); if (h) D.add(h); return h; });

  const orbitK = (t0: number, t1: number): Key[] => [0, 0.5, 1].map((u) => { const t = t0 + u * (t1 - t0); return { t, ...T.orbit(t - t0), fov: 40 }; });
  const camera = shots([
    [0, [
      { t: 0, pos: [AT.gallery + 1.2, 2.2, 6.4], look: [AT.gallery, 1.6, 0], fov: 40 },
      { t: tThen, pos: [AT.gallery - 0.4, 1.9, 4.2], look: [AT.gallery, 1.7, 0], fov: 38 },
    ]],
    [tThen - 0.2, [...orbitK(tThen - 0.2, tNow + 0.6),
      { t: tNow + 3.2, pos: [8, 6, 10], look: [14, 0, -10], fov: 46 },
      { t: tNow + 5.4, pos: [AT.city - 40, 30, 40], look: [AT.city, -20, -60], fov: 50 },
      { t: tNow + 7.4, pos: [AT.city, 40, -100], look: [AT.city, -10, -300], fov: 52 },
      { t: tThousand - 0.3, pos: [AT.city, 30, -340], look: [AT.city, -10, -480], fov: 50 },
    ]],
    [tThousand - 0.2, [
      { t: tThousand - 0.2, pos: [AT.galaxy, 22, 64], look: [AT.galaxy, 0, 0], fov: 50 },
      { t: tThousand + 4, pos: [AT.galaxy, 12, 40], look: [AT.galaxy, 0, 0], fov: 50 },
      { t: tYours - 0.2, pos: [AT.galaxy, 4.5, 22], look: [AT.galaxy, 0, 2], fov: 46 },
    ]],
    [tYours, [
      { t: tYours, pos: [AT.field + 0.5, 14, 18], look: [AT.field, 0, -2], fov: 50 },
      { t: tYours + 3, pos: [AT.field + 0.8, 2.2, 8], look: [AT.field, 0.9, -2], fov: 42 },
      { t: end, pos: [AT.field + 0.6, 1.3, 5.4], look: [AT.field, 1.0, -2], fov: 40 },
    ]],
  ]);
  const starts = [0, tThen - 0.2, tThousand - 0.2, tYours];

  return {
    scene,
    portalScale: 1.4,
    camera,
    orbit: (t) => ({ target: camera(t).look, limits: { yaw0: 0, yawSpan: 1.0, minPitch: -0.1, maxPitch: 1.3, minDist: 1, maxDist: 80 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      const st = stageAt(starts, t);
      sky.follow(cam);
      const out = st === 1 ? ramp(t, tNow + 1.5, tNow + 5) : 0;
      if (st === 3) {
        sky.u.uTop.value.copy(col("#2f3d78")); sky.u.uHorizon.value.copy(col("#e8904a")); sky.u.uBottom.value.copy(col("#2a1a0e"));
      } else {
        sky.u.uTop.value.copy(col("#0a0a14").lerp(col("#02040c"), out)); sky.u.uHorizon.value.copy(col("#1a1a2a").lerp(col("#0a1430"), out)); sky.u.uBottom.value.copy(col("#050508"));
      }
      stars.points.visible = st === 2 || out > 0.5;
      fog.density = st === 3 ? 0.009 : 0;
      fog.color.copy(col("#7a5030"));
      L.key.intensity = st === 3 ? 1.6 : 0.8;
      L.key.color.copy(col(st === 3 ? "#ffc070" : "#fff0d8"));
      L.hemi.intensity = st === 3 ? 0.6 : 0.4;

      // A. The case: wind and waves swirl round it.
      gal.visible = galFloor.visible = st === 0;
      caseLamp.intensity = st === 0 ? 30 : 0;
      sw2.group.rotation.y = Math.sin(ambient * 0.4) * 0.25;
      const swk = st === 0 ? ramp(t, tThirty + 0.6, tThirty + 2) : 0;
      wind.u.uTime.value = ambient; wind.u.uOpacity.value = swk * 0.8;
      foam.u.uTime.value = ambient; foam.u.uPixel.value = px; foam.u.uOpacity.value = swk;

      // B/C. The table; the cable lights and runs out of the room.
      T.redraw(ambient);
      T.lamp.intensity = st === 1 ? 30 : 0;
      T.cable.mesh.visible = T.gbA.group.visible = T.gbB.group.visible = st === 1;
      const fuse = st === 1 ? ramp(t, tNow, tNow + 1.4) : 0;
      T.cable.u.uFuse.value = fuse;
      T.cable.u.uHead.value = fuse > 0 && fuse < 1 ? fuse : -1;
      // The light that left the cable flies ahead of the camera.
      const flyK = ramp(t, tNow + 1.4, tThousand - 0.3);
      const hp = new THREE.Vector3(14, 0.4, -10).lerp(new THREE.Vector3(AT.city, -6, -440), flyK * flyK);
      trail.u.uCenter.value.copy(hp); trail.u.uTime.value = ambient; trail.u.uPixel.value = px; trail.u.uOpacity.value = st === 1 && flyK > 0 && flyK < 1 ? 1 : 0;
      head.sprite.position.copy(hp); head.set("#e6ff9a", st === 1 && flyK > 0 && flyK < 1 ? 0.9 : 0);
      city.mesh.visible = sea.visible = world.group.visible = st === 1 && t > tNow + 2;
      city.u.uTime.value = ambient;
      world.u.uTime.value = ambient; world.u.uPixel.value = px;
      world.group.rotation.y = t * 0.02;

      // D. The galaxy forms; the first three and Mew in front, Pikachu at its heart.
      const gk = st === 2 ? ramp(t, tThousand + 0.6, tThousand + 5) : 0;
      galU.uK.value = gk;
      galU.uSpin.value = (t - tThousand) * 0.05;
      galU.uShow.value = st === 2 ? 1 - ramp(t, tYours - 1.4, tYours - 0.2) : 0;
      galU.uTime.value = ambient; galU.uPixel.value = px;
      galaxy.visible = st === 2;
      core.set("#ffe0a0", st === 2 ? 0.12 + 0.2 * gk : 0);
      dust.u.uTime.value = ambient; dust.u.uPixel.value = px; dust.u.uOpacity.value = st === 2 ? gk : 0;
      heroes.forEach((h, i) => {
        if (!h) return;
        const k = st === 2 ? ramp(t, tThousand + 2.4 + (i ? 0.6 + i * 0.3 : 0), tThousand + 3.6 + (i ? 0.6 + i * 0.3 : 0)) * (1 - ramp(t, tYours - 1.2, tYours - 0.2)) : 0;
        h.fig.group.visible = k > 0.001;
        h.set(k, ambient, viewH, cam, 0.06, 0.08);
      });
      // The galaxy breaks into fireflies.
      fallFlies.u.uTime.value = ambient; fallFlies.u.uPixel.value = px; fallFlies.u.uOpacity.value = st === 2 ? ramp(t, tYours - 1.6, tYours - 0.4) : 0;

      // E. The field at dusk, the child with the net, the ring of light.
      field.mesh.visible = grass.mesh.visible = kid.mesh.visible = st === 3;
      grass.u.uTime.value = ambient;
      kid.setRim("#ffcf7a", 1.6);
      flies.u.uTime.value = ambient; flies.u.uPixel.value = px; flies.u.uOpacity.value = st === 3 ? 1 : 0;
      dusk.set("#ffb05a", st === 3 ? 0.5 : 0);
      const ringAt = tYours + 4.2;
      finalRing.u.uK.value = ramp(t, ringAt, ringAt + 2.2);
      finalRing.u.uOpacity.value = st === 3 && t > ringAt ? 1 - ramp(t, ringAt + 1.6, ringAt + 2.4) : 0;
      finalRing.u.uTime.value = ambient;
      finalRing.mesh.scale.setScalar(6);
      finalRing.mesh.quaternion.copy(cam.quaternion);
    },
    look: (t) => {
      const base = t < tYours ? { ...STOCK.clean } : { ...STOCK.film70s };
      return lookAt(t, base, {
        exposure: [[0, 0.95], [tThen, 0.9], [tNow + 3, 1.0], [tThousand, 1.0], [tYours, 0.95], [end, 0.95]],
        bloom: [[0, 1.0], [tThen, 0.85], [tNow + 1, 1.2], [tNow + 4, 1.0], [tThousand + 2, 0.95], [tYours - 0.5, 1.1], [tYours, 0.85], [tYours + 4.2, 0.9], [tYours + 4.6, 1.3], [end, 1.0]],
        bloomThreshold: [[0, 0.7], [tYours - 0.01, 0.65], [tYours, 0.7], [end, 0.7]],
        flash: [[tYours - 0.3, 0], [tYours, 0.4], [tYours + 0.5, 0], [tYours + 4.1, 0], [tYours + 4.3, 0.35], [tYours + 5, 0]],
        fade: [[0, 0.5], [1.0, 0], [end - 1.2, 0], [end, 0.35]],
      });
    },
    dispose() { D.dispose(); },
  };
};

