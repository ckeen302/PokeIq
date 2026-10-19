import { describe, expect, it } from "vitest";
import { Battle } from "@pkmn/sim";
import { SimSession, randomTeam, replay, type SideID, type SimResult, type SimSnapshot } from "@/lib/server/battle-engine/engine";
import { firstChoice, randomChoice } from "@/lib/server/battle-engine/choices";
import { chooseCpu, seededRandom } from "@/lib/server/battle-engine/cpu";
import { cpuTeam, prepareTeam } from "@/lib/server/battle-engine/teams";
import type { BattleRequest, CpuLevel } from "@/lib/battle/play";

const SEED = "1,2,3,4";

function start(formatid: string, seed = SEED, teams?: [string, string]) {
  return SimSession.create({
    formatid,
    seed,
    p1: { name: "Red", team: teams?.[0] ?? randomTeam(formatid, "11,12,13,14") },
    p2: { name: "Blue", team: teams?.[1] ?? randomTeam(formatid, "21,22,23,24") },
  });
}

/** The database round trip: everything is JSON text in between requests. */
const roundTrip = (s: SimSnapshot): SimSnapshot => JSON.parse(JSON.stringify(s));

/** Plays until the end (or `turns`), restoring from the snapshot before every choice. */
function play(formatid: string, turns: number, pick: (req: BattleRequest, side: SideID, session: SimSession) => string) {
  let session = start(formatid);
  let snap: SimResult = session.result();
  const lines = { p1: [] as string[], p2: [] as string[], spectator: [] as string[] };
  const choices: [SideID, string][] = [];
  for (let i = 0; i < turns * 3 && !session.ended && session.turn <= turns; i++) {
    session = SimSession.restore(roundTrip(snap));
    for (const side of ["p1", "p2"] as SideID[]) {
      const req = session.pending(side);
      if (!req) continue;
      const choice = pick(req, side, session);
      const out = session.choose(side, choice);
      expect(out, `${side} ${choice}`).toEqual({ ok: true });
      choices.push([side, choice]);
    }
    const res = session.result();
    for (const ch of ["p1", "p2", "spectator"] as const) lines[ch].push(...res.lines[ch]);
    snap = res;
  }
  return { session, snap, lines, choices };
}

