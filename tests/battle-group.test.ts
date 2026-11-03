import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Battle, Teams } from "pokemon-showdown";
import { canShift, firstChoice, forcedSwitchSlots, moveSlotOptions, moveTargets, randomChoice, targetSpots } from "@/lib/battle/choices";
import { fillPasses, slotPasses } from "@/components/battle/play/choice";
import { chooseCpu } from "@/lib/battle/cpu-policy";
import { seededRandom } from "@/lib/battle/cpu-policy";
import { SimSession, randomTeam, sideOf, type PlayerSide } from "@/lib/server/battle-engine/engine";
import { catalogueTeam } from "@/lib/server/battle-engine/custom";
import { columnLines, columnText, loadBattle } from "@/lib/server/battle-engine/store";
import { actOnBattle, battleToken, createCpuBattle, createLiveBattle, createMatchedBattle, pollBattle, readBattleToken, rematchBattle } from "@/lib/server/battle-engine/service";
import { settleBattle } from "@/lib/server/battle-engine/settle";
import { packPlayers, replayStore, standingsFromLog, unpackPlayers } from "@/lib/server/battle-engine/replays";
import { listWatchable } from "@/lib/server/battle-engine/watch";
import { replayResult, replayTitle } from "@/lib/battle/replay";
import { BattleModel } from "@/components/battle/play/model";
import type { BattleRequest, BattleView, GameType } from "@/lib/battle/play";

/**
 * Triples, Free-For-All and Multi Battles: Showdown's own targeting and
 * shifting, forced switches with passes, the computer's choices over many
 * self-played battles, and four-trainer battles through the battle service
 * (against the computer, and a live room with four seats).
 */

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const team = (formatid: string) => (formatid === "gen9triples" ? Teams.pack(catalogueTeam(formatid)) : randomTeam(formatid));
const players = (formatid: string, n: number) => Array.from({ length: n }, (_, i) => ({ name: `Trainer ${"ABCD"[i]}`, team: team(formatid) }));

describe("targets, as Showdown's simulator judges them", () => {
  const TYPES = ["normal", "any", "adjacentAlly", "adjacentAllyOrSelf", "adjacentFoe"];

  function check(formatid: string, gameType: GameType, sides: number) {
    const battle = new Battle({ formatid: formatid as never, seed: [1, 2, 3, 4] as never });
    players(formatid, sides).forEach((p, i) => battle.setPlayer(sideOf(i) as "p1", p));
    if (battle.requestState === "teampreview") for (let i = 0; i < sides; i++) battle.choose(sideOf(i) as "p1", "default");
    let checked = 0;
    for (const side of battle.sides) {
      side.active.forEach((mon, slot) => {
        for (const type of TYPES) {
          const spots = targetSpots(type, slot, gameType, side.n);
          const per = gameType === "triples" ? 3 : 2;
          expect(spots.map((s) => s.loc).sort()).toEqual([...Array.from({ length: per }, (_, i) => i + 1), ...Array.from({ length: per }, (_, i) => -(i + 1))].sort());
          for (const spot of spots) {
            expect(spot.legal, `${formatid} ${side.id} slot ${slot} ${type} ${spot.loc}`).toBe(battle.validTargetLoc(spot.loc, mon, type as never));
            checked++;
          }
          // Self, foe and ally, as the simulator places them.
          const self = spots.find((s) => s.self)!;
          expect(self.loc).toBe(mon.getLocOf(mon));
          for (const spot of spots.filter((s) => !s.self)) {
            const at = mon.getAtLoc(spot.loc);
            if (at) expect(spot.foe, `${side.id} → ${spot.loc}`).toBe(gameType === "freeforall" ? true : !side.hasAlly(at));
          }
        }
      });
    }
    return checked;
  }

  it("in triples, single-target moves reach only adjacent Pokémon", () => {
    expect(check("gen9triples", "triples", 2)).toBeGreaterThan(100);
    // From the left edge: the foe across and the centre one, never the far edge; the centre reaches all three.
    expect(moveTargets("normal", 0, "triples")).toEqual([2, 3]);
    expect(moveTargets("normal", 1, "triples")).toEqual([1, 2, 3]);
    expect(moveTargets("normal", 2, "triples")).toEqual([1, 2]);
    expect(moveTargets("any", 0, "triples")).toEqual([1, 2, 3]);
    expect(moveTargets("adjacentAlly", 1, "triples")).toEqual([-1, -3]);
    expect(moveTargets("adjacentAllyOrSelf", 0, "triples")).toEqual([-1, -2]);
  });

  it("in a Free-For-All every other trainer is a foe; in a Multi Battle the partner is an ally", () => {
    expect(check("gen9freeforallrandombattle", "freeforall", 4)).toBeGreaterThan(50);
    expect(check("gen9multirandombattle", "multi", 4)).toBeGreaterThan(50);
    // p1 and p3: the other half's two, and the other trainer on its own half.
    expect(moveTargets("normal", 0, "freeforall", 0)).toEqual([1, 2, -2]);
    expect(moveTargets("normal", 0, "freeforall", 2)).toEqual([1, 2, -1]);
    expect(moveTargets("normal", 0, "multi", 2)).toEqual([1, 2]);
    expect(moveTargets("adjacentAlly", 0, "multi", 2)).toEqual([-1]);
  });

  it("keeps doubles exactly as before", () => {
    expect(moveTargets("normal", 0, true)).toEqual([1, 2]);
    expect(moveTargets("adjacentAlly", 0, true)).toEqual([-2]);
    expect(moveTargets("adjacentAllyOrSelf", 1, true)).toEqual([-2, -1]);
    expect(moveTargets("normal", 0, false)).toEqual([0]);
    expect(targetSpots("normal", 0, "singles")).toEqual([]);
  });
});

