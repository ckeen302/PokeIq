import { afterEach, describe, expect, it, vi } from "vitest";
import { Battle, Teams as PkmnTeams, type PokemonSet, type PRNGSeed } from "@pkmn/sim";
import { BUSY_RETRY_DELAYS_MS, sendRetryingBusy } from "@/lib/battle/busy-retry";
import { chooseCpu as choosePolicy, seededRandom } from "@/lib/battle/cpu-policy";
import { completeSet } from "@/lib/battle/sets";
import type { BattleRequest } from "@/lib/battle/play";

// The memory stores, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

/** The server's computer, slowed down on demand (a long Hard search on a loaded machine). */
const slow = vi.hoisted(() => ({ ms: 0 }));
vi.mock("@/lib/server/battle-engine/cpu", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/battle-engine/cpu")>();
  return {
    ...real,
    chooseCpu: (...args: Parameters<typeof real.chooseCpu>) => {
      const until = performance.now() + slow.ms;
      while (performance.now() < until) {
        // Busy: the simulator runs synchronously, so this is what a slow search costs a request.
      }
      return real.chooseCpu(...args);
    },
  };
});

const { CPU_REQUEST_BUDGET_MS, actOnBattle, createCpuBattle, isCpuSeat, pollBattle, readBattleToken } = await import("@/lib/server/battle-engine/service");
const store = await import("@/lib/server/battle-engine/store");
const { firstChoice } = await import("@/lib/server/battle-engine/choices");

afterEach(() => {
  slow.ms = 0;
  vi.restoreAllMocks();
});

const noWait = async () => {};

describe("a busy battle is tried again before an error shows", () => {
  it("resends a 503 after jittered pauses of about 150, 400 and 900 ms, then gives the last answer", async () => {
    const waits: number[] = [];
    let calls = 0;
    const out = await sendRetryingBusy(async () => ({ status: ++calls < 10 ? 503 : 200 }), { wait: async (ms) => void waits.push(ms), random: () => 0.5 });
    expect(out.status).toBe(503);
    expect(calls).toBe(4);
    expect(waits).toEqual([...BUSY_RETRY_DELAYS_MS]);
    // The jitter keeps each pause within half to one and a half times its base.
    const jittered: number[] = [];
    await sendRetryingBusy(async () => ({ status: 503 }), { wait: async (ms) => void jittered.push(ms) });
    expect(jittered).toHaveLength(3);
    jittered.forEach((ms, i) => {
      expect(ms).toBeGreaterThanOrEqual(BUSY_RETRY_DELAYS_MS[i] * 0.5);
      expect(ms).toBeLessThanOrEqual(BUSY_RETRY_DELAYS_MS[i] * 1.5);
    });
  });

  it("never resends anything but a 503", async () => {
    for (const status of [200, 400, 403, 409, 429, 500]) {
      let calls = 0;
      const out = await sendRetryingBusy(async () => ({ status: (calls++, status) }), { wait: noWait });
      expect(out.status).toBe(status);
      expect(calls).toBe(1);
    }
  });

  it("lands a choice whose first send lost six compare-and-swaps in a row, with no error", async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9randombattle", level: "easy" });
    if (!made.ok) throw new Error(made.error);
    const seat = readBattleToken(made.token, made.code)!;
    const req = made.view.request!;
    const save = vi.spyOn(store, "saveBattle");
    for (let i = 0; i < 6; i++) save.mockResolvedValueOnce(false);
    const statuses: number[] = [];
    const out = await sendRetryingBusy(
      async () => {
        const res = await actOnBattle(made.code, seat.playerId, { action: "choose", rqid: req.rqid, choice: firstChoice(req.data, false) }, made.view.log.total);
        statuses.push(res.ok ? 200 : res.status);
        return { status: res.ok ? 200 : res.status, res };
      },
      { wait: noWait }
    );
    expect(statuses).toEqual([503, 200]);
    expect(out.res.ok).toBe(true);
    if (out.res.ok) expect(out.res.view.log.total).toBeGreaterThan(made.view.log.total);
  });
});

