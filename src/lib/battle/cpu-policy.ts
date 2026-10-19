import { calculate, Field, Generations, Move, Pokemon as CalcMon, type GenerationNum } from "@smogon/calc";
import type { Battle, Pokemon, Side } from "@pkmn/sim";
import type { BattleRequest, CpuLevel } from "@/lib/battle/play";
import { benchIndices, forcedSwitchSlots, moveSlotOptions, randomChoice, teamChoice, type SlotOption } from "./choices";

/**
 * The computer opponent: a heuristic on Smogon's damage calculator that runs
 * on a live simulator battle (on the server right after the player's choice,
 * or in a Battle Lab worker in the browser). It reads its own side exactly
 * but the other side only as it has been shown: species, level, HP as a
 * fraction, stat stages, status and the moves already used. Unknown stats
 * use a neutral random-battle-style spread, unknown moves a strong STAB
 * guess per type. Damage follows the battle's own generation.
 *
 * - easy: greedy with heavy noise, never switches by choice, never Terastallizes.
 * - normal: small noise, switches out of bad matchups, Terastallizes for a KO.
 * - hard: no noise; also values priority to finish, safe setup, recovery,
 *   hazards, and Terastallizing for a big damage gain.
 *
 * It always returns an explicit, legal choice (built from the request).
 * Pure and isomorphic: no server or Node APIs.
 */

type CalcGen = ReturnType<typeof Generations.get>;

/** The damage calculator's data for the battle's generation. */
export function calcGen(battle: Battle): CalcGen {
  return Generations.get(Math.min(9, Math.max(1, battle.gen)) as GenerationNum);
}

interface Scored {
  text: string;
  score: number;
  option?: SlotOption;
}

const NOISE: Record<CpuLevel, number> = { easy: 0.8, normal: 0.15, hard: 0 };

/** @smogon/calc lacks cosmetic formes (Gastrodon-East, Vivillon-*, Maushold-Four...): they share the base stats. */
function calcName(gen: CalcGen, p: Pokemon): string {
  return gen.species.get(p.species.id as never) ? p.species.name : p.species.baseSpecies;
}

const NEUTRAL_EVS = { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 };

/**
 * Work shared within one decision: the battle doesn't change while the
 * computer thinks, so each Pokémon's calc version and each damage calc is
 * worked out once (the calculator clones its inputs, so sharing is safe).
 * Set only while chooseCpu runs.
 */
interface Memo {
  mons: Map<Pokemon, Map<string, CalcMon>>;
  hits: Map<string, Hit>;
  ids: WeakMap<object, number>;
  next: number;
}
let memo: Memo | null = null;

function memoId(m: Memo, o: object): number {
  let id = m.ids.get(o);
  if (id === undefined) m.ids.set(o, (id = ++m.next));
  return id;
}

/** Calc moves by generation and name (the calculator clones them, so one of each will do). */
const calcMoves = new Map<string, Move>();
function calcMove(gen: CalcGen, name: string): Move {
  const key = `${gen.num}:${name}`;
  let move = calcMoves.get(key);
  if (!move) calcMoves.set(key, (move = new Move(gen, name)));
  return move;
}

/** A calc Pokémon: exact for our own (`hidden` false), only what's been shown for the other side's. */
export function toCalc(battle: Battle, p: Pokemon, hidden: boolean, tera?: boolean): CalcMon {
  if (!memo) return makeCalc(battle, p, hidden, tera);
  let forMon = memo.mons.get(p);
  if (!forMon) memo.mons.set(p, (forMon = new Map()));
  const key = `${hidden ? 1 : 0}${tera ? 1 : 0}`;
  let mon = forMon.get(key);
  if (!mon) forMon.set(key, (mon = makeCalc(battle, p, hidden, tera)));
  return mon;
}

