/**
 * Pokémon Mass Battle (/lab/mass-battle), end to end in the browser: a
 * preset battle (which fills the Battle setup panel in) played to its
 * result, the "how many?" solver to its answer
 * (from a shared question link), a shared battle's link, title and preview
 * cards, the Battle setup panel (rows, a group, the Advanced section's
 * field, behaviour, a species' set and playback) building a link that
 * fills the panel back in when it's opened, presets with a held item,
 * the field and their own playback filling the panel in (and a preset
 * link's playback), a "how many?" with the solver's settings, the zoom controls (the wheel, a trackpad pinch as ctrl + wheel,
 * Safari's gesture events, the + and − buttons, the 0 key back to the
 * director), the sound staying off when the site is muted, the phone
 * layout, and "Make a video": a 5-second export (?len=5 at the light test
 * quality and 10 fps, so it runs without a GPU) that must be a valid
 * 1080 × 1920 MP4 with video and audio tracks. Screenshots at 1440 and 390.
 *
 * CI has no GPU: software WebGL draws a frame every few seconds, so the
 * scene runs at its light test quality (?q=draft), presses on the stage are
 * dispatched in the page, and each part records a failure instead of
 * stopping the rest of the smoke test.
 */
import fs from "fs";
import { inspectMp4 } from "./e2e-sizes.mjs";

const press = (page, id) => page.getByTestId(id).dispatchEvent("click", undefined, { timeout: 120_000 });
const wheel = (page, init) =>
  page.getByTestId("mb-scene").evaluate((el, i) => {
    const r = el.getBoundingClientRect();
    return !el.dispatchEvent(new WheelEvent("wheel", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, ...i }));
  }, init, { timeout: 120_000 });
/** Safari's trackpad pinch: gesturestart, gesturechange (scale), gestureend. */
const gesture = (page, scale) =>
  page.getByTestId("mb-scene").evaluate((el, s) => {
    const ev = (type, k) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "scale", { value: k });
      return !el.dispatchEvent(e);
    };
    const kept = ev("gesturestart", 1);
    ev("gesturechange", s);
    ev("gestureend", s);
    return kept;
  }, scale, { timeout: 120_000 });

