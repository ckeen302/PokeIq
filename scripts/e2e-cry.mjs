/**
 * Cry Quiz (/quiz/pokemon-cry-quiz), end to end in the browser: question 1's
 * cry starts by itself after the click on Start (a real browser's autoplay
 * policy, no flag), the Play button plays it again from the start as often
 * as asked, question 2 plays its own cry through the same element (so the
 * last one stops), and a browser without Ogg Vorbis (Safari) is sent a WAV
 * that plays. Each part records a failure instead of stopping the rest of
 * the smoke test; screenshots are best effort.
 *
 *   node scripts/e2e-cry.mjs [baseUrl]     # on its own (CHROMIUM_PATH as for the smoke test)
 */
import fs from "fs";
import { pathToFileURL } from "url";

const QUIZ = "/quiz/pokemon-cry-quiz";

/** Records every play() a page makes: its source, the element, and whether the browser allowed it. */
function instrument() {
  window.__plays = [];
  window.__cryEls = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const rec = { src: this.src || this.currentSrc, el: window.__cryEls.indexOf(this), at: performance.now() };
    if (rec.el < 0) rec.el = window.__cryEls.push(this) - 1;
    window.__plays.push(rec);
    const p = play.call(this);
    p.then(
      () => (rec.ok = true),
      (e) => (rec.err = e?.name ?? String(e))
    );
    return p;
  };
}

const realPlays = (page) =>
  page.evaluate(() => window.__plays.filter((r) => !r.src.startsWith("data:")).map(({ src, el, ok, err }) => ({ src, el, ok, err })));

/** Wait for a play() of a cry (not the silent unlock) after `after` earlier ones to go through. */
async function waitForPlay(page, after, timeout = 15_000) {
  await page.waitForFunction(
    (n) => window.__plays.filter((r) => !r.src.startsWith("data:")).some((r, i) => i >= n && (r.ok || r.err === "NotAllowedError")),
    after,
    { timeout }
  );
  const plays = await realPlays(page);
  return plays.slice(after).find((r) => r.ok || r.err === "NotAllowedError");
}

const audioState = (page) =>
  page.evaluate(() => {
    const el = window.__cryEls.find((e) => !e.src.startsWith("data:")) ?? window.__cryEls[0];
    return el ? { src: el.src, t: el.currentTime, paused: el.paused, ended: el.ended, error: el.error?.code ?? null, readyState: el.readyState } : null;
  });

async function shot(page, path) {
  await page.screenshot({ path }).catch(() => {});
}

async function startQuiz(page, BASE) {
  await page.goto(`${BASE}${QUIZ}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  const howto = page.locator('[data-testid="howto-sheet"]').first();
  if (await howto.isVisible().catch(() => false)) await page.getByTestId("howto-never").click();
  await page.getByRole("button", { name: /^Start/ }).click();
  await page.getByTestId("cry-player").waitFor({ timeout: 30_000 });
}

/**
 * iOS lets an element play by itself only once it was started or loaded
 * inside a tap; Chrome's "user-gesture-required" policy works the same way,
 * except that any play() within 5 s of a tap passes. So the cries are held
 * back 10 s here: question 1's play() comes well after the tap on Start and
 * only goes through because that tap unlocked the shared element. (Nothing
 * polls the page meanwhile: Playwright's evaluations count as taps.)
 */
async function strictAutoplay({ browser, BASE, OUT }) {
  const strict = await browser.browserType().launch({
    ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }),
    args: ["--autoplay-policy=user-gesture-required"],
  });
  try {
    const context = await strict.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
    await context.addInitScript(instrument);
    await context.addInitScript(() => window.addEventListener("click", () => (window.__tapAt = performance.now()), true));
    await context.route(/\/api\/media\//, async (route) => {
      await new Promise((r) => setTimeout(r, 10_000));
      await route.continue().catch(() => {});
    });
    const page = await context.newPage();
    await page.goto(`${BASE}${QUIZ}`, { waitUntil: "load" });
    await page.waitForTimeout(3_000); // hydrated, without polling the page
    await page.getByRole("button", { name: /^Start/ }).click();
    await page.waitForTimeout(20_000);
    const { plays, tapAt } = await page.evaluate(() => ({ plays: window.__plays, tapAt: window.__tapAt }));
    const cry = plays.find((r) => !r.src.startsWith("data:") && (r.ok || r.err === "NotAllowedError"));
    await shot(page, `${OUT}/cry-strict-autoplay.png`);
    if (!cry) throw new Error(`question 1 never tried to play its cry (${JSON.stringify(plays)})`);
    const late = Math.round(cry.at - tapAt);
    if (late < 5_000) throw new Error(`the cry played ${late} ms after the tap: too soon to test the unlock`);
    if (!cry.ok) {
      const label = await page.getByTestId("cry-player").innerText().catch(() => "");
      throw new Error(`question 1's cry was refused ${late} ms after the tap (${cry.err}); the player reads "${label.replace(/\s+/g, " ")}"`);
    }
  } finally {
    await strict.close();
  }
}

