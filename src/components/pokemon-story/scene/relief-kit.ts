import * as THREE from "three";
import type { Vec3 } from "@/lib/world-history/camera";
import { NOISE, col, merge, placed, rng } from "@/components/world-history/scene/kit";

/**
 * Lit terrain for VII: a region map raised into a relief (land, coast and
 * mountains read from the map's own colours), a sea that runs to the horizon
 * under the same light, and a night arena with tiers, floodlights and a crowd.
 * The lighting is analytic (one sun, a sky and a ground colour), so the map,
 * the sea and the arena all match without extra scene lights.
 */

export interface TerrainLight { sunDir: THREE.Vector3; sun: THREE.Color; sky: THREE.Color; ground: THREE.Color }

const LIGHT_PARS = /* glsl */ `
  uniform vec3 uSunDir, uSun, uSky, uGround, uSea;
  vec3 lightAt(vec3 n){ float d = max(dot(n, uSunDir), 0.0); return uSun * d + mix(uGround, uSky, n.y * 0.5 + 0.5); }
  // The open sea: deep colour, long low swells, a soft broad sun sheen (no hot specular blob).
  vec3 seaAt(vec3 w, float t){
    float sw = whNoise(vec3(w.xz * 0.045, t * 0.05)) * 0.6 + whNoise(vec3(w.xz * 0.16, t * 0.12)) * 0.4;
    vec3 n = normalize(vec3((sw - 0.5) * 0.18, 1.0, (whNoise(vec3(w.zx * 0.05, t * 0.07)) - 0.5) * 0.18));
    vec3 v = normalize(cameraPosition - w);
    vec3 h = normalize(v + uSunDir);
    float sheen = max(dot(n, h), 0.0); sheen = sheen * sheen; sheen = sheen * sheen; sheen = sheen * sheen;
    float fres = 1.0 - max(dot(n, v), 0.0); fres = fres * fres * fres;
    return uSea * lightAt(n) * (0.85 + 0.3 * sw) + uSun * sheen * 0.05 + uSky * fres * 0.25;
  }`;

function lightUniforms(l: TerrainLight, sea: string) {
  return { uSunDir: { value: l.sunDir }, uSun: { value: l.sun }, uSky: { value: l.sky }, uGround: { value: l.ground }, uSea: { value: col(sea) } };
}

/** The shared light the terrain reads: update it each frame from the chapter's lights. */
export function terrainLight(): TerrainLight {
  return { sunDir: new THREE.Vector3(0.4, 0.8, 0.4).normalize(), sun: new THREE.Color(1, 1, 1), sky: new THREE.Color(0.4, 0.5, 0.7), ground: new THREE.Color(0.1, 0.1, 0.12) };
}

export function syncTerrainLight(l: TerrainLight, key: THREE.DirectionalLight, hemi: THREE.HemisphereLight) {
  l.sunDir.copy(key.position).sub(key.target.position).normalize();
  l.sun.copy(key.color).multiplyScalar(key.intensity * 0.62);
  l.sky.copy(hemi.color).multiplyScalar(hemi.intensity * 0.45);
  l.ground.copy(hemi.groundColor).multiplyScalar(hemi.intensity * 0.45);
}

