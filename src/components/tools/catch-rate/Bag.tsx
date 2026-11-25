"use client";

import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { Backpack, Crown, Hand, Sparkles, Zap } from "lucide-react";
import { useT } from "@/i18n/client";
import msgs from "@/messages/catch-rate";
import type { BallId } from "@/lib/catch-rate/formula";
import type { Inputs } from "@/lib/catch-rate/link";
import type { BallResult, Ranking } from "@/lib/catch-rate/rank";
import { cn } from "@/lib/utils";
import { BallArt } from "./BallArt";
import { pct, throws } from "./format";

type T = ReturnType<typeof useT<typeof msgs.en>>;
/** A translator for keys built at run time (ball ids). */
const dyn = (t: T) => t as unknown as (key: string, values?: Record<string, string | number>) => string;

export const WITHIN = [1, 3, 5, 10] as const;
export type Within = (typeof WITHIN)[number];

/** Why a ball is strong or weak here, in a few words. */
export function why(b: BallResult, r: Ranking, t: T, i: Pick<Inputs, "turn" | "yourLevel">): string {
  const fx = b.first.fx;
  const g = r.game.gen;
  const td = dyn(t);
  if (r.target.ultraBeast && g >= 7 && b.ball !== "beast" && b.ball !== "master") return t("why.ub");
  switch (b.ball) {
    case "poke":
      return "";
    case "great":
    case "ultra":
      return td(`why.${b.ball}`);
    case "timer":
      return fx.active ? t("why.timerOn", { n: i.turn }) : t("why.timerOff");
    case "nest":
      return fx.active ? t("why.nestOn", { n: r.target.level }) : t("why.nestOff");
    case "level":
      return fx.active ? t("why.levelOn", { you: i.yourLevel, wild: r.target.level }) : t("why.levelOff");
    case "fast":
      return fx.active ? t("why.fastOn", { n: r.target.baseSpeed }) : t("why.fastOff");
    case "heavy": {
      const kg = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(r.target.weight / 10);
      return t("why.heavy", { kg, delta: fx.add > 0 ? `+${fx.add}` : fx.add < 0 ? `−${-fx.add}` : "±0" });
    }
    case "beast":
      return r.target.ultraBeast ? t("why.beastOn") : t("why.beastOff");
    case "lure":
      return g === 9 ? (fx.active ? t("why.lureOnSv") : t("why.lureOffSv")) : fx.active ? t("why.lureOn") : t("why.lureOff");
    default:
      return td(`why.${b.ball}${fx.active ? "On" : "Off"}`);
  }
}

/** The multiplier tag: ×3.5 in green when it helps, grey at ×1, red when it hurts; Heavy Ball shows its +/−. */
function MulTag({ b, locale }: { b: BallResult; locale: string }) {
  const fx = b.first.fx;
  if (fx.sure) return null;
  const f = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const text = fx.add ? (fx.add > 0 ? `+${fx.add}` : `−${-fx.add}`) : `×${f.format(fx.mul)}`;
  const good = fx.add > 0 || fx.mul > 1,
    bad = fx.add < 0 || fx.mul < 1;
  return (
    <span className={cn("shrink-0 rounded-md px-1.5 py-px text-[11.5px] font-bold tabular-nums", good ? "bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success))]" : bad ? "bg-destructive/15 text-destructive" : "bg-foreground/[0.06] text-muted-foreground")}>
      {text}
    </span>
  );
}

/** A chance's colour: red for long odds, amber in the middle, green when it's likely. */
export const barColour = (p: number) => (p >= 0.6 ? "hsl(154 68% 46%)" : p >= 0.25 ? "hsl(42 98% 55%)" : "hsl(354 82% 60%)");

function Bar({ p, top }: { p: number; top: number }) {
  return (
    <span className="mt-2 block h-[7px] overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden>
      <span
        className="block h-full rounded-full shadow-[inset_0_-2px_0_rgb(0_0_0/0.15),inset_0_1px_0_rgb(255_255_255/0.35)] transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.max(p > 0 ? 2 : 0, (p / Math.max(top, 1e-9)) * 100 * Math.min(1, top))}%`, background: barColour(p) }}
      />
    </span>
  );
}

function InHand({ t }: { t: T }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-primary-foreground">
      <Hand className="h-3 w-3" aria-hidden />
      {t("results.inHand")}
    </span>
  );
}

/**
 * The bag: every ball in the game, best first. The best one is the big crowned card at the top, with its throws on
 * average, throws to a 90% chance and the best-value pick; the rest are slots with their art, their multiplier, why,
 * and the chance per throw and within the chosen number of throws. Tapping one puts it in hand and throws it.
 */
