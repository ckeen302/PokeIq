import * as THREE from "three";
import type { Vec3 } from "@/lib/world-history/camera";
import { NOISE, col, makeGlow, makeParticles, merge, placed, rng, stoneMaterial, v3 } from "./kit";

/**
 * Set dressing shared by the exhibits, all procedural and original:
 * pagoda towers, ruined colonnades, houses with lit windows, towers of
 * light, foliage, crystals, lanterns, glowing screens, journal pages,
 * meteors and robed figures.
 */

/** A tiered pagoda: `tiers` storeys of wall and flared roof. */
export function makePagoda(o: { tiers: number; base: number; height: number; wall: string; roof: string; trim?: string; glow?: string }) {
  const wall: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [], trims: THREE.BufferGeometry[] = [];
  const tierH = o.height / o.tiers;
  for (let i = 0; i < o.tiers; i++) {
    const k = 1 - (i / o.tiers) * 0.55;
    const w = o.base * k;
    const y = i * tierH;
    wall.push(placed(new THREE.BoxGeometry(w * 0.72, tierH * 0.7, w * 0.72), [0, y + tierH * 0.35, 0]));
    // A flared roof: a squat, wide square pyramid.
    const roof = new THREE.ConeGeometry(w * 0.82, tierH * 0.42, 4, 1);
    roof.rotateY(Math.PI / 4);
    roofs.push(placed(roof, [0, y + tierH * 0.86, 0]));
    trims.push(placed(new THREE.BoxGeometry(w * 0.78, tierH * 0.06, w * 0.78), [0, y + tierH * 0.66, 0]));
  }
  const spire = new THREE.CylinderGeometry(0.05 * o.base, 0.12 * o.base, tierH * 1.2, 8);
  roofs.push(placed(spire, [0, o.height + tierH * 0.5, 0]));
  const group = new THREE.Group();
  const wallMat = stoneMaterial({ color: o.wall, roughness: 0.8, dirt: 0.35, emissive: o.glow ?? "#000000", emissiveK: o.glow ? 0.25 : 0 });
  const roofMat = new THREE.MeshStandardMaterial({ color: col(o.roof), roughness: 0.55, metalness: 0.35 });
  const trimMat = new THREE.MeshStandardMaterial({ color: col(o.trim ?? "#d8a548"), roughness: 0.4, metalness: 0.8, emissive: col(o.trim ?? "#d8a548"), emissiveIntensity: 0.08 });
  const meshes = [new THREE.Mesh(merge(wall), wallMat), new THREE.Mesh(merge(roofs), roofMat), new THREE.Mesh(merge(trims), trimMat)];
  meshes.forEach((m) => group.add(m));
  return { group, wallMat, roofMat, height: o.height, dispose() { meshes.forEach((m) => m.geometry.dispose()); wallMat.dispose(); roofMat.dispose(); trimMat.dispose(); } };
}

/** Ruins: broken columns and fallen blocks scattered over an area, with a few arches. */
export function makeRuins(o: { center: Vec3; radius: number; columns: number; arches?: number; color: string; seed?: number; height?: [number, number]; heightAt?: (x: number, z: number) => number }) {
  const r = rng(o.seed ?? 2);
  const geos: THREE.BufferGeometry[] = [];
  const [h0, h1] = o.height ?? [2, 7];
  const ground = (x: number, z: number) => o.heightAt?.(x, z) ?? o.center[1];
  for (let i = 0; i < o.columns; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * o.radius;
    const x = o.center[0] + Math.cos(a) * d, z = o.center[2] + Math.sin(a) * d;
    const y = ground(x, z);
    const h = h0 + r() * (h1 - h0) * (r() < 0.3 ? 0.4 : 1);
    const rad = 0.35 + r() * 0.25;
    geos.push(placed(new THREE.CylinderGeometry(rad * 0.9, rad, h, 12, 1), [x, y + h / 2, z], r() * 3, [1, 1, 1], (r() - 0.5) * 0.08, (r() - 0.5) * 0.08));
    geos.push(placed(new THREE.BoxGeometry(rad * 2.6, 0.35, rad * 2.6), [x, y + 0.17, z], r()));
    if (h > h1 * 0.7) geos.push(placed(new THREE.BoxGeometry(rad * 2.8, 0.4, rad * 2.8), [x, y + h, z], r()));
    if (r() < 0.6) geos.push(placed(new THREE.BoxGeometry(0.8 + r() * 1.6, 0.5 + r() * 0.7, 0.7 + r()), [x + (r() - 0.5) * 4, y + 0.3, z + (r() - 0.5) * 4], r() * 3, [1, 1, 1], r() * 0.3, r() * 0.3));
  }
  for (let i = 0; i < (o.arches ?? 0); i++) {
    const a = r() * Math.PI * 2, d = (0.3 + 0.6 * r()) * o.radius;
    const x = o.center[0] + Math.cos(a) * d, z = o.center[2] + Math.sin(a) * d;
    const y = ground(x, z);
    const span = 4 + r() * 3, h = 6 + r() * 3, rot = r() * Math.PI;
    const cx = Math.cos(rot), sz = Math.sin(rot);
    geos.push(placed(new THREE.BoxGeometry(1, h, 1.2), [x - (cx * span) / 2, y + h / 2, z + (sz * span) / 2], -rot));
    geos.push(placed(new THREE.BoxGeometry(1, h, 1.2), [x + (cx * span) / 2, y + h / 2, z - (sz * span) / 2], -rot));
    const arc = new THREE.TorusGeometry(span / 2, 0.5, 6, 16, Math.PI);
    geos.push(placed(arc, [x, y + h, z], -rot));
  }
  const mat = stoneMaterial({ color: o.color, roughness: 0.9, dirt: 0.55 });
  const mesh = new THREE.Mesh(merge(geos), mat);
  return { mesh, mat, dispose() { mesh.geometry.dispose(); mat.dispose(); } };
}

