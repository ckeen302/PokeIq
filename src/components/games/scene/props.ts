import * as THREE from "three";
import { LIFT } from "@/lib/games/constants";
import { loadBar } from "@/lib/games/lift";
import { REF_LIGHTS } from "@/lib/games/venues";
import { signTexture } from "./venues/infield";
import type { ShowFrame } from "../show/types";

/**
 * The things athletes handle and win, shared by the venues: the shot (a
 * real 12 cm, 7.26 kg sphere) and the javelin (2.65 m), the barbell (a
 * 20 kg bar or a lighter training bar, its real IWF plates, collars, and a
 * shaft that bends under the load and whips on the drive), the judges'
 * lights, and the podium with its medals.
 */

export interface GameProps {
  group: THREE.Group;
  /** Shows every prop once so its shaders compile before the show. */
  warm(): void;
  update(f: ShowFrame, cam: THREE.Camera): void;
  dispose(): void;
}

const PLATE_GEO = new Map<string, THREE.CylinderGeometry>();

export function buildProps(o: { font: string }): GameProps {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => { geos.push(x); return x; };
  const m = <T extends THREE.Material>(x: T) => { mats.push(x); return x; };

  // ---- Shot and javelin.
  const shot = new THREE.Mesh(g(new THREE.SphereGeometry(0.06, 24, 16)), m(new THREE.MeshStandardMaterial({ color: "#3a3d44", metalness: 0.85, roughness: 0.32 })));
  shot.visible = false;
  group.add(shot);
  const jav = new THREE.Group();
  {
    const shaft = new THREE.Mesh(g(new THREE.CylinderGeometry(0.014, 0.01, 2.4, 8).rotateZ(-Math.PI / 2)), m(new THREE.MeshStandardMaterial({ color: "#d8dde4", metalness: 0.7, roughness: 0.3 })));
    shaft.position.x = -0.1;
    const tip = new THREE.Mesh(g(new THREE.ConeGeometry(0.014, 0.25, 8).rotateZ(-Math.PI / 2)), m(new THREE.MeshStandardMaterial({ color: "#ff4d4d", metalness: 0.6, roughness: 0.3 })));
    tip.position.x = 1.22;
    const grip = new THREE.Mesh(g(new THREE.CylinderGeometry(0.017, 0.017, 0.16, 8).rotateZ(-Math.PI / 2)), m(new THREE.MeshStandardMaterial({ color: "#1f2d4a", roughness: 0.9 })));
    grip.position.x = 0.12;
    jav.add(shaft, tip, grip);
  }
  jav.visible = false;
  group.add(jav);

  // ---- The barbell: a shaft that bends (vertex shader), sleeves, plates and collars.
  const bend = { uBend: { value: 0 }, uHalf: { value: 0.66 } };
  const shaftMat = m(new THREE.MeshStandardMaterial({ color: "#c9ced6", metalness: 0.9, roughness: 0.25 }));
  shaftMat.onBeforeCompile = (s) => {
    s.uniforms.uBend = bend.uBend;
    s.uniforms.uHalf = bend.uHalf;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uBend; uniform float uHalf;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n{ float ax = abs(transformed.x); float o = max(0.0, ax - uHalf * 0.42); transformed.y -= uBend * o * o; }");
  };
  shaftMat.customProgramCacheKey = () => "games-bar";
  const barbell = new THREE.Group();
  const shaft = new THREE.Mesh(g(new THREE.CylinderGeometry(0.014, 0.014, 1, 12, 24).rotateZ(Math.PI / 2)), shaftMat);
  barbell.add(shaft);
  const sleeves = [-1, 1].map((s) => {
    const sl = new THREE.Mesh(g(new THREE.CylinderGeometry(0.025, 0.025, 1, 12, 8).rotateZ(Math.PI / 2)), shaftMat);
    sl.userData.side = s;
    barbell.add(sl);
    return sl;
  });
  const plateGroup = new THREE.Group();
  barbell.add(plateGroup);
  barbell.visible = false;
  group.add(barbell);
  const plateMats = new Map<string, THREE.MeshStandardMaterial>();
  const plateMat = (color: string) => {
    let pm = plateMats.get(color);
    if (!pm) { pm = m(new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 })); plateMats.set(color, pm); }
    return pm;
  };
  const collarMat = m(new THREE.MeshStandardMaterial({ color: "#9aa1ab", metalness: 0.8, roughness: 0.3 }));
  let loadedWeight = -1;
  let half = 0.66;
  const setLoad = (weight: number) => {
    if (weight === loadedWeight) return;
    loadedWeight = weight;
    plateGroup.clear();
    const l = loadBar(weight);
    const bar = l?.bar ?? 2;
    // Bar lengths (m): 20 kg 2.2, 15 kg 2.01, technique bars 2.01 and 1.8, the junior bar 1.5.
    const len = bar === 20 ? 2.2 : bar >= 10 ? 2.01 : bar === 5 ? 1.8 : 1.5;
    const gripHalf = bar === 20 ? 0.655 : len * 0.3;
    let x = gripHalf + 0.03;
    const side = l?.side ?? [];
    const placed: { kg: number; color: string; d: number; w: number; x: number }[] = [];
    for (const p of side) { placed.push({ ...p, x: x + p.w / 2 }); x += p.w + 0.004; }
    if (l?.collars) x += 0.05;
    // The sleeves are as long as the plates need (giants' loads run far past a real 41.5 cm sleeve).
    const sleeveEnd = Math.max(len / 2, x + 0.04);
    half = sleeveEnd;
    bend.uHalf.value = sleeveEnd;
    shaft.scale.set(gripHalf * 2 + 0.04, 1, 1);
    for (const sl of sleeves) {
      const s = sl.userData.side as number;
      sl.scale.set(sleeveEnd - gripHalf, 1, 1);
      sl.position.x = s * (gripHalf + (sleeveEnd - gripHalf) / 2);
    }
    for (const p of placed) {
      const key = `${p.d}|${p.w}`;
      let pg = PLATE_GEO.get(key);
      if (!pg) { pg = new THREE.CylinderGeometry(p.d / 2, p.d / 2, p.w, 28).rotateZ(Math.PI / 2) as THREE.CylinderGeometry; PLATE_GEO.set(key, pg); }
      for (const s of [-1, 1]) {
        const mesh = new THREE.Mesh(pg, plateMat(p.color));
        mesh.position.x = s * p.x;
        mesh.userData.x = p.x;
        plateGroup.add(mesh);
      }
    }
    if (l?.collars) for (const s of [-1, 1]) {
      const c = new THREE.Mesh(g(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12).rotateZ(Math.PI / 2)), collarMat);
      c.position.x = s * (x - 0.03);
      c.userData.x = x - 0.03;
      plateGroup.add(c);
    }
  };

  // ---- Judges' lights: three lamps on a stand.
  const lights = new THREE.Group();
  const lampGeo = g(new THREE.SphereGeometry(0.09, 16, 12));
  const lamps = [0, 1, 2].map((i) => {
    const lm = m(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.08, 0.08), toneMapped: false }));
    const lamp = new THREE.Mesh(lampGeo, lm);
    lamp.position.set((i - 1) * 0.28, 1.6, 0);
    lights.add(lamp);
    return lm;
  });
  const stand = new THREE.Mesh(g(new THREE.BoxGeometry(1.0, 0.32, 0.14)), m(new THREE.MeshStandardMaterial({ color: "#16191f", roughness: 0.6 })));
  stand.position.y = 1.6;
  stand.position.z = -0.1;
  const pole = new THREE.Mesh(g(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8)), m(new THREE.MeshStandardMaterial({ color: "#2a2f38" })));
  pole.position.y = 0.75;
  lights.add(stand, pole);
  lights.visible = false;
  group.add(lights);

  // ---- The podium.
  const podium = new THREE.Group();
  const stepMat = m(new THREE.MeshStandardMaterial({ color: "#f3f4f6", roughness: 0.4, metalness: 0.05 }));
  const steps: THREE.Mesh[] = [];
  for (const [place, h, x] of [[1, 0.6, 0], [2, 0.42, -1.25], [3, 0.3, 1.25]] as const) {
    const st = new THREE.Mesh(g(new THREE.BoxGeometry(1.2, h, 1.0)), stepMat);
    st.position.set(x, h / 2, 0);
    st.userData = { place, h, x };
    podium.add(st);
    steps.push(st);
    const tex = signTexture(String(place), o.font, { w: 128, h: 128, bg: "#f3f4f6", fg: place === 1 ? "#b08a1e" : place === 2 ? "#7c8591" : "#9a5b2b" });
    texs.push(tex);
    const face = new THREE.Mesh(g(new THREE.PlaneGeometry(0.42, 0.42)), m(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, transparent: true })));
    face.position.set(x, h * 0.55, 0.501);
    podium.add(face);
  }
  const trim = new THREE.Mesh(g(new THREE.BoxGeometry(3.8, 0.04, 1.06)), m(new THREE.MeshStandardMaterial({ color: "#ffd84a", metalness: 0.6, roughness: 0.35 })));
  trim.position.y = 0.02;
  podium.add(trim);
  podium.visible = false;
  group.add(podium);
  // Medals: a disc on a ribbon, gold, silver, bronze.
  const medalGeo = g(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 32).rotateX(Math.PI / 2));
  const ribbonGeo = g(new THREE.PlaneGeometry(0.28, 1.1));
  const medalMats = [m(new THREE.MeshStandardMaterial({ color: "#f4c542", metalness: 1, roughness: 0.22, emissive: new THREE.Color(0.25, 0.18, 0.02) })), m(new THREE.MeshStandardMaterial({ color: "#d7dde5", metalness: 1, roughness: 0.2, emissive: new THREE.Color(0.12, 0.12, 0.14) })), m(new THREE.MeshStandardMaterial({ color: "#c27a3f", metalness: 1, roughness: 0.28, emissive: new THREE.Color(0.14, 0.07, 0.02) }))];
  const ribbonMat = m(new THREE.MeshStandardMaterial({ color: "#2b59c3", roughness: 0.8, side: THREE.DoubleSide }));
  const medals = [0, 1, 2].map((i) => {
    const md = new THREE.Group();
    const disc = new THREE.Mesh(medalGeo, medalMats[i]);
    const rib = new THREE.Mesh(ribbonGeo, ribbonMat);
    rib.position.y = 0.75;
    md.add(disc, rib);
    md.visible = false;
    group.add(md);
    return md;
  });

  const camPos = new THREE.Vector3();
  return {
    group,
    warm() {
      shot.visible = jav.visible = barbell.visible = lights.visible = podium.visible = true;
      setLoad(187);
      medals.forEach((md) => { md.visible = true; });
    },
    update(f, cam) {
      cam.getWorldPosition(camPos);
      const p = f.props;
      shot.visible = jav.visible = false;
      if (p.kind === "throw" && p.pos) {
        if (p.implement === "shot") {
          shot.visible = true;
          shot.position.set(...p.pos);
        } else {
          jav.visible = true;
          jav.position.set(...p.pos);
          const d = new THREE.Vector3(...p.dir).normalize();
          jav.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d);
          if (p.stuck > 0) jav.rotateY(0.05 * Math.sin(f.t * 40) * Math.exp(-p.stuck * 3));
        }
      }
      barbell.visible = lights.visible = false;
      if (p.kind === "lift") {
        lights.visible = true;
        // Beside the platform, facing the lifter.
        lights.position.set(REF_LIGHTS.x, 0, REF_LIGHTS.z);
        lights.rotation.y = Math.atan2(-REF_LIGHTS.x, -REF_LIGHTS.z);
        p.lights.forEach((c, i) => lamps[i].color.setRGB(c === "white" ? 6 : c === "red" ? 6 : 0.08, c === "white" ? 6 : c === "red" ? 0.25 : 0.08, c === "white" ? 6 : c === "red" ? 0.2 : 0.08));
        if (p.bar) {
          barbell.visible = true;
          setLoad(p.weight);
          barbell.position.set(...p.bar);
          barbell.rotation.set(0, 0, p.tilt);
          // A real bar sags and whips a few centimetres at its ends under a heavy load; a giant's load bends it a
          // little more, but never into a drawing's arc (the tip's drop, whatever the bar's length).
          const reach = Math.max(0.2, half * 0.58);
          const tip = Math.min(0.14, 0.02 + p.weight / 6000) * Math.max(-0.6, Math.min(1.6, p.bend + p.whip));
          bend.uBend.value = tip / (reach * reach);
          // Plates ride the bend.
          for (const c of plateGroup.children) {
            const x = c.userData.x as number;
            const o2 = Math.max(0, x - half * 0.42);
            c.position.y = -bend.uBend.value * o2 * o2;
          }
        }
      }
      podium.visible = false;
      medals.forEach((md) => { md.visible = false; });
      if (p.kind === "podium") {
        podium.visible = true;
        podium.position.set(...p.at);
        podium.scale.setScalar(p.scale);
        for (const md of p.medals) {
          if (f.t < md.t0) continue;
          const mesh = medals[md.medal - 1];
          mesh.visible = true;
          // Hung round the neck: it drops in, swings, and catches the light.
          const k = Math.min(1, (f.t - md.t0) / 0.5);
          mesh.position.set(md.pos[0], md.pos[1] + (1 - k) * md.size * 3, md.pos[2]);
          mesh.lookAt(camPos.x, mesh.position.y, camPos.z);
          mesh.scale.setScalar(md.size);
          mesh.rotateY(0.3 * Math.sin(f.t * 2.2 + md.medal) * Math.exp(-(f.t - md.t0) * 0.6));
        }
      }
    },
    dispose() {
      geos.forEach((x) => x.dispose());
      mats.forEach((x) => x.dispose());
      texs.forEach((x) => x.dispose());
      for (const pg of PLATE_GEO.values()) pg.dispose();
      PLATE_GEO.clear();
    },
  };
}

export const podiumSteps = { 1: { h: 0.6, x: 0 }, 2: { h: 0.42, x: -1.25 }, 3: { h: 0.3, x: 1.25 } } as const;
export const BAR = LIFT.bar;
