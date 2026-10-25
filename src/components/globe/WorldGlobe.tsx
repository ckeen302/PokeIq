"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";

type Item = { n: string; lon: number; lat: number; kind: "region" | "city" | "place"; pri: number; min: number; v: THREE.Vector3; el: HTMLDivElement | null; w: number; h: number };
type Atlas = {
  W: number;
  H: number;
  regions: { name: string; tier: number; x: number; y: number }[];
  markers: { name: string; region: string; kind: string; x: number; y: number }[];
  places: { name: string; region: string; x: number; y: number }[];
};

// Atlas pixel -> degrees (the mask has sea padding top and bottom).
const lonOf = (x: number, W: number) => (x / W) * 360 - 180;
const latOf = (y: number, W: number, H: number) => 90 - ((y + (W / 2 - H) / 2) / (W / 2)) * 180;

/** "248 40% 97%" token -> three Color, bypassing colour management so it matches the CSS exactly. */
function tokenColor(name: string, out: THREE.Color) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const [h, s, l] = raw.match(/-?[\d.]+/g)?.map(Number) ?? [0, 0, 50];
  return out.setHSL(h / 360, s / 100, l / 100);
}

const CSS = `
.gl-lb{position:absolute;left:0;top:0;white-space:nowrap;will-change:transform}
.gl-lb.region{font:700 15px var(--font-display),sans-serif;letter-spacing:.16em;text-transform:uppercase;color:hsl(var(--foreground));padding:3px 9px;background:hsl(var(--card)/.8);border:1px solid hsl(var(--screen));border-radius:2px;backdrop-filter:blur(4px)}
.gl-lb.city{font:600 12px var(--font-display),sans-serif;letter-spacing:.04em;color:hsl(var(--foreground));text-shadow:0 0 4px hsl(var(--background)),0 0 8px hsl(var(--background))}
.gl-lb.city::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:hsl(var(--primary));margin-right:5px;vertical-align:1px;box-shadow:0 0 6px hsl(var(--primary))}
.gl-lb.place{font:400 10.5px var(--font-body),sans-serif;color:hsl(var(--muted-foreground));text-shadow:0 0 3px hsl(var(--background)),0 0 6px hsl(var(--background))}
.gl-lb.place::before{content:"";display:inline-block;width:4px;height:4px;border-radius:50%;background:hsl(var(--screen));margin-right:4px;vertical-align:1px}
`;

