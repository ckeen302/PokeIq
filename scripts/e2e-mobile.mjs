/**
 * Phone layout (390 × 844, touch): on the key routes, nothing scrolls sideways
 * and, at the bottom of each page, no button, link or line of text is left
 * under the bottom tab bar where it could never be scrolled into view. The
 * game pop-ups open over the tab bar, not under it. The phone design system
 * holds (labels 12px and up, 16px fields so iOS doesn't zoom, 40px toggles),
 * and a few in-game states stay fixed (sheet titles, the quiz's Next button,
 * the encounter table).
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
function layoutProblems(phoneWidth) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out = [];
  // A page wider than the phone is zoomed out to fit, and innerWidth grows with it: compare with the phone's own width.
  const wide = Math.max(vw, document.documentElement.scrollWidth);
  if (wide > (phoneWidth ?? vw) + 1) out.push(`scrolls sideways (${wide}px wide)`);
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

/** Runs in the page: the phone design system's floors (type 12px for labels, 16px fields, thumb-sized toggles). */
function designProblems() {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("main *, footer *")) {
    if (el.closest(".mp-dense, svg, [aria-hidden='true'], [data-testid='tabbar']")) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || s.visibility === "hidden" || s.display === "none") continue;
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const size = parseFloat(s.fontSize);
    const what = `<${el.tagName.toLowerCase()}> "${(el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 30)}"`;
    const push = (msg) => !seen.has(msg) && (seen.add(msg), out.push(msg));
    if (text && size < 11.5) push(`text too small to read (${size}px): ${what}`);
    if (el.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), select, textarea") && size < 16) push(`field under 16px (${size}px), iOS zooms in on it: ${what}`);
    if (el.matches("main button[aria-pressed], main [role=tab], main [role=radio]") && r.height < 39.5) push(`toggle too small to tap (${Math.round(r.height)}px tall): ${what}`);
  }
  return out.slice(0, 5);
}

export async function runMobile({ browser, BASE, OUT, errors, step }) {
  step("phone layout: no sideways scroll and nothing under the tab bar on the key routes; pop-ups cover the tab bar");
  const width = Number(process.env.MOBILE_WIDTH || 390);
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
      for (const problem of await page.evaluate(designProblems)) errors.push(`phone ${path}: ${problem}`);
      // To the real bottom: lists that load more as they scroll (the Pokédex) only count once they stop growing.
      let settled = false;
      for (let i = 0; i < 6 && !settled; i++) {
        const before = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(700);
        settled = before === (await page.evaluate(() => document.documentElement.scrollHeight));
      }
      for (const problem of await page.evaluate(layoutProblems, width)) {
        if (settled || problem.startsWith("scrolls sideways")) errors.push(`phone ${path}: ${problem}`);
      }
    } catch (e) {
      errors.push(`phone ${path}: ${e.message.split("\n")[0]}`);
    }
  }
  await phoneStates(page, BASE, errors, step);
  await paintsBeforeScripts(browser, BASE, errors, step, width);
  await narrowPhone(browser, BASE, errors, step);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.goto(`${BASE}/pokedex`, { waitUntil: "load" });
  await page.screenshot({ path: `${OUT}/phone-pokedex.png` });
  await context.close();
}

