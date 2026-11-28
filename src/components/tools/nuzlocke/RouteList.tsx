"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, ChevronDown, ChevronsUp, Hash, Medal, Plus, RotateCcw, SkipForward, Sparkles, Swords, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { NICK_MAX, counts, displayName, levelCap, monsIn, type MonStatus, type Run, type RunMon } from "@/lib/nuzlocke/run";
import type { AreaFilter } from "@/lib/nuzlocke/storage";
import { capFor, inVersion, type GameView, type ViewArea, type ViewBoss } from "@/lib/nuzlocke/view";
import { groupByMethod } from "@/lib/nuzlocke/group";
import { Segmented } from "../tier-list/ui";
import type { Act } from "./act";
import { Menu, Sprite, TypeChip, type MenuItem, type NuzT } from "./parts";

/**
 * The run's main column: every area in story order with the bosses between them, each area's one encounter (or the
 * button to log it), filters to hide what's done, and the areas outside the story under "Other areas".
 */

type Item = { type: "area"; area: ViewArea } | { type: "boss"; boss: ViewBoss };

/** The Pokémon an area gives in this version, in the picker's order (walking first, then gifts, then the water…). */
const areaMons = (area: ViewArea, version: string) => [...new Set(groupByMethod(area.encounters.filter((e) => inVersion(e, version))).flatMap((g) => g.rows.map((r) => r.mon)))];

