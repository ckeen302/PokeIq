/**
 * Accessibility check for the daily games and quizzes: runs axe-core on each page
 * (dark and light theme) and fails on critical issues. Serious issues are printed
 * as warnings so they stay visible without blocking.
 *
 *   node scripts/e2e-a11y.mjs [baseUrl]
 */
import { chromium } from "playwright";
import fs from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

export const A11Y_ROUTES = ["/pokedle", "/connections", "/pikadoku", "/guessr", "/daily", "/quiz/pokemon-trivia-quiz", "/quiz/which-pokemon", "/quiz/name-em-all", "/iq-test"];

export async function runA11y({ browser, BASE, errors, step }) {
  step("accessibility: axe-core finds no critical issues on the daily games and quizzes (dark and light)");
  for (const light of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (light) await context.addInitScript(() => { try { localStorage.setItem("pokeiq-theme", "light"); } catch {} });
    const page = await context.newPage();
    for (const path of A11Y_ROUTES) {
      await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      await page.locator("main").first().waitFor();
      await page.waitForTimeout(1500);
      await page.addScriptTag({ content: AXE });
      const { violations } = await page.evaluate(() => axe.run(document, { resultTypes: ["violations"] }));
      for (const v of violations) {
        const line = `a11y ${path} (${light ? "light" : "dark"}): ${v.id} (${v.impact}) on ${v.nodes.length} element(s), e.g. ${v.nodes[0].target.join(" ").slice(0, 120)}`;
        if (v.impact === "critical") errors.push(line);
        else if (v.impact === "serious") console.log(`  warning: ${line}`);
      }
    }
    await context.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  await runA11y({ browser, BASE, errors, step: (s) => console.log(`\n== ${s}`) });
  await browser.close();
  for (const e of errors) console.error(e);
  console.log(errors.length ? `${errors.length} critical issue(s)` : "no critical issues");
  process.exit(errors.length ? 1 : 0);
}
