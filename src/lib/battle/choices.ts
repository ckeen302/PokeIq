import { activesPerHalf, activesPerSide, gimmickFamily, gimmicksOf, isDynamaxed, playerCount, type BattleGimmick, type BattleRequest, type BattleRequestMove, type GameType } from "@/lib/battle/play";

/**
 * Every legal, fully explicit choice a request allows: what the computer
 * opponent picks from, and what the turn timer plays for a player who ran
 * out of time. Never "default": the simulator logs a default move without
 * its target, and such an input log won't replay in doubles.
 *
 * Pure and isomorphic: the server's battles and the Battle Lab's browser
 * workers both use it.
 */

/** Move targets the player must pick in doubles (and the other game types with more than one Pokémon a half). */
const CHOOSABLE_TARGETS = new Set(["normal", "any", "adjacentAlly", "adjacentAllyOrSelf", "adjacentFoe"]);
export const isChoosableTarget = (target: string | undefined) => !!target && CHOOSABLE_TARGETS.has(target);

export const isFainted = (condition: string) => condition.endsWith(" fnt");

/**
 * The battle's shape, as the choice helpers need it: `true` is doubles and
 * `false` singles (what every caller passed before triples and four-player
 * battles), or the game type itself.
 */
export type ChoiceGeometry = boolean | GameType;
const gameTypeOf = (g: ChoiceGeometry): GameType => (g === true ? "doubles" : g === false ? "singles" : g);
/** The side a request is for (0 is p1). */
export const sideIndexOf = (request: Pick<BattleRequest, "side">) => Math.max(0, Number(request.side?.id?.[1] ?? 1) - 1);

/** One active slot's options, as the simulator's choice text for that slot. */
export interface SlotOption {
  kind: "move" | "switch" | "pass" | "shift";
  text: string;
  /** move: the move's index (1-based) and target location (0 for none); switch: the team index (1-based). */
  index: number;
  target: number;
  tera: boolean;
  move?: BattleRequestMove;
  /** A move used with Mega Evolution, Ultra Burst, a Z-Move or Dynamax (only when asked for, see moveSlotOptions). */
  gimmick?: BattleGimmick;
}

/** One spot a move could be aimed at: its target location, and what the simulator makes of it. */
export interface TargetSpot {
  /** Showdown's target location: 1.. for the far half, -1.. for your own half (-(slot + 1) is you). */
  loc: number;
  self: boolean;
  /** A foe (in a Free-For-All every other trainer's Pokémon is one, on either half). */
  foe: boolean;
  /** The simulator accepts this target for this move. */
  legal: boolean;
}

/**
 * Every spot on the field as a target for a move of `target` type from
 * `slot` of side `side` (0 is p1), in Showdown's own terms
 * (sim/battle.ts validTargetLoc): in triples a single-target move reaches
 * only adjacent Pokémon (an edge Pokémon can't reach the far edge), "any"
 * reaches every spot but your own, and in a Free-For-All an ally move can
 * be aimed at a foe. Empty when the move takes no target.
 */
export function targetSpots(target: string | undefined, slot: number, gameType: GameType, side = 0): TargetSpot[] {
  const perHalf = activesPerHalf(gameType);
  if (perHalf < 2 || !isChoosableTarget(target)) return [];
  const offset = playerCount(gameType) === 4 ? Math.floor(side / 2) * activesPerSide(gameType) : 0;
  const source = -(slot + offset + 1);
  const ffa = gameType === "freeforall";
  const out: TargetSpot[] = [];
  for (const loc of [...Array.from({ length: perHalf }, (_, i) => i + 1), ...Array.from({ length: perHalf }, (_, i) => -(i + 1))]) {
    const self = loc === source;
    const foe = ffa ? !self : loc > 0;
    const across = -(perHalf + 1 - loc);
    const adjacent = loc > 0 ? Math.abs(across - source) <= 1 : Math.abs(loc - source) === 1;
    let legal: boolean;
    if (ffa && target === "adjacentAlly") legal = adjacent;
    else if (target === "normal") legal = adjacent;
    else if (target === "adjacentAlly") legal = adjacent && !foe;
    else if (target === "adjacentAllyOrSelf") legal = (adjacent && !foe) || self;
    else if (target === "adjacentFoe") legal = adjacent && foe;
    else legal = !self; // any
    out.push({ loc, self, foe, legal });
  }
  return out;
}

