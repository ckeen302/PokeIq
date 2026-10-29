"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import {
  CLAUSE_INFO,
  CLAUSES,
  CUSTOM_GENS,
  GIMMICK_INFO,
  GIMMICKS,
  LEVEL_MAX,
  LEVEL_MIN,
  TIMER_MAX,
  TIMER_MIN,
  gimmickAllowed,
  normalizeRules,
  type CustomRules,
} from "@/lib/battle/custom-rules";
import { PLAYABLE_FORMATS, type CatalogueFormat } from "@/lib/battle/format-catalogue";
import { cn } from "@/lib/utils";
import { FormatPicker } from "./FormatPicker";

/**
 * The custom ruleset: one of Showdown's own formats (the whole catalogue,
 * see FormatPicker), or the trainer's own: generation, level, gimmicks, clauses, team size, team
 * preview and (live battles) the turn timer. Every change is checked by
 * Pokémon Showdown on the server (/api/battle/rules), along with the team
 * picked, and Showdown's own messages are shown.
 */

export type RulesVerdict = { state: "checking" } | { state: "ok" } | { state: "bad"; errors: string[]; teamErrors: string[] };

const chip = (on: boolean) =>
  cn(
    "rounded-md border px-2.5 py-1.5 font-display text-xs font-bold uppercase tracking-wider transition-colors hover:border-screen/60 disabled:cursor-not-allowed disabled:opacity-40",
    on ? "border-primary bg-primary/15 text-foreground ring-1 ring-primary" : "bg-card text-muted-foreground"
  );

