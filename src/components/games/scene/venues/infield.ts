import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng } from "@/components/race/scene/textures";
import type { StadiumUrls } from "@/components/race/scene/stadium";
import { HJ, JT, LJ, SP, jtLine } from "@/lib/games/venues";

/**
 * The field-event venues in PokéIQ Stadium's infield (lib/games/venues
 * lays them out): the long jump runway, board and sand pit; the high jump
 * apron, standards, bar and landing mat; the shot put circle with its stop
 * board; the javelin runway and arc; each with its sector lines and
 * distance arcs. Each event shows its own and hides the rest. The moving
 * pieces (the bar, the mat's dent, the implements, flags, the measuring
 * tape and the leader's line) are set every frame by the event's stage.
 */

interface Built { geos: THREE.BufferGeometry[]; mats: THREE.Material[]; texs: THREE.Texture[] }
const keep = <T extends THREE.BufferGeometry>(b: Built, g: T) => { b.geos.push(g); return g; };
const mat = <T extends THREE.Material>(b: Built, m: T) => { b.mats.push(m); return m; };

function tartan(b: Built, urls: StadiumUrls, loader: THREE.TextureLoader, aniso: number, repeat: [number, number], color = "#d9a08f"): THREE.MeshStandardMaterial {
  const load = (map: "diff" | "nor" | "rough") => {
    const t = loader.load(urls.tex("rubberized_track", map));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    t.anisotropy = aniso;
    t.colorSpace = map === "diff" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    b.texs.push(t);
    return t;
  };
  return mat(b, new THREE.MeshStandardMaterial({ map: load("diff"), normalMap: load("nor"), roughnessMap: load("rough"), color, roughness: 1, metalness: 0, envMapIntensity: 0.5 }));
}

/** A raked sand texture (canvas). */
function sandTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#d8b47a";
  g.fillRect(0, 0, S, S);
  const r = rng(11);
  for (let i = 0; i < 9000; i++) {
    const k = r();
    g.fillStyle = k < 0.5 ? `rgba(255,236,196,${0.12 + r() * 0.2})` : `rgba(120,86,40,${0.08 + r() * 0.18})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  // Rake lines along the pit.
  for (let x = 0; x < S; x += 6) {
    g.strokeStyle = `rgba(120,86,40,${0.1 + r() * 0.12})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x + r() * 2, 0);
    for (let y = 0; y <= S; y += 16) g.lineTo(x + Math.sin(y * 0.05 + x) * 1.2, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A white board with black numerals (distance markers, the bar's height). */
export function signTexture(text: string, font: string, o: { w?: number; h?: number; bg?: string; fg?: string } = {}): THREE.CanvasTexture {
  const W = o.w ?? 256, H = o.h ?? 128;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = o.bg ?? "#f4f4f0";
  g.fillRect(0, 0, W, H);
  g.fillStyle = o.fg ?? "#14161c";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `800 ${Math.round(H * 0.72)}px ${font}`;
  g.fillText(text, W / 2, H * 0.54, W * 0.92);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Flat white line segments on the ground (merged quads). */
function lines(b: Built, segs: [number, number, number, number][], w: number, y = 0.006, color = "#f2f2ee"): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x0, z0, x1, z1] of segs) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.PlaneGeometry(len, w).rotateX(-Math.PI / 2);
    g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    parts.push(g);
  }
  const geo = keep(b, mergeGeometries(parts));
  parts.forEach((p) => p.dispose());
  const m = new THREE.Mesh(geo, mat(b, new THREE.MeshStandardMaterial({ color, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 })));
  m.receiveShadow = true;
  return m;
}

/** An arc of a circle drawn as short segments. */
function arcSegs(cx: number, cz: number, r: number, a0: number, a1: number, n = 48): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = a0 + ((a1 - a0) * i) / n, q = a0 + ((a1 - a0) * (i + 1)) / n;
    out.push([cx + r * Math.cos(p), cz + r * Math.sin(p), cx + r * Math.cos(q), cz + r * Math.sin(q)]);
  }
  return out;
}

/** A glowing virtual line (the broadcast's "leader" mark). */
function glowLine(b: Built, color: string): THREE.Mesh {
  const m = new THREE.Mesh(keep(b, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), mat(b, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })));
  m.renderOrder = 4;
  m.visible = false;
  return m;
}