/** Houses with lit windows: simple boxes under pitched roofs, each with a warm emissive face. */
export function makeHouses(o: { spots: { pos: Vec3; rot?: number; size?: Vec3 }[]; wall: string; roof: string; window: string; windowK?: number }) {
  const walls: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [], wins: THREE.BufferGeometry[] = [];
  for (const s of o.spots) {
    const [w, h, d] = s.size ?? [4, 3, 3.5];
    const rot = s.rot ?? 0;
    const g = new THREE.BoxGeometry(w, h, d);
    walls.push(placed(g, [s.pos[0], s.pos[1] + h / 2, s.pos[2]], rot));
    const roof = new THREE.CylinderGeometry(0.01, d * 0.78, w * 1.1, 4, 1);
    roof.rotateZ(Math.PI / 2);
    roof.rotateX(Math.PI / 4);
    roofs.push(placed(roof, [s.pos[0], s.pos[1] + h + d * 0.28, s.pos[2]], rot, [1, 0.62, 1]));
    for (const wx of [-w * 0.25, w * 0.25]) {
      const win = new THREE.PlaneGeometry(w * 0.18, h * 0.3);
      const m = new THREE.Matrix4().makeRotationY(rot).multiply(new THREE.Matrix4().makeTranslation(wx, h * 0.55, d / 2 + 0.02));
      win.applyMatrix4(m);
      win.translate(s.pos[0], s.pos[1], s.pos[2]);
      wins.push(win);
    }
  }
  const wallMat = stoneMaterial({ color: o.wall, roughness: 0.85, dirt: 0.4 });
  const roofMat = new THREE.MeshStandardMaterial({ color: col(o.roof), roughness: 0.75 });
  const winMat = new THREE.MeshBasicMaterial({ color: col(o.window, o.windowK ?? 3) });
  const group = new THREE.Group();
  const meshes = [new THREE.Mesh(merge(walls), wallMat), new THREE.Mesh(merge(roofs), roofMat), new THREE.Mesh(merge(wins), winMat)];
  meshes.forEach((m) => group.add(m));
  return { group, winMat, dispose() { meshes.forEach((m) => m.geometry.dispose()); wallMat.dispose(); roofMat.dispose(); winMat.dispose(); } };
}

