import { afterEach, describe, expect, it, vi } from "vitest";
import { actOnBattle, battleToken, createLiveBattle, pollBattle, readBattleToken } from "@/lib/server/battle-engine/service";
import { longPollBattle } from "@/lib/server/battle-engine/long-poll";
import { firstChoice } from "@/lib/server/battle-engine/choices";
import { battleSeenDigest, battleTopic, parseBattleLiveEvent } from "@/lib/battle/live";
import { BATTLE_LIVE_POLL_MS, battleLongPoll, battlePollDelay } from "@/lib/polling";
import type { BattleView } from "@/lib/battle/play";

/**
 * Opponent moves arrive fast without a socket: the long poll answers as
 * soon as the battle moves on, the waiting poll is 500 ms, and with
 * Realtime set up a "something changed" signal (code and revision only)
 * goes out after each write, while the battle itself still comes only
 * through the authenticated GET.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function live() {
  const made = await createLiveBattle({ name: "Red", format: "gen9randombattle" }, Date.now());
  if (!made.ok) throw new Error(made.error);
  const joined = await actOnBattle(made.code, null, { action: "join", name: "Blue" }, 0);
  if (!joined.ok) throw new Error(joined.error);
  const red = readBattleToken(made.token, made.code)!;
  await actOnBattle(made.code, red.playerId, { action: "ready", ready: true }, 0);
  const started = await actOnBattle(made.code, joined.playerId, { action: "ready", ready: true }, 0);
  if (!started.ok) throw new Error(started.error);
  return { code: made.code, red: made.token, redId: red.playerId, blue: battleToken(made.code, joined.playerId, 1), blueId: joined.playerId };
}

async function poll(code: string, token: string, since = 0) {
  const out = await pollBattle(code, token, since);
  if (!out.ok) throw new Error(out.error);
  return out.view;
}

describe("the long poll", () => {
  /** Red has chosen and is waiting on Blue: Red's view, as Red's page holds it. */
  async function redWaiting() {
    const b = await live();
    let r = await poll(b.code, b.red);
    const out = await actOnBattle(b.code, b.redId, { action: "choose", rqid: r.request!.rqid, choice: firstChoice(r.request!.data, false) }, 0);
    if (!out.ok) throw new Error(out.error);
    r = await poll(b.code, b.red);
    expect(r.waiting).toBe(true);
    return { ...b, view: r };
  }

  it("answers as soon as the opponent moves, with the new lines", async () => {
    const { code, red, blue, blueId, view } = await redWaiting();
    const since = view.log.total;
    const started = Date.now();
    const waiting = longPollBattle(code, red, since, null, battleSeenDigest(view), { maxMs: 10_000, stepMs: 50 });
    // Blue chooses 300 ms later.
    await new Promise((r) => setTimeout(r, 300));
    const b = await poll(code, blue);
    const chose = await actOnBattle(code, blueId, { action: "choose", rqid: b.request!.rqid, choice: firstChoice(b.request!.data, false) }, 0);
    expect(chose.ok).toBe(true);
    const out = await waiting;
    const took = Date.now() - started;
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.view.log.total).toBeGreaterThan(since);
    const lines = out.view.log.lines;
    // The turn played out: its moves are among the new lines.
    expect(lines.some((l) => /^\|(move|cant)\|/.test(l))).toBe(true);
    // It ends on the next turn, unless a Pokémon fainted or switched out mid-turn (U-turn, Volt Switch, Eject
    // Button...): then the battle asks that trainer for a switch-in instead, and the turn waits on it.
    const forced = !!out.view.request?.data.forceSwitch || !!(await poll(code, blue)).request?.data.forceSwitch;
    expect(lines.some((l) => l.startsWith("|turn|")) || forced, lines.join("\n")).toBe(true);
    expect(took).toBeGreaterThanOrEqual(280);
    expect(took).toBeLessThan(2_000);
  });

  it("answers at once when the page is behind, and waits it out when nothing happens", async () => {
    const { code, red, view } = await redWaiting();
    // The page hasn't seen the last change (an old digest): no waiting.
    let started = Date.now();
    let out = await longPollBattle(code, red, view.log.total, null, "stale", { maxMs: 5_000, stepMs: 50 });
    expect(out.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
    // Lines past `since`: no waiting either.
    started = Date.now();
    out = await longPollBattle(code, red, 0, null, battleSeenDigest(view), { maxMs: 5_000, stepMs: 50 });
    expect(out.ok && out.view.log.lines.length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(500);
    // Up to date and nothing happens: the whole wait, then the same battle.
    started = Date.now();
    out = await longPollBattle(code, red, view.log.total, null, battleSeenDigest(view), { maxMs: 600, stepMs: 50 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    expect(out.ok && out.view.log.total).toBe(view.log.total);
    expect(out.ok && battleSeenDigest(out.view)).toBe(battleSeenDigest(view));
  });

  it("the digest ignores the clock, the revision, avatars and the lines already held", () => {
    const view = { kind: "pvp", status: "playing", now: 1, rev: 1, you: 0, players: [{ name: "Red" }], log: { from: 0, total: 9, lines: ["a"] }, request: null, waiting: true } as unknown as BattleView;
    const later = { ...view, now: 99, rev: 7, players: [{ name: "Red", avatar: { id: 25 } }], log: { from: 9, total: 9, lines: [] }, live: null } as unknown as BattleView;
    expect(battleSeenDigest(later)).toBe(battleSeenDigest(view));
    expect(battleSeenDigest({ ...view, waiting: false })).not.toBe(battleSeenDigest(view));
    expect(battleSeenDigest({ ...view, log: { from: 0, total: 10, lines: [] } })).not.toBe(battleSeenDigest(view));
  });
});

describe("the pace without and with the push channel", () => {
  const NOW = 1_000_000;
  const battle = (over: Partial<BattleView>): BattleView =>
    ({ kind: "pvp", status: "playing", you: 0, players: [{}, {}], request: null, waiting: false, now: NOW, rev: 1, ...over }) as BattleView;
  const request = { rqid: 1, data: {} } as BattleView["request"];

  it("long-polls only while a seated trainer waits on the opponent, and never with the channel up", () => {
    expect(battleLongPoll(battle({ request, waiting: true }), false)).toBe(true);
    expect(battleLongPoll(battle({ request: null }), false)).toBe(true);
    expect(battleLongPoll(battle({ request }), false)).toBe(false);
    expect(battleLongPoll(battle({ you: null }), false)).toBe(false);
    expect(battleLongPoll(battle({ status: "lobby" }), false)).toBe(false);
    expect(battleLongPoll(battle({ kind: "cpu" }), false)).toBe(false);
    expect(battleLongPoll(battle({ request, waiting: true }), true)).toBe(false);
  });

  it("polls every 3 s as a safety net while the channel is up", () => {
    expect(battlePollDelay(battle({ request, waiting: true }), 0, NOW, true)).toBe(BATTLE_LIVE_POLL_MS);
    expect(battlePollDelay(battle({ request }), 0, NOW, true)).toBe(BATTLE_LIVE_POLL_MS);
    expect(battlePollDelay(battle({ you: null }), 0, NOW, true)).toBe(BATTLE_LIVE_POLL_MS);
  });
});

describe("the push channel", () => {
  it("is off while NEXT_PUBLIC_SUPABASE_ANON_KEY is unset: nothing is sent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    const fetchSpy = vi.fn(async (url: string) => (void url, new Response("{}")));
    vi.stubGlobal("fetch", fetchSpy);
    const { code, red, redId } = await live();
    const r = await poll(code, red);
    await actOnBattle(code, redId, { action: "choose", rqid: r.request!.rqid, choice: firstChoice(r.request!.data, false) }, 0);
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("/realtime/"))).toEqual([]);
  });

  it("with Realtime set up, sends the code and revision after a write, and nothing of the battle", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    const sent: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes("/realtime/")) sent.push({ url: String(url), body: String(init.body) });
        return new Response("{}");
      })
    );
    const { code, red, redId } = await live();
    sent.length = 0;
    const r = await poll(code, red);
    const out = await actOnBattle(code, redId, { action: "choose", rqid: r.request!.rqid, choice: firstChoice(r.request!.data, false) }, 0);
    expect(out.ok).toBe(true);
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const msg = JSON.parse(sent.at(-1)!.body).messages[0];
    expect(sent.at(-1)!.url).toBe("https://example.supabase.co/realtime/v1/api/broadcast");
    expect(msg.topic).toBe(battleTopic(code));
    const event = JSON.parse(msg.payload.data);
    expect(Object.keys(event).sort()).toEqual(["at", "code", "rev"]);
    expect(parseBattleLiveEvent(msg.payload.data, code)?.rev).toBe(out.ok ? out.view.rev : -1);
    // Nothing hidden rides along: no lines, no requests, no teams.
    expect(msg.payload.data).not.toMatch(/\|request\||"side"|move|switch/);
  });
});
