"use client";

import "@/components/tools/shiny-maker/maker.css";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Box, Clapperboard, Dices, Download, Film, Image as ImageIcon, Link2, Printer, Redo2, Share, Sparkles, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import msgs from "@/messages/pokeball-maker";
import { isCleanName } from "@/lib/name-filter";
import { play } from "@/lib/sound";
import { artUrl, homeRenderUrl } from "@/lib/pokemon/art";
import { labDist, rgbToOklab } from "@/lib/shiny-maker/color";
import { loadSpecies, loadSpeciesList } from "@/lib/shiny-maker/data";
import { decodeDesign as decodeShiny } from "@/lib/shiny-maker/design";
import { pixelCanvas } from "@/lib/shiny-maker/export";
import { fromB64Url, toB64Url } from "@/lib/share/link-bytes";
import { blankDesign, cleanDesc, cleanName, cloneDesign, encodeDesign, MAX_STICKERS, PARTS, type Design, type Finish, type Part, type PatternLayer, type RGB } from "@/lib/pokeball-maker/design";
import { ballPreset, pokemonPreset, randomDesign, typePreset, type BallId, type TypeName } from "@/lib/pokeball-maker/presets";
import { catchPose, CATCH_SECONDS, frontOf, IDLE_SPEED, idlePose, OPEN_SECONDS, openPose, videoPose, type Pose } from "@/lib/pokeball-maker/anim";
import { drawAtlas } from "@/lib/pokeball-maker/glyphs";
import { stickerSize } from "@/lib/pokeball-maker/design";
import { Picker } from "@/components/tools/shiny-maker/Picker";
import { ShinyLocalContext } from "@/components/tools/shiny-maker/local";
import { CardPanel, ColoursPanel, CssBall, EffectPanel, FinishPanel, InsidePanel, PatternsPanel, ShapePanel, StartPanel, StickersPanel, type StickerBrush, type T, type Thumb } from "./panels";
import { createBallScene, type BallScene } from "./scene";
import * as ex from "./exports";

const TABS = ["start", "colours", "patterns", "finish", "shape", "stickers", "effect", "inside", "card"] as const;
type Tab = (typeof TABS)[number];
type Panel = Tab | "match" | "pick-inside" | "export";
const HISTORY_MAX = 120;

