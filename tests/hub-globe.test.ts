import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FOV, LOOK_DOWN, TILT, cameraZ, project, toVec, turn, type Screen } from "@/components/geo/hub-globe/project";
import { toVec as toVec3 } from "@/components/globe/world-look";

/**
 * The landing globe's DOM overlay (names, pins) is placed with project.ts's maths; the scene draws with three.js
 * (hub-globe/scene.ts: a tilt group, Euler(LOOK_DOWN + tiltX, 0, -TILT, "XZY"), holding a spin group, Ry(angle)).
 * Built the same way here, the two must agree, or the names slide off the land.
 */
describe("landing globe: project.ts agrees with the scene", () => {
  const frac = 0.8;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  camera.position.set(0, 0, cameraZ(frac));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const tiltG = new THREE.Group(), spinG = new THREE.Group();
  tiltG.add(spinG);

  it("the axis is upright (not leant sideways), the view a little from below", () => {
    expect(TILT).toBe(0);
    expect(LOOK_DOWN).toBeLessThan(0);
  });

  it("puts every point where three.js draws it", () => {
    const s: Screen = { x: 0, y: 0, facing: 0 };
    const W = 600, H = 600;
    for (const angle of [0, 0.7, 2.1, 4.4]) {
      for (const tiltX of [0, 0.2, -0.3]) {
        tiltG.rotation.set(LOOK_DOWN + tiltX, 0, -TILT, "XZY");
        spinG.rotation.set(0, angle, 0);
        tiltG.updateMatrixWorld(true);
        for (const [lon, lat] of [[0, 0], [60, 30], [-120, -50], [170, 75], [33, -40]]) {
          const mine = turn(toVec(lon, lat), angle, tiltX);
          const theirs = toVec3(lon, lat).applyMatrix4(spinG.matrixWorld);
          expect(mine[0]).toBeCloseTo(theirs.x, 9);
          expect(mine[1]).toBeCloseTo(theirs.y, 9);
          expect(mine[2]).toBeCloseTo(theirs.z, 9);
          project(mine, cameraZ(frac), W, H, s);
          const ndc = theirs.clone().project(camera);
          expect(s.x).toBeCloseTo((ndc.x * 0.5 + 0.5) * W, 6);
          expect(s.y).toBeCloseTo((-ndc.y * 0.5 + 0.5) * H, 6);
        }
      }
    }
  });

  it("the axis stands straight up the disc, under the trainer, as it turns", () => {
    const s: Screen = { x: 0, y: 0, facing: 0 };
    for (const angle of [0, 1.3, 4]) {
      project(turn(toVec(0, 90), angle, 0), cameraZ(frac), 600, 600, s);
      expect(s.x).toBeCloseTo(300, 6);
      expect(s.y).toBeLessThan(300);
    }
  });
});