describe("battle engine", () => {
  it("creates, takes choices and resumes from a JSON snapshot", () => {
    const first = start("gen9randombattle");
    const created = first.result();
    expect(created.turn).toBe(1);
    expect(first.pending("p1")?.active?.[0].moves.length).toBeGreaterThan(0);
    expect(created.lines.p1.some((l) => l.startsWith("|switch|p1a:"))).toBe(true);
    expect(created.lines.p1.some((l) => l.startsWith("|t:|"))).toBe(false);

    const { session, snap } = play("gen9randombattle", 12, (req) => firstChoice(req, false));
    expect(snap.turn).toBeGreaterThan(5);
    expect(SimSession.restore(roundTrip(snap)).turn).toBe(session.turn);
  });

  it("resuming the snapshot equals rebuilding from the input log", () => {
    for (const formatid of ["gen9randombattle", "gen9randomdoublesbattle"]) {
      const rand = seededRandom(formatid);
      const { snap } = play(formatid, 10, (req) => randomChoice(req, formatid.includes("doubles"), rand));
      const fromSnapshot = Battle.fromJSON(snap.state);
      // Rebuilt from the input log (plus any choice made for a turn that hasn't run yet).
      const fromLog = SimSession.restore({ ...snap, simVersion: "0.0.0-older" }).battle;
      expect(replay(snap.inputLog).turn).toBe(fromSnapshot.turn);
      expect(fromLog.turn).toBe(fromSnapshot.turn);
      // Bookkeeping aside (timestamps, whether requests and the end were sent), the rebuilt
      // battle is the same battle: same PRNG state, sides, choices, field and log.
      const strip = (b: Battle) => {
        const json = b.toJSON() as Record<string, unknown> & { sides: Record<string, unknown>[] };
        return JSON.stringify({
          ...json,
          sentRequests: null,
          sentEnd: null,
          log: b.log.filter((l) => !l.startsWith("|t:|")),
        });
      };
      expect(JSON.parse(strip(fromLog))).toEqual(JSON.parse(strip(fromSnapshot)));

      // Both go on identically with the same choices.
      const a = SimSession.restore(snap);
      const b = SimSession.restore({ ...snap, simVersion: "0.0.0-older" }); // another engine version: rebuilt from the log
      for (let i = 0; i < 6 && !a.ended; i++) {
        for (const side of ["p1", "p2"] as SideID[]) {
          const req = a.pending(side);
          if (!req) continue;
          const choice = firstChoice(req, formatid.includes("doubles"));
          expect(a.choose(side, choice).ok).toBe(true);
          expect(b.choose(side, choice), `${formatid} ${side} ${choice} turn ${b.turn}/${a.turn}`).toEqual({ ok: true });
        }
      }
      expect(b.result().lines).toEqual(a.result().lines);
      expect(b.turn).toBe(a.turn);
    }
  });

  it("never shows a player what the other side hasn't revealed", () => {
    const { lines, snap } = play("gen9randombattle", 30, (req) => firstChoice(req, false));
    expect(lines.p1.length).toBeGreaterThan(20);
    for (const ch of ["p1", "p2", "spectator"] as const) {
      expect(lines[ch].some((l) => l.startsWith("|request|") || l.startsWith("|split|") || l.startsWith("|debug|"))).toBe(false);
    }
    // Everything p2 learns about p1 is public: the same line went to spectators.
    const spectator = new Set(lines.spectator);
    const aboutP1 = lines.p2.filter((l) => /\|p1[a-d]?: /.test(l));
    expect(aboutP1.length).toBeGreaterThan(5);
    for (const line of aboutP1) expect(spectator.has(line), line).toBe(true);
    // p1's HP only ever reaches p2 as a percentage; p1 sees its own exactly.
    const hp = (l: string) => /\|p1a: [^|]+\|(?:[^|]+\|)?(\d+)\/(\d+)/.exec(l);
    expect(lines.p2.filter((l) => /^\|(-damage|-heal|switch|drag)\|p1a/.test(l)).every((l) => !hp(l) || hp(l)![2] === "100")).toBe(true);
    expect(lines.p1.some((l) => /^\|switch\|p1a/.test(l) && hp(l) && hp(l)![2] !== "100")).toBe(true);
    // p1's moves appear in p2's channel only once p1 has used them.
    const battle = Battle.fromJSON(snap.state);
    for (const mon of battle.p1.pokemon) {
      for (const slot of mon.moveSlots) {
        const mention = lines.p2.findIndex((l) => l.includes(`|${slot.move}`) && l.includes(`p1a: ${mon.name}`));
        const used = lines.p2.findIndex((l) => l.startsWith(`|move|p1a: ${mon.name}|${slot.move}`));
        if (mention >= 0) expect(used, `${mon.name} ${slot.move}`).toBeGreaterThanOrEqual(0);
        if (mention >= 0) expect(used).toBeLessThanOrEqual(mention);
      }
    }
  });

  it("team preview shows species only", () => {
    const team = cpuTeam("gen9ou", "5,6,7,8");
    const session = start("gen9ou", SEED, [cpuTeam("gen9ou", "1,1,1,1"), team]);
    const res = session.result();
    const preview = res.lines.p1.filter((l) => l.startsWith("|poke|p2|"));
    expect(preview).toHaveLength(6);
    const sets = Battle.fromJSON(res.state).p2.pokemon;
    for (const mon of sets) {
      expect(res.lines.p1.join("\n")).not.toContain(mon.getItem().name || "\u0000none");
      for (const slot of mon.moveSlots) expect(res.lines.p1.join("\n")).not.toContain(slot.move);
    }
    expect(session.pending("p1")?.teamPreview).toBe(true);
  });

  it("the computer's choices are always legal, singles and doubles, every level", () => {
    const levels: CpuLevel[] = ["easy", "normal", "hard"];
    let decisions = 0;
    for (const formatid of ["gen9randombattle", "gen9randomdoublesbattle", "gen9ou", "gen9doublesou"] as const) {
      for (let game = 0; game < 4; game++) {
        const ou = !formatid.includes("random");
        const teams: [string, string] | undefined = ou ? [cpuTeam(formatid, `${game},1,2,3`), cpuTeam(formatid, `${game},4,5,6`)] : undefined;
        const session = SimSession.create({
          formatid,
          seed: `${game + 1},9,9,9`,
          p1: { name: "Red", team: teams?.[0] ?? randomTeam(formatid, `${game},1,1,1`) },
          p2: { name: "Blue", team: teams?.[1] ?? randomTeam(formatid, `${game},2,2,2`) },
        });
        for (let i = 0; i < 400 && !session.ended; i++) {
          let moved = false;
          for (const side of ["p1", "p2"] as SideID[]) {
            if (!session.pending(side)) continue;
            const level = levels[(game + (side === "p1" ? 0 : 1)) % 3];
            const choice = chooseCpu(session.battle, session.battle[side], level, seededRandom(`${game}:${i}:${side}`));
            const out = session.choose(side, choice);
            expect(out, `${formatid} ${side} ${level}: "${choice}"`).toEqual({ ok: true });
            decisions++;
            moved = true;
          }
          if (!moved) break;
        }
        expect(session.ended || session.turn > 50).toBe(true);
      }
    }
    expect(decisions).toBeGreaterThan(200);
  });

  it("random choices are legal too (the timer's fallback)", () => {
    const rand = seededRandom("fuzz");
    for (const formatid of ["gen9randombattle", "gen9randomdoublesbattle"]) {
      const { session } = play(formatid, 60, (req) => randomChoice(req, formatid.includes("doubles"), rand));
      expect(session.turn).toBeGreaterThan(3);
    }
  });

  it("validates a pasted team for OU", () => {
    const team = `Gholdengo @ Choice Specs
Ability: Good as Gold
Tera Type: Steel
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
IVs: 0 Atk
- Make It Rain
- Shadow Ball
- Focus Blast
- Trick

Great Tusk @ Booster Energy
Ability: Protosynthesis
Tera Type: Ground
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off`;
    const ok = prepareTeam("gen9ou", team);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.size).toBe(2);
    const bad = prepareTeam("gen9ou", team.replace("- Knock Off", "- Spore"));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/Spore/);
    expect(prepareTeam("gen9ou", "hello there").ok).toBe(false);
    expect(prepareTeam("gen9randombattle", team).ok).toBe(false);
  });

  it("forfeits end the battle with the right winner", () => {
    const session = start("gen9randombattle");
    session.lose("p1");
    const res = session.result();
    expect(res.ended).toBe(true);
    expect(res.winner).toBe("p2");
    expect(res.inputLog.at(-1)).toBe(">forcelose p1");
    expect(replay(res.inputLog).ended).toBe(true);
  });
});
