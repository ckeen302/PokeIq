import { describe, expect, it } from "vitest";
import { Generations } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import * as lib from "@smogon/calc/dist/adaptable";
import type { AssumedSet } from "@/lib/battle/analysis/assume";
import {
  addChance,
  addRoll,
  consistentRolls,
  critChance,
  critStage,
  emptyRolls,
  emptyTally,
  hitChance,
  luckScore,
  rollPosition,
  shownPercent,
  stageMultiplier,
  type AccuracyInput,
} from "@/lib/battle/analysis/luck-math";
import { rollPlacer } from "@/lib/battle/analysis/rolls";
import { computeStats, type RollCandidate } from "@/lib/battle/analysis/stats";
import { causeOf, luckVerdict, mvpOf, shareHeadline, shareText, signed, turningPoints } from "@/lib/battle/analysis/stats-text";
import type { BattleStats, TurnNote } from "@/lib/battle/analysis/stats-types";
import type { WinPoint } from "@/lib/battle/analysis/maths";
import { completeSet } from "@/lib/battle/sets";
import { computeBattleStats } from "@/lib/server/battle-stats";
import { simBattle, type SimBattle } from "./helpers/sim-battle";

const gens = new Generations(Dex);

// ---------------------------------------------------------------------------
// The odds
// ---------------------------------------------------------------------------

