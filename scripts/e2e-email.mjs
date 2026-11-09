/**
 * Daily reminder emails, end to end (called from e2e-smoke.mjs).
 *
 * 1. Against the server under test, with email switched off (no Resend key):
 *    nothing shows and every email endpoint is a 404 or a no-op.
 * 2. A second server on the same build with email switched on in test
 *    capture mode (EMAIL_TEST_CAPTURE: mail goes to a file, never to
 *    Resend): a guest's nudge after a daily, sign up with an email and the
 *    box ticked, the confirm link, the Settings toggles, the cron run, the
 *    captured email, a re-run that sends nothing, then unsubscribe.
 *
 *   node scripts/e2e-email.mjs [baseUrl]
 */
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOWTO = '[data-testid="howto-sheet"], [data-testid="pdk-howto"]';
const CRON = "e2e-cron-secret";

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

async function waitUp(url, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await fetch(url).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${url} didn't start`);
}

function readCapture(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function closeHowTo(p) {
  const sheet = p.locator(HOWTO).first();
  if (await sheet.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false)) {
    await p.getByTestId("howto-never").click();
    await sheet.waitFor({ state: "hidden" });
  }
}

const NAMES = ["Pikachu", "Charizard", "Gengar", "Snorlax", "Lucario", "Eevee", "Mewtwo", "Bulbasaur", "Squirtle", "Jigglypuff", "Magikarp", "Dragonite"];

/** Plays today's Pokédle to the end (solved or out of guesses). */
async function finishPokedle(p, base) {
  await p.goto(`${base}/pokedle`, { waitUntil: "load" });
  await closeHowTo(p);
  const result = p.locator('section[aria-label="Result"]');
  for (const name of NAMES) {
    if (await result.count()) break;
    const box = p.getByLabel("Guess a Pokémon");
    if (!(await box.isEnabled().catch(() => false))) break;
    await box.fill(name);
    await p.getByRole("option").first().click();
    await p.waitForTimeout(1400);
  }
  await result.waitFor({ timeout: 15_000 });
  await p.waitForTimeout(1500);
}

