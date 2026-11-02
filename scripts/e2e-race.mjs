/**
 * Pokémon Race (/pokedex/race), end to end in the browser: its 3D Lab card
 * and the way back to the Lab, the Race tab and its server-rendered
 * results, the 3D stadium and the broadcast (lane intros, the start, the
 * race, the replay) through to the results and the photo-finish image, the
 * camera presets and zoom (buttons, wheel, a trackpad pinch as ctrl +
 * wheel or Safari's gesture events, drag to orbit), a shared race link
 * with its own title and preview card, the preset cards, the list
 * fallback, the Pokédex entry's "Race it" link, the sound staying off when
 * the site is muted, and "Make a video": a 5-second export (?len=5, at the
 * light test quality and 10 fps) that must be a valid 1080 × 1920 MP4 with
 * video and audio.
 * Screenshots at 1440 and 390 px.
 *
 * CI has no GPU: software WebGL draws a frame every few seconds. So the
 * scene runs at its light test quality (?q=draft), presses are dispatched
 * in the page, the show clock is moved with the page's own seek hook
 * (window.__race) instead of waiting in real time, and each part records a
 * failure instead of stopping the rest of the smoke test.
 */
import fs from "fs";
import { inspectMp4 } from "./e2e-sizes.mjs";

const press = (page, id) => page.getByTestId(id).dispatchEvent("click", undefined, { timeout: 120_000 });
async function part(errors, name, fn) {
  try {
    await fn();
  } catch (e) {
    errors.push(`race (${name}): ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

export async function runRace({ browser, BASE, OUT, errors, step }) {
  step("pokédex Race: its 3D Lab card, the Race tab, 3D stadium, broadcast to results, photo finish, camera and zoom, share link, preview cards, list view");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    localStorage.setItem("pokeiq-muted", "1");
    window.__audioContexts = 0;
    const Real = window.AudioContext;
    if (Real) window.AudioContext = class extends Real { constructor(...a) { super(...a); window.__audioContexts++; } };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push(`[${page.url()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${page.url()}] PAGEERROR: ${err.message}`));
  const stage = page.locator('[data-testid="race-stage"]');
  const attr = (name) => stage.getAttribute(`data-${name}`);
  const ready = () => page.locator('[data-testid="race-stage"][data-ready="1"]').waitFor({ timeout: 240_000 }).then(() => true, () => false);
  const loaded = () => page.waitForFunction(() => { const p = document.querySelector('[data-testid="race-stage"]')?.dataset.phase; return !!p && p !== "loading"; }, null, { timeout: 240_000 }).then(() => true, () => false);
  const phaseIs = (re, ms = 120_000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid="race-stage"]')?.dataset.phase ?? ""), re.source, { timeout: ms });
  const state = () => page.evaluate(() => window.__race?.state());
  const seek = (t) => page.evaluate((x) => window.__race.seek(x), t);

  await part(errors, "3d lab", async () => {
    // The race lives in the 3D Lab: its card (a real screenshot) opens /pokedex/race, the nav's 3D Lab tab is lit there, and the stage leads back.
    await page.goto(`${BASE}/lab`, { waitUntil: "load" });
    const card = page.getByTestId("lab-card-race");
    if (!(await card.count())) throw new Error("no Race card on /lab");
    const art = card.locator("img").first();
    await art.evaluate((img) => img.scrollIntoView({ block: "center" }));
    if (!(await art.evaluate((img) => img.complete ? img.naturalWidth > 0 : new Promise((r) => { img.onload = () => r(true); img.onerror = () => r(false); })))) errors.push("race: the 3D Lab card's picture didn't load");
    await page.getByTestId("lab-open-race").click();
    await page.waitForURL(/\/pokedex\/race$/);
    const header = page.locator("header");
    if ((await header.getByRole("link", { name: "3D Lab", exact: true }).getAttribute("aria-current")) !== "page") errors.push("race: the nav's 3D Lab tab isn't lit on /pokedex/race");
    if ((await header.getByRole("link", { name: "Pokédex", exact: true }).getAttribute("aria-current")) === "page") errors.push("race: Pokédex is lit on /pokedex/race too");
    const back = page.getByTestId("race-back");
    if (await back.count() && (await back.getAttribute("href")) !== "/lab") errors.push("race: the stage's back link doesn't lead to /lab");
  });

  await part(errors, "tab", async () => {
    await page.goto(`${BASE}/pokedex`, { waitUntil: "load" });
    await page.getByTestId("dex-tab-race").click();
    await page.waitForURL(/\/pokedex\/race$/);
    if (!(await page.locator('[data-testid="race-list"] #race-regieleki').count())) errors.push("race: the server-rendered results are missing Regieleki");
    if (!/Furusawa/.test(await page.locator("body").innerText())) errors.push("race: the page doesn't explain the model (Furusawa / Alexander)");
  });

  await part(errors, "broadcast", async () => {
    await page.goto(`${BASE}/pokedex/race?q=draft`, { waitUntil: "load" });
    if (!(await ready())) throw new Error("the 3D stadium never became ready");
    if (!(await loaded())) throw new Error("the runners never loaded");
    if ((await attr("count")) !== "8") errors.push(`race: the Fastest Eight fielded ${await attr("count")} runners`);
    if ((await attr("winner")) !== "regieleki") errors.push(`race: the Fastest Eight's winner is ${await attr("winner")}`);
    await phaseIs(/crane|intro/, 30_000).catch(() => errors.push("race: the broadcast didn't open on the crane shot and lane intros"));
    const st = await state();
    const intro = st.shots.find((s) => s[0] === "intro");
    await seek(intro[2] + 0.6);
    await phaseIs(/intro/, 30_000);
    await page.screenshot({ path: `${OUT}/race-intro.png` });
    await press(page, "race-skip");
    await phaseIs(/marks|set|race/, 60_000).catch(() => errors.push("race: 'To the start' didn't skip the intros"));
    // Mid-race, then the results (moving the show clock: software WebGL is too slow for real time).
    await seek(st.gun + 3);
    await phaseIs(/race/, 30_000);
    await page.screenshot({ path: `${OUT}/race-running.png` });
    await seek(st.end - 0.2);
    await phaseIs(/results/, 60_000).catch(() => errors.push("race: the broadcast never reached the results"));
    await page.getByTestId("race-results").waitFor({ timeout: 60_000 }).catch(() => errors.push("race: no results board"));
    const rows = await page.getByTestId("race-result-row").count();
    if (rows !== 8) errors.push(`race: the results board has ${rows} rows`);
    await page.waitForFunction(() => document.querySelector('[data-testid="race-stage"]')?.dataset.photo === "1", null, { timeout: 120_000 }).catch(() => errors.push("race: the photo-finish image was never developed"));
    if (!(await page.getByTestId("race-photo").count())) errors.push("race: the results don't show the photo finish");
    await page.screenshot({ path: `${OUT}/race-results.png` });
    if ((await attr("cam")) !== "free") errors.push(`race: after the race the camera is ${await attr("cam")}, not free`);
  });

  await part(errors, "camera", async () => {
    const camState = () => page.evaluate(() => {
      const s = window.__race.state();
      return { cam: document.querySelector('[data-testid="race-stage"]').dataset.cam, fov: s.camera?.fov, dist: s.camera?.dist };
    });
    // Zoom buttons, wheel and a trackpad pinch (ctrl + wheel) all move the free camera in and out.
    const d0 = (await camState()).dist;
    await press(page, "race-zoom-in");
    await page.waitForFunction((d) => window.__race.state().camera.dist < d - 0.01, d0, { timeout: 30_000 }).catch(() => errors.push("race: + didn't zoom in"));
    const d1 = (await camState()).dist;
    await press(page, "race-zoom-out");
    await page.waitForFunction((d) => window.__race.state().camera.dist > d + 0.01, d1, { timeout: 30_000 }).catch(() => errors.push("race: − didn't zoom out"));
    const d2 = (await camState()).dist;
    await page.getByTestId("race-scene").dispatchEvent("wheel", { deltaY: -240, deltaMode: 0 });
    await page.waitForFunction((d) => window.__race.state().camera.dist < d - 0.01, d2, { timeout: 30_000 }).catch(() => errors.push("race: the mouse wheel didn't zoom"));
    const d3 = (await camState()).dist;
    await page.getByTestId("race-scene").dispatchEvent("wheel", { deltaY: 8, deltaMode: 0, ctrlKey: true });
    await page.waitForFunction((d) => window.__race.state().camera.dist > d + 0.001, d3, { timeout: 30_000 }).catch(() => errors.push("race: a trackpad pinch (ctrl + wheel) didn't zoom"));
    // Safari's trackpad pinch: gesture events with a growing scale zoom in.
    const d4 = (await camState()).dist;
    await page.getByTestId("race-stage").evaluate((el) => {
      const fire = (type, scale) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, "scale", { value: scale }); el.dispatchEvent(e); };
      fire("gesturestart", 1);
      fire("gesturechange", 1.2);
      fire("gesturechange", 1.5);
      fire("gestureend", 1.5);
    });
    await page.waitForFunction((d) => window.__race.state().camera.dist < d - 0.01, d4, { timeout: 30_000 }).catch(() => errors.push("race: a Safari pinch (gesture events) didn't zoom"));
    // Presets, then drag to orbit (back to Free).
    for (const m of ["headon", "overhead", "broadcast"]) {
      await press(page, `race-cam-${m}`);
      if ((await attr("cam")) !== m) errors.push(`race: the ${m} camera preset didn't switch`);
    }
    const f0 = (await camState()).fov;
    await press(page, "race-zoom-in");
    await page.waitForFunction((f) => window.__race.state().camera.fov < f - 0.01, f0, { timeout: 30_000 }).catch(() => errors.push("race: + didn't zoom the broadcast camera"));
    await page.getByTestId("race-scene").evaluate((el) => {
      const r = el.getBoundingClientRect();
      const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, clientX: x, clientY: y, button: 0, buttons: 1 }));
      ev("pointerdown", r.width / 2, r.height / 2);
      ev("pointermove", r.width / 2 + 80, r.height / 2 + 10);
      ev("pointermove", r.width / 2 + 160, r.height / 2 + 20);
      ev("pointerup", r.width / 2 + 160, r.height / 2 + 20);
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="race-stage"]')?.dataset.cam === "free", null, { timeout: 30_000 }).catch(() => errors.push("race: dragging didn't switch to the free camera"));
    await page.screenshot({ path: `${OUT}/race-free-camera.png` });
    // The site's sound was off throughout: no AudioContext at all.
    const made = await page.evaluate(() => window.__audioContexts);
    if (made !== 0) errors.push(`race: ${made} AudioContext(s) started with the site's sound off`);
  });

  await part(errors, "links", async () => {
    await page.goto(`${BASE}/pokedex/race/run?vs=regieleki,shuckle&q=draft`, { waitUntil: "load" });
    if (!/Regieleki vs Shuckle/.test(await page.title())) errors.push(`race: the shared race's title is "${await page.title()}"`);
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    if (!og || !/\/pokedex\/race\/run\/og\?vs=regieleki,shuckle/.test(og)) errors.push(`race: the shared race's preview image is ${og}`);
    if (await ready()) {
      if (await loaded()) {
        if ((await attr("count")) !== "2") errors.push(`race: the shared race fielded ${await attr("count")} runners`);
        if ((await attr("winner")) !== "regieleki") errors.push("race: Regieleki didn't beat Shuckle");
      }
    }
    for (const path of ["/pokedex/race/run/og?vs=regieleki,shuckle", "/pokedex/race/run/og?run=starters&d=200", "/pokedex/race/opengraph-image", "/pokedex/race/shuckle-vs-regieleki/opengraph-image", "/pokedex/race/every-pokemon/opengraph-image"]) {
      const res = await page.request.get(`${BASE}${path}`);
      if (res.status() !== 200 || !/image\/png/.test(res.headers()["content-type"] ?? "")) errors.push(`race: preview card ${path} failed (${res.status()})`);
    }
    const preset = await page.request.get(`${BASE}/pokedex/race/eeveelutions`);
    if (preset.status() !== 200) errors.push(`race: the Eeveelutions page returned ${preset.status()}`);
    if ((await page.request.get(`${BASE}/pokedex/race/not-a-race`)).status() !== 404) errors.push("race: an unknown race isn't a 404");
    // The list fallback.
    await page.goto(`${BASE}/pokedex/race/shuckle-vs-regieleki?view=list`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("race-list").waitFor({ timeout: 15_000 }).catch(() => errors.push("race: the list view has no results table"));
    if (await stage.count()) errors.push("race: the list view still shows the 3D stage");
    // The Pokédex entry races it.
    await page.goto(`${BASE}/pokemon/pikachu`, { waitUntil: "domcontentloaded" });
    if ((await page.getByTestId("dex-race-it").getAttribute("href")) !== "/pokedex/race/run?vs=pikachu") errors.push("race: Pikachu's Pokédex entry has no 'Race it' link");
  });

  step("pokédex Race: make a 5 s video (a valid 1080 × 1920 MP4 with sound), phone layout");
  await part(errors, "video", async () => {
    await page.goto(`${BASE}/pokedex/race/run?vs=regieleki,shuckle&q=draft&len=5&vq=draft&vfps=10`, { waitUntil: "load" });
    if (!(await ready()) || !(await loaded())) throw new Error("the stadium never became ready for the video");
    await press(page, "race-video");
    await page.getByTestId("race-video-dialog").waitFor();
    await press(page, "race-video-record");
    const done = await page.getByTestId("race-video-download").waitFor({ timeout: 20 * 60_000 }).then(() => true, () => false);
    if (!done) {
      errors.push("race: the 5 s video never finished");
    } else {
      const [download] = await Promise.all([page.waitForEvent("download"), press(page, "race-video-download")]);
      const file = `${OUT}/race-test-video.mp4`;
      await download.saveAs(file);
      if (!/\.mp4$/.test(download.suggestedFilename())) errors.push(`race: the video is named ${download.suggestedFilename()}`);
      const mp4 = inspectMp4(fs.readFileSync(file));
      if (mp4.order.join(",") !== "ftyp,moov,mdat" || !mp4.ends) errors.push(`race: the MP4's layout is ${mp4.order.join(",")}`);
      if (Math.abs(mp4.seconds - 5) > 0.3) errors.push(`race: the video lasts ${mp4.seconds} s, not 5`);
      const video = mp4.tracks.find((t) => t.kind === "vide");
      if (!video || video.width !== 1080 || video.height !== 1920) errors.push(`race: the video track is ${video ? `${video.width}×${video.height}` : "missing"}`);
      else if (video.samples !== 50) errors.push(`race: the video has ${video.samples} frames, expected 50 at 10 fps`);
      if (!mp4.tracks.some((t) => t.kind === "soun")) errors.push("race: the video has no sound track");
    }
    await press(page, "race-video-close");
  });

  await part(errors, "phone", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/pokedex/race/shuckle-vs-regieleki?q=draft`, { waitUntil: "load" });
    if (!(await ready())) throw new Error("the stadium never became ready on a phone");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) errors.push("race: the phone layout scrolls sideways");
    for (const id of ["race-new", "race-video", "race-share", "race-title", "race-cam-free", "race-zoom-in"]) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box || box.x < 0 || box.x + box.width > 391) errors.push(`race: ${id} is off a 390 px screen`);
    }
    await page.screenshot({ path: `${OUT}/race-390.png` });
  });
  await context.close();
}
