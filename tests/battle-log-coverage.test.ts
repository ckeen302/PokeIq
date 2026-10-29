import { describe, expect, it } from "vitest";
import { SimSession, randomTeam, type SideID } from "@/lib/server/battle-engine/engine";
import { randomChoice } from "@/lib/server/battle-engine/choices";
import { BattleModel, benchOrder, endNote, hpNote, isSilentLine } from "@/components/battle/play/model";
import { Protocol } from "@pkmn/protocol";

/**
 * Plays real engine battles (random teams, fixed seeds, several generations,
 * singles and doubles) and feeds every line each player sees to the battle
 * screen: every line must either become log text or be one of the lines
 * Showdown itself writes nothing for.
 */

const FORMATS = [
  "gen9randombattle",
  "gen9randomdoublesbattle",
  "gen8randombattle",
  "gen8randomdoublesbattle",
  "gen7randombattle",
  "gen6randombattle",
  "gen5randombattle",
  "gen4randombattle",
  "gen3randombattle",
  "gen2randombattle",
  "gen1randombattle",
];

type Req = Parameters<typeof randomChoice>[0] & {
  active?: { canMegaEvo?: boolean; canDynamax?: boolean; canZMove?: unknown[]; canUltraBurst?: boolean }[];
};

/** Small seeded generator for the players' choices. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random choice that also Mega Evolves, Dynamaxes or uses a Z-Move when it can, to cover those lines. */
function choose(req: Req, doubles: boolean, rand: () => number): string {
  const base = randomChoice(req, doubles, rand);
  if (req.forceSwitch || req.teamPreview || !req.active?.[0]) return base;
  const parts = base.split(", ");
  const first = parts[0];
  const act = req.active[0];
  if (/^move \d+/.test(first)) {
    if (act.canMegaEvo) parts[0] = `${first} mega`;
    else if (act.canUltraBurst) parts[0] = `${first} ultra`;
    else if (act.canDynamax) parts[0] = `${first} dynamax`;
    else if (act.canZMove) {
      const z = act.canZMove.findIndex(Boolean);
      if (z >= 0) parts[0] = first.replace(/^move \d+/, `move ${z + 1}`) + " zmove";
    }
  }
  return parts.join(", ");
}

function play(formatid: string, seed: number, forfeitAt = Infinity) {
  const rand = mulberry(seed * 7919 + formatid.length);
  const s = (n: number) => `${seed},${n},${seed + n},9`;
  const session = SimSession.create({
    formatid,
    seed: s(1),
    p1: { name: "Red", team: randomTeam(formatid, s(2)) },
    p2: { name: "Blue", team: randomTeam(formatid, s(3)) },
  });
  const doubles = formatid.includes("doubles");
  const lines: Record<SideID, string[]> = { p1: [], p2: [] };
  const take = () => {
    const r = session.result().lines;
    lines.p1.push(...r.p1);
    lines.p2.push(...r.p2);
  };
  take();
  for (let i = 0; i < 400 && !session.ended; i++) {
    let chose = false;
    for (const side of ["p1", "p2"] as SideID[]) {
      const req = session.pending(side) as Req | null;
      if (req) {
        chose = true;
        if (!session.choose(side, choose(req, doubles, rand))) session.choose(side, randomChoice(req, doubles, rand));
      }
    }
    take();
    if (!chose) break;
    if (session.turn >= forfeitAt) {
      session.lose("p1");
      take();
    }
  }
  return lines;
}

describe("battle log coverage", () => {
  it("writes text for every protocol line the engine emits", () => {
    const unhandled = new Map<string, string>();
    const seen = new Set<string>();
    for (const formatid of FORMATS) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const lines = play(formatid, seed, seed === 6 ? 3 : Infinity);
        if (seed === 6) {
          // The battle service's own lines: the timer and inactivity messages.
          const notes = [
            "|inactive|Battle timer is ON: inactive players will automatically lose when time's up. (requested by Red)",
            "|inactive|Blue has 30 seconds left this turn.",
            "|inactiveoff|Battle timer is now OFF.",
            "|-message|All players are inactive.",
            "|-message|Red lost due to inactivity.",
          ];
          lines.p1.splice(lines.p1.length - 2, 0, ...notes);
          lines.p2.splice(lines.p2.length - 2, 0, ...notes);
        }
        for (const me of ["p1", "p2"] as SideID[]) {
          const model = new BattleModel(me);
          for (const line of lines[me]) {
            const step = model.feed(line);
            const { args, kwArgs } = Protocol.parseBattleLine(line) as unknown as { args: string[]; kwArgs: Record<string, unknown> };
            const cmd = args[0] ?? "";
            seen.add(cmd);
            if (isSilentLine(args, kwArgs, Number(/^gen(\d)/.exec(formatid)?.[1]))) continue;
            if (!step || !step.text.trim()) unhandled.set(cmd, `${formatid}: ${line}`);
          }
        }
      }
    }
    expect([...unhandled.values()]).toEqual([]);
    // The battles really covered the interesting parts.
    for (const cmd of ["move", "switch", "-damage", "faint", "turn", "win", "-supereffective", "-crit", "-boost", "-weather", "-status"]) expect(seen).toContain(cmd);
  }, 180_000);
});

describe("battle log details", () => {
  it("notes a Pokémon's HP and status when it switches in hurt", () => {
    expect(hpNote("100/100")).toBe("");
    expect(hpNote("54/100 par")).toBe("54% · PAR");
    expect(hpNote("1/300")).toBe("1%");
    const model = new BattleModel("p1");
    for (const line of ["|player|p1|Red||", "|player|p2|Blue||", "|gametype|singles", "|gen|9", "|start"]) model.feed(line);
    const step = model.feed("|switch|p2a: Garchomp|Garchomp, L80, M|61/100 brn");
    expect(step?.text).toContain("Blue sent out **Garchomp**! (61% · BRN)");
  });

  it("writes the format and rules, and keeps silent what Showdown keeps silent", () => {
    const model = new BattleModel("p1");
    expect(model.feed("|tier|[Gen 9] OU")?.text).toBe("Format: **[Gen 9] OU**");
    expect(model.feed("|rule|Sleep Clause Mod: Limit one foe put to sleep")?.text).toBe("Sleep Clause Mod: Limit one foe put to sleep");
    expect(isSilentLine(["-anim", "p1a: X", "Solar Beam"], {}, 9)).toBe(true);
    expect(isSilentLine(["-boost", "p1a: X", "spd", "1"], {}, 1)).toBe(true);
    expect(isSilentLine(["-boost", "p1a: X", "spd", "1"], {}, 2)).toBe(false);
    expect(isSilentLine(["move", "p1a: X", "Tackle"], {}, 9)).toBe(false);
  });

  it("puts 5-9 on the bench, in party order", () => {
    expect(benchOrder([{ active: true }, { active: false }, { active: false }, { active: true }, { active: false }])).toEqual([1, 2, 4]);
  });

  it("says who forfeited before the winner", () => {
    const players = [{ name: "Red" }, { name: "Blue" }];
    expect(endNote({ players, end: { winner: 1, reason: "forfeit" } })).toBe("Red forfeited.");
    expect(endNote({ players, end: { winner: 1, reason: "normal" } })).toBeNull();
  });
});
