"use client";

/* eslint-disable @next/next/no-img-element -- small static board pictures */
import "./maker.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Dices, Ellipsis, Lock, Share, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import tools from "@/messages/tools";
import { boardArtUrl } from "@/lib/pokemon/art";
import { isCleanName } from "@/lib/name-filter";
import { hex, type RGB } from "@/lib/shiny-maker/color";
import { loadSpecies, type Species } from "@/lib/shiny-maker/data";
import { cleanName, encodeDesign, fitsSpecies, newDesign, STYLES, type Design, type PartColour, type Style } from "@/lib/shiny-maker/design";
import { borrowParts, DEFAULT_ID, firstDesign, presetParts, randomParts, TYPE_GLOW, type Preset, type TypeName } from "@/lib/shiny-maker/presets";
import { partSwatch, type View } from "@/lib/shiny-maker/recolor";
import { loadFrames } from "@/lib/shiny-maker/frames";
import type { GifFrames } from "@/lib/shiny-maker/gif";
import { canvasBlob, encodeInWorker, fileName, gifFrames, pixelCanvas, saveBlob } from "@/lib/shiny-maker/export";
import { Dot } from "./ColourControls";
import { ColourPanel } from "./ColourPanel";
import { ExtrasPanel, Seg, type ColourBlind } from "./ExtrasPanel";
import { HdFigure, hasWebGL2 } from "./HdFigure";
import { Picker } from "./Picker";
import { PixelFigure, type FigureHandle } from "./PixelFigure";

type Panel = null | "extras" | "picker" | "borrow";
const HISTORY_MAX = 120;

