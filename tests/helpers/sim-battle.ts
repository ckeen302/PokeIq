import { Battle, PRNG, Teams } from "pokemon-showdown";
import { extractChannelMessages } from "pokemon-showdown/dist/sim/battle";
import type { PRNGSeed } from "pokemon-showdown/dist/sim/prng";

/**
 * A whole singles battle played on Pokémon Showdown's simulator with fixed
 * seeds (the battle's and the players' choices), so a test reads a real
 * protocol log that comes out the same every run: the spectator channel (what
 * a replay stores), the omniscient channel (exact HP), both teams and the
 * winner's seat. Each player picks a random legal move (or, now and then, a
 * switch).
 */

export interface SimBattle {
  spectator: string[];
  omniscient: string[];
  teams: [ReturnType<typeof Teams.unpack>, ReturnType<typeof Teams.unpack>];
  winner: 0 | 1 | null;
}

type Req = {
  wait?: boolean;
  forceSwitch?: boolean[];
  teamPreview?: boolean;
  active?: { moves: { disabled?: boolean | string; pp?: number }[]; trapped?: boolean; canTerastallize?: string }[];
  side: { pokemon: { condition: string; active?: boolean }[] };
};

const hex4 = (n: number) => (n & 0xffff).toString(16).padStart(4, "0");
/** A fixed gen5 PRNG seed from a number. */
export const seedOf = (n: number) => `gen5,${hex4(n)}${hex4(n * 3 + 1)}${hex4(n * 7 + 2)}${hex4(n * 11 + 3)}`;

export function simBattle(format: string, n: number, opts: { teams?: [string, string]; maxTurns?: number } = {}): SimBattle {
  const battle = new Battle({ formatid: format as never, seed: seedOf(n) as PRNGSeed });
  const spectator: string[] = [];
  const omniscient: string[] = [];
  const keep = (lines: string[]) => lines.filter((l) => l && !/^\|(t:|debug)\|/.test(l));
  (battle as { send: Battle["send"] }).send = (type: string, data: string | string[]) => {
    if (type !== "update") return;
    const text = Array.isArray(data) ? data.join("\n") : data;
    const ch = extractChannelMessages(text, [-1, 0]);
    omniscient.push(...keep(ch[-1].join("\n").split("\n")));
    spectator.push(...keep(ch[0].join("\n").split("\n")));
  };
  const rng = new PRNG(seedOf(n + 1000) as PRNGSeed);
  const team = (i: number) => opts.teams?.[i] ?? Teams.pack(Teams.generate(format, { seed: seedOf(n * 2 + i + 500) as PRNGSeed }));
  battle.setPlayer("p1", { name: "Red", team: team(0) });
  battle.setPlayer("p2", { name: "Blue", team: team(1) });
  const choose = (req: Req): string => {
    if (req.teamPreview) return "default";
    const bench = req.side.pokemon.map((p, i) => ({ i: i + 1, ok: !p.active && !p.condition.endsWith(" fnt") })).filter((p) => p.ok);
    if (req.forceSwitch) return bench.length ? `switch ${bench[rng.random(bench.length)].i}` : "pass";
    const a = req.active?.[0];
    if (!a) return "default";
    const moves = a.moves.map((m, i) => ({ i: i + 1, ok: !m.disabled && m.pp !== 0 })).filter((m) => m.ok);
    if (!a.trapped && bench.length && (rng.random(100) < 12 || !moves.length)) return `switch ${bench[rng.random(bench.length)].i}`;
    if (!moves.length) return "default";
    const tera = a.canTerastallize && rng.random(100) < 10 ? " terastallize" : "";
    return `move ${moves[rng.random(moves.length)].i}${tera}`;
  };
  const max = opts.maxTurns ?? 120;
  while (!battle.ended && battle.turn <= max) {
    let acted = false;
    for (const side of battle.sides) {
      const req = side.activeRequest as Req | null;
      if (!req || req.wait || side.isChoiceDone()) continue;
      if (!battle.choose(side.id, choose(req))) battle.choose(side.id, "default");
      acted = true;
      if (battle.ended) break;
    }
    // The simulator holds its lines until asked (as its stream does after each choice).
    battle.sendUpdates();
    if (!acted) break;
  }
  battle.sendUpdates();
  const win = spectator.find((l) => l.startsWith("|win|"))?.slice(5);
  return {
    spectator,
    omniscient,
    teams: [battle.sides[0].team as never, battle.sides[1].team as never],
    winner: win === "Red" ? 0 : win === "Blue" ? 1 : null,
  };
}
