"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { typeColor } from "@/lib/pokemon/type-colors";
import { SCENE_URLS } from "@/components/sizes/scene-item";
import { cn } from "@/lib/utils";
import type { LabEntry } from "./roster";
import type { Shot } from "./scene";

/**
 * MOCK: the Professor's Lab, a 3D Pokédex. The scene (scene/index.ts) is the
 * whole stage; the panels over it are plain HTML in the site's type and
 * colours: who's on the table, their base stats, the wheel's controls and
 * the filters.
 */

const STAT_LABELS = ["HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed"];
const STAT_SHORT = ["HP", "ATK", "DEF", "SPA", "SPD", "SPE"];
const GENS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
const FILTER_TYPES = ["fire", "water", "grass", "electric", "psychic", "dragon"];

function cssFont(v: string, fallback: string) {
  const f = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  return f || fallback;
}

function Corners({ className }: { className?: string }) {
  const c = "pointer-events-none absolute h-3 w-3 border-cyan-200/70";
  return (
    <div className={cn("pointer-events-none absolute inset-0", className)} aria-hidden>
      <span className={cn(c, "left-0 top-0 rounded-tl-[6px] border-l-2 border-t-2")} />
      <span className={cn(c, "right-0 top-0 rounded-tr-[6px] border-r-2 border-t-2")} />
      <span className={cn(c, "bottom-0 left-0 rounded-bl-[6px] border-b-2 border-l-2")} />
      <span className={cn(c, "bottom-0 right-0 rounded-br-[6px] border-b-2 border-r-2")} />
    </div>
  );
}

const panel = "relative rounded-xl border border-cyan-200/[0.14] bg-[#050a17]/60 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-md";