export interface LongJumpVenue {
  group: THREE.Group;
  /** Lengthen the pit for the field's longest jump. */
  setPit(farMark: number): void;
  /** The flag by the board: 0 down, 1 up; white for a fair jump, red for a foul. */
  setFlag(up: number, foul: boolean): void;
  /** The measuring tape from the line to a mark (null hides it). */
  setTape(mark: number | null): void;
  /** The leader's mark across the pit (null hides it). */
  setLeader(mark: number | null): void;
}

export interface HighJumpVenue {
  group: THREE.Group;
  /** Sets the bar's height: the standards grow for giants, the height board reads it. */
  setHeight(h: number, font: string): void;
  /** The bar: wobble (rad of roll, m of bounce) or knocked off (0 on the pins … 1 on the mat). */
  setBar(o: { bounce: number; spin: number; fall: number; side: number }): void;
  /** The mat's dent: where (x, z) and how deep (m). */
  setDent(x: number, z: number, depth: number, r: number): void;
}

export interface ThrowVenue {
  group: THREE.Group;
  setTape(mark: number | null): void;
  setLeader(mark: number | null): void;
}

export interface Infield {
  group: THREE.Group;
  lj: LongJumpVenue;
  hj: HighJumpVenue;
  sp: ThrowVenue;
  jt: ThrowVenue;
  show(which: "lj" | "hj" | "sp" | "jt" | "podium" | null): void;
  dispose(): void;
}