export function WorldGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "nogl" | "failed">("loading");
  const [focus, setFocus] = useState("Kanto");
  const [tier, setTier] = useState("Regions");
  const [auto, setAuto] = useState(true);
  const [stats, setStats] = useState({ lon: "0.0°", lat: "0.0°", zoom: "1.0×" });
  const [counts, setCounts] = useState({ r: 0, c: 0, p: 0 });
  const api = useRef<{ next(): void; out(): void; setAuto(v: boolean): void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const layer = layerRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      setState("nogl");
      return;
    }
    let dead = false;
    let raf = 0;
    const disposables: { dispose(): void }[] = [renderer];
    THREE.ColorManagement.enabled = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    const MAXD = 6, MIND = 1.3, HOME = 3.4, R = 1;
    let dist = HOME;
    const globe = new THREE.Group();
    scene.add(globe);
    const toVec = (lon: number, lat: number, r = R) => {
      const phi = ((90 - lat) * Math.PI) / 180, th = ((lon + 180) * Math.PI) / 180;
      return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
    };

    const tex = new THREE.TextureLoader().load("/geo/maps/globe-mask.png");
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    disposables.push(tex);

    const U = { map: { value: tex }, time: { value: 0 }, land: { value: new THREE.Color() }, coast: { value: new THREE.Color() }, grid: { value: new THREE.Color() }, rim: { value: new THREE.Color() }, sea: { value: new THREE.Color() }, light: { value: 0 } };
    const holo = new THREE.ShaderMaterial({
      uniforms: U,
      transparent: true,
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; uniform float time; uniform vec3 land; uniform vec3 coast; uniform vec3 grid; uniform vec3 rim; uniform vec3 sea; uniform float light;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        float gridf(vec2 uv, vec2 n){ vec2 g=abs(fract(uv*n-.5)-.5)/fwidth(uv*n); return 1.-min(min(g.x,g.y),1.); }
        void main(){
          float m=texture2D(map,vUv).r;
          float c=smoothstep(.85,1.,m);
          float l=step(.04,m);
          float g=gridf(vUv, vec2(36.,18.))*(1.-l*.6);
          float f=pow(1.-max(dot(vN,vV),0.),2.2);
          float band=.96+.04*sin(vUv.y*900.+time*2.);
          vec3 col=sea;
          col=mix(col, land*(.55+.75*m)*band, l*.92);
          col=mix(col, coast, c*.9);
          col=mix(col, grid, g*.35);
          col+=rim*f*(light>.5?.35:.9);
          gl_FragColor=vec4(col,1.);
        }`,
    });
    const sphereGeo = new THREE.SphereGeometry(R, 160, 80);
    const sphere = new THREE.Mesh(sphereGeo, holo);
    globe.add(sphere);
    const haloU = { color: { value: new THREE.Color() }, strength: { value: 1 } };
    const haloMat = new THREE.ShaderMaterial({
      uniforms: haloU, transparent: true, depthWrite: false, side: THREE.BackSide,
      vertexShader: `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform vec3 color; uniform float strength; varying vec3 vN; void main(){ float i=pow(max(.7-dot(vN,vec3(0,0,1.)),0.),2.6)*strength; gl_FragColor=vec4(color, i); }`,
    });
    const haloGeo = new THREE.SphereGeometry(R * 1.16, 64, 32);
    scene.add(new THREE.Mesh(haloGeo, haloMat));
    const ringMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3 });
    disposables.push(holo, sphereGeo, haloMat, haloGeo, ringMat);
    [[1.32, 0.45], [1.46, -0.3]].forEach(([r, tilt]) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 160; i++) { const a = (i / 160) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      disposables.push(geo);
      const ring = new THREE.LineLoop(geo, ringMat);
      ring.rotation.x = Math.PI / 2 + tilt; ring.rotation.z = tilt;
      scene.add(ring);
    });

    // Theme: the site's tokens, re-read when html.light toggles.
    function applyTheme() {
      const dark = !document.documentElement.classList.contains("light");
      const screen = tokenColor("--screen", new THREE.Color()), primary = tokenColor("--primary", new THREE.Color());
      U.light.value = dark ? 0 : 1;
      tokenColor("--card", U.sea.value); U.land.value.copy(screen); tokenColor("--foreground", U.coast.value); tokenColor("--border", U.grid.value);
      if (dark) U.rim.value.copy(screen); else U.rim.value.set("#ffffff");
      haloU.color.value.copy(dark ? screen : primary); haloU.strength.value = dark ? 1.4 : 0.55;
      ringMat.color.copy(screen); ringMat.opacity = dark ? 0.3 : 0.22;
    }
    applyTheme();
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    // Labels.
    let items: Item[] = [];
    let regionList: [string, number, number][] = [];
    const pool: Record<string, HTMLDivElement[]> = { region: [], city: [], place: [] };
    function getEl(it: Item) {
      if (it.el) return it.el;
      const el = pool[it.kind].pop() ?? Object.assign(document.createElement("div"), { className: "gl-lb " + it.kind });
      el.textContent = it.n; layer.appendChild(el); it.el = el; it.w = el.offsetWidth; it.h = el.offsetHeight;
      return el;
    }
    function dropEl(it: Item) { if (!it.el) return; it.el.remove(); pool[it.kind].push(it.el); it.el = null; }
    const tmp = new THREE.Vector3(), camDir = new THREE.Vector3();
    function layoutLabels(zoom: number) {
      const W = window.innerWidth, H = window.innerHeight, boxes: number[][] = [];
      camDir.copy(camera.position).normalize();
      const keep = new Set<Item>();
      for (const it of items.filter((i) => zoom >= i.min).sort((a, b) => a.pri - b.pri)) {
        tmp.copy(it.v).applyMatrix4(globe.matrixWorld);
        const facing = tmp.clone().normalize().dot(camDir);
        if (facing < 0.18) continue;
        tmp.project(camera);
        const x = (tmp.x * 0.5 + 0.5) * W, y = (-tmp.y * 0.5 + 0.5) * H;
        if (x < -40 || x > W + 40 || y < -20 || y > H + 20) continue;
        const el = getEl(it);
        const bx = it.kind === "region" ? x - it.w / 2 : x - 4, by = y - it.h / 2;
        const box = [bx - 3, by - 2, bx + it.w + 3, by + it.h + 2];
        if (boxes.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
        boxes.push(box); keep.add(it);
        el.style.transform = `translate(${bx}px, ${by}px)`; el.style.opacity = String(Math.min(1, (facing - 0.18) * 5));
        if (boxes.length > 140) break;
      }
      for (const it of items) if (!keep.has(it)) dropEl(it);
    }

    // Interaction.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let rotY = -2.2, rotX = 0.35, velY = 0, velX = 0, autoSpin = !reduce, dragging = false;
    let last: number[] | null = null, down: number[] | null = null;
    let fly: { y0: number; x0: number; d0: number; y1: number; x1: number; d1: number; t: number } | null = null;
    setAuto(autoSpin);
    const pointers = new Map<number, number[]>();
    let pinch0: number[] | null = null;
    const clampD = (d: number) => Math.min(MAXD, Math.max(MIND, d));
    const zoomOf = () => (HOME - R) / (dist - R);
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
      dragging = true; last = [e.clientX, e.clientY]; down = [e.clientX, e.clientY]; fly = null;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = [Math.hypot(a[0] - b[0], a[1] - b[1]), dist]; }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || !last) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2 && pinch0) { const [a, b] = [...pointers.values()]; dist = clampD((pinch0[1] * pinch0[0]) / Math.hypot(a[0] - b[0], a[1] - b[1])); return; }
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      const k = (0.0045 * (dist - R * 0.98)) / (HOME - R);
      velY = dx * k; velX = dy * k; rotY += velY; rotX = Math.max(-1.35, Math.min(1.35, rotX + velX));
    };
    const onEnd = (e: PointerEvent) => {
      pointers.delete(e.pointerId); if (pointers.size < 2) pinch0 = null;
      if (!pointers.size) { dragging = false; if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) pick(e); }
    };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); fly = null; dist = clampD(R + (dist - R) * Math.exp(e.deltaY * 0.0015)); };
    canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onEnd); canvas.addEventListener("pointercancel", onEnd);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    const nearest = (lon: number, lat: number) => {
      let best = "", bd = 1e9;
      regionList.forEach(([n, a, b]) => { const d = (a - lon) ** 2 + (b - lat) ** 2; if (d < bd) { bd = d; best = n; } });
      return bd < 400 ? best : "Near " + best;
    };
    const lonLatOf = (p: THREE.Vector3) => {
      const lat = (Math.asin(p.y) * 180) / Math.PI; let lon = (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180; if (lon < -180) lon += 360;
      return { lon, lat };
    };
    function flyTo(lon: number, lat: number, zoom: number, name?: string | null) {
      autoSpin = false; setAuto(false);
      let ty = -(((lon + 180) * Math.PI) / 180 - Math.PI / 2) + Math.PI;
      while (ty - rotY > Math.PI) ty -= Math.PI * 2;
      while (rotY - ty > Math.PI) ty += Math.PI * 2;
      fly = { y0: rotY, x0: rotX, d0: dist, y1: ty, x1: (lat * Math.PI) / 180, d1: clampD(R + (HOME - R) / zoom), t: 0 };
      if (name) setFocus(name);
    }
    function pick(e: PointerEvent) {
      mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera);
      const s = ray.intersectObject(sphere)[0]; if (!s) return;
      const { lon, lat } = lonLatOf(globe.worldToLocal(s.point.clone()).normalize());
      if (zoomOf() < 1.7) { const n = nearest(lon, lat); const r = regionList.find((x) => x[0] === n); if (r) return flyTo(r[1], r[2], 2.2, n); }
      flyTo(lon, lat, Math.max(zoomOf() * 1.6, 2.2));
    }
    let ri = 0;
    api.current = {
      next() { if (!regionList.length) return; ri = (ri + 1) % regionList.length; const [n, lo, la] = regionList[ri]; flyTo(lo, la, 2.2, n); },
      out() { const { lon, lat } = lonLatOf(globe.worldToLocal(new THREE.Vector3(0, 0, 5)).normalize()); flyTo(lon, lat, 1); },
      setAuto(v) { autoSpin = v; setAuto(v); },
    };

    function resize() { renderer.setSize(window.innerWidth, window.innerHeight, false); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); }
    window.addEventListener("resize", resize); resize();

    const clock = new THREE.Clock();
    let hudT = 0;
    function frame() {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (fly) {
        fly.t = Math.min(1, fly.t + dt / 1.4);
        const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
        rotY = fly.y0 + (fly.y1 - fly.y0) * e; rotX = fly.x0 + (fly.x1 - fly.x0) * e; dist = fly.d0 + (fly.d1 - fly.d0) * e;
        if (fly.t >= 1) fly = null;
      } else if (!dragging) {
        velY *= 0.93; velX *= 0.93; rotY += velY + (autoSpin ? dt * 0.1 : 0); rotX = Math.max(-1.35, Math.min(1.35, rotX + velX));
      }
      globe.rotation.set(rotX, rotY, 0); globe.updateMatrixWorld();
      camera.position.set(0, 0, dist); camera.lookAt(0, 0, 0);
      U.time.value += dt;
      const z = zoomOf();
      renderer.render(scene, camera);
      layoutLabels(z);
      hudT += dt;
      if (hudT > 0.08) {
        hudT = 0;
        const { lon, lat } = lonLatOf(globe.worldToLocal(new THREE.Vector3(0, 0, 5)).normalize());
        setStats({ lon: lon.toFixed(1) + "°", lat: lat.toFixed(1) + "°", zoom: z.toFixed(1) + "×" });
        setTier(z >= 4.2 ? "Every place" : z >= 2.4 ? "Towns and cities" : z >= 1.7 ? "Major cities" : "Regions");
        if (!fly) setFocus(nearest(lon, lat));
      }
    }
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden && !dead && items.length) { clock.getDelta(); frame(); } };
    document.addEventListener("visibilitychange", onVis);

    fetch("/atlas/atlas.json")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<Atlas>; })
      .then((a) => {
        if (dead) return;
        const { W, H } = a;
        const mk = (n: string, x: number, y: number, kind: Item["kind"], pri: number, min: number): Item => {
          const lon = lonOf(x, W), lat = latOf(y, W, H);
          return { n, lon, lat, kind, pri, min, v: toVec(lon, lat, R * 1.002), el: null, w: 0, h: 0 };
        };
        const regs = a.regions.filter((r) => r.tier === 1);
        const seen = new Set(a.markers.map((m) => m.name + "|" + m.region));
        const places = a.places.filter((p) => !seen.has(p.name + "|" + p.region));
        items = [
          ...regs.map((r) => mk(r.name, r.x, r.y, "region", 0, 0)),
          ...a.markers.map((m) => mk(m.name, m.x, m.y, "city", m.kind === "city" ? 1 : 2, m.kind === "city" ? 1.7 : 2.4)),
          ...places.map((p) => mk(p.name, p.x, p.y, "place", 3, 4.2)),
        ];
        regionList = items.filter((i) => i.kind === "region").map((i) => [i.n, i.lon, i.lat]);
        setCounts({ r: regs.length, c: a.markers.length, p: places.length });
        setState("ready");
        clock.getDelta();
        if (!document.hidden) frame();
      })
      .catch(() => !dead && setState("failed"));

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onEnd); canvas.removeEventListener("pointercancel", onEnd);
      canvas.removeEventListener("wheel", onWheel);
      disposables.forEach((d) => d.dispose());
      renderer.forceContextLoss();
      layer.replaceChildren();
    };
  }, []);

  const btn = "pointer-events-auto rounded-md border bg-card/80 px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.12em] backdrop-blur hover:border-screen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-background text-foreground" data-testid="world-globe" data-state={state}>
      <style>{CSS}</style>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing" aria-label="Interactive 3D globe of the Pokémon world. Drag to spin, scroll or pinch to zoom." />
      <div ref={layerRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
      {state === "nogl" && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center" data-testid="globe-fallback">
          <p className="font-display text-lg font-semibold uppercase tracking-wider text-muted-foreground">Your browser can&apos;t show 3D graphics</p>
        </div>
      )}
      {state === "failed" && <p className="absolute inset-0 flex items-center justify-center font-display text-muted-foreground">Couldn&apos;t load the atlas. Try reloading.</p>}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap justify-between gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <div>
          <Link href="/guessr" className={btn + " mb-3 inline-block"}>← PokéGuessr</Link>
          <h1 className="font-display text-xl font-bold uppercase tracking-[0.14em] sm:text-3xl">Poké<span className="text-primary">IQ</span> World</h1>
          <p className="mt-1.5 font-pixel text-[10px] uppercase tracking-[0.14em] text-screen">
            {counts.r ? `${counts.r} regions · ${counts.c} towns and cities · ${counts.p} more places` : "Loading the world…"}
          </p>
        </div>
        <div className="text-right font-pixel text-[10px] uppercase leading-[1.9] tracking-[0.12em] tabular-nums text-muted-foreground">
          Lon <b className="font-normal text-foreground">{stats.lon}</b><br />Lat <b className="font-normal text-foreground">{stats.lat}</b><br />Zoom <b className="font-normal text-foreground">{stats.zoom}</b>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        <div>
          <p className="mb-1 font-pixel text-[10px] uppercase tracking-[0.14em] text-screen">Detail: {tier}</p>
          <p className="min-h-[1.3em] font-display text-base font-bold uppercase tracking-[0.14em] sm:text-2xl">{focus}</p>
          <p className="max-w-md text-xs text-muted-foreground">Drag to spin · scroll or pinch to zoom in on towns, routes and landmarks · tap a region to fly there</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={auto} onClick={() => api.current?.setAuto(!auto)} className={btn + (auto ? " border-primary text-primary" : "")}>Auto-spin</button>
          <button type="button" onClick={() => api.current?.next()} className={btn}>Next region</button>
          <button type="button" onClick={() => api.current?.out()} className={btn}>Zoom out</button>
        </div>
      </div>
    </div>
  );
}
