import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Message } from "@/lib/server/email/templates";
import type { EmailStore, EmailSub } from "@/lib/server/email/store";
import { CONFIRMS_PER_ADDRESS_PER_DAY, claimConfirmSlot, saveSettings, type ServiceDeps } from "@/lib/server/email/service";
import { cronAuthorized } from "@/lib/server/cron-auth";
import { validateCustom } from "@/lib/server/connections-custom";
import { FACTS } from "@/lib/connections/facts";
import type { CustomGroupInput } from "@/lib/connections/custom";
import { GAMEPLAY_IP_LIMIT } from "@/lib/server/rate-limit";
import { POST as postLeaderboard } from "@/app/api/leaderboard/route";
import { POST as postGeoLeaderboard } from "@/app/api/geo/leaderboard/route";

const ROOT = path.resolve(import.meta.dirname, "..");

function memoryStore(): EmailStore {
  const map = new Map<string, EmailSub>();
  return {
    async get(id) {
      return map.get(id) ?? null;
    },
    async save(sub) {
      map.set(sub.profileId, { ...sub });
    },
    async candidates() {
      return [];
    },
    async claim() {
      return [];
    },
    async release() {},
  };
}

describe("confirmation emails: a cap per address, whichever accounts ask", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  const deps = (store: EmailStore, sent: Message[], at = now): ServiceDeps => ({
    store,
    send: async (m) => (sent.push(m), { ok: true }),
    now: () => at,
    claimRecipient: (email, t) => claimConfirmSlot(email, t),
  });

  it("mails a stranger's address only a few times a day however many accounts type it in", async () => {
    const store = memoryStore();
    const sent: Message[] = [];
    const outcomes: (string | null)[] = [];
    for (let i = 0; i < CONFIRMS_PER_ADDRESS_PER_DAY + 3; i++) {
      const out = await saveSettings({ id: `spam-${i}`, username: `Spam${i}` }, { email: "victim@example.com" }, deps(store, sent));
      expect(out.ok).toBe(true);
      outcomes.push(out.ok ? out.confirm : null);
    }
    expect(outcomes.filter((c) => c === "sent")).toHaveLength(CONFIRMS_PER_ADDRESS_PER_DAY);
    expect(outcomes.slice(CONFIRMS_PER_ADDRESS_PER_DAY)).toEqual(["throttled", "throttled", "throttled"]);
    expect(sent).toHaveLength(CONFIRMS_PER_ADDRESS_PER_DAY);
  });

  it("still mails an honest trainer's own new address (and the next day's resend)", async () => {
    const store = memoryStore();
    const sent: Message[] = [];
    const first = await saveSettings({ id: "ash", username: "Ash" }, { email: "ash.ketchum@example.com" }, deps(store, sent));
    expect(first.ok && first.confirm).toBe("sent");
    // Another address is its own allowance.
    const other = await saveSettings({ id: "misty", username: "Misty" }, { email: "misty@example.com" }, deps(store, sent));
    expect(other.ok && other.confirm).toBe("sent");
    // The day after, the address's allowance is fresh.
    for (let i = 0; i < CONFIRMS_PER_ADDRESS_PER_DAY; i++) await claimConfirmSlot("brock@example.com", now);
    expect(await claimConfirmSlot("brock@example.com", now)).toBe(false);
    expect(await claimConfirmSlot("brock@example.com", now + 24 * 3600_000)).toBe(true);
  });
});

