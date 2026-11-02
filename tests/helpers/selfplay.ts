import { Battle, Teams } from "pokemon-showdown";
import { extractChannelMessages } from "pokemon-showdown/dist/sim/battle";
import type { PRNGSeed } from "pokemon-showdown/dist/sim/prng";
import type { Battle as PolicyBattle, Side as PolicySide } from "@pkmn/sim";
import { chooseCpu, seededRandom } from "@/lib/battle/cpu-policy";
import { chooseCpuLegacy } from "@/lib/battle/cpu-policy-legacy";
import { randomChoice } from "@/lib/battle/choices";
import type { BattleRequest } from "@/lib/battle/play";
import { seedOf } from "./sim-battle";

/**
 * A whole battle between two computer players on Pokémon Showdown's own
 * simulator (what live battles run on), with fixed seeds, so a test reads a
 * real replay log: the spectator channel as a replay stores it, the winner,
 * and, at the start of every turn, the simulator's exact state (the truth a
 * rebuilt position is checked against). Both players are the computer on
 * Hard (in doubles, cpu-policy-doubles.ts), or the old heuristic.
 */

export interface TruthMon {
  species: string;
  /** % of max HP, as the replay rounds it. */
  hp: number;
  status: string;
  boosts: Record<string, number>;
  terastallized: string;
  activeMoveActions: number;
}

export interface TruthSide {
  /** The Pokémon in each position, null if empty or fainted. */
  active: (TruthMon | null)[];
  /** Every Pokémon not fainted: species → % HP. */
  alive: Record<string, number>;
  conditions: Record<string, number>;
}

export interface Truth {
  turn: number;
  sides: [TruthSide, TruthSide];
  weather: string;
  terrain: string;
  trickRoom: boolean;
}

export interface SelfPlay {
  format: string;
  players: [string, string];
  winner: 0 | 1 | null;
  turns: number;
  log: string[];
  /** truth[t]: the simulator's state at the start of turn t. */
  truth: Truth[];
  /** Choices the simulator refused (should be none). */
  refused: string[];
}

const pct = (hp: number, max: number) => (hp <= 0 ? 0 : Math.max(1, Math.round((100 * hp) / max)));

type SimSide = Battle["sides"][number];
function truthOf(battle: Battle): Truth {
  const side = (s: SimSide): TruthSide => ({
    active: s.active.map((p) =>
      p && !p.fainted && p.hp > 0
        ? {
            species: p.species.name,
            hp: pct(p.hp, p.maxhp),
            status: p.status || "",
            boosts: Object.fromEntries(Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v)),
            terastallized: p.terastallized || "",
            activeMoveActions: p.activeMoveActions,
          }
        : null
    ),
    alive: Object.fromEntries(s.pokemon.filter((p) => !p.fainted && p.hp > 0).map((p) => [p.species.name, pct(p.hp, p.maxhp)])),
    conditions: Object.fromEntries(Object.entries(s.sideConditions).map(([id, c]) => [id, (c as { layers?: number }).layers ?? 1])),
  });
  return {
    turn: battle.turn,
    sides: [side(battle.sides[0]), side(battle.sides[1])],
    weather: battle.field.weather,
    terrain: battle.field.terrain,
    trickRoom: !!battle.field.pseudoWeather.trickroom,
  };
}

/** `teamFormat`: where the teams come from, when the format has no generator of its own (Doubles OU plays Random Doubles teams). */
export function selfPlay(format: string, n: number, opts: { policy?: "hard" | "legacy"; maxTurns?: number; teamFormat?: string } = {}): SelfPlay {
  const battle = new Battle({ formatid: format as never, seed: seedOf(n) as PRNGSeed });
  const refused: string[] = [];
  (battle as { send: Battle["send"] }).send = (type: string, data: string | string[]) => {
    if (type !== "sideupdate") return;
    const text = Array.isArray(data) ? data.join("\n") : data;
    const err = text.indexOf("|error|");
    if (err >= 0 && !text.startsWith("[Unavailable choice]", err + 7)) refused.push(text.slice(err + 7));
  };
  // Teams from their own seeds (left to the battle, they'd be drawn from a fresh random seed).
  const team = (i: number) => Teams.pack(Teams.generate(opts.teamFormat ?? format, { seed: seedOf(n * 2 + i + 500) as PRNGSeed }));
  battle.setPlayer("p1", { name: "Red", team: team(0) });
  battle.setPlayer("p2", { name: "Blue", team: team(1) });
  const rands = [seededRandom(`selfplay:${n}:0`), seededRandom(`selfplay:${n}:1`)];
  const truth: Truth[] = [];
  const doubles = battle.gameType === "doubles";
  const maxTurns = opts.maxTurns ?? 200;
  for (let guard = 0; !battle.ended && guard < 5_000 && battle.turn <= maxTurns; guard++) {
    if (battle.turn > 0 && !truth[battle.turn]) truth[battle.turn] = truthOf(battle);
    let acted = false;
    for (const side of battle.sides) {
      if (battle.ended) break;
      const request = side.activeRequest as unknown as BattleRequest | null;
      if (!request || request.wait || side.isChoiceDone()) continue;
      acted = true;
      const ps = side as unknown as PolicySide;
      const pb = battle as unknown as PolicyBattle;
      const choice = opts.policy === "legacy" ? chooseCpuLegacy(pb, ps, "hard", rands[side.n]) : chooseCpu(pb, ps, "hard", rands[side.n]);
      if (!battle.choose(side.id, choice)) {
        const fresh = side.activeRequest as unknown as BattleRequest | null;
        if (!fresh || !battle.choose(side.id, randomChoice(fresh, doubles, rands[side.n]))) battle.choose(side.id, "default");
      }
    }
    if (!acted) break;
  }
  const log = extractChannelMessages(battle.log.join("\n"), [0])[0].filter((l) => l && !/^\|(t:|debug|request)\|/.test(l));
  const winner = battle.winner === "Red" ? 0 : battle.winner === "Blue" ? 1 : null;
  return { format, players: ["Red", "Blue"], winner, turns: battle.turn, log, truth, refused };
}