function useMedia(query: string, fallback = false) {
  const [on, setOn] = useState(fallback);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

/** An element's size, followed as it changes (a callback ref, so a re-mounted element is followed too). */
function useSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

/** Colour-blind simulation matrices (Machado et al. 2009, severity 1). */
const CB: Record<Exclude<ColourBlind, "off">, string> = {
  deutan: "0.367 0.861 -0.228 0 0  0.280 0.673 0.047 0 0  -0.012 0.043 0.969 0 0  0 0 0 1 0",
  protan: "0.152 1.053 -0.205 0 0  0.115 0.786 0.099 0 0  -0.004 -0.048 1.052 0 0  0 0 0 1 0",
  tritan: "1.256 -0.077 -0.179 0 0  -0.078 0.931 0.148 0 0  0.005 0.691 0.304 0 0  0 0 0 1 0",
};

export default function ShinyMaker({ initial, linkBroken }: { initial: Design | null; linkBroken: boolean }) {
  const t = useT(tools);
  const phone = useMedia("(max-width: 1023px)");
  const motion = !useMedia("(prefers-reduced-motion: reduce)");

  const [design, setDesign] = useState<Design | null>(initial);
  const [sp, setSp] = useState<Species | null>(null);
  const [loadError, setLoadError] = useState(false);
  // What the stage shows: one view, or all three side by side.
  const [view, setView] = useState<View | "compare">("yours");
  const [peek, setPeek] = useState(false);
  const [sel, setSel] = useState(-1);
  const [hover, setHover] = useState(-1);
  const [panel, setPanel] = useState<Panel>(null);
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [expert, setExpert] = useState(false);
  const [cb, setCb] = useState<ColourBlind>("off");
  const [toast, setToast] = useState<string | null>(linkBroken ? t("maker.badLink") : null);
  const [frames, setFrames] = useState<GifFrames | null>(null);
  const [gl2, setGl2] = useState(true);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [gifBusy, setGifBusy] = useState(false);
  const [, bump] = useState(0);
  const past = useRef<Design[]>([]);
  const future = useRef<Design[]>([]);
  const figure = useRef<FigureHandle>(null);
  const [stageSizeRef, stage] = useSize<HTMLElement>();
  const stageBox = useRef<HTMLElement | null>(null);
  const stageRef = useCallback((el: HTMLElement | null) => { stageBox.current = el; stageSizeRef(el); }, [stageSizeRef]);
  const dockRef = useRef<HTMLDivElement>(null);
  const designRef = useRef(design);
  designRef.current = design;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => {
    if (linkBroken) toastTimer.current = setTimeout(() => setToast(null), 3600);
    setGl2(hasWebGL2());
  }, [linkBroken]);

  // History: a gesture pushes the design it started from once; its moves replace the present.
  const begin = useCallback(() => {
    const d = designRef.current;
    if (!d) return;
    past.current.push(d);
    if (past.current.length > HISTORY_MAX) past.current.shift();
    future.current = [];
    bump((n) => n + 1);
  }, []);
  const commit = useCallback((next: Design) => {
    begin();
    setDesign(next);
  }, [begin]);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !designRef.current) return;
    future.current.push(designRef.current);
    setDesign(prev);
    bump((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !designRef.current) return;
    past.current.push(designRef.current);
    setDesign(next);
    bump((n) => n + 1);
  }, []);

  // The species follows the design (a new Pokémon, an undo across Pokémon, a link).
  const wantId = design?.id ?? initial?.id ?? DEFAULT_ID;
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setLoadError(false);
    loadSpecies(wantId).then(
      (s) => {
        if (!live) return;
        setSp(s);
        const d = designRef.current;
        if (!d) setDesign(firstDesign(s));
        else if (d.id === s.id && !fitsSpecies(d, s.parts.length, s.slots.length)) {
          // A link from older data: start fresh on the same Pokémon.
          setDesign({ ...newDesign(s.id, s.parts.length, 1), style: d.style });
          say(t("maker.badLink"));
        }
      },
      () => live && setLoadError(true)
    );
    return () => { live = false; };
  }, [wantId, retry, say, t]);

  const ready = !!sp && !!design && sp.id === design.id && fitsSpecies(design, sp.parts.length, sp.slots.length);

  const failStyle = useCallback((st: Style, id: number) => setFailed((f) => new Set(f).add(`${st}:${id}`)), []);
  // Animated sprite, fetched only when asked for.
  useEffect(() => {
    setFrames(null);
    if (!ready || design?.style !== "sd" || !sp?.anim) return;
    let live = true;
    loadFrames(sp).then((f) => {
      if (!live) return;
      if (!f) failStyle("sd", sp.id);
      setFrames(f);
    });
    return () => { live = false; };
  }, [ready, sp, design?.style, failStyle]);

  // The address carries the design (so a reload or a copied address keeps it).
  useEffect(() => {
    if (!ready || !design) return;
    const id = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("d", encodeDesign(design));
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    }, 250);
    return () => clearTimeout(id);
  }, [ready, design]);

  // Which styles this Pokémon has (and this browser can draw).
  const canStyle = useCallback(
    (st: Style) => !!sp && (st === "px" || (!failed.has(`${st}:${sp.id}`) && (st === "sd" ? sp.anim : gl2 && !!(st === "hd" ? sp.hd : sp.art)))),
    [sp, failed, gl2]
  );
  const style: Style = design && canStyle(design.style) ? design.style : "px";

  const visibleParts = useMemo(() => (sp ? sp.parts.map((p, i) => ({ p, i })).filter(({ p }) => expert || !p.o) : []), [sp, expert]);

  const setPart = useCallback((pi: number, col: PartColour | null, src?: 0 | 1) => {
    setDesign((d) => {
      if (!d) return d;
      const parts = d.parts.slice();
      parts[pi] = { src: src ?? parts[pi].src, col };
      return { ...d, parts };
    });
  }, []);

  const randomise = useCallback(() => {
    const d = designRef.current;
    if (!sp || !d || !ready) return;
    commit({ ...d, parts: randomParts(sp, d, locked), shades: {} });
    setView("yours");
  }, [sp, ready, locked, commit]);

  const choosePreset = (p: Preset | TypeName) => {
    if (!sp || !design) return;
    commit({ ...design, parts: presetParts(sp, design, p, locked), shades: {} });
    setView("yours");
  };

  const pickSpecies = (id: number) => {
    setPanel(null);
    setSel(-1);
    if (!design || id === design.id) return;
    loadSpecies(id).then((s) => {
      const d = designRef.current;
      if (!d) return;
      const next = { ...newDesign(id, s.parts.length, 1), style: d.style, finish: d.finish, sparkle: d.sparkle, glow: d.glow, bg: d.bg };
      setLocked(new Set());
      commit(next);
      setView("yours");
    }, () => setLoadError(true));
  };

  const borrowFrom = (id: number) => {
    setPanel(null);
    if (!sp || !design) return;
    loadSpecies(id).then((other) => {
      const d = designRef.current;
      if (!d || !sp) return;
      commit({ ...d, parts: borrowParts(sp, d, other, locked), shades: {} });
      setView("yours");
    });
  };

  const share = async () => {
    if (!design) return;
    const url = `${window.location.origin}/tools/shiny-maker?d=${encodeDesign(design)}`;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse && navigator.share) {
      try {
        await navigator.share({ title: t("maker.title"), url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      say(t("toast.copied"));
    } catch {
      say(t("toast.copyFailed"));
    }
  };

  const downloadPng = async (scale: number) => {
    if (!sp || !design) return;
    try {
      let blob: Blob;
      if (style === "hd" || style === "art") {
        const c = document.querySelector<HTMLCanvasElement>("[data-testid=sm-hd-canvas]");
        if (!c) return;
        const out = document.createElement("canvas");
        out.width = c.width;
        out.height = c.height;
        const ctx = out.getContext("2d")!;
        if (design.bg !== "none") {
          ctx.fillStyle = "#0e0c1d";
          ctx.fillRect(0, 0, out.width, out.height);
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(c, 0, 0, out.width, out.height);
        blob = await canvasBlob(out);
      } else blob = await canvasBlob(pixelCanvas(sp, design, scale));
      saveBlob(blob, fileName(sp, design, "png"));
      say(t("toast.downloaded"));
    } catch {
      /* nothing to save */
    }
  };

  const downloadGif = async () => {
    if (!sp || !design || gifBusy) return;
    setGifBusy(true);
    try {
      const f = style === "sd" ? await loadFrames(sp) : null;
      const blob = await encodeInWorker(gifFrames(sp, design, f));
      saveBlob(blob, fileName(sp, design, "gif"));
      say(t("toast.downloaded"));
    } finally {
      setGifBusy(false);
    }
  };


  // Keys: Space randomises, ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y) undo and redo, Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        if (panel || sel >= 0) {
          setPanel(null);
          setSel(-1);
        }
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
      const onControl = !!el?.closest("button, [role=slider], [role=radio], [role=switch], a, select");
      if ((e.key === " " || e.code === "Space") && !mod && !onControl && !e.repeat) {
        e.preventDefault();
        randomise();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, sel, undo, redo, randomise]);

  // Pointer on the figure: hover outlines a part, a click opens its colour, a long press peeks at Normal.
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; peeking: boolean }>({ timer: null, peeking: false });
  const onFigureMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const p = figure.current?.partAt(e.clientX, e.clientY) ?? -1;
    setHover(p >= 0 && (expert || !sp?.parts[p]?.o) ? p : -1);
  };
  const onFigureDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    hold.current.peeking = false;
    hold.current.timer = setTimeout(() => {
      hold.current.peeking = true;
      setPeek(true);
    }, 380);
  };
  const endHold = () => {
    if (hold.current.timer) clearTimeout(hold.current.timer);
    hold.current.timer = null;
    if (hold.current.peeking) setPeek(false);
  };
  const onFigureUp = (e: React.PointerEvent) => {
    const wasPeek = hold.current.peeking;
    endHold();
    if (wasPeek) return;
    const p = figure.current?.partAt(e.clientX, e.clientY) ?? -1;
    if (p >= 0 && (expert || !sp?.parts[p]?.o)) {
      setView("yours");
      setPanel(null);
      setSel(p);
    } else if (sel >= 0) setSel(-1);
  };

  const compare = view === "compare";
  const shownView: View = peek ? "normal" : view === "compare" ? "yours" : view;
  const glowHsl = TYPE_GLOW[sp?.types[0] ?? "fire"] ?? TYPE_GLOW.normal;
  const mainColour = sp && design && ready ? hex(partSwatch(sp, design, visibleParts[0]?.i ?? 0)) : "#ffffff";

  // Figure geometry: whole-number pixel scale at rest; with a colour open it eases up and steps back.
  const popOpen = sel >= 0 && !phone;
  const sheetOpen = phone && (sel >= 0 || panel !== null);
  const geo = useMemo(() => {
    const W = stage.w, H = stage.h;
    if (!W || !H || !sp) return null;
    const restTop = phone ? 56 : 104, restBottom = phone ? 64 : 116;
    // On a phone the sheet (about 310 px above the tab bar) covers the stage's lower part.
    const stageTop = stageBox.current?.getBoundingClientRect().top ?? 150;
    const openTop = phone ? 52 : 26, openBottom = phone ? Math.max(18, H - (window.innerHeight - 56 - 310 - Math.max(0, stageTop))) : 352;
    const painted = style === "hd" || style === "art";
    // The animated sprite's frames are a little bigger than the still sprite.
    const anim = style === "sd" && frames;
    const baseW = Math.max(anim ? frames.width : sp.w, 64), baseH = Math.max(anim ? frames.height : sp.h, 64);
    const fit = (top: number, bottom: number) => {
      const ah = Math.max(60, H - top - bottom), aw = W - (phone ? 24 : 96);
      if (painted) return { s: 1, size: Math.min(560, aw, ah * 1.08), cy: top + ah / 2 };
      const s = Math.max(1, Math.min(10, Math.floor(Math.min(aw / baseW, ah / baseH))));
      return { s, size: 0, cy: top + ah / 2 };
    };
    const rest = fit(restTop, restBottom);
    // Side by side: a third of the width each, the same kind of scale.
    const third = (W - (phone ? 24 : 96)) / 3 - (phone ? 6 : 24);
    const cmp = painted
      ? { s: 1, size: Math.max(60, Math.min(rest.size, third)) }
      : { s: Math.max(1, Math.min(rest.s, Math.floor(third / baseW))), size: 0 };
    const open = fit(openTop, openBottom);
    // A drawer takes 444 px of one side: the figure fits the rest.
    const sideW = W - 444;
    const side = painted ? { s: 1, size: Math.min(rest.size, sideW - 48, H - 140), cy: rest.cy } : { s: Math.max(1, Math.min(rest.s, Math.floor((sideW - 48) / baseW))), size: 0, cy: rest.cy };
    return { rest, open, side, sideShift: 222, cmp };
  }, [stage.w, stage.h, sp, phone, style, frames]);
  const drawer = !phone && panel !== null;
  const moved = popOpen || sheetOpen || drawer;
  const target = geo ? (drawer ? geo.side : geo.open) : null;
  const k = geo && target ? (style === "hd" || style === "art" ? target.size / geo.rest.size : target.s / geo.rest.s) : 1;
  const dy = geo && target ? target.cy - geo.rest.cy : 0;
  const dx = drawer && geo ? (panel === "extras" ? -geo.sideShift : geo.sideShift) : 0;

  const cbFilter = cb !== "off" ? `url(#sm-cb-${cb})` : "";
  const glowFilter = design?.glow && shownView === "yours" ? `drop-shadow(0 0 ${phone ? 12 : 22}px ${mainColour}aa)` : "";
  const filter = [glowFilter, cbFilter].filter(Boolean).join(" ") || undefined;
  const label = sp ? (shownView === "normal" ? t("view.normal") : shownView === "official" ? t("view.official") : t("view.yours")) + ` · ${sp.name}` : "";

  const stageEl = (
    <section
      ref={stageRef}
      className={cn(
        "sm-stage relative overflow-hidden border border-white/[0.06]",
        phone ? "h-[min(440px,56svh)] min-h-[340px] rounded-[24px]" : "h-[calc(100dvh-108px)] min-h-[640px] rounded-[28px]",
        design?.bg === "none" && "sm-checker"
      )}
      data-testid="sm-stage"
      onPointerDown={(e) => { if (e.target === e.currentTarget && sel >= 0) setSel(-1); }}
    >
      <div className="sm-glow pointer-events-none absolute left-1/2 top-1/2 h-[min(820px,120%)] w-[min(820px,120%)] -translate-x-1/2 -translate-y-1/2" style={{ ["--sm-glow" as string]: glowHsl, opacity: design?.bg === "glow" ? 1 : 0 }} aria-hidden />
      {!phone && (
        <header className="absolute left-9 top-8 z-10">
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight">{t("maker.title")}</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">{t("maker.subtitle")}</p>
        </header>
      )}
      <div className={cn("absolute z-10", phone ? "left-1/2 top-3 -translate-x-1/2" : "right-8 top-8")}>
        <Seg<View | "compare">
          label={t("view.label")}
          value={view}
          onChange={(v) => { setView(v); setSel(-1); }}
          testId="sm-view"
          items={[
            { v: "normal", label: t("view.normal") },
            { v: "official", label: t("view.official") },
            { v: "yours", label: t("view.yours") },
            { v: "compare", label: t("view.compare") },
          ]}
        />
      </div>

      {sp && design && (
        <div className={cn("absolute z-10", phone ? "bottom-3 left-1/2 -translate-x-1/2" : "xl:left-1/2 xl:top-8 xl:-translate-x-1/2 max-xl:right-8 max-xl:top-[84px]")}>
          <Seg<Style>
            label={t("styles.label")}
            value={style}
            onChange={(st) => { if (design.style !== st) commit({ ...design, style: st }); setSel(-1); }}
            testId="sm-style"
            items={STYLES.map((st) => ({ v: st, label: t(`styles.${st}`), disabled: !canStyle(st), title: canStyle(st) ? undefined : (st === "hd" || st === "art") && !gl2 ? t("extras.hdNoGl") : t("styles.unavailable") }))}
          />
        </div>
      )}

      {ready && sp && design && geo && compare ? (
        <div className="sm-fade absolute inset-x-0 flex items-end justify-center" style={{ top: geo.rest.cy, transform: "translateY(-50%)", gap: phone ? 6 : 24 }} data-testid="sm-compare">
          {(["normal", "official", "yours"] as const).map((v) => (
            <figure key={v} className="flex flex-col items-center gap-3">
              <div style={{ filter: v === "yours" ? filter : cbFilter || undefined }}>
                {style === "hd" || style === "art" ? (
                  <HdFigure kind={style} sp={sp} design={design} view={v} size={geo.cmp.size} hover={-1} motion={motion} label={`${t(`view.${v}`)} · ${sp.name}`} onFail={() => failStyle(style, sp.id)} />
                ) : (
                  <PixelFigure sp={sp} design={design} view={v} animate={style === "sd"} scale={geo.cmp.s} hover={-1} selected={-1} motion={motion} frames={frames} label={`${t(`view.${v}`)} · ${sp.name}`} />
                )}
              </div>
              <figcaption className={cn("text-[13px] font-medium", v === "yours" ? "text-foreground" : "text-muted-foreground")}>{t(`view.${v}`)}</figcaption>
            </figure>
          ))}
        </div>
      ) : ready && sp && design && geo ? (
        <div
          className="sm-figure absolute left-1/2 top-0 sm-fade"
          style={{ transform: `translate(-50%, calc(${geo.rest.cy}px - 50%)) translate(${moved ? dx : 0}px, ${moved ? dy : 0}px) scale(${moved ? k : 1})`, filter }}
          onPointerMove={onFigureMove}
          onPointerLeave={() => { setHover(-1); endHold(); }}
          onPointerDown={onFigureDown}
          onPointerUp={onFigureUp}
          onPointerCancel={endHold}
          onContextMenu={(e) => e.preventDefault()}
          title={t("view.peek")}
          data-testid="sm-figure"
          data-scale={style === "px" || style === "sd" ? geo.rest.s : undefined}
        >
          {style === "hd" || style === "art" ? (
            <HdFigure
              ref={figure}
              kind={style}
              sp={sp}
              design={design}
              view={shownView}
              size={geo.rest.size}
              hover={hover >= 0 ? hover : sel}
              motion={motion}
              label={label}
              onFail={() => failStyle(style, sp.id)}
            />
          ) : (
            <PixelFigure ref={figure} sp={sp} design={design} view={shownView} animate={style === "sd"} scale={geo.rest.s} hover={hover >= 0 ? hover : sel} selected={sel} motion={motion} frames={frames} label={label} />
          )}
          {design.sparkle && shownView === "yours" && <Sparkles />}
        </div>
      ) : (
        <StageSkeleton error={loadError} onRetry={() => setRetry((r) => r + 1)} t={t} />
      )}

      {toast && (
        <div className="sm-enter pointer-events-none absolute left-1/2 top-[84px] z-30 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-[13.5px] font-medium text-[#141225] shadow-lg max-lg:top-16" role="status" data-testid="sm-toast">
          {toast}
        </div>
      )}

      {!phone && panel && sp && design && (
        <Drawer side={panel === "extras" ? "right" : "left"} title={panel === "extras" ? t("extras.title") : panel === "borrow" ? t("extras.borrow") : t("picker.title")} onClose={() => setPanel(null)} t={t} testId={panel === "extras" ? "sm-extras-pop" : "sm-picker"}>
          {panel === "extras" ? extrasPanel() : <Picker current={design.id} onPick={panel === "borrow" ? borrowFrom : pickSpecies} />}
        </Drawer>
      )}

      {!phone && (
        <Dock
          ref={dockRef}
          sp={ready ? sp : null}
          design={ready ? design : null}
          parts={visibleParts}
          sel={sel}
          locked={locked}
          panel={panel}
          onPart={(i) => { setPanel(null); setView("yours"); setSel((s) => (s === i ? -1 : i)); }}
          onPanel={(p) => { setSel(-1); setPanel((cur) => (cur === p ? null : p)); }}
          onRandomise={randomise}
          onShare={share}
          onHover={setHover}
          t={t}
          popover={
            sel >= 0 && sp && design && ready ? (
              <ColourPanel
                sp={sp}
                design={design}
                part={sel}
                locked={locked.has(sel)}
                expert={expert}
                onBegin={begin}
                onLive={(c) => setPart(sel, c)}
                onCommit={(c) => setPart(sel, c)}
                onReset={() => commit({ ...design, parts: design.parts.map((p, i) => (i === sel ? { src: p.src, col: null } : p)), shades: Object.fromEntries(Object.entries(design.shades).filter(([s]) => sp.partOf[Number(s)] !== sel)) })}
                onToggleLock={() => setLocked((l) => { const n = new Set(l); if (n.has(sel)) n.delete(sel); else n.add(sel); return n; })}
                onShade={(slot, rgb) => commit({ ...design, shades: shadeSet(design.shades, slot, rgb) })}
              />
            ) : null
          }
        />
      )}
    </section>
  );

  function extrasPanel() {
    if (!sp || !design) return null;
    return (
      <ExtrasPanel
        design={design}
        canGif={style === "sd" || (style === "px" && (design.finish === "holo" || design.finish === "galaxy"))}
        style={style}
        gifBusy={gifBusy}
        cb={cb}
        expert={expert}
        canUndo={past.current.length > 0}
        canRedo={future.current.length > 0}
        onPreset={choosePreset}
        onBorrow={() => setPanel("borrow")}
        onFinish={(f) => commit({ ...design, finish: f })}
        onToggle={(key, v) => commit({ ...design, [key]: v })}
        onBg={(b) => commit({ ...design, bg: b })}
        onName={(n) => {
          const clean = cleanName(n);
          if (clean && !isCleanName(clean)) return false;
          if (clean !== design.name) commit({ ...design, name: clean });
          return true;
        }}
        onCb={setCb}
        onExpert={setExpert}
        onUndo={undo}
        onRedo={redo}
        onPng={downloadPng}
        onGif={downloadGif}
      />
    );
  }

  return (
    <div className="dark-scope relative" data-testid="shiny-maker">
      <svg width="0" height="0" className="absolute" aria-hidden>
        {(Object.keys(CB) as (keyof typeof CB)[]).map((k) => (
          <filter key={k} id={`sm-cb-${k}`} colorInterpolationFilters="linearRGB">
            <feColorMatrix type="matrix" values={CB[k]} />
          </filter>
        ))}
      </svg>
      {phone ? (
        <div className="space-y-4">
          <header className="px-1">
            <h1 className="font-display text-[22px] font-semibold leading-tight tracking-tight">{t("maker.title")}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("maker.subtitle")}</p>
          </header>
          {stageEl}
          <PhoneControls
            sp={ready ? sp : null}
            design={ready ? design : null}
            parts={visibleParts}
            sel={sel}
            locked={locked}
            onPart={(i) => { setPanel(null); setView("yours"); setSel((s) => (s === i ? -1 : i)); }}
            onPanel={(p) => { setSel(-1); setPanel(p); }}
            onRandomise={randomise}
            onShare={share}
            t={t}
          />
          {sheetOpen && (
            <Sheet
              onClose={() => { setSel(-1); setPanel(null); }}
              title={sel >= 0 && sp ? t("colour.dialog", { part: sp.parts[sel]?.n ?? "" }) : panel === "extras" ? t("extras.title") : t("picker.title")}
              tall={panel === "picker" || panel === "borrow" || panel === "extras"}
              t={t}
            >
              {sel >= 0 && sp && design && ready ? (
                <ColourPanel
                  compact
                  sp={sp}
                  design={design}
                  part={sel}
                  locked={locked.has(sel)}
                  expert={expert}
                  onBegin={begin}
                  onLive={(c) => setPart(sel, c)}
                  onCommit={(c) => setPart(sel, c)}
                  onReset={() => commit({ ...design, parts: design.parts.map((p, i) => (i === sel ? { src: p.src, col: null } : p)) })}
                  onToggleLock={() => setLocked((l) => { const n = new Set(l); if (n.has(sel)) n.delete(sel); else n.add(sel); return n; })}
                  onShade={(slot, rgb) => commit({ ...design, shades: shadeSet(design.shades, slot, rgb) })}
                />
              ) : panel === "extras" ? (
                extrasPanel()
              ) : panel === "picker" || panel === "borrow" ? (
                <Picker current={design?.id ?? DEFAULT_ID} onPick={panel === "borrow" ? borrowFrom : pickSpecies} />
              ) : null}
            </Sheet>
          )}
        </div>
      ) : (
        stageEl
      )}
      <p className="mt-4 px-1 text-center text-[12px] leading-relaxed text-muted-foreground/70">{t("credit")}</p>
    </div>
  );
}

