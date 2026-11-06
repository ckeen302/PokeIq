import * as THREE from "three";
import { jointAngles, type LimbPart } from "@/lib/race/limbs";
import { poseFor } from "@/lib/race/gait";
import { MAX_PARTS } from "@/lib/race/parts";
import { makeRace } from "@/lib/race/race";
import type { Motion } from "@/lib/race/types";
import type { Athlete } from "@/lib/games/athlete";
import { loadFigure, type Figure, type RunnerOptions, type RunnerUrls } from "@/components/race/scene/runners";
import { LAYER } from "@/components/race/scene/stadium";
import type { ActorPose } from "./pose";

export type { ActorPose, LimbSet } from "./pose";

/**
 * The athletes: each Pokémon's articulated 3D figure from the Race (its
 * HOME render on a relief mesh with a sculpted back, its legs, arms, wings
 * and tail found in a worker: components/race/scene/runners), posed here
 * for every event on the same rig, driven by the physics:
 *
 * - the root at a ground point, the body leaning about its lateral axis,
 *   rolled in its own plane (a Fosbury layout, a dive, a fall), swayed,
 *   squashed and stretched, arched (the bend uniform);
 * - turned towards the camera as in the Race (a little past its direction
 *   of travel) and mirrored so its head leads, or turned round (its back to
 *   a high-jump bar);
 * - its parts swung by the Race's gait (lib/race/limbs) or held in an
 *   event pose (arms overhead in a jerk, a knee drive at take-off),
 *   blended.
 */


export interface Actor {
  athlete: Athlete;
  fig: Figure;
  /** Figure size (m): width, standing height, hip height. */
  w: number;
  h: number;
  hip: number;
  runsRight: boolean;
  lastStep: number;
}

/** Loads one athlete's figure through the Race's own loader (a one-runner race gives it its lane). */
export async function loadActor(renderer: THREE.WebGLRenderer, athlete: Athlete, urls: RunnerUrls, o: RunnerOptions, signal: AbortSignal): Promise<Actor> {
  const lane = makeRace([athlete.entrant], 100).lanes[0];
  const fig = await loadFigure(renderer, lane, urls, o, signal);
  return { athlete, fig, w: lane.w, h: lane.h, hip: lane.hip, runsRight: true, lastStep: 0 };
}

const up = new THREE.Vector3(0, 1, 0);
const camPos = new THREE.Vector3(), camRight = new THREE.Vector3(), axis = new THREE.Vector3(), tmp = new THREE.Vector3();
const qLean = new THREE.Quaternion(), qSway = new THREE.Quaternion();
const inv = new THREE.Matrix4(), dLoc = new THREE.Vector3(), upLoc = new THREE.Vector3(), S = new THREE.Vector3(), Zl = new THREE.Vector3(0, 0, 1);