export function RouteList({
  t,
  run,
  view,
  readOnly,
  filter,
  onFilter,
  onboarding,
  onDismissOnboarding,
  justCaught,
  onCaughtShown,
  act,
}: {
  t: NuzT;
  run: Run;
  view: GameView;
  readOnly: boolean;
  filter: AreaFilter;
  onFilter(f: AreaFilter): void;
  onboarding: boolean;
  onDismissOnboarding(): void;
  justCaught: string | null;
  onCaughtShown(): void;
  act: Act;
}) {
  const [otherOpen, setOtherOpen] = useState(() => view.extra.some((a) => run.areas[a.id]));
  const cap = run.rules.caps ? levelCap(run, view) : null;
  const playable = (a: ViewArea) => areaMons(a, run.version).length > 0;
  // A version's own bosses (Sword's Bea, Shield's Allister) show in that version's runs only.
  const story: Item[] = view.steps.flatMap((s): Item[] => (s.type === "area" ? [{ type: "area", area: s.area }] : inVersion(s.boss, run.version) ? [{ type: "boss", boss: s.boss }] : []));
  const all = [...story.flatMap((i) => (i.type === "area" ? [i.area] : [])), ...view.extra];
  const done = all.filter((a) => run.areas[a.id]).length;
  const remaining = all.filter((a) => !run.areas[a.id] && playable(a)).length;
  // Up next: the first open area after the furthest one logged in story order (a player moves on; one passed by, such as
  // a town's water before Surf, stays in Remaining), else the first open one.
  const open = (a: ViewArea) => !run.areas[a.id] && playable(a);
  const storyAreas = story.flatMap((i) => (i.type === "area" ? [i.area] : []));
  const furthest = storyAreas.reduce((last, a, n) => (run.areas[a.id] ? n : last), -1);
  const next = storyAreas.slice(furthest + 1).find(open) ?? all.find(open) ?? null;
  const shows = (i: Item) =>
    filter === "all" ? true : i.type === "boss" ? (filter === "done") === run.beaten.includes(i.boss.key) : filter === "done" ? !!run.areas[i.area.id] : !run.areas[i.area.id] && playable(i.area);
  const shown = story.filter(shows);
  const extraShown = view.extra.filter((a) => shows({ type: "area", area: a }));
  const anyArea = shown.some((i) => i.type === "area") || extraShown.length > 0;

  const goNext = () => {
    if (!next) return;
    if (filter === "done") onFilter("all");
    if (view.extra.some((a) => a.id === next.id)) setOtherOpen(true);
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`nz-area-${next.id}`);
      if (!el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      el.classList.remove("nz-flash");
      void el.offsetWidth;
      el.classList.add("nz-flash");
    });
  };

  return (
    <section aria-label={t("routes.label")} data-testid="nz-routes">
      {onboarding && (
        <div className="mb-4 rounded-[22px] border border-primary/25 bg-primary/[0.06] p-4 sm:p-5" data-testid="nz-onboarding">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-[18px] font-bold tracking-tight">{t("onboarding.title")}</h2>
            <button type="button" onClick={onDismissOnboarding} className="-mr-1 -mt-1 h-10 shrink-0 rounded-full px-4 text-[13.5px] font-bold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="nz-onboarding-ok">
              {t("onboarding.dismiss")}
            </button>
          </div>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {(["s1", "s2", "s3"] as const).map((k, i) => (
              <li key={k} className="flex items-start gap-3 text-[14.5px] leading-snug">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-display text-[14px] font-bold text-primary-foreground" aria-hidden>
                  {i + 1}
                </span>
                <span className="pt-0.5">{t(`onboarding.${k}`)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label={t("routes.filter")}
          value={filter}
          onChange={onFilter}
          size="sm"
          testId="nz-filter"
          options={[
            { value: "remaining", label: <FilterLabel text={t("routes.remaining")} n={remaining} />, testId: "nz-filter-remaining" },
            { value: "all", label: <FilterLabel text={t("routes.all")} n={all.length} />, testId: "nz-filter-all" },
            { value: "done", label: <FilterLabel text={t("routes.done")} n={done} />, testId: "nz-filter-done" },
          ]}
        />
        {next && !readOnly && (
          <button type="button" onClick={goNext} className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10" data-testid="nz-next">
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{t("routes.next", { area: next.name })}</span>
          </button>
        )}
      </div>

      <ol className="space-y-2.5">
        {shown.map((i, n) =>
          i.type === "boss" ? (
            <BossDivider key={`${i.boss.key}-${n}`} t={t} run={run} boss={i.boss} current={cap?.boss.key === i.boss.key} readOnly={readOnly} onToggle={() => act.boss(i.boss.key)} />
          ) : (
            <AreaCard key={i.area.id} t={t} run={run} view={view} area={i.area} next={i.area.id === next?.id} readOnly={readOnly} justCaught={justCaught} onCaughtShown={onCaughtShown} act={act} />
          )
        )}
      </ol>
      {!anyArea && <p className="rounded-[22px] border border-dashed border-foreground/[0.14] px-5 py-8 text-center text-[15px] text-muted-foreground">{filter === "done" ? t("routes.emptyDone") : t("routes.emptyRemaining")}</p>}

      {view.extra.length > 0 && extraShown.length > 0 && (
        <div className="mt-6">
          <button type="button" onClick={() => setOtherOpen((o) => !o)} aria-expanded={otherOpen} className="flex w-full items-center justify-between gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="nz-other">
            <span className="flex items-baseline gap-2">
              <span className="font-display text-[19px] font-bold tracking-tight">{t("routes.other")}</span>
              <span className="text-[13px] text-muted-foreground">{t("routes.otherCount", { n: extraShown.length })}</span>
            </span>
            <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform motion-reduce:transition-none", otherOpen && "rotate-180")} aria-hidden />
          </button>
          {otherOpen && (
            <ol className="mt-2 space-y-2.5">
              {extraShown.map((a) => (
                <AreaCard key={a.id} t={t} run={run} view={view} area={a} next={a.id === next?.id} readOnly={readOnly} justCaught={justCaught} onCaughtShown={onCaughtShown} act={act} />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function FilterLabel({ text, n }: { text: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      <span className="rounded-full bg-foreground/[0.08] px-1.5 text-[11px] font-bold leading-[18px] [font-variant-numeric:tabular-nums]">{n}</span>
    </span>
  );
}

function BossDivider({ t, run, boss, current, readOnly, onToggle }: { t: NuzT; run: Run; boss: ViewBoss; current: boolean; readOnly: boolean; onToggle(): void }) {
  const beaten = run.beaten.includes(boss.key);
  const cap = capFor(boss, run.version);
  const showCap = run.rules.caps && cap !== undefined;
  const Icon = beaten ? Check : boss.badge ? Medal : Swords;
  const body = (
    <>
      <span className={cn("h-px flex-1", beaten ? "bg-success/30" : "bg-foreground/[0.12]")} aria-hidden />
      <span
        className={cn(
          "flex max-w-[88%] flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-full border px-4 py-2 text-center text-[14px] font-semibold transition-colors",
          beaten ? "border-success/40 bg-success/[0.09] text-foreground/80" : current ? "border-[hsl(var(--warning)/0.55)] bg-[hsl(var(--warning)/0.12)] shadow-[0_0_0_3px_hsl(var(--warning)/0.1)]" : "border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.06)]"
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", beaten ? "text-success" : "text-[hsl(var(--warning))]")} strokeWidth={beaten ? 3 : 2} aria-hidden />
        <span>{boss.name}</span>
        {boss.badge && <span className="text-muted-foreground">· {boss.badge}</span>}
        {/* On a phone the cap and "Beaten" take the second line, so no line starts with a dot. */}
        {(showCap || beaten) && (
          <span className="max-sm:basis-full">
            <span className="max-sm:hidden">· </span>
            {showCap && <span className={cn(!beaten && "font-bold")}>{t("routes.cap", { n: cap })}</span>}
            {showCap && beaten && " · "}
            {beaten && <span className="text-success">{t("routes.beaten")}</span>}
          </span>
        )}
      </span>
      <span className={cn("h-px flex-1", beaten ? "bg-success/30" : "bg-foreground/[0.12]")} aria-hidden />
    </>
  );
  return (
    <li data-testid="nz-boss" data-boss={boss.key} data-beaten={beaten ? "1" : "0"}>
      {readOnly ? (
        <div className="flex items-center gap-3 py-1">{body}</div>
      ) : (
        <button type="button" onClick={onToggle} aria-pressed={beaten} aria-label={beaten ? t("routes.markNotBeaten", { boss: boss.name }) : t("routes.markBeaten", { boss: boss.name })} className="flex min-h-12 w-full items-center gap-3 rounded-full py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`nz-boss-${boss.key}`}>
          {body}
        </button>
      )}
    </li>
  );
}

/** An area: its one encounter (or the button to log it: the bright one on the next area in story order), and any extras. */
function AreaCard({ t, run, view, area, next, readOnly, justCaught, onCaughtShown, act }: { t: NuzT; run: Run; view: GameView; area: ViewArea; next: boolean; readOnly: boolean; justCaught: string | null; onCaughtShown(): void; act: Act }) {
  const result = run.areas[area.id];
  const mons = monsIn(run, area.id);
  const preview = areaMons(area, run.version);
  const version = view.versions.find((v) => v.id === run.version)?.name ?? run.version;
  // Something can still be added once the area's encounter is logged: a shiny (shiny clause), or a gift or static
  // Pokémon that doesn't count under these rules.
  const extras = run.rules.shiny || area.encounters.some((e) => inVersion(e, run.version) && !counts(run.rules, e.kind));
  const menu: MenuItem[] = [
    ...(result ? [{ id: "reopen", label: t("routes.reopen"), icon: <RotateCcw /> }] : []),
    ...(result && extras ? [{ id: "extra", label: t("routes.addExtra"), icon: <Plus /> }] : []),
  ];
  const failedMon = result?.kind === "failed" && result.met ? view.mons[result.met] : undefined;
  return (
    <li id={`nz-area-${area.id}`} className={cn("rounded-[22px] border bg-card p-3 shadow-[0_14px_36px_-32px_hsl(var(--shade)/0.9)] transition-colors sm:p-3.5", result ? "border-foreground/[0.07]" : "border-foreground/[0.1]")} data-testid="nz-area" data-area={area.id} data-state={result?.kind ?? "open"}>
      <div className="flex items-center gap-2 px-1">
        <h3 className="min-w-0 flex-1 truncate font-display text-[16.5px] font-bold tracking-tight">{area.name}</h3>
        {result && <Check className="h-4 w-4 shrink-0 text-success" strokeWidth={3} aria-hidden />}
        {!readOnly && menu.length > 0 && <Menu label={t("routes.areaMenu", { area: area.name })} items={menu} onPick={(id) => (id === "reopen" ? act.reopen(area.id) : act.pick(area.id, true))} className="-my-1.5 -mr-1.5" testId={`nz-area-menu-${area.id}`} />}
      </div>

      {!result && !preview.length && <p className="mt-1.5 px-1 text-[13.5px] text-muted-foreground">{t("routes.nothing", { version })}</p>}

      {!result && preview.length > 0 && (readOnly ? (
        <PreviewStrip view={view} mons={preview} className="mt-2 px-1" />
      ) : (
        <button
          type="button"
          onClick={() => act.pick(area.id)}
          aria-label={t("routes.logFor", { area: area.name })}
          className={cn(
            "group mt-2 flex w-full items-center gap-3 rounded-2xl border-2 border-dashed p-2 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:flex-col max-sm:items-stretch max-sm:gap-2",
            next ? "border-primary/35 bg-primary/[0.04] hover:border-primary/60 hover:bg-primary/[0.07]" : "border-foreground/[0.12] hover:border-foreground/25 hover:bg-foreground/[0.03]"
          )}
          data-testid={`nz-log-${area.id}`}
        >
          <PreviewStrip view={view} mons={preview} className="min-w-0 flex-1" />
          <span
            className={cn(
              "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-[14.5px] font-bold transition-[filter,background-color]",
              next ? "bg-primary text-primary-foreground shadow-[0_3px_0_hsl(var(--primary-shadow))] group-hover:brightness-110" : "bg-foreground/[0.07] text-foreground group-hover:bg-foreground/[0.11]"
            )}
          >
            <Plus className="h-4 w-4" strokeWidth={3} aria-hidden /> {t("routes.log")}
          </span>
        </button>
      ))}

      {(result?.kind === "failed" || result?.kind === "skipped") && (
        <div className="mt-2 flex items-center gap-3 rounded-2xl bg-foreground/[0.035] p-2 pr-2.5" data-testid="nz-area-result">
          {failedMon ? <Sprite art={failedMon.art} dim className="h-11 w-11 shrink-0" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-muted-foreground">{result.kind === "skipped" ? <SkipForward className="h-5 w-5" aria-hidden /> : <Undo2 className="h-5 w-5" aria-hidden />}</span>}
          <span className="min-w-0 flex-1 text-[14.5px] font-semibold text-muted-foreground">{result.kind === "skipped" ? t("routes.skipped") : failedMon ? t("routes.failedAs", { name: failedMon.name }) : t("routes.failed")}</span>
          {!readOnly && (
            <button type="button" onClick={() => act.reopen(area.id, true)} className="h-10 shrink-0 rounded-full px-4 text-[13.5px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11" data-testid={`nz-change-${area.id}`}>
              {t("routes.change")}
            </button>
          )}
        </div>
      )}

      {mons.length > 0 && (
        <ul className="mt-2 space-y-2">
          {mons.map((m) => (
            <MonRow key={m.id} t={t} run={run} view={view} mon={m} readOnly={readOnly} focus={m.id === justCaught} onFocused={onCaughtShown} act={act} />
          ))}
        </ul>
      )}
    </li>
  );
}

function PreviewStrip({ view, mons, className }: { view: GameView; mons: string[]; className?: string }) {
  const max = 7;
  return (
    <span className={cn("flex items-center", className)} aria-hidden>
      {mons.slice(0, max).map((k) => (
        <Sprite key={k} art={view.mons[k]?.art} className="-mr-1.5 h-10 w-10 shrink-0 last:mr-0 max-sm:h-9 max-sm:w-9" />
      ))}
      {mons.length > max && <span className="ml-2 text-[12.5px] font-bold text-muted-foreground">+{mons.length - max}</span>}
    </span>
  );
}

const STATUSES: MonStatus[] = ["team", "box", "dead"];

/** A caught Pokémon in its area: picture, nickname (edited in place), species, and where it is (Team, Box, Dead). */
function MonRow({ t, run, view, mon, readOnly, focus, onFocused, act }: { t: NuzT; run: Run; view: GameView; mon: RunMon; readOnly: boolean; focus: boolean; onFocused(): void; act: Act }) {
  const v = view.mons[mon.mon];
  const species = v?.name ?? mon.mon;
  const name = displayName(mon, v);
  const [draft, setDraft] = useState(mon.nickname);
  const [levelOpen, setLevelOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => setDraft(mon.nickname), [mon.nickname]);
  useEffect(() => {
    if (!focus) return;
    input.current?.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [focus]);
  const save = () => {
    if (draft.trim() !== mon.nickname) act.rename(mon.id, draft);
  };
  const evos = (v?.evos ?? []).map((k) => view.mons[k]).filter(Boolean);
  const menu: MenuItem[] = [
    ...evos.map((e) => ({ id: `evo:${e.key}`, label: t("mon.evolve", { name: e.name }), icon: <ChevronsUp /> })),
    { id: "level", label: t("mon.setLevel"), icon: <Hash /> },
    { id: "shiny", label: mon.shiny ? t("mon.notShiny") : t("mon.shiny"), icon: <Sparkles /> },
    ...(v ? [{ id: "dex", label: t("mon.dex"), icon: <BookOpen />, href: `/pokemon/${v.slug}` }] : []),
    { id: "remove", label: t("mon.remove"), icon: <Trash2 />, danger: true },
  ];
  const tags = [mon.level ? t("mon.lv", { n: mon.level }) : null, mon.kind ? t(`kinds.${mon.kind}`) : null, mon.free ? (mon.shiny && run.rules.shiny ? t("routes.extraShiny") : t("routes.extraFree")) : null].filter(Boolean);
  return (
    <li ref={row} className={cn("rounded-2xl bg-foreground/[0.035] p-2", mon.status === "dead" && "bg-destructive/[0.05]", focus && "nz-flash")} data-testid="nz-mon" data-mon={mon.id} data-status={mon.status}>
      <div className="flex items-center gap-2.5 max-sm:flex-wrap">
        <div className="relative shrink-0">
          <Sprite art={v?.art} dim={mon.status === "dead"} className="h-14 w-14 max-sm:h-12 max-sm:w-12" />
          {mon.shiny && <Sparkles className="absolute -right-0.5 -top-0.5 h-4 w-4 text-[hsl(var(--warning))]" aria-label={t("mon.shinyMark")} />}
        </div>
        <div className="min-w-0 flex-1">
          {readOnly ? (
            <p className="truncate px-2 font-display text-[17px] font-bold leading-tight">{name}</p>
          ) : (
            <input
              ref={input}
              value={draft}
              maxLength={NICK_MAX}
              placeholder={t("mon.nickname")}
              aria-label={t("mon.nicknameFor", { species })}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                save();
                if (focus) onFocused();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setDraft(mon.nickname);
                  window.setTimeout(() => input.current?.blur());
                }
              }}
              className="h-9 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 font-display text-[17px] font-bold leading-tight transition-colors placeholder:font-sans placeholder:text-[15px] placeholder:font-semibold placeholder:text-muted-foreground/80 hover:border-foreground/[0.12] focus:border-foreground/[0.2] focus:bg-background focus-visible:outline-none"
              data-testid="nz-nickname"
            />
          )}
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-2 text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground/80" data-testid="nz-species">{species}</span>
            {v?.types.map((ty) => <TypeChip key={ty} t={t} type={ty} size="sm" />)}
            {tags.map((x) => (
              <span key={x}>· {x}</span>
            ))}
          </p>
          {levelOpen && !readOnly && (
            <label className="mt-1.5 flex items-center gap-2 px-2 text-[13px] font-semibold">
              {t("mon.level")}
              <input
                type="number"
                min={1}
                max={100}
                autoFocus
                defaultValue={mon.level ?? ""}
                aria-label={t("mon.levelFor", { name })}
                onBlur={(e) => {
                  act.level(mon.id, e.target.value ? Number(e.target.value) : null);
                  setLevelOpen(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="h-9 w-20 rounded-lg border border-foreground/[0.14] bg-background px-2 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="nz-level"
              />
            </label>
          )}
        </div>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-1 max-sm:w-full max-sm:pl-0">
            <StatusPill t={t} name={name} status={mon.status} onPick={(s) => act.status(mon.id, s)} />
            <Menu
              label={t("mon.menu", { name })}
              items={menu}
              onPick={(id) => {
                if (id.startsWith("evo:")) act.evolve(mon.id, id.slice(4));
                else if (id === "level") setLevelOpen(true);
                else if (id === "shiny") act.shiny(mon.id, !mon.shiny);
                else if (id === "remove") act.remove(mon.id);
              }}
              testId="nz-mon-menu"
            />
          </div>
        )}
        {readOnly && <StatusBadge t={t} status={mon.status} />}
      </div>
    </li>
  );
}

const STATUS_TONE: Record<MonStatus, string> = {
  team: "bg-screen text-white shadow-[0_2px_0_hsl(var(--screen)/0.45)]",
  box: "bg-foreground/[0.82] text-background",
  dead: "bg-destructive text-destructive-foreground",
};

export function StatusPill({ t, name, status, onPick }: { t: NuzT; name: string; status: MonStatus; onPick(s: MonStatus): void }) {
  return (
    <div role="radiogroup" aria-label={t("mon.status", { name })} className="grid flex-1 grid-cols-3 gap-0.5 rounded-full bg-foreground/[0.06] p-1 sm:flex-none" data-testid="nz-status">
      {STATUSES.map((s) => {
        const on = s === status;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(s)}
            className={cn("h-9 rounded-full px-3 text-[13px] font-bold transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none max-md:h-10", on ? STATUS_TONE[s] : "text-muted-foreground hover:text-foreground")}
            data-testid={`nz-status-${s}`}
          >
            {t(`mon.${s}`)}
          </button>
        );
      })}
    </div>
  );
}

function StatusBadge({ t, status }: { t: NuzT; status: MonStatus }) {
  return <span className={cn("shrink-0 rounded-full px-3 py-1 text-[12px] font-bold", STATUS_TONE[status])}>{t(`mon.${status}`)}</span>;
}