describe("triples: shifting and forced switches", () => {
  it("lets an edge Pokémon shift to the centre, never the centre one", () => {
    // Fixed teams with plain attacks, so nothing drags, ejects or pivots the shifter out first and the turn is the same every run.
    const plain = Teams.pack(Teams.import(["Snorlax", "Blissey", "Chansey", "Slaking", "Wigglytuff", "Audino"].map((s) => `${s}\nLevel: 50\nAbility: ${s === "Slaking" ? "Truant" : s === "Snorlax" ? "Thick Fat" : s === "Audino" ? "Healer" : s === "Wigglytuff" ? "Competitive" : "Natural Cure"}\n- Tackle\n- Protect`).join("\n\n"))!);
    const session = SimSession.create({ formatid: "gen9triples", seed: "5,6,7,8", players: [{ name: "Trainer A", team: plain }, { name: "Trainer B", team: plain }] });
    for (const side of ["p1", "p2"] as const) session.choose(side, "default");
    const request = session.pending("p1")!;
    expect(request.active).toHaveLength(3);
    expect(canShift(request, 0, "triples")).toBe(true);
    expect(canShift(request, 1, "triples")).toBe(false);
    expect(canShift(request, 2, "triples")).toBe(true);
    expect(moveSlotOptions(request, 0, "triples").some((o) => o.kind === "shift")).toBe(true);
    expect(moveSlotOptions(request, 1, "triples").some((o) => o.kind === "shift")).toBe(false);
    expect(canShift(request, 0, "doubles")).toBe(false);
    const left = session.battle.p1.active[0].name;
    const centre = session.battle.p1.active[1].name;
    const move = (slot: number) => moveSlotOptions(request, slot, "triples").find((o) => o.kind === "move" && !o.tera)!.text;
    expect(session.choose("p1", `shift, ${move(1)}, ${move(2)}`)).toEqual({ ok: true });
    expect(session.choose("p2", firstChoice(session.pending("p2")!, "triples"))).toEqual({ ok: true });
    const lines = session.result().lines.spectator;
    // The swap plays out unless the one shifting (or the one in the centre) fainted first.
    const fainted = lines.some((l) => /^\|faint\|p1[ab]:/.test(l));
    expect(lines.some((l) => l.startsWith("|swap|p1")) || fainted).toBe(true);
    // Swapped (unless one of them fainted that turn).
    const now = session.battle.p1.active.map((p) => p.name);
    if (!session.battle.p1.active[0].fainted && !session.battle.p1.active[1].fainted) {
      expect(now[1]).toBe(left);
      expect(now[0]).toBe(centre);
    }
  });

  it("passes the spots it has nobody left to fill", () => {
    const mon = (i: number, active: boolean, fainted: boolean) => ({ ident: `p1: Mon${i}`, details: "Pikachu, L50", condition: fainted ? "0 fnt" : "100/100", active, stats: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, moves: [], baseAbility: "", item: "", pokeball: "" });
    // Three down at once with one left on the bench: one comes in, the other two spots stay empty.
    const request = { forceSwitch: [true, true, true], side: { name: "A", id: "p1", pokemon: [mon(1, true, true), mon(2, true, true), mon(3, true, true), mon(4, false, false), mon(5, false, true), mon(6, false, true)] } } as unknown as BattleRequest;
    expect(forcedSwitchSlots(request).map((s) => s.pool)).toEqual([[4], [4], [4]]);
    expect(randomChoice(request, "triples", () => 0)).toBe("switch 4, pass, pass");
    expect(fillPasses(request, ["switch 4"])).toEqual(["switch 4", "pass", "pass"]);
    // Only the middle one asked to switch.
    const one = { ...request, forceSwitch: [false, true, false] } as BattleRequest;
    expect(fillPasses(one, [])).toEqual(["pass"]);
    expect(slotPasses(one, 1, ["pass"])).toBe(false);
  });
});

