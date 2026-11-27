"use client";

import { useEffect, useRef } from "react";
import { ArtBox } from "./ArtBox";
import type { HeroMon } from "./data";

type Vars = React.CSSProperties & Record<`--${string}`, string | number>;

/** Motes rising through the beam: [left %, delay s, duration s, size px]. Fixed, so the server and the browser draw the same. */
const MOTES: [number, number, number, number][] = [
  [22, 0, 5.6, 3], [34, -1.4, 6.4, 2], [46, -3.1, 5.2, 4], [58, -0.7, 6.8, 2], [70, -2.2, 5.8, 3], [80, -4.4, 6.2, 2],
  [28, -4.9, 7.2, 2], [52, -5.6, 6.0, 3], [64, -3.8, 7.4, 2], [40, -2.8, 6.6, 3], [76, -1.1, 7.0, 2], [16, -3.4, 6.2, 2],
];

/**
 * Option 1: one Pokémon on a holo pedestal. The poster (its HOME render) is
 * drawn by the server, standing where the 3D figure will; the figure is
 * built after the page has loaded and fades in over it once its first frame
 * is drawn. No 3D for reduced motion (the poster is the still frame); the
 * canvas only draws while it's on screen.
 */
export function HeroPedestal({ mon }: { mon: HeroMon }) {
  const root = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, , bw, bh] = mon.box;
  // The figure fits a box 0.9 as wide as tall (wide ones, like Charizard, are held to the width).
  const aspect = bw / bh;
  const figH = Math.min(1, 0.92 / aspect);

  useEffect(() => {
    const el = root.current, canvas = canvasRef.current;
    if (!el || !canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let alive = true;
    let cleanup = () => {};
    const start = async () => {
      try {
        const test = document.createElement("canvas").getContext("webgl2");
        if (!test) return;
        const { createPedestalScene } = await import("./pedestal-scene");
        if (!alive) return;
        const light = () => document.documentElement.classList.contains("light");
        const s = createPedestalScene(canvas, { key: mon.key, name: mon.name, kind: "pokemon", art: mon.art, species: 0, m: mon.m, length: mon.length, min: false, w: mon.w, h: mon.h, box: mon.box, types: mon.types }, { light: light(), maxDpr: 2 });
        let visible = true;
        const sync = () => s.setRunning(visible && !document.hidden);
        const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); });
        io.observe(el);
        document.addEventListener("visibilitychange", sync);
        const mo = new MutationObserver(() => s.setLight(light()));
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        const ro = new ResizeObserver(() => s.resize());
        ro.observe(canvas);
        cleanup = () => { io.disconnect(); mo.disconnect(); ro.disconnect(); document.removeEventListener("visibilitychange", sync); s.dispose(); };
        await s.ready;
        if (!alive) return;
        sync();
        el.dataset.live = "1";
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") console.warn("lab hero: 3D unavailable", e);
      }
    };
    // After the page has settled: nothing on the page waits on three.js.
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = idle ? idle(() => void start(), { timeout: 1500 }) : window.setTimeout(() => void start(), 400);
    return () => {
      alive = false;
      if (!idle) clearTimeout(id);
      cleanup();
    };
  }, [mon]);

  return (
    <div ref={root} className="lh-ped" style={{ "--fig-h": figH, "--fig-ar": aspect } as Vars} aria-hidden data-testid="lab-hero-pedestal" data-mon={mon.key}>
      <span className="lh-ped-glow" />
      <span className="lh-ped-beam" />
      <div className="lh-ped-base">
        <span className="lh-ped-ring lh-r3" />
        <span className="lh-ped-ring lh-r2" />
        <span className="lh-ped-side" />
        <span className="lh-ped-top" />
        <span className="lh-ped-ring lh-r1" />
      </div>
      <span className="lh-ped-shadow" />
      <div className="lh-ped-fig">
        <ArtBox mon={mon} size={512} eager className="lh-ped-poster" />
      </div>
      <canvas ref={canvasRef} className="lh-ped-canvas" style={{ "--fig": figH / 1.3, "--foot": 1 - 0.12 / 1.3 } as Vars} />
      <div className="lh-ped-motes">
        {MOTES.map(([l, d, t, s], i) => (
          <span key={i} style={{ left: `${l}%`, animationDelay: `${d}s`, animationDuration: `${t}s`, width: s, height: s }} />
        ))}
      </div>
    </div>
  );
}
