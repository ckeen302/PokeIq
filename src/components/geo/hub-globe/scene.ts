import * as THREE from "three";
import { deviceInfo } from "@/lib/gl/device-tier";
import { watchContext } from "@/lib/gl/context-loss";
import type { Atlas } from "@/lib/globe/geo";
import { createWorldLook } from "@/components/globe/world-look";
import { LOOK_DOWN, TILT, FOV, START_LON, angleFacing, cameraZ, toVec } from "./project";
import type { Overlay } from "./overlay";

/**
 * The landing's planet: the World globe's own world (components/globe/world-look.ts: the holographic atlas in the
 * site's theme colours, its atmosphere, clouds and night lights), small, turning about a tilted axis under the
 * trainer, lit from up and to the left. The names and pins are DOM (overlay.ts), moved with it every frame.
 *
 * It turns on its own (a turn every 75 seconds); a drag turns it by hand (and, with a mouse, tips it a little), a
 * throw coasts, then it eases back into its own turn. It draws only on screen with the page visible, at 30 frames a
 * second while it just turns (every frame while it's handled), and steps its pixel ratio down when frames run slow.
 * Reduced motion: one still frame (a drag still turns it).
 */

export interface HubGlobeOptions {
  /** The disc's share of the canvas (the rest is atmosphere). */
  frac: number;
  overlay: Overlay;
  /** A positioned ancestor that clips the globe (overflow: hidden): only the part inside it is drawn. */
  clip?: HTMLElement | null;
  onReady(): void;
  onFailed(): void;
}
export interface HubGlobeApi {
  /** Light a region (an atlas name) and, with `turnTo`, turn to face it; light the whole world's rim ("world"); or neither. */
  focus(f: string | null, turnTo: boolean): void;
  setPaused(p: boolean): void;
  /** For measurements: frames drawn, the time spent drawing them, the pixel ratio now. */
  stats(): { frames: number; ms: number; pr: number };
  /** The first frame, as a PNG (the poster is made from it). */
  snapshot(): string;
  dispose(): void;
}

/** A turn every 75 seconds: you see it moving within a few seconds, and can still read the names as they pass. */
const SPIN = (Math.PI * 2) / 75;
/** The clouds' own drift about the axis, on top of the land's turn (they turn a touch faster). */
const CLOUD_DRIFT = SPIN * 0.2;
/** The fastest a throw may spin it (a turn in about two and a half seconds). */
const MAX_THROW = 2.5;
/** The ambient clock under reduced motion (as the World globe holds it). */
const STILL_T = 12;

/** A CSS length in px or rem, as pixels (else null). */
function cssLength(v: string): number | null {
  const m = v.trim().match(/^(-?[\d.]+)(px|rem)$/);
  if (!m) return null;
  return Number(m[1]) * (m[2] === "rem" ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 : 1);
}