describe("the computer in triples, Free-For-All and Multi Battles", () => {
  for (const [formatid, n, games] of [
    ["gen9triples", 2, 6],
    ["gen9freeforallrandombattle", 4, 5],
    ["gen9multirandombattle", 4, 8],
  ] as const) {
    it(`only ever makes legal choices (${formatid}, self-play)`, { timeout: 240_000 }, () => {
      const levels = ["easy", "normal", "hard"] as const;
      let decisions = 0;
      let finished = 0;
      for (let game = 0; game < games; game++) {
        const session = SimSession.create({ formatid, seed: `${game + 11},${n},3,9`, players: players(formatid, n) });
        const errors: unknown[] = [];
        for (let i = 0; i < 1500 && !session.ended; i++) {
          let moved = false;
          for (let seat = 0; seat < n; seat++) {
            const side = sideOf(seat) as PlayerSide;
            if (!session.pending(side)) continue;
            const level = levels[(game + seat) % 3];
            const pick = () => chooseCpu(session.battle as never, session.side(side) as never, level, seededRandom(`${game}:${i}:${side}`), (err) => errors.push(err));
            const choice = pick();
            const out = session.choose(side, choice);
            if (!out.ok) {
              // Only what the request couldn't show: a trap or a disabled move the simulator reveals on a refused choice (Showdown's maybeTrapped / maybeDisabled). The updated request's choice must then be legal.
              expect(out.error, `${formatid} ${side} ${level}: "${choice}"`).toMatch(/trapped|disabled/i);
              const again = pick();
              expect(session.choose(side, again), `${formatid} ${side} ${level} (retry): "${again}"`).toEqual({ ok: true });
            }
            decisions++;
            moved = true;
          }
          if (!moved) break;
        }
        expect(errors).toEqual([]);
        if (session.ended) finished++;
        const res = session.result();
        if (session.ended && res.winners.length) expect(res.winners.length).toBe(formatid === "gen9multirandombattle" ? 2 : 1);
      }
      expect(finished).toBe(games);
      expect(decisions).toBeGreaterThan(games * 10);
    });
  }
});

describe("four channels in the store's two columns", () => {
  it("keeps p1's and p3's lines apart in one column", () => {
    for (const [a, b] of [
      [["|a", "|b"], ["|c"]],
      [[], ["|c", "|d"]],
      [["|a"], []],
      [[], []],
    ] as [string[], string[]][]) {
      const [x, y] = columnLines(columnText(a, b));
      expect(x).toEqual(a);
      expect(y).toEqual(b);
    }
  });

  it("packs a four-player replay into two names and reads it back", () => {
    const ffa = { players: ["Red", "Blue", "Gold", "Silver"], gameType: "freeforall" as const, winner: 2 };
    const packed = packPlayers(ffa);
    expect(packed.players).toHaveLength(2);
    expect(packed.winner).toBeNull();
    expect(unpackPlayers(packed.players, packed.winner)).toMatchObject({ players: ffa.players, gameType: "freeforall", winner: 2, winners: [2] });
    const multi = { players: ["Red", "Blue", "Gold", "Silver"], gameType: "multi" as const, winner: 1 };
    const back = unpackPlayers(packPlayers(multi).players, packPlayers(multi).winner);
    expect(back).toMatchObject({ players: multi.players, gameType: "multi", winner: 1, winners: [1, 3] });
    expect(replayResult(back)).toBe("Blue & Silver beat Red & Gold");
    expect(replayTitle(back)).toBe("Red & Gold vs Blue & Silver");
    expect(unpackPlayers(["Red", "Blue"], 1)).toEqual({ players: ["Red", "Blue"], winner: 1 });
  });
});

// ---------------------------------------------------------------------------
// Through the battle service
// ---------------------------------------------------------------------------

