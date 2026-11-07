"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Crosshair, Gem, MoveHorizontal, Sparkles, Undo2 } from "lucide-react";
import { activesPerHalf, activesPerSide, gimmickFamily, gimmicksOf, moveAsUsed, playerCount, type BattleGimmick, type BattleRequest, type BattleRequestMove, type BattleRequestPokemon, type GameType } from "@/lib/battle/play";
import { canShift, sideIndexOf, targetSpots, type TargetSpot } from "@/lib/battle/choices";
import { BattleSprite } from "@/components/battle/BattleSprite";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { cn } from "@/lib/utils";
import { Dex } from "@pkmn/dex";
import { other, sameHalf, type MonSnap, type SideId, type Snap } from "./model";
import { effectiveness, moveInfo, targetChoices, type Effect } from "./moves";
import { HpBar, STATUS_STYLE } from "./Hud";
import { teraColor } from "./player";
import { MonTip, MoveTip, Tip, isRandomFormat, tipFromRequest, tipFromSnap } from "./Tooltips";
import type { FieldMon, FieldState } from "@/lib/battle/tooltip-calc";
import { useBattleKeys, type BattleKeys } from "./hotkeys";
import { benchOrder } from "./model";
import { aimableSpots, cycleExtra, emptiedSlots, fainted, fillPasses, slotCount, switchOptions, switchedIn, teamOrder } from "./choice";

/**
 * What the player can do now, built from their request: pick a lead (team
 * preview), a move (with Tera) or a switch, a replacement after a faint, and
 * in doubles a choice per Pokémon with a target where the move needs one.
 * Triples and four-player battles aim the same way on Showdown's own grid
 * (the foes' row above yours, spots out of reach greyed out), and in
 * triples a Pokémon on the edge can shift to the centre.
 * Every choice goes out in the simulator's syntax, fully explicit.
 */

type Extra = BattleGimmick;
const EXTRA_LABEL: Record<Extra, string> = { mega: "Mega Evolve", megax: "Mega Evolve X", megay: "Mega Evolve Y", ultra: "Ultra Burst", zmove: "Z-Move", dynamax: "Dynamax" };
const EXTRAS = new Set<string>(Object.keys(EXTRA_LABEL));

/** A move's name and type by id or name (Max Moves and G-Max Moves included), for the buttons. */
const moveNamed = (id: string) => {
  const m = Dex.moves.get(id);
  return { name: m.exists ? m.name : id, type: m.type };
};

interface Props {
  request: BattleRequest;
  snap: Snap;
  me: SideId;
  /** Showdown's game type (singles, doubles, triples, freeforall, multi). */
  gameType: GameType;
  /** Four-player battles: each side's trainer (target buttons and team preview name them). */
  names?: Partial<Record<SideId, string>>;
  busy: boolean;
  onChoose: (choice: string) => void;
  /** The battle's format (random formats know their spreads; tooltips use it). */
  format: string;
  /** "?": show or hide the hotkey list. */
  onHelp?: () => void;
}

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
        "battle-move group relative flex min-h-[5.25rem] max-sm:min-h-[3.75rem] max-sm:px-2.5 max-sm:pb-2 max-sm:pt-1.5 flex-col justify-between overflow-hidden rounded-lg border-2 px-3 pb-2.5 pt-2 text-left transition-[transform,filter,box-shadow] duration-100 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 sm:min-h-[4.5rem]",
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
        <span className="font-display text-base font-bold uppercase leading-tight tracking-wide max-sm:text-sm">
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
        <span className="max-sm:hidden">Acc {info.accuracy === true ? "—" : `${info.accuracy}%`}</span>
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

/** Remembered on this device: team preview asks for the whole order, not just the leads. */
const ORDER_ALL_KEY = "pokeiq:battle:order-all";

