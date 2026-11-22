import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * A soft, room-like environment map for studio lighting (three.js's RoomEnvironment through PMREM), made once per
 * renderer and shared by everything drawn with it; released when its last user lets go. Used by the 3D trainers
 * and the Poké Ball Maker.
 */
const rooms = new WeakMap<THREE.WebGLRenderer, { texture: THREE.Texture; users: number }>();

export function roomEnvironment(renderer: THREE.WebGLRenderer): { texture: THREE.Texture; release(): void } {
  let room = rooms.get(renderer);
  if (!room) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const scene = new RoomEnvironment();
    room = { texture: pmrem.fromScene(scene, 0.04).texture, users: 0 };
    scene.dispose();
    pmrem.dispose();
    rooms.set(renderer, room);
  }
  room.users++;
  const r = room;
  let released = false;
  return {
    texture: r.texture,
    release() {
      if (released) return;
      released = true;
      if (--r.users > 0) return;
      r.texture.dispose();
      if (rooms.get(renderer) === r) rooms.delete(renderer);
    },
  };
}

const studios = new WeakMap<THREE.WebGLRenderer, { texture: THREE.Texture; users: number }>();

/**
 * A product-photo studio as an environment map: a dark cyclorama with a big soft key box above and to the left, a
 * tall strip light on each side for rim highlights, and a dim warm floor bounce. Gives glossy and metal surfaces
 * long clean highlights instead of a room's many small lamps. Shared and released like `roomEnvironment`.
 */
export function studioEnvironment(renderer: THREE.WebGLRenderer): { texture: THREE.Texture; release(): void } {
  let s = studios.get(renderer);
  if (!s) {
    const scene = new THREE.Scene();
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    const add = (g: THREE.BufferGeometry, c: THREE.Color, pos: [number, number, number], look = true) => {
      const m = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
      geos.push(g);
      mats.push(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(...pos);
      if (look) mesh.lookAt(0, 0, 0);
      scene.add(mesh);
    };
    // The cyclorama: dark, a touch lighter towards the top.
    const dome = new THREE.SphereGeometry(40, 32, 16);
    const col: number[] = [];
    const p = dome.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 40;
      const v = 0.035 + 0.05 * Math.max(0, y);
      col.push(v * 1.02, v, v * 1.12);
    }
    dome.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geos.push(dome);
    const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    mats.push(domeMat);
    scene.add(new THREE.Mesh(dome, domeMat));
    add(new THREE.PlaneGeometry(26, 18), new THREE.Color(5.5, 5.3, 5.0), [-16, 22, 16]);
    add(new THREE.PlaneGeometry(5, 34), new THREE.Color(3.0, 3.2, 3.6), [30, 4, -14]);
    add(new THREE.PlaneGeometry(5, 34), new THREE.Color(2.6, 2.5, 2.8), [-30, 2, -18]);
    add(new THREE.PlaneGeometry(14, 10), new THREE.Color(1.6, 1.6, 1.7), [18, 10, 26]);
    add(new THREE.CircleGeometry(22, 32), new THREE.Color(0.42, 0.38, 0.36), [0, -30, 0]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    s = { texture: pmrem.fromScene(scene, 0.02).texture, users: 0 };
    pmrem.dispose();
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    studios.set(renderer, s);
  }
  s.users++;
  const r = s;
  let released = false;
  return {
    texture: r.texture,
    release() {
      if (released) return;
      released = true;
      if (--r.users > 0) return;
      r.texture.dispose();
      if (studios.get(renderer) === r) studios.delete(renderer);
    },
  };
}
