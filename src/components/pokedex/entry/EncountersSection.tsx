"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { VERSION_BY_KEY, type EncGen, type EncRow } from "@/lib/pokemon/encounter-types";
import { cn } from "@/lib/utils";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const TIMES = ["Morning", "Day", "Night"];

/**
 * Where to catch this Pokémon, grouped by generation (newest open, older ones
 * collapsed). Games whose rows are identical share one row; rates that change
 * with the time of day get Morning / Day / Night columns.
 */
export function EncountersSection({ gens, name }: { gens: EncGen[]; name: string }) {
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
        const places = gen.rows.filter((r) => r.loc).length;
        return (
          <div key={gen.g} className="overflow-hidden rounded-md border border-foreground/10">
            <button
              type="button"
              onClick={() => toggle(gen.g)}
              aria-expanded={isOpen}
              aria-controls={`enc-gen-${gen.g}`}
              className="flex w-full items-center gap-3 bg-shade/30 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-pixel text-[10px] uppercase tracking-wider text-primary">Gen {ROMAN[gen.g]}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {places ? `${places} ${places === 1 ? "way" : "ways"} to find ${name}` : `${name} isn't found in the wild`}
              </span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
            </button>
            {isOpen && (
              <div id={`enc-gen-${gen.g}`} className="overflow-x-auto" data-hscroll>
                <GenTable rows={gen.rows} />
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">
        Gens 1–7 from PokéAPI, Let&apos;s Go and Gens 8–9 from Serebii. Rates are the chance per encounter in that spot; Gen 8–9 raids and overview-only spots list no levels or rates. Tap a place to find it on the atlas.
      </p>
    </div>
  );
}

function GenTable({ rows }: { rows: EncRow[] }) {
  const timed = rows.some((r) => r.t);
  return (
    <table className="w-full min-w-[34rem] text-sm">
      <thead>
        <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <th className="p-2" rowSpan={timed ? 2 : 1}>
            Games
          </th>
          <th className="p-2" rowSpan={timed ? 2 : 1}>
            Location
          </th>
          <th className="p-2" rowSpan={timed ? 2 : 1}>
            Method
          </th>
          <th className="p-2" rowSpan={timed ? 2 : 1}>
            Levels
          </th>
          <th className={cn("p-2", timed ? "text-center" : "text-right")} colSpan={timed ? 3 : 1}>
            Rate
          </th>
        </tr>
        {timed && (
          <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
            {TIMES.map((t) => (
              <th key={t} className="px-2 pb-1 text-right font-normal">
                {t}
              </th>
            ))}
          </tr>
        )}
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-foreground/5 align-top transition-colors hover:bg-foreground/[0.03]">
            <td className="p-2">
              <Badges versions={r.v} />
            </td>
            {r.x ? (
              <td colSpan={timed ? 6 : 4} className="p-2 text-xs italic text-muted-foreground">
                {r.x}
              </td>
            ) : (
              <>
                <td className="p-2 font-semibold">
                  {r.a ? (
                    <Link href={`/atlas?q=${encodeURIComponent(r.a)}`} className="underline-offset-2 hover:text-primary hover:underline">
                      {r.loc}
                    </Link>
                  ) : (
                    r.loc
                  )}
                  {r.n && <div className="text-[11px] font-normal text-muted-foreground">{r.n}</div>}
                </td>
                <td className="p-2">{r.m}</td>
                <td className="p-2 font-mono text-xs tabular-nums">{r.lv ?? "—"}</td>
                {r.t ? (
                  r.t.map((v, k) => (
                    <td key={k} className="p-2 text-right font-mono text-xs tabular-nums">
                      {v}
                    </td>
                  ))
                ) : (
                  <td colSpan={timed ? 3 : 1} className={cn("p-2 font-mono text-xs tabular-nums", timed ? "text-center" : "text-right")}>
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

function Badges({ versions }: { versions: string[] }) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {versions.map((key) => {
        const v = VERSION_BY_KEY[key];
        if (!v) return null;
        return (
          <span
            key={key}
            title={v.name}
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
