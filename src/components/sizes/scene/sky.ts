import * as THREE from "three";

/**
 * A clear late-morning sky over Lumiose: a deep blue zenith fading to a pale
 * haze at the horizon, warmer on the sun's side, the sun's disc and glow,
 * and a few soft fair-weather clouds (procedural noise on a cloud layer)
 * with warm sunlit edges and cooler undersides. It follows the camera, so it
 * is always at infinity. The haze colour is shared with the scene fog so the
 * round city melts into the horizon seen from the finale's height.
 */

export const SKY = {
  zenith: new THREE.Color("#1d68d2"),
  horizon: new THREE.Color("#bfdaf1"),
  haze: new THREE.Color("#cddff0"),
  sun: new THREE.Color("#fff1da"),
  /** The horizon towards the sun: a little warmer. */
  warm: new THREE.Color("#f3e6d2"),
};

/**
 * Tileable fractal noise for the clouds, baked once (periodic value noise,
 * five octaves): the sky then reads two texels a pixel instead of working
 * the noise out for every pixel of every frame.
 */
function cloudNoise(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size);
  const hash = (x: number, y: number, p: number) => {
    const xx = ((x % p) + p) % p, yy = ((y % p) + p) % p;
    let h = Math.imul(xx, 374761393) ^ Math.imul(yy, 668265263) ^ Math.imul(p, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (x: number, y: number, p: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, p), b = hash(ix + 1, iy, p), c = hash(ix, iy + 1, p), d = hash(ix + 1, iy + 1, p);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0, amp = 0.5, f = 4;
      for (let o = 0; o < 5; o++) {
        s += amp * noise((x / size) * f, (y / size) * f, f);
        amp *= 0.5;
        f *= 2;
      }
      data[y * size + x] = Math.round(Math.min(1, s / 0.96875) * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function createSky(sunDir: THREE.Vector3): { mesh: THREE.Mesh; update(camera: THREE.Camera, t: number): void; dispose(): void } {
  const noiseTex = cloudNoise();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      noiseTex: { value: noiseTex },
      sunDir: { value: sunDir.clone().normalize() },
      zenith: { value: SKY.zenith.clone().convertSRGBToLinear() },
      horizon: { value: SKY.horizon.clone().convertSRGBToLinear() },
      haze: { value: SKY.haze.clone().convertSRGBToLinear() },
      sunCol: { value: SKY.sun.clone().convertSRGBToLinear() },
      warm: { value: SKY.warm.clone().convertSRGBToLinear() },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, zenith, horizon, haze, sunCol, warm;
      uniform float time;
      uniform sampler2D noiseTex;
      varying vec3 vDir;
      // The baked noise has four cells across the tile: a quarter tile per unit, like the noise it replaces.
      float fbm(vec2 p){ return texture2D(noiseTex, p * 0.25).r; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        // Towards the sun the low sky is a little warmer.
        float sunSide = max(dot(normalize(d.xz + 1e-5), normalize(sunDir.xz + 1e-5)), 0.0);
        vec3 low = mix(horizon, warm, 0.45 * sunSide * sunSide);
        vec3 col = mix(low, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
        col = mix(col, haze, smoothstep(0.1, -0.03, h));
        // Clouds on a layer above: soft cumulus, lit on the sun's side.
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 0.55 + vec2(time * 0.004, 0.0);
          float c = fbm(uv * 1.3);
          float cov = smoothstep(0.57, 0.78, c) * smoothstep(0.0, 0.18, h) * (1.0 - smoothstep(0.55, 0.95, h));
          float lit = 0.82 + 0.25 * pow(sd, 3.0) - 0.18 * smoothstep(0.6, 0.9, fbm(uv * 2.6 + 3.0));
          // Sunlit edges warm, shaded undersides a touch blue.
          vec3 cloud = mix(vec3(0.9, 0.93, 1.0), vec3(1.0, 0.98, 0.94), clamp(lit, 0.0, 1.0));
          col = mix(col, cloud * lit * 1.06, cov * 0.85);
        }
        col += sunCol * (pow(sd, 1600.0) * 40.0 + pow(sd, 90.0) * 0.6 + pow(sd, 8.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.name = "sky";
  return {
    mesh,
    update(camera, t) {
      mesh.position.copy(camera.position);
      mesh.scale.setScalar(1000);
      mat.uniforms.time.value = t;
    },
    dispose() { mesh.geometry.dispose(); mat.dispose(); noiseTex.dispose(); },
  };
}
