"use client";

import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookCheck, BookOpen, ChevronsUp, Eye, Fish, Heart, Hourglass, Medal, Minus, Moon, Mountain, Plus, SlidersHorizontal, Sparkles, Sprout, Waves, X, Zap } from "lucide-react";
import { useT } from "@/i18n/client";
import msgs from "@/messages/catch-rate";
import { badgePenalty, ballsIn, hasPower, type BallId } from "@/lib/catch-rate/formula";
import { MAX_DEX, MAX_LEVEL, MAX_TURN, type Inputs } from "@/lib/catch-rate/link";
import type { Ranking } from "@/lib/catch-rate/rank";
import { cn } from "@/lib/utils";
import { BallArt } from "./BallArt";

type T = ReturnType<typeof useT<typeof msgs.en>>;
type Icon = ComponentType<{ className?: string }>;
export type DarkKind = "night" | "cave";

interface Toggle {
  key: string;
  on: boolean;
  set(v: boolean): void;
  label: string;
  icon: Icon;
  balls: BallId[];
  testId: string;
  /** Shown as an icon in the summary when on. */
  tint: string;
}

/** The switches that matter in this game, in the order the sheet shows them. */
function toggles(r: Ranking, i: Inputs, set: (p: Partial<Inputs>) => void, kind: DarkKind, setKind: (k: DarkKind) => void, t: T): Toggle[] {
  const have = new Set(ballsIn(r.game));
  const g = r.game.gen;
  // Fishing is its own switch where a Lure Ball needs it (it counts for the Dive Ball too); Scarlet & Violet's Lure Ball goes by water like the Dive Ball.
  const fishing = have.has("lure") && g <= 8;
  const waterLabel = g === 3 ? t("situation.waterOld") : g === 9 ? t("situation.waterSv") : fishing ? t("situation.waterNoFish") : t("situation.water");
  const out: (Toggle | false)[] = [
    have.has("dusk") && {
      key: "night",
      on: i.dark && kind === "night",
      set: (v) => (setKind("night"), set({ dark: v || (i.dark && kind !== "night") })),
      label: t("situation.night"),
      icon: Moon,
      balls: ["dusk"],
      testId: "cr-dark",
      tint: "#9b8cff",
    },
    have.has("dusk") && {
      key: "cave",
      on: i.dark && kind === "cave",
      set: (v) => (setKind("cave"), set({ dark: v || (i.dark && kind !== "cave") })),
      label: t("situation.cave"),
      icon: Mountain,
      balls: ["dusk"],
      testId: "cr-cave",
      tint: "#c79a6a",
    },
    { key: "water", on: i.water, set: (v) => set({ water: v }), label: waterLabel, icon: Waves, balls: g === 9 && have.has("lure") ? ["dive", "lure"] : ["dive"], testId: "cr-water", tint: "#4fb6ff" },
    fishing && { key: "fishing", on: i.fishing, set: (v) => set({ fishing: v }), label: t("situation.fishing"), icon: Fish, balls: ["lure", "dive"], testId: "cr-fishing", tint: "#4fb6ff" },
    { key: "caught", on: i.caught, set: (v) => set({ caught: v }), label: t("situation.caught"), icon: BookCheck, balls: ["repeat"], testId: "cr-caught", tint: "#ff7a7a" },
    have.has("love") && { key: "love", on: i.loveMatch, set: (v) => set({ loveMatch: v }), label: t("situation.loveMatch"), icon: Heart, balls: ["love"], testId: "cr-love", tint: "#ff7ab8" },
    g >= 8 && { key: "charm", on: i.charm, set: (v) => set({ charm: v }), label: t("trainer.charm"), icon: Sparkles, balls: [], testId: "cr-charm", tint: "#ffd34d" },
    g === 9 && { key: "off", on: i.offGuard, set: (v) => set({ offGuard: v }), label: t("trainer.offGuard"), icon: Eye, balls: [], testId: "cr-off-guard", tint: "#7ee0b0" },
    g === 5 && { key: "grass", on: i.darkGrass, set: (v) => set({ darkGrass: v }), label: t("trainer.darkGrass"), icon: Sprout, balls: [], testId: "cr-dark-grass", tint: "#5fcf6a" },
  ];
  return out.filter((x): x is Toggle => !!x);
}

function ToggleTile({ tg }: { tg: Toggle }) {
  const I = tg.icon;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={tg.on}
      onClick={() => tg.set(!tg.on)}
      className={cn(
        "group relative flex min-h-[64px] w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left text-[13.5px] font-medium leading-snug transition-[background-color,border-color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tg.on ? "border-transparent bg-primary/[0.12] text-foreground ring-2 ring-inset ring-primary/60" : "border-foreground/[0.09] bg-foreground/[0.025] text-foreground/85 hover:border-foreground/[0.18]"
      )}
      data-testid={tg.testId}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors", tg.on ? "text-white" : "bg-foreground/[0.06] text-muted-foreground")} style={tg.on ? { background: tg.tint } : undefined} aria-hidden>
        <I className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">{tg.label}</span>
      {tg.balls.length > 0 && (
        <span className="flex shrink-0 -space-x-1.5" aria-hidden>
          {tg.balls.map((b) => (
            <BallArt key={b} id={b} size={20} />
          ))}
        </span>
      )}
    </button>
  );
}