function useMedia(query: string) {
  // The maker only renders in the browser, so the first render can already know.
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

function cssFont(v: string, fallback: string) {
  const f = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  return f ? `${f}, ${fallback}` : fallback;
}

/** A Pokémon's own colours, largest share of its sprite first (outline and near-duplicates left out). */
function pokemonColours(sp: Awaited<ReturnType<typeof loadSpecies>>): RGB[] {
  const outline = new Set(sp.parts.flatMap((p) => (p.o ? p.s : [])));
  const slots = sp.slots.map((s, i) => ({ s, i })).filter(({ i, s }) => !outline.has(i) && s.count > 0).sort((a, b) => b.s.count - a.s.count);
  const out: RGB[] = [];
  for (const { s } of slots) {
    const lab = rgbToOklab(...s.normal);
    if (out.every((c) => labDist(rgbToOklab(...c), lab) > 0.09)) out.push(s.normal);
    if (out.length >= 6) break;
  }
  return out;
}

/** Where a new visitor starts: a Poké Ball with stars bursting out and Pikachu inside, so the first Open shows it all. */
function firstDesign(): Design {
  const d = ballPreset("poke");
  d.effect = { kind: "stars", colours: [[255, 214, 90], [255, 255, 255], [255, 140, 170]] };
  d.inside = { id: 25, shiny: false, custom: null };
  return d;
}

export default function BallMaker({ initial, linkBroken }: { initial: Design | null; linkBroken: boolean }) {
  const t = useT(msgs);
  const local = useContext(ShinyLocalContext);
  const phone = useMedia("(max-width: 1023px)");
  const motion = !useMedia("(prefers-reduced-motion: reduce)");
  const touch = useMedia("(pointer: coarse)");

  const [design, setDesign] = useState<Design>(() => initial ?? firstDesign());
  const designRef = useRef(design);
  designRef.current = design;
  const [panel, setPanel] = useState<Panel | null>(null);
  const [part, setPart] = useState<Part>("top");
  const [finPart, setFinPart] = useState<Part>("top");
  const [half, setHalf] = useState<"top" | "bottom">("top");
  const [brush, setBrush] = useState<StickerBrush>({ glyph: 18, size: 90, rot: 0, colour: [255, 255, 255] });
  const [selSticker, setSelSticker] = useState(-1);
  const [toast, setToast] = useState<string | null>(linkBroken ? t("badLink") : null);
  const [gl, setGl] = useState<"pending" | "ok" | "none">("pending");
  const [busy, setBusy] = useState<null | { kind: string; p: number }>(null);
  const [atlas, setAtlas] = useState<string | null>(null);
  const [names, setNames] = useState<Record<number, string>>(local?.names ?? {});
  const [rejected, setRejected] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [still, setStill] = useState<string | null>(null);
  const [, bump] = useState(0);
  const [stageEl, setStageEl] = useState<HTMLElement | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<BallScene | null>(null);
  const past = useRef<Design[]>([]);
  const future = useRef<Design[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const say = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);
  useEffect(() => {
    if (linkBroken) toastTimer.current = setTimeout(() => setToast(null), 3600);
  }, [linkBroken]);

  // ---- History: a gesture pushes the design it started from once; its moves replace the present.
  const begin = useCallback(() => {
    past.current.push(designRef.current);
    if (past.current.length > HISTORY_MAX) past.current.shift();
    future.current = [];
    bump((n) => n + 1);
  }, []);
  const commit = useCallback((next: Design) => {
    begin();
    setDesign(next);
  }, [begin]);
  const live = useCallback((f: (d: Design) => Design) => setDesign((d) => f(d)), []);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(designRef.current);
    setDesign(prev);
    bump((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(designRef.current);
    setDesign(next);
    bump((n) => n + 1);
  }, []);

  // ---- The address carries the design.
  useEffect(() => {
    const id = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("d", encodeDesign(design));
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    }, 250);
    return () => clearTimeout(id);
  }, [design]);

  // ---- The clock: idle time (paused while dragging or placing stickers), and the action playing.
  const clock = useRef({ idle: 0, last: 0, yawBase: 0.6 });
  const action = useRef<null | { kind: "open" | "catch"; t0: number; yaw0: number; withMon: boolean }>(null);
  const view = useRef({ yaw: 0, pitch: 0, vy: 0, vp: 0, dragging: false });
  const holdIdle = panel === "stickers";
  const holdRef = useRef(holdIdle);
  holdRef.current = holdIdle;
  const motionRef = useRef(motion);
  motionRef.current = motion;

  const pinned = useRef<Pose | null>(null);
  const driver = useCallback((now: number): Pose => {
    if (pinned.current) return pinned.current;
    const c = clock.current;
    const dt = c.last ? Math.min(0.1, now - c.last) : 0;
    c.last = now;
    const v = view.current;
    if (!v.dragging) {
      // Inertia after a drag, and the lean easing back.
      v.yaw += v.vy * dt;
      v.vy *= Math.exp(-dt * 3.2);
      v.pitch += v.vp * dt;
      v.vp *= Math.exp(-dt * 3.2);
      v.pitch *= Math.exp(-dt * 0.9);
      sceneRef.current?.setView(v.yaw, v.pitch);
    }
    const a = action.current;
    if (a) {
      const t = now - a.t0;
      if (!motionRef.current) {
        // Reduced motion: the moment that tells the story, held, then back.
        if (t < 2.4) return a.kind === "open" ? openPose(1.7, frontOf(a.yaw0), a.withMon) : catchPose(4.3, frontOf(a.yaw0), false, a.withMon);
      } else if (t < (a.kind === "open" ? OPEN_SECONDS : CATCH_SECONDS)) return a.kind === "open" ? openPose(t, a.yaw0, a.withMon) : catchPose(t, a.yaw0, false, a.withMon);
      c.yawBase = frontOf(a.yaw0) - c.idle * IDLE_SPEED;
      action.current = null;
    }
    if (motionRef.current && !holdRef.current && !v.dragging) c.idle += dt;
    return idlePose(c.idle, c.yawBase);
  }, []);

  const sfx = useRef<ReturnType<typeof setTimeout>[]>([]);
  const start = useCallback((kind: "open" | "catch") => {
    const c = clock.current;
    const v = view.current;
    const yaw0 = c.yawBase + c.idle * IDLE_SPEED + v.yaw;
    v.yaw = 0;
    v.vy = 0;
    sceneRef.current?.setView(0, v.pitch);
    const now = performance.now() / 1000;
    action.current = { kind, t0: now, yaw0, withMon: designRef.current.inside.id > 0 };
    sfx.current.forEach(clearTimeout);
    const at = (s: number, k: Parameters<typeof play>[0]) => sfx.current.push(setTimeout(() => play(k), s * 1000));
    if (!motionRef.current) {
      at(0.05, kind === "open" ? "ping" : "click");
      return;
    }
    if (kind === "open") {
      at(0.3, "click");
      at(0.45, "ping");
    } else {
      at(0.7, "click");
      for (const s of [1.5, 2.4, 3.3]) at(s, "tick");
      at(4.12, "click");
      at(4.2, "streak");
    }
  }, []);
  useEffect(() => () => sfx.current.forEach(clearTimeout), []);

  // For tests and screenshots: pin the stage to one moment of an animation (window.__pokeballMaker).
  useEffect(() => {
    const w = window as unknown as { __pokeballMaker?: unknown };
    w.__pokeballMaker = {
      pin(kind: "idle" | "open" | "catch" | "video", t: number) {
        const mon = designRef.current.inside.id > 0;
        pinned.current = kind === "open" ? openPose(t, 0, mon) : kind === "catch" ? catchPose(t, 0, false, mon) : kind === "video" ? videoPose(t, mon) : idlePose(t, -0.42);
      },
      unpin() {
        pinned.current = null;
      },
      tier: () => sceneRef.current?.tier() ?? -1,
      design: () => encodeDesign(designRef.current),
    };
    return () => void delete w.__pokeballMaker;
  }, []);

  // ---- The scene.
  useEffect(() => {
    const canvas = canvasEl;
    if (!canvas) return;
    const scene = createBallScene(canvas, { phone, reducedMotion: !motion, font: cssFont("--font-display", "sans-serif") });
    if (!scene) {
      setGl("none");
      return;
    }
    sceneRef.current = scene;
    scene.setDriver(driver);
    scene.onThumb(() => bump((n) => n + 1));
    scene.setDesign(designRef.current);
    setGl("ok");
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // The scene is made once per canvas; the phone and motion settings it starts with are only its first quality guess.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver, canvasEl]);

  useEffect(() => {
    sceneRef.current?.setDesign(design);
  }, [design]);

  // The stage's size.
  useLayoutEffect(() => {
    if (!stageEl) return;
    const ro = new ResizeObserver(([e]) => sceneRef.current?.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(stageEl);
    const r = stageEl.getBoundingClientRect();
    sceneRef.current?.resize(r.width, r.height);
    return () => ro.disconnect();
  }, [stageEl, gl]);

  // A drawer open on the right moves the ball left.
  const drawer = !phone && panel !== null;
  useEffect(() => {
    sceneRef.current?.setShift(drawer ? (panel === "match" || panel === "pick-inside" ? -210 : 214) : 0);
  }, [drawer, panel]);

  // The sticker atlas for the Stickers tab's buttons.
  useEffect(() => {
    if (panel !== "stickers" || atlas) return;
    const make = () => setAtlas(drawAtlas(cssFont("--font-display", "sans-serif"), 512).toDataURL());
    make();
    void document.fonts?.ready.then(make);
  }, [panel, atlas]);

  // English names for the Inside tab (another language's page sends its own).
  useEffect(() => {
    if (local || !design.inside.id || names[design.inside.id]) return;
    loadSpeciesList().then((l) => setNames(Object.fromEntries(l.map(([id, n]) => [id, n]))), () => undefined);
  }, [design.inside.id, local, names]);

  // The Pokémon inside: its HOME render (shiny or not), or a Shiny Maker design drawn in its pixels.
  const insideKey = `${design.inside.id}:${design.inside.shiny}:${design.inside.custom ? Array.from(design.inside.custom).join(",") : ""}`;
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const ins = designRef.current.inside;
    if (!ins.id) return scene.setMon(null);
    const custom = ins.custom ? decodeShiny(toB64Url(ins.custom)) : null;
    if (custom && custom.id === ins.id) {
      let live = true;
      loadSpecies(custom.id).then((sp) => live && scene.setMon({ kind: "canvas", canvas: pixelCanvas(sp, { ...custom, bg: "none" }, 6) }), () => scene.setMon({ kind: "url", urls: [homeRenderUrl(ins.id), artUrl(ins.id, 400)] }));
      return () => {
        live = false;
      };
    }
    scene.setMon({ kind: "url", urls: [homeRenderUrl(ins.id, ins.shiny), artUrl(ins.id, 400, ins.shiny)] });
  }, [insideKey, gl]);

  // The item card's picture (a small still of the ball).
  useEffect(() => {
    if (panel !== "card" || !sceneRef.current) return;
    let live = true;
    const id = setTimeout(() => {
      sceneRef.current?.still(160, ex.STILL_POSE).then((b) => live && setStill(URL.createObjectURL(b)), () => undefined);
    }, 120);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [panel, design]);
  useEffect(() => () => void (still && URL.revokeObjectURL(still)), [still]);

  // ---- Design changes.
  const setColour = (p: Part, c: RGB) => live((d) => ({ ...d, colours: { ...d.colours, [p]: c } }));
  const setLayer = (h: "top" | "bottom", l: PatternLayer, commitIt?: boolean) => {
    const f = (d: Design) => ({ ...d, patterns: { ...d.patterns, [h]: l } });
    if (commitIt) setDesign(f);
    else live(f);
  };
  const setFinish = (p: Part, f: Finish) => commit({ ...designRef.current, finishes: { ...designRef.current.finishes, [p]: f } });
  const choose = (d: Design, keepCard = true) => {
    const cur = designRef.current;
    const next = cloneDesign(d);
    if (keepCard) {
      next.name = cur.name;
      next.desc = cur.desc;
      if (!next.inside.id) next.inside = cur.inside;
      if (!next.stickers.length && d.stickers.length === 0) next.stickers = [];
    }
    commit(next);
    setSelSticker(-1);
  };
  const randomise = useCallback(() => {
    const cur = designRef.current;
    const d = randomDesign(Math.random);
    d.name = cur.name;
    d.desc = cur.desc;
    d.inside = cur.inside;
    commit(d);
    setSelSticker(-1);
  }, [commit]);

  const matchPokemon = (id: number) => {
    setPanel("start");
    say(t("start.matching", { name: names[id] ?? `#${id}` }));
    loadSpecies(id).then(
      (sp) => {
        const d = pokemonPreset({ id, types: sp.types, colours: pokemonColours(sp) });
        commit(d);
        if (!names[id]) setNames((n) => ({ ...n, [id]: local?.names[id] ?? sp.name }));
        setToast(null);
      },
      () => say(t("start.matchFailed"))
    );
  };

  const placeSticker = (x: number, y: number) => {
    const scene = sceneRef.current;
    if (!scene || action.current) return;
    const hit = scene.pick(x, y);
    if (!hit) return;
    const d = designRef.current;
    // A click on a sticker selects it.
    const dir = (az: number, pol: number) => [Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az)];
    const p = dir(hit.az, hit.pol);
    let near = -1, best = Infinity;
    d.stickers.forEach((s, i) => {
      const q = dir((s.az / 65536) * Math.PI * 2, (s.pol / 65535) * Math.PI);
      const dist = Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
      if (dist < stickerSize(s.size) * 0.9 && dist < best) {
        best = dist;
        near = i;
      }
    });
    if (near >= 0) return setSelSticker(near);
    if (d.stickers.length >= MAX_STICKERS) return say(t("stickers.full"));
    const az = Math.round((((hit.az / (Math.PI * 2)) % 1) + 1) % 1 * 65536) % 65536;
    const pol = Math.round((hit.pol / Math.PI) * 65535);
    commit({ ...d, stickers: [...d.stickers, { glyph: brush.glyph, az, pol, size: brush.size, rot: brush.rot, colour: brush.colour }] });
    setSelSticker(-1);
  };

  // ---- Dragging to turn the ball (a click without a drag places a sticker on the Stickers tab).
  const drag = useRef<{ x: number; y: number; lx: number; lt: number; moved: boolean; id: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || gl !== "ok") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, lx: e.clientX, lt: performance.now(), moved: false, id: e.pointerId };
  };
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.lx;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 5) {
      g.moved = true;
      view.current.dragging = true;
    }
    if (!g.moved) return;
    const v = view.current;
    const now = performance.now();
    const dt = Math.max(1, now - g.lt) / 1000;
    v.yaw += dx * 0.009;
    v.vy = (dx * 0.009) / dt;
    v.pitch = Math.max(-0.7, Math.min(0.7, v.pitch + e.movementY * 0.006));
    v.vp = 0;
    g.lx = e.clientX;
    g.lt = now;
    sceneRef.current?.setView(v.yaw, v.pitch);
  };
  const onUp = (e: React.PointerEvent) => {
    const g = drag.current;
    drag.current = null;
    view.current.dragging = false;
    if (!g || g.moved) {
      if (g && performance.now() - g.lt > 80) view.current.vy = 0;
      return;
    }
    if (panel === "stickers") placeSticker(e.clientX, e.clientY);
  };

  // ---- Share and downloads.
  const share = async () => {
    const url = `${window.location.origin}/tools/pokeball-maker?d=${encodeDesign(designRef.current)}`;
    if (touch && navigator.share) {
      try {
        await navigator.share({ title: designRef.current.name || t("title"), url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      say(t("export.copied"));
    } catch {
      say(t("export.copyFailed"));
    }
  };
  const run = async (kind: string, f: (scene: BallScene, signal: AbortSignal) => Promise<void>, needsGl = true) => {
    const scene = sceneRef.current;
    if (needsGl && !scene) return say(t("export.needsGl"));
    if (busy) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy({ kind, p: 0 });
    try {
      await f(scene!, ac.signal);
      say(t("export.downloaded"));
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        console.error("[pokeball-maker]", e);
        say(t("export.failed"));
      }
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  };
  const downloads = {
    png: (s: 1 | 2 | 4) => run("png", (scene) => ex.png(scene, designRef.current, s)),
    gif: () => run("gif", (scene) => ex.gif(scene, designRef.current)),
    video: () =>
      run("video", (scene, signal) =>
        ex.video(
          scene,
          designRef.current,
          { title: designRef.current.name || t("card.untitled"), kicker: t("title"), end: t("export.videoEnd"), font: cssFont("--font-display", "sans-serif"), sans: cssFont("--font-body", "sans-serif") },
          (p) => setBusy({ kind: "video", p }),
          signal
        )
      ),
    glb: () => run("glb", (scene) => ex.glb(scene, designRef.current)),
    stl: () => run("stl", async () => ex.stl(designRef.current), false),
  };

  // ---- Keys: Space randomises, O opens, C catches, ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y) undo and redo, Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        if (panel) setPanel(null);
        return;
      }
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey || e.repeat) return;
      const onControl = !!el?.closest("button, [role=slider], [role=radio], [role=switch], a, select, input");
      if ((e.key === " " || e.code === "Space") && !onControl) {
        e.preventDefault();
        randomise();
      } else if (e.key === "o" || e.key === "O") start("open");
      else if (e.key === "c" || e.key === "C") start("catch");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, undo, redo, randomise, start]);

  const thumb: Thumb = useCallback((o) => sceneRef.current?.thumb(o) ?? null, []);
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  function panelBody(p: Panel, compact: boolean): ReactNode {
    const d = design;
    switch (p) {
      case "start":
        return <StartPanel t={t} onPick={(id: BallId) => choose(ballPreset(id))} onType={(ty: TypeName) => choose(typePreset(ty))} onBlank={() => choose(blankDesign())} onRandom={randomise} onMatch={() => setPanel("match")} />;
      case "colours":
        return <ColoursPanel t={t} compact={compact} design={d} part={part} onPart={setPart} onBegin={begin} onColour={setColour} />;
      case "patterns":
        return (
          <PatternsPanel
            t={t}
            compact={compact}
            design={d}
            half={half}
            onHalf={setHalf}
            onBegin={begin}
            onLayer={setLayer}
            onBoth={() => commit({ ...d, patterns: { top: d.patterns[half], bottom: { ...d.patterns[half], colours: [...d.patterns[half].colours] as PatternLayer["colours"] } } })}
            thumb={thumb}
          />
        );
      case "finish":
        return <FinishPanel t={t} design={d} part={finPart} onPart={setFinPart} onFinish={setFinish} onAll={(f) => commit({ ...d, finishes: Object.fromEntries(PARTS.map((x) => [x, x === "button" && f === "glow" ? d.finishes.button : f])) as Design["finishes"] })} thumb={thumb} glassReal={(sceneRef.current?.tier() ?? 0) >= 2} />;
      case "shape":
        return <ShapePanel t={t} design={d} onBegin={begin} onChange={(patch, c) => (c ? commit({ ...d, ...patch }) : live((x) => ({ ...x, ...patch })))} />;
      case "stickers":
        return (
          <StickersPanel
            t={t}
            compact={compact}
            design={d}
            brush={brush}
            onBrush={setBrush}
            sel={selSticker}
            onSel={setSelSticker}
            onBegin={begin}
            onSticker={(i, patch) => live((x) => ({ ...x, stickers: x.stickers.map((s, k) => (k === i ? { ...s, ...patch } : s)) }))}
            onRemove={(i) => {
              commit({ ...d, stickers: d.stickers.filter((_, k) => k !== i) });
              setSelSticker(-1);
            }}
            onClear={() => {
              commit({ ...d, stickers: [] });
              setSelSticker(-1);
            }}
            atlas={atlas}
            touch={touch}
          />
        );
      case "effect":
        return <EffectPanel t={t} compact={compact} design={d} onBegin={begin} onEffect={(e, c) => (c ? commit({ ...d, effect: e }) : live((x) => ({ ...x, effect: e })))} onPlay={() => start("open")} />;
      case "inside":
        return (
          <InsidePanel
            t={t}
            design={d}
            name={d.inside.id ? names[d.inside.id] ?? null : null}
            onChoose={() => setPanel("pick-inside")}
            onShiny={(v) => commit({ ...d, inside: { ...d.inside, shiny: v } })}
            onClear={() => commit({ ...d, inside: { id: 0, shiny: false, custom: null } })}
            linkError={linkError}
            onLink={(s) => {
              const raw = (() => {
                try {
                  return new URL(s.trim(), window.location.origin).searchParams.get("d") ?? s.trim();
                } catch {
                  return s.trim();
                }
              })();
              const sd = decodeShiny(raw);
              const bytes = sd ? fromB64Url(raw) : null;
              if (!sd || !bytes || bytes.length > 255) return setLinkError(true);
              setLinkError(false);
              commit({ ...d, inside: { id: sd.id, shiny: false, custom: bytes } });
              start("open");
            }}
          />
        );
      case "card":
        return (
          <CardPanel
            t={t}
            design={d}
            still={still}
            rejected={rejected}
            onName={(n) => {
              const c = cleanName(n);
              if (c && !isCleanName(c)) return setRejected(true);
              setRejected(false);
              if (c !== d.name) commit({ ...d, name: c });
            }}
            onDesc={(s) => {
              const c = cleanDesc(s);
              if (c && !isCleanName(c)) return setRejected(true);
              if (c !== d.desc) commit({ ...d, desc: c });
            }}
          />
        );
      case "match":
      case "pick-inside":
        return (
          <Picker
            current={p === "pick-inside" ? d.inside.id : 0}
            onPick={(id) => {
              if (p === "match") return matchPokemon(id);
              setPanel("inside");
              commit({ ...d, inside: { id, shiny: d.inside.shiny, custom: null } });
              if (!names[id] && local?.names[id]) setNames((n) => ({ ...n, [id]: local.names[id] }));
              start("open");
            }}
          />
        );
      case "export":
        return <ExportMenu t={t} busy={busy} gl={gl === "ok"} onCopy={share} downloads={downloads} onCancel={() => abortRef.current?.abort()} />;
    }
  }

  const panelTitle = (p: Panel) => (p === "match" ? t("start.pickTitle") : p === "pick-inside" ? t("inside.choose") : p === "export" ? t("export.title") : t(`tabs.${p}`));

  const stage = (
    <section
      ref={setStageEl}
      className={cn("sm-stage relative select-none overflow-hidden", phone ? "touch-pan-y" : "touch-none", " border border-white/[0.06]", phone ? (panel ? "sticky top-14 z-20 h-[min(300px,36svh)] min-h-[220px] rounded-[24px] shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)]" : "h-[min(440px,56svh)] min-h-[340px] rounded-[24px]") : "h-[calc(100dvh-108px)] min-h-[640px] rounded-[28px]", panel === "stickers" && "cursor-crosshair")}
      data-testid="pbm-stage"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        drag.current = null;
        view.current.dragging = false;
      }}
    >
      <canvas ref={setCanvasEl} className={cn("absolute inset-0 h-full w-full", gl === "none" && "hidden")} role="img" aria-label={t("stage")} data-testid="pbm-canvas" />
      {gl === "none" && <FlatBall design={design} t={t} />}
      {!phone && (
        <header className="pointer-events-none absolute left-9 top-8 z-10">
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">{t("subtitle")}</p>
        </header>
      )}
      <div className={cn("absolute z-10 flex items-center gap-1 rounded-full bg-black/25 p-1 backdrop-blur-md", phone ? "bottom-3 left-1/2 -translate-x-1/2" : "right-8 top-8")} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => start("open")} className="flex h-10 items-center gap-2 rounded-full bg-white/[0.1] px-4 text-[14px] font-medium transition-colors hover:bg-white/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="pbm-open">
          <Sparkles className="h-4 w-4" aria-hidden /> {t("actions.open")}
        </button>
        <button type="button" onClick={() => start("catch")} className="flex h-10 items-center gap-2 rounded-full px-4 text-[14px] text-foreground/80 transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="pbm-catch">
          {t("actions.catch")}
        </button>
        {!phone && (
          <>
            <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
            <IconButton label={t("actions.undo")} onClick={undo} disabled={!past.current.length} testId="pbm-undo"><Undo2 className="h-4 w-4" aria-hidden /></IconButton>
            <IconButton label={t("actions.redo")} onClick={redo} disabled={!future.current.length} testId="pbm-redo"><Redo2 className="h-4 w-4" aria-hidden /></IconButton>
          </>
        )}
      </div>
      {panel === "stickers" && !phone && <p className="pointer-events-none absolute left-1/2 top-8 z-10 -translate-x-[calc(50%+214px)] rounded-full bg-black/35 px-4 py-2 text-[13px] text-foreground/90 backdrop-blur-md">{touch ? t("stickers.hintTouch") : t("stickers.hint")}</p>}
      {toast && (
        <div className="sm-enter pointer-events-none absolute left-1/2 top-[84px] z-30 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-[13.5px] font-medium text-[#141225] shadow-lg max-lg:top-4" role="status" data-testid="pbm-toast">
          {toast}
        </div>
      )}
      {busy && busy.kind === "video" && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-[hsl(248_34%_6%/0.92)]" role="status" onPointerDown={(e) => e.stopPropagation()}>
          <p className="text-[15px]">{t("export.progress", { pct: Math.round(busy.p * 100) })}</p>
          <div className="h-1.5 w-56 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-primary transition-[width]" style={{ width: `${busy.p * 100}%` }} /></div>
          <button type="button" onClick={() => abortRef.current?.abort()} className="h-9 rounded-full border border-white/15 px-4 text-[13px] hover:bg-white/[0.06]">{t("export.cancel")}</button>
        </div>
      )}
      {!phone && panel && (
        <Drawer side={panel === "match" || panel === "pick-inside" ? "left" : "right"} title={panelTitle(panel)} onClose={() => setPanel(null)} t={t} testId={`pbm-drawer-${panel}`}>
          {panelBody(panel, false)}
        </Drawer>
      )}
      {!phone && <Dock panel={panel} onTab={(tab) => togglePanel(tab)} onRandomise={randomise} onShare={() => togglePanel("export")} shareOpen={panel === "export"} t={t} />}
    </section>
  );

  return (
    <div className="dark-scope relative" data-testid="pokeball-maker" data-gl={gl}>
      {phone ? (
        <div className="space-y-4">
          <header className="px-1">
            <h1 className="font-display text-[22px] font-semibold leading-tight tracking-tight">{t("title")}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
          </header>
          {stage}
          <div className="sm-noscroll -mx-4 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label={t("tabs.label")} data-testid="pbm-tabs">
            {TABS.map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={panel === tab} onClick={() => togglePanel(tab)} className={cn("flex h-11 shrink-0 items-center rounded-full border px-4 text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70", panel === tab ? "border-white/20 bg-white/[0.1] text-foreground" : "border-white/[0.07] text-foreground/70")} data-testid={`pbm-tab-${tab}`}>
                {t(`tabs.${tab}`)}
              </button>
            ))}
          </div>
          {panel && (
            <section className="sm-pop rounded-[24px] p-4" aria-label={panelTitle(panel)} data-testid={`pbm-drawer-${panel}`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold">{panelTitle(panel)}</h2>
                <button type="button" onClick={() => setPanel(null)} aria-label={t("actions.close")} className="-mr-1 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
              <div className={cn((panel === "match" || panel === "pick-inside") && "h-[60svh]")}>{panelBody(panel, true)}</div>
            </section>
          )}
          <div className="grid grid-cols-[auto_auto_1fr_1fr] gap-2">
            <IconButton label={t("actions.undo")} onClick={undo} disabled={!past.current.length} big testId="pbm-undo"><Undo2 className="h-5 w-5" aria-hidden /></IconButton>
            <IconButton label={t("actions.redo")} onClick={redo} disabled={!future.current.length} big testId="pbm-redo"><Redo2 className="h-5 w-5" aria-hidden /></IconButton>
            <button type="button" onClick={randomise} className="flex h-12 items-center justify-center gap-2 rounded-full border border-white/[0.1] text-[15px] font-medium text-foreground/85 transition-colors active:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="pbm-randomise">
              <Dices className="h-[18px] w-[18px]" aria-hidden /> {t("actions.randomise")}
            </button>
            <button type="button" onClick={() => togglePanel("export")} className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80" data-testid="pbm-share">
              <Share className="h-4 w-4" aria-hidden /> {t("actions.share")}
            </button>
          </div>
        </div>
      ) : (
        stage
      )}
      <p className="mt-4 px-1 text-center text-[12px] leading-relaxed text-muted-foreground/70">{t("credit")}</p>
    </div>
  );
}

