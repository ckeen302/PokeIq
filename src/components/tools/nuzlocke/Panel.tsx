"use client";

import { useRef, useState } from "react";
import { ArrowLeftRight, BookOpen, ChevronsUp, Flower2, GripVertical, HeartCrack, MoveLeft, MoveRight, Package, ShieldAlert, Swords, Undo2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { box, displayName, graveyard, team, type Run, type RunMon } from "@/lib/nuzlocke/run";
import { matchupSummary, teamMatchups, type TypeMatchup } from "@/lib/nuzlocke/matchups";
import { allAreas, type GameView } from "@/lib/nuzlocke/view";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { Modal, PillButton } from "../tier-list/ui";
import type { Act } from "./act";
import { whereFell } from "./DeathDialog";
import { Menu, Sprite, TypeChip, type MenuItem, type NuzT } from "./parts";

export type Side = "team" | "box" | "grave";

/**
 * The run's Pokémon: the team (six slots, drag or the menu to reorder, its type matchups), the box and the graveyard.
 * A sticky column beside the areas on a wide screen; on a phone, the dock's Team, Box and Graveyard.
 */
export function Panel({ t, run, view, readOnly, tab, onTab, act, onTeamBuilder }: { t: NuzT; run: Run; view: GameView; readOnly: boolean; tab: Side; onTab(s: Side): void; act: Act; onTeamBuilder?: () => void }) {
  const tabs: { id: Side; label: string; icon: typeof Users; n: number }[] = [
    { id: "team", label: t("panel.team"), icon: Users, n: team(run).length },
    { id: "box", label: t("panel.box"), icon: Package, n: box(run).length },
    { id: "grave", label: t("panel.grave"), icon: Flower2, n: graveyard(run).length },
  ];
  return (
    <div className="rounded-[26px] border border-foreground/[0.08] bg-card shadow-[0_20px_50px_-40px_hsl(var(--shade)/0.8)] lg:flex lg:max-h-[calc(100dvh-96px)] lg:flex-col" data-testid="nz-panel">
      <div role="tablist" aria-label={t("panel.label")} className="grid grid-cols-3 gap-1 border-b border-foreground/[0.06] p-1.5 max-lg:hidden">
        {tabs.map((x) => {
          const on = tab === x.id;
          const Icon = x.icon;
          return (
            <button key={x.id} type="button" role="tab" aria-selected={on} onClick={() => onTab(x.id)} className={cn("flex h-11 items-center justify-center gap-1.5 rounded-[18px] text-[14px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-foreground/[0.07] text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`nz-tab-${x.id}`}>
              <Icon className="h-4 w-4" aria-hidden />
              {x.label}
              <span className={cn("min-w-[20px] rounded-full px-1.5 text-center text-[11px] leading-5 [font-variant-numeric:tabular-nums]", on ? "bg-primary text-primary-foreground" : "bg-foreground/[0.08]")}>{x.id === "team" ? `${x.n}/6` : x.n}</span>
            </button>
          );
        })}
      </div>
      <div className="nz-scroll p-3.5 sm:p-4 lg:min-h-0 lg:overflow-y-auto" role="tabpanel" data-testid={`nz-panel-${tab}`}>
        {tab === "team" && <TeamView t={t} run={run} view={view} readOnly={readOnly} act={act} onTeamBuilder={onTeamBuilder} />}
        {tab === "box" && <BoxView t={t} run={run} view={view} readOnly={readOnly} act={act} />}
        {tab === "grave" && <GraveView t={t} run={run} view={view} readOnly={readOnly} act={act} />}
      </div>
    </div>
  );
}

function monMenu(t: NuzT, view: GameView, m: RunMon, extra: MenuItem[] = []): MenuItem[] {
  const v = view.mons[m.mon];
  return [
    ...extra,
    ...(v?.evos ?? []).flatMap((k) => (view.mons[k] ? [{ id: `evo:${k}`, label: t("mon.evolve", { name: view.mons[k].name }), icon: <ChevronsUp /> }] : [])),
    ...(v ? [{ id: "dex", label: t("mon.dex"), icon: <BookOpen />, href: `/pokemon/${v.slug}` }] : []),
  ];
}

function TeamView({ t, run, view, readOnly, act, onTeamBuilder }: { t: NuzT; run: Run; view: GameView; readOnly: boolean; act: Act; onTeamBuilder?: () => void }) {
  const members = team(run);
  const [drag, setDrag] = useState<{ id: string; from: number; over: number | null } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const overAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-slot]");
    return el && list.current?.contains(el) ? Number(el.dataset.slot) : null;
  };
  const lines = teamMatchups(
    members.map((m) => view.mons[m.mon]?.types ?? []),
    view.types,
    view.chart
  );
  const { weak, resist, gaps } = matchupSummary(lines);
  return (
    <div className="space-y-4">
      <ol ref={list} className="grid grid-cols-2 gap-2" data-testid="nz-team">
        {Array.from({ length: 6 }, (_, i) => {
          const m = members[i];
          if (!m)
            return (
              <li key={`empty-${i}`} data-slot={Math.min(i, Math.max(0, members.length - 1))} className="flex min-h-[78px] items-center justify-center rounded-2xl border-2 border-dashed border-foreground/[0.1] text-[13px] font-semibold text-muted-foreground/70" data-testid="nz-slot-empty">
                {t("panel.emptySlot")}
              </li>
            );
          const v = view.mons[m.mon];
          const name = displayName(m, v);
          return (
            <li
              key={m.id}
              data-slot={i}
              className={cn("relative flex items-center gap-2 rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03] py-2 pl-2 pr-1 transition-shadow", drag?.id === m.id && "nz-dragging", drag && drag.over === i && drag.id !== m.id && "nz-drop")}
              data-testid="nz-slot"
              data-mon={m.id}
            >
              <Sprite art={v?.art} className="h-[52px] w-[52px] shrink-0 max-sm:h-11 max-sm:w-11" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-bold leading-tight" data-testid="nz-slot-name">{name}</p>
                <p className="truncate text-[12px] leading-snug text-muted-foreground [font-variant-numeric:tabular-nums]">{[m.nickname ? v?.name : null, m.level ? t("mon.lv", { n: m.level }) : null].filter(Boolean).join(" · ")}</p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {v?.types.map((ty) => <TypeChip key={ty} t={t} type={ty} size="sm" />)}
                </p>
              </div>
              {!readOnly && (
                <span className="flex flex-col items-center self-stretch justify-between">
                  <Menu
                    label={t("mon.menu", { name })}
                    items={monMenu(t, view, m, [
                      ...(i > 0 ? [{ id: "up", label: t("mon.moveUp"), icon: <MoveLeft /> }] : []),
                      ...(i < members.length - 1 ? [{ id: "down", label: t("mon.moveDown"), icon: <MoveRight /> }] : []),
                      { id: "box", label: t("mon.toBox"), icon: <Package /> },
                      { id: "dead", label: t("mon.markDead"), icon: <HeartCrack />, danger: true },
                    ])}
                    onPick={(id) => {
                      if (id === "up") act.move(m.id, i - 1);
                      else if (id === "down") act.move(m.id, i + 1);
                      else if (id === "box") act.status(m.id, "box");
                      else if (id === "dead") act.status(m.id, "dead");
                      else if (id.startsWith("evo:")) act.evolve(m.id, id.slice(4));
                    }}
                    testId="nz-slot-menu"
                  />
                  <button
                    type="button"
                    aria-label={`${t("mon.drag")}: ${name}`}
                    title={t("mon.drag")}
                    className="flex h-9 w-8 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDrag({ id: m.id, from: i, over: i });
                    }}
                    onPointerMove={(e) => drag && setDrag({ ...drag, over: overAt(e.clientX, e.clientY) })}
                    onPointerUp={() => {
                      if (drag && drag.over !== null && drag.over !== drag.from) act.move(drag.id, drag.over);
                      setDrag(null);
                    }}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(e) => {
                      const by = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
                      if (!by) return;
                      e.preventDefault();
                      act.move(m.id, i + by);
                    }}
                    data-testid="nz-grip"
                  >
                    <GripVertical className="h-4 w-4" aria-hidden />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {!members.length && <p className="text-center text-[14px] text-muted-foreground">{t("panel.teamEmpty")}</p>}

      {members.length > 0 && (
        <section className="rounded-2xl bg-foreground/[0.035] p-3.5" aria-labelledby="nz-matchups" data-testid="nz-matchups">
          <h3 id="nz-matchups" className="flex items-center gap-2 font-display text-[16px] font-bold tracking-tight">
            <Swords className="h-4 w-4 text-muted-foreground" aria-hidden /> {t("panel.matchups")}
          </h3>
          <MatchupRow t={t} label={t("panel.weak")} lines={weak} pick={(l) => l.weak} tone="weak" testId="nz-weak" empty={t("panel.noWeak")} />
          <MatchupRow t={t} label={t("panel.resist")} lines={resist} pick={(l) => l.resist} tone="resist" testId="nz-resist" />
          {gaps.length > 0 && (
            <div className="mt-3 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5" data-testid="nz-gaps">
              <p className="flex items-start gap-1.5 text-[12.5px] font-semibold leading-snug">
                <ShieldAlert className="mt-px h-4 w-4 shrink-0 text-destructive" aria-hidden />
                {t("panel.gaps")}
              </p>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {gaps.map((l) => (
                  <TypeChip key={l.type} t={t} type={l.type} />
                ))}
              </p>
            </div>
          )}
          <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">{t("panel.matchupsNote", { gen: view.gen })}</p>
        </section>
      )}
      {onTeamBuilder && members.length > 0 && !readOnly && (
        <PillButton onClick={onTeamBuilder} className="w-full" testId="nz-team-builder">
          <ArrowLeftRight className="h-4 w-4" aria-hidden /> {t("panel.teamBuilder")}
        </PillButton>
      )}
    </div>
  );
}

function MatchupRow({ t, label, lines, pick, tone, testId, empty }: { t: NuzT; label: string; lines: TypeMatchup[]; pick(l: TypeMatchup): number; tone: "weak" | "resist"; testId: string; empty?: string }) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      {lines.length ? (
        <ul className="flex flex-wrap gap-1.5" data-testid={testId}>
          {lines.map((l) => (
            <li
              key={l.type}
              className="inline-flex h-7 items-center gap-1.5 rounded-full pl-2.5 pr-1 text-[12px] font-bold"
              style={{ background: typeColor(l.type), color: typeTextColor(l.type) }}
              title={t("panel.cell", { type: t(`types.${l.type}` as "types.normal"), weak: l.weak, resist: l.resist })}
              data-type={l.type}
              data-n={pick(l)}
            >
              {t(`types.${l.type}` as "types.normal")}
              <span className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] [font-variant-numeric:tabular-nums]", tone === "weak" ? "bg-black/35 text-white" : "bg-white/80 text-[#16131f]")}>{pick(l)}</span>
            </li>
          ))}
        </ul>
      ) : (
        empty && <p className="text-[13px] text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function BoxView({ t, run, view, readOnly, act }: { t: NuzT; run: Run; view: GameView; readOnly: boolean; act: Act }) {
  const boxed = box(run);
  const areas = new Map(allAreas(view).map((a) => [a.id, a.name]));
  if (!boxed.length) return <p className="py-8 text-center text-[14.5px] text-muted-foreground">{t("panel.boxEmpty")}</p>;
  return (
    <ul className="space-y-2" data-testid="nz-box">
      {boxed.map((m) => {
        const v = view.mons[m.mon];
        const name = displayName(m, v);
        return (
          <li key={m.id} className="flex items-center gap-2.5 rounded-2xl bg-foreground/[0.035] p-2" data-testid="nz-box-mon">
            <Sprite art={v?.art} className="h-12 w-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[15.5px] font-bold leading-tight">{name}</p>
              <p className="truncate text-[12.5px] text-muted-foreground">
                {m.nickname ? `${v?.name} · ` : ""}
                {t("mon.caughtIn", { area: areas.get(m.area) ?? m.area })}
              </p>
            </div>
            {!readOnly && (
              <>
                <button type="button" onClick={() => act.status(m.id, "team")} className="h-10 shrink-0 rounded-full bg-screen/[0.14] px-3.5 text-[13px] font-bold text-screen transition-colors hover:bg-screen/[0.22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="nz-to-team">
                  {t("mon.toTeam")}
                </button>
                <Menu label={t("mon.menu", { name })} items={monMenu(t, view, m, [{ id: "dead", label: t("mon.markDead"), icon: <HeartCrack />, danger: true }])} onPick={(id) => (id === "dead" ? act.status(m.id, "dead") : id.startsWith("evo:") && act.evolve(m.id, id.slice(4)))} />
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function GraveView({ t, run, view, readOnly, act }: { t: NuzT; run: Run; view: GameView; readOnly: boolean; act: Act }) {
  const fallen = graveyard(run);
  if (!fallen.length)
    return (
      <div className="py-8 text-center" data-testid="nz-grave-empty">
        <Flower2 className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
        <p className="mt-2 text-[14.5px] text-muted-foreground">{t("panel.graveEmpty")}</p>
      </div>
    );
  return (
    <div>
      <p className="mb-3 text-[13.5px] text-muted-foreground">{t("panel.graveLead")}</p>
      <ul className="grid grid-cols-2 gap-2" data-testid="nz-grave">
        {fallen.map((m) => {
          const v = view.mons[m.mon];
          const name = displayName(m, v);
          const by = m.death?.by ? view.dex.find(([id]) => id === m.death!.by)?.[1] : m.death?.byText;
          const where = whereFell(view, m.death?.area);
          return (
            <li key={m.id} className="relative flex flex-col items-center rounded-2xl border border-foreground/[0.07] bg-[linear-gradient(180deg,hsl(var(--foreground)/0.045),hsl(var(--foreground)/0.015))] px-2.5 pb-3 pt-2 text-center" data-testid="nz-grave-mon">
              {!readOnly && (
                <Menu label={t("mon.menu", { name })} items={[{ id: "revive", label: t("mon.revive"), icon: <Undo2 /> }]} onPick={() => act.status(m.id, "box")} className="absolute right-1 top-1" />
              )}
              <Sprite art={v?.art} dim className="h-[72px] w-[72px]" />
              <p className="mt-1 flex max-w-full items-center gap-1 font-display text-[15.5px] font-bold leading-tight">
                <Flower2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate" data-testid="nz-grave-name">{name}</span>
              </p>
              <p className="truncate text-[12px] text-muted-foreground">{v?.name}</p>
              <p className="mt-1.5 space-y-0.5 text-[11.5px] leading-snug text-muted-foreground">
                {by && <span className="block">{t("panel.fellTo", { by })}</span>}
                {where && <span className="block">{"boss" in where ? t("panel.fellVs", { boss: where.boss }) : t("panel.fellAt", { where: where.area })}</span>}
                {m.death?.level && <span className="block font-semibold">{t("mon.lv", { n: m.death.level })}</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The team is full: who goes to the box so this one can join? */
export function SwapDialog({ t, run, view, mon, onClose, onSwap }: { t: NuzT; run: Run; view: GameView; mon: RunMon; onClose(): void; onSwap(out: string): void }) {
  const name = displayName(mon, view.mons[mon.mon]);
  return (
    <Modal title={t("mon.swapTitle")} onClose={onClose} closeLabel={t("picker.close")} testId="nz-swap">
      <p className="text-[14.5px] text-muted-foreground">{t("mon.swapLead", { name })}</p>
      <ul className="mt-4 grid grid-cols-2 gap-2">
        {team(run).map((m) => {
          const v = view.mons[m.mon];
          return (
            <li key={m.id}>
              <button type="button" onClick={() => onSwap(m.id)} className="flex w-full items-center gap-2 rounded-2xl border border-foreground/[0.08] p-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="nz-swap-out">
                <Sprite art={v?.art} className="h-11 w-11 shrink-0" />
                <span className="min-w-0 truncate text-[14.5px] font-bold">{displayName(m, v)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