/**
 * The targets a move may be aimed at from `slot` (0-based); [0] when no
 * target is chosen. The computer's and the timer's choices: an attack goes
 * at a foe in reach (aiming one at your partner is legal but never
 * wanted); a move for an ally at the allies in reach, yourself first where
 * it may be.
 */
export function moveTargets(target: string | undefined, slot: number, doubles: ChoiceGeometry, side = 0): number[] {
  const spots = targetSpots(target, slot, gameTypeOf(doubles), side).filter((s) => s.legal);
  if (!spots.length) return [0];
  if (target === "adjacentAlly") return spots.filter((s) => !s.self).map((s) => s.loc);
  if (target === "adjacentAllyOrSelf") return [...spots.filter((s) => s.self), ...spots.filter((s) => !s.self)].map((s) => s.loc);
  const foes = spots.filter((s) => s.foe);
  return foes.length ? foes.map((s) => s.loc) : [0];
}

/** Triples: an edge Pokémon may shift to the centre instead of moving (Showdown's "shift"). */
export const canShift = (request: BattleRequest, slot: number, doubles: ChoiceGeometry) => gameTypeOf(doubles) === "triples" && (request.active?.length ?? 0) === 3 && slot !== 1 && !request.forceSwitch;

const moveText = (index: number, target: number, tera: boolean, gimmick?: BattleGimmick) => `move ${index}${target ? ` ${target}` : ""}${tera ? " terastallize" : ""}${gimmick ? ` ${gimmick}` : ""}`;

/**
 * The move and switch options for active slot `slot` of a move request.
 * `gimmicks`: also every move with each Mega Evolution, Ultra Burst, Z-Move
 * or Dynamax the request offers (aimed as the Z-Move or Max Move is), as
 * Showdown's random player may play them. Off by default: the computer's
 * policies weigh moves as they are.
 */
export function moveSlotOptions(request: BattleRequest, slot: number, doubles: ChoiceGeometry, { gimmicks = false }: { gimmicks?: boolean } = {}): SlotOption[] {
  const active = request.active?.[slot];
  const mon = request.side.pokemon[slot];
  if (!active || !mon || isFainted(mon.condition) || mon.commanding) return [{ kind: "pass", text: "pass", index: 0, target: 0, tera: false }];
  const options: SlotOption[] = [];
  const side = sideIndexOf(request);
  const usable = active.moves.map((move, i) => ({ move, index: i + 1 })).filter(({ move }) => !move.disabled);
  // Everything disabled can't happen (the simulator offers Struggle instead), but never leave a slot empty.
  const moves = usable.length ? usable : active.moves.slice(0, 1).map((move) => ({ move, index: 1 }));
  // Dynamaxed already: the moves are its Max Moves, aimed as those are.
  const maxed = isDynamaxed(active);
  for (const { move, index } of moves) {
    const aimAs = maxed ? (active.maxMoves?.maxMoves[index - 1]?.target ?? move.target) : move.target;
    for (const target of moveTargets(aimAs, slot, doubles, side)) {
      options.push({ kind: "move", text: moveText(index, target, false), index, target, tera: false, move });
      if (active.canTerastallize) options.push({ kind: "move", text: moveText(index, target, true), index, target, tera: true, move });
    }
  }
  if (gimmicks) {
    for (const gimmick of gimmicksOf(active)) {
      for (const { move, index } of moves) {
        const as = gimmick === "zmove" ? active.canZMove?.[index - 1] : gimmick === "dynamax" ? active.maxMoves?.maxMoves[index - 1] : move;
        if (!as || ("disabled" in as && as.disabled)) continue;
        for (const target of moveTargets(as.target, slot, doubles, side)) {
          options.push({ kind: "move", text: moveText(index, target, false, gimmick), index, target, tera: false, move, gimmick });
        }
      }
    }
  }
  if (!active.trapped) {
    for (const index of benchIndices(request)) options.push({ kind: "switch", text: `switch ${index}`, index, target: 0, tera: false });
  }
  if (canShift(request, slot, doubles)) options.push({ kind: "shift", text: "shift", index: 0, target: 0, tera: false });
  return options;
}

