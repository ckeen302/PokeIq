"use client";

/* eslint-disable @next/next/no-img-element -- screenshots come from the preview proxy, artwork from /api/art */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { REGION_ORIGINS } from "@/lib/region-origins";
import { isMuted, onMuteChange, setMuted } from "@/lib/sound";
import { artUrl } from "@/lib/pokemon/art";
import { placeSlug } from "@/lib/dex/places";
import { clampEra, LAST_GEN, ROMAN } from "@/lib/globe/era";
import { markGlobeIntroSeen, shouldPlayGlobeIntro } from "@/lib/globe/intro";
import type { GlobeShotIndex } from "@/lib/globe/shots";
import type { GlobeEra, GlobeRegionCard } from "@/lib/globe/regions";
import type { HoverInfo, SceneApi } from "./scene";
import type { GlobeAudio } from "./audio";

const CSS = `
.gl-lb{position:absolute;left:0;top:0;white-space:nowrap;will-change:transform;transition:color .15s}
.gl-lb.region{font:700 15px var(--font-display),sans-serif;letter-spacing:.16em;text-transform:uppercase;color:hsl(var(--foreground));padding:3px 9px;background:hsl(var(--card)/.8);border:1px solid hsl(var(--screen));border-radius:2px;backdrop-filter:blur(4px)}
.gl-lb.city{font:600 12px var(--font-display),sans-serif;letter-spacing:.04em;color:hsl(var(--foreground));text-shadow:0 0 4px hsl(var(--background)),0 0 8px hsl(var(--background))}
.gl-lb.city::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:hsl(var(--primary));margin-right:5px;vertical-align:1px;box-shadow:0 0 6px hsl(var(--primary))}
.gl-lb.place{font:400 10.5px var(--font-body),sans-serif;color:hsl(var(--muted-foreground));text-shadow:0 0 3px hsl(var(--background)),0 0 6px hsl(var(--background))}
.gl-lb.place::before{content:"";display:inline-block;width:4px;height:4px;border-radius:50%;background:hsl(var(--screen));margin-right:4px;vertical-align:1px}
.gl-lb.peak{font:600 11px var(--font-display),sans-serif;letter-spacing:.06em;color:hsl(var(--foreground)/.9)}
.gl-lb.peak::before{content:"▲";width:auto;height:auto;border-radius:0;background:none;color:hsl(var(--screen));font-size:9px;margin-right:4px;vertical-align:0}
.gl-lb.is-hover{color:hsl(var(--primary))}
.gl-lb.is-hover::after{content:"";position:absolute;left:10px;right:0;bottom:-3px;height:1px;background:hsl(var(--primary)/.8)}
@keyframes gl-intro-veil{from{opacity:1}to{opacity:0}}
@keyframes gl-intro-title{0%{opacity:0;letter-spacing:.6em;filter:blur(6px)}22%{opacity:1;letter-spacing:.24em;filter:blur(0)}72%{opacity:1}100%{opacity:0;letter-spacing:.2em}}
@keyframes gl-intro-sub{0%,18%{opacity:0;transform:translateY(6px)}34%{opacity:1;transform:none}72%{opacity:1}100%{opacity:0}}
@keyframes gl-blink{50%{opacity:.35}}
@keyframes gl-pop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
@keyframes gl-card{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
@keyframes gl-sheet{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
.gl-pop{animation:gl-pop .18s cubic-bezier(.2,.9,.3,1) both}
@media (prefers-reduced-motion: reduce){.gl-pop,.gl-card-in,.gl-sheet-in{animation:none!important}}
`;