export function Bag({ r, inputs, ballNames, n, setN, throwing, onPick }: { r: Ranking; inputs: Inputs; ballNames: Record<BallId, string>; n: Within; setN(n: Within): void; throwing: BallId; onPick(b: BallId): void }) {
  const t = useT(msgs);
  const locale = t.locale;
  const reduce = useReducedMotion();
  const top = Math.max(r.best.chance, 0.0001);
  const best = r.best;
  const ninety = best.throwsFor(0.9);
  const same = r.budget?.ball === best.ball;
  return (
    <section className="overflow-hidden rounded-[28px] border border-foreground/[0.08] bg-card shadow-[0_24px_60px_-40px_hsl(var(--shade)/0.7)] max-sm:rounded-[24px]" aria-labelledby="cr-ranked" data-testid="cr-bag">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-foreground/[0.07] bg-gradient-to-b from-foreground/[0.035] to-transparent px-4 py-3.5 sm:px-5">
        <h2 id="cr-ranked" className="flex items-center gap-2 font-display text-[19px] font-bold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-b from-[#ffb648] to-[#e8792b] text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)]" aria-hidden>
            <Backpack className="h-[17px] w-[17px]" />
          </span>
          {t("results.title")}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground" id="cr-within-label">
            {t("results.within")}
          </span>
          <div role="radiogroup" aria-labelledby="cr-within-label" className="inline-flex rounded-full bg-foreground/[0.06] p-1">
            {WITHIN.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={n === w}
                onClick={() => setN(w)}
                className={cn("h-8 min-w-[34px] rounded-full px-2 text-[13px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", n === w ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/10" : "text-muted-foreground hover:text-foreground")}
                data-testid={`cr-within-${w}`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>
      <LayoutGroup>
        <ol className="space-y-1.5 p-2.5 sm:p-3" data-testid="cr-list">
          {r.balls.map((b, i) => {
            const within = b.within(n);
            const isBest = i === 0;
            const isBudget = b.ball === r.budget?.ball;
            const reason = why(b, r, t, inputs);
            const held = throwing === b.ball;
            const label = t("results.rowLabel", { ball: ballNames[b.ball], pct: pct(b.chance, locale), within: pct(within, locale), n });
            return (
              <motion.li key={b.ball} layout={reduce ? false : "position"} transition={{ type: "spring", stiffness: 520, damping: 42 }} data-testid="cr-row" data-ball={b.ball} data-chance={b.chance}>
                {isBest ? (
                  <button
                    type="button"
                    onClick={() => onPick(b.ball)}
                    aria-pressed={held}
                    aria-label={label}
                    className={cn(
                      "relative block w-full overflow-hidden rounded-[22px] p-4 text-left transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "bg-[linear-gradient(135deg,hsl(42_98%_60%/0.2),hsl(340_86%_60%/0.1)_55%,transparent)] ring-2 ring-inset",
                      held ? "ring-primary" : "ring-[hsl(var(--warning)/0.55)]"
                    )}
                    data-testid="cr-hero"
                  >
                    <span className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-[hsl(var(--warning)/0.18)] blur-2xl" aria-hidden />
                    <span className="relative flex items-center justify-between gap-2">
                      <span id="cr-best" className="inline-flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--warning))]">
                        <Crown className="h-4 w-4 fill-current" aria-hidden /> {t("results.best")}
                      </span>
                      {held && <InHand t={t} />}
                    </span>
                    <span className="relative mt-3 flex items-center gap-4">
                      <motion.span key={best.ball} className="relative shrink-0" initial={reduce ? false : { scale: 0.5, rotate: -120, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 18 }}>
                        <span className="absolute inset-[-10px] rounded-full bg-[radial-gradient(closest-side,hsl(42_98%_60%/0.45),transparent)]" aria-hidden />
                        <BallArt id={best.ball} size={68} className="relative" />
                      </motion.span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-display text-[24px] font-bold leading-tight tracking-tight" data-testid="cr-best-name" data-ball={best.ball}>
                            {ballNames[best.ball]}
                          </span>
                          <MulTag b={b} locale={locale} />
                        </span>
                        {reason && <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{reason}</span>}
                      </span>
                    </span>
                    <span className="relative mt-3 flex items-baseline gap-2">
                      <span className="font-display text-[56px] font-bold leading-none tracking-tight tabular-nums" style={{ color: barColour(best.chance) }} data-testid="cr-best-chance" data-chance={best.chance}>
                        {pct(best.chance, locale)}
                      </span>
                      <span className="text-[14px] text-muted-foreground">{t("results.perThrow")}</span>
                    </span>
                    <Bar p={b.chance} top={top} />
                    <span className="relative mt-3 grid grid-cols-3 gap-2">
                      <span className="rounded-2xl bg-foreground/[0.05] px-3 py-2">
                        <span className="block text-[11px] leading-tight text-muted-foreground">{t("results.avg")}</span>
                        <span className="mt-0.5 block font-display text-[18px] font-bold tabular-nums" data-testid="cr-best-avg">
                          {best.chance >= 1 ? t("results.sure") : Number.isFinite(best.expected) ? t("results.avgValue", { n: throws(best.expected, locale) }) : t("results.never")}
                        </span>
                      </span>
                      <span className="rounded-2xl bg-foreground/[0.05] px-3 py-2">
                        <span className="block text-[11px] leading-tight text-muted-foreground">{t("results.toNinety")}</span>
                        <span className="mt-0.5 block font-display text-[18px] font-bold tabular-nums" data-testid="cr-best-90">
                          {Number.isFinite(ninety) ? t("results.throwsN", { n: ninety }) : t("results.never")}
                        </span>
                      </span>
                      <span className="rounded-2xl bg-foreground/[0.05] px-3 py-2">
                        <span className="block text-[11px] leading-tight text-muted-foreground">{t("results.withinCol", { n })}</span>
                        <span className="mt-0.5 block font-display text-[18px] font-bold tabular-nums">{pct(within, locale)}</span>
                      </span>
                    </span>
                    {best.first.crit > 0 && best.chance < 1 && (
                      <span className="relative mt-3 flex items-center gap-2 text-[12.5px] text-muted-foreground" data-testid="cr-crit" data-crit={best.first.crit}>
                        <Zap className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]" aria-hidden />
                        {t("results.crit", { pct: pct(best.first.crit, locale) })}
                      </span>
                    )}
                    {r.budget && (
                      <span className="relative mt-3 flex items-center gap-3 rounded-2xl border border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.08)] px-3 py-2" data-testid="cr-budget" data-ball={r.budget.ball}>
                        <BallArt id={r.budget.ball} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--success))]">{t("results.budget")}</span>
                          <span className="block truncate text-[12.5px] text-muted-foreground">{same ? t("results.bothHint") : t("results.budgetHint")}</span>
                        </span>
                        <span className="text-right">
                          <span className="block text-[13px] font-semibold">{ballNames[r.budget.ball]}</span>
                          <span className="block font-display text-[15px] font-bold tabular-nums">{pct(r.budget.chance, locale)}</span>
                        </span>
                      </span>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onPick(b.ball)}
                    aria-pressed={held}
                    aria-label={label}
                    className={cn(
                      "group grid w-full grid-cols-[20px_46px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-2xl px-2.5 py-2.5 text-left transition-[background-color,box-shadow,transform] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      held ? "bg-primary/[0.09] ring-2 ring-inset ring-primary/70" : "hover:bg-foreground/[0.045]"
                    )}
                  >
                    <span className="text-center font-display text-[13px] font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="relative flex h-[46px] w-[46px] items-center justify-center rounded-full bg-foreground/[0.04] transition-transform group-hover:-rotate-12 group-hover:scale-105">
                      <BallArt id={b.ball} size={40} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[15px] font-semibold">{ballNames[b.ball]}</span>
                        <MulTag b={b} locale={locale} />
                        {isBudget && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[hsl(var(--success)/0.14)] px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--success))] max-[400px]:hidden">
                            <Sparkles className="h-3 w-3" aria-hidden />
                            {t("results.budget")}
                          </span>
                        )}
                      </span>
                      {reason && <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{reason}</span>}
                      <Bar p={b.chance} top={top} />
                    </span>
                    <span className="flex flex-col items-end text-right">
                      {held && <span className="mb-1"><InHand t={t} /></span>}
                      <span className="block font-display text-[22px] font-bold leading-none tabular-nums">{pct(b.chance, locale)}</span>
                      <span className="mt-1 block whitespace-nowrap text-[11px] leading-tight tabular-nums text-muted-foreground">
                        {t("results.withinCol", { n })} · {pct(within, locale)}
                      </span>
                    </span>
                  </button>
                )}
              </motion.li>
            );
          })}
        </ol>
      </LayoutGroup>
      <div className="space-y-2 border-t border-foreground/[0.07] px-4 py-4 text-[13px] text-muted-foreground sm:px-5">
        {r.master && (
          <button
            type="button"
            onClick={() => onPick("master")}
            aria-pressed={throwing === "master"}
            className={cn("flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", throwing === "master" && "bg-primary/[0.09] text-foreground ring-2 ring-inset ring-primary/70")}
            data-testid="cr-master"
          >
            <BallArt id="master" size={32} />
            <span className="min-w-0 flex-1 leading-snug">{t("results.master")}</span>
            <span className="font-display text-[17px] font-bold tabular-nums text-foreground">{pct(r.master.chance, locale)}</span>
          </button>
        )}
        <p className="flex items-center gap-3 px-2">
          <span className="flex shrink-0 -space-x-2" aria-hidden>
            {(["premier", "luxury", "heal"] as const).map((b) => (
              <BallArt key={b} id={b} size={22} />
            ))}
          </span>
          {t("results.plain")}
        </p>
      </div>
    </section>
  );
}
