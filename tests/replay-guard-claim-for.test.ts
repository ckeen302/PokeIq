import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * claimFor against a stand-in for the token_claims table (a unique key; an
 * insert of several rows is one statement: all of them or none), with each
 * "instance" a fresh copy of the module (its own memory) over the same table.
 */
const table = new Set<string>();
let inserts = 0;
let failWith: { code: string; message: string } | null = null;

const fake = {
  from: () => ({
    insert: async (rows: { key: string } | { key: string }[]) => {
      inserts++;
      if (failWith) return { error: failWith };
      const list = Array.isArray(rows) ? rows : [rows];
      if (list.some((r) => table.has(r.key))) return { error: { code: "23505", message: "duplicate key" } };
      for (const r of list) table.add(r.key);
      return { error: null };
    },
    select: () => ({
      eq: (_col: string, key: string) => ({
        limit: async () => ({ data: table.has(key) ? [{ key }] : [], error: null }),
      }),
    }),
  }),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ getServiceSupabase: () => fake }));

/** A new serverless instance: the module again, with empty memory. */
async function instance() {
  vi.resetModules();
  return (await import("@/lib/server/replay-guard")).claimFor;
}

beforeEach(() => {
  table.clear();
  inserts = 0;
  failWith = null;
});

describe("claimFor", () => {
  it("claims a round and records who claimed it in one database call", async () => {
    const claimFor = await instance();
    expect(await claimFor("geo:s1:0", "pin-a")).toBe("new");
    expect(inserts).toBe(1);
    expect(table.size).toBe(2);
  });

  it("answers the very same request again on the same instance, and refuses another pin", async () => {
    const claimFor = await instance();
    await claimFor("geo:s1:0", "pin-a");
    expect(await claimFor("geo:s1:0", "pin-a")).toBe("same");
    expect(await claimFor("geo:s1:0", "pin-b")).toBe("other");
  });

  it("knows a retry from another instance, and refuses another pin there", async () => {
    await (await instance())("geo:s1:0", "pin-a");
    expect(await (await instance())("geo:s1:0", "pin-a")).toBe("same");
    expect(await (await instance())("geo:s1:0", "pin-b")).toBe("other");
  });

  it("lets the guess through when the database fails another way", async () => {
    failWith = { code: "57014", message: "statement timeout" };
    const claimFor = await instance();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await claimFor("geo:s1:1", "pin-a")).toBe("new");
    spy.mockRestore();
  });
});
