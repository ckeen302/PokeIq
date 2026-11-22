"use client";

import { useState } from "react";
import Link from "@/components/ui/Link";
import { ClipboardPaste, Eraser, FolderOpen, Plus } from "lucide-react";
import { HpBar } from "@/components/game/HpBar";
import { useT } from "@/i18n/client";
import battleLab from "@/messages/battle-lab";
import battlePickers from "@/messages/battle-pickers";
import battleTeams from "@/messages/battle-teams";
import { BATTLE_FORMATS } from "@/lib/battle/formats";
import { labMon } from "@/lib/battle/lab/setup";
import {
  LAB_STRATEGIES,
  LAB_TEAM_SIZE,
  SIDE_FIELD_NAMES,
  sideFieldFor,
  activeCount,
  type LabGen,
  type LabSetup,
  type LabSide,
} from "@/lib/battle/lab/types";
import type { TeamSet } from "@/lib/battle/sets";
import type { SpriteSpecies } from "@/lib/battle/sprites";
import { useTeams, type BattleTeam } from "@/lib/battle/teams";
import { cn } from "@/lib/utils";
import { BattleSprite } from "../BattleSprite";
import { Toggle } from "../controls";
import { ImportPanel } from "../TeamEditor";
import { useBattleNames } from "../use-battle-names";
import { SIDE_COLOR, Swatch } from "./charts";

/**
 * One side of the matchup: its team (pick one to edit it below), where it
 * came from (a saved team or a pasted Showdown export), its strategy, and
 * the hazards and screens already on its side of the field.
 */
