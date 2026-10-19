import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/report/route";

let ip = 0;

/** A report from its own address, so the rate limit only bites where a test wants it to. */
function report(body: unknown, opts: { ip?: string; origin?: string; raw?: string } = {}) {
  return POST(
    new NextRequest("http://localhost:3000/api/report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "localhost:3000",
        origin: opts.origin ?? "http://localhost:3000",
        "x-forwarded-for": opts.ip ?? `10.0.0.${++ip}`,
        "user-agent": "vitest",
      },
      body: opts.raw ?? JSON.stringify(body),
    })
  );
}

describe("POST /api/report", () => {
  it("takes a problem report (and logs it when there's no database)", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await report({ kind: "feedback", message: "The map didn't load", page: "/guessr", contact: "ash@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("The map didn't load"));
    log.mockRestore();
  });

  it("takes an error report with its details", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await report({ kind: "error", message: "TypeError: x is undefined", extra: { stack: "at y (app.js:1:2)", source: "window" } });
    expect(res.status).toBe(200);
    log.mockRestore();
  });

  it("turns away empty, malformed and oversized reports", async () => {
    expect((await report({ kind: "feedback", message: "   " })).status).toBe(400);
    expect((await report({ kind: "spam", message: "hi" })).status).toBe(400);
    expect((await report(null, { raw: "{not json" })).status).toBe(400);
    expect((await report({ kind: "feedback", message: "x".repeat(2001) })).status).toBe(400);
    expect((await report({ kind: "error", message: "x", extra: { stack: "y".repeat(7000) } })).status).toBe(400);
    expect((await report({ kind: "feedback", message: "x".repeat(20_000) })).status).toBe(413);
  });

  it("turns away other sites", async () => {
    expect((await report({ kind: "feedback", message: "hi" }, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("slows down one address sending a lot, with a message to show", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await report({ kind: "feedback", message: `report ${i}` }, { ip: "10.9.9.9" })).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    const limited = await report({ kind: "feedback", message: "one more" }, { ip: "10.9.9.9" });
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toMatch(/try again/i);
    // Errors have their own allowance.
    expect((await report({ kind: "error", message: "boom" }, { ip: "10.9.9.9" })).status).toBe(200);
    log.mockRestore();
  });
});