function readOrderAll(): boolean {
  try {
    return window.localStorage.getItem(ORDER_ALL_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Team preview: their six (species only), then tap your lead (two in doubles);
 * the rest follow in order. With "Set the whole order" on, tap the whole team
 * in order instead (or send once the leads are in), as Showdown's full
 * "team 123456" order. Bring 6, pick N: tap the N that battle, in order.
 */
function TeamPreview({
  request,
  leadCount,
  busy,
  onChoose,
  foes,
  others,
  tipInfo,
  keys,
}: {
  request: BattleRequest;
  /** Pokémon you lead with: 1, 2 in doubles, 3 in triples. */
  leadCount: number;
  busy: boolean;
  onChoose: (c: string) => void;
  foes: MonSnap[];
  /** Four-player battles: every other trainer's team, by name (your partner's marked). */
  others?: { name: string; partner: boolean; team: MonSnap[] }[];
  tipInfo: TipInfo;
  keys: BattleKeys;
}) {
  const [leads, setLeads] = useState<number[]>([]);
  const [orderAll, setOrderAll] = useState(false);
  useEffect(() => setOrderAll(readOrderAll()), []);
  const size = request.side.pokemon.length;
  const picking = !!request.maxChosenTeamSize && request.maxChosenTeamSize < size;
  const leadsNeeded = Math.min(size, leadCount);
  // The whole order: the last one left needs no tap.
  const ordering = orderAll && !picking && size > leadsNeeded;
  const need = picking ? request.maxChosenTeamSize! : ordering ? size - 1 : leadsNeeded;
  const send = (order: number[]) => {
    onChoose(teamOrder(order, size, !picking));
    setLeads([]);
  };
  const pick = (n: number) => {
    const next = leads.includes(n) ? leads.filter((l) => l !== n) : [...leads, n];
    if (next.length >= need) send(next);
    else setLeads(next);
  };
  const toggleOrderAll = () => {
    const on = !orderAll;
    setOrderAll(on);
    setLeads([]);
    try {
      window.localStorage.setItem(ORDER_ALL_KEY, on ? "1" : "0");
    } catch {
      // Private mode: the choice lasts for this battle only.
    }
  };
  keys.digit = (n) => {
    if (!busy && n <= size) pick(n);
  };
  keys.back = () => setLeads([]);
  const LEADS = ["", "lead", "two leads", "three leads"];
  return (
    <div className="space-y-3">
      {others?.map((o) =>
        o.team.length ? (
          <div key={o.name} className="space-y-1.5">
            <p className="hud-label">{o.partner ? `Your partner ${o.name}'s team` : `${o.name}'s team`}</p>
            <div className="flex flex-wrap gap-1" data-testid="foe-preview">
              {o.team.map((m, i) => (
                <Tip key={`${m.species}:${i}`} content={() => <MonTip mon={tipFromSnap(m)} mine={false} gen={tipInfo.gen} format={tipInfo.format} />}>
                  <span className={cn("flex flex-col items-center rounded-md border bg-shade/20 px-1.5 py-1", o.partner ? "border-primary/40" : "border-screen/30")}>
                    <BattleSprite species={speciesKey(m.species)} size={40} />
                    <span className="max-w-[4.5rem] truncate text-[10px] text-muted-foreground">{m.species}</span>
                  </span>
                </Tip>
              ))}
            </div>
          </div>
        ) : null
      )}
      {!others && foes.length > 0 && (
        <div className="space-y-1.5">
          <p className="hud-label">Their team</p>
          <div className="flex flex-wrap gap-1" data-testid="foe-preview">
            {foes.map((m, i) => (
              // Team preview's Pokémon have no ident yet (an empty key): keyed by their place.
              <Tip key={`${m.species}:${i}`} content={() => <MonTip mon={tipFromSnap(m)} mine={false} gen={tipInfo.gen} format={tipInfo.format} />}>
              <span className="flex flex-col items-center rounded-md border border-screen/30 bg-shade/20 px-1.5 py-1">
                <BattleSprite species={speciesKey(m.species)} size={44} />
                <span className="max-w-[4.5rem] truncate text-[10px] text-muted-foreground">{m.species}</span>
              </span>
              </Tip>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-lg font-bold uppercase">
          {picking ? `Choose ${need} to battle (the first leads)` : ordering ? "Tap your team in order (the first leads)" : `Choose your ${LEADS[leadsNeeded] ?? `${leadsNeeded} leads`}`}
        </p>
        {!picking && size > leadsNeeded && (
          <div className="flex items-center gap-2">
            {ordering && leads.length >= leadsNeeded && (
              <button type="button" disabled={busy} onClick={() => send(leads)} className="rounded-md border border-primary bg-primary px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50" data-testid="send-order">
                Send this order
              </button>
            )}
            <button
              type="button"
              onClick={toggleOrderAll}
              aria-pressed={orderAll}
              className={cn("rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider transition", orderAll ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/60")}
              data-testid="order-all"
              title="Choose the order of your whole team, not just the lead"
            >
              Set the whole order{orderAll ? " on" : ""}
            </button>
          </div>
        )}
      </div>
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

export function Controls({ request, snap, me, gameType, names, busy, onChoose, format, onHelp }: Props) {
  const doubles = gameType === "doubles";
  const perHalf = activesPerHalf(gameType);
  const four = playerCount(gameType) === 4;
  const sideIndex = sideIndexOf(request);
  /** Where your slot's Pokémon stands in your half (a four-player half has two trainers' Pokémon: p3's and p4's stand second). */
  const posOf = (slot: number) => (four && (me === "p3" || me === "p4") ? slot + 1 : slot);
  /** Filled in below for whichever menu is showing; the listener reads it on every key. */
  const keys: BattleKeys = {};
  useBattleKeys(keys, () => onHelp?.());
  const [parts, setParts] = useState<string[]>([]);
  const [tera, setTera] = useState(false);
  /** Mega Evolution, a Z-Move or Dynamax for this Pokémon's move (where the rules and gen allow it). */
  const [extra, setExtra] = useState<Extra | null>(null);
  const [aiming, setAiming] = useState<{ index: number; move: BattleRequestMove; targets: number[]; spots?: TargetSpot[] } | null>(null);
  const foeSide = snap.sides[other(me)];
  const mySide = snap.sides[me];

  // Doubles builds one choice per slot; a slot passes on its own when its Pokémon is fainted or commanding,
  // or, switching in after a faint, when there's nobody left on the bench for it (see ./choice).
  const slots = slotCount(request);
  const fill = (list: string[]) => fillPasses(request, list);
  const filled = fill(parts);
  const slot = filled.length;
  // Every slot passing (nobody left to send in at all): the choice goes out without asking, once per request.
  const sentFor = useRef<BattleRequest | null>(null);
  const allPass = !request.teamPreview && slots > 0 && parts.length === 0 && filled.length >= slots;
  useEffect(() => {
    if (!allPass || busy || sentFor.current === request) return;
    sentFor.current = request;
    onChoose(fillPasses(request, []).join(", "));
  }, [allPass, busy, request, onChoose]);
  const teraTaken = parts.some((c) => c.includes("terastallize"));
  // Each gimmick once a turn across the side (any Mega Evolution counts as the one Mega Evolution).
  const takenFamilies = new Set(parts.flatMap((c) => c.split(/[ ,]+/)).filter((w) => EXTRAS.has(w)).map((w) => gimmickFamily(w as Extra)));
  const extraTaken = (e: Extra) => takenFamilies.has(gimmickFamily(e));
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

  if (request.teamPreview) {
    const others = four
      ? (["p1", "p2", "p3", "p4"] as SideId[])
          .filter((id) => id !== me)
          .map((id) => ({ name: names?.[id] ?? id, partner: gameType === "multi" && sameHalf(id, me), team: snap.sides[id].team }))
      : undefined;
    return <TeamPreview request={request} leadCount={activesPerSide(gameType)} busy={busy} onChoose={onChoose} foes={foeSide.team} others={others} tipInfo={{ gen: snap.gen, format, seen: mySide.team }} keys={keys} />;
  }
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
    const options = switchOptions(request, slot, filled);
    const canPick = (p: BattleRequestPokemon | undefined, i: number) => !!p && !busy && options.includes(i + 1);
    // Two down and fewer left to send in: the spot without one stays empty.
    const emptied = emptiedSlots(request, filled).map((s) => request.side.pokemon[s]?.ident.split(": ")[1] ?? "your Pokémon");
    keys.digit = (n) => {
      if (canPick(request.side.pokemon[n - 1], n - 1)) add(`switch ${n}`);
    };
    keys.shiftDigit = keys.digit;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg font-bold uppercase">{reviving ? "Revive which Pokémon?" : slots > 1 ? `Replace ${actorName}` : "Send out which Pokémon?"}</p>
          {back}
        </div>
        {!reviving && emptied.length > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="switch-last-one">
            Only {options.length} Pokémon left to send in: {emptied.join(" and ")}&apos;s spot stays empty.
          </p>
        )}
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
  // The foes the move menu rates moves against: the far half's (and in a Free-For-All the other trainer on your own half).
  const foes = perHalf > 1 ? [...foeSide.active, ...(gameType === "freeforall" ? mySide.active.filter((m) => m && m.owner !== me) : [])] : foeSide.active.slice(0, 1);
  const fieldState: FieldState = { doubles: perHalf > 1, weather: snap.weather, terrain: snap.terrain, pseudo: snap.pseudo, attacker: mySide.conditions, defender: foeSide.conditions };
  const shiftable = canShift(request, slot, gameType);
  const trapped = !!active.trapped;
  const extras: Extra[] = gimmicksOf(active).filter((e) => !extraTaken(e));
  const extraOn = (e: Extra) => extras.includes(e);
  // The moves as they'll be used: Max Moves while Dynamaxing (or Dynamaxed), Z-Moves with a Z-Move on.
  const shown = active.moves.map((_, i) => moveAsUsed(active, i, extra && extraOn(extra) ? extra : null, moveNamed));
  const maybeTrapped = !trapped && !!active.maybeTrapped;

  if (aiming?.spots) {
    const spots = aiming.spots;
    const at = (loc: number) => (loc > 0 ? foeSide.active[loc - 1] : mySide.active[-loc - 1]);
    const empty = (loc: number) => {
      const mon = at(loc);
      return !mon || mon.fainted;
    };
    // Showdown's grid: the far half's spots above (in screen order, right to left by slot), yours below.
    const far = spots.filter((t) => t.loc > 0).sort((a, b) => b.loc - a.loc);
    const near = spots.filter((t) => t.loc < 0).sort((a, b) => b.loc - a.loc);
    // The spots in reach with a Pokémon in them; with nobody in reach, the empty ones (the move then fails).
    const usable = aimableSpots([...far, ...near], empty);
    const nobody = usable.length > 0 && usable.every((t) => empty(t.loc));
    keys.digit = (n) => {
      const t = usable[n - 1];
      if (t && !busy) add(`move ${aiming.index} ${t.loc}${suffix()}`);
    };
    keys.back = () => setAiming(null);
    const button = (t: TargetSpot) => {
      const mon = at(t.loc);
      const off = busy || !usable.includes(t);
      const key = usable.indexOf(t);
      const owner = four && mon ? (mon.owner === me ? "You" : (names?.[mon.owner] ?? mon.owner)) : null;
      return (
        <button
          key={t.loc}
          type="button"
          data-testid="target-button"
          data-loc={t.loc}
          data-legal={t.legal}
          aria-keyshortcuts={key >= 0 ? String(key + 1) : undefined}
          disabled={off}
          onClick={() => add(`move ${aiming.index} ${t.loc}${suffix()}`)}
          title={!t.legal ? "Out of reach: this move only reaches adjacent Pokémon" : undefined}
          className={cn("menu-item flex min-w-0 flex-col items-start gap-0.5 rounded-md border bg-card px-2.5 py-2 text-left hover:border-screen/60 disabled:opacity-40", !t.foe && "border-dashed")}
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <Crosshair className={cn("h-3.5 w-3.5 shrink-0", t.foe ? "text-primary" : "text-screen")} aria-hidden />
            <span className="truncate font-display text-sm font-bold uppercase">{mon && !mon.fainted ? mon.name : "Empty spot"}</span>
          </span>
          <span className="hud-label flex w-full min-w-0 items-center gap-1 truncate">
            {t.self ? "You" : t.foe ? "Foe" : gameType === "multi" ? "Partner" : "Ally"}
            {owner && !t.self && <span className="truncate normal-case text-muted-foreground">· {owner}</span>}
            {!t.legal && !t.self && <span className="text-muted-foreground">· out of reach</span>}
          </span>
        </button>
      );
    };
    return (
      <div className="space-y-3" data-testid="target-grid">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg font-bold uppercase">{moveInfo(aiming.move.move || aiming.move.id, snap.gen).name}: pick a target</p>
          <button type="button" className="hud-label hover:text-foreground" onClick={() => setAiming(null)}>
            Back
          </button>
        </div>
        {nobody && (
          <p className="text-sm text-muted-foreground" data-testid="target-none-in-reach">
            Nobody is in reach from here, so this move will fail.{shiftable ? " Go back to shift to the centre, where every foe is in reach." : ""}
          </p>
        )}
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${perHalf}, minmax(0, 1fr))` }}>
          {far.map(button)}
          {near.map(button)}
        </div>
      </div>
    );
  }

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
    if (perHalf > 1 && !doubles) {
      // Triples and four-player battles: Showdown's own adjacency (a lone legal target is picked for you).
      const spots = targetSpots(move.target, slot, gameType, sideIndex);
      const legal = spots.filter((t) => t.legal);
      if (legal.length > 1) setAiming({ index, move, targets: legal.map((t) => t.loc), spots });
      else add(`move ${index}${legal[0] ? ` ${legal[0].loc}` : ""}${suffix()}`);
      return;
    }
    const targets = doubles ? targetChoices(move.target, slot) : [];
    if (targets.length > 1) setAiming({ index, move, targets });
    else add(`move ${index}${targets[0] ? ` ${targets[0]}` : ""}${suffix()}`);
  };
  const canSwitchTo = (p: BattleRequestPokemon | undefined, i: number) => !!p && !busy && !trapped && !p.active && !fainted(p) && !switchedIn(parts).includes(i + 1);
  const bench = benchOrder(request.side.pokemon);
  keys.digit = (n) => {
    // 5-9: switch to the first to fifth Pokémon on the bench (Showdown's keys).
    if (n >= 5) {
      const i = bench[n - 5];
      if (i !== undefined && canSwitchTo(request.side.pokemon[i], i)) add(`switch ${i + 1}`);
      return;
    }
    const move = shown[n - 1];
    if (!move || busy || move.disabled) return;
    pickMove(n, move);
  };
  keys.shiftDigit = (n) => {
    if (canSwitchTo(request.side.pokemon[n - 1], n - 1)) add(`switch ${n}`);
  };
  if (teraType) keys.tera = () => setTera((t) => !t);
  // M cycles: none, then each option in turn, then none again.
  if (extras.length) keys.extra = () => setExtra((x) => cycleExtra(x, extras));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-lg font-bold uppercase max-sm:text-base">What will {actorName} do?</p>
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
        {shown.map((move, i) => (
          <MoveButton
            key={`${move.id}-${i}`}
            gen={snap.gen}
            move={move}
            index={i + 1}
            foes={foes}
            tera={tera}
            teraType={teraType}
            disabled={busy}
            onPick={pickMove}
            tip={{ attacker: attackerOf(request.side.pokemon[slot], mySide.active[posOf(slot)], tera, teraType), field: fieldState, randomBattle: isRandomFormat(format), foes }}
          />
        ))}
      </div>
      {shiftable && (
        <button
          type="button"
          disabled={busy}
          onClick={() => add("shift")}
          data-testid="shift-button"
          className="menu-item flex w-full items-center justify-center gap-2 rounded-md border border-dashed bg-card px-3 py-2 font-display text-sm font-bold uppercase hover:border-screen/60 disabled:opacity-40"
          title="Move to the centre spot (the Pokémon there moves to this edge): from the centre every foe is in reach"
        >
          <MoveHorizontal className="h-4 w-4 text-screen" aria-hidden /> Shift to the centre
        </button>
      )}
      {maybeTrapped && (
        <p className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm" role="note" data-testid="maybe-trapped">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden /> {actorName} might be trapped, so a switch can&apos;t be cancelled.
        </p>
      )}
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