/** In-game states on a phone that once went wrong. */
async function phoneStates(page, BASE, errors, step) {
  step("phone states: sheet titles, the quiz's Next button, the encounter table, the type chart, Pokédle's demo");
  const settle = async (path) => {
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  };
  try {
    // A bottom sheet's pinned title must not cover its first line (Pikadoku's picker, the how-tos).
    await settle("/pikadoku");
    await page.locator("main button").filter({ hasText: "+" }).first().click();
    await page.getByTestId("pdk-search").waitFor();
    await page.waitForTimeout(600);
    const cover = await page.evaluate(() => {
      const d = document.querySelector("[role=dialog]");
      return d.firstElementChild.getBoundingClientRect().bottom - d.querySelector("label").getBoundingClientRect().top;
    });
    if (cover > 1) errors.push(`phone /pikadoku: the picker's title covers the search field by ${Math.round(cover)}px`);
  } catch (e) {
    errors.push(`phone /pikadoku picker: ${e.message.split("\n")[0]}`);
  }
  try {
    // Pokédle with the Pokédex notebook on: its header and filters wrap, so the page stays the phone's width
    // (a too-wide row makes a phone lay the whole page out wider and zoom it out), and the hint chips are thumb-sized.
    await settle("/pokedle");
    const phoneWidth = page.viewportSize().width;
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const level of [/^Notebook/, /^Full Pokédex/]) {
      await page.getByRole("radiogroup", { name: "Pokédex assist", exact: true }).getByRole("radio", { name: level }).click();
      await page.getByLabel("Search the Pokédex").waitFor();
      await page.waitForTimeout(400);
      const wide = await page.evaluate(() => Math.max(window.innerWidth, document.documentElement.scrollWidth));
      if (wide > phoneWidth + 1) errors.push(`phone /pokedle: the page is ${wide}px wide with the ${level.source.slice(1)} Pokédex on`);
    }
    await page.keyboard.press("Escape");
    const chips = await page.getByTestId("hints").locator("button").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h > 0));
    if (!chips.length || chips.some((h) => h < 40)) errors.push(`phone /pokedle: the hint chips are too small to tap (${chips.join(", ")}px tall)`);
    await page.evaluate(() => localStorage.removeItem("pokeiq:pokedle-prefs:v1"));
    // PokéConnections: Submit is docked above the tab bar from the first screen, before any scrolling.
    await settle("/connections");
    await page.getByTestId("conn-tile").first().waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    const gap = await page.getByTestId("conn-submit").evaluate((b) => document.querySelector('nav[aria-label="Primary"]').getBoundingClientRect().top - b.getBoundingClientRect().bottom);
    if (gap < 0) errors.push(`phone /connections: Submit starts ${Math.round(-gap)}px under the tab bar`);
    // Pikadoku's More row (difficulty, Weekly, Archive) is thumb-sized too.
    await settle("/pikadoku");
    await page.getByTestId("pdk-more").click();
    const more = await page.locator('[data-testid="pdk-more"], [data-testid="pdk-mode-weekly"], [data-testid="pdk-archive-btn"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    if (more.length !== 3 || more.some((h) => h < 40)) errors.push(`phone /pikadoku: the More controls are too small to tap (${more.join(", ")}px tall)`);
  } catch (e) {
    errors.push(`phone dailies: ${e.message.split("\n")[0]}`);
  }
  try {
    // After an answer, Next question is on screen above the tab bar without scrolling.
    await settle("/quiz/whos-that-pokemon");
    await page.getByRole("button", { name: /^Start/ }).click();
    await page.locator("main [data-answer-tile]").first().click({ timeout: 15_000 });
    const next = page.getByRole("button", { name: /Next question|See results/ });
    await next.waitFor();
    await page.waitForTimeout(800);
    const gap = await next.evaluate((b) => document.querySelector('nav[aria-label="Primary"]').getBoundingClientRect().top - b.getBoundingClientRect().bottom);
    if (gap < 0) errors.push("phone quiz: Next question sits under the tab bar after an answer");
  } catch (e) {
    errors.push(`phone quiz Next: ${e.message.split("\n")[0]}`);
  }
  try {
    // Where to find it: rows stack on a phone instead of scrolling sideways.
    await settle("/pokemon/pikachu");
    const wide = await page.evaluate(() => [...document.querySelectorAll("[id^=enc-gen-]")].filter((t) => t.scrollWidth > t.clientWidth + 1).length);
    if (wide) errors.push(`phone /pokemon/pikachu: ${wide} encounter table(s) scroll sideways`);
  } catch (e) {
    errors.push(`phone encounters: ${e.message.split("\n")[0]}`);
  }
  try {
    // Pokédle's how-to demo keeps one height as its guesses play out, so the sheet doesn't jump on a phone.
    await page.evaluate(() => localStorage.removeItem("pokeiq:pokedle-prefs:v1"));
    await settle("/pokedle");
    const demo = page.getByTestId("howto-demo").first();
    await demo.waitFor();
    const heights = new Set();
    for (let i = 0; i < 24; i++) {
      heights.add(Math.round(await demo.evaluate((d) => d.getBoundingClientRect().height)));
      await page.waitForTimeout(400);
    }
    if (heights.size > 1) errors.push(`phone /pokedle: the how-to demo changes height as it plays (${[...heights].join(", ")}px)`);
    await page.getByTestId("howto-never").click();
  } catch (e) {
    errors.push(`phone Pokédle demo: ${e.message.split("\n")[0]}`);
  }
  try {
    // The type chart's row names (ELECTRIC, FIGHTING) fit their label at the phone's 12px type.
    await settle("/pokedex/types");
    const cut = await page.evaluate(() => [...document.querySelectorAll('[data-testid="type-chart"] tbody th a')].filter((a) => a.scrollWidth > a.clientWidth + 1).map((a) => a.textContent));
    if (cut.length) errors.push(`phone /pokedex/types: type names cut off in the chart (${cut.join(", ")})`);
  } catch (e) {
    errors.push(`phone type chart: ${e.message.split("\n")[0]}`);
  }
}

/**
 * On a slow phone the scripts arrive seconds after the page: what a visitor came for must
 * show without them (no entrance animation that waits on the scripts to make it visible).
 */
async function paintsBeforeScripts(browser, BASE, errors, step, width) {
  step("phone, before the scripts load: the game modes, a quiz's setup and the PokéIQ Test's start show");
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, javaScriptEnabled: false });
  const page = await context.newPage();
  for (const [path, text] of [["/play", "Who's That Pokémon?"], ["/quiz/whos-that-pokemon", "Start Who's That"], ["/iq-test", "Start the test"]]) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      const opacity = await page.locator("main").getByText(text, { exact: false }).first().evaluate((el) => {
        let o = 1;
        for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
        return o;
      });
      if (opacity < 0.99) errors.push(`phone ${path}: "${text}" stays hidden until the scripts load (opacity ${opacity})`);
    } catch (e) {
      errors.push(`phone ${path} without scripts: ${e.message.split("\n")[0]}`);
    }
  }
  await context.close();
}

/**
 * A 360 px Android: nothing may be wider than the screen, or the phone lays the
 * page out wider and zooms it all out (innerWidth grows with it, so the check
 * is against the phone's width, not innerWidth).
 */
async function narrowPhone(browser, BASE, errors, step) {
  step("phone at 360 px: the Pokédex entry and the rankings fit the screen");
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  const page = await context.newPage();
  for (const path of ["/pokemon/charizard", "/pokedex/rankings"]) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(1000);
      const wide = await page.evaluate(() => Math.max(window.innerWidth, document.documentElement.scrollWidth));
      if (wide > 361) errors.push(`phone 360 ${path}: laid out ${wide}px wide, so the phone zooms the page out`);
    } catch (e) {
      errors.push(`phone 360 ${path}: ${e.message.split("\n")[0]}`);
    }
  }
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
