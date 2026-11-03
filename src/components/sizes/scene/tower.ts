import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PRISM_Y, TOWER_H } from "@/lib/sizes/world";

/**
 * Prism Tower, our own design in the spirit of Lumiose City's landmark: a
 * wrought-steel lattice on four flared legs joined by great arches, two
 * observation platforms, a tapering shaft and, at the crown, a faceted
 * crystal prism that glows, ringed by a steel cage. Strings of lights run
 * up every edge and twinkle; the prism breathes. The lattice is real
 * geometry at its edges (corner girders) with an alpha-cut bracing pattern
 * on each face. No height is shown anywhere: it is simply the tallest thing
 * in the city, standing at the centre of its great round plaza.
 */

export { TOWER_H };
/** Where the legs meet, the platforms and the shaft's top (m); the prism's middle is PRISM_Y. */
const MERGE = 74, DECK1 = 46, DECK2 = 112, SHAFT_TOP = 168;

/** Half-width of the tower's footprint at height y (an Eiffel-like exponential flare). */
const profile = (y: number) => 3.2 + 40 * Math.exp(-y / 46);

function latticeTexture(): THREE.DataTexture {
  const cv = document.createElement("canvas");
  cv.width = 128;
  cv.height = 256;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, 128, 256);
  g.strokeStyle = "#fff";
  g.lineCap = "square";
  g.lineWidth = 9;
  g.strokeRect(4.5, 4.5, 119, 247);
  g.lineWidth = 6.5;
  for (const [y0, y1] of [[0, 128], [128, 256]]) {
    g.beginPath(); g.moveTo(4, y0); g.lineTo(124, y1); g.stroke();
    g.beginPath(); g.moveTo(124, y0); g.lineTo(4, y1); g.stroke();
  }
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(0, 128); g.lineTo(128, 128); g.stroke();
  // Secondary bracing, and a little scrollwork in each bay.
  g.lineWidth = 2.5;
  for (const y of [64, 192]) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 256); g.stroke();
  g.lineWidth = 2;
  for (const y of [32, 96, 160, 224]) { g.beginPath(); g.arc(64, y, 11, 0, Math.PI * 2); g.stroke(); }
  return coverageMips(g.getImageData(0, 0, 128, 256));
}

/**
 * The lattice as a texture whose smaller mip levels keep the bars: a cut-out
 * pattern averaged down loses its alpha under the cut (from the finale's
 * height the tower's faces would vanish, leaving bare corner girders), so
 * each level's alpha is scaled until as much of it stands solid as in the
 * full-size picture. From afar the faces read as a fine steel mesh.
 */
function coverageMips(img: ImageData): THREE.DataTexture {
  const { width: w0, height: h0 } = img;
  const solid = (a: Uint8ClampedArray | Float32Array, scale = 1) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] * scale > 127.5) n++; return n / a.length; };
  let alpha = new Float32Array(w0 * h0);
  for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
  const target = solid(alpha);
  const rgba = (a: Float32Array, scale: number): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(new ArrayBuffer(a.length * 4));
    for (let i = 0; i < a.length; i++) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255; out[i * 4 + 3] = Math.min(255, Math.round(a[i] * scale)); }
    return out;
  };
  const levels: { data: Uint8Array<ArrayBuffer>; width: number; height: number }[] = [{ data: rgba(alpha, 1), width: w0, height: h0 }];
  let w = w0, h = h0;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const next = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let s = 0, c = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy);
        s += alpha[sy * w + sx];
        c++;
      }
      next[y * nw + x] = s / c;
    }
    // The scale that keeps the solid share (a few halvings of a binary search are plenty).
    let lo = 1, hi = 6;
    for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (solid(next, m) < target) lo = m; else hi = m; }
    levels.push({ data: rgba(next, hi), width: nw, height: nh });
    alpha = next;
    w = nw;
    h = nh;
  }
  const t = new THREE.DataTexture(levels[0].data, w0, h0, THREE.RGBAFormat);
  t.mipmaps = levels as unknown as THREE.DataTexture["mipmaps"];
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

type Ring = { c: THREE.Vector3; h: number };
const corner = (r: Ring, k: number) => {
  const sx = k === 0 || k === 3 ? -1 : 1, sz = k < 2 ? -1 : 1;
  return new THREE.Vector3(r.c.x + sx * r.h, r.c.y, r.c.z + sz * r.h);
};

