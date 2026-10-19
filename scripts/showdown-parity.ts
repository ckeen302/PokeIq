/**
 * Parity between @pkmn/sim (what PokéIQ's battles run on) and the official
 * Pokémon Showdown simulator (the `pokemon-showdown` npm package).
 *
 * Every battle is played twice, once per engine, with the same format, seed
 * and teams, and the same choices: each choice is picked by a seeded RNG from
 * the legal options of the official engine's request, then fed to both. At
 * every decision the two requests are compared, and when the battle ends the
 * two full (omniscient) logs are compared line by line. Only the timestamp
 * lines (`|t:|`) are dropped before comparing.
 *
 * The random teams of both generators are also generated from the same seed
 * and compared (that's data: the random-battle set lists), and the official
 * engine's team is the one both battles use, so a set-list difference never
 * hides a mechanics difference.
 *
 *   npm run verify:showdown                    (2,000 battles)
 *   npm run verify:showdown -- --battles 200 --seed 7 --verbose
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as Pkmn from "@pkmn/sim";
import { TeamGenerators } from "@pkmn/randoms";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// The two engines behind one minimal interface.

type Seed = string | number[];

interface SimSide {
  activeRequest: AnyRequest | null;
  isChoiceDone(): boolean;
}
interface SimBattle {
  log: string[];
  ended: boolean;
  turn: number;
  winner?: string;
  p1: SimSide;
  p2: SimSide;
  setPlayer(slot: string, options: { name: string; team: string }): void;
  choose(side: string, choice: string): boolean;
  send: (type: string, data: string | string[]) => void;
}
interface Engine {
  name: string;
  Battle: new (options: { formatid: string; seed: Seed }) => SimBattle;
  Teams: {
    pack(team: unknown[]): string;
    import(text: string): unknown[] | null;
    generate(format: string, options: { seed: Seed }): unknown[];
  };
  validate(format: string, team: string): string[] | null;
}

Pkmn.Teams.setGeneratorFactory(TeamGenerators);
const pkmn: Engine = {
  name: "@pkmn/sim",
  Battle: Pkmn.Battle as never,
  Teams: Pkmn.Teams as never,
  validate: (format, team) => new Pkmn.TeamValidator(format).validateTeam(Pkmn.Teams.unpack(team)),
};

interface ShowdownModule {
  Battle: Engine["Battle"];
  Teams: Engine["Teams"] & { unpack(team: string): unknown[] };
  TeamValidator: new (format: string) => { validateTeam(team: unknown[]): string[] | null };
}
const PS = require("pokemon-showdown") as ShowdownModule;
const showdown: Engine = {
  name: "pokemon-showdown",
  Battle: PS.Battle,
  Teams: PS.Teams,
  validate: (format, team) => new PS.TeamValidator(format).validateTeam(PS.Teams.unpack(team)),
};

// ---------------------------------------------------------------------------
// Requests and legal choices.

interface MoveSlot {
  move: string;
  id: string;
  pp?: number;
  maxpp?: number;
  target?: string;
  disabled?: boolean | string;
}
interface ActiveRequest {
  moves: MoveSlot[];
  trapped?: boolean;
  maybeTrapped?: boolean;
  canMegaEvo?: boolean;
  canMegaEvoX?: boolean;
  canMegaEvoY?: boolean;
  canUltraBurst?: boolean;
  canZMove?: ({ move: string; target: string } | null)[];
  canDynamax?: boolean;
  maxMoves?: { maxMoves: { move: string; target: string; disabled?: boolean }[] };
  canTerastallize?: string;
  commanding?: boolean;
}
interface SidePokemon {
  condition: string;
  active?: boolean;
  reviving?: boolean;
}
interface AnyRequest {
  wait?: boolean;
  teamPreview?: boolean;
  maxChosenTeamSize?: number;
  forceSwitch?: boolean[];
  active?: ActiveRequest[];
  side: { pokemon: SidePokemon[] };
}

/** A small seeded RNG (mulberry32) for the choices, independent of both engines. */
export class ChoiceRng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

const fainted = (p: SidePokemon) => p.condition.endsWith(" fnt");

