import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CHAT_KEPT, chatReport, type ChatLine } from "@/lib/chat";
import { POST as reportRoute } from "@/app/api/report/route";
import { MASK, addChatLine, chatBlocked, checkChat, looksLikeLink, postChat } from "@/lib/server/chat";
import { chatRateLimit } from "@/lib/server/rate-limit";
import { createPokedleDuel, type PokedleDuel } from "@/lib/server/pokedle-duel";
import { chatDuel, duelView, joinDuel, leaveDuel, linkRematch, readyDuel, rematchOf } from "@/lib/server/duels";
import { pvpToken, seatToken, type PvpOutcome } from "@/lib/server/duel-core";
import { pvpStore } from "@/lib/server/duel-store";
import { actOnBattle, battleToken, chatBattle, createLiveBattle, pollBattle } from "@/lib/server/battle-engine/service";
import { POST as duelRoute } from "@/app/api/duel/[code]/route";
import { POST as battleRoute } from "@/app/api/battle/[code]/route";

// The memory store, whatever the environment says.
process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const T0 = 1_800_000_000_000;
const SECOND = 1000;

const must = (out: PvpOutcome<PokedleDuel>): PokedleDuel => {
  if (!out.ok) throw new Error(out.error);
  return out.duel;
};

function lobby(code = "chatcode") {
  const { duel, playerId: red } = createPokedleDuel("Red", code, T0, "chat-seed");
  const joined = joinDuel(duel, "Blue", T0 + SECOND);
  if (!joined.ok) throw new Error(joined.error);
  return { duel: joined.duel, red, blue: joined.playerId };
}

describe("chat messages", () => {
  it("are trimmed, with control and invisible characters and extra whitespace taken out", () => {
    expect(checkChat("  good   luck\u0000‮!\n\n have fun ")).toEqual({ ok: true, text: "good luck ! have fun", masked: false });
    expect(checkChat("   ")).toMatchObject({ ok: false });
    expect(checkChat("​‍")).toMatchObject({ ok: false });
    expect(checkChat(42)).toMatchObject({ ok: false });
  });

  it("are 1 to 200 characters", () => {
    expect(checkChat("a".repeat(200))).toMatchObject({ ok: true });
    expect(checkChat("a".repeat(201))).toEqual({ ok: false, error: "Keep it under 200 characters." });
  });

  it("have swears masked, word by word, and letters spaced out", () => {
    expect(checkChat("what the fuck was that")).toEqual({ ok: true, text: `what the ${MASK} was that`, masked: true });
    expect(checkChat("you are SH1T at this")).toEqual({ ok: true, text: `you are ${MASK} at this`, masked: true });
    const spaced = checkChat("lol s h i t move");
    expect(spaced.ok && spaced.text).toBe(`lol ${MASK} ${MASK} ${MASK} ${MASK} move`);
  });

  it("are refused when they're mostly slurs or swears", () => {
    expect(checkChat("fuck fuck shit")).toEqual({ ok: false, error: "Keep it friendly: that message wasn't sent." });
    expect(checkChat("nigger")).toMatchObject({ ok: false });
  });

  it("leave everyday words and Pokémon alone", () => {
    for (const text of ["Cockatiel? I mean Cottonee!", "good game, gg wp", "Scunthorpe assassin class hit", "Mr. Mime and Mr.Mime are cool", "1.5x damage, e.g. Choice Band", "nice. one more?"]) {
      expect(checkChat(text), text).toEqual({ ok: true, text, masked: false });
    }
  });

  it("are refused when they carry a link or anything like one", () => {
    for (const text of [
      "go to http://example.com",
      "https stuff",
      "www pokemon",
      "free robux at robux.com",
      "site dot com",
      "site(dot)net",
      "my site . com",
      "join discord.gg/abc",
      "bit.ly/xyz",
      "lol.gg",
      "ｅｘａｍｐｌｅ．ｃｏｍ",
      "email me a@b.co",
      "connect to 192.168.0.1",
    ]) {
      expect(looksLikeLink(text), text).toBe(true);
      expect(checkChat(text), text).toEqual({ ok: false, error: "Links can't be sent in chat." });
    }
  });
});