function StepTile({ icon: I, label, hint, value, min, max, onChange, down, up, testId, step = 1, balls = [] }: { icon: Icon; label: string; hint?: string; value: number; min: number; max: number; onChange(v: number): void; down: string; up: string; testId: string; step?: number; balls?: BallId[] }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const btn = "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.07] text-foreground transition-colors hover:bg-foreground/[0.12] active:scale-95 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-foreground/[0.09] bg-foreground/[0.025] px-3 py-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.06] text-muted-foreground" aria-hidden>
        <I className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug">
        <span className="flex items-center gap-2">
          {label}
          {balls.length > 0 && (
            <span className="flex -space-x-1.5" aria-hidden>
              {balls.map((b) => (
                <BallArt key={b} id={b} size={16} />
              ))}
            </span>
          )}
        </span>
        {hint && <span className="mt-0.5 block text-[11.5px] font-normal text-muted-foreground">{hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" className={btn} onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={down} data-testid={`${testId}-down`}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          aria-label={label}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && e.target.value !== "") onChange(clamp(Math.round(v)));
          }}
          className={cn("h-10 rounded-lg bg-transparent text-center font-display text-[19px] font-bold tabular-nums outline-none [appearance:textfield] focus:bg-foreground/[0.06] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", max >= 1000 ? "w-[58px]" : "w-11")}
          data-testid={testId}
        />
        <button type="button" className={btn} onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={up} data-testid={`${testId}-up`}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </span>
    </div>
  );
}