/** Target locations a move with this target type may name, in an `activeCount`-a-side battle from slot `slot`. */
function targetsFor(target: string | undefined, activeCount: number, slot: number): number[] {
  if (activeCount < 2) return [0];
  const foes = Array.from({ length: activeCount }, (_, i) => i + 1);
  const allies = Array.from({ length: activeCount }, (_, i) => -(i + 1)).filter((loc) => loc !== -(slot + 1));
  switch (target) {
    case "normal":
    case "adjacentFoe":
      return activeCount === 3 ? foes.filter((loc) => Math.abs(loc - 1 - (activeCount - 1 - slot)) <= 1) : foes;
    case "any":
      return [...foes, ...allies];
    case "adjacentAlly":
      return allies;
    case "adjacentAllyOrSelf":
      return [-(slot + 1), ...allies];
    default:
      return [0];
  }
}

/** One random legal choice for a request (the engine has the final word: see `chooseBoth`). */
export function randomChoice(request: AnyRequest, rng: ChoiceRng): string {
  const team = request.side.pokemon;
  if (request.teamPreview) {
    const order = rng.shuffle(team.map((_, i) => i + 1));
    return `team ${order.slice(0, request.maxChosenTeamSize ?? team.length).join("")}`;
  }
  const activeCount = request.forceSwitch?.length ?? request.active?.length ?? 1;
  const bench = team.map((p, i) => ({ p, slot: i + 1 })).filter(({ p, slot }) => slot > activeCount && !fainted(p));
  const used = new Set<number>();
  const takeSwitch = (): string | null => {
    const options = bench.filter(({ slot }) => !used.has(slot));
    if (!options.length) return null;
    const { slot } = rng.pick(options);
    used.add(slot);
    return `switch ${slot}`;
  };
  if (request.forceSwitch) {
    // Revival Blessing asks for a fainted Pokémon instead.
    if (team.some((p) => p.reviving)) {
      const dead = team.map((p, i) => ({ p, slot: i + 1 })).filter(({ p, slot }) => slot > activeCount && fainted(p));
      return dead.length ? `switch ${rng.pick(dead).slot}` : "pass";
    }
    return request.forceSwitch.map((must) => (must ? (takeSwitch() ?? "pass") : "pass")).join(", ");
  }
  let gimmickUsed = false;
  const parts = (request.active ?? []).map((active, slot) => {
    if (fainted(team[slot]) || active.commanding) return "pass";
    const canSwitch = !active.trapped && bench.some(({ slot: s }) => !used.has(s));
    if (canSwitch && rng.next() < 0.15) return takeSwitch() ?? "pass";
    const usable = active.moves.map((m, i) => ({ m, i })).filter(({ m }) => !m.disabled && (m.pp === undefined || m.pp > 0));
    if (!usable.length) return "move 1";
    const { m, i } = rng.pick(usable);
    let gimmick = "";
    if (!gimmickUsed && rng.next() < 0.3) {
      if (active.canTerastallize) gimmick = " terastallize";
      else if (active.canDynamax) gimmick = " dynamax";
      else if (active.canMegaEvo) gimmick = " mega";
      else if (active.canMegaEvoX) gimmick = " megax";
      else if (active.canMegaEvoY) gimmick = " megay";
      else if (active.canUltraBurst) gimmick = " ultra";
      else if (active.canZMove?.[i]) gimmick = " zmove";
      if (gimmick) gimmickUsed = true;
    }
    let target = m.target;
    if (gimmick === " zmove") target = active.canZMove?.[i]?.target;
    else if (gimmick === " dynamax" || (active.maxMoves && !active.canDynamax)) target = active.maxMoves?.maxMoves[i]?.target ?? target;
    const loc = rng.pick(targetsFor(target, activeCount, slot));
    return `move ${i + 1}${loc ? ` ${loc}` : ""}${gimmick}`;
  });
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// One battle in both engines.

export interface Scenario {
  label: string;
  formatid: string;
  /** Teams (any Showdown format); omitted: generated for the format from the seed. */
  teams?: [string, string];
}

export interface Divergence {
  scenario: string;
  formatid: string;
  seed: string;
  kind: "team" | "request" | "choice" | "log" | "crash" | "validator";
  /** Which battle of the run (replay it with `--trace`). */
  battle?: number;
  /** The line (or turn) where it starts. */
  at: number;
  official: string;
  pkmn: string;
}

export interface BattleOutcome {
  scenario: string;
  turns: number;
  lines: number;
  divergences: Divergence[];
  /** Both full logs, when asked for (`--trace`). */
  logs?: { official: string[]; pkmn: string[] };
}

const TURN_LIMIT = 400;
/** Ways two logs may line up again after a differing line, nearest first. */
const RESYNC: [number, number][] = Array.from({ length: 25 }, (_, n) => [Math.floor(n / 5), n % 5] as [number, number])
  .filter(([di, dj]) => di + dj > 0)
  .sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]));
