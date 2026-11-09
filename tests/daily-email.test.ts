import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emailEnabled } from "@/lib/server/email/config";
import { confirmToken, unsubscribeToken, verifyConfirmToken, verifyUnsubscribeToken, CONFIRM_TTL_MS } from "@/lib/server/email/tokens";
import { atRiskStreak, pickRecipients, runDailyEmail, streakSourceOf, type DailyDeps, type StreakSource } from "@/lib/server/email/daily";
import { confirmByToken, optInAtSignup, saveSettings, unsubscribeByToken, type ServiceDeps } from "@/lib/server/email/service";
import { sendBatch } from "@/lib/server/email/send";
import { dailyEmail, DAILY_LINKS, type Message } from "@/lib/server/email/templates";
import type { EmailStore, EmailSub } from "@/lib/server/email/store";
import { DailyEmailNudgeView } from "@/components/email/DailyEmailNudge";
import { DailyEmailOptIn } from "@/components/email/DailyEmailOptIn";
import { GET as cronGet } from "@/app/api/cron/daily-email/route";

// The site's Link wants a mounted app router; a plain anchor is enough here.
vi.mock("@/components/ui/Link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) };
});

const ENV = ["RESEND_API_KEY", "EMAIL_FROM", "POKEIQ_SECRET", "CRON_SECRET", "EMAIL_TEST_CAPTURE", "EMAIL_POSTAL_ADDRESS", "EMAIL_SITE_URL"] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  process.env.POKEIQ_SECRET = "test-secret-at-least-16-chars";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

const switchOn = () => {
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "daily@playpokeiq.com";
};

/** An in-memory store, like the file store. */
function memoryStore(rows: EmailSub[] = []): EmailStore & { rows: Map<string, EmailSub> } {
  const map = new Map(rows.map((r) => [r.profileId, { ...r }]));
  return {
    rows: map,
    async get(id) {
      const s = map.get(id);
      return s ? { ...s } : null;
    },
    async save(sub) {
      map.set(sub.profileId, { ...sub });
    },
    async candidates(today) {
      return [...map.values()].filter((s) => s.dailyEmail && s.verifiedAt && s.lastSentOn !== today).map((s) => ({ ...s }));
    },
    async claim(ids, today) {
      const got = ids.filter((id) => map.get(id) && map.get(id)!.lastSentOn !== today);
      for (const id of got) map.get(id)!.lastSentOn = today;
      return got;
    },
    async release(ids, today) {
      for (const id of ids) if (map.get(id)?.lastSentOn === today) map.get(id)!.lastSentOn = null;
    },
  };
}

