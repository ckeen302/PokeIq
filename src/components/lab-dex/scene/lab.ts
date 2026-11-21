import * as THREE from "three";
import { typeColor } from "@/lib/pokemon/type-colors";
import { capsuleGlass, glowDisc, holoColumn, holoRing, holoTop, lightShaft, type LabTime } from "./holo";
import { captionBand, nameplate, type LabFonts } from "./screens";
import { ROOM } from "./room";
import type { LabEntry } from "../roster";

/**
 * The wheel's furniture: the holo-table in the middle (a stepped plinth in
 * dark metal, its face a projector glowing in the selected Pokémon's type
 * colour, a column of light and turning rings over it) and the capsule pods
 * round it, each with its own lamp, glass and nameplate.
 */

export const TABLE_TOP = 0.625;
export const POD_FLOOR = 0.35;

export function hdr(hex: string, k: number) {
  return new THREE.Color(hex).multiplyScalar(k);
}

/** A type colour pushed towards a hologram's (brighter, a little whiter). */
export function holoTint(type: string) {
  return new THREE.Color(typeColor(type)).lerp(new THREE.Color("#ffffff"), 0.12);
}

export interface Table {
  group: THREE.Group;
  color: THREE.Color;
  dispose(): void;
}

export function buildTable(entry: LabEntry, time: LabTime, fonts: LabFonts): Table {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const color = holoTint(entry.types[0]);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
    geos.push(geo);
    if (!mats.includes(m)) mats.push(m);
    const me = new THREE.Mesh(geo, m);
    me.castShadow = cast;
    me.receiveShadow = true;
    group.add(me);
    return me;
  };
  const metal = new THREE.MeshStandardMaterial({ color: "#151b25", roughness: 0.3, metalness: 0.85 });
  const metal2 = new THREE.MeshStandardMaterial({ color: "#232c3a", roughness: 0.22, metalness: 0.9 });
  const band = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3.2) });
  const cyan = new THREE.MeshBasicMaterial({ color: hdr("#5fdcff", 2.4) });
  add(new THREE.CylinderGeometry(2.3, 2.42, 0.18, 128).translate(0, 0.09, 0), metal);
  add(new THREE.CylinderGeometry(1.96, 2.06, 0.28, 128).translate(0, 0.18 + 0.14, 0), metal2);
  add(new THREE.CylinderGeometry(2.075, 2.075, 0.045, 128, 1, true).translate(0, 0.3, 0), band, false);
  add(new THREE.CylinderGeometry(2.07, 2.07, 0.012, 128, 1, true).translate(0, 0.405, 0), cyan, false);
  add(new THREE.CylinderGeometry(1.78, 1.88, 0.165, 128).translate(0, 0.46 + 0.0825, 0), metal);
  // The face: dark glass with the projected pattern.
  const faceMat = new THREE.MeshStandardMaterial({ color: "#04060a", roughness: 0.1, metalness: 0.5, envMapIntensity: 0.8 });
  holoTop(faceMat, color, new THREE.Vector3(0, 0, 0), 1.74, time, 1.25);
  add(new THREE.CircleGeometry(1.745, 160).rotateX(-Math.PI / 2).translate(0, TABLE_TOP, 0), faceMat, false);
  add(new THREE.TorusGeometry(1.79, 0.022, 8, 160).rotateX(Math.PI / 2).translate(0, TABLE_TOP, 0), band, false);
  // Vents and status lamps round the step.
  const vent = new THREE.MeshStandardMaterial({ color: "#090c12", roughness: 0.6, metalness: 0.5 });
  const led = new THREE.MeshBasicMaterial({ color: hdr("#5fdcff", 3) });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const v = add(new THREE.BoxGeometry(0.34, 0.12, 0.03), vent, false);
    v.position.set(Math.sin(a) * 2.06, 0.25, Math.cos(a) * 2.06);
    v.rotation.y = a;
    const l = add(new THREE.BoxGeometry(0.05, 0.02, 0.02), i % 6 === 0 ? band : led, false);
    l.position.set(Math.sin(a + 0.09) * 2.075, 0.39, Math.cos(a + 0.09) * 2.075);
    l.rotation.y = a;
  }
  // Light over the face: a glow lying on it, the column, rings turning in the air, the caption round the rim.
  const glow = add(new THREE.PlaneGeometry(4.6, 4.6).rotateX(-Math.PI / 2).translate(0, TABLE_TOP + 0.004, 0), glowDisc(color, 0.22, 2.6), false);
  glow.renderOrder = 2;
  const col = add(new THREE.CylinderGeometry(1.5, 1.58, 3.6, 128, 1, true).translate(0, TABLE_TOP + 1.8, 0), holoColumn(color.clone().lerp(new THREE.Color("#ffffff"), 0.15), time, 0.12), false);
  col.renderOrder = 3;
  const rings: [number, number, number, Parameters<typeof holoRing>[2]][] = [
    [1.86, 1.95, TABLE_TOP + 0.05, { dashes: 7, duty: 0.7, speed: 0.02, strength: 1.4 }],
    [1.52, 1.545, TABLE_TOP + 0.32, { dashes: 3, duty: 0.8, speed: -0.03, strength: 1.6, phase: 0.2 }],
    [1.6, 1.68, TABLE_TOP + 0.14, { dashes: 0, duty: 1, speed: 0, strength: 0.7, ticks: 120 }],
    [1.7, 1.715, TABLE_TOP + 0.62, { dashes: 5, duty: 0.3, speed: 0.04, strength: 0.6, phase: 0.6 }],
  ];
  for (const [r0, r1, y, o] of rings) {
    const m = add(new THREE.RingGeometry(r0, r1, 160, 1).rotateX(-Math.PI / 2).translate(0, y, 0), holoRing(color, time, o), false);
    m.renderOrder = 3;
  }
  // The rig's light falling through the haze onto the table.
  const shaftH = ROOM.height - 1.5 - TABLE_TOP;
  const shaft = add(new THREE.CylinderGeometry(1.25, 1.95, shaftH, 96, 1, true).translate(0, TABLE_TOP + shaftH / 2, 0), lightShaft(new THREE.Color("#fff1e2"), 0.03), false);
  shaft.renderOrder = 3;
  const cap = captionBand(entry, fonts);
  cap.repeat.set(1, 1);
  const capMat = new THREE.MeshBasicMaterial({ map: cap, color: color.clone().multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide });
  const capMesh = add(new THREE.CylinderGeometry(1.9, 1.9, 0.09, 160, 1, true).translate(0, TABLE_TOP + 0.2, 0), capMat, false);
  capMesh.renderOrder = 3;
  mats.push(metal, metal2, band, cyan, faceMat, vent, led, capMat);
  return {
    group,
    color,
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      cap.dispose();
    },
  };
}