function makeCalc(battle: Battle, p: Pokemon, hidden: boolean, tera?: boolean): CalcMon {
  const gen = calcGen(battle);
  const name = calcName(gen, p);
  const teraType = p.terastallized ? p.terastallized : tera ? p.teraType : undefined;
  const isDynamaxed = p.volatiles.dynamax ? true : undefined;
  if (hidden) {
    const maxHP = new CalcMon(gen, name, { level: p.level, evs: { hp: 84 } }).maxHP();
    return new CalcMon(gen, name, {
      level: p.level,
      nature: "Hardy",
      evs: NEUTRAL_EVS,
      boosts: { ...p.boosts },
      status: (p.status || "") as never,
      curHP: Math.max(1, Math.round((p.hp / p.maxhp) * maxHP)),
      teraType: teraType as never,
      isDynamaxed,
    });
  }
  return new CalcMon(gen, name, {
    level: p.level,
    item: (p.item ? battle.dex.items.get(p.item).name : undefined) as never,
    // Abilities arrive in Gen 3.
    ability: (gen.num >= 3 ? battle.dex.abilities.get(p.ability).name : undefined) as never,
    nature: (p.set.nature || "Hardy") as never,
    evs: p.set.evs,
    ivs: p.set.ivs,
    boosts: { ...p.boosts },
    status: (p.status || "") as never,
    curHP: Math.max(1, p.hp),
    teraType: teraType as never,
    isDynamaxed,
  });
}

const WEATHER: Record<string, string> = {
  sunnyday: "Sun",
  desolateland: "Harsh Sunshine",
  raindance: "Rain",
  primordialsea: "Heavy Rain",
  sandstorm: "Sand",
  snowscape: "Snow",
  hail: "Hail",
  deltastream: "Strong Winds",
};
const TERRAIN: Record<string, string> = { electricterrain: "Electric", grassyterrain: "Grassy", psychicterrain: "Psychic", mistyterrain: "Misty" };
const RUIN = { beadsofruin: "isBeadsOfRuin", swordofruin: "isSwordOfRuin", tabletsofruin: "isTabletsOfRuin", vesselofruin: "isVesselOfRuin" } as const;

/** One side's screens, hazards and Tailwind, as the calculator takes them. */
function calcSide(side: Side) {
  const has = (id: string) => !!side.sideConditions[id];
  return {
    isReflect: has("reflect"),
    isLightScreen: has("lightscreen"),
    isAuroraVeil: has("auroraveil"),
    isTailwind: has("tailwind"),
    isSR: has("stealthrock"),
    spikes: (side.sideConditions.spikes as { layers?: number } | undefined)?.layers ?? 0,
  };
}

/**
 * The battle's field for a hit by `attacker`'s side: weather, terrain,
 * Gravity and the rooms, both sides' screens, and a Ruin ability on the
 * field (the calculator works out the attacker's and defender's own).
 */
export function field(battle: Battle, doubles: boolean, attacker?: Side): Field {
  const pseudo = (id: string) => !!battle.field.pseudoWeather[id];
  const ruin: Partial<Record<(typeof RUIN)[keyof typeof RUIN], boolean>> = {};
  for (const side of battle.sides) {
    for (const p of side.active) {
      const flag = alive(p) ? RUIN[p.ability as keyof typeof RUIN] : undefined;
      if (flag) ruin[flag] = true;
    }
  }
  return new Field({
    gameType: doubles ? "Doubles" : "Singles",
    weather: WEATHER[battle.field.weather] as never,
    terrain: TERRAIN[battle.field.terrain] as never,
    isGravity: pseudo("gravity"),
    isMagicRoom: pseudo("magicroom"),
    isWonderRoom: pseudo("wonderroom"),
    ...ruin,
    attackerSide: attacker ? calcSide(attacker) : undefined,
    defenderSide: attacker ? calcSide(attacker.foe) : undefined,
  });
}

export interface Hit {
  /** Expected fraction of the defender's current HP (accuracy-weighted, capped at 1). */
  frac: number;
  /** Chance-ish of a KO: 1 when the lowest roll KOs, 0.5 when only the highest does (times accuracy). */
  ko: number;
  priority: number;
  status: boolean;
}

const NO_HIT: Hit = { frac: 0, ko: 0, priority: 0, status: true };

/** What `moveName` does to `defender`; a move the calculator doesn't know scores nothing. */
export function hit(gen: CalcGen, attacker: CalcMon, defender: CalcMon, moveName: string, f: Field): Hit {
  if (!memo) return calcHit(gen, attacker, defender, moveName, f);
  const key = `${memoId(memo, attacker)}:${memoId(memo, defender)}:${memoId(memo, f)}:${moveName}`;
  let h = memo.hits.get(key);
  if (!h) memo.hits.set(key, (h = calcHit(gen, attacker, defender, moveName, f)));
  return h;
}

