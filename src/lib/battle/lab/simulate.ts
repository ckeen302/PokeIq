import { Battle, Dex, Teams, extractChannelMessages, type PokemonSet, type PRNGSeed } from "@pkmn/sim";
import { randomChoice, teamChoice } from "@/lib/battle/choices";
import type { BattleRequest } from "@/lib/battle/play";
import { makeChooser, originalSlot, type Chooser } from "./policies";
import { battleSeed, strategyRandom } from "./seed";
import { addRecord, emptyTotals, type BattleRecord, type LabTotals, type Outcome, type Pair } from "./stats";
import { labFormatId, SIDE_NAMES, TURN_LIMIT, type LabSetup } from "./types";

/**
 * One Battle Lab battle on Pokémon Showdown's simulator (@pkmn/sim), start
 * to finish, synchronously: the setup's teams in the generation's Custom
 * Game, the starting conditions applied once the leads are out, then each
 * side's strategy answers the simulator's requests until someone wins, it's
 * a tie, or the turn limit stops it (a draw). Then the log is read for the
 * numbers: KOs and who scored them, crits, misses, moves used.
 *
 * Runs in a Web Worker in the browser, and in Node for the tests.
 *
 * @pkmn/sim is the browser build of Showdown's simulator; the official
 * package (what live and computer battles run on) only runs in Node. They
 * play Gen 9 and the Lab's Gen 4 example line for line alike, and differ
 * where @pkmn/sim 0.10.11 hasn't caught up with Showdown yet
 * (`npm run verify:showdown` counts each one over 2,000+ battles):
 * - Gen 1-8: recoil damage names the Pokémon that was hit ([of]); text only.
 * - Gen 2-7: Pursuit on a switching target is an activation, not a move of
 *   its own (PP and Pressure can differ).
 * - Gen 3-4: Encore can last a turn longer.
 * - Gen 4: Truant doesn't count the turn its Pokémon switched in; Custap
 *   Berry is a message rather than an item activation.
 * - Gen 1: the Desync Clause makes the move fail instead of resolving it as
 *   the acting player's cartridge would.
 * - Gen 1 and 3 rule lists and descriptions are older.
 */

export class LabSetupError extends Error {}

export interface PreparedLab {
  setup: LabSetup;
  formatid: string;
  /** Each side's team, packed for the simulator. */
  packed: Pair<string>;
  /** The names the simulator knows each Pokémon by (unique within a side), by team slot. */
  names: Pair<string[]>;
  /** Scripted strategy: each slot's moves (ids). */
  scripts: Pair<string[][]>;
  /** Changes made to fit the generation (e.g. "dropped the item: Gen 1 has none"). */
  notes: string[];
}

const OK_NONSTANDARD = new Set(["Past", "Unobtainable"]);
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const usable = (d: { exists: boolean; isNonstandard?: string | null }) => d.exists && (!d.isNonstandard || OK_NONSTANDARD.has(d.isNonstandard));

