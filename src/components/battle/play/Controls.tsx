"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Crosshair, Gem, Sparkles, Undo2 } from "lucide-react";
import type { BattleRequest, BattleRequestMove, BattleRequestPokemon } from "@/lib/battle/play";
import { BattleSprite } from "@/components/battle/BattleSprite";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { cn } from "@/lib/utils";
import { Dex } from "@pkmn/dex";
import { other, type MonSnap, type SideId, type Snap } from "./model";
import { effectiveness, moveInfo, targetChoices, type Effect } from "./moves";
import { HpBar, STATUS_STYLE } from "./Hud";
import { teraColor } from "./player";
import { MonTip, MoveTip, Tip, isRandomFormat, tipFromRequest, tipFromSnap } from "./Tooltips";
import type { FieldMon, FieldState } from "@/lib/battle/tooltip-calc";
import { useBattleKeys, type BattleKeys } from "./hotkeys";
import { benchOrder } from "./model";

/**
 * What the player can do now, built from their request: pick a lead (team
 * preview), a move (with Tera) or a switch, a replacement after a faint, and
 * in doubles a choice per Pokémon with a target where the move needs one.
 * Every choice goes out in the simulator's syntax, fully explicit.
 */

type Extra = "mega" | "zmove" | "dynamax";
const EXTRA_LABEL: Record<Extra, string> = { mega: "Mega Evolve", zmove: "Z-Move", dynamax: "Dynamax" };

interface Props {
  request: BattleRequest;
  snap: Snap;
  me: SideId;
  doubles: boolean;
  busy: boolean;
  onChoose: (choice: string) => void;
  /** The battle's format (random formats know their spreads; tooltips use it). */
  format: string;
  /** "?": show or hide the hotkey list. */
  onHelp?: () => void;
}

const fainted = (p: BattleRequestPokemon) => p.condition.endsWith(" fnt");
const speciesOf = (p: BattleRequestPokemon) => p.details.split(",")[0];

function hpOf(p: BattleRequestPokemon): [number, number, string] {
  const [hp, rest] = p.condition.split(" ");
  const [cur, max] = hp.split("/").map(Number);
  return [cur || 0, max || 0, rest && rest !== "fnt" ? rest : ""];
}

function speciesKey(name: string) {
  const s = Dex.species.get(name);
  return { id: s.id, num: s.num };
}

const EFFECT_LABEL: Record<Effect, { text: string; className: string; mark: string }> = {
  super: { text: "Super effective", className: "bg-emerald-400 text-black shadow-[0_0_10px_rgb(52_211_153/0.7)]", mark: "▲" },
  neutral: { text: "Effective", className: "bg-black/30 text-white", mark: "●" },
  resisted: { text: "Not very effective", className: "bg-amber-300 text-black", mark: "▼" },
  immune: { text: "No effect", className: "bg-slate-700 text-white", mark: "✕" },
};

/** What the Pokémon tooltips need: the generation, the format and your Pokémon as the field shows them. */
type TipInfo = { gen: number; format: string; seen: MonSnap[] };

const NO_FIELD: FieldState = { doubles: false, weather: "", terrain: "", pseudo: [], attacker: [], defender: [] };

/** Your Pokémon as the damage calculator should see it: exact stats, item, ability and HP from the request; boosts from the field. */
function attackerOf(p: BattleRequestPokemon | undefined, seen: MonSnap | null | undefined, teraOn: boolean, teraType?: string): FieldMon | null {
  if (!p) return null;
  const [hpText, status] = p.condition.split(" ");
  const [hp, max] = hpText.split("/").map(Number);
  return {
    species: speciesOf(p),
    level: Number(/, L(\d+)/.exec(p.details)?.[1] ?? 100),
    hpPercent: max ? (hp / max) * 100 : 100,
    boosts: seen?.boosts ?? {},
    status: status && status !== "fnt" ? status : "",
    item: p.item ? Dex.items.get(p.item).name : undefined,
    ability: Dex.abilities.get(p.ability || p.baseAbility).name || undefined,
    teraType: teraOn && teraType ? teraType : p.terastallized || undefined,
    terastallized: (teraOn && !!teraType) || !!p.terastallized,
    stats: { ...p.stats, hp: max || undefined },
  };
}

