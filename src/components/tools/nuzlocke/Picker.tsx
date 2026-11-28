"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { Check, ExternalLink, Search, SkipForward, Sparkles, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { counts, dupeOf, isFree, type Run } from "@/lib/nuzlocke/run";
import { groupByMethod, levelSpan, methodLabel, postStats, sameButLevels, storyStats, type EncounterStat } from "@/lib/nuzlocke/group";
import { allAreas, inVersion, type GameView } from "@/lib/nuzlocke/view";
import type { EncounterKind } from "@/lib/nuzlocke/model";
import type { Act } from "./act";
import { AddOnTag, Sheet, Sprite, TypeChip, type NuzT } from "./parts";
import { methodIcon } from "./icons";

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Each of some lines' condition and odds: one of the data's own ("1F 69%") or a summary's ("Main Area · 1–20%"). */
function oddsTexts(t: NuzT, stats: readonly EncounterStat[]): string[] {
  return [
    ...new Set(
      stats
        .map((s) => {
          const rate = s.rate === undefined ? null : s.rateMin !== undefined ? t("picker.rates", { min: s.rateMin, max: s.rate }) : t("picker.rate", { n: s.rate });
          // A line summed up from several reads "condition · range"; one of the data's own, "1F 69%".
          return [s.condition, rate].filter(Boolean).join(s.when || s.rateMin !== undefined ? " · " : " ");
        })
        .filter(Boolean)
    ),
  ];
}

function levelText(t: NuzT, stats: readonly EncounterStat[]): string | null {
  const span = levelSpan(stats);
  return span ? (span[0] === span[1] ? t("picker.level", { n: span[0] }) : t("picker.levels", { min: span[0], max: span[1] })) : null;
}

/** One line of a Pokémon's odds here: "1F 69%", "50%", "Main Area · 1–20%", then its levels. */
export function statText(t: NuzT, stats: readonly EncounterStat[]): string {
  return [...oddsTexts(t, stats), levelText(t, stats)].filter(Boolean).join(" · ");
}

/**
 * A Pokémon's post-game lines, each on its own: they're never summed up with the story's, whose levels a player mid-run
 * needs on their own. When only the levels differ from the story's, that's all one says: "After the Hall of Fame: Lv 60";
 * otherwise it says it all: "After the Hall of Fame: Rain · 20% · Lv 60".
 */
export function postText(t: NuzT, stats: readonly EncounterStat[]): string[] {
  const story = storyStats(stats);
  const by = new Map<string, EncounterStat[]>();
  for (const s of postStats(stats)) by.set(s.post!, [...(by.get(s.post!) ?? []), s]);
  return [...by].map(([post, lines]) => {
    // A post-game line is there for its levels: when they aren't known, it says so.
    const level = levelText(t, lines) ?? t("picker.noLevel");
    const text = sameButLevels(lines, story) ? level : [...new Set(lines.flatMap((s) => s.when ?? []))].concat(oddsTexts(t, lines), level).join(" · ");
    return t("picker.post", { when: post, text });
  });
}

/** How many of a Pokémon's conditions show before "+3 more" (all of them once it's chosen). */
const WHEN_SHOWN = 3;
/** A line longer than this (a note on where it spawns) shows in two lines until the row is chosen. */
const NOTE_SHOWN = 80;

/**
 * One Pokémon in the picker. Memoised: a big area (Sword & Shield's Wild Area) lists a hundred or more, and choosing one
 * should redraw two rows, not all of them.
 */
