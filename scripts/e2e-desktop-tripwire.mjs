/**
 * Desktop tripwire: phone-only changes must leave tablets, laptops and desktops
 * exactly as they were. On a set of routes, at 1440 × 900 and 1024 × 768, it
 * records the layout boxes (and font sizes) of the page's structural elements
 * and compares them with the committed snapshot in
 * scripts/e2e-desktop-tripwire.json. Boxes are stable across machines, unlike
 * pixels; daily or user-made content is compared on its x and width only.
 *
 *   node scripts/e2e-desktop-tripwire.mjs [baseUrl]            # check (or from e2e-smoke.mjs)
 *   node scripts/e2e-desktop-tripwire.mjs [baseUrl] --update   # after an intended desktop change
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SNAPSHOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "e2e-desktop-tripwire.json");

/** [path, mode]: "full" compares x, y, width, height; "x" only x and width (the content changes with the day or with who has played). */
export const TRIPWIRE_ROUTES = [
  ["/", "x"],
  ["/daily", "x"],
  ["/pokedle", "x"],
  ["/guessr", "x"],
  ["/pikadoku", "x"],
  ["/connections", "x"],
  ["/play", "full"],
  ["/quiz/name-em-all", "full"],
  ["/quiz/which-pokemon", "full"],
  ["/iq-test", "full"],
  ["/battle", "x"],
  ["/battle/calc", "full"],
  ["/battle/teams", "x"],
  ["/battle/ladder", "x"],
  ["/battle/tournaments", "x"],
  ["/rooms", "x"],
  ["/leaderboard", "x"],
  ["/trainer", "x"],
  ["/login", "full"],
  ["/pokedex", "full"],
  ["/pokemon/pikachu", "full"],
  ["/pokedex/moves", "full"],
  ["/pokedex/moves/thunderbolt", "full"],
  ["/pokedex/abilities", "full"],
  ["/pokedex/items", "full"],
  ["/pokedex/places", "full"],
  ["/pokedex/types", "full"],
  ["/pokedex/types/fire", "full"],
  ["/pokedex/natures", "full"],
  ["/pokedex/trainers", "full"],
  ["/pokedex/tcg", "full"],
  ["/atlas", "x"],
  ["/lab", "x"],
  ["/privacy", "full"],
  ["/this-page-does-not-exist", "full"],
];
const SIZES = [
  [1440, 900],
  [1024, 768],
];
const TOL = { x: 2, w: 2, y: 4, h: 4, font: 0.01 };

/** Runs in the page: boxes of the structural elements in the first two screens, keyed by their place in the DOM. */
function collect() {
  const out = {};
  const limitY = window.innerHeight * 2;
  const roots = [document.querySelector("body > header"), document.querySelector("main"), document.querySelector("body > footer, footer")].filter(Boolean);
  const keyOf = (el) => {
    const parts = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      parts.unshift(`${n.tagName.toLowerCase()}${sibs.length > 1 ? `:${sibs.indexOf(n)}` : ""}`);
    }
    return parts.join(">");
  };
  const depthOf = (el, root) => {
    let d = 0;
    for (let n = el; n && n !== root; n = n.parentElement) d++;
    return d;
  };
  for (const root of roots) {
    const els = [root, ...root.querySelectorAll("*")];
    for (const el of els) {
      const deep = depthOf(el, root);
      const heading = /^H[1-3]$/.test(el.tagName);
      const control = el.matches("button, input, select, textarea, nav, form, section, table");
      if (deep > 3 && !heading && !control) continue;
      if (el.closest("svg") && el.tagName !== "svg") continue;
      if (el.closest("[data-testid='tabbar'], [aria-hidden='true'], canvas")) continue;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.position === "fixed") continue;
      if (el.closest("[role='dialog']")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.top + window.scrollY > limitY) continue;
      out[keyOf(el)] = [Math.round(r.left), Math.round(r.top + window.scrollY), Math.round(r.width), Math.round(r.height), parseFloat(s.fontSize)];
      if (Object.keys(out).length >= 150) return out;
    }
  }
  return out;
}

async function measure(browser, BASE) {
  const result = {};
  for (const [w, h] of SIZES) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      sessionStorage.setItem("pokeiq-splash", "1");
      localStorage.setItem("pokeiq-muted", "1");
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    for (const [route] of TRIPWIRE_ROUTES) {
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: "load" });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
        const howto = page.locator('[data-testid="howto-sheet"], [data-testid="pdk-howto"]').first();
        if (await howto.waitFor({ state: "visible", timeout: 2_000 }).then(() => true, () => false)) {
          await page.getByTestId("howto-never").click();
          await howto.waitFor({ state: "hidden" });
        }
        await page.waitForTimeout(400);
        result[`${w}${route}`] = await page.evaluate(collect);
      } catch (e) {
        result[`${w}${route}`] = { error: e.message.split("\n")[0] };
      }
    }
    await context.close();
  }
  return result;
}

/** Differences between a snapshot and a fresh measurement, as readable lines. */
export function compareLayouts(want, got) {
  const out = [];
  const modes = Object.fromEntries(TRIPWIRE_ROUTES);
  for (const [page, boxes] of Object.entries(want)) {
    const route = page.replace(/^\d+/, "");
    const mode = modes[route] ?? "full";
    const now = got[page];
    if (!now) continue;
    if (now.error) {
      out.push(`${page}: ${now.error}`);
      continue;
    }
    let shown = 0;
    let moved = 0;
    for (const [key, a] of Object.entries(boxes)) {
      const b = now[key];
      if (!b) {
        if (mode === "full") moved++, shown++ < 3 && out.push(`${page}: gone: ${key}`);
        continue;
      }
      const bad =
        Math.abs(a[0] - b[0]) > TOL.x ||
        Math.abs(a[2] - b[2]) > TOL.w ||
        Math.abs(a[4] - b[4]) > TOL.font ||
        (mode === "full" && (Math.abs(a[1] - b[1]) > TOL.y || Math.abs(a[3] - b[3]) > TOL.h));
      if (bad) {
        moved++;
        if (shown++ < 3) out.push(`${page}: ${key} was [${a.join(", ")}] now [${b.join(", ")}]`);
      }
    }
    if (moved > 3) out.push(`${page}: ...${moved} elements changed in all`);
  }
  return out;
}

export async function runDesktopTripwire({ browser, BASE, errors, step }) {
  step("desktop tripwire: tablet, laptop and desktop layouts match the committed snapshot");
  const want = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const got = await measure(browser, BASE);
  for (const line of compareLayouts(want, got)) errors.push(`desktop layout changed: ${line}`);
}

// Run on its own.
if (import.meta.url === `file://${process.argv[1]}`) {
  const BASE = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? "http://localhost:3000";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  if (process.argv.includes("--update")) {
    const got = await measure(browser, BASE);
    fs.writeFileSync(SNAPSHOT, JSON.stringify(got) + "\n");
    const errs = Object.entries(got).filter(([, v]) => v.error);
    console.log(`snapshot written: ${Object.keys(got).length} pages${errs.length ? `, ${errs.length} with errors: ${errs.map(([k]) => k).join(", ")}` : ""}`);
  } else {
    const errors = [];
    await runDesktopTripwire({ browser, BASE, errors, step: (s) => console.log(`• ${s}`) });
    if (errors.length) {
      console.error(`\n${errors.length} problem(s):\n${errors.join("\n")}`);
      process.exitCode = 1;
    } else console.log("desktop layout unchanged");
  }
  await browser.close();
}