function calcHit(gen: CalcGen, attacker: CalcMon, defender: CalcMon, moveName: string, f: Field): Hit {
  try {
    const move = calcMove(gen, moveName);
    if (move.category === "Status") return { ...NO_HIT, priority: move.priority };
    const r = calculate(gen, attacker, defender, move, f);
    const [lo, hi] = r.range();
    const accuracy = (move as unknown as { accuracy?: number | true }).accuracy;
    const acc = typeof accuracy === "number" ? accuracy / 100 : 1;
    const hp = Math.max(1, defender.curHP());
    return {
      frac: Math.min(1, (lo + hi) / 2 / hp) * acc,
      ko: lo >= hp ? acc : hi >= hp ? 0.5 * acc : 0,
      priority: move.priority,
      status: false,
    };
  } catch {
    return NO_HIT;
  }
}

const STAB_GUESS: Record<string, [string, string]> = {
  Normal: ["Double-Edge", "Hyper Voice"],
  Fire: ["Flare Blitz", "Flamethrower"],
  Water: ["Liquidation", "Surf"],
  Grass: ["Wood Hammer", "Energy Ball"],
  Electric: ["Wild Charge", "Thunderbolt"],
  Ice: ["Icicle Crash", "Ice Beam"],
  Fighting: ["Close Combat", "Aura Sphere"],
  Poison: ["Gunk Shot", "Sludge Bomb"],
  Ground: ["Earthquake", "Earth Power"],
  Flying: ["Brave Bird", "Air Slash"],
  Psychic: ["Zen Headbutt", "Psychic"],
  Bug: ["U-turn", "Bug Buzz"],
  Rock: ["Stone Edge", "Power Gem"],
  Ghost: ["Poltergeist", "Shadow Ball"],
  Dragon: ["Outrage", "Draco Meteor"],
  Dark: ["Knock Off", "Dark Pulse"],
  Steel: ["Iron Head", "Flash Cannon"],
  Fairy: ["Play Rough", "Moonblast"],
  Stellar: ["Tera Blast", "Tera Blast"],
};

/** The other side's Pokémon's best hit on one of ours: its revealed moves, plus STAB guesses while fewer than two are known. */
function threat(battle: Battle, foe: Pokemon, mine: CalcMon, f: Field): number {
  if (!foe || foe.fainted) return 0;
  const gen = calcGen(battle);
  const foeCalc = toCalc(battle, foe, true);
  const known = foe.moveSlots.filter((m) => m.used).map((m) => m.move);
  const physical = foe.species.baseStats.atk >= foe.species.baseStats.spa;
  const guesses = known.length >= 2 ? known : [...known, ...foe.getTypes().map((t) => (STAB_GUESS[t] ?? ["Tackle", "Swift"])[physical ? 0 : 1])];
  let best = 0;
  for (const m of guesses) best = Math.max(best, hit(gen, foeCalc, mine, m, f).frac);
  return best;
}

const SETUP = new Set(["swordsdance", "nastyplot", "dragondance", "calmmind", "quiverdance", "bulkup", "shellsmash", "agility", "irondefense", "coil", "victorydance", "tidyup", "shiftgear", "tailglow", "geomancy", "bellydrum", "filletaway"]);
const RECOVERY = new Set(["recover", "roost", "slackoff", "softboiled", "moonlight", "synthesis", "morningsun", "shoreup", "milkdrink", "strengthsap", "wish", "rest"]);
const HAZARDS = new Set(["stealthrock", "spikes", "toxicspikes", "stickyweb"]);
const PROTECT = new Set(["protect", "detect", "spikyshield", "kingsshield", "banefulbunker", "silktrap", "burningbulwark", "obstruct"]);

export const alive = (p: Pokemon | null | undefined): p is Pokemon => !!p && !p.fainted && p.hp > 0;