async function part(errors, name, fn) {
  try {
    await fn();
  } catch (e) {
    errors.push(`mass battle (${name}): ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

export async function runMassBattle({ browser, BASE, OUT, errors, step }) {
  step("3D Lab Mass Battle: a preset battle to its result, the how-many solver, share links and preview cards, zoom, sound off when muted");
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
  const stage = page.locator('[data-testid="mb-stage"]');
  const attr = (name) => stage.getAttribute(`data-${name}`);
  const phaseIs = (phases, ms = 240_000) => page.waitForFunction((ps) => ps.includes(document.querySelector('[data-testid="mb-stage"]')?.dataset.phase), phases, { timeout: ms });

  await part(errors, "preset", async () => {
    await page.goto(`${BASE}/lab/mass-battle/pikachu-vs-snorlax?q=draft`, { waitUntil: "load" });
    if (!/100 Pikachu vs 1 Snorlax/.test(await page.title())) errors.push(`mass battle: the preset's title is "${await page.title()}"`);
    if (!(await page.locator('[data-testid="mb-results"] li').count())) errors.push("mass battle: the server-rendered results are missing");
    await phaseIs(["ready", "error"]);
    if ((await attr("phase")) !== "ready") throw new Error("the battle never deployed");
    await page.screenshot({ path: `${OUT}/mass-battle-ready.png` });
    if ((await attr("left")) && (await attr("left")) !== "100,1") errors.push(`mass battle: the armies start at ${await attr("left")}`);
    // The preset fills the Battle setup panel in.
    if (!(await page.getByTestId("mb-tab-army").getAttribute("aria-selected"))?.includes("true")) errors.push("mass battle: a preset battle doesn't open the Army vs army tab");
    for (const [t, want] of [["mb-side-0-pick-0", "pikachu"], ["mb-side-1-pick-0", "snorlax"]]) {
      const got = await page.getByTestId(t).getAttribute("data-value");
      if (got !== want) errors.push(`mass battle: the preset's panel has ${got} in ${t}, not ${want}`);
    }
    if ((await page.getByTestId("mb-side-0-count-0").inputValue()) !== "100") errors.push("mass battle: the preset's panel lost the count");
    await press(page, "mb-start");
    await phaseIs(["playing"], 60_000);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/mass-battle-playing.png` });
    await phaseIs(["done"], 240_000);
    const winner = await attr("winner");
    if (!["0", "1", "2"].includes(winner ?? "")) errors.push(`mass battle: the battle ended without a winner (${winner})`);
    await page.getByTestId("mb-final").waitFor();
    if (!(await page.getByTestId("mb-result-title").textContent())?.trim()) errors.push("mass battle: the result card has no title");
    await page.screenshot({ path: `${OUT}/mass-battle-result.png` });
    const made = await page.evaluate(() => window.__audioContexts);
    if (made !== 0) errors.push(`mass battle: ${made} AudioContext(s) started with the site's sound off`);
  });

  await part(errors, "solver", async () => {
    await page.goto(`${BASE}/lab/mass-battle?ask=rattata.mewtwo.100.plains&q=draft`, { waitUntil: "load" });
    if (!/How many Rattata beat Mewtwo\?/.test(await page.title())) errors.push(`mass battle: the question link's title is "${await page.title()}"`);
    await phaseIs(["solving", "deploying", "ready", "playing", "done", "error"], 60_000);
    await phaseIs(["playing", "done", "error"], 300_000);
    if ((await attr("phase")) === "error") throw new Error("the solver stopped with an error");
    const answer = Number(await attr("answer"));
    if (!(answer >= 1 && answer <= 200)) errors.push(`mass battle: the solver's answer is ${answer}`);
    await phaseIs(["done"], 240_000);
    const text = await page.getByTestId("mb-answer").textContent();
    if (!new RegExp(`${answer}\\s*Rattata`).test(text ?? "")) errors.push(`mass battle: the answer card reads "${text}"`);
    if (!/± \d+ over \d+ battles/.test((await page.getByTestId("mb-spread").textContent()) ?? "")) errors.push("mass battle: the answer has no spread");
    await page.screenshot({ path: `${OUT}/mass-battle-answer.png` });
  });

  await part(errors, "links", async () => {
    // A version 1 link still opens; its preview card and canonical link are version 2.
    const code = "1.100.plains.k3f9.swarm.line.rattata*40.mewtwo*1";
    const v2 = "2.100.plains.k3f9.items.swarm_rattata*40.line_mewtwo*1";
    await page.goto(`${BASE}/lab/mass-battle?b=${code}&q=draft`, { waitUntil: "load" });
    if (!/40 Rattata vs 1 Mewtwo/.test(await page.title())) errors.push(`mass battle: the battle link's title is "${await page.title()}"`);
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    if (!og || !og.includes(`/lab/mass-battle/og?b=${v2}`)) errors.push(`mass battle: the battle link's preview image is ${og}`);
    for (const path of [`/lab/mass-battle/og?b=${code}`, `/lab/mass-battle/og?b=${v2}`, "/lab/mass-battle/og?b=2.100.volcano.1.0.line_all-water-fe-nolegend*5.line_all-fire-fe-nolegend*10", "/lab/mass-battle/og?ask=magikarp.arceus.100.colosseum", "/lab/mass-battle/og?ask=2.100.colosseum.90-20.sun.swarm_magikarp*1.line_arceus*1", "/lab/mass-battle/opengraph-image", "/lab/mass-battle/fire-vs-water/opengraph-image"]) {
      const res = await page.request.get(`${BASE}${path}`);
      if (res.status() !== 200 || !/image\/png/.test(res.headers()["content-type"] ?? "")) errors.push(`mass battle: preview card ${path} failed (${res.status()})`);
    }
    const roster = await page.request.get(`${BASE}/api/mass-battle/roster`);
    if (roster.status() !== 200) errors.push(`mass battle: the roster returned ${roster.status()}`);
    const learnsets = await page.request.get(`${BASE}/api/mass-battle/learnsets`);
    if (learnsets.status() !== 200 || !Object.keys(await learnsets.json()).length) errors.push(`mass battle: the learnsets returned ${learnsets.status()}`);
    if ((await page.request.get(`${BASE}/lab/mass-battle/not-a-preset`)).status() !== 404) errors.push("mass battle: an unknown preset isn't a 404");
  });

  await part(errors, "zoom", async () => {
    await phaseIs(["ready"], 240_000);
    const dist = async () => Number(await attr("dist"));
    const until = (fn, ms = 60_000) => page.waitForFunction(fn, null, { timeout: ms });
    await page.waitForTimeout(500);
    const d0 = await dist();
    if (!(await wheel(page, { deltaY: -240 }))) errors.push("mass battle: the wheel over the battle wasn't kept from the page");
    await until(() => document.querySelector('[data-testid="mb-stage"]')?.dataset.cam === "free").catch(() => errors.push("mass battle: the wheel didn't take the free camera"));
    await page.waitForTimeout(1200);
    const d1 = await dist();
    if (!(d1 < d0 * 0.9)) errors.push(`mass battle: the wheel didn't zoom in (${d0} → ${d1})`);
    if (!(await wheel(page, { deltaY: 40, ctrlKey: true }))) errors.push("mass battle: a pinch (ctrl + wheel) would zoom the page");
    await page.waitForTimeout(1200);
    const d2 = await dist();
    if (!(d2 > d1 * 1.2)) errors.push(`mass battle: a pinch didn't zoom out (${d1} → ${d2})`);
    if (!(await gesture(page, 2))) errors.push("mass battle: Safari's pinch gesture would zoom the page");
    await page.waitForTimeout(1200);
    const d3 = await dist();
    if (!(d3 < d2 * 0.7)) errors.push(`mass battle: Safari's pinch didn't zoom in (${d2} → ${d3})`);
    await press(page, "mb-zoom-out");
    await page.waitForTimeout(1200);
    const d4 = await dist();
    if (!(d4 > d3 * 1.2)) errors.push(`mass battle: − didn't zoom out (${d3} → ${d4})`);
    await press(page, "mb-zoom-in");
    await press(page, "mb-zoom-in");
    await page.waitForTimeout(1200);
    const d5 = await dist();
    if (!(d5 < d4 * 0.8)) errors.push(`mass battle: + didn't zoom in (${d4} → ${d5})`);
    await page.screenshot({ path: `${OUT}/mass-battle-free-camera.png` });
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true })));
    await until(() => document.querySelector('[data-testid="mb-stage"]')?.dataset.cam === "director").catch(() => errors.push("mass battle: 0 didn't hand the camera back to the director"));
  });

  await part(errors, "controls", async () => {
    // Playback: speed, the top-down camera, the options menu (damage numbers, slow motion, the HUD), pause and step.
    await page.goto(`${BASE}/lab/mass-battle/pikachu-vs-snorlax?q=draft`, { waitUntil: "load" });
    await phaseIs(["ready"], 240_000);
    await press(page, "mb-start");
    await phaseIs(["playing"], 60_000);
    // Paused at once, so the battle is still on when the checks end.
    await press(page, "mb-play");
    await page.getByTestId("mb-step").waitFor({ timeout: 30_000 });
    for (const want of ["2×", "4×", "¼×"]) {
      await press(page, "mb-speed");
      const label = (await page.getByTestId("mb-speed").textContent())?.trim();
      if (label !== want) errors.push(`mass battle: the speed reads "${label}", expected ${want}`);
    }
    await press(page, "mb-speed");
    await press(page, "mb-speed");
    // The camera button cycles director → free → follow the boss → top-down.
    await press(page, "mb-camera");
    await press(page, "mb-camera");
    await press(page, "mb-camera");
    await page.waitForFunction(() => document.querySelector('[data-testid="mb-stage"]')?.dataset.cam === "top", null, { timeout: 30_000 }).catch(() => errors.push("mass battle: the camera button didn't reach the top-down camera"));
    await press(page, "mb-options");
    await page.getByTestId("mb-options-menu").waitFor({ timeout: 30_000 });
    await press(page, "mb-opt-numbers");
    if ((await page.getByTestId("mb-opt-numbers").getAttribute("aria-checked")) !== "true") errors.push("mass battle: damage numbers didn't turn on");
    await press(page, "mb-opt-hud");
    if (await page.getByTestId("mb-hud").count()) errors.push("mass battle: the HUD didn't hide");
    await press(page, "mb-opt-hud");
    const t0 = Number(await attr("t"));
    await press(page, "mb-step");
    await press(page, "mb-step");
    await page.waitForFunction((t) => Number(document.querySelector('[data-testid="mb-stage"]')?.dataset.t) > t, t0, { timeout: 60_000 }).catch(() => errors.push("mass battle: stepping while paused didn't move the battle on"));
    await page.screenshot({ path: `${OUT}/mass-battle-controls.png` });
  });

  step("3D Lab Mass Battle: the Battle setup panel and its share link both ways");
  await part(errors, "setup", async () => {
    await page.goto(`${BASE}/lab/mass-battle?q=draft`, { waitUntil: "load" });
    await phaseIs(["ready", "error"]);
    const id = (t) => page.getByTestId(t);
    const pick = async (testId, query, slug) => {
      await id(testId).click();
      await id(`${testId}-search`).fill(query);
      await page.locator(`[data-testid="${testId}-option"][data-slug="${slug}"]`).first().dispatchEvent("mousedown");
      if ((await id(testId).getAttribute("data-value")) !== slug) throw new Error(`${testId} didn't take ${slug}`);
    };
    await id("mb-tab-army").click();
    await pick("mb-side-0-pick-0", "pikach", "pikachu");
    await id("mb-side-0-count-0").fill("30");
    // A whole group on the red side: every fully evolved Fire type, two of each.
    await id("mb-add-group-1").click();
    await id("mb-group-1-type").selectOption("fire");
    await id("mb-group-1-kind").selectOption("no");
    await id("mb-group-1-count").fill("2");
    const matches = await id("mb-group-1-matches").textContent();
    if (!/Every fully evolved Fire type/.test(matches ?? "")) errors.push(`mass battle: the group reads "${matches}"`);
    await id("mb-group-1-add").click();
    await id("mb-side-1-1-group").waitFor();
    // Advanced: the field, how the blue side fights, Pikachu's set, playback.
    await id("mb-advanced").click();
    await id("mb-weather").selectOption("rain");
    await id("mb-terrain").selectOption("grassy");
    await id("mb-time").selectOption("night");
    await id("mb-items").selectOption("sets");
    await id("mb-beh-0-targeting").selectOption("boss");
    await id("mb-beh-0-stance").selectOption("hold");
    await id("mb-side-0-0-set-toggle").click();
    await id("mb-side-0-0-set").waitFor();
    await id("mb-side-0-0-level").fill("50");
    await id("mb-side-0-0-nature").selectOption("Adamant");
    await id("mb-side-0-0-tera").selectOption("Water");
    await page.waitForFunction(() => document.querySelector('[data-testid="mb-side-0-0-move-0"] optgroup[label="Its other legal moves"]'), null, { timeout: 30_000 });
    await id("mb-side-0-0-move-0").selectOption("Thunderbolt");
    const stats = await id("mb-side-0-0-stats").textContent();
    if (!/Level 50/.test(stats ?? "") || !/Tera Water/.test(stats ?? "")) errors.push(`mass battle: Pikachu's set reads "${stats}"`);
    await id("mb-speed-pick").selectOption("2");
    await id("mb-numbers").click();
    await page.screenshot({ path: `${OUT}/mass-battle-setup-advanced.png`, fullPage: true });
    await id("mb-fight").click();
    await page.waitForFunction(() => /[?&]b=2\./.test(location.search), null, { timeout: 30_000 });
    const url = new URL(page.url());
    const b = url.searchParams.get("b") ?? "";
    for (const want of ["rain-grassy-night-items", "swarm-boss-hold_pikachu*30*l50*mthunderbolt", "nadamant", "twater", "_all-fire-nolegend-fe*2"]) if (!b.includes(want)) errors.push(`mass battle: the battle's link ${b} has no ${want}`);
    if (url.searchParams.get("v") !== "2-numbers") errors.push(`mass battle: the link's playback is ${url.searchParams.get("v")}`);
    await phaseIs(["ready", "playing", "done", "error"], 240_000);
    if ((await attr("phase")) === "error") throw new Error("the panel's battle didn't deploy");
    // The link opens the same battle, with the panel filled in.
    await page.goto(`${BASE}/lab/mass-battle?b=${b}&v=2-numbers&q=draft`, { waitUntil: "load" });
    await phaseIs(["ready", "error"]);
    if (!(await id("mb-tab-army").getAttribute("aria-selected"))?.includes("true")) errors.push("mass battle: a battle link doesn't open the Army vs army tab");
    if ((await id("mb-side-0-pick-0").getAttribute("data-value")) !== "pikachu") errors.push("mass battle: the link lost the blue army's Pikachu");
    if ((await id("mb-side-0-count-0").inputValue()) !== "30") errors.push("mass battle: the link lost the count");
    if (!(await id("mb-side-1-1-group").count())) errors.push("mass battle: the link lost the red army's group");
    await id("mb-advanced").click();
    const values = { "mb-weather": "rain", "mb-terrain": "grassy", "mb-time": "night", "mb-items": "sets", "mb-beh-0-targeting": "boss", "mb-beh-0-stance": "hold", "mb-speed-pick": "2" };
    for (const [t, want] of Object.entries(values)) if ((await id(t).inputValue()) !== want) errors.push(`mass battle: after the link, ${t} is ${await id(t).inputValue()}, not ${want}`);
    if ((await id("mb-numbers").getAttribute("aria-checked")) !== "true") errors.push("mass battle: the link lost the damage numbers");
    await id("mb-side-0-0-set-toggle").click();
    if ((await id("mb-side-0-0-level").inputValue()) !== "50" || (await id("mb-side-0-0-nature").inputValue()) !== "Adamant" || (await id("mb-side-0-0-tera").inputValue()) !== "Water") errors.push("mass battle: the link lost Pikachu's set");
    await page.screenshot({ path: `${OUT}/mass-battle-setup-from-link.png` });
  });

  await part(errors, "preset options", async () => {
    // A preset with a held item and its own playback fills the How many? tab in, Advanced included.
    const id = (t) => page.getByTestId(t);
    await page.goto(`${BASE}/lab/mass-battle/light-ball-pikachu-vs-snorlax?q=draft`, { waitUntil: "load" });
    await phaseIs(["ready", "error"]);
    if ((await attr("phase")) !== "ready") throw new Error("the Light Ball preset never deployed");
    if (!(await id("mb-tab-ask").getAttribute("aria-selected"))?.includes("true")) errors.push("mass battle: a how-many preset doesn't open the How many? tab");
    if ((await id("mb-pick-challenger").getAttribute("data-value")) !== "pikachu") errors.push("mass battle: the Light Ball preset's challenger isn't Pikachu");
    if (Number(await attr("answer")) < 1) errors.push("mass battle: the Light Ball preset has no answer on the stage");
    await id("mb-advanced").click();
    if ((await id("mb-numbers").getAttribute("aria-checked")) !== "true") errors.push("mass battle: the Light Ball preset didn't turn damage numbers on");
    await id("mb-side-army-0-set-toggle").click();
    await id("mb-side-army-0-set").waitFor();
    if ((await id("mb-side-army-0-item").inputValue()) !== "Light Ball") errors.push(`mass battle: the Light Ball preset's Pikachu holds ${await id("mb-side-army-0-item").inputValue()}`);
    // A preset with the field: harsh sunlight in the panel; its static page still reads a link's playback.
    await page.goto(`${BASE}/lab/mass-battle/fire-vs-water-sun?v=2-noslow&q=draft`, { waitUntil: "load" });
    await phaseIs(["ready", "error"]);
    if (!/Fire vs Water in harsh sunlight/.test(await page.title())) errors.push(`mass battle: the sunny preset's title is "${await page.title()}"`);
    await id("mb-advanced").click();
    if ((await id("mb-weather").inputValue()) !== "sun") errors.push(`mass battle: the sunny preset's weather is ${await id("mb-weather").inputValue()}`);
    if ((await id("mb-speed-pick").inputValue()) !== "2") errors.push("mass battle: a preset link's playback speed was lost");
    if ((await id("mb-slowmo").getAttribute("aria-checked")) !== "false") errors.push("mass battle: a preset link's slow motion setting was lost");
    await page.screenshot({ path: `${OUT}/mass-battle-preset-sun.png` });
  });

  await part(errors, "ask", async () => {
    await page.goto(`${BASE}/lab/mass-battle?q=draft`, { waitUntil: "load" });
    await phaseIs(["ready", "error"]);
    const id = (t) => page.getByTestId(t);
    await id("mb-pick-challenger").click();
    await id("mb-pick-challenger-search").fill("rattata");
    await page.locator('[data-testid="mb-pick-challenger-option"][data-slug="rattata"]').first().dispatchEvent("mousedown");
    await id("mb-pick-boss").click();
    await id("mb-pick-boss-search").fill("mewtwo");
    await page.locator('[data-testid="mb-pick-boss-option"][data-slug="mewtwo"]').first().dispatchEvent("mousedown");
    await id("mb-advanced").click();
    await id("mb-threshold").selectOption("0.9");
    await id("mb-runs").selectOption("20");
    if (!/How many Rattata beat Mewtwo\?/.test((await id("mb-question").textContent()) ?? "")) errors.push(`mass battle: the question reads "${await id("mb-question").textContent()}"`);
    await id("mb-ask").click();
    await page.waitForFunction(() => /[?&]ask=2\./.test(location.search), null, { timeout: 30_000 });
    const ask = new URL(page.url()).searchParams.get("ask") ?? "";
    if (!/^2\.100\.[a-z]+\.90-20\.0\.swarm_rattata\*1\.line_mewtwo\*1$/.test(ask)) errors.push(`mass battle: the question's link is ${ask}`);
    await phaseIs(["playing", "done", "error"], 300_000);
    if ((await attr("phase")) === "error") throw new Error("the 90% question stopped with an error");
    const answer = Number(await attr("answer"));
    if (!(answer >= 2 && answer <= 200)) errors.push(`mass battle: the 90% answer is ${answer}`);
  });

  step("3D Lab Mass Battle: make a 5 s video (a valid 1080 × 1920 MP4 with sound), phone layout");
  await part(errors, "video", async () => {
    await page.goto(`${BASE}/lab/mass-battle/pikachu-vs-snorlax?q=draft&len=5&vq=draft&vfps=10`, { waitUntil: "load" });
    await phaseIs(["ready"], 240_000);
    await press(page, "mb-video");
    await page.getByTestId("mb-video-dialog").waitFor();
    await press(page, "mb-video-length-5");
    await press(page, "mb-video-record");
    const done = await page.getByTestId("mb-video-download").waitFor({ timeout: 20 * 60_000 }).then(() => true, () => false);
    if (!done) {
      const err = await page.locator('[data-testid="mb-video-dialog"] [role="alert"]').textContent().catch(() => null);
      errors.push(`mass battle: the 5 s video never finished${err ? ` (${err})` : ""}`);
    } else {
      const [download] = await Promise.all([page.waitForEvent("download"), press(page, "mb-video-download")]);
      const file = `${OUT}/mass-battle-test-video.mp4`;
      await download.saveAs(file);
      if (!/\.mp4$/.test(download.suggestedFilename())) errors.push(`mass battle: the video is named ${download.suggestedFilename()}`);
      const mp4 = inspectMp4(fs.readFileSync(file));
      if (mp4.order.join(",") !== "ftyp,moov,mdat" || !mp4.ends) errors.push(`mass battle: the MP4's layout is ${mp4.order.join(",")}`);
      if (Math.abs(mp4.seconds - 5) > 0.3) errors.push(`mass battle: the video lasts ${mp4.seconds} s, not 5`);
      const video = mp4.tracks.find((t) => t.kind === "vide");
      if (!video || video.width !== 1080 || video.height !== 1920) errors.push(`mass battle: the video track is ${video ? `${video.width}×${video.height}` : "missing"}`);
      else if (video.samples !== 50) errors.push(`mass battle: the video has ${video.samples} frames, expected 50 at 10 fps`);
      if (!mp4.tracks.some((t) => t.kind === "soun")) errors.push("mass battle: the video has no sound track");
    }
    await press(page, "mb-video-close");
  });

  await part(errors, "phone", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/lab/mass-battle/rattata-vs-mewtwo?q=draft`, { waitUntil: "load" });
    await phaseIs(["ready"], 240_000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) errors.push("mass battle: the phone layout scrolls sideways");
    for (const id of ["mb-play", "mb-restart", "mb-speed", "mb-camera", "mb-zoom-in", "mb-zoom-out", "mb-options", "mb-sound", "mb-how", "mb-share", "mb-video", "mb-start"]) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box || box.x < 0 || box.x + box.width > 391) errors.push(`mass battle: ${id} is off a 390 px screen`);
    }
    await page.screenshot({ path: `${OUT}/mass-battle-390.png` });
    await press(page, "mb-how");
    await page.getByTestId("mb-how-panel").waitFor();
    // The setup panel with Advanced open still fits a phone.
    await page.getByTestId("mb-how-panel").getByRole("button", { name: "Close" }).click();
    await page.getByTestId("mb-advanced").click();
    await page.getByTestId("mb-tab-army").click();
    await page.getByTestId("mb-side-0-0-set-toggle").click();
    await page.getByTestId("mb-side-0-0-set").waitFor();
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) errors.push("mass battle: the setup panel scrolls sideways on a phone");
    await page.getByTestId("mb-setup").screenshot({ path: `${OUT}/mass-battle-setup-390.png` });
  });
  await context.close();
}
