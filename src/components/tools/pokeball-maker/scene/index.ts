import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { scrubBloom } from "@/lib/gl/safe-hdr";
import { studioEnvironment } from "@/lib/gl/room-env";
import { Governor, startTier, type Tier } from "@/components/lab-dex/scene/quality";
import { drawAtlas } from "@/lib/pokeball-maker/glyphs";
import type { Design, Effect, Finish, PatternLayer, RGB } from "@/lib/pokeball-maker/design";
import { R } from "@/lib/pokeball-maker/geometry";
import type { Pose } from "@/lib/pokeball-maker/anim";
import { lin, partMaterial, setPart, setStickers, sharedUniforms, bakeMaterial } from "./materials";
import { buildBall, shapeKey, type BallModel } from "./model";
import { createParticles, effectMode, STARS_MODE } from "./particles";

/**
 * The stage: the ball under studio light (the room environment, a warm key, two rims and a soft fill), on the
 * maker's dark backdrop with a glow in the ball's colour, a soft contact shadow, bloom on what glows, the opening's
 * light burst, its particles and the Pokémon. Quality steps down on a slow device (pixel ratio, multisampling,
 * bloom, particles, real glass) with the Lab's governor, and back up when it runs well.
 */

interface TierSpec {
  dpr: number;
  msaa: number;
  bloom: boolean;
  particles: number;
  glass: boolean;
}
export const TIERS: Record<Tier, TierSpec> = {
  0: { dpr: 1, msaa: 2, bloom: false, particles: 160, glass: false },
  1: { dpr: 1.25, msaa: 4, bloom: true, particles: 300, glass: false },
  2: { dpr: 1.5, msaa: 4, bloom: true, particles: 460, glass: true },
  3: { dpr: 2, msaa: 4, bloom: true, particles: 640, glass: true },
};

export interface ThumbSpec {
  top: RGB;
  bottom: RGB;
  band: RGB;
  pattern: PatternLayer | null;
  finish: Finish;
}

/** A Pokémon picture to pop out: an image URL (smooth) or a canvas (pixel art, drawn crisp). */
export type MonSource = { kind: "url"; urls: string[] } | { kind: "canvas"; canvas: HTMLCanvasElement };

export interface BallScene {
  readonly canvas: HTMLCanvasElement;
  setDesign(d: Design): void;
  setMon(src: MonSource | null): void;
  /** What the stage shows at a moment (seconds on the page's clock). */
  setDriver(f: (now: number) => Pose): void;
  /** The user's own turn of the ball (radians), on top of the pose. */
  setView(yaw: number, pitch: number): void;
  /** Moves the ball sideways on the stage (px), e.g. beside an open drawer. */
  setShift(px: number): void;
  resize(w: number, h: number): void;
  /** Where a click lands on the ball, as angles in the ball's frame, or null. */
  pick(x: number, y: number): { az: number; pol: number } | null;
  /** A transparent PNG of the ball at rest (no bloom). */
  still(size: number, pose: Pose): Promise<Blob>;
  /** Renders one frame at a size for an export and returns the canvas holding it (valid until the next frame). */
  exportFrame(pose: Pose, w: number, h: number, now: number): HTMLCanvasElement;
  endExport(): void;
  glb(): Promise<Blob>;
  /** A small ball with a pattern or a finish (a data URL), or null while it's being drawn (`onThumb` says when). */
  thumb(o: ThumbSpec): string | null;
  onThumb(f: () => void): void;
  tier(): Tier;
  dispose(): void;
}

const BG_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const BG_FS = /* glsl */ `
uniform vec3 uGlow; uniform float uAspect, uGlowOn;
varying vec2 vUv;
vec3 toLin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main(){
  // The maker's stage: a dark violet fall-off with a soft glow behind the ball, in the ball's colour.
  vec3 top = toLin(vec3(0.088, 0.078, 0.122)), bot = toLin(vec3(0.062, 0.054, 0.086));
  vec3 c = mix(bot, top, vUv.y);
  vec2 q = (vUv - vec2(0.5, 0.5)) * vec2(uAspect, 1.0);
  float r = length(q / vec2(0.7, 0.6));
  c += toLin(vec3(0.13, 0.11, 0.21)) * 0.6 * (1.0 - smoothstep(0.0, 0.75, r));
  float g = length(q) / 0.46;
  c += uGlow * uGlowOn * (0.14 * (1.0 - smoothstep(0.0, 1.0, g)) + 0.05 * (1.0 - smoothstep(0.0, 1.6, g)));
  gl_FragColor = vec4(c, 1.0);
}`;

