import * as THREE from "three";
import { cloudNoise } from "../sky";
import type { SkyHandle } from "../kit";

/**
 * Nimbasa's night sky: a deep indigo zenith over a horizon glowing magenta
 * and amber with the city's lights, a field of stars that thins towards the
 * glow and twinkles, a pale moon behind the Ferris wheel, and thin clouds lit
 * from below by the city. It follows the camera (always at infinity). The
 * haze colour is the fog's, so the city melts into the glow from the
 * finale's height. The same colours, without the stars, light the scene
 * (nightEnvironment): reflections of the glow and of neon round the horizon.
 */

export const NIGHT = {
  zenith: new THREE.Color("#0a0d2b"),
  mid: new THREE.Color("#251d5c"),
  horizon: new THREE.Color("#7a4a92"),
  glow: new THREE.Color("#e07a8a"),
  haze: new THREE.Color("#3a2a5e"),
  moon: new THREE.Color("#fdf3dc"),
};

/** Where the moon stands: over the city beyond the promenade's far side, high enough to clear the skyline. */
const MOON_DIR = new THREE.Vector3(0.3, 0.34, 1).normalize();

const SKY_GLSL = /* glsl */ `
  uniform vec3 zenith, mid, horizon, glow, haze;
  vec3 nightSky(vec3 d) {
    float h = d.y;
    // City glow: strongest just over the horizon, warm at the very bottom.
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
    col = mix(col, zenith, smoothstep(0.18, 0.75, h));
    col = mix(col, glow, (1.0 - smoothstep(-0.01, 0.09, h)) * 0.4);
    col = mix(col, haze, smoothstep(0.02, -0.06, h));
    return col;
  }
`;

export function createNightSky(): SkyHandle {
  const noiseTex = cloudNoise();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      noiseTex: { value: noiseTex },
      zenith: { value: NIGHT.zenith.clone().convertSRGBToLinear() },
      mid: { value: NIGHT.mid.clone().convertSRGBToLinear() },
      horizon: { value: NIGHT.horizon.clone().convertSRGBToLinear() },
      glow: { value: NIGHT.glow.clone().convertSRGBToLinear() },
      haze: { value: NIGHT.haze.clone().convertSRGBToLinear() },
      moonCol: { value: NIGHT.moon.clone().convertSRGBToLinear() },
      moonDir: { value: MOON_DIR.clone() },
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
      ${SKY_GLSL}
      uniform vec3 moonCol, moonDir;
      uniform float time;
      uniform sampler2D noiseTex;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = nightSky(d);
        if (h > 0.0) {
          // Stars: one candidate per cell of a cube-projected grid, fewer and dimmer down in the glow.
          vec3 q = d * 260.0;
          vec3 cell = floor(q);
          float r = hash(cell);
          if (r > 0.965) {
            vec3 c = cell + 0.5 + (vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) - 0.5) * 0.6;
            float dist = length(q - c);
            float tw = 0.65 + 0.35 * sin(time * (1.3 + r * 3.0) + r * 40.0);
            float s = smoothstep(0.42, 0.0, dist) * tw * smoothstep(0.06, 0.4, h) * (0.6 + 2.4 * (r - 0.965) / 0.035);
            col += vec3(0.85, 0.9, 1.0) * s * 1.4;
          }
          // Thin clouds, lit from below by the city.
          vec2 uv = d.xz / (h + 0.1) * 0.5 + vec2(time * 0.003, 0.0);
          float n = texture2D(noiseTex, uv * 0.3).r;
          float cov = smoothstep(0.6, 0.82, n) * smoothstep(0.02, 0.16, h) * (1.0 - smoothstep(0.45, 0.85, h));
          vec3 cloud = mix(glow * 0.55, horizon * 0.8, smoothstep(0.05, 0.4, h));
          col = mix(col, cloud, cov * 0.42);
          // The moon: a soft disc and its halo.
          float md = max(dot(d, normalize(moonDir)), 0.0);
          col += moonCol * (smoothstep(0.99955, 0.99975, md) * 3.2 + pow(md, 300.0) * 0.3 + pow(md, 18.0) * 0.05);
        }
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

/**
 * The light the night gives the scene's materials: the sky's colours round a
 * small room, with bands of neon and warm windows low round the horizon and
 * a soft bright patch where the key light (the promenade's floodlights)
 * comes from. Rendered once into an environment map: nothing to download.
 */
export function nightEnvironment(renderer: THREE.WebGLRenderer, pmrem: THREE.PMREMGenerator, keyDir: THREE.Vector3): THREE.Texture {
  const scene = new THREE.Scene();
  const own: { dispose(): void }[] = [];
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: NIGHT.zenith.clone().convertSRGBToLinear().multiplyScalar(1.6) },
      mid: { value: NIGHT.mid.clone().convertSRGBToLinear().multiplyScalar(1.6) },
      horizon: { value: NIGHT.horizon.clone().convertSRGBToLinear().multiplyScalar(1.5) },
      glow: { value: NIGHT.glow.clone().convertSRGBToLinear().multiplyScalar(1.3) },
      // Below the horizon: lit paving.
      haze: { value: new THREE.Color("#4a3a52").convertSRGBToLinear() },
      key: { value: keyDir.clone().normalize() },
    },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform vec3 key;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = nightSky(d);
        col += vec3(0.9, 0.88, 1.0) * pow(max(dot(d, key), 0.0), 6.0) * 1.4;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const skyGeo = new THREE.SphereGeometry(40, 32, 16);
  own.push(skyMat, skyGeo);
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  // Neon and lit windows round the horizon.
  const neon = ["#ff3fa4", "#32e0ff", "#ffd23a", "#7b5cff", "#ff7a2f", "#4dff9a", "#ffffff"];
  const panel = new THREE.PlaneGeometry(1, 1);
  own.push(panel);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + (i % 3) * 0.07;
    const col = new THREE.Color(neon[i % neon.length]).multiplyScalar(i % neon.length === 6 ? 1.4 : 2.6);
    const m = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
    own.push(m);
    const p = new THREE.Mesh(panel, m);
    const r = 30, y = 1.2 + (i % 4) * 1.6;
    p.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    p.scale.set(3 + (i % 5), 0.7 + (i % 3) * 0.5, 1);
    p.lookAt(0, y, 0);
    scene.add(p);
  }
  const tex = pmrem.fromScene(scene, 0.03, 0.1, 100).texture;
  for (const o of own) o.dispose();
  void renderer;
  return tex;
}
