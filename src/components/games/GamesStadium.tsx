"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Medal, Swords, Trophy, X } from "lucide-react";
import type { EventId } from "@/lib/games/events";
import { RACE_URLS } from "@/components/race/urls";
import { RACE_CSS } from "@/components/race/race-css";
import type { GamesScene, Quality } from "./scene";
import { cn } from "@/lib/utils";

export interface StadiumEvent { id: EventId; name: string; emoji: string; question: string; href: string; group: string }
export interface StadiumLink { label: string; href: string }

export interface GamesStadiumProps {
  events: StadiumEvent[];
  groups: string[];
  playHref: string;
  records: StadiumLink[];
  h2h: StadiumLink[];
  /** The head-to-head picker, over the example match-ups. */
  h2hPicker?: React.ReactNode;
  backHref: string;
  children: React.ReactNode;
}

const ENTERED = "pokeiq-games-entered";
const FLY_S = 2.6;

function webglOk() {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
}
function quality(): Quality {
  try {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q === "draft" || q === "low" || q === "medium" || q === "high") return q;
  } catch { /* ignore */ }
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return coarse && Math.min(window.screen.width, window.screen.height) < 820 ? "low" : "medium";
}
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * /lab/games: the stadium at night from outside, one "Enter the stadium"
 * button, then a flight into the infield and the event board over the 3D
 * view. Each event is a link to its own page (which starts it, as a deep
 * link always has). Without WebGL, or with reduced motion, the plain page
 * underneath (the same links) is the page.
 */