describe("luck maths", () => {
  it("crit chances follow each generation's table", () => {
    expect(critChance(9, 1)).toBeCloseTo(1 / 24);
    expect(critChance(9, 2)).toBeCloseTo(1 / 8);
    expect(critChance(9, 3)).toBe(0.5);
    expect(critChance(9, 4)).toBe(1);
    expect(critChance(6, 1)).toBeCloseTo(1 / 16);
    expect(critChance(5, 1)).toBeCloseTo(1 / 16);
    expect(critChance(5, 3)).toBe(0.25);
    expect(critChance(4, 5)).toBe(0.5);
    expect(critStage({ critRatio: 2, item: "scopelens", ability: "superluck", species: "Absol" })).toBe(4);
    expect(critStage({ item: "leek", ability: "", species: "Sirfetch’d" })).toBe(3);
    expect(critStage({ focusEnergy: true, item: "", ability: "", species: "Kingler" })).toBe(3);
  });

  const base = (over: Partial<AccuracyInput> = {}): AccuracyInput => ({
    gen: 9,
    move: { id: "stoneedge", accuracy: 80, category: "Physical", type: "Rock" },
    user: { level: 100, types: ["Rock"], ability: "", item: "", accuracy: 0 },
    target: { level: 100, types: ["Flying"], ability: "", item: "", evasion: 0 },
    weather: "",
    ...over,
  });

  it("works out a move's chance to hit from what's known", () => {
    expect(hitChance(base())).toBeCloseTo(0.8);
    expect(hitChance(base({ user: { level: 100, types: ["Rock"], ability: "compoundeyes", item: "", accuracy: 0 } }))).toBe(1);
    expect(hitChance(base({ user: { level: 100, types: ["Rock"], ability: "hustle", item: "", accuracy: 0 } }))).toBeCloseTo(0.64);
    expect(hitChance(base({ target: { level: 100, types: ["Flying"], ability: "", item: "brightpowder", evasion: 0 } }))).toBeCloseTo(0.72);
    expect(hitChance(base({ target: { level: 100, types: ["Flying"], ability: "", item: "", evasion: 1 } }))).toBeCloseTo(0.6);
    expect(hitChance(base({ user: { level: 100, types: ["Rock"], ability: "", item: "", accuracy: -1 } }))).toBeCloseTo(0.6);
    expect(hitChance(base({ user: { level: 100, types: ["Rock"], ability: "noguard", item: "", accuracy: 0 } }))).toBeNull();
    expect(hitChance(base({ move: { id: "thunder", accuracy: 70, category: "Special", type: "Electric" }, weather: "raindance" }))).toBeNull();
    expect(hitChance(base({ move: { id: "thunder", accuracy: 70, category: "Special", type: "Electric" }, weather: "sunnyday" }))).toBeCloseTo(0.5);
    expect(hitChance(base({ move: { id: "blizzard", accuracy: 70, category: "Special", type: "Ice" }, weather: "snow" }))).toBeNull();
    expect(hitChance(base({ move: { id: "toxic", accuracy: 90, category: "Status", type: "Poison" }, user: { level: 100, types: ["Poison"], ability: "", item: "", accuracy: 0 } }))).toBeNull();
    expect(hitChance(base({ move: { id: "earthquake", accuracy: true, category: "Physical", type: "Ground" } }))).toBeNull();
    expect(hitChance(base({ move: { id: "sheercold", accuracy: 30, ohko: "Ice", category: "Special", type: "Ice" }, user: { level: 100, types: ["Water"], ability: "", item: "", accuracy: 0 }, target: { level: 90, types: ["Normal"], ability: "", item: "", evasion: 0 } }))).toBeCloseTo(0.3);
    expect(stageMultiplier(2)).toBeCloseTo(5 / 3);
    expect(stageMultiplier(-2)).toBeCloseTo(3 / 5);
    expect(stageMultiplier(9)).toBe(3);
  });

  it("reads a percentage HP bar as Showdown draws it, and places a roll from it", () => {
    expect(shownPercent(300, 300)).toBe(100);
    expect(shownPercent(299, 300)).toBe(99);
    expect(shownPercent(1, 300)).toBe(1);
    expect(shownPercent(150, 300)).toBe(50);
    expect(shownPercent(151, 300)).toBe(51);
    const rolls = [140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155];
    // 300 HP, 100% → 50%: 148–150 HP left, so 150 to 152 damage.
    expect(consistentRolls(rolls, 300, 100, 50)).toEqual([10, 11, 12]);
    expect(rollPosition(rolls, 300, 100, 50)).toBeCloseTo(11 / 15);
    expect(consistentRolls(rolls, 300, 100, 90)).toEqual([]);
    expect(rollPosition(rolls, 300, 100, 90)).toBeNull();
    // A bar too coarse to tell (a tiny hit on a bulky Pokémon): every roll fits, so it says nothing.
    expect(rollPosition([5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6], 1000, 50, 50)).toBeNull();
  });

  it("adds luck up as observed minus expected, opposite for the two sides", () => {
    const t = emptyTally();
    for (let i = 0; i < 24; i++) addChance(t, 1 / 24, i < 3);
    expect(t.observed).toBe(3);
    expect(t.expected).toBeCloseTo(1);
    expect(t.variance).toBeCloseTo(24 * (1 / 24) * (23 / 24));
    const none = emptyTally();
    const rolls = emptyRolls();
    addRoll(rolls, 1);
    addRoll(rolls, 1);
    addRoll(rolls, 0.5);
    expect(rolls).toEqual({ n: 3, sum: 2.5, high: 2, low: 0 });
    const misses = emptyTally();
    addChance(misses, 0.2, true); // our Stone Edge missed
    const a = luckScore({ critsLanded: t, critsReceived: none, missesOwn: misses, missesFoe: emptyTally(), procsLanded: emptyTally(), procsReceived: emptyTally(), rollsOwn: rolls, rollsReceived: emptyRolls() });
    expect(a.parts.crits).toBeCloseTo(2);
    expect(a.parts.misses).toBeCloseTo(-0.8);
    expect(a.parts.rolls).toBeCloseTo(1);
    expect(a.score).toBeCloseTo(2.2);
    const b = luckScore({ critsLanded: none, critsReceived: t, missesOwn: emptyTally(), missesFoe: misses, procsLanded: emptyTally(), procsReceived: emptyTally(), rollsOwn: emptyRolls(), rollsReceived: rolls });
    expect(b.score).toBeCloseTo(-a.score);
    expect(b.sd).toBeCloseTo(a.sd);
  });
});

// ---------------------------------------------------------------------------
// Real battles: every count against the log itself
// ---------------------------------------------------------------------------

const keyOf = (ident: string) => ident.replace(/^(p[12])[a-d]?: /, "$1: ");
const hpOf = (cond: string | undefined) => {
  if (!cond || cond.startsWith("0")) return 0;
  const [a, b] = cond.split(" ")[0].split("/").map(Number);
  return b ? (100 * a) / b : 0;
};