/** Six base stats on a hexagon: HP at the top, then clockwise Attack, Defense, Speed, Sp. Def, Sp. Atk. */
function Radar({ stats, color }: { stats: number[]; color: string }) {
  const order = [0, 1, 2, 5, 4, 3];
  const R = 92, C = 110, MAX = 150;
  const pt = (k: number, v: number) => {
    const a = -Math.PI / 2 + (k * Math.PI) / 3;
    const r = (Math.min(MAX, v) / MAX) * R;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r] as const;
  };
  const ring = (f: number) => order.map((_, k) => pt(k, MAX * f).join(",")).join(" ");
  const shape = order.map((i, k) => pt(k, stats[i]).join(",")).join(" ");
  return (
    <svg viewBox="0 0 220 220" className="h-[200px] w-[200px] overflow-visible" aria-label="Base stats">
      <defs>
        <radialGradient id="radar-fill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0.5" />
        </radialGradient>
        <filter id="radar-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill={f === 1 ? "rgba(126,232,255,0.04)" : "none"} stroke="rgba(126,232,255,0.22)" strokeWidth={f === 1 ? 1.2 : 0.8} strokeDasharray={f === 1 ? undefined : "2 3"} />
      ))}
      {order.map((_, k) => {
        const [x, y] = pt(k, MAX);
        return <line key={k} x1={C} y1={C} x2={x} y2={y} stroke="rgba(126,232,255,0.16)" strokeWidth={0.8} />;
      })}
      <polygon points={shape} fill="url(#radar-fill)" stroke={color} strokeWidth={2} strokeLinejoin="round" filter="url(#radar-glow)" />
      {order.map((i, k) => {
        const [x, y] = pt(k, stats[i]);
        return <circle key={k} cx={x} cy={y} r={3} fill="#fff" stroke={color} strokeWidth={1.5} />;
      })}
      {order.map((i, k) => {
        const [x, y] = pt(k, MAX * 1.2);
        return (
          <g key={`l${k}`}>
            <text x={x} y={y - 5} textAnchor="middle" className="fill-cyan-100/60 font-pixel" fontSize="8.5" letterSpacing="1">{STAT_SHORT[i]}</text>
            <text x={x} y={y + 8} textAnchor="middle" className="fill-white font-display" fontSize="12" fontWeight="700">{stats[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function LabDex({ roster }: { roster: LabEntry[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [shot, setShot] = useState<Shot>("hero");
  const [selected, setSelected] = useState(() => roster.findIndex((e) => e.id === 6));
  const [ready, setReady] = useState(false);
  const [hud, setHud] = useState(true);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const s = q.get("shot") as Shot | null;
    if (s === "wide" || s === "select" || s === "hero") setShot(s);
    const id = Number(q.get("pick") || (s === "select" ? 25 : 6));
    const i = roster.findIndex((e) => e.id === id);
    if (i >= 0) setSelected(i);
    if (q.get("hud") === "0") setHud(false);
  }, [roster]);

  useEffect(() => {
    document.documentElement.classList.add("lx-locked");
    return () => document.documentElement.classList.remove("lx-locked");
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || selected < 0) return;
    let alive = true;
    let raf = 0;
    let dispose: (() => void) | null = null;
    setReady(false);
    (async () => {
      const fonts = { display: cssFont("--font-display", "sans-serif"), pixel: cssFont("--font-pixel", "monospace"), body: cssFont("--font-body", "sans-serif") };
      await Promise.all([document.fonts.load(`700 40px ${fonts.display}`), document.fonts.load(`600 20px ${fonts.display}`), document.fonts.load(`400 20px ${fonts.pixel}`)]).catch(() => undefined);
      const { createLabScene } = await import("./scene");
      if (!alive) return;
      const scene = createLabScene(el, { roster, selected, shot, fonts, urls: SCENE_URLS, spin: shot === "select" ? 0.38 : 0.5 });
      dispose = () => scene.dispose();
      const onResize = () => scene.resize(el.clientWidth, el.clientHeight);
      window.addEventListener("resize", onResize);
      const prevDispose = dispose;
      dispose = () => { window.removeEventListener("resize", onResize); prevDispose(); };
      await scene.ready.catch((e) => console.error("lab figures", e));
      if (!alive) return;
      // A still: a fixed moment of the idle loop, drawn a few times (shadow maps, the mirror, mipmaps all settle).
      let n = 0;
      const t = shot === "select" ? 3.1 : 2.4;
      const step = () => {
        if (!alive) return;
        scene.render(t);
        n++;
        if (n < 3) raf = requestAnimationFrame(step);
        else requestAnimationFrame(() => { setReady(true); (window as unknown as { __labReady?: boolean }).__labReady = true; });
      };
      raf = requestAnimationFrame(step);
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      dispose?.();
    };
  }, [roster, selected, shot]);

  const e = roster[Math.max(0, selected)];
  const col = typeColor(e.types[0]);
  const prev = roster[(selected - 1 + roster.length) % roster.length];
  const next = roster[(selected + 1) % roster.length];
  const total = useMemo(() => e.stats.reduce((a, b) => a + b, 0), [e]);

  return (
    <>
      <style>{`html.lx-locked, html.lx-locked body { overflow: hidden; } nextjs-portal { display: none !important; } .lx-stage { background: radial-gradient(120% 90% at 50% 40%, #0b1426 0%, #03050b 70%); }`}</style>
      <div className="lx-stage fixed inset-x-0 bottom-0 top-14 z-40 overflow-hidden" data-ready={ready ? "1" : "0"} data-testid="lab-stage">
        <div ref={host} className="absolute inset-0" />
        {!ready && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="hud-label animate-pulse text-cyan-200/70">Calibrating the lab…</p>
          </div>
        )}
        {hud && (
          <div className="pointer-events-none absolute inset-0 text-white">
            {/* Filters. */}
            <div className="pointer-events-auto absolute left-8 right-8 top-5 flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-lg border border-cyan-200/15 bg-[#050a17]/60 px-3 py-2 backdrop-blur-md">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-cyan-300 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" /></span>
                <span className="whitespace-nowrap font-pixel text-[10px] uppercase tracking-[0.14em] text-cyan-100">Professor&apos;s Lab</span>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#050a17]/55 p-1 backdrop-blur-md">
                <button type="button" className="whitespace-nowrap rounded-md bg-white/[0.12] px-2.5 py-1 font-display text-[11px] font-semibold uppercase tracking-wider text-white">All types</button>
                {FILTER_TYPES.map((t) => (
                  <button key={t} type="button" className="flex items-center gap-1.5 rounded-md px-2 py-1 font-display text-[11px] font-semibold uppercase tracking-wider text-white/60 hover:text-white">
                    <span className="h-2 w-2 rounded-full" style={{ background: typeColor(t), boxShadow: `0 0 8px ${typeColor(t)}` }} />
                    {t}
                  </button>
                ))}
                <span className="px-1.5 font-display text-[11px] font-semibold uppercase tracking-wider text-white/40">+12</span>
              </div>
              <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-[#050a17]/55 p-1 backdrop-blur-md">
                <span className="px-2 font-pixel text-[9px] uppercase tracking-[0.14em] text-white/45">Gen</span>
                {GENS.map((g, i) => (
                  <button key={g} type="button" className={cn("min-w-[28px] rounded-md px-1.5 py-1 font-display text-[11px] font-bold tracking-wider", i === 0 ? "bg-cyan-300/90 text-[#04121c]" : "text-white/55")}>{g}</button>
                ))}
              </div>
              <div className="ml-auto flex h-9 w-60 items-center gap-2 rounded-lg border border-white/10 bg-[#050a17]/55 px-3 text-sm text-white/45 backdrop-blur-md">
                <Search className="h-4 w-4" />
                <span className="flex-1 whitespace-nowrap">Search 1,025 Pokémon</span>
                <kbd className="rounded border border-white/15 px-1.5 font-pixel text-[9px] text-white/50">/</kbd>
              </div>
            </div>

            {/* Who's on the table. */}
            {shot !== "wide" && (<>
            <div className="absolute left-10 top-[22%] w-[400px]">
              <div className="flex items-center gap-2">
                <span className="hud-label !text-cyan-200/80">Specimen</span>
                <span className="h-px w-8 bg-cyan-200/40" />
                <span className="font-pixel text-[11px] tracking-[0.14em] text-cyan-100">No.{String(e.id).padStart(4, "0")}</span>
                <span className="ml-2 rounded-sm border border-cyan-200/30 px-1.5 py-[3px] font-pixel text-[8px] uppercase tracking-[0.16em] text-cyan-200/80">{shot === "select" ? "Materialising…" : "Scan complete"}</span>
              </div>
              <h1 className="mt-3 font-display text-[68px] font-bold uppercase leading-[0.9] tracking-[0.01em] text-white [text-shadow:0_0_40px_rgba(0,0,0,0.6)]">{e.name}</h1>
              <p className="mt-2 text-[15px] font-medium text-white/70">{e.genus}</p>
              <div className="mt-4 flex gap-2">
                {e.types.map((t) => <TypeBadge key={t} type={t} size="lg" />)}
              </div>
              <div className={cn(panel, "mt-6 grid grid-cols-3 divide-x divide-cyan-200/10 px-1 py-3")}>
                {[["Height", `${e.heightM.toFixed(1)} m`], ["Weight", `${e.weightKg.toFixed(1)} kg`], ["Region", `Kanto · Gen ${GENS[e.gen - 1]}`]].map(([k, v]) => (
                  <div key={k} className="px-4">
                    <p className="hud-label !text-[9px]">{k}</p>
                    <p className="mt-1.5 font-display text-[15px] font-semibold text-white">{v}</p>
                  </div>
                ))}
              </div>
              {e.flavor && (
                <p className="mt-5 max-w-[360px] border-l-2 pl-4 text-[13.5px] leading-relaxed text-white/65" style={{ borderColor: col }}>{e.flavor}</p>
              )}
              {e.abilities.length > 0 && (
                <p className="mt-4 flex items-center gap-2 text-[12px] text-white/55">
                  <span className="hud-label !text-[9px]">Abilities</span>
                  {e.abilities.join(" · ")}
                </p>
              )}
            </div>

            {/* Base stats. */}
            <div className={cn(panel, "pointer-events-auto absolute right-10 top-[15%] w-[340px] p-5")}>
              <Corners />
              <div className="flex items-center justify-between">
                <p className="hud-label !text-cyan-200/80">Base stats</p>
                <p className="font-pixel text-[9px] uppercase tracking-[0.14em] text-white/40">Lv. 50 · neutral</p>
              </div>
              <div className="mt-1 flex justify-center">
                <Radar stats={e.stats} color={col} />
              </div>
              <div className="mt-2 space-y-[7px]">
                {e.stats.map((v, i) => (
                  <div key={i} className="grid grid-cols-[62px_34px_1fr] items-center gap-2">
                    <span className="font-pixel text-[9px] uppercase tracking-[0.12em] text-white/55">{STAT_LABELS[i]}</span>
                    <span className="text-right font-display text-[14px] font-bold tabular-nums text-white">{v}</span>
                    <span className="relative h-[7px] overflow-hidden rounded-full bg-white/[0.07]">
                      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (v / 160) * 100)}%`, background: `linear-gradient(90deg, ${col}99, ${col})`, boxShadow: `0 0 10px ${col}88` }} />
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-end justify-between border-t border-cyan-200/10 pt-3">
                <span className="hud-label">Total</span>
                <span className="font-display text-[30px] font-bold leading-none tabular-nums text-white">{total}</span>
              </div>
              <button type="button" className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-display text-sm font-semibold uppercase tracking-wider text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))]">
                Open in Pokédex <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            </>)}

            {/* The wheel. */}
            <div className="pointer-events-auto absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-4">
              <button type="button" className="group flex items-center gap-3 rounded-full border border-white/12 bg-[#050a17]/60 py-1.5 pl-1.5 pr-4 backdrop-blur-md" aria-label={`Previous: ${prev.name}`}>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10"><ChevronLeft className="h-5 w-5" /></span>
                <span className="text-left">
                  <span className="block font-pixel text-[8px] uppercase tracking-[0.14em] text-white/40">No.{String(prev.id).padStart(4, "0")}</span>
                  <span className="block font-display text-[13px] font-semibold uppercase tracking-wide text-white/80">{prev.name}</span>
                </span>
              </button>
              <div className="flex flex-col items-center gap-2 px-2">
                <div className="flex items-center gap-1.5">
                  {roster.map((r, i) => (
                    <span key={r.id} className={cn("h-1.5 rounded-full transition-all", i === selected ? "w-6" : "w-1.5 bg-white/25")} style={i === selected ? { background: col, boxShadow: `0 0 10px ${col}` } : undefined} />
                  ))}
                </div>
                <p className="font-pixel text-[9px] uppercase tracking-[0.16em] text-white/50">Drag or ← → to choose</p>
              </div>
              <button type="button" className="group flex items-center gap-3 rounded-full border border-white/12 bg-[#050a17]/60 py-1.5 pl-4 pr-1.5 backdrop-blur-md" aria-label={`Next: ${next.name}`}>
                <span className="text-right">
                  <span className="block font-pixel text-[8px] uppercase tracking-[0.14em] text-white/40">No.{String(next.id).padStart(4, "0")}</span>
                  <span className="block font-display text-[13px] font-semibold uppercase tracking-wide text-white/80">{next.name}</span>
                </span>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10"><ChevronRight className="h-5 w-5" /></span>
              </button>
            </div>
            <p className="absolute bottom-8 left-10 font-pixel text-[9px] uppercase tracking-[0.16em] text-white/35">{String(selected + 1).padStart(2, "0")} / {String(roster.length).padStart(2, "0")} · Kanto ring</p>
          </div>
        )}
      </div>
    </>
  );
}