/** Healthy Pokémon on the bench (1-based team indices). */
export function benchIndices(request: BattleRequest): number[] {
  const out: number[] = [];
  request.side.pokemon.forEach((p, i) => {
    if (!p.active && !isFainted(p.condition)) out.push(i + 1);
  });
  return out;
}

/** For Revival Blessing: fainted Pokémon that can be brought back (1-based). */
function revivable(request: BattleRequest): number[] {
  const out: number[] = [];
  request.side.pokemon.forEach((p, i) => {
    if (!p.active && isFainted(p.condition)) out.push(i + 1);
  });
  return out;
}

/** Which slots of a forced-switch request need a Pokémon, and from which pool. */
export function forcedSwitchSlots(request: BattleRequest): { slot: number; pool: number[]; reviving: boolean }[] {
  return (request.forceSwitch ?? []).map((forced, slot) => {
    const reviving = !!request.side.pokemon[slot]?.reviving;
    return { slot, pool: forced ? (reviving ? revivable(request) : benchIndices(request)) : [], reviving };
  });
}

/** The team order for team preview: `lead` first, then the rest in order. */
export function teamChoice(request: BattleRequest, lead = 1): string {
  const size = request.side.pokemon.length;
  const order = [lead, ...Array.from({ length: size }, (_, i) => i + 1).filter((i) => i !== lead)];
  return `team ${order.join("")}`;
}

/**
 * A random legal choice, using `rand` (0 ≤ x < 1). Picks a Pokémon at most
 * once per turn and Terastallizes at most one of them. Like Showdown's random
 * player it may also Mega Evolve, Ultra Burst, use a Z-Move or Dynamax where
 * the request allows (each at most once a turn across the side).
 */
export function randomChoice(request: BattleRequest, doubles: ChoiceGeometry, rand: () => number): string {
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
  if (request.teamPreview) return teamChoice(request, 1 + Math.floor(rand() * request.side.pokemon.length));
  if (request.forceSwitch) {
    const taken = new Set<number>();
    return forcedSwitchSlots(request)
      .map(({ pool }) => {
        const free = pool.filter((i) => !taken.has(i));
        if (!free.length) return "pass";
        const index = pick(free);
        taken.add(index);
        return `switch ${index}`;
      })
      .join(", ");
  }
  const slots = request.active?.length ?? 0;
  const taken = new Set<number>();
  let tera = false;
  const used = new Set<string>();
  const parts: string[] = [];
  for (let slot = 0; slot < slots; slot++) {
    const options = moveSlotOptions(request, slot, doubles, { gimmicks: true }).filter(
      (o) => (o.kind !== "switch" || !taken.has(o.index)) && !(o.tera && tera) && !(o.gimmick && used.has(gimmickFamily(o.gimmick)))
    );
    // Prefer attacking: switching (or shifting) at random makes a poor opponent and a worse stand-in for a timed-out player.
    const moves = options.filter((o) => o.kind !== "switch" && o.kind !== "shift");
    const option = moves.length && rand() < 0.85 ? pick(moves) : pick(options);
    if (option.kind === "switch") taken.add(option.index);
    if (option.tera) tera = true;
    if (option.gimmick) used.add(gimmickFamily(option.gimmick));
    parts.push(option.text);
  }
  return parts.join(", ");
}

/** A safe, plain choice: the first usable move (no target trickery, no Tera) or the first healthy switch. */
export function firstChoice(request: BattleRequest, doubles: ChoiceGeometry): string {
  return randomChoice(request, doubles, () => 0);
}
