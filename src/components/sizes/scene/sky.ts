import * as THREE from "three";

/**
 * A clear summer sky: a deep blue zenith fading to a pale haze at the
 * horizon, the sun's disc and glow, and a few soft fair-weather clouds
 * (procedural noise on a cloud layer). It follows the camera, so it is
 * always at infinity. The haze colour is shared with the scene fog so the
 * city melts into the horizon.
 */

export const SKY = {
  zenith: new THREE.Color("#1f6fd6"),
  horizon: new THREE.Color("#bcd9f2"),
  haze: new THREE.Color("#c9def0"),
  sun: new THREE.Color("#fff3df"),
};

export function createSky(sunDir: THREE.Vector3): { mesh: THREE.Mesh; update(camera: THREE.Camera, t: number): void; dispose(): void } {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunDir: { value: sunDir.clone().normalize() },
      zenith: { value: SKY.zenith.clone().convertSRGBToLinear() },
      horizon: { value: SKY.horizon.clone().convertSRGBToLinear() },
      haze: { value: SKY.haze.clone().convertSRGBToLinear() },
      sunCol: { value: SKY.sun.clone().convertSRGBToLinear() },
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
      uniform vec3 sunDir, zenith, horizon, haze, sunCol;
      uniform float time;
      varying vec3 vDir;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
        col = mix(col, haze, smoothstep(0.1, -0.03, h));
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        // Clouds on a layer above: soft cumulus, lit on the sun's side.
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 0.55 + vec2(time * 0.004, 0.0);
          float c = fbm(uv * 1.3);
          float cov = smoothstep(0.57, 0.78, c) * smoothstep(0.0, 0.18, h) * (1.0 - smoothstep(0.55, 0.95, h));
          float lit = 0.82 + 0.25 * pow(sd, 3.0) - 0.18 * smoothstep(0.6, 0.9, fbm(uv * 2.6 + 3.0));
          col = mix(col, vec3(1.0, 0.99, 0.97) * lit * 1.05, cov * 0.85);
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
    dispose() { mesh.geometry.dispose(); mat.dispose(); },
  };
}
