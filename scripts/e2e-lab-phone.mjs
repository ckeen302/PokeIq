/**
 * The 3D Lab on phones and without WebGL, end to end in the browser:
 * - a phone sees a still of the scene at once (the poster, a plain image in
 *   the page's HTML), gone once the scene has drawn;
 * - without WebGL the World Globe lists every region (name, generation,
 *   starters, links) under its message.
 *
 * CI has no GPU: scenes run at their lightest (?q=0, ?quality=0, ?q=draft).
 *
 *   node scripts/e2e-lab-phone.mjs [baseUrl]      (or E2E_ONLY=lab-phone in e2e-smoke)
 */

async function part(errors, name, fn) {
  try {
    await fn();
  } catch (e) {
    errors.push(`lab phone (${name}): ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

export async function runLabPhone({ browser, BASE, errors, step }) {
  step("3D Lab: phone posters, the globe without WebGL");
  const open = async (opts = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
    await context.addInitScript(() => {
      sessionStorage.setItem("pokeiq-splash", "1");
      localStorage.setItem("pokeiq-muted", "1");
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`lab phone [${page.url()}] PAGEERROR: ${e.message}`));
    return { context, page };
  };

  await part(errors, "globe without WebGL", async () => {
    const { context, page } = await open();
    await context.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
        return /webgl/.test(String(kind)) ? null : real.call(this, kind, ...rest);
      };
    });
    await page.goto(`${BASE}/pokeguessr/globe`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("globe-fallback").waitFor({ timeout: 60_000 });
    const n = await page.getByTestId("globe-region-list").locator("li").count();
    if (n < 9) errors.push(`lab phone: without WebGL the globe lists ${n} regions`);
    await context.close();
  });

  await part(errors, "phone posters", async () => {
    const { context, page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    for (const [url, ready] of [
      ["/lab/pokedex?q=0", '[data-testid="lab-stage"][data-ready="1"]'],
      ["/pokeguessr/globe?quality=0", '[data-testid="world-globe"][data-state="ready"]'],
      ["/pokedex/sizes?q=draft", '[data-testid="sizes-stage"][data-shown="1"]'],
    ]) {
      await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
      const poster = page.getByTestId("stage-poster").first();
      const src = await poster.locator("img").getAttribute("src", { timeout: 30_000 }).catch(() => null);
      if (!src) {
        errors.push(`lab phone: ${url} has no poster on a phone`);
        continue;
      }
      const res = await page.request.get(BASE + src);
      if (!res.ok()) errors.push(`lab phone: ${url}'s poster ${src} is ${res.status()}`);
      await page.locator(ready).waitFor({ timeout: 240_000 });
      await page.locator('[data-testid="stage-poster"][data-gone="1"]').first().waitFor({ timeout: 30_000 }).catch(() => errors.push(`lab phone: ${url}'s poster didn't go once the scene was drawn`));
    }
    await context.close();
  });
}


if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import("playwright");
  const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH && { executablePath: process.env.CHROME_PATH }), args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const errors = [];
  await runLabPhone({ browser, BASE, errors, step: (s) => console.log(`→ ${s}`) });
  await browser.close();
  console.log(errors.length ? errors.join("\n") : "lab phone: all good");
  process.exit(errors.length ? 1 : 0);
}
