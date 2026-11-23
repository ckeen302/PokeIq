/**
 * The 3D Lab's share links and short videos, end to end in the browser:
 * - the Professor's Lab: "Share link" copies a link that opens the lab on the
 *   same Pokémon (the tab's title names it), and "Video" makes a short
 *   vertical MP4 of it from the live scene, which then carries on;
 * - the World Globe: ?region=kanto opens straight on Kanto's card (no
 *   fly-in), the card's "Share link" copies that link, and its "Video" makes
 *   an MP4.
 *
 * CI has no GPU: scenes run at their lightest (?q=0 / ?quality=0) and the
 * videos are a second long at 5 frames a second (?len=1&vfps=5).
 *
 *   node scripts/e2e-lab-share.mjs [baseUrl]      (or E2E_ONLY=lab-share in e2e-smoke)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { inspectMp4 } from "./e2e-sizes.mjs";

async function part(errors, name, fn) {
  try {
    await fn();
  } catch (e) {
    errors.push(`lab share (${name}): ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

/** Clipboard writes are kept in the page (a headless browser's clipboard may be off). */
const CLIPBOARD = () => {
  window.__copied = [];
  const write = (t) => {
    window.__copied.push(String(t));
    return Promise.resolve();
  };
  try {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
  } catch {
    // keep the browser's own
  }
};

async function checkVideo(page, errors, label, testid) {
  const done = await page.getByTestId(`${testid}-download`).waitFor({ timeout: 15 * 60_000 }).then(() => true, () => false);
  if (!done) {
    errors.push(`${label}: the video wasn't made (${await page.getByTestId(`${testid}-dialog`).innerText().catch(() => "no dialog")})`);
    return;
  }
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`${testid}-download`).click()]);
  const file = path.join(os.tmpdir(), `lab-share-${Date.now()}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  const name = download.suggestedFilename();
  if (/\.mp4$/.test(name)) {
    const info = inspectMp4(fs.readFileSync(file));
    const v = info.tracks.find((t) => t.kind === "vide");
    if (!v || v.width !== 1080 || v.height !== 1920) errors.push(`${label}: the video isn't 1080 × 1920 (${JSON.stringify(info.tracks)})`);
    if (!(info.seconds > 0.5)) errors.push(`${label}: the video is ${info.seconds}s long`);
  } else if (!/\.webm$/.test(name)) errors.push(`${label}: the video is named ${name}`);
  fs.rmSync(file, { force: true });
}

export async function runLabShare({ browser, BASE, errors, step }) {
  step("3D Lab: share links and videos (Professor's Lab, World Globe)");
  const open = async (opts = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
    await context.addInitScript(() => {
      sessionStorage.setItem("pokeiq-splash", "1");
      localStorage.setItem("pokeiq-muted", "1");
    });
    await context.addInitScript(CLIPBOARD);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`lab share [${page.url()}] PAGEERROR: ${e.message}`));
    return { context, page };
  };

  await part(errors, "professor's lab", async () => {
    const { context, page } = await open();
    await page.goto(`${BASE}/lab/pokedex?pick=6&q=0&len=1&vfps=5`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="lab-stage"][data-ready="1"]').waitFor({ timeout: 240_000 });
    await page.waitForFunction(() => /^Charizard in 3D · /.test(document.title), null, { timeout: 120_000 }).catch(() => errors.push(`lab share: the lab's title doesn't name Charizard ("${page.url()}")`));
    await page.getByTestId("lab-share").click();
    const copied = await page.waitForFunction(() => window.__copied?.[0], null, { timeout: 10_000 }).then((h) => h.jsonValue(), () => "");
    const link = /https?:\/\/\S+/.exec(copied)?.[0] ?? "";
    if (!/Charizard/.test(copied) || !/\/lab\/pokedex\?pick=6$/.test(link)) errors.push(`lab share: the lab's share text is "${copied}"`);
    // Video: made from the live scene, which then carries on.
    await page.getByTestId("lab-video").click();
    await page.getByTestId("lab-clip-record").click();
    await checkVideo(page, errors, "lab share: the lab's video", "lab-clip");
    await page.getByTestId("lab-clip-close").click();
    const before = await page.evaluate(() => window.__labDex?.().frames ?? 0);
    await page.waitForTimeout(4000);
    const after = await page.evaluate(() => window.__labDex?.().frames ?? 0);
    if (!(after > before)) errors.push("lab share: the lab's scene didn't carry on after the video");
    // The shared link opens on the same Pokémon.
    if (link) {
      const shared = await context.newPage();
      await shared.goto(link.replace(/^https?:\/\/[^/]+/, BASE) + "&q=0", { waitUntil: "domcontentloaded" });
      await shared.getByTestId("lab-name").waitFor({ timeout: 120_000 });
      if ((await shared.getByTestId("lab-name").textContent()) !== "Charizard") errors.push("lab share: the lab's shared link didn't open on Charizard");
    }
    await context.close();
  });

  await part(errors, "world globe", async () => {
    const { context, page } = await open();
    await page.goto(`${BASE}/pokeguessr/globe?region=kanto&quality=0&len=1&vfps=5`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="world-globe"][data-state="ready"]').waitFor({ timeout: 240_000 });
    if ((await page.getByTestId("world-globe").getAttribute("data-intro")) === "1") errors.push("lab share: a shared globe link played the fly-in");
    await page.locator('[data-testid="world-globe"][data-card="Kanto"]').waitFor({ timeout: 60_000 }).catch(() => errors.push("lab share: ?region=kanto didn't open Kanto's card"));
    await page.getByTestId("globe-region-share").click();
    const copied = await page.waitForFunction(() => window.__copied?.[0], null, { timeout: 10_000 }).then((h) => h.jsonValue(), () => "");
    if (!/Kanto/.test(copied) || !/\/pokeguessr\/globe\?region=kanto$/.test(copied)) errors.push(`lab share: the globe's share text is "${copied}"`);
    if (!/^Kanto on the World Globe · /.test(await page.title())) errors.push(`lab share: the globe's title is "${await page.title()}"`);
    await page.getByTestId("globe-region-video").click();
    await page.getByTestId("lab-clip-record").click();
    await checkVideo(page, errors, "lab share: the globe's video", "lab-clip");
    await page.getByTestId("lab-clip-close").click();
    // Closing the card takes ?region= off the address.
    await page.getByTestId("globe-region-close").click();
    await page.waitForFunction(() => !new URL(location.href).searchParams.has("region"), null, { timeout: 10_000 }).catch(() => errors.push("lab share: closing the card left ?region= on the address"));
    await context.close();
  });

}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import("playwright");
  const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH && { executablePath: process.env.CHROME_PATH }), args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const errors = [];
  await runLabShare({ browser, BASE, errors, step: (s) => console.log(`→ ${s}`) });
  await browser.close();
  console.log(errors.length ? errors.join("\n") : "lab share: all good");
  process.exit(errors.length ? 1 : 0);
}