type Popup = { info: HoverInfo; pinned: boolean; i: number };

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function WorldGlobe({ regions, eras }: { regions: GlobeRegionCard[]; eras: GlobeEra[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const api = useRef<SceneApi | null>(null);
  const audio = useRef<GlobeAudio | null>(null);
  const shots = useRef<GlobeShotIndex | null>(null);
  const shotsLoad = useRef<Promise<GlobeShotIndex | null> | null>(null);
  const closeTimer = useRef(0);
  const heldByHover = useRef(false);
  const [state, setState] = useState<"loading" | "ready" | "nogl" | "failed">("loading");
  const [stats, setStats] = useState({ lon: "0.0°", lat: "0.0°", zoom: "1.0×", tier: "Regions", focus: "Kanto" });
  const [auto, setAuto] = useState(true);
  const [intro, setIntro] = useState<boolean | null>(null);
  const [era, setEraState] = useState(LAST_GEN);
  const [playing, setPlaying] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [shotIndex, setShotIndex] = useState<GlobeShotIndex | null>(null);
  const [muted, setMutedState] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [quality, setQuality] = useState(3);
  const popupRef = useRef<Popup | null>(null);
  /** Decided once per page: React's development double-mount must not see its own "seen" mark. */
  const introDecision = useRef<boolean | null>(null);
  popupRef.current = popup;

  const ensureShots = useCallback(() => {
    if (shots.current) return Promise.resolve(shots.current);
    shotsLoad.current ??= fetch("/guessr/globe/shots.json")
      .then((r) => (r.ok ? (r.json() as Promise<GlobeShotIndex>) : null))
      .then((idx) => {
        if (idx) {
          shots.current = idx;
          setShotIndex(idx);
          api.current?.setShots(new Set(Object.keys(idx)));
        }
        return idx;
      })
      .catch(() => {
        shotsLoad.current = null;
        return null;
      });
    return shotsLoad.current;
  }, []);
  const preload = useCallback((key: string, all = false) => {
    void ensureShots().then((idx) => {
      for (const s of (idx?.[key] ?? []).slice(0, all ? 5 : 1)) {
        const img = new Image();
        img.decoding = "async";
        img.src = s.src;
      }
    });
  }, [ensureShots]);

  // ---- the scene
  useEffect(() => {
    const host = hostRef.current!, layer = layerRef.current!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("quality");
    const startEra = params.has("era") ? clampEra(params.get("era")) : LAST_GEN;
    if (introDecision.current === null) {
      introDecision.current = shouldPlayGlobeIntro({ store: localStore(), reducedMotion: reduce });
      if (introDecision.current) markGlobeIntroSeen(localStore());
    }
    const playIntro = introDecision.current;
    setIntro(playIntro);
    setEraState(startEra);
    setMutedState(isMuted());
    const onResize = () => setNarrow(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    let alive = true;
    void import("./scene").then(({ createGlobeScene }) => {
      if (!alive) return;
      const s = createGlobeScene(
        host,
        layer,
        {
          ready() { setState("ready"); },
          failed() { setIntro(false); setState("failed"); },
          stats(s) { setStats(s); },
          hover(h, pinned) {
            window.clearTimeout(closeTimer.current);
            if (!h || !pinned) heldByHover.current = heldByHover.current && !!h;
            if (!h) {
              // A short grace, so the pointer can travel from the label onto the popup.
              closeTimer.current = window.setTimeout(() => setPopup(null), pinned ? 0 : 240);
              return;
            }
            preload(h.key, true);
            setPopup((p) => {
              if (!p || p.info.key !== h.key) { if (pinned) audio.current?.shot(); else audio.current?.hover(); }
              return { info: h, pinned, i: p && p.info.key === h.key ? p.i : 0 };
            });
          },
          anchor(x, y, w, h, visible) {
            const el = popRef.current;
            if (!el) return;
            // Phones dock the picture at the bottom of the screen.
            if (window.innerWidth < 640) { el.style.left = ""; el.style.top = ""; el.style.visibility = "visible"; return; }
            const W = host.clientWidth, pw = el.offsetWidth, ph = el.offsetHeight;
            const left = Math.max(12, Math.min(W - pw - 12, x + w / 2 - pw / 2));
            const top = y - ph - 10 < 64 ? y + h + 10 : y - ph - 10;
            el.style.left = `${Math.round(left)}px`;
            el.style.top = `${Math.round(top)}px`;
            el.style.visibility = visible ? "visible" : "hidden";
          },
          intent(key) { preload(key); },
          region(name) {
            setCard((was) => {
              if (name && name !== was) audio.current?.card();
              return name;
            });
          },
          fly() { audio.current?.fly(); },
          auto(on) { setAuto(on); },
          quality(qq) { setQuality(qq); },
          introDone() { setIntro(false); },
          firstPointer() { void ensureShots(); },
        },
        { intro: playIntro, quality: q !== null && /^[0-3]$/.test(q) ? Number(q) : null, era: startEra },
      );
      if (!s) { setIntro(false); return setState("nogl"); }
      api.current = s;
      if (shots.current) s.setShots(new Set(Object.keys(shots.current)));
    });
    // The pictures index loads once the world is up and the page is idle (or sooner, when the pointer reaches for a label).
    const idle = window.setTimeout(() => void ensureShots(), 4000);
    return () => {
      alive = false;
      window.clearTimeout(idle);
      window.removeEventListener("resize", onResize);
      api.current?.dispose();
      api.current = null;
    };
  }, [ensureShots, preload]);

  // ---- the globe is full screen: the page behind it doesn't scroll (nor show a scrollbar)
  useEffect(() => {
    const html = document.documentElement, was = html.style.overflow;
    html.style.overflow = "hidden";
    return () => { html.style.overflow = was; };
  }, []);

  // ---- sound: the module loads on the first gesture, and only does anything when the site's sound is on
  useEffect(() => {
    let alive = true;
    const gesture = () => {
      if (isMuted()) return;
      if (audio.current) { audio.current.gesture(); return; }
      void import("./audio").then(({ createGlobeAudio }) => {
        if (!alive || audio.current) return;
        audio.current = createGlobeAudio();
        audio.current.gesture();
      });
    };
    window.addEventListener("pointerdown", gesture, true);
    window.addEventListener("keydown", gesture, true);
    const stop = onMuteChange((m) => setMutedState(m));
    return () => {
      alive = false;
      window.removeEventListener("pointerdown", gesture, true);
      window.removeEventListener("keydown", gesture, true);
      stop();
      audio.current?.dispose();
      audio.current = null;
    };
  }, []);
  const closePopup = () => {
    audio.current?.close();
    heldByHover.current = false;
    api.current?.unpin();
    window.clearTimeout(closeTimer.current);
    setPopup(null);
  };
  const toggleSound = () => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  };

  // ---- the intro: any key skips it; Escape closes what is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (intro) { api.current?.skipIntro(); return; }
      if (e.key === "Escape") {
        if (popupRef.current) { api.current?.unpin(); setPopup(null); }
        else setCard(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [intro]);

  // ---- the region card makes room for itself
  useEffect(() => {
    const s = api.current;
    if (!s) return;
    if (!card) s.setShift(0, 0);
    else if (narrow) s.setShift(0, -Math.min(window.innerHeight * 0.22, 190));
    else s.setShift(-190, 0);
  }, [card, narrow]);

  // ---- era
  const chooseEra = useCallback((gen: number, sound = true) => {
    setEraState(gen);
    api.current?.setEra(gen);
    if (sound) audio.current?.era(gen);
    setCard((c) => {
      const r = regions.find((x) => x.name === c);
      return r && r.gen > gen ? null : c;
    });
    const url = new URL(window.location.href);
    if (gen === LAST_GEN) url.searchParams.delete("era"); else url.searchParams.set("era", String(gen));
    window.history.replaceState(null, "", url);
  }, [regions]);
  useEffect(() => {
    if (!playing) return;
    let gen = era >= LAST_GEN ? 0 : era;
    const step = () => {
      gen++;
      chooseEra(gen);
      if (gen >= LAST_GEN) setPlaying(false);
    };
    if (gen === 0) step();
    const id = window.setInterval(step, 1300);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per press of play
  }, [playing]);

  const regionCard = regions.find((r) => r.name === card) ?? null;
  const shotList = popup ? shotIndex?.[popup.info.key] ?? [] : [];
  const shot = shotList.length ? shotList[popup!.i % shotList.length] : null;
  const eraInfo = eras.find((e) => e.gen === era);
  const btn = "pointer-events-auto rounded-md border bg-card/80 px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.12em] backdrop-blur hover:border-screen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const ready = state === "ready";
  const hudOn = ready && intro === false;

  return (
    <div ref={hostRef} className="fixed inset-0 z-[60] overflow-hidden bg-background text-foreground" data-testid="world-globe" data-state={state} data-era={era} data-intro={intro ? "1" : "0"} data-card={card ?? ""}>
      <style>{CSS}</style>
      {/* A soft glow of space behind the world, under the canvas. */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 55%, hsl(var(--screen) / 0.10), transparent 60%)" }} />
      <div ref={layerRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
      {/* Soft scrims keep the HUD readable over a bright, zoomed-in world. */}
      <div aria-hidden className={"pointer-events-none absolute inset-x-0 top-0 h-40 transition-opacity duration-700 " + (hudOn ? "opacity-100" : "opacity-0")} style={{ background: "linear-gradient(hsl(var(--background) / .72), transparent)" }} />
      <div aria-hidden className={"pointer-events-none absolute inset-x-0 bottom-0 h-56 transition-opacity duration-700 " + (hudOn ? "opacity-100" : "opacity-0")} style={{ background: "linear-gradient(transparent, hsl(var(--background) / .78))" }} />
      {state === "nogl" && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center" data-testid="globe-fallback">
          <p className="font-display text-lg font-semibold uppercase tracking-wider text-muted-foreground">Your browser can&apos;t show 3D graphics</p>
        </div>
      )}
      {state === "failed" && <p className="absolute inset-0 flex items-center justify-center font-display text-muted-foreground">Couldn&apos;t load the atlas. Try reloading.</p>}

      {/* HUD */}
      <div className={"transition-opacity duration-700 " + (hudOn || state === "nogl" || state === "failed" || intro === false ? "opacity-100" : "opacity-0")}>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
          <div className="min-w-0">
            <Link href="/guessr" className={btn + " mb-3 inline-block"}>← PokéGuessr</Link>
            <h1 className="font-display text-xl font-bold uppercase tracking-[0.14em] sm:text-3xl">Poké<span className="text-primary">IQ</span> World</h1>
            <p className="mt-1.5 font-pixel text-[10px] uppercase tracking-[0.14em] text-screen">
              {state === "ready" ? "Every region, on one world" : "Loading the world…"}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button type="button" onClick={toggleSound} data-testid="globe-sound" aria-pressed={!muted} aria-label={muted ? "Turn sound on" : "Turn sound off"} title={muted ? "Sound off" : "Sound on"} className={btn + " flex h-9 w-9 items-center justify-center !p-0"}>
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 text-primary" />}
            </button>
            <div className="hidden text-right font-pixel text-[10px] uppercase leading-[1.9] tracking-[0.12em] tabular-nums text-muted-foreground sm:block">
              Lon <b className="font-normal text-foreground">{stats.lon}</b><br />Lat <b className="font-normal text-foreground">{stats.lat}</b><br />Zoom <b className="font-normal text-foreground">{stats.zoom}</b>
            </div>
          </div>
        </div>

        <div className={"pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity sm:px-6 " + (card && narrow ? "invisible opacity-0" : "")}>
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0 max-w-md">
              <p className="mb-1 font-pixel text-[10px] uppercase tracking-[0.14em] text-screen">Detail: {stats.tier}</p>
              <p className="min-h-[1.3em] font-display text-base font-bold uppercase tracking-[0.14em] sm:text-2xl">{stats.focus}</p>
              {REGION_ORIGINS[stats.focus] && <p className="mb-1 hidden text-sm text-foreground/85 sm:block" data-testid="globe-region-origin">{REGION_ORIGINS[stats.focus]}</p>}
              <p className="hidden text-xs text-muted-foreground sm:block">Drag to spin · scroll or pinch to zoom · hover a town to see it · click a region to fly there</p>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <EraControl eras={eras} era={era} playing={playing} onEra={(g) => { setPlaying(false); chooseEra(g); }} onPlay={() => setPlaying((p) => !p)} caption={eraInfo} />
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <button type="button" aria-pressed={auto} onClick={() => api.current?.setAuto(!auto)} className={btn + (auto ? " border-primary text-primary" : "")}>Auto-spin</button>
                <button type="button" onClick={() => api.current?.next()} className={btn}>Next region</button>
                <button type="button" onClick={() => api.current?.out()} className={btn}>Zoom out</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hover/tap picture */}
      {popup && (
        <div
          ref={popRef}
          data-testid="globe-shot-card"
          onPointerEnter={() => { window.clearTimeout(closeTimer.current); if (!popup.pinned) { heldByHover.current = true; api.current?.pin(popup.info.key); } }}
          onPointerLeave={(e) => { if (e.pointerType === "mouse" && heldByHover.current) { heldByHover.current = false; api.current?.unpin(); } }}
          className="gl-pop pointer-events-auto fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-3 right-3 z-20 overflow-hidden rounded-lg border border-screen/50 bg-card/95 shadow-[0_0_32px_hsl(var(--screen)/0.25)] backdrop-blur sm:absolute sm:bottom-auto sm:left-0 sm:right-auto sm:top-0 sm:w-[320px]"
          style={{ visibility: "hidden" }}
        >
          <ShotFrame shot={shot} name={popup.info.name} loading={!shotIndex} />
          <div className="flex items-start gap-2 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-bold uppercase tracking-[0.1em]" data-testid="globe-shot-name">{shot?.n ?? popup.info.name}</p>
              <p className="font-pixel text-[9px] uppercase leading-relaxed tracking-[0.14em] text-screen">
                {popup.info.region}{shot ? ` · ${shot.g}` : ""}
              </p>
              {shot && (
                <Link href={`/pokedex/places/${placeSlug({ name: shot.n, region: popup.info.region })}`} className="mt-1 inline-block text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  Open its Pokédex page
                </Link>
              )}
            </div>
            {shotList.length > 1 && (
              <div className="flex shrink-0 items-center gap-1">
                <span className="font-pixel text-[9px] tabular-nums text-muted-foreground">{(popup.i % shotList.length) + 1}/{shotList.length}</span>
                <button type="button" aria-label="Previous picture" className={btn + " !p-1.5"} onClick={() => { audio.current?.hover(); setPopup((p) => p && { ...p, i: (p.i + shotList.length - 1) % shotList.length }); }}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="Next picture" data-testid="globe-shot-next" className={btn + " !p-1.5"} onClick={() => { audio.current?.hover(); setPopup((p) => p && { ...p, i: (p.i + 1) % shotList.length }); }}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {(popup.pinned || narrow) && (
              <button type="button" aria-label="Close" data-testid="globe-shot-close" className={btn + " !p-1.5"} onClick={closePopup}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Region card */}
      {regionCard && (
        <RegionCard
          key={regionCard.name}
          card={regionCard}
          narrow={narrow}
          onClose={() => { audio.current?.close(); setCard(null); }}
        />
      )}

      {/* Intro */}
      {intro && (
        <button
          type="button"
          data-testid="globe-intro"
          onClick={() => api.current?.skipIntro()}
          onWheel={() => api.current?.skipIntro()}
          onTouchStart={() => api.current?.skipIntro()}
          className="absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center text-center outline-none"
          aria-label="Skip the intro"
        >
          {/* Dark until the world is built, then the veil lifts as the camera falls in from space. */}
          <span aria-hidden className="absolute inset-0 bg-background" style={ready ? { animation: "gl-intro-veil 1.4s ease-out .15s both" } : undefined} />
          {ready && (
            <>
              <span className="relative font-display text-3xl font-bold uppercase text-foreground sm:text-6xl" style={{ animation: "gl-intro-title 3.4s ease-out .2s both", textShadow: "0 0 28px hsl(var(--screen) / .6)" }}>
                Poké<span className="text-primary">IQ</span> World
              </span>
              <span className="relative mt-3 font-pixel text-[10px] uppercase tracking-[0.3em] text-screen sm:text-xs" style={{ animation: "gl-intro-sub 3.4s ease-out .2s both" }}>
                Every region, on one world
              </span>
            </>
          )}
          <span data-testid="globe-intro-skip" className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] font-pixel text-[9px] uppercase tracking-[0.3em] text-muted-foreground" style={{ animation: "gl-blink 1.2s steps(2) infinite" }}>
            Click or press any key to skip
          </span>
        </button>
      )}
      <span className="sr-only" data-testid="globe-quality">{quality}</span>
    </div>
  );
}

function ShotFrame({ shot, name, loading }: { shot: { src: string; b?: string; n: string; g: string } | null; name: string; loading: boolean }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden bg-shade/40">
      {shot?.b && <img src={shot.b} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl" />}
      {shot ? (
        <img
          key={shot.src}
          src={shot.src}
          alt={`${shot.n} in Pokémon ${shot.g}`}
          data-testid="globe-shot-img"
          decoding="async"
          onLoad={() => setLoaded(shot.src)}
          className={"absolute inset-0 h-full w-full object-cover transition-opacity duration-300 " + (loaded === shot.src ? "opacity-100" : "opacity-0")}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center font-pixel text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {loading ? "Loading…" : `No picture of ${name} yet`}
        </div>
      )}
    </div>
  );
}

function EraControl({ eras, era, playing, onEra, onPlay, caption }: { eras: GlobeEra[]; era: number; playing: boolean; onEra(g: number): void; onPlay(): void; caption?: GlobeEra }) {
  return (
    <div className="pointer-events-auto" data-testid="globe-era">
      <p className="mb-1.5 font-pixel text-[9px] uppercase tracking-[0.14em] text-muted-foreground sm:text-right" data-testid="globe-era-caption">
        <span className="text-screen">Era</span> · Gen {ROMAN[era]}{caption?.year ? ` · ${caption.year}` : ""}
        {caption?.regions.length ? ` · ${era === eras.at(-1)?.gen ? "the whole world" : `adds ${caption.regions.join(", ")}`}` : ""}
      </p>
      <div role="group" aria-label="Show the world as it was at a generation" className="flex items-center gap-1 rounded-md border bg-card/80 p-1 backdrop-blur">
        <button type="button" onClick={onPlay} aria-pressed={playing} data-testid="globe-era-play" aria-label={playing ? "Stop" : "Watch the world grow, generation by generation"} title="Watch the world grow" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        {eras.map((e) => {
          const on = e.gen <= era, cur = e.gen === era;
          return (
            <button
              key={e.gen}
              type="button"
              data-testid={`globe-era-${e.gen}`}
              aria-pressed={cur}
              aria-label={`Generation ${e.gen}${e.year ? `, ${e.year}` : ""}${e.regions.length ? `: ${e.regions.join(", ")}` : ""}`}
              onClick={() => onEra(e.gen)}
              className={
                "h-7 min-w-0 flex-1 rounded-sm px-1 font-pixel text-[9px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-8 sm:flex-none " +
                (cur ? "bg-primary text-primary-foreground" : on ? "bg-screen/15 text-foreground hover:bg-screen/25" : "text-muted-foreground hover:bg-accent")
              }
            >
              {ROMAN[e.gen]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RegionCard({ card, narrow, onClose }: { card: GlobeRegionCard; narrow: boolean; onClose(): void }) {
  return (
    <aside
      data-testid="globe-region-card"
      aria-label={`${card.name} region`}
      className={
        "pointer-events-auto absolute z-20 overflow-y-auto border border-screen/50 bg-card/90 p-5 shadow-[0_0_40px_hsl(var(--screen)/0.22)] backdrop-blur-md " +
        (narrow
          ? "inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[56vh] rounded-xl !p-4"
          : "right-6 top-[88px] max-h-[calc(100vh-250px)] w-[360px] rounded-xl")
      }
      style={{ animation: `${narrow ? "gl-sheet" : "gl-card"} .35s cubic-bezier(.2,.9,.3,1) both` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-pixel text-[10px] uppercase tracking-[0.16em] text-screen" data-testid="globe-region-gen">
            Generation {ROMAN[card.gen]}{card.year ? ` · ${card.year}` : ""}
          </p>
          <h2 className="mt-1 font-display text-3xl font-bold uppercase tracking-[0.14em]">{card.name}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" data-testid="globe-region-close" className="rounded-md border bg-card/80 p-1.5 hover:border-screen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="h-4 w-4" />
        </button>
      </div>
      {card.origin && <p className={"mt-2 leading-snug text-foreground/80 " + (narrow ? "text-xs" : "text-sm")}>{card.origin}</p>}
      {card.starters.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-pixel text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{card.starters.length === 1 ? "Partner" : "Starters"}</p>
          <ul className="grid grid-cols-3 gap-2" data-testid="globe-region-starters">
            {card.starters.map((s) => (
              <li key={s.id}>
                <Link href={`/pokemon/${s.slug}`} className="group flex flex-col items-center rounded-lg border bg-background/40 px-1 pb-2 pt-1 hover:border-screen">
                  <img src={artUrl(s.id, 96)} alt="" width={72} height={72} loading="lazy" decoding="async" className="h-14 w-14 object-contain sm:h-[72px] sm:w-[72px] drop-shadow-[0_4px_8px_hsl(var(--shade)/0.4)] transition-transform group-hover:-translate-y-0.5" />
                  <span className="mt-1 truncate text-center font-display text-[11px] font-semibold uppercase tracking-wide">{s.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {card.games.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-pixel text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Games set here</p>
          <ul className="flex flex-wrap gap-1.5" data-testid="globe-region-games">
            {card.games.map((g) => (
              <li key={g.title} className="rounded-sm border px-2 py-1 text-[11px] leading-tight">
                {g.title} <span className="text-muted-foreground">· {g.year}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={"grid gap-2 " + (narrow ? "mt-4 grid-cols-2" : "mt-5")}>
        {card.guessr && (
          <Link href={card.guessr} data-testid="globe-region-play" className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md bg-primary px-3 font-display text-xs sm:text-sm font-semibold uppercase tracking-wider text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))] hover:brightness-110 active:translate-y-[2px] active:shadow-[0_2px_0_hsl(var(--primary-shadow))]">
            Play PokéGuessr here
          </Link>
        )}
        {card.places && (
          <Link href={card.places} data-testid="globe-region-dex" className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border border-border bg-card px-3 font-display text-xs sm:text-sm font-semibold uppercase tracking-wider shadow-[0_3px_0_hsl(var(--border))] hover:border-screen/60 active:translate-y-[2px]">
            Open in Pokédex
          </Link>
        )}
      </div>
    </aside>
  );
}