describe("cron secret", () => {
  it("accepts only the exact bearer secret", () => {
    const secret = "a-cron-secret-of-some-length";
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(cronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(cronAuthorized(secret, secret)).toBe(false);
    expect(cronAuthorized(null, secret)).toBe(false);
    expect(cronAuthorized("Bearer ", "")).toBe(false);
    expect(cronAuthorized("Bearer undefined", undefined)).toBe(false);
  });
});

describe("shared PokéConnections puzzles: no links in their names", () => {
  const id = (name: string) => {
    const f = FACTS.find((x) => x.name === name);
    if (!f) throw new Error(name);
    return f.id;
  };
  const groups = (first: string): CustomGroupInput[] => [
    { name: first, level: 0, members: ["Snorlax", "Psyduck", "Slowpoke", "Drowzee"].map(id) },
    { name: "Pays attention", level: 1, members: ["Meowth", "Abra", "Pikachu", "Eevee"].map(id) },
    { name: "Rocky road", level: 2, members: ["Onix", "Geodude", "Machop", "Zubat"].map(id) },
    { name: "Odd ones out", level: 3, members: ["Ditto", "Mewtwo", "Lugia", "Magikarp"].map(id) },
  ];

  it("refuses a group or title that carries a link", () => {
    expect(validateCustom({ groups: groups("free stuff at scam.com") }).join(" ")).toMatch(/can't hold a link/);
    expect(validateCustom({ groups: groups("join discord.gg/abc") }).join(" ")).toMatch(/can't hold a link/);
    expect(validateCustom({ title: "Visit www.example.net", groups: groups("Sleepy and lazy") }).join(" ")).toMatch(/can't hold a link/);
  });

  it("keeps everyday names, Pokémon with dots in them among them", () => {
    expect(validateCustom({ groups: groups("Sleepy and lazy") })).toEqual([]);
    expect(validateCustom({ groups: groups("Friends of Mr. Mime") })).toEqual([]);
    expect(validateCustom({ title: "Gen 1 vs. Gen 2: who's who?", groups: groups("Fire/Water") })).toEqual([]);
  });
});

describe("per-address caps on score submissions tolerate a shared address (CGNAT)", () => {
  const post = (handler: (r: NextRequest) => Promise<Response>, url: string, ip: string) =>
    handler(
      new NextRequest(url, {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": ip },
        body: JSON.stringify({ resultToken: "not-a-real-token", playerName: "Ash" }),
      })
    );

  it("is at least 25 a minute for gameplay writes", () => {
    expect(GAMEPLAY_IP_LIMIT[0]).toBeGreaterThanOrEqual(25);
    expect(GAMEPLAY_IP_LIMIT[1] * 60).toBeGreaterThanOrEqual(25);
  });

  it("lets 25 players behind one address post a Daily Challenge score in the same minute, then slows the address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 26; i++) statuses.push((await post(postLeaderboard, "http://localhost:3000/api/leaderboard", "100.64.0.1")).status);
    expect(statuses.slice(0, 25)).not.toContain(429);
    expect(statuses[25]).toBe(429);
  });

  it("and a PokéGuessr score", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await post(postGeoLeaderboard, "http://localhost:3000/api/geo/leaderboard", "100.64.0.2")).status);
    expect(statuses).not.toContain(429);
  });
});

/** Every source file under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("static guards", () => {
  it("the service-role client can't be bundled for the browser", () => {
    expect(readFileSync(path.join(ROOT, "src/lib/supabase.ts"), "utf8").startsWith('import "server-only";')).toBe(true);
  });

  it("every inline script escapes `<` (no raw JSON.stringify into HTML)", () => {
    const offenders = sources(path.join(ROOT, "src")).filter((f) => /dangerouslySetInnerHTML=\{\{\s*__html:\s*JSON\.stringify\(/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("migration 0056 locks the public schema to the service role", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/0056_launch_lockdown.sql"), "utf8");
    for (const policy of ["anyone can read runs", "anyone can read geo runs", "profile_about is public"]) expect(sql).toContain(`drop policy if exists "${policy}"`);
    expect(sql).toContain("revoke all on all tables in schema public from anon, authenticated;");
    expect(sql).toContain("revoke all on all sequences in schema public from anon, authenticated;");
    expect(sql).toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect(sql).toMatch(/alter default privileges in schema public revoke all on tables from anon, authenticated/);
    expect(sql).toMatch(/key not like 'board:%' and key not like 'email-confirm:%'/);
  });

  it("no later migration grants the public roles anything again", () => {
    const dir = path.join(ROOT, "supabase/migrations");
    const later = readdirSync(dir).filter((f) => f > "0056");
    for (const f of later) expect(readFileSync(path.join(dir, f), "utf8")).not.toMatch(/grant\s+(?!execute[^;]*to service_role)[^;]*\bto\s+(anon|authenticated|public)\b/i);
  });
});
