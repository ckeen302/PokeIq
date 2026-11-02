import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Prism Tower, our own design in the spirit of Lumiose City's landmark: a
 * wrought-steel lattice on four curved legs joined by arches, two
 * observation decks, a tapering spire and a faceted prism at the crown
 * that glows. The lattice is real geometry at its edges (corner girders)
 * with an alpha-cut bracing pattern on each face. No height is shown
 * anywhere; it is simply the tallest thing in the city.
 */

export const TOWER_H = 310;

/** Half-width of the tower's footprint at height y (an Eiffel-like exponential flare). */
const profile = (y: number) => 4 + 46 * Math.exp(-y / 62);

function latticeTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 128;
  cv.height = 256;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, 128, 256);
  g.strokeStyle = "#fff";
  g.lineCap = "square";
  g.lineWidth = 7;
  g.strokeRect(3.5, 3.5, 121, 249);
  g.lineWidth = 5;
  for (const [y0, y1] of [[0, 128], [128, 256]]) {
    g.beginPath(); g.moveTo(4, y0); g.lineTo(124, y1); g.stroke();
    g.beginPath(); g.moveTo(124, y0); g.lineTo(4, y1); g.stroke();
  }
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(0, 128); g.lineTo(128, 128); g.stroke();
  // Secondary bracing.
  g.lineWidth = 2.5;
  for (const y of [64, 192]) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 256); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A four-sided lattice tube along a path of square cross-sections (centre, half-size) as quads with lattice UVs. */
function latticeTube(rings: { c: THREE.Vector3; h: number }[], cellM: number): { faces: THREE.BufferGeometry; girders: THREE.BufferGeometry } {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const corner = (r: { c: THREE.Vector3; h: number }, k: number) => {
    const sx = k === 0 || k === 3 ? -1 : 1, sz = k < 2 ? -1 : 1;
    return new THREE.Vector3(r.c.x + sx * r.h, r.c.y, r.c.z + sz * r.h);
  };
  let v = 0;
  const vAt: number[] = [0];
  for (let i = 1; i < rings.length; i++) vAt.push(vAt[i - 1] + rings[i].c.distanceTo(rings[i - 1].c) / cellM);
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < rings.length - 1; i++) {
      const a = corner(rings[i], side), b = corner(rings[i], (side + 1) % 4);
      const c = corner(rings[i + 1], (side + 1) % 4), d = corner(rings[i + 1], side);
      const uw = Math.max(1, Math.round((rings[i].h * 2) / cellM));
      for (const p of [a, b, c, d]) pos.push(p.x, p.y, p.z);
      uv.push(0, vAt[i] * 0.5, uw, vAt[i] * 0.5, uw, vAt[i + 1] * 0.5, 0, vAt[i + 1] * 0.5);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  const faces = new THREE.BufferGeometry();
  faces.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  faces.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  faces.setIndex(idx);
  faces.computeVertexNormals();
  // Corner girders: thin boxes between consecutive rings at each corner.
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < rings.length - 1; i++) {
      const a = corner(rings[i], k), b = corner(rings[i + 1], k);
      const len = a.distanceTo(b);
      const w = Math.max(0.5, rings[i].h * 0.09);
      const g = new THREE.BoxGeometry(w, len, w);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
      g.translate(a.x, a.y, a.z);
      parts.push(g.toNonIndexed());
    }
  }
  return { faces, girders: mergeGeometries(parts) };
}

export interface Tower {
  group: THREE.Group;
  /** The prism's material, for the glow and the golden-hour lights. */
  glow: THREE.MeshStandardMaterial;
  /** World position of the crown (for the halo). */
  crown: THREE.Vector3;
  dispose(): void;
}

export function buildTower(x: number, z: number): Tower {
  const group = new THREE.Group();
  group.name = "prism-tower";
  group.position.set(x, 0, z);
  const steel = new THREE.MeshStandardMaterial({ color: "#d9e0e8", roughness: 0.38, metalness: 0.35 });
  const lattice = latticeTexture();
  const latticeMat = new THREE.MeshStandardMaterial({ color: "#d4dce5", roughness: 0.42, metalness: 0.32, map: lattice, alphaTest: 0.5, side: THREE.DoubleSide });
  const geos: THREE.BufferGeometry[] = [];
  const addMesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.push(g);
  };
  const merge = 112; // the legs join here
  // Four legs, each a lattice tube following the flare from its corner up to the merge.
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const rings: { c: THREE.Vector3; h: number }[] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const y = (merge * i) / steps;
      const hw = profile(y);
      const legHalf = 7.5 - 4.2 * (i / steps);
      const inset = hw - legHalf;
      rings.push({ c: new THREE.Vector3(sx * inset, y, sz * inset), h: legHalf });
    }
    const { faces, girders } = latticeTube(rings, 6);
    addMesh(faces, latticeMat);
    addMesh(girders, steel);
  }
  // The shaft above the merge.
  {
    const rings: { c: THREE.Vector3; h: number }[] = [];
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const y = merge + ((262 - merge) * i) / steps;
      rings.push({ c: new THREE.Vector3(0, y, 0), h: Math.max(2.4, profile(y)) });
    }
    const { faces, girders } = latticeTube(rings, 5);
    addMesh(faces, latticeMat);
    addMesh(girders, steel);
  }
  // Arches between the legs, and the two decks.
  {
    const parts: THREE.BufferGeometry[] = [];
    const arch = new THREE.TorusGeometry(31, 1.3, 6, 32, Math.PI);
    for (let k = 0; k < 4; k++) {
      const g = arch.clone();
      g.translate(0, 9, 0);
      g.scale(1, 1.15, 1);
      g.translate(0, 0, profile(42) - 5);
      g.rotateY((k * Math.PI) / 2);
      parts.push(g.toNonIndexed());
    }
    for (const [y, t] of [[57, 3.2], [114, 2.6], [262, 1.6]]) {
      const hw = profile(y) + 2.5;
      const deck = new THREE.BoxGeometry(hw * 2, t, hw * 2);
      deck.translate(0, y, 0);
      parts.push(deck.toNonIndexed());
      // A railing band.
      const band = new THREE.BoxGeometry(hw * 2 + 0.6, 1.4, hw * 2 + 0.6);
      band.translate(0, y + t / 2 + 0.7, 0);
      parts.push(band.toNonIndexed());
    }
    const spire = new THREE.CylinderGeometry(0.35, 1.3, 26, 8);
    spire.translate(0, 296, 0);
    parts.push(spire.toNonIndexed());
    addMesh(mergeGeometries(parts), steel);
  }
  // The prism: a faceted crystal at the crown.
  const glow = new THREE.MeshStandardMaterial({ color: "#d9f4ff", emissive: "#7fe1ff", emissiveIntensity: 2.6, roughness: 0.15, metalness: 0.1, flatShading: true });
  const prism = new THREE.OctahedronGeometry(7.5, 0);
  prism.scale(1, 1.9, 1);
  prism.translate(0, 276, 0);
  addMesh(prism, glow, false);
  const crown = new THREE.Vector3(x, 276, z);
  return {
    group,
    glow,
    crown,
    dispose() {
      for (const g of geos) g.dispose();
      steel.dispose();
      latticeMat.dispose();
      lattice.dispose();
      glow.dispose();
    },
  };
}
