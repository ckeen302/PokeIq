"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { spriteCandidates } from "@/lib/battle/sprites";
import type { TrainerFacing } from "@/lib/trainer/config";
import type { Avatar3DSceneProps } from "./Avatar3D";
import { tauntOf } from "@/lib/trainer/taunts";
import { FACING_YAW, buildTrainer, lightStage, type TauntAct, type TrainerModel } from "./model";
import { STILL_AT } from "./moves";

/**
 * The three.js scene behind <Avatar3D> (loaded lazily, so pages without a
 * 3D trainer never load three.js). One small WebGL canvas per trainer,
 * transparent so the page shows through. It only animates while on screen
 * and the tab is visible, and draws a single frame under reduced motion.
 *
 * The partner Pokémon is the site's animated sprite as a camera-facing
 * billboard: an <img> pinned to its spot in the scene (GIFs animate on
 * their own and stay crisp), with a soft shadow drawn in 3D.
 */

const PARTNER_SPOT: Record<TrainerFacing, { x: number; z: number }> = {
  front: { x: 1.05, z: 0.25 },
  right: { x: 1.15, z: 0.55 },
  left: { x: -1.15, z: 0.55 },
};
/** Sprite pixels to scene units (a 56 px Pikachu stands about knee-to-waist on the trainer). */
const SPRITE_UNIT = 0.0125;

function shadowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(0,0,0,0.34)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.16)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The one WebGL context trainers drawn with `shared` take turns on: each
 * renders its scene here and copies the frame onto its own 2D canvas (the
 * copy is made straight after the render, so the buffer needn't be kept).
 * It goes shortly after the last of them does, so a screen that swaps one
 * set of trainers for another (a lobby for a line-up) keeps the context and
 * its compiled shaders instead of building them all again.
 */
let sharedGl: { renderer: THREE.WebGLRenderer; users: number; lost: Set<() => void>; closing?: number } | null = null;
/** How long the shared context outlives its last trainer. */
const SHARED_LINGER_MS = 3_000;

function acquireShared(onLost: () => void): THREE.WebGLRenderer {
  if (!sharedGl) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power", preserveDrawingBuffer: false });
    const lost = new Set<() => void>();
    const gl = { renderer, users: 0, lost };
    renderer.domElement.addEventListener("webglcontextlost", () => {
      if (sharedGl === gl) sharedGl = null;
      for (const f of [...lost]) f();
    });
    sharedGl = gl;
  }
  window.clearTimeout(sharedGl.closing);
  sharedGl.users++;
  sharedGl.lost.add(onLost);
  return sharedGl.renderer;
}

function releaseShared(renderer: THREE.WebGLRenderer, onLost: () => void) {
  const gl = sharedGl;
  if (!gl || gl.renderer !== renderer) return;
  gl.lost.delete(onLost);
  if (--gl.users > 0) return;
  window.clearTimeout(gl.closing);
  gl.closing = window.setTimeout(() => {
    if (gl.users > 0) return;
    if (sharedGl === gl) sharedGl = null;
    gl.lost.clear();
    renderer.dispose();
    renderer.forceContextLoss();
  }, SHARED_LINGER_MS);
}

/** Whether a frame has the trainer in it: a few solid pixels in a small copy (the soft shadows are faint, the trainer opaque). */
function hasSolidPixels(src: HTMLCanvasElement, probe: CanvasRenderingContext2D): boolean {
  const n = probe.canvas.width;
  probe.clearRect(0, 0, n, n);
  probe.drawImage(src, 0, 0, n, n);
  const d = probe.getImageData(0, 0, n, n).data;
  let solid = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 160 && ++solid >= 3) return true;
  return false;
}

