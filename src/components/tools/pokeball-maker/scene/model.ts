import * as THREE from "three";
import { PARTS, type Design, type Finish, type Part } from "@/lib/pokeball-maker/design";
import { buttonProfile, couplerProfile, dimsOf, frontLathe, gemProfile, halfGeometries, latheGeometry, R, ringProfile } from "@/lib/pokeball-maker/geometry";
import { partMaterial, setPart, type PartMaterial, type Shared } from "./materials";

/**
 * The ball as meshes: the bottom half (with the button, the coupler ring inside and, on a Hisuian ball, rivets and
 * the clasp), and the lid, hung on a hinge at the back. Its shape comes from the same lathe profiles the STL prints.
 */

export interface BallModel {
  /** Turned by the wobble about the ball's base. */
  root: THREE.Group;
  /** The ball itself (turned, leaned and squashed by the pose); its centre is the origin. */
  ball: THREE.Group;
  /** The lid's hinge (turned to open it). */
  hinge: THREE.Group;
  mats: Record<Part, PartMaterial>;
  /** The outer shells a sticker can be put on. */
  pickable: THREE.Mesh[];
  /** Every mesh with the part it's coloured as (for the GLB). */
  meshes: { mesh: THREE.Mesh; part: Part }[];
  /** The key of what the shape was built from (a change of these rebuilds it). */
  key: string;
  update(d: Design): void;
  dispose(): void;
}

export const shapeKey = (d: Design, glass: boolean) => `${d.shape}:${d.band}:${d.button}:${glass ? 1 : 0}:${PARTS.map((p) => (d.finishes[p] === "glass" ? "g" : d.finishes[p])).join(",")}`;

/** The hinge's axis: across the back of the ball, at the rim. */
export const HINGE_Z = -(R - 1.2);

export function buildBall(d: Design, shared: Shared, o: { glass: boolean }): BallModel {
  const dm = dimsOf(d);
  const geos: THREE.BufferGeometry[] = [];
  const geo = <G extends THREE.BufferGeometry>(g: G) => (geos.push(g), g);
  const flat = dm.faceted;
  const ringFinish = (dd: Design): Finish => (dd.button === "glow" ? "glow" : dd.finishes.ring);
  const finishOf = (dd: Design, p: Part): Finish => (p === "ring" ? ringFinish(dd) : dd.finishes[p]);
  const mats = {} as Record<Part, PartMaterial>;
  for (const p of PARTS) {
    const gem = p === "button" && d.button === "gem";
    mats[p] = partMaterial(finishOf(d, p), shared, { glass: o.glass, flat: flat || gem, side: p === "inner" ? THREE.DoubleSide : THREE.FrontSide });
  }
  mats.top.u.uStickOn.value = 1;
  mats.bottom.u.uStickOn.value = 1;

  const root = new THREE.Group();
  const ball = new THREE.Group();
  root.add(ball);
  const bottom = new THREE.Group();
  const hinge = new THREE.Group();
  hinge.position.set(0, 0, HINGE_Z);
  const lid = new THREE.Group();
  lid.position.set(0, 0, -HINGE_Z);
  hinge.add(lid);
  ball.add(bottom, hinge);
  const meshes: BallModel["meshes"] = [];
  const add = (g: THREE.BufferGeometry, part: Part, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo(g), mats[part].material);
    parent.add(m);
    meshes.push({ mesh: m, part });
    return m;
  };

  const top = halfGeometries(dm, false);
  const bot = halfGeometries(dm, true);
  const pickable = [add(top.shell, "top", lid), add(bot.shell, "bottom", bottom)];
  add(top.band, "band", lid);
  add(bot.band, "band", bottom);
  add(top.inner, "inner", lid);
  add(bot.inner, "inner", bottom);
  // The coupler ring stays with the bottom half (it shows when the lid is up).
  add(latheGeometry([...couplerProfile(), couplerProfile()[0]], dm.radial, true, 0.5), "inner", bottom);

  // The button (or the clasp), on the bottom half, facing the front.
  const radial = flat ? 10 : 64;
  if (d.button === "latch") {
    const plate = add(new THREE.BoxGeometry(14, 17, 3, 1, 1, 1), "ring", bottom);
    plate.position.set(0, -1, R + 0.9);
    const knob = add(new THREE.CylinderGeometry(3.2, 3.2, 2.2, 32), "button", bottom);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(0, -1.5, R + 3.2);
    // The clasp's tongue on the lid.
    const tongue = add(new THREE.BoxGeometry(8, 7, 1.6, 1, 1, 1), "ring", lid);
    tongue.position.set(0, 7, R + 0.4);
  } else {
    add(frontLathe(ringProfile(d.button), radial, true), "ring", bottom);
    add(d.button === "gem" ? frontLathe(gemProfile(), 8, false) : frontLathe(buttonProfile(), radial, false), "button", bottom);
  }
  // The hinge itself, at the back.
  const pin = add(new THREE.CylinderGeometry(1.6, 1.6, 12, 24), "ring", ball);
  pin.rotation.z = Math.PI / 2;
  pin.position.set(0, 0, HINGE_Z - 1.1);
  if (d.shape === "hisui") {
    // Rivets round the band.
    const rivet = geo(new THREE.SphereGeometry(0.9, 12, 8));
    const yb = dm.bandH / 2;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + Math.PI / 16;
      for (const [y, parent] of [[yb * 0.55, lid], [-yb * 0.55, bottom]] as const) {
        const rr = R + 0.9;
        const m = new THREE.Mesh(rivet, mats.ring.material);
        m.position.set(Math.sin(a) * rr, y, Math.cos(a) * rr);
        parent.add(m);
        meshes.push({ mesh: m, part: "ring" });
      }
    }
  }

  const model: BallModel = {
    root,
    ball,
    hinge,
    mats,
    pickable,
    meshes,
    key: shapeKey(d, o.glass),
    update(dd) {
      setPart(mats.top.u, dd.colours.top, dd.finishes.top, 1, dd.patterns.top);
      setPart(mats.bottom.u, dd.colours.bottom, dd.finishes.bottom, -1, dd.patterns.bottom);
      for (const p of ["band", "ring", "button", "inner"] as const) setPart(mats[p].u, dd.colours[p], finishOf(dd, p), 0, null);
      for (const p of PARTS) {
        const m = mats[p].material;
        if (finishOf(dd, p) === "glass") {
          // Glass takes its colour as a tint of what's behind it.
          m.color.copy(mats[p].u.uBase.value).lerp(new THREE.Color(1, 1, 1), 0.35);
          m.attenuationColor.copy(mats[p].u.uBase.value);
        }
      }
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const p of PARTS) mats[p].material.dispose();
    },
  };
  model.update(d);
  return model;
}
