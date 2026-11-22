"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import type { FormatDex } from "@/lib/battle/dex";
import { hasTera } from "@/lib/battle/formats";
import { coverageChart, multiplierLabel } from "@/lib/battle/coverage";
import type { TeamSet } from "@/lib/battle/sets";
import { matchupLine, threatReports, type ThreatReport } from "@/lib/battle/threats";
import { popularSets, USAGE_SOURCE, type UsageFile } from "@/lib/battle/usage";
import { cn } from "@/lib/utils";
import { BattleSprite } from "./BattleSprite";
import { Toggle } from "./controls";
import { useCalc, useSpriteLookup, useUsage } from "./hooks";
import { BattleType } from "./pickers";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import teamInsights from "@/messages/battle-team-insights";
import { useBattleNames, type BattleNames } from "./use-battle-names";

type InsightsT = Translator<typeof teamInsights.en>;

/**
 * Under the team: its type chart (weaknesses, resistances and immunities
 * per type, and what its attacks hit super-effectively) and the format's
 * common Pokémon it struggles against, worked out with the damage calc.
 */
export function TeamInsights({ dex, sets }: { dex: FormatDex; sets: TeamSet[] }) {
  const usage = useUsage(dex.format.id);
  if (!sets.length) return null;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <CoverageGrid dex={dex} sets={sets} />
      <Threats dex={dex} sets={sets} usage={usage} />
    </div>
  );
}

const cellTone = (x: number | null) =>
  x === null
    ? "text-muted-foreground"
    : x === 0
      ? "bg-screen/25 text-screen font-bold"
      : x >= 4
        ? "bg-destructive/45 text-destructive-foreground font-bold"
        : x > 1
          ? "bg-destructive/25 text-destructive font-semibold"
          : x < 1
            ? "bg-success/20 text-success font-semibold"
            : "text-muted-foreground/60";

