import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Battle } from "pokemon-showdown";
import { extractChannelMessages } from "pokemon-showdown/dist/sim/battle";
import {
  actOnBattle,
  battleToken,
  createCpuBattle,
  createLiveBattle,
  createMatchedBattle,
  pollBattle,
  readBattleToken,
  WATCHER_TTL_MS,
} from "@/lib/server/battle-engine/service";
import { loadBattle } from "@/lib/server/battle-engine/store";
import { listWatchable, watchEntry } from "@/lib/server/battle-engine/watch";
import { firstChoice } from "@/lib/server/battle-engine/choices";
import type { BattleView } from "@/lib/battle/play";

// The memory stores, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());
const at = (ms: number) => vi.setSystemTime(T0 + ms);

async function poll(code: string, token: string | null, since = 0, viewer: string | null = null): Promise<BattleView> {
  const out = await pollBattle(code, token, since, viewer);
  if (!out.ok) throw new Error(`${out.status} ${out.error}`);
  return out.view;
}

async function matched(format: "gen9randombattle" | "gen9randomdoublesbattle" = "gen9randombattle") {
  const made = await createMatchedBattle(format, [{ name: "Red" }, { name: "Blue" }]);
  if (!made) throw new Error("no battle");
  return { code: made.code, tokens: [battleToken(made.code, made.ids[0], 0), battleToken(made.code, made.ids[1], 1)] };
}

/** Both players answer their requests until the battle has run `turns` turns (or ended). */
async function play(code: string, tokens: string[], turns: number) {
  for (let i = 0; i < turns * 4; i++) {
    let moved = false;
    for (const token of tokens) {
      const view = await poll(code, token);
      if (view.status !== "playing") return;
      if (!view.request || view.waiting) continue;
      const seat = readBattleToken(token, code)!;
      const out = await actOnBattle(code, seat.playerId, { action: "choose", rqid: view.request.rqid, choice: firstChoice(view.request.data, view.format === "gen9randomdoublesbattle") }, 0);
      if (!out.ok) throw new Error(out.error);
      moved = true;
    }
    const view = await poll(code, tokens[0]);
    if (view.turn > turns || !moved) return;
  }
}

/** What Showdown's own simulator shows a spectator: the input log replayed, every update split for channel 0. */
function showdownSpectatorLog(inputLog: string[]): string[] {
  const out: string[] = [];
  let battle: Battle | null = null;
  for (const line of inputLog) {
    const space = line.indexOf(" ");
    const cmd = line.slice(1, space);
    const rest = line.slice(space + 1);
    if (cmd === "start") {
      battle = new Battle(JSON.parse(rest));
      (battle as { send: Battle["send"] }).send = (type: string, data: string | string[]) => {
        if (type !== "update") return;
        const text = Array.isArray(data) ? data.join("\n") : data;
        out.push(...(extractChannelMessages(text, [0])[0] ?? []));
      };
    } else if (cmd === "player") {
      const [slot, json] = [rest.slice(0, 2), rest.slice(3)];
      battle!.setPlayer(slot as "p1" | "p2", JSON.parse(json));
    } else if (cmd === "p1" || cmd === "p2") battle!.choose(cmd, rest);
  }
  battle!.sendUpdates();
  return out.filter((l) => !/^\|(t:|debug)\|/.test(l));
}