const SHADOW_FS = /* glsl */ `
uniform float uA; varying vec2 vUv;
void main(){ float r = length(vUv - 0.5) * 2.0; float a = (1.0 - smoothstep(0.0, 1.0, r)); gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * uA); }`;
const PLAIN_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const BURST_FS = /* glsl */ `
uniform float uA, uK, uTime; uniform vec3 uCol; varying vec2 vUv;
void main(){
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float core = exp(-r * r * 10.0);
  float ang = atan(p.y, p.x);
  float rays = pow(0.5 + 0.5 * sin(ang * 9.0 + uK * 3.0), 6.0) * (1.0 - smoothstep(0.2, 1.0, r));
  float ring = exp(-pow((r - uK * 0.9) * 7.0, 2.0)) * (1.0 - uK);
  vec3 c = uCol * (core * 3.0 + rays * 1.2 + ring * 1.5);
  gl_FragColor = vec4(c * uA, 1.0);
}`;

const MON_FS = /* glsl */ `
uniform sampler2D uMap; uniform float uFlash, uRed, uA; varying vec2 vUv;
void main(){
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.02) discard;
  vec3 c = t.rgb;
  c = mix(c, vec3(1.0, 0.22, 0.25) * (0.5 + dot(c, vec3(0.3, 0.6, 0.1))), uRed * 0.85);
  c = mix(c, vec3(1.4), uFlash);
  gl_FragColor = vec4(c, t.a * uA);
}`;

