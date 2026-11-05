import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeGlow, makeParticles, makeRing, makeShaft, makeSky, ramp, rng } from "@/components/world-history/scene/kit";
import { makeCity } from "@/components/world-history/scene/props";
import { lights, loadFigures, lookAt, pointPixel, spike } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { REGION_MAPS } from "@/lib/timeline/types";
import { bowlPoints, glassMaterial, makeArcs, makeCritterWall, makeCrowd, makeDevice, makeGlobe, makeRegionFloor, makeStadium, makeStars, spherePoint, type Device } from "../story-kit";
import { bag, heroFigure, STOCK, type Hero } from "./base";

/**
 * VII. A Growing World: one continuous flight, no cuts. The 3D Timeline's
 * region maps glow on the floor below as it goes: Johto, where the sky turns
 * from sun to moon, Ho-Oh and Lugia loop overhead and an egg cracks open;
 * across the sea to Hoenn, Groudon and Kyogre facing each other under a
 * sky split red and blue; Sinnoh, from where the camera lifts into orbit
 * over a planet of points threaded with thousands of links (slow motion),
 * Dialga and Palkia at the edge of space; down into a stadium of lights;
 * and Unova's skyline at dusk, Reshiram and Zekrom circling, a field of new
 * shapes glowing on in a wave. In the corner of the frame a glass case
 * holds the hardware of the moment: Game Boy Color, then Advance, then DS.
 */