function shadeSet(shades: Record<number, RGB>, slot: number, rgb: RGB | null): Record<number, RGB> {
  const next = { ...shades };
  if (rgb) next[slot] = rgb;
  else delete next[slot];
  return next;
}

type T = Translator<typeof tools.en>;

function StageSkeleton({ error, onRetry, t }: { error: boolean; onRetry: () => void; t: T }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5" data-testid="sm-skeleton">
      {error ? (
        <>
          <p className="max-w-xs text-center text-[14px] text-muted-foreground">{t("maker.loadError")}</p>
          <button type="button" onClick={onRetry} className="h-10 rounded-full border border-white/15 px-5 text-[14px] transition-colors hover:bg-white/[0.06]">
            {t("maker.retry")}
          </button>
        </>
      ) : (
        <>
          <div className="sm-breathe h-[42%] w-[34%] max-w-[360px] rounded-[45%] bg-white/[0.05] blur-2xl" aria-hidden />
          <span className="sr-only" role="status">{t("maker.loading")}</span>
        </>
      )}
    </div>
  );
}

/** Four-pointed sparkles twinkling around the figure (still when motion is reduced). */
function Sparkles() {
  const spots = [
    [8, 14, 18, 0], [86, 10, 14, 0.7], [94, 52, 12, 1.4], [4, 62, 13, 2.0], [70, 88, 16, 0.4], [22, 92, 11, 1.1], [50, -2, 12, 1.8], [-4, 34, 10, 2.3],
  ];
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {spots.map(([x, y, s, delay], i) => (
        <svg key={i} viewBox="0 0 24 24" width={s * 1.6} height={s * 1.6} className="sm-twinkle absolute" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}>
          <path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z" fill="white" style={{ filter: "drop-shadow(0 0 4px rgb(255 255 255 / 0.9))" }} />
        </svg>
      ))}
    </div>
  );
}