const CATEGORY_MARK: Record<string, string> ={ Physical: "✸ Physical", Special: "◎ Special", Status: "◇ Status" };

function MoveButton({
  gen,
  move,
  index,
  foes,
  tera,
  teraType,
  disabled,
  onPick,
  tip,
}: {
  gen: number;
  move: BattleRequestMove;
  index: number;
  foes: (MonSnap | null)[];
  tera: boolean;
  teraType?: string;
  disabled: boolean;
  onPick: (index: number, move: BattleRequestMove) => void;
  /** What the move tooltip needs for its damage ranges. */
  tip?: { attacker: FieldMon | null; field: FieldState; randomBattle: boolean; foes: (MonSnap | null)[] };
}) {
  const info = moveInfo(move.move || move.id, gen);
  const type = tera && info.id === "terablast" && teraType ? teraType : info.type;
  const color = typeColor(type.toLowerCase());
  const off = disabled || !!move.disabled;
  const hints = foes.map((foe) => effectiveness(info, foe, tera ? teraType : undefined, gen));
  const shown = hints.filter((h): h is Effect => h !== null);
  const ppShare = move.maxpp ? Math.max(0, Math.min(1, (move.pp ?? 0) / move.maxpp)) : 1;
  return (
    <Tip content={() => <MoveTip info={info} type={type} pp={move.pp} maxpp={move.maxpp} gen={gen} attacker={tip?.attacker ?? null} foes={tip?.foes ?? foes} field={tip?.field ?? NO_FIELD} randomBattle={!!tip?.randomBattle} />}>
    <button
      type="button"
      disabled={off}
      onClick={() => onPick(index, move)}
      data-testid="move-button"
      aria-keyshortcuts={String(index)}
      className={cn(
        "battle-move group relative flex min-h-[5.25rem] flex-col justify-between overflow-hidden rounded-lg border-2 px-3 pb-2.5 pt-2 text-left transition-[transform,filter,box-shadow] duration-100 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 sm:min-h-[4.5rem]",
        tera && "ring-2 ring-offset-2 ring-offset-background"
      )}
      style={{
        borderColor: `${color}`,
        background: `radial-gradient(120% 140% at 0% 0%, ${color} 0%, ${color}dd 45%, color-mix(in srgb, ${color} 55%, #0b0a18) 100%)`,
        color: typeTextColor(type.toLowerCase()),
        boxShadow: tera ? `0 0 16px ${teraColor(teraType ?? "")}` : `0 4px 0 color-mix(in srgb, ${color} 45%, #000), 0 8px 18px -8px ${color}`,
        ...(tera ? { ["--tw-ring-color" as string]: teraColor(teraType ?? "") } : {}),
      }}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-display text-base font-bold uppercase leading-tight tracking-wide">
          <kbd className="mr-1.5 hidden rounded-sm bg-black/25 px-1 align-middle font-pixel text-[9px] font-normal sm:inline">{index}</kbd>
          {info.name}
        </span>
        <span className={cn("shrink-0 rounded-sm bg-black/25 px-1 py-0.5 font-pixel text-[10px] tabular-nums", ppShare <= 0.25 ? "text-[#ffd1d1]" : "opacity-90")}>
          {move.pp ?? "–"}/{move.maxpp ?? "–"}
        </span>
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-pixel text-[9px] uppercase opacity-90">
        <span className="rounded-sm bg-black/25 px-1 py-0.5">{type}</span>
        <span>{CATEGORY_MARK[info.category]}</span>
        {info.power > 0 && <span>Pow {info.power}</span>}
        <span>Acc {info.accuracy === true ? "—" : `${info.accuracy}%`}</span>
        {info.priority !== 0 && <span>Pri {info.priority > 0 ? `+${info.priority}` : info.priority}</span>}
      </span>
      {shown.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-1">
          {hints.map((h, i) =>
            h ? (
              <span key={i} className={cn("inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-pixel text-[8px] uppercase", EFFECT_LABEL[h].className)}>
                <span aria-hidden>{EFFECT_LABEL[h].mark}</span>
                {foes.length > 1 ? `${foes[i]?.name ?? "?"}: ` : ""}
                {EFFECT_LABEL[h].text}
              </span>
            ) : null
          )}
        </span>
      )}
      {typeof move.disabled === "string" && <span className="font-pixel text-[8px] uppercase">Disabled</span>}
      {/* PP left, as a thin gauge along the bottom. */}
      {move.maxpp ? (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-black/30" aria-hidden>
          <span className="block h-full" style={{ width: `${ppShare * 100}%`, background: ppShare <= 0.25 ? "#ff6b6b" : "rgb(255 255 255 / 0.7)" }} />
        </span>
      ) : null}
    </button>
    </Tip>
  );
}

