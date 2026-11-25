"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, Check, Crown, Minus, Plus, RotateCcw, Share2, Sparkles, Zap } from "lucide-react";
import { useT } from "@/i18n/client";
import msgs from "@/messages/catch-rate";
import { badgePenalty, ballsIn, blockedIn, GAMES, hasPower, lowLevelBonus, STATUSES, SWSH_CAP, type BallId, type GameId, type Status } from "@/lib/catch-rate/formula";
import { DEFAULT_INPUTS, encodeInputs, MAX_DEX, MAX_LEVEL, MAX_TURN, type Inputs } from "@/lib/catch-rate/link";
import { rank, type BallResult, type Ranking } from "@/lib/catch-rate/rank";
import { cn } from "@/lib/utils";
import { BallArt } from "./BallArt";
import { HpBar } from "./HpBar";
import { nameOf, PokemonPicker, type Names } from "./PokemonPicker";
import { ThrowStage } from "./ThrowStage";
import { pct, throws } from "./format";

type T = ReturnType<typeof useT<typeof msgs.en>>;
/** A translator for keys built at run time (ball, status and game ids). */
const dyn = (t: T) => t as unknown as (key: string, values?: Record<string, string | number>) => string;

const WITHIN = [1, 3, 5, 10] as const;
const STATUS_COLOUR: Record<Exclude<Status, "none">, string> = { sleep: "#8d8fa3", freeze: "#5ec8e8", paralysis: "#e8c430", poison: "#b05cc8", burn: "#f0743a" };

export interface CatchRateAppProps extends Names {
  initial: Inputs | null;
  ballNames: Record<BallId, string>;
}

