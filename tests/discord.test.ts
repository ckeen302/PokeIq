import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/discord/server", () => ({
  gameSchema: { safeParse: (v: unknown) => (["pokedle", "connections", "pikadoku", "guessr", "quiz"].includes(v as string) ? { success: true, data: v } : { success: false }) },
  createDuelEmbed: vi.fn(async (g: string, n: string) => ({ title: `${g} duel for ${n}`, description: "[Join the duel](https://x/abc)" })),
  leaderboardEmbed: vi.fn(async () => ({ title: "board", description: "No scores yet." })),
}));

import { POST } from "@/app/api/discord/route";
import { GET as cron } from "@/app/api/cron/discord-daily/route";
import { verifyDiscordSignature } from "@/lib/discord/verify";
import { createDuelEmbed } from "@/lib/discord/server";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubHex = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("hex");

function signed(body: object, tamper = false) {
  const raw = JSON.stringify(body);
  const ts = "1700000000";
  const sig = sign(null, Buffer.from(ts + raw), privateKey).toString("hex");
  return new Request("http://x/api/discord", {
    method: "POST",
    body: tamper ? raw + " " : raw,
    headers: { "x-signature-ed25519": sig, "x-signature-timestamp": ts },
  });
}
const cmd = (name: string, options?: object[]) => signed({ type: 2, application_id: "app", token: "tok", member: { nick: "Ash K!", user: { username: "ash" } }, data: { name, options } });

beforeAll(() => {
  process.env.DISCORD_PUBLIC_KEY = pubHex;
});
afterEach(() => vi.unstubAllGlobals());

describe("signature", () => {
  it("accepts a valid signature and rejects tampering, bad hex and missing parts", () => {
    const raw = "{}";
    const sig = sign(null, Buffer.from("1" + raw), privateKey).toString("hex");
    expect(verifyDiscordSignature(raw, sig, "1", pubHex)).toBe(true);
    expect(verifyDiscordSignature(raw + "x", sig, "1", pubHex)).toBe(false);
    expect(verifyDiscordSignature(raw, "zz", "1", pubHex)).toBe(false);
    expect(verifyDiscordSignature(raw, null, "1", pubHex)).toBe(false);
    expect(verifyDiscordSignature(raw, sig, "1", undefined)).toBe(false);
  });
  it("401s unsigned and tampered requests", async () => {
    expect((await POST(new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await POST(signed({ type: 1 }, true))).status).toBe(401);
  });
});

describe("interactions", () => {
  it("answers PING", async () => {
    expect(await (await POST(signed({ type: 1 }))).json()).toEqual({ type: 1 });
  });
  it("/daily links every game in site colours", async () => {
    const j = await (await POST(cmd("daily"))).json();
    expect(j.type).toBe(4);
    const e = j.data.embeds[0];
    expect(e.color).toBe(0xf1417c);
    for (const p of ["/pokedle", "/connections", "/pikadoku", "/guessr", "/daily"]) expect(e.description).toContain(p);
    expect(e.title).toMatch(/#\d+/);
  });
  it("/help", async () => {
    const e = (await (await POST(cmd("help"))).json()).data.embeds[0];
    expect(e.color).toBe(0xa47efb);
    expect(e.description).toContain("/dex");
  });
  it("/dex card, and not-found", async () => {
    const e = (await (await POST(cmd("dex", [{ name: "pokemon", value: "pikachu" }]))).json()).data.embeds[0];
    expect(e.title).toContain("Pikachu");
    expect(e.url).toMatch(/\/pokemon\/pikachu$/);
    expect(e.thumbnail.url).toMatch(/\/25\.png$/);
    expect(e.fields.map((f: { name: string }) => f.name)).toEqual(["Type", "Base stat total", "Key stats", "Abilities"]);
    const miss = (await (await POST(cmd("dex", [{ name: "pokemon", value: "zzzz" }]))).json()).data.embeds[0];
    expect(miss.description).toMatch(/No Pok/);
  });
  it("autocomplete returns at most 25 slug choices", async () => {
    const all = await (await POST(signed({ type: 4, data: { name: "dex", options: [{ name: "pokemon", value: "", focused: true }] } }))).json();
    expect(all.type).toBe(8);
    expect(all.data.choices).toHaveLength(25);
    const some = await (await POST(signed({ type: 4, data: { name: "dex", options: [{ name: "pokemon", value: "pika", focused: true }] } }))).json();
    expect(some.data.choices[0]).toEqual({ name: "Pikachu", value: "pikachu" });
  });
  it("/duel and /leaderboard defer then PATCH the follow-up", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    for (const name of ["duel", "leaderboard"]) {
      const j = await (await POST(cmd(name, [{ name: "game", value: "quiz" }]))).json();
      expect(j.type).toBe(5);
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(createDuelEmbed).toHaveBeenCalledWith("quiz", "Ash K!");
    const urls = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([u, o]) => `${o.method} ${u}`);
    expect(urls).toEqual(Array(2).fill("PATCH https://discord.com/api/v10/webhooks/app/tok/messages/@original"));
  });
  it("rejects an unknown game", async () => {
    const j = await (await POST(cmd("duel", [{ name: "game", value: "chess" }]))).json();
    expect(j.type).toBe(4);
  });
});

describe("cron auth", () => {
  const req = (auth?: string) => new Request("http://x/api/cron/discord-daily", { headers: auth ? { authorization: auth } : {} });
  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.DISCORD_DAILY_WEBHOOK_URL;
  });
  it("skips without env", async () => {
    expect(await (await cron(req())).json()).toEqual({ skipped: true });
  });
  it("401s a wrong bearer and posts with the right one", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.DISCORD_DAILY_WEBHOOK_URL = "https://discord.test/hook";
    expect((await cron(req("Bearer nope"))).status).toBe(401);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await cron(req("Bearer s3cret"));
    expect(await res.json()).toEqual({ posted: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].description).toContain("/pokedle");
  });
});