function CoverageGrid({ dex, sets }: { dex: FormatDex; sets: TeamSet[] }) {
  const sprite = useSpriteLookup();
  const t = useT(teamInsights);
  const names = useBattleNames();
  const teraOk = hasTera(dex.format);
  const [tera, setTera] = useState(false);
  const chart = useMemo(() => coverageChart(dex.gen, sets, { tera: tera && teraOk }, t, names), [dex.gen, sets, tera, teraOk, t, names]);
  const th = "px-1.5 py-1 text-center hud-label normal-case tracking-wide";
  return (
    <section className="hud rounded-lg border bg-card p-4" data-testid="coverage-chart" aria-label={t("coverage.label")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-bold uppercase tracking-wider">{t("coverage.heading")}</h3>
        {teraOk && (
          <Toggle pressed={tera} onChange={setTera} className="h-8 px-2.5 text-xs">
            {t("coverage.tera")}
          </Toggle>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-xs tabular-nums">
          <thead>
            <tr>
              <th className={cn(th, "text-left")}>{t("coverage.type")}</th>
              {sets.map((s, i) => (
                <th key={i} className={th} title={s.name || names.species(s.species)}>
                  <BattleSprite species={sprite?.(s.species)} animated={false} size={32} className="mx-auto" />
                </th>
              ))}
              <th className={th} title={t("coverage.weakTitle")}>
                {t("coverage.weak")}
              </th>
              <th className={th} title={t("coverage.resistTitle")}>
                {t("coverage.resist")}
              </th>
              <th className={th} title={t("coverage.immuneTitle")}>
                {t("coverage.immune")}
              </th>
              <th className={th} title={t("coverage.seTitle")}>
                {t("coverage.se")}
              </th>
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row) => (
              <tr key={row.type} data-type={row.type}>
                <td className="pr-1">
                  <BattleType type={row.type} />
                </td>
                {row.taken.map((x, i) => (
                  <td key={i} className={cn("rounded-sm px-1 py-0.5 text-center", cellTone(x))}>
                    {x === null ? "?" : x === 1 ? "·" : multiplierLabel(x)}
                  </td>
                ))}
                <td className={cn("text-center font-bold", row.weak >= 3 ? "text-destructive" : row.weak > 0 ? "text-warning" : "text-muted-foreground/60")}>{row.weak}</td>
                <td className={cn("text-center", row.resist ? "text-success" : "text-muted-foreground/60")}>{row.resist}</td>
                <td className={cn("text-center", row.immune ? "text-screen" : "text-muted-foreground/60")}>{row.immune}</td>
                <td
                  className={cn("text-center font-semibold", row.superEffective ? "text-success" : row.best < 1 ? "text-destructive" : "text-muted-foreground")}
                  title={row.hitters.join("\n") || (row.best < 1 ? t("coverage.nothingNeutral") : t("coverage.nothingSe"))}
                  data-testid={`coverage-se-${row.type}`}
                >
                  {row.superEffective || (row.best < 1 ? "✕" : "0")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chart.notes.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{t("coverage.abilities", { notes: chart.notes.join(" · ") })}</p>}
      <p className="mt-1 text-xs text-muted-foreground">{t("coverage.help")}</p>
    </section>
  );
}

const THREATS_CHECKED = 15;
const THREATS_SHOWN = 5;

function Threats({ dex, sets, usage }: { dex: FormatDex; sets: TeamSet[]; usage: UsageFile | null }) {
  const calc = useCalc(dex.gen.num);
  const t = useT(teamInsights);
  const names = useBattleNames();
  const [reports, setReports] = useState<{ key: string; list: ThreatReport[] } | null>(null);
  const key = JSON.stringify(sets);

  useEffect(() => {
    if (!calc || !usage) return;
    const timer = setTimeout(() => {
      const own = new Set(sets.map((s) => s.species));
      const threats = usage.pokemon
        .filter((m) => !own.has(m.species) && dex.gen.species.get(m.species))
        .slice(0, THREATS_CHECKED)
        .flatMap((m) => {
          const [first] = popularSets(m, { level: dex.format.level, tera: false, isStatus: (mv) => dex.gen.moves.get(mv)?.category === "Status" });
          return first ? [{ set: first.set, label: first.label, usage: m.usage }] : [];
        });
      try {
        setReports({ key, list: threatReports(calc, sets, threats) });
      } catch {
        setReports({ key, list: [] });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [calc, usage, sets, key, dex]);

  const struggling = reports?.key === key ? reports.list.filter((r) => r.struggles).slice(0, THREATS_SHOWN) : null;
  return (
    <section className="hud rounded-lg border bg-card p-4" data-testid="threat-list" aria-label={t("threats.label")}>
      <h3 className="mb-1 font-display text-sm font-bold uppercase tracking-wider">{t("threats.heading", { format: dex.format.name })}</h3>
      {!usage ? (
        <p className="text-sm text-muted-foreground">{t("threats.noUsage")}</p>
      ) : !struggling ? (
        <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {t("threats.running")}
        </p>
      ) : struggling.length === 0 ? (
        <p className="flex items-center gap-2 py-2 text-sm text-success">
          <ShieldCheck className="h-4 w-4" aria-hidden /> {t("threats.none", { n: THREATS_CHECKED })}
        </p>
      ) : (
        <ul className="space-y-2">
          {struggling.map((r) => (
            <ThreatRow key={r.species} report={r} t={t} names={names} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {t("threats.help", { n: THREATS_CHECKED, source: USAGE_SOURCE, stats: usage ? "yes" : "none", battles: usage?.battles ?? 0, fetched: usage?.fetched ?? "" })}
      </p>
    </section>
  );
}

function ThreatRow({ report, t, names }: { report: ThreatReport; t: InsightsT; names: BattleNames }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-destructive/30 bg-destructive/5">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" aria-expanded={open}>
        <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <span className="flex-1">
          {t.rich("threats.struggles", { species: names.species(report.species), b: (c) => <strong>{c}</strong> })}
          <span className="block text-xs text-muted-foreground">
            {t("threats.share", { set: report.setLabel, pct: (report.usage * 100).toFixed(1) })}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul className="space-y-0.5 border-t border-destructive/20 px-3 py-2 text-xs text-muted-foreground">
          {report.matchups.map((m) => (
            <li key={m.member}>{matchupLine(m, t, names)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