describe("spectators", () => {
  it("see exactly Showdown's spectator channel: no request, no split, no exact HP", async () => {
    for (const format of ["gen9randombattle", "gen9randomdoublesbattle"] as const) {
      const { code, tokens } = await matched(format);
      await play(code, tokens, 4);
      const view = await poll(code, null, 0, "viewer-aaaa1111");
      const stored = (await loadBattle(code))!.rec;
      expect(view.you).toBeNull();
      expect(view.request).toBeNull();
      expect(view.log.lines).toEqual(stored.logs.spectator);
      expect(view.log.lines.length).toBeGreaterThan(20);
      // Showdown's own simulator, replayed from the input log, shows a spectator the very same lines.
      expect(view.log.lines).toEqual(showdownSpectatorLog(stored.inputLog));
      for (const line of view.log.lines) {
        expect(line).not.toMatch(/^\|(request|split|t:|debug)\|/);
        // Every HP a spectator sees is out of 100 (the players' own channels have exact HP).
        const hp = /^\|(?:switch|drag|replace|-damage|-heal|-sethp)\|[^|]+\|(?:[^|]+\|)?(\d+)\/(\d+)/.exec(line);
        if (hp) expect(hp[2]).toBe("100");
      }
      // The players' private lines (exact HP) never reach the spectator.
      const privateOnly = stored.logs.p1.filter((l) => !stored.logs.spectator.includes(l) && /\d+\/\d+/.test(l) && !/\/100\b/.test(l));
      expect(privateOnly.length).toBeGreaterThan(0);
      const json = JSON.stringify(view);
      for (const l of privateOnly) expect(json).not.toContain(l);
      // Nothing secret about the battle or the seats.
      expect(json).not.toContain(stored.meta.seed);
      for (const s of stored.meta.seats) expect(json).not.toContain(s.id);
      expect(json).not.toMatch(/"(state|inputLog|seed|requests|team|watchers|player)"|"side":\{"name"/);
    }
  });

  it("follow a battle from where they left off, like the players", async () => {
    const { code, tokens } = await matched();
    const first = await poll(code, null, 0, "viewer-bbbb2222");
    await play(code, tokens, 2);
    const next = await poll(code, null, first.log.total, "viewer-bbbb2222");
    const stored = (await loadBattle(code))!.rec;
    expect([...first.log.lines, ...next.log.lines]).toEqual(stored.logs.spectator);
  });

  it("a stale or foreign seat token never reads a player's channel", async () => {
    const { code, tokens } = await matched();
    const other = await matched();
    // Red's token from another battle: a spectator here.
    const view = await poll(code, other.tokens[0]);
    const stored = (await loadBattle(code))!.rec;
    expect(view.you).toBeNull();
    expect(view.log.lines).toEqual(stored.logs.spectator);
    expect(tokens).toHaveLength(2);
  });

  it("are counted, live, for players and spectators alike", async () => {
    const { code, tokens } = await matched();
    expect((await poll(code, tokens[0])).spectators).toBe(0);
    await poll(code, null, 0, "viewer-cccc3333");
    await poll(code, null, 0, "viewer-dddd4444");
    await poll(code, null, 0, "viewer-dddd4444");
    expect((await poll(code, tokens[1])).spectators).toBe(2);
    expect((await poll(code, null, 0, "viewer-cccc3333")).spectators).toBe(2);
    // A bad id counts nobody.
    expect((await poll(code, null, 0, "bad id!")).spectators).toBe(2);
    at(WATCHER_TTL_MS + 1000);
    expect((await poll(code, tokens[0])).spectators).toBe(0);
  });

  it("never see a battle against the computer", async () => {
    const made = await createCpuBattle({ name: "Red", format: "gen9randombattle", level: "easy" });
    if (!made.ok) throw new Error(made.error);
    const view = await poll(made.code, null, 0, "viewer-eeee5555");
    expect(view.log.lines).toEqual([]);
    expect(view.spectators).toBeUndefined();
  });
});

async function friendBattle(opts: { public?: boolean; timer?: boolean } = {}) {
  const made = await createLiveBattle({ name: "Red", format: "gen9randombattle", ...opts }, Date.now());
  if (!made.ok) throw new Error(made.error);
  const joined = await actOnBattle(made.code, null, { action: "join", name: "Blue" }, 0);
  if (!joined.ok) throw new Error(joined.error);
  const red = readBattleToken(made.token, made.code)!;
  await actOnBattle(made.code, red.playerId, { action: "ready", ready: true }, 0);
  const started = await actOnBattle(made.code, joined.playerId, { action: "ready", ready: true }, 0);
  if (!started.ok) throw new Error(started.error);
  return { code: made.code, red: made.token, blue: battleToken(made.code, joined.playerId, 1), view: started.view };
}

describe("the Watch lobby", () => {
  it("lists matchmade and opted-in friend battles only", async () => {
    const ladder = await matched();
    const open = await friendBattle({ public: true });
    const closed = await friendBattle();
    const cpu = await createCpuBattle({ name: "Red", format: "gen9randombattle", level: "easy" });
    if (!cpu.ok) throw new Error(cpu.error);
    const lobby = await createLiveBattle({ name: "Gold", format: "gen9randombattle", public: true }, Date.now());
    if (!lobby.ok) throw new Error(lobby.error);
    const listed = (await listWatchable(null)).map((e) => e.code);
    expect(listed).toContain(ladder.code);
    expect(listed).toContain(open.code);
    expect(listed).not.toContain(closed.code);
    expect(listed).not.toContain(cpu.code);
    // Not under way yet.
    expect(listed).not.toContain(lobby.code);
    // A finished battle drops off.
    const red = readBattleToken(open.red, open.code)!;
    await actOnBattle(open.code, red.playerId, { action: "forfeit" }, 0);
    expect((await listWatchable(null)).map((e) => e.code)).not.toContain(open.code);
  });

  it("filters by format and lists public facts only", async () => {
    const singles = await matched("gen9randombattle");
    const doubles = await matched("gen9randomdoublesbattle");
    at(65_000);
    await poll(singles.code, null, 0, "viewer-ffff6666");
    const only = await listWatchable("gen9randomdoublesbattle");
    expect(only.map((e) => e.code)).toContain(doubles.code);
    expect(only.every((e) => e.format === "gen9randomdoublesbattle")).toBe(true);
    const entry = (await listWatchable(null)).find((e) => e.code === singles.code)!;
    expect(entry).toMatchObject({ format: "gen9randombattle", players: [{ name: "Red" }, { name: "Blue" }], ranked: false, turn: 1, spectators: 1, startedAt: T0 });
    const stored = (await loadBattle(singles.code))!.rec;
    const json = JSON.stringify(entry);
    expect(json).not.toContain(stored.meta.seed);
    for (const s of stored.meta.seats) expect(json).not.toContain(s.id);
    expect(Object.keys(entry).sort()).toEqual(["code", "format", "formatName", "players", "ranked", "spectators", "startedAt", "turn"]);
    // Privacy is the battle's own: a private battle has no entry at all.
    expect(watchEntry({ ...stored.meta, public: undefined }, Date.now())).toBeNull();
    expect(watchEntry({ ...stored.meta, kind: "cpu" }, Date.now())).toBeNull();
  });
});

describe("the turn timer", () => {
  it("a friend battle can start with the timer off, and either player starts it", async () => {
    const b = await friendBattle({ timer: false });
    expect(b.view.clocks).toBeUndefined();
    expect(b.view.timer).toBeNull();
    expect(b.view.timerStartable).toBe(true);
    const blue = readBattleToken(b.blue, b.code)!;
    const out = await actOnBattle(b.code, blue.playerId, { action: "timer" }, 0);
    if (!out.ok) throw new Error(out.error);
    expect(out.view.timerStartable).toBeUndefined();
    expect(out.view.clocks?.you.deadline).toBeGreaterThan(Date.now());
    // Showdown's message, in the battle log.
    expect((await loadBattle(b.code))!.rec.logs.spectator).toContain("|inactive|Battle timer is ON: inactive players will automatically lose when time's up. (requested by Blue)");
  });

  it("friend battles keep the timer on by default", async () => {
    const b = await friendBattle();
    expect(b.view.clocks?.you.deadline).not.toBeNull();
    expect(b.view.timerStartable).toBeUndefined();
  });
});