const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Poses an actor for a frame. `time` drives idle motion. */
export function poseActor(act: Actor, p: ActorPose, cam: THREE.Camera, time: number) {
  const f = act.fig;
  f.root.visible = p.visible;
  if (!p.visible) return;
  cam.getWorldPosition(camPos);
  camRight.setFromMatrixColumn(cam.matrixWorld, 0);
  const shake = p.shake ? p.shake * Math.sin(time * 47) : 0;
  f.root.position.set(p.x + shake * 0.6, p.y, p.z + shake * 0.4);
  // Lean about the lateral axis, sway about the direction of travel.
  axis.set(p.dx, 0, p.dz).cross(up);
  if (axis.lengthSq() < 1e-8) axis.set(0, 0, 1);
  axis.normalize();
  qLean.setFromAxisAngle(axis, -p.lean);
  if (p.sway) qLean.multiply(qSway.setFromAxisAngle(tmp.set(p.dx, 0, p.dz).normalize(), p.sway));
  f.lean.quaternion.copy(qLean);
  // Face the camera (a little past the direction of travel), or a locked direction; mirror so the head leads.
  let nx: number, nz: number;
  if (p.faceDir) [nx, nz] = p.faceDir;
  else {
    const cx = camPos.x - p.x, cz = camPos.z - p.z;
    const cl = Math.hypot(cx, cz) || 1;
    nx = cx / cl + p.dx * 0.32;
    nz = cz / cl + p.dz * 0.32;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
  }
  f.yaw.rotation.y = Math.atan2(nx, nz) + (p.turn ?? 0);
  const side = p.dx * camRight.x + p.dz * camRight.z;
  if (side > 0.12) act.runsRight = true;
  else if (side < -0.12) act.runsRight = false;
  const turned = Math.cos(p.turn ?? 0) < 0;
  // Mirrored so the head leads its direction of travel; turned round (its back to a bar), it faces back the way it came.
  f.mirrored = act.runsRight === (f.facing < 0);
  const sq = p.squash;
  f.yaw.scale.set((f.mirrored ? -1 : 1) * (1 - sq * 0.5), 1 + sq, 1 - sq * 0.5);
  // Roll in the figure's own plane about a point up its body.
  const pv = (p.pivot ?? 0.5) * act.h;
  f.spin.position.y = pv;
  f.body.position.y = -pv;
  // + roll takes the head towards the figure's back as seen: anticlockwise when it faces screen-right.
  const facesRight = act.runsRight !== turned;
  f.spin.rotation.z = p.roll * (facesRight ? 1 : -1) * (f.mirrored ? -1 : 1) * (turned ? -1 : 1);
  const U = f.uniforms;
  U.uWave.value = 0;
  // + bend bulges the front (the side the render faces).
  U.uBend.value.set((p.bend ?? 0) * f.meshH * (f.facing < 0 ? -1 : 1), f.meshH);
  U.uClipY.value = p.clipY ?? -1e5;
  // ---- Moving parts, in the mesh's own frame (as the Race does).
  f.root.updateMatrixWorld(true);
  inv.copy(f.body.matrixWorld).invert();
  dLoc.set(p.dx, 0, p.dz).transformDirection(inv);
  upLoc.set(0, 1, 0).transformDirection(inv);
  S.crossVectors(dLoc, upLoc);
  if (S.lengthSq() < 1e-8) S.set(1, 0, 0);
  S.normalize();
  S.set(S.x * 0.45, S.y * 0.45, S.z).normalize();
  const g = p.gait;
  const clock = { motion: g?.motion ?? "run", phase: g ? g.phase : time * 0.5, v: g ? g.v : 0, hip: act.hip, time };
  const raise = p.raise ?? 0;
  f.joints.forEach((j, k) => {
    if (k >= MAX_PARTS) return;
    const out = Math.sign(j.tip[0] - j.pivot[0]) || (j.pivot[0] >= 0 ? 1 : -1);
    const part: LimbPart = { kind: j.kind, side: j.side, front: j.front, out, stub: j.stub, reach: j.reach };
    const base = jointAngles(part, clock);
    const JA = U.uJA.value[k], JB = U.uJB.value[k], XA = U.uXA.value[k], XB = U.uXB.value[k];
    switch (j.kind) {
      case "leg": {
        const o = p.legs;
        let a = base.a, b = base.b;
        if (o) {
          const sp = (o.split ?? 0) * (j.side ? 1 : -1) * (j.front ? 1 : 1);
          a = mix(base.a, o.a + sp, o.k);
          b = mix(base.b, o.b, o.k);
        }
        JA.set(j.pivot[0], j.pivot[1], j.pivot[2], a);
        XA.set(S.x, S.y, S.z, 0);
        JB.set(j.knee[0], j.knee[1], j.knee[2], b);
        XB.set(S.x, S.y, S.z, 0);
        break;
      }
      case "arm": {
        const o = p.arms;
        const a = o ? mix(base.a, o.a, o.k) : base.a;
        const b = o ? mix(base.b, o.b, o.k) : base.b;
        tmp.copy(S).multiplyScalar(1 - raise).addScaledVector(Zl, raise).normalize();
        JA.set(j.pivot[0], j.pivot[1], j.pivot[2], a * (1 - raise) + out * (1.35 + 0.05 * Math.sin(time * 9)) * raise);
        XA.set(tmp.x, tmp.y, tmp.z, 0);
        JB.set(j.knee[0], j.knee[1], j.knee[2], b * (1 - raise * 0.85));
        XB.set(S.x, S.y, S.z, 0);
        break;
      }
      case "wing": {
        const o = p.wings;
        JA.set(j.pivot[0], j.pivot[1], j.pivot[2], o ? mix(base.a, o.a * out, o.k) : base.a * (1 + 0.4 * raise));
        XA.set(0, 0, 1, 0);
        JB.set(j.knee[0], j.knee[1], j.knee[2], o ? mix(base.b, o.b * out, o.k) : base.b);
        XB.set(0, 0, 1, 1);
        break;
      }
      case "tail": {
        const o = p.tail;
        JA.set(j.pivot[0], j.pivot[1], j.pivot[2], o ? mix(base.a, o.a, o.k) : base.a + 0.35 * raise * Math.sin(time * 11));
        XA.set(upLoc.x, upLoc.y, upLoc.z, 1);
        JB.set(j.pivot[0], j.pivot[1], j.pivot[2], o ? mix(base.b, o.b * out, o.k) : base.b);
        XB.set(0, 0, 1, 1);
        break;
      }
    }
  });
  if (p.swim) {
    const lat = tmp.crossVectors(upLoc, dLoc).normalize();
    const headX = f.facing < 0 ? -f.meshW / 2 : f.meshW / 2;
    U.uSwim.value.set(p.swim.amp * f.meshW, p.swim.waves, p.swim.phase, p.swim.style);
    U.uSwimAx.value.set(lat.x, lat.y, lat.z, headX);
    U.uSwimLen.value.set(-f.facing, f.meshW);
  } else U.uSwim.value.w = 0;
}