const norm = (log: string[]) => log.filter((line) => !line.startsWith("|t:|"));

function seedFor(master: number, index: number): string {
  const rng = new ChoiceRng(master * 1_000_003 + index * 7919);
  return `sodium,${Array.from({ length: 16 }, () => rng.int(256).toString(16).padStart(2, "0")).join("")}`;
}

function packTeam(engine: Engine, text: string): string {
  const team = engine.Teams.import(text);
  if (!team) throw new Error(`Unreadable team: ${text.slice(0, 40)}`);
  return engine.Teams.pack(team);
}

export function playBoth(scenario: Scenario, seed: string, choiceSeed: number, teamSeeds: [string, string] = [seed, seed], keepLogs = false): BattleOutcome {
  const divergences: Divergence[] = [];
  const add = (d: Omit<Divergence, "scenario" | "formatid" | "seed">) =>
    divergences.push({ scenario: scenario.label, formatid: scenario.formatid, seed, ...d });

  let teams: [string, string];
  if (scenario.teams) {
    teams = [packTeam(showdown, scenario.teams[0]), packTeam(showdown, scenario.teams[1])];
  } else {
    const official = [1, 2].map((n) => showdown.Teams.pack(showdown.Teams.generate(scenario.formatid, { seed: teamSeeds[n - 1] })));
    const ours = [1, 2].map((n) => pkmn.Teams.pack(pkmn.Teams.generate(scenario.formatid, { seed: teamSeeds[n - 1] })));
    for (const n of [0, 1]) {
      if (official[n] !== ours[n]) add({ kind: "team", at: n + 1, official: official[n], pkmn: ours[n] });
    }
    teams = [official[0], official[1]];
  }

  const make = (engine: Engine) => {
    const battle = new engine.Battle({ formatid: scenario.formatid, seed });
    battle.send = () => {};
    battle.setPlayer("p1", { name: "Alice", team: teams[0] });
    battle.setPlayer("p2", { name: "Bob", team: teams[1] });
    return battle;
  };
  let official: SimBattle;
  let ours: SimBattle;
  try {
    official = make(showdown);
    ours = make(pkmn);
  } catch (err) {
    add({ kind: "crash", at: 0, official: String(err), pkmn: "" });
    return { scenario: scenario.label, turns: 0, lines: 0, divergences };
  }

  const rng = new ChoiceRng(choiceSeed);
  let decisions = 0;
  try {
    while (!official.ended && official.turn <= TURN_LIMIT && decisions < 4 * TURN_LIMIT) {
      decisions++;
      let progressed = false;
      for (const side of ["p1", "p2"] as const) {
        const req = official[side].activeRequest;
        if (!req || req.wait || official[side].isChoiceDone()) continue;
        const theirs = JSON.stringify(req);
        const mine = JSON.stringify(ours[side].activeRequest);
        if (theirs !== mine) {
          add({ kind: "request", at: official.turn, official: theirs, pkmn: mine });
          return finish();
        }
        let accepted = false;
        for (let attempt = 0; attempt < 12 && !accepted; attempt++) {
          const choice = attempt < 11 ? randomChoice(official[side].activeRequest!, rng) : "default";
          const a = official.choose(side, choice);
          const b = ours.choose(side, choice);
          if (a !== b) {
            add({ kind: "choice", at: official.turn, official: `${choice} -> ${a}`, pkmn: `${choice} -> ${b}` });
            return finish();
          }
          accepted = a;
        }
        if (!accepted) throw new Error(`No legal choice found for ${side} on turn ${official.turn}`);
        progressed = true;
        if (official.ended) break;
      }
      if (!progressed) break;
    }
  } catch (err) {
    add({ kind: "crash", at: official.turn, official: String(err instanceof Error ? err.stack?.split("\n").slice(0, 3).join(" ") : err), pkmn: "" });
  }
  return finish();

  function finish(): BattleOutcome {
    const a = norm(official.log);
    const b = norm(ours.log);
    // The header (format, rules, teams) and the battle proper are compared
    // separately, so a rule-text difference doesn't hide the battle. Within
    // each, a line that differs, or is there in one log only, while the logs
    // line up again right after, is one divergence and the walk goes on;
    // once they stop lining up, the battles have desynced and only that
    // first line is reported.
    const split = (log: string[]) => Math.max(0, log.indexOf("|start"));
    const parts: [string[], string[], number][] = [
      [a.slice(0, split(a)), b.slice(0, split(b)), 0],
      [a.slice(split(a)), b.slice(split(b)), split(a)],
    ];
    for (const [x, y, offset] of parts) {
      let i = 0;
      let j = 0;
      while (i < x.length || j < y.length) {
        if (x[i] === y[j]) {
          i++;
          j++;
          continue;
        }
        add({ kind: "log", at: offset + i, official: `${x[i - 1] ?? ""}  >>  ${x[i] ?? "(end)"}`, pkmn: `${y[j - 1] ?? ""}  >>  ${y[j] ?? "(end)"}` });
        const lined = (di: number, dj: number) => i + di <= x.length && j + dj <= y.length && x[i + di] === y[j + dj] && x[i + di + 1] === y[j + dj + 1];
        // The nearest point (up to 4 lines on) where they line up again: a
        // changed line (and its |split| twin), an added one or a dropped one.
        const step = RESYNC.find(([di, dj]) => lined(di, dj));
        if (!step) break;
        i += step[0];
        j += step[1];
      }
    }
    return { scenario: scenario.label, turns: official.turn, lines: a.length, divergences, logs: keepLogs ? { official: a, pkmn: b } : undefined };
  }
}