describe("chat rate limits", () => {
  const line = (seat: number | null, at: number, n = 1): ChatLine => ({ n, at, seat, text: "hi" });

  it("allow one message a second per trainer", () => {
    expect(chatBlocked([line(0, T0)], 0, T0 + 999)).toBe("One message a second, please.");
    expect(chatBlocked([line(0, T0)], 0, T0 + 1000)).toBeNull();
    // The opponent's messages and the game's own lines don't count against you.
    expect(chatBlocked([line(1, T0), line(null, T0)], 0, T0 + 1)).toBeNull();
  });

  it("allow five in any ten seconds", () => {
    const five = [0, 1, 2, 3, 4].map((k) => line(0, T0 + k * 1500, k + 1));
    expect(chatBlocked(five, 0, T0 + 7000)).toMatch(/too fast/);
    expect(postChat(five, 0, "Red", "hello", T0 + 7000)).toMatchObject({ ok: false, status: 429 });
    expect(chatBlocked(five, 0, T0 + 10_001)).toBeNull();
  });

  it("also hold per trainer and per address on the server, with a friendly 429", async () => {
    const results = Array.from({ length: 6 }, () => chatRateLimit("10.0.0.1", "player-rl"));
    expect(results.slice(0, 5).every((r) => r === null)).toBe(true);
    const limited = results[5]!;
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toMatch(/too fast/);
    // Ten trainers' worth from one address.
    const ip = Array.from({ length: 11 }, (_, k) => chatRateLimit("10.0.0.2", `player-ip-${k}`));
    expect(ip.slice(0, 10).every((r) => r === null)).toBe(true);
    expect(ip[10]!.status).toBe(429);
  });
});

describe("chat history", () => {
  it(`keeps the last ${CHAT_KEPT} lines, numbered on`, () => {
    let lines: ChatLine[] = [];
    for (let k = 0; k < 60; k++) {
      const out = postChat(lines, k % 2, k % 2 ? "Blue" : "Red", `message ${k}`, T0 + k * 2000);
      if (!out.ok) throw new Error(out.error);
      lines = out.chat;
    }
    expect(lines).toHaveLength(CHAT_KEPT);
    expect(lines[0]).toMatchObject({ n: 11, text: "message 10" });
    expect(lines[CHAT_KEPT - 1]).toMatchObject({ n: 60, seat: 1, name: "Blue", text: "message 59" });
    expect(addChatLine(lines, { at: T0, seat: null, text: "GG!" })).toHaveLength(CHAT_KEPT);
  });
});

describe("duel chat", () => {
  it("is open in the lobby, with a line when someone joins", () => {
    const { duel, red } = lobby();
    const d = must(chatDuel(duel, red, "hi Blue, good luck!", T0 + 2 * SECOND));
    expect(d.chat?.map((l) => [l.seat, l.name, l.text])).toEqual([
      [null, undefined, "Blue joined"],
      [0, "Red", "hi Blue, good luck!"],
    ]);
    // Everyone who can see the duel reads it, visitors included.
    expect(duelView(d, null, T0 + 2 * SECOND, 1).chat).toHaveLength(2);
  });

  it("only takes messages from the trainers seated in it", () => {
    const { duel } = lobby();
    expect(chatDuel(duel, "someone-else", "hello", T0 + 2 * SECOND)).toMatchObject({ ok: false, status: 403 });
  });

  it("closes during play (reactions only), opens again at the end with a GG, and moves on to a rematch", () => {
    const { duel, red, blue } = lobby();
    const t = T0 + 2 * SECOND;
    const playing = must(readyDuel(must(readyDuel(duel, red, true, t)), blue, true, t));
    expect(playing.status).toBe("playing");
    expect(chatDuel(playing, red, "hello", t + 5 * SECOND)).toMatchObject({ ok: false, status: 409 });

    const over = must(leaveDuel(playing, blue, t + 6 * SECOND));
    expect(over.status).toBe("finished");
    expect(over.chat?.at(-1)).toMatchObject({ seat: null, text: "GG!" });
    const after = must(chatDuel(over, red, "well played", t + 7 * SECOND));
    expect(after.chat?.at(-1)).toMatchObject({ seat: 0, text: "well played" });

    // The rematch lobby carries the chat on; the old duel's chat closes.
    const next = rematchOf(after, "rematchc", t + 8 * SECOND);
    expect(next.chat?.map((l) => l.text)).toEqual(after.chat?.map((l) => l.text));
    const linked = must(linkRematch(after, "rematchc"));
    expect(chatDuel(linked, blue, "wait", t + 9 * SECOND)).toMatchObject({ ok: false, status: 409 });
  });

  it("never carries hidden game state", () => {
    const { duel, red } = lobby();
    const d = must(chatDuel(duel, red, "hi", T0 + 2 * SECOND));
    expect(Object.keys(d.chat![1]).sort()).toEqual(["at", "n", "name", "seat", "text"]);
  });
});

