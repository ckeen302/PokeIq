"use client";

import { SlidersHorizontal } from "lucide-react";
import { DLE_COLUMNS } from "@/lib/dle-types";
import {
  DLE_FORMATS,
  DLE_FORMAT_BLURB,
  DLE_FORMAT_LABEL,
  DLE_GEN_COUNT,
  DLE_GUESS_CHOICES,
  DLE_MIN_COLUMNS,
  DLE_TIMERS,
  DLE_TIMER_LABEL,
  bonusText,
  dleRules,
  rulesTags,
  type DleRules,
  type DleSettings,
} from "@/lib/dle-format";
import { cn } from "@/lib/utils";

/**
 * Pokédle's format and advanced settings (practice games and the duels you
 * make): the format (Classic, Squirdle-style, Custom with its clue
 * columns), generations, guesses, hints, close states, timer and pool. All
 * of it is set before the first guess. The daily has fixed settings, so it
 * only shows the summary chip.
 */

const GEN_PRESETS: { label: string; gens: [number, number] }[] = [
  { label: "All gens", gens: [1, DLE_GEN_COUNT] },
  { label: "Gen 1 only", gens: [1, 1] },
  { label: "Gen 1–2", gens: [1, 2] },
  { label: "Gen 1–4", gens: [1, 4] },
];

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
  const bonus = bonusText(rules);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border border-screen/40 bg-screen/[0.06] px-3 py-1 text-xs font-semibold", className)}
      data-testid="rules-chip"
    >
      <SlidersHorizontal className="h-3.5 w-3.5 text-screen" aria-hidden />
      {rulesTags(rules, { dex, hard }).join(" · ")}
      {bonus && <span className="font-normal text-success">{bonus} pts</span>}
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
  const set = <K extends keyof DleSettings>(key: K, v: DleSettings[K]) => onChange({ ...value, [key]: v });
  const rules = dleRules(value);
  const squirdle = value.format === "squirdle";
  const ownGuesses = dleRules({ ...value, guesses: 0 }).maxGuesses;
  const [lo, hi] = value.gens;

  return (
    <section className="mx-auto max-w-xl space-y-2 rounded-lg border bg-card/60 p-3 text-left" aria-label="Game settings">
      <Row label="Format">
        {DLE_FORMATS.map((f) => (
          <Choice key={f} active={value.format === f} disabled={disabled} onClick={() => set("format", f)} title={DLE_FORMAT_BLURB[f]}>
            {DLE_FORMAT_LABEL[f]}
          </Choice>
        ))}
      </Row>
      <p className="pl-[6.5rem] text-xs text-muted-foreground">{DLE_FORMAT_BLURB[value.format]}</p>

      {value.format === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 shrink-0 text-xs font-semibold text-muted-foreground">Clues</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Clue columns">
            {DLE_COLUMNS.map((c) => {
              const on = value.columns.includes(c.key);
              const last = on && value.columns.length <= DLE_MIN_COLUMNS;
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled || last}
                  title={last ? `At least ${DLE_MIN_COLUMNS} clues` : undefined}
                  onClick={() => set("columns", on ? value.columns.filter((k) => k !== c.key) : [...value.columns, c.key])}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs font-semibold disabled:cursor-not-allowed",
                    on ? "border-primary bg-primary/15 text-foreground" : "border-foreground/15 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!duel && (
        <div className="flex flex-wrap items-center gap-2">
          <Row label="Generations">
            {GEN_PRESETS.map((p) => (
              <Choice key={p.label} active={lo === p.gens[0] && hi === p.gens[1]} disabled={disabled} onClick={() => set("gens", p.gens)}>
                {p.label}
              </Choice>
            ))}
          </Row>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Gen
            <select
              aria-label="First generation"
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
            to
            <select
              aria-label="Last generation"
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

      <Row label="Guesses">
        <Choice active={value.guesses === 0} disabled={disabled} onClick={() => set("guesses", 0)} title={squirdle ? "Stats' count: 5 for one generation, up to 9 for all" : undefined}>
          Auto ({ownGuesses})
        </Choice>
        {DLE_GUESS_CHOICES.map((n) => (
          <Choice key={n} active={value.guesses === n} disabled={disabled} onClick={() => set("guesses", n)}>
            {n}
          </Choice>
        ))}
      </Row>

      <Row label="Hints">
        <Choice active={value.hints} disabled={disabled} onClick={() => set("hints", true)}>
          On
        </Choice>
        <Choice active={!value.hints} disabled={disabled} onClick={() => set("hints", false)}>
          Off
        </Choice>
      </Row>

      <Row label="Close states">
        <Choice active={rules.close} disabled={disabled || squirdle} onClick={() => set("close", true)} title={squirdle ? "Stats never has close states" : "Yellow ▲ / ▼ for near misses"}>
          On
        </Choice>
        <Choice active={!rules.close} disabled={disabled || squirdle} onClick={() => set("close", false)} title="Strict: ▲ / ▼ only">
          Strict (▲ / ▼ only)
        </Choice>
      </Row>

      <Row label={duel ? "Round clock" : "Timer"}>
        {DLE_TIMERS.filter((t) => !duel || t !== "none").map((t) => (
          <Choice key={t} active={duel ? (t === "60s") === (value.timer === "60s") : value.timer === t} disabled={disabled} onClick={() => set("timer", t)}>
            {DLE_TIMER_LABEL[t]}
          </Choice>
        ))}
      </Row>

      <Row label="Pool">
        <Choice active={value.pool === "all"} disabled={disabled} onClick={() => set("pool", "all")}>
          Every Pokémon
        </Choice>
        <Choice active={value.pool === "legendary"} disabled={disabled} onClick={() => set("pool", "legendary")}>
          Legendaries only
        </Choice>
      </Row>
    </section>
  );
}