export default function CatchRateApp({ initial, ballNames, names, alt }: CatchRateAppProps) {
  const t = useT(msgs);
  const locale = t.locale;
  const [inputs, setInputs] = useState<Inputs>(initial ?? DEFAULT_INPUTS);
  const [touched, setTouched] = useState(false);
  const [n, setN] = useState<(typeof WITHIN)[number]>(5);
  const [chosen, setChosen] = useState<BallId | null>(null);
  const [note, setNote] = useState("");
  const local = useMemo(() => ({ names, alt }), [names, alt]);
  const r = useMemo(() => rank(inputs), [inputs]);

  const set = useCallback((patch: Partial<Inputs>) => {
    setInputs((i) => ({ ...i, ...patch }));
    setTouched(true);
  }, []);

  // The address keeps the inputs (once they're changed), so a reload or a copied link opens the same encounter.
  useEffect(() => {
    if (!touched) return;
    const h = setTimeout(() => window.history.replaceState(window.history.state, "", `${window.location.pathname}?${encodeInputs(inputs)}`), 250);
    return () => clearTimeout(h);
  }, [inputs, touched]);

  // The ball being thrown: the one picked in the list, or the best (it follows the best until one is picked).
  const available = r.balls.map((b) => b.ball);
  const throwing = chosen && (available.includes(chosen) || chosen === "master") ? chosen : r.best.ball;
  const throwResult = throwing === "master" ? r.master! : (r.balls.find((b) => b.ball === throwing) ?? r.best);

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?${encodeInputs(inputs)}`;
    if (window.matchMedia("(pointer: coarse)").matches && navigator.share) {
      try {
        await navigator.share({ title: `${nameOf(r.species, local)}: ${pct(r.best.chance, locale)}`, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote(t("share.copied"));
    } catch {
      setNote(t("share.failed"));
    }
    setTimeout(() => setNote(""), 2400);
  };
  const reset = () => {
    setInputs(DEFAULT_INPUTS);
    setChosen(null);
    setTouched(false);
    window.history.replaceState(window.history.state, "", window.location.pathname);
  };

  // The screen reader hears the best ball once the inputs settle, not on every step of a drag.
  const liveText = t("results.live", { ball: ballNames[r.best.ball], pct: pct(r.best.chance, locale) });
  const [live, setLive] = useState(liveText);
  useEffect(() => {
    const h = setTimeout(() => setLive(liveText), 700);
    return () => clearTimeout(h);
  }, [liveText]);

  const species = r.species;
  const newer = species.gen > r.game.gen ? species.gen : null;
  const resultsRef = useRef<HTMLDivElement>(null);

  return (
    <div className="mt-8 max-sm:mt-6" data-testid="catch-rate-app">
      <div className="grid items-start gap-6 lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[430px_minmax(0,1fr)]">
        <InputsPanel r={r} inputs={inputs} set={set} names={local} newer={newer} t={t} />
        <div ref={resultsRef} className="min-w-0 scroll-mt-20 space-y-6" data-testid="cr-results">
          <Hero r={r} inputs={inputs} t={t} ballNames={ballNames} species={nameOf(species, local)} throwing={throwing} throwResult={throwResult} onShare={share} onReset={reset} note={note} touched={touched || !!initial} />
          <Ranked r={r} inputs={inputs} t={t} ballNames={ballNames} n={n} setN={setN} throwing={throwing} onPick={(b) => setChosen(b)} />
        </div>
      </div>
      <p className="sr-only" aria-live="polite" data-testid="cr-live">
        {live}
      </p>
      <JumpPill target={resultsRef} label={t("jump")} ball={r.best.ball} chance={pct(r.best.chance, locale)} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Inputs

function Field({ label, children, aside, id }: { label: string; children: ReactNode; aside?: ReactNode; id: string }) {
  return (
    <div role="group" aria-labelledby={id} className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <p id={id} className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children, testId, label, className }: { on: boolean; onClick(): void; children: ReactNode; testId?: string; label?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-primary/50 bg-primary/[0.14] text-foreground" : "border-foreground/[0.09] text-muted-foreground hover:border-foreground/20 hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

function Stepper({ value, min, max, onChange, label, down, up, testId, wide, step = 1 }: { value: number; min: number; max: number; onChange(v: number): void; label: string; down: string; up: string; testId: string; wide?: boolean; step?: number }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const btn = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-foreground transition-colors hover:bg-foreground/[0.1] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex items-center gap-1.5">
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
        className={cn("h-10 rounded-xl bg-transparent text-center", wide ? "w-[72px]" : "w-14", "font-display text-[20px] font-semibold tabular-nums outline-none [appearance:textfield] focus:bg-foreground/[0.05] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none")}
        data-testid={testId}
      />
      <button type="button" className={btn} onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={up} data-testid={`${testId}-up`}>
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function Toggle({ on, onChange, label, balls, testId }: { on: boolean; onChange(v: boolean): void; label: string; balls: BallId[]; testId: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "flex min-h-[48px] w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-primary/40 bg-primary/[0.08]" : "border-foreground/[0.08] hover:border-foreground/[0.16]"
      )}
      data-testid={testId}
    >
      {balls.length > 0 && (
        <span className="flex shrink-0 -space-x-2" aria-hidden>
          {balls.map((b) => (
            <BallArt key={b} id={b} size={22} />
          ))}
        </span>
      )}
      <span className="min-w-0 flex-1 leading-snug">{label}</span>
      <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-foreground/[0.15]")} aria-hidden>
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-150", on ? "left-[18px]" : "left-0.5")} />
      </span>
    </button>
  );
}

function InputsPanel({ r, inputs, set, names, newer, t }: { r: Ranking; inputs: Inputs; set(p: Partial<Inputs>): void; names: Names; newer: number | null; t: T }) {
  const td = dyn(t);
  const have = new Set(ballsIn(r.game));
  const low = lowLevelBonus(inputs.level, r.game.gen);
  const hpOf = (f: number) => Math.max(1, Math.round(f * r.target.maxHp));
  const toPermille = (hp: number) => Math.max(1, Math.min(1000, Math.round((hp / r.target.maxHp) * 1000)));
  const presets: [string, number, string][] = [
    [t("hp.full"), r.target.maxHp, "full"],
    [t("hp.half"), hpOf(0.5), "half"],
    [t("hp.red"), hpOf(0.15), "red"],
    [t("hp.one"), 1, "one"],
  ];
  const g = r.game.gen;
  // Fishing is its own switch where a Lure Ball needs it (it counts for the Dive Ball too); Scarlet & Violet's Lure Ball goes by water like the Dive Ball.
  const fishing = have.has("lure") && g <= 8;
  const waterLabel = g === 3 ? t("situation.waterOld") : g === 9 ? t("situation.waterSv") : fishing ? t("situation.waterNoFish") : t("situation.water");
  const situational = [
    have.has("dusk") && <Toggle key="dark" on={inputs.dark} onChange={(v) => set({ dark: v })} label={t("situation.dark")} balls={["dusk"]} testId="cr-dark" />,
    <Toggle key="water" on={inputs.water} onChange={(v) => set({ water: v })} label={waterLabel} balls={g === 9 && have.has("lure") ? ["dive", "lure"] : ["dive"]} testId="cr-water" />,
    fishing && <Toggle key="fishing" on={inputs.fishing} onChange={(v) => set({ fishing: v })} label={t("situation.fishing")} balls={["lure", "dive"]} testId="cr-fishing" />,
    <Toggle key="caught" on={inputs.caught} onChange={(v) => set({ caught: v })} label={t("situation.caught")} balls={["repeat"]} testId="cr-caught" />,
    have.has("love") && <Toggle key="love" on={inputs.loveMatch} onChange={(v) => set({ loveMatch: v })} label={t("situation.loveMatch")} balls={["love"]} testId="cr-love" />,
  ];
  return (
    <section className="space-y-6 rounded-[28px] border border-foreground/[0.08] bg-card p-6 shadow-[0_20px_60px_-40px_hsl(var(--shade)/0.6)] max-sm:rounded-[22px] max-sm:p-4 lg:sticky lg:top-20" aria-label={t("pokemon.label")} data-testid="cr-inputs">
      <PokemonPicker species={r.species} rate={r.target.rate} names={names} onPick={(id) => set({ id })} newer={newer} />

      <Field label={t("game.label")} id="cr-game" aside={<span className="text-[12px] text-muted-foreground">{t("game.gen", { n: r.game.gen })}</span>}>
        <div className="flex flex-wrap gap-1.5">
          {GAMES.map((g) => (
            <Chip key={g.id} on={inputs.game === g.id} onClick={() => set({ game: g.id as GameId })} testId={`cr-game-${g.id}`} label={td(`game.full.${g.id}`)} className="h-9 px-3 max-md:h-10">
              {td(`game.short.${g.id}`)}
            </Chip>
          ))}
        </div>
        <p className="px-1 text-[13px] text-muted-foreground" data-testid="cr-game-name">
          {td(`game.full.${r.game.id}`)}
        </p>
      </Field>

      <Field
        label={t("level.label")}
        id="cr-level-label"
        aside={low > 1 ? <span className="rounded-full bg-[hsl(var(--success)/0.14)] px-2 py-0.5 text-[11.5px] font-semibold text-[hsl(var(--success))]">{t("level.lowBonus", { n: new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(low) })}</span> : null}
      >
        <div className="flex items-center gap-3">
          <Stepper value={inputs.level} min={1} max={MAX_LEVEL} onChange={(level) => set({ level })} label={t("level.label")} down={t("level.down")} up={t("level.up")} testId="cr-level" />
          <input
            type="range"
            min={1}
            max={MAX_LEVEL}
            value={inputs.level}
            onChange={(e) => set({ level: Number(e.target.value) })}
            aria-label={t("level.label")}
            className="h-10 min-w-0 flex-1 cursor-pointer accent-[hsl(var(--primary))]"
            data-testid="cr-level-range"
          />
        </div>
      </Field>

      <Field label={t("hp.label")} id="cr-hp-label">
        <HpBar hp={r.target.hp} max={r.target.maxHp} onChange={(hp) => set({ hp: toPermille(hp) })} locale={t.locale} />
        <div className="grid grid-cols-4 gap-1.5">
          {presets.map(([label, hp, key]) => (
            <Chip key={key} on={r.target.hp === hp} onClick={() => set({ hp: toPermille(hp) })} testId={`cr-hp-${key}`} className="justify-center px-2" label={key === "one" ? `${label}: ${t("hp.oneHint")}` : undefined}>
              {label}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={t("status.label")} id="cr-status">
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <Chip key={s} on={inputs.status === s} onClick={() => set({ status: s })} testId={`cr-status-${s}`}>
              {s !== "none" && (
                <span className="rounded px-1 py-px font-display text-[10px] font-bold leading-tight tracking-wide text-black/80" style={{ background: STATUS_COLOUR[s] }} aria-hidden>
                  {td(`status.abbr.${s}`)}
                </span>
              )}
              {td(`status.names.${s}`)}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={t("situation.label")} id="cr-situation">
        <p className="-mt-1 text-[13px] text-muted-foreground">{t("situation.hint")}</p>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-foreground/[0.08] px-3 py-1.5">
            <span className="flex items-center gap-3 text-[14px] font-medium">
              <span className="flex -space-x-2" aria-hidden>
                {(["quick", "timer"] as const).filter((b) => have.has(b)).map((b) => (
                  <BallArt key={b} id={b} size={22} />
                ))}
              </span>
              {t("situation.turn")}
            </span>
            <Stepper value={inputs.turn} min={1} max={MAX_TURN} onChange={(turn) => set({ turn })} label={t("situation.turn")} down={t("situation.turnDown")} up={t("situation.turnUp")} testId="cr-turn" />
          </div>
          {(have.has("level") || (g === 8 && inputs.badges < 8)) && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-foreground/[0.08] px-3 py-1.5">
              <span className="flex items-center gap-3 text-[14px] font-medium">
                {have.has("level") && <BallArt id="level" size={22} />}
                {t("situation.yourLevel")}
              </span>
              <Stepper value={inputs.yourLevel} min={1} max={MAX_LEVEL} onChange={(yourLevel) => set({ yourLevel })} label={t("situation.yourLevel")} down={t("level.down")} up={t("level.up")} testId="cr-you" />
            </div>
          )}
          {situational}
        </div>
      </Field>

      {g >= 5 && <TrainerField r={r} inputs={inputs} set={set} t={t} />}
    </section>
  );
}

/** You: the species you've caught (critical captures), and from game to game the Catching Charm, badges, a capture power, dark grass and a back strike. */
function TrainerField({ r, inputs, set, t }: { r: Ranking; inputs: Inputs; set(p: Partial<Inputs>): void; t: T }) {
  const g = r.game.gen;
  const f = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 2 });
  const penalty = badgePenalty(r.game, r.target, inputs);
  const row = "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-foreground/[0.08] px-3 py-1.5";
  const powerName = g === 5 ? t("trainer.powerBw") : g === 6 ? t("trainer.powerXy") : t("trainer.powerSv");
  return (
    <Field
      label={t("trainer.label")}
      id="cr-trainer"
      aside={penalty < 1 ? <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11.5px] font-semibold text-destructive" data-testid="cr-penalty">{t(g === 8 ? "trainer.swshPenalty" : "trainer.badgePenalty", { n: f.format(penalty) })}</span> : null}
    >
      <p className="-mt-1 text-[13px] text-muted-foreground">{t("trainer.hint")}</p>
      <div className="grid gap-2">
        <div className={row}>
          <span className="min-w-0 flex-1 text-[14px] font-medium leading-snug">
            {t("trainer.dex")}
            <span className="block text-[12px] font-normal text-muted-foreground">{t("trainer.dexHint")}</span>
          </span>
          <Stepper value={inputs.dex} min={0} max={MAX_DEX} onChange={(dex) => set({ dex })} label={t("trainer.dex")} down={t("trainer.dexDown")} up={t("trainer.dexUp")} testId="cr-dex" wide step={10} />
        </div>
        {g >= 8 && (
          <div className={row}>
            <span className="text-[14px] font-medium">{t("trainer.badges")}</span>
            <Stepper value={inputs.badges} min={0} max={8} onChange={(badges) => set({ badges })} label={t("trainer.badges")} down={t("trainer.badgesDown")} up={t("trainer.badgesUp")} testId="cr-badges" />
          </div>
        )}
        {hasPower(g) && (
          <div className="space-y-2 rounded-2xl border border-foreground/[0.08] px-3 py-2.5">
            <p className="text-[14px] font-medium" id="cr-power-label">
              {powerName}
            </p>
            <div role="radiogroup" aria-labelledby="cr-power-label" className="grid grid-cols-4 gap-1.5">
              {[0, 1, 2, 3].map((p) => (
                <Chip key={p} on={inputs.power === p} onClick={() => set({ power: p })} testId={`cr-power-${p}`} className="justify-center px-2">
                  {p === 0 ? t("trainer.powerNone") : t("trainer.powerLv", { n: p })}
                </Chip>
              ))}
            </div>
          </div>
        )}
        {g >= 8 && <Toggle on={inputs.charm} onChange={(v) => set({ charm: v })} label={t("trainer.charm")} balls={[]} testId="cr-charm" />}
        {g === 9 && <Toggle on={inputs.offGuard} onChange={(v) => set({ offGuard: v })} label={t("trainer.offGuard")} balls={[]} testId="cr-off-guard" />}
        {g === 5 && <Toggle on={inputs.darkGrass} onChange={(v) => set({ darkGrass: v })} label={t("trainer.darkGrass")} balls={[]} testId="cr-dark-grass" />}
      </div>
      {blockedIn(r.game, r.target, inputs) && (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/[0.08] px-3.5 py-2.5 text-[13.5px] font-medium leading-snug text-destructive" role="status" data-testid="cr-blocked">
          {t("trainer.blocked", { badges: inputs.badges, max: SWSH_CAP[inputs.badges] })}
        </p>
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Results

/** Why a ball is strong or weak here, in a few words. */
function why(b: BallResult, r: Ranking, t: T, i: Pick<Inputs, "turn" | "yourLevel">): string {
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
  const good = fx.add > 0 || fx.mul > 1, bad = fx.add < 0 || fx.mul < 1;
  return (
    <span className={cn("rounded-md px-1.5 py-px text-[11.5px] font-bold tabular-nums", good ? "bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success))]" : bad ? "bg-destructive/15 text-destructive" : "bg-foreground/[0.06] text-muted-foreground")}>
      {text}
    </span>
  );
}

/** A chance's colour on the bars: red for long odds, amber in the middle, green when it's likely. */
const barColour = (p: number) => (p >= 0.6 ? "hsl(154 68% 46%)" : p >= 0.25 ? "hsl(42 98% 55%)" : "hsl(354 82% 60%)");

function Hero({ r, inputs, t, ballNames, species, throwing, throwResult, onShare, onReset, note, touched }: { r: Ranking; inputs: Inputs; t: T; ballNames: Record<BallId, string>; species: string; throwing: BallId; throwResult: BallResult; onShare(): void; onReset(): void; note: string; touched: boolean }) {
  const best = r.best;
  const locale = t.locale;
  const reduce = useReducedMotion();
  const ninety = best.throwsFor(0.9);
  const same = r.budget?.ball === best.ball;
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-foreground/[0.08] bg-card p-6 shadow-[0_20px_60px_-40px_hsl(var(--shade)/0.6)] max-sm:rounded-[22px] max-sm:p-4" aria-labelledby="cr-best" data-testid="cr-hero">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/[0.12] blur-3xl" aria-hidden />
      <div className="relative grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between gap-2">
            <p id="cr-best" className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[hsl(var(--warning))]">
              <Crown className="h-3.5 w-3.5" aria-hidden /> {t("results.best")}
            </p>
            <div className="flex items-center gap-1">
              {touched && (
                <button type="button" onClick={onReset} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("share.reset")} title={t("share.reset")} data-testid="cr-reset">
                  <RotateCcw className="h-4 w-4" aria-hidden />
                </button>
              )}
              <button type="button" onClick={onShare} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-3.5 text-[13px] font-semibold transition-colors hover:bg-foreground/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="cr-share">
                {note ? <Check className="h-4 w-4 text-[hsl(var(--success))]" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
                {note || t("share.button")}
              </button>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <motion.span key={best.ball} initial={reduce ? false : { scale: 0.5, rotate: -90, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 18 }}>
              <BallArt id={best.ball} size={64} />
            </motion.span>
            <div className="min-w-0">
              <h2 className="truncate font-display text-[26px] font-semibold leading-tight tracking-tight max-sm:text-[22px]" data-testid="cr-best-name" data-ball={best.ball}>
                {ballNames[best.ball]}
              </h2>
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{why(best, r, t, inputs) || " "}</p>
            </div>
          </div>
          <p className="mt-5 flex items-baseline gap-2">
            <span className="font-display text-[64px] font-bold leading-none tracking-tight tabular-nums max-sm:text-[54px]" style={{ color: barColour(best.chance) }} data-testid="cr-best-chance" data-chance={best.chance}>
              {pct(best.chance, locale)}
            </span>
            <span className="text-[15px] text-muted-foreground">{t("results.perThrow")}</span>
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-foreground/[0.04] px-3.5 py-3">
              <dt className="text-[12px] text-muted-foreground">{t("results.avg")}</dt>
              <dd className="mt-0.5 font-display text-[22px] font-semibold tabular-nums" data-testid="cr-best-avg">
                {best.chance >= 1 ? t("results.sure") : Number.isFinite(best.expected) ? t("results.avgValue", { n: throws(best.expected, locale) }) : t("results.never")}
              </dd>
            </div>
            <div className="rounded-2xl bg-foreground/[0.04] px-3.5 py-3">
              <dt className="text-[12px] text-muted-foreground">{t("results.toNinety")}</dt>
              <dd className="mt-0.5 font-display text-[22px] font-semibold tabular-nums" data-testid="cr-best-90">
                {Number.isFinite(ninety) ? t("results.throwsN", { n: ninety }) : t("results.never")}
              </dd>
            </div>
          </dl>
          {best.first.crit > 0 && best.chance < 1 && (
            <p className="mt-3 flex items-center gap-2 px-1 text-[13px] text-muted-foreground" data-testid="cr-crit" data-crit={best.first.crit}>
              <Zap className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]" aria-hidden />
              {t("results.crit", { pct: pct(best.first.crit, locale) })}
            </p>
          )}
          {r.budget && (
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.07)] px-3.5 py-2.5" data-testid="cr-budget" data-ball={r.budget.ball}>
              <BallArt id={r.budget.ball} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[hsl(var(--success))]">{t("results.budget")}</p>
                <p className="truncate text-[13px] text-muted-foreground">{same ? t("results.bothHint") : t("results.budgetHint")}</p>
              </div>
              <div className="text-right">
                <p className="text-[14px] font-semibold">{ballNames[r.budget.ball]}</p>
                <p className="font-display text-[16px] font-semibold tabular-nums">{pct(r.budget.chance, locale)}</p>
              </div>
            </div>
          )}
        </div>
        <ThrowStage ball={throwing} ballName={t("throw.with", { ball: ballNames[throwing], pct: pct(throwResult.chance, locale) })} th={throwResult.first} speciesId={r.species.id} speciesName={species} />
      </div>
    </section>
  );
}

function Ranked({ r, inputs, t, ballNames, n, setN, throwing, onPick }: { r: Ranking; inputs: Inputs; t: T; ballNames: Record<BallId, string>; n: number; setN(n: (typeof WITHIN)[number]): void; throwing: BallId; onPick(b: BallId): void }) {
  const locale = t.locale;
  const reduce = useReducedMotion();
  const top = Math.max(r.best.chance, 0.0001);
  return (
    <section className="rounded-[28px] border border-foreground/[0.08] bg-card p-6 shadow-[0_20px_60px_-40px_hsl(var(--shade)/0.6)] max-sm:rounded-[22px] max-sm:p-3" aria-labelledby="cr-ranked">
      <div className="flex flex-wrap items-center justify-between gap-3 max-sm:px-1 max-sm:pt-1">
        <h2 id="cr-ranked" className="font-display text-[22px] font-semibold tracking-tight">
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
                className={cn("h-8 min-w-[36px] rounded-full px-2.5 text-[13px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", n === w ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                data-testid={`cr-within-${w}`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>
      <LayoutGroup>
        <ol className="mt-4 space-y-1" data-testid="cr-list">
          {r.balls.map((b, i) => {
            const within = b.within(n);
            const isBest = b.ball === r.best.ball;
            const isBudget = b.ball === r.budget?.ball;
            const reason = why(b, r, t, inputs);
            return (
              <motion.li key={b.ball} layout={reduce ? false : "position"} transition={{ type: "spring", stiffness: 520, damping: 42 }} data-testid="cr-row" data-ball={b.ball} data-chance={b.chance}>
                <button
                  type="button"
                  onClick={() => onPick(b.ball)}
                  aria-pressed={throwing === b.ball}
                  aria-label={t("results.rowLabel", { ball: ballNames[b.ball], pct: pct(b.chance, locale), within: pct(within, locale), n })}
                  className={cn(
                    "grid w-full grid-cols-[22px_36px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3",
                    throwing === b.ball ? "bg-primary/[0.09]" : "hover:bg-foreground/[0.04]",
                    isBest && throwing !== b.ball && "bg-[hsl(var(--warning)/0.06)]"
                  )}
                >
                  <span className={cn("text-center font-display text-[14px] font-semibold tabular-nums", isBest ? "text-[hsl(var(--warning))]" : "text-muted-foreground")}>{isBest ? <Crown className="mx-auto h-4 w-4" aria-hidden /> : i + 1}</span>
                  <BallArt id={b.ball} size={34} />
                  <span className="min-w-0">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-[15px] font-semibold">{ballNames[b.ball]}</span>
                      <MulTag b={b} locale={locale} />
                      {isBudget && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--success)/0.14)] px-1.5 py-px text-[11px] font-bold uppercase tracking-wide text-[hsl(var(--success))]">
                          <Sparkles className="h-3 w-3" aria-hidden />
                          {t("results.budget")}
                        </span>
                      )}
                    </span>
                    {reason && <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{reason}</span>}
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]" aria-hidden>
                      <span className="block h-full rounded-full transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${Math.max(b.chance > 0 ? 1.5 : 0, (b.chance / Math.max(top, 1e-9)) * 100 * Math.min(1, top))}%`, background: barColour(b.chance) }} />
                    </span>
                  </span>
                  <span className="w-[100px] text-right sm:w-[124px]">
                    <span className="block font-display text-[19px] font-semibold leading-tight tabular-nums">{pct(b.chance, locale)}</span>
                    <span className="block text-[11px] leading-tight tabular-nums text-muted-foreground sm:text-[11.5px]">
                      {t("results.withinCol", { n })} · {pct(within, locale)}
                    </span>
                  </span>
                </button>
              </motion.li>
            );
          })}
        </ol>
      </LayoutGroup>
      <div className="mt-4 space-y-2 border-t border-foreground/[0.07] px-2 pt-4 text-[13px] text-muted-foreground">
        {r.master && (
          <button type="button" onClick={() => onPick("master")} aria-pressed={throwing === "master"} className={cn("flex w-full items-center gap-3 rounded-2xl px-1 py-1 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", throwing === "master" && "text-foreground")} data-testid="cr-master">
            <BallArt id="master" size={26} />
            <span className="min-w-0 flex-1">{t("results.master")}</span>
            <span className="font-display text-[15px] font-semibold tabular-nums text-foreground">{pct(r.master.chance, locale)}</span>
          </button>
        )}
        <p className="flex items-center gap-3 px-1">
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


/** On a phone, a pill at the bottom that shows the best ball and jumps to the results while they're off screen. */
function JumpPill({ target, label, ball, chance }: { target: React.RefObject<HTMLDivElement | null>; label: string; ball: BallId; chance: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = target.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top > 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [target]);
  return (
    <motion.button
      type="button"
      initial={false}
      animate={{ y: show ? 0 : 90, opacity: show ? 1 : 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      onClick={() => target.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      className="fixed bottom-[calc(var(--tabbar-h)+12px)] left-1/2 z-40 flex h-12 items-center gap-2.5 rounded-full border border-foreground/[0.1] bg-card/95 pl-2 pr-4 text-[14px] font-semibold shadow-[0_16px_40px_-12px_hsl(var(--shade)/0.7)] backdrop-blur lg:hidden"
      style={{ x: "-50%" }}
      data-testid="cr-jump"
    >
      <BallArt id={ball} size={30} />
      <span className="font-display text-[17px] tabular-nums">{chance}</span>
      <span className="text-muted-foreground">{label}</span>
      <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden />
    </motion.button>
  );
}
