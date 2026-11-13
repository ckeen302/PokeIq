import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { resetDatabaseBackoff, resilientFetch } from "@/lib/supabase";

describe("a dead database fails fast", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetDatabaseBackoff();
  });

  it("once the back-off is over, lets one request check the database while the rest still fail fast", async () => {
    const real = globalThis.fetch;
    let calls = 0;
    let answer: ((res: Response) => void) | null = null;
    // Down: refused at once. Then a database that hangs until it answers the check.
    let mode: "refuse" | "hang" = "refuse";
    globalThis.fetch = (async () => {
      calls++;
      if (mode === "refuse") throw new TypeError("fetch failed");
      return new Promise<Response>((resolve) => (answer = resolve));
    }) as typeof fetch;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let i = 0; i < 3; i++) await expect(resilientFetch("http://db.invalid/rest/v1/x")).rejects.toThrow(/unavailable/);
      expect(calls).toBe(3);
      // Backing off: nothing reaches the database.
      await expect(resilientFetch("http://db.invalid/rest/v1/x")).rejects.toThrow(/backing off/);
      expect(calls).toBe(3);
      // The back-off is over: one request goes through; while it waits, the others don't pile up behind it.
      vi.setSystemTime(Date.now() + 11_000);
      mode = "hang";
      const check = resilientFetch("http://db.invalid/rest/v1/x");
      for (let i = 0; i < 50; i++) await expect(resilientFetch("http://db.invalid/rest/v1/x")).rejects.toThrow(/checking/);
      expect(calls).toBe(4);
      // It's back: everything goes through again.
      answer!(new Response("[]", { status: 200 }));
      expect((await check).status).toBe(200);
      mode = "hang";
      void resilientFetch("http://db.invalid/rest/v1/x");
      void resilientFetch("http://db.invalid/rest/v1/x");
      expect(calls).toBe(6);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("turns a 503 into a 502 so the read isn't retried", async () => {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => (calls++, new Response("{}", { status: 503 }))) as typeof fetch;
    try {
      const res = await resilientFetch("http://example.invalid/rest/v1/x");
      expect(res.status).toBe(502);
    } finally {
      globalThis.fetch = real;
    }
    expect(calls).toBe(1);
  });

  it("returns a read's error at once instead of supabase-js's 7-second retry ladder", async () => {
    const sb = createClient("http://127.0.0.1:9", "dummy-key", { auth: { persistSession: false }, global: { fetch: resilientFetch } });
    for (let i = 0; i < 4; i++) {
      const t = Date.now();
      const { data, error } = await sb.from("runs").select("id").limit(1);
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(Date.now() - t).toBeLessThan(900);
    }
  });
});
