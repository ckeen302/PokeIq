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
import { GameSwatch, MonArt } from "./Art";
import { ShinyStage } from "./Stage";
import { Setup, Stepper } from "./Setup";
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
  /** The hunt setup is open (above the stage). */
  setupOpen: boolean;
  onCloseSetup(): void;
}

/**
 * The hunt on screen: the setup (when open), the shiny on its stage with its odds, the big number, the count keys (beside
 * the stage on a wide screen, in a dock in thumb reach on a phone), the stats strip and the phases.
 */
export function Counter({ hunt, names, prefs, visit, onChange, onFound, onShare, onChangeTarget, onPref, setupOpen, onCloseSetup }: CounterProps) {
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
      className={cn("sh-count flex flex-1 items-center justify-center gap-1.5 rounded-[26px] font-display font-bold italic", big ? "h-[100px] text-[46px]" : "h-[72px] text-[34px]")}
      data-testid={big ? "sh-add" : "sh-add-dock"}
    >
      {pulse > 0 && <span key={pulse} className="sh-ripple" aria-hidden />}
      <Plus className={big ? "h-10 w-10" : "h-7 w-7"} strokeWidth={3.4} aria-hidden />
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
        "sh-side flex shrink-0 items-center justify-center rounded-[22px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
        big ? "h-[100px] w-[84px]" : "h-[72px] w-[60px]"
      )}
      data-testid={`sh-${kind}${big ? "" : "-dock"}`}
    >
      {kind === "sub" ? <Minus className={big ? "h-8 w-8" : "h-6 w-6"} strokeWidth={2.8} aria-hidden /> : <Undo2 className={big ? "h-7 w-7" : "h-6 w-6"} strokeWidth={2.5} aria-hidden />}
    </button>
  );

  const half = encountersFor(p, 0.5);
  const ninety = encountersFor(p, 0.9);
  const phaseN = hunt.phases.length + 1;
  const timerOn = running && !idle;
  const digits = fmt(n).length;
  const size = digits <= 5 ? "text-[80px] lg:text-[124px]" : digits <= 7 ? "text-[72px] lg:text-[104px]" : "text-[58px] lg:text-[88px]";

  return (
    <div data-testid="sh-counter" data-count={n}>
      {setupOpen && (
        <section id="sh-setup-panel" className="sh-open mb-5 rounded-[26px] border border-foreground/[0.08] bg-card p-5 shadow-[0_20px_50px_-36px_hsl(var(--shade)/0.9)] sm:p-6" aria-labelledby="sh-setup-title">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 id="sh-setup-title" className="font-display text-[20px] font-bold tracking-tight">{t("counter.settings")}</h2>
            <button type="button" onClick={onCloseSetup} className="inline-flex h-10 items-center rounded-full bg-foreground px-5 text-[14px] font-bold text-background transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="sh-setup-done">
              {t("setup.done")}
            </button>
          </div>
          <Setup hunt={hunt} onChange={onChange} prefs={prefs} onPref={onPref} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.06fr)_minmax(0,1fr)] lg:gap-5">
        {/* The stage: the shiny, lit in its own colours, ringed by the chance of having seen it by now. */}
        <ShinyStage
          id={hunt.species}
          type={names.type(hunt.species)}
          chance={chance}
          pulse={pulse}
          alt={t("counter.shinyAlt", { name })}
          className="flex flex-col justify-center rounded-[30px] px-4 pb-5 pt-[54px] lg:min-h-[560px] lg:pb-6 lg:pt-[72px]"
          figureClassName="w-[min(54vw,212px)] sm:w-[340px] lg:w-[min(410px,86%)]"
          testId="sh-stage"
        >
          <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3 lg:p-4">
            <button type="button" onClick={onChangeTarget} className="group flex min-w-0 items-center gap-2.5 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" title={t("counter.change")} data-testid="sh-change-target">
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate font-display text-[22px] font-bold leading-tight tracking-tight text-white [text-shadow:0_2px_10px_rgb(0_0_0/0.5)] lg:text-[26px]" data-testid="sh-target-name">{hunt.name || name}</span>
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-white/50 transition-colors group-hover:text-white" aria-hidden />
                  <span className="sr-only">{t("counter.change")}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-white/65 max-sm:hidden">
                  <GameSwatch game={hunt.game} className="h-3.5 w-3.5" />
                  <span className="truncate">{t(`games.${hunt.game}`)} · {t(`methods.${hunt.method}`)}</span>
                </span>
              </span>
            </button>
            <button type="button" onClick={onShare} aria-label={t("share.button")} title={t("share.button")} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-white/80 ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-white/[0.14] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="sh-share">
              <Share2 className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </div>
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-3 lg:p-4">
            <span className="sh-num inline-flex h-10 items-center gap-1.5 rounded-full bg-black/35 px-3.5 text-[14px] font-bold text-[#ffd75e] ring-1 ring-[#ffd75e]/35 backdrop-blur" title={t("setup.yourOdds")} data-testid="sh-odds">
              <Sparkles className="h-4 w-4" aria-hidden />
              {odds}
            </span>
            <button type="button" onClick={onFound} className="sh-gold inline-flex h-11 items-center gap-2 rounded-full px-5 font-display text-[15px] font-bold uppercase italic tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80" data-testid="sh-found">
              <Sparkles className="h-[18px] w-[18px]" aria-hidden /> {t("counter.foundIt")}
            </button>
          </div>
        </ShinyStage>

        {/* The count, its stats, and (on a wide screen) the keys. */}
        <section className="flex min-w-0 flex-col justify-center lg:rounded-[30px] lg:border lg:border-foreground/[0.08] lg:bg-card lg:px-8 lg:py-6 lg:shadow-[0_24px_60px_-40px_hsl(var(--shade)/0.9)]" aria-label={t("counter.target")}>
          <div className="flex flex-col items-center">
            <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              {t("counter.encounters", { n })}
              {visit > 0 && <span className="sh-num rounded-full bg-[hsl(var(--success)/0.14)] px-2 py-0.5 text-[11px] tracking-normal text-[hsl(var(--success))]">{t("counter.visit", { n: fmt(visit) })}</span>}
            </p>
            <div className="relative flex h-[86px] items-center justify-center lg:h-[134px]">
              {editing ? (
                <EditCount value={n} onDone={(v) => { if (v !== null) onChange(setCount(hunt, v)); setEditing(false); }} />
              ) : (
                <button type="button" onClick={() => setEditing(true)} className="group relative rounded-3xl px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={t("counter.edit")} data-testid="sh-count">
                  <span className="sr-only">{t("counter.edit")}: </span>
                  <span className={cn("sh-num relative block overflow-hidden font-display font-bold leading-[1.08] tracking-[-0.03em]", size)} aria-hidden>
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.span
                        key={n}
                        className="block bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent"
                        initial={reduce ? false : { y: dir > 0 ? "50%" : "-50%", opacity: 0, scale: 0.92 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={reduce ? undefined : { y: dir > 0 ? "-50%" : "50%", opacity: 0 }}
                        transition={{ type: "spring", stiffness: 720, damping: 38, mass: 0.6 }}
                      >
                        {fmt(n)}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  <span className="sr-only">{fmt(n)}</span>
                  {pulse > 0 && (
                    <span key={pulse} className="sh-plus sh-num -right-2 top-2 font-display text-[22px] font-bold italic text-primary lg:text-[28px]" aria-hidden>
                      +{fmt(hunt.step)}
                    </span>
                  )}
                  <Pencil className="absolute -right-4 bottom-4 h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-md:hidden" aria-hidden />
                </button>
              )}
            </div>
            <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="sh-live">
              {t("counter.live", { n })}
            </p>
            {hunt.phases.length > 0 && (
              <span className="sh-num mt-0.5 rounded-full bg-primary/10 px-3 py-1 text-[12.5px] font-semibold text-primary" data-testid="sh-phase">
                {t("counter.phase", { n: phaseN })} · {t("counter.phaseCount", { n: phaseCount(hunt) })}
              </span>
            )}
          </div>

          {/* The stats: one tight strip. */}
          <dl className="mt-4 grid grid-cols-4 divide-x divide-foreground/[0.08] rounded-[20px] border border-foreground/[0.08] bg-foreground/[0.025] py-3 lg:mt-5" data-testid="sh-stats">
            <Stat label={t("stats.chance")} hint={t("stats.chanceHint")} value={fmt(chance, { style: "percent", maximumFractionDigits: chance > 0 && chance < 0.001 ? 2 : 1 })} bar={chance} testId="sh-stat-chance" />
            <Stat label={t("stats.multiple")} hint={t("stats.multipleHint")} value={t("stats.multipleValue", { x: fmt(mult, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })} bar={Math.min(1, mult / 3)} warm={mult >= 1} testId="sh-stat-multiple" />
            <Stat label={t("stats.perHour")} hint={t("stats.perHourHint")} value={rate === null ? t("stats.none") : fmt(Math.round(rate))} testId="sh-stat-rate" />
            <Stat
              label={t("stats.time")}
              hint={t("stats.timerHint")}
              value={clock(ms)}
              testId="sh-stat-time"
              status={
                <button
                  type="button"
                  onClick={() => onChange(timerOn ? pause(hunt) : resume(hunt))}
                  aria-label={timerOn ? t("stats.pause") : t("stats.resume")}
                  title={timerOn ? t("stats.pause") : t("stats.resume")}
                  className="sh-tap -my-1 inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:h-9"
                  data-testid="sh-timer"
                  data-running={timerOn ? "1" : "0"}
                >
                  {timerOn ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                  <span className={cn("h-1.5 w-1.5 rounded-full", timerOn ? "bg-[hsl(var(--success))] motion-safe:animate-pulse" : "bg-foreground/25")} aria-hidden />
                  <span className="max-sm:sr-only">{running ? (idle ? t("stats.idle") : t("stats.running")) : t("stats.paused")}</span>
                </button>
              }
            />
          </dl>
          <p className="mt-2.5 text-center text-[12.5px] text-muted-foreground" data-testid="sh-milestones">
            {t("stats.milestones", { half: fmt(half), ninety: fmt(ninety) })}
          </p>

          {/* Wide screens: the keys right here. */}
          <div className="mt-5 hidden w-full items-start gap-3 pb-[7px] lg:flex">
            {sideButton("sub", true)}
            {countButton(true)}
            {sideButton("undo", true)}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 lg:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-muted-foreground">{t("counter.stepLabel")}</span>
              <Stepper value={hunt.step} min={1} max={STEP_MAX} onChange={(v) => onChange(setStep(hunt, v))} downLabel={t("counter.stepDown")} upLabel={t("counter.stepUp")} label={t("counter.stepLabel")} testId="sh-step" />
            </div>
            <p className="hidden text-[12px] text-muted-foreground lg:block">{t.rich("counter.keys", { k: (c) => <kbd className="rounded-md border border-foreground/15 bg-foreground/[0.05] px-1.5 py-0.5 font-sans text-[11px] font-semibold text-foreground/80 shadow-[0_1px_0_hsl(var(--foreground)/0.15)]">{c}</kbd> })}</p>
          </div>
        </section>
      </div>

      {/* Phases: the other shinies found along the way. */}
      {hunt.phases.length > 0 && (
        <section className="mt-5" aria-labelledby="sh-phases-title" data-testid="sh-phases">
          <h2 id="sh-phases-title" className="mb-2.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("phases.title")}</h2>
          <ol className="flex flex-wrap gap-2">
            {hunt.phases.map((ph, i) => (
              <li key={i} className="flex items-center gap-2.5 rounded-full border border-foreground/[0.08] bg-card py-1 pl-1 pr-1">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.05]">
                  {ph.species ? <MonArt id={ph.species} shiny size="sm" className="h-9 w-9" /> : <Sparkles className="h-5 w-5 text-[hsl(var(--warning))]" aria-hidden />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold leading-tight">
                    {t("counter.phase", { n: i + 1 })} · {ph.species ? names.name(ph.species) : t("phases.unknown")}
                  </span>
                  <span className="sh-num block text-[12px] text-muted-foreground">{t("phases.row", { n: ph.at })}</span>
                </span>
                <button type="button" onClick={() => onChange(removePhase(hunt, i))} aria-label={t("phases.remove", { n: i + 1 })} title={t("phases.remove", { n: i + 1 })} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Phones and tablets: the count keys in thumb reach, over the tab bar. */}
      <div className="h-[112px] lg:hidden" aria-hidden />
      <div className="sh-dock fixed inset-x-0 z-40 px-4 pt-3 lg:hidden" style={{ bottom: "var(--tabbar-h)", paddingBottom: "max(14px, calc(env(safe-area-inset-bottom) - var(--tabbar-h) + 14px))" }} data-testid="sh-dock">
        <div className="mx-auto flex max-w-[560px] items-start gap-2.5 pb-[5px]">
          {sideButton("sub", false)}
          {countButton(false)}
          {sideButton("undo", false)}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, bar, warm, status, testId }: { label: string; value: string; hint: string; bar?: number; warm?: boolean; status?: ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center px-1.5 text-center sm:px-3" title={hint} data-testid={testId}>
      <dt className="text-[10.5px] font-bold uppercase leading-[1.15] tracking-[0.08em] text-muted-foreground sm:text-[11px] sm:tracking-[0.12em]">{label}</dt>
      <dd className="mt-1 flex w-full flex-col items-center">
        <span className={cn("sh-num truncate font-display text-[19px] font-bold leading-tight tracking-tight sm:text-[24px]", warm && "text-[hsl(var(--warning))]")} data-value>
          {value}
        </span>
        {bar !== undefined && (
          <span className="relative mt-1.5 block h-1 w-[70%] overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden>
            <span className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 motion-reduce:transition-none", warm ? "bg-[hsl(var(--warning))]" : "bg-gradient-to-r from-[#ffc93c] to-primary")} style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }} />
          </span>
        )}
        {status && <span className="mt-1">{status}</span>}
        <span className="sr-only">{hint}</span>
      </dd>
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
