"use client";

import { Minus, Plus, RotateCcw, Sparkles } from "lucide-react";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import { useLocale } from "@/i18n/navigation";
import { formatNumber } from "@/i18n/format";
import counter from "@/messages/shiny-counter";
import { GAMES_NEWEST_FIRST, NO_BONUS, chainCap, charmApplies, getGame, getMethod, hasChain, shinyChance, type ChoiceId, type GameId, type MethodId } from "@/lib/shiny-hunt/odds";
import { oneIn } from "@/lib/shiny-hunt/math";
import { setOdds, type Hunt } from "@/lib/shiny-hunt/store";
import { cn } from "@/lib/utils";
import { Segmented } from "../tier-list/ui";

/** The hunt's game, method and bonuses, each showing what it does to the odds. */
export function Setup({ hunt, onChange }: { hunt: Hunt; onChange(h: Hunt): void }) {
  const t = useT(counter);
  const locale = useLocale();
  const game = getGame(hunt.game)!;
  const method = getMethod(hunt.game, hunt.method)!;
  const fmtOdds = (p: number) => t("counter.odds", { n: formatNumber(oneIn(p), locale) });
  const set = (patch: Parameters<typeof setOdds>[1]) => onChange(setOdds(hunt, patch));
  const gens = [...new Set(GAMES_NEWEST_FIRST.map((g) => g.gen))];
  const cap = chainCap(method);
  return (
    <div className="space-y-5" data-testid="sh-setup">
      <label className="block space-y-2">
        <span className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("setup.game")}</span>
        <select
          value={hunt.game}
          onChange={(e) => set({ game: e.target.value as GameId })}
          className="h-12 w-full cursor-pointer appearance-none rounded-2xl border border-foreground/[0.1] bg-background/60 bg-[length:16px] bg-[right_14px_center] bg-no-repeat px-4 pr-10 text-[16px] font-medium outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
          data-testid="sh-game"
        >
          {gens.map((gen) => (
            <optgroup key={gen} label={t("setup.gen", { n: gen })}>
              {GAMES_NEWEST_FIRST.filter((g) => g.gen === gen).map((g) => (
                <option key={g.id} value={g.id}>
                  {t(`games.${g.id}`)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="space-y-2">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground" id="sh-method-label">{t("setup.method")}</p>
        <div role="radiogroup" aria-labelledby="sh-method-label" className="grid gap-1.5">
          {game.methods.map((m) => {
            const on = m.id === hunt.method;
            const p = shinyChance(hunt.game, m.id, on ? hunt : { ...NO_BONUS, charm: hunt.charm });
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ method: m.id as MethodId })}
                className={cn(
                  "flex min-h-[52px] w-full items-center gap-3 rounded-2xl border px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "border-primary/50 bg-primary/[0.08]" : "border-foreground/[0.08] hover:bg-foreground/[0.04]"
                )}
                data-testid={`sh-method-${m.id}`}
              >
                <span className={cn("flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2", on ? "border-primary" : "border-foreground/25")} aria-hidden>
                  {on && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold leading-tight">{t(`methods.${m.id}`)}</span>
                  {on && <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{t(`methodHints.${m.id}`)}</span>}
                </span>
                <span className="sh-num shrink-0 text-[13px] font-semibold text-muted-foreground">{fmtOdds(p)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {(charmApplies(method) || method.lure) && (
        <div className="grid gap-1.5">
          {charmApplies(method) && <Switch on={hunt.charm} onChange={(v) => set({ charm: v })} label={t("setup.charm")} icon testId="sh-charm" />}
          {method.lure && <Switch on={hunt.lure} onChange={(v) => set({ lure: v })} label={t(method.lureKind === "diglett" ? "setup.diglett" : "setup.lure")} testId="sh-lure" />}
        </div>
      )}

      {(method.choices ?? []).map((c) => (
        <div key={c.id} className="space-y-2">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t(`setup.${c.id}`)}</p>
          <Segmented<string>
            size="sm"
            className="flex w-full"
            label={t(`setup.${c.id}`)}
            value={hunt.choices[c.id] ?? c.options[0].id}
            onChange={(v) => set({ choices: { ...hunt.choices, [c.id as ChoiceId]: v } })}
            options={c.options.map((o) => ({ value: o.id, label: choiceLabel(t, c.id, o.id), testId: `sh-choice-${c.id}-${o.id}` }))}
          />
        </div>
      ))}

      {method.level && (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground" id="sh-level-label">{t(`setup.level.${method.level.id}`)}</p>
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
          <p className="text-[13px] text-muted-foreground">{t(`setup.levelHint.${method.level.id}`)}</p>
        </div>
      )}

      {hasChain(method) && (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t(`setup.chain.${method.id as ChainMethod}`)}</p>
          <div className="flex items-center gap-2">
            <Stepper value={hunt.chain} min={0} max={method.chainMax ?? 9999} onChange={(v) => set({ chain: v })} downLabel={t("setup.chainDown")} upLabel={t("setup.chainUp")} label={t(`setup.chain.${method.id as ChainMethod}`)} testId="sh-chain" />
            <button type="button" onClick={() => set({ chain: 0 })} disabled={!hunt.chain} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40">
              <RotateCcw className="h-4 w-4" aria-hidden /> {t("setup.chainReset")}
            </button>
          </div>
          <p className="text-[13px] text-muted-foreground">{method.id === "dexNav" ? t("setup.chainHintDexNav") : method.chainMax ? t("setup.chainHintWrap", { n: cap, max: method.chainMax }) : t("setup.chainHint", { n: cap })}</p>
        </div>
      )}
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

export function Switch({ on, onChange, label, icon, testId }: { on: boolean; onChange(v: boolean): void; label: string; icon?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-foreground/[0.08] px-4 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={testId}
    >
      {icon && <Sparkles className={cn("h-[18px] w-[18px] shrink-0", on ? "text-[hsl(var(--warning))]" : "text-muted-foreground")} aria-hidden />}
      <span className="flex-1 text-[15px] font-semibold">{label}</span>
      <span className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors motion-reduce:transition-none", on ? "bg-primary" : "bg-foreground/15")} aria-hidden>
        <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none", on ? "translate-x-6" : "translate-x-1")} />
      </span>
    </button>
  );
}

/** − value + (the value types in too). */
export function Stepper({ value, min, max, step = 1, onChange, downLabel, upLabel, label, testId }: { value: number; min: number; max: number; step?: number; onChange(v: number): void; downLabel: string; upLabel: string; label?: string; testId?: string }) {
  const locale = useLocale();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
  return (
    <div className="inline-flex h-11 items-center rounded-full bg-foreground/[0.06] p-1" data-testid={testId}>
      <button type="button" className="sh-side flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-foreground/[0.08] disabled:opacity-35" onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={downLabel} title={downLabel} data-testid={testId && `${testId}-down`}>
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
        className="sh-num h-9 w-16 bg-transparent text-center text-[16px] font-semibold outline-none"
        data-testid={testId && `${testId}-value`}
      />
      <button type="button" className="sh-side flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-foreground/[0.08] disabled:opacity-35" onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={upLabel} title={upLabel} data-testid={testId && `${testId}-up`}>
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
