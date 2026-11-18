import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { notifyReport, reportMessage, REPORT_MAILS_PER_WINDOW } from "@/lib/server/email/report-mail";

const ENV = ["RESEND_API_KEY", "EMAIL_FROM", "POKEIQ_SECRET", "EMAIL_TEST_CAPTURE", "REPORT_EMAIL_TO"] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
let dir = "";
let file = "";

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = mkdtempSync(path.join(tmpdir(), "report-mail-"));
  file = path.join(dir, "mail.jsonl");
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "hello@example.com";
  process.env.POKEIQ_SECRET = "test-secret-at-least-16-chars";
  process.env.EMAIL_TEST_CAPTURE = file;
  delete process.env.REPORT_EMAIL_TO;
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

const sent = () => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
// Each test uses its own 6-hour window so the claims of one don't leak into the next.
let clock = Date.parse("2030-01-01T00:00:00Z");
const nextWindow = () => (clock += 7 * 60 * 60 * 1000);

describe("report emails", () => {
  it("a bug report is emailed to the owner with the page, the reporter and the message", async () => {
    const ok = await notifyReport({ kind: "feedback", category: "bug", message: "the map is cut off", page: "/pokeguessr", reporter: "Ash", contact: "ash@example.com" }, nextWindow());
    expect(ok).toBe(true);
    const [m] = sent();
    expect(m.to).toEqual(["pokeiq.official@gmail.com"]);
    expect(m.subject).toBe("[PokéIQ] Bug report: the map is cut off");
    expect(m.text).toContain("Page: /pokeguessr");
    expect(m.text).toContain("From: Ash, contact: ash@example.com");
    expect(m.text).toContain("the map is cut off");
  });

  it("goes to REPORT_EMAIL_TO when it is set", async () => {
    process.env.REPORT_EMAIL_TO = "me@example.com";
    await notifyReport({ kind: "feedback", category: "idea", message: "add a mode" }, nextWindow());
    expect(sent()[0].to).toEqual(["me@example.com"]);
  });

  it("browser errors never send an email", async () => {
    expect(await notifyReport({ kind: "error", message: "TypeError" }, nextWindow())).toBe(false);
    expect(sent()).toHaveLength(0);
  });

  it("sends nothing while the email service isn't set up", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await notifyReport({ kind: "feedback", message: "hi" }, nextWindow())).toBe(false);
    expect(sent()).toHaveLength(0);
  });

  it("at most REPORT_MAILS_PER_WINDOW emails in a 6-hour window, then it stops", async () => {
    const at = nextWindow();
    for (let i = 0; i < REPORT_MAILS_PER_WINDOW + 5; i++) await notifyReport({ kind: "feedback", message: `report ${i}` }, at);
    expect(sent()).toHaveLength(REPORT_MAILS_PER_WINDOW);
    // The next window has room again.
    expect(await notifyReport({ kind: "feedback", message: "later" }, at + 7 * 60 * 60 * 1000)).toBe(true);
  });

  it("the message is escaped in the HTML and can't break the subject line", () => {
    const m = reportMessage({ kind: "chat", message: "<script>alert(1)</script>\nBcc: x@y.z" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.subject).not.toMatch(/\n/);
    expect(m.subject.startsWith("[PokéIQ] Reported chat message:")).toBe(true);
  });
});