/** The sea, a big lit plane that melts into the fog at the horizon. */
export function makeSea(o: { size: number; center: Vec3; color: string; light: TerrainLight }) {
  const geo = new THREE.PlaneGeometry(o.size, o.size).rotateX(-Math.PI / 2);
  const u = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...lightUniforms(o.light, o.color), uTime: { value: 0 }, uVis: { value: 1 } };
  u.uSunDir.value = o.light.sunDir; u.uSun.value = o.light.sun; u.uSky.value = o.light.sky; u.uGround.value = o.light.ground;
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    fog: true,
    vertexShader: /* glsl */ `#include <fog_pars_vertex>
      varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `${NOISE}
      #include <fog_pars_fragment>
      uniform float uTime, uVis; varying vec3 vW;
      ${LIGHT_PARS}
      void main(){ gl_FragColor = vec4(seaAt(vW, uTime), uVis);
        #include <fog_fragment>
      }`,
  });
  mat.transparent = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -2;
  mesh.position.set(...o.center);
  return { mesh, u, dispose() { geo.dispose(); mat.dispose(); } };
}

/**
 * A region map raised into lit relief. Land is read from the map's colours
 * (warm or green over blue), mountains from its tan and grey ground; both are
 * blurred into soft slopes, with beaches at the coast. The map's own painting
 * is the albedo, lit by the shared sun, and its sea shades into the open sea
 * so the map has no edge. `uA` raises the land out of the sea as we arrive.
 */
export async function makeReliefMap(o: { src: string; w: number; h: number; width: number; light: TerrainLight; sea: string; tint: string; relief?: number; cols?: number; signal?: AbortSignal }) {
  const tex = await new THREE.TextureLoader().loadAsync(o.src);
  if (o.signal?.aborted) { tex.dispose(); throw new DOMException("aborted", "AbortError"); }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const gw = o.cols ?? 180, gh = Math.max(8, Math.round((gw * o.h) / o.w));
  const cv = document.createElement("canvas");
  cv.width = gw; cv.height = gh;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(tex.image as CanvasImageSource, 0, 0, gw, gh);
  const px = g.getImageData(0, 0, gw, gh).data;
  const n = gw * gh;
  const land0 = new Float32Array(n), mount0 = new Float32Array(n), detail0 = new Float32Array(n);
  const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++) {
    const r = px[i * 4] / 255, gg = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
    const l = ss(0.0, 0.12, Math.max(r, gg) - b);
    land0[i] = l;
    const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    // Tan highlands (red over green) and grey-white peaks (bright, unsaturated).
    mount0[i] = l * Math.max(ss(0.0, 0.08, r - gg), ss(0.55, 0.8, (r + gg + b) / 3) * ss(0.2, 0.05, sat) * 1.4);
    detail0[i] = (r + gg + b) / 3;
  }
  const blur = (a: Float32Array, rad: number, passes: number): Float32Array => {
    let src: Float32Array = a;
    for (let p = 0; p < passes; p++) {
      const tmp = new Float32Array(n), out = new Float32Array(n);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let s = 0, c = 0; for (let k = -rad; k <= rad; k++) { const xx = x + k; if (xx >= 0 && xx < gw) { s += src[y * gw + xx]; c++; } } tmp[y * gw + x] = s / c; }
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let s = 0, c = 0; for (let k = -rad; k <= rad; k++) { const yy = y + k; if (yy >= 0 && yy < gh) { s += tmp[yy * gw + x]; c++; } } out[y * gw + x] = s / c; }
      src = out;
    }
    return src;
  };
  const land = blur(land0, 1, 2), mount = blur(mount0, 2, 2), detail = blur(detail0, 1, 1);
  const height = (o.width * o.h) / o.w;
  const geo = new THREE.PlaneGeometry(o.width, height, gw - 1, gh - 1).rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const R = o.relief ?? 2.6;
  const nr = rng(7);
  for (let i = 0; i < n; i++) {
    const l = land[i];
    const y = Math.pow(Math.max(l, 0), 0.7) * 0.45 + mount[i] * R * (0.75 + detail[i] * 0.5) + (l > 0.5 ? (nr() - 0.5) * 0.05 : 0) - (1 - l) * 0.25;
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  const u = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...lightUniforms(o.light, o.sea), uMap: { value: tex }, uA: { value: 1 }, uVis: { value: 1 }, uTime: { value: 0 }, uTint: { value: col(o.tint) }, uCoast: { value: 0.3 }, uTexel: { value: new THREE.Vector2(1 / o.w, 1 / o.h) } };
  u.uSunDir.value = o.light.sunDir; u.uSun.value = o.light.sun; u.uSky.value = o.light.sky; u.uGround.value = o.light.ground;
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    fog: true,
    vertexShader: /* glsl */ `#include <fog_pars_vertex>
      uniform float uA; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      void main(){ vUv = uv; vec3 p = position; float k = uA * uA * (3.0 - 2.0 * uA); p.y = p.y * k - 0.3 * (1.0 - k); vec4 wp = modelMatrix * vec4(p, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * mix(vec3(0.0, 1.0, 0.0), normal, k)); vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `${NOISE}
      #include <fog_pars_fragment>
      uniform sampler2D uMap; uniform float uA, uTime, uCoast, uVis; uniform vec3 uTint; uniform vec2 uTexel;
      varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      ${LIGHT_PARS}
      float landAt(vec2 uv){ vec3 t = texture2D(uMap, uv).rgb; return smoothstep(0.0, 0.06, max(t.r, t.g) - t.b); }
      void main(){
        vec3 t = texture2D(uMap, vUv).rgb;
        float land = landAt(vUv);
        vec3 n = normalize(vN);
        // Land: the map's painting, a touch less saturated, lit by the sun; the paths become pale dust tracks.
        float lum = dot(t, vec3(0.3, 0.59, 0.11));
        vec3 alb = mix(vec3(lum), t, 0.82) * 0.9;
        alb *= 0.92 + 0.16 * whNoise(vW * 0.9);
        vec3 lc = alb * lightAt(n);
        // The map's sea: shallows by the coast shade out into the open sea's colour.
        float shallow = clamp((t.g - 0.12) * 2.2, 0.0, 1.0);
        vec3 sea = seaAt(vW, uTime);
        vec3 shal = mix(sea, t * 0.55 * lightAt(vec3(0.0, 1.0, 0.0)) + uSea * 0.2, shallow * 0.6);
        vec3 c = mix(shal, lc, land);
        // A faint living coastline in the region's colour, and a foam line.
        vec2 o = uTexel * 1.5;
        float around = (landAt(vUv + vec2(o.x, 0.0)) + landAt(vUv - vec2(o.x, 0.0)) + landAt(vUv + vec2(0.0, o.y)) + landAt(vUv - vec2(0.0, o.y))) * 0.25;
        float coast = clamp(abs(land - around) * 2.5, 0.0, 1.0);
        float scan = 0.6 + 0.4 * smoothstep(0.6, 1.0, sin(vW.z * 0.25 - uTime * 1.6));
        c += (uTint * uCoast * scan + vec3(0.5) * 0.15 * lightAt(vec3(0.0, 1.0, 0.0))) * coast;
        // No hard edge: the map melts into the open sea, and rises from it as we arrive.
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = smoothstep(0.0, 0.1, e.x) * smoothstep(0.0, 0.1, e.y) * uA;
        c = mix(sea, c, edge);
        gl_FragColor = vec4(c, uVis);
        #include <fog_fragment>
      }`,
  });
  mat.transparent = true;
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, u, width: o.width, height, dispose() { geo.dispose(); mat.dispose(); tex.dispose(); } };
}