/** The log read the plain way: HP lost by cause, per Pokémon, and each Pokémon's last HP. */
function tally(log: readonly string[]) {
  const hp = new Map<string, number>();
  const lost = new Map<string, Record<string, number>>();
  const healed = new Map<string, number>();
  const add = (key: string, kind: string, n: number) => {
    const r = lost.get(key) ?? {};
    r[kind] = (r[kind] ?? 0) + n;
    lost.set(key, r);
  };
  for (const line of log) {
    const parts = line.split("|");
    const cmd = parts[1];
    if (cmd === "switch" || cmd === "drag" || cmd === "replace") {
      const key = keyOf(parts[2]);
      const now = hpOf(parts[4]);
      if (hp.has(key) && now > hp.get(key)!) healed.set(key, (healed.get(key) ?? 0) + now - hp.get(key)!);
      hp.set(key, now);
    } else if (cmd === "-damage" || cmd === "-heal" || cmd === "-sethp") {
      const key = keyOf(parts[2]);
      const now = hpOf(parts[3]);
      const delta = (hp.get(key) ?? 100) - now;
      const from = (parts.find((p) => p.startsWith("[from]")) ?? "").replace("[from] ", "").replace(/^(item|ability|move): /, "");
      if (delta > 0) {
        const kind = !from
          ? "direct"
          : /^(Stealth Rock|Spikes)$/.test(from)
            ? "hazard"
            : /^(psn|tox|brn)$/.test(from)
              ? "status"
              : /^(Sandstorm|hail)$/i.test(from)
                ? "weather"
                : /^Recoil$/i.test(from)
                  ? "recoil"
                  : from === "Life Orb"
                    ? "lifeorb"
                    : "other";
        add(key, kind, delta);
      } else if (delta < 0) healed.set(key, (healed.get(key) ?? 0) - delta);
      hp.set(key, now);
    } else if (cmd === "faint") {
      // Fainting with HP left (Explosion, Destiny Bond…): that HP was lost too.
      const key = keyOf(parts[2]);
      if ((hp.get(key) ?? 0) > 0) add(key, "other", hp.get(key)!);
      hp.set(key, 0);
    }
  }
  return { hp, lost, healed };
}

const count = (log: readonly string[], re: RegExp) => log.filter((l) => re.test(l)).length;

const SEEDS: [string, number][] = [
  ["gen9randombattle", 1],
  ["gen9randombattle", 2],
  ["gen9randombattle", 3],
  ["gen9randombattle", 4],
  ["gen9randombattle", 5],
  ["gen9randombattle", 6],
  ["gen8randombattle", 7],
  ["gen4randombattle", 8],
];

