import * as THREE from "three";
import { chainShader, glowDisc, withWorldPos, type LabTime } from "./holo";
import { liquidGradient, miniScreen, wallPanel, wallScreens, type LabFonts } from "./screens";

/**
 * The research lab round the wheel: a polished floor (its reflection drawn
 * by mirror.ts, blurred by how rough each tile is, with light inlays), the
 * round wall with its research screens, consoles and specimen tubes, the
 * ceiling's ribs and light rings, and cables run across the floor.
 */

export const ROOM = {
  wallR: 16.5,
  height: 8.2,
  ringR: 9.0,
  tableR: 2.3,
  pods: 12,
} as const;

export interface FloorUniforms {
  tRefl: { value: THREE.Texture | null };
  uMirror: { value: THREE.Matrix4 };
  uReflOn: { value: number };
  uRingPhase: { value: number };
  uSel: { value: number };
  uSelCol: { value: THREE.Color };
  uPodCol: { value: THREE.Color[] };
}

export interface Room {
  group: THREE.Group;
  floor: THREE.Mesh;
  floorUniforms: FloorUniforms;
  /** The live specimen index on the wall: redraw its canvas, then flag the texture. */
  index: { canvas: HTMLCanvasElement; texture: THREE.Texture };
  dispose(): void;
}

const CYAN = new THREE.Color("#5fdcff");

function std(p: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial(p);
}