const Z = { johto: 0, hoenn: -95, sinnoh: -190, stadium: -300, unova: -385 };

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tClock = B("clock"), tColour = B("colour"), tOnline = B("online"), tWorlds = B("worlds"), tFresh = B("fresh");
  const P = ctx.q.particles;

  const sky = D.add(makeSky({ top: "#3a78d0", horizon: "#bfe0ff", bottom: "#0a1830", stars: 0 }));
  scene.add(sky.mesh);
  const stars = D.add(makeStars({ count: 2600, radius: 700, center: [0, 0, -200] }));
  scene.add(stars.points);
  const L = lights(scene, { sky: "#cfe0ff", ground: "#203040", fill: 0.8, key: "#fff0d8", keyK: 1.6, keyPos: [8, 20, 10], rim: "#9ad0ff", rimK: 0.8 });

  // ---- The region floors.
  const floors = await Promise.all(([[2, Z.johto, "#7ad8ff"], [3, Z.hoenn, "#ff9a6a"], [4, Z.sinnoh, "#b8a8ff"], [5, Z.unova, "#ffd27a"]] as [number, number, string][]).map(async ([gen, z, tint]) => {
    const m = REGION_MAPS[gen];
    const f = D.add(await makeRegionFloor({ src: m.src, w: m.w, h: m.h, width: 66, tint, signal: ctx.signal }));
    f.mesh.position.set(0, 0, z);
    scene.add(f.mesh);
    return f;
  }));
  // A dark ground under all of it, and the sea between Johto and Hoenn.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 520).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#050c16"), roughness: 0.95, metalness: 0 }));
  ground.position.set(0, -0.05, -200);
  scene.add(ground);
  D.add({ dispose: () => { ground.geometry.dispose(); (ground.material as THREE.Material).dispose(); } });
  const seaGlints = D.add(makeParticles({ count: Math.round(900 * P) + 100, shape: "box", center: [0, 0.1, -48], extent: [50, 0.05, 30], velocity: [0, 0, 0], spread: [0.05, 0, 0.05], life: 2.5, size: [0.05, 0.14], colors: ["#ffffff", "#9ad8ff", "#3a8aff"], intensity: 1.6, flicker: 0.9 }));
  scene.add(seaGlints.points);

  // ---- Johto: the egg.
  const eggMat = new THREE.MeshStandardMaterial({ color: col("#f4ecd8"), roughness: 0.4, emissive: col("#ffe8a0"), emissiveIntensity: 0.2 });
  const eggTop = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), eggMat);
  const eggBot = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), eggMat);
  const egg = new THREE.Group();
  egg.add(eggTop, eggBot);
  egg.scale.set(0.9, 1.2, 0.9);
  egg.position.set(-6, 1.2, Z.johto + 2);
  scene.add(egg);
  D.add({ dispose: () => { eggTop.geometry.dispose(); eggBot.geometry.dispose(); eggMat.dispose(); } });
  const eggGlow = D.add(makeGlow({ pos: [-6, 1.4, Z.johto + 2], size: 5, color: "#ffe8a0", intensity: 0 }));
  scene.add(eggGlow.sprite);
  const hatch = D.add(makeRing({ color: "#fff0b0", intensity: 1.8, thickness: 0.05 }));
  hatch.mesh.position.set(-6, 1.4, Z.johto + 2);
  scene.add(hatch.mesh);
  const moon = D.add(makeGlow({ pos: [30, 40, Z.johto - 90], size: 22, color: "#dfe8ff", intensity: 0 }));
  const sun = D.add(makeGlow({ pos: [-30, 40, Z.johto - 90], size: 40, color: "#fff0c0", intensity: 0.8 }));
  scene.add(moon.sprite, sun.sprite);

  // ---- Hoenn: a sky split red and blue.
  const red = D.add(makeGlow({ pos: [-26, 10, Z.hoenn - 12], size: 60, color: "#ff4a2a", intensity: 0 }));
  const blue = D.add(makeGlow({ pos: [26, 10, Z.hoenn - 12], size: 60, color: "#2a7aff", intensity: 0 }));
  scene.add(red.sprite, blue.sprite);

  // ---- Online: a planet of points under Sinnoh, threaded with links.
  const GR = 46, GC: Vec3 = [0, -58, Z.sinnoh - 40];
  const globe = D.add(makeGlobe({ radius: GR, count: Math.round(14000 * Math.max(0.45, P)), land: "#8ab8ff", lit: "#bfe8ff", sea: "#02060f", seed: 3 }));
  globe.group.position.set(...GC);
  globe.u.uSize.value = GR * 0.014;
  scene.add(globe.group);
  const gr = rng(29);
  const pairs: [Vec3, Vec3][] = Array.from({ length: Math.round(90 * Math.max(0.5, P)) }, () => [spherePoint(gr, 0.9), spherePoint(gr, 0.9)]);
  const links = D.add(makeArcs({ radius: GR, pairs, color: "#bfe8ff", perArc: 50, lift: 0.3 }));
  links.points.position.set(...GC);
  links.u.uSize.value = 0.9;
  scene.add(links.points);

  // ---- Worlds: a stadium bowl, crowds of lights, spot shafts, a cup.
  const stadium = D.add(makeStadium({ inner: 9, outer: 20, height: 7, pitch: "#2a5a9a", stand: "#3a4058" }));
  const stadLight = new THREE.PointLight(col("#e8f0ff"), 0, 60, 1.2);
  stadLight.position.set(0, 14, Z.stadium);
  scene.add(stadLight);
  stadium.group.position.set(0, 0, Z.stadium);
  scene.add(stadium.group);
  const crowd = D.add(makeCrowd({ points: bowlPoints({ inner: 10, outer: 20, height: 7, count: Math.round(3200 * P) + 400, center: [0, 0, Z.stadium] }), colors: ["#ffe8b0", "#9ad8ff"], size: 0.1, intensity: 1.4 }));
  scene.add(crowd.points);
  const spots = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => { const s = D.add(makeShaft({ from: [sx * 17, 14, Z.stadium + sz * 14], to: [0, 0, Z.stadium], r0: 0.3, r1: 2.6, color: "#e8f0ff", intensity: 0.7, noise: 0.4 })); scene.add(s.mesh); return s; }));
  const cupMat = new THREE.MeshStandardMaterial({ color: col("#f2c96b"), roughness: 0.2, metalness: 1, emissive: col("#7a5a10"), emissiveIntensity: 0.4 });
  const cupProfile = [[0, 0], [0.7, 0], [0.7, 0.15], [0.25, 0.3], [0.2, 0.9], [0.3, 1.0], [0.85, 1.4], [0.95, 2.1], [0.9, 2.15]].map(([x, y]) => new THREE.Vector2(x, y));
  const cup = new THREE.Mesh(new THREE.LatheGeometry(cupProfile, 40), cupMat);
  cup.position.set(0, 0.05, Z.stadium);
  scene.add(cup);
  D.add({ dispose: () => { cup.geometry.dispose(); cupMat.dispose(); } });
  const cupGlow = D.add(makeGlow({ pos: [0, 1.6, Z.stadium], size: 7, color: "#ffd27a", intensity: 0 }));
  scene.add(cupGlow.sprite);

  // ---- Unova: a skyline at dusk, and a field of new shapes.
  const skyline = D.add(makeCity({ center: [0, 0, Z.unova - 46], radius: 26, count: 70, height: [10, 34], color: "#7a5a3a", seed: 5 }));
  scene.add(skyline.mesh);
  const field = D.add(makeCritterWall({ count: Math.round(260 * Math.max(0.5, P)), cols: 26, cell: 1.6, center: [0, 0, 0], colors: ["#bfe8ff", "#ffe27a"], seed: 9 }));
  field.mesh.rotation.x = -Math.PI / 2;
  field.mesh.position.set(0, 0.25, Z.unova + 4);
  scene.add(field.mesh);
  const fire = D.add(makeParticles({ count: Math.round(400 * P) + 60, shape: "sphere", center: [0, 0, 0], extent: [1.8, 1.8, 1.8], velocity: [0, 0.6, 0], spread: [0.5, 0.5, 0.5], life: 1.4, size: [0.05, 0.14], colors: ["#ffffff", "#ffe0c0", "#ff9a5a"], intensity: 2.4, turbulence: 0.8, flicker: 0.5 }));
  const volt = D.add(makeParticles({ count: Math.round(400 * P) + 60, shape: "sphere", center: [0, 0, 0], extent: [1.8, 1.8, 1.8], velocity: [0, 0.3, 0], spread: [0.8, 0.8, 0.8], life: 0.7, size: [0.04, 0.1], colors: ["#ffffff", "#9ad8ff", "#3a6aff"], intensity: 2.8, turbulence: 1.4, flicker: 0.9 }));
  scene.add(fire.points, volt.points);

  // ---- The hardware case that rides in the corner of the frame.
  const caseG = new THREE.Group();
  const kinds: Device[] = (["gbc", "gba", "ds"] as const).map((k) => {
    const d = D.add(makeDevice(k, { draw: (g, w, h) => { const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, "#6ac8ff"); grd.addColorStop(1, "#ffd27a"); g.fillStyle = grd; g.fillRect(0, 0, w, h); } }));
    d.group.scale.setScalar(0.18);
    caseG.add(d.group);
    return d;
  });
  const glass = glassMaterial({ tint: "#d8f0ff", edge: "#e8f4ff", k: 0.6 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.56, 0.32), glass);
  caseG.add(box);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.08, 0.38), new THREE.MeshStandardMaterial({ color: col("#5a3a22"), roughness: 0.5 }));
  plinth.position.y = -0.32;
  caseG.add(plinth);
  const caseLight = new THREE.PointLight(col("#fff0d8"), 0.6, 2, 1.5);
  caseLight.position.set(0.2, 0.4, 0.6);
  caseG.add(caseLight);
  scene.add(caseG);
  D.add({ dispose: () => { box.geometry.dispose(); glass.dispose(); plinth.geometry.dispose(); (plinth.material as THREE.Material).dispose(); } });

  // ---- The legends.
  const figs = await loadFigures(ctx, [250, 249, 383, 382, 483, 484, 643, 644]);
  const mk = (dex: number, pos: Vec3, h: number, accent: string, rotY = 0) => { const f = heroFigure(figs.get(dex), { pos, height: h, accent, scene, rotY }); if (f) D.add(f); return f; };
  const hoOh = mk(250, [0, 18, Z.johto], 5, "#ffb04a");
  const lugia = mk(249, [0, 18, Z.johto], 5, "#9ad8ff");
  const groudon = mk(383, [-11, 0.2, Z.hoenn - 6], 8, "#ff5a2a", 0.9);
  const kyogre = mk(382, [11, 0.6, Z.hoenn - 6], 8, "#3a8aff", -0.9);
  const dialga = mk(483, [-19, 12, Z.sinnoh - 44], 10, "#6ab8ff", 0.5);
  const palkia = mk(484, [19, 12, Z.sinnoh - 44], 10, "#ff9ad8", -0.5);
  const reshiram = mk(643, [0, 12, Z.unova - 10], 8.5, "#ffd8b0");
  const zekrom = mk(644, [0, 12, Z.unova - 10], 8.5, "#6ab8ff");

  const keys: Key[] = [
    { t: 0, pos: [0, 18, Z.johto + 42], look: [0, 0, Z.johto], fov: 50 },
    { t: tClock + 1, pos: [2, 15, Z.johto + 28], look: [-2, 3, Z.johto - 2], fov: 50 },
    { t: tClock + 4, pos: [5, 13, Z.johto + 14], look: [-2, 5, Z.johto - 6], fov: 52 },
    { t: tClock + 6.5, pos: [4, 12, Z.johto - 2], look: [0, 6, Z.johto - 18], fov: 52 },
    { t: tColour - 0.8, pos: [0, 9, Z.johto - 40], look: [0, 3, Z.hoenn + 6], fov: 52 },
    { t: tColour + 2.4, pos: [0, 8, Z.hoenn + 28], look: [0, 4, Z.hoenn - 8], fov: 50 },
    { t: tColour + 5.2, pos: [0, 9, Z.hoenn + 17], look: [0, 4, Z.hoenn - 8], fov: 50 },
    { t: tOnline - 1.2, pos: [0, 11, Z.hoenn - 30], look: [0, 2, Z.sinnoh], fov: 50 },
    { t: tOnline + 0.6, pos: [0, 16, Z.sinnoh + 22], look: [0, 0, Z.sinnoh - 4], fov: 52 },
    { t: tOnline + 2.4, pos: [0, 44, Z.sinnoh + 30], look: [0, -14, Z.sinnoh - 40], fov: 54 },
    { t: tOnline + 6, pos: [0, 62, Z.sinnoh + 44], look: [0, 2, Z.sinnoh - 60], fov: 54 },
    { t: tWorlds - 1, pos: [0, 34, Z.stadium + 60], look: [0, 0, Z.stadium], fov: 50 },
    { t: tWorlds + 1.6, pos: [0, 24, Z.stadium + 16], look: [0, 0, Z.stadium - 2], fov: 50 },
    { t: tWorlds + 5, pos: [3, 15, Z.stadium + 10], look: [0, 1, Z.stadium], fov: 48 },
    { t: tFresh - 0.6, pos: [0, 12, Z.stadium - 26], look: [0, 6, Z.unova], fov: 50 },
    { t: tFresh + 3, pos: [0, 9, Z.unova + 34], look: [0, 8, Z.unova - 10], fov: 50 },
    { t: end, pos: [0, 8, Z.unova + 24], look: [0, 9.5, Z.unova - 12], fov: 48 },
  ];

  // Sky palettes by stretch, blended.
  const pal: [number, string, string, string][] = [
    [0, "#3a78d0", "#bfe0ff", "#0a1830"],
    [tClock + 2, "#3a78d0", "#ffd8a0", "#0a1830"],
    [tClock + 4.5, "#0a1440", "#3a4a8a", "#02060f"],
    [tColour - 1, "#1a2a6a", "#5a6aa0", "#02060f"],
    [tColour + 1.5, "#2a1a4a", "#ff8a6a", "#05040a"],
    [tOnline, "#10183a", "#5a5aa0", "#02040a"],
    [tOnline + 2.2, "#000208", "#040818", "#000000"],
    [tWorlds - 0.5, "#000208", "#040818", "#000000"],
    [tWorlds + 1, "#050a1e", "#1a2a5a", "#02040a"],
    [tFresh, "#1a1a4a", "#ff8a5a", "#08040c"],
    [end, "#22184a", "#ff9a6a", "#08040c"],
  ];
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  const palAt = (t: number, i: 1 | 2 | 3, out: THREE.Color) => {
    let k = 0;
    while (k < pal.length - 2 && t > pal[k + 1][0]) k++;
    const [t0, ...a] = pal[k], [t1, ...b] = pal[Math.min(pal.length - 1, k + 1)];
    const x = Math.max(0, Math.min(1, (t - t0) / Math.max(1e-3, t1 - t0)));
    return out.copy(tmpA.set(a[i - 1])).lerp(tmpB.set(b[i - 1]), x * x * (3 - 2 * x));
  };
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const set = (h: Hero | null, k: number, pos: Vec3, rotY: number | undefined, ambient: number, viewH: number, cam: THREE.PerspectiveCamera, bob = 0.05) => {
    if (!h) return;
    h.move(pos, rotY);
    h.fig.group.visible = k > 0.001;
    h.set(k, ambient, viewH, cam, bob, 0.05);
  };

  return {
    scene,
    portalScale: 1.6,
    camera: (t) => poseOnPath(keys, t),
    orbit: (t) => ({ target: poseOnPath(keys, t).look, limits: { yaw0: 0, yawSpan: 1.0, minPitch: -0.1, maxPitch: 1.3, minDist: 2, maxDist: 90 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      sky.follow(cam);
      palAt(t, 1, sky.u.uTop.value); palAt(t, 2, sky.u.uHorizon.value); palAt(t, 3, sky.u.uBottom.value);
      const night = ramp(t, tClock + 2.5, tClock + 4.5);
      const space = ramp(t, tOnline + 1, tOnline + 3) * (1 - ramp(t, tWorlds - 0.5, tWorlds + 1));
      stars.mat.opacity = Math.max(night * (1 - ramp(t, tColour, tColour + 2)) * 0.7, space, 0.25 * ramp(t, tFresh, end));
      sun.set("#fff0c0", 0.8 * (1 - night));
      moon.set("#dfe8ff", 0.7 * night * (1 - ramp(t, tColour - 1, tColour + 1)));
      L.key.intensity = 1.6 * (1 - night * 0.6) * (1 - space * 0.7);
      L.hemi.intensity = 0.8 * (1 - night * 0.4);
      // The floors glow up as we reach them.
      const near = [tClock - 3, tColour - 1, tOnline - 2, tFresh - 1];
      floors.forEach((f, i) => { f.u.uA.value = ramp(t, near[i], near[i] + 2) * (i === 2 ? 1 - space : 1); f.u.uTime.value = ambient; });
      seaGlints.u.uTime.value = ambient; seaGlints.u.uPixel.value = px;
      seaGlints.u.uOpacity.value = ramp(t, tClock + 6, tColour - 1) * (1 - ramp(t, tColour + 3, tOnline));

      // Johto: Ho-Oh and Lugia loop overhead; the egg glows and cracks open.
      const loop = ramp(t, tClock + 0.5, tClock + 2);
      const la = ambient * 0.35;
      set(hoOh, loop * (1 - ramp(t, tColour, tColour + 1)), [Math.cos(la) * 10, 9.5 + Math.sin(la * 2) * 1.2, Z.johto - 8 + Math.sin(la) * 7], -la + Math.PI, ambient, viewH, cam);
      set(lugia, loop * (1 - ramp(t, tColour, tColour + 1)), [Math.cos(la + Math.PI) * 10, 8.5 + Math.sin(la * 2 + 1) * 1.2, Z.johto - 8 + Math.sin(la + Math.PI) * 7], -la, ambient, viewH, cam);
      const crack = ramp(t, tClock + 4.6, tClock + 5.4);
      eggTop.position.set(crack * 0.3, crack * 0.9, 0);
      eggTop.rotation.z = -crack * 0.8;
      eggBot.position.y = 0;
      eggGlow.set("#ffe8a0", 0.3 * ramp(t, tClock + 2.5, tClock + 4.5) + 1.2 * spike(t, tClock + 5.0, 0.08, 0.8));
      hatch.u.uK.value = ramp(t, tClock + 5.0, tClock + 6.4); hatch.u.uOpacity.value = t > tClock + 5 ? 1 - ramp(t, tClock + 6, tClock + 6.4) : 0; hatch.u.uTime.value = ambient;
      hatch.mesh.scale.setScalar(4); hatch.mesh.quaternion.copy(cam.quaternion);
      egg.visible = t < tColour + 2;

      // Hoenn: the two face off, calmly, under a split sky.
      const ho = ramp(t, tColour + 0.4, tColour + 2) * (1 - ramp(t, tOnline, tOnline + 1.5));
      set(groudon, ho, [-11, 0.2, Z.hoenn - 6], 0.9, ambient, viewH, cam, 0.02);
      set(kyogre, ho, [11, 0.4 + Math.sin(ambient * 0.8) * 0.3, Z.hoenn - 6], -0.9, ambient, viewH, cam, 0.02);
      red.set("#ff4a2a", 0.5 * ho); blue.set("#2a7aff", 0.5 * ho);

      // Online: the planet, the links, the pair at the edge of space.
      const orb = ramp(t, tOnline + 0.8, tOnline + 2.6) * (1 - ramp(t, tWorlds - 1, tWorlds + 0.5));
      globe.group.visible = links.points.visible = orb > 0.01;
      globe.u.uAll.value = 0.3;
      globe.u.uSpread.value = ramp(t, tOnline + 1, tOnline + 6) * 3.2;
      globe.u.uFrom.value.set(0, 1, 0.3).normalize();
      globe.u.uTime.value = ambient; globe.u.uPixel.value = px;
      globe.group.rotation.set(0.9, 2.2 + (t - tOnline) * 0.02, 0);
      links.points.rotation.copy(globe.group.rotation);
      links.u.uGrow.value = ramp(t, tOnline + 0.9, tOnline + 4.5);
      links.u.uTime.value = ambient; links.u.uPixel.value = px;
      set(dialga, orb * ramp(t, tOnline + 2.0, tOnline + 3.4), [-19, 12, Z.sinnoh - 44], 0.5, ambient, viewH, cam, 0.03);
      set(palkia, orb * ramp(t, tOnline + 2.3, tOnline + 3.7), [19, 12, Z.sinnoh - 44], -0.5, ambient, viewH, cam, 0.03);

      // Worlds: the stadium lights up.
      const st = ramp(t, tWorlds - 0.5, tWorlds + 1.5) * (1 - ramp(t, tFresh, tFresh + 1.5));
      crowd.u.uTime.value = ambient; crowd.u.uPixel.value = px; crowd.u.uShow.value = st; crowd.u.uCheer.value = ramp(t, tWorlds + 1, tWorlds + 2);
      spots.forEach((s) => { s.u.uOpacity.value = st; s.u.uTime.value = ambient; });
      cupGlow.set("#ffd27a", 0.6 * st + 0.6 * spike(t, tWorlds + 1.2, 0.1, 1.2));
      cup.rotation.y = ambient * 0.3;
      stadium.group.visible = cup.visible = t > tOnline + 4;
      stadLight.intensity = 45 * st;

      // Unova: the skyline at dusk, the pair circling, the field glowing on in a wave.
      const un = ramp(t, tFresh + 0.2, tFresh + 1.8);
      const ca = ambient * 0.5;
      const rp: Vec3 = [Math.cos(ca) * 9, 9 + Math.sin(ca * 2) * 1.2, Z.unova - 2 + Math.sin(ca) * 5];
      const zp: Vec3 = [Math.cos(ca + Math.PI) * 9, 9 + Math.sin(ca * 2 + 2) * 1.2, Z.unova - 2 + Math.sin(ca + Math.PI) * 5];
      set(reshiram, un, rp, -ca + Math.PI, ambient, viewH, cam);
      set(zekrom, un, zp, -ca, ambient, viewH, cam);
      fire.u.uCenter.value.set(rp[0], rp[1] + 2.5, rp[2]); fire.u.uTime.value = ambient; fire.u.uPixel.value = px; fire.u.uOpacity.value = un;
      volt.u.uCenter.value.set(zp[0], zp[1] + 2.5, zp[2]); volt.u.uTime.value = ambient; volt.u.uPixel.value = px; volt.u.uOpacity.value = un;
      field.u.uFill.value = ramp(t, tFresh + 2.4, tFresh + 6) * 1.1;
      field.u.uTime.value = ambient;
      field.u.uDim.value = 0.6;
      field.mesh.visible = t > tFresh;
      skyline.u.uTime.value = ambient;
      skyline.mesh.visible = t > tFresh - 1.5;
      skyline.u.uLit.value = 0.25 + 0.75 * ramp(t, tFresh + 1, tFresh + 5);
      ground.visible = orb < 0.4;

      // The case in the corner of the frame: GBC → GBA → DS.
      cam.getWorldDirection(fwd);
      right.crossVectors(fwd, cam.up).normalize();
      up.crossVectors(right, fwd).normalize();
      const dist = 2.4, halfH = Math.tan((cam.fov * Math.PI) / 360) * dist, halfW = halfH * cam.aspect;
      const sx = halfW * 0.8, sy = -halfH * 0.56;
      caseG.position.copy(cam.position).addScaledVector(fwd, dist).addScaledVector(right, sx).addScaledVector(up, sy);
      caseG.quaternion.copy(cam.quaternion);
      caseG.rotateY(-0.35);
      caseG.scale.setScalar(Math.min(0.75, halfW * 0.5));
      const which = t < tColour + 0.5 ? 0 : t < tOnline - 0.5 ? 1 : 2;
      kinds.forEach((d, i) => {
        const k = i === which ? 1 : 0;
        d.group.visible = k > 0;
        d.group.rotation.y = Math.sin(ambient * 0.7) * 0.4;
        d.group.position.y = 0.02;
      });
      caseG.visible = t > 1.2 && t < end - 0.3;
    },
    look: (t) =>
      lookAt(t, { ...STOCK.pop, saturation: 1.15 }, {
        exposure: [[0, 1.0], [tClock + 4, 0.92], [tOnline + 2, 1.0], [tWorlds + 1, 0.95], [end, 0.95]],
        bloom: [[0, 0.8], [tOnline, 0.8], [tOnline + 2, 0.85], [tWorlds, 0.8], [tFresh + 2, 0.9], [end, 0.9]],
        bloomThreshold: [[0, 0.8], [end, 0.8]],
        flash: [[tColour - 0.2, 0], [tColour, 0.18], [tColour + 0.4, 0], [tFresh - 0.2, 0], [tFresh, 0.15], [tFresh + 0.4, 0]],
        fade: [[0, 0.5], [1.0, 0]],
      }),
    dispose() { D.dispose(); },
  };
};