export function createHubGlobe(host: HTMLElement, grab: HTMLElement, o: HubGlobeOptions): HubGlobeApi | null {
  const canvas = document.createElement("canvas");
  canvas.className = "pointer-events-none absolute left-0 top-0";
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  const dev = deviceInfo();
  // A weak device (as on the World globe's lowest start): no multisampling, a pixel ratio of 1, no clouds, fewer frames.
  const weak = dev.tier === 0;
  let renderer: THREE.WebGLRenderer;
  const ctx = watchContext(canvas, () => o.onFailed());
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !weak, alpha: true, powerPreference: "default" });
  } catch {
    ctx.dispose();
    canvas.remove();
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const maxPr = weak ? 1 : Math.min(window.devicePixelRatio || 1, dev.tier <= 1 ? 1.5 : 2);
  const idleFps = weak ? 20 : 30;
  let pr = maxPr;

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  camera.position.set(0, 0, cameraZ(o.frac));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  // The tilted axis (and the view a little from above), then the day's turn about it (as project.ts's turn()).
  const tiltG = new THREE.Group();
  const spinG = new THREE.Group();
  tiltG.add(spinG);
  scene.add(tiltG);
  const setTilt = (extra: number) => tiltG.rotation.set(LOOK_DOWN + extra, 0, -TILT, "XZY");
  setTilt(0);

  let maskReady = false;
  const look = createWorldLook({
    // The World globe's mask, losslessly as a WebP (half the bytes).
    mask: "/geo/maps/globe-mask.webp",
    onMask: () => {
      maskReady = true;
      tryReady();
    },
    onMaskError: () => o.onFailed(),
    maxAniso: Math.min(4, renderer.capabilities.getMaxAnisotropy()),
    segments: 96,
    cloudSegments: 64,
    focus: true,
  });
  const { U, haloU } = look;
  spinG.add(look.sphere);
  if (!weak) spinG.add(look.clouds);
  spinG.add(look.cityLights);
  scene.add(look.halo);

  // ---- theme: the site's tokens, re-read when html.light toggles
  let haloBase = 1;
  const applyTheme = () => {
    look.applyTheme(!document.documentElement.classList.contains("light"));
    haloBase = haloU.strength.value;
    kick(true);
  };
  const mo = new MutationObserver(applyTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  // ---- night lights: the atlas's towns (the World globe's)
  let gone = false;
  fetch("/atlas/atlas.json")
    .then((r) => (r.ok ? (r.json() as Promise<Atlas>) : Promise.reject(new Error(String(r.status)))))
    .then((a) => {
      if (gone) return;
      const seen = new Set(a.markers.map((m) => m.name + "|" + m.region));
      look.setTowns(a, a.places.filter((p) => !seen.has(p.name + "|" + p.region)));
      kick(true);
    })
    .catch(() => {});

  // ---- motion
  let angle = angleFacing(START_LON);
  let cloudA = 0;
  let omega = reduce ? 0 : SPIN;
  let tiltX = 0, tiltV = 0;
  let dragging = false, lastMove = -1e9;
  let target: number | null = null;
  let focusName: string | null = null;
  /** A name is pointed at: the world holds still under the pointer (as the World globe does). */
  let hold = false;
  let worldK = 0, focusK = 0;
  /** The region the pool of light is on now (it fades out before it moves to another). */
  let pool: string | null = null;
  let clock = 0;
  const marks = o.overlay.regions.map((r) => ({ ...r, n: new THREE.Vector3(...toVec(r.lon, r.lat)).normalize() }));
  const markOf = (n: string) => marks.find((m) => m.name === n);
  /** The nearest spin that faces a longitude. */
  const nearest = (lon: number) => {
    const a = angleFacing(lon);
    return a + Math.round((angle - a) / (Math.PI * 2)) * Math.PI * 2;
  };

  // ---- drag to spin (a horizontal drag; on a touch screen a vertical one still scrolls the page: touch-action pan-y)
  let px = 0, py = 0, pt = 0, pid = -1;
  const diskPx = () => Math.max(80, host.clientWidth * o.frac);
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || dragging) return;
    dragging = true;
    pid = e.pointerId;
    target = null;
    omega = 0;
    px = e.clientX; py = e.clientY; pt = performance.now();
    try {
      grab.setPointerCapture(e.pointerId);
    } catch {
      // (a pointer already gone)
    }
    grab.dataset.dragging = "true";
    kick();
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pid) return;
    const now = performance.now(), dt = Math.max(4, now - pt) / 1000;
    // The land under the pointer follows it (a little more, so a drag across the disc turns it a good way).
    const da = ((e.clientX - px) / diskPx()) * 2.4;
    angle += da;
    omega = omega * 0.35 + (da / dt) * 0.65;
    if (e.pointerType === "mouse") tiltX = Math.max(-0.3, Math.min(0.3, tiltX + ((e.clientY - py) / diskPx()) * 1.2));
    px = e.clientX; py = e.clientY; pt = now;
    lastMove = now;
    kick();
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false;
    // A throw carries on (held still before letting go: it doesn't), never faster than MAX_THROW.
    if (performance.now() - pt > 90 || reduce) omega = 0;
    omega = Math.max(-MAX_THROW, Math.min(MAX_THROW, omega));
    try {
      grab.releasePointerCapture(e.pointerId);
    } catch {
      // (already released)
    }
    delete grab.dataset.dragging;
    lastMove = performance.now();
    kick();
  };
  grab.addEventListener("pointerdown", onDown);
  grab.addEventListener("pointermove", onMove);
  grab.addEventListener("pointerup", onUp);
  grab.addEventListener("pointercancel", onUp);
  // A name on the globe is part of it: a drag from one turns the world too.
  const layer = grab.parentElement?.querySelector<HTMLElement>("[data-hg-layer]") ?? null;
  layer?.addEventListener("pointerdown", onDown);

  // ---- size: the whole square is W × H; the canvas covers only the part of it the clipping ancestor shows (the
  // world rises from the bottom of the landing: its lower part is never seen, so never drawn)
  let W = 0, H = 0;
  const view = { x: 0, y: 0, w: 0, h: 0 };
  function visible() {
    view.x = 0; view.y = 0; view.w = W; view.h = H;
    const clip = o.clip;
    if (!clip) return;
    // How far down the clip the host starts (layout offsets: the rise's transform doesn't count). Only the bottom is
    // cropped: across, the box is centred by a transform, which offsets don't see.
    let y = 0, el: HTMLElement | null = host;
    while (el && el !== clip) {
      y += el.offsetTop;
      el = el.offsetParent as HTMLElement | null;
    }
    if (el !== clip) return;
    // --globe-floor (on an ancestor): how far down the clip anything of the globe shows (the page fades it out
    // there, under its cards).
    const floor = cssLength(getComputedStyle(host).getPropertyValue("--globe-floor"));
    const y0 = Math.max(0, -y), y1 = Math.min(H, (floor ?? clip.clientHeight) - y, clip.clientHeight - y);
    if (y1 - y0 < 8) return;
    view.y = Math.floor(y0);
    view.h = Math.ceil(y1) - view.y;
  }
  function size(full: boolean) {
    if (full) { view.x = 0; view.y = 0; view.w = W; view.h = H; }
    else visible();
    renderer.setSize(view.w, view.h, false);
    canvas.style.cssText = `left:${view.x}px;top:${view.y}px;width:${view.w}px;height:${view.h}px`;
    camera.aspect = W / H;
    if (view.w === W && view.h === H) camera.clearViewOffset();
    else camera.setViewOffset(W, H, view.x, view.y, view.w, view.h);
    camera.updateProjectionMatrix();
  }
  const resize = () => {
    W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return;
    renderer.setPixelRatio(pr);
    size(false);
    // The night lights in proportion to the disc (the World globe's are drawn for a disc about 700px across).
    look.lightMat.uniforms.uPx.value = pr * Math.max(0.5, Math.min(1, (W * o.frac) / 700));
    o.overlay.resize(W, H);
    kick(true);
  };
  const ro = new ResizeObserver(() => resize());
  ro.observe(host);
  if (o.clip) ro.observe(o.clip);

  // ---- the loop: only while on screen and visible
  let onScreen = true, paused = false, raf = 0, last = 0, lastRaf = 0, dead = false, ready = false, force = false;
  const io = new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    kick();
  });
  io.observe(host);
  const onVis = () => kick();
  document.addEventListener("visibilitychange", onVis);
  let frames = 0, ms = 0, slow = 0, fast = 0;

  const sunWorld = new THREE.Vector3(), q = new THREE.Quaternion();
  function draw() {
    // The sun: up and to the left, swinging slowly, so the day/night line creeps over the land and back.
    const tm = reduce ? STILL_T : clock;
    const az = 1.0 + Math.sin(tm * 0.021) * 0.18, el = 0.42;
    sunWorld.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    spinG.rotation.y = angle;
    setTilt(tiltX);
    scene.updateMatrixWorld();
    spinG.getWorldQuaternion(q);
    look.orient(q, camera, sunWorld, tm, cloudA);
    U.uWorldK.value = worldK;
    U.uFocusK.value = focusK;
    // A little lighter than the World globe's: here the planet is small, beside cards.
    haloU.strength.value = haloBase * (0.85 + 0.45 * worldK);
    renderer.render(scene, camera);
    o.overlay.place(angle, tiltX);
  }

  /** Whether anything but the steady turn is moving (it then draws every frame, not at the idle rate). */
  let lively = true;
  function step(dt: number) {
    clock += dt;
    const was = { angle, tiltX, worldK, focusK };
    if (!dragging) {
      const idle = performance.now() - lastMove;
      if (target !== null) {
        // A critically damped turn to the region in focus.
        const k = 2.6;
        omega += (k * k * (target - angle) - 2 * k * omega) * dt;
        if (Math.abs(target - angle) < 0.002 && Math.abs(omega) < 0.002) omega = 0;
      } else if (idle < 1100) {
        // Let go: it coasts, slowing.
        omega *= Math.exp(-dt / 0.8);
      } else {
        // Then eases back into its own turn.
        omega += ((reduce || hold ? 0 : SPIN) - omega) * (1 - Math.exp(-dt / (hold ? 0.35 : 1.3)));
      }
      // Tipped by a drag: settles back onto the axis.
      const k = 3;
      tiltV += (-k * k * tiltX - 2 * k * tiltV) * dt;
      tiltX += tiltV * dt;
      if (Math.abs(tiltX) < 1e-4 && Math.abs(tiltV) < 1e-4) tiltX = tiltV = 0;
      angle += omega * dt;
    }
    if (!reduce) cloudA += CLOUD_DRIFT * dt;
    // The region lit: the one in focus (the pool fades out before it moves to another).
    const want = focusName && focusName !== "world" ? focusName : null;
    if (want !== pool) {
      focusK += (0 - focusK) * (1 - Math.exp(-dt / 0.1));
      if (focusK < 0.03) {
        pool = want;
        const m = want ? markOf(want) : null;
        if (m) U.uFocus.value.copy(m.n);
      }
    } else focusK += ((pool ? 1 : 0) - focusK) * (1 - Math.exp(-dt / 0.18));
    worldK += ((focusName === "world" ? 1 : 0) - worldK) * (1 - Math.exp(-dt / 0.18));
    lively =
      dragging ||
      target !== null ||
      Math.abs(omega - (reduce || hold ? 0 : SPIN)) > 0.004 ||
      Math.abs(tiltX - was.tiltX) > 1e-5 ||
      Math.abs(worldK - was.worldK) > 1e-4 ||
      Math.abs(focusK - was.focusK) > 1e-4;
    // Nothing moving at all (reduced motion, settled): no more frames until something changes.
    return angle !== was.angle || lively;
  }

  function frame(now: number) {
    raf = 0;
    if (dead || ctx.lost) return;
    const rafDt = lastRaf ? now - lastRaf : 16;
    lastRaf = now;
    // While it only turns, a frame every 1/30 s is plenty (under a pixel of travel each), which halves the GPU time
    // it takes from the trainer's scene and the page. The page's clock, not the frame's: a recording's virtual clock
    // keeps real time too.
    const t = performance.now();
    if (!force && !lively && last && t - last < 1000 / idleFps - 4) {
      raf = requestAnimationFrame(frame);
      return;
    }
    force = false;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
    last = t;
    const moving = step(dt);
    draw();
    frames++;
    ms += performance.now() - t;
    // The display's frames slow for a second and a half: a lower pixel ratio, down to 1; ten seconds fast: back up.
    if (rafDt > 24) slow += rafDt / 1000;
    else slow = Math.max(0, slow - rafDt / 2000);
    if (rafDt < 18) fast += rafDt / 1000;
    else fast = 0;
    if (slow > 1.5 && pr > 1) {
      pr = Math.max(1, pr - 0.25);
      slow = 0;
      resize();
    } else if (fast > 10 && pr < maxPr) {
      pr = Math.min(maxPr, pr + 0.25);
      fast = 0;
      resize();
    }
    if (moving) kick();
    else last = lastRaf = 0;
  }
  function kick(now = false) {
    if (now) force = true;
    if (dead || raf || !ready || paused || !onScreen || document.hidden) {
      if (!raf) last = lastRaf = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  function tryReady() {
    if (ready || dead || !maskReady) return;
    ready = true;
    applyTheme();
    resize();
    // Compile and draw the first frame before the poster gives way.
    draw();
    o.onReady();
    kick();
  }

  return {
    focus(f, turnTo) {
      if (f === focusName) return;
      focusName = f;
      hold = !!f && f !== "world" && !turnTo;
      const m = f && f !== "world" && turnTo ? markOf(f) : null;
      target = m ? nearest(m.lon) : null;
      if (!m) lastMove = Math.min(lastMove, performance.now() - 1100);
      kick();
    },
    setPaused(p) {
      paused = p;
      kick();
    },
    stats: () => ({ frames, ms, pr }),
    snapshot() {
      const kept = { angle, cloudA, clock, tiltX, focusK, worldK };
      angle = angleFacing(START_LON); cloudA = 0; clock = 0; tiltX = 0; focusK = 0; worldK = 0;
      // At the full pixel ratio, whatever the frame rate has brought it down to.
      renderer.setPixelRatio(maxPr);
      size(true);
      draw();
      const url = canvas.toDataURL("image/png");
      ({ angle, cloudA, clock, tiltX, focusK, worldK } = kept);
      resize();
      draw();
      return url;
    },
    dispose() {
      dead = gone = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      grab.removeEventListener("pointerdown", onDown);
      grab.removeEventListener("pointermove", onMove);
      grab.removeEventListener("pointerup", onUp);
      grab.removeEventListener("pointercancel", onUp);
      layer?.removeEventListener("pointerdown", onDown);
      delete grab.dataset.dragging;
      look.disposables.forEach((d) => d.dispose());
      ctx.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