export async function runEmail({ browser, BASE, OUT, errors, step, shotsDir }) {
  const shots = shotsDir ?? OUT;
  fs.mkdirSync(shots, { recursive: true });
  const newPage = async (base, viewport = { width: 1440, height: 900 }) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
    const page = await context.newPage();
    page.on("pageerror", (err) => errors.push(`[email ${page.url()}] PAGEERROR: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push(`[email ${page.url()}] ${msg.text()}`);
    });
    return page;
  };
  /** The same screen at 1440 and at 390 (no sideways scroll on the phone). */
  const both = async (p, name, prepare) => {
    await p.setViewportSize({ width: 1440, height: 900 });
    if (prepare) await prepare();
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${shots}/${name}-1440.png`, fullPage: false });
    await p.setViewportSize({ width: 390, height: 844 });
    if (prepare) await prepare();
    await p.waitForTimeout(400);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) errors.push(`email: ${name} scrolls sideways at 390 (${wide}px)`);
    await p.screenshot({ path: `${shots}/${name}-390.png`, fullPage: false });
    await p.setViewportSize({ width: 1440, height: 900 });
  };

  /** Scrolls a control to the middle of the screen, clear of the phone tab bar. */
  const center = (loc) => loc.evaluate((el) => el.scrollIntoView({ block: "center" }));

  // ---------------------------------------------------------------------------
  // 1. Switched off
  // ---------------------------------------------------------------------------
  const me = await (await fetch(`${BASE}/api/auth/me`)).json();
  if (me.emailEnabled) {
    step("email: the server under test has email switched on, skipping the switched-off checks");
  } else {
    step("email: switched off, nothing shows and nothing sends");
    for (const [method, url] of [
      ["GET", "/api/email/settings"],
      ["PUT", "/api/email/settings"],
      ["POST", "/api/email/confirm"],
      ["GET", "/api/email/daily-image?date=2026-11-08"],
      ["POST", "/api/email/test"],
    ]) {
      const res = await fetch(`${BASE}${url}`, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
      if (res.status !== 404) errors.push(`email off: ${method} ${url} returned ${res.status}, expected 404`);
    }
    const cron = await (await fetch(`${BASE}/api/cron/daily-email`, { headers: { Authorization: `Bearer ${CRON}` } })).json();
    if (!cron.skipped) errors.push(`email off: the cron didn't skip: ${JSON.stringify(cron)}`);
    if (me.enabled) {
      const p = await newPage(BASE);
      await p.goto(`${BASE}/login?signup=1`, { waitUntil: "load" });
      await p.getByRole("tab", { name: "Create account", selected: true }).waitFor();
      await p.waitForTimeout(800);
      if (await p.getByTestId("signup-email").count()) errors.push("email off: the sign-up form shows the email box");
      await p.context().close();
    }
  }
  if (!me.enabled) return step("email: accounts are off on this server, skipping the switched-on flow");

  // ---------------------------------------------------------------------------
  // 2. Switched on, mail captured to a file
  // ---------------------------------------------------------------------------
  step("email: switched on (test capture), sign up -> confirm -> settings -> cron -> captured -> unsubscribe");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const capture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pokeiq-mail-")), "mail.jsonl");
  const server = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: {
      ...process.env,
      POKEIQ_SECRET: process.env.POKEIQ_SECRET || "ci-only-secret-not-used-anywhere-else",
      POKEIQ_LOCAL_ACCOUNTS: "1",
      RESEND_API_KEY: "re_e2e_not_a_real_key",
      EMAIL_FROM: "daily@playpokeiq.com",
      EMAIL_TEST_CAPTURE: capture,
      EMAIL_SITE_URL: base,
      EMAIL_POSTAL_ADDRESS: "",
      CRON_SECRET: CRON,
    },
    stdio: ["ignore", "ignore", "pipe"],
    // Its own process group, so stopping it stops every process it started.
    detached: true,
  });
  let serverErr = "";
  server.stderr.on("data", (d) => (serverErr = (serverErr + d).slice(-4000)));
  try {
    await waitUp(`${base}/api/auth/me`);
    const on = await (await fetch(`${base}/api/auth/me`)).json();
    if (!on.emailEnabled) throw new Error("the capture server didn't switch email on");

    // A guest finishing a daily sees the nudge.
    const guest = await newPage(base);
    await finishPokedle(guest, base);
    const nudge = guest.getByTestId("daily-email-nudge");
    await nudge.waitFor({ timeout: 10_000 });
    if (!/Sign up to get the daily in your inbox/.test(await nudge.innerText())) errors.push("email: the guest nudge has the wrong words");
    await both(guest, "email-guest-nudge", () => center(nudge));
    await guest.context().close();

    // Sign up with an email, the box unticked until ticked.
    const p = await newPage(base);
    const username = `mail_${Date.now().toString(36)}`;
    const address = `${username}@example.com`;
    await p.goto(`${base}/login?signup=1`, { waitUntil: "load" });
    await p.getByRole("tab", { name: "Create account", selected: true }).waitFor();
    const box = p.getByTestId("signup-daily-email");
    await box.waitFor();
    if (await box.isChecked()) errors.push("email: the sign-up box starts ticked");
    await p.getByLabel("Trainer name").fill(username);
    await p.getByLabel("Password").fill("correct horse battery");
    await p.getByTestId("signup-email-input").fill(address);
    await box.check();
    await both(p, "email-signup-checkbox", async () => {
      if ((await p.evaluate(() => window.innerWidth)) < 500) {
        const fs390 = await p.getByTestId("signup-email-input").evaluate((el) => getComputedStyle(el).fontSize);
        if (fs390 !== "16px") errors.push(`email: the sign-up email field is ${fs390} on a phone, not 16px`);
      }
      await center(p.getByTestId("signup-email"));
    });
    await p.getByRole("button", { name: "Create account" }).click();
    await p.getByLabel("I saved my recovery code somewhere safe").check();
    await p.getByRole("button", { name: "Continue" }).click();
    await p.waitForURL(/\/trainer/);

    // The confirmation email, and nothing daily before it's opened.
    const confirmMail = readCapture(capture).find((m) => m.to[0] === address && /Confirm your email/.test(m.subject));
    if (!confirmMail) throw new Error("no confirmation email was captured");
    const early = await (await fetch(`${base}/api/cron/daily-email`, { headers: { Authorization: `Bearer ${CRON}` } })).json();
    if (readCapture(capture).some((m) => m.to[0] === address && /dailies are live/.test(m.subject))) errors.push(`email: a daily email went out before the address was confirmed (${JSON.stringify(early)})`);
    const confirmUrl = confirmMail.text.match(/https?:\/\/\S+\/email\/confirm\?token=\S+/)?.[0];
    if (!confirmUrl) throw new Error("the confirmation email has no link");
    await p.goto(confirmUrl, { waitUntil: "load" });
    await p.locator('[data-testid="email-confirm"][data-status="done"]').waitFor();

    // Settings: on, the address confirmed, "streak at risk" and back, off and on.
    await p.goto(`${base}/trainer#settings`, { waitUntil: "load" });
    const settings = p.getByTestId("email-settings");
    await settings.getByTestId("email-address").filter({ hasText: `Sending to ${address}` }).waitFor();
    const toggle = settings.getByTestId("email-daily-toggle");
    if ((await toggle.locator("[aria-pressed=true]").getAttribute("data-value")) !== "on") errors.push("email: the ticked sign-up box didn't turn the emails on");
    await settings.getByTestId("email-streak-toggle").locator('[data-value="streak"]').click();
    await settings.getByTestId("email-streak-toggle").locator('[data-value="streak"][aria-pressed=true]').waitFor();
    await settings.getByTestId("email-streak-toggle").locator('[data-value="daily"]').click();
    await settings.getByTestId("email-streak-toggle").locator('[data-value="daily"][aria-pressed=true]').waitFor();
    await toggle.locator('[data-value="off"]').click();
    await toggle.locator('[data-value="off"][aria-pressed=true]').waitFor();
    await toggle.locator('[data-value="on"]').click();
    await toggle.locator('[data-value="on"][aria-pressed=true]').waitFor();
    await both(p, "email-settings-toggle", () => center(settings));

    // The cron run: Vercel's Bearer secret, one email, and a re-run sends nothing.
    if ((await fetch(`${base}/api/cron/daily-email`, { headers: { Authorization: "Bearer wrong" } })).status !== 401) errors.push("email: the cron ran with a wrong secret");
    const run = await (await fetch(`${base}/api/cron/daily-email`, { headers: { Authorization: `Bearer ${CRON}` } })).json();
    if (!(run.sent >= 1)) errors.push(`email: the cron sent nothing: ${JSON.stringify(run)}`);
    const daily = readCapture(capture).filter((m) => m.to[0] === address && /dailies are live/.test(m.subject));
    if (daily.length !== 1) errors.push(`email: ${daily.length} daily emails captured for the trainer, expected 1`);
    const again = await (await fetch(`${base}/api/cron/daily-email`, { headers: { Authorization: `Bearer ${CRON}` } })).json();
    if (again.sent !== 0) errors.push(`email: a second cron run the same day sent again: ${JSON.stringify(again)}`);
    const mail = daily[0];
    if (mail) {
      const unsub = mail.headers?.["List-Unsubscribe"]?.replace(/^<|>$/g, "");
      if (!unsub || mail.headers["List-Unsubscribe-Post"] !== "List-Unsubscribe=One-Click") errors.push("email: the daily email lacks the List-Unsubscribe headers");
      if (!mail.html.includes("Unsubscribe") || !mail.text.includes("Unsubscribe:")) errors.push("email: the daily email has no unsubscribe link");
      if (!mail.text) errors.push("email: the daily email has no plain-text part");
      // The email itself, as an inbox would draw it.
      const view = await newPage(base);
      await view.setContent(mail.html, { waitUntil: "load" });
      await view.waitForTimeout(800);
      const img = await view.evaluate(() => document.images[0]?.naturalWidth ?? 0);
      if (!img) errors.push("email: the daily email's picture didn't load");
      await both(view, "email-daily-html");
      await view.context().close();

      // Unsubscribe from the link in the email.
      await p.goto(unsub, { waitUntil: "load" });
      await p.locator('[data-testid="email-unsubscribe"][data-status="done"]').waitFor();
      await p.screenshot({ path: `${shots}/email-unsubscribed-1440.png` });
      const after = await (await p.request.get(`${base}/api/auth/me`)).json();
      if (after.dailyEmail) errors.push("email: still subscribed after unsubscribing");
      // RFC 8058 one-click: a mail app POSTs to the header's URL.
      const oneClick = await fetch(unsub.replace("/email/unsubscribe", "/api/email/unsubscribe"), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      });
      if (oneClick.status !== 200) errors.push(`email: one-click unsubscribe returned ${oneClick.status}`);
    }
    await p.context().close();
  } catch (err) {
    errors.push(`email flow: ${err instanceof Error ? err.message : err}${serverErr ? `\n${serverErr}` : ""}`);
  } finally {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
    fs.rmSync(path.dirname(capture), { recursive: true, force: true });
  }
}

// Run on its own: node scripts/e2e-email.mjs [baseUrl]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const OUT = "e2e-screenshots";
  const errors = [];
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await runEmail({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`), shotsDir: process.env.EMAIL_SHOTS || OUT });
  await browser.close();
  if (errors.length) {
    console.error(`✗ ${errors.length} error(s):`);
    errors.forEach((e) => console.error("  ", e));
    process.exit(1);
  }
  console.log("✓ email e2e passed");
}
