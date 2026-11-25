"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus, Share2, Trophy, X } from "lucide-react";
import { useT } from "@/i18n/client";
import { useLocale } from "@/i18n/navigation";
import { INTL_LOCALE, formatNumber } from "@/i18n/format";
import counter from "@/messages/shiny-counter";
import { shinyChance } from "@/lib/shiny-hunt/odds";
import { clock, oneIn } from "@/lib/shiny-hunt/math";
import type { Hunt } from "@/lib/shiny-hunt/store";
import { MonArt, Sparkle } from "./Art";
import { fanfare } from "./feedback";
import type { Names } from "./names";

const GOLD = ["#f6c94a", "#ffe9a3", "#ffffff", "#f1417c", "#a47efb"];

/**
 * The shiny is found: a flash, the shiny on slow gold rays with sparkles and confetti (none of the motion under
 * reduced motion), and the hunt's numbers, with what to do next.
 */
export function Celebrate({ hunt, names, sound, onClose, onShare, onTrophies, onNew, onUndo }: { hunt: Hunt; names: Names; sound: boolean; onClose(): void; onShare(): void; onTrophies(): void; onNew(): void; onUndo(): void }) {
  const t = useT(counter);
  const locale = useLocale();
  const name = names.name(hunt.species);
  const f = hunt.found ?? { date: Date.now(), count: hunt.count, timeMs: hunt.timeMs };
  const p = shinyChance(hunt.game, hunt.method, hunt);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
      if (e.key === "Tab" && panel.current) {
        const all = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
        const i = all.indexOf(document.activeElement as HTMLElement);
        const to = e.shiftKey && i <= 0 ? all[all.length - 1] : !e.shiftKey && i === all.length - 1 ? all[0] : null;
        if (to) {
          e.preventDefault();
          to.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      html.style.overflow = prev;
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (sound) fanfare();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let live = true;
    const timers: number[] = [];
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (!live) return;
      const fire = (o: Parameters<typeof confetti>[0]) => confetti({ colors: GOLD, disableForReducedMotion: true, zIndex: 120, ...o });
      fire({ particleCount: 90, spread: 90, startVelocity: 42, origin: { y: 0.42 }, shapes: ["star", "circle"], scalar: 1.1 });
      timers.push(window.setTimeout(() => fire({ particleCount: 50, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, shapes: ["star"] }), 350));
      timers.push(window.setTimeout(() => fire({ particleCount: 50, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, shapes: ["star"] }), 500));
    });
    return () => {
      live = false;
      timers.forEach((x) => window.clearTimeout(x));
    };
  }, [sound]);

  const date = new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "medium" }).format(new Date(f.date));
  const stats = [
    { label: t("found.encounters"), value: formatNumber(f.count, locale) },
    { label: t("found.time"), value: clock(f.timeMs) },
    { label: t("found.odds"), value: t("counter.odds", { n: formatNumber(oneIn(p), locale) }) },
    { label: t("found.phases"), value: formatNumber(hunt.phases.length, locale) },
  ];

  return createPortal(
    <div className="dark-scope fixed inset-0 z-[90] overflow-y-auto overscroll-contain bg-[hsl(246_42%_4%/0.94)] text-foreground backdrop-blur-md" data-testid="sh-celebrate">
      <div className="sh-flash pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_35%,#fff8dc,transparent_65%)]" aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="sh-cel-title" className="relative mx-auto flex min-h-full w-full max-w-xl flex-col items-center px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))] text-center">
        <button type="button" onClick={onClose} aria-label={t("found.close")} title={t("found.close")} className="absolute right-3 top-[max(12px,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <X className="h-5 w-5" aria-hidden />
        </button>
        <p className="sh-rise mt-8 font-display text-[13px] font-bold uppercase tracking-[0.28em] text-[#f6c94a] sm:mt-10">{t("found.title")}</p>

        <div className="relative my-2 h-[min(330px,42svh)] w-[min(330px,42svh)] min-h-[220px] min-w-[220px]">
          <div className="sh-rays absolute -inset-[35%] rounded-full" aria-hidden />
          <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(closest-side,rgba(246,201,74,0.45),rgba(246,201,74,0.08)_60%,transparent)]" aria-hidden />
          <div className="sh-pop absolute inset-[6%]">
            <MonArt id={hunt.species} shiny eager alt={t("counter.shinyAlt", { name })} className="h-full w-full drop-shadow-[0_24px_30px_rgba(0,0,0,0.55)]" />
          </div>
          {[
            ["4%", "10%", 34, 0],
            ["14%", "84%", 24, 0.5],
            ["70%", "2%", 20, 1],
            ["78%", "88%", 30, 1.4],
            ["-4%", "54%", 16, 1.8],
            ["46%", "96%", 14, 2.2],
          ].map(([top, left, size, delay], i) => (
            <Sparkle key={i} className="sh-star text-[#f6c94a]" style={{ top: top as string, left: left as string, width: size as number, height: size as number, animationDelay: `${delay}s` }} />
          ))}
        </div>

        <h2 id="sh-cel-title" className="sh-rise font-display text-[40px] font-bold leading-[1.05] tracking-tight sm:text-[52px]" style={{ animationDelay: "120ms" }} data-testid="sh-cel-title">
          {t("found.headline", { name })}
        </h2>
        <p className="sh-rise mt-2 text-[16px] text-white/70" style={{ animationDelay: "180ms" }}>
          {t("found.after", { n: f.count })} · {date}
        </p>
        <p className="sh-rise mt-1 text-[14px] text-white/55" style={{ animationDelay: "200ms" }}>
          {t(`games.${hunt.game}`)} · {t(`methods.${hunt.method}`)}
        </p>

        <dl className="sh-rise mt-6 grid w-full grid-cols-2 gap-2.5 sm:grid-cols-4" style={{ animationDelay: "260ms" }}>
          {stats.map((s, i) => (
            <div key={s.label} className="rounded-2xl border border-white/[0.08] bg-white/[0.05] px-3 py-3">
              <dt className="text-[11.5px] font-semibold uppercase tracking-wider text-white/55">{s.label}</dt>
              <dd className={`sh-num mt-1 truncate font-display text-[22px] font-bold ${i === 0 ? "text-[#f6c94a]" : "text-white"}`}>{s.value}</dd>
            </div>
          ))}
        </dl>

        <div className="sh-rise mt-6 grid w-full gap-2.5 sm:grid-cols-3" style={{ animationDelay: "320ms" }}>
          <button type="button" onClick={onShare} data-autofocus className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#f6c94a] px-5 text-[15px] font-bold text-[#1d1606] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f6c94a]/40" data-testid="sh-cel-share">
            <Share2 className="h-4 w-4" aria-hidden /> {t("found.share")}
          </button>
          <button type="button" onClick={onTrophies} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white/10 px-5 text-[15px] font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="sh-cel-trophies">
            <Trophy className="h-4 w-4" aria-hidden /> {t("found.trophies")}
          </button>
          <button type="button" onClick={onNew} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white/10 px-5 text-[15px] font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="sh-cel-new">
            <Plus className="h-4 w-4" aria-hidden /> {t("found.newHunt")}
          </button>
        </div>
        <button type="button" onClick={onUndo} className="mt-5 min-h-11 rounded-full px-4 text-[14px] text-white/55 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="sh-cel-undo">
          {t("found.notIt")}
        </button>
      </div>
    </div>,
    document.body
  );
}
