"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Minus, Pause, Pencil, Play, Plus, Share2, Sparkles, Undo2, X } from "lucide-react";
import { useT } from "@/i18n/client";
import { useLocale } from "@/i18n/navigation";
import { formatNumber } from "@/i18n/format";
import counter from "@/messages/shiny-counter";
import { shinyChance } from "@/lib/shiny-hunt/odds";
import { chanceByNow, clock, encountersFor, oddsMultiple, oneIn, perHour } from "@/lib/shiny-hunt/math";
import { COUNT_MAX, STEP_MAX, addCount, elapsed, isIdle, pause, phaseCount, removePhase, resume, setCount, setStep, undo, type Hunt, type Prefs } from "@/lib/shiny-hunt/store";
import { cn } from "@/lib/utils";
import { MonArt, Twinkles } from "./Art";
import { Setup, Stepper, Switch } from "./Setup";
import { buzz, clickSound } from "./feedback";
import type { Names } from "./names";

/** Re-renders every second while `on` (the hunt timer). */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

/** Keys that belong to whatever has focus: typing, a select, an open dialog. */
function keyIsTaken(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  // An open dialog (the site's own sheets stay in the page, inert, while closed).
  if (document.querySelector('[role="dialog"]:not([inert])')) return true;
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]');
}

export interface CounterProps {
  hunt: Hunt;
  names: Names;
  prefs: Prefs;
  /** Encounters added since the page opened (this visit). */
  visit: number;
  onChange(h: Hunt): void;
  onFound(): void;
  onShare(): void;
  onChangeTarget(): void;
  onPref(k: keyof Prefs, v: boolean): void;
}

/**
 * The hunt on screen: the target and its odds, the big number, the count button (in the stage on a wide screen, in a
 * dock in thumb reach on a phone), the live stats, the settings and the phases.
 */
