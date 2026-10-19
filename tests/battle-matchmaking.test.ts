import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { battleQueueKey, cancelBattleSearch, searchBattle, type BattleSearchResult } from "@/lib/server/battle-engine/matchmaking";
import { MATCH_FRESH_MS, newTicket } from "@/lib/server/match-queue";
import { queueStore } from "@/lib/server/duel-store";
import { loadBattle } from "@/lib/server/battle-engine/store";
import { pollBattle, readBattleToken } from "@/lib/server/battle-engine/service";
import { PLAY_FORMATS, type PlayFormatId } from "@/lib/battle/play";
import type { PvpFailure } from "@/lib/server/duel-core";

// The memory stores, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const SECOND = 1000;
const RANDOM: PlayFormatId = "gen9randombattle";

const OU_TEAM = `Kingambit @ Leftovers
Ability: Supreme Overlord
Tera Type: Dark
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Swords Dance

Great Tusk @ Booster Energy
Ability: Protosynthesis
Tera Type: Ground
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off`;

type Waiting = Extract<BattleSearchResult, { status: "waiting" }>;
type Matched = Extract<BattleSearchResult, { status: "matched" }>;

function waiting(out: BattleSearchResult | PvpFailure): Waiting {
  if (!out.ok || out.status !== "waiting") throw new Error(`expected to wait, got ${JSON.stringify(out)}`);
  return out;
}
function matched(out: BattleSearchResult | PvpFailure): Matched {
  if (!out.ok || out.status !== "matched") throw new Error(`expected a match, got ${JSON.stringify(out)}`);
  return out;
}

