import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PublicUser } from "@/lib/server/accounts";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const users = new Map<string, PublicUser>();
const user = (n: number, username: string): PublicUser => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, username, createdAt: "2026-01-01T00:00:00Z" });
const red = user(1, "Red");
const blue = user(2, "Blue");
users.set("red", red).set("blue", blue);

// Signed in as whoever the x-test-user header names.
vi.mock("@/lib/server/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/server/auth")>();
  return {
    ...real,
    sessionTokenHash: (r: NextRequest) => r.headers.get("x-test-user"),
    userFromRequest: async (r: NextRequest) => users.get(r.headers.get("x-test-user") ?? "") ?? null,
  };
});

const { clearMemoryRooms, memoryRoomStore, postToRoom, reportRoomMessage, setSlowMode } = await import("@/lib/server/rooms");
const { clearMemoryReports, memoryReports } = await import("@/lib/server/reports");
const { signEvent, broadcastKey } = await import("@/lib/server/realtime");
const { verifyRoomEvent } = await import("@/lib/rooms-client");
const route = await import("@/app/api/rooms/[id]/route");

let ip = 0;
function post(room: string, body: unknown, as?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": `10.1.0.${++ip}` };
  if (as) headers["x-test-user"] = as;
  return route.POST(new NextRequest(`http://localhost:3000/api/rooms/${room}`, { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ id: room }) });
}

const T = Date.UTC(2026, 9, 20, 12);
const store = memoryRoomStore();
beforeEach(() => {
  clearMemoryRooms();
  clearMemoryReports();
});

describe("posting in rooms", () => {
  it("is for signed-in trainers only; anyone can read", async () => {
    expect((await post("lobby", { action: "post", text: "hello" })).status).toBe(401);
    const ok = await post("lobby", { action: "post", text: "hello" }, "red");
    expect(ok.status).toBe(200);
    const read = await route.GET(new NextRequest("http://localhost:3000/api/rooms/lobby"), { params: Promise.resolve({ id: "lobby" }) });
    const body = await read.json();
    expect(body.messages.map((m: { name: string; text: string }) => [m.name, m.text])).toEqual([["Red", "hello"]]);
    // No account ids go out.
    expect(JSON.stringify(body)).not.toContain(red.id);
    expect((await post("nowhere", { action: "post", text: "hi" }, "red")).status).toBe(404);
  });

  it("masks swears, refuses links, and keeps to a message a second", async () => {
    const masked = await postToRoom(store, red, "lobby", "what the shit", T);
    expect(masked).toMatchObject({ ok: true, message: { text: "what the •••" } });
    expect(await postToRoom(store, red, "lobby", "go to bit.ly/abc", T + 2_000)).toMatchObject({ ok: false, status: 400 });
    expect(await postToRoom(store, red, "lobby", "again", T + 2_500)).toMatchObject({ ok: true });
    expect(await postToRoom(store, red, "lobby", "too fast", T + 2_800)).toMatchObject({ ok: false, status: 429 });
  });

  it("slow mode spaces each trainer's messages", async () => {
    await setSlowMode(store, "lobby", 30);
    expect(await postToRoom(store, red, "lobby", "one", T)).toMatchObject({ ok: true });
    const slowed = await postToRoom(store, red, "lobby", "two", T + 10_000);
    expect(slowed).toMatchObject({ ok: false, status: 429 });
    expect((slowed as { error: string }).error).toMatch(/Slow mode/);
    // Others aren't held up by Red, and Red can post again after 30 s.
    expect(await postToRoom(store, blue, "lobby", "hi", T + 10_000)).toMatchObject({ ok: true });
    expect(await postToRoom(store, red, "lobby", "three", T + 31_000)).toMatchObject({ ok: true });
  });

  it("keeps the last 100 messages", async () => {
    for (let i = 0; i < 105; i++) await postToRoom(store, i % 2 ? red : blue, "battle", `message ${i}`, T + i * 60_000);
    const kept = await store.messages("battle");
    expect(kept).toHaveLength(100);
    expect(kept[0].text).toBe("message 5");
  });

  it("a report carries the message and its context from the server's own records", async () => {
    await postToRoom(store, blue, "lobby", "first", T);
    const bad = await postToRoom(store, blue, "lobby", "something mean", T + 2_000);
    expect(bad.ok).toBe(true);
    const id = (bad as { message: { id: number } }).message.id;
    expect(await reportRoomMessage(store, red, "lobby", id, null)).toEqual({ ok: true });
    const [report] = memoryReports();
    expect(report).toMatchObject({ kind: "chat", reporter: "Red", page: "/rooms/lobby" });
    expect((report.extra as { context: unknown[] }).context).toHaveLength(2);
    expect((await post("lobby", { action: "report", id: 99999 }, "red")).status).toBe(404);
  });
});

describe("realtime broadcasts", () => {
  it("are signed by the server; a forged or altered one is dropped", async () => {
    const event = { type: "msg" as const, room: "lobby", msg: { id: 1, at: T, name: "Red", text: "hi" } };
    const signed = signEvent(event);
    const key = broadcastKey();
    expect(await verifyRoomEvent(signed, key, "lobby")).toEqual(event);
    expect(await verifyRoomEvent({ ...signed, data: signed.data.replace("hi", "bad words") }, key, "lobby")).toBeNull();
    expect(await verifyRoomEvent({ data: signed.data, sig: "AAAA" }, key, "lobby")).toBeNull();
    // Signed for another room: not this one's.
    expect(await verifyRoomEvent(signed, key, "help")).toBeNull();
  });
});
