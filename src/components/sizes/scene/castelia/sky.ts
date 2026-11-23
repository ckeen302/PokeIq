import * as THREE from "three";
import { cloudNoise } from "../sky";

/**
 * Castelia's evening: the sun low on the camera's side, a deep blue zenith
 * over the skyline, a band of rose and lilac above the horizon opposite the
 * sun (where the camera looks) and amber towards it, streaks of high cloud
 * lit pink from below, and the first stars. The scene's lights, haze and
 * exposure for the same hour live here too, so the city, the figures and
 * the sky agree.
 */

/** The haze the city melts into (the scene's fog). */
export const CASTELIA_HAZE = "#9a8fb0";

export const DUSK = {
  zenith: new THREE.Color("#152a63"),
  mid: new THREE.Color("#4a4f93"),
  /** Opposite the sun: the rose band over a lilac haze. */
  rose: new THREE.Color("#d494a8"),
  horizon: new THREE.Color("#a89bbd"),
  /** Towards the sun. */
  amber: new THREE.Color("#ffab6b"),
  sun: new THREE.Color("#ffd2a0"),
  /** The haze the city melts into (the fog), close to the horizon's own colour. */
  haze: new THREE.Color(CASTELIA_HAZE),
};

/** The scene's lighting for Castelia (index.ts reads it in place of Lumiose's sunny morning). */
export const CASTELIA_MOOD = {
  /** The sun's height over the horizon (degrees): low, for long shadows and a golden light on the towers. */
  sunElevation: 12,
  sunColor: "#ffbf8a",
  sunIntensity: 3.1,
  hemiSky: "#a6b2ff",
  hemiGround: "#6b5560",
  hemiIntensity: 0.62,
  fogDensity: 0.00022,
  exposure: 1.02,
  envIntensity: 0.85,
} as const;

export function createDuskSky(sunDir: THREE.Vector3): { mesh: THREE.Mesh; update(camera: THREE.Camera, t: number): void; dispose(): void } {
  const noiseTex = cloudNoise();
  const lin = (c: THREE.Color) => c.clone().convertSRGBToLinear();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      noiseTex: { value: noiseTex },
      sunDir: { value: sunDir.clone().normalize() },
      zenith: { value: lin(DUSK.zenith) },
      mid: { value: lin(DUSK.mid) },
      rose: { value: lin(DUSK.rose) },
      horizon: { value: lin(DUSK.horizon) },
      amber: { value: lin(DUSK.amber) },
      haze: { value: lin(DUSK.haze) },
      sunCol: { value: lin(DUSK.sun) },
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
      uniform vec3 sunDir, zenith, mid, rose, horizon, amber, haze, sunCol;
      uniform float time;
      uniform sampler2D noiseTex;
      varying vec3 vDir;
      float fbm(vec2 p){ return texture2D(noiseTex, p * 0.25).r; }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 s = normalize(sunDir);
        float sd = max(dot(d, s), 0.0);
        float sunSide = dot(normalize(d.xz + 1e-5), normalize(s.xz + 1e-5)) * 0.5 + 0.5;
        // Low sky: lilac and rose opposite the sun, amber towards it.
        vec3 low = mix(mix(horizon, rose, smoothstep(0.02, 0.16, h) * (1.0 - smoothstep(0.16, 0.34, h))), amber, pow(sunSide, 3.0) * 0.9);
        vec3 col = mix(low, mid, smoothstep(0.12, 0.42, h));
        col = mix(col, zenith, smoothstep(0.38, 0.95, h));
        col = mix(col, haze, smoothstep(0.06, -0.04, h));
        // High streaks of cloud, lit pink from below, darker towards the zenith.
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.08) * vec2(0.22, 0.75) + vec2(time * 0.003, 0.0);
          float c = fbm(uv * 1.1);
          float cov = smoothstep(0.55, 0.8, c) * smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.45, 0.85, h));
          vec3 cloud = mix(vec3(0.95, 0.55, 0.62), vec3(1.0, 0.7, 0.45), pow(sunSide, 2.0)) * mix(1.1, 0.45, smoothstep(0.1, 0.6, h));
          col = mix(col, cloud, cov * 0.75);
          // The first stars.
          vec2 sp = d.xz / (h + 0.25) * 260.0;
          float st = step(0.9965, hash(floor(sp))) * smoothstep(0.35, 0.8, h) * (1.0 - cov);
          col += vec3(0.8, 0.85, 1.0) * st * 0.6;
        }
        col += sunCol * (pow(sd, 900.0) * 18.0 + pow(sd, 40.0) * 0.5 + pow(sd, 6.0) * 0.18);
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
 * Reflections and sky light for the evening, made from the sky itself
 * (Lumiose's come from a daylight photograph): nothing to download.
 */
export function duskEnvironment(renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3): THREE.Texture {
  const sky = createDuskSky(sunDir);
  const scene = new THREE.Scene();
  sky.mesh.scale.setScalar(50);
  scene.add(sky.mesh);
  // A warm glow low all round: the lit city reflected in the glass.
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 6, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffb070").multiplyScalar(0.55), side: THREE.BackSide }));
  glow.position.y = -2;
  scene.add(glow);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 200);
  pmrem.dispose();
  sky.dispose();
  glow.geometry.dispose();
  (glow.material as THREE.Material).dispose();
  return rt.texture;
}
