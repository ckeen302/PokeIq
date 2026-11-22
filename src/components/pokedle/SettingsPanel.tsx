"use client";

import { SlidersHorizontal } from "lucide-react";
import { DLE_COLUMNS } from "@/lib/dle-types";
import { DLE_FORMATS, DLE_GEN_COUNT, DLE_GUESS_CHOICES, DLE_MIN_COLUMNS, DLE_TIMERS, dleRules, type DleRules, type DleSettings } from "@/lib/dle-format";
import { localBonusText, localRulesTags } from "@/lib/dle-i18n";
import { useT } from "@/i18n/client";
import board from "@/messages/pokedle-board";
import { cn } from "@/lib/utils";

/**
 * Pokédle's format and advanced settings (practice games and the duels you
 * make): the format (Classic, Squirdle-style, Custom with its clue
 * columns), generations, guesses, hints, close states, timer and pool. All
 * of it is set before the first guess. The daily has fixed settings, so it
 * only shows the summary chip.
 */

const GEN_PRESETS = [
  { label: "presetAll", gens: [1, DLE_GEN_COUNT] },
  { label: "presetGen1", gens: [1, 1] },
  { label: "presetGen12", gens: [1, 2] },
  { label: "presetGen14", gens: [1, 4] },
] as const satisfies readonly { label: string; gens: [number, number] }[];

function Choice({ active, disabled, onClick, children, title }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        "rounded px-2 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground enabled:hover:text-foreground disabled:opacity-50"
      )}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center rounded-md border border-foreground/15 p-0.5" role="radiogroup" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/** The compact summary: "Squirdle · Gen 1–4 · 8 guesses · No dex". */
export function RulesChip({ rules, dex, hard, className }: { rules: DleRules; dex?: string; hard?: boolean; className?: string }) {
  const t = useT(board);
  const bonus = localBonusText(rules, t);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border border-screen/40 bg-screen/[0.06] px-3 py-1 text-xs font-semibold", className)}
      data-testid="rules-chip"
    >
      <SlidersHorizontal className="h-3.5 w-3.5 text-screen" aria-hidden />
      {localRulesTags(rules, t, { dex, hard }).join(" · ")}
      {bonus && <span className="font-normal text-success">{t("settings.bonusPts", { bonus })}</span>}
    </span>
  );
}

