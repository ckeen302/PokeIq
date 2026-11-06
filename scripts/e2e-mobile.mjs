/**
 * Phone layout (390 × 844, touch): on the key routes, nothing scrolls sideways
 * and, at the bottom of each page, no button, link or line of text is left
 * under the bottom tab bar where it could never be scrolled into view. The
 * game pop-ups open over the tab bar, not under it.
 *
 *   node scripts/e2e-mobile.mjs [baseUrl]     # or from e2e-smoke.mjs
 */
import { chromium } from "playwright";

export const MOBILE_ROUTES = [
  "/daily",
  "/pokedle",
  "/guessr",
  "/pikadoku",
  "/connections",
  "/play",
  "/quiz/whos-that-pokemon",
  "/iq-test",
  "/battle",
  "/battle/teams",
  "/battle/calc",
  "/battle/tournaments",
  "/rooms",
  "/leaderboard",
  "/trainer",
  "/login",
  "/pokedex",
  "/pokemon/pikachu",
  "/pokedex/moves",
  "/pokedex/types",
  "/pokedex/trainers",
  "/pokedex/tcg",
  "/atlas",
  "/privacy",
];

/** Runs in the page: what's wrong with the layout at the bottom of the page. */
function layoutProblems() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out = [];
  if (document.documentElement.scrollWidth > vw + 1) out.push(`scrolls sideways (${document.documentElement.scrollWidth}px wide)`);
  const bar = document.querySelector('nav[aria-label="Primary"]');
  if (!bar || getComputedStyle(bar).display === "none") return out;
  const top = bar.getBoundingClientRect().top;
  for (const el of document.querySelectorAll('main *, footer *')) {
    if (el.closest("details:not([open]) > :not(summary)")) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || s.position === "fixed") continue;
    const interactive = el.matches("a[href], button, input, select, textarea");
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!interactive && !text) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.top >= vh || r.bottom <= top + 2) continue;
    const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(top + 1, r.bottom - 2)));
    if (hit && bar.contains(hit)) out.push(`under the tab bar: <${el.tagName.toLowerCase()}> "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40)}"`);
  }
  return out;
}

export async function runMobile({ browser, BASE, OUT, errors, step }) {
  step("phone layout: no sideways scroll and nothing under the tab bar on the key routes; pop-ups cover the tab bar");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    localStorage.setItem("pokeiq-muted", "1");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  for (const path of MOBILE_ROUTES) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      // A game's first-visit how-to: it must sit over the tab bar, then it's closed for the rest of the run.
      const howto = page.locator('[data-testid="howto-sheet"], [data-testid="pdk-howto"]').first();
      if (await howto.waitFor({ state: "visible", timeout: 2_500 }).then(() => true, () => false)) {
        const covered = await page.evaluate(() => {
          const bar = document.querySelector('nav[aria-label="Primary"]').getBoundingClientRect();
          const hit = document.elementFromPoint(bar.left + bar.width / 2, bar.top + bar.height / 2);
          return !document.querySelector('nav[aria-label="Primary"]').contains(hit);
        });
        if (!covered) errors.push(`phone ${path}: the how-to pop-up opens under the tab bar`);
        await page.getByTestId("howto-never").click();
        await howto.waitFor({ state: "hidden" });
      }
      // To the real bottom: lists that load more as they scroll (the Pokédex) only count once they stop growing.
      let settled = false;
      for (let i = 0; i < 6 && !settled; i++) {
        const before = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(700);
        settled = before === (await page.evaluate(() => document.documentElement.scrollHeight));
      }
      for (const problem of await page.evaluate(layoutProblems)) {
        if (settled || problem.startsWith("scrolls sideways")) errors.push(`phone ${path}: ${problem}`);
      }
    } catch (e) {
      errors.push(`phone ${path}: ${e.message.split("\n")[0]}`);
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.goto(`${BASE}/pokedex`, { waitUntil: "load" });
  await page.screenshot({ path: `${OUT}/phone-pokedex.png` });
  await context.close();
}

// Run on its own.
if (import.meta.url === `file://${process.argv[1]}`) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const fs = await import("fs");
  fs.mkdirSync("e2e-screenshots", { recursive: true });
  await runMobile({ browser, BASE, OUT: "e2e-screenshots", errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`\n${errors.length} problem(s):\n${errors.join("\n")}`);
    process.exit(1);
  }
  console.log("phone layout OK");
}