/** A small deterministic generator from a string seed (so a rebuilt battle replays the same noise). */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The field for each direction of a hit: ours on them, theirs on us (each side's screens differ). */
interface Fields {
  ours: Field;
  theirs: Field;
}

/** How well `p` would do against `foes`: what it threatens minus what it takes. */
function matchup(battle: Battle, p: Pokemon, foes: Pokemon[], f: Fields): number {
  if (!foes.length) return p.hp / p.maxhp;
  const gen = calcGen(battle);
  const mine = toCalc(battle, p, false);
  let total = 0;
  for (const foe of foes) {
    const foeCalc = toCalc(battle, foe, true);
    let out = 0;
    for (const slot of p.moveSlots) out = Math.max(out, hit(gen, mine, foeCalc, slot.move, f.ours).frac);
    total += out - threat(battle, foe, mine, f.theirs) * 1.1;
  }
  return total / foes.length + 0.2 * (p.hp / p.maxhp);
}

/** Scores one active slot's move options against the foes. */
function scoreMoves(battle: Battle, side: Side, slot: number, options: SlotOption[], level: CpuLevel, doubles: boolean, f: Fields): Scored[] {
  const me = side.active[slot];
  const foes = side.foe.active.filter(alive);
  if (!alive(me) || !foes.length) return options.filter((o) => o.kind === "move").map((o) => ({ text: o.text, score: 0, option: o }));
  const gen = calcGen(battle);
  const mine = toCalc(battle, me, false);
  const mineTera = me.canTerastallize ? toCalc(battle, me, false, true) : null;
  const incoming = Math.max(...foes.map((foe) => threat(battle, foe, mine, f.theirs)));
  const myHp = me.hp / me.maxhp;
  // Action speed: paralysis, Choice Scarf, Tailwind and Trick Room included, as the turn order uses it.
  const fastest = Math.max(...foes.map((foe) => foe.getActionSpeed()));
  const faster = me.getActionSpeed() > fastest;
  const out: Scored[] = [];

  for (const o of options) {
    if (o.kind !== "move" || !o.move) continue;
    if (o.tera && (level === "easy" || !mineTera)) continue;
    const id = o.move.id;
    const attacker = o.tera && mineTera ? mineTera : mine;
    const target = o.target > 0 ? side.foe.active[o.target - 1] : null;
    const spread = o.move.target === "allAdjacentFoes" || o.move.target === "allAdjacent";
    const victims = doubles ? (spread ? foes : alive(target) ? [target] : []) : foes.slice(0, 1);
    let score = 0;
    let anyKo = false;
    for (const foe of victims) {
      const h = hit(gen, attacker, toCalc(battle, foe, true), o.move.move, f.ours);
      const frac = h.frac * (spread && doubles ? 0.75 : 1);
      score += frac;
      if (h.ko > 0) {
        anyKo = true;
        score += 1 + h.ko;
        // Finishing with priority before a faster foe moves.
        if (h.priority > 0 && !faster && level !== "easy") score += 1;
      }
    }
    // Earthquake and friends also hit the partner.
    if (doubles && o.move.target === "allAdjacent") {
      const ally = side.active[1 - slot];
      if (alive(ally)) score -= hit(gen, attacker, toCalc(battle, ally, false), o.move.move, f.ours).frac * 0.9;
    }
    if (SETUP.has(id)) {
      const safe = incoming < 0.35 && myHp > 0.6 && (me.boosts.atk ?? 0) < 2 && (me.boosts.spa ?? 0) < 2;
      score = safe ? 0.9 : -1;
    } else if (RECOVERY.has(id)) {
      score = myHp < 0.5 && incoming < 0.5 ? 0.85 : -0.5;
    } else if (HAZARDS.has(id)) {
      const up = Object.keys(side.foe.sideConditions).includes(id);
      score = up ? -1 : side.foe.pokemonLeft >= 3 ? 0.6 : 0.1;
    } else if (PROTECT.has(id)) {
      // Doubles: protect when threatened (not twice in a row); singles: rarely worth it.
      const lastWasProtect = PROTECT.has(me.lastMove?.id ?? "");
      score = doubles && incoming >= 0.5 && !lastWasProtect ? 0.55 : -0.3;
    } else if (o.move.target === "self" || victims.length === 0 || (score === 0 && !anyKo)) {
      score = 0.05;
    }
    if (o.tera) {
      // Terastallize only when it pays: a KO it unlocks (normal), or a big gain (hard).
      const plain = out.find((s) => s.option && !s.option.tera && s.option.index === o.index && s.option.target === o.target);
      const gain = plain ? score - plain.score : 0;
      const worth = level === "hard" ? gain >= 0.25 || (anyKo && plain !== undefined && plain.score < 1) : anyKo && plain !== undefined && plain.score < 1;
      if (!worth) continue;
      score += 0.05;
    }
    out.push({ text: o.text, score, option: o });
  }
  return out;
}

/** The computer's choice for `side`. `rand` drives the noise; `onError` hears about a fallback to a random move. */
export function chooseCpu(
  battle: Battle,
  side: Side,
  level: CpuLevel,
  rand: () => number,
  onError: (err: unknown) => void = (err) => console.error("[battle] cpu fell back to a random choice:", err)
): string {
  const request = side.activeRequest as unknown as BattleRequest | null;
  if (!request || request.wait) throw new Error("The computer has nothing to choose.");
  const doubles = battle.gameType === "doubles";
  memo = { mons: new Map(), hits: new Map(), ids: new WeakMap(), next: 0 };
  try {
    return decide(battle, side, request, level, doubles, rand);
  } catch (err) {
    // The calculator choked on something unusual: still play a legal move.
    onError(err);
    return randomChoice(request, doubles, rand);
  } finally {
    memo = null;
  }
}

function decide(battle: Battle, side: Side, request: BattleRequest, level: CpuLevel, doubles: boolean, rand: () => number): string {
  const f: Fields = { ours: field(battle, doubles, side), theirs: field(battle, doubles, side.foe) };
  const foes = side.foe.active.filter(alive);
  const noise = NOISE[level];
  const jitter = () => (rand() - 0.5) * noise;

  if (request.teamPreview) {
    // Lead with the Pokémon that matches up best against their whole team.
    const theirs = side.foe.pokemon;
    let best = 1;
    let bestScore = -Infinity;
    side.pokemon.forEach((p, i) => {
      const s = matchup(battle, p, theirs, f) + jitter();
      if (s > bestScore) [best, bestScore] = [i + 1, s];
    });
    return teamChoice(request, best);
  }

  if (request.forceSwitch) {
    const taken = new Set<number>();
    return forcedSwitchSlots(request)
      .map(({ pool, reviving }) => {
        const free = pool.filter((i) => !taken.has(i));
        if (!free.length) return "pass";
        let pick = free[0];
        if (!reviving) {
          let bestScore = -Infinity;
          for (const i of free) {
            const s = matchup(battle, side.pokemon[i - 1], foes, f) + jitter();
            if (s > bestScore) [pick, bestScore] = [i, s];
          }
        }
        taken.add(pick);
        return `switch ${pick}`;
      })
      .join(", ");
  }

  const slots = request.active?.length ?? 0;
  const parts: string[] = [];
  const taken = new Set<number>();
  let teraUsed = false;
  for (let slot = 0; slot < slots; slot++) {
    const options = moveSlotOptions(request, slot, doubles);
    if (options.length === 1 && options[0].kind === "pass") {
      parts.push("pass");
      continue;
    }
    const scored = scoreMoves(battle, side, slot, options, level, doubles, f).filter((s) => !(teraUsed && s.option?.tera));

    // Singles: get out of a matchup we're losing badly.
    const me = side.active[slot];
    if (!doubles && level !== "easy" && alive(me) && foes.length && !request.active?.[slot]?.trapped) {
      const mine = toCalc(battle, me, false);
      const incoming = threat(battle, foes[0], mine, f.theirs);
      const faster = me.getActionSpeed() > foes[0].getActionSpeed();
      const bestAttack = Math.max(0, ...scored.map((s) => s.score));
      const outmatched = incoming >= me.hp / me.maxhp && !faster && bestAttack < 1;
      // A matchup is at most 1.2, so a switch scores at most 1.7 (outmatched) or 0.6. With no noise, a
      // switch that can't beat the best move isn't worked out; its die is still cast, to keep them in step.
      const hopeless = noise === 0 && bestAttack > (outmatched ? 1.7 : 0.6);
      for (const index of benchIndices(request)) {
        if (taken.has(index)) continue;
        if (hopeless) {
          rand();
          continue;
        }
        const s = matchup(battle, side.pokemon[index - 1], foes, f);
        scored.push({ text: `switch ${index}`, score: outmatched ? s + 0.5 : s - 0.6 });
      }
    }

    if (!scored.length) {
      // Nothing scored (no foe in sight, say): any legal option.
      const fallback = options.find((o) => o.kind !== "switch" && !o.tera) ?? options.find((o) => !taken.has(o.index)) ?? options[0];
      parts.push(fallback.text);
      if (fallback.kind === "switch") taken.add(fallback.index);
      continue;
    }
    for (const s of scored) s.score += jitter();
    scored.sort((a, b) => b.score - a.score);
    const pick = scored[0];
    if (pick.option?.tera) teraUsed = true;
    const switchTo = /^switch (\d+)$/.exec(pick.text);
    if (switchTo) taken.add(Number(switchTo[1]));
    parts.push(pick.text);
  }
  return parts.join(", ");
}
