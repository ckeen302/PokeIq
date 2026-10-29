import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DuelView } from "@/lib/duel-types";
import type { LiveChannelLike, LiveClient } from "@/lib/realtime-client";

/**
 * A PokéGuessr duel's live channel: the server publishes a signed "revision
 * N" after each write a page can see (and not after a mere heartbeat), the
 * browser drops anything unsigned, fetches on each push, and keeps the
 * channel alive through errors; polling eases off while it's up.
 */

// The memory store, and Realtime "configured" (the broadcast endpoint is a mocked fetch).
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
// No Postgres behind those keys: every store stays in memory.
vi.mock("@/lib/supabase", () => ({ getServiceSupabase: () => null }));

const { broadcastKey, signPayload } = await import("@/lib/server/realtime");
const { duelChanged, duelFingerprint, publishDuel, publishIfChanged } = await import("@/lib/server/geo-duel-live");
const { createDuel, guessDuel, joinDuel, touchDuel } = await import("@/lib/server/duel");
const { DUEL_LIVE_EVENT, duelTopic, parseDuelLiveEvent } = await import("@/lib/geo-duel-live");
const { LIVE_WATCHDOG_MS, openLiveChannel, retryDelay, verifySigned } = await import("@/lib/realtime-client");
const { LIVE_POLL_MS, duelPollDelay } = await import("@/lib/polling");
const route = await import("@/app/api/geo/duel/[code]/route");
const create = await import("@/app/api/geo/duel/route");

const T0 = 1_800_000_000_000;

