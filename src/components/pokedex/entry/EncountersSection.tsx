"use client";

import { useState } from "react";
import Link from "@/components/ui/Link";
import { slugFromKey } from "@/lib/dex/places";
import { ChevronDown } from "lucide-react";
import { VERSION_BY_KEY, genColumns, genSummary, type EncGen, type EncRow } from "@/lib/pokemon/encounter-types";
import { cn } from "@/lib/utils";
import type { DexEntryLocal } from "@/lib/pokemon/dex-types";
import { useT } from "@/i18n/client";
import dexEntryNs from "@/messages/dex-entry";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const TIMES = ["morning", "day", "night"] as const;

/**
 * Where to catch this Pokémon, grouped by generation (newest open, older ones
 * collapsed). Games whose rows are identical share one row; rates that change
 * with the time of day get Morning / Day / Night columns.
 */
export function EncountersSection({ gens, name, local }: { gens: EncGen[]; name: string; local?: DexEntryLocal }) {
  const t = useT(dexEntryNs);
  const [open, setOpen] = useState<Set<number>>(() => new Set(gens.length ? [gens[0].g] : []));
  const toggle = (g: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  return (
    <div className="space-y-3 hud rounded-lg border bg-card p-4">
      {gens.map((gen) => {
        const isOpen = open.has(gen.g);
        return (
          <div key={gen.g} className="overflow-hidden rounded-md border border-foreground/10">
            <button
              type="button"
              onClick={() => toggle(gen.g)}
              aria-expanded={isOpen}
              aria-controls={`enc-gen-${gen.g}`}
              className="flex w-full items-center gap-3 bg-shade/30 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-pixel text-[10px] uppercase tracking-wider text-primary">{t("enc.gen", { n: ROMAN[gen.g] })}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {local ? localSummary(local.encKinds[gen.g], gen.rows.length, name) : genSummary(gen, name)}
              </span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
            </button>
            {isOpen && (
              <div id={`enc-gen-${gen.g}`} className="overflow-x-auto" data-hscroll>
                <GenTable rows={gen.rows} versions={local?.versions} />
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">
        {t("enc.note")}
      </p>
    </div>
  );

  function localSummary(kind: DexEntryLocal["encKinds"][number] | undefined, n: number, who: string): string {
    if (kind === "notInGames") return t("enc.notInGames", { name: who });
    if (kind === "notWild") return t("enc.notWild", { name: who });
    return t("enc.entries", { n, name: who });
  }
}

function GenTable({ rows, versions }: { rows: EncRow[]; versions?: Record<string, string> }) {
  const t = useT(dexEntryNs);
  // Columns no row in this generation fills are left out entirely.
  const { levels: showLv, rate: showRate, timed } = genColumns(rows);
  const dataCols = 2 + (showLv ? 1 : 0) + (showRate ? (timed ? 3 : 1) : 0);
  return (
    <table className="w-full min-w-[34rem] text-sm max-md:block max-md:min-w-0">
      <thead className="max-md:hidden">
        <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <th className="p-2" rowSpan={timed ? 2 : 1}>
            {t("enc.games")}
          </th>
          <th className="p-2" rowSpan={timed ? 2 : 1}>
            {t("enc.location")}
          </th>
          <th className="p-2" rowSpan={timed ? 2 : 1}>
            {t("enc.method")}
          </th>
          {showLv && (
            <th className="p-2" rowSpan={timed ? 2 : 1}>
              {t("enc.levels")}
            </th>
          )}
          {showRate && (
            <th className={cn("p-2", timed ? "text-center" : "text-right")} colSpan={timed ? 3 : 1}>
              {t("enc.rate")}
            </th>
          )}
        </tr>
        {timed && (
          <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
            {TIMES.map((time) => (
              <th key={time} className="px-2 pb-1 text-right font-normal">
                {t(`enc.${time}`)}
              </th>
            ))}
          </tr>
        )}
      </thead>
      <tbody className="max-md:block">
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-foreground/5 align-top transition-colors hover:bg-foreground/[0.03] max-md:flex max-md:flex-wrap max-md:items-baseline max-md:pb-1.5">
            <td className="p-2 max-md:w-[4.75rem] max-md:shrink-0">
              <Badges versions={r.v} names={versions} />
            </td>
            {r.x ? (
              <td colSpan={dataCols} className="p-2 text-xs italic text-muted-foreground max-md:min-w-0 max-md:flex-1">
                {r.x}
              </td>
            ) : (
              <>
                <td className="p-2 font-semibold max-md:min-w-0 max-md:basis-[calc(100%-4.75rem)]">
                  {r.a && slugFromKey(r.a) ? (
                    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
                      <Link href={`/pokedex/places/${slugFromKey(r.a)}`} data-testid="enc-place-link" className="underline-offset-2 hover:text-primary hover:underline">
                        {r.loc}
                      </Link>
                      <Link href={`/atlas?q=${encodeURIComponent(r.a)}`} className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground hover:text-primary" aria-label={t("enc.findOn", { place: r.loc ?? "" })}>
                        {t("enc.atlas")}
                      </Link>
                    </span>
                  ) : r.p && slugFromKey(r.p) ? (
                    <Link href={`/pokedex/places/${slugFromKey(r.p)}`} data-testid="enc-place-link" className="underline-offset-2 hover:text-primary hover:underline">
                      {r.loc}
                    </Link>
                  ) : (
                    r.loc
                  )}
                  {r.n && <div className="text-[11px] font-normal text-muted-foreground">{r.n}</div>}
                </td>
                <td className="p-2 max-md:ml-[4.75rem] max-md:py-0 max-md:text-[13px] max-md:text-muted-foreground">{r.m}</td>
                {showLv && <td className="p-2 font-mono text-xs tabular-nums max-md:py-0 max-md:before:mr-1 max-md:before:font-sans max-md:before:text-muted-foreground max-md:before:content-['Lv']">{r.lv ?? "—"}</td>}
                {!showRate ? null : r.t ? (
                  r.t.map((v, k) => (
                    <td key={k} data-label={t(`enc.${TIMES[k]}`)} className="p-2 text-right font-mono text-xs tabular-nums max-md:py-0 max-md:before:mr-1 max-md:before:font-sans max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]">
                      {v}
                    </td>
                  ))
                ) : (
                  <td colSpan={timed ? 3 : 1} className={cn("p-2 font-mono text-xs tabular-nums max-md:py-0", timed ? "text-center" : "text-right")}>
                    {r.r ?? "—"}
                  </td>
                )}
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** `names`: the games' names in the page's language, for the badges' titles (English: their own names). */
export function Badges({ versions, names }: { versions: string[]; names?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {versions.map((key) => {
        const v = VERSION_BY_KEY[key];
        if (!v) return null;
        return (
          <span
            key={key}
            title={names?.[key] ?? v.name}
            className={cn("inline-flex h-5 min-w-6 items-center justify-center rounded-sm px-1 text-[10px] font-bold leading-none", v.dark ? "text-black/80" : "text-white")}
            style={{ background: v.bg }}
          >
            {v.abbr}
          </span>
        );
      })}
    </div>
  );
}