function Avatar({ id, size = 36 }: { id: number; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/[0.06]" style={{ width: size, height: size }}>
      <img src={boardArtUrl(id)} alt="" width={size} height={size} className="scale-[1.15] object-contain" />
    </span>
  );
}

interface DockProps {
  sp: Species | null;
  design: Design | null;
  parts: { p: Species["parts"][number]; i: number }[];
  sel: number;
  locked: Set<number>;
  onPart: (i: number) => void;
  onRandomise: () => void;
  onShare: () => void;
  t: T;
}

function PartChip({ sp, design, i, name, on, locked, onClick, onHover, phone }: { sp: Species; design: Design; i: number; name: string; on: boolean; locked: boolean; onClick: () => void; onHover?: (i: number) => void; phone?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-haspopup="dialog"
      onClick={onClick}
      onMouseEnter={() => onHover?.(i)}
      onMouseLeave={() => onHover?.(-1)}
      onFocus={() => onHover?.(i)}
      onBlur={() => onHover?.(-1)}
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 rounded-full pl-3 pr-4 text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        phone && "border",
        on
          ? cn("bg-white/[0.1] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]", phone && "border-white/20")
          : cn("text-foreground/70 hover:bg-white/[0.05] hover:text-foreground", phone && "border-white/[0.07]")
      )}
      data-testid={`sm-part-${i}`}
    >
      <Dot color={hex(partSwatch(sp, design, i))} size={18} />
      {name}
      {locked && <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />}
    </button>
  );
}

