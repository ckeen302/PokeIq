import * as THREE from "three";
import { poseOnPath, type Key, type Vec3 } from "@/lib/world-history/camera";
import { col, makeGlow, makeParticles, makeSky } from "../kit";
import type { ChapterBuilder } from "../types";
import { figureStyle, floatFigure, lights, loadFigures, lookAt, place, pointPixel } from "./common";

/** A simple exhibit: a sky in the chapter's colours and its figures on a lit stage (used while a chapter's set piece is built). */
export function generic(o: { sky: [string, string, string]; accent: string; arts?: number[] }): ChapterBuilder {
  return async (ctx) => {
    const scene = new THREE.Scene();
    const sky = makeSky({ top: o.sky[0], horizon: o.sky[1], bottom: o.sky[2], nebulaA: o.accent, nebulaB: o.sky[1], nebula: 0.6, stars: 0.04 });
    scene.add(sky.mesh);
    lights(scene, { sky: "#ffffff", ground: o.sky[2], fill: 0.6, key: "#fff2dc", keyK: 1.8, keyPos: [5, 10, 12], rim: o.accent, rimK: 1.4, rimPos: [-6, 8, -12] });
    const arts = o.arts ?? [...new Set(ctx.chapter.figures.map((f) => f.art))];
    const figs = await loadFigures(ctx, arts);
    const n = arts.length;
    const spots: Vec3[] = arts.map((_, i) => [(i - (n - 1) / 2) * 4.2, 0, -Math.abs(i - (n - 1) / 2) * 1.2]);
    arts.forEach((a, i) => { place(figs.get(a), spots[i], 3.2, -spots[i][0] * 0.05, scene); figureStyle(figs.get(a), { rim: o.accent, rimK: 1.2 }); });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col("#0c0a12"), roughness: 0.4, metalness: 0.2 }));
    scene.add(floor);
    const glow = makeGlow({ pos: [0, 2, -3], size: 18, color: o.accent, intensity: 0.5 });
    scene.add(glow.sprite);
    const motes = makeParticles({ count: Math.round(800 * ctx.q.particles) + 40, shape: "box", center: [0, 4, 0], extent: [16, 5, 10], velocity: [0, 0.2, 0], spread: [0.1, 0.1, 0.1], life: 9, size: [0.03, 0.08], colors: ["#ffffff", o.accent, o.accent], intensity: 1.6, turbulence: 0.6 });
    scene.add(motes.points);
    const end = ctx.timing.anim;
    const keys: Key[] = [
      { t: 0, pos: [0, 3, 26], look: [0, 2, 0], fov: 42 },
      { t: end * 0.5, pos: [-6, 4, 18], look: [0, 2, 0], fov: 42 },
      { t: end, pos: [4, 3.5, 20], look: [0, 2, 0], fov: 44 },
    ];
    return {
      scene,
      camera: (t) => poseOnPath(keys, t),
      orbit: () => ({ target: [0, 2, 0], limits: { yaw0: 0, yawSpan: 1, minPitch: -0.1, maxPitch: 1, minDist: 4, maxDist: 60 } }),
      update(_t, ambient, cam, viewH) {
        sky.follow(cam);
        sky.u.uTime.value = ambient;
        motes.u.uTime.value = ambient;
        motes.u.uPixel.value = pointPixel(viewH, cam);
        arts.forEach((a, i) => floatFigure(figs.get(a), spots[i], ambient, 0.08, i, -spots[i][0] * 0.05, 0.04));
      },
      look: (t) => lookAt(t, { bloom: 0.8 }, {}),
      dispose() {
        sky.dispose();
        motes.dispose();
        glow.dispose();
        floor.geometry.dispose();
        (floor.material as THREE.Material).dispose();
        figs.forEach((f) => f.dispose());
      },
    };
  };
}
