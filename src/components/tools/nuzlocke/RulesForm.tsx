"use client";

import { Check } from "lucide-react";
import type { Rules } from "@/lib/nuzlocke/run";
import { Switch, type NuzT } from "./parts";

const CLAUSES = [
  ["dupes", "dupes", "dupesText"],
  ["shiny", "shiny", "shinyText"],
  ["gifts", "gifts", "giftsText"],
  ["statics", "statics", "staticsText"],
  ["caps", "caps", "capsText"],
] as const;

/** The rules: the three that make a Nuzlocke (always on, explained), then the clauses the player picks. */
export function RulesForm({ t, rules, onChange }: { t: NuzT; rules: Rules; onChange(r: Rules): void }) {
  return (
    <div className="space-y-5" data-testid="nz-rules">
      <section>
        <h3 className="mb-2 text-[12.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("rules.core")}</h3>
        <ul className="space-y-2 rounded-2xl bg-foreground/[0.04] p-3.5">
          {(["first", "faint", "nick"] as const).map((k) => (
            <li key={k} className="flex items-start gap-2.5 text-[14.5px] leading-snug">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success" aria-hidden>
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
              {t(`rules.${k}`)}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-1 text-[12.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{t("rules.clauses")}</h3>
        <div className="divide-y divide-foreground/[0.06]">
          {CLAUSES.map(([key, label, text]) => (
            <Switch key={key} checked={rules[key]} onChange={(v) => onChange({ ...rules, [key]: v })} label={t(`rules.${label}`)} text={t(`rules.${text}`)} testId={`nz-rule-${key}`} />
          ))}
        </div>
      </section>
    </div>
  );
}