function SwitchGrid({
  pokemon,
  allowed,
  onPick,
  label,
  tipInfo,
  benchKeys,
}: {
  pokemon: BattleRequestPokemon[];
  allowed: (p: BattleRequestPokemon, i: number) => boolean;
  onPick: (index: number) => void;
  label: string;
  tipInfo?: TipInfo;
  /** Show Showdown's 5-9 hotkeys on the Pokémon on the bench (the move menu). */
  benchKeys?: boolean;
}) {
  const bench = benchOrder(pokemon);
  return (
    <div className="space-y-2">
      <p className="hud-label flex items-center gap-1.5">
        <ArrowLeftRight className="h-3 w-3" aria-hidden /> {label}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {pokemon.map((p, i) => {
          const [hp, max, status] = hpOf(p);
          const ok = allowed(p, i);
          const species = speciesOf(p);
          const key = benchKeys ? bench.indexOf(i) : -1;
          const keyName = key >= 0 && key < 5 ? String(key + 5) : null;
          return (
            <Tip key={p.ident} content={() => <MonTip mon={tipFromRequest(p, tipInfo?.seen.find((m) => m.key === p.ident))} mine gen={tipInfo?.gen ?? 9} format={tipInfo?.format ?? ""} />}>
            <button
              type="button"
              disabled={!ok}
              onClick={() => onPick(i + 1)}
              data-testid="switch-button"
              aria-keyshortcuts={keyName ? `${keyName} Shift+${i + 1}` : `Shift+${i + 1}`}
              title={keyName ? `${keyName} or Shift+${i + 1}` : `Shift+${i + 1}`}
              className="menu-item relative flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left hover:border-screen/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {keyName && ok && <kbd className="pointer-events-none absolute right-1 top-1 hidden rounded border bg-muted px-1 font-mono text-[9px] leading-3 text-muted-foreground lg:block">{keyName}</kbd>}
              <BattleSprite species={speciesKey(species)} animated={false} size={40} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <span className="truncate font-display text-sm font-bold uppercase">{p.ident.split(": ")[1] ?? species}</span>
                  {status && STATUS_STYLE[status] && <span className={cn("rounded-sm px-1 font-pixel text-[8px] leading-4", STATUS_STYLE[status].className)}>{STATUS_STYLE[status].label}</span>}
                </span>
                <HpBar hp={fainted(p) ? 0 : hp} maxhp={max} className="mt-1 h-1.5" />
                <span className="font-pixel text-[9px] text-muted-foreground">{fainted(p) ? "Fainted" : p.active ? "In battle" : `${hp}/${max}`}</span>
              </span>
            </button>
            </Tip>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Team preview: their six (species only), then tap your lead (two in doubles);
 * the rest follow in order. Bring 6, pick N: tap the N that battle, in order.
 */
function TeamPreview({
  request,
  doubles,
  busy,
  onChoose,
  foes,
  tipInfo,
  keys,
}: {
  request: BattleRequest;
  doubles: boolean;
  busy: boolean;
  onChoose: (c: string) => void;
  foes: MonSnap[];
  tipInfo: TipInfo;
  keys: BattleKeys;
}) {
  const [leads, setLeads] = useState<number[]>([]);
  const size = request.side.pokemon.length;
  const picking = !!request.maxChosenTeamSize && request.maxChosenTeamSize < size;
  const need = picking ? request.maxChosenTeamSize! : doubles ? 2 : 1;
  const pick = (n: number) => {
    const next = leads.includes(n) ? leads.filter((l) => l !== n) : [...leads, n];
    if (next.length >= need) {
      const rest = picking ? [] : request.side.pokemon.map((_, i) => i + 1).filter((i) => !next.includes(i));
      onChoose(`team ${[...next, ...rest].join("")}`);
      setLeads([]);
    } else setLeads(next);
  };
  keys.digit = (n) => {
    if (!busy && n <= size) pick(n);
  };
  keys.back = () => setLeads([]);
  return (
    <div className="space-y-3">
      {foes.length > 0 && (
        <div className="space-y-1.5">
          <p className="hud-label">Their team</p>
          <div className="flex flex-wrap gap-1" data-testid="foe-preview">
            {foes.map((m) => (
              <Tip key={m.key} content={() => <MonTip mon={tipFromSnap(m)} mine={false} gen={tipInfo.gen} format={tipInfo.format} />}>
              <span className="flex flex-col items-center rounded-md border border-screen/30 bg-shade/20 px-1.5 py-1">
                <BattleSprite species={speciesKey(m.species)} size={44} />
                <span className="max-w-[4.5rem] truncate text-[10px] text-muted-foreground">{m.species}</span>
              </span>
              </Tip>
            ))}
          </div>
        </div>
      )}
      <p className="font-display text-lg font-bold uppercase">
        {picking ? `Choose ${need} to battle (the first leads)` : doubles ? "Choose your two leads" : "Choose your lead"}
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {request.side.pokemon.map((p, i) => {
          const species = speciesOf(p);
          const chosen = leads.indexOf(i + 1);
          return (
            <button
              key={p.ident}
              type="button"
              disabled={busy}
              onClick={() => pick(i + 1)}
              data-testid="lead-button"
              className={cn("relative flex flex-col items-center rounded-md border bg-card p-2 hover:border-screen/60", chosen >= 0 && "border-primary ring-2 ring-primary")}
            >
              {chosen >= 0 && <span className="absolute left-1 top-1 font-pixel text-[10px] text-primary">#{chosen + 1}</span>}
              <BattleSprite species={speciesKey(species)} size={56} />
              <span className="w-full truncate text-center font-display text-xs font-bold uppercase">{species}</span>
              <span className="w-full truncate text-center text-[10px] text-muted-foreground">{p.item ? Dex.items.get(p.item).name : "No item"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Controls({ request, snap, me, doubles, busy, onChoose, format, onHelp }: Props) {
  /** Filled in below for whichever menu is showing; the listener reads it on every key. */
  const keys: BattleKeys = {};
  useBattleKeys(keys, () => onHelp?.());
  const [parts, setParts] = useState<string[]>([]);
  const [tera, setTera] = useState(false);
  /** Mega Evolution, a Z-Move or Dynamax for this Pokémon's move (where the rules and gen allow it). */
  const [extra, setExtra] = useState<Extra | null>(null);
  const [aiming, setAiming] = useState<{ index: number; move: BattleRequestMove; targets: number[] } | null>(null);
  const foeSide = snap.sides[other(me)];
  const mySide = snap.sides[me];

  // Doubles builds one choice per slot; a fainted or commanding Pokémon passes.
  const slots = request.forceSwitch?.length ?? request.active?.length ?? 0;
  const passes = (s: number) => {
    const p = request.side.pokemon[s];
    if (request.forceSwitch) return !request.forceSwitch[s];
    return !request.active?.[s] || !p || fainted(p) || !!p.commanding;
  };
  /** The choices so far plus any passes due next (a fainted Pokémon with nothing to replace it). */
  const fill = (list: string[]) => {
    let next = list;
    while (next.length < slots && passes(next.length)) next = [...next, "pass"];
    return next;
  };
  const filled = fill(parts);
  const slot = filled.length;
  const switchingIn = useMemo(() => parts.map((c) => /^switch (\d+)$/.exec(c)?.[1]).filter(Boolean).map(Number), [parts]);
  const teraTaken = parts.some((c) => c.includes("terastallize"));
  const extraTaken = (e: Extra) => parts.some((c) => c.endsWith(` ${e}`));
  const suffix = () => `${tera && teraType ? " terastallize" : ""}${extra && extraOn(extra) ? ` ${extra}` : ""}`;

  function add(choice: string) {
    const next = fill([...filled, choice]);
    setAiming(null);
    setTera(false);
    setExtra(null);
    if (next.length >= slots) {
      onChoose(next.join(", "));
      setParts([]);
    } else setParts(next);
  }

  if (request.teamPreview) return <TeamPreview request={request} doubles={doubles} busy={busy} onChoose={onChoose} foes={foeSide.team} tipInfo={{ gen: snap.gen, format, seen: mySide.team }} keys={keys} />;
  if (slot >= slots) return null;
  const actor = request.side.pokemon[slot];
  const actorName = actor?.ident.split(": ")[1] ?? "your Pokémon";
  const back =
    parts.length > 0 ? (
      <button type="button" className="hud-label flex items-center gap-1 hover:text-foreground" onClick={() => setParts([])}>
        <Undo2 className="h-3 w-3" aria-hidden /> Start over
      </button>
    ) : null;

  if (parts.length > 0) keys.back = () => setParts([]);

  if (request.forceSwitch) {
    const reviving = !!actor?.reviving;
    const canPick = (p: BattleRequestPokemon | undefined, i: number) => !!p && !busy && !p.active && !switchingIn.includes(i + 1) && (reviving ? fainted(p) : !fainted(p));
    keys.digit = (n) => {
      if (canPick(request.side.pokemon[n - 1], n - 1)) add(`switch ${n}`);
    };
    keys.shiftDigit = keys.digit;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg font-bold uppercase">{reviving ? "Revive which Pokémon?" : doubles ? `Replace ${actorName}` : "Send out which Pokémon?"}</p>
          {back}
        </div>
        <SwitchGrid
          tipInfo={{ gen: snap.gen, format, seen: mySide.team }}
          pokemon={request.side.pokemon}
          label={reviving ? "Fainted Pokémon" : "Your team"}
          allowed={(p, i) => canPick(p, i)}
          onPick={(n) => add(`switch ${n}`)}
        />
      </div>
    );
  }

  const active = request.active![slot];
  const teraType = active.canTerastallize && !teraTaken ? active.canTerastallize : undefined;
  const foes = doubles ? foeSide.active : foeSide.active.slice(0, 1);
  const fieldState: FieldState = { doubles, weather: snap.weather, terrain: snap.terrain, pseudo: snap.pseudo, attacker: mySide.conditions, defender: foeSide.conditions };
  const trapped = !!active.trapped;
  const extras: Extra[] = [];
  if (active.canMegaEvo && !extraTaken("mega")) extras.push("mega");
  if (active.canZMove?.some(Boolean) && !extraTaken("zmove")) extras.push("zmove");
  if (active.canDynamax && !extraTaken("dynamax")) extras.push("dynamax");
  const extraOn = (e: Extra) => extras.includes(e);

  if (aiming) {
    keys.digit = (n) => {
      const t = aiming.targets[n - 1];
      const mon = t === undefined ? null : t > 0 ? foeSide.active[t - 1] : mySide.active[-t - 1];
      if (t !== undefined && !busy && mon && !mon.fainted) add(`move ${aiming.index} ${t}${suffix()}`);
    };
    keys.back = () => setAiming(null);
    const at = (t: number) => (t > 0 ? foeSide.active[t - 1] : mySide.active[-t - 1]);
    const label = (t: number) => at(t)?.name ?? "Empty spot";
    // Showdown greys out spots with no Pokémon in them (the simulator would retarget anyway).
    const empty = (t: number) => {
      const mon = at(t);
      return !mon || mon.fainted;
    };
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg font-bold uppercase">{moveInfo(aiming.move.move || aiming.move.id, snap.gen).name}: pick a target</p>
          <button type="button" className="hud-label hover:text-foreground" onClick={() => setAiming(null)}>
            Back
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {aiming.targets.map((t, ti) => (
            <button
              key={t}
              type="button"
              data-testid="target-button"
              aria-keyshortcuts={String(ti + 1)}
              disabled={busy || empty(t)}
              onClick={() => add(`move ${aiming.index} ${t}${suffix()}`)}
              className={cn("menu-item flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-left hover:border-screen/60 disabled:opacity-40", t < 0 && "border-dashed")}
            >
              <Crosshair className="h-4 w-4 text-primary" aria-hidden />
              <span className="font-display font-bold uppercase">{label(t)}</span>
              <span className="hud-label ml-auto">{t > 0 ? "Foe" : t === -(slot + 1) ? "Self" : "Ally"}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const pickMove = (index: number, move: BattleRequestMove) => {
    const targets = doubles ? targetChoices(move.target, slot) : [];
    if (targets.length > 1) setAiming({ index, move, targets });
    else add(`move ${index}${targets[0] ? ` ${targets[0]}` : ""}${suffix()}`);
  };
  const canSwitchTo = (p: BattleRequestPokemon | undefined, i: number) => !!p && !busy && !trapped && !p.active && !fainted(p) && !switchingIn.includes(i + 1);
  const bench = benchOrder(request.side.pokemon);
  keys.digit = (n) => {
    // 5-9: switch to the first to fifth Pokémon on the bench (Showdown's keys).
    if (n >= 5) {
      const i = bench[n - 5];
      if (i !== undefined && canSwitchTo(request.side.pokemon[i], i)) add(`switch ${i + 1}`);
      return;
    }
    const move = active.moves[n - 1];
    if (!move || busy || move.disabled || (extra === "zmove" && !active.canZMove?.[n - 1])) return;
    pickMove(n, move);
  };
  keys.shiftDigit = (n) => {
    if (canSwitchTo(request.side.pokemon[n - 1], n - 1)) add(`switch ${n}`);
  };
  if (teraType) keys.tera = () => setTera((t) => !t);
  if (extras.length) keys.extra = () => setExtra((x) => (x ? null : extras[0]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-lg font-bold uppercase">What will {actorName} do?</p>
        <div className="flex items-center gap-3">
          {back}
          {teraType && (
            <button
              type="button"
              onClick={() => setTera((t) => !t)}
              aria-pressed={tera}
              data-testid="tera-toggle"
              aria-keyshortcuts="T"
              title="T"
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider transition",
                tera ? "text-black" : "bg-card text-foreground hover:border-screen/60"
              )}
              style={tera ? { background: teraColor(teraType), borderColor: teraColor(teraType), boxShadow: `0 0 14px ${teraColor(teraType)}` } : { borderColor: `${teraColor(teraType)}88` }}
            >
              <Gem className="h-3.5 w-3.5" aria-hidden /> Tera {teraType}
              {tera ? " on" : ""}
            </button>
          )}
          {extras.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setExtra((x) => (x === e ? null : e))}
              aria-pressed={extra === e}
              data-testid={`${e}-toggle`}
              aria-keyshortcuts="M"
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider transition",
                extra === e ? "border-primary bg-primary text-primary-foreground shadow-[0_0_14px_hsl(var(--primary)/0.6)]" : "bg-card text-foreground hover:border-screen/60"
              )}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> {EXTRA_LABEL[e]}
              {extra === e ? " on" : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:gap-2">
        {active.moves.map((move, i) => (
          <MoveButton
            key={`${move.id}-${i}`}
            gen={snap.gen}
            move={move}
            index={i + 1}
            foes={foes}
            tera={tera}
            teraType={teraType}
            disabled={busy || (extra === "zmove" && !active.canZMove?.[i])}
            onPick={pickMove}
            tip={{ attacker: attackerOf(request.side.pokemon[slot], mySide.active[slot], tera, teraType), field: fieldState, randomBattle: isRandomFormat(format), foes }}
          />
        ))}
      </div>
      <SwitchGrid
        tipInfo={{ gen: snap.gen, format, seen: mySide.team }}
        pokemon={request.side.pokemon}
        label={trapped ? "Can't switch: trapped" : "Switch"}
        benchKeys
        allowed={(p, i) => canSwitchTo(p, i)}
        onPick={(n) => add(`switch ${n}`)}
      />
    </div>
  );
}