/** A four-sided lattice tube along a path of square cross-sections (centre, half-size) as quads with lattice UVs, plus its corner girders. */
function latticeTube(rings: Ring[], cellM: number): { faces: THREE.BufferGeometry; girders: THREE.BufferGeometry } {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
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
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < rings.length - 1; i++) {
      const a = corner(rings[i], k), b = corner(rings[i + 1], k);
      const len = a.distanceTo(b);
      // Heavy corner members, as on the real thing: they carry the tower's outline from across the city.
      const w = Math.max(0.8, rings[i].h * 0.16);
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
  /** The prism's material, for the glow. */
  glow: THREE.MeshPhysicalMaterial;
  /** World position of the crown (for the halo). */
  crown: THREE.Vector3;
  /** The prism breathes and the lights twinkle (t: seconds). */
  tick(t: number): void;
  dispose(): void;
}

export function buildTower(x: number, z: number): Tower {
  const group = new THREE.Group();
  group.name = "prism-tower";
  group.position.set(x, 0, z);
  // Warm steel, a champagne bronze that glows in the late-morning sun against the pale city.
  const steel = new THREE.MeshStandardMaterial({ color: "#c9ab7f", roughness: 0.38, metalness: 0.42 });
  const lattice = latticeTexture();
  const latticeMat = new THREE.MeshStandardMaterial({ color: "#d2b68b", roughness: 0.42, metalness: 0.36, map: lattice, alphaTest: 0.5, side: THREE.DoubleSide });
  const stone = new THREE.MeshStandardMaterial({ color: "#cdbf9f", roughness: 0.9, metalness: 0 });
  const geos: THREE.BufferGeometry[] = [];
  const addMesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.push(g);
    return mesh;
  };
  /** Points along the corner edges, for the strings of lights. */
  const lights: THREE.Vector3[] = [];
  const edgeLights = (rings: Ring[], every: number) => {
    for (let k = 0; k < 4; k++) {
      let carry = 0;
      for (let i = 0; i < rings.length - 1; i++) {
        const a = corner(rings[i], k), b = corner(rings[i + 1], k);
        const len = a.distanceTo(b);
        for (let d = carry; d < len; d += every) lights.push(a.clone().lerp(b, d / len).multiplyScalar(1.004));
        carry = (carry + Math.ceil((len - carry) / every) * every) - len;
      }
    }
  };
  // Four legs, each a lattice tube following the flare from its corner up to the merge.
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const rings: Ring[] = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const y = (MERGE * i) / steps;
      const hw = profile(y);
      const legHalf = 6.6 - 3.6 * (i / steps);
      const inset = hw - legHalf;
      rings.push({ c: new THREE.Vector3(sx * inset, y, sz * inset), h: legHalf });
    }
    const { faces, girders } = latticeTube(rings, 5.5);
    addMesh(faces, latticeMat);
    addMesh(girders, steel);
    edgeLights(rings, 3.6);
  }
  // The shaft above the merge.
  const shaftRings: Ring[] = [];
  {
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const y = MERGE + ((SHAFT_TOP - MERGE) * i) / steps;
      shaftRings.push({ c: new THREE.Vector3(0, y, 0), h: Math.max(2.2, profile(y)) });
    }
    const { faces, girders } = latticeTube(shaftRings, 4.5);
    addMesh(faces, latticeMat);
    addMesh(girders, steel);
    edgeLights(shaftRings, 3.2);
  }
  // Great arches between the legs, the two platforms with their railings, and the cage round the prism.
  {
    const parts: THREE.BufferGeometry[] = [];
    const archR = profile(16) - 6;
    const arch = new THREE.TorusGeometry(archR, 1.15, 6, 36, Math.PI);
    for (let k = 0; k < 4; k++) {
      const g = arch.clone();
      g.scale(1, 1.05, 1);
      g.translate(0, 4, profile(22) - 3.6);
      g.rotateY((k * Math.PI) / 2);
      parts.push(g.toNonIndexed());
    }
    for (const [y, t] of [[DECK1, 2.8], [DECK2, 2.2], [SHAFT_TOP, 1.6]]) {
      const hw = profile(y) + 2.2;
      const deck = new THREE.BoxGeometry(hw * 2, t, hw * 2);
      deck.translate(0, y, 0);
      parts.push(deck.toNonIndexed());
      const band = new THREE.BoxGeometry(hw * 2 + 0.6, 1.3, hw * 2 + 0.6);
      band.translate(0, y + t / 2 + 0.65, 0);
      parts.push(band.toNonIndexed());
      for (let k = 0; k < 28; k++) {
        // Lights round each platform's rail.
        const a = (k / 28) * Math.PI * 2;
        const r = hw * 1.02 + 0.4;
        const sq = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
        lights.push(new THREE.Vector3((Math.cos(a) / sq) * r, y + t / 2 + 1.5, (Math.sin(a) / sq) * r));
      }
    }
    // The cage: eight ribs from the shaft's top round the prism to the spire.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const f = i / 10;
        const y = SHAFT_TOP + 1 + f * (TOWER_H - 18 - SHAFT_TOP);
        const r = 3.2 + 10.5 * Math.sin(Math.PI * Math.min(1, f * 1.05));
        pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.38, 5, false).toNonIndexed());
      for (const p of pts.slice(1, -1)) lights.push(p.clone().multiplyScalar(1.03));
    }
    const ring = new THREE.TorusGeometry(13.4, 0.5, 6, 40);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, PRISM_Y, 0);
    parts.push(ring.toNonIndexed());
    const spire = new THREE.CylinderGeometry(0.28, 1.2, 20, 8);
    spire.translate(0, TOWER_H - 10, 0);
    parts.push(spire.toNonIndexed());
    for (const p of parts) if (!p.attributes.uv) p.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
    addMesh(mergeGeometries(parts.map((p) => { const q = p.clone(); for (const k of Object.keys(q.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") q.deleteAttribute(k); return q; })), steel);
  }
  // The base: a stepped round plinth set in the plaza's stone apron, and a masonry pier under each leg.
  {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(new THREE.CylinderGeometry(70, 71.5, 0.5, 96).translate(0, 0.25, 0).toNonIndexed());
    parts.push(new THREE.CylinderGeometry(66, 67, 1.1, 96).translate(0, 0.55, 0).toNonIndexed());
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const c = profile(0) - 6.6;
      parts.push(new THREE.BoxGeometry(17, 4.4, 17).translate(sx * c, 1.1 + 2.2, sz * c).toNonIndexed());
      parts.push(new THREE.BoxGeometry(18.4, 0.7, 18.4).translate(sx * c, 1.1 + 4.4 + 0.35, sz * c).toNonIndexed());
    }
    addMesh(mergeGeometries(parts), stone);
  }
  // The prism: a great faceted crystal (a six-sided bipyramid, flat facets that catch the sun) ringed by six smaller ones, glowing from within.
  const glow = new THREE.MeshPhysicalMaterial({ color: "#d8f6ff", emissive: "#3cc6ff", emissiveIntensity: 3.2, roughness: 0.06, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.7, iridescenceIOR: 1.5, flatShading: true, envMapIntensity: 1.6 });
  {
    const parts: THREE.BufferGeometry[] = [];
    const main = new THREE.LatheGeometry([new THREE.Vector2(0, -19), new THREE.Vector2(8.6, -6), new THREE.Vector2(9.4, 6), new THREE.Vector2(0, 25)], 6);
    parts.push(main.translate(0, PRISM_Y, 0).toNonIndexed());
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const small = new THREE.LatheGeometry([new THREE.Vector2(0, -6), new THREE.Vector2(2.4, -1.5), new THREE.Vector2(2.6, 2), new THREE.Vector2(0, 8.5)], 6);
      small.rotateZ(-0.42);
      small.rotateY(-a);
      parts.push(small.translate(Math.cos(a) * 9.5, PRISM_Y - 9, Math.sin(a) * 9.5).toNonIndexed());
    }
    const prism = mergeGeometries(parts);
    prism.computeVertexNormals();
    addMesh(prism, glow, false);
  }
  // Strings of lights: tiny bulbs that bloom, each twinkling on its own beat.
  const bulbGeo = new THREE.SphereGeometry(0.42, 6, 4);
  geos.push(bulbGeo);
  const bulbTime = { value: 0 };
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe2a6").multiplyScalar(2.2), toneMapped: true, fog: true });
  bulbMat.onBeforeCompile = (s) => {
    s.uniforms.uTwinkle = bulbTime;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTwinkle;\nvarying float vTw;").replace("#include <begin_vertex>", "#include <begin_vertex>\n  float ph = float(gl_InstanceID) * 2.3999;\n  vTw = 0.55 + 0.45 * smoothstep(-0.2, 1.0, sin(uTwinkle * (1.7 + mod(ph, 1.3)) + ph));");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vTw;").replace("#include <opaque_fragment>", "outgoingLight *= vTw;\n#include <opaque_fragment>");
  };
  bulbMat.customProgramCacheKey = () => "tower-bulbs";
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lights.length);
  const m4 = new THREE.Matrix4();
  lights.forEach((p, i) => bulbs.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
  bulbs.computeBoundingSphere();
  group.add(bulbs);
  const crown = new THREE.Vector3(x, PRISM_Y + 2, z);
  return {
    group,
    glow,
    crown,
    tick(t) {
      glow.emissiveIntensity = 3.2 + 0.7 * Math.sin(t * 1.3);
      bulbTime.value = t;
    },
    dispose() {
      for (const g of geos) g.dispose();
      steel.dispose();
      stone.dispose();
      latticeMat.dispose();
      lattice.dispose();
      glow.dispose();
      bulbMat.dispose();
    },
  };
}