const Dock = ({ ref, sp, design, parts, sel, locked, panel, onPart, onPanel, onRandomise, onShare, onHover, popover, t }: DockProps & {
  ref: React.Ref<HTMLDivElement>;
  panel: Panel;
  onPanel: (p: Panel) => void;
  onHover: (i: number) => void;
  popover: ReactNode;
}) => {
  const chipRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const dock = useRef<HTMLDivElement | null>(null);
  const [popX, setPopX] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (sel < 0) return;
    const chip = chipRefs.current.get(sel), d = dock.current;
    if (!chip || !d) return;
    setPopX(chip.offsetLeft + chip.offsetWidth / 2);
  }, [sel, parts.length]);
  const dw = dock.current?.offsetWidth ?? 0;
  const popW = 380;
  const left = popX === null ? dw / 2 : Math.min(Math.max(popX, popW / 2 - 40), dw - popW / 2 + 40);
  return (
    <div
      ref={(el) => {
        dock.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      className="sm-dock absolute inset-x-0 bottom-8 z-20 mx-auto flex w-fit max-w-[calc(100%-48px)] items-center gap-1 rounded-full p-1.5"
      role="toolbar"
      aria-label={t("dock.toolbar")}
      data-testid="sm-dock"
    >
      {popover && (
        <div
          key={sel}
          className="sm-pop sm-enter absolute bottom-full mb-4 rounded-[24px] p-4 pr-5"
          style={{ left, transform: "translateX(-50%)" }}
          role="dialog"
          aria-label={t("colour.dialog", { part: sp?.parts[sel]?.n ?? "" })}
          data-testid="sm-popover"
        >
          {popover}
          <span className="sm-pop absolute -bottom-[7px] h-3.5 w-3.5 -translate-x-1/2 rotate-45 rounded-[3px] [clip-path:polygon(100%_0,100%_100%,0_100%)]" style={{ left: (popX ?? dw / 2) - left + popW / 2 > 0 ? `calc(50% + ${(popX ?? dw / 2) - left}px)` : "50%" }} aria-hidden />
        </div>
      )}
      <button
        type="button"
        onClick={() => onPanel("picker")}
        aria-expanded={panel === "picker"}
        aria-label={sp ? t("dock.pokemon", { name: sp.name }) : t("picker.title")}
        className="flex h-11 shrink-0 items-center gap-2.5 rounded-full pl-1 pr-3.5 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        data-testid="sm-pokemon"
      >
        {sp ? <Avatar id={sp.id} /> : <span className="h-9 w-9 animate-pulse rounded-full bg-white/[0.06]" />}
        <span className="max-w-[150px] truncate text-[15px] font-medium">{sp?.name ?? " "}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
      </button>
      <span className="mx-1.5 h-6 w-px shrink-0 bg-white/10" aria-hidden />
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto sm-noscroll" role="group" aria-label={t("dock.parts")}>
        {sp && design
          ? parts.map(({ p, i }) => (
              <div key={i} ref={(el) => { if (el) chipRefs.current.set(i, el); else chipRefs.current.delete(i); }} className="shrink-0">
                <PartChip sp={sp} design={design} i={i} name={p.n} on={sel === i} locked={locked.has(i)} onClick={() => onPart(i)} onHover={onHover} />
              </div>
            ))
          : Array.from({ length: 4 }, (_, i) => <span key={i} className="h-11 w-24 shrink-0 animate-pulse rounded-full bg-white/[0.04]" aria-hidden />)}
      </div>
      <span className="mx-1.5 h-6 w-px shrink-0 bg-white/10" aria-hidden />
      <button
        type="button"
        onClick={() => onPanel("extras")}
        aria-expanded={panel === "extras"}
        aria-label={t("dock.more")}
        title={t("dock.more")}
        className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70", panel === "extras" && "bg-white/[0.1] text-foreground")}
        data-testid="sm-more"
      >
        <Ellipsis className="h-5 w-5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onRandomise}
        title={t("keys.hint")}
        aria-label={t("dock.randomise")}
        className="flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] text-foreground/70 transition-colors hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 max-xl:px-3"
        data-testid="sm-randomise"
      >
        <Dices className="h-[18px] w-[18px]" aria-hidden /> <span className="max-xl:hidden">{t("dock.randomise")}</span>
      </button>
      <button
        type="button"
        onClick={onShare}
        className="ml-1 flex h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-5 font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        data-testid="sm-share"
      >
        <Share className="h-4 w-4" aria-hidden /> {t("dock.share")}
      </button>
    </div>
  );
};

function PhoneControls({ sp, design, parts, sel, locked, onPart, onPanel, onRandomise, onShare, t }: DockProps & { onPanel: (p: Panel) => void }) {
  return (
    <div className="space-y-3" data-testid="sm-phone-controls">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => onPanel("picker")} className="flex h-11 items-center gap-2.5 rounded-full pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" aria-label={sp ? t("dock.pokemon", { name: sp.name }) : t("picker.title")} data-testid="sm-pokemon">
          {sp ? <Avatar id={sp.id} /> : <span className="h-9 w-9 animate-pulse rounded-full bg-white/[0.06]" />}
          <span className="text-[15px] font-medium">{sp?.name ?? " "}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        </button>
        <button type="button" onClick={() => onPanel("extras")} aria-label={t("dock.more")} className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="sm-more">
          <Ellipsis className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="sm-noscroll -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label={t("dock.parts")}>
        {sp && design
          ? parts.map(({ p, i }) => <PartChip key={i} phone sp={sp} design={design} i={i} name={p.n} on={sel === i} locked={locked.has(i)} onClick={() => onPart(i)} />)
          : Array.from({ length: 4 }, (_, i) => <span key={i} className="h-11 w-24 shrink-0 animate-pulse rounded-full bg-white/[0.04]" aria-hidden />)}
      </div>
      <div className="grid grid-cols-2 gap-3 pt-1">
        <button type="button" onClick={onRandomise} className="flex h-12 items-center justify-center gap-2 rounded-full border border-white/[0.1] text-[15px] font-medium text-foreground/85 transition-colors active:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="sm-randomise">
          <Dices className="h-[18px] w-[18px]" aria-hidden /> {t("dock.randomise")}
        </button>
        <button type="button" onClick={onShare} className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80" data-testid="sm-share">
          <Share className="h-4 w-4" aria-hidden /> {t("dock.share")}
        </button>
      </div>
    </div>
  );
}