// ---------------------------------------------------------------------------
// Scenarios.

const PIPLUP = `Piplup @ Oran Berry
Ability: Torrent
Level: 5
EVs: 4 HP / 252 SpA / 252 Spe
Modest Nature
- Bubble
- Growl
- Pound
- Peck`;
const TURTWIG = `Turtwig @ Sitrus Berry
Ability: Overgrow
Level: 5
EVs: 252 HP / 252 Atk / 4 Def
Adamant Nature
- Tackle
- Withdraw
- Absorb
- Razor Leaf`;

/** A gen 9 OU team (legal in both validators: checked by `checkValidators`). */
const OU_TEAM_A = `Great Tusk @ Booster Energy
Ability: Protosynthesis
Tera Type: Steel
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off

Kingambit @ Leftovers
Ability: Supreme Overlord
Tera Type: Dark
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Swords Dance

Gholdengo @ Choice Scarf
Ability: Good as Gold
Tera Type: Steel
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Make It Rain
- Shadow Ball
- Trick
- Focus Blast

Dragapult @ Choice Specs
Ability: Infiltrator
Tera Type: Ghost
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Draco Meteor
- Shadow Ball
- Flamethrower
- U-turn

Corviknight @ Leftovers
Ability: Pressure
Tera Type: Dragon
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
- Brave Bird
- Roost
- Defog
- U-turn

Clefable @ Leftovers
Ability: Magic Guard
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
IVs: 0 Atk
- Moonblast
- Moonlight
- Calm Mind
- Flamethrower`;

const OU_TEAM_B = `Iron Valiant @ Booster Energy
Ability: Quark Drive
Tera Type: Fairy
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
IVs: 0 Atk
- Moonblast
- Psyshock
- Calm Mind
- Encore

Heatran @ Leftovers
Ability: Flash Fire
Tera Type: Grass
EVs: 252 HP / 4 SpA / 252 SpD
Calm Nature
IVs: 0 Atk
- Magma Storm
- Earth Power
- Stealth Rock
- Taunt

Garganacl @ Leftovers
Ability: Purifying Salt
Tera Type: Fairy
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
- Salt Cure
- Recover
- Protect
- Stealth Rock

Zamazenta @ Leftovers
Ability: Dauntless Shield
Tera Type: Fire
EVs: 252 HP / 88 Def / 168 Spe
Jolly Nature
- Body Press
- Iron Defense
- Crunch
- Roar

Samurott-Hisui @ Assault Vest
Ability: Sharpness
Tera Type: Dark
EVs: 252 Atk / 4 SpD / 252 Spe
Adamant Nature
- Ceaseless Edge
- Razor Shell
- Sucker Punch
- Aqua Jet

Ogerpon-Wellspring @ Wellspring Mask
Ability: Water Absorb
Tera Type: Water
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Ivy Cudgel
- Horn Leech
- Knock Off
- Swords Dance`;

