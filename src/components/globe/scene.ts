import * as THREE from "three";
import { latOf, lonOf, type Atlas } from "@/lib/globe/geo";
import { atlasMountains, type GlobeMountain } from "@/lib/globe/mountains";
import { eraVisibility, LAST_GEN, regionGeneration } from "@/lib/globe/era";

/**
 * The world globe's three.js scene: the holographic world (the atlas mask),
 * its atmosphere, stars, a moving day/night line with towns lighting up at
 * night, drifting clouds, sun glint on the sea, mountains raised at their
 * atlas pins, three legendaries in orbit, the era filter (regions fade in by
 * generation, on the GPU from public/geo/maps/globe-gens.png), the labels
 * (DOM, laid out each frame with collision avoidance) and every pointer
 * interaction. The React shell (WorldGlobe.tsx) owns the HUD and cards.
 *
 * Adaptive quality, as on the timeline: the frame time is watched and the
 * scene steps down (pixel ratio, stars, clouds, mountain detail, the
 * legendaries) when frames run slow, and back up after a long fast run.
 */

export type LabelKind = "region" | "city" | "place";
export interface HoverInfo {
  key: string;
  name: string;
  region: string;
  kind: LabelKind;
}
export interface SceneCallbacks {
  ready(counts: { r: number; c: number; p: number }): void;
  failed(): void;
  stats(s: { lon: string; lat: string; zoom: string; tier: string; focus: string }): void;
  /** A label with pictures is hovered (or tapped: pinned), or nothing is. */
  hover(h: HoverInfo | null, pinned: boolean): void;
  /** Where the hovered label is on screen, every frame it is. */
  anchor(x: number, y: number, w: number, h: number, visible: boolean): void;
  /** The pointer is closing in on a label: preload its picture. */
  intent(key: string): void;
  /** A region was chosen (its card opens), or null. */
  region(name: string | null): void;
  /** The camera set off on a flight. */
  fly(): void;
  auto(on: boolean): void;
  quality(q: number, ft: number): void;
  introDone(): void;
  /** The first time the pointer moves over the globe. */
  firstPointer(): void;
}
export interface SceneOptions {
  intro: boolean;
  /** Pins the quality level (0–3); null lets the frame-time monitor choose. */
  quality: number | null;
  era: number;
}
export interface SceneApi {
  next(): void;
  out(): void;
  setAuto(v: boolean): void;
  setEra(gen: number): void;
  flyToRegion(name: string): void;
  /** The label keys that have pictures. */
  setShots(keys: ReadonlySet<string>): void;
  /** Moves the globe on screen (px; negative x = left, negative y = up) to make room for a card. */
  setShift(x: number, y: number): void;
  /** Keeps a label's popup open (the pointer moved onto it). */
  pin(key: string): void;
  unpin(): void;
  skipIntro(): void;
  dispose(): void;
}

type Label = {
  n: string;
  region: string;
  key: string;
  lon: number;
  lat: number;
  kind: LabelKind;
  peak: boolean;
  pri: number;
  min: number;
  v: THREE.Vector3;
  el: HTMLDivElement | null;
  w: number;
  h: number;
  gen: number | null;
  box: [number, number, number, number] | null;
};

const QUALITY = [
  { pr: 0.75, stars: 0, clouds: false, legends: false, peaks: 0 },
  { pr: 1, stars: 0.35, clouds: false, legends: true, peaks: 1 },
  { pr: 1.5, stars: 0.7, clouds: true, legends: true, peaks: 2 },
  { pr: 2, stars: 1, clouds: true, legends: true, peaks: 2 },
] as const;
const PEAK_DETAIL = [
  { rings: 3, segs: 7 },
  { rings: 4, segs: 9 },
  { rings: 5, segs: 12 },
] as const;
const FRAME_BUDGET_MS = 1000 / 60;
const STAR_COUNT = 2600;
const R = 1;
const INTRO_S = 3.8;
const INTRO_FROM = 26;

/** Official artwork (the Pokédex's /api/art proxy) and which way each one faces in it. */
const LEGENDS = [
  { id: 384, name: "Rayquaza", faces: -1, size: 0.46, r: 1.95, tilt: 0.42, yaw: 0.3, period: 95, phase: 0.6, local: false },
  { id: 250, name: "Ho-Oh", faces: 1, size: 0.3, r: 1.5, tilt: -0.55, yaw: 1.9, period: 70, phase: 2.4, local: false },
  { id: 249, name: "Lugia", faces: -1, size: 0.26, r: 1.085, tilt: 0, yaw: 0, period: 120, phase: 4.1, local: true },
] as const;