const T0 = Date.UTC(2026, 10, 3, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

async function poll(code: string, token: string | null, since = 0): Promise<BattleView> {
  const out = await pollBattle(code, token, since);
  if (!out.ok) throw new Error(`${out.status} ${out.error}`);
  return out.view;
}

async function act(code: string, token: string, choice: (view: BattleView) => string | null) {
  const view = await poll(code, token);
  if (!view.request) return view;
  const pick = choice(view);
  if (!pick) return view;
  const seat = readBattleToken(token, code)!;
  const out = await actOnBattle(code, seat.playerId, { action: "choose", rqid: view.request.rqid, choice: pick }, 0);
  if (!out.ok) throw new Error(`${out.status} ${out.error}`);
  expect(out.rejected, `"${pick}"`).toBeUndefined();
  return out.view;
}

const geometryOf = (view: BattleView) => view.gameType ?? "singles";

describe("four trainers against the computer", () => {
  it("a Free-For-All: three computer trainers, played to the end with knock-outs and final standings", { timeout: 180_000 }, async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9freeforallrandombattle", level: "normal" });
    if (!made.ok) throw new Error(made.error);
    expect(made.view.gameType).toBe("freeforall");
    expect(made.view.players.map((p) => p.name)).toEqual(["Red", "CPU", "CPU 2", "CPU 3"]);
    expect(made.view.players.slice(1).every((p) => p.cpu)).toBe(true);
    expect(made.view.you).toBe(0);
    expect(made.view.request?.data.side.id).toBe("p1");
    let view = made.view;
    for (let i = 0; i < 400 && view.status === "playing"; i++) view = await act(made.code, made.token, (v) => randomChoice(v.request!.data, geometryOf(v), seededRandom(`ffa:${i}`)));
    view = await poll(made.code, made.token);
    expect(view.status).toBe("finished");
    const end = view.end!;
    expect(end.standings).toHaveLength(4);
    expect(new Set(end.standings)).toEqual(new Set([0, 1, 2, 3]));
    expect(end.standings![0]).toBe(end.winner);
    expect(end.winners).toEqual([end.winner]);
    // Everyone but the winner went out, on a turn.
    for (const s of end.standings!.slice(1)) expect(view.players[s].out).toBeGreaterThanOrEqual(0);
    // Your channel and the protocol knew all four trainers.
    expect(view.log.lines.filter((l) => /^\|player\|p[1-4]\|/.test(l))).toHaveLength(4);
  });

  it("a Multi Battle: a computer partner (p3) beside you, two computer foes; the winning team is both partners", { timeout: 180_000 }, async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9multirandombattle", level: "hard" });
    if (!made.ok) throw new Error(made.error);
    expect(made.view.gameType).toBe("multi");
    let view = made.view;
    for (let i = 0; i < 300 && view.status === "playing"; i++) view = await act(made.code, made.token, (v) => firstChoice(v.request!.data, geometryOf(v)));
    view = await poll(made.code, made.token);
    expect(view.status).toBe("finished");
    const winners = view.end!.winners!;
    expect(winners).toHaveLength(2);
    expect(winners[1] - winners[0]).toBe(2);
    expect(view.end!.winner).toBe(winners[0]);
    expect(view.end!.standings).toBeUndefined();
    // The model splits the half between you and your partner.
    const model = new BattleModel("p1");
    for (const line of view.log.lines) model.feed(line);
    const snap = model.snapshot();
    expect(snap.gameType).toBe("multi");
    expect(snap.sides.p3.name).toBe("CPU 2");
    expect(snap.sides.p1.team.every((m) => m.owner === "p1")).toBe(true);
  });

  it("triples against the computer: three Pokémon out a side, played to the end", { timeout: 180_000 }, async () => {
    const quick = Teams.export(catalogueTeam("gen9triples"));
    const made = await createCpuBattle({ name: "Red", format: "gen9triples", level: "normal", team: quick });
    if (!made.ok) throw new Error(made.error);
    expect(made.view.gameType).toBe("triples");
    let view = made.view;
    for (let i = 0; i < 300 && view.status === "playing"; i++)
      view = await act(made.code, made.token, (v) => (v.request!.data.teamPreview ? "team 123456" : randomChoice(v.request!.data, "triples", seededRandom(`t:${i}`))));
    view = await poll(made.code, made.token);
    expect(view.status).toBe("finished");
    expect([0, 1]).toContain(view.end!.winner);
    expect(view.end!.standings).toBeUndefined();
  });
});