/** The floor's material: dark polished panels in rings and spokes, a blurred mirror in each, inlaid light lines. */
function floorMaterial(u: FloorUniforms, time: LabTime) {
  const m = std({ color: "#0d121b", roughness: 0.24, metalness: 0.35, envMapIntensity: 0.35 });
  chainShader(m, "labfloor", (s) => {
    withWorldPos(s);
    Object.assign(s.uniforms, u, { uLabTime: time, uCyan: { value: CYAN } });
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D tRefl; uniform mat4 uMirror; uniform float uReflOn, uRingPhase, uSel, uLabTime;
        uniform vec3 uSelCol, uCyan; uniform vec3 uPodCol[${ROOM.pods}];
        float flHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        const float RINGS[9] = float[9](2.45, 3.35, 4.7, 6.1, 9.1, 10.9, 12.6, 14.1, 15.5);
        float labGrout, labPanel;
        void labTiles(vec2 xz) {
          float r = length(xz);
          float a = atan(xz.x, xz.y);
          float dr = 1e3; float ringId = 0.0;
          for (int i = 0; i < 9; i++) { float d = abs(r - RINGS[i]); if (d < dr) dr = d; ringId += step(RINGS[i], r); }
          float n = ringId < 1.5 ? 12.0 : ringId < 3.5 ? 24.0 : 48.0;
          float sa = a / 6.2831853 * n + (ringId == 2.0 || ringId == 5.0 ? 0.5 : 0.0);
          float ds = abs(fract(sa) - 0.5) * 6.2831853 / n * r;
          float d = min(dr, ds);
          float aa = fwidth(r) * 0.8 + 0.002;
          labGrout = 1.0 - smoothstep(0.006, 0.018 + aa, d);
          labPanel = flHash(vec2(ringId, floor(sa)));
        }`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        labTiles(vLabW.xz);
        diffuseColor.rgb *= mix(0.82, 1.12, labPanel) * (1.0 - 0.75 * labGrout);`
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = mix(0.16 + 0.16 * labPanel, 0.8, labGrout);")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec2 xz = vLabW.xz;
          float r = length(xz);
          float a = atan(xz.x, xz.y);
          // The mirror, blurred more on rougher panels and towards the distance.
          vec3 refl = vec3(0.0);
          if (uReflOn > 0.5) {
            vec4 pr = uMirror * vec4(vLabW, 1.0);
            vec2 ruv = pr.xy / pr.w;
            float blur = mix(0.002, 0.016, labPanel * 0.5 + labGrout);
            float lod = mix(0.6, 3.0, labPanel * 0.4 + labGrout);
            float ang = flHash(gl_FragCoord.xy) * 6.2831853;
            for (int i = 0; i < 8; i++) {
              float t = (float(i) + 0.5) / 8.0;
              float ra = ang + float(i) * 2.39996;
              vec2 o = vec2(cos(ra), sin(ra)) * sqrt(t) * blur;
              o.y *= 1.8; // reflections stretch towards the viewer
              refl += textureLod(tRefl, ruv + o, lod).rgb;
            }
            refl /= 8.0;
            vec3 vd = normalize(vViewPosition);
            float ndv = clamp(dot(normal, vd), 0.0, 1.0);
            float fres = mix(0.38, 1.0, pow(1.0 - ndv, 3.0));
            refl *= fres * (1.0 - 0.85 * labGrout);
          }
          vec3 glow = vec3(0.0);
          float aa = fwidth(r) + 0.002;
          float step12 = 6.2831853 / ${ROOM.pods}.0;
          // The ring path between the pods, broken at each pod.
          float k = (a - uRingPhase) / step12;
          float podD = abs(fract(k + 0.5) - 0.5) * step12 * r;
          float ringLine = (1.0 - smoothstep(0.0, 0.012 + aa, abs(r - ${ROOM.ringR.toFixed(2)} - 1.05))) * smoothstep(0.9, 1.3, podD);
          ringLine += (1.0 - smoothstep(0.0, 0.01 + aa, abs(r - ${ROOM.ringR.toFixed(2)} + 1.05))) * smoothstep(0.9, 1.3, podD) * 0.6;
          glow += uCyan * ringLine * 1.6;
          // Conduits from the table to each pod: dashes flowing outwards; the selected pod's is solid and in its colour.
          float idx = floor(k + 0.5);
          float wrapIdx = mod(idx, ${ROOM.pods}.0);
          float lat = (k - idx) * step12 * r;
          float inRun = step(2.7, r) * step(r, ${ROOM.ringR.toFixed(2)} - 1.0);
          float line = (1.0 - smoothstep(0.0, 0.01 + aa, abs(lat))) * inRun;
          float line2 = (1.0 - smoothstep(0.0, 0.008 + aa, abs(abs(lat) - 0.09))) * inRun * 0.5;
          float isSel = 1.0 - step(0.5, abs(wrapIdx - uSel));
          float dash = step(0.45, fract(r * 1.6 - uLabTime * 0.5));
          vec3 podCol = uPodCol[int(wrapIdx)];
          glow += mix(podCol * 0.7 * dash, uSelCol * (1.4 + 1.2 * dash), isSel) * line;
          glow += mix(uCyan * 0.35, uSelCol * 0.9, isSel) * line2;
          // The table's surround and the perimeter.
          glow += uSelCol * (1.0 - smoothstep(0.0, 0.012 + aa, abs(r - 2.62))) * 1.8;
          glow += uSelCol * (1.0 - smoothstep(0.0, 0.008 + aa, abs(r - 2.78))) * 0.7;
          glow += uCyan * (1.0 - smoothstep(0.0, 0.012 + aa, abs(r - 15.4))) * 1.0;
          // Light pooled round the table and under each pod.
          glow += uSelCol * exp(-pow((r - 2.4) / 0.9, 2.0)) * 0.16;
          vec2 pc = vec2(sin(uRingPhase + idx * step12), cos(uRingPhase + idx * step12)) * ${ROOM.ringR.toFixed(2)};
          float pd = length(xz - pc);
          glow += mix(podCol, uSelCol, isSel) * exp(-pd * pd / 1.6) * mix(0.1, 0.28, isSel);
          totalEmissiveRadiance += refl + glow * (1.0 - 0.6 * labGrout);
        }`
      );
  });
  return m;
}

export function buildRoom(scene: THREE.Scene, fonts: LabFonts, time: LabTime, floorUniforms: FloorUniforms, back: number): Room {
  const group = new THREE.Group();
  scene.add(group);
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, o: { cast?: boolean; receive?: boolean } = {}) => {
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = !!o.cast;
    mesh.receiveShadow = o.receive ?? true;
    group.add(mesh);
    return mesh;
  };
  const mat = <T extends THREE.Material>(m: T) => { mats.push(m); return m; };

  // ---- Floor.
  const floor = add(new THREE.CircleGeometry(ROOM.wallR, 160).rotateX(-Math.PI / 2), mat(floorMaterial(floorUniforms, time)), { receive: true });

  // ---- Wall.
  const panel = wallPanel();
  texs.push(panel.map, panel.emissive);
  const wallMat = mat(std({ map: panel.map, emissiveMap: panel.emissive, emissive: new THREE.Color(1.4, 1.4, 1.4), roughness: 0.6, metalness: 0.4, side: THREE.BackSide }));
  add(new THREE.CylinderGeometry(ROOM.wallR, ROOM.wallR, ROOM.height, 96, 1, true).translate(0, ROOM.height / 2, 0), wallMat);
  // Skirting with a light strip.
  const dark = mat(std({ color: "#0b0f16", roughness: 0.45, metalness: 0.7 }));
  const darker = mat(std({ color: "#07090e", roughness: 0.55, metalness: 0.5 }));
  add(new THREE.CylinderGeometry(ROOM.wallR - 0.25, ROOM.wallR - 0.25, 0.35, 96, 1, true).translate(0, 0.175, 0), mat(std({ color: "#0e131c", roughness: 0.4, metalness: 0.6, side: THREE.BackSide })));
  const stripMat = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(2.2) }));
  add(new THREE.TorusGeometry(ROOM.wallR - 0.27, 0.015, 6, 192).rotateX(Math.PI / 2).translate(0, 0.36, 0), stripMat);

  // ---- Ceiling: a dark dome cap, ribs, light rings, the rig over the table.
  add(new THREE.CircleGeometry(ROOM.wallR, 96).rotateX(Math.PI / 2).translate(0, ROOM.height, 0), mat(std({ color: "#080a10", roughness: 0.8, metalness: 0.2 })));
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const len = ROOM.wallR - 2.2;
    const rib = add(new THREE.BoxGeometry(0.22, 0.5, len).translate(0, 0, 2.2 + len / 2), dark);
    rib.rotation.y = a;
    rib.position.y = ROOM.height - 0.25;
    // Wall pilaster under each rib.
    const pil = add(new THREE.BoxGeometry(0.42, ROOM.height, 0.3).translate(0, ROOM.height / 2, -(ROOM.wallR - 0.12)), dark);
    pil.rotation.y = a + Math.PI / 24;
  }
  const lampMat = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.6, 4.2) }));
  const lampDim = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(1.6) }));
  add(new THREE.TorusGeometry(ROOM.ringR, 0.035, 8, 220).rotateX(Math.PI / 2).translate(0, ROOM.height - 0.62, 0), lampMat);
  add(new THREE.TorusGeometry(11.6, 0.025, 8, 220).rotateX(Math.PI / 2).translate(0, ROOM.height - 0.55, 0), lampDim);
  add(new THREE.TorusGeometry(ROOM.ringR, 0.18, 10, 160).rotateX(Math.PI / 2).translate(0, ROOM.height - 0.45, 0), dark);
  // The rig over the table: a drum with a ring of lamps underneath.
  add(new THREE.CylinderGeometry(2.0, 2.2, 0.6, 64).translate(0, ROOM.height - 1.15, 0), dark, { cast: false });
  add(new THREE.CylinderGeometry(0.5, 0.5, 0.9, 24).translate(0, ROOM.height - 0.45, 0), darker);
  add(new THREE.TorusGeometry(1.75, 0.04, 8, 128).rotateX(Math.PI / 2).translate(0, ROOM.height - 1.47, 0), lampMat);
  add(new THREE.CircleGeometry(1.2, 48).rotateX(Math.PI / 2).translate(0, ROOM.height - 1.46, 0), mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.85, 0.8) })));

  // ---- Research screens on the wall, consoles before them, specimen tubes between.
  const { textures: screens, index } = wallScreens(fonts);
  texs.push(...screens);
  const bezel = mat(std({ color: "#121822", roughness: 0.35, metalness: 0.8 }));
  const screenAngles = [back - 0.48, back + 0.48, back - 1.62, back + 1.62, back - 2.75, back + 2.75];
  const SW = 0.27; // arc (rad) of a screen: ~4.2 m
  screenAngles.forEach((a, i) => {
    const R = ROOM.wallR - 0.35;
    const m = mat(new THREE.MeshBasicMaterial({ map: screens[i % screens.length], color: new THREE.Color(1.55, 1.55, 1.55), side: THREE.BackSide }));
    // An arc of cylinder; three.js's theta runs from +z towards +x.
    const g = new THREE.CylinderGeometry(R, R, 2.4, 24, 1, true, a - SW / 2, SW).translate(0, 3.65, 0);
    // Seen from inside the drum: run the picture the other way round so it reads.
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setX(k, 1 - uv.getX(k));
    add(g, m, { receive: false });
    add(new THREE.CylinderGeometry(R + 0.06, R + 0.06, 2.62, 24, 1, true, a - SW / 2 - 0.008, SW + 0.016).translate(0, 3.65, 0), mat(std({ color: "#0d1219", roughness: 0.4, metalness: 0.8, side: THREE.BackSide })));
    // A light bar over it.
    add(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 0.03, 24, 1, true, a - SW / 2, SW).translate(0, 4.95, 0), stripMat);
    // The console before it: a desk, a sloped control deck, two small monitors.
    const desk = new THREE.Group();
    const dg = (geo: THREE.BufferGeometry, m: THREE.Material) => { geos.push(geo); const me = new THREE.Mesh(geo, m); me.castShadow = me.receiveShadow = true; desk.add(me); return me; };
    dg(new THREE.BoxGeometry(3.0, 0.95, 0.9).translate(0, 0.475, 0), dark);
    const deck = dg(new THREE.BoxGeometry(3.0, 0.06, 0.7), bezel);
    deck.position.set(0, 1.0, 0.05);
    deck.rotation.x = 0.35;
    const keys = mat(new THREE.MeshBasicMaterial({ map: miniScreen(i + 1, fonts), color: new THREE.Color(0.9, 0.9, 0.9) }));
    texs.push(keys.map!);
    const kp = dg(new THREE.PlaneGeometry(2.6, 0.5), keys);
    kp.position.set(0, 1.04, 0.07);
    kp.rotation.x = -Math.PI / 2 + 0.35;
    for (const sx of [-0.85, 0.85]) {
      dg(new THREE.BoxGeometry(0.9, 0.58, 0.05).translate(sx, 1.55, -0.28), bezel);
      const ms = mat(new THREE.MeshBasicMaterial({ map: miniScreen(i * 2 + (sx > 0 ? 7 : 3), fonts), color: new THREE.Color(1.3, 1.3, 1.3) }));
      texs.push(ms.map!);
      const sp = dg(new THREE.PlaneGeometry(0.84, 0.52), ms);
      sp.position.set(sx, 1.55, -0.25);
    }
    const r2 = ROOM.wallR - 1.55;
    desk.position.set(Math.sin(a) * r2, 0, Math.cos(a) * r2);
    desk.rotation.y = a + Math.PI;
    group.add(desk);
  });

  // Specimen tubes: glass round glowing liquid, bubbles rising.
  const liquid = liquidGradient();
  texs.push(liquid);
  const tubeCols = ["#3dffb0", "#5fd6ff", "#b28cff", "#3dffb0", "#ff8fd0", "#5fd6ff", "#9cff5f", "#b28cff"];
  const tubeAngles = [back, back - 1.05, back + 1.05, back - 2.2, back + 2.2, back + Math.PI - 0.35, back + Math.PI + 0.35];
  const glassMat = mat(new THREE.MeshPhysicalMaterial({ color: "#cfefff", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide }));
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.6, 2.6) })), tubeAngles.length * 22);
  geos.push(bubbles.geometry);
  const bm = new THREE.Matrix4();
  let bi = 0;
  tubeAngles.forEach((a, i) => {
    const r = ROOM.wallR - 1.25;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    const col = new THREE.Color(tubeCols[i]);
    const tube = new THREE.Group();
    tube.position.set(x, 0, z);
    group.add(tube);
    const tg = (geo: THREE.BufferGeometry, m: THREE.Material, cast = true) => { geos.push(geo); const me = new THREE.Mesh(geo, m); me.castShadow = cast; me.receiveShadow = true; tube.add(me); return me; };
    tg(new THREE.CylinderGeometry(0.62, 0.7, 0.55, 40).translate(0, 0.275, 0), dark);
    tg(new THREE.TorusGeometry(0.63, 0.02, 6, 64).rotateX(Math.PI / 2).translate(0, 0.42, 0), mat(new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.5) })), false);
    const liq = mat(std({ color: "#000000", emissive: col.clone().multiplyScalar(1.15), emissiveMap: liquid, roughness: 0.2, transparent: true, opacity: 0.9 }));
    tg(new THREE.CylinderGeometry(0.44, 0.44, 3.0, 40, 1, false).translate(0, 0.6 + 1.5, 0), liq, false);
    tg(new THREE.CylinderGeometry(0.5, 0.5, 3.2, 40, 1, true).translate(0, 0.55 + 1.6, 0), glassMat, false);
    tg(new THREE.CylinderGeometry(0.66, 0.6, 0.45, 40).translate(0, 3.95, 0), dark);
    tg(new THREE.CylinderGeometry(0.08, 0.08, ROOM.height - 4.1, 8).translate(0.25, 4.1 + (ROOM.height - 4.1) / 2, 0), darker, false);
    tg(new THREE.CylinderGeometry(0.06, 0.06, ROOM.height - 4.1, 8).translate(-0.22, 4.1 + (ROOM.height - 4.1) / 2, 0.1), darker, false);
    // Its glow on the floor round it (painted light: no lamp to slow every other surface down).
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2).translate(0, 0.012, 0), mat(glowDisc(col.clone(), 0.32, 2.2)));
    geos.push(gl.geometry);
    gl.renderOrder = 2;
    tube.add(gl);
    for (let k = 0; k < 22; k++) {
      const rr = Math.sqrt(Math.random()) * 0.34, aa = Math.random() * Math.PI * 2, y = 0.7 + Math.random() * 2.8, s = 0.012 + Math.random() * 0.03;
      bm.makeScale(s, s, s).setPosition(x + Math.cos(aa) * rr, y, z + Math.sin(aa) * rr);
      bubbles.setMatrixAt(bi++, bm);
    }
  });
  group.add(bubbles);

  // Shelving between: frames with specimen jars and binders.
  const jarCols = ["#ffcf5f", "#5fd6ff", "#3dffb0", "#ff8f6b", "#b28cff"];
  const shelfAngles = [back - 0.82, back + 0.82, back - 1.33, back + 1.33];
  const shelfMat = mat(std({ color: "#1a212c", roughness: 0.5, metalness: 0.6 }));
  shelfAngles.forEach((a, si) => {
    const r = ROOM.wallR - 0.75;
    const shelf = new THREE.Group();
    shelf.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    shelf.rotation.y = a + Math.PI;
    group.add(shelf);
    const sg = (geo: THREE.BufferGeometry, m: THREE.Material) => { geos.push(geo); const me = new THREE.Mesh(geo, m); me.castShadow = true; me.receiveShadow = true; shelf.add(me); return me; };
    for (const sx of [-1.0, 1.0]) sg(new THREE.BoxGeometry(0.08, 4.2, 0.6).translate(sx, 2.1, 0), shelfMat);
    for (let k = 0; k < 5; k++) {
      const y = 0.3 + k * 0.92;
      sg(new THREE.BoxGeometry(2.08, 0.05, 0.6).translate(0, y, 0), shelfMat);
      // A light strip under each shelf.
      sg(new THREE.BoxGeometry(1.9, 0.012, 0.02).translate(0, y - 0.035, 0.24), stripMat);
      let x = -0.9;
      let n = 0;
      while (x < 0.85) {
        const v = Math.sin((si * 31 + k * 7 + n) * 12.9898) * 43758.5453;
        const rnd = v - Math.floor(v);
        if (rnd < 0.45) {
          const h = 0.22 + rnd * 0.3, rad = 0.08 + rnd * 0.05;
          const jc = new THREE.Color(jarCols[(si + k + n) % jarCols.length]);
          sg(new THREE.CylinderGeometry(rad, rad, h, 16).translate(x + rad, y + 0.03 + h / 2, 0), mat(std({ color: "#000", emissive: jc.multiplyScalar(0.55 + rnd), roughness: 0.2 })));
          sg(new THREE.CylinderGeometry(rad * 0.9, rad * 0.9, 0.04, 16).translate(x + rad, y + 0.05 + h, 0), dark);
          x += rad * 2 + 0.06;
        } else {
          const w = 0.06 + rnd * 0.05, h = 0.48 + rnd * 0.26;
          const hue = (si * 0.13 + k * 0.29 + n * 0.17) % 1;
          sg(new THREE.BoxGeometry(w, h, 0.42).translate(x + w / 2, y + 0.03 + h / 2, -0.02), mat(std({ color: new THREE.Color().setHSL(hue, 0.35, 0.22), roughness: 0.7 })));
          x += w + 0.01;
        }
        n++;
      }
    }
  });

  return {
    group,
    floor,
    floorUniforms,
    index,
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
      scene.remove(group);
    },
  };
}

/** Cables across the floor from the table to each pod (on the turning ring, so they go round with it), dark rubber catching the light. */
export function buildCables(group: THREE.Group, podAngles: number[]): { dispose(): void } {
  const geos: THREE.BufferGeometry[] = [];
  const rubber = new THREE.MeshStandardMaterial({ color: "#0a0c10", roughness: 0.38, metalness: 0.1 });
  podAngles.forEach((a, i) => {
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      const off = side * 0.24 + (i % 3) * 0.02;
      const r0 = ROOM.tableR + 0.05, r1 = ROOM.ringR - 0.7;
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const r = r0 + (r1 - r0) * t;
        const wig = Math.sin(t * Math.PI * 2 + i + side) * 0.12 * Math.sin(t * Math.PI);
        const aa = a + (off + wig) / r;
        pts.push(new THREE.Vector3(Math.sin(aa) * r, 0.04, Math.cos(aa) * r));
      }
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, side > 0 ? 0.04 : 0.03, 8, false);
      geos.push(g);
      const m = new THREE.Mesh(g, rubber);
      m.receiveShadow = true;
      group.add(m);
    }
  });
  return { dispose() { geos.forEach((g) => g.dispose()); rubber.dispose(); } };
}