export function GamesStadium({ events, groups, playHref, records, h2h, h2hPicker, backHref, children }: GamesStadiumProps) {
  const [view, setView] = useState<"boot" | "3d" | "list">("boot");
  const [ready, setReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const [board, setBoard] = useState(false);
  const [tab, setTab] = useState<"events" | "records" | "h2h">("events");
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GamesScene | null>(null);
  const flyRef = useRef<{ t0: number | null; inside: boolean }>({ t0: null, inside: false });

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const forced = new URLSearchParams(window.location.search).get("view");
    setView(forced === "list" || (forced !== "3d" && reduce) || !webglOk() ? "list" : "3d");
    try {
      if (sessionStorage.getItem(ENTERED) === "1") { flyRef.current.inside = true; setEntered(true); setBoard(true); }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (view !== "3d") return;
    window.scrollTo(0, 0);
    document.documentElement.classList.add("rc-locked");
    return () => document.documentElement.classList.remove("rc-locked");
  }, [view]);

  useEffect(() => {
    if (view !== "3d" || !hostRef.current) return;
    const host = hostRef.current;
    let alive = true;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    const ac = new AbortController();
    import("./scene").then(async ({ createGamesScene }) => {
      if (!alive) return;
      const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
      try {
        await document.fonts?.load(`700 40px ${font}`).catch(() => undefined);
        if (!alive) return;
        const scene = createGamesScene(host, { quality: quality(), urls: RACE_URLS, font, onContextGone: () => alive && setView("list") });
        sceneRef.current = scene;
        await scene.load({ athletes: [], venue: "stadium" }, ac.signal);
        if (!alive) return;
        scene.setCard("The PokéIQ Games", "Choose your event");
        const fit = () => scene.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
        fit();
        ro = new ResizeObserver(fit);
        ro.observe(host);
        const tick = () => {
          raf = requestAnimationFrame(tick);
          const now = performance.now();
          const a = now / 1000;
          const aspect = host.clientWidth / Math.max(1, host.clientHeight);
          const narrow = aspect < 0.8;
          // Outside: a slow high orbit of the bowl, close and steep enough that the lit bowl (not its dark roof and the night) fills the frame. Inside: low on the infield, drifting.
          const out = { r: narrow ? 170 : 180, y: narrow ? 230 : 125, ang: a * 0.04, fov: narrow ? 58 : 40 };
          const inn = { r: 46, y: 9, ang: a * 0.03 + 0.6, fov: narrow ? 66 : 48 };
          const f = flyRef.current;
          let k = f.inside ? 1 : 0;
          if (f.t0 != null) {
            k = Math.min(1, (now - f.t0) / 1000 / FLY_S);
            if (k >= 1) { f.t0 = null; f.inside = true; }
          }
          const e = ease(k);
          const r = lerp(out.r, inn.r, e), y = lerp(out.y, inn.y, e), ang = lerp(out.ang, inn.ang, e);
          const pose = { pos: [Math.sin(ang) * r, y, Math.cos(ang) * r] as [number, number, number], target: [0, lerp(0, 4, e), 0] as [number, number, number], fov: lerp(out.fov, inn.fov, e) };
          scene.frame({ t: a, venue: "stadium", pose, beat: { kind: "card", t0: 0, t1: 1, cam: "" }, k: 0, actors: [], props: { kind: "none" }, bursts: [], decals: [], excitement: lerp(0.25, 0.55, e), replay: 0, fade: 0, flash: 0, clock: "", screen: null });
        };
        raf = requestAnimationFrame(tick);
        setReady(true);
      } catch { if (alive) setView("list"); }
    }, () => alive && setView("list"));
    return () => {
      alive = false;
      ac.abort();
      cancelAnimationFrame(raf);
      ro?.disconnect();
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, [view]);

  const enter = () => {
    setEntered(true);
    try { sessionStorage.setItem(ENTERED, "1"); } catch { /* ignore */ }
    if (!ready) { flyRef.current.inside = true; setBoard(true); return; }
    flyRef.current.t0 = performance.now();
    setTimeout(() => setBoard(true), FLY_S * 1000 * 0.8);
  };
  const leave = () => {
    setBoard(false);
    setEntered(false);
    flyRef.current = { t0: null, inside: false };
    try { sessionStorage.removeItem(ENTERED); } catch { /* ignore */ }
  };

  const chip = "pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-white/15 bg-[#0b1226]/75 px-3 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-white/85 backdrop-blur-md transition-colors hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd84a]";
  const tabBtn = (id: typeof tab, label: string, Icon?: typeof Trophy) => (
    <button type="button" onClick={() => setTab(id)} aria-pressed={tab === id} className={cn("inline-flex h-9 items-center gap-1.5 rounded-md border px-3 font-display text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors", tab === id ? "border-[#ffd84a]/70 bg-[#ffd84a]/15 text-[#ffd84a]" : "border-white/15 text-white/70 hover:text-white")} data-testid={`stadium-tab-${id}`}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}{label}
    </button>
  );

  return (
    <>
      <style>{RACE_CSS}</style>
      <noscript><style>{`.gm-entry{display:none!important}.gm-entry-page{visibility:visible!important}`}</style></noscript>
      <div className={cn("gm-entry-page", view !== "list" && "invisible")} inert={view !== "list" ? true : undefined}>{children}</div>
      {view !== "list" && (
        <div className="rc-stage gm-entry fixed left-0 !mt-0 w-screen bottom-[calc(3.5rem+env(safe-area-inset-bottom))] top-14 z-40 overflow-hidden lg:bottom-0" data-testid="stadium" data-ready={ready ? "1" : "0"} data-entered={entered ? "1" : "0"}>
          <div ref={hostRef} className="rc-host absolute inset-0 select-none" aria-hidden />
          <div className="rc-shade-top" aria-hidden />
          <div className="rc-shade-bottom" aria-hidden />
          <h1 className="sr-only">The PokéIQ Games: real track and field, swimming, weightlifting and wrestling for every Pokémon</h1>

          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3 sm:p-4">
            {entered ? (
              <button type="button" onClick={leave} className={chip} data-testid="stadium-leave"><ArrowLeft className="h-4 w-4" aria-hidden /> Outside</button>
            ) : (
              <Link href={backHref} className={chip} data-testid="stadium-back"><ArrowLeft className="h-4 w-4" aria-hidden /> 3D Lab</Link>
            )}
          </div>

          <AnimatePresence>
            {!entered && (
              <motion.div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 px-4 text-center text-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.4 }}>
                <p className="font-pixel text-[10px] uppercase tracking-[0.3em] text-[#ffd84a]">3D Lab · real sport, real stats</p>
                <p className="font-display text-4xl font-bold uppercase leading-none tracking-tight drop-shadow-[0_4px_24px_rgb(0_0_0/0.6)] sm:text-6xl" aria-hidden>The PokéIQ <span className="text-[#ffd84a]">Games</span></p>
                <button type="button" onClick={enter} className="rc-go inline-flex h-16 min-w-[16rem] items-center justify-center gap-3 rounded-xl px-8 font-display text-lg font-bold uppercase tracking-wider sm:h-[4.5rem] sm:text-xl" data-testid="stadium-enter" autoFocus>
                  <Medal className="h-6 w-6" aria-hidden /> Enter the stadium
                </button>
                {!ready && <p className="font-pixel text-[10px] uppercase tracking-[0.3em] text-white/60" aria-live="polite">Opening the venue…</p>}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {board && (
              <motion.div
                key="board"
                role="dialog"
                aria-label="Choose your event"
                className="absolute inset-x-0 bottom-0 z-20 mx-auto flex max-h-[78%] flex-col rounded-t-2xl border border-white/15 bg-[#070c1c]/90 text-white shadow-2xl backdrop-blur-xl sm:bottom-auto sm:top-16 sm:max-h-[calc(100%-6rem)] sm:w-[min(52rem,calc(100%-3rem))] sm:rounded-2xl lg:top-[max(4rem,calc(50%-20rem))] lg:max-h-[min(40rem,calc(100%-6rem))]"
                initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} transition={{ duration: 0.35 }}
                data-testid="stadium-picker" data-rc-scroll
              >
                <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="font-pixel text-[9px] uppercase tracking-[0.3em] text-[#ffd84a]">PokéIQ Stadium · tonight</p>
                    <h2 className="font-display text-xl font-bold uppercase tracking-wider">Choose your event</h2>
                  </div>
                  <button type="button" onClick={leave} className="rounded p-2 text-white/60 hover:text-white" aria-label="Back outside"><X className="h-5 w-5" /></button>
                </div>
                <div className="flex flex-wrap gap-2 px-4 pt-3 sm:px-5">
                  {tabBtn("events", "Events")}
                  {tabBtn("records", "Records", Trophy)}
                  {tabBtn("h2h", "Head to head", Swords)}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-5">
                  {tab === "events" && (
                    <div className="space-y-4">
                      <Link href={playHref} className="rc-go flex min-h-14 items-center justify-between gap-3 rounded-xl px-4 py-3" data-testid="stadium-play">
                        <span><span className="block font-display text-base font-bold uppercase tracking-wider">The full Games</span><span className="block text-xs opacity-80">Nations of three through every event, with a medal table</span></span>
                        <Trophy className="h-6 w-6 shrink-0" aria-hidden />
                      </Link>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {groups.map((g) => (
                          <section key={g} aria-label={g} className="min-w-0">
                            <h3 className="mb-1.5 font-pixel text-[9px] uppercase tracking-[0.3em] text-white/55">{g}</h3>
                            <ul className="space-y-1.5">
                              {events.filter((e) => e.group === g).map((e) => (
                                <li key={e.id}>
                                  <Link href={e.href} prefetch={false} className="flex min-h-12 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 transition-colors hover:border-[#ffd84a]/60 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd84a]" data-testid={`stadium-event-${e.id}`}>
                                    <span className="text-xl" aria-hidden>{e.emoji}</span>
                                    <span className="min-w-0 flex-1"><span className="block font-display text-sm font-bold uppercase tracking-wide">{e.name}</span><span className="block truncate text-xs text-white/60">{e.question}</span></span>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    </div>
                  )}
                  {tab === "records" && (
                    <ul className="grid gap-1.5 sm:grid-cols-2" data-testid="stadium-records">
                      {records.map((r) => <li key={r.href}><Link href={r.href} prefetch={false} className="flex min-h-11 items-center rounded-lg border border-white/10 bg-white/[0.04] px-3 font-display text-sm font-semibold uppercase tracking-wide hover:border-[#ffd84a]/60">{r.label}</Link></li>)}
                    </ul>
                  )}
                  {tab === "h2h" && h2hPicker && <div className="mb-3">{h2hPicker}</div>}
                  {tab === "h2h" && (
                    <ul className="grid gap-1.5 sm:grid-cols-2" data-testid="stadium-h2h">
                      {h2h.map((r) => <li key={r.href}><Link href={r.href} prefetch={false} className="flex min-h-11 items-center rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-display text-sm font-semibold uppercase tracking-wide hover:border-[#ffd84a]/60">{r.label}</Link></li>)}
                    </ul>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