describe("a live four-player room", () => {
  it("seats four (two by link, the computer in the rest), plays, eliminates a forfeit, lets a spectator watch, saves the replay", { timeout: 240_000 }, async () => {
    const made = await createLiveBattle({ name: "Red", format: "gen9freeforallrandombattle", public: true, timer: false }, Date.now());
    if (!made.ok) throw new Error(made.error);
    const code = made.code;
    expect(made.view.gameType).toBe("freeforall");
    const blue = await actOnBattle(code, null, { action: "join", name: "Blue" }, 0);
    if (!blue.ok) throw new Error(blue.error);
    expect(blue.view.you).toBe(1);
    const gold = await actOnBattle(code, null, { action: "join", name: "Gold" }, 0);
    if (!gold.ok) throw new Error(gold.error);
    expect(gold.view.you).toBe(2);
    // A fifth wouldn't fit once the computer is in; a name already there is refused.
    expect((await actOnBattle(code, null, { action: "join", name: "Blue" }, 0)).ok).toBe(false);
    const red = readBattleToken(made.token, code)!;
    // Only the host fills, and the battle waits for every trainer to be ready.
    expect((await actOnBattle(code, blue.playerId, { action: "fill" }, 0)).ok).toBe(false);
    for (const id of [blue.playerId, gold.playerId]) expect((await actOnBattle(code, id, { action: "ready", ready: true }, 0)).ok).toBe(true);
    const filled = await actOnBattle(code, red.playerId, { action: "fill", level: "easy" }, 0);
    if (!filled.ok) throw new Error(filled.error);
    expect(filled.view.status).toBe("playing");
    expect(filled.view.players.map((p) => p.name)).toEqual(["Red", "Blue", "Gold", "CPU"]);
    expect(filled.view.players[3].cpu).toBe(true);
    expect((await actOnBattle(code, null, { action: "join", name: "Silver" }, 0)).ok).toBe(false);

    const tokens = [made.token, battleToken(code, blue.playerId, 1), battleToken(code, gold.playerId, 2)];
    // Each trainer sees their own channel: their own Pokémon's exact HP, and the others' as a percentage.
    const views = await Promise.all(tokens.map((t) => poll(code, t)));
    views.forEach((v, seat) => {
      expect(v.you).toBe(seat);
      expect(v.request?.data.side.id).toBe(`p${seat + 1}`);
      const own = v.log.lines.find((l) => l.startsWith(`|switch|p${seat + 1}`))!;
      expect(own).toMatch(/\|\d+\/\d+$/);
      expect(v.log.lines.some((l) => l.startsWith("|request|") || l.startsWith("|split|"))).toBe(false);
    });

    // A turn: all three trainers choose (and send in replacements after a faint); the computer answers by itself.
    let after = await poll(code, tokens[0]);
    for (let round = 0; round < 12 && after.turn < 2; round++) {
      for (let s = 0; s < 3; s++) await act(code, tokens[s], (v) => firstChoice(v.request!.data, "freeforall"));
      after = await poll(code, tokens[0]);
    }
    expect(after.turn).toBeGreaterThanOrEqual(2);

    // A spectator: the spectator channel, no request, no seat.
    const spectator = await pollBattle(code, null, 0, "viewer-123456");
    if (!spectator.ok) throw new Error(spectator.error);
    expect(spectator.view.you).toBeNull();
    expect(spectator.view.request).toBeNull();
    expect(spectator.view.log.lines.some((l) => /^\|switch\|p1a: .*\|\d+\/100/.test(l))).toBe(true);
    expect((await listWatchable(null)).some((e) => e.code === code && e.players.length === 4 && e.gameType === "freeforall")).toBe(true);

    // Gold forfeits: out, and the other three battle on.
    const left = await actOnBattle(code, gold.playerId, { action: "forfeit" }, 0);
    if (!left.ok) throw new Error(left.error);
    expect(left.view.status).toBe("playing");
    expect(left.view.players[2].out).toBeGreaterThanOrEqual(1);
    expect(left.view.request).toBeNull();
    // Then Blue, then Red: the computer wins, and the standings run from it to Gold.
    for (const [id, token] of [[blue.playerId, tokens[1]], [red.playerId, tokens[0]]] as const) {
      const v = await poll(code, token);
      if (v.status !== "playing") break;
      const out = await actOnBattle(code, id, { action: "forfeit" }, 0);
      if (!out.ok) throw new Error(out.error);
    }
    const done = await poll(code, tokens[0]);
    expect(done.status).toBe("finished");
    expect(done.end!.winner).toBe(3);
    expect(done.end!.standings).toEqual([3, 0, 1, 2]);
    expect(done.log.lines).toContain("|-message|Gold forfeited.");

    // Settled: no ladder; a replay of the spectator channel with all four trainers.
    await settleBattle(code);
    const rec = (await loadBattle(code))!.rec;
    expect(rec.meta.ranked).toBeUndefined();
    expect(rec.logs.p3?.length).toBeGreaterThan(10);
    const replay = await replayStore()!.get(code);
    expect(replay?.players).toEqual(["Red", "Blue", "Gold", "CPU"]);
    expect(replay?.gameType).toBe("freeforall");
    expect(replay?.standings).toEqual([3, 0, 1, 2]);
    expect(standingsFromLog(replay!.log, replay!.players, 3)).toEqual([3, 0, 1, 2]);

    // A rematch keeps the four seats (the computer's ready); it starts once the three trainers press it.
    const again = await rematchBattle(code, red.playerId);
    if (!again.ok) throw new Error(again.error);
    expect(again.view.status).toBe("lobby");
    for (const id of [blue.playerId, gold.playerId]) {
      const r = await rematchBattle(code, id);
      if (!r.ok) throw new Error(r.error);
    }
    const next = await poll(again.code, again.token);
    expect(next.status).toBe("playing");
    expect(next.players.map((p) => p.name)).toEqual(["Red", "Blue", "Gold", "CPU"]);
  });

  it("the turn timer in a Free-For-All: a trainer out of time is out alone, and the others battle on", { timeout: 120_000 }, async () => {
    const made = await createLiveBattle({ name: "Red", format: "gen9freeforallrandombattle", timer: true, timeoutLoses: true }, Date.now());
    if (!made.ok) throw new Error(made.error);
    const code = made.code;
    const blue = await actOnBattle(code, null, { action: "join", name: "Blue" }, 0);
    if (!blue.ok) throw new Error(blue.error);
    const red = readBattleToken(made.token, code)!;
    await actOnBattle(code, blue.playerId, { action: "ready", ready: true }, 0);
    const filled = await actOnBattle(code, red.playerId, { action: "fill", level: "easy" }, 0);
    if (!filled.ok) throw new Error(filled.error);
    expect(filled.view.status).toBe("playing");
    const blueToken = battleToken(code, blue.playerId, 1);
    // Blue keeps the page open (so never "left") but never chooses; Red answers every request.
    const first = await poll(code, blueToken);
    const deadline = first.clocks!.you.deadline!;
    expect(deadline).toBeGreaterThan(T0);
    for (let t = 20_000; t <= deadline - T0 + 20_000; t += 20_000) {
      vi.setSystemTime(T0 + t);
      await act(code, made.token, (v) => firstChoice(v.request!.data, "freeforall"));
      await poll(code, blueToken);
    }
    const after = await poll(code, made.token);
    expect(after.players[1].out).toBeGreaterThanOrEqual(1);
    expect(after.players[0].out).toBeUndefined();
    expect(after.status).toBe("playing");
    expect(after.log.lines).toContain("|-message|Blue lost due to inactivity.");
    // Blue has nothing left to choose; Red's turns still come.
    expect((await poll(code, blueToken)).request).toBeNull();
    expect(after.request).not.toBeNull();
  });

  it("a disconnected trainer in a Multi Battle forfeits for their team; matchmaking fills two seats with the computer", { timeout: 120_000 }, async () => {
    const matched = await createMatchedBattle("gen9multirandombattle", [{ name: "Red" }, { name: "Blue" }]);
    if (!matched) throw new Error("no battle");
    const tokens = matched.ids.map((id, seat) => battleToken(matched.code, id, seat));
    const view = await poll(matched.code, tokens[0]);
    expect(view.players.map((p) => p.name)).toEqual(["Red", "Blue", "CPU", "CPU 2"]);
    expect(view.ranked).toBeUndefined();
    expect(view.chat?.[0]?.text).toMatch(/computer in the other two seats/);
    // Red keeps polling; Blue goes quiet for longer than the disconnect timer.
    for (let t = 10_000; t <= 90_000; t += 10_000) {
      vi.setSystemTime(T0 + t);
      await poll(matched.code, tokens[0]);
    }
    const done = await poll(matched.code, tokens[0]);
    expect(done.status).toBe("finished");
    expect(done.end!.reason).toBe("left");
    // Blue's team (Blue and the CPU beside them) lost.
    expect(done.end!.winners).toEqual([0, 2]);
  });
});