function Group({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
        {aside}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export interface SituationProps {
  r: Ranking;
  inputs: Inputs;
  set(p: Partial<Inputs>): void;
  kind: DarkKind;
  setKind(k: DarkKind): void;
}

/** The button under the scene that opens the situation: the turn and whatever is switched on, as icons. */
export function SituationButton({ r, inputs, set, kind, setKind, open, onOpen }: SituationProps & { open: boolean; onOpen(): void }) {
  const t = useT(msgs);
  const on = toggles(r, inputs, set, kind, setKind, t).filter((x) => x.on);
  const penalty = r.game.gen >= 8 ? badgePenalty(r.game, r.target, inputs) : 1;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      aria-controls="cr-situation"
      className="group flex h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-foreground/[0.09] bg-card px-3 text-left shadow-[0_10px_30px_-24px_hsl(var(--shade)/0.8)] transition-colors hover:border-foreground/[0.2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="cr-situation-open"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.12] text-primary max-[400px]:hidden" aria-hidden>
        <SlidersHorizontal className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 shrink-0 text-[14px] font-semibold">{t("situation.label")}</span>
      {/* The summary sits on the right; when it doesn't fit, its last icons are cut, never the turn. */}
      <span className="flex min-w-0 flex-1 overflow-hidden">
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground/[0.07] px-2 py-1 text-[12px] font-semibold tabular-nums text-foreground/80">
          <Hourglass className="h-3 w-3" aria-hidden />
          {t("why.timerOn", { n: inputs.turn })}
        </span>
        {penalty < 1 && <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-1 text-[12px] font-semibold tabular-nums text-destructive">×{new Intl.NumberFormat(t.locale, { maximumFractionDigits: 2 }).format(penalty)}</span>}
        {on.map((x) => {
          const I = x.icon;
          return (
            <span key={x.key} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ring-2 ring-card [&+&]:-ml-3" style={{ background: x.tint }} title={x.label}>
              <I className="h-3.5 w-3.5" aria-hidden />
            </span>
          );
        })}
        </span>
      </span>
    </button>
  );
}

/**
 * The situation: the turn, the time and place, and from Generation 5 on your Pokédex and progress. Only what a ball or
 * rule in the chosen game cares about. On a phone it's a sheet from the bottom; on a wide screen it rises over the
 * bottom of the scene, so the backdrop changes in view.
 */
export function SituationSheet({ r, inputs, set, kind, setKind, open, onClose }: SituationProps & { open: boolean; onClose(): void }) {
  const t = useT(msgs);
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const g = r.game.gen;
  const have = new Set(ballsIn(r.game));
  const f = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 2 });
  const penalty = badgePenalty(r.game, r.target, inputs);
  const powerName = g === 5 ? t("trainer.powerBw") : g === 6 ? t("trainer.powerXy") : t("trainer.powerSv");
  const list = toggles(r, inputs, set, kind, setKind, t);
  const battle = list.filter((x) => !["charm", "off", "grass"].includes(x.key));
  const yours = list.filter((x) => ["charm", "off", "grass"].includes(x.key));

  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="shade" className="fixed inset-0 z-[55] bg-black/50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.div
            key="sheet"
            ref={panel}
            id="cr-situation"
            role="dialog"
            aria-labelledby="cr-situation-title"
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 48 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 48 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[60] flex max-h-[86svh] flex-col rounded-t-[28px] border border-foreground/[0.1] bg-card shadow-[0_-24px_60px_-12px_rgb(0_0_0/0.5)] outline-none",
              "lg:absolute lg:inset-x-3 lg:bottom-[76px] lg:z-30 lg:max-h-[min(500px,calc(100%-110px))] lg:rounded-[24px] lg:bg-card/[0.97] lg:backdrop-blur-xl"
            )}
            data-testid="cr-situation"
          >
            <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-foreground/15 lg:hidden" aria-hidden />
            <div className="flex shrink-0 items-start gap-3 px-4 pb-2 pt-3 lg:px-5 lg:pt-4">
              <div className="min-w-0 flex-1">
                <h2 id="cr-situation-title" className="font-display text-[20px] font-bold tracking-tight">
                  {t("situation.label")}
                </h2>
                <p className="text-[12.5px] text-muted-foreground">{t("situation.hint")}</p>
              </div>
              <button type="button" onClick={onClose} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card" data-testid="cr-situation-done">
                <X className="h-4 w-4 sm:hidden" aria-hidden />
                <span className="max-sm:sr-only">{t("situation.done")}</span>
              </button>
            </div>
            <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2 lg:px-5 lg:pb-5">
              <Group title={t("situation.battle")}>
                <StepTile icon={Hourglass} label={t("situation.turn")} value={inputs.turn} min={1} max={MAX_TURN} onChange={(turn) => set({ turn })} down={t("situation.turnDown")} up={t("situation.turnUp")} testId="cr-turn" balls={(["quick", "timer"] as const).filter((b) => have.has(b))} />
                {(have.has("level") || (g === 8 && inputs.badges < 8)) && (
                  <StepTile icon={ChevronsUp} label={t("situation.yourLevel")} value={inputs.yourLevel} min={1} max={MAX_LEVEL} onChange={(yourLevel) => set({ yourLevel })} down={t("level.down")} up={t("level.up")} testId="cr-you" balls={have.has("level") ? ["level"] : []} />
                )}
                {battle.map((x) => (
                  <ToggleTile key={x.key} tg={x} />
                ))}
              </Group>
              {g >= 5 && (
                <Group
                  title={t("trainer.label")}
                  aside={
                    penalty < 1 ? (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11.5px] font-semibold text-destructive" data-testid="cr-penalty">
                        {t(g === 8 ? "trainer.swshPenalty" : "trainer.badgePenalty", { n: f.format(penalty) })}
                      </span>
                    ) : null
                  }
                >
                  <StepTile icon={BookOpen} label={t("trainer.dex")} hint={t("trainer.dexHint")} value={inputs.dex} min={0} max={MAX_DEX} onChange={(dex) => set({ dex })} down={t("trainer.dexDown")} up={t("trainer.dexUp")} testId="cr-dex" step={10} />
                  {g >= 8 && <StepTile icon={Medal} label={t("trainer.badges")} value={inputs.badges} min={0} max={8} onChange={(badges) => set({ badges })} down={t("trainer.badgesDown")} up={t("trainer.badgesUp")} testId="cr-badges" />}
                  {hasPower(g) && (
                    <div className="flex min-h-[64px] flex-col justify-center gap-2 rounded-2xl border border-foreground/[0.09] bg-foreground/[0.025] px-3 py-2.5 sm:col-span-2">
                      <p className="flex items-center gap-2 text-[13.5px] font-medium" id="cr-power-label">
                        <Zap className="h-4 w-4 text-[hsl(var(--warning))]" aria-hidden />
                        {powerName}
                      </p>
                      <div role="radiogroup" aria-labelledby="cr-power-label" className="grid grid-cols-4 gap-1 rounded-xl bg-foreground/[0.05] p-1">
                        {[0, 1, 2, 3].map((p) => (
                          <button
                            key={p}
                            type="button"
                            role="radio"
                            aria-checked={inputs.power === p}
                            onClick={() => set({ power: p })}
                            className={cn("h-9 rounded-lg text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", inputs.power === p ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/10" : "text-muted-foreground hover:text-foreground")}
                            data-testid={`cr-power-${p}`}
                          >
                            {p === 0 ? t("trainer.powerNone") : t("trainer.powerLv", { n: p })}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {yours.map((x) => (
                    <ToggleTile key={x.key} tg={x} />
                  ))}
                </Group>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