export async function runCry({ browser, BASE, OUT, errors, step }) {
  const fail = (msg) => errors.push(`cry quiz: ${msg}`);
  async function part(name, fn) {
    try {
      await fn();
    } catch (e) {
      fail(`${name}: ${String(e?.message ?? e).split("\n")[0]}`);
    }
  }

  step?.("cry quiz: the cry plays when each question loads");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  await context.addInitScript(instrument);
  const page = await context.newPage();
  page.on("pageerror", (err) => fail(`PAGEERROR ${err.message}`));

  let q1 = null;
  await part("question 1 plays by itself after Start", async () => {
    await startQuiz(page, BASE);
    q1 = await waitForPlay(page, 0);
    if (!q1?.ok) throw new Error(`question 1's cry was refused (${q1?.err})`);
    if (!/\/api\/media\//.test(q1.src)) throw new Error(`question 1 played ${q1.src}, not its cry`);
    await page.waitForFunction(() => document.querySelector('[data-testid="cry-player"]')?.dataset.state === "playing", null, { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(250);
    const a = await audioState(page);
    if (!a || (a.t === 0 && !a.ended)) throw new Error(`question 1's cry isn't sounding (${JSON.stringify(a)})`);
    await shot(page, `${OUT}/cry-q1-playing.png`);
  });

  await part("Play replays the cry, from the start, again and again", async () => {
    const player = page.getByTestId("cry-player");
    // Let the first play finish, then replay twice: once after it ends, once mid-cry.
    await page.waitForFunction(() => document.querySelector('[data-testid="cry-player"]')?.dataset.state === "ready", null, { timeout: 10_000 });
    const n = (await realPlays(page)).length;
    await page.getByRole("button", { name: "Play cry" }).click();
    const again = await waitForPlay(page, n);
    if (!again?.ok) throw new Error(`replay refused (${again?.err})`);
    await page.waitForFunction(() => document.querySelector('[data-testid="cry-player"]')?.dataset.state === "playing", null, { timeout: 5_000 });
    await page.waitForTimeout(300);
    const mid = await audioState(page);
    await page.getByRole("button", { name: "Replay cry" }).click();
    const third = await waitForPlay(page, n + 1);
    if (!third?.ok) throw new Error(`replay mid-cry refused (${third?.err})`);
    const restarted = await audioState(page);
    if (mid && restarted && !(restarted.t < mid.t)) throw new Error(`replay mid-cry didn't restart (${mid.t}s -> ${restarted.t}s)`);
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="cry-player"]')?.dataset.plays) >= 3, null, { timeout: 5_000 });
    await shot(page, `${OUT}/cry-q1-replayed.png`);
    if (!(await player.innerText()).match(/Played 3x|Playing/i)) throw new Error(`the counter reads "${await player.innerText()}"`);
  });

  await part("question 2 plays its own cry, through the same element", async () => {
    const n = (await realPlays(page)).length;
    await page.locator("[data-answer-tile]:not([disabled])").first().click();
    await page.getByRole("button", { name: /Next question/ }).click({ timeout: 15_000 });
    const q2 = await waitForPlay(page, n);
    if (!q2?.ok) throw new Error(`question 2's cry was refused (${q2?.err})`);
    if (q1 && q2.src === q1.src) throw new Error("question 2 played question 1's cry");
    const els = await page.evaluate(() => window.__cryEls.length);
    if (els !== 1) throw new Error(`cries played through ${els} elements (they can overlap)`);
    await shot(page, `${OUT}/cry-q2.png`);
  });

  await part("the cry route serves the file as it is, and a WAV on request", async () => {
    const src = q1?.src;
    if (!src) throw new Error("no cry URL from question 1");
    const plain = await page.request.get(src.replace(/[?&]format=wav\b/, ""));
    if (plain.status() !== 200 || !/^audio\/(ogg|mpeg)$/.test(plain.headers()["content-type"] ?? "")) {
      throw new Error(`cry: ${plain.status()} ${plain.headers()["content-type"]}`);
    }
    const wav = await page.request.get(`${src.replace(/[?&]format=wav\b/, "")}?format=wav`);
    const body = await wav.body();
    const type = wav.headers()["content-type"] ?? "";
    if (wav.status() !== 200) throw new Error(`?format=wav: ${wav.status()}`);
    if (type === "audio/wav" ? body.subarray(0, 4).toString() !== "RIFF" : type !== "audio/mpeg") throw new Error(`?format=wav sent ${type}`);
  });
  await context.close();

  step?.("cry quiz: strict autoplay (as on iOS): question 1's cry still plays by itself, long after the tap on Start");
  await part("strict autoplay", () => strictAutoplay({ browser, BASE, OUT }));

  step?.("cry quiz: when the browser refuses to start the cry, the button asks for a tap");
  await part("autoplay refused", async () => {
    const refusing = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await refusing.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
    await refusing.addInitScript(() => {
      // A cry may only start inside a click, as in a browser that never autoplays.
      let inTap = false;
      window.addEventListener("click", () => {
        inTap = true;
        setTimeout(() => (inTap = false));
      }, true);
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (!inTap && !this.src.startsWith("data:")) return Promise.reject(new DOMException("autoplay refused", "NotAllowedError"));
        return play.call(this);
      };
    });
    await refusing.addInitScript(instrument);
    const p = await refusing.newPage();
    await startQuiz(p, BASE);
    const player = p.locator('[data-testid="cry-player"][data-state="blocked"]');
    await player.waitFor({ timeout: 15_000 });
    if (!/tap to hear the cry/i.test(await player.innerText())) throw new Error(`the blocked player reads "${await player.innerText()}"`);
    await shot(p, `${OUT}/cry-tap-to-hear.png`);
    await p.getByRole("button", { name: "Play cry" }).click();
    await p.locator('[data-testid="cry-player"][data-plays="1"]').waitFor({ timeout: 10_000 });
    await refusing.close();
  });

  step?.("cry quiz: a browser without Ogg Vorbis (Safari) gets a WAV that plays");
  const safari = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await safari.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  await safari.addInitScript(() => {
    const can = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (type) {
      return /ogg/i.test(type) ? "" : can.call(this, type);
    };
  });
  await safari.addInitScript(instrument);
  const phone = await safari.newPage();
  phone.on("pageerror", (err) => fail(`PAGEERROR (no Ogg) ${err.message}`));
  await part("no Ogg Vorbis: question 1 plays the WAV", async () => {
    await startQuiz(phone, BASE);
    const first = await waitForPlay(phone, 0);
    if (!first?.ok) throw new Error(`refused (${first?.err})`);
    if (!/[?&]format=wav\b/.test(first.src)) throw new Error(`played ${first.src}, not the WAV`);
    await phone.waitForTimeout(300);
    const a = await audioState(phone);
    if (!a || a.error) throw new Error(`the WAV didn't play (${JSON.stringify(a)})`);
    await shot(phone, `${OUT}/cry-no-ogg.png`);
  });
  await safari.close();
}

// On its own: node scripts/e2e-cry.mjs [baseUrl]
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { chromium } = await import("playwright");
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const OUT = "e2e-screenshots";
  fs.mkdirSync(OUT, { recursive: true });
  // Headless Chrome allows sound before any tap; this flag restores a real browser's rule.
  const args = ["--autoplay-policy=document-user-activation-required"];
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args } : { args });
  const errors = [];
  await runCry({ browser, BASE, OUT, errors, step: (s) => console.log(`▸ ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("cry quiz: ok");
}
