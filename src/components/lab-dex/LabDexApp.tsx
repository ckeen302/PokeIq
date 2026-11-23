"use client";

import { STAGE_POSTERS, StagePoster } from "@/components/lab/StagePoster";
import { deviceInfo } from "@/lib/gl/device-tier";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { typeColor } from "@/lib/pokemon/type-colors";
import { publicCryUrl } from "@/lib/pokemon/art";
import { isMuted } from "@/lib/sound";
import { roleTable } from "@/lib/lab-dex/roles";
import { DEFAULT_VIEW, buildSequence, sameView, viewFromParams, viewToParams, type LabView } from "@/lib/lab-dex/sequence";
import { fromRow, type LabDetails, type LabLocal, type LabMon, type LabRow } from "@/lib/lab-dex/types";
import { PODS, Wheel, mod, nearestSlot } from "@/lib/lab-dex/wheel";
import { SCENE_URLS } from "@/components/sizes/scene-item";
import { cn } from "@/lib/utils";
import { Fallback2D, type Fallback2DHandle } from "./Fallback2D";
import { BaseStats, Corners, Heading, InfoCard, OpenInDex, Roles, StatsTabs, dexNo, glass, type StatsTab } from "./panels";
import { GenPicker, SearchBox, SortPicker, Toolbar, TogglesList, TypePicker, activeCount } from "./Toolbar";
import { LabLocalContext, useLabStrings } from "./strings";
import type { LabScene } from "./scene";
import { Governor, startTier, type Tier } from "./scene/quality";

/**
 * The Professor's Lab (/lab/pokedex): every Pokémon on an endless wheel of
 * capsule pods round a holo-table. This component owns the state (the
 * filtered, sorted sequence, the wheel, the Pokémon on the table, the URL)
 * and the input (drag with inertia, arrows, the mouse wheel, swipes, clicks
 * on pods, search); the 3D scene (./scene, loaded on its own) only draws.
 * Without WebGL the same wheel drives a 2D one under the same panels.
 */

type Mode = "boot" | "3d" | "2d";

interface Debug {
  mode: Mode;
  ready: boolean;
  shown: number | null;
  settled: number | null;
  wheel: { p: number; target: number | null; v: number };
  seqLength: number;
  stats: ReturnType<LabScene["stats"]> | null;
  tier: Tier | null;
  frames: number;
}

declare global {
  interface Window {
    __labDex?: () => Debug;
  }
}

function webglOk() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    // Give the probe's context back at once: browsers cap live contexts and drop the oldest.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

function cssFont(v: string, fallback: string) {
  const f = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  return f || fallback;
}

const isTyping = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  if (!e) return false;
  const tag = e.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.isContentEditable;
};

/**
 * `local`: a page in another language's type names (English pages send none). `intro`: the lab's heading and what it
 * is, unseen (screen readers and crawlers), in the page's HTML until the lab starts; then each Pokémon's name heads it.
 */
export function LabDexApp({ rows, local, intro }: { rows: LabRow[]; local?: LabLocal; intro?: React.ReactNode }) {
  return (
    <LabLocalContext.Provider value={local}>
      <Lab rows={rows} intro={intro} />
    </LabLocalContext.Provider>
  );
}