/** A desktop drawer inside the stage (the picker on the left, more options on the right). */
function Drawer({ side, title, onClose, children, t, testId }: { side: "left" | "right"; title: string; onClose: () => void; children: ReactNode; t: T; testId: string }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (side === "right") close.current?.focus({ preventScroll: true });
  }, [side]);
  return (
    <div
      className={cn("sm-pop sm-enter absolute bottom-[112px] top-6 z-30 flex w-[420px] flex-col rounded-[24px] p-5 pr-3", side === "left" ? "left-6" : "right-6")}
      role="dialog"
      aria-label={title}
      data-testid={testId}
    >
      <div className="mb-4 flex shrink-0 items-center justify-between pr-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <button ref={close} type="button" onClick={onClose} aria-label={t("extras.close")} className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="sm-drawer-close">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">{children}</div>
    </div>
  );
}

/** The phone's bottom sheet, above the tab bar. */
function Sheet({ title, onClose, tall, children, t }: { title: string; onClose: () => void; tall: boolean; children: ReactNode; t: T }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, []);
  return createPortal(
    <div className="dark-scope">
      {tall && <div className="sm-fade fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden />}
      <div
        className={cn("sm-pop sm-sheet-enter fixed inset-x-0 z-50 flex flex-col rounded-t-[26px] px-4 pb-4 pt-2", tall ? "h-[min(78svh,640px)]" : "")}
        style={{ bottom: "var(--tabbar-h)" }}
        role="dialog"
        aria-label={title}
        data-testid="sm-sheet"
      >
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-white/20" aria-hidden />
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button ref={close} type="button" onClick={onClose} aria-label={t("extras.close")} className="-mr-1 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="sm-sheet-close">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className={cn("min-h-0", tall && "flex-1 overflow-y-auto overscroll-contain")}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