function IconButton({ label, onClick, disabled, children, big, testId }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; big?: boolean; testId?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className={cn("flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-35 disabled:hover:bg-transparent", big ? "h-12 w-12 border border-white/[0.1]" : "h-10 w-10")} data-testid={testId}>
      {children}
    </button>
  );
}

function FlatBall({ design, t }: { design: Design; t: T }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6" data-testid="pbm-flat">
      <CssBall design={design} size={220} className="max-sm:!h-40 max-sm:!w-40" />
      <p className="max-w-sm text-center text-[13px] text-muted-foreground">{t("noWebgl")}</p>
    </div>
  );
}

function Dock({ panel, onTab, onRandomise, onShare, shareOpen, t }: { panel: Panel | null; onTab: (t: Tab) => void; onRandomise: () => void; onShare: () => void; shareOpen: boolean; t: T }) {
  return (
    <div className="sm-dock absolute inset-x-0 bottom-8 z-20 mx-auto flex w-fit max-w-[calc(100%-48px)] items-center gap-1 rounded-full p-1.5" role="toolbar" aria-label={t("tabs.label")} data-testid="pbm-dock" onPointerDown={(e) => e.stopPropagation()}>
      <div className="sm-noscroll flex min-w-0 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label={t("tabs.label")}>
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={panel === tab}
            onClick={() => onTab(tab)}
            className={cn("flex h-11 shrink-0 items-center rounded-full px-3.5 text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 max-xl:px-2.5 max-xl:text-[13.5px]", panel === tab ? "bg-white/[0.1] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-foreground/70 hover:bg-white/[0.05] hover:text-foreground")}
            data-testid={`pbm-tab-${tab}`}
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>
      <span className="mx-1 h-6 w-px shrink-0 bg-white/10" aria-hidden />
      <button type="button" onClick={onRandomise} title={t("actions.keys")} aria-label={t("actions.randomise")} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="pbm-randomise">
        <Dices className="h-[18px] w-[18px]" aria-hidden />
      </button>
      <button type="button" onClick={onShare} aria-expanded={shareOpen} className="ml-0.5 flex h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-5 font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black" data-testid="pbm-share">
        <Share className="h-4 w-4" aria-hidden /> {t("actions.share")}
      </button>
    </div>
  );
}