function Lab({ rows, intro }: { rows: LabRow[]; intro?: React.ReactNode }) {
  const S = useLabStrings();
  const lang = S.locale;
  const all = useMemo(() => rows.map(fromRow), [rows]);
  const tables = useMemo(() => ({ species: roleTable(all.filter((m) => !m.isForm)), everyone: roleTable(all) }), [all]);
  const [booted, setBooted] = useState(false);
  const [view, setView] = useState<LabView>(DEFAULT_VIEW);
  const seq = useMemo(() => buildSequence(all, view, lang), [all, view, lang]);
  const inSeq = useMemo(() => new Map(seq.map((i, pos) => [all[i].id, pos])), [all, seq]);
  const [shown, setShown] = useState<number | null>(null);
  const [settled, setSettled] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("boot");
  const [ready, setReady] = useState(false);
  const [sceneKey, setSceneKey] = useState(0);
  const [phone, setPhone] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const [tab, setTab] = useState<StatsTab>("stats");
  const [sheet, setSheet] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [, setDetailsTick] = useState(0);

  const wheel = useRef(new Wheel()).current;
  const seqRef = useRef(seq);
  const sceneRef = useRef<LabScene | null>(null);
  const fbRef = useRef<Fallback2DHandle>(null);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const phoneSearchRef = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const pendingPick = useRef<number | null>(null);
  const pushNext = useRef(false);
  const interacted = useRef(false);
  const details = useRef(new Map<number, LabDetails | null>());
  const tierRef = useRef<Tier | null>(null);
  const frames = useRef(0);
  const reducedMotion = useRef(false);
  /** What the frame loop last told React (reset when the sequence changes, so a slot number from the old sequence is never read against the new one). */
  const loopMarks = useRef<{ shown: number | null; settled: number | null }>({ shown: null, settled: null });

  const len = seq.length;
  const monAt = useCallback((pos: number): LabMon => all[seqRef.current[mod(pos, seqRef.current.length)]], [all]);
  // (Right after the sequence changes, the layout effect below moves the wheel before anything is painted.)
  const mon = shown !== null && len > 0 ? all[seq[mod(shown, len)]] : null;
  const viewRef = useRef(view);
  viewRef.current = view;
  /** The Pokémon the wheel is on (or heading to). */
  const currentMonId = useCallback(() => {
    const s = seqRef.current;
    return s.length ? all[s[mod(wheel.rest(), s.length)]].id : null;
  }, [all, wheel]);

  // ---- Boot: the URL's view and pick, the device, WebGL.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const v = viewFromParams(q);
    const pick = Number(q.get("pick"));
    pendingPick.current = Number.isFinite(pick) && pick > 0 ? pick : 1;
    const mq = window.matchMedia("(max-width: 1023px)");
    const cq = window.matchMedia("(pointer: coarse)");
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPhone(mq.matches);
    setCoarse(cq.matches);
    const onMq = () => setPhone(mq.matches);
    mq.addEventListener("change", onMq);
    setView(v);
    setBooted(true);
    setMode(q.get("view") === "2d" || !webglOk() ? "2d" : "3d");
    document.documentElement.classList.add("lx-locked");
    return () => {
      mq.removeEventListener("change", onMq);
      document.documentElement.classList.remove("lx-locked");
    };
  }, []);

  // ---- The sequence changed (or first arrived): keep the Pokémon on the table if it's still in it, refill the ring.
  useLayoutEffect(() => {
    if (!booted) return;
    const want = pendingPick.current ?? currentMonId();
    seqRef.current = seq;
    pendingPick.current = null;
    const pos = want != null ? (inSeq.get(want) ?? -1) : -1;
    wheel.set(pos >= 0 ? pos : 0);
    version.current++;
    sceneRef.current?.setSequence(seq.length, (i) => all[seq[i]], version.current);
    loopMarks.current = { shown: null, settled: null };
    setSettled(null);
    setShown(seq.length ? wheel.p : null);
  }, [booted, seq, inSeq, all, wheel, currentMonId]);

  // ---- The frame loop: the wheel's motion, the scene, the 2D fallback; paused while the tab is hidden.
  useEffect(() => {
    if (!booted) return;
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    let clock = 0;
    const q = new URLSearchParams(location.search).get("q");
    const nav = navigator as Navigator & { deviceMemory?: number };
    const forced = q !== null && /^[0-3]$/.test(q);
    // The screen's start, lowered for a weak device (a software renderer, an old GPU, a slow CPU).
    const device = deviceInfo().tier;
    const first = forced ? (Number(q) as Tier) : (Math.min(startTier({ phone: window.matchMedia("(max-width: 1023px)").matches, cores: nav.hardwareConcurrency || 8, memoryGb: nav.deviceMemory }), device === 0 ? 0 : device === 1 ? 1 : 3) as Tier);
    tierRef.current = first;
    const governor = new Governor(first, first);
    // Test aid (?rec=1): a fixed step a frame, so a slow software renderer can be filmed frame by frame at the real pace.
    const fixedStep = new URLSearchParams(location.search).get("rec") === "1" ? 1 / 30 : 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = fixedStep || Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      frames.current++;
      wheel.update(dt);
      const n = seqRef.current.length;
      const s = n === 0 ? null : wheel.target !== null && !wheel.dragging && Math.abs(wheel.p - wheel.target) < 0.5 ? wheel.target : Math.round(wheel.p);
      if (s !== loopMarks.current.shown) { loopMarks.current.shown = s; setShown(s); }
      const st = n > 0 && wheel.settled() ? wheel.target : null;
      if (st !== loopMarks.current.settled) { loopMarks.current.settled = st; setSettled(st); }
      const scene = sceneRef.current;
      if (scene) {
        clock += dt;
        scene.frame(wheel, dt, fixedStep ? clock : (now - t0) / 1000);
        if (!forced) {
          const t = governor.frame(dt);
          if (t !== null) { scene.setTier(t); tierRef.current = t; }
        }
      }
      fbRef.current?.frame(wheel.p);
    };
    const start = () => { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(tick); };
    const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    document.addEventListener("visibilitychange", onVis);
    start();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [booted, wheel]);

  // ---- The 3D scene (three.js and the lab load only here, on their own).
  useEffect(() => {
    if (mode !== "3d") return;
    const el = host.current;
    if (!el) return;
    let alive = true;
    let scene: LabScene | null = null;
    let ro: ResizeObserver | null = null;
    setReady(false);
    (async () => {
      const fonts = { display: cssFont("--font-display", "sans-serif"), pixel: cssFont("--font-pixel", "monospace"), body: cssFont("--font-body", "sans-serif"), ...(S.caption && { words: S.caption }) };
      await Promise.all([document.fonts.load(`700 40px ${fonts.display}`), document.fonts.load(`600 20px ${fonts.display}`), document.fonts.load(`400 20px ${fonts.pixel}`)]).catch(() => undefined);
      const { createLabScene } = await import("./scene");
      if (!alive) return;
      try {
        scene = createLabScene(el, {
          fonts,
          urls: SCENE_URLS,
          tier: tierRef.current ?? 2,
          phone: window.matchMedia("(max-width: 1023px)").matches,
          reducedMotion: reducedMotion.current,
          onContextGone: () => setSceneKey((k) => k + 1),
        });
      } catch (e) {
        console.warn("lab: 3D unavailable", e);
        if (alive) setMode("2d");
        return;
      }
      const s = seqRef.current;
      scene.setSequence(s.length, (i) => all[s[i]], version.current);
      ro = new ResizeObserver(() => scene?.resize(el.clientWidth, el.clientHeight));
      ro.observe(el);
      await scene.ready;
      if (!alive) return;
      sceneRef.current = scene;
      setReady(true);
    })();
    return () => {
      alive = false;
      ro?.disconnect();
      if (sceneRef.current === scene) sceneRef.current = null;
      scene?.dispose();
    };
  }, [mode, sceneKey, all, S.caption]);

  useEffect(() => {
    if (mode === "2d") setReady(true);
  }, [mode]);

  // ---- Test and debugging aid.
  useEffect(() => {
    window.__labDex = () => ({
      mode,
      ready,
      shown: currentMonId(),
      settled: settled === null || !seqRef.current.length ? null : all[seqRef.current[mod(settled, seqRef.current.length)]].id,
      wheel: { p: wheel.p, target: wheel.target, v: wheel.v },
      seqLength: seqRef.current.length,
      stats: sceneRef.current?.stats() ?? null,
      tier: tierRef.current,
      frames: frames.current,
    });
    return () => { delete window.__labDex; };
  }, [mode, ready, settled, all, wheel, currentMonId]);

  // ---- Moving the wheel.
  const jump = useCallback((pos: number, push = false) => {
    const n = seqRef.current.length;
    if (!n) return;
    const target = nearestSlot(wheel.rest(), pos, n);
    const d = target - wheel.p;
    // Far away: cut to just short of it (the pods refill in a wave) and spin the last few slots.
    if (Math.abs(d) > PODS / 2 + 1) {
      wheel.set(target - Math.sign(d) * 3);
      version.current++;
      sceneRef.current?.setSequence(n, (i) => all[seqRef.current[i]], version.current);
    }
    // Already there: nothing moves, nothing to add to history.
    if (target === wheel.rest() && wheel.settled()) return;
    wheel.goTo(target);
    if (push) pushNext.current = true;
  }, [all, wheel]);

  const step = useCallback((dir: number) => {
    interacted.current = true;
    wheel.step(dir);
  }, [wheel]);

  // ---- Settled on a Pokémon: the URL, the announcement, its details, its cry.
  useEffect(() => {
    if (settled === null || !seqRef.current.length) return;
    const m = monAt(settled);
    const q = viewToParams(view, m.id).toString();
    const url = `${location.pathname}?${q}`;
    if (`${location.pathname}${location.search}` !== url) {
      if (pushNext.current) window.history.pushState(null, "", url);
      else window.history.replaceState(window.history.state, "", url);
    }
    pushNext.current = false;
    setAnnounce(S.announce(m.name, String(m.species), m.types.map((ty) => S.typeName(ty) ?? ty).join(", ")));
    if (interacted.current && !isMuted()) {
      try {
        const a = new Audio();
        if (a.canPlayType("audio/ogg")) {
          a.src = publicCryUrl(m.species);
          a.volume = 0.35;
          void a.play().catch(() => undefined);
        }
      } catch {
        // No audio: fine.
      }
    }
  }, [settled, view, monAt]);

  // Details: a few hundred bytes per Pokémon, fetched once it's on the table (and kept).
  const detailId = settled !== null && len ? monAt(settled).id : null;
  useEffect(() => {
    if (detailId === null || details.current.has(detailId)) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      fetch(lang === "en" ? `/api/lab-dex/${detailId}` : `/api/lab-dex/${detailId}/${lang}`, { signal: ac.signal })
        .then((r) => (r.ok ? (r.json() as Promise<LabDetails>) : null))
        .then((d) => { details.current.set(detailId, d); setDetailsTick((x) => x + 1); })
        .catch(() => undefined);
    }, 120);
    return () => { clearTimeout(t); ac.abort(); };
  }, [detailId, lang]);

  // ---- The view: filters and sort (a new history entry, so Back undoes them).
  const changeView = useCallback((part: Partial<LabView>) => {
    const v = viewRef.current;
    const next = { ...v, ...part };
    if (sameView(v, next)) return;
    pushNext.current = false;
    window.history.pushState(null, "", `${location.pathname}?${viewToParams(next, pendingPick.current ?? currentMonId()).toString()}`);
    viewRef.current = next;
    setView(next);
  }, [currentMonId]);

  const showAnyway = useCallback((id: number) => {
    const m = all.find((x) => x.id === id);
    if (!m) return;
    pendingPick.current = id;
    changeView({ ...DEFAULT_VIEW, forms: m.isForm, sort: view.sort, reverse: view.reverse });
  }, [all, changeView, view.sort, view.reverse]);

  const pickId = useCallback((id: number) => {
    const pos = inSeq.get(id);
    if (pos === undefined) return;
    interacted.current = true;
    jump(pos, true);
  }, [inSeq, jump]);

  // Back and Forward: the URL's view and pick.
  useEffect(() => {
    const onPop = () => {
      const q = new URLSearchParams(location.search);
      const v = viewFromParams(q);
      const pick = Number(q.get("pick"));
      if (!sameView(viewRef.current, v)) {
        pendingPick.current = pick > 0 ? pick : null;
        viewRef.current = v;
        setView(v);
        return;
      }
      const pos = inSeqRef.current.get(pick);
      if (pos !== undefined) jumpRef.current(pos);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const inSeqRef = useRef(inSeq);
  inSeqRef.current = inSeq;
  const jumpRef = useRef(jump);
  jumpRef.current = jump;

  // ---- Keys: ← → turn the wheel (Page Up / Down by ten, Home / End to the ends), / searches.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      const n = seqRef.current.length;
      if (e.key === "/") {
        e.preventDefault();
        (window.matchMedia("(max-width: 1023px)").matches ? phoneSearchRef : searchRef).current?.focus();
        return;
      }
      if (!n) return;
      if ((e.target as HTMLElement | null)?.getAttribute?.("role") === "tab") return;
      const map: Record<string, () => void> = {
        ArrowRight: () => step(1),
        ArrowLeft: () => step(-1),
        PageDown: () => { interacted.current = true; jump(mod(wheel.rest() + 10, n)); },
        PageUp: () => { interacted.current = true; jump(mod(wheel.rest() - 10, n)); },
        Home: () => { interacted.current = true; jump(0); },
        End: () => { interacted.current = true; jump(n - 1); },
      };
      const f = map[e.key];
      if (f) {
        e.preventDefault();
        f();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump, step, wheel]);

  // ---- Pointer: drag (or swipe) to turn with inertia, click a pod to bring it round; the mouse wheel steps.
  const drag = useRef<{ id: number; x: number; total: number } | null>(null);
  const pxPerSlot = phone ? 72 : 120;
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !seqRef.current.length) return;
    interacted.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, total: 0 };
    wheel.grab(e.timeStamp / 1000);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.pointerType === "mouse") sceneRef.current?.pointer(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    d.x = e.clientX;
    d.total += Math.abs(dx);
    wheel.drag(-dx / pxPerSlot, e.timeStamp / 1000);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    wheel.release(e.timeStamp / 1000);
    if (d.total < 6 && e.type === "pointerup") {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const slot = sceneRef.current ? sceneRef.current.pick(e.clientX - r.left, e.clientY - r.top) : (fbRef.current?.pick(e.clientX - r.left, r.width) ?? null);
      if (slot !== null) wheel.goTo(slot);
    }
  };
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let acc = 0;
    let lastT = 0;
    const onWheel = (e: WheelEvent) => {
      if (!seqRef.current.length) return;
      e.preventDefault();
      interacted.current = true;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const px = e.deltaMode === 1 ? d * 33 : e.deltaMode === 2 ? d * 400 : d;
      if (e.timeStamp - lastT > 250) acc = 0;
      lastT = e.timeStamp;
      acc += px;
      while (Math.abs(acc) >= 60) {
        wheel.step(Math.sign(acc));
        acc -= Math.sign(acc) * 60;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wheel, booted]);

  // ---- What's shown.
  const prev = len && shown !== null ? monAt(shown - 1) : null;
  const next = len && shown !== null ? monAt(shown + 1) : null;
  const scanning = settled === null;
  const det = mon ? details.current.get(mon.id) : undefined;
  const table = view.forms ? tables.everyone : tables.species;
  const col = mon ? typeColor(mon.types[0]) : "#7ee8ff";
  const podDot = shown === null ? -1 : mod(shown, PODS);
  const inView = (id: number) => inSeq.has(id);
  const empty = booted && len === 0;

  const statsBody = mon && (
    <div id={`${phone ? "p" : "d"}-panel`} role="tabpanel" aria-labelledby={`${phone ? "p" : "d"}-tab-${tab}`}>
      {tab === "stats" ? <BaseStats mon={mon} radar={phone ? 180 : 196} /> : <Roles mon={mon} table={table} withForms={view.forms} />}
    </div>
  );

  return (
    <>
      <style>{`html.lx-locked, html.lx-locked body { overflow: hidden; overscroll-behavior: none; } .lx-stage { background: radial-gradient(120% 90% at 50% 40%, #0b1426 0%, #03050b 70%); } @media (max-width: 1023px) { html:has(.lx-stage) { --tabbar-h: 0px; } html:has(.lx-stage) [data-testid="tabbar"] { display: none; } } .lab-scroll { scrollbar-width: thin; scrollbar-color: rgba(126,232,255,0.25) transparent; }
        .lx-in { animation: lx-in 520ms cubic-bezier(.2,.8,.2,1) both; }
        @keyframes lx-in { 0% { opacity: 0; transform: translateX(-10px); clip-path: inset(0 100% 0 0); filter: brightness(2.2); } 60% { filter: brightness(1.3); } 100% { opacity: 1; transform: none; clip-path: inset(0 0 0 0); filter: none; } }
        .lx-rule { background: linear-gradient(90deg, rgba(126,232,255,0.45), rgba(126,232,255,0.08) 70%, transparent), repeating-linear-gradient(90deg, rgba(126,232,255,0.5) 0 1px, transparent 1px 12px); background-size: 100% 1px, 100% 1px; }
        .lx-spine { background: linear-gradient(180deg, transparent, rgba(126,232,255,0.5) 6%, var(--lx-col, #7ee8ff) 50%, rgba(126,232,255,0.35) 92%, transparent); box-shadow: 0 0 8px rgba(126,232,255,0.4); }
        .lx-flow { background: repeating-linear-gradient(90deg, rgba(126,232,255,0.75) 0 4px, transparent 4px 8px); background-size: 16px 1px; animation: lx-flow 1.2s linear infinite; }
        @keyframes lx-flow { to { background-position: 16px 0; } }
        .lx-shimmer { background: linear-gradient(90deg, rgba(126,232,255,0.06), rgba(126,232,255,0.18), rgba(126,232,255,0.06)); background-size: 200% 100%; animation: lx-shim 1.4s linear infinite; }
        @keyframes lx-shim { to { background-position: -200% 0; } }
        .lx-falloff { background: linear-gradient(90deg, rgba(2,5,12,0.92) 0%, rgba(2,5,12,0.78) 55%, rgba(2,5,12,0.35) 80%, transparent 100%); }
        @media (prefers-reduced-motion: reduce) { .lx-in { animation-duration: 1ms; } .lx-flow, .lx-shimmer { animation: none; } }`}</style>
      <div className="lx-stage fixed inset-x-0 bottom-0 top-14 z-40 overflow-hidden text-white" data-testid="lab-stage" data-ready={ready ? "1" : "0"} data-mode={mode}>
        <div
          ref={stage}
          role="region"
          aria-roledescription={S.stageRole}
          aria-label={S.stage}
          tabIndex={0}
          className="absolute inset-x-0 top-0 isolate h-[52%] touch-none select-none outline-none focus-visible:shadow-[inset_0_0_0_2px_rgba(126,232,255,0.6)] lg:h-full"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-testid="lab-wheel"
        >
          <div ref={host} className="absolute inset-0" />
          <StagePoster src={STAGE_POSTERS.labDex} gone={ready} />
          {mode === "2d" && <Fallback2D ref={fbRef} len={len} monAt={monAt} phone={phone} />}
          {!booted && intro}
          {(mode === "boot" || (mode === "3d" && !ready)) && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="flex flex-col items-center gap-3">
                <span className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-200/20 border-t-cyan-200/80 motion-reduce:animate-none" aria-hidden />
                <p className="hud-label text-cyan-200/70">{S.loading}</p>
              </div>
            </div>
          )}
          {mode === "2d" && <p className="pointer-events-none absolute inset-x-0 top-3 mx-auto max-w-md px-4 text-center text-[12px] text-white/55 lg:top-20">{S.noWebgl}</p>}
        </div>

        {empty && (
          <div className="absolute inset-x-0 top-[30%] z-10 mx-auto w-fit rounded-xl border border-white/10 bg-[#050a17]/85 px-6 py-5 text-center backdrop-blur-md" data-testid="lab-empty">
            <p className="font-display text-lg font-semibold">{S.noMatch}</p>
            <button type="button" onClick={() => changeView(DEFAULT_VIEW)} className="mt-3 rounded-md bg-primary px-4 py-2 font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground">{S.reset}</button>
          </div>
        )}

        {/* ---- Desktop. */}
        {!phone && booted && (
          <div className="pointer-events-none absolute inset-0">
            <div className="pointer-events-auto absolute left-6 right-6 top-4 z-10 xl:left-8 xl:right-8">
              <Toolbar view={view} set={changeView} all={all} seq={seq} onJump={(pos) => { interacted.current = true; jump(pos, true); }} onShowAnyway={showAnyway} searchRef={searchRef} />
            </div>
            {mon && (
              <>
                {/* A soft falloff behind the readout (light leaves the lab there), not a panel. */}
                <div className="lx-falloff pointer-events-none absolute inset-y-0 left-0 w-[560px] xl:w-[600px]" aria-hidden />
                <div className="pointer-events-auto absolute bottom-24 left-6 top-[76px] flex w-[380px] flex-col gap-5 xl:left-8 xl:w-[410px]">
                  <Heading mon={mon} scanning={scanning} sort={view.sort} />
                  <div className="lab-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2 [mask-image:linear-gradient(180deg,#000_92%,transparent)]">
                    <InfoCard mon={mon} details={det} inView={inView} onPick={pickId} />
                  </div>
                </div>
                <div className={cn(glass, "pointer-events-auto absolute right-6 top-[76px] flex max-h-[calc(100%-176px)] w-[340px] flex-col p-4 xl:right-8")} data-testid="lab-stats-panel">
                  <Corners />
                  <StatsTabs tab={tab} onTab={setTab} idBase="d" />
                  <div className="lab-scroll mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">{statsBody}</div>
                  <OpenInDex mon={mon} className="mt-4 shrink-0" />
                </div>
                <div className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-4">
                  <button type="button" onClick={() => step(-1)} className="group flex items-center gap-3 rounded-full border border-white/12 bg-[#050a17]/70 py-1.5 pl-1.5 pr-4 backdrop-blur-md transition-colors hover:border-white/25" aria-label={prev ? S.prevNamed(prev.name) : S.prev} data-testid="lab-prev">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10 group-hover:bg-white/15"><ChevronLeft className="h-5 w-5" aria-hidden /></span>
                    <span className="text-left">
                      <span className="block font-pixel text-[8px] uppercase tracking-[0.14em] text-white/45">{prev ? dexNo(prev.species) : ""}</span>
                      <span className="block max-w-[150px] truncate font-display text-[13px] font-semibold uppercase tracking-wide text-white/85">{prev?.name}</span>
                    </span>
                  </button>
                  <div className="flex flex-col items-center gap-2 px-2">
                    <div className="flex items-center gap-1.5" aria-hidden>
                      {Array.from({ length: PODS }, (_, i) => (
                        <span key={i} className={cn("h-1.5 rounded-full transition-all duration-300", i === podDot ? "w-6" : "w-1.5 bg-white/25")} style={i === podDot ? { background: col, boxShadow: `0 0 10px ${col}` } : undefined} />
                      ))}
                    </div>
                    <p className="font-pixel text-[9px] uppercase tracking-[0.16em] text-white/55">{coarse ? S.hintTouch : S.hint}</p>
                  </div>
                  <button type="button" onClick={() => step(1)} className="group flex items-center gap-3 rounded-full border border-white/12 bg-[#050a17]/70 py-1.5 pl-4 pr-1.5 backdrop-blur-md transition-colors hover:border-white/25" aria-label={next ? S.nextNamed(next.name) : S.next} data-testid="lab-next">
                    <span className="text-right">
                      <span className="block font-pixel text-[8px] uppercase tracking-[0.14em] text-white/45">{next ? dexNo(next.species) : ""}</span>
                      <span className="block max-w-[150px] truncate font-display text-[13px] font-semibold uppercase tracking-wide text-white/85">{next?.name}</span>
                    </span>
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10 group-hover:bg-white/15"><ChevronRight className="h-5 w-5" aria-hidden /></span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---- Phone: the lab on top, a sheet with the details below. */}
        {phone && booted && (
          <>
            <div className="absolute inset-x-3 top-2.5 z-20 flex items-center gap-2">
              <SearchBox all={all} seq={seq} onJump={(pos) => { interacted.current = true; jump(pos, true); }} onShowAnyway={showAnyway} className="min-w-0 flex-1" inputRef={phoneSearchRef} />
              <button type="button" onClick={() => setFiltersOpen(true)} className="flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-[#050a17]/75 px-3 font-display text-[11px] font-semibold uppercase tracking-wider backdrop-blur-md" data-testid="lab-filters" aria-haspopup="dialog">
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                {S.filters}
                {activeCount(view) > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-cyan-300 px-1 text-[10px] text-[#04121c]">{activeCount(view)}</span>}
              </button>
            </div>
            {mon && (
              <div className="pointer-events-none absolute inset-x-0 top-[calc(52%-52px)] z-10 flex items-center justify-between px-3">
                <button type="button" onClick={() => step(-1)} className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-[#050a17]/75 backdrop-blur-md" aria-label={prev ? S.prevNamed(prev.name) : S.prev} data-testid="lab-prev">
                  <ChevronLeft className="h-5 w-5" aria-hidden />
                </button>
                <div className="flex flex-col items-center gap-1.5" aria-hidden>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: PODS }, (_, i) => (
                      <span key={i} className={cn("h-1 rounded-full transition-all duration-300", i === podDot ? "w-4" : "w-1 bg-white/30")} style={i === podDot ? { background: col } : undefined} />
                    ))}
                  </div>
                  <p className="font-pixel text-[8px] uppercase tracking-[0.16em] text-white/55">{S.hintTouch}</p>
                </div>
                <button type="button" onClick={() => step(1)} className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-[#050a17]/75 backdrop-blur-md" aria-label={next ? S.nextNamed(next.name) : S.next} data-testid="lab-next">
                  <ChevronRight className="h-5 w-5" aria-hidden />
                </button>
              </div>
            )}
            {mon && (
              <PhoneSheet open={sheet} onOpen={setSheet} color={col}>
                <Heading mon={mon} scanning={scanning} sort={view.sort} phone />
                <div className="mt-4">
                  <StatsTabs tab={tab} onTab={setTab} idBase="p" />
                  <div className="mt-3">{statsBody}</div>
                </div>
                <div className="mt-4">
                  <InfoCard mon={mon} details={det} inView={inView} onPick={pickId} />
                </div>
                <OpenInDex mon={mon} className="mt-4" />
              </PhoneSheet>
            )}
            {filtersOpen && (
              <div className="fixed inset-x-0 bottom-0 top-14 z-50 flex flex-col bg-[#040814]/95 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={S.filters} data-testid="lab-filter-sheet">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <p className="font-display text-base font-bold uppercase tracking-wider">{S.filters}</p>
                  <button type="button" onClick={() => setFiltersOpen(false)} aria-label={S.close} className="grid h-9 w-9 place-items-center rounded-md text-white/70"><X className="h-5 w-5" aria-hidden /></button>
                </div>
                <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
                  <div>
                    <p className="hud-label !text-[9px]">{S.sortBy}</p>
                    <div className="mt-2"><SortPicker view={view} set={changeView} wide /></div>
                  </div>
                  <div>
                    <p className="hud-label !text-[9px]">{S.types} · {S.typesHint}</p>
                    <div className="mt-2"><TypePicker types={view.types} onChange={(types) => changeView({ types })} inline /></div>
                  </div>
                  <div>
                    <p className="hud-label !text-[9px]">{S.gen}</p>
                    <div className="mt-2"><GenPicker gens={view.gens} onChange={(gens) => changeView({ gens })} compact /></div>
                  </div>
                  <TogglesList view={view} set={changeView} />
                </div>
                <div className="flex gap-3 border-t border-white/10 px-4 py-3">
                  <button type="button" onClick={() => changeView(DEFAULT_VIEW)} className="h-11 flex-1 rounded-md border border-white/15 font-display text-sm font-semibold uppercase tracking-wider text-white/80">{S.reset}</button>
                  <button type="button" onClick={() => setFiltersOpen(false)} className="h-11 flex-1 rounded-md bg-primary font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground" data-testid="lab-filters-done">{S.done}</button>
                </div>
              </div>
            )}
          </>
        )}

        <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="lab-announce">{announce}</div>
      </div>
    </>
  );
}

/** The phone's sheet: under the lab, swiped (or tapped) up over it for everything, and back down. */
function PhoneSheet({ open, onOpen, color, children }: { open: boolean; onOpen: (o: boolean) => void; color: string; children: React.ReactNode }) {
  const S = useLabStrings();
  const start = useRef<{ y: number; t: number } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  return (
    <div
      className={cn("absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-white/12 bg-[#040814]/[0.94] shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md transition-[height] duration-300 ease-out motion-reduce:transition-none", open ? "h-[calc(100%-56px)]" : "h-[48%]")}
      style={{ boxShadow: `0 -1px 0 ${color}55, 0 -20px 60px -20px rgba(0,0,0,0.9)` }}
      data-testid="lab-sheet"
      data-open={open ? "1" : "0"}
    >
      <button
        type="button"
        className="mx-auto flex h-7 w-full shrink-0 touch-none items-center justify-center"
        onClick={() => onOpen(!open)}
        onPointerDown={(e) => { start.current = { y: e.clientY, t: e.timeStamp }; }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          if (!s) return;
          const dy = e.clientY - s.y;
          if (dy < -24) onOpen(true);
          else if (dy > 24) onOpen(false);
        }}
        aria-expanded={open}
        aria-label={open ? S.sheetClose : S.sheetHandle}
        data-testid="lab-sheet-handle"
      >
        <span className="h-1 w-10 rounded-full bg-white/30" />
      </button>
      <div
        ref={body}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6"
        onTouchStart={(e) => { start.current = { y: e.touches[0].clientY, t: e.timeStamp }; }}
        onTouchEnd={(e) => {
          const s = start.current;
          start.current = null;
          if (!s) return;
          const dy = e.changedTouches[0].clientY - s.y;
          // A swipe up from the top of the closed sheet opens it; a swipe down at the top of the open one closes it.
          if (!open && dy < -40) onOpen(true);
          else if (open && dy > 60 && (body.current?.scrollTop ?? 0) <= 0) onOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