describe("the computer's thinking time", () => {
  it("answers the human's choice within 2 s however slow the computer is, and plays the rest on the next poll", async () => {
    // Three computer trainers: each answers every turn, inside the human's request.
    const made = await createCpuBattle({ name: "Red", format: "gen9freeforallrandombattle", level: "normal" });
    if (!made.ok) throw new Error(made.error);
    const seat = readBattleToken(made.token, made.code)!;
    const owed = async () => {
      const meta = (await store.loadBattle(made.code))!.rec.meta;
      return meta.seats.filter((s, i) => isCpuSeat(s) && meta.requests[i]).length;
    };
    let view = made.view;
    let deferred = false;
    // A turn whose end asks the computers for choices (not just a switch from the human after a KO).
    for (let step = 0; step < 20 && !deferred && view.request; step++) {
      const req = view.request;
      slow.ms = CPU_REQUEST_BUDGET_MS + 100;
      const t0 = performance.now();
      const out = await actOnBattle(made.code, seat.playerId, { action: "choose", rqid: req.rqid, choice: firstChoice(req.data, "freeforall") }, 0);
      const took = performance.now() - t0;
      slow.ms = 0;
      if (!out.ok) throw new Error(out.error);
      expect(took).toBeLessThan(2_000);
      if ((await owed()) > 0) {
        deferred = true;
        // The next poll plays the rest.
        const polled = await pollBattle(made.code, made.token, 0);
        if (!polled.ok) throw new Error(polled.error);
        expect(await owed()).toBe(0);
      }
      view = out.view;
    }
    expect(deferred).toBe(true);
  });

  /** A singles position with the first Pokémon of each side out. */
  function position(): Battle {
    const fill = (sets: Partial<PokemonSet>[]) => PkmnTeams.pack(sets.map((s) => completeSet({ level: 100, ...s } as never)) as PokemonSet[]);
    const battle = new Battle({ formatid: "gen9customgame" as never, seed: "1,2,3,4" as PRNGSeed });
    battle.setPlayer("p1", { name: "CPU", team: fill([{ species: "Garchomp", moves: ["Earthquake", "Dragon Claw", "Swords Dance", "Stone Edge"] }, { species: "Rotom-Wash", moves: ["Hydro Pump", "Volt Switch", "Will-O-Wisp", "Protect"] }]) });
    battle.setPlayer("p2", { name: "Player", team: fill([{ species: "Gholdengo", moves: ["Make It Rain", "Shadow Ball", "Nasty Plot", "Recover"] }, { species: "Dragonite", moves: ["Extreme Speed", "Earthquake", "Dragon Dance", "Fire Punch"] }]) });
    for (const side of battle.sides) if ((side.activeRequest as unknown as BattleRequest | null)?.teamPreview) battle.choose(side.id, "team 1");
    return battle;
  }

  it("stops Hard's look-ahead at its budget and still plays a legal choice; with no budget it plays as before", () => {
    const battle = position();
    const fail = (err: unknown) => {
      throw err;
    };
    const unlimited = choosePolicy(battle, battle.p1, "hard", seededRandom("t"), fail);
    expect(choosePolicy(battle, battle.p1, "hard", seededRandom("t"), fail, {})).toBe(unlimited);
    // A clock that jumps a second each look: out of time before the first look a turn deeper.
    let t = 0;
    let looks = 0;
    const now = () => ((looks += 1), (t += 1_000));
    const rushed = choosePolicy(battle, battle.p1, "hard", seededRandom("t"), fail, { budgetMs: 400, now });
    expect(looks).toBe(2);
    // Out of time at once plays Hard's one-turn favourite, which is what a zero budget gives too.
    expect(choosePolicy(battle, battle.p1, "hard", seededRandom("t"), fail, { budgetMs: 0 })).toBe(rushed);
    expect(rushed).toMatch(/^(move [1-4]|switch [1-6])/);
  });
});

describe("a request that never reached the server", () => {
  it("is explained in plain words, whatever the browser calls it", async () => {
    const { sendFailureText } = await import("@/lib/battle/busy-retry");
    for (const raw of [new TypeError("Failed to fetch"), new TypeError("Load failed"), new Error("NetworkError when attempting to fetch resource.")]) {
      const text = sendFailureText(raw);
      expect(text).toMatch(/Check your connection/);
      expect(text).not.toMatch(/fetch|Load failed|NetworkError/);
    }
  });

  it("keeps the server's own message, and falls back when there is none", async () => {
    const { sendFailureText } = await import("@/lib/battle/busy-retry");
    expect(sendFailureText(new Error("This battle is full."))).toBe("This battle is full.");
    expect(sendFailureText("?", "Couldn't join the battle.")).toBe("Couldn't join the battle.");
  });
});

describe("battle speed before the trainer picks one", () => {
  it("is 1x on a desktop and 2x on a phone", async () => {
    const { defaultBattleSpeed } = await import("@/lib/battle/busy-retry");
    expect(defaultBattleSpeed(false)).toBe(1);
    expect(defaultBattleSpeed(true)).toBe(2);
  });
});
