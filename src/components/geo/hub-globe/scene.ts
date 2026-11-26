import * as THREE from "three";
import { deviceInfo } from "@/lib/gl/device-tier";
import { watchContext } from "@/lib/gl/context-loss";
import { latOf, lonOf } from "@/lib/globe/geo";

/**
 * The landing's planet: the world atlas (public/geo/maps/world-*.webp, the same map, in the same place, as the
 * World Atlas and /pokeguessr/globe) wrapped on a sphere that turns about a tilted axis like a real planet. Over it:
 * drifting clouds, a day/night edge that creeps a little, the atmosphere's glow, a pool of light on a region a hovered
 * mode is played in, and the main regions' names (DOM, placed every frame on the surface, fading round the back).
 *
 * It spins on its own; a drag spins it by hand (horizontally; tips it a little vertically), it coasts, then eases
 * back to its own turn. Reduced motion: it holds still (a drag still turns it). It draws only while it is on screen
 * and the page is visible, and steps its pixel ratio down when frames run slow.
 */

export interface HubRegion {
  name: string;
  /** Atlas pixels (public/atlas/atlas.json). */
  x: number;
  y: number;
}
export interface HubGlobeOptions {
  regions: HubRegion[];
  /** The label of each region (its name in the page's language). */
  label(name: string): string;
  /** The disc's share of the canvas (the rest is atmosphere). */
  frac: number;
  /** "tour": turns from region to region, easing in and out, instead of turning steadily. */
  mode: "spin" | "tour";
  onReady(): void;
  onFailed(): void;
  /** The atlas's size on the sphere (default: the larger one on a big, capable screen). */
  texture?: "big" | "small";
  /** The region the tour (or a hover) faces now. */
  onFacing?(name: string | null): void;
}
export interface HubGlobeApi {
  /** Light a region (an atlas name) and turn to face it, light the whole world's rim ("world"), or neither. */
  focus(f: string | null): void;
  /** Turn to face a region now (the tour's dial). */
  face(name: string): void;
  setPins(spots: [number, number][]): void;
  setPaused(p: boolean): void;
  /** For the mock's measurements: frames drawn and the time spent in them. */
  stats(): { frames: number; ms: number; pr: number };
  /** The current frame as a PNG (the poster is made from this). */
  snapshot(): string;
  dispose(): void;
}

const R = 1;
const D2R = Math.PI / 180;
/** The axis's tilt (Earth's), and how far the view looks down on it, so the north and the south both show. */
const TILT = 23.4 * D2R;
const LOOK_DOWN = 9 * D2R;
/** A turn every 50 seconds: slow enough to read the names as they pass. */
const SPIN = (Math.PI * 2) / 50;
/** Where the world faces when it appears (and where the poster shows it): Johto and Kanto, front and centre. */
const START_LON = 60;
const ATLAS = { W: 5850, H: 2565 };