export const SCENARIOS: Scenario[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((gen) => ({ label: `gen${gen}randombattle`, formatid: `gen${gen}randombattle` })),
  { label: "gen9randomdoublesbattle", formatid: "gen9randomdoublesbattle" },
  { label: "gen4customgame Piplup vs Turtwig", formatid: "gen4customgame", teams: [PIPLUP, TURTWIG] },
  { label: "gen9ou", formatid: "gen9ou", teams: [OU_TEAM_A, OU_TEAM_B] },
];

/** Both validators on the fixed teams: they must agree (and the OU teams must be legal). */
/**
 * Single sets on the edge of legality, where the two validators' rules or
 * tiers have moved apart. Each is compared like the battle teams are.
 */
export const VALIDATOR_PROBES: { formatid: string; label: string; team: string }[] = [
  { formatid: "gen9ou", label: "Clefable with Soft-Boiled (a Gen 3 tutor move)", team: "Clefable @ Leftovers\nAbility: Magic Guard\nTera Type: Water\nEVs: 252 HP / 252 Def / 4 SpD\nBold Nature\n- Moonblast\n- Soft-Boiled\n- Calm Mind\n- Flamethrower" },
  { formatid: "gen9uu", label: "Heatran in UU", team: "Heatran @ Leftovers\nAbility: Flash Fire\nTera Type: Grass\nEVs: 252 HP / 4 SpA / 252 SpD\nCalm Nature\n- Magma Storm\n- Earth Power\n- Stealth Rock\n- Taunt" },
  { formatid: "gen9uu", label: "Tyranitar in UU", team: "Tyranitar @ Leftovers\nAbility: Sand Stream\nTera Type: Ghost\nEVs: 252 HP / 252 Atk / 4 SpD\nAdamant Nature\n- Stone Edge\n- Knock Off\n- Stealth Rock\n- Thunder Wave" },
  { formatid: "gen9uu", label: "Iron Crown in UU", team: "Iron Crown @ Choice Specs\nAbility: Quark Drive\nTera Type: Steel\nEVs: 252 SpA / 4 SpD / 252 Spe\nTimid Nature\n- Tachyon Cutter\n- Psyshock\n- Volt Switch\n- Focus Blast" },
];

/** Both validators on the fixed teams and the probes: they must agree (and the battle teams must be legal). */
export function checkValidators(): Divergence[] {
  const out: Divergence[] = [];
  const cases = [
    ...SCENARIOS.flatMap((scenario) => (scenario.teams ?? []).map((team) => ({ formatid: scenario.formatid, label: scenario.label, team, mustPass: true }))),
    ...VALIDATOR_PROBES.map((probe) => ({ ...probe, mustPass: false })),
  ];
  for (const [n, c] of cases.entries()) {
    const official = showdown.validate(c.formatid, packTeam(showdown, c.team));
    const ours = pkmn.validate(c.formatid, packTeam(pkmn, c.team));
    if (JSON.stringify(official) !== JSON.stringify(ours) || (c.mustPass && official)) {
      out.push({ scenario: c.label, formatid: c.formatid, seed: "", kind: "validator", at: n + 1, official: JSON.stringify(official), pkmn: JSON.stringify(ours) });
    }
  }
  return out;
}

export interface ParityReport {
  battles: number;
  turns: number;
  lines: number;
  perScenario: Record<string, { battles: number; diverged: number }>;
  divergences: Divergence[];
}

// ---------------------------------------------------------------------------
// Every divergence seen so far, by cause. A divergence that matches none is
// "unclassified" and fails the run: it needs a look.

export type Category = "data update" | "mechanics fix" | "harness artefact";

interface Known {
  label: string;
  category: Category;
  test: (d: Divergence) => boolean;
  /** It changes what happens (not just a line's wording), so later requests and lines can differ too. */
  stateful?: boolean;
}