/** Checks a setup against the generation's Pokédex and builds what the simulator takes. Throws LabSetupError. */
export function prepareLab(setup: LabSetup): PreparedLab {
  const { gen } = setup;
  const dex = Dex.forGen(gen);
  const notes: string[] = [];
  const packed: string[] = [];
  const names: string[][] = [];
  const scripts: string[][][] = [];
  for (const s of [0, 1] as const) {
    const side = setup.sides[s];
    const label = SIDE_NAMES[s];
    if (!side.team.length) throw new LabSetupError(`${label} needs a Pokémon.`);
    if (setup.doubles && side.team.length < 2) throw new LabSetupError(`${label} needs two Pokémon for a double battle.`);
    const taken = new Set<string>();
    const sets: PokemonSet[] = [];
    const sideNames: string[] = [];
    const sideScripts: string[][] = [];
    for (const mon of side.team) {
      const set = mon.set;
      const species = dex.species.get(set.species);
      const who = `${label}'s ${set.name || set.species}`;
      if (!usable(species)) throw new LabSetupError(`${who}: there's no Pokémon called "${set.species}" in Gen ${gen}.`);
      if (species.battleOnly) {
        const base = Array.isArray(species.battleOnly) ? species.battleOnly[0] : species.battleOnly;
        throw new LabSetupError(`${who}: ${species.name} is a forme it only takes in battle. Start it as ${base}.`);
      }
      const moves: string[] = [];
      for (const name of set.moves.filter(Boolean)) {
        const move = dex.moves.get(name);
        if (!usable(move)) throw new LabSetupError(`${who}: there's no move called "${name}" in Gen ${gen}.`);
        if (!moves.includes(move.name)) moves.push(move.name);
      }
      if (!moves.length) throw new LabSetupError(`${who} needs at least one move.`);

      let item = "";
      if (set.item) {
        const it = dex.items.get(set.item);
        if (gen === 1) notes.push(`${who}: Gen 1 has no held items, so it holds nothing.`);
        else if (!usable(it)) throw new LabSetupError(`${who}: there's no item called "${set.item}" in Gen ${gen}.`);
        else item = it.name;
      }
      let ability = "";
      if (gen >= 3) {
        const own = Object.values(species.abilities).filter(Boolean) as string[];
        const ab = set.ability ? dex.abilities.get(set.ability) : null;
        if (ab && !usable(ab)) throw new LabSetupError(`${who}: there's no ability called "${set.ability}" in Gen ${gen}.`);
        ability = ab ? ab.name : (own[0] ?? "");
      }
      let nature = "";
      if (gen >= 3 && set.nature) {
        const n = dex.natures.get(set.nature);
        if (!n.exists) throw new LabSetupError(`${who}: there's no nature called "${set.nature}".`);
        nature = n.name;
      }
      // A unique name per side, so the log says which Pokémon did what.
      let wanted = (set.name || species.baseSpecies || species.name).replace(/[|,\]\n\r]/g, "").trim().slice(0, 18) || species.name;
      if (SIDE_NAMES.some((n) => n.toLowerCase() === wanted.toLowerCase())) wanted = species.baseSpecies;
      let name = wanted;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${wanted.slice(0, 15)} ${n}`;
      taken.add(name.toLowerCase());

      sets.push({
        name,
        species: species.name,
        item,
        ability,
        moves,
        nature,
        gender: set.gender && !species.gender ? set.gender : "",
        evs: { ...set.evs },
        ivs: { ...set.ivs },
        level: Math.min(100, Math.max(1, Math.round(set.level || 100))),
        shiny: set.shiny,
        happiness: set.happiness,
        hpType: set.hpType,
        teraType: gen >= 9 ? set.teraType || species.types[0] : undefined,
      } as PokemonSet);
      sideNames.push(name);
      sideScripts.push(mon.script.map(toId).filter((id) => moves.some((m) => toId(m) === id)));
    }
    packed.push(Teams.pack(sets));
    names.push(sideNames);
    scripts.push(sideScripts);
  }
  return {
    setup,
    formatid: labFormatId(gen, setup.doubles),
    packed: packed as Pair<string>,
    names: names as Pair<string[]>,
    scripts: scripts as Pair<string[][]>,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Starting conditions
// ---------------------------------------------------------------------------

/** Applies HP, status, stat stages, weather, terrain, hazards and screens once the leads are out. Returns what didn't take. */
function applyStart(battle: Battle, prep: PreparedLab): string[] {
  const { setup } = prep;
  const misses: string[] = [];
  let changed = false;
  for (const s of [0, 1] as const) {
    const side = battle.sides[s];
    setup.sides[s].team.forEach((mon, i) => {
      const p = side.pokemon.find((q) => originalSlot(side, q) === i);
      if (!p) return;
      if (mon.hp < 100) {
        p.sethp(Math.max(1, Math.round((p.maxhp * mon.hp) / 100)));
        if (p.isActive) battle.add("-sethp", p, p.getHealth, "[silent]");
        changed = true;
      }
      if (mon.terastallized && setup.gen === 9 && p.teraType) {
        // As the simulator's own Terastallization leaves it (the type change), without its message.
        p.terastallized = p.teraType;
        p.addedType = "";
        p.knownType = true;
        p.apparentType = p.teraType;
        changed = true;
      }
      if (mon.status) {
        if (!p.setStatus(mon.status)) misses.push(`${SIDE_NAMES[s]}'s ${p.name} can't start ${mon.status === "slp" ? "asleep" : `with that status (${mon.status})`}.`);
        changed = true;
      }
      if (p.isActive) {
        const boosts: Record<string, number> = { ...mon.boosts };
        if (setup.gen === 1 && boosts.spa) boosts.spd = boosts.spa; // one Special stat
        for (const [stat, amount] of Object.entries(boosts)) {
          if (!amount) continue;
          const before = p.boosts[stat as keyof typeof p.boosts];
          p.boostBy({ [stat]: amount });
          const delta = p.boosts[stat as keyof typeof p.boosts] - before;
          if (delta && !(setup.gen === 1 && stat === "spd")) battle.add(delta > 0 ? "-boost" : "-unboost", p, stat, Math.abs(delta), "[silent]");
          changed = true;
        }
      }
    });
  }
  for (const s of [0, 1] as const) {
    if (!setup.sides[s].teraUsed) continue;
    for (const p of battle.sides[s].pokemon) p.canTerastallize = null;
    changed = true;
  }
  const source = battle.sides[0].active[0];
  if (setup.weather && source) {
    battle.field.setWeather(setup.weather, source, battle.dex.moves.get(setup.weather) as never);
    if (battle.field.weather === setup.weather) battle.field.weatherState.duration = setup.weatherTurns;
    else misses.push("The weather didn't take.");
    changed = true;
  }
  if (setup.terrain && source) {
    battle.field.setTerrain(setup.terrain, source, battle.dex.moves.get(setup.terrain) as never);
    if (battle.field.terrain === setup.terrain) battle.field.terrainState.duration = setup.terrainTurns;
    else misses.push("The terrain didn't take.");
    changed = true;
  }
  for (const s of [0, 1] as const) {
    const side = battle.sides[s];
    const f = setup.sides[s].field;
    const add = (id: string, times = 1) => {
      for (let n = 0; n < times; n++) side.addSideCondition(id, "debug" as never, battle.dex.moves.get(id) as never);
      changed = true;
    };
    if (f.stealthrock) add("stealthrock");
    if (f.spikes) add("spikes", f.spikes);
    if (f.toxicspikes) add("toxicspikes", f.toxicspikes);
    if (f.stickyweb) add("stickyweb");
    if (f.reflect) add("reflect");
    if (f.lightscreen) add("lightscreen");
    if (f.auroraveil) add("auroraveil");
  }
  // The requests the simulator made for turn 1 predate the edits.
  if (changed) battle.makeRequest("move");
  return misses;
}

// ---------------------------------------------------------------------------
// Reading the log
// ---------------------------------------------------------------------------

interface Who {
  side: 0 | 1;
  slot: number;
  key: string;
}

function emptyRecord(prep: PreparedLab): BattleRecord {
  return {
    outcome: 2,
    capped: false,
    broken: false,
    turns: 0,
    winnerHp: null,
    kos: [prep.names[0].map(() => 0), prep.names[1].map(() => 0)],
    otherKos: [0, 0],
    critKo: [false, false],
    missed: [false, false],
    moves: [{}, {}],
    refused: 0,
    fallbacks: 0,
  };
}

/** KOs (and who scored them), crit KOs, misses and moves used, from the battle's full log. */
function readLog(log: readonly string[], prep: PreparedLab, record: BattleRecord) {
  const slots = prep.names.map((names) => new Map(names.map((n, i) => [n, i])));
  const who = (ident: string | undefined): Who | null => {
    const m = /^p([12])[a-c]?: (.*)$/.exec(ident ?? "");
    if (!m) return null;
    const side = m[1] === "1" ? 0 : 1;
    return { side, slot: slots[side].get(m[2]) ?? -1, key: `${side}:${m[2]}` };
  };
  let mover: Who | null = null;
  const crits = new Set<string>();
  const lastHit = new Map<string, { by: Who | null; crit: boolean }>();
  for (let i = 0; i < log.length; i++) {
    let line = log[i];
    if (line.startsWith("|split|")) {
      // The exact (owner's) line, then the public one: read the first, skip the second.
      line = log[i + 1] ?? "";
      i += 2;
    }
    const parts = line.split("|");
    switch (parts[1]) {
      case "move": {
        mover = who(parts[2]);
        crits.clear();
        if (mover && !parts.some((p) => p.startsWith("[from]"))) {
          const moves = record.moves[mover.side];
          moves[parts[3]] = (moves[parts[3]] ?? 0) + 1;
        }
        break;
      }
      case "-crit": {
        const t = who(parts[2]);
        if (t) crits.add(t.key);
        break;
      }
      case "-miss": {
        const s = who(parts[2]);
        if (s) record.missed[s.side] = true;
        break;
      }
      case "-damage": {
        const t = who(parts[2]);
        if (!t || !/^0( |$)/.test(parts[3] ?? "")) break;
        const from = parts.find((p) => p.startsWith("[from]"));
        const of = parts.find((p) => p.startsWith("[of] "));
        const by = of ? who(of.slice(5)) : from ? null : mover;
        lastHit.set(t.key, { by, crit: !from && crits.has(t.key) });
        break;
      }
      case "faint": {
        const t = who(parts[2]);
        if (!t) break;
        const hitBy = lastHit.get(t.key);
        lastHit.delete(t.key);
        const by = hitBy?.by;
        if (by && by.side !== t.side && by.slot >= 0) {
          record.kos[by.side][by.slot]++;
          if (hitBy.crit) record.critKo[by.side] = true;
        } else {
          record.otherKos[t.side === 0 ? 1 : 0]++;
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The battle
// ---------------------------------------------------------------------------

export interface LabBattle {
  record: BattleRecord;
  /** With `log`: the whole battle as everyone sees it (both sides' exact HP), for a text replay. */
  log?: string[];
  /** With `log`: starting conditions that didn't take (a Fire type can't be burned…). */
  misses?: string[];
}

/** Lines no reader needs. */
const DROPPED = /^\|(t:|debug|request)\|/;

export interface LabBattleOptions {
  log?: boolean;
  /** Each side's chooser in place of the setup's strategies (the CPU benchmark pits policies against each other). */
  choosers?: (rands: [() => number, () => number], record: BattleRecord) => [Chooser, Chooser];
}

/** Battle `index` of the run with master seed `master`. The same arguments always play the same battle. */
export function runLabBattle(prep: PreparedLab, master: string, index: number, opts: LabBattleOptions = {}): LabBattle {
  const { setup } = prep;
  const record = emptyRecord(prep);
  const battle = new Battle({ formatid: prep.formatid as never, seed: battleSeed(master, index) as PRNGSeed });
  const refusedBy: string[] = [];
  (battle as { send: Battle["send"] }).send = (type: string, data: string | string[]) => {
    if (type !== "sideupdate") return;
    const text = Array.isArray(data) ? data.join("\n") : data;
    const err = text.indexOf("|error|");
    // "[Unavailable choice]" is the simulator revealing something the side couldn't know (a trap, a disable): not a mistake.
    if (err >= 0 && !text.startsWith("[Unavailable choice]", err + 7)) refusedBy.push(text.slice(err + 7));
  };
  const rands: [() => number, () => number] = [strategyRandom(master, index, 0), strategyRandom(master, index, 1)];
  const choosers = opts.choosers?.(rands, record) ?? ([0, 1] as const).map((s) =>
    makeChooser({
      strategy: setup.sides[s].strategy,
      rand: rands[s],
      scripts: prep.scripts[s],
      loop: setup.sides[s].loop,
      onFallback: () => record.fallbacks++,
    })
  );
  let misses: string[] = [];
  let setupStart = -1;
  let setupEnd = -1;
  try {
    battle.setPlayer("p1", { name: SIDE_NAMES[0], team: prep.packed[0] });
    battle.setPlayer("p2", { name: SIDE_NAMES[1], team: prep.packed[1] });
    // Team preview (Gen 5 on): the leads are the setup's first Pokémon, the rest in order.
    for (const side of battle.sides) {
      const request = side.activeRequest as unknown as BattleRequest | null;
      if (request?.teamPreview) battle.choose(side.id, teamChoice(request, 1));
    }
    setupStart = battle.log.length;
    misses = applyStart(battle, prep);
    setupEnd = battle.log.length;

    let decisions = 0;
    while (!battle.ended) {
      if (battle.turn > TURN_LIMIT) {
        record.capped = true;
        break;
      }
      let acted = false;
      for (const side of battle.sides) {
        if (battle.ended) break;
        const request = side.activeRequest as unknown as BattleRequest | null;
        if (!request || request.wait || side.isChoiceDone()) continue;
        acted = true;
        decisions++;
        const choose = choosers[side.n];
        const before = refusedBy.length;
        if (battle.choose(side.id, choose(battle, side))) continue;
        // Unavailable (the simulator revealed a trap or a disabled move and sent a new request): ask again.
        if (refusedBy.length === before && battle.choose(side.id, choose(battle, side))) continue;
        // Still no: any legal choice, so the battle goes on (counted in `refused`).
        const fresh = side.activeRequest as unknown as BattleRequest | null;
        if (!fresh || !battle.choose(side.id, randomChoice(fresh, battle.gameType === "doubles", rands[side.n]))) battle.choose(side.id, "default");
      }
      if (!acted || decisions > TURN_LIMIT * 12) {
        record.broken = !battle.ended;
        break;
      }
    }
  } catch (err) {
    record.broken = true;
    if (opts.log) misses.push(`The simulator stopped: ${err instanceof Error ? err.message : String(err)}`);
  }
  record.refused += refusedBy.length;

  // Who won.
  let outcome: Outcome = 2;
  if (battle.ended && battle.winner === SIDE_NAMES[0]) outcome = 0;
  else if (battle.ended && battle.winner === SIDE_NAMES[1]) outcome = 1;
  record.outcome = outcome;
  record.turns = battle.turn;
  if (outcome !== 2 && !setup.doubles && setup.sides[0].team.length === 1 && setup.sides[1].team.length === 1) {
    const mon = battle.sides[outcome].pokemon[0];
    record.winnerHp = mon.maxhp ? (100 * mon.hp) / mon.maxhp : 0;
  }
  readLog(battle.log, prep, record);

  if (!opts.log) return { record };
  return { record, log: replayLog(battle, prep, setupStart, setupEnd), misses };
}

/** Battles `from` (inclusive) to `to` (exclusive): their totals, and each one's outcome (1 Side A, 2 Side B, 3 draw). */
export function runLabRange(prep: PreparedLab, master: string, from: number, to: number): { totals: LabTotals; outcomes: Uint8Array } {
  const totals = emptyTotals();
  const outcomes = new Uint8Array(Math.max(0, to - from));
  for (let i = from; i < to; i++) {
    const { record } = runLabBattle(prep, master, i);
    addRecord(totals, record);
    outcomes[i - from] = record.outcome + 1;
  }
  return { totals, outcomes };
}

/** The omniscient log for a replay: starting conditions before turn 1, nothing about Pokémon still on the bench. */
function replayLog(battle: Battle, prep: PreparedLab, setupStart: number, setupEnd: number): string[] {
  let raw = battle.log;
  if (setupStart >= 0 && setupEnd > setupStart) {
    const turn1 = raw.lastIndexOf("|turn|1", setupStart);
    if (turn1 >= 0) {
      // A replay only learns about a Pokémon when it comes out (its switch-in line carries its HP and status).
      const bench = new Set(prep.names.flatMap((names, s) => names.map((n) => `p${s + 1}: ${n}`)));
      const onBench = (line: string | undefined) => !!line && bench.has(line.split("|")[2] ?? "");
      const setupLines = raw.slice(setupStart, setupEnd).filter((l, i, all) => !onBench(l) && !(l.startsWith("|split|") && onBench(all[i + 1])));
      raw = [...raw.slice(0, turn1), ...setupLines, ...raw.slice(turn1, setupStart), ...raw.slice(setupEnd)];
    }
  }
  const lines = extractChannelMessages(raw.join("\n"), [-1])[-1];
  return lines.filter((l) => !DROPPED.test(l));
}