const sub = (id: string, over: Partial<EmailSub> = {}): EmailSub => ({
  profileId: id,
  email: `${id}@example.com`,
  verifiedAt: "2026-11-01T00:00:00.000Z",
  dailyEmail: true,
  streakNudge: false,
  lastSentOn: null,
  confirmSentAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

const TODAY = "2026-11-08";
const YESTERDAY = "2026-11-07";

describe("the email switch", () => {
  it("is off without a Resend key and a From address", () => {
    expect(emailEnabled()).toBe(false);
    process.env.RESEND_API_KEY = "re_test_key";
    expect(emailEnabled()).toBe(false);
    process.env.EMAIL_FROM = "daily@playpokeiq.com";
    expect(emailEnabled()).toBe(true);
  });

  it("stays off on the public dev secret (links would be forgeable)", () => {
    switchOn();
    process.env.POKEIQ_SECRET = "short";
    expect(emailEnabled()).toBe(false);
  });

  it("gate off: no UI", () => {
    const optIn = renderToStaticMarkup(createElement(DailyEmailOptIn, { enabled: false, value: { email: "", dailyEmail: false }, onChange: () => undefined }));
    expect(optIn).toBe("");
    expect(renderToStaticMarkup(createElement(DailyEmailNudgeView, { emailEnabled: false, signedIn: false, subscribed: false }))).toBe("");
    expect(renderToStaticMarkup(createElement(DailyEmailNudgeView, { emailEnabled: false, signedIn: true, subscribed: false }))).toBe("");
  });

  it("gate on: the nudge for guests and trainers not opted in, never for trainers who are", () => {
    expect(renderToStaticMarkup(createElement(DailyEmailNudgeView, { emailEnabled: true, signedIn: false, subscribed: false }))).toContain("Sign up to get the daily in your inbox");
    expect(renderToStaticMarkup(createElement(DailyEmailNudgeView, { emailEnabled: true, signedIn: true, subscribed: false }))).toContain("/trainer#email");
    expect(renderToStaticMarkup(createElement(DailyEmailNudgeView, { emailEnabled: true, signedIn: true, subscribed: true }))).toBe("");
  });

  it("gate on: the sign-up box starts unticked", () => {
    const html = renderToStaticMarkup(createElement(DailyEmailOptIn, { enabled: true, value: { email: "ash@example.com", dailyEmail: false }, onChange: () => undefined }));
    expect(html).toContain("Email me when new dailies drop");
    expect(html).toContain('value="ash@example.com"');
    expect(html).not.toMatch(/checked/);
  });

  it("gate off: the cron does nothing and sends nothing", async () => {
    process.env.CRON_SECRET = "cron";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await cronGet(new Request("http://x/api/cron/daily-email", { headers: { authorization: "Bearer cron" } }));
    expect(await res.json()).toEqual({ skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("gate on: the cron refuses a wrong secret", async () => {
    switchOn();
    process.env.CRON_SECRET = "cron";
    const res = await cronGet(new Request("http://x/api/cron/daily-email", { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });

  it("gate off: a sign-up's address is ignored and nothing is sent", async () => {
    const send = vi.fn();
    const store = memoryStore();
    const out = await optInAtSignup({ id: "u1", username: "Ash" }, { email: "ash@example.com", dailyEmail: true }, { store, send, now: () => Date.now() });
    expect(out).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(0);
  });
});

describe("tokens", () => {
  it("confirm tokens round-trip, carry the address and expire", () => {
    const now = Date.parse("2026-11-08T08:00:00Z");
    const t = confirmToken("u1", "ash@example.com", now);
    expect(verifyConfirmToken(t, now)).toEqual({ profileId: "u1", email: "ash@example.com" });
    expect(verifyConfirmToken(t, now + CONFIRM_TTL_MS + 1)).toBeNull();
  });

  it("rejects tampered tokens and tokens of another kind", () => {
    const t = unsubscribeToken("u1");
    expect(verifyUnsubscribeToken(t)).toBe("u1");
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "u2" })).toString("base64url");
    expect(verifyUnsubscribeToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${body}.AAAA${sig.slice(4)}`)).toBeNull();
    expect(verifyConfirmToken(t)).toBeNull();
    expect(verifyUnsubscribeToken(confirmToken("u1", "a@b.co"))).toBeNull();
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
  });

  it("a different server secret can't verify", () => {
    const t = unsubscribeToken("u1");
    process.env.POKEIQ_SECRET = "another-secret-of-16-chars";
    expect(verifyUnsubscribeToken(t)).toBeNull();
  });
});

describe("double opt-in and unsubscribe", () => {
  const deps = (store: EmailStore, sent: Message[], now = Date.parse("2026-11-08T10:00:00Z")): ServiceDeps => ({
    store,
    send: async (m) => (sent.push(m), { ok: true }),
    now: () => now,
  });

  it("saving an address sends one confirmation and nothing daily goes out until it's opened", async () => {
    switchOn();
    process.env.EMAIL_SITE_URL = "http://localhost:3999";
    const store = memoryStore();
    const sent: Message[] = [];
    const out = await saveSettings({ id: "u1", username: "Ash" }, { email: " Ash@Example.com ", dailyEmail: true }, deps(store, sent));
    expect(out.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ash@example.com");
    expect(sent[0].subject).toMatch(/Confirm your email/);
    expect(await store.candidates(TODAY)).toHaveLength(0);

    // A second save straight away doesn't mail again.
    await saveSettings({ id: "u1", username: "Ash" }, { resend: true }, deps(store, sent));
    expect(sent).toHaveLength(1);

    const token = new URL(sent[0].text.match(/http\S+/)![0]).searchParams.get("token");
    expect(await confirmByToken(token, { store, now: () => Date.now() })).toBe("confirmed");
    expect(await store.candidates(TODAY)).toHaveLength(1);
  });

  it("a link for an old address can't confirm a new one", async () => {
    switchOn();
    const store = memoryStore();
    const sent: Message[] = [];
    await saveSettings({ id: "u1", username: "Ash" }, { email: "old@example.com", dailyEmail: true }, deps(store, sent));
    const old = confirmToken("u1", "old@example.com");
    await saveSettings({ id: "u1", username: "Ash" }, { email: "new@example.com" }, deps(store, sent, Date.parse("2026-11-08T11:00:00Z")));
    expect(await confirmByToken(old, { store, now: () => Date.now() })).toBe("stale");
    expect((await store.get("u1"))?.verifiedAt).toBeNull();
  });

  it("rejects a bad address", async () => {
    switchOn();
    const out = await saveSettings({ id: "u1", username: "Ash" }, { email: "not an email" }, deps(memoryStore(), []));
    expect(out).toMatchObject({ ok: false, status: 400 });
  });

  it("one-click unsubscribe turns it off, and repeating is fine", async () => {
    const store = memoryStore([sub("u1")]);
    const t = unsubscribeToken("u1");
    expect(await unsubscribeByToken(t, { store, now: () => Date.now() })).toBe(true);
    expect((await store.get("u1"))?.dailyEmail).toBe(false);
    expect(await unsubscribeByToken(t, { store, now: () => Date.now() })).toBe(true);
    expect(await unsubscribeByToken("garbage", { store, now: () => Date.now() })).toBe(false);
    expect(await store.candidates(TODAY)).toHaveLength(0);
  });
});

describe("streaks", () => {
  it("only a streak finished yesterday is at risk, the longest wins", () => {
    const src: StreakSource = {
      daily: { last: YESTERDAY, streak: 3 },
      dle: { last: YESTERDAY, streak: 12 },
      conn: { last: TODAY, streak: 40 },
      pdk: { last: "2026-11-05", streak: 50 },
    };
    expect(atRiskStreak(src, TODAY)).toEqual({ game: "dle", days: 12 });
    expect(atRiskStreak({ conn: { last: TODAY, streak: 5 } }, TODAY)).toBeNull();
    expect(atRiskStreak({ dle: { last: YESTERDAY, streak: "7" } }, TODAY)).toBeNull();
    expect(atRiskStreak(undefined, TODAY)).toBeNull();
  });

  it("reads PokéGuessr's streak from the best map", () => {
    const src = streakSourceOf({ best: { "geo:dailyLast": 20261107, "geo:dailyStreak": 9 } });
    expect(atRiskStreak(src, TODAY)).toEqual({ game: "geo", days: 9 });
  });
});

describe("the daily run", () => {
  const streaks = new Map<string, StreakSource>([
    ["risky", { dle: { last: YESTERDAY, streak: 5 } }],
    ["safe", { dle: { last: TODAY, streak: 5 } }],
  ]);

  function setup(rows: EmailSub[], send?: DailyDeps["send"]) {
    const store = memoryStore(rows);
    const batches: Message[][] = [];
    const deps: DailyDeps = {
      store,
      usernames: async (ids) => new Map(ids.filter((id) => id !== "gone").map((id) => [id, `T-${id}`])),
      streaks: async () => streaks,
      send: send ?? (async (m) => (batches.push(m), { ok: true })),
      sleep: async () => undefined,
      now: () => 0,
    };
    return { store, batches, deps };
  }

  it("picks opted-in, confirmed trainers not sent today, with the streak-only rule", () => {
    const picked = pickRecipients(
      [
        sub("a"),
        sub("unconfirmed", { verifiedAt: null }),
        sub("off", { dailyEmail: false }),
        sub("sent", { lastSentOn: TODAY }),
        sub("sentYesterday", { lastSentOn: YESTERDAY }),
        sub("risky", { streakNudge: true }),
        sub("safe", { streakNudge: true }),
        sub("nostreak", { streakNudge: true }),
      ],
      streaks,
      TODAY
    );
    expect(picked.map((r) => r.sub.profileId)).toEqual(["a", "sentYesterday", "risky"]);
    expect(picked.find((r) => r.sub.profileId === "risky")?.streak).toEqual({ game: "dle", days: 5 });
  });

  it("sends once per day in batches, and a re-run sends nothing", async () => {
    switchOn();
    const rows = Array.from({ length: 5 }, (_, i) => sub(`u${i}`));
    const { batches, deps } = setup([...rows, sub("gone")]);
    const first = await runDailyEmail(TODAY, deps, { batchSize: 2 });
    expect(first).toMatchObject({ sent: 5, eligible: 5 });
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
    const again = await runDailyEmail(TODAY, deps, { batchSize: 2 });
    expect(again.sent).toBe(0);
    expect(batches).toHaveLength(3);
  });

  it("stops cleanly on a send error and releases that batch", async () => {
    switchOn();
    let calls = 0;
    const { store, deps } = setup([sub("u0"), sub("u1"), sub("u2"), sub("u3")], async () => (++calls === 2 ? { ok: false, status: 429, error: "rate limited" } : { ok: true }));
    const out = await runDailyEmail(TODAY, deps, { batchSize: 2 });
    expect(out.sent).toBe(2);
    expect(out.error).toMatch(/429/);
    expect(calls).toBe(2);
    expect((await store.candidates(TODAY)).map((s) => s.profileId).sort()).toEqual(["u2", "u3"]);
  });
});

describe("the email", () => {
  const input = {
    to: "ash@example.com",
    username: "Ash",
    date: TODAY,
    dailyNumber: 23,
    siteUrl: "https://playpokeiq.com",
    imageUrl: "https://playpokeiq.com/api/email/daily-image?date=2026-11-08",
    unsubscribeUrl: "https://playpokeiq.com/email/unsubscribe?token=abc.def",
    settingsUrl: "https://playpokeiq.com/trainer#settings",
    postalAddress: null,
    streak: { game: "dle" as const, days: 12 },
  };

  it("has the unsubscribe link, the one-click headers and a button per daily", () => {
    const m = dailyEmail(input);
    expect(m.subject).toBe("Today's PokéIQ dailies are live");
    expect(m.html).toContain('href="https://playpokeiq.com/email/unsubscribe?token=abc.def"');
    expect(m.text).toContain("Unsubscribe: https://playpokeiq.com/email/unsubscribe?token=abc.def");
    expect(m.headers).toEqual({
      "List-Unsubscribe": "<https://playpokeiq.com/email/unsubscribe?token=abc.def>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    for (const d of DAILY_LINKS) expect(m.html).toContain(`href="https://playpokeiq.com${d.path}"`);
    expect(m.html).toContain("Your 12-day Pokédle streak ends at midnight.");
    expect(m.text).toContain("Your 12-day Pokédle streak ends at midnight.");
    expect(m.html).toContain("Ash");
  });

  it("puts the postal address in the footer only when it's set", () => {
    expect(dailyEmail(input).text).not.toContain("PO Box");
    const m = dailyEmail({ ...input, postalAddress: "PO Box 1, Springfield", streak: null });
    expect(m.html).toContain("PO Box 1, Springfield");
    expect(m.text).toContain("PO Box 1, Springfield");
    expect(m.html).not.toContain("streak ends");
  });

  it("escapes what it puts in the HTML", () => {
    expect(dailyEmail({ ...input, username: "<b>x</b>" }).html).not.toContain("<b>x</b>");
  });
});

describe("sending", () => {
  it("batches go to Resend's batch endpoint with the key and an idempotency key", async () => {
    switchOn();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const m = dailyEmail({ ...{ to: "a@b.co", username: "A", date: TODAY, dailyNumber: 1, siteUrl: "s", imageUrl: "i", unsubscribeUrl: "u", settingsUrl: "t", postalAddress: null, streak: null } });
    expect(await sendBatch([m], { idempotencyKey: "k1", fetchImpl })).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails/batch");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe("k1");
    const body = JSON.parse(init.body as string);
    expect(body[0]).toMatchObject({ from: "PokéIQ <daily@playpokeiq.com>", to: ["a@b.co"], headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
  });

  it("reports a refusal", async () => {
    switchOn();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "nope" }), { status: 422 }));
    expect(await sendBatch([{ to: "a@b.co", subject: "s", html: "h", text: "t" }], { fetchImpl })).toEqual({ ok: false, status: 422, error: "nope" });
  });

  it("test capture writes to a file instead of calling Resend", async () => {
    switchOn();
    const dir = mkdtempSync(path.join(tmpdir(), "pokeiq-email-"));
    process.env.EMAIL_TEST_CAPTURE = path.join(dir, "mail.jsonl");
    const fetchImpl = vi.fn();
    await sendBatch([{ to: "a@b.co", subject: "s", html: "h", text: "t" }], { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(process.env.EMAIL_TEST_CAPTURE, "utf8").trim())).toMatchObject({ to: ["a@b.co"], subject: "s" });
    rmSync(dir, { recursive: true, force: true });
  });
});