const genOf = (d: Divergence) => Number(/^gen(\d)/.exec(d.formatid)?.[1] ?? 9);
const both = (d: Divergence) => `${d.official}\n${d.pkmn}`;

export const KNOWN: Known[] = [
  { label: "Random-battle set lists", category: "data update", test: (d) => d.kind === "team" },
  { label: "Validator rules and tiers (transfer moves, tier shifts)", category: "data update", test: (d) => d.kind === "validator" },
  { label: "Format rules and their descriptions", category: "data update", test: (d) => d.kind === "log" && /\|rule\|/.test(both(d)) },
  {
    label: "Recoil damage no longer names the Pokémon hit ([of])",
    category: "mechanics fix",
    test: (d) => d.kind === "log" && /\[from\] Recoil$/.test(d.official) && /\[from\] Recoil\|\[of\] /.test(d.pkmn),
  },
  {
    label: "Pursuit on a switching target runs as its own move ([from] Pursuit), PP and Pressure included",
    category: "mechanics fix",
    stateful: true,
    test: (d) => d.kind === "log" && /\|Pursuit\|.*\[from\] (move: )?Pursuit/.test(d.official) && /-activate\|.*move: Pursuit/.test(d.pkmn),
  },
  { label: "Gen 3-4 Encore ends on schedule", category: "mechanics fix", stateful: true, test: (d) => d.kind === "log" && [3, 4].includes(genOf(d)) && /\|-end\|[^|]*\|Encore/.test(d.official) },
  { label: "Gen 4 Truant counts the turn it switched in", category: "mechanics fix", stateful: true, test: (d) => d.kind === "log" && genOf(d) === 4 && /ability: Truant/.test(both(d)) },
  { label: "Gen 4 Custap Berry is announced as an item activation", category: "mechanics fix", test: (d) => d.kind === "log" && /Custap Berry/.test(both(d)) },
  {
    label: "Gen 1 Desync Clause: link-battle behaviour from the acting player's view",
    category: "mechanics fix",
    stateful: true,
    test: (d) => d.kind === "log" && genOf(d) === 1 && /Desync Clause|In Gen 1, /.test(both(d)),
  },
];

/** A divergence's cause; a request or choice divergence follows from the battle's own mechanics divergence. */
export function classify(d: Divergence, sameBattle: Divergence[]): { label: string; category: Category | "unclassified" } {
  const known = KNOWN.find((k) => k.test(d));
  if (known) return known;
  if (d.kind === "request" || d.kind === "choice" || d.kind === "log") {
    const cause = sameBattle.map((o) => KNOWN.find((k) => k.stateful && k.test(o))).find(Boolean);
    if (cause) return { label: `${cause.label} (and what follows from it)`, category: cause.category };
  }
  return { label: `${d.kind} in ${d.formatid}`, category: "unclassified" };
}

export interface Tally {
  label: string;
  category: Category | "unclassified";
  count: number;
  /** How many battles (or validator cases) it showed up in. */
  battles: number;
  formats: string[];
  example: Divergence;
}