export function CustomRulesEditor({ rules, onChange, live }: { rules: CustomRules; onChange: (rules: CustomRules) => void; live: boolean }) {
  const set = (patch: Partial<CustomRules>) => onChange(normalizeRules({ ...rules, ...patch }));
  const gimmicks = GIMMICKS.filter((g) => gimmickAllowed(g, rules.gen));
  const showdown = !!rules.base;
  // The format picked last, kept while the trainer looks at their own rules.
  const [lastBase, setLastBase] = useState<CatalogueFormat | null>(null);
  const chooseFormat = (f: CatalogueFormat) => {
    setLastBase(f);
    set({ base: f.id, baseName: f.name, baseRandom: f.random, gen: f.gen as CustomRules["gen"] });
  };
  const fallback = PLAYABLE_FORMATS.find((f) => f.id === "gen9ou") ?? PLAYABLE_FORMATS[0];

  const modes = (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Rules">
      <button type="button" role="radio" aria-checked={showdown} className={chip(showdown)} data-testid="rules-mode-showdown" onClick={() => !showdown && chooseFormat(lastBase ?? fallback)}>
        Showdown format · {PLAYABLE_FORMATS.length}
      </button>
      <button type="button" role="radio" aria-checked={!showdown} className={chip(!showdown)} data-testid="rules-mode-own" onClick={() => showdown && set({ base: null })}>
        Your own rules
      </button>
    </div>
  );
  const timer = live && (
    <div className="space-y-1.5">
      <span className="hud-label">Turn timer</span>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className={chip(rules.timer)} aria-pressed={rules.timer} onClick={() => set({ timer: !rules.timer })}>
          {rules.timer ? "On" : "Off"}
        </button>
        {rules.timer && (
          <label className="flex items-center gap-1.5">
            <input
              type="number"
              min={TIMER_MIN}
              max={TIMER_MAX}
              step={10}
              value={rules.timerSeconds}
              onChange={(e) => set({ timerSeconds: Number(e.target.value) })}
              className="h-9 w-20 rounded-md border border-input bg-background px-2"
              aria-label="Seconds per turn"
            />
            seconds at most per turn
          </label>
        )}
      </div>
    </div>
  );

  if (showdown)
    return (
      <div className="space-y-4" data-testid="custom-rules">
        {modes}
        <p className="text-sm">
          <span className="hud-label mr-2">Playing</span>
          <span className="font-display font-bold uppercase" data-testid="picked-format">
            {rules.baseName ?? rules.base}
          </span>
          <span className="text-muted-foreground"> · {rules.baseRandom ? "random teams, dealt by the engine" : "bring a team that's legal in it"}</span>
        </p>
        <FormatPicker value={rules.base} onPick={chooseFormat} />
        {timer}
      </div>
    );

  return (
    <div className="space-y-4" data-testid="custom-rules">
      {modes}
      <div className="space-y-1.5">
        <span className="hud-label">Generation · mechanics, type chart, Pokémon and moves</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Generation">
          {CUSTOM_GENS.map((g) => (
            <button key={g} type="button" role="radio" aria-checked={rules.gen === g} data-testid={`gen-${g}`} className={chip(rules.gen === g)} onClick={() => set({ gen: g })}>
              Gen {g}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="custom-level" className="hud-label">
            Level
          </label>
          <div className="flex items-center gap-2">
            <input
              id="custom-level"
              type="number"
              min={LEVEL_MIN}
              max={LEVEL_MAX}
              value={rules.level}
              onChange={(e) => set({ level: Number(e.target.value) })}
              className="h-9 w-20 rounded-md border border-input bg-background px-2 text-sm"
            />
            <button type="button" className={chip(rules.levelMode === "fixed")} aria-pressed={rules.levelMode === "fixed"} onClick={() => set({ levelMode: "fixed" })}>
              Everyone at it
            </button>
            <button type="button" className={chip(rules.levelMode === "cap")} aria-pressed={rules.levelMode === "cap"} onClick={() => set({ levelMode: "cap" })}>
              Cap
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="hud-label">Team</span>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              Bring
              <select value={rules.teamSize} onChange={(e) => set({ teamSize: Number(e.target.value) })} className="h-9 rounded-md border border-input bg-background px-2" aria-label="Team size">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={chip(rules.pick !== null)}
              aria-pressed={rules.pick !== null}
              data-testid="team-preview-toggle"
              onClick={() => set({ pick: rules.pick === null ? Math.min(3, rules.teamSize) : null })}
            >
              Team preview
            </button>
            {rules.pick !== null && (
              <label className="flex items-center gap-1.5">
                pick
                <select value={rules.pick} onChange={(e) => set({ pick: Number(e.target.value) })} className="h-9 rounded-md border border-input bg-background px-2" aria-label="Pokémon picked">
                  {Array.from({ length: rules.teamSize }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="hud-label">Gimmicks</span>
        {gimmicks.length ? (
          <div className="flex flex-wrap gap-1.5">
            {gimmicks.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={rules.gimmicks[g]}
                className={chip(rules.gimmicks[g])}
                onClick={() => set({ gimmicks: { ...rules.gimmicks, [g]: !rules.gimmicks[g] } })}
              >
                {GIMMICK_INFO[g].name} {rules.gimmicks[g] ? "on" : "off"}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Gen {rules.gen} has no battle gimmick (Mega Evolution arrives in Gen 6, Z-Moves in 7, Dynamax in 8, Terastal in 9).</p>
        )}
      </div>

      <div className="space-y-1.5">
        <span className="hud-label">Clauses</span>
        <div className="flex flex-wrap gap-1.5">
          {CLAUSES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={rules.clauses[c]}
              title={CLAUSE_INFO[c].blurb}
              data-testid={`clause-${c}`}
              className={chip(rules.clauses[c])}
              onClick={() => set({ clauses: { ...rules.clauses, [c]: !rules.clauses[c] } })}
            >
              {CLAUSE_INFO[c].name}
            </button>
          ))}
        </div>
      </div>

      {timer}
    </div>
  );
}

/** Showdown's verdict on the ruleset (and team), re-checked shortly after each change. */
export function useRulesCheck(rules: CustomRules | null, team: string): RulesVerdict | null {
  const [verdict, setVerdict] = useState<RulesVerdict | null>(null);
  const key = rules ? JSON.stringify(rules) : "";
  useEffect(() => {
    if (!key) {
      setVerdict(null);
      return;
    }
    setVerdict({ state: "checking" });
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/battle/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules: JSON.parse(key), team: team || undefined }),
          signal: controller.signal,
        });
        const body = (await res.json()) as { ok?: boolean; errors?: string[]; teamErrors?: string[]; error?: string };
        if (body.ok) setVerdict({ state: "ok" });
        else setVerdict({ state: "bad", errors: body.errors ?? (body.error ? [body.error] : []), teamErrors: body.teamErrors ?? [] });
      } catch {
        if (!controller.signal.aborted) setVerdict(null);
      }
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [key, team]);
  return verdict;
}

export function RulesVerdictNote({ verdict }: { verdict: RulesVerdict | null }) {
  if (!verdict) return null;
  if (verdict.state === "checking")
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking with Pokémon Showdown…
      </p>
    );
  if (verdict.state === "ok")
    return (
      <p className="flex items-center gap-1.5 text-xs text-success" data-testid="rules-ok">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Rules and team check out.
      </p>
    );
  return (
    <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive" data-testid="rules-errors">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {verdict.errors.length ? "Pokémon Showdown can't use these rules:" : "Your team breaks these rules:"}
      </p>
      <ul className="list-disc space-y-0.5 pl-5">
        {[...verdict.errors, ...verdict.teamErrors].slice(0, 8).map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}