const toVec = (lon: number, lat: number, r = R, out = new THREE.Vector3()) => {
  const phi = (90 - lat) * D2R, th = (lon + 180) * D2R;
  return out.set(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
};
/** The spin that brings a longitude to the front. */
const angleFacing = (lon: number) => -(lon + 90) * D2R;
const smooth = (a: number, b: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

const NOISE = `
float hash(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s; }
`;

export function createHubGlobe(host: HTMLElement, layer: HTMLElement, o: HubGlobeOptions): HubGlobeApi | null {
  const canvas = document.createElement("canvas");
  canvas.className = "absolute inset-0 h-full w-full";
  canvas.setAttribute("aria-hidden", "true");
  host.insertBefore(canvas, layer);
  let renderer: THREE.WebGLRenderer;
  const ctx = watchContext(canvas, () => o.onFailed());
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "default" });
  } catch {
    ctx.dispose();
    canvas.remove();
    return null;
  }
  THREE.ColorManagement.enabled = false;
  renderer.setClearColor(0x000000, 0);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dev = deviceInfo();
  const maxPr = Math.min(window.devicePixelRatio || 1, dev.tier <= 1 ? 1.5 : 2);
  let pr = maxPr;

  // ---- the camera: the disc spans `frac` of the canvas (a long lens, so the planet reads as a ball, not a bulge)
  const FOV = 26;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  const t2 = Math.tan((FOV / 2) * D2R);
  camera.position.set(0, 0, Math.sqrt(1 + 1 / (o.frac * t2) ** 2));
  camera.lookAt(0, 0, 0);
  const scene = new THREE.Scene();
  // The tilted axis (and the view a little from above), then the day's turn about it.
  const tiltG = new THREE.Group();
  const spinG = new THREE.Group();
  tiltG.add(spinG);
  scene.add(tiltG);
  const setTilt = (extra: number) => tiltG.rotation.set(LOOK_DOWN + extra, 0, -TILT, "XZY");
  setTilt(0);

  // ---- the world: the atlas map, padded with sea above and below (as the globe page's texture is)
  const big = o.texture ? o.texture === "big" : canvas.clientWidth * maxPr > 1100 && dev.tier >= 2;
  const tex = new THREE.TextureLoader().load(big ? "/geo/maps/world-2925.webp" : "/geo/maps/world-1463.webp", () => {
    texReady = true;
    tryReady();
  }, undefined, () => o.onFailed());
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let texReady = false;
  const sunV = new THREE.Vector3();
  const U = {
    map: { value: tex },
    k1: { value: ATLAS.W / 2 / ATLAS.H },
    k0: { value: (ATLAS.W / 2 - ATLAS.H) / 2 / ATLAS.H },
    uSun: { value: sunV },
    uFocus: { value: new THREE.Vector3(0, 1, 0) },
    uFocusK: { value: 0 },
    uWorldK: { value: 0 },
    uTime: { value: 0 },
  };
  const worldMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vO;
      void main(){ vUv=uv; vO=position; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D map; uniform float k1; uniform float k0; uniform vec3 uSun; uniform vec3 uFocus; uniform float uFocusK; uniform float uWorldK; uniform float uTime;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vO;
      ${NOISE}
      void main(){
        float down=(1.-vUv.y)*k1-k0;
        vec3 a=texture2D(map, vec2(vUv.x, 1.-clamp(down,.002,.998))).rgb;
        vec3 N=normalize(vN), V=normalize(vV);
        float ndl=dot(N,uSun);
        float day=smoothstep(-.14,.2,ndl);
        float sea=smoothstep(.06,.2,a.b-max(a.r,a.g));
        // Day: soft wrapped light, never harsh (it's a map first). Night: a deep blue, the land still faintly there.
        vec3 lit=a*(.62+.5*smoothstep(-.2,1.,ndl));
        vec3 night=a*vec3(.2,.24,.42)+vec3(.014,.02,.06);
        vec3 col=mix(night,lit,day);
        // The evening's edge: a warm band where the sun sets.
        float dx=(ndl-.02)/.11; col+=vec3(1.,.5,.25)*exp(-dx*dx)*.16*(.4+.6*(1.-sea));
        // Sun glint on the sea, shimmering a little.
        vec3 H=normalize(uSun+V); float nh=max(dot(N,H),0.);
        float w=vnoise(vO*40.+vec3(uTime*.3,uTime*.2,0.));
        col+=vec3(1.,.96,.86)*(pow(nh,70.)*(.5+.5*w)*.42+pow(nh,9.)*.05)*sea*day;
        // A pool of light on the region in focus.
        float f=dot(normalize(vO),uFocus);
        float pool=smoothstep(cos(.24),cos(.06),f);
        float ring=exp(-pow((f-cos(.2))/.0035,2.));
        col=mix(col, col*1.1+vec3(1.,.84,.4)*.06, pool*uFocusK);
        col=mix(col, vec3(1.,.88,.45), ring*.7*uFocusK);
        // The air at the limb, brighter on the day side (and when the whole world is in focus).
        float fr=pow(1.-max(dot(N,V),0.),2.6);
        col+=vec3(.42,.66,1.)*fr*(.55+.5*uWorldK)*mix(.25,1.,day);
        gl_FragColor=vec4(col,1.);
      }`,
  });
  const sphereGeo = new THREE.SphereGeometry(R, 128, 64);
  spinG.add(new THREE.Mesh(sphereGeo, worldMat));

  // ---- clouds: soft fbm on a shell just above the land, turning a little faster than it
  const cloudU = { uTime: { value: 0 }, uSun: { value: new THREE.Vector3() } };
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudU,
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec3 vO; varying vec3 vN; varying vec3 vV;
      void main(){ vO=position; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSun; varying vec3 vO; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      void main(){
        vec3 p=normalize(vO);
        vec3 q=p*vec3(2.2,4.8,2.2);
        float w=fbm(q*.8+vec3(uTime*.01,0.,uTime*.007));
        float n=fbm(q*1.7+w*1.5+vec3(-uTime*.016,0.,uTime*.01));
        float a=smoothstep(.52,.8,n)*.62;
        a*=1.-smoothstep(.78,.98,abs(p.y));
        float ndl=dot(normalize(vN),uSun);
        float lit=smoothstep(-.15,.3,ndl);
        a*=mix(.1,1.,lit);
        a*=smoothstep(.0,.25,dot(normalize(vN),normalize(vV)));
        if(a<.004) discard;
        gl_FragColor=vec4(mix(vec3(.3,.34,.5),vec3(1.,.99,.97),lit),a);
      }`,
  });
  const cloudGeo = new THREE.SphereGeometry(R * 1.012, 96, 48);
  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
  tiltG.add(cloudMesh);

  // ---- the atmosphere: a glow round the limb, fading out into space, warmer where the sun sets
  const haloU = { uSun: { value: sunV }, uWorldK: U.uWorldK };
  const haloMat = new THREE.ShaderMaterial({
    uniforms: haloU,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    vertexShader: `varying vec3 vP; varying vec3 vC; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vP=mv.xyz; vC=(modelViewMatrix*vec4(0.,0.,0.,1.)).xyz; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uSun; uniform float uWorldK; varying vec3 vP; varying vec3 vC;
      void main(){
        vec3 D=normalize(vP);
        vec3 near=D*dot(vC,D);
        vec3 r=near-vC; float b=length(r);
        float out_=b>1. ? pow(clamp(1.-(b-1.)/.13,0.,1.),2.6) : pow(b,6.)*.9;
        float s=dot(r/max(b,1e-4),uSun);
        float lit=.3+.9*smoothstep(-.5,.6,s);
        float sx=s/.3;
        vec3 c=mix(vec3(.38,.62,1.),vec3(1.,.6,.42),exp(-sx*sx)*.4);
        float k=out_*lit*(.85+.5*uWorldK);
        gl_FragColor=vec4(c*k,k);
      }`,
  });
  const haloGeo = new THREE.SphereGeometry(R * 1.14, 64, 32);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.renderOrder = 4;
  scene.add(halo);

  // ---- labels: the main regions, on the surface
  type Mark = { name: string; v: THREE.Vector3; lon: number; el: HTMLElement };
  const marks: Mark[] = o.regions.map((r) => {
    const lon = lonOf(r.x, ATLAS.W), lat = latOf(r.y, ATLAS.W, ATLAS.H);
    const el = document.createElement("span");
    el.className = "hg-label";
    el.textContent = o.label(r.name);
    el.dataset.testid = "geo-home-region";
    el.dataset.region = r.name;
    layer.appendChild(el);
    return { name: r.name, v: toVec(lon, lat, R * 1.01), lon, el };
  });
  let pins: { v: THREE.Vector3; el: HTMLElement }[] = [];

  // ---- motion
  let angle = angleFacing(START_LON);
  let omega = reduce ? 0 : SPIN;
  let tiltX = 0, tiltV = 0;
  let dragging = false, lastMove = -1e9;
  let target: number | null = null;
  let focusName: string | null = null;
  let worldK = 0, focusK = 0;
  /** The region the pool of light is on now (it fades out before it moves to another). */
  let pool: string | null = null;
  let tourI = Math.max(0, marks.findIndex((m) => m.name === "Johto"));
  let tourT = 0;
  let clock = 0;
  const lonOrder = [...marks].sort((a, b) => a.lon - b.lon);

  /** The nearest spin that faces a longitude, going forwards when it's close to even. */
  const nearest = (lon: number) => {
    const a = angleFacing(lon);
    const k = Math.round((angle - a) / (Math.PI * 2));
    let best = a + k * Math.PI * 2;
    if (best < angle - 0.3) best += Math.PI * 2;
    return best;
  };
  const markOf = (n: string) => marks.find((m) => m.name === n);

  // ---- drag to spin
  let px = 0, py = 0, pt = 0;
  const diskPx = () => canvas.clientWidth * o.frac;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    target = null;
    px = e.clientX; py = e.clientY; pt = performance.now();
    host.setPointerCapture(e.pointerId);
    host.style.cursor = "grabbing";
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const now = performance.now(), dt = Math.max(1, now - pt) / 1000;
    const da = ((e.clientX - px) / diskPx()) * Math.PI;
    angle += da;
    omega = omega * 0.5 + (da / dt) * 0.5;
    tiltX = Math.max(-0.32, Math.min(0.32, tiltX + ((e.clientY - py) / diskPx()) * 1.2));
    px = e.clientX; py = e.clientY; pt = now;
    lastMove = now;
    kick();
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (performance.now() - pt > 80) omega = 0;
    host.releasePointerCapture?.(e.pointerId);
    host.style.cursor = "";
    lastMove = performance.now();
    if (o.mode === "tour") {
      // Let go mid-tour: it carries on from the region nearest the front (after the throw has carried it a little).
      const front = -(angle + omega * 0.6) / D2R - 90;
      const off = (m: Mark) => Math.abs((((m.lon - front) % 360) + 540) % 360 - 180);
      const near = marks.reduce((a, m) => (off(m) < off(a) ? m : a), marks[0]);
      tourI = marks.indexOf(near);
      tourT = 0;
      o.onFacing?.(near.name);
    }
    kick();
  };
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);

  // ---- size
  let W = 0, Hh = 0;
  const resize = () => {
    W = host.clientWidth; Hh = host.clientHeight;
    if (!W || !Hh) return;
    renderer.setPixelRatio(pr);
    renderer.setSize(W, Hh, false);
    camera.aspect = W / Hh;
    camera.updateProjectionMatrix();
    kick();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // ---- the loop: only while on screen and visible
  let onScreen = true, paused = false, raf = 0, last = 0, dead = false, ready = false;
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; kick(); });
  io.observe(host);
  const onVis = () => kick();
  document.addEventListener("visibilitychange", onVis);
  let frames = 0, ms = 0, slow = 0, fast = 0;

  const pA = new THREE.Vector3(), pN = new THREE.Vector3(), camW = new THREE.Vector3();
  function place(v: THREE.Vector3, el: HTMLElement, minFace: number) {
    pA.copy(v).applyMatrix4(spinG.matrixWorld);
    pN.copy(pA).normalize();
    const facing = pN.dot(camW.copy(camera.position).sub(pA).normalize());
    const op = smooth(minFace, minFace + 0.28, facing);
    pA.project(camera);
    const x = (pA.x * 0.5 + 0.5) * W, y = (-pA.y * 0.5 + 0.5) * Hh;
    if (op < 0.02) {
      if (el.style.visibility !== "hidden") el.style.visibility = "hidden";
      return;
    }
    el.style.visibility = "visible";
    el.style.opacity = op.toFixed(3);
    el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${(0.8 + 0.2 * op).toFixed(3)})`;
  }

  function draw() {
    // The sun: up and to the left, swinging slowly, so the evening's edge creeps across the land and back.
    const sw = reduce ? 0 : Math.sin(clock * 0.09) * 0.22;
    sunV.set(-0.74 + sw, 0.38, 0.42).normalize();
    cloudU.uSun.value.copy(sunV);
    U.uTime.value = reduce ? 0 : clock;
    cloudU.uTime.value = reduce ? 0 : clock;
    spinG.rotation.y = angle;
    cloudMesh.rotation.y = angle * 1.04 + (reduce ? 0 : clock * 0.006);
    setTilt(tiltX);
    scene.updateMatrixWorld();
    // sunV is in view space; the shaders' normals are too (the camera never moves).
    U.uWorldK.value = worldK;
    U.uFocusK.value = focusK;
    renderer.render(scene, camera);
    for (const m of marks) {
      place(m.v, m.el, 0.08);
      m.el.classList.toggle("hg-lit", focusK > 0.3 && m.name === pool);
      m.el.classList.toggle("hg-dim", focusK > 0.3 && m.name !== pool && focusName !== null);
    }
    for (const p of pins) place(p.v, p.el, 0.12);
  }

  function step(dt: number) {
    clock += dt;
    const now = performance.now();
    if (!dragging) {
      const idle = now - lastMove;
      if (target !== null) {
        // A critically damped turn to the region in focus.
        const k = 2.6;
        const acc = k * k * (target - angle) - 2 * k * omega;
        omega += acc * dt;
        if (Math.abs(target - angle) < 0.002 && Math.abs(omega) < 0.002) omega = 0;
      } else if (o.mode === "tour" && !reduce) {
        // From region to region (west to east, as the world turns), resting a moment on each.
        tourT += dt;
        if (tourT > 5.2) {
          tourT = 0;
          const cur = lonOrder.findIndex((m) => m.name === marks[tourI].name);
          tourI = marks.indexOf(lonOrder[(cur - 1 + lonOrder.length) % lonOrder.length]);
          o.onFacing?.(marks[tourI].name);
        }
        const goal = nearest(marks[tourI].lon);
        const k = 1.5;
        omega += (k * k * (goal - angle) - 2 * k * omega) * dt;
      } else {
        // After a drag: coast, then ease back to the world's own turn.
        const want = reduce ? 0 : SPIN;
        const ease = idle < 900 ? 0.9 : 1.4;
        omega += (want - omega) * (1 - Math.exp(-dt / ease));
      }
      // Tipped by a drag: settle back onto the axis.
      const k = 3;
      tiltV += (-k * k * tiltX - 2 * k * tiltV) * dt;
      tiltX += tiltV * dt;
      angle += omega * dt;
    }
    // The region lit: the one in focus, else (touring) the one the tour is on.
    const want = focusName && focusName !== "world" ? focusName : focusName === null && o.mode === "tour" && !reduce ? marks[tourI]?.name ?? null : null;
    if (want !== pool) {
      focusK += (0 - focusK) * (1 - Math.exp(-dt / 0.12));
      if (focusK < 0.03) {
        pool = want;
        const m = want ? markOf(want) : null;
        if (m) U.uFocus.value.copy(m.v).normalize();
      }
    } else focusK += ((pool ? 1 : 0) - focusK) * (1 - Math.exp(-dt / 0.2));
    worldK += ((focusName === "world" ? 1 : 0) - worldK) * (1 - Math.exp(-dt / 0.18));
  }

  const settled = () => reduce && !dragging && target === null && Math.abs(tiltX) < 1e-3 && Math.abs(omega) < 1e-3 && pool === (focusName === "world" ? null : focusName) && Math.abs(focusK - (pool ? 1 : 0)) < 0.01 && Math.abs(worldK - (focusName === "world" ? 1 : 0)) < 0.01;

  function frame(t: number) {
    raf = 0;
    if (dead || ctx.lost) return;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
    last = t;
    const t0 = performance.now();
    step(dt);
    draw();
    const cost = performance.now() - t0;
    frames++;
    ms += cost;
    // Slow frames for a second and a half: a lower pixel ratio (down to 1); ten seconds of fast ones: back up.
    if (dt > 0.024) slow += dt; else slow = Math.max(0, slow - dt * 0.5);
    if (dt < 0.018) fast += dt; else fast = 0;
    if (slow > 1.5 && pr > 1) { pr = Math.max(1, pr - 0.25); slow = 0; resize(); }
    else if (fast > 10 && pr < maxPr) { pr = Math.min(maxPr, pr + 0.25); fast = 0; resize(); }
    if (!settled()) kick();
    else last = 0;
  }
  function kick() {
    if (dead || raf || !ready || paused || !onScreen || document.hidden) {
      if (!raf) last = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  function tryReady() {
    if (ready || dead || !texReady) return;
    ready = true;
    resize();
    // Compile and draw the first frame before the still gives way.
    draw();
    o.onReady();
    o.onFacing?.(o.mode === "tour" ? marks[tourI]?.name ?? null : null);
    kick();
  }

  return {
    focus(f) {
      focusName = f;
      const m = f && f !== "world" ? markOf(f) : null;
      if (m) {
        target = nearest(m.lon);
        o.onFacing?.(m.name);
      } else {
        target = null;
        lastMove = performance.now();
        if (o.mode === "tour") tourT = 0;
      }
      kick();
    },
    face(name) {
      const i = marks.findIndex((m) => m.name === name);
      if (i < 0) return;
      tourI = i;
      tourT = 0;
      o.onFacing?.(name);
      if (reduce) target = nearest(marks[i].lon);
      kick();
    },
    setPins(spots) {
      pins.forEach((p) => p.el.remove());
      pins = spots.map(([lon, lat]) => {
        const el = document.createElement("span");
        el.className = "hg-pin";
        el.dataset.testid = "geo-home-pin";
        el.innerHTML = `<svg width="12" height="17" viewBox="0 0 10 14" aria-hidden="true"><path d="M5 13.5C5 13.5 9.5 8.6 9.5 5A4.5 4.5 0 0 0 .5 5c0 3.6 4.5 8.5 4.5 8.5Z" fill="#ffd23c" stroke="#3a2200" stroke-width="1"/><circle cx="5" cy="5" r="1.6" fill="#3a2200"/></svg>`;
        layer.appendChild(el);
        return { v: toVec(lon, lat, R * 1.01), el };
      });
      kick();
    },
    setPaused(p) {
      paused = p;
      kick();
    },
    stats: () => ({ frames, ms, pr }),
    snapshot() {
      // The first frame, as the live one starts: the poster.
      const kept = { angle, clock, tiltX, focusK, worldK };
      angle = angleFacing(START_LON); clock = 0; tiltX = 0; focusK = 0; worldK = 0;
      draw();
      const url = canvas.toDataURL("image/png");
      ({ angle, clock, tiltX, focusK, worldK } = kept);
      return url;
    },
    dispose() {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      marks.forEach((m) => m.el.remove());
      pins.forEach((p) => p.el.remove());
      [tex, worldMat, sphereGeo, cloudMat, cloudGeo, haloMat, haloGeo].forEach((d) => d.dispose());
      ctx.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