export interface Pod {
  group: THREE.Group;
  /** Where the figure stands (world), and the turntable that faces it (and its nameplate) to the camera. */
  spot: THREE.Vector3;
  turn: THREE.Group;
  light: THREE.SpotLight;
  dispose(): void;
}

export function buildPod(entry: LabEntry, angle: number, selected: boolean, time: LabTime, fonts: LabFonts, selColor: THREE.Color): Pod {
  const group = new THREE.Group();
  const x = Math.sin(angle) * ROOM.ringR, z = Math.cos(angle) * ROOM.ringR;
  group.position.set(x, 0, z);
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const own = <T extends THREE.Material>(m: T) => { mats.push(m); return m; };
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = group, cast = true) => {
    geos.push(geo);
    const me = new THREE.Mesh(geo, m);
    me.castShadow = cast;
    me.receiveShadow = true;
    parent.add(me);
    return me;
  };
  const c = selected ? selColor : holoTint(entry.types[0]);
  const metal = own(new THREE.MeshStandardMaterial({ color: "#161c26", roughness: 0.32, metalness: 0.85 }));
  const metal2 = own(new THREE.MeshStandardMaterial({ color: "#252e3c", roughness: 0.25, metalness: 0.9 }));
  const band = own(new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(selected ? 3.6 : 2.4) }));
  add(new THREE.CylinderGeometry(0.84, 0.92, 0.22, 72).translate(0, 0.11, 0), metal);
  add(new THREE.CylinderGeometry(0.78, 0.8, 0.12, 72).translate(0, 0.22 + 0.06, 0), metal2);
  add(new THREE.CylinderGeometry(0.925, 0.925, 0.03, 72, 1, true).translate(0, 0.16, 0), band, group, false);
  const plate = own(new THREE.MeshStandardMaterial({ color: "#04060a", roughness: 0.12, metalness: 0.5 }));
  holoTop(plate, c, new THREE.Vector3(x, 0, z), 0.74, time, selected ? 1.3 : 0.55);
  add(new THREE.CircleGeometry(0.75, 72).rotateX(-Math.PI / 2).translate(0, POD_FLOOR - 0.005, 0), plate, group, false);
  // Glass, its rims, the cap with its lamp, three struts.
  const glass = add(new THREE.CylinderGeometry(0.66, 0.66, 2.0, 72, 1, true).translate(0, POD_FLOOR + 1.0, 0), own(capsuleGlass(new THREE.Color("#8fe6ff"), selected ? 1.3 : 1)), group, false);
  glass.renderOrder = 4;
  for (const y of [POD_FLOOR + 0.01, POD_FLOOR + 1.99]) add(new THREE.TorusGeometry(0.67, 0.025, 8, 72).rotateX(Math.PI / 2).translate(0, y, 0), metal2);
  add(new THREE.CylinderGeometry(0.8, 0.84, 0.16, 72).translate(0, POD_FLOOR + 2.0 + 0.08, 0), metal);
  add(new THREE.CylinderGeometry(0.5, 0.78, 0.09, 72).translate(0, POD_FLOOR + 2.16 + 0.045, 0), metal2);
  add(new THREE.CylinderGeometry(0.845, 0.845, 0.02, 72, 1, true).translate(0, POD_FLOOR + 2.06, 0), band, group, false);
  const lampCol = selected ? c.clone().lerp(new THREE.Color("#ffffff"), 0.4) : new THREE.Color("#dff4ff");
  add(new THREE.CircleGeometry(0.5, 48).rotateX(Math.PI / 2).translate(0, POD_FLOOR + 1.995, 0), own(new THREE.MeshBasicMaterial({ color: lampCol.clone().multiplyScalar(2.6) })), group, false);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 3;
    add(new THREE.BoxGeometry(0.07, 2.0, 0.09).translate(Math.sin(a) * 0.76, POD_FLOOR + 1.0, Math.cos(a) * 0.76), metal2);
  }
  // A soft glow on the plate (and, for the empty selected pod, a column of light where its Pokémon was).
  const g = add(new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2).translate(0, POD_FLOOR + 0.004, 0), own(glowDisc(c, selected ? 0.9 : 0.35, 2.4)), group, false);
  g.renderOrder = 2;
  if (selected) {
    const col = add(new THREE.CylinderGeometry(0.6, 0.62, 1.95, 64, 1, true).translate(0, POD_FLOOR + 0.98, 0), own(holoColumn(c, time, 0.55)), group, false);
    col.renderOrder = 3;
  }
  const sh = add(new THREE.CylinderGeometry(0.46, 0.63, 1.62, 48, 1, true).translate(0, POD_FLOOR + 0.2 + 0.81, 0), own(lightShaft(lampCol, selected ? 0.05 : 0.07)), group, false);
  sh.renderOrder = 3;
  // The turntable: what faces the camera (the figure, its nameplate).
  const turn = new THREE.Group();
  turn.position.y = POD_FLOOR;
  group.add(turn);
  const plateTex = nameplate(entry, fonts, selected);
  const np = add(new THREE.PlaneGeometry(0.92, 0.23), own(new THREE.MeshBasicMaterial({ map: plateTex, color: new THREE.Color(1.25, 1.25, 1.25), transparent: true })), turn, false);
  np.position.set(0, -0.2, 0.97);
  np.rotation.x = -0.35;
  // The lamp lights the figure from above.
  const light = new THREE.SpotLight(lampCol, selected ? 0 : 11, 4.5, 0.75, 0.7, 2);
  light.position.set(0, POD_FLOOR + 1.95, 0.15);
  light.target.position.set(0, POD_FLOOR + 0.3, 0);
  group.add(light, light.target);
  return {
    group,
    spot: new THREE.Vector3(x, POD_FLOOR, z),
    turn,
    light,
    dispose() {
      geos.forEach((q) => q.dispose());
      mats.forEach((m) => m.dispose());
      plateTex.dispose();
    },
  };
}