export function Counter({ hunt, names, prefs, visit, onChange, onFound, onShare, onChangeTarget, onPref }: CounterProps) {
  const t = useT(counter);
  const locale = useLocale();
  const reduce = useReducedMotion();
  const running = hunt.runningSince !== null;
  const now = useNow(running);
  const p = shinyChance(hunt.game, hunt.method, hunt);
  const n = hunt.count;
  const chance = chanceByNow(p, n);
  const mult = oddsMultiple(p, n);
  const ms = elapsed(hunt, now);
  const rate = perHour(hunt.timedCount, ms);
  const idle = isIdle(hunt, now);
  const name = names.name(hunt.species);
  const fmt = (v: number, o?: Intl.NumberFormatOptions) => formatNumber(v, locale, o);
  const odds = t("counter.odds", { n: fmt(oneIn(p)) });

  // Feedback: the direction the digits roll and a ring per tap.
  const [dir, setDir] = useState(1);
  const [pulse, setPulse] = useState(0);
  const lastKey = useRef(0);
  const huntRef = useRef(hunt);
  huntRef.current = hunt;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const bump = useCallback(
    (delta: number) => {
      const h = huntRef.current;
      const next = addCount(h, delta);
      if (next === h) return;
      setDir(delta > 0 ? 1 : -1);
      if (delta > 0) setPulse((v) => v + 1);
      if (prefsRef.current.haptics) buzz(delta > 0 ? 10 : [6, 40, 6]);
      if (prefsRef.current.sound) clickSound(delta > 0);
      onChange(next);
    },
    [onChange]
  );
  const add = useCallback(() => bump(huntRef.current.step), [bump]);
  const sub = useCallback(() => bump(-huntRef.current.step), [bump]);
  const back = useCallback(() => {
    const h = huntRef.current;
    if (!h.undo.length) return;
    setDir(h.undo[h.undo.length - 1] >= h.count ? 1 : -1);
    onChange(undo(h));
  }, [onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || keyIsTaken(e.target)) return;
      const k = e.key;
      const onControl = !!(e.target as HTMLElement | null)?.closest?.("button, a, [role=radio], [role=switch]") && !(e.target as HTMLElement).closest("[data-count]");
      if (e.ctrlKey) {
        if (k.toLowerCase() === "z") {
          e.preventDefault();
          back();
        }
        return;
      }
      if (k === " " || k === "Spacebar" || (k === "Enter" && !onControl) || k === "+" || k === "=") {
        e.preventDefault();
        if (e.repeat && (k === " " || k === "Enter")) return;
        lastKey.current = Date.now();
        add();
      } else if (k === "-" || k === "_" || k === "Subtract") {
        e.preventDefault();
        sub();
      } else if (k === "z" || k === "Z" || k === "u" || k === "U") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [add, sub, back]);

  // A click the keyboard made (Space/Enter on the focused button) was already counted above.
  const onCountClick = (e: React.MouseEvent) => {
    if (e.detail === 0 && Date.now() - lastKey.current < 500) return;
    add();
  };

  const [editing, setEditing] = useState(false);

  const countButton = (big: boolean) => (
    <button
      type="button"
      onClick={onCountClick}
      data-count
      aria-label={t("counter.add", { n: hunt.step })}
      aria-keyshortcuts="Space Enter"
      className={cn("sh-count relative flex flex-1 items-center justify-center gap-2 rounded-[26px] font-display font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40", big ? "h-[104px] text-[44px]" : "h-[76px] text-[34px]")}
      data-testid={big ? "sh-add" : "sh-add-dock"}
    >
      {pulse > 0 && <span key={pulse} className="sh-ripple" aria-hidden />}
      <Plus className={big ? "h-9 w-9" : "h-7 w-7"} strokeWidth={3} aria-hidden />
      <span className="sh-num">{fmt(hunt.step)}</span>
    </button>
  );
  const sideButton = (kind: "sub" | "undo", big: boolean) => (
    <button
      type="button"
      onClick={kind === "sub" ? sub : back}
      disabled={kind === "sub" ? n === 0 : !hunt.undo.length}
      aria-label={kind === "sub" ? t("counter.subtract", { n: hunt.step }) : t("counter.undo")}
      title={kind === "sub" ? `${t("counter.subtract", { n: hunt.step })} (−)` : `${t("counter.undo")} (Z)`}
      aria-keyshortcuts={kind === "sub" ? "-" : "Z"}
      className={cn(
        "sh-side flex shrink-0 items-center justify-center rounded-[22px] bg-foreground/[0.07] text-foreground transition-colors hover:bg-foreground/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-foreground/[0.14] disabled:opacity-35",
        big ? "h-[104px] w-[92px]" : "h-[76px] w-[64px]"
      )}
      data-testid={`sh-${kind}${big ? "" : "-dock"}`}
    >
      {kind === "sub" ? <Minus className={big ? "h-8 w-8" : "h-6 w-6"} strokeWidth={2.6} aria-hidden /> : <Undo2 className={big ? "h-7 w-7" : "h-6 w-6"} strokeWidth={2.4} aria-hidden />}
    </button>
  );

  const stats = (ids: boolean) => (
    <>
        <section className={cn("grid grid-cols-2 gap-3", !ids && "sm:grid-cols-4")} data-testid={ids ? "sh-stats" : undefined}>
          <Stat label={t("stats.chance")} hint={t("stats.chanceHint")} value={fmt(chance, { style: "percent", maximumFractionDigits: chance > 0 && chance < 0.001 ? 2 : 1 })} testId={ids ? "sh-stat-chance" : undefined}>
            <Bar value={chance} />
          </Stat>
          <Stat label={t("stats.multiple")} hint={t("stats.multipleHint")} value={t("stats.multipleValue", { x: fmt(mult, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })} accent={mult >= 1} testId={ids ? "sh-stat-multiple" : undefined}>
            <Bar value={Math.min(1, mult / 3)} marks={[1 / 3, 2 / 3]} warm={mult >= 1} />
          </Stat>
          <Stat label={t("stats.perHour")} hint={t("stats.perHourHint")} value={rate === null ? t("stats.none") : fmt(Math.round(rate))} testId={ids ? "sh-stat-rate" : undefined} />
          <Stat
            label={t("stats.time")}
            hint={t("stats.timerHint")}
            value={clock(ms)}
            testId={ids ? "sh-stat-time" : undefined}
            action={
              <button
                type="button"
                onClick={() => onChange(running && !idle ? pause(hunt) : resume(hunt))}
                aria-label={running && !idle ? t("stats.pause") : t("stats.resume")}
                title={running && !idle ? t("stats.pause") : t("stats.resume")}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.06] text-foreground transition-colors hover:bg-foreground/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={ids ? "sh-timer" : undefined}
                data-running={running && !idle ? "1" : "0"}
              >
                {running && !idle ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4 translate-x-px" aria-hidden />}
              </button>
            }
          >
            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", running && !idle ? "bg-[hsl(var(--success))] motion-safe:animate-pulse" : "bg-foreground/25")} aria-hidden />
              {running ? (idle ? t("stats.idle") : t("stats.running")) : t("stats.paused")}
            </p>
          </Stat>
        </section>
        <p className="mt-3 px-1 text-center text-[13px] text-muted-foreground sm:text-left" data-testid={ids ? "sh-milestones" : undefined}>
          {t("stats.milestones", { half: fmt(half), ninety: fmt(ninety) })}
        </p>
    </>
  );

  const half = encountersFor(p, 0.5);
  const ninety = encountersFor(p, 0.9);
  const phaseN = hunt.phases.length + 1;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start" data-testid="sh-counter" data-count={n}>
      <div className="min-w-0 space-y-5">
        {/* The stage */}
        <section className="sh-stage relative overflow-hidden rounded-[28px] border border-foreground/[0.08] px-5 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-6" aria-label={t("counter.target")}>
          <div className="flex items-start justify-between gap-3">
            <button type="button" onClick={onChangeTarget} className="group -ml-2 flex min-w-0 items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={t("counter.change")} data-testid="sh-change-target">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06]">
                <MonArt id={hunt.species} shiny={false} size="sm" className="h-10 w-10" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-display text-[20px] font-semibold leading-tight tracking-tight sm:text-[22px]" data-testid="sh-target-name">{hunt.name || name}</span>
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 max-md:hidden" aria-hidden />
                  <span className="sr-only">{t("counter.change")}</span>
                </span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {t(`games.${hunt.game}`)} · {t(`methods.${hunt.method}`)}
                </span>
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="sh-num inline-flex h-9 items-center gap-1.5 rounded-full bg-[hsl(var(--warning)/0.14)] px-3 text-[14px] font-bold text-[hsl(var(--warning))] max-sm:hidden" data-testid="sh-odds">
                <Sparkles className="h-4 w-4" aria-hidden />
                {odds}
              </span>
              <button
                type="button"
                onClick={onFound}
                className="hidden h-9 items-center gap-1.5 rounded-full border border-[hsl(var(--warning)/0.5)] bg-[hsl(var(--warning)/0.12)] px-4 text-[14px] font-bold text-[hsl(var(--warning))] transition-colors hover:bg-[hsl(var(--warning)/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--warning))] lg:inline-flex"
                data-testid="sh-found"
              >
                <Sparkles className="h-4 w-4" aria-hidden /> {t("counter.foundIt")}
              </button>
              <button type="button" onClick={onShare} aria-label={t("share.button")} title={t("share.button")} className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 max-md:w-11" data-testid="sh-share">
                <Share2 className="h-[18px] w-[18px]" aria-hidden />
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-col items-center sm:mt-1">
            {/* The shiny, ringed by the chance of having seen it by now. */}
            <div className="relative h-[164px] w-[164px] sm:h-[200px] sm:w-[200px] lg:h-[176px] lg:w-[176px]">
              <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
                <circle cx="50" cy="50" r="47" fill="none" stroke="hsl(var(--foreground) / 0.07)" strokeWidth="2.2" />
                <circle cx="50" cy="50" r="47" fill="none" stroke="hsl(var(--warning))" strokeWidth="2.6" strokeLinecap="round" pathLength={1} strokeDasharray={`${Math.max(chance, n ? 0.004 : 0)} 1`} className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none" />
              </svg>
              <div className="absolute inset-[12%] rounded-full bg-[radial-gradient(closest-side,hsl(var(--warning)/0.22),transparent)]" aria-hidden />
              <div className="sh-float absolute inset-[10%]">
                <MonArt id={hunt.species} shiny eager alt={t("counter.shinyAlt", { name })} className="h-full w-full drop-shadow-[0_14px_18px_hsl(var(--shade)/0.35)]" />
              </div>
              <Twinkles />
            </div>

            {/* The number */}
            <div className="relative mt-1 flex h-[84px] items-center justify-center sm:h-[112px] lg:h-[104px]">
              {editing ? (
                <EditCount value={n} onDone={(v) => { if (v !== null) onChange(setCount(hunt, v)); setEditing(false); }} />
              ) : (
                <button type="button" onClick={() => setEditing(true)} className="group relative rounded-2xl px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={t("counter.edit")} data-testid="sh-count">
                  <span className="sr-only">{t("counter.edit")}: </span>
                  <span className="sh-num relative block overflow-hidden font-display text-[76px] font-bold leading-[1.05] tracking-tight sm:text-[104px] lg:text-[96px]" aria-hidden>
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.span
                        key={n}
                        className="block"
                        initial={reduce ? false : { y: dir > 0 ? "45%" : "-45%", opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={reduce ? undefined : { y: dir > 0 ? "-45%" : "45%", opacity: 0 }}
                        transition={{ type: "spring", stiffness: 700, damping: 40, mass: 0.6 }}
                      >
                        {fmt(n)}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  <span className="sr-only">{fmt(n)}</span>
                  <Pencil className="absolute -right-3 top-4 h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-md:hidden" aria-hidden />
                </button>
              )}
            </div>
            <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="sh-live">
              {t("counter.live", { n })}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[14px] text-muted-foreground">
              <span className="font-semibold uppercase tracking-[0.14em] text-[12px]">{t("counter.encounters", { n })}</span>
              {hunt.phases.length > 0 && (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] font-semibold text-primary" data-testid="sh-phase">
                  {t("counter.phase", { n: phaseN })} · {t("counter.phaseCount", { n: phaseCount(hunt) })}
                </span>
              )}
              {visit > 0 && <span className="text-[12px]">{t("counter.visit", { n: fmt(visit) })}</span>}
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 lg:hidden">
              <span className="sh-num inline-flex h-10 items-center gap-1.5 rounded-full bg-[hsl(var(--warning)/0.14)] px-3.5 text-[14px] font-bold text-[hsl(var(--warning))] sm:hidden" data-testid="sh-odds-phone">
                {odds}
              </span>
                <button
                  type="button"
                  onClick={onFound}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-[hsl(var(--warning)/0.5)] bg-[hsl(var(--warning)/0.12)] px-4 text-[14px] font-bold text-[hsl(var(--warning))] transition-colors hover:bg-[hsl(var(--warning)/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--warning))] lg:hidden"
                  data-testid="sh-found-phone"
                >
                  <Sparkles className="h-[18px] w-[18px]" aria-hidden /> {t("counter.foundIt")}
                </button>
            </div>

            {/* Wide screens: the controls right here. */}
            <div className="mt-5 hidden w-full max-w-[560px] items-stretch gap-3 lg:flex">
              {sideButton("sub", true)}
              {countButton(true)}
              {sideButton("undo", true)}
            </div>

            <div className="mt-4 flex w-full max-w-[560px] flex-wrap items-center justify-center gap-x-3 gap-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-muted-foreground">{t("counter.stepLabel")}</span>
                <Stepper value={hunt.step} min={1} max={STEP_MAX} onChange={(v) => onChange(setStep(hunt, v))} downLabel={t("counter.stepDown")} upLabel={t("counter.stepUp")} label={t("counter.stepLabel")} testId="sh-step" />
              </div>
            </div>
            <p className="mt-3 hidden text-[12px] text-muted-foreground lg:block">{t.rich("counter.keys", { k: (c) => <kbd className="rounded-md border border-foreground/15 bg-foreground/[0.05] px-1.5 py-0.5 font-sans text-[11px] font-semibold text-foreground/80">{c}</kbd> })}</p>
          </div>
        </section>

        <div className="lg:hidden">{stats(false)}</div>
      </div>

      {/* Settings and phases */}
      <div className="min-w-0 space-y-5">
        <div className="hidden lg:block">{stats(true)}</div>
        <section className="sh-panel rounded-[24px] border border-foreground/[0.08] p-5" aria-labelledby="sh-settings-title">
          <h2 id="sh-settings-title" className="mb-4 font-display text-[18px] font-semibold tracking-tight">{t("counter.settings")}</h2>
          <Setup hunt={hunt} onChange={onChange} />
          <div className="mt-5 grid gap-1.5 border-t border-foreground/[0.07] pt-5">
            <Switch on={prefs.sound} onChange={(v) => onPref("sound", v)} label={t("prefs.sound")} testId="sh-pref-sound" />
            <Switch on={prefs.haptics} onChange={(v) => onPref("haptics", v)} label={t("prefs.haptics")} testId="sh-pref-haptics" />
          </div>
          <p className="mt-5 text-[12px] leading-relaxed text-muted-foreground/80">{t("setup.source")}</p>
        </section>
        {hunt.phases.length > 0 && (
          <section className="sh-panel rounded-[24px] border border-foreground/[0.08] p-5" aria-labelledby="sh-phases-title" data-testid="sh-phases">
            <h2 id="sh-phases-title" className="mb-3 font-display text-[18px] font-semibold tracking-tight">{t("phases.title")}</h2>
            <ol className="space-y-1.5">
              {hunt.phases.map((ph, i) => (
                <li key={i} className="flex items-center gap-3 rounded-2xl bg-foreground/[0.035] py-1.5 pl-2 pr-1">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                    {ph.species ? <MonArt id={ph.species} shiny size="sm" className="h-10 w-10" /> : <Sparkles className="h-5 w-5 text-[hsl(var(--warning))]" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">
                      {t("counter.phase", { n: i + 1 })} · {ph.species ? names.name(ph.species) : t("phases.unknown")}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">{t("phases.row", { n: ph.at })}</span>
                  </span>
                  <button type="button" onClick={() => onChange(removePhase(hunt, i))} aria-label={t("phases.remove", { n: i + 1 })} title={t("phases.remove", { n: i + 1 })} className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      {/* Phones and tablets: the count controls in thumb reach, over the tab bar. */}
      <div className="h-[104px] lg:hidden" aria-hidden />
      <div className="sh-dock fixed inset-x-0 z-40 px-4 pt-3 lg:hidden" style={{ bottom: "var(--tabbar-h)", paddingBottom: "max(12px, calc(env(safe-area-inset-bottom) - var(--tabbar-h) + 12px))" }} data-testid="sh-dock">
        <div className="mx-auto flex max-w-[560px] items-stretch gap-2.5">
          {sideButton("sub", false)}
          {countButton(false)}
          {sideButton("undo", false)}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, children, action, accent, testId }: { label: string; value: string; hint: string; children?: ReactNode; action?: ReactNode; accent?: boolean; testId?: string }) {
  return (
    <div className="sh-panel relative flex min-w-0 flex-col rounded-[20px] border border-foreground/[0.08] p-4" title={hint} data-testid={testId}>
      <p className={cn("text-[12px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground", action && "pr-10")}>{label}</p>
      {action && <div className="absolute right-2.5 top-2.5">{action}</div>}
      <p className={cn("sh-num mt-1.5 truncate font-display text-[26px] font-bold leading-none tracking-tight", accent && "text-[hsl(var(--warning))]")} data-value>
        {value}
      </p>
      {children}
      <span className="sr-only">{hint}</span>
    </div>
  );
}

function Bar({ value, marks = [], warm }: { value: number; marks?: number[]; warm?: boolean }) {
  return (
    <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden>
      <div className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", warm ? "bg-[hsl(var(--warning))]" : "bg-primary")} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      {marks.map((m) => (
        <span key={m} className="absolute top-0 h-full w-px bg-background/70" style={{ left: `${m * 100}%` }} />
      ))}
    </div>
  );
}

/** The count, typed in. Enter saves, Escape cancels. */
function EditCount({ value, onDone }: { value: number; onDone(v: number | null): void }) {
  const t = useT(counter);
  const [text, setText] = useState(String(value));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const save = () => {
    const v = Number(text.replace(/\D/g, ""));
    onDone(text.trim() && Number.isFinite(v) ? Math.min(COUNT_MAX, v) : null);
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onDone(null);
          }
        }}
        inputMode="numeric"
        aria-label={t("counter.editLabel")}
        className="sh-num h-[76px] w-[min(62vw,300px)] rounded-2xl border border-primary/50 bg-background/70 text-center font-display text-[52px] font-bold outline-none focus:ring-4 focus:ring-primary/20"
        data-testid="sh-count-input"
      />
      <div className="flex flex-col gap-1.5">
        <button type="submit" className="h-9 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:brightness-110" data-testid="sh-count-save">
          {t("counter.save")}
        </button>
        <button type="button" onClick={() => onDone(null)} className="h-9 rounded-full bg-foreground/[0.07] px-4 text-[14px] font-semibold hover:bg-foreground/[0.11]">
          {t("counter.cancel")}
        </button>
      </div>
    </form>
  );
}