const at = (t: number) => vi.setSystemTime(t);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(T0);
  for (const f of PLAY_FORMATS) await queueStore.remove(battleQueueKey(f));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("battle matchmaking", () => {
  it("pairs two searchers into a live battle that's already under way, both seated", async () => {
    const red = newTicket();
    expect(waiting(await searchBattle(RANDOM, "Red", red))).toMatchObject({ ticket: red, since: T0 });
    at(T0 + 2 * SECOND);
    const blue = matched(await searchBattle(RANDOM, "Blue", newTicket()));
    expect(blue.href).toBe(`/battle/live/${blue.code}`);
    // Red learns of it on the next poll: the same battle, seat 0.
    at(T0 + 3 * SECOND);
    const redSeat = matched(await searchBattle(RANDOM, "Red", red));
    expect(redSeat.code).toBe(blue.code);

    const { rec } = (await loadBattle(blue.code))!;
    expect(rec.meta.kind).toBe("pvp");
    expect(rec.meta.status).toBe("playing");
    expect(rec.meta.seats.map((s) => [s.name, s.ready])).toEqual([
      ["Red", true],
      ["Blue", true],
    ]);
    expect(readBattleToken(redSeat.token, blue.code)).toEqual({ playerId: rec.meta.seats[0].id, seat: 0 });
    expect(readBattleToken(blue.token, blue.code)).toEqual({ playerId: rec.meta.seats[1].id, seat: 1 });

    // Both have a move to make right away, each on their own side.
    const r = await pollBattle(blue.code, redSeat.token, 0);
    const b = await pollBattle(blue.code, blue.token, 0);
    if (!r.ok || !b.ok) throw new Error("poll failed");
    expect(r.view.request?.data.side.id).toBe("p1");
    expect(b.view.request?.data.side.id).toBe("p2");
    expect(r.view.clocks?.you.deadline).not.toBeNull();
    // The queue is empty again, and a lost response is fine: Red's next poll still finds the seat.
    expect((await queueStore.load(battleQueueKey(RANDOM)))!.duel.waiting).toBeUndefined();
    expect(matched(await searchBattle(RANDOM, "Red", red)).code).toBe(blue.code);
  });

  it("passes over a waiting searcher who stopped polling (a closed tab)", async () => {
    const [a, b] = [newTicket(), newTicket()];
    waiting(await searchBattle(RANDOM, "Ash", a));
    at(T0 + MATCH_FRESH_MS + SECOND);
    waiting(await searchBattle(RANDOM, "Brock", b));
    expect((await queueStore.load(battleQueueKey(RANDOM)))!.duel.waiting?.ticket).toBe(b);
    // Brock, still polling, is the one the next searcher meets.
    at(T0 + MATCH_FRESH_MS + 4 * SECOND);
    waiting(await searchBattle(RANDOM, "Brock", b));
    at(T0 + MATCH_FRESH_MS + 6 * SECOND);
    const misty = matched(await searchBattle(RANDOM, "Misty", newTicket()));
    const { rec } = (await loadBattle(misty.code))!;
    expect(rec.meta.seats.map((s) => s.name)).toEqual(["Brock", "Misty"]);
  });

  it("forgets a cancelled search, and only its own ticket can cancel it", async () => {
    const a = newTicket();
    waiting(await searchBattle(RANDOM, "Ash", a));
    await cancelBattleSearch(RANDOM, a);
    expect((await queueStore.load(battleQueueKey(RANDOM)))!.duel.waiting).toBeUndefined();
    const b = newTicket();
    waiting(await searchBattle(RANDOM, "Brock", b));
    await cancelBattleSearch(RANDOM, a);
    expect((await queueStore.load(battleQueueKey(RANDOM)))!.duel.waiting?.ticket).toBe(b);
  });

  it("never pairs a search with itself", async () => {
    const a = newTicket();
    waiting(await searchBattle(RANDOM, "Ash", a));
    for (let i = 1; i <= 5; i++) {
      at(T0 + i * SECOND);
      expect(waiting(await searchBattle(RANDOM, "Ash", a)).since).toBe(T0);
    }
  });

  it("keeps formats apart: each format is its own queue", async () => {
    waiting(await searchBattle("gen9randombattle", "Ash", newTicket()));
    waiting(await searchBattle("gen9randomdoublesbattle", "Brock", newTicket()));
    waiting(await searchBattle("gen9ou", "Misty", newTicket(), OU_TEAM));
    // Ubers takes the same team, but it's another queue.
    waiting(await searchBattle("gen9ubers", "Dawn", newTicket(), OU_TEAM));
    expect(new Set(PLAY_FORMATS.map(battleQueueKey)).size).toBe(PLAY_FORMATS.length);
    expect(battleQueueKey("gen9randombattle")).toMatch(/^[a-z0-9:-]{3,64}$/);
    // Doubles pairs with doubles, into a doubles battle.
    const pair = matched(await searchBattle("gen9randomdoublesbattle", "Cynthia", newTicket()));
    expect((await loadBattle(pair.code))!.rec.meta.format).toBe("gen9randomdoublesbattle");
    // Ash is still waiting in singles.
    expect((await queueStore.load(battleQueueKey("gen9randombattle")))!.duel.waiting?.name).toBe("Ash");
  });

  it("lets only one of two simultaneous searches have the waiting trainer (compare-and-swap)", async () => {
    const a = newTicket();
    waiting(await searchBattle(RANDOM, "Ash", a));
    const battles = () => new Set((globalThis as unknown as { __pokeiqBattles: Map<string, unknown> }).__pokeiqBattles.keys());
    const before = battles();
    const [b, c] = await Promise.all([searchBattle(RANDOM, "Brock", newTicket()), searchBattle(RANDOM, "Misty", newTicket())]);
    // Both read Ash waiting and opened a battle; one lost the swap, threw its battle away and waited instead.
    expect([b, c].map((o) => (o.ok ? o.status : "failed")).sort()).toEqual(["matched", "waiting"]);
    const winner = matched([b, c].find((o) => o.ok && o.status === "matched")!);
    expect([...battles()].filter((code) => !before.has(code))).toEqual([winner.code]);
    expect(matched(await searchBattle(RANDOM, "Ash", a)).code).toBe(winner.code);
    expect((await loadBattle(winner.code))!.rec.meta.seats[0].name).toBe("Ash");
  });

  it("checks a brought team before the search joins the queue, and battles with both teams", async () => {
    // No team, or a team that breaks the rules: never queued.
    const none = await searchBattle("gen9ou", "Ash", newTicket());
    expect(none.ok).toBe(false);
    const illegal = await searchBattle("gen9ou", "Ash", newTicket(), OU_TEAM.replace("- Swords Dance", "- Spore"));
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.status).toBe(400);
    expect(await queueStore.load(battleQueueKey("gen9ou"))).toBeNull();

    // A legal team waits (packed, server-side only), and the pair battles with both.
    const a = newTicket();
    const wait = waiting(await searchBattle("gen9ou", "Ash", a, OU_TEAM));
    expect(JSON.stringify(wait)).not.toContain("Kingambit");
    expect((await queueStore.load(battleQueueKey("gen9ou")))!.duel.waiting?.team).toContain("Kingambit");
    // Later polls needn't resend it.
    at(T0 + 3 * SECOND);
    waiting(await searchBattle("gen9ou", "Ash", a));
    expect((await queueStore.load(battleQueueKey("gen9ou")))!.duel.waiting?.team).toContain("Kingambit");
    const blue = matched(await searchBattle("gen9ou", "Blue", newTicket(), OU_TEAM.replace("Kingambit", "Gholdengo").replace(/Ability: Supreme Overlord[\s\S]*?- Swords Dance/, "Ability: Good as Gold\nTera Type: Steel\nEVs: 252 SpA / 4 SpD / 252 Spe\nTimid Nature\n- Make It Rain\n- Shadow Ball\n- Nasty Plot\n- Recover")));
    const { rec } = (await loadBattle(blue.code))!;
    expect(rec.meta.seats[0].team).toContain("Kingambit");
    expect(rec.meta.seats[1].team).toContain("Gholdengo");
    // Team preview: each picks a lead.
    const view = await pollBattle(blue.code, blue.token, 0);
    if (!view.ok) throw new Error(view.error);
    expect(view.view.request?.data.teamPreview).toBe(true);
    expect(view.view.log.lines.filter((l) => l.startsWith("|poke|p1|")).map((l) => l.split("|")[3].split(",")[0])).toEqual(["Kingambit", "Great Tusk"]);
  });

  it("gives two trainers with the same name different names in the battle", async () => {
    waiting(await searchBattle(RANDOM, "Ash", newTicket()));
    const out = matched(await searchBattle(RANDOM, "ash", newTicket()));
    expect((await loadBattle(out.code))!.rec.meta.seats.map((s) => s.name)).toEqual(["Ash", "ash 2"]);
  });
});
