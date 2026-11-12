import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { resilientFetch } from "@/lib/supabase";

describe("a dead database fails fast", () => {
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
