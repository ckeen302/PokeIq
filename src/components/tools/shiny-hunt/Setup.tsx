"use client";

import type { ComponentType } from "react";
import {
  Check,
  CloudLightning,
  Egg,
  Fish,
  Flame,
  Footprints,
  Heart,
  Languages,
  Map as MapIcon,
  Megaphone,
  Minus,
  Orbit,
  Pickaxe,
  Plus,
  Radar,
  Repeat,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Sun,
  Telescope,
  Users,
  Volume2,
  Vibrate,
  type LucideProps,
} from "lucide-react";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import { useLocale } from "@/i18n/navigation";
import { formatNumber } from "@/i18n/format";
import counter from "@/messages/shiny-counter";
import { GAMES_NEWEST_FIRST, NO_BONUS, chainCap, charmApplies, getGame, getMethod, hasChain, shinyChance, type ChoiceId, type GameId, type MethodId } from "@/lib/shiny-hunt/odds";
import { oneIn } from "@/lib/shiny-hunt/math";
import { setOdds, type Hunt, type Prefs } from "@/lib/shiny-hunt/store";
import { cn } from "@/lib/utils";
import { Segmented } from "../tier-list/ui";
import { GAME_COLOURS, GameSwatch } from "./Art";

/** Each method's little picture. */
export const METHOD_ICONS: Record<MethodId, ComponentType<LucideProps>> = {
  wild: Footprints,
  eggs: Egg,
  breeding: Heart,
  masuda: Languages,
  pokeRadar: Radar,
  friendSafari: Users,
  chainFishing: Fish,
  horde: Users,
  dexNav: ScanSearch,
  sos: Megaphone,
  wormhole: Orbit,
  catchCombo: Repeat,
  brilliant: Sun,
  dynamax: CloudLightning,
  underground: Pickaxe,
  outbreak: Flame,
  massiveOutbreak: MapIcon,
  hyperspace: Telescope,
};

const LABEL = "text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground";

