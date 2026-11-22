"use client";

import { useEffect, useMemo, useState } from "react";
import type { Generations } from "@pkmn/data";
import { ArrowLeftRight, Check, ClipboardCopy, LoaderCircle } from "lucide-react";
import { useT } from "@/i18n/client";
import battleCalc from "@/messages/battle-calc";
import {
  calcMoves,
  emptyField,
  emptySide,
  FIELD_FLAGS,
  SIDE_FLAGS,
  TERRAINS,
  WEATHERS,
  type CalcField,
  type CalcLine,
  type CalcModule,
  type CalcSide,
} from "@/lib/battle/calc";
import { byDexNumber, loadCalcGenerations } from "@/lib/battle/dex";
import { BATTLE_FORMATS } from "@/lib/battle/formats";
import { cn } from "@/lib/utils";
import { CalcPanel, type CalcLists } from "./CalcPanel";
import { BattleType } from "./pickers";
import { useBattleNames } from "./use-battle-names";

const GENS = [9, 8, 7, 6, 5, 4, 3];
const NO_CRITS = [false, false, false, false];

/** A standard opener: Garchomp into Heatran. */
const DEFAULT_SIDES: [CalcSide, CalcSide] = [
  {
    ...emptySide("Garchomp"),
    ability: "Rough Skin",
    item: "Life Orb",
    nature: "Jolly",
    evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
    teraType: "Ground",
    moves: ["Earthquake", "Dragon Claw", "Stone Edge", "Fire Fang"],
  },
  {
    ...emptySide("Heatran"),
    ability: "Flash Fire",
    item: "Leftovers",
    nature: "Calm",
    evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 252, spe: 0 },
    teraType: "Grass",
    moves: ["Magma Storm", "Earth Power", "Flash Cannon", "Stealth Rock"],
  },
];

/** One move's result, with the move slot (0-3) it came from. */
type SlotLine = CalcLine & { slot: number };
type Side = 0 | 1;
/** The move whose full line shows under the results: a side and its move slot. */
type Pick = { side: Side; slot: number };

const pair = <T,>(a: T, b: T, i: Side, value: T): [T, T] => (i === 0 ? [value, b] : [a, value]);