/** Every broadcast sent: its topic, event and payload. */
const sent: { topic: string; event: string; payload: { data: string; sig: string } }[] = [];
const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url).endsWith("/realtime/v1/api/broadcast")) {
    const body = JSON.parse(String(init?.body)) as { messages: (typeof sent)[number][] };
    sent.push(...body.messages);
    return new Response("{}", { status: 202 });
  }
  throw new Error(`unexpected fetch ${String(url)}`);
});

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The broadcasts settle on the next tick (they're never awaited by the caller). */
const settled = () => new Promise((r) => setTimeout(r, 0));

describe("publishing a duel's changes", () => {
  it("sends a signed revision on the duel's own topic, which the browser side verifies and reads", async () => {
    await publishDuel("abcdefgh", 7);
    expect(sent).toHaveLength(1);
    expect(sent[0].topic).toBe(duelTopic("abcdefgh"));
    expect(sent[0].topic).toBe("geo-duel:abcdefgh");
    expect(sent[0].event).toBe(DUEL_LIVE_EVENT);
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toBe("https://example.supabase.co/realtime/v1/api/broadcast");
    expect((call[1]?.headers as Record<string, string>).Authorization).toBe("Bearer service-key");

    const data = await verifySigned(sent[0].payload, broadcastKey());
    expect(data).not.toBeNull();
    expect(parseDuelLiveEvent(data!, "abcdefgh")).toMatchObject({ code: "abcdefgh", rev: 7 });
    // Another duel's event, or a forged one, is nothing to act on.
    expect(parseDuelLiveEvent(data!, "zzzzzzzz")).toBeNull();
    expect(await verifySigned({ data: JSON.stringify({ code: "abcdefgh", rev: 99, at: 0 }), sig: sent[0].payload.sig }, broadcastKey())).toBeNull();
    expect(await verifySigned({ data: sent[0].payload.data, sig: "AAAA" }, broadcastKey())).toBeNull();
    expect(await verifySigned(null, broadcastKey())).toBeNull();
    expect(await verifySigned(signPayload({ code: "abcdefgh", rev: 1 }), broadcastKey())).not.toBeNull();
    expect(parseDuelLiveEvent("not json", "abcdefgh")).toBeNull();
    expect(parseDuelLiveEvent(JSON.stringify({ code: "abcdefgh", rev: "7" }), "abcdefgh")).toBeNull();
  });

  it("tells a heartbeat from a change", () => {
    const { duel, playerId: red } = createDuel("kanto", "Red", "abcdefgh", T0, "seed");
    const touched = touchDuel(duel, red, T0 + 60_000);
    expect(touched.players[0].seenAt).not.toBe(duel.players[0].seenAt);
    expect(duelFingerprint(touched)).toBe(duelFingerprint(duel));
    expect(duelChanged(duel, touched)).toBe(false);
    const joined = joinDuel(duel, "Blue", T0 + 1000);
    if (!joined.ok) throw new Error(joined.error);
    expect(duelChanged(duel, joined.duel)).toBe(true);
    expect(duelChanged(undefined, duel)).toBe(true);
  });

  it("publishes only changes a page can see", async () => {
    const { duel, playerId: red } = createDuel("kanto", "Red", "abcdefgh", T0, "seed");
    publishIfChanged("abcdefgh", duel, touchDuel(duel, red, T0 + 60_000), 2);
    await settled();
    expect(sent).toHaveLength(0);
    const joined = joinDuel(duel, "Blue", T0 + 1000);
    if (!joined.ok) throw new Error(joined.error);
    publishIfChanged("abcdefgh", duel, joined.duel, 3);
    await settled();
    expect(sent).toHaveLength(1);
    expect(parseDuelLiveEvent(sent[0].payload.data, "abcdefgh")?.rev).toBe(3);
  });

  it("never carries anything but the code and revision", () => {
    const { duel, playerId: red } = createDuel("kanto", "Red", "abcdefgh", T0, "seed");
    const joined = joinDuel(duel, "Blue", T0 + 1000);
    if (!joined.ok) throw new Error(joined.error);
    const guessed = guessDuel(joined.duel, red, 0, { x: 0.1, y: 0.2 }, T0 + 20_000);
    publishIfChanged("abcdefgh", joined.duel, guessed.ok ? guessed.duel : joined.duel, 4);
    for (const s of sent) expect(Object.keys(JSON.parse(s.payload.data)).sort()).toEqual(["at", "code", "rev"]);
  });
});

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

let ip = 0;
const headers = (token?: string) => {
  const h: Record<string, string> = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": `10.2.0.${++ip}` };
  if (token) h["x-duel-token"] = token;
  return h;
};
const ctx = (code: string) => ({ params: Promise.resolve({ code }) });
const post = (code: string, body: unknown) => route.POST(new NextRequest(`http://localhost:3000/api/geo/duel/${code}`, { method: "POST", headers: headers(), body: JSON.stringify(body) }), ctx(code));
const get = (code: string, token?: string) => route.GET(new NextRequest(`http://localhost:3000/api/geo/duel/${code}`, { headers: headers(token) }), ctx(code));

describe("the duel routes", () => {
  it("publish each action, a poll that moves the duel on, and not a plain heartbeat; the view says where to subscribe", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const made = await create.POST(new NextRequest("http://localhost:3000/api/geo/duel", { method: "POST", headers: headers(), body: JSON.stringify({ region: "kanto", name: "Red" }) }));
    expect(made.status).toBe(200);
    const seat = (await made.json()) as { code: string; token: string; view: DuelView };
    expect(seat.view.live).toEqual({ url: "https://example.supabase.co", anon: "anon-key", key: broadcastKey() });
    // The anon key is public; the service key never goes out.
    expect(JSON.stringify(seat)).not.toContain("service-key");
    const code = seat.code;
    expect(sent).toHaveLength(0);

    const joined = await post(code, { action: "join", name: "Blue" });
    expect(joined.status).toBe(200);
    const blue = (await joined.json()) as { token: string; view: DuelView };
    await settled();
    expect(sent.map((s) => s.topic)).toEqual([duelTopic(code)]);
    expect(parseDuelLiveEvent(sent[0].payload.data, code)?.rev).toBe(blue.view.rev);

    // A poll right after: a heartbeat, nothing to tell.
    sent.length = 0;
    vi.setSystemTime(T0 + 6_000);
    const polled = await get(code, seat.token);
    expect(polled.status).toBe(200);
    await settled();
    expect(sent).toHaveLength(0);

    // Both ready: two pushes, and the round starts after the lead-in.
    await post(code, { action: "ready", token: seat.token, ready: true });
    await post(code, { action: "ready", token: blue.token, ready: true });
    await settled();
    expect(sent).toHaveLength(2);

    // The round's start was stamped with the second Ready: the poll that finds it under way changes nothing server-side.
    sent.length = 0;
    vi.setSystemTime(T0 + 20_000);
    const started = (await (await get(code, blue.token)).json()) as DuelView;
    expect(started.round?.shot).toBeTruthy();
    await settled();
    expect(sent).toHaveLength(0);

    // A guess: pushed with the new revision, and the other page's fetch sees the countdown (never the pin).
    const guessed = await post(code, { action: "guess", token: seat.token, round: 0, x: 0.5, y: 0.5 });
    expect(guessed.status).toBe(200);
    const after = (await guessed.json()) as DuelView;
    await settled();
    expect(sent).toHaveLength(1);
    expect(parseDuelLiveEvent(sent[0].payload.data, code)?.rev).toBe(after.rev);
    const theirs = (await (await get(code, blue.token)).json()) as DuelView;
    expect(theirs.round?.countdown).toBe(true);
    expect(theirs.round?.guessed).toEqual([true, false]);
    expect(theirs.round?.yours).toBeUndefined();

    // Blue's 15 s run out: the poll that closes the round (the reveal) publishes it, so Red's page hears at once.
    sent.length = 0;
    vi.setSystemTime(T0 + 20_000 + 17_000);
    const revealed = (await (await get(code, blue.token)).json()) as DuelView;
    expect(revealed.round).toBeUndefined();
    expect(revealed.revealed).toHaveLength(1);
    await settled();
    expect(sent).toHaveLength(1);
    expect(parseDuelLiveEvent(sent[0].payload.data, code)?.rev).toBe(revealed.rev);
  });
});