describe.each(SEEDS)("a real %s battle (seed %i)", (format, seed) => {
  const battle: SimBattle = simBattle(format, seed);
  const log = battle.spectator;
  const stats = computeStats(log);

  it("is a whole battle", () => {
    expect(log.length).toBeGreaterThan(50);
    expect(stats.turns).toBe(Number([...log].reverse().find((l) => l.startsWith("|turn|"))!.split("|")[2]));
    expect(stats.players).toEqual(["Red", "Blue"]);
    expect(stats.winner).toBe(battle.winner);
    const leads = log.filter((l) => l.startsWith("|switch|")).slice(0, 2);
    expect(stats.leads).toEqual(leads.map((l) => l.split("|")[3].split(",")[0]));
  });

  it("counts every crit and every miss in the log", () => {
    const crits = count(log, /^\|-crit\|/);
    expect(stats.luck[0].critsLanded.observed + stats.luck[1].critsLanded.observed).toBe(crits);
    expect(stats.luck[0].critsLanded.observed).toBe(stats.luck[1].critsReceived.observed);
    expect(stats.luck[0].critsLanded.observed).toBe(count(log, /^\|-crit\|p2/));
    expect(stats.luck[1].critsLanded.observed).toBe(count(log, /^\|-crit\|p1/));
    // A miss against a Pokémon out of reach (Fly, Dig…) was never a roll.
    let charging = new Set<string>();
    let misses = [0, 0];
    for (const line of log) {
      const parts = line.split("|");
      if (parts[1] === "-prepare" && /^(Fly|Bounce|Dig|Dive|Phantom Force|Shadow Force|Sky Drop)$/.test(parts[3])) charging.add(keyOf(parts[2]));
      if (parts[1] === "move") charging.delete(keyOf(parts[2]));
      if (parts[1] === "-miss" && !charging.has(keyOf(parts[3] ?? ""))) misses[parts[2].startsWith("p1") ? 0 : 1] += 1;
    }
    expect(stats.luck[0].missesOwn.observed).toBe(misses[0]);
    expect(stats.luck[1].missesOwn.observed).toBe(misses[1]);
    expect(stats.luck[0].missesFoe.observed).toBe(misses[1]);
    charging = new Set();
    misses = [0, 0];
    // Expected never exceeds chances, and the two sides mirror each other.
    for (const s of [0, 1] as const) {
      const l = stats.luck[s];
      for (const t of [l.critsLanded, l.missesOwn, l.procsLanded]) {
        expect(t.expected).toBeLessThanOrEqual(t.n + 1e-9);
        expect(t.observed).toBeLessThanOrEqual(t.n);
      }
      expect(l.score).toBeCloseTo(-stats.luck[s === 0 ? 1 : 0].score, 1);
    }
  });

  it("counts every faint, and credits each KO to at most one foe", () => {
    const faints = count(log, /^\|faint\|/);
    const revived = count(log, /\[from\] move: Revival Blessing/);
    expect(stats.mons.filter((m) => m.fainted)).toHaveLength(faints - revived);
    const kos = stats.mons.reduce((a, m) => a + m.kos, 0);
    if (!revived) expect(kos).toBe(stats.mons.filter((m) => m.koBy).length);
    expect(kos).toBeLessThanOrEqual(faints);
    for (const m of stats.mons.filter((x) => x.koBy)) expect(m.koBy!.slice(0, 2)).not.toBe(m.key.slice(0, 2));
    const koNotes = stats.notes.flat().filter((x) => x.kind === "ko");
    expect(koNotes).toHaveLength(faints);
    for (const n of koNotes) expect(stats.mons.some((m) => m.species === n.target)).toBe(true);
  });

  it("adds up damage, indirect damage and healing exactly as the log has them", () => {
    const plain = tally(log);
    let dealt = 0;
    let taken = 0;
    for (const m of stats.mons) {
      const lost = plain.lost.get(m.key) ?? {};
      const ind = m.takenIndirect;
      for (const kind of ["hazard", "status", "weather", "recoil", "lifeorb"] as const) expect(ind[kind] ?? 0, `${m.key} ${kind}`).toBeCloseTo(lost[kind] ?? 0, 0);
      expect(m.taken + (ind.other ?? 0), `${m.key} direct`).toBeCloseTo((lost.direct ?? 0) + (lost.other ?? 0), 0);
      expect(m.healed, `${m.key} healed`).toBeCloseTo(plain.healed.get(m.key) ?? 0, 0);
      // Where it ended up: full HP, less everything it lost, plus everything it got back.
      const end = 100 - m.taken - Object.values(ind).reduce((a, b) => a + (b ?? 0), 0) + m.healed;
      expect(end, `${m.key} final HP`).toBeCloseTo(plain.hp.get(m.key) ?? 100, 0);
      dealt += m.dealt;
      taken += m.taken;
    }
    // Every point of direct damage dealt was taken by someone.
    expect(dealt).toBeCloseTo(taken, 0);
  });

  it("knows how many turns each Pokémon spent in battle", () => {
    for (const m of stats.mons) {
      expect(m.turns).toBeGreaterThanOrEqual(0);
      expect(m.turns).toBeLessThanOrEqual(stats.turns);
    }
    const leadMon = stats.mons.find((m) => m.side === 0 && m.species === stats.leads[0])!;
    expect(leadMon.turns).toBeGreaterThanOrEqual(1);
    // In singles, each turn has one Pokémon a side in battle at its start (a turn can count a switch-in too).
    for (const s of [0, 1] as const) expect(stats.mons.filter((m) => m.side === s).reduce((a, m) => a + m.turns, 0)).toBeGreaterThanOrEqual(stats.turns);
  });

  it("notes every flinch it calls luck against a flinch in the log", () => {
    for (const e of stats.luckEvents.filter((x) => /flinch/.test(x.text))) {
      expect(stats.notes[e.turn].some((n) => n.kind === "flinch")).toBe(true);
    }
    const flinches = stats.luckEvents.filter((x) => /flinch/.test(x.text)).length;
    expect(flinches).toBeLessThanOrEqual(count(log, /^\|cant\|.*\|flinch$/));
  });
});