export function SideCard({
  side,
  setup,
  sprite,
  selected,
  onSelect,
  onChange,
  onGen,
}: {
  side: 0 | 1;
  setup: LabSetup;
  sprite: ((name: string) => SpriteSpecies | null) | null;
  /** The slot open in the editor, if it's on this side (team.length for a new one). */
  selected: number | null;
  onSelect: (slot: number) => void;
  onChange: (side: LabSide) => void;
  /** Switch the whole Lab to another generation's mechanics. */
  onGen: (gen: LabGen) => void;
}) {
  const t = useT(battleLab);
  const tp = useT(battlePickers);
  const names = useBattleNames();
  const data = setup.sides[side];
  const name = side === 0 ? t("side.a") : t("side.b");
  const [panel, setPanel] = useState<"paste" | "teams" | null>(null);
  const [loaded, setLoaded] = useState<{ what: string; gen: LabGen } | null>(null);
  const update = (patch: Partial<LabSide>) => onChange({ ...data, ...patch });
  const leads = activeCount(setup);

  function load(sets: TeamSet[], what: string, gen: LabGen | null) {
    update({ team: sets.slice(0, LAB_TEAM_SIZE).map((s) => labMon(s)) });
    setPanel(null);
    onSelect(0);
    setLoaded(gen && gen !== setup.gen ? { what, gen } : null);
  }

  return (
    <section aria-label={name} className="hud min-w-0 space-y-4 rounded-lg border bg-card p-4" data-testid={`lab-side-${side === 0 ? "a" : "b"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold uppercase tracking-wide">
          <Swatch color={SIDE_COLOR[side]} /> {name}
          <span className="hud-label normal-case tracking-wider">
            {data.team.length}/{LAB_TEAM_SIZE}
          </span>
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <SmallButton pressed={panel === "teams"} onClick={() => setPanel(panel === "teams" ? null : "teams")}>
            <FolderOpen className="h-3.5 w-3.5" aria-hidden /> {t("team.myTeams")}
          </SmallButton>
          <SmallButton pressed={panel === "paste"} onClick={() => setPanel(panel === "paste" ? null : "paste")}>
            <ClipboardPaste className="h-3.5 w-3.5" aria-hidden /> {t("team.paste")}
          </SmallButton>
          <SmallButton onClick={() => update({ team: [] })} disabled={!data.team.length}>
            <Eraser className="h-3.5 w-3.5" aria-hidden /> {t("team.clear")}
          </SmallButton>
        </div>
      </div>

      {panel === "teams" && <TeamList onPick={(team) => load(team.sets, t("team.quoted", { name: team.name }), BATTLE_FORMATS[team.format].gen)} />}
      {panel === "paste" && (
        <ImportPanel
          confirmLabel={t("team.useFor", { side: name })}
          onImport={(sets, meta) => load(sets, t("team.thatTeam"), meta.format ? BATTLE_FORMATS[meta.format].gen : null)}
        />
      )}
      {loaded && (
        <p className="flex flex-wrap items-center gap-2 rounded-md border border-screen/40 bg-screen/10 px-3 py-2 text-sm">
          {t("team.otherGen", { what: loaded.what, gen: loaded.gen, labGen: setup.gen })}
          <button type="button" className="font-semibold text-screen underline-offset-2 hover:underline" onClick={() => {
              onGen(loaded.gen);
              setLoaded(null);
            }}>
            {t("team.switchTo", { gen: loaded.gen })}
          </button>
        </p>
      )}

      {/* The team */}
      <ol className="space-y-1.5" aria-label={t("team.label", { side: name })}>
        {data.team.map((mon, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={selected === i ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border bg-shade/20 px-2 py-1 text-left transition-colors",
                selected === i ? "border-screen/70 bg-screen/10" : "border-foreground/10 hover:border-screen/40"
              )}
            >
              <BattleSprite species={sprite?.(mon.set.species)} shiny={mon.set.shiny} animated={false} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate font-display font-semibold">{mon.set.name || names.species(mon.set.species)}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{t("level", { level: mon.set.level })}</span>
                  {i < leads && <span className="hud-label text-screen">{t("lead")}</span>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[mon.set.item ? names.item(mon.set.item) : setup.gen >= 2 ? tp("noItem") : "", mon.set.moves.filter(Boolean).map(names.move).join(" / ") || t("team.noMoves")].filter(Boolean).join(" · ")}
                </span>
              </span>
              {(mon.hp < 100 || mon.status) && (
                <span className="w-16 shrink-0 space-y-0.5 text-right">
                  <HpBar value={mon.hp / 100} />
                  <span className="block font-mono text-[10px] text-muted-foreground">
                    {mon.hp}%{mon.status ? ` · ${t(`status.${mon.status}`)}` : ""}
                  </span>
                </span>
              )}
            </button>
          </li>
        ))}
        {data.team.length < LAB_TEAM_SIZE && (
          <li>
            <button
              type="button"
              onClick={() => onSelect(data.team.length)}
              aria-current={selected === data.team.length ? "true" : undefined}
              className={cn(
                "flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-sm text-muted-foreground transition-colors hover:border-screen/50 hover:text-foreground",
                selected === data.team.length ? "border-screen/70 text-foreground" : "border-foreground/15"
              )}
            >
              <Plus className="h-4 w-4" aria-hidden /> {t("team.add")}
            </button>
          </li>
        )}
      </ol>

      {/* Strategy */}
      <fieldset className="space-y-2">
        <legend className="hud-label mb-1.5">{t("team.plays", { side: name })}</legend>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label={t("team.strategyLabel", { side: name })}>
          {LAB_STRATEGIES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={data.strategy === s}
              onClick={() => update({ strategy: s })}
              className={cn(
                "rounded-md border px-2 py-1.5 text-left transition-colors",
                data.strategy === s ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-foreground/10 bg-shade/20 hover:border-screen/40"
              )}
            >
              <span className="block font-display text-sm font-bold uppercase tracking-wide">{t(`strategy.${s}.name`)}</span>
              <span className="block text-[11px] leading-tight text-muted-foreground">{t(`strategy.${s}.short`)}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(`strategy.${data.strategy}.blurb`)}</p>
        {data.strategy === "scripted" && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t("team.afterLast")}</span>
            <Toggle pressed={!data.loop} onChange={() => update({ loop: false })}>
              {t("team.repeatLast")}
            </Toggle>
            <Toggle pressed={data.loop} onChange={() => update({ loop: true })}>
              {t("team.startOver")}
            </Toggle>
            <span className="text-muted-foreground">{t("team.pickEach")}</span>
          </div>
        )}
      </fieldset>

      {/* Hazards and screens */}
      {sideFieldFor(setup.gen).length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="hud-label mb-1.5">{t("team.onSide", { side: name })}</legend>
          <div className="flex flex-wrap gap-1.5">
            {sideFieldFor(setup.gen).map(({ key, layers }) =>
              layers > 1 ? (
                <label key={key} className="inline-flex h-8 items-center max-sm:h-10 gap-1.5 rounded-md border border-foreground/10 bg-shade/30 px-2 text-xs font-semibold text-muted-foreground">
                  {names.move(SIDE_FIELD_NAMES[key])}
                  <select
                    aria-label={t("team.layers", { side: name, name: names.move(SIDE_FIELD_NAMES[key]) })}
                    value={data.field[key] as number}
                    onChange={(e) => update({ field: { ...data.field, [key]: Number(e.target.value) } })}
                    className="bg-transparent font-mono text-foreground focus:outline-none"
                  >
                    {Array.from({ length: layers + 1 }, (_, n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <Toggle key={key} pressed={!!data.field[key]} onChange={(on) => update({ field: { ...data.field, [key]: on } })}>
                  {names.move(SIDE_FIELD_NAMES[key])}
                </Toggle>
              )
            )}
          </div>
        </fieldset>
      )}
    </section>
  );
}

function SmallButton({ pressed, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40",
        pressed ? "border-screen/60 bg-screen/15 text-foreground" : "border-foreground/10 bg-shade/30 text-muted-foreground hover:border-screen/50 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/** The trainer's saved teams, any format, to load as a whole. */
function TeamList({ onPick }: { onPick: (team: BattleTeam) => void }) {
  const t = useT(battleLab);
  const tt = useT(battleTeams);
  const teams = useTeams();
  const usable = (teams ?? []).filter((team) => team.sets.length);
  if (teams === null) return null;
  if (!usable.length) {
    return (
      <p className="rounded-md border bg-shade/20 p-3 text-sm text-muted-foreground">
        {t.rich("team.noTeams", {
          link: (chunks) => (
            <Link href="/battle/teams" className="text-screen underline-offset-2 hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    );
  }
  return (
    <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border bg-shade/20 p-1.5" aria-label={t("team.saved")}>
      {usable.map((team) => (
        <li key={team.id}>
          <button type="button" onClick={() => onPick(team)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-screen/10">
            <span className="truncate font-semibold">{team.name || tt("builder.untitled")}</span>
            <span className="hud-label shrink-0 normal-case tracking-wider">
              {BATTLE_FORMATS[team.format].name} · {team.sets.length}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