/** The hunt's game, method and bonuses, picked from chips and cards that each show what they do to the odds. */
export function Setup({ hunt, onChange, prefs, onPref }: { hunt: Hunt; onChange(h: Hunt): void; prefs: Prefs; onPref(k: keyof Prefs, v: boolean): void }) {
  const t = useT(counter);
  const locale = useLocale();
  const game = getGame(hunt.game)!;
  const method = getMethod(hunt.game, hunt.method)!;
  const fmtOdds = (p: number) => t("counter.odds", { n: formatNumber(oneIn(p), locale) });
  const set = (patch: Parameters<typeof setOdds>[1]) => onChange(setOdds(hunt, patch));
  const cap = chainCap(method);
  const bonuses = charmApplies(method) || !!method.lure || !!method.choices?.length || !!method.level || hasChain(method);
  return (
    <div className="space-y-6" data-testid="sh-setup">
      {/* Games: a chip each, in the game's colours, newest first. */}
      <div>
        <p className={LABEL} id="sh-game-label">{t("setup.game")}</p>
        <div role="radiogroup" aria-labelledby="sh-game-label" className="sh-noscroll mt-2.5 flex flex-wrap gap-1.5 max-sm:-mx-5 max-sm:grid max-sm:grid-flow-col max-sm:grid-rows-3 max-sm:justify-start max-sm:overflow-x-auto max-sm:px-5 max-sm:pb-1" data-testid="sh-game">
          {GAMES_NEWEST_FIRST.map((g) => {
            const on = g.id === hunt.game;
            const [a] = GAME_COLOURS[g.id];
            return (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={on}
                title={t("setup.gen", { n: g.gen })}
                onClick={() => set({ game: g.id as GameId })}
                className={cn(
                  "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full border pl-1.5 pr-3.5 text-[13.5px] font-semibold transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:h-9 max-sm:text-[13px]",
                  on ? "border-transparent text-foreground" : "border-foreground/[0.09] bg-foreground/[0.025] text-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground"
                )}
                style={on ? { background: `color-mix(in srgb, ${a} 16%, transparent)`, boxShadow: `inset 0 0 0 2px ${a}` } : undefined}
                data-testid={`sh-game-${g.id}`}
              >
                <GameSwatch game={g.id} className="h-7 w-7 max-sm:h-6 max-sm:w-6" />
                {t(`games.${g.id}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Methods: cards with a picture and their odds. */}
      <div>
        <p className={LABEL} id="sh-method-label">{t("setup.method")}</p>
        <div role="radiogroup" aria-labelledby="sh-method-label" className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2 max-sm:grid-cols-2">
          {game.methods.map((m) => {
            const on = m.id === hunt.method;
            const p = shinyChance(hunt.game, m.id, on ? hunt : { ...NO_BONUS, charm: hunt.charm });
            const Icon = METHOD_ICONS[m.id];
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ method: m.id as MethodId })}
                className={cn(
                  "group relative flex min-h-[64px] w-full flex-col rounded-[18px] border p-3 text-left transition-[background-color,border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985] motion-reduce:active:scale-100",
                  on ? "border-primary/60 bg-primary/[0.08] shadow-[0_8px_24px_-14px_hsl(var(--primary)/0.7)]" : "border-foreground/[0.09] bg-foreground/[0.02] hover:border-foreground/[0.16] hover:bg-foreground/[0.045]"
                )}
                data-testid={`sh-method-${m.id}`}
              >
                <span className="flex w-full items-start gap-2.5">
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", on ? "bg-primary text-primary-foreground shadow-[inset_0_-2px_0_rgb(0_0_0/0.2)]" : "bg-foreground/[0.06] text-foreground/75")} aria-hidden>
                    <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5 text-[14px] font-semibold leading-tight">{t(`methods.${m.id}`)}</span>
                  {on && <Check className="h-4 w-4 shrink-0 text-primary max-sm:hidden" strokeWidth={3} aria-hidden />}
                </span>
                <span className="mt-2 flex items-center">
                  <span className={cn("sh-num inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-bold", on ? "bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))]" : "bg-foreground/[0.06] text-muted-foreground")}>
                    <Sparkles className="h-3 w-3" aria-hidden />
                    {fmtOdds(p)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 text-[13px] leading-snug text-muted-foreground" data-testid="sh-method-hint">
          <span className="font-semibold text-foreground/85">{t(`methods.${method.id}`)}:</span> {t(`methodHints.${method.id}`)}
        </p>
      </div>

      {/* Bonuses: the Shiny Charm and whatever else the method takes. */}
      {bonuses && (
        <div>
          <p className={LABEL}>{t("setup.bonuses")}</p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {charmApplies(method) && <Toggle on={hunt.charm} onChange={(v) => set({ charm: v })} label={t("setup.charm")} icon={<Sparkles className="h-[18px] w-[18px]" aria-hidden />} testId="sh-charm" />}
            {method.lure && <Toggle on={hunt.lure} onChange={(v) => set({ lure: v })} label={t(method.lureKind === "diglett" ? "setup.diglett" : "setup.lure")} icon={<Plus className="h-[18px] w-[18px]" aria-hidden />} testId="sh-lure" />}
            {(method.choices ?? []).map((c) => (
              <Box key={c.id} label={t(`setup.${c.id}`)} wide>
                <Segmented<string>
                  size="sm"
                  className="flex w-full"
                  label={t(`setup.${c.id}`)}
                  value={hunt.choices[c.id] ?? c.options[0].id}
                  onChange={(v) => set({ choices: { ...hunt.choices, [c.id as ChoiceId]: v } })}
                  options={c.options.map((o) => ({ value: o.id, label: choiceLabel(t, c.id, o.id), testId: `sh-choice-${c.id}-${o.id}` }))}
                />
              </Box>
            ))}
            {method.level && (
              <Box label={t(`setup.level.${method.level.id}`)} hint={t(`setup.levelHint.${method.level.id}`)}>
                <Stepper
                  value={hunt.level ?? 0}
                  min={0}
                  max={method.level.max}
                  step={method.level.step}
                  onChange={(v) => set({ level: v })}
                  downLabel={t(`setup.levelDown.${method.level.id}`)}
                  upLabel={t(`setup.levelUp.${method.level.id}`)}
                  label={t(`setup.level.${method.level.id}`)}
                  testId="sh-level"
                />
              </Box>
            )}
            {hasChain(method) && (
              <Box label={t(`setup.chain.${method.id as ChainMethod}`)} hint={method.id === "dexNav" ? t("setup.chainHintDexNav") : method.chainMax ? t("setup.chainHintWrap", { n: cap, max: method.chainMax }) : t("setup.chainHint", { n: cap })}>
                <div className="flex flex-wrap items-center gap-2">
                  <Stepper value={hunt.chain} min={0} max={method.chainMax ?? 9999} onChange={(v) => set({ chain: v })} downLabel={t("setup.chainDown")} upLabel={t("setup.chainUp")} label={t(`setup.chain.${method.id as ChainMethod}`)} testId="sh-chain" />
                  <button type="button" onClick={() => set({ chain: 0 })} disabled={!hunt.chain} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40">
                    <RotateCcw className="h-4 w-4" aria-hidden /> {t("setup.chainReset")}
                  </button>
                </div>
              </Box>
            )}
          </div>
        </div>
      )}

      {/* Tap feedback, and where the odds come from. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-foreground/[0.07] pt-4">
        <div className="flex flex-wrap gap-2">
          <Switch on={prefs.sound} onChange={(v) => onPref("sound", v)} label={t("prefs.sound")} icon={<Volume2 className="h-4 w-4" aria-hidden />} testId="sh-pref-sound" />
          <Switch on={prefs.haptics} onChange={(v) => onPref("haptics", v)} label={t("prefs.haptics")} icon={<Vibrate className="h-4 w-4" aria-hidden />} testId="sh-pref-haptics" />
        </div>
        <p className="max-w-md text-[12px] leading-relaxed text-muted-foreground/80">{t("setup.source")}</p>
      </div>
    </div>
  );
}

type ChainMethod = "chainFishing" | "sos" | "catchCombo" | "pokeRadar" | "dexNav";

function choiceLabel(t: Translator<typeof counter.en>, id: ChoiceId, option: string): string {
  if (id === "research") return t(`setup.researchOptions.${option as "none" | "lv10" | "perfect"}`);
  if (id === "sparkling") return t(`setup.sparklingOptions.${option as "0" | "1" | "2" | "3"}`);
  if (id === "battled") return t(`setup.battledOptions.${option as "1" | "50" | "100" | "200" | "300" | "500"}`);
  if (id === "rings") return t(`setup.ringsOptions.${option as "0" | "1" | "2" | "3"}`);
  return t(`setup.clearedOptions.${option as "0" | "30" | "60"}`);
}

function Box({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-[18px] border border-foreground/[0.09] bg-foreground/[0.02] p-3", wide && "sm:col-span-2")}>
      <p className="mb-2 text-[13px] font-semibold">{label}</p>
      {children}
      {hint && <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A bonus that's on or off, as a card that lights up. */
function Toggle({ on, onChange, label, icon, testId }: { on: boolean; onChange(v: boolean): void; label: string; icon: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "flex min-h-[60px] w-full items-center gap-3 rounded-[18px] border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-[hsl(var(--warning)/0.55)] bg-[hsl(var(--warning)/0.10)]" : "border-foreground/[0.09] bg-foreground/[0.02] hover:bg-foreground/[0.045]"
      )}
      data-testid={testId}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", on ? "bg-gradient-to-b from-[#ffe27a] to-[#f5a516] text-[#3a2200] shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)]" : "bg-foreground/[0.06] text-muted-foreground")}>{icon}</span>
      <span className="flex-1 text-[14.5px] font-semibold">{label}</span>
      <Knob on={on} />
    </button>
  );
}

function Knob({ on, small }: { on: boolean; small?: boolean }) {
  return (
    <span className={cn("relative shrink-0 rounded-full transition-colors motion-reduce:transition-none", small ? "h-5 w-9" : "h-7 w-12", on ? "bg-primary" : "bg-foreground/15")} aria-hidden>
      <span className={cn("absolute rounded-full bg-white shadow transition-transform motion-reduce:transition-none", small ? "top-0.5 h-4 w-4" : "top-1 h-5 w-5", on ? (small ? "translate-x-[18px]" : "translate-x-6") : small ? "translate-x-0.5" : "translate-x-1")} />
    </span>
  );
}

/** A small on/off pill (the tap feedback). */
export function Switch({ on, onChange, label, icon, testId }: { on: boolean; onChange(v: boolean): void; label: string; icon?: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="inline-flex h-10 items-center gap-2 rounded-full border border-foreground/[0.09] pl-3 pr-2 text-[13.5px] font-semibold text-foreground/85 transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={testId}
    >
      {icon && <span className="text-muted-foreground">{icon}</span>}
      {label}
      <Knob on={on} small />
    </button>
  );
}

/** − value + (the value types in too). */
export function Stepper({ value, min, max, step = 1, onChange, downLabel, upLabel, label, testId }: { value: number; min: number; max: number; step?: number; onChange(v: number): void; downLabel: string; upLabel: string; label?: string; testId?: string }) {
  const locale = useLocale();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
  return (
    <div className="inline-flex h-11 items-center rounded-full bg-foreground/[0.06] p-1 shadow-[inset_0_1px_2px_hsl(var(--shade)/0.25)]" data-testid={testId}>
      <button type="button" className="sh-tap flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground/80 shadow-[0_1px_0_hsl(var(--foreground)/0.06),0_2px_4px_-2px_hsl(var(--shade)/0.5)] transition-colors hover:text-foreground disabled:opacity-35" onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={downLabel} title={downLabel} data-testid={testId && `${testId}-down`}>
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label ?? `${downLabel} / ${upLabel}`}
        value={formatNumber(value, locale)}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          if (Number.isFinite(n)) onChange(clamp(n));
        }}
        onFocus={(e) => e.currentTarget.select()}
        className="sh-num h-9 w-16 bg-transparent text-center text-[16px] font-bold outline-none"
        data-testid={testId && `${testId}-value`}
      />
      <button type="button" className="sh-tap flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground/80 shadow-[0_1px_0_hsl(var(--foreground)/0.06),0_2px_4px_-2px_hsl(var(--shade)/0.5)] transition-colors hover:text-foreground disabled:opacity-35" onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={upLabel} title={upLabel} data-testid={testId && `${testId}-up`}>
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
