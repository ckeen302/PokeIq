"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { CustomRules } from "@/lib/battle/custom-rules";

/** Pokémon Showdown's word on a custom ruleset and the team picked for it (see CustomRulesEditor). */
export type RulesVerdict = { state: "checking" } | { state: "ok" } | { state: "bad"; errors: string[]; teamErrors: string[] };

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