/** The Race's gait pose (lift, lean, squash…) for a gait at a speed: the base every running motion starts from. */
export function gaitPose(act: Actor, motion: Motion, phase: number, v: number, a: number, distance: number, time: number) {
  return poseFor(motion, { phase, v, a, h: act.h, hip: act.hip, distance, time });
}

/** Soft blob shadows under the actors (instanced), with one cast away from the key light. */
export function blobShadows(n: number): { mesh: THREE.InstancedMesh; set(i: number, x: number, y: number, z: number, w: number, d: number, k: number, lx?: number, lz?: number): void; commit(used: number): void; dispose(): void } {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vUv; varying float vA;
      void main(){ vUv = uv; vA = instanceColor.r; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec2 vUv; varying float vA;
      void main(){ vec2 q = (vUv - 0.5) * 2.0; float d = dot(q, q); float a = exp(-d * 3.2) * vA * (1.0 - smoothstep(0.85, 1.0, d)); gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n * 2);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 2 * 3), 3);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.layers.set(LAYER.MAIN);
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    mesh,
    set(i, x, y, z, w, d, k, lx = 0.35, lz = -0.5) {
      q.identity();
      pos.set(x, y + 0.012, z);
      s.set(w, 1, d);
      m.compose(pos, q, s);
      mesh.setMatrixAt(i * 2, m);
      mesh.instanceColor!.setXYZ(i * 2, 0.55 * k, 0, 0);
      // A long soft shadow away from the key light.
      const len = Math.max(w, d) * 1.6;
      q.setFromAxisAngle(up, Math.atan2(lx, lz));
      pos.set(x + lx * len * 0.45, y + 0.011, z + lz * len * 0.45);
      s.set(w * 0.8, 1, len);
      m.compose(pos, q, s);
      mesh.setMatrixAt(i * 2 + 1, m);
      mesh.instanceColor!.setXYZ(i * 2 + 1, 0.22 * k, 0, 0);
    },
    commit(used) {
      for (let i = used * 2; i < n * 2; i++) mesh.setMatrixAt(i, zero);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
