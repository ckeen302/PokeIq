/**
 * An empty queue still leads to a battle: on the battle home, search for an
 * OU opponent with a quick team while nobody else is searching, wait out the
 * 20 s until the box offers the other ways in, then take "Battle the
 * computer" and check the battle starts against the computer with the same
 * team. The second part checks "Copy a friend link" opens a lobby. Shots at
 * 1440 and 390 px. Each part records a failure instead of stopping the rest.
 *
 *   node scripts/e2e-battle-queue.mjs http://localhost:3000 [screenshot dir]
 */
import fs from "fs";

/** The fallback shows after 20 s of searching (QUEUE_FALLBACK_MS in BattleHome.tsx), plus a poll's slack. */
const FALLBACK_WAIT = 30_000;

async function part(errors, name, fn) {
  try {
    await fn();
  } catch (e) {
    errors.push(`battle queue (${name}): ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

async function openHome(browser, BASE, viewport, errors, label) {
  const context = await browser.newContext({ viewport });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => undefined);
  await context.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    localStorage.setItem("pokeiq-muted", "1");
    localStorage.setItem("pokeiq:battle:animations", "off");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on("pageerror", (err) => errors.push(`[${label} ${page.url()}] PAGEERROR: ${err.message}`));
  await page.goto(`${BASE}/battle`, { waitUntil: "networkidle" });
  const trainer = page.getByLabel("Your trainer name");
  if (!(await trainer.isVisible().catch(() => false))) await page.getByRole("button", { name: /change/ }).click();
  await page.getByLabel("Your trainer name").fill(label);
  return page;
}

/** Picks a format from the format menu by its label. */
async function pickFormat(page, name) {
  await page.getByTestId("format-picker").click();
  await page.getByRole("option", { name, exact: true }).first().click();
}

async function noSideways(page, errors, where) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (over) errors.push(`battle queue: ${where} scrolls sideways at ${page.viewportSize().width} px`);
}

export async function runEmptyQueue({ browser, BASE, OUT, errors, step }) {
  step("battle home: an empty queue offers the computer after 20 s, with the same team");
  await part(errors, "computer", async () => {
    const page = await openHome(browser, BASE, { width: 1440, height: 900 }, errors, "Lonely");
    await pickFormat(page, "OU");
    await page.getByRole("button", { name: /Quick team/ }).click();
    const sprites = page.getByTestId("quick-team").locator("[aria-label]").first();
    await sprites.waitFor();
    await page.waitForFunction(() => document.querySelector("[data-testid=quick-team] [aria-label]")?.getAttribute("aria-label")?.includes(","));
    const team = (await sprites.getAttribute("aria-label")).split(", ");
    await page.getByTestId("battle-button").click();
    await page.getByTestId("battle-searching").waitFor();
    if (await page.getByTestId("queue-fallback").isVisible()) errors.push("battle queue: the fallback showed before 20 s");
    await page.getByTestId("queue-fallback").waitFor({ timeout: FALLBACK_WAIT });
    const text = await page.getByTestId("queue-fallback").innerText();
    if (!/Nobody.s in .*OU.* right now/.test(text)) errors.push(`battle queue: fallback text "${text.slice(0, 80)}"`);
    await page.screenshot({ path: `${OUT}/battle-queue-fallback-1440.png` });
    await page.getByTestId("queue-fallback-cpu").click();
    await page.waitForURL(/\/battle\/play\/[a-z2-9]{8}$/);
    await page.getByTestId("lead-button").first().waitFor();
    const leads = await page.getByTestId("lead-button").allInnerTexts();
    const shown = leads.map((t) => t.split("\n")[0].trim().toLowerCase());
    const wanted = team.map((s) => s.toLowerCase());
    for (const s of wanted) if (!shown.some((x) => x === s || s.startsWith(x) || x.startsWith(s))) errors.push(`battle queue: ${s} from the quick team is missing in the computer battle (${shown.join(", ")})`);
    await page.screenshot({ path: `${OUT}/battle-queue-cpu-1440.png` });
    await page.context().close();
  });

  step("battle home: an empty queue offers a friend link (390 px)");
  await part(errors, "friend link", async () => {
    const page = await openHome(browser, BASE, { width: 390, height: 844 }, errors, "Alone");
    await pickFormat(page, "Random Doubles");
    await page.getByTestId("battle-button").click();
    await page.getByTestId("queue-fallback").waitFor({ timeout: FALLBACK_WAIT });
    await page.getByTestId("battle-searching").scrollIntoViewIfNeeded();
    await noSideways(page, errors, "the queue fallback");
    await page.screenshot({ path: `${OUT}/battle-queue-fallback-390.png` });
    await page.getByTestId("queue-fallback-invite").click();
    await page.waitForURL(/\/battle\/live\/[a-z2-9]{8}$/);
    const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
    if (copied && !copied.endsWith(new URL(page.url()).pathname)) errors.push(`battle queue: copied "${copied}", expected the lobby link ${page.url()}`);
    await page.screenshot({ path: `${OUT}/battle-queue-invite-390.png` });
    await page.context().close();
  });
}

// Standalone: node scripts/e2e-battle-queue.mjs <base> [shots dir]
if (process.argv[1]?.endsWith("e2e-battle-queue.mjs")) {
  const { chromium } = await import("playwright");
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const OUT = process.argv[3] ?? "e2e-screenshots";
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  await runEmptyQueue({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("ok");
}