/**
 * A night arena: a lower and an upper tier of seat rows (aisles, sector
 * colours, a lit concourse band between them, a dark back wall), a roof
 * canopy with a lit underside, floodlight masts with lamp banks round the
 * rim, and a lit battle floor with court lines. Returns crowd points along
 * the actual seat rows. Elliptical (z scaled by `squash`).
 */
export function makeArena(o: { inner: number; outer: number; height: number; squash?: number; masts?: number; seed?: number; crowd: number }) {
  const sq = o.squash ?? 0.82;
  const r = rng(o.seed ?? 21);
  const span = o.outer - o.inner;
  const r1 = o.inner + span * 0.48, h1 = o.height * 0.42, gap = o.height * 0.12;
  // Profile: floor wall, lower tier rows, concourse band, upper tier rows (steeper), back wall, canopy.
  const prof: THREE.Vector2[] = [new THREE.Vector2(o.inner - 0.4, 0), new THREE.Vector2(o.inner - 0.4, 0.9)];
  const rows: [number, number][] = [];
  const N1 = 12, N2 = 14;
  for (let i = 0; i < N1; i++) { const rr = o.inner + ((r1 - o.inner) * i) / N1, y = 0.9 + ((h1 - 0.9) * i) / N1; prof.push(new THREE.Vector2(rr, y), new THREE.Vector2(rr + (r1 - o.inner) / N1, y)); rows.push([rr + 0.15, y]); }
  prof.push(new THREE.Vector2(r1, h1 + gap), new THREE.Vector2(r1 + 0.6, h1 + gap));
  for (let i = 0; i < N2; i++) { const rr = r1 + 0.6 + ((o.outer - r1 - 0.6) * i) / N2, y = h1 + gap + ((o.height - h1 - gap) * i) / N2; prof.push(new THREE.Vector2(rr, y), new THREE.Vector2(rr + (o.outer - r1 - 0.6) / N2, y)); rows.push([rr + 0.15, y]); }
  prof.push(new THREE.Vector2(o.outer, o.height + 1.6), new THREE.Vector2(o.outer - span * 0.32, o.height + 2.4), new THREE.Vector2(o.outer - span * 0.32, o.height + 2.1), new THREE.Vector2(o.outer + 0.6, o.height + 1.2), new THREE.Vector2(o.outer + 1.0, 0));
  const bowlGeo = new THREE.LatheGeometry(prof, 120);
  bowlGeo.scale(1, 1, sq);
  const u = { uTime: { value: 0 }, uLit: { value: 0 }, uOuter: { value: o.outer }, uDr1: { value: (r1 - o.inner) / N1 }, uInner: { value: o.inner }, uR1: { value: r1 }, uH1: { value: h1 }, uGap: { value: gap }, uH: { value: o.height }, uSq: { value: sq } };
  const bowlMat = new THREE.ShaderMaterial({
    uniforms: u,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec3 vL; varying vec3 vN; void main(){ vL = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `${NOISE}
      uniform float uTime, uLit, uOuter, uDr1, uInner, uR1, uH1, uGap, uH, uSq; varying vec3 vL; varying vec3 vN;
      void main(){
        vec3 n = normalize(vN);
        float rad = length(vec2(vL.x, vL.z / uSq));
        float ang = atan(vL.z / uSq, vL.x);
        float y = vL.y;
        // Light from the floodlights: strongest on the seats that face the floor, falling off up the stand.
        float face = clamp(n.y * 0.6 + 0.4, 0.0, 1.0);
        float lit = uLit * (0.35 + 0.65 * face) * (1.0 - 0.35 * clamp((rad - uInner) / (uR1 * 1.6 - uInner), 0.0, 1.0));
        // Seat rows: a tread and a riser per row; sectors of colour split by aisles.
        float sector = floor(ang / 6.2832 * 24.0 + 24.0);
        float aisle = smoothstep(0.035, 0.02, abs(fract(ang / 6.2832 * 24.0) - 0.5) - 0.44);
        vec3 seatA = vec3(0.12, 0.17, 0.34), seatB = vec3(0.26, 0.1, 0.13), seatC = vec3(0.15, 0.16, 0.21);
        float h = whHash(vec3(sector, 3.0, 1.0));
        vec3 seat = h < 0.45 ? seatA : h < 0.6 ? seatB : seatC;
        // Each row: seat backs, then a dark gap at the riser.
        float rf = fract((rad - uInner) / uDr1);
        float row = smoothstep(0.0, 0.12, rf) * smoothstep(1.0, 0.8, rf);
        vec3 c = mix(vec3(0.05, 0.05, 0.065), seat, 0.35 + 0.65 * row);
        c = mix(c, vec3(0.13, 0.13, 0.15), aisle);
        c *= 0.85 + 0.15 * whHash(vec3(floor(rad * 2.0), floor(ang * 60.0), 7.0));
        vec3 col = c * (0.05 + lit * 0.95);
        // The concourse band between the tiers glows warm; the canopy underside carries a ring of lamps.
        float band = step(uH1, y) * step(y, uH1 + uGap) * step(rad, uR1 + 0.7);
        col = mix(col, vec3(1.0, 0.75, 0.45) * (0.25 + 0.6 * uLit) * (0.7 + 0.3 * step(0.5, fract(ang * 40.0))), band);
        float canopy = step(uH + 1.5, y);
        float under = canopy * step(n.y, -0.2);
        col = mix(col, vec3(0.05, 0.055, 0.07) * (0.4 + lit), canopy);
        // The outside wall: dark concrete with lit entrance slots.
        float wall = step(uOuter - 0.02, rad) * (1.0 - canopy);
        float slot = step(0.9, fract(ang * 36.0 / 6.2832)) * step(0.3, y) * step(y, uH * 0.3);
        col = mix(col, vec3(0.06, 0.06, 0.07) * (0.3 + 0.4 * uLit) + vec3(1.0, 0.8, 0.55) * slot * (0.12 + 0.3 * uLit), wall);
        col += under * vec3(0.9, 0.95, 1.0) * uLit * 0.7 * step(0.7, fract(ang * 18.0)) * smoothstep(0.0, 0.6, abs(rad - (uR1 + (uH - uH1)) ));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const bowl = new THREE.Mesh(bowlGeo, bowlMat);

  // The battle floor: a dark arena floor with a lit court, lines and a centre ring.
  const fc = document.createElement("canvas"); fc.width = 512; fc.height = 512;
  const fg = fc.getContext("2d")!;
  const gr = fg.createRadialGradient(256, 256, 20, 256, 256, 256);
  gr.addColorStop(0, "#1c3a6a"); gr.addColorStop(1, "#0a1428");
  fg.fillStyle = gr; fg.fillRect(0, 0, 512, 512);
  fg.fillStyle = "#1f5aa8"; fg.fillRect(126, 186, 260, 140);
  fg.strokeStyle = "rgba(235,245,255,0.95)"; fg.lineWidth = 4;
  fg.strokeRect(126, 186, 260, 140);
  fg.beginPath(); fg.moveTo(256, 186); fg.lineTo(256, 326); fg.stroke();
  fg.beginPath(); fg.arc(256, 256, 34, 0, Math.PI * 2); fg.stroke();
  fg.strokeStyle = "rgba(255,210,122,0.8)"; fg.lineWidth = 3;
  fg.beginPath(); fg.arc(256, 256, 236, 0, Math.PI * 2); fg.stroke();
  for (const sx of [150, 362]) { fg.strokeStyle = "rgba(235,245,255,0.7)"; fg.lineWidth = 2; fg.strokeRect(sx - 16, 236, 32, 40); }
  const floorTex = new THREE.CanvasTexture(fc);
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.anisotropy = 8;
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.1, emissive: col("#ffffff"), emissiveMap: floorTex, emissiveIntensity: 0 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(o.inner - 0.4, 72).rotateX(-Math.PI / 2).scale(1, 1, sq), floorMat);
  floor.position.y = 0.02;

  // Floodlight masts round the rim: a lattice-ish mast and a tilted bank of lamps, merged.
  const M = o.masts ?? 6;
  const mastParts: THREE.BufferGeometry[] = [], lampParts: THREE.BufferGeometry[] = [];
  const heads: Vec3[] = [];
  const mastH = o.height + 9;
  for (let k = 0; k < M; k++) {
    const a = (k / M) * Math.PI * 2;
    const x = Math.cos(a) * (o.outer + 1.6), z = Math.sin(a) * (o.outer + 1.6) * sq;
    mastParts.push(placed(new THREE.CylinderGeometry(0.18, 0.4, mastH, 6), [x, mastH / 2, z]));
    for (let s = 2; s < mastH; s += 2.2) mastParts.push(placed(new THREE.BoxGeometry(0.9, 0.06, 0.06), [x, s, z], -a));
    // The bank faces the floor, tilted down.
    const face = new THREE.Group();
    face.position.set(x, mastH, z);
    face.lookAt(0, 0, 0);
    face.updateMatrixWorld();
    const frame = new THREE.BoxGeometry(3.6, 2.2, 0.3).applyMatrix4(face.matrixWorld);
    mastParts.push(frame);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) lampParts.push(new THREE.PlaneGeometry(0.7, 0.5).translate(-1.27 + i * 0.85, -0.6 + j * 0.62, 0.17).applyMatrix4(face.matrixWorld));
    heads.push([x, mastH, z]);
  }
  const mastGeo = merge(mastParts);
  mastParts.forEach((g) => g.dispose());
  const mastMat = new THREE.MeshStandardMaterial({ color: col("#2a2e38"), roughness: 0.6, metalness: 0.6 });
  const masts = new THREE.Mesh(mastGeo, mastMat);
  const lampGeo = merge(lampParts);
  lampParts.forEach((g) => g.dispose());
  const lampMat = new THREE.MeshBasicMaterial({ color: col("#ffffff", 0.05), side: THREE.DoubleSide });
  const lamps = new THREE.Mesh(lampGeo, lampMat);

  // The crowd, on the real seat rows (skipping aisles).
  const crowd: Vec3[] = [];
  for (let i = 0; i < o.crowd; i++) {
    const [rr, y] = rows[Math.floor(r() * rows.length)];
    let a = r() * Math.PI * 2;
    const f = (a / (Math.PI * 2)) * 24;
    if (Math.abs((f % 1) - 0.5) > 0.42) a += 0.04;
    crowd.push([Math.cos(a) * rr, y + 0.35, Math.sin(a) * rr * sq]);
  }

  const group = new THREE.Group();
  group.add(bowl, floor, masts, lamps);
  return {
    group, u, heads, crowd, floorMat, lampMat,
    setLit(k: number) { u.uLit.value = k; floorMat.emissiveIntensity = 0.32 * k; lampMat.color.setScalar(0.05 + 6 * k); },
    dispose() { bowlGeo.dispose(); bowlMat.dispose(); floor.geometry.dispose(); floorMat.dispose(); floorTex.dispose(); mastGeo.dispose(); mastMat.dispose(); lampGeo.dispose(); lampMat.dispose(); },
  };
}

/** Soft glows as one draw call of points (floodlight heads, beacons). */
export function makeGlowPoints(o: { points: Vec3[]; color: string; size: number }) {
  const p = new Float32Array(o.points.length * 3);
  o.points.forEach((v, i) => p.set(v, i * 3));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  const u = { uPixel: { value: 600 }, uK: { value: 1 }, uColor: { value: col(o.color) }, uSize: { value: o.size } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `uniform float uPixel, uSize; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uSize * uPixel / -mv.z, 1.0, 256.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = max(0.0, 1.0 - d); a = a * a * a; gl_FragColor = vec4(uColor * a * uK, a * uK); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  return { points, u, dispose() { geo.dispose(); mat.dispose(); } };
}