const toVec = (lon: number, lat: number, r = R, out = new THREE.Vector3()) => {
  const phi = ((90 - lat) * Math.PI) / 180, th = ((lon + 180) * Math.PI) / 180;
  return out.set(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
};
const smooth = (a: number, b: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** "248 40% 97%" token -> three Color, bypassing colour management so it matches the CSS exactly. */
function tokenColor(name: string, out: THREE.Color) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const [h, s, l] = raw.match(/-?[\d.]+/g)?.map(Number) ?? [0, 0, 50];
  return out.setHSL(h / 360, s / 100, l / 100);
}

const NOISE = `
float hash(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s; }
`;

export function createGlobeScene(host: HTMLElement, layer: HTMLDivElement, cb: SceneCallbacks, opts: SceneOptions): SceneApi | null {
  const canvas = document.createElement("canvas");
  canvas.className = "absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing";
  canvas.setAttribute("aria-label", "Interactive 3D globe of the Pokémon world. Drag to spin, scroll or pinch to zoom, hover or tap a town to see it.");
  host.insertBefore(canvas, layer);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    canvas.remove();
    return null;
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dead = false;
  let raf = 0;
  const disposables: { dispose(): void }[] = [];
  THREE.ColorManagement.enabled = false;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  const globe = new THREE.Group();
  scene.add(globe);

  // ---- the world
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const tex = new THREE.TextureLoader().load("/geo/maps/globe-mask.png", (t) => sampleOcean(t.image as HTMLImageElement));
  tex.anisotropy = maxAniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  disposables.push(tex);
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  blank.needsUpdate = true;
  disposables.push(blank);

  const sunObj = new THREE.Vector3(1, 0, 0), sunWorld = new THREE.Vector3(), camObj = new THREE.Vector3();
  const C = () => new THREE.Color();
  const U = {
    map: { value: tex }, gens: { value: blank as THREE.Texture }, hasGens: { value: 0 }, era: { value: LAST_GEN },
    time: { value: 0 }, land: { value: C() }, coast: { value: C() }, grid: { value: C() }, rim: { value: C() }, sea: { value: C() },
    spec: { value: C() }, dusk: { value: new THREE.Color(1, 0.62, 0.36) }, nightTint: { value: new THREE.Color(0.72, 0.78, 1.15) },
    nightLevel: { value: 0.34 }, light: { value: 0 }, uSun: { value: sunObj }, uCam: { value: camObj },
  };
  const holo = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `varying vec2 vUv; varying vec3 vP;
      void main(){ vUv=uv; vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D map; uniform sampler2D gens; uniform float hasGens; uniform float era; uniform float time;
      uniform vec3 land; uniform vec3 coast; uniform vec3 grid; uniform vec3 rim; uniform vec3 sea; uniform vec3 spec; uniform vec3 dusk; uniform vec3 nightTint;
      uniform float nightLevel; uniform float light; uniform vec3 uSun; uniform vec3 uCam;
      varying vec2 vUv; varying vec3 vP;
      ${NOISE}
      float gridf(vec2 uv, vec2 n){ vec2 g=abs(fract(uv*n-.5)-.5)/fwidth(uv*n); return 1.-min(min(g.x,g.y),1.); }
      void main(){
        vec3 N=normalize(vP); vec3 V=normalize(uCam-vP);
        float m=texture2D(map,vUv).r;
        float gen=texture2D(gens,vUv).r*255./25.;
        float vis=hasGens>.5 ? clamp(era-gen+1.,0.,1.) : 1.;
        float l0=step(.04,m), c0=smoothstep(.85,1.,m);
        float l=l0*vis, c=c0*vis;
        float g=gridf(vUv, vec2(36.,18.))*(1.-l*.6);
        float f=pow(1.-max(dot(N,V),0.),2.2);
        float band=.96+.04*sin(vUv.y*900.+time*2.);
        vec3 col=sea;
        col=mix(col, land*(.55+.75*m)*band, l*.92);
        col=mix(col, coast, c*.9);
        col=mix(col, land, l0*(1.-vis)*.09);
        col=mix(col, grid, g*.35);
        float ndl=dot(N,uSun);
        float day=smoothstep(-.1,.22,ndl);
        vec3 H=normalize(uSun+V); float nh=max(dot(N,H),0.);
        float w=vnoise(vP*38.+vec3(time*.25,time*.18,0.));
        col+=spec*(pow(nh,90.)*(.3+.9*w*w)*.55+pow(nh,10.)*.04)*(1.-l0)*day;
        col*=mix(nightLevel,1.,day);
        col=mix(col,col*nightTint,(1.-day)*.75);
        col+=dusk*exp(-pow((ndl-.03)/.06,2.))*(light>.5?.025:.05)*(.35+.65*l);
        col+=rim*f*(light>.5?.35:.9)*mix(.4,1.,day);
        gl_FragColor=vec4(col,1.);
      }`,
  });
  const sphereGeo = new THREE.SphereGeometry(R, 160, 80);
  const sphere = new THREE.Mesh(sphereGeo, holo);
  globe.add(sphere);
  disposables.push(holo, sphereGeo);

  // ---- atmosphere: a rim of light around the limb, brighter on the day side
  const haloU = { color: { value: C() }, dusk: { value: new THREE.Color(1, 0.55, 0.4) }, strength: { value: 1 }, uSunV: { value: new THREE.Vector3() } };
  const haloMat = new THREE.ShaderMaterial({
    uniforms: haloU, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    vertexShader: `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 color; uniform vec3 dusk; uniform float strength; uniform vec3 uSunV; varying vec3 vN;
      void main(){
        float i=pow(max(.72-dot(vN,vec3(0,0,1.)),0.),2.4)*strength;
        float s=dot(vN,uSunV);
        float lit=.35+.85*smoothstep(-.45,.55,s);
        vec3 c=mix(color,dusk,exp(-pow(s/.28,2.))*.45);
        float k=i*lit; gl_FragColor=vec4(c*k,min(1.,k*.8));
      }`,
  });
  const haloGeo = new THREE.SphereGeometry(R * 1.17, 64, 32);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.renderOrder = 4;
  scene.add(halo);
  const ringMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3 });
  disposables.push(haloMat, haloGeo, ringMat);
  [[1.32, 0.45], [1.46, -0.3]].forEach(([r, tilt]) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) { const a = (i / 160) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    disposables.push(geo);
    const ring = new THREE.LineLoop(geo, ringMat);
    ring.rotation.x = Math.PI / 2 + tilt; ring.rotation.z = tilt;
    scene.add(ring);
  });

  // ---- stars: a sphere of points, a third of them in a faint band
  const starGeo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(STAR_COUNT * 3), size = new Float32Array(STAR_COUNT), seed = new Float32Array(STAR_COUNT), tint = new Float32Array(STAR_COUNT);
    const band = new THREE.Vector3(0.3, 1, 0.2).normalize(), v = new THREE.Vector3();
    for (let i = 0; i < STAR_COUNT; i++) {
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (v.lengthSq() > 1 || v.lengthSq() < 1e-4) { i--; continue; }
      v.normalize();
      if (i % 3 === 0) v.addScaledVector(band, -v.dot(band) * 0.88).normalize();
      v.multiplyScalar(60 + Math.random() * 30);
      pos.set([v.x, v.y, v.z], i * 3);
      const big = Math.random();
      size[i] = big > 0.985 ? 3.2 : big > 0.9 ? 2.1 : 0.8 + Math.random() * 0.9;
      seed[i] = Math.random();
      tint[i] = Math.random();
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    starGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    starGeo.setAttribute("aTint", new THREE.BufferAttribute(tint, 1));
  }
  const starU = { uTime: { value: 0 }, uPx: { value: 1 }, uFade: { value: 1 } };
  const starMat = new THREE.ShaderMaterial({
    uniforms: starU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    vertexShader: `attribute float aSize; attribute float aSeed; attribute float aTint; uniform float uTime; uniform float uPx; varying float vA; varying float vT;
      void main(){ vT=aTint; vA=.55+.45*sin(uTime*(.6+aSeed*1.8)+aSeed*60.); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize=aSize*uPx; }`,
    fragmentShader: `uniform float uFade; varying float vA; varying float vT;
      void main(){ float d=length(gl_PointCoord-.5)*2.; float a=smoothstep(1.,0.,d); a*=a;
        vec3 c=mix(vec3(.78,.82,1.),vec3(1.,.92,.82),vT); if(vT<.2) c=vec3(.86,.78,1.);
        float k=a*vA*uFade; gl_FragColor=vec4(c*k,k); }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -1;
  scene.add(stars);
  disposables.push(starGeo, starMat);

  // ---- clouds: drifting fbm streaks on a shell just above the world
  const cloudU = { uTime: { value: 0 }, uSun: { value: new THREE.Vector3() }, uFade: { value: 1 }, uDay: { value: C() }, uNight: { value: C() }, uAmt: { value: 0.34 } };
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudU, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSun; uniform float uFade; uniform vec3 uDay; uniform vec3 uNight; uniform float uAmt; varying vec3 vP;
      ${NOISE}
      void main(){
        vec3 p=normalize(vP);
        vec3 q=p*vec3(2.1,4.6,2.1);
        float w=fbm(q*.9+vec3(uTime*.012,0.,uTime*.008));
        float n=fbm(q*1.6+w*1.4+vec3(-uTime*.02,0.,uTime*.01));
        float a=smoothstep(.54,.78,n)*uAmt;
        float lit=smoothstep(-.18,.3,dot(p,uSun));
        a*=mix(.12,1.,lit)*uFade*(1.-smoothstep(.72,.98,abs(p.y)));
        if(a<.004) discard;
        gl_FragColor=vec4(mix(uNight,uDay,lit),a);
      }`,
  });
  const cloudGeo = new THREE.SphereGeometry(R * 1.016, 96, 48);
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  clouds.renderOrder = 3;
  globe.add(clouds);
  disposables.push(cloudMat, cloudGeo);

  // ---- city lights: every town and city glows warm on the night side
  const lightMat = new THREE.ShaderMaterial({
    uniforms: { uSun: U.uSun, uCam: U.uCam, uEra: U.era, uTime: { value: 0 }, uPx: { value: 1 }, uColor: { value: new THREE.Color(1, 0.78, 0.42) }, uFade: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    vertexShader: `attribute float aSize; attribute float aGen; attribute float aSeed; uniform vec3 uSun; uniform vec3 uCam; uniform float uEra; uniform float uTime; uniform float uPx; uniform float uFade; varying float vA;
      void main(){ vec3 n=normalize(position);
        float night=smoothstep(.04,-.2,dot(n,uSun));
        float vis=clamp(uEra-aGen+1.,0.,1.);
        float facing=dot(n,normalize(uCam-position));
        vA=night*vis*smoothstep(.0,.3,facing)*(.82+.18*sin(uTime*(1.3+aSeed)+aSeed*50.))*uFade;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
        gl_PointSize=vA>.003 ? aSize*uPx : 0.; }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d=length(gl_PointCoord-.5)*2.; float core=smoothstep(.32,0.,d); float glow=pow(max(1.-d,0.),2.2)*.6;
        gl_FragColor=vec4((uColor*glow+vec3(1.,.95,.85)*core)*vA,(glow+core)*vA); }`,
  });
  const lightGeo = new THREE.BufferGeometry();
  const cityLights = new THREE.Points(lightGeo, lightMat);
  cityLights.renderOrder = 2;
  globe.add(cityLights);
  disposables.push(lightMat, lightGeo);

  // ---- mountains: low-poly peaks raised at their atlas pins, snow on the great ones, a glowing crater on the volcanoes
  const peakU = { uSun: U.uSun, uEra: U.era, uLand: { value: C() }, uSnow: { value: C() }, nightLevel: U.nightLevel, uHot: { value: new THREE.Color(1, 0.45, 0.15) } };
  const peakMat = new THREE.ShaderMaterial({
    uniforms: peakU,
    vertexShader: `attribute float aGen; attribute float aH; attribute float aSnow; varying vec3 vN; varying vec3 vP; varying float vH; varying float vVis; varying float vSnow; uniform float uEra;
      void main(){ vVis=clamp(uEra-aGen+1.,0.,1.); vN=normal; vH=aH; vSnow=aSnow;
        vec3 b=normalize(position); float h=length(position)-1.; vec3 p=b*(1.+h*vVis); vP=p;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); }`,
    fragmentShader: `uniform vec3 uSun; uniform vec3 uLand; uniform vec3 uSnow; uniform vec3 uHot; uniform float nightLevel;
      varying vec3 vN; varying vec3 vP; varying float vH; varying float vVis; varying float vSnow;
      void main(){ if(vVis<.02) discard;
        vec3 n=normalize(vN); float ndl=max(dot(n,uSun),0.);
        float day=smoothstep(-.1,.22,dot(normalize(vP),uSun));
        vec3 base=mix(uLand*.9,uLand*1.3,vH);
        float snow=step(.6,vH)*max(vSnow,0.);
        base=mix(base,uSnow,snow*.9);
        // Lit against the flat ground around it: faces towards the sun brighter, the far side in shade.
        float ground=max(dot(normalize(vP),uSun),0.);
        vec3 col=base*clamp(.92+1.25*(ndl-ground),.32,1.7);
        col*=mix(nightLevel,1.,day);
        col+=uHot*smoothstep(.7,.95,vH)*step(vSnow,-.5)*(.45+.75*(1.-day));
        gl_FragColor=vec4(col,1.); }`,
  });
  let peaks: THREE.Mesh | null = null;
  let peakList: GlobeMountain[] = [];
  let peakDetail = -1;
  disposables.push(peakMat);
  function buildPeaks(detail: number) {
    if (detail === peakDetail || !peakList.length) return;
    peakDetail = detail;
    const { rings, segs } = PEAK_DETAIL[detail];
    const pos: number[] = [], aGen: number[] = [], aH: number[] = [], aSnow: number[] = [], idx: number[] = [];
    const P = new THREE.Vector3(), T = new THREE.Vector3(), B = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    peakList.forEach((m, mi) => {
      // A fixed seed per peak, so it keeps its shape when the detail level changes.
      let seed = 1 + mi * 7919;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      toVec(m.lon, m.lat, R, P);
      T.crossVectors(up, P).normalize();
      B.crossVectors(P, T).normalize();
      const base = 0.022 + 0.016 * m.scale, H = 0.052 * m.scale;
      // Mt. Coronet is a range down Sinnoh's middle: drawn long north to south.
      const sx = m.name === "Mt. Coronet" ? 0.75 : 1, sy = m.name === "Mt. Coronet" ? 2.1 : 1;
      const volcano = /Chimney|Volcano|Ember/.test(m.name);
      const snowy = !volcano && m.scale >= 1 ? 1 : 0;
      const spur = rnd() * Math.PI * 2;
      const start = pos.length / 3;
      // Ring 0 is the summit (one point); the last ring sits just under the ground.
      for (let i = 0; i <= rings; i++) {
        const r = i / rings;
        const n = i === 0 ? 1 : segs;
        for (let j = 0; j < n; j++) {
          const a = ((j + (i % 2) * 0.5) / segs) * Math.PI * 2;
          const bell = Math.pow(1 - r, 1.25);
          const ridges = 1 + 0.28 * Math.cos(3 * a + spur) * Math.sqrt(r) + (rnd() - 0.5) * 0.36 * r;
          let h = i === 0 ? H * (0.96 + rnd() * 0.08) : H * bell * ridges;
          if (volcano && i === 1) h = H * 0.9;
          if (volcano && i === 0) h = H * 0.72;
          if (i === rings) h = -0.002;
          const rr = r * (1 + (rnd() - 0.5) * 0.22 * (i < rings ? 1 : 0));
          const x = Math.cos(a) * rr * base * sx, y = Math.sin(a) * rr * base * sy;
          v.copy(P).addScaledVector(T, x).addScaledVector(B, y).normalize().multiplyScalar(R + h);
          pos.push(v.x, v.y, v.z);
          aGen.push(regionGeneration(m.region) ?? 1);
          aH.push(Math.max(0, h / H));
          aSnow.push(volcano ? -1 : snowy);
        }
      }
      // Fan from the summit, then strips between rings (odd rings are offset half a step: triangles, not quads).
      for (let j = 0; j < segs; j++) idx.push(start, start + 1 + j, start + 1 + ((j + 1) % segs));
      for (let i = 1; i < rings; i++) {
        const o = start + 1 + (i - 1) * segs, o2 = o + segs;
        for (let j = 0; j < segs; j++) {
          const a = o + j, b = o + ((j + 1) % segs), c = o2 + j, d = o2 + ((j + 1) % segs);
          idx.push(a, c, d, a, d, b);
        }
      }
    });
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    indexed.setAttribute("aGen", new THREE.Float32BufferAttribute(aGen, 1));
    indexed.setAttribute("aH", new THREE.Float32BufferAttribute(aH, 1));
    indexed.setAttribute("aSnow", new THREE.Float32BufferAttribute(aSnow, 1));
    indexed.setIndex(idx);
    // Every face its own normal: crisp facets.
    const geo = indexed.toNonIndexed();
    indexed.dispose();
    geo.computeVertexNormals();
    if (peaks) { peaks.geometry.dispose(); peaks.geometry = geo; }
    else { peaks = new THREE.Mesh(geo, peakMat); peaks.renderOrder = 1; globe.add(peaks); }
  }

  // ---- the legendaries: camera-facing artwork on gentle orbits (never picked: clicks go to the globe)
  type Legend = { def: (typeof LEGENDS)[number]; sprite: THREE.Sprite; mat: THREE.SpriteMaterial; face: number; fade: number; trail?: THREE.Points; axis?: THREE.Quaternion };
  const legends: Legend[] = [];
  const legendGroup = new THREE.Group();
  scene.add(legendGroup);
  let legendsLoading = false;
  /** Lugia skims the sea: the great circle (in the world's own frame) that crosses the most ocean, read off the mask. */
  let oceanAxis = new THREE.Quaternion();
  function sampleOcean(img: HTMLImageElement) {
    try {
      const w = 256, h = 128, c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) return;
      g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      const landAt = (v: THREE.Vector3) => {
        const lat = Math.asin(Math.max(-1, Math.min(1, v.y))), lon = Math.atan2(v.z, -v.x);
        const u = ((lon / (Math.PI * 2)) % 1 + 1) % 1, vv = 0.5 - lat / Math.PI;
        return d[(Math.min(h - 1, Math.floor(vv * h)) * w + Math.min(w - 1, Math.floor(u * w))) * 4] > 10;
      };
      let best = Infinity;
      const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3();
      for (let ti = 0; ti < 12; ti++)
        for (let yi = 0; yi < 24; yi++) {
          e.set((ti / 12) * Math.PI * 0.9 - 0.45 * Math.PI, (yi / 24) * Math.PI * 2, 0);
          q.setFromEuler(e);
          let land = 0;
          for (let k = 0; k < 120; k++) {
            const a = (k / 120) * Math.PI * 2;
            p.set(Math.cos(a), 0, Math.sin(a)).applyQuaternion(q);
            if (Math.abs(p.y) > 0.8) land += 0.5;
            if (landAt(p)) land++;
          }
          if (land < best) { best = land; oceanAxis = q.clone(); }
        }
      for (const l of legends) if (l.def.local) l.axis = oceanAxis;
    } catch {
      // keep the default orbit
    }
  }
  function loadLegends() {
    if (legendsLoading || dead) return;
    legendsLoading = true;
    const loader = new THREE.TextureLoader();
    LEGENDS.forEach((def, i) => {
      window.setTimeout(() => {
        if (dead) return;
        loader.load(`/api/art/${def.id}?s=256`, (t) => {
          if (dead) { t.dispose(); return; }
          t.anisotropy = Math.min(4, maxAniso);
          const mat = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0 });
          const sprite = new THREE.Sprite(mat);
          sprite.renderOrder = 5;
          sprite.raycast = () => undefined;
          sprite.scale.setScalar(def.size);
          const leg: Legend = { def, sprite, mat, face: 1, fade: 0, axis: def.local ? oceanAxis : undefined };
          if (def.id === 250) leg.trail = makeTrail();
          (def.local ? globe : legendGroup).add(sprite);
          if (leg.trail) legendGroup.add(leg.trail);
          disposables.push(t, mat);
          legends.push(leg);
        });
      }, i * 250);
    });
  }
  const TRAIL_N = 46;
  function makeTrail() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(TRAIL_N * 3), col = new Float32Array(TRAIL_N * 3), k = new Float32Array(TRAIL_N);
    const c = new THREE.Color();
    for (let i = 0; i < TRAIL_N; i++) {
      c.setHSL((i / TRAIL_N) * 0.78, 0.95, 0.62);
      col.set([c.r, c.g, c.b], i * 3);
      k[i] = i / (TRAIL_N - 1);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aK", new THREE.BufferAttribute(k, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: 1 }, uFade: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, vertexColors: true,
      vertexShader: `attribute float aK; uniform float uPx; varying vec3 vC; varying float vA;
        void main(){ vC=color; vA=pow(1.-aK,1.4); vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=(15.*(1.-aK*.55))*uPx*(3./-mv.z); }`,
      fragmentShader: `uniform float uFade; varying vec3 vC; varying float vA;
        void main(){ float d=length(gl_PointCoord-.5)*2.; float a=pow(max(1.-d,0.),1.6)*vA*.62*uFade; gl_FragColor=vec4(vC*a,a); }`,
    });
    const p = new THREE.Points(geo, mat);
    p.renderOrder = 4;
    p.frustumCulled = false;
    disposables.push(geo, mat);
    return p;
  }
  const lq = new THREE.Quaternion(), le = new THREE.Euler(), lp = new THREE.Vector3(), lp2 = new THREE.Vector3(), lw = new THREE.Vector3(), lw2 = new THREE.Vector3();
  function orbitAt(def: (typeof LEGENDS)[number], axis: THREE.Quaternion | undefined, t: number, out: THREE.Vector3) {
    const a = def.phase + (t / def.period) * Math.PI * 2;
    out.set(Math.cos(a) * def.r, Math.sin(t * 0.7 + def.phase) * 0.03, Math.sin(a) * def.r);
    if (axis) out.applyQuaternion(axis);
    else out.applyQuaternion(lq.setFromEuler(le.set(def.tilt, def.yaw, 0)));
    return out;
  }
  function updateLegends(t: number, dt: number, zoom: number, show: boolean) {
    const zFade = 1 - smooth(1.45, 2.2, zoom);
    for (const L of legends) {
      const target = show ? zFade : 0;
      L.fade += (target - L.fade) * Math.min(1, dt * 2.2);
      const vis = L.fade > 0.01;
      L.sprite.visible = vis;
      if (L.trail) L.trail.visible = vis;
      if (!vis) continue;
      orbitAt(L.def, L.axis, t, lp);
      orbitAt(L.def, L.axis, t + 0.25, lp2);
      L.sprite.position.copy(lp);
      // Faces the way it flies on screen.
      lw.copy(lp); lw2.copy(lp2);
      if (L.def.local) { lw.applyMatrix4(globe.matrixWorld); lw2.applyMatrix4(globe.matrixWorld); }
      const front = lw.z > 0 && Math.hypot(lw.x, lw.y) < R * 1.02;
      lw.project(camera); lw2.project(camera);
      const dir = Math.sign(lw2.x - lw.x) || L.face;
      if (dir !== L.face && Math.abs(lw2.x - lw.x) > 0.002) L.face = dir;
      const bob = 1 + Math.sin(t * 1.6 + L.def.phase) * 0.035;
      L.sprite.scale.set(L.def.size * bob, L.def.size * bob, 1);
      // Sprites ignore a negative scale: mirror the artwork through its texture instead.
      const map = L.mat.map!;
      const flip = L.face !== L.def.faces;
      if ((map.repeat.x < 0) !== flip) { map.repeat.x = flip ? -1 : 1; map.offset.x = flip ? 1 : 0; }
      L.mat.rotation = Math.sin(t * 0.9 + L.def.phase) * 0.06;
      // Over the world it is fainter, so the map stays readable.
      L.mat.opacity = L.fade * (front ? 0.62 : 0.95);
      if (L.trail) {
        const p = L.trail.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < TRAIL_N; i++) {
          orbitAt(L.def, L.axis, t - 0.06 - i * 0.075, lp2);
          p.setXYZ(i, lp2.x, lp2.y - 0.02, lp2.z);
        }
        p.needsUpdate = true;
        const m = L.trail.material as THREE.ShaderMaterial;
        m.uniforms.uFade.value = L.fade;
        m.uniforms.uPx.value = renderer.getPixelRatio();
      }
    }
  }

  // ---- theme: the site's tokens, re-read when html.light toggles
  let darkTheme = true;
  function applyTheme() {
    darkTheme = !document.documentElement.classList.contains("light");
    const screen = tokenColor("--screen", C()), primary = tokenColor("--primary", C());
    U.light.value = darkTheme ? 0 : 1;
    tokenColor("--card", U.sea.value); U.land.value.copy(screen); tokenColor("--foreground", U.coast.value); tokenColor("--border", U.grid.value);
    if (darkTheme) U.rim.value.copy(screen); else U.rim.value.set("#ffffff");
    U.spec.value.copy(darkTheme ? new THREE.Color(0.85, 0.82, 1) : new THREE.Color(1, 1, 1));
    U.nightLevel.value = darkTheme ? 0.36 : 0.74;
    U.nightTint.value.set(darkTheme ? 0x7f8cff : 0xd2d0ff).multiplyScalar(darkTheme ? 1.25 : 1.05);
    haloU.color.value.copy(darkTheme ? screen : primary); haloU.strength.value = darkTheme ? 1.2 : 0.5;
    ringMat.color.copy(screen); ringMat.opacity = darkTheme ? 0.3 : 0.22;
    cloudU.uDay.value.copy(darkTheme ? new THREE.Color(0.93, 0.92, 1) : new THREE.Color(1, 1, 1));
    cloudU.uNight.value.copy(darkTheme ? new THREE.Color(0.22, 0.2, 0.42) : new THREE.Color(0.75, 0.74, 0.9));
    cloudU.uAmt.value = darkTheme ? 0.34 : 0.5;
    peakU.uLand.value.copy(screen); peakU.uSnow.value.copy(darkTheme ? new THREE.Color(0.95, 0.94, 1) : new THREE.Color(1, 1, 1));
    lightMat.uniforms.uColor.value.set(darkTheme ? 0xffc46a : 0xff9a3c);
    stars.visible = darkTheme && QUALITY[quality].stars > 0;
  }
  const mo = new MutationObserver(applyTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  // ---- the era filter's map of generations (loaded the first time the era is not the latest)
  let gensLoading = false;
  function loadGens() {
    if (gensLoading) return;
    gensLoading = true;
    new THREE.TextureLoader().load("/geo/maps/globe-gens.png", (t) => {
      if (dead) { t.dispose(); return; }
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      U.gens.value = t; U.hasGens.value = 1;
      disposables.push(t);
    });
  }

  // ---- labels
  let labels: Label[] = [];
  let regionList: [string, number, number][] = [];
  let shotKeys: ReadonlySet<string> = new Set();
  const pool: Record<string, HTMLDivElement[]> = { region: [], city: [], place: [] };
  function getEl(it: Label) {
    if (it.el) return it.el;
    const el = pool[it.kind].pop() ?? document.createElement("div");
    el.className = "gl-lb " + it.kind + (it.peak ? " peak" : "");
    el.textContent = it.n;
    el.dataset.key = it.key;
    if (shotKeys.has(it.key)) el.dataset.shot = "1"; else delete el.dataset.shot;
    el.classList.toggle("is-hover", hoverKey === it.key);
    layer.appendChild(el); it.el = el; it.w = el.offsetWidth; it.h = el.offsetHeight;
    return el;
  }
  function dropEl(it: Label) { if (!it.el) return; it.el.remove(); pool[it.kind].push(it.el); it.el = null; it.box = null; }
  const tmp = new THREE.Vector3(), camW = new THREE.Vector3(), nW = new THREE.Vector3();
  let labelFade = 1;
  let kept: Label[] = [];
  function layoutLabels(zoom: number, era: number) {
    const W = host.clientWidth, H = host.clientHeight, boxes: number[][] = [];
    const next: Label[] = [];
    if (labelFade > 0.01) {
      for (const it of labels) {
        if (zoom < it.min) continue;
        const ev = eraVisibility(it.gen, era);
        if (ev < 0.05) continue;
        tmp.copy(it.v).applyMatrix4(globe.matrixWorld);
        nW.copy(tmp).normalize();
        const facing = nW.dot(camW.copy(camera.position).sub(tmp).normalize());
        if (facing < 0.2) continue;
        tmp.project(camera);
        const x = (tmp.x * 0.5 + 0.5) * W, y = (-tmp.y * 0.5 + 0.5) * H;
        if (x < -40 || x > W + 40 || y < -20 || y > H + 20) continue;
        const el = getEl(it);
        const bx = it.kind === "region" ? x - it.w / 2 : x - 4, by = y - it.h / 2;
        const box: [number, number, number, number] = [bx - 3, by - 2, bx + it.w + 3, by + it.h + 2];
        if (boxes.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) { dropEl(it); continue; }
        boxes.push(box); next.push(it); it.box = box;
        el.style.transform = `translate(${bx}px, ${by}px)`;
        el.style.opacity = String(Math.min(1, (facing - 0.2) * 5) * ev * labelFade);
        if (boxes.length > 140) break;
      }
    }
    const keep = new Set(next);
    for (const it of kept) if (!keep.has(it)) dropEl(it);
    kept = next;
  }
  /** The label (with a box on screen) under a point, with some slop for fingers. */
  function labelAt(x: number, y: number, slop: number): Label | null {
    let best: Label | null = null, bd = Infinity;
    for (const it of kept) {
      const b = it.box;
      if (!b) continue;
      const dx = x < b[0] ? b[0] - x : x > b[2] ? x - b[2] : 0, dy = y < b[1] ? b[1] - y : y > b[3] ? y - b[3] : 0;
      const d = Math.hypot(dx, dy);
      if (d <= slop && d < bd && (it.kind === "region" || shotKeys.has(it.key))) { bd = d; best = it; }
    }
    return best;
  }

  // ---- camera & interaction
  let homeD = 3.4, maxD = 6, minD = 1.3;
  let rotY = -2.2, rotX = 0.35, velY = 0, velX = 0, autoSpin = !reduce, dragging = false;
  let dist = homeD;
  let last: number[] | null = null, down: number[] | null = null, downT = 0;
  let fly: { y0: number; x0: number; d0: number; y1: number; x1: number; d1: number; t: number; dur: number; arc: number } | null = null;
  let intro = opts.intro && !reduce ? { t: 0, speed: 1, y0: 0, y1: 0 } : null;
  let era = opts.era, eraTarget = opts.era;
  if (era < LAST_GEN) loadGens();
  U.era.value = era;
  let shiftX = 0, shiftY = 0, shiftTX = 0, shiftTY = 0;
  let hoverKey: string | null = null, pinned = false, hoverHold = false;
  let firstPointer = false;
  const intentAt = new Map<string, number>();
  cb.auto(autoSpin);
  const pointers = new Map<number, number[]>();
  let pinch0: number[] | null = null;
  const clampD = (d: number) => Math.min(maxD, Math.max(minD, d));
  const zoomOf = () => (homeD - R) / (dist - R);
  const rel = (e: { clientX: number; clientY: number }) => {
    const r = host.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  function setHover(it: Label | null, pin: boolean) {
    const key = it && it.kind !== "region" ? it.key : null;
    if (key === hoverKey && pin === pinned) return;
    if (hoverKey) layer.querySelector(`.gl-lb[data-key="${CSS.escape(hoverKey)}"]`)?.classList.remove("is-hover");
    hoverKey = key; pinned = !!key && pin;
    if (key) layer.querySelector(`.gl-lb[data-key="${CSS.escape(key)}"]`)?.classList.add("is-hover");
    hoverHold = !!key;
    cb.hover(it && key ? { key, name: it.n, region: it.region, kind: it.kind } : null, pinned);
  }

  const onDown = (e: PointerEvent) => {
    if (intro) return skipIntro();
    canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
    dragging = true; last = [e.clientX, e.clientY]; down = [e.clientX, e.clientY]; downT = performance.now(); fly = null;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = [Math.hypot(a[0] - b[0], a[1] - b[1]), dist]; }
  };
  const onMove = (e: PointerEvent) => {
    if (!firstPointer) { firstPointer = true; cb.firstPointer(); }
    if (!pointers.has(e.pointerId) || !last) {
      // Hovering (a mouse or pen, no button down): labels with pictures answer.
      if (e.pointerType === "touch" || intro) return;
      const [x, y] = rel(e);
      const it = labelAt(x, y, 4);
      canvas.style.cursor = it ? "pointer" : "";
      if (!pinned) setHover(it && it.kind !== "region" ? it : null, false);
      // Hover intent: preload what the pointer is heading for.
      const near = labelAt(x, y, 40);
      if (near && near.kind !== "region") {
        const now = performance.now();
        if (now - (intentAt.get(near.key) ?? 0) > 4000) { intentAt.set(near.key, now); cb.intent(near.key); }
      }
      return;
    }
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2 && pinch0) { const [a, b] = [...pointers.values()]; dist = clampD((pinch0[1] * pinch0[0]) / Math.hypot(a[0] - b[0], a[1] - b[1])); return; }
    const dx = e.clientX - last[0], dy = e.clientY - last[1];
    last = [e.clientX, e.clientY];
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 && !pinned) setHover(null, false);
    const k = (0.0045 * (dist - R * 0.98)) / (homeD - R) * (3.4 / homeD);
    velY = dx * k; velX = dy * k; rotY += velY; rotX = Math.max(-1.35, Math.min(1.35, rotX + velX));
  };
  const onEnd = (e: PointerEvent) => {
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch0 = null;
    if (!pointers.size) {
      dragging = false;
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6 && performance.now() - downT < 600) pick(e);
      down = null;
    }
  };
  const onLeave = () => { if (!pinned) setHover(null, false); canvas.style.cursor = ""; };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (intro) return skipIntro();
    fly = null; dist = clampD(R + (dist - R) * Math.exp(e.deltaY * 0.0015));
  };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onEnd); canvas.addEventListener("pointercancel", onEnd);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  const visibleRegions = () => regionList.filter(([n]) => eraVisibility(regionGeneration(n), eraTarget) >= 1);
  const nearest = (lon: number, lat: number, list = visibleRegions()) => {
    let best = "", bd = 1e9;
    list.forEach(([n, a, b]) => { const d = (a - lon) ** 2 + (b - lat) ** 2; if (d < bd) { bd = d; best = n; } });
    return { name: best, d: bd };
  };
  const lonLatOf = (p: THREE.Vector3) => {
    const lat = (Math.asin(Math.max(-1, Math.min(1, p.y))) * 180) / Math.PI; let lon = (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180; if (lon < -180) lon += 360;
    return { lon, lat };
  };
  function flyTo(lon: number, lat: number, zoom: number) {
    autoSpin = false; cb.auto(false);
    // A point at θ = lon + 180° faces the camera when rotY = π/2 − θ.
    let ty = Math.PI / 2 - ((lon + 180) * Math.PI) / 180;
    while (ty - rotY > Math.PI) ty -= Math.PI * 2;
    while (rotY - ty > Math.PI) ty += Math.PI * 2;
    const x1 = (lat * Math.PI) / 180, d1 = clampD(R + (homeD - R) / zoom);
    const ang = Math.hypot(ty - rotY, x1 - rotX);
    if (ang < 0.01 && Math.abs(d1 - dist) < 0.01) return;
    fly = { y0: rotY, x0: rotX, d0: dist, y1: ty, x1, d1, t: 0, dur: reduce ? 0.01 : 1.5 + Math.min(0.9, ang * 0.3), arc: Math.min(1.1, ang) * 0.32 * (homeD - R) };
    cb.fly();
  }
  function flyToRegion(name: string) {
    const r = regionList.find((x) => x[0] === name);
    if (!r) return;
    flyTo(r[1], r[2], 2.2);
    cb.region(name);
  }
  function pick(e: PointerEvent) {
    const [px, py] = rel(e);
    const it = labelAt(px, py, e.pointerType === "touch" ? 14 : 3);
    if (it?.kind === "region") { setHover(null, false); return flyToRegion(it.n); }
    if (it) return setHover(it, true);
    if (pinned) { setHover(null, false); return; }
    const W = host.clientWidth, H = host.clientHeight;
    mouse.set((px / W) * 2 - 1, -(py / H) * 2 + 1); ray.setFromCamera(mouse, camera);
    const s = ray.intersectObject(sphere)[0]; if (!s) return;
    const { lon, lat } = lonLatOf(globe.worldToLocal(s.point.clone()).normalize());
    const near = nearest(lon, lat);
    if (zoomOf() < 1.7) { if (near.name && near.d < 900) return flyToRegion(near.name); return; }
    flyTo(lon, lat, Math.max(zoomOf() * 1.6, 2.2));
  }
  function skipIntro() {
    if (intro) intro.speed = Math.max(intro.speed, (1 - intro.t) / 0.45);
  }

  // ---- sizing & quality
  let quality = opts.quality ?? (reduce ? 1 : Math.min(window.innerWidth, window.innerHeight) < 600 ? 2 : 3);
  function applyPixelRatio() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[quality].pr));
    renderer.setSize(w, h, false);
  }
  function applyQuality() {
    const Q = QUALITY[quality];
    applyPixelRatio();
    starGeo.setDrawRange(0, Math.round(STAR_COUNT * Q.stars));
    stars.visible = darkTheme && Q.stars > 0;
    clouds.visible = Q.clouds;
    buildPeaks(Q.peaks);
    if (Q.legends && labels.length) loadLegends();
    host.setAttribute("data-q", String(quality));
    cb.quality(quality, ftEma);
  }
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const aspect = w / h;
    // The whole globe fits across a phone; a landscape window keeps the classic framing.
    const fitW = 1.13 / (Math.tan((20 * Math.PI) / 180) * Math.min(aspect, 1));
    const was = homeD;
    homeD = Math.max(3.4, fitW);
    maxD = homeD * 1.75; minD = 1.3;
    if (was !== homeD) dist = R + ((dist - R) * (homeD - R)) / (was - R);
    applyPixelRatio();
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  let ftEma = FRAME_BUDGET_MS, slowFor = 0, fastFor = 0, lastQChange = 0, qCeiling = 3, stepsDown = 0, warm = 0, lastNow = performance.now();
  function monitor(now: number) {
    const raw = now - lastNow;
    lastNow = now;
    if (opts.quality !== null) return;
    if (warm < 40 || raw > 400) { warm++; return; }
    ftEma = ftEma * 0.9 + raw * 0.1;
    if (ftEma > FRAME_BUDGET_MS * 1.5) { slowFor += raw; fastFor = 0; }
    else if (ftEma < FRAME_BUDGET_MS * 0.8) { fastFor += raw; slowFor = 0; }
    else { slowFor = 0; fastFor = 0; }
    if (slowFor > 700 && quality > 0 && now - lastQChange > 900) {
      quality--; stepsDown++; slowFor = 0; lastQChange = now;
      if (stepsDown >= 2) qCeiling = Math.min(qCeiling, quality + 1);
      applyQuality();
    } else if (fastFor > 6000 && quality < qCeiling && now - lastQChange > 5000) {
      quality++; fastFor = 0; lastQChange = now;
      if (stepsDown) qCeiling = quality;
      applyQuality();
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  dist = homeD;
  applyTheme();
  applyQuality();
  if (intro) {
    intro.y1 = rotY; intro.y0 = rotY - 2.1;
    rotY = intro.y0; rotX = 0.95; dist = INTRO_FROM; labelFade = 0;
  }

  // ---- frame loop
  const clock = new THREE.Clock();
  const qInv = new THREE.Quaternion(), S = new THREE.Vector3(), up = new THREE.Vector3();
  let hudT = 0, t = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    monitor(now);
    const dt = Math.min(clock.getDelta(), 0.1);
    t += dt;
    if (intro) {
      intro.t = Math.min(1, intro.t + (dt / INTRO_S) * intro.speed);
      const e = 1 - Math.pow(1 - intro.t, 4);
      dist = INTRO_FROM + (homeD - INTRO_FROM) * e;
      rotY = intro.y0 + (intro.y1 - intro.y0) * easeInOut(intro.t);
      rotX = 0.95 + (0.35 - 0.95) * e;
      labelFade = smooth(0.78, 1, intro.t);
      if (intro.t >= 1) { intro = null; labelFade = 1; cb.introDone(); }
    } else if (fly) {
      fly.t = Math.min(1, fly.t + dt / fly.dur);
      const e = easeInOut(fly.t);
      rotY = fly.y0 + (fly.y1 - fly.y0) * e; rotX = fly.x0 + (fly.x1 - fly.x0) * e;
      dist = clampD(fly.d0 + (fly.d1 - fly.d0) * e + fly.arc * Math.sin(Math.PI * fly.t));
      if (fly.t >= 1) fly = null;
    } else if (!dragging) {
      velY *= 0.93; velX *= 0.93;
      rotY += velY + (autoSpin && !hoverHold ? dt * 0.1 : 0);
      rotX = Math.max(-1.35, Math.min(1.35, rotX + velX));
    }
    // Era: slides to the chosen generation, a step at a time.
    if (era !== eraTarget) {
      const step = dt * Math.max(1.3, Math.abs(eraTarget - era) * 1.6);
      era = Math.abs(eraTarget - era) <= step ? eraTarget : era + Math.sign(eraTarget - era) * step;
      U.era.value = era;
    }
    const ks = Math.min(1, dt * 4.5);
    shiftX += (shiftTX - shiftX) * ks; shiftY += (shiftTY - shiftY) * ks;
    if (Math.abs(shiftX) + Math.abs(shiftY) < 0.5 && !shiftTX && !shiftTY) { if (camera.view?.enabled) camera.clearViewOffset(); }
    else camera.setViewOffset(host.clientWidth, host.clientHeight, -shiftX, -shiftY, host.clientWidth, host.clientHeight);

    globe.rotation.set(rotX, rotY, 0); globe.updateMatrixWorld();
    // The camera tilts towards the horizon as it nears the ground, so mountains stand up.
    const z = zoomOf();
    const tilt = (intro ? 0 : 1) * smooth(1.5, 4.2, z) * 0.62;
    S.set(0, 0, R);
    camera.position.set(0, -Math.sin(tilt) * (dist - R), R + Math.cos(tilt) * (dist - R));
    up.set(0, 1, 0);
    camera.up.copy(up);
    camera.lookAt(S.x, S.y + Math.sin(tilt) * 0.02, tilt > 0.001 ? S.z : 0);
    camera.updateMatrixWorld();

    // The sun: fixed in space, up and to the right, swinging slowly so the day/night line moves over the land.
    const az = 1.3 + Math.sin(t * 0.021) * 0.32, el = 0.32;
    sunWorld.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    qInv.copy(globe.quaternion).invert();
    sunObj.copy(sunWorld).applyQuaternion(qInv);
    camObj.copy(camera.position).applyQuaternion(qInv);
    haloU.uSunV.value.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
    U.time.value = t;
    // Clouds drift on their own, a little faster than the world turns.
    clouds.rotation.y = t * 0.006;
    cloudU.uSun.value.copy(sunObj).applyAxisAngle(up, -clouds.rotation.y);
    cloudU.uTime.value = t;
    cloudU.uFade.value = 1 - smooth(2.2, 4.5, z);
    lightMat.uniforms.uTime.value = t;
    lightMat.uniforms.uPx.value = renderer.getPixelRatio() * (0.85 + Math.min(z, 4) * 0.15);
    starU.uTime.value = t;
    starU.uPx.value = renderer.getPixelRatio();
    starU.uFade.value = 1;
    stars.rotation.set(rotX * 0.3, rotY * 0.3, 0);
    updateLegends(t, dt, intro ? 1 : z, QUALITY[quality].legends);

    renderer.render(scene, camera);
    layoutLabels(z, era);
    // Keeps the popup on its label while the globe turns.
    if (hoverKey) {
      const it = kept.find((l) => l.key === hoverKey);
      if (it?.box) cb.anchor(it.box[0], it.box[1], it.box[2] - it.box[0], it.box[3] - it.box[1], true);
      else cb.anchor(0, 0, 0, 0, false);
    }
    hudT += dt;
    if (hudT > 0.08) {
      hudT = 0;
      const { lon, lat } = lonLatOf(globe.worldToLocal(new THREE.Vector3(0, 0, 5)).normalize());
      const near = nearest(lon, lat);
      cb.stats({
        lon: lon.toFixed(1) + "°", lat: lat.toFixed(1) + "°", zoom: z.toFixed(1) + "×",
        tier: z >= 4.2 ? "Every place" : z >= 2.4 ? "Towns and cities" : z >= 1.7 ? "Major cities" : "Regions",
        focus: near.name ? (near.d < 400 ? near.name : "Near " + near.name) : "",
      });
    }
  }
  const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden && !dead && labels.length) { clock.getDelta(); frame(); } };
  document.addEventListener("visibilitychange", onVis);

  fetch("/atlas/atlas.json")
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<Atlas>; })
    .then((a) => {
      if (dead) return;
      const { W, H } = a;
      peakList = atlasMountains(a);
      const peakNames = new Set(peakList.map((m) => `${m.name} · ${m.region}`));
      const mk = (n: string, region: string, x: number, y: number, kind: LabelKind, pri: number, min: number): Label => {
        const lon = lonOf(x, W), lat = latOf(y, W, H);
        const key = `${n} · ${region}`;
        const peak = kind === "place" && peakNames.has(key);
        return { n, region, key, lon, lat, kind, peak, pri: peak ? 2.5 : pri, min: peak ? 2.4 : min, v: toVec(lon, lat, R * 1.002), el: null, w: 0, h: 0, gen: regionGeneration(region), box: null };
      };
      const regs = a.regions.filter((r) => r.tier === 1);
      const seen = new Set(a.markers.map((m) => m.name + "|" + m.region));
      const places = a.places.filter((p) => !seen.has(p.name + "|" + p.region));
      labels = [
        ...regs.map((r) => mk(r.name, r.name, r.x, r.y, "region", 0, 0)),
        ...a.markers.map((m) => mk(m.name, m.region, m.x, m.y, "city", m.kind === "city" ? 1 : 2, m.kind === "city" ? 1.7 : 2.4)),
        ...places.map((p) => mk(p.name, p.region, p.x, p.y, "place", 3, 4.2)),
      ].sort((x, y) => x.pri - y.pri);
      regionList = labels.filter((i) => i.kind === "region").map((i) => [i.n, i.lon, i.lat]);
      // Night lights: every town and city marker, and the atlas's other towns.
      const towns = [...a.markers.map((m) => ({ ...m, big: m.kind === "city" })), ...places.filter((p) => p.kind === "town").map((p) => ({ ...p, big: false }))];
      const lp = new Float32Array(towns.length * 3), ls = new Float32Array(towns.length), lg = new Float32Array(towns.length), lsd = new Float32Array(towns.length);
      const v = new THREE.Vector3();
      towns.forEach((m, i) => {
        toVec(lonOf(m.x, W), latOf(m.y, W, H), R * 1.003, v);
        lp.set([v.x, v.y, v.z], i * 3);
        ls[i] = m.big ? 15 : 10;
        lg[i] = regionGeneration(m.region) ?? 1;
        lsd[i] = Math.random();
      });
      lightGeo.setAttribute("position", new THREE.BufferAttribute(lp, 3));
      lightGeo.setAttribute("aSize", new THREE.BufferAttribute(ls, 1));
      lightGeo.setAttribute("aGen", new THREE.BufferAttribute(lg, 1));
      lightGeo.setAttribute("aSeed", new THREE.BufferAttribute(lsd, 1));
      buildPeaks(QUALITY[quality].peaks);
      if (QUALITY[quality].legends) loadLegends();
      cb.ready({ r: regs.length, c: a.markers.length, p: places.length });
      clock.getDelta();
      if (!document.hidden) frame();
    })
    .catch(() => !dead && cb.failed());

  let ri = 0;
  return {
    next() {
      const list = visibleRegions();
      if (!list.length) return;
      ri = (ri + 1) % list.length;
      flyToRegion(list[ri][0]);
    },
    out() { const { lon, lat } = lonLatOf(globe.worldToLocal(new THREE.Vector3(0, 0, 5)).normalize()); flyTo(lon, lat, 1); cb.region(null); },
    setAuto(v) { autoSpin = v; cb.auto(v); },
    setEra(gen) {
      eraTarget = gen;
      if (gen < LAST_GEN) loadGens();
      if (reduce) { era = gen; U.era.value = gen; }
    },
    flyToRegion,
    setShots(keys) {
      shotKeys = keys;
      for (const it of kept) if (it.el) { if (keys.has(it.key)) it.el.dataset.shot = "1"; else delete it.el.dataset.shot; }
    },
    setShift(x, y) { shiftTX = x; shiftTY = y; },
    pin(key) { const it = kept.find((l) => l.key === key); if (it) setHover(it, true); },
    unpin() { setHover(null, false); },
    skipIntro,
    dispose() {
      dead = true;
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onEnd); canvas.removeEventListener("pointercancel", onEnd);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      peaks?.geometry.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      layer.replaceChildren();
    },
  };
}