export function buildInfield(o: { urls: StadiumUrls; font: string; aniso: number }): Infield {
  const b: Built = { geos: [], mats: [], texs: [] };
  const loader = new THREE.TextureLoader();
  const root = new THREE.Group();
  const white = mat(b, new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.5 }));
  const steel = mat(b, new THREE.MeshStandardMaterial({ color: "#d9dde3", roughness: 0.35, metalness: 0.7 }));
  const dark = mat(b, new THREE.MeshStandardMaterial({ color: "#23262d", roughness: 0.6, metalness: 0.3 }));

  // ---------------------------------------------------------------- Long jump
  const lj = new THREE.Group();
  {
    const len = LJ.back + 2;
    const run = new THREE.Mesh(keep(b, new THREE.PlaneGeometry(len, LJ.runwayW + 0.3).rotateX(-Math.PI / 2)), tartan(b, o.urls, loader, o.aniso, [len / 2.5, 0.6]));
    run.position.set(LJ.line - len / 2, 0.003, LJ.z);
    run.receiveShadow = true;
    lj.add(run);
    lj.add(lines(b, [[LJ.line - len, LJ.z - LJ.runwayW / 2, LJ.line, LJ.z - LJ.runwayW / 2], [LJ.line - len, LJ.z + LJ.runwayW / 2, LJ.line, LJ.z + LJ.runwayW / 2]], 0.05, 0.007));
    // Take-off board and plasticine.
    const board = new THREE.Mesh(keep(b, new THREE.BoxGeometry(LJ.boardW, 0.02, LJ.runwayW)), white);
    board.position.set(LJ.line - LJ.boardW / 2, 0.0, LJ.z);
    lj.add(board);
    const plast = new THREE.Mesh(keep(b, new THREE.BoxGeometry(0.1, 0.012, LJ.runwayW)), mat(b, new THREE.MeshStandardMaterial({ color: "#e9dcc0", roughness: 0.9 })));
    plast.position.set(LJ.line + 0.05, 0.0, LJ.z);
    lj.add(plast);
  }
  const sandTex = sandTexture();
  b.texs.push(sandTex);
  const sandMat = mat(b, new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, color: "#ffffff" }));
  const pit = new THREE.Mesh(keep(b, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), sandMat);
  pit.receiveShadow = true;
  lj.add(pit);
  const rim = new THREE.Group();
  lj.add(rim);
  const rimMat = mat(b, new THREE.MeshStandardMaterial({ color: "#3b4250", roughness: 0.8 }));
  const rimGeo = keep(b, new THREE.BoxGeometry(1, 0.08, 1));
  const rims = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(rimGeo, rimMat); rim.add(m); return m; });
  // Distance markers along the far side of the pit (every metre, numbered).
  const markers = new THREE.Group();
  lj.add(markers);
  const markerTex = new Map<number, THREE.CanvasTexture>();
  const markerGeo = keep(b, new THREE.PlaneGeometry(0.42, 0.24));
  const flagPole = new THREE.Mesh(keep(b, new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6)), steel);
  const flagCloth = new THREE.Mesh(keep(b, new THREE.PlaneGeometry(0.42, 0.3)), mat(b, new THREE.MeshStandardMaterial({ color: "#ffffff", side: THREE.DoubleSide, roughness: 0.8 })));
  const flag = new THREE.Group();
  flagPole.position.y = 0.55;
  flagCloth.position.set(0.22, 1.0, 0);
  flag.add(flagPole, flagCloth);
  flag.position.set(LJ.line + 0.2, 0, LJ.z - LJ.pitW / 2 - 0.9);
  lj.add(flag);
  const tape = new THREE.Mesh(keep(b, new THREE.PlaneGeometry(1, 0.03).rotateX(-Math.PI / 2)), mat(b, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.2), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6 })));
  tape.visible = false;
  lj.add(tape);
  const ljLeader = glowLine(b, "#3dff9a");
  lj.add(ljLeader);
  let pitFar = 10;
  const setPit = (far: number) => {
    pitFar = Math.max(10, Math.ceil(far + 2));
    const x0 = LJ.line + 1, x1 = LJ.line + pitFar;
    pit.scale.set(x1 - x0, 1, LJ.pitW);
    pit.position.set((x0 + x1) / 2, 0.004, LJ.z);
    sandTex.repeat.set((x1 - x0) / 2.5, LJ.pitW / 2.5);
    const t = 0.12;
    rims[0].scale.set(x1 - x0 + 2 * t, 1, t); rims[0].position.set((x0 + x1) / 2, 0.02, LJ.z - LJ.pitW / 2 - t / 2);
    rims[1].scale.set(x1 - x0 + 2 * t, 1, t); rims[1].position.set((x0 + x1) / 2, 0.02, LJ.z + LJ.pitW / 2 + t / 2);
    rims[2].scale.set(t, 1, LJ.pitW); rims[2].position.set(x0 - t / 2, 0.02, LJ.z);
    rims[3].scale.set(t, 1, LJ.pitW); rims[3].position.set(x1 + t / 2, 0.02, LJ.z);
    markers.clear();
    for (let m = 1; m <= pitFar; m++) {
      let tex = markerTex.get(m);
      if (!tex) { tex = signTexture(String(m), o.font, { w: 128, h: 72 }); markerTex.set(m, tex); b.texs.push(tex); }
      const sign = new THREE.Mesh(markerGeo, mat(b, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })));
      sign.position.set(LJ.line + m, 0.16, LJ.z - LJ.pitW / 2 - 0.3);
      sign.rotation.x = -0.35;
      markers.add(sign);
    }
  };
  setPit(10);
  root.add(lj);

  // ---------------------------------------------------------------- High jump
  const hj = new THREE.Group();
  {
    const apron = new THREE.Mesh(keep(b, new THREE.CircleGeometry(HJ.apron, 48, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2)), tartan(b, o.urls, loader, o.aniso, [HJ.apron / 2.5, HJ.apron / 2.5]));
    apron.rotation.y = 0;
    apron.position.set(HJ.barX, 0.003, HJ.z);
    apron.receiveShadow = true;
    hj.add(apron);
  }
  const matGeo = keep(b, new THREE.BoxGeometry(HJ.matD, HJ.matH, HJ.matW, 24, 2, 32));
  const dent = { uDent: { value: new THREE.Vector4(0, 0, 0, 1) } };
  const matMat = mat(b, new THREE.MeshStandardMaterial({ color: "#1f5fbf", roughness: 0.85 }));
  matMat.onBeforeCompile = (s) => {
    s.uniforms.uDent = dent.uDent;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec4 uDent;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        {
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float d = length(wp.xz - uDent.xy);
          float k = exp(-(d * d) / max(1e-3, uDent.w * uDent.w)) * smoothstep(${(-HJ.matH / 2).toFixed(3)}, ${(HJ.matH / 2).toFixed(3)}, transformed.y);
          transformed.y -= uDent.z * k;
        }`);
  };
  matMat.customProgramCacheKey = () => "games-hj-mat";
  const matMesh = new THREE.Mesh(matGeo, matMat);
  matMesh.position.set(HJ.barX - HJ.matD / 2 - 0.12, HJ.matH / 2, HJ.z);
  hj.add(matMesh);
  // A darker cover stripe and the front pads.
  const pad = new THREE.Mesh(keep(b, new THREE.BoxGeometry(0.4, HJ.matH * 0.9, HJ.matW + 0.4)), mat(b, new THREE.MeshStandardMaterial({ color: "#17468f", roughness: 0.9 })));
  pad.position.set(HJ.barX - 0.05 - 0.2, HJ.matH * 0.45, HJ.z);
  hj.add(pad);
  const standards: THREE.Group[] = [];
  const postGeo = keep(b, new THREE.CylinderGeometry(0.03, 0.03, 1, 10));
  const baseGeo = keep(b, new THREE.BoxGeometry(0.5, 0.05, 0.5));
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(postGeo, white);
    post.name = "post";
    g.add(post);
    const base = new THREE.Mesh(baseGeo, dark);
    base.position.y = 0.025;
    g.add(base);
    const peg = new THREE.Mesh(keep(b, new THREE.BoxGeometry(0.06, 0.03, 0.04)), steel);
    peg.name = "peg";
    g.add(peg);
    g.position.set(HJ.barX, 0, HJ.z + s * (HJ.barLength / 2 + 0.05));
    standards.push(g);
    hj.add(g);
  }
  const barTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 8;
    const g = cv.getContext("2d")!;
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#1a1a1a" : "#f2c230"; g.fillRect(i * 32, 0, 32, 8); }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  b.texs.push(barTex);
  const bar = new THREE.Mesh(keep(b, new THREE.CylinderGeometry(0.015, 0.015, HJ.barLength, 10).rotateX(Math.PI / 2)), mat(b, new THREE.MeshStandardMaterial({ map: barTex, roughness: 0.4 })));
  const barPivot = new THREE.Group();
  barPivot.add(bar);
  hj.add(barPivot);
  const heightBoard = new THREE.Mesh(keep(b, new THREE.PlaneGeometry(1.2, 0.5)), mat(b, new THREE.MeshBasicMaterial({ toneMapped: false })));
  const hbPost = new THREE.Mesh(keep(b, new THREE.BoxGeometry(0.08, 1, 0.08)), dark);
  const hb = new THREE.Group();
  hb.add(heightBoard, hbPost);
  heightBoard.position.y = 1.35;
  hbPost.position.y = 0.55;
  hb.position.set(HJ.barX + 3.5, 0, HJ.z + HJ.barLength / 2 + 2.6);
  hb.rotation.y = Math.PI * 0.32;
  hj.add(hb);
  let barH = 2;
  let hbTex: THREE.CanvasTexture | null = null;
  root.add(hj);

  // ---------------------------------------------------------------- Throws
  const throwLines = (cx: number, half: number, from: number, to: number, every: number, label: number, origin: number) => {
    const g = new THREE.Group();
    const segs: [number, number, number, number][] = [];
    for (const s of [-1, 1]) segs.push([cx - from * Math.cos(half), s * from * Math.sin(half), cx - to * Math.cos(half), s * to * Math.sin(half)]);
    for (let d = Math.ceil(from / every) * every; d <= to; d += every) segs.push(...arcSegs(cx, 0, d, Math.PI - half, Math.PI + half, Math.max(8, Math.round(d))));
    g.add(lines(b, segs, 0.05, 0.006));
    for (let d = Math.ceil(from / label) * label; d <= to; d += label) {
      const tex = signTexture(String(d - origin), o.font, { w: 160, h: 96 });
      b.texs.push(tex);
      const sign = new THREE.Mesh(keep(b, new THREE.PlaneGeometry(1.1, 0.66)), mat(b, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })));
      const a = Math.PI + half + 0.035;
      sign.position.set(cx + d * Math.cos(a), 0.45, d * Math.sin(a));
      sign.rotation.y = Math.PI / 2 + 0.35;
      g.add(sign);
    }
    return g;
  };
  const sp = new THREE.Group();
  {
    const conc = new THREE.Mesh(keep(b, new THREE.CircleGeometry(SP.r, 48).rotateX(-Math.PI / 2)), mat(b, new THREE.MeshStandardMaterial({ color: "#8d9096", roughness: 0.95 })));
    conc.position.set(SP.x, 0.008, SP.z);
    sp.add(conc);
    const ring = new THREE.Mesh(keep(b, new THREE.RingGeometry(SP.r, SP.r + 0.05, 64).rotateX(-Math.PI / 2)), white);
    ring.position.set(SP.x, 0.01, SP.z);
    sp.add(ring);
    const pad = new THREE.Mesh(keep(b, new THREE.CircleGeometry(SP.r + 1.1, 48).rotateX(-Math.PI / 2)), mat(b, new THREE.MeshStandardMaterial({ color: "#5c6068", roughness: 1 })));
    pad.position.set(SP.x, 0.005, SP.z);
    sp.add(pad);
    // The stop board: a white arc at the front of the circle, 10 cm tall.
    const sb = new THREE.Mesh(keep(b, new THREE.CylinderGeometry(SP.r + 0.12, SP.r + 0.12, 0.1, 24, 1, true, -Math.PI / 2 - 0.29, 0.58)), mat(b, new THREE.MeshStandardMaterial({ color: "#f4f4f0", side: THREE.DoubleSide, roughness: 0.6 })));
    sb.position.set(SP.x, 0.05, SP.z);
    sb.rotation.y = -Math.PI / 2;
    sp.add(sb);
    sp.add(throwLines(SP.x, SP.half, SP.r + 1, 95, 5, 10, SP.r));
  }
  const spTape = new THREE.Mesh(keep(b, new THREE.PlaneGeometry(1, 0.05).rotateX(-Math.PI / 2)), mat(b, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.2), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6 })));
  spTape.visible = false;
  sp.add(spTape);
  const leaderMat = mat(b, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 1.2), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
  /** A glowing arc across a sector at radius r (rebuilt when the lead changes). */
  const arcGeo = (r: number, half: number) => new THREE.RingGeometry(Math.max(0.01, r - 0.06), r + 0.06, Math.max(16, Math.round(r * 2)), 1, Math.PI - half, 2 * half).rotateX(-Math.PI / 2);
  const spLeader = new THREE.Mesh(arcGeo(10, SP.half), leaderMat);
  spLeader.visible = false;
  sp.add(spLeader);
  root.add(sp);

  const jt = new THREE.Group();
  {
    const x0 = jtLine(), x1 = x0 + JT.runway;
    const run = new THREE.Mesh(keep(b, new THREE.PlaneGeometry(JT.runway, JT.width).rotateX(-Math.PI / 2)), tartan(b, o.urls, loader, o.aniso, [JT.runway / 2.5, JT.width / 2.5]));
    run.position.set((x0 + x1) / 2, 0.003, JT.z);
    run.receiveShadow = true;
    jt.add(run);
    jt.add(lines(b, [[x0, JT.z - JT.width / 2, x1, JT.z - JT.width / 2], [x0, JT.z + JT.width / 2, x1, JT.z + JT.width / 2]], 0.05, 0.007));
    // The arc (7 cm, white) between the runway's lines.
    const ah = Math.asin(JT.width / 2 / JT.r);
    jt.add(lines(b, arcSegs(JT.cx, JT.z, JT.r, Math.PI - ah, Math.PI + ah, 12), 0.07, 0.008));
    jt.add(throwLines(JT.cx, JT.half, JT.r + 2, 112, 10, 10, JT.r));
  }
  const jtTape = spTape.clone();
  jtTape.material = spTape.material;
  jt.add(jtTape);
  const jtLeader = new THREE.Mesh(arcGeo(10, JT.half), leaderMat);
  jtLeader.visible = false;
  jt.add(jtLeader);
  const leaderAt = (m: THREE.Mesh, r: number, half: number, cx: number, z: number) => {
    if (m.userData.r !== r) {
      m.geometry.dispose();
      m.geometry = arcGeo(r, half);
      m.userData.r = r;
    }
    m.visible = true;
    m.position.set(cx, 0.015, z);
  };
  root.add(jt);

  const groups = { lj, hj, sp, jt };
  const show = (which: keyof typeof groups | "podium" | null) => {
    for (const [k, g] of Object.entries(groups)) g.visible = k === which;
  };
  show(null);

  const tapeTo = (m: THREE.Mesh, x0: number, x1: number, z: number) => {
    m.visible = true;
    m.scale.set(Math.max(0.01, Math.abs(x1 - x0)), 1, 1);
    m.position.set((x0 + x1) / 2, 0.012, z);
  };

  return {
    group: root,
    lj: {
      group: lj,
      setPit,
      setFlag(upK, foul) {
        flagCloth.position.y = 0.4 + 0.6 * upK;
        flagCloth.visible = upK > 0.02;
        (flagCloth.material as THREE.MeshStandardMaterial).color.set(foul ? "#e0262b" : "#ffffff");
      },
      setTape(mark) {
        if (mark == null) { tape.visible = false; return; }
        tapeTo(tape, LJ.line, LJ.line + mark, LJ.z - LJ.pitW * 0.36);
      },
      setLeader(mark) {
        if (mark == null) { ljLeader.visible = false; return; }
        ljLeader.visible = true;
        ljLeader.scale.set(0.08, 1, LJ.pitW + 0.6);
        ljLeader.position.set(LJ.line + mark, 0.02, LJ.z);
      },
    },
    hj: {
      group: hj,
      setHeight(h, font) {
        barH = h;
        const postH = Math.max(2.6, h + 0.45);
        for (const g of standards) {
          const post = g.getObjectByName("post")!;
          post.scale.y = postH;
          post.position.y = postH / 2;
          const peg = g.getObjectByName("peg")!;
          peg.position.set(0, h - 0.02, (g.position.z > HJ.z ? -1 : 1) * 0.03);
        }
        barPivot.position.set(HJ.barX, h, HJ.z);
        barPivot.rotation.set(0, 0, 0);
        bar.position.set(0, 0, 0);
        hbTex?.dispose();
        hbTex = signTexture(h.toFixed(2), font, { w: 256, h: 104, bg: "#06080d", fg: "#ffcc1a" });
        (heightBoard.material as THREE.MeshBasicMaterial).map = hbTex;
        (heightBoard.material as THREE.MeshBasicMaterial).needsUpdate = true;
        hb.position.y = Math.max(0, h * 0.6 - 0.8);
      },
      setBar({ bounce, spin, fall, side }) {
        if (fall > 0) {
          // Knocked off: it tips off the pins on the landing side and drops onto the mat.
          const k = Math.min(1, fall);
          const drop = Math.min(barH - HJ.matH - 0.02, barH * k * k * 1.1);
          barPivot.position.set(HJ.barX - 0.25 * k - 0.6 * k * k, barH - Math.max(0, drop), HJ.z);
          barPivot.rotation.set(0.25 * k * side, 0, 0.6 * k);
        } else {
          barPivot.position.set(HJ.barX, barH + bounce, HJ.z);
          barPivot.rotation.set(0, 0, spin);
        }
      },
      setDent(x, z, depth, r) { dent.uDent.value.set(x, z, Math.min(depth, HJ.matH * 0.8), Math.max(0.2, r)); },
    },
    sp: {
      group: sp,
      setTape(mark) {
        if (mark == null) { spTape.visible = false; return; }
        tapeTo(spTape, SP.x - SP.r, SP.x - SP.r - mark, SP.z);
      },
      setLeader(mark) {
        if (mark == null) { spLeader.visible = false; return; }
        leaderAt(spLeader, mark + SP.r, SP.half, SP.x, SP.z);
      },
    },
    jt: {
      group: jt,
      setTape(mark) {
        if (mark == null) { jtTape.visible = false; return; }
        tapeTo(jtTape, jtLine(), jtLine() - mark, JT.z);
      },
      setLeader(mark) {
        if (mark == null) { jtLeader.visible = false; return; }
        leaderAt(jtLeader, mark + JT.r, JT.half, JT.cx, JT.z);
      },
    },
    show,
    dispose() {
      hbTex?.dispose();
      spLeader.geometry.dispose();
      jtLeader.geometry.dispose();
      b.geos.forEach((g) => g.dispose());
      b.mats.forEach((m) => m.dispose());
      b.texs.forEach((t) => t.dispose());
    },
  };
}
