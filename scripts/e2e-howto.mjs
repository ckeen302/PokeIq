/**
 * The "How to play" pop-ups: every game's is the same card. On a desktop or
 * tablet it's 448px wide and as tall as the others, 680px at most and never
 * taller than the screen less 64px; on a phone it's the screen's width less
 * 16px each side. Its rules scroll inside it (never sideways), and its
 * buttons are on screen without scrolling the page.
 *
 *   node scripts/e2e-howto.mjs [baseUrl]     # or from e2e-smoke.mjs (E2E_ONLY=howto runs just this)
 */
import { chromium } from "playwright";

export const HOWTO_GAMES = ["/pokedle", "/pokeguessr", "/pikadoku", "/pokeconnections"];
const SIZES = [
  [1440, 900, false],
  [1024, 768, false],
  [390, 844, true],
  [360, 740, true],
];
const HOWTO = '[data-testid="howto-sheet"], [data-testid="pdk-howto"]';

/** Runs in the page: the open pop-up's box and what's wrong with it. */
function measureCard(card) {
  const r = card.getBoundingClientRect();
  const body = card.querySelector('[data-testid="howto-body"]');
  const play = card.querySelector('[data-testid="howto-play"]')?.getBoundingClientRect();
  const out = [];
  if (!body) out.push("has no scrolling body");
  else if (getComputedStyle(body).overflowY !== "auto") out.push("its body doesn't scroll");
  if (!play || play.top < r.top || play.bottom > Math.min(r.bottom, window.innerHeight) + 1) out.push("its Let's play! button isn't on screen");
  if (r.top < 0 || r.bottom > window.innerHeight) out.push(`runs off the screen (${Math.round(r.top)} to ${Math.round(r.bottom)})`);
  else if (Math.abs(r.top - (window.innerHeight - r.height) / 2) > 2) out.push(`isn't centred on the screen (top at ${Math.round(r.top)}px)`);
  for (const el of card.querySelectorAll("*")) {
    if (el.closest("details:not([open]) > :not(summary), .sr-only, .truncate")) continue;
    if (/auto|scroll/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1) {
      out.push(`scrolls sideways inside (<${el.tagName.toLowerCase()}> ${el.scrollWidth}px in ${el.clientWidth}px)`);
      break;
    }
  }
  const wide = Math.max(window.innerWidth, document.documentElement.scrollWidth);
  if (wide > window.innerWidth + 1) out.push(`makes the page scroll sideways (${wide}px wide)`);
  return { w: Math.round(r.width), h: Math.round(r.height), problems: out };
}

export async function runHowTo({ browser, BASE, OUT, errors, step }) {
  step("how to play: every game's pop-up is the same size (448px wide on a desktop, 680px tall at most), scrolling inside");
  const table = [];
  for (const [width, height, phone] of SIZES) {
    const heights = new Map();
    for (const path of HOWTO_GAMES) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
      await context.addInitScript(() => {
        sessionStorage.setItem("pokeiq-splash", "1");
        localStorage.setItem("pokeiq-muted", "1");
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const where = `${width}×${height} ${path}`;
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: "load" });
        const card = page.locator(HOWTO).first();
        await card.waitFor({ state: "visible", timeout: 15_000 });
        await page.waitForTimeout(800);
        const m = await card.evaluate(measureCard);
        table.push(`${where}: ${m.w}×${m.h}`);
        heights.set(path, m.h);
        const wantW = phone ? width - 32 : 448;
        if (Math.abs(m.w - wantW) > 1) errors.push(`how-to ${where}: ${m.w}px wide, not ${wantW}px`);
        if (m.h > Math.min(680, height - 64) + 1) errors.push(`how-to ${where}: ${m.h}px tall, more than ${Math.min(680, height - 64)}px`);
        for (const p of m.problems) errors.push(`how-to ${where}: ${p}`);
        // A record for review, not a check: CI's browser sometimes can't capture one.
        if (OUT && width === 1440) {
          await page
            .screenshot({ path: `${OUT}/howto${path.replace("/", "-")}.png` })
            .catch((e) => console.log(`  note: how-to screenshot skipped (${String(e.message).split("\n")[0]})`));
        }
      } catch (e) {
        errors.push(`how-to ${where}: ${e.message.split("\n")[0]}`);
      }
      await context.close();
    }
    const all = [...heights.values()];
    if (all.length && Math.max(...all) - Math.min(...all) > 1) errors.push(`how-to at ${width}×${height}: the pop-ups aren't one height (${[...heights].map(([p, h]) => `${p} ${h}px`).join(", ")})`);
  }
  console.log(`  ${table.join("\n  ")}`);
}

// Run on its own.
if (import.meta.url === `file://${process.argv[1]}`) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  await runHowTo({ browser, BASE, OUT: null, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`\n${errors.length} problem(s):\n${errors.join("\n")}`);
    process.exit(1);
  }
  console.log("how-to pop-ups OK");
}