export function SettingsPanel({
  value,
  onChange,
  disabled,
  duel,
}: {
  value: DleSettings;
  onChange: (next: DleSettings) => void;
  disabled?: boolean;
  /** A duel: the generations are picked apart, and there's always a round clock. */
  duel?: boolean;
}) {
  const t = useT(board);
  const set = <K extends keyof DleSettings>(key: K, v: DleSettings[K]) => onChange({ ...value, [key]: v });
  const rules = dleRules(value);
  const squirdle = value.format === "squirdle";
  const ownGuesses = dleRules({ ...value, guesses: 0 }).maxGuesses;
  const [lo, hi] = value.gens;

  return (
    <section className="mx-auto max-w-xl space-y-2 rounded-lg border bg-card/60 p-3 text-left" aria-label={t("settings.label")}>
      <Row label={t("settings.format")}>
        {DLE_FORMATS.map((f) => (
          <Choice key={f} active={value.format === f} disabled={disabled} onClick={() => set("format", f)} title={t(`formatBlurb.${f}`)}>
            {t(`format.${f}`)}
          </Choice>
        ))}
      </Row>
      <p className="pl-[6.5rem] text-xs text-muted-foreground">{t(`formatBlurb.${value.format}`)}</p>

      {value.format === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 shrink-0 text-xs font-semibold text-muted-foreground">{t("settings.clues")}</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("settings.clueColumns")}>
            {DLE_COLUMNS.map((c) => {
              const on = value.columns.includes(c.key);
              const last = on && value.columns.length <= DLE_MIN_COLUMNS;
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled || last}
                  title={last ? t("settings.minClues", { n: DLE_MIN_COLUMNS }) : undefined}
                  onClick={() => set("columns", on ? value.columns.filter((k) => k !== c.key) : [...value.columns, c.key])}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs font-semibold disabled:cursor-not-allowed",
                    on ? "border-primary bg-primary/15 text-foreground" : "border-foreground/15 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(`column.${c.key}`)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!duel && (
        <div className="flex flex-wrap items-center gap-2">
          <Row label={t("settings.generations")}>
            {GEN_PRESETS.map((p) => (
              <Choice key={p.label} active={lo === p.gens[0] && hi === p.gens[1]} disabled={disabled} onClick={() => set("gens", [...p.gens])}>
                {t(`settings.${p.label}`)}
              </Choice>
            ))}
          </Row>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            {t("settings.gen")}
            <select
              aria-label={t("settings.firstGen")}
              disabled={disabled}
              value={lo}
              onChange={(e) => set("gens", [Number(e.target.value), Math.max(Number(e.target.value), hi)])}
              className="rounded border bg-background px-1 py-0.5"
            >
              {Array.from({ length: DLE_GEN_COUNT }, (_, k) => (
                <option key={k} value={k + 1}>
                  {k + 1}
                </option>
              ))}
            </select>
            {t("settings.to")}
            <select
              aria-label={t("settings.lastGen")}
              disabled={disabled}
              value={hi}
              onChange={(e) => set("gens", [Math.min(lo, Number(e.target.value)), Number(e.target.value)])}
              className="rounded border bg-background px-1 py-0.5"
            >
              {Array.from({ length: DLE_GEN_COUNT }, (_, k) => (
                <option key={k} value={k + 1}>
                  {k + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <Row label={t("settings.guesses")}>
        <Choice active={value.guesses === 0} disabled={disabled} onClick={() => set("guesses", 0)} title={squirdle ? t("settings.autoTitle") : undefined}>
          {t("settings.auto", { n: ownGuesses })}
        </Choice>
        {DLE_GUESS_CHOICES.map((n) => (
          <Choice key={n} active={value.guesses === n} disabled={disabled} onClick={() => set("guesses", n)}>
            {n}
          </Choice>
        ))}
      </Row>

      <Row label={t("settings.hints")}>
        <Choice active={value.hints} disabled={disabled} onClick={() => set("hints", true)}>
          {t("settings.on")}
        </Choice>
        <Choice active={!value.hints} disabled={disabled} onClick={() => set("hints", false)}>
          {t("settings.off")}
        </Choice>
      </Row>

      <Row label={t("settings.close")}>
        <Choice active={rules.close} disabled={disabled || squirdle} onClick={() => set("close", true)} title={squirdle ? t("settings.closeNever") : t("settings.closeTitle")}>
          {t("settings.on")}
        </Choice>
        <Choice active={!rules.close} disabled={disabled || squirdle} onClick={() => set("close", false)} title={t("settings.strictTitle")}>
          {t("settings.strict")}
        </Choice>
      </Row>

      <Row label={duel ? t("settings.roundClock") : t("settings.timer")}>
        {DLE_TIMERS.filter((timer) => !duel || timer !== "none").map((timer) => (
          <Choice key={timer} active={duel ? (timer === "60s") === (value.timer === "60s") : value.timer === timer} disabled={disabled} onClick={() => set("timer", timer)}>
            {t(`timer.${timer}`)}
          </Choice>
        ))}
      </Row>

      <Row label={t("settings.pool")}>
        <Choice active={value.pool === "all"} disabled={disabled} onClick={() => set("pool", "all")}>
          {t("settings.every")}
        </Choice>
        <Choice active={value.pool === "legendary"} disabled={disabled} onClick={() => set("pool", "legendary")}>
          {t("settings.legendary")}
        </Choice>
      </Row>
    </section>
  );
}