function webglOk(c: HTMLCanvasElement) {
  try {
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

export function createBallScene(canvas: HTMLCanvasElement, o: { phone: boolean; reducedMotion: boolean; font: string }): BallScene | null {
  if (!webglOk(document.createElement("canvas"))) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
  } catch {
    return null;
  }
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const env = studioEnvironment(renderer);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.9;
  const camera = new THREE.PerspectiveCamera(26, 1, 10, 2000);

  // Studio light: a warm key from the upper left, a cool rim from behind each side, a soft fill.
  scene.add(new THREE.HemisphereLight(0xfff4ea, 0x4a4060, 0.55));
  const key = new THREE.DirectionalLight(0xfff0de, 2.1);
  key.position.set(-120, 200, 180);
  const rimL = new THREE.DirectionalLight(0xbfd4ff, 1.1);
  rimL.position.set(-220, 80, -160);
  const rimR = new THREE.DirectionalLight(0xffd8f0, 0.8);
  rimR.position.set(220, 40, -120);
  const fill = new THREE.DirectionalLight(0xe8ecff, 0.35);
  fill.position.set(160, -40, 200);
  scene.add(key, rimL, rimR, fill);
  const inner = new THREE.PointLight(0xffffff, 0, 120, 1.6);
  scene.add(inner);

  // The backdrop, drawn first behind everything (so bloom and glass see it).
  const bgU = { uGlow: { value: new THREE.Color(1, 0.4, 0.3) }, uAspect: { value: 1 }, uGlowOn: { value: 1 } };
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: bgU, vertexShader: BG_VS, fragmentShader: BG_FS, depthWrite: false, depthTest: false }));
  bg.frustumCulled = false;
  bg.renderOrder = -10;
  scene.add(bg);

  const shadowU = { uA: { value: 0.55 } };
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: shadowU, vertexShader: PLAIN_VS, fragmentShader: SHADOW_FS, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = -5;
  scene.add(shadow);

  const shared = sharedUniforms();
  const atlas = new THREE.CanvasTexture(drawAtlas(o.font));
  atlas.colorSpace = THREE.NoColorSpace;
  atlas.anisotropy = 4;
  shared.uGlyphs.value = atlas;
  // Redraw the letters once the page's display font has loaded.
  void document.fonts?.ready.then(() => {
    atlas.image = drawAtlas(o.font);
    atlas.needsUpdate = true;
  });

  const particles = createParticles();
  scene.add(particles.points);
  const colours: [THREE.Color, THREE.Color, THREE.Color] = [new THREE.Color(), new THREE.Color(), new THREE.Color()];

  const burstU = { uA: { value: 0 }, uK: { value: 0 }, uTime: shared.uTime, uCol: { value: new THREE.Color(1, 0.97, 0.9) } };
  const burst = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({ uniforms: burstU, vertexShader: PLAIN_VS, fragmentShader: BURST_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  burst.renderOrder = 6;
  scene.add(burst);

  const monU = { uMap: { value: null as THREE.Texture | null }, uFlash: { value: 0 }, uRed: { value: 0 }, uA: { value: 1 } };
  const mon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: monU, vertexShader: PLAIN_VS, fragmentShader: MON_FS, transparent: true, depthWrite: false }));
  mon.renderOrder = 4;
  mon.visible = false;
  scene.add(mon);
  let monAspect = 1;
  let monToken = 0;

  let model: BallModel | null = null;
  let design: Design | null = null;
  let tier: Tier = startTier({ phone: o.phone, cores: navigator.hardwareConcurrency || 4, memoryGb: (navigator as { deviceMemory?: number }).deviceMemory });
  const governor = new Governor(tier, tier);
  let spec = TIERS[tier];
  // Below the lightest tier: half resolution, for devices that can't draw even that smoothly (and software GL).
  let emergency = false;
  let slowStreak = 0;
  const EMERGENCY: TierSpec = { dpr: 0.5, msaa: 0, bloom: false, particles: 120, glass: false };
  let W = 1, H = 1, shift = 0, shiftNow = 0;
  let userYaw = 0, userPitch = 0;
  let driver: (now: number) => Pose = () => ({}) as Pose;
  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;
  let target: THREE.WebGLRenderTarget | null = null;

  function buildPost() {
    composer?.dispose();
    target?.dispose();
    bloom?.dispose();
    const pr = renderer.getPixelRatio();
    target = new THREE.WebGLRenderTarget(W * pr, H * pr, { type: THREE.HalfFloatType, samples: spec.msaa });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(pr);
    composer.setSize(W, H);
    composer.addPass(new RenderPass(scene, camera));
    bloom = null;
    if (spec.bloom) {
      bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.32, 0.38, 1.15);
      scrubBloom(bloom);
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass());
  }

  function applyTier() {
    spec = emergency ? EMERGENCY : TIERS[tier];
    renderer.setPixelRatio(emergency ? spec.dpr : Math.min(window.devicePixelRatio || 1, spec.dpr));
    renderer.setSize(W, H, false);
    particles.setCount(o.reducedMotion ? Math.round(spec.particles * 0.35) : spec.particles);
    buildPost();
    // Real glass needs the richer tiers: rebuild the ball when that changes.
    if (design && model && model.key !== shapeKey(design, spec.glass)) rebuild();
  }

  function rebuild() {
    if (!design) return;
    model?.dispose();
    if (model) scene.remove(model.root);
    model = buildBall(design, shared, { glass: spec.glass });
    scene.add(model.root);
  }

  function frame(pose: Pose, now: number, live: boolean) {
    if (!model || !design) return;
    shared.uTime.value = now;
    const zoom = pose.zoom ?? 0;
    // Framing: the ball a little below the middle; pulled back and up to fit the Pokémon when it's out.
    const aspect = W / H;
    const fitH = (o.phone ? 50 : 60) / Math.min(1, aspect * 0.9);
    const dist = (fitH / Math.tan((camera.fov * Math.PI) / 360)) * (1 + 0.42 * zoom);
    const lookY = 4 + 24 * zoom;
    const elev = 0.12 + 0.12 * zoom;
    camera.position.set(0, lookY + Math.sin(elev) * dist, Math.cos(elev) * dist);
    camera.lookAt(0, lookY, 0);
    camera.aspect = aspect;
    if (live) shiftNow += (shift - shiftNow) * 0.14;
    if (Math.abs(shiftNow) > 0.5) camera.setViewOffset(W, H, shiftNow, 0, W, H);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    bgU.uAspect.value = aspect;

    // The ball: wobble about its base, then lean, turn, squash.
    model.root.position.set(0, -R + pose.y, 0);
    model.root.rotation.set(0, 0, pose.wobble);
    model.ball.position.set(0, R * pose.squash, 0);
    model.ball.rotation.set(pose.tilt + userPitch, pose.yaw + userYaw, 0, "XYZ");
    model.ball.scale.set(1 + (1 - pose.squash) * 0.5, pose.squash, 1 + (1 - pose.squash) * 0.5);
    model.hinge.rotation.x = -pose.lid;
    const glowB = pose.button * 2.2 + pose.click * 3.0;
    model.mats.button.material.emissive.copy(model.mats.button.u.uBase.value).multiplyScalar(glowB).lerp(new THREE.Color(glowB, glowB, glowB), 0.4);
    shadow.position.set(0, -R - 0.5, 0);
    shadow.scale.setScalar(R * 2.3 * (1 + Math.max(0, -pose.y) * 0.01));
    shadowU.uA.value = 0.6 * (1 - Math.max(0, pose.y) * 0.02);

    // Light pouring out of the open ball.
    const world = new THREE.Vector3();
    model.ball.getWorldPosition(world);
    inner.position.copy(world).add(new THREE.Vector3(0, 6, 4));
    inner.intensity = pose.burstA * 9000 + pose.lid * 600;
    burst.visible = pose.burstA > 0.001;
    if (burst.visible) {
      burst.position.copy(world).add(new THREE.Vector3(0, 14, 8));
      burst.quaternion.copy(camera.quaternion);
      burst.scale.setScalar(30 + 95 * pose.burst);
      burstU.uA.value = pose.burstA * 0.7;
      burstU.uK.value = pose.burst;
    }

    // The effect (or the catch's stars), from the ball's opening.
    if (pose.starsT >= 0) {
      colours[0].setRGB(1, 0.85, 0.3);
      colours[1].setRGB(1, 1, 1);
      colours[2].setRGB(1, 0.9, 0.5);
      particles.points.position.copy(world);
      particles.set(STARS_MODE, colours, pose.starsT);
    } else if (pose.effectT >= 0 && design.effect.kind !== "none") {
      design.effect.colours.forEach((c, i) => lin(colours[i], c));
      particles.points.position.copy(world).add(new THREE.Vector3(0, 10, 4));
      particles.set(effectMode(design.effect.kind as Effect), colours, o.reducedMotion && live ? Math.min(pose.effectT, 0.7) : pose.effectT);
    } else particles.set(0, colours, -1);
    const pr = renderer.getPixelRatio();
    particles.setScale((H * pr) / (2 * Math.tan((camera.fov * Math.PI) / 360)));

    // The Pokémon.
    mon.visible = !!monU.uMap.value && pose.mon > 0.001;
    if (mon.visible) {
      const h = 58 * pose.mon;
      mon.scale.set(h * monAspect, h, 1);
      mon.position.copy(world).add(new THREE.Vector3(0, pose.monY + h * 0.18, 10));
      mon.quaternion.copy(camera.quaternion);
      monU.uFlash.value = pose.monFlash;
      monU.uRed.value = pose.monRed;
    }
  }

  function draw() {
    if (composer) composer.render();
  }

  let raf = 0;
  let last = performance.now();
  let running = true;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!running) return;
    const t = performance.now();
    const dt = (t - last) / 1000;
    last = t;
    const next = governor.frame(dt);
    if (next !== null && next !== tier) {
      tier = next;
      applyTier();
    }
    // The governor ignores long frames (a hitch isn't the frame rate); a run of them is, though.
    slowStreak = dt > 0.2 ? slowStreak + 1 : 0;
    if (slowStreak >= 5) {
      slowStreak = 0;
      if (tier > 0) {
        tier = (tier - 1) as Tier;
        governor.tier = tier;
      } else emergency = true;
      applyTier();
    }
    const now = t / 1000;
    frame(driver(now), now, true);
    draw();
    pumpThumbs();
  };

  // Pause while the tab is hidden.
  const onVis = () => {
    running = !document.hidden;
    last = performance.now();
  };
  document.addEventListener("visibilitychange", onVis);


  // Thumbnails: a small ball in a scene of its own, drawn a few a frame and kept.
  const thumbs = new Map<string, string>();
  const thumbQueue: { key: string; o: ThumbSpec }[] = [];
  let onThumb: () => void = () => undefined;
  const tScene = new THREE.Scene();
  tScene.environment = env.texture;
  tScene.environmentIntensity = 0.9;
  tScene.add(new THREE.HemisphereLight(0xfff4ea, 0x4a4060, 0.55));
  for (const l of [key, rimL, rimR, fill]) tScene.add(l.clone());
  const tTop = new THREE.SphereGeometry(30, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2 - 0.05);
  const tBot = new THREE.SphereGeometry(30, 48, 24, 0, Math.PI * 2, Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  const tBand = new THREE.CylinderGeometry(29.6, 29.6, 3.2, 48, 1, false);
  const tCam = new THREE.PerspectiveCamera(30, 1, 10, 1000);
  tCam.position.set(0, 62, 104);
  tCam.lookAt(0, 0, 0);
  const T = 96;
  let tRt: THREE.WebGLRenderTarget | null = null, tOut: THREE.WebGLRenderTarget | null = null;
  const tPass = new OutputPass();
  function drawThumb(o: ThumbSpec): string {
    tRt ??= new THREE.WebGLRenderTarget(T, T, { type: THREE.HalfFloatType, samples: emergency ? 0 : 4 });
    tOut ??= new THREE.WebGLRenderTarget(T, T, { type: THREE.UnsignedByteType });
    const top = partMaterial(o.finish, shared, { glass: spec.glass, flat: false });
    const bot = partMaterial(o.pattern ? "gloss" : o.finish, shared, { glass: spec.glass, flat: false });
    const band = partMaterial("matte", shared, { glass: false, flat: false });
    setPart(top.u, o.top, o.finish, 1, o.pattern);
    setPart(bot.u, o.bottom, o.pattern ? "gloss" : o.finish, -1, null);
    setPart(band.u, o.band, "matte", 0, null);
    for (const m of [top, bot]) if (m.finish === "glass") m.material.color.copy(m.u.uBase.value).lerp(new THREE.Color(1, 1, 1), 0.35);
    const meshes = [new THREE.Mesh(tTop, top.material), new THREE.Mesh(tBot, bot.material), new THREE.Mesh(tBand, band.material)];
    tScene.add(...meshes);
    renderer.setRenderTarget(tRt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(tScene, tCam);
    tPass.render(renderer, tOut, tRt, 0, false);
    const px = new Uint8Array(T * T * 4);
    renderer.readRenderTargetPixels(tOut, 0, 0, T, T, px);
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
    tScene.remove(...meshes);
    for (const m of [top, bot, band]) m.material.dispose();
    const cv = document.createElement("canvas");
    cv.width = cv.height = T;
    const g = cv.getContext("2d")!;
    const img = g.createImageData(T, T);
    for (let y = 0; y < T; y++) {
      const src = (T - 1 - y) * T * 4, dst = y * T * 4;
      for (let x = 0; x < T * 4; x += 4) {
        const a = px[src + x + 3], k = a > 0 && a < 255 ? 255 / a : 1;
        img.data[dst + x] = Math.min(255, px[src + x] * k);
        img.data[dst + x + 1] = Math.min(255, px[src + x + 1] * k);
        img.data[dst + x + 2] = Math.min(255, px[src + x + 2] * k);
        img.data[dst + x + 3] = a;
      }
    }
    g.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  }
  function pumpThumbs() {
    if (!thumbQueue.length) return;
    const t0 = performance.now();
    let n = 0;
    while (thumbQueue.length && (n === 0 || performance.now() - t0 < 6)) {
      const job = thumbQueue.shift()!;
      if (!thumbs.has(job.key)) thumbs.set(job.key, drawThumb(job.o));
      n++;
    }
    if (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value!);
    onThumb();
  }

  const ray = new THREE.Raycaster();
  const api: BallScene = {
    canvas,
    setDesign(d) {
      const needs = !model || model.key !== shapeKey(d, spec.glass);
      design = d;
      if (needs) rebuild();
      else model!.update(d);
      setStickers(shared, d);
      lin(bgU.uGlow.value, d.colours.top as RGB);
      // A glow that's too dark (a black top) borrows the band's or stays dim.
      const l = bgU.uGlow.value.r * 0.3 + bgU.uGlow.value.g * 0.6 + bgU.uGlow.value.b * 0.1;
      bgU.uGlowOn.value = l < 0.02 ? 0.3 : 1;
    },
    setMon(src) {
      const token = ++monToken;
      if (!src) {
        monU.uMap.value?.dispose();
        monU.uMap.value = null;
        return;
      }
      const apply = (tex: THREE.Texture, w: number, h: number, crisp: boolean) => {
        if (token !== monToken) return void tex.dispose();
        tex.colorSpace = THREE.SRGBColorSpace;
        if (crisp) {
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.generateMipmaps = false;
        }
        monU.uMap.value?.dispose();
        monU.uMap.value = tex;
        monAspect = w / h;
      };
      if (src.kind === "canvas") return apply(new THREE.CanvasTexture(src.canvas), src.canvas.width, src.canvas.height, true);
      const tryUrl = (i: number) => {
        if (i >= src.urls.length || token !== monToken) return;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.decoding = "async";
        img.onload = () => {
          const tex = new THREE.Texture(img);
          tex.needsUpdate = true;
          apply(tex, img.naturalWidth || 1, img.naturalHeight || 1, false);
        };
        img.onerror = () => tryUrl(i + 1);
        img.src = src.urls[i];
      };
      tryUrl(0);
    },
    setDriver(f) {
      driver = f;
    },
    setView(y, p) {
      userYaw = y;
      userPitch = p;
    },
    setShift(px) {
      shift = px;
    },
    resize(w, h) {
      W = Math.max(2, Math.round(w));
      H = Math.max(2, Math.round(h));
      renderer.setPixelRatio(emergency ? spec.dpr : Math.min(window.devicePixelRatio || 1, spec.dpr));
      renderer.setSize(W, H, false);
      composer?.setPixelRatio(renderer.getPixelRatio());
      composer?.setSize(W, H);
      bloom?.setSize(W * renderer.getPixelRatio(), H * renderer.getPixelRatio());
    },
    pick(x, y) {
      if (!model) return null;
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(model.pickable, false)[0];
      if (!hit) return null;
      const p = model.ball.worldToLocal(hit.point.clone()).normalize();
      return { az: Math.atan2(p.x, p.z), pol: Math.acos(Math.max(-1, Math.min(1, p.y))) };
    },
    async still(size, pose) {
      if (!model) throw new Error("no ball");
      const pw = W, ph = H;
      W = H = size;
      const samples = size <= 1100 ? 4 : size <= 1800 ? 2 : 0;
      const sceneRt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, samples });
      const outRt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType });
      const out = new OutputPass();
      const keep = { bg: bg.visible, shadow: shadow.visible, burst: burst.visible };
      try {
        shiftNow = 0;
        frame(pose, shared.uTime.value, false);
        bg.visible = false;
        shadow.visible = false;
        particles.set(0, colours, -1);
        burst.visible = false;
        mon.visible = false;
        renderer.setRenderTarget(sceneRt);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, camera);
        out.render(renderer, outRt, sceneRt, 0, false);
        const px = new Uint8Array(size * size * 4);
        renderer.readRenderTargetPixels(outRt, 0, 0, size, size, px);
        const cv = document.createElement("canvas");
        cv.width = cv.height = size;
        const g = cv.getContext("2d")!;
        const img = g.createImageData(size, size);
        // Flip (GL rows run bottom up) and un-premultiply the edges.
        for (let y = 0; y < size; y++) {
          const src = (size - 1 - y) * size * 4, dst = y * size * 4;
          for (let x = 0; x < size * 4; x += 4) {
            const a = px[src + x + 3];
            const k = a > 0 && a < 255 ? 255 / a : 1;
            img.data[dst + x] = Math.min(255, px[src + x] * k);
            img.data[dst + x + 1] = Math.min(255, px[src + x + 1] * k);
            img.data[dst + x + 2] = Math.min(255, px[src + x + 2] * k);
            img.data[dst + x + 3] = a;
          }
        }
        g.putImageData(img, 0, 0);
        return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png"));
      } finally {
        renderer.setRenderTarget(null);
        renderer.setClearColor(0x000000, 1);
        sceneRt.dispose();
        outRt.dispose();
        out.dispose();
        bg.visible = keep.bg;
        shadow.visible = keep.shadow;
        W = pw;
        H = ph;
      }
    },
    exportFrame(pose, w, h, now) {
      running = false;
      if (W !== w || H !== h || renderer.getPixelRatio() !== 1) {
        W = w;
        H = h;
        renderer.setPixelRatio(1);
        renderer.setSize(W, H, false);
        buildPost();
      }
      shiftNow = 0;
      shift = 0;
      frame(pose, now, false);
      draw();
      return canvas;
    },
    endExport() {
      const r = canvas.getBoundingClientRect();
      W = Math.max(2, Math.round(r.width));
      H = Math.max(2, Math.round(r.height));
      applyTier();
      running = !document.hidden;
      last = performance.now();
    },
    async glb() {
      if (!model || !design) throw new Error("no ball");
      const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
      // Each part's colour (pattern, surface, stickers) baked into its own texture.
      const quad = new THREE.Scene();
      const camO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const out = new THREE.Group();
      const textures: THREE.Texture[] = [];
      const made: THREE.Material[] = [];
      const bakes = new Map<string, THREE.Texture>();
      const N = 1024;
      try {
        for (const { mesh, part } of model.meshes) {
          const g = mesh.geometry;
          let tex = bakes.get(`${part}:${g.uuid}`);
          if (!tex && g.getAttribute("uv")) {
            const rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.UnsignedByteType });
            const bm = bakeMaterial(model.mats[part].u, shared);
            const m = new THREE.Mesh(g, bm);
            quad.add(m);
            renderer.setRenderTarget(rt);
            renderer.setClearColor(0xffffff, 1);
            renderer.clear();
            renderer.render(quad, camO);
            quad.remove(m);
            bm.dispose();
            const px = new Uint8Array(N * N * 4);
            renderer.readRenderTargetPixels(rt, 0, 0, N, N, px);
            rt.dispose();
            const cv = document.createElement("canvas");
            cv.width = cv.height = N;
            const c2 = cv.getContext("2d")!;
            const img = c2.createImageData(N, N);
            for (let y = 0; y < N; y++) img.data.set(px.subarray((N - 1 - y) * N * 4, (N - y) * N * 4), y * N * 4);
            c2.putImageData(img, 0, 0);
            tex = new THREE.CanvasTexture(cv);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = true;
            textures.push(tex);
            bakes.set(`${part}:${g.uuid}`, tex);
          }
          const src = model.mats[part].material;
          const mat = new THREE.MeshStandardMaterial({
            map: tex ?? null,
            color: tex ? 0xffffff : src.color,
            roughness: src.roughness,
            metalness: src.metalness,
            transparent: src.transparent,
            opacity: src.opacity,
            emissive: model.mats[part].finish === "glow" ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0),
            emissiveMap: model.mats[part].finish === "glow" ? tex ?? null : null,
            flatShading: src.flatShading,
          });
          made.push(mat);
          const copy = new THREE.Mesh(g, mat);
          mesh.updateWorldMatrix(true, false);
          // In the ball's own frame, closed and upright.
          copy.applyMatrix4(new THREE.Matrix4().copy(model.ball.matrixWorld).invert().multiply(mesh.matrixWorld));
          out.add(copy);
        }
        renderer.setRenderTarget(null);
        renderer.setClearColor(0x000000, 1);
        // In metres, as glTF expects (the ball is 60 mm).
        out.scale.setScalar(0.001);
        const data = await new GLTFExporter().parseAsync(out, { binary: true });
        return new Blob([data as ArrayBuffer], { type: "model/gltf-binary" });
      } finally {
        textures.forEach((t) => t.dispose());
        made.forEach((m) => m.dispose());
      }
    },
    thumb(o) {
      const k = JSON.stringify([o, spec.glass]);
      const got = thumbs.get(k);
      if (got) return got;
      if (!thumbQueue.some((j) => j.key === k)) thumbQueue.push({ key: k, o });
      return null;
    },
    onThumb(f) {
      onThumb = f;
    },
    tier: () => (emergency ? 0 : tier),
    dispose() {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      model?.dispose();
      particles.dispose();
      atlas.dispose();
      monU.uMap.value?.dispose();
      for (const m of [bg, shadow, burst, mon]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      composer?.dispose();
      target?.dispose();
      bloom?.dispose();
      tTop.dispose();
      tBot.dispose();
      tBand.dispose();
      tRt?.dispose();
      tOut?.dispose();
      tPass.dispose();
      env.release();
      renderer.dispose();
    },
  };
  applyTier();
  raf = requestAnimationFrame(loop);
  return api;
}