const PickRow = memo(function PickRow({
  t,
  mon,
  stats,
  dupe,
  on,
  disabled,
  onPick,
}: {
  t: NuzT;
  mon: GameView["mons"][string];
  stats: readonly EncounterStat[];
  dupe: string | null;
  on: boolean;
  disabled: boolean;
  onPick(): void;
}) {
  // The story's lines lead; the post-game ones follow, muted (or lead, muted, when there are only those).
  const story = useMemo(() => storyStats(stats), [stats]);
  const when = useMemo(() => [...new Set(story.flatMap((s) => s.when ?? []))], [story]);
  const shown = on ? when : when.slice(0, WHEN_SHOWN);
  const text = statText(t, story);
  const post = postText(t, stats);
  return (
    <li className="nz-pick">
      <button
        type="button"
        role="radio"
        aria-checked={on}
        disabled={disabled}
        onClick={onPick}
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 motion-reduce:transition-none",
          on ? "border-primary/70 bg-primary/[0.08] shadow-[0_0_0_1px_hsl(var(--primary)/0.5)]" : "border-foreground/[0.07] hover:border-foreground/[0.18] hover:bg-foreground/[0.03]"
        )}
        data-testid={`nz-pick-${mon.key}`}
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
          {/* A long note (Bulbapedia's on where a Pokémon spawns) in two lines, all of it once the row is chosen. */}
          {text && <span className={cn("mt-0.5 block text-[12.5px] text-muted-foreground [font-variant-numeric:tabular-nums] [overflow-wrap:anywhere]", !on && text.length > NOTE_SHOWN && "line-clamp-2")}>{text}</span>}
          {when.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1" data-testid="nz-when">
              {shown.map((w) => (
                <span key={w} className="rounded-full bg-foreground/[0.06] px-2 py-px text-[11.5px] font-semibold leading-[18px] text-foreground/75">
                  {w}
                </span>
              ))}
              {when.length > shown.length && <span className="px-1 text-[11.5px] font-semibold leading-[20px] text-muted-foreground">{t("picker.more", { n: when.length - shown.length })}</span>}
            </span>
          )}
          {post.map((line) => (
            <span key={line} className="mt-1 block text-[12px] leading-snug text-muted-foreground/80 [font-variant-numeric:tabular-nums]" data-testid="nz-post">
              {line}
            </span>
          ))}
          {dupe && (
            <span className="mt-1 flex items-start gap-1 text-[12.5px] font-semibold leading-snug text-[hsl(var(--warning))]" data-testid="nz-dupe">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              {dupe}
            </span>
          )}
        </span>
        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-foreground/[0.18]")} aria-hidden>
          {on && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
        </span>
      </button>
    </li>
  );
});

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
  const [chosen, setChosen] = useState<{ mon: string; kind: EncounterKind; method: string; level?: number } | null>(null);
  const [shinyOn, setShinyOn] = useState(false);
  const rows = groups.reduce((n, g) => n + g.rows.length, 0);
  const choose = useCallback(
    (c: { mon: string; kind: EncounterKind; method: string; level?: number }) =>
      setChosen((cur) => (cur && cur.mon === c.mon && cur.kind === c.kind && cur.method === c.method ? null : c)),
    []
  );
  // One handler per row, made once per area: the rows are memoised, so their props must stay the same between renders.
  const pickers = useMemo(() => {
    const m = new Map<string, () => void>();
    for (const g of groups)
      for (const r of g.rows) {
        // The level to start the catch odds from: the story's (a post-game line's only if that's all there is).
        const story = storyStats(r.stats);
        const span = levelSpan(story.length ? story : r.stats);
        m.set(`${g.kind}|${g.method}|${r.mon}`, () => choose({ mon: r.mon, kind: g.kind, method: g.method, ...(span && { level: span[0] }) }));
      }
    return m;
  }, [groups, choose]);
  const q = fold(query.trim());
  // In "extra" mode a Pokémon of a kind that counts can only come in as a shiny (the shiny clause).
  const forcedShiny = extra && !!chosen && counts(run.rules, chosen.kind);
  const shiny = forcedShiny || shinyOn;
  const free = !!chosen && isFree(run.rules, chosen.kind, shiny);
  const chosenMon = chosen ? view.mons[chosen.mon] : undefined;
  const catchHref = chosen && chosen.kind === "wild" && view.catchRate && chosenMon ? `/tools/catch-rate-calculator?p=${chosenMon.species}&g=${view.catchRate}${chosen.level ? `&l=${chosen.level}` : ""}` : null;

  const footer = (
    <div data-testid="nz-picker-footer">
        {chosen && chosenMon ? (
          <>
            <div className="flex items-center gap-3">
              <Sprite art={chosenMon.art} className="h-12 w-12 shrink-0" eager />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15.5px] font-bold leading-tight">{t("picker.chosen", { name: chosenMon.name })}</p>
                {catchHref && (
                  <a href={catchHref} target="_blank" rel="noopener" className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-testid="nz-catch-odds">
                    {t("picker.catchOdds")} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </div>
              <button
                type="button"
                aria-pressed={shiny}
                disabled={forcedShiny}
                onClick={() => setShinyOn((x) => !x)}
                className={cn("inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-100", shiny ? "bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))]" : "bg-foreground/[0.06] text-muted-foreground hover:text-foreground")}
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
  );
  return (
    <Sheet
      title={area.name}
      sub={
        <p tabIndex={-1} data-autofocus className="mt-0.5 text-[14px] text-muted-foreground outline-none">
          {area.addOn && <AddOnTag name={area.addOn} className="mr-2" />}
          {extra ? t("picker.leadExtra") : t("picker.lead")}
        </p>
      }
      onClose={onClose}
      closeLabel={t("picker.close")}
      wide
      footer={footer}
      testId="nz-picker"
    >
      {/* The search stays at the top of the list; its shadow fills the list's own top padding, so no row shows above it. */}
      {rows > 6 && (
        <div className="sticky top-0 z-10 -mx-6 bg-card px-6 pb-2 pt-1 shadow-[0_-6px_0_0_hsl(var(--card))] max-sm:-mx-5 max-sm:px-5">
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
            <section key={`${g.kind}|${g.method}`} aria-label={methodLabel(g.method)}>
              <h3 className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {methodLabel(g.method)}
                </span>
                {groupFree && <span className="rounded-full bg-success/[0.14] px-2 py-0.5 text-[10.5px] normal-case tracking-normal text-success">{t("picker.free")}</span>}
              </h3>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {shown.map((r) => {
                  const mon = view.mons[r.mon];
                  if (!mon) return null;
                  const dupe = run.rules.dupes ? dupeOf(run, view, r.mon) : null;
                  return (
                    <PickRow
                      key={r.mon}
                      t={t}
                      mon={mon}
                      stats={r.stats}
                      dupe={dupe ? t(dupe.status === "dead" ? "picker.dupeDead" : "picker.dupe", { name: view.mons[dupe.mon]?.name ?? "?" }) : null}
                      on={chosen?.mon === r.mon && chosen.kind === g.kind && chosen.method === g.method}
                      disabled={extra && !groupFree && !run.rules.shiny}
                      onPick={pickers.get(`${g.kind}|${g.method}|${r.mon}`)!}
                    />
                  );
                })}
              </ul>
            </section>
          );
        })}
        {q && groups.every((g) => !g.rows.some((r) => fold(view.mons[r.mon]?.name ?? "").includes(q))) && <p className="py-6 text-center text-[14.5px] text-muted-foreground">{t("picker.none")}</p>}
      </div>

    </Sheet>
  );
}