export function Avatar3DScene({ config, pose = "idle", facing = "front", partner = false, still = false, taunt = null, shared = false, onPaint, onFail }: Avatar3DSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const sprite = useRef<HTMLImageElement>(null);
  const state = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    model: TrainerModel | null;
    turn: THREE.Group;
    partnerShadow: THREE.Mesh;
    render: () => void;
    frame: () => void;
    layout: () => void;
  } | null>(null);
  const live = useRef({ pose, facing, partner, still, spriteSize: { w: 0, h: 0 }, act: null as { id: TauntAct["id"]; n: number; start: number } | null });
  /** The partner's size in scene units (from its sprite), and how far it steps out so big ones clear the trainer. */
  const partnerBox = () => {
    const { w, h } = live.current.spriteSize;
    if (!w || !h) return { units: 0.9, wide: 0.9, shift: 0 };
    const units = Math.max(0.5, Math.min(1.45, h * SPRITE_UNIT));
    const wide = (w / h) * units;
    return { units, wide, shift: Math.max(0, wide / 2 - 0.5) };
  };
  live.current.pose = pose;
  live.current.facing = facing;
  live.current.partner = partner;
  live.current.still = still;
  const [failed, setFailed] = useState(false);
  const [candidate, setCandidate] = useState(0);
  const notify = useRef({ onPaint, onFail });
  notify.current = { onPaint, onFail };

  // ---- renderer, camera, lights (once) ----
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let raf = 0;
    const fail = () => {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      setFailed(true);
      notify.current.onFail?.();
    };
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = shared ? acquireShared(fail) : new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power", preserveDrawingBuffer: false });
    } catch {
      fail();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    // Shared: this trainer's own 2D canvas, which each frame is copied onto.
    const view = shared ? document.createElement("canvas") : renderer.domElement;
    const view2d = shared ? view.getContext("2d") : null;
    if (shared && !view2d) {
      releaseShared(renderer, fail);
      fail();
      return;
    }
    if (!shared) renderer.domElement.addEventListener("webglcontextlost", fail);
    view.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    el.prepend(view);
    // Until the trainer shows up in a frame: a tiny canvas to sample it.
    let painted = false;
    let probes = 0;
    const probeCanvas = document.createElement("canvas");
    probeCanvas.width = probeCanvas.height = 24;
    const probe = probeCanvas.getContext("2d", { willReadFrequently: true });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    const stage = lightStage(scene, renderer);

    const tex = shadowTexture();
    const shadowMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1.4, 1.1, 1);
    shadow.position.y = 0.002;
    scene.add(shadow);
    // A tighter, darker contact shadow right under the feet.
    const contact = new THREE.Mesh(shadowGeo, shadowMat);
    contact.rotation.x = -Math.PI / 2;
    contact.scale.set(0.62, 0.42, 1);
    contact.position.set(0, 0.003, 0.02);
    scene.add(contact);
    const partnerShadow = new THREE.Mesh(shadowGeo, shadowMat);
    partnerShadow.rotation.x = -Math.PI / 2;
    partnerShadow.position.y = 0.002;
    scene.add(partnerShadow);

    const turn = new THREE.Group();
    scene.add(turn);

    let width = 0;
    let height = 0;
    const tmp = new THREE.Vector3();

    /** Frames the trainer (and partner) to fit the box, feet near the bottom. */
    const layout = () => {
      width = el.clientWidth;
      height = el.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      if (shared) {
        view.width = renderer.domElement.width;
        view.height = renderer.domElement.height;
      }
      const aspect = width / height;
      camera.aspect = aspect;
      const spot = PARTNER_SPOT[live.current.facing];
      const withPartner = live.current.partner;
      const pb = partnerBox();
      const side = Math.sign(spot.x);
      const px = spot.x + side * pb.shift;
      const minX = Math.min(-0.66, withPartner ? px - pb.wide / 2 - 0.05 : 0);
      const maxX = Math.max(0.66, withPartner ? px + pb.wide / 2 + 0.05 : 0);
      const boxW = maxX - minX;
      const boxH = 2.5;
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const fitH = boxH / 2 / Math.tan(fov / 2);
      const fitW = boxW / 2 / Math.tan(fov / 2) / aspect;
      const dist = Math.max(fitH, fitW) * 1.08;
      const cx = (minX + maxX) / 2;
      // A little above the trainer's eye line, looking slightly down.
      camera.position.set(cx, 1.98, dist + 0.3);
      camera.lookAt(cx, 1.18, 0);
      camera.updateProjectionMatrix();
      partnerShadow.position.set(px, 0.002, spot.z);
      partnerShadow.visible = withPartner;
    };

    const placeSprite = (t: number) => {
      const img = sprite.current;
      if (!img) return;
      const { w, h } = live.current.spriteSize;
      if (!live.current.partner || !w || !width) {
        img.style.visibility = "hidden";
        return;
      }
      const spot = PARTNER_SPOT[live.current.facing];
      const pb = partnerBox();
      const units = pb.units;
      const sx = spot.x + Math.sign(spot.x) * pb.shift;
      tmp.set(sx, 0, spot.z).project(camera);
      const fx = ((tmp.x + 1) / 2) * width;
      const fy = ((1 - tmp.y) / 2) * height;
      tmp.set(sx, units, spot.z).project(camera);
      const topY = ((1 - tmp.y) / 2) * height;
      const px = Math.max(1, fy - topY);
      const scale = px / h;
      const hop = live.current.still ? 0 : Math.max(0, Math.sin(t * (live.current.pose === "fight" ? 4.2 : 2.2))) * px * 0.04;
      const flip = live.current.facing === "right" ? -1 : 1;
      img.style.visibility = "visible";
      img.style.width = `${w * scale}px`;
      img.style.height = `${h * scale}px`;
      img.style.transform = `translate(${fx - (w * scale) / 2}px, ${fy - h * scale - hop + h * scale * 0.04}px) scaleX(${flip})`;
      partnerShadow.scale.setScalar(Math.max(0.55, Math.min(1.4, pb.wide * 0.8)));
    };

    let last = performance.now();
    let clock = 0;
    let onScreen = true;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const animating = () => onScreen && !document.hidden && !live.current.still && !reduced;
    /** The taunt playing now (a still of its key pose when not animating), or null once it's over. */
    const act = (): TauntAct | null => {
      const a = live.current.act;
      if (!a) return null;
      const secs = tauntOf(a.id)?.secs ?? 0;
      if (!animating()) return { id: a.id, t: STILL_AT[a.id] ?? secs * 0.4 };
      if (a.start < 0) a.start = clock;
      const t = clock - a.start;
      return t < secs ? { id: a.id, t } : null;
    };

    /** One frame: on the shared context it's drawn at this trainer's size, then copied over. */
    const draw = () => {
      if (dead || !width || !height) return;
      if (shared) {
        const buf = renderer.domElement;
        if (buf.width !== view.width || buf.height !== view.height) renderer.setSize(width, height, false);
        // Each trainer's scene has the same lighting set-up (lightStage), so the renderer's settings hold.
        renderer.render(scene, camera);
        view2d!.clearRect(0, 0, view.width, view.height);
        view2d!.drawImage(buf, 0, 0);
      } else {
        renderer.render(scene, camera);
      }
      // A read-back each frame is dear: a few dozen tries, then the caller's own deadline decides.
      if (!painted && probe && notify.current.onPaint && state.current?.model && probes++ < 60) {
        try {
          painted = hasSolidPixels(view, probe);
        } catch {
          painted = true; // can't sample: take it as drawn
        }
        if (painted) notify.current.onPaint?.();
      }
    };

    const render = () => {
      const s = state.current;
      if (!s) return;
      s.model?.update(clock, 1 / 60, live.current.pose, act());
      const yaw = FACING_YAW[live.current.facing];
      turn.rotation.y += (yaw - turn.rotation.y) * (animating() ? 0.12 : 1);
      placeSprite(clock);
      draw();
    };

    const frame = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (!animating()) {
        // One settled frame.
        const s = state.current;
        const a = act();
        if (s?.model) for (let i = 0; i < 40; i++) s.model.update(clock, 1 / 30, live.current.pose, a);
        render();
        return;
      }
      const tick = (now: number) => {
        if (dead) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        clock += dt;
        state.current?.model?.update(clock, dt, live.current.pose, act());
        const yaw = FACING_YAW[live.current.facing];
        turn.rotation.y += (yaw - turn.rotation.y) * Math.min(1, dt * 8);
        placeSprite(clock);
        draw();
        raf = requestAnimationFrame(tick);
      };
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    state.current = { renderer, scene, camera, model: null, turn, partnerShadow, render, frame, layout };

    const ro = new ResizeObserver(() => {
      layout();
      render();
    });
    ro.observe(el);
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        frame();
      },
      { rootMargin: "64px" },
    );
    io.observe(el);
    const onVisibility = () => frame();
    document.addEventListener("visibilitychange", onVisibility);
    layout();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      state.current?.model?.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      tex.dispose();
      stage.dispose();
      dead = true;
      if (shared) {
        releaseShared(renderer, fail);
        view.remove();
      } else {
        renderer.domElement.removeEventListener("webglcontextlost", fail);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
      state.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the context is chosen once
  }, []);

  // ---- the trainer (rebuilt when the config changes) ----
  const key = JSON.stringify(config);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const model = buildTrainer(JSON.parse(key));
    s.model?.root.removeFromParent();
    s.model?.dispose();
    s.model = model;
    s.turn.add(model.root);
    s.frame();
  }, [key]);

  // ---- a taunt: each new `n` plays it from the start ----
  const tauntKey = taunt ? `${taunt.id}:${taunt.n}` : "";
  useEffect(() => {
    live.current.act = taunt ? { id: taunt.id, n: taunt.n, start: -1 } : null;
    state.current?.frame();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the taunt's id and count
  }, [tauntKey]);

  // ---- pose, facing, partner ----
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    s.layout();
    s.frame();
  }, [pose, facing, partner, still]);

  const urls = spriteCandidates({ id: `n${config.partner}`, num: config.partner }, config.shiny);
  const src = urls[Math.min(candidate, urls.length - 1)];
  useEffect(() => setCandidate(0), [config.partner, config.shiny]);

  if (failed) return null;
  return (
    <div ref={host} className="absolute inset-0 overflow-hidden">
      {partner && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={sprite}
          key={src}
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute left-0 top-0 origin-center [image-rendering:pixelated]"
          style={{ visibility: "hidden" }}
          data-testid="avatar-3d-partner"
          onLoad={(e) => {
            const img = e.currentTarget;
            live.current.spriteSize = { w: img.naturalWidth, h: img.naturalHeight };
            state.current?.layout();
            state.current?.render();
          }}
          onError={() => setCandidate((c) => (c + 1 < urls.length ? c + 1 : c))}
        />
      )}
    </div>
  );
}