/** Divergences grouped by cause, most frequent first. */
export function tally(divergences: Divergence[]): Tally[] {
  const byBattle = new Map<string, Divergence[]>();
  for (const d of divergences) {
    const key = `${d.battle ?? "v"}`;
    byBattle.set(key, [...(byBattle.get(key) ?? []), d]);
  }
  const out = new Map<string, Tally>();
  const seen = new Map<string, Set<string>>();
  for (const d of divergences) {
    const { label, category } = classify(d, byBattle.get(`${d.battle ?? "v"}`) ?? []);
    const row = out.get(label) ?? { label, category, count: 0, battles: 0, formats: [], example: d };
    row.count++;
    const ids = seen.get(label) ?? new Set<string>();
    ids.add(`${d.battle ?? `v${d.at}`}`);
    seen.set(label, ids);
    row.battles = ids.size;
    if (!row.formats.includes(d.formatid)) row.formats.push(d.formatid);
    out.set(label, row);
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}

/** Battle `i` of a run: its scenario, seeds and choices follow from `i` and the master seed alone. */
export function playOne(i: number, seed: number, scenarios = SCENARIOS, keepLogs = false): BattleOutcome {
  const scenario = scenarios[i % scenarios.length];
  return playBoth(scenario, seedFor(seed, 3 * i), seed * 65_537 + i, [seedFor(seed, 3 * i + 1), seedFor(seed, 3 * i + 2)], keepLogs);
}

/** `battles` battles, spread evenly over the scenarios. */
export function runParity({ battles, seed = 1, scenarios = SCENARIOS }: { battles: number; seed?: number; scenarios?: Scenario[] }): ParityReport {
  const report: ParityReport = { battles: 0, turns: 0, lines: 0, perScenario: {}, divergences: checkValidators() };
  for (let i = 0; i < battles; i++) {
    const scenario = scenarios[i % scenarios.length];
    const outcome = playOne(i, seed, scenarios);
    for (const d of outcome.divergences) d.battle = i;
    report.battles++;
    report.turns += outcome.turns;
    report.lines += outcome.lines;
    const row = (report.perScenario[scenario.label] ??= { battles: 0, diverged: 0 });
    row.battles++;
    if (outcome.divergences.length) row.diverged++;
    report.divergences.push(...outcome.divergences);
  }
  return report;
}

// ---------------------------------------------------------------------------
// CLI: a summary, never the raw logs.

function clip(s: string, n = 220): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function main(): void {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: number) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : fallback;
  };
  const battles = flag("battles", 2000);
  const seed = flag("seed", 1);
  const verbose = args.includes("--verbose");
  const json = args.includes("--json");
  const trace = flag("trace", -1);
  if (trace >= 0) {
    // One battle's divergences, with the lines around each.
    const outcome = playOne(trace, seed, SCENARIOS, true);
    const { official, pkmn: ours } = outcome.logs!;
    console.log(`${outcome.scenario}, ${outcome.turns} turns`);
    for (const d of outcome.divergences) {
      console.log(`\n${d.kind} at ${d.at}\n  official: ${clip(d.official, 2000)}\n  @pkmn:    ${clip(d.pkmn, 2000)}`);
      const at = d.kind === "log" ? d.at : official.length;
      for (const [name, log] of [["official", official], ["@pkmn", ours]] as const) {
        console.log(`  -- ${name} ${Math.max(0, at - 12)}..${at + 3}`);
        for (const line of log.slice(Math.max(0, at - 12), at + 4)) console.log(`     ${clip(line, 160)}`);
      }
    }
    return;
  }
  const started = Date.now();
  const report = runParity({ battles, seed });
  if (json) {
    console.log(JSON.stringify(report));
    return;
  }
  console.log(`${report.battles} battles, ${report.turns} turns, ${report.lines} log lines compared in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const [label, row] of Object.entries(report.perScenario)) console.log(`  ${label.padEnd(36)} ${row.battles} battles, ${row.diverged} diverged`);
  const byKind = new Map<string, Divergence[]>();
  for (const d of report.divergences) {
    const key = `${d.kind} ${d.formatid}`;
    byKind.set(key, [...(byKind.get(key) ?? []), d]);
  }
  console.log(`${report.divergences.length} divergent lines, requests and checks`);
  if (verbose) {
    for (const [key, list] of byKind) {
      console.log(`\n${key}: ${list.length}`);
      for (const d of list.slice(0, 5)) console.log(`  battle ${d.battle} at ${d.at}\n    official: ${clip(d.official)}\n    @pkmn:    ${clip(d.pkmn)}`);
    }
  }
  const rows = tally(report.divergences);
  for (const category of ["data update", "mechanics fix", "harness artefact", "unclassified"] as const) {
    const these = rows.filter((r) => r.category === category);
    if (!these.length) continue;
    console.log(`\n${category}: ${these.reduce((n, r) => n + r.count, 0)}  (lines or checks, battles they're in)`);
    for (const r of these) {
      const formats = r.formats.length > 4 ? `${r.formats.slice(0, 4).join(", ")} +${r.formats.length - 4}` : r.formats.join(", ");
      console.log(`  ${String(r.count).padStart(5)} ${`(${r.battles})`.padStart(6)}  ${r.label}  [${formats}]`);
      if (category === "unclassified" || verbose) {
        console.log(`         battle ${r.example.battle} at ${r.example.at}\n         official: ${clip(r.example.official)}\n         @pkmn:    ${clip(r.example.pkmn)}`);
      }
    }
  }
  process.exitCode = rows.some((r) => r.category === "unclassified") ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
