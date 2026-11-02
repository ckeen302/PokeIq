import * as THREE from "three";
import { LAYER, TIERS, bowlLength, bowlRing } from "./stadium";
import { CROWD_COLS, CROWD_ROWS, crowdAtlas, rng } from "./textures";

/**
 * The crowd: every seat row of both tiers filled (about nine in ten seats)
 * with instanced sprites, one draw call. Each sprite holds a few seated
 * spectators drawn by the page (textures.crowdAtlas) in many shirt
 * colours; the shader bobs them, raises arms as the excitement grows and
 * tints each one a little differently. Camera flashes pop across the
 * stands, more of them at the start and the finish.
 */

export interface CrowdOptions {
  /** Spectators per sprite (fewer sprites on slower devices). */
  perSprite: 2 | 3 | 4;
  /** Use every row (1) or every other row (2) on the slowest devices. */
  rowStep: 1 | 2;
  flashes: number;
}

export interface Crowd {
  group: THREE.Group;
  count: number;
  /** 0 calm … 1 the finish. */
  update(t: number, excitement: number): void;
  dispose(): void;
}

const SEAT_W = 0.56;
const ROW_D = 0.86;

export function buildCrowd(o: CrowdOptions): Crowd {
  const r = rng(2026);
  const atlas = crowdAtlas(o.perSprite);
  const quadW = SEAT_W * o.perSprite;
  const pos: number[] = [], dir: number[] = [], cell: number[] = [], tint: number[] = [], phase: number[] = [];
  const heads: THREE.Vector3[] = [];
  for (const [ti, tier] of [TIERS.lower, TIERS.upper].entries()) {
    const rows = Math.floor((tier.d1 - tier.d0) / ROW_D);
    for (let row = 0; row < rows; row += o.rowStep) {
      const d = tier.d0 + row * ROW_D + 0.35;
      const y = tier.y0 + ((d - tier.d0) / (tier.d1 - tier.d0)) * (tier.y1 - tier.y0);
      const L = bowlLength(d);
      const n = Math.floor(L / quadW);
      const ring = bowlRing(n, d - 0.2);
      for (const p of ring) {
        // About nine seats in ten are taken (gaps come in whole sprites).
        if (r() < 0.07) continue;
        pos.push(p.x, y, p.z);
        dir.push(-p.nx, -p.nz);
        cell.push(Math.floor(r() * (CROWD_COLS * CROWD_ROWS) / 2));
        const k = 0.78 + r() * 0.34;
        tint.push(k * (0.92 + r() * 0.16), k * (0.92 + r() * 0.16), k * (0.92 + r() * 0.16));
        phase.push(r() * 100 + ti * 0.5);
        if (r() < 0.06) heads.push(new THREE.Vector3(p.x - p.nx * 0.2, y + 1.15, p.z - p.nz * 0.2));
      }
    }
  }
  const count = pos.length / 3;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.attributes.position);
  geo.setAttribute("uv", base.attributes.uv);
  geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("iDir", new THREE.InstancedBufferAttribute(new Float32Array(dir), 2));
  geo.setAttribute("iCell", new THREE.InstancedBufferAttribute(new Float32Array(cell), 1));
  geo.setAttribute("iTint", new THREE.InstancedBufferAttribute(new Float32Array(tint), 3));
  geo.setAttribute("iPhase", new THREE.InstancedBufferAttribute(new Float32Array(phase), 1));
  geo.instanceCount = count;
  const uniforms = {
    uAtlas: { value: atlas },
    uTime: { value: 0 },
    uExcite: { value: 0.2 },
    uQuad: { value: new THREE.Vector2(quadW, 1.18) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 iPos; attribute vec2 iDir; attribute float iCell; attribute vec3 iTint; attribute float iPhase;
      uniform float uTime; uniform float uExcite; uniform vec2 uQuad;
      varying vec2 vUv; varying vec3 vTint; varying float vShade;
      void main() {
        vec3 right = vec3(iDir.y, 0.0, -iDir.x);
        float speed = 5.0 + 4.0 * fract(iPhase * 7.31);
        float jump = uExcite * uExcite * 0.16 * max(0.0, sin(uTime * speed + iPhase * 6.2831));
        float sway = 0.03 * sin(uTime * 1.3 + iPhase);
        vec3 p = iPos + right * (position.x * uQuad.x + sway) + vec3(0.0, (position.y + 0.5) * uQuad.y + jump, 0.0);
        // Cheering: more sprites raise their arms as the excitement rises, in waves.
        float wave = fract(iPhase * 0.137 + uTime * 0.21);
        float up = step(1.0 - uExcite * uExcite * 0.6, fract(iPhase * 13.7)) * step(0.2, wave);
        float c = iCell + up * ${((CROWD_COLS * CROWD_ROWS) / 2).toFixed(1)};
        float col = mod(c, ${CROWD_COLS.toFixed(1)});
        float row = floor(c / ${CROWD_COLS.toFixed(1)});
        vUv = vec2((col + uv.x) / ${CROWD_COLS.toFixed(1)}, 1.0 - (row + 1.0 - uv.y) / ${CROWD_ROWS.toFixed(1)});
        vTint = iTint;
        // Lower rows catch more of the floodlights than the back of the upper tier.
        vShade = mix(1.0, 0.62, smoothstep(2.0, 34.0, iPos.y));
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying vec2 vUv; varying vec3 vTint; varying float vShade;
      void main() {
        vec4 t = texture2D(uAtlas, vUv);
        if (t.a < 0.45) discard;
        vec3 c = t.rgb * vTint;
        c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.78);
        gl_FragColor = vec4(c * vShade * 0.46, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER.CROWD);
  const group = new THREE.Group();
  group.add(mesh);

  // Camera flashes.
  const fp: number[] = [], fa: number[] = [];
  for (let i = 0; i < o.flashes && heads.length; i++) {
    const h = heads[Math.floor(r() * heads.length)];
    fp.push(h.x + (r() - 0.5) * 3, h.y + r() * 0.3, h.z + (r() - 0.5) * 3);
    fa.push(r() * 1000);
  }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
  fgeo.setAttribute("aPhase", new THREE.Float32BufferAttribute(fa, 1));
  const fmat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uExcite: uniforms.uExcite, uScale: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute float aPhase; uniform float uTime; uniform float uExcite; uniform float uScale; varying float vI;
      void main() {
        float period = mix(16.0, 2.2, uExcite * uExcite);
        float f = fract(uTime / period + aPhase);
        float x = f * period;
        vI = exp(-x * x * 900.0) + 0.6 * exp(-(x - 0.09) * (x - 0.09) * 2000.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = vI > 0.01 ? clamp(uScale * 260.0 / -mv.z, 2.0, 12.0) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vI;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = exp(-dot(q, q) * 18.0) * vI;
        gl_FragColor = vec4(vec3(5.0, 5.2, 6.0) * a, a);
      }`,
  });
  const flashes = new THREE.Points(fgeo, fmat);
  flashes.frustumCulled = false;
  flashes.layers.set(LAYER.CROWD);
  group.add(flashes);

  return {
    group,
    count: count * o.perSprite,
    update(t, excitement) {
      uniforms.uTime.value = t;
      uniforms.uExcite.value = excitement;
      fmat.uniforms.uScale.value = window.devicePixelRatio > 1.5 ? 1.4 : 1;
    },
    dispose() {
      base.dispose();
      geo.dispose();
      material.dispose();
      atlas.dispose();
      fgeo.dispose();
      fmat.dispose();
    },
  };
}