describe("damage rolls against the simulator's exact HP", () => {
  // The omniscient channel has each Pokémon's exact HP: the bar's rounding, and the roll that was dealt.
  const battles = [1, 2, 3, 4, 5].map((n) => simBattle("gen9randombattle", n));

  it("draws the HP bar exactly as the simulator does, and finds the real damage among the rolls that fit it", () => {
    let checked = 0;
    for (const b of battles) {
      const exact = new Map<string, { hp: number; max: number }>();
      b.omniscient.forEach((line, i) => {
        const parts = line.split("|");
        if (!/^(switch|drag|replace|-damage|-heal|-sethp)$/.test(parts[1] ?? "")) return;
        const cond = parts[1].startsWith("-") ? parts[3] : parts[4];
        if (!cond || cond.startsWith("0")) return;
        const [hp, max] = cond.split(" ")[0].split("/").map(Number);
        const key = keyOf(parts[2]);
        const prev = exact.get(key);
        exact.set(key, { hp, max });
        const shown = b.spectator[i].split("|")[parts[1].startsWith("-") ? 3 : 4].split(" ")[0];
        expect(`${shownPercent(hp, max)}/100`).toBe(shown);
        if (parts[1] === "-damage" && !line.includes("[from]") && prev && prev.hp > hp) {
          const d = prev.hp - hp;
          const rolls = Array.from({ length: 16 }, (_, k) => d - 7 + k);
          expect(consistentRolls(rolls, max, shownPercent(prev.hp, max), shownPercent(hp, max))).toContain(7);
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("with the real sets, the damage calc explains nearly every plain hit", () => {
    const calc = { gen: gens.get(9), lib };
    let placed = 0;
    let tried = 0;
    for (const b of battles) {
      const sets = new Map<string, AssumedSet>();
      b.teams.forEach((team, s) => {
        for (const set of team as unknown as { name: string; species: string }[]) {
          sets.set(`p${s + 1}: ${set.name || set.species}`, { key: `p${s + 1}: ${set.name}`, set: completeSet(set as never), source: "random", revealedMoves: 4 });
        }
      });
      const place = rollPlacer(calc, sets);
      const results: (number | null)[] = [];
      computeStats(b.spectator, {
        placeRoll: (c: RollCandidate) => {
          const r = place(c);
          results.push(r);
          return r;
        },
      });
      tried += results.length;
      placed += results.filter((r) => r !== null).length;
      for (const r of results.filter((x): x is number => x !== null)) expect(r >= 0 && r <= 1).toBe(true);
    }
    expect(tried).toBeGreaterThan(30);
    // The rest: hits the bar can't place (most rolls fit), or field effects the calc wasn't told about.
    expect(placed / tried).toBeGreaterThan(0.5);
  });
});

describe("the server's stats for a replay", () => {
  it("fills in max HP and places rolls from the assumed sets", async () => {
    const b = simBattle("gen9randombattle", 2);
    const stats = await computeBattleStats({ format: "gen9randombattle", log: b.spectator });
    expect(stats.mons.some((m) => m.maxHp && m.maxHp > 100)).toBe(true);
    expect(stats.rolls.placed + stats.rolls.unplaced).toBeGreaterThan(0);
    const real = computeStats(b.spectator);
    // Rolls aside, the counts don't depend on the sets.
    expect(stats.luck[0].critsLanded.observed).toBe(real.luck[0].critsLanded.observed);
    expect(stats.mons.map((m) => m.dealt)).toEqual(real.mons.map((m) => m.dealt));
  });
});

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

describe("turning points, luck and the share card", () => {
  const pt = (turn: number, p: number, n = 200): WinPoint => ({ turn, n, p, lo: p, hi: p });
  const base: BattleStats = computeStats(simBattle("gen9randombattle", 1).spectator);
  const withNotes = (notes: Record<number, TurnNote[]>): BattleStats => ({ ...base, notes: base.notes.map((n, t) => notes[t] ?? n.filter((x) => x.kind === "move")) });

  it("names a logged cause for a swing, from the side it helped", () => {
    const notes: TurnNote[] = [
      { kind: "move", side: 0, mon: "Heatran", move: "Magma Storm", target: "Garchomp" },
      { kind: "move", side: 1, mon: "Garchomp", move: "Earthquake", target: "Heatran" },
      { kind: "crit", side: 1, mon: "Garchomp", move: "Earthquake", target: "Heatran", chance: 1 / 24 },
      { kind: "ko", side: 1, mon: "Garchomp", target: "Heatran" },
    ];
    expect(causeOf(notes, 1)?.kind).toBe("crit");
    expect(causeOf(notes, 0)).toBeNull();
    const stats = withNotes({ 7: notes });
    const [tp] = turningPoints([pt(7, 0.62), pt(8, 0.31), pt(9, 0.3)], stats, 0);
    expect(tp.text).toBe("Blue's Garchomp knocking out your Heatran with a critical Earthquake on turn 7 dropped your odds from 62% to 31%.");
    expect(tp.caused).toBe(true);
  });

  it("says plainly what happened when the log shows no cause", () => {
    const notes: TurnNote[] = [
      { kind: "move", side: 0, mon: "Heatran", move: "Earth Power", target: "Garchomp" },
      { kind: "switch", side: 1, mon: "Corviknight" },
      { kind: "crit", side: 0, mon: "Heatran", move: "Earth Power", target: "Corviknight", chance: 1 / 24 },
    ];
    const stats = withNotes({ 3: notes });
    // The swing went against Red; Red's own crit can't be why.
    const [tp] = turningPoints([pt(3, 0.6), pt(4, 0.35), pt(5, 0.35)], stats, 0);
    expect(tp.caused).toBe(false);
    expect(tp.text).toBe("On turn 3 you used Earth Power and Blue switched to Corviknight: nothing went against the odds, but it dropped your odds from 60% to 35%.");
  });

  it("explains misses with their odds and a battle's last turn with its result", () => {
    const notes: TurnNote[] = [{ kind: "miss", side: 1, mon: "Garchomp", move: "Stone Edge", target: "Heatran", chance: 0.2 }];
    const stats = withNotes({ 9: notes });
    const [tp] = turningPoints([pt(9, 0.45), pt(10, 1, 0)], stats, 0);
    expect(tp.text).toBe("Blue's Garchomp missing Stone Edge (80% to hit) on turn 9 took your odds from 45% to the win.");
    expect(tp.ended).toBe(true);
  });

  it("keeps at most three turning points, and none inside the noise", () => {
    const pts = [pt(1, 0.5), pt(2, 0.3), pt(3, 0.6), pt(4, 0.2), pt(5, 0.7), pt(6, 0.71), pt(7, 1, 0)];
    expect(turningPoints(pts, base, 0)).toHaveLength(3);
    expect(turningPoints([pt(1, 0.5, 30), pt(2, 0.52, 30)], base, 0)).toHaveLength(0);
  });

  it("gives a luck verdict, an MVP and a share card", () => {
    const l = base.luck[0];
    expect(signed(2.14)).toBe("+2.1");
    expect(signed(-0.96)).toBe("−1.0");
    expect(signed(0.01)).toBe("0.0");
    expect(luckVerdict({ ...l, score: 0.2, sd: 2 }).tone).toBe("even");
    expect(luckVerdict({ ...l, score: -2.5, sd: 1.5 }).label).toBe("Much unluckier than expected");
    const mvp = mvpOf(base.mons, 0)!;
    expect(mvp.side).toBe(0);
    for (const m of base.mons.filter((x) => x.side === 0)) expect(m.dealt + m.dealtIndirect + 30 * m.kos).toBeLessThanOrEqual(mvp.dealt + mvp.dealtIndirect + 30 * mvp.kos);
    const lost: BattleStats = { ...base, winner: 1, luck: [{ ...l, score: -2.1, critsReceived: { ...l.critsReceived, observed: 3 } }, base.luck[1]] };
    expect(shareHeadline(lost, 0)).toBe("Lost to 3 crits 😤");
    const text = shareText(lost, 0, { formatName: "[Gen 9] Random Battle", url: "https://pokeiq.test/battle/replay/abc" });
    expect(text.split("\n")[1]).toBe(`Lost to 3 crits 😤 · Luck −2.1 · MVP ${mvpOf(lost.mons, 0)!.species}`);
    expect(text).toContain("vs Blue · [Gen 9] Random Battle");
    expect(text.endsWith("https://pokeiq.test/battle/replay/abc")).toBe(true);
  });
});
