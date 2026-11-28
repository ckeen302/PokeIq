"use client";

import { useMemo, useState } from "react";
import { Check, ExternalLink, Search, SkipForward, Sparkles, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { counts, dupeOf, isFree, type Run } from "@/lib/nuzlocke/run";
import { groupByMethod, levelSpan, type EncounterStat } from "@/lib/nuzlocke/group";
import { allAreas, inVersion, type GameView } from "@/lib/nuzlocke/view";
import type { EncounterKind } from "@/lib/nuzlocke/model";
import { Modal } from "../tier-list/ui";
import type { Act } from "./act";
import { Sprite, TypeChip, type NuzT } from "./parts";
import { methodIcon } from "./icons";

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** One line of a Pokémon's odds here: "1F 69%", "50%", then its levels. */
export function statText(t: NuzT, stats: readonly EncounterStat[]): string {
  const lines = [...new Set(stats.map((s) => [s.condition, s.rate !== undefined ? t("picker.rate", { n: s.rate }) : null].filter(Boolean).join(" ")).filter(Boolean))];
  const span = levelSpan(stats);
  if (span) lines.push(span[0] === span[1] ? t("picker.level", { n: span[0] }) : t("picker.levels", { min: span[0], max: span[1] }));
  return lines.join(" · ");
}

/**
 * The encounter picker (a sheet from the bottom on a phone, a dialog on a wider screen): only the Pokémon this area
 * gives in the run's version, by how they're met, with their odds and levels. The dupes clause marks a family already
 * caught, but leaves it to the player. Choose one, then say how it went: caught (shiny or not) or fainted / fled; or
 * skip the area. `extra`: the area's encounter is used, so only a free catch can be added (a shiny, a gift…).
 */
export function Picker({ t, run, view, area: areaId, extra, onClose, act }: { t: NuzT; run: Run; view: GameView; area: string; extra: boolean; onClose(): void; act: Act }) {
  const area = allAreas(view).find((a) => a.id === areaId)!;
  const groups = useMemo(() => groupByMethod(area.encounters.filter((e) => inVersion(e, run.version))), [area, run.version]);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<{ mon: string; kind: EncounterKind; level?: number } | null>(null);
  const [shinyOn, setShinyOn] = useState(false);
  const rows = groups.reduce((n, g) => n + g.rows.length, 0);
  const q = fold(query.trim());
  // In "extra" mode a Pokémon of a kind that counts can only come in as a shiny (the shiny clause).
  const forcedShiny = extra && !!chosen && counts(run.rules, chosen.kind);
  const shiny = forcedShiny || shinyOn;
  const free = !!chosen && isFree(run.rules, chosen.kind, shiny);
  const chosenMon = chosen ? view.mons[chosen.mon] : undefined;
  const catchHref = chosen && chosen.kind === "wild" && view.catchRate && chosenMon ? `/tools/catch-rate-calculator?p=${chosenMon.species}&g=${view.catchRate}${chosen.level ? `&l=${chosen.level}` : ""}` : null;

  return (
    <Modal title={area.name} onClose={onClose} closeLabel={t("picker.close")} wide testId="nz-picker">
      <p tabIndex={-1} data-autofocus className="-mt-1 text-[14.5px] text-muted-foreground outline-none">
        {extra ? t("picker.leadExtra") : t("picker.lead")}
      </p>
      {rows > 6 && (
        <div className="sticky top-0 z-10 -mx-6 bg-card px-6 pb-2 pt-3 max-sm:-mx-5 max-sm:px-5">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} type="search" placeholder={t("picker.search")} aria-label={t("picker.search")} className="h-11 w-full rounded-full border border-foreground/[0.1] bg-background pl-10 pr-4 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="nz-picker-search" />
          </label>
        </div>
      )}

      <div role="radiogroup" aria-label={t("picker.lead")} className="mt-3 space-y-4 pb-2">
        {groups.map((g) => {
          const shown = g.rows.filter((r) => !q || fold(view.mons[r.mon]?.name ?? "").includes(q));
          if (!shown.length) return null;
          const Icon = methodIcon(g.method, g.kind);
          const groupFree = !counts(run.rules, g.kind);
          return (
            <section key={`${g.kind}|${g.method}`} aria-label={g.method}>
              <h3 className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {g.method}
                </span>
                {groupFree && <span className="rounded-full bg-success/[0.14] px-2 py-0.5 text-[10.5px] normal-case tracking-normal text-success">{t("picker.free")}</span>}
              </h3>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {shown.map((r) => {
                  const mon = view.mons[r.mon];
                  if (!mon) return null;
                  const dupe = run.rules.dupes ? dupeOf(run, view, r.mon) : null;
                  const on = chosen?.mon === r.mon && chosen.kind === g.kind;
                  const disabled = extra && !groupFree && !run.rules.shiny;
                  const span = levelSpan(r.stats);
                  return (
                    <li key={r.mon}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={disabled}
                        onClick={() => setChosen(on ? null : { mon: r.mon, kind: g.kind, ...(span && { level: span[0] }) })}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-2xl border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 motion-reduce:transition-none",
                          on ? "border-primary/70 bg-primary/[0.08] shadow-[0_0_0_1px_hsl(var(--primary)/0.5)]" : "border-foreground/[0.07] hover:border-foreground/[0.18] hover:bg-foreground/[0.03]"
                        )}
                        data-testid={`nz-pick-${r.mon}`}
                        data-dupe={dupe ? "1" : "0"}
                      >
                        <Sprite art={mon.art} className="h-12 w-12 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[15px] font-bold leading-tight">{mon.name}</span>
                            {mon.types.map((ty) => (
                              <TypeChip key={ty} t={t} type={ty} size="sm" />
                            ))}
                          </span>
                          <span className="mt-0.5 block text-[12.5px] text-muted-foreground [font-variant-numeric:tabular-nums]">{statText(t, r.stats)}</span>
                          {dupe && (
                            <span className="mt-1 flex items-start gap-1 text-[12.5px] font-semibold leading-snug text-[hsl(var(--warning))]" data-testid="nz-dupe">
                              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                              {t(dupe.status === "dead" ? "picker.dupeDead" : "picker.dupe", { name: view.mons[dupe.mon]?.name ?? "?" })}
                            </span>
                          )}
                        </span>
                        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-foreground/[0.18]")} aria-hidden>
                          {on && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {q && groups.every((g) => !g.rows.some((r) => fold(view.mons[r.mon]?.name ?? "").includes(q))) && <p className="py-6 text-center text-[14.5px] text-muted-foreground">{t("picker.none")}</p>}
      </div>

      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 border-t border-foreground/[0.07] bg-card px-6 pb-5 pt-3.5 max-sm:-mx-5 max-sm:px-5 max-sm:pb-[max(16px,env(safe-area-inset-bottom))]" data-testid="nz-picker-footer">
        {chosen && chosenMon ? (
          <>
            <div className="flex items-center gap-3">
              <Sprite art={chosenMon.art} className="h-11 w-11 shrink-0" eager />
              <p className="min-w-0 flex-1 truncate text-[15px] font-bold">{t("picker.chosen", { name: chosenMon.name })}</p>
              {catchHref && (
                <a href={catchHref} target="_blank" rel="noopener" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground max-sm:px-2" data-testid="nz-catch-odds">
                  {t("picker.catchOdds")} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
              <button
                type="button"
                aria-pressed={shiny}
                disabled={forcedShiny}
                onClick={() => setShinyOn((s) => !s)}
                className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-100", shiny ? "bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))]" : "bg-foreground/[0.06] text-muted-foreground hover:text-foreground")}
                data-testid="nz-shiny"
              >
                <Sparkles className="h-4 w-4" aria-hidden /> {t("picker.shiny")}
              </button>
            </div>
            {shiny && run.rules.shiny && <p className="mt-2 text-[12.5px] font-semibold text-[hsl(var(--warning))]">{t("picker.shinyFree")}</p>}
            <div className={cn("mt-3 grid gap-2", free || extra ? "grid-cols-1" : "grid-cols-2")}>
              {!free && !extra && (
                <button type="button" onClick={() => act.failed(area.id, chosen.mon)} className="h-12 rounded-full bg-foreground/[0.07] text-[15px] font-bold transition-colors hover:bg-foreground/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="nz-failed">
                  {t("picker.failed")}
                </button>
              )}
              <button type="button" onClick={() => act.caught(area.id, chosen.mon, chosen.kind, shiny)} className="h-12 rounded-full bg-primary text-[15px] font-bold text-primary-foreground shadow-[0_3px_0_hsl(var(--primary-shadow))] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px" data-testid="nz-caught">
                {t("picker.caught")}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[14px] text-muted-foreground">{t("picker.choose")}</p>
            {!extra && (
              <button type="button" onClick={() => act.skip(area.id)} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-foreground/[0.07] px-4 text-[14px] font-semibold transition-colors hover:bg-foreground/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="nz-skip">
                <SkipForward className="h-4 w-4" aria-hidden /> {t("picker.skip")}
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
