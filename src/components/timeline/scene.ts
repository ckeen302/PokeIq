import * as THREE from "three";
import { CSS3DObject, CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import type { LaneId } from "@/lib/timeline/types";

/**
 * The 3D time tunnel behind /pokedex/timeline. Time runs into the screen
 * (-z); each lane is a glowing track on a curved floor and every entry is a
 * card standing over its track. Cards and labels are real DOM (CSS3D), so
 * their text stays crisp and they stay clickable; the tunnel, tracks,
 * particles and warp streaks are WebGL drawn behind them with one camera.
 * Loaded only on this page, after the page has rendered.
 */

export interface SceneEntry {
  id: string;
  lane: LaneId;
  t: number;
  title: string;
  date: string;
  meta: string;
  laneLabel: string;
}
export interface SceneEra {
  start: number;
  a: string;
  b: string;
  deep: string;
  label: string;
  device: string;
  year: number;
}
export interface SceneLane {
  id: LaneId;
  color: string;
}
export interface SceneCallbacks {
  /** Every frame: the time at the focus plane and the speed of travel (years/s). */
  frame(t: number, speed: number): void;
  open(id: string): void;
  current(id: string | null): void;
  era(index: number, forward: boolean): void;
}
export interface SceneApi {
  goTo(t: number): void;
  step(dir: 1 | -1): string | null;
  stepEra(dir: 1 | -1): void;
  focus(id: string | null, panel: boolean): void;
  setLanes(lanes: Set<LaneId>): void;
  current(): string | null;
  dispose(): void;
}

const T0 = 1995.6;
const YS = 11; // world units per year
const zOf = (t: number) => -(t - T0) * YS;
const tOf = (z: number) => T0 - z / YS;
const AXIS_Y = 3;
const RING_R = 17;
const MAX_ERAS = 8;
const MAX_LANES = 6;

const hsl = (triplet: string) => {
  const [h, s, l] = triplet.match(/[\d.]+/g)!.map(Number);
  return new THREE.Color().setHSL(h / 360, s / 100, l / 100);
};
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const FADE_GLSL = `
  uniform float uCamZ;
  float fade(float z){ float d=uCamZ-z; return smoothstep(175.,60.,d)*smoothstep(-6.,4.,d); }
`;
const ERA_GLSL = `
  uniform float uEraZ[${MAX_ERAS}];
  uniform vec3 uEraA[${MAX_ERAS}];
  uniform vec3 uEraB[${MAX_ERAS}];
  uniform int uEraN;
  void eraAt(float z, out vec3 a, out vec3 b){
    a=uEraA[0]; b=uEraB[0];
    for(int i=1;i<${MAX_ERAS};i++){
      if(i>=uEraN) break;
      float k=smoothstep(uEraZ[i]+3.,uEraZ[i]-3.,z);
      a=mix(a,uEraA[i],k); b=mix(b,uEraB[i],k);
    }
  }
`;

export function createScene(host: HTMLElement, entries: SceneEntry[], eras: SceneEra[], lanes: SceneLane[], cb: SceneCallbacks, startT: number): SceneApi {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  canvas.className = "tl-gl";
  host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  THREE.ColorManagement.enabled = false;
  renderer.setClearColor(0x000000, 0);
  const css = new CSS3DRenderer();
  css.domElement.className = "tl-css";
  host.appendChild(css.domElement);

  const scene = new THREE.Scene();
  const cssScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  const disposables: { dispose(): void }[] = [renderer];

  function eraIndexAt(t: number) { let k = 0; eras.forEach((e, i) => { if (t >= e.start) k = i; }); return k; }
  const tMin = Math.min(...entries.map((e) => e.t)) - 0.4;
  const tMax = Math.max(...entries.map((e) => e.t)) + 0.3;
  // The camera trails the focus plane, so it may sit a little before the first entry.
  const camMin = tMin - 0.6;
  const zNear = zOf(tMin - 1.5), zFar = zOf(tMax + 1.5);

  // ---- shared uniforms: eras by depth, camera depth, time
  const eraZ = new Array(MAX_ERAS).fill(-1e5), eraA = Array.from({ length: MAX_ERAS }, () => new THREE.Color()), eraB = Array.from({ length: MAX_ERAS }, () => new THREE.Color());
  eras.forEach((e, i) => { eraZ[i] = i === 0 ? 1e5 : zOf(e.start); eraA[i].set(e.a); eraB[i].set(e.b); });
  const U = {
    uCamZ: { value: 0 }, uTime: { value: 0 }, uSpeed: { value: 0 },
    uEraZ: { value: eraZ }, uEraA: { value: eraA }, uEraB: { value: eraB }, uEraN: { value: eras.length },
    uLaneX: { value: new Array(MAX_LANES).fill(0) }, uLaneA: { value: new Array(MAX_LANES).fill(1) }, uLaneC: { value: lanes.map((l) => hsl(l.color)) },
    uK: { value: 0.035 }, uGlow: { value: 1 },
  };

  // ---- lane layout (re-packed when tracks are filtered)
  let portrait = false;
  const laneX = lanes.map(() => 0), laneXTarget = lanes.map(() => 0), laneY = lanes.map(() => 0), laneYTarget = lanes.map(() => 0), laneAlpha = lanes.map(() => 1), laneAlphaTarget = lanes.map(() => 1);
  let visibleLanes = new Set(lanes.map((l) => l.id));
  function layoutLanes() {
    const vis = lanes.filter((l) => visibleLanes.has(l.id));
    // Landscape: tracks side by side on a curved floor. Portrait: stacked as shelves, so the cards stay readable.
    vis.forEach((l, i) => {
      const k = lanes.indexOf(l);
      if (portrait) { laneXTarget[k] = 0; laneYTarget[k] = 0.9 + (vis.length - 1 - i) * PORTRAIT_GAP; }
      else { laneXTarget[k] = (i - (vis.length - 1) / 2) * 4.7; laneYTarget[k] = floorY(laneXTarget[k]) + 1.75; }
    });
    midTarget = portrait ? 0.9 + ((vis.length - 1) * PORTRAIT_GAP) / 2 : 1.2;
    lanes.forEach((l, i) => { laneAlphaTarget[i] = visibleLanes.has(l.id) ? 1 : 0; });
  }
  const floorY = (x: number) => U.uK.value * x * x;
  const PORTRAIT_GAP = 1.5;
  let midTarget = 1.2, mid = 1.2;

  // ---- the floor: a curved trough with a time grid, tracks and the era colour of its depth
  const floorGeo = new THREE.PlaneGeometry(44, zNear - zFar, 88, Math.ceil((zNear - zFar) / 2));
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(0, -0.25, (zNear + zFar) / 2);
  const floorMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uK; varying vec3 vP; void main(){ vec3 p=position; p.y+=uK*p.x*p.x; vP=p; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); }`,
    fragmentShader: `${FADE_GLSL}${ERA_GLSL}
      uniform float uTime; uniform float uGlow; uniform float uLaneX[${MAX_LANES}]; uniform float uLaneA[${MAX_LANES}]; uniform vec3 uLaneC[${MAX_LANES}];
      varying vec3 vP;
      float line(float v, float w){ float d=abs(fract(v-.5)-.5)/fwidth(v); return 1.-min(d/w,1.); }
      void main(){
        vec3 a,b; eraAt(vP.z,a,b);
        float yr=${T0.toFixed(2)}-vP.z/${YS.toFixed(1)};
        float year=line(yr,1.2), month=line(yr*12.,.8)*.35, col=line(vP.x/1.35,.8)*.22;
        float edge=smoothstep(22.,15.,abs(vP.x));
        vec3 c=mix(a,b,.5+.5*sin(vP.x*.12+yr*.6))*(year*.9+month*.35+col*.5)*.55;
        for(int i=0;i<${MAX_LANES};i++){
          float d=abs(vP.x-uLaneX[i]);
          c+=uLaneC[i]*uLaneA[i]*uGlow*(exp(-d*7.)*1.1+exp(-d*1.4)*.12);
          float pulse=fract(yr*.5-uTime*.12);
          c+=uLaneC[i]*uLaneA[i]*uGlow*exp(-d*9.)*smoothstep(.03,0.,abs(pulse-.5))*.9;
        }
        gl_FragColor=vec4(c*edge*fade(vP.z),1.);
      }`,
  });
  scene.add(new THREE.Mesh(floorGeo, floorMat));
  disposables.push(floorGeo, floorMat);

  // ---- year rings and era portals
  const ringMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aBright; varying vec3 vP; varying float vB; void main(){ vP=(modelMatrix*vec4(position,1.)).xyz; vB=aBright; gl_Position=projectionMatrix*viewMatrix*vec4(vP,1.); }`,
    fragmentShader: `${FADE_GLSL}${ERA_GLSL} varying vec3 vP; varying float vB;
      void main(){ vec3 a,b; eraAt(vP.z,a,b); float lo=smoothstep(-2.,${AXIS_Y.toFixed(1)}+2.,vP.y); gl_FragColor=vec4(mix(a,b,lo)*vB*fade(vP.z),1.); }`,
  });
  {
    const pts: number[] = [], bright: number[] = [];
    const seg = 96;
    const startYear = Math.ceil(tMin), endYear = Math.floor(tMax + 1);
    for (let y = startYear; y <= endYear; y++) {
      const z = zOf(y);
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        pts.push(Math.cos(a0) * RING_R, AXIS_Y + Math.sin(a0) * RING_R * 0.62, z, Math.cos(a1) * RING_R, AXIS_Y + Math.sin(a1) * RING_R * 0.62, z);
        // Brighter towards the top, dashed every few segments.
        const dash = i % 8 < 6 ? 1 : 0.15;
        bright.push(0.38 * dash, 0.38 * dash);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute("aBright", new THREE.Float32BufferAttribute(bright, 1));
    scene.add(new THREE.LineSegments(g, ringMat));
    disposables.push(g, ringMat);
  }
  // Era portals: thick glowing ellipses at the first day of each era.
  const portalMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uZ: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv=uv; vP=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vP,1.); }`,
    fragmentShader: `${FADE_GLSL} uniform float uTime; varying vec2 vUv; varying vec3 vP; uniform vec3 uColA; uniform vec3 uColB;
      void main(){ float r=abs(vUv.y-.5)*2.; float core=exp(-r*r*18.); float halo=exp(-r*3.)*.35;
        float sweep=.6+.4*sin(vUv.x*6.2831*3.-uTime*1.6);
        vec3 c=mix(uColA,uColB,.5+.5*sin(vUv.x*6.2831+uTime*.4))*(core*1.6+halo)*sweep;
        gl_FragColor=vec4(c*fade(vP.z),1.); }`,
  });
  const portals: THREE.Mesh[] = [];
  eras.forEach((e, i) => {
    if (i === 0) return;
    const shape = new THREE.EllipseCurve(0, 0, RING_R + 0.4, (RING_R + 0.4) * 0.62, 0, Math.PI * 2);
    const path = new THREE.CatmullRomCurve3(shape.getPoints(160).map((p) => new THREE.Vector3(p.x, p.y + AXIS_Y, 0)), true);
    const geo = new THREE.TubeGeometry(path, 240, 0.55, 6, true);
    const mat = portalMat.clone();
    mat.uniforms = { ...U, uColA: { value: new THREE.Color(e.a) }, uColB: { value: new THREE.Color(e.b) } };
    const m = new THREE.Mesh(geo, mat);
    m.position.z = zOf(e.start);
    scene.add(m);
    portals.push(m);
    disposables.push(geo, mat);
  });
  disposables.push(portalMat);

  // ---- particles drifting through the tunnel, coloured by era
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const N = reduce ? 0 : small ? 1600 : 4200;
  const ptGeo = new THREE.BufferGeometry();
  {
    const p = new Float32Array(N * 3), s = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.pow(Math.random(), 0.6) * 30;
      p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = AXIS_Y + Math.sin(a) * r * 0.7; p[i * 3 + 2] = zFar + Math.random() * (zNear - zFar);
      s[i] = 0.4 + Math.random() * Math.random() * 2.2;
    }
    ptGeo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    ptGeo.setAttribute("aSize", new THREE.BufferAttribute(s, 1));
  }
  const ptMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uPx: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `${FADE_GLSL}${ERA_GLSL} uniform float uTime; uniform float uPx; attribute float aSize; varying vec3 vC; varying float vA;
      void main(){ vec3 p=position; p.x+=sin(uTime*.3+p.z*.05)*.6; p.y+=cos(uTime*.25+p.z*.07)*.4;
        vec3 a,b; eraAt(p.z,a,b); vC=mix(a,b,fract(aSize*7.3)); vA=fade(p.z)*(.55+.45*sin(uTime*2.+p.z));
        vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize=aSize*uPx*90./-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d=gl_PointCoord-.5; float r=dot(d,d)*4.; gl_FragColor=vec4(vC*exp(-r*3.5)*vA,1.); }`,
  });
  if (N) scene.add(new THREE.Points(ptGeo, ptMat));
  disposables.push(ptGeo, ptMat);

  // ---- warp streaks: only visible at speed
  const M = reduce ? 0 : small ? 160 : 420;
  const stGeo = new THREE.BufferGeometry();
  {
    const p = new Float32Array(M * 6), e = new Float32Array(M * 2);
    for (let i = 0; i < M; i++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 26, z = Math.random() * 160;
      for (let k = 0; k < 2; k++) { p[i * 6 + k * 3] = Math.cos(a) * r; p[i * 6 + k * 3 + 1] = AXIS_Y + Math.sin(a) * r * 0.66; p[i * 6 + k * 3 + 2] = z; e[i * 2 + k] = k; }
    }
    stGeo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    stGeo.setAttribute("aEnd", new THREE.BufferAttribute(e, 1));
  }
  const stMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `${ERA_GLSL} uniform float uCamZ; uniform float uSpeed; attribute float aEnd; varying vec3 vC; varying float vA;
      void main(){ vec3 p=position; float z=uCamZ-mod(uCamZ-p.z+1e4,150.)+6.; p.z=z+aEnd*clamp(uSpeed*.9,0.,18.)*sign(uSpeed+.0001);
        vec3 a,b; eraAt(z,a,b); vC=mix(a,b,aEnd); vA=clamp(abs(uSpeed)*.18-.05,0.,1.)*smoothstep(150.,90.,uCamZ-z)*(1.-aEnd*.7);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ gl_FragColor=vec4(vC*vA,1.); }`,
  });
  if (M) scene.add(new THREE.LineSegments(stGeo, stMat));
  disposables.push(stGeo, stMat);

  // ---- entry beams + nodes (one object per lane so a filter can fade its track)
  const laneObjs = lanes.map((l) => {
    const mine = entries.filter((e) => e.lane === l.id);
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mine.length * 6), 3));
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mine.length * 3), 3));
    const color = hsl(l.color);
    const beamMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    const nodeMat = new THREE.ShaderMaterial({
      uniforms: { ...U, uColor: { value: color }, uA: { value: 1 }, uPx: ptMat.uniforms.uPx },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `${FADE_GLSL} uniform float uPx; uniform float uTime; varying float vA; void main(){ vA=fade(position.z)*(.75+.25*sin(uTime*3.+position.z)); vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=uPx*420./-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uA; varying float vA; void main(){ vec2 d=gl_PointCoord-.5; float r=length(d)*2.; float g=exp(-r*r*9.)+exp(-r*3.)*.25; float ring=smoothstep(.06,0.,abs(r-.55))*.6; gl_FragColor=vec4(uColor*(g+ring)*vA*uA,1.); }`,
    });
    const beams = new THREE.LineSegments(beamGeo, beamMat), nodes = new THREE.Points(nodeGeo, nodeMat);
    scene.add(beams, nodes);
    disposables.push(beamGeo, nodeGeo, beamMat, nodeMat);
    return { entries: mine, beamGeo, nodeGeo, beamMat, nodeMat };
  });
  scene.fog = new THREE.Fog(0x000000, 50, 170);

  // ---- cards (CSS3D)
  const stackOf = new Map<string, number>();
  for (const l of lanes) {
    let lastT = -1e9, level = 0;
    for (const e of entries.filter((x) => x.lane === l.id)) {
      level = e.t - lastT < 0.42 ? (level + 1) % 3 : 0;
      stackOf.set(e.id, level);
      lastT = e.t;
    }
  }
  type Card = { e: SceneEntry; obj: CSS3DObject; el: HTMLElement; lane: number; level: number; shown: boolean; op: number };
  const cards: Card[] = entries.map((e) => {
    const el = document.createElement("div");
    el.className = "tl-card";
    el.dataset.entry = e.id;
    el.dataset.lane = e.lane;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `${e.title}, ${e.date}`);
    el.style.setProperty("--lane", lanes.find((l) => l.id === e.lane)!.color);
    el.innerHTML = `<span class="tl-card-top"><span class="tl-card-lane">${esc(e.laneLabel)}</span><span class="tl-card-date">${esc(e.date)}</span></span><span class="tl-card-title">${esc(e.title)}</span><span class="tl-card-meta">${esc(e.meta)}</span>`;
    const obj = new CSS3DObject(el);
    obj.visible = false;
    cssScene.add(obj);
    return { e, obj, el, lane: lanes.findIndex((l) => l.id === e.lane), level: stackOf.get(e.id) ?? 0, shown: false, op: -1 };
  });
  const cardScale = () => (portrait ? 0.0074 : 0.0088);
  const cardY = (c: Card) => laneY[c.lane] + (portrait ? 0 : c.level * 1.95);
  const cardX = (c: Card) => laneX[c.lane] + (portrait && c.level ? (c.level % 2 ? 1 : -1) * 0.9 : 0);

  // Year labels on the floor, and era titles over each portal.
  const eraSigns: CSS3DObject[] = [];
  type Label = { obj: CSS3DObject; el: HTMLElement; z: number; shown: boolean; kind: "year" | "era" };
  const labels: Label[] = [];
  for (let y = Math.ceil(tMin); y <= Math.floor(tMax); y++) {
    const el = document.createElement("div");
    el.className = "tl-year";
    el.textContent = String(y);
    el.style.setProperty("--year-c", eras[eraIndexAt(y + 0.5)]?.a ?? "#fff");
    const obj = new CSS3DObject(el);
    obj.visible = false;
    obj.rotation.x = -Math.PI / 2;
    obj.position.set(0, -0.2, zOf(y) - 1.2);
    obj.scale.setScalar(0.016);
    cssScene.add(obj);
    labels.push({ obj, el, z: obj.position.z, shown: false, kind: "year" });
  }
  eras.forEach((e) => {
    const el = document.createElement("div");
    el.className = "tl-era";
    el.style.setProperty("--a", e.a);
    el.style.setProperty("--b", e.b);
    el.innerHTML = `<span class="tl-era-k">${esc(String(e.year))} · ${esc(e.device)}</span><span class="tl-era-t">${esc(e.label)}</span>`;
    const obj = new CSS3DObject(el);
    obj.visible = false;
    obj.position.set(0, AXIS_Y + RING_R * 0.62 - 2.2, zOf(e.start));
    eraSigns.push(obj);
    obj.scale.setScalar(0.02);
    cssScene.add(obj);
    labels.push({ obj, el, z: obj.position.z, shown: false, kind: "era" });
  });

  function placeLaneObjects() {
    laneObjs.forEach((lo) => {
      const bp = lo.beamGeo.attributes.position as THREE.BufferAttribute, np = lo.nodeGeo.attributes.position as THREE.BufferAttribute;
      lo.entries.forEach((e, i) => {
        const c = cards.find((x) => x.e === e)!;
        const x = cardX(c), fy = floorY(x), z = zOf(e.t);
        bp.setXYZ(i * 2, x, fy, z); bp.setXYZ(i * 2 + 1, x, cardY(c) - (portrait ? 0.5 : 0.8), z);
        np.setXYZ(i, x, fy + 0.02, z);
      });
      bp.needsUpdate = true; np.needsUpdate = true;
      lo.beamGeo.computeBoundingSphere(); lo.nodeGeo.computeBoundingSphere();
    });
  }

  // ---- camera state
  let tTarget = Math.min(tMax, Math.max(tMin, startT)), tCur = tTarget - (reduce ? 0 : 1.2), vel = 0;
  let focusId: string | null = null, panel = false;
  let fx = 0, fy = 0, px = 0, py = 0, mx = 0, my = 0, fovKick = 0, lastEra = -1, lastCurrent: string | null = null;
  const camBack = () => (portrait ? 12 : 11);
  // The focus plane is 7 units in front of the camera; the camera sits at an earlier moment than it.
  const focusOffset = () => -(camBack() - 7) / YS;
  const clampT = (t: number) => Math.min(tMax, Math.max(camMin, t));
  const visibleSorted = () => cards.filter((c) => visibleLanes.has(c.e.lane)).sort((a, b) => a.e.t - b.e.t);

  function nearest(t: number) {
    let best: Card | null = null, bd = 1e9;
    for (const c of cards) {
      if (!visibleLanes.has(c.e.lane)) continue;
      const d = Math.abs(c.e.t - t);
      if (d < bd) { bd = d; best = c; }
    }
    return best && bd < 0.9 ? best : null;
  }

  // ---- input
  const pointers = new Map<number, { x: number; y: number }>();
  let down: { x: number; y: number; card: string | null } | null = null, lastMove = 0, moved = 0;
  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest(".tl-ui")) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const card = (e.target as HTMLElement).closest?.(".tl-card") as HTMLElement | null;
    down = { x: e.clientX, y: e.clientY, card: card?.dataset.entry ?? null }; moved = 0; vel = 0;
    host.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    mx = (e.clientX / window.innerWidth) * 2 - 1; my = (e.clientY / window.innerHeight) * 2 - 1;
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    // Drag up or left to travel forward in time.
    const k = (portrait ? 0.012 : 0.0065);
    const d = (-dx - dy * 1.4) * k;
    tTarget = clampT(tTarget + d);
    const now = performance.now();
    vel = d / Math.max(0.008, (now - lastMove) / 1000) * 0.5 + vel * 0.5;
    lastMove = now;
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (!down) return;
    const quick = performance.now() - lastMove > 90;
    if (moved < 7) {
      if (down.card) cb.open(down.card);
      vel = 0;
    } else if (quick) vel = 0;
    down = null;
  };
  const onWheel = (e: WheelEvent) => {
    if ((e.target as HTMLElement).closest(".tl-ui")) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const d = (e.deltaY + e.deltaX) * unit;
    tTarget = clampT(tTarget + Math.sign(d) * Math.min(Math.abs(d), 240) * 0.0032);
    vel = 0;
  };
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);
  host.addEventListener("wheel", onWheel, { passive: false });

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    const wasPortrait = portrait;
    portrait = w / h < 0.85;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, portrait ? 1.5 : 2));
    renderer.setSize(w, h, false);
    css.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    ptMat.uniforms.uPx.value = renderer.getPixelRatio() * (h / 900);
    U.uK.value = portrait ? 0.02 : 0.035;
    U.uGlow.value = portrait ? 0.16 : 1;
    for (const c of cards) c.obj.scale.setScalar(cardScale());
    for (const o of eraSigns) { o.position.y = portrait ? 9 : AXIS_Y + RING_R * 0.62 - 2.2; o.scale.setScalar(portrait ? 0.014 : 0.02); }
    if (wasPortrait !== portrait || !laneY.some(Boolean)) {
      layoutLanes();
      laneXTarget.forEach((x, i) => (laneX[i] = x));
      laneYTarget.forEach((y, i) => (laneY[i] = y));
      mid = midTarget;
    }
    placeLaneObjects();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  // Start with the requested moment on the focus plane, gliding in from a little before it.
  tTarget = clampT(startT - focusOffset());
  tCur = tTarget - (reduce ? 0 : 1.2);

  // ---- frame loop
  const clock = new THREE.Clock();
  let raf = 0, dead = false, lanesMoving = true;
  const look = new THREE.Vector3();
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    U.uTime.value += dt;
    if (!pointers.size && Math.abs(vel) > 0.01) { tTarget = clampT(tTarget + vel * dt); vel *= Math.exp(-3.2 * dt); }
    const before = tCur;
    tCur = reduce ? tTarget : damp(tCur, tTarget, 4.2, dt);
    const speed = (tCur - before) / Math.max(dt, 1e-4);
    U.uSpeed.value = damp(U.uSpeed.value, speed * YS * 0.12, 6, dt);

    // Lanes glide to their new places when tracks are filtered.
    lanesMoving = false;
    lanes.forEach((_, i) => {
      const nx = damp(laneX[i], laneXTarget[i], 5, dt), ny = damp(laneY[i], laneYTarget[i], 5, dt), na = damp(laneAlpha[i], laneAlphaTarget[i], 6, dt);
      if (Math.abs(nx - laneX[i]) > 1e-3 || Math.abs(ny - laneY[i]) > 1e-3 || Math.abs(na - laneAlpha[i]) > 1e-3) lanesMoving = true;
      laneX[i] = nx; laneY[i] = ny; laneAlpha[i] = na;
      U.uLaneX.value[i] = nx; U.uLaneA.value[i] = na;
      // On a phone every track runs down the middle, so each one glows less.
      laneObjs[i].beamMat.opacity = (portrait ? 0.3 : 0.55) * na;
      laneObjs[i].nodeMat.uniforms.uA.value = (portrait ? 0.35 : 1) * na;
    });
    if (lanesMoving) placeLaneObjects();

    // Camera: glide to the focus plane, lean towards an opened card, a little mouse parallax.
    const focusCard = focusId ? cards.find((c) => c.e.id === focusId) : null;
    mid = damp(mid, midTarget, 4, dt);
    fx = damp(fx, focusCard ? cardX(focusCard) * (portrait ? 0.8 : 0.62) : 0, 3, dt);
    fy = damp(fy, focusCard ? (cardY(focusCard) - (portrait ? mid : 2)) * 0.55 : 0, 3, dt);
    px = damp(px, reduce ? 0 : mx * 0.9, 2.5, dt);
    py = damp(py, reduce ? 0 : -my * 0.45, 2.5, dt);
    fovKick = damp(fovKick, 0, 2.2, dt);
    const camZ = zOf(tCur) + camBack();
    const camY = portrait ? mid + 0.5 : AXIS_Y + 0.4;
    camera.position.set(fx + px, camY + fy + py, camZ);
    const shift = panel && !portrait ? 2.6 : 0;
    // With the phone's bottom sheet open, look lower so the card sits in the space above it.
    look.set(fx * 0.85 + shift + px * 0.3, (portrait ? mid - 0.2 : 1.2) + fy * 1.1 - (panel && portrait ? 4 : 0), camZ - 20);
    camera.lookAt(look);
    camera.rotateZ(-px * 0.012);
    const baseFov = portrait ? 68 : 55;
    camera.fov = baseFov + fovKick + Math.min(Math.abs(U.uSpeed.value) * 0.35, 9);
    camera.updateProjectionMatrix();
    U.uCamZ.value = camZ;

    // Cards: place, cull and fade by depth.
    for (const c of cards) {
      const z = zOf(c.e.t);
      const d = camZ - z;
      const la = laneAlpha[c.lane];
      const inRange = d > 1.5 && d < 165 && la > 0.02;
      if (inRange !== c.shown) { c.obj.visible = inRange; c.shown = inRange; c.op = -1; }
      if (!inRange) continue;
      const x = cardX(c);
      c.obj.position.set(x, cardY(c), z);
      c.obj.rotation.y = portrait ? 0 : -x * 0.028;
      // Outer tracks pass close to the screen edges (and the overlays), so their cards fade out sooner.
      const near = portrait ? (d - 4) / 2.5 : Math.abs(x) > 6 ? (d - 10) / 5 : (d - 1.5) / 3.5;
      const op = Math.min(1, (165 - d) / 70) * Math.max(0, Math.min(1, near)) * la;
      if (Math.abs(op - c.op) > 0.015) { c.el.style.opacity = op.toFixed(3); c.op = op; c.el.style.pointerEvents = op > 0.3 ? "auto" : "none"; }
    }
    for (const l of labels) {
      const d = camZ - l.z;
      const inRange = d > (l.kind === "era" ? 2 : 0) && d < 150;
      if (inRange !== l.shown) { l.obj.visible = inRange; l.shown = inRange; }
      if (inRange) l.el.style.opacity = (l.kind === "era" ? Math.min(1, (125 - d) / 55) * Math.min(1, Math.max(0, (d - (portrait ? 34 : 28)) / 24)) : Math.min(1, (150 - d) / 60) * Math.min(1, d / 6)).toFixed(3);
    }

    const ft = tCur + focusOffset();
    const ei = eraIndexAt(ft);
    if (ei !== lastEra) {
      if (lastEra >= 0) { cb.era(ei, ei > lastEra); if (!reduce) fovKick = 9; }
      else cb.era(ei, true);
      lastEra = ei;
    }
    const cur = focusId ?? nearest(ft)?.e.id ?? null;
    if (cur !== lastCurrent) {
      if (lastCurrent) cards.find((c) => c.e.id === lastCurrent)?.el.classList.remove("is-current");
      if (cur) cards.find((c) => c.e.id === cur)?.el.classList.add("is-current");
      lastCurrent = cur;
      cb.current(cur);
    }
    cb.frame(ft, speed);
    renderer.render(scene, camera);
    css.render(cssScene, camera);
  }
  const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden && !dead) { clock.getDelta(); frame(); } };
  document.addEventListener("visibilitychange", onVis);
  frame();

  const goTo = (t: number) => { tTarget = clampT(t); vel = 0; };
  return {
    goTo(t) { goTo(t - focusOffset()); },
    step(dir) {
      const list = visibleSorted();
      if (!list.length) return null;
      const ft = tCur + focusOffset();
      let i = lastCurrent ? list.findIndex((c) => c.e.id === lastCurrent) : -1;
      if (i < 0) i = dir > 0 ? list.findIndex((c) => c.e.t > ft) - 1 : list.findIndex((c) => c.e.t >= ft);
      const next = list[Math.min(list.length - 1, Math.max(0, i + dir))];
      goTo(next.e.t - focusOffset());
      if (!focusId) {
        if (lastCurrent) cards.find((c) => c.e.id === lastCurrent)?.el.classList.remove("is-current");
        next.el.classList.add("is-current");
        lastCurrent = next.e.id;
        cb.current(next.e.id);
      }
      return next.e.id;
    },
    stepEra(dir) {
      const ft = tCur + focusOffset();
      const i = Math.min(eras.length - 1, Math.max(0, eraIndexAt(ft + 0.05) + dir));
      goTo(eras[i].start + 0.05 - focusOffset());
    },
    focus(id, withPanel) {
      focusId = id;
      panel = withPanel;
      const c = id ? cards.find((x) => x.e.id === id) : null;
      if (c) goTo(c.e.t - focusOffset());
    },
    setLanes(set) { visibleLanes = new Set(set); layoutLanes(); },
    current: () => lastCurrent,
    dispose() {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("wheel", onWheel);
      disposables.forEach((d) => d.dispose());
      renderer.forceContextLoss();
      canvas.remove();
      css.domElement.remove();
    },
  };
}

export { tOf, zOf };