describe("the chat endpoints", () => {
  const post = (url: string, body: unknown, ip = "10.1.0.1") =>
    new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
  const ctx = (code: string) => ({ params: Promise.resolve({ code }) });

  it("duels: take a seat's signed token, mask swears and refuse links; a forged or borrowed token can't post", async () => {
    const { duel, red } = lobby("rtduexab");
    await pvpStore.insert(duel);

    const ok = await duelRoute(post("/api/duel/rtduexab", { action: "chat", token: pvpToken("rtduexab", red), text: "this is shit" }), ctx("rtduexab"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).chat.at(-1)).toMatchObject({ seat: 0, name: "Red", text: `this is ${MASK}` });

    await new Promise((r) => setTimeout(r, 1010));
    const link = await duelRoute(post("/api/duel/rtduexab", { action: "chat", token: pvpToken("rtduexab", red), text: "see pokeiq.com" }), ctx("rtduexab"));
    expect(link.status).toBe(400);
    expect((await link.json()).error).toBe("Links can't be sent in chat.");

    const forged = await duelRoute(post("/api/duel/rtduexab", { action: "chat", token: "not-a-real-token-at-all", text: "hi" }), ctx("rtduexab"));
    expect(forged.status).toBe(403);
    // Signed for another duel, or for battles.
    const elsewhere = await duelRoute(post("/api/duel/rtduexab", { action: "chat", token: pvpToken("otherdue", red), text: "hi" }), ctx("rtduexab"));
    expect(elsewhere.status).toBe(403);
    const wrongKind = await duelRoute(post("/api/duel/rtduexab", { action: "chat", token: seatToken("battle", "rtduexab", red), text: "hi" }), ctx("rtduexab"));
    expect(wrongKind.status).toBe(403);
    // A valid token for someone not seated here: a spectator.
    const spectator = await duelRoute(post("/api/duel/rtduexab", { action: "chat", token: pvpToken("rtduexab", "spectator-id"), text: "hi" }), ctx("rtduexab"));
    expect(spectator.status).toBe(403);
  });
});

describe("reporting a message", () => {
  it("sends the code and the message to the report endpoint, which takes it", async () => {
    const line: ChatLine = { n: 7, at: T0, seat: 1, name: "Blue", text: "x".repeat(200) };
    const body = chatReport(line, "abcdefgh", "Live battle", "/battle/live/abcdefgh");
    expect(body.message).toContain("abcdefgh");
    expect(body.extra.chat).toMatchObject({ code: "abcdefgh", text: line.text, name: "Blue" });
    const res = await reportRoute(
      new NextRequest("http://localhost:3000/api/report", {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": "10.3.0.1" },
        body: JSON.stringify(body),
      })
    );
    expect(res.status).toBe(200);
  });
});

describe("battle chat", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets both players talk, reads to spectators, and refuses anyone else", async () => {
    const made = await createLiveBattle({ name: "Red", format: "gen9randombattle" }, Date.now());
    if (!made.ok) throw new Error(made.error);
    const joined = await actOnBattle(made.code, null, { action: "join", name: "Blue" }, 0);
    if (!joined.ok) throw new Error(joined.error);
    const red = (await pollBattle(made.code, made.token, 0)).ok;
    expect(red).toBe(true);

    vi.setSystemTime(T0 + SECOND);
    const said = await chatBattle(made.code, joined.playerId, "good luck!", 0);
    if (!said.ok) throw new Error(said.error);
    expect(said.view.chat?.map((l) => l.text)).toEqual(["Blue joined", "good luck!"]);

    // Spectators read it but can't post, by the service or the endpoint.
    const spectator = await pollBattle(made.code, null, 0);
    expect(spectator.ok && spectator.view.chat?.map((l) => l.text)).toEqual(["Blue joined", "good luck!"]);
    expect(await chatBattle(made.code, "not-seated", "hi", 0)).toMatchObject({ ok: false, status: 403 });
    const ctx = { params: Promise.resolve({ code: made.code }) };
    const req = (token: string, text: string) =>
      new NextRequest(`http://localhost/api/battle/${made.code}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.2.0.1" },
        body: JSON.stringify({ action: "chat", token, text, since: 0 }),
      });
    expect((await battleRoute(req(battleToken(made.code, "not-seated", 1), "hi"), ctx)).status).toBe(403);
    expect((await battleRoute(req("forged-token-forged-token", "hi"), ctx)).status).toBe(403);
    expect((await battleRoute(req(pvpToken(made.code, joined.playerId), "hi"), ctx)).status).toBe(403);

    vi.setSystemTime(T0 + 3 * SECOND);
    const masked = await battleRoute(req(made.token, "what the fuck"), ctx);
    expect(masked.status).toBe(200);
    expect((await masked.json()).chat.at(-1)).toMatchObject({ seat: 0, name: "Red", text: `what the ${MASK}` });
    vi.setSystemTime(T0 + 5 * SECOND);
    const link = await battleRoute(req(made.token, "www.example.org"), ctx);
    expect(link.status).toBe(400);
  });
});
