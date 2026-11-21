import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newTicket, searchMatch, type SearchResult } from "@/lib/server/matchmaking";
import { pvpStore, queueStore } from "@/lib/server/duel-store";
import { duelView, emoteDuel, touchDuel, type PvpDuel } from "@/lib/server/duels";
import { emoteBlocked, readPvpToken, type PvpFailure } from "@/lib/server/duel-core";
import type { PokedleDuel } from "@/lib/server/pokedle-duel";
import { EMOTE_BURST, EMOTE_GAP_MS, EMOTE_WINDOW_MS, PVP_AWAY_MS } from "@/lib/pvp-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const SECOND = 1000;
const at = (t: number) => vi.setSystemTime(t);

type Matched = Extract<SearchResult, { status: "matched" }>;
function matched(out: SearchResult | PvpFailure): Matched {
  if (!out.ok || out.status !== "matched") throw new Error(`expected a match, got ${JSON.stringify(out)}`);
  return out;
}
function waiting(out: SearchResult | PvpFailure) {
  if (!out.ok || out.status !== "waiting") throw new Error(`expected to wait, got ${JSON.stringify(out)}`);
  return out;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(T0);
  await queueStore.remove("pokedle:all");
});
afterEach(() => {
  vi.useRealTimers();
});

/** Red waits, Blue searches: a matched Pokédle duel, under way. Blue is seat 1. */
async function liveDuel() {
  const red = newTicket();
  waiting(await searchMatch({ game: "pokedle" }, "Red", red));
  const blue = matched(await searchMatch({ game: "pokedle" }, "Blue", newTicket()));
  const duel = (await pvpStore.load(blue.code))!.duel as PvpDuel;
  return { duel, blue: readPvpToken(blue.token, blue.code)! };
}

describe("a matched pokédle duel", () => {
  it("is marked as met in the casual queue", async () => {
    const { duel } = await liveDuel();
    expect((duel as PokedleDuel).queue).toBe("casual");
  });

  it("gives the win to the trainer who stayed when the other goes quiet", async () => {
    const { duel, blue } = await liveDuel();
    // Blue keeps polling; Red's tab is gone.
    let d: PvpDuel = duel;
    for (let t = 5; t * SECOND <= PVP_AWAY_MS + 10 * SECOND; t += 5) d = touchDuel(d, blue, T0 + t * SECOND);
    expect(d.status).toBe("finished");
    expect(d.end).toMatchObject({ reason: "left", winner: 1 });
  });
});

describe("reactions", () => {
  it("allows a few at a time, spaced out", async () => {
    const { duel, blue } = await liveDuel();
    let d = duel;
    const send = (t: number, emote: "gg" | "fire" = "fire") => emoteDuel(d, blue, emote, T0 + t);
    const ok = (t: number) => {
      const out = send(t);
      if (!out.ok) throw new Error(`refused at ${t}: ${out.error}`);
      d = out.duel;
    };
    ok(0);
    // Too soon after the last one.
    expect(send(EMOTE_GAP_MS - 1)).toMatchObject({ ok: false, status: 429 });
    ok(EMOTE_GAP_MS);
    ok(2 * EMOTE_GAP_MS);
    expect(EMOTE_BURST).toBe(3);
    // A fourth inside the window is too many...
    expect(send(3 * EMOTE_GAP_MS)).toMatchObject({ ok: false, status: 429 });
    // ...until the first has left it.
    ok(EMOTE_WINDOW_MS + 1);
    // Older ones are dropped once they can no longer count or show.
    expect(d.emotes!.map((e) => e.n)).toEqual([2, 3, 4]);
    const view = duelView(d, null, T0 + EMOTE_WINDOW_MS + 2, 1);
    expect(view.emotes!.map((e) => Object.keys(e).sort())).toEqual([["at", "emote", "n", "seat"]]);
  });

  it("counts each trainer separately", () => {
    const emotes = [{ n: 1, seat: 0, emote: "gg" as const, at: T0 }];
    expect(emoteBlocked(emotes, 0, T0 + 10)).not.toBeNull();
    expect(emoteBlocked(emotes, 1, T0 + 10)).toBeNull();
  });
});