// ---------------------------------------------------------------------------
// The browser side
// ---------------------------------------------------------------------------

/** A stand-in Supabase client: the test drives the channel's status and its broadcasts. */
function fakeClient() {
  const made: { topic: string; subscribed: boolean; status: (s: string) => void; handlers: ((m: { payload: unknown }) => void)[]; }[] = [];
  let disconnects = 0;
  const makeClient = async (): Promise<LiveClient> => ({
    channel(topic: string) {
      const entry = { topic, subscribed: false, status: (() => {}) as (status: string) => void, handlers: [] as ((m: { payload: unknown }) => void)[] };
      made.push(entry);
      const ch: LiveChannelLike = {
        on(_type, _filter, cb) {
          entry.handlers.push(cb);
          return ch;
        },
        subscribe(cb) {
          entry.subscribed = true;
          entry.status = cb;
          return ch;
        },
      };
      return ch;
    },
    removeAllChannels: async () => [],
    realtime: {
      disconnect() {
        disconnects++;
      },
    },
  });
  return { made, makeClient, disconnects: () => disconnects };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("the live channel in the browser", () => {
  it("reports up on SUBSCRIBED, down on an error, and hands over only signed events for this duel", async () => {
    const { made, makeClient } = fakeClient();
    const statuses: boolean[] = [];
    const revs: number[] = [];
    const close = openLiveChannel(
      { config: { url: "u", anon: "a", key: broadcastKey() }, topic: duelTopic("abcdefgh"), event: DUEL_LIVE_EVENT, parse: (d) => parseDuelLiveEvent(d, "abcdefgh"), onEvent: (e) => revs.push(e.rev), onStatus: (up) => statuses.push(up) },
      makeClient
    );
    await flush();
    expect(made).toHaveLength(1);
    expect(made[0].topic).toBe("geo-duel:abcdefgh");
    made[0].status("SUBSCRIBED");
    made[0].status("SUBSCRIBED");
    expect(statuses).toEqual([true]);
    made[0].status("CHANNEL_ERROR");
    expect(statuses).toEqual([true, false]);
    made[0].status("SUBSCRIBED");
    expect(statuses).toEqual([true, false, true]);

    const good = signPayload({ code: "abcdefgh", rev: 5, at: T0 });
    const other = signPayload({ code: "zzzzzzzz", rev: 6, at: T0 });
    for (const h of made[0].handlers) {
      h({ payload: good });
      h({ payload: other });
      h({ payload: { data: JSON.stringify({ code: "abcdefgh", rev: 9, at: T0 }), sig: "forged" } });
      h({ payload: "junk" });
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(revs).toEqual([5]);
    close();
    for (const h of made[0].handlers) h({ payload: good });
    await new Promise((r) => setTimeout(r, 20));
    expect(revs).toEqual([5]);
  });

  it("starts over with backoff when the channel stays down past the watchdog, and at once when the browser comes back online", async () => {
    vi.useFakeTimers();
    // The browser's "online" event, which the channel listens for.
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    const { made, makeClient, disconnects } = fakeClient();
    const statuses: boolean[] = [];
    const close = openLiveChannel(
      { config: { url: "u", anon: "a", key: broadcastKey() }, topic: "t", event: "e", parse: () => null, onEvent: () => {}, onStatus: (up) => statuses.push(up) },
      makeClient
    );
    await flush();
    expect(made).toHaveLength(1);
    made[0].status("TIMED_OUT");
    expect(statuses).toEqual([]);
    // Never came up: torn down after the watchdog, remade after the first backoff (about a second).
    await vi.advanceTimersByTimeAsync(LIVE_WATCHDOG_MS + 1);
    expect(disconnects()).toBe(1);
    expect(made).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(made).toHaveLength(2);
    made[1].status("SUBSCRIBED");
    expect(statuses).toEqual([true]);
    // Dropped, and not back within the watchdog: a fresh client, then a longer wait than before only if it fails again.
    made[1].status("CLOSED");
    expect(statuses).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(LIVE_WATCHDOG_MS + 1);
    expect(disconnects()).toBe(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(made).toHaveLength(3);
    made[2].status("CHANNEL_ERROR");
    // The network's back: no waiting on the watchdog.
    win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(1500);
    expect(made).toHaveLength(4);
    made[3].status("SUBSCRIBED");
    expect(statuses).toEqual([true, false, true]);
    close();
    expect(disconnects()).toBe(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(made).toHaveLength(4);
  });

  it("waits 1, 2, 4… seconds between fresh attempts, up to 30, with jitter", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map((n) => retryDelay(n, 0.5))).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
    expect(retryDelay(0, 0)).toBe(800);
    expect(retryDelay(0, 1)).toBe(1200);
  });
});

describe("polling while pushes arrive", () => {
  const NOW = T0;
  it("eases off to 3 s in play but still lands a poll after each deadline; every second once the channel is down", () => {
    const round = { startsAt: NOW - 5000, endsAt: NOW + 60_000 };
    const view = { rev: 1, now: NOW, status: "playing" as const, you: 0, players: [{}, {}], round };
    expect(duelPollDelay(view, 0, NOW)).toBe(1000);
    expect(duelPollDelay(view, 0, NOW, undefined, true)).toBe(LIVE_POLL_MS);
    expect(duelPollDelay({ ...view, round: { startsAt: NOW - 5000, endsAt: NOW + 700 } }, 0, NOW, undefined, true)).toBe(760);
    expect(duelPollDelay(view, 0, NOW, undefined, false)).toBe(1000);
    expect(duelPollDelay({ ...view, status: "lobby", round: undefined }, 0, NOW, undefined, true)).toBe(LIVE_POLL_MS);
    expect(duelPollDelay({ ...view, status: "lobby", round: undefined }, 0, NOW)).toBe(2000);
  });
});