/** A desktop drawer inside the stage. */
function Drawer({ side, title, onClose, children, t, testId }: { side: "left" | "right"; title: string; onClose: () => void; children: ReactNode; t: T; testId: string }) {
  return (
    <div className={cn("sm-pop sm-enter absolute bottom-[112px] top-6 z-30 flex w-[420px] flex-col rounded-[24px] p-5 pr-3", side === "left" ? "left-6" : "right-6")} role="dialog" aria-label={title} data-testid={testId} onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-4 flex shrink-0 items-center justify-between pr-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label={t("actions.close")} className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="pbm-drawer-close">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">{children}</div>
    </div>
  );
}

function ExportMenu({ t, busy, gl, onCopy, downloads, onCancel }: { t: T; busy: null | { kind: string; p: number }; gl: boolean; onCopy: () => void; downloads: { png: (s: 1 | 2 | 4) => void; gif: () => void; video: () => void; glb: () => void; stl: () => void }; onCancel: () => void }) {
  const Row = ({ icon, title, hint, children, testId, onClick, disabled }: { icon: ReactNode; title: string; hint: string; children?: ReactNode; testId: string; onClick?: () => void; disabled?: boolean }) => (
    <div className={cn("flex items-center gap-3 rounded-2xl px-3 py-2.5", onClick && !disabled && "cursor-pointer transition-colors hover:bg-white/[0.06]", disabled && "opacity-45")} onClick={disabled ? undefined : onClick} data-testid={testId}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-foreground/85">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="block text-[12.5px] text-muted-foreground">{busy?.kind === testId.replace("pbm-export-", "") ? t("export.working") : hint}</span>
      </span>
      {children}
    </div>
  );
  const pill = "h-9 rounded-full border border-white/[0.12] px-3 text-[13px] font-medium transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40";
  return (
    <div className="space-y-1" data-testid="pbm-export">
      <button type="button" onClick={onCopy} className="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80" data-testid="pbm-copy">
        <Link2 className="h-4 w-4" aria-hidden /> {t("export.copy")}
      </button>
      <Row icon={<ImageIcon className="h-[18px] w-[18px]" aria-hidden />} title={t("export.png")} hint={t("export.pngHint")} testId="pbm-export-png" disabled={!gl}>
        <div className="flex gap-1">
          {([1, 2, 4] as const).map((s) => (
            <button key={s} type="button" disabled={!gl || !!busy} onClick={() => downloads.png(s)} className={pill} data-testid={`pbm-png-${s}`}>
              {s}×
            </button>
          ))}
        </div>
      </Row>
      <Row icon={<Film className="h-[18px] w-[18px]" aria-hidden />} title={t("export.gif")} hint={t("export.gifHint")} testId="pbm-export-gif" disabled={!gl || !!busy} onClick={downloads.gif}>
        <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
      </Row>
      <Row icon={<Clapperboard className="h-[18px] w-[18px]" aria-hidden />} title={t("export.video")} hint={t("export.videoHint")} testId="pbm-export-video" disabled={!gl || !!busy} onClick={downloads.video}>
        <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
      </Row>
      <Row icon={<Box className="h-[18px] w-[18px]" aria-hidden />} title={t("export.glb")} hint={t("export.glbHint")} testId="pbm-export-glb" disabled={!gl || !!busy} onClick={downloads.glb}>
        <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
      </Row>
      <Row icon={<Printer className="h-[18px] w-[18px]" aria-hidden />} title={t("export.stl")} hint={t("export.stlHint")} testId="pbm-export-stl" disabled={!!busy} onClick={downloads.stl}>
        <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
      </Row>
      {busy && busy.kind !== "video" && (
        <button type="button" onClick={onCancel} className="mt-2 text-[12.5px] text-muted-foreground hover:text-foreground">{t("export.cancel")}</button>
      )}
    </div>
  );
}