export function DamageCalc() {
  const t = useT(battleCalc);
  const names = useBattleNames();
  const [lib, setLib] = useState<{ calc: CalcModule; gens: Generations } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [genNum, setGenNum] = useState(9);
  const [sides, setSides] = useState<[CalcSide, CalcSide]>(DEFAULT_SIDES);
  const [field, setField] = useState<CalcField>(emptyField);
  // Critical hits, per move slot of each side (Showdown's calculator has a crit toggle on every move).
  const [crits, setCrits] = useState<[boolean[], boolean[]]>([NO_CRITS, NO_CRITS]);
  const [pick, setPick] = useState<Pick>({ side: 0, slot: 0 });

  // The calculator and its data load on this page only.
  useEffect(() => {
    let live = true;
    Promise.all([import("@smogon/calc/dist/adaptable"), loadCalcGenerations()]).then(
      ([calc, gens]) => live && setLib({ calc, gens }),
      () => live && setLoadError(true)
    );
    return () => {
      live = false;
    };
  }, []);

  const lists = useMemo<CalcLists | null>(() => {
    if (!lib) return null;
    const gen = lib.gens.get(genNum);
    const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
    return {
      gen,
      species: [...gen.species].filter((s) => s.num > 0).sort(byDexNumber),
      items: [...gen.items].sort(byName),
      // No Z or Max moves (the calc takes those as options), nor typeless Struggle.
      moves: [...gen.moves].filter((m) => !m.isZ && !m.isMax && gen.types.get(m.type)).sort(byName),
      abilities: [...gen.abilities].sort(byName),
      natures: [...gen.natures].sort(byName),
      types: [...gen.types].map((t) => t.name as string).filter((t) => t !== "???"),
    };
  }, [lib, genNum]);

  const results = useMemo(() => {
    if (!lib || !lists) return null;
    const calc = { gen: lists.gen, lib: lib.calc };
    const run = (a: CalcSide, d: CalcSide, crit: boolean[]): SlotLine[] | string => {
      if (!lists.gen.species.get(a.species) || !lists.gen.species.get(d.species)) return t("results.notInGen", { n: genNum });
      try {
        // Move by move, so each takes its own crit toggle; the calc itself is the same as for all four at once.
        return a.moves.flatMap((move, slot) => calcMoves(calc, { ...a, moves: [move] }, d, { ...field, crit: !!crit[slot] }).map((line) => ({ ...line, slot })));
      } catch (err) {
        return err instanceof Error ? err.message : t("results.failed");
      }
    };
    return [run(sides[0], sides[1], crits[0]), run(sides[1], sides[0], crits[1])] as const;
  }, [lib, lists, sides, field, genNum, crits, t]);

  const setSide = (i: Side) => (side: CalcSide) => setSides((s) => pair(s[0], s[1], i, side));
  const setSideCrits = (i: Side) => (next: boolean[]) => setCrits((c) => pair(c[0], c[1], i, next));
  const swap = () => {
    setSides(([a, b]) => [b, a]);
    setCrits(([a, b]) => [b, a]);
    setPick((p) => ({ side: p.side === 0 ? 1 : 0, slot: p.slot }));
  };

  if (loadError) {
    return <p className="py-16 text-center text-sm text-destructive">{t("loadError")}</p>;
  }
  if (!lib || !lists || !results) {
    return (
      <p className="flex min-h-[75vh] items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {t("loading")}
      </p>
    );
  }

  // The picked move's line; if that slot has none (its move was cleared), that side's first, then the other side's.
  const linesOf = (i: Side) => (typeof results[i] === "string" ? [] : (results[i] as SlotLine[]));
  const shown: { side: Side; line: SlotLine } | null = (() => {
    const own = linesOf(pick.side);
    const exact = own.find((l) => l.slot === pick.slot) ?? own[0];
    if (exact) return { side: pick.side, line: exact };
    const other: Side = pick.side === 0 ? 1 : 0;
    const first = linesOf(other)[0];
    return first ? { side: other, line: first } : null;
  })();

  const panel = (i: Side) => (
    <CalcPanel
      index={i}
      title={i === 0 ? t("panel.one") : t("panel.two")}
      side={sides[i]}
      lists={lists}
      crits={crits[i]}
      onCrits={setSideCrits(i)}
      onChange={setSide(i)}
      onLoad={(team) => {
        setGenNum(BATTLE_FORMATS[team.format].gen);
        setSideCrits(i)(NO_CRITS);
      }}
    />
  );

  return (
    <div className="calc-dense space-y-3">
      {/* Generation */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="hud-label">{t("gen.label")}</span>
        <div className="flex rounded-md border border-foreground/10 bg-shade/30 p-0.5 max-sm:w-full" role="group" aria-label={t("gen.label")}>
          {GENS.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={genNum === g}
              onClick={() => setGenNum(g)}
              aria-label={t("gen.button", { n: g })}
              className={cn(
                "whitespace-nowrap rounded-sm px-2.5 py-1.5 font-pixel text-[10px] leading-none max-sm:h-10 max-sm:flex-1 max-sm:px-0 max-sm:text-xs",
                genNum === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="hidden sm:inline">{t("gen.button", { n: g })}</span>
              <span className="sm:hidden">{g}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Results: both sides' moves, then the picked move's full line and its rolls. */}
      <section className="hud rounded-lg border bg-card" aria-label={t("results.label")} data-testid="calc-results">
        <div className="grid gap-x-4 gap-y-3 p-2.5 sm:grid-cols-2 md:p-3">
          {([0, 1] as const).map((i) => (
            <MoveResults
              key={i}
              side={i}
              title={t("results.moves", { name: names.species(sides[i].species) })}
              lines={results[i]}
              picked={shown?.side === i ? shown.line.slot : null}
              onPick={(slot) => setPick({ side: i, slot })}
            />
          ))}
        </div>
        <MainLine line={shown?.line ?? null} />
      </section>

      {/* Pokémon 1, the field, Pokémon 2 (phones: both Pokémon, then the field). */}
      <div className="grid items-start gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_16rem_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_18.5rem_minmax(0,1fr)]">
        {panel(0)}
        <FieldPanel
          field={field}
          onChange={setField}
          sides={sides}
          onSide={(i, side) => setSide(i)(side)}
          onSwap={swap}
          className="max-lg:order-last md:max-lg:col-span-2"
        />
        {panel(1)}
      </div>
    </div>
  );
}

/** "50.4 – 59.8%" coloured by the KO it gives: green for a possible OHKO, amber for any other KO. */
function koTone(line: CalcLine) {
  return /OHKO/.test(line.ko) ? "text-success" : line.ko ? "text-warning" : "text-foreground";
}

function MoveResults({
  side,
  title,
  lines,
  picked,
  onPick,
}: {
  side: Side;
  title: string;
  lines: SlotLine[] | string;
  picked: number | null;
  onPick: (slot: number) => void;
}) {
  const t = useT(battleCalc);
  const names = useBattleNames();
  return (
    <div className="min-w-0 space-y-1.5" data-testid={`calc-moves-${side + 1}`}>
      <h2 className="hud-label truncate">{title}</h2>
      {typeof lines === "string" ? (
        <p className="text-[13px] text-destructive">{lines}</p>
      ) : lines.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("results.noMoves")}</p>
      ) : (
        <ul className="grid gap-1">
          {lines.map((line) => {
            const [lo, hi] = line.percent;
            const status = line.category === "Status";
            const none = !status && line.damage[1] === 0;
            const on = picked === line.slot;
            const range = status ? t("results.status") : none ? t("results.noDamage") : `${lo.toFixed(1)} – ${hi.toFixed(1)}%`;
            return (
              <li key={line.slot}>
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={t("results.showMove", { move: names.move(line.move), range })}
                  onClick={() => onPick(line.slot)}
                  data-testid="calc-move"
                  className={cn(
                    "relative flex h-7 w-full items-center gap-2 overflow-hidden rounded-md border pl-1.5 pr-2 text-left transition-colors max-md:h-10",
                    on ? "border-screen/60 bg-screen/[0.12]" : "border-foreground/10 bg-shade/20 hover:border-foreground/25 hover:bg-shade/40"
                  )}
                >
                  <BattleType type={line.type} className="w-[52px] shrink-0 max-sm:hidden" />
                  <span className={cn("min-w-0 flex-1 truncate font-display text-[13px] font-semibold", on && "text-foreground")}>{names.move(line.move)}</span>
                  {line.ko && <span className="hidden shrink-0 truncate text-[11px] text-muted-foreground xl:inline">{line.ko}</span>}
                  <span className={cn("shrink-0 font-mono text-[12.5px] font-bold tabular-nums", status || none ? "font-normal text-muted-foreground" : koTone(line))}>{range}</span>
                  {!status && !none && (
                    <span className="absolute inset-x-0 bottom-0 h-[2px] bg-foreground/[0.06]" aria-hidden>
                      <span className="absolute inset-y-0 left-0 bg-success/80" style={{ width: `${Math.min(100, lo)}%` }} />
                      <span className="absolute inset-y-0 bg-warning/70" style={{ left: `${Math.min(100, lo)}%`, width: `${Math.max(0, Math.min(100, hi) - Math.min(100, lo))}%` }} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The picked move's Showdown line in bold, its rolls underneath, and the copy button. */
function MainLine({ line }: { line: SlotLine | null }) {
  const t = useT(battleCalc);
  const names = useBattleNames();
  const [copied, setCopied] = useState(false);
  if (!line) {
    return <p className="border-t border-foreground/10 px-3 py-2.5 text-[13px] text-muted-foreground">{t("results.pick")}</p>;
  }
  const status = line.category === "Status";
  const desc = status ? t("results.statusLine", { move: names.move(line.move) }) : line.desc;
  return (
    <div className="space-y-1 border-t border-foreground/10 bg-shade/15 px-2.5 py-2 md:px-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 select-all break-words text-[13px] font-bold leading-snug" data-testid="calc-desc">
          {desc}
        </p>
        {!status && (
          <button
            type="button"
            aria-label={t("results.copy", { move: names.move(line.move) })}
            onClick={() =>
              navigator.clipboard?.writeText(line.desc).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                },
                () => undefined
              )
            }
            className="tap -mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />}
          </button>
        )}
      </div>
      {line.rolls.length > 0 && line.damage[1] > 0 && (
        <p className="break-words font-mono text-[11px] leading-relaxed text-muted-foreground" data-testid="calc-rolls">
          <span className="font-sans font-semibold">{t("results.rolls")}</span> ({line.rolls.join(", ")})
        </p>
      )}
    </div>
  );
}

/** Small segmented buttons: one of a few values (pressing the picked one again clears it when `clearable`). */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className,
  cols,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** A fixed grid (equal widths) instead of wrapping chips. */
  cols?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn(cols ? `grid gap-1 ${cols}` : "flex flex-wrap gap-1", className)}>
      {options.map((o) => (
        <Chip key={String(o.value)} pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

function Chip({ pressed, onClick, children, label, className }: { pressed: boolean; onClick: () => void; children: React.ReactNode; label?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "h-[26px] min-w-0 truncate rounded-[5px] border px-1 text-[11.5px] font-semibold max-md:text-xs leading-none transition-colors",
        pressed ? "border-screen/60 bg-screen/15 text-foreground" : "border-foreground/10 bg-shade/25 text-muted-foreground hover:border-foreground/25 hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

function FieldPanel({
  field,
  onChange,
  sides,
  onSide,
  onSwap,
  className,
}: {
  field: CalcField;
  onChange: (field: CalcField) => void;
  sides: [CalcSide, CalcSide];
  onSide: (i: Side, side: CalcSide) => void;
  onSwap: () => void;
  className?: string;
}) {
  const t = useT(battleCalc);
  const names = useBattleNames();
  const update = (patch: Partial<CalcField>) => onChange({ ...field, ...patch });
  const none = { value: "", label: t("field.none") };
  return (
    <section className={cn("hud min-w-0 space-y-3 rounded-lg border bg-card p-2.5 md:p-3", className)} aria-label={t("field.label")} data-testid="calc-field">
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 flex-1 font-display text-sm font-bold uppercase tracking-wide">{t("field.label")}</h2>
        <button
          type="button"
          onClick={onSwap}
          aria-label={t("field.swap")}
          title={t("field.swap")}
          data-testid="calc-swap"
          className="group inline-flex h-7 items-center gap-1.5 rounded-full border border-screen/50 bg-card px-2.5 text-xs font-semibold text-screen shadow-[0_0_14px_-6px_hsl(var(--screen))] transition-colors hover:bg-screen/10 max-md:h-10 max-md:px-4"
        >
          <ArrowLeftRight className="h-3.5 w-3.5 transition-transform group-hover:rotate-180" aria-hidden /> {t("field.swap")}
        </button>
      </div>

      <FieldGroup label={t("field.battle")}>
        <Segmented
          label={t("field.battle")}
          cols="grid-cols-2"
          value={field.gameType}
          onChange={(gameType) => update({ gameType })}
          options={[
            { value: "Singles", label: t("field.singles") },
            { value: "Doubles", label: t("field.doubles") },
          ]}
        />
        {field.gameType === "Doubles" && <p className="pt-1 text-[11px] text-muted-foreground">{t("field.doublesNote")}</p>}
      </FieldGroup>

      <FieldGroup label={t("field.terrain")}>
        <Segmented
          label={t("field.terrain")}
          cols="grid-cols-3"
          value={field.terrain}
          onChange={(terrain) => update({ terrain })}
          options={[none, ...TERRAINS.map((v) => ({ value: v as string, label: t(`terrains.${v}`) }))]}
        />
      </FieldGroup>

      <FieldGroup label={t("field.weather")}>
        {/* None and the five weathers in a 3 × 2 grid; the three primal weathers (longer names) on their own row. */}
        <div className="space-y-1">
          <Segmented
            label={t("field.weather")}
            cols="grid-cols-3"
            value={field.weather}
            onChange={(weather) => update({ weather })}
            options={[none, ...WEATHERS.slice(0, 5).map((v) => ({ value: v as string, label: t(`weathers.${v}`) }))]}
          />
          <Segmented
            label={t("field.weather")}
            cols="grid-cols-[1.3fr_1fr_1.15fr] lg:max-xl:grid-cols-2"
            value={field.weather}
            onChange={(weather) => update({ weather })}
            options={WEATHERS.slice(5).map((v) => ({ value: v as string, label: t(`weathers.${v}`) }))}
          />
        </div>
      </FieldGroup>

      <FieldGroup label={t("field.effects")}>
        <div className="grid grid-cols-2 gap-1">
          {FIELD_FLAGS.map(([flag]) => (
            <Chip key={flag} pressed={!!field.flags[flag]} onClick={() => update({ flags: { ...field.flags, [flag]: !field.flags[flag] } })}>
              {t(`fieldFlags.${flag}`)}
            </Chip>
          ))}
        </div>
      </FieldGroup>

      {/* Each side's screens, support and hazards: Pokémon 1's on the left, Pokémon 2's on the right, as the panels. */}
      <FieldGroup label={t("field.sides")}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-1.5 gap-y-[3px] max-md:gap-y-1">
          <p className="truncate font-display text-xs font-semibold" title={names.species(sides[0].species)}>
            {names.species(sides[0].species)}
          </p>
          <span />
          <p className="truncate text-right font-display text-xs font-semibold" title={names.species(sides[1].species)}>
            {names.species(sides[1].species)}
          </p>
          {SIDE_ORDER.map((flag) =>
            flag === "spikes" ? (
              <SpikesRow key={flag} sides={sides} onSide={onSide} />
            ) : (
              <FlagRow
                key={flag}
                label={t(`sideFlags.${flag}`)}
                cells={(i) => (
                  <SideToggle
                    side={i}
                    pressed={!!sides[i].flags[flag]}
                    label={t("field.flagLabel", { side: names.species(sides[i].species), flag: t(`sideFlags.${flag}`) })}
                    onClick={() => onSide(i, { ...sides[i], flags: { ...sides[i].flags, [flag]: !sides[i].flags[flag] } })}
                  />
                )}
              />
            )
          )}
        </div>
      </FieldGroup>
    </section>
  );
}

/** Hazards and screens first, as in Showdown's calculator; then the rest the calc supports. */
const SIDE_ORDER = [
  "isSR",
  "spikes",
  "isReflect",
  "isLightScreen",
  "isAuroraVeil",
  "isHelpingHand",
  "isTailwind",
  ...SIDE_FLAGS.map(([flag]) => flag).filter((f) => !["isSR", "isReflect", "isLightScreen", "isAuroraVeil", "isHelpingHand", "isTailwind"].includes(f)),
] as const;

/** One row of the side table: Pokémon 1's control, the name in the middle, Pokémon 2's control. */
function FlagRow({ label, cells }: { label: string; cells: (i: Side) => React.ReactNode }) {
  return (
    <>
      {cells(0)}
      <span className="max-w-[7.5rem] truncate text-center text-xs text-muted-foreground">{label}</span>
      {cells(1)}
    </>
  );
}

/** A side's on/off cell: a slim bar that lights up, mirrored left and right. */
function SideToggle({ side, pressed, label, onClick }: { side: Side; pressed: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-[22px] w-full items-center rounded-[5px] border px-1.5 transition-colors",
        side === 1 && "justify-end",
        pressed ? "border-screen/60 bg-screen/15 text-screen" : "border-foreground/10 bg-shade/25 text-transparent hover:border-foreground/25"
      )}
    >
      <Check className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function SpikesRow({ sides, onSide }: { sides: [CalcSide, CalcSide]; onSide: (i: Side, side: CalcSide) => void }) {
  const t = useT(battleCalc);
  const names = useBattleNames();
  const cell = (i: Side) => (
    <div role="group" aria-label={t("field.spikesLabel", { side: names.species(sides[i].species) })} className="grid grid-cols-4 gap-0.5">
      {[0, 1, 2, 3].map((n) => (
        <Chip key={n} pressed={sides[i].spikes === n} onClick={() => onSide(i, { ...sides[i], spikes: n })} className="h-[22px] px-0 font-mono text-[11px]">
          {n}
        </Chip>
      ))}
    </div>
  );
  return <FlagRow label={t("field.spikes")} cells={cell} />;
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="hud-label">{label}</h3>
      {children}
    </div>
  );
}