/** Towers of light (a city): tall boxes with a window shader that can drain to dark (uLit 1 → 0). */
export function makeCity(o: { center: Vec3; radius: number; count: number; height: [number, number]; color: string; seed?: number }) {
  const r = rng(o.seed ?? 4);
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < o.count; i++) {
    const a = r() * Math.PI * 2, d = 6 + Math.sqrt(r()) * o.radius;
    const h = o.height[0] + Math.pow(r(), 2) * (o.height[1] - o.height[0]) * (1 - d / (o.radius + 8) * 0.6);
    const w = 2 + r() * 3.5;
    geos.push(placed(new THREE.BoxGeometry(w, h, w * (0.7 + r() * 0.6)), [o.center[0] + Math.cos(a) * d, o.center[1] + h / 2, o.center[2] + Math.sin(a) * d], r() * Math.PI));
  }
  const u = { uLit: { value: 1 }, uColor: { value: col(o.color) }, uTime: { value: 0 }, uDrain: { value: v3(o.center) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vN; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uLit, uTime; uniform vec3 uColor, uDrain; varying vec3 vW; varying vec3 vN;
      void main(){
        vec2 f = abs(vN.x) > 0.5 ? vW.zy : vW.xy;
        vec2 cell = floor(f * vec2(1.3, 0.9));
        float on = step(0.45, whHash(vec3(cell, floor(vW.x * 0.1) + floor(vW.z * 0.1))));
        vec2 g = fract(f * vec2(1.3, 0.9));
        float win = step(0.18, g.x) * step(g.x, 0.82) * step(0.25, g.y) * step(g.y, 0.8);
        float top = abs(vN.y) > 0.5 ? 1.0 : 0.0;
        float dist = length(vW.xz - uDrain.xz);
        float lit = clamp(uLit * 1.4 - dist * 0.004 * (1.0 - uLit), 0.0, 1.0);
        vec3 c = vec3(0.02, 0.025, 0.05) + uColor * win * on * (1.0 - top) * lit * (2.0 + whNoise(vec3(cell, uTime * 0.2)));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(merge(geos), mat);
  return { mesh, u, dispose() { mesh.geometry.dispose(); mat.dispose(); } };
}

/** Foliage: instanced cards of leaf clusters (a canvas-drawn leaf sprite), swaying in the wind. */
export function makeFoliage(o: { points: Vec3[]; size: [number, number]; colors: [string, string]; seed?: number; light?: number }) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  const r = rng(o.seed ?? 6);
  for (let i = 0; i < 28; i++) {
    const x = 64 + (r() - 0.5) * 80, y = 64 + (r() - 0.5) * 80, a = r() * Math.PI;
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.fillStyle = `rgba(255,255,255,${0.75 + r() * 0.25})`;
    g.beginPath();
    g.ellipse(0, 0, 9 + r() * 10, 3.5 + r() * 3, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  const at = new Float32Array(o.points.length * 4);
  o.points.forEach((p, i) => at.set([p[0], p[1], p[2], r()], i * 4));
  geo.setAttribute("aAt", new THREE.InstancedBufferAttribute(at, 4));
  geo.instanceCount = o.points.length;
  const u = { tLeaf: { value: tex }, uTime: { value: 0 }, uSize0: { value: o.size[0] }, uSize1: { value: o.size[1] }, uC0: { value: col(o.colors[0]) }, uC1: { value: col(o.colors[1]) }, uLight: { value: o.light ?? 1 }, uFog: { value: col("#000000") }, uFogK: { value: 0.0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: false,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec4 aAt; uniform float uTime, uSize0, uSize1; varying vec2 vUv; varying float vSeed; varying float vDepth;
      void main(){
        float s = mix(uSize0, uSize1, aAt.w);
        vec4 c = modelViewMatrix * vec4(aAt.xyz, 1.0);
        float sway = sin(uTime * 1.3 + aAt.w * 30.0 + aAt.x * 0.2) * 0.08 * s;
        float a = aAt.w * 6.2831;
        vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
        c.xy += q * s + vec2(sway, 0.0);
        gl_Position = projectionMatrix * c;
        vUv = uv; vSeed = aAt.w; vDepth = -c.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tLeaf; uniform vec3 uC0, uC1, uFog; uniform float uLight, uFogK; varying vec2 vUv; varying float vSeed; varying float vDepth;
      void main(){
        float a = texture2D(tLeaf, vUv).a;
        if (a < 0.5) discard;
        vec3 c = mix(uC0, uC1, vSeed) * uLight * (0.6 + 0.4 * vUv.y);
        c = mix(c, uFog, 1.0 - exp(-uFogK * vDepth));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, u, dispose() { geo.dispose(); base.dispose(); mat.dispose(); tex.dispose(); } };
}

/** Crystals: faceted spires with an iridescent, glowing shader (Terastal crystals, ice, Necrozma's prisms). */
export function makeCrystals(o: { spots: { pos: Vec3; h: number; r?: number; tilt?: Vec3 }[]; colors: [string, string]; glow?: number; seed?: number }) {
  const geos: THREE.BufferGeometry[] = [];
  const r = rng(o.seed ?? 12);
  for (const s of o.spots) {
    const rad = s.r ?? s.h * 0.18;
    const body = new THREE.CylinderGeometry(rad * 0.7, rad, s.h * 0.75, 6, 1);
    const tip = new THREE.ConeGeometry(rad * 0.7, s.h * 0.25, 6, 1);
    tip.translate(0, s.h * 0.875, 0);
    body.translate(0, s.h * 0.375, 0);
    const g = merge([body, tip]);
    const t = s.tilt ?? [(r() - 0.5) * 0.6, r() * 6, (r() - 0.5) * 0.6];
    geos.push(placed(g, s.pos, t[1], [1, 1, 1], t[0], t[2]));
  }
  const geo = merge(geos).toNonIndexed();
  geo.computeVertexNormals();
  const u = { uC0: { value: col(o.colors[0]) }, uC1: { value: col(o.colors[1]) }, uGlow: { value: o.glow ?? 1 }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uC0, uC1; uniform float uGlow, uTime; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float f = max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vV))));
        vec3 irid = 0.5 + 0.5 * cos(6.2831 * (f * 1.4 + vW.y * 0.05 + vec3(0.0, 0.33, 0.67)) + uTime * 0.2);
        vec3 c = mix(uC0, uC1, f) * (0.35 + 0.9 * f) + irid * pow(f, 2.0) * 0.8;
        c += uC1 * pow(f, 4.0) * 2.0;
        gl_FragColor = vec4(c * uGlow, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, u, dispose() { geo.dispose(); mat.dispose(); } };
}

/** Lanterns: small glowing paper lanterns with halos, optionally drifting upward (sky lanterns). */
export function makeLanterns(o: { points: Vec3[]; color: string; size?: number; intensity?: number; seed?: number }) {
  const r = rng(o.seed ?? 21);
  const n = o.points.length;
  const geo = new THREE.SphereGeometry((o.size ?? 0.35), 10, 8);
  geo.scale(1, 1.3, 1);
  const mat = new THREE.MeshBasicMaterial({ color: col(o.color, o.intensity ?? 4) });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const base = o.points.map((p) => v3(p));
  const phase = o.points.map(() => r() * 10);
  const m = new THREE.Matrix4();
  base.forEach((p, i) => { m.makeTranslation(p.x, p.y, p.z); mesh.setMatrixAt(i, m); });
  const glows = makeParticlesFromPoints(o.points, (o.size ?? 0.35) * 7, o.color, (o.intensity ?? 4) * 0.25);
  const group = new THREE.Group();
  group.add(mesh, glows.points);
  return {
    group,
    mesh,
    /** Rise: each lantern floats up by `rise` (world units), with a gentle sway. */
    update(ambient: number, rise = 0, px = 600) {
      for (let i = 0; i < n; i++) {
        const p = base[i];
        const sway = Math.sin(ambient * 0.6 + phase[i]) * 0.15;
        m.makeTranslation(p.x + sway, p.y + rise * (0.6 + 0.4 * ((phase[i] * 7) % 1)) + Math.sin(ambient * 1.1 + phase[i]) * 0.05, p.z);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      glows.update(mesh, px);
    },
    dispose() { geo.dispose(); mat.dispose(); glows.dispose(); },
  };
}

/** Halos that follow an instanced mesh's instances (for lanterns). */
function makeParticlesFromPoints(points: Vec3[], size: number, color: string, intensity: number) {
  const n = points.length;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  points.forEach((p, i) => pos.set(p, i * 3));
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const u = { uColor: { value: col(color, intensity) }, uSize: { value: size }, uPixel: { value: 600 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `uniform float uSize, uPixel; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uSize * uPixel / -mv.z, 0.0, 160.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a * a; gl_FragColor = vec4(uColor * a, a); }`,
  });
  const points3 = new THREE.Points(geo, mat);
  points3.frustumCulled = false;
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  return {
    points: points3,
    update(mesh: THREE.InstancedMesh, px: number) {
      for (let i = 0; i < n; i++) {
        mesh.getMatrixAt(i, m);
        v.setFromMatrixPosition(m);
        pos.set([v.x, v.y, v.z], i * 3);
      }
      (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      u.uPixel.value = px;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** A glowing screen (or page) drawn on a canvas; redraw() repaints it. */
export function makeCanvasPanel(o: { w: number; h: number; px: [number, number]; draw: (g: CanvasRenderingContext2D, w: number, h: number, t: number) => void; emissive?: number; basic?: boolean }) {
  const cv = document.createElement("canvas");
  cv.width = o.px[0];
  cv.height = o.px[1];
  const g = cv.getContext("2d")!;
  o.draw(g, cv.width, cv.height, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = o.basic === false
    ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: col("#ffffff"), emissiveMap: tex, emissiveIntensity: o.emissive ?? 0.15, side: THREE.DoubleSide })
    : new THREE.MeshBasicMaterial({ map: tex, color: col("#ffffff", o.emissive ?? 1.6), side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), mat);
  return {
    mesh,
    mat,
    redraw(t: number) { o.draw(g, cv.width, cv.height, t); tex.needsUpdate = true; },
    dispose() { mesh.geometry.dispose(); mat.dispose(); tex.dispose(); },
  };
}

/** A journal page: aged paper with the game's words in an old hand. */
export function makePage(o: { lines: string[]; font: string; w?: number; ink?: string }) {
  return makeCanvasPanel({
    w: o.w ?? 1.6,
    h: (o.w ?? 1.6) * 1.3,
    px: [512, 666],
    basic: false,
    emissive: 0.35,
    draw(g, w, h) {
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#efe2c0");
      grad.addColorStop(1, "#d8c393");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      const r = rng(9);
      for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(110,80,40,${r() * 0.05})`; g.fillRect(r() * w, r() * h, 2, 2); }
      g.strokeStyle = "rgba(120,90,50,0.25)";
      for (let y = 120; y < h - 30; y += 46) { g.beginPath(); g.moveTo(36, y); g.lineTo(w - 36, y); g.stroke(); }
      g.fillStyle = o.ink ?? "#2a1d10";
      g.font = `italic 600 34px ${o.font}`;
      let y = 110;
      for (const line of o.lines) {
        const words = line.split(" ");
        let cur = "";
        for (const wd of words) {
          const next = cur ? `${cur} ${wd}` : wd;
          if (g.measureText(next).width > w - 80 && cur) { g.fillText(cur, 40, y); y += 46; cur = wd; } else cur = next;
        }
        if (cur) { g.fillText(cur, 40, y); y += 46; }
        y += 10;
      }
    },
  });
}

/** A meteor: a white-hot head, a long fiery trail and sparks, moved along a path by the caller. */
export function makeMeteor(o: { size: number; color: string; trail: number }) {
  const group = new THREE.Group();
  const head = makeGlow({ pos: [0, 0, 0], size: o.size * 4, color: "#fff4dc", intensity: 3 });
  const corona = makeGlow({ pos: [0, 0, 0], size: o.size * 12, color: o.color, intensity: 1.6 });
  group.add(head.sprite, corona.sprite);
  const trailGeo = new THREE.CylinderGeometry(o.size * 0.9, 0, o.trail, 24, 1, true);
  trailGeo.translate(0, -o.trail / 2, 0);
  const u = { uColor: { value: col(o.color) }, uOpacity: { value: 1 }, uTime: { value: 0 } };
  const trailMat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform vec3 uColor; uniform float uOpacity, uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
        float vy = clamp(vUv.y, 0.0, 1.0);
        float along = pow(vy, 2.2);
        float n = 0.6 + 0.8 * whNoise(vec3(vUv.x * 8.0, vUv.y * 20.0 - uTime * 6.0, 0.0));
        vec3 c = mix(uColor, vec3(1.0, 0.95, 0.85), pow(vy, 6.0)) * f * along * n * 3.0;
        gl_FragColor = vec4(c * uOpacity, f * along * uOpacity);
      }`,
  });
  const trail = new THREE.Mesh(trailGeo, trailMat);
  group.add(trail);
  const sparks = makeParticles({ count: 600, shape: "sphere", center: [0, 0, 0], extent: [o.size, o.size, o.size], velocity: [0, 0, 0], spread: [o.size * 6, o.size * 6, o.size * 6], life: 1.2, size: [o.size * 0.08, o.size * 0.25], colors: ["#ffffff", o.color, "#ff3a10"], intensity: 2.5, fadeIn: 0.02, fadeOut: 0.6 });
  return {
    group,
    sparks,
    u,
    /** Puts the head at `pos`, pointing the trail back along `dir`. */
    at(pos: THREE.Vector3, dir: THREE.Vector3) {
      group.position.copy(pos);
      trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      sparks.u.uCenter.value.copy(pos);
    },
    dispose() { head.dispose(); corona.dispose(); trailGeo.dispose(); trailMat.dispose(); sparks.dispose(); },
  };
}

/** A robed figure or statue (a lathe silhouette with head and arms): AZ, the twin heroes, a hero's statue. */
export function makeRobed(o: { height: number; color: string; emissive?: string; emissiveK?: number; sword?: boolean; shield?: boolean; stone?: boolean }) {
  const h = o.height;
  const prof: THREE.Vector2[] = [
    [0.0, 0], [0.34, 0], [0.32, 0.12], [0.27, 0.4], [0.22, 0.62], [0.2, 0.74], [0.16, 0.8], [0.09, 0.83], [0.0, 0.84],
  ].map(([x, y]) => new THREE.Vector2(x * h * 0.55, y * h));
  const body = new THREE.LatheGeometry(prof, 24);
  const head = new THREE.SphereGeometry(h * 0.075, 16, 12);
  head.translate(0, h * 0.9, 0);
  const armL = new THREE.CylinderGeometry(h * 0.035, h * 0.045, h * 0.36, 8);
  armL.translate(0, -h * 0.18, 0);
  armL.rotateZ(0.25);
  armL.translate(-h * 0.13, h * 0.76, 0);
  const armR = armL.clone();
  armR.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  const parts: THREE.BufferGeometry[] = [body, head, armL, armR];
  if (o.sword) {
    const blade = new THREE.BoxGeometry(h * 0.03, h * 0.5, h * 0.01);
    blade.translate(h * 0.2, h * 0.75, h * 0.05);
    parts.push(blade);
  }
  if (o.shield) {
    const sh = new THREE.CylinderGeometry(h * 0.13, h * 0.13, h * 0.02, 20);
    sh.rotateX(Math.PI / 2);
    sh.translate(-h * 0.2, h * 0.6, h * 0.08);
    parts.push(sh);
  }
  const geo = merge(parts);
  const mat = o.stone ? stoneMaterial({ color: o.color, roughness: 0.85, dirt: 0.5 }) : new THREE.MeshStandardMaterial({ color: col(o.color), roughness: 0.7, emissive: col(o.emissive ?? "#000000"), emissiveIntensity: o.emissiveK ?? 0 });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, mat, dispose() { geo.dispose(); mat.dispose(); } };
}

/** A meadow: flowers as soft dots in a palette over the ground. uBloom (a radius around uCenter) opens them outward; 0 keeps them closed. */
export function makeMeadow(o: { points: Vec3[]; colors: string[]; size: [number, number]; center: Vec3; intensity?: number; seed?: number }) {
  const n = o.points.length;
  const r = rng(o.seed ?? 17);
  const pos = new Float32Array(n * 3), colors = new Float32Array(n * 3), seeds = new Float32Array(n);
  const pal = o.colors.map((c) => col(c));
  o.points.forEach((p, i) => {
    pos.set(p, i * 3);
    const c = pal[Math.floor(r() * pal.length) % pal.length];
    colors.set([c.r, c.g, c.b], i * 3);
    seeds[i] = r();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  const u = { uPixel: { value: 600 }, uSize0: { value: o.size[0] }, uSize1: { value: o.size[1] }, uBloom: { value: 1e4 }, uCenter: { value: v3(o.center) }, uTime: { value: 0 }, uIntensity: { value: o.intensity ?? 1 }, uOpacity: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSeed;
      uniform float uPixel, uSize0, uSize1, uBloom, uTime; uniform vec3 uCenter;
      varying vec3 vColor; varying float vOpen;
      void main(){
        float d = length(position.xz - uCenter.xz) + aSeed * 5.0;
        float open = smoothstep(uBloom, uBloom - 6.0, d);
        vec3 p = position + vec3(sin(uTime * 1.2 + aSeed * 40.0), 0.0, cos(uTime * 0.9 + aSeed * 30.0)) * 0.03;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(mix(uSize0, uSize1, aSeed) * open * uPixel / max(0.05, -mv.z), 0.0, 48.0);
        vColor = aColor; vOpen = open;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity, uOpacity; varying vec3 vColor; varying float vOpen;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        float ang = atan(q.y, q.x);
        float petals = 0.36 + 0.1 * cos(ang * 5.0);
        float a = smoothstep(petals, petals - 0.12, d);
        vec3 c = mix(vColor, vec3(1.0, 0.86, 0.45), smoothstep(0.12, 0.0, d));
        float k = a * uOpacity * step(0.01, vOpen);
        gl_FragColor = vec4(c * uIntensity, k);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, u, dispose() { geo.dispose(); mat.dispose(); } };
}
