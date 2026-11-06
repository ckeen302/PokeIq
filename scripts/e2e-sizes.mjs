/**
 * Pokémon Sizes (/pokedex/sizes), end to end in the browser: the Sizes tab,
 * the 3D scene and its first-visit Play glide, stopping it, search and
 * fly-to, the arrow keys, zooming (the wheel, a trackpad pinch as ctrl +
 * wheel, the + and − buttons, reset) and turning the view, a two-Pokémon
 * comparison and its share link and
 * preview card, a Pokémon's own size page, the list fallback, the sound
 * staying off when the site is muted, and "Make a video": a 5-second
 * export (?len=5, at the light test quality and 10 fps so it runs in CI
 * without a GPU) that must be a valid 1080 × 1920 MP4 with video and audio
 * tracks, plus cancelling a recording. Screenshots at 1440 and 390 px.
 *
 * CI has no GPU: software WebGL draws a frame every few seconds, and real
 * input events then wait behind those frames. So the scene runs at its light
 * test quality (?q=draft), presses on the 3D stage are dispatched in the page
 * (as a click, a typed value or a key would arrive), and each part records a
 * failure instead of stopping the rest of the smoke test.
 */
import fs from "fs";

/** The boxes of an ISO BMFF file, nested where they hold others. */
export function mp4Boxes(buf, start = 0, end = buf.length) {
  const out = [];
  const containers = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf"]);
  let at = start;
  while (at + 8 <= end) {
    const size = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    if (size < 8 || at + size > end) break;
    const box = { type, start: at, size };
    if (containers.has(type)) box.children = mp4Boxes(buf, at + 8, at + size);
    out.push(box);
    at += size;
  }
  return out;
}

/** What a viewer needs to know about an MP4: its top-level layout, duration, video size and tracks. */
export function inspectMp4(buf) {
  const top = mp4Boxes(buf);
  const all = (boxes) => boxes.flatMap((b) => [b, ...all(b.children ?? [])]);
  const flat = all(top);
  const mvhd = flat.find((b) => b.type === "mvhd");
  const timescale = mvhd ? buf.readUInt32BE(mvhd.start + 20) : 0;
  const duration = mvhd ? buf.readUInt32BE(mvhd.start + 24) : 0;
  const traks = top.find((b) => b.type === "moov")?.children?.filter((b) => b.type === "trak") ?? [];
  const tracks = traks.map((t) => {
    const hdlr = all(t.children ?? []).find((b) => b.type === "hdlr");
    const tkhd = (t.children ?? []).find((b) => b.type === "tkhd");
    const kind = hdlr ? buf.toString("latin1", hdlr.start + 16, hdlr.start + 20) : "?";
    const stsz = all(t.children ?? []).find((b) => b.type === "stsz");
    return { kind, width: tkhd ? buf.readUInt32BE(tkhd.start + tkhd.size - 8) >>> 16 : 0, height: tkhd ? buf.readUInt32BE(tkhd.start + tkhd.size - 4) >>> 16 : 0, samples: stsz ? buf.readUInt32BE(stsz.start + 16) : 0 };
  });
  return { order: top.map((b) => b.type), seconds: timescale ? duration / timescale : 0, tracks, ends: top.length ? top[top.length - 1].start + top[top.length - 1].size === buf.length : false };
}

/** A click handled in the page (React sees it like any click), immune to input queued behind slow frames. */
const press = (page, id) => page.getByTestId(id).dispatchEvent("click", undefined, { timeout: 120_000 });
/** Types into a React text field from the page. */
const typeInto = (page, id, value) =>
  page.getByTestId(id).evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value, { timeout: 120_000 });
/** A key press on the page (the stage listens on the window). */
const key = (page, k) => page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk, bubbles: true })), k);
/** A wheel turn over the 3D scene, dispatched in the page; resolves to whether the page kept it from the browser (preventDefault). */
const wheel = (page, init) =>
  page.getByTestId("sizes-scene").evaluate((el, i) => {
    const r = el.getBoundingClientRect();
    return !el.dispatchEvent(new WheelEvent("wheel", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, ...i }));
  }, init, { timeout: 120_000 });
/** A drag over the 3D scene with the given mouse button (2 is the right button), dispatched in the page. */
const drag = (page, button, dx, dy) =>
  page.getByTestId("sizes-scene").evaluate((el, [b, x, y]) => {
    const r = el.getBoundingClientRect();
    const at = (type, k) => el.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: "mouse", isPrimary: true, button: b, buttons: type === "pointerup" ? 0 : 1 << (b === 2 ? 1 : 0), clientX: r.left + r.width / 2 + x * k, clientY: r.top + r.height / 2 + y * k, bubbles: true, cancelable: true }));
    at("pointerdown", 0);
    for (let k = 1; k <= 8; k++) at("pointermove", k / 8);
    at("pointerup", 1);
  }, [button, dx, dy], { timeout: 120_000 });
/** Runs one part of the test, recording a failure rather than stopping the run. */
async function part(errors, name, fn) {
  try {
    await fn();
  } catch (e) {
    errors.push(`sizes (${name}): ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

export async function runSizes({ browser, BASE, OUT, errors, step }) {
  step("pokédex Sizes tab: 3D scene, first-visit glide, stop, search + fly-to, keys, compare two, share link, deep links, list view");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    // Site sound off: count every AudioContext the page creates.
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
  const stage = page.locator('[data-testid="sizes-stage"]');
  const ready = () => page.locator('[data-testid="sizes-stage"][data-ready="1"]').waitFor({ timeout: 180_000 }).then(() => true, () => false);
  const attr = (name) => stage.getAttribute(`data-${name}`);
  const stageIs = (name, value, ms = 120_000) => page.waitForFunction(([n, v]) => document.querySelector('[data-testid="sizes-stage"]')?.dataset[n] === v, [name, value], { timeout: ms });

  await part(errors, "tab", async () => {
    // Sizes lives in the 3D Lab, not in the Pokédex's sections.
    await page.goto(`${BASE}/pokedex`, { waitUntil: "load" });
    if (await page.getByTestId("dex-tab-sizes").count()) errors.push("sizes: the Pokédex still has a Sizes tab");
    await page.goto(`${BASE}/pokedex/sizes`, { waitUntil: "load" });
    if (!(await page.locator('[data-testid="sizes-list"] #size-pikachu').count())) errors.push("sizes: the server-rendered table is missing Pikachu");
  });
  // The rest at the light test quality, as a first visit again.
  await part(errors, "glide", async () => {
    await page.evaluate(() => localStorage.removeItem("pokeiq-sizes-intro"));
    await page.goto(`${BASE}/pokedex/sizes?q=draft`, { waitUntil: "load" });
    if (!(await ready())) throw new Error("the 3D scene never became ready");
    // First visit: the glide plays by itself, under the lineup's title card.
    await stageIs("kind", "play", 30_000).catch(() => errors.push("sizes: the first visit didn't play the glide"));
    await page.getByTestId("sizes-hook").waitFor({ timeout: 20_000 }).catch(() => errors.push("sizes: no title card as the glide began"));
    if (Number(await attr("count")) < 1026) errors.push(`sizes: the full line has ${await attr("count")} figures`);
    if (await page.locator('[data-testid="sizes-list"] #size-ref-phone').count()) errors.push("sizes: the phone stands in the full line");
    await page.screenshot({ path: `${OUT}/sizes-play.png` });
    await press(page, "sizes-play");
    await stageIs("kind", "explore").catch(() => errors.push("sizes: Stop didn't stop the glide"));
  });
  await part(errors, "search", async () => {
    await press(page, "sizes-search-toggle");
    await typeInto(page, "sizes-search", "wailord");
    await page.locator('[data-testid="sizes-search-result"][data-key="wailord"]').dispatchEvent("click");
    await stageIs("focus", "wailord").catch(async () => errors.push(`sizes: searching didn't fly to Wailord (focus ${await attr("focus")})`));
    await page.screenshot({ path: `${OUT}/sizes-wailord.png` });
    // The arrow keys step along the line.
    await key(page, "ArrowRight");
    await page.waitForFunction(() => document.querySelector('[data-testid="sizes-stage"]')?.dataset.focus !== "wailord", null, { timeout: 120_000 }).catch(() => errors.push("sizes: → didn't step to the next Pokémon"));
    await key(page, "ArrowLeft");
    await stageIs("focus", "wailord").catch(() => errors.push("sizes: ← didn't step back to Wailord"));
  });
  await part(errors, "zoom", async () => {
    // The zoom on screen is on the stage as data-zoom (1 is the automatic framing).
    const zoom = async () => Number(await attr("zoom"));
    /** Waits for data-zoom to be in [lo, hi]. */
    const zoomed = (lo, hi, ms = 120_000) => page.waitForFunction(([a, b]) => { const z = Number(document.querySelector('[data-testid="sizes-stage"]')?.dataset.zoom); return Number.isFinite(z) && z >= a && z <= b; }, [lo, hi], { timeout: ms });
    await zoomed(0.98, 1.02, 60_000).catch(async () => errors.push(`sizes: exploring didn't start at the automatic framing (data-zoom ${await attr("zoom")})`));
    // The wheel zooms in (and the page itself doesn't scroll or zoom).
    if (!(await wheel(page, { deltaY: -240 }))) errors.push("sizes: the wheel over the scene wasn't kept from the page");
    await zoomed(1.15, 99).catch(async () => errors.push(`sizes: the wheel didn't zoom in (data-zoom ${await attr("zoom")})`));
    // A trackpad pinch in Chrome, Edge and Firefox: ctrl + wheel. Spreading the fingers zooms out here (deltaY > 0); the browser's page zoom stays out of it.
    const before = await zoom();
    if (!(await wheel(page, { deltaY: 40, ctrlKey: true }))) errors.push("sizes: a pinch (ctrl + wheel) over the scene would zoom the page");
    await zoomed(0, before * 0.8).catch(async () => errors.push(`sizes: a pinch didn't zoom (data-zoom ${before} → ${await attr("zoom")})`));
    // The on-screen buttons.
    const atOut = await zoom();
    await press(page, "sizes-zoom-in");
    await zoomed(atOut * 1.3, 99).catch(async () => errors.push(`sizes: + didn't zoom in (data-zoom ${atOut} → ${await attr("zoom")})`));
    const atIn = await zoom();
    await press(page, "sizes-zoom-out");
    await press(page, "sizes-zoom-out");
    await press(page, "sizes-zoom-out");
    await zoomed(0, atIn / 2).catch(async () => errors.push(`sizes: − didn't zoom out (data-zoom ${atIn} → ${await attr("zoom")})`));
    // Looking round: a right-drag turns the camera round the figure (a little), and tilts.
    await drag(page, 2, 220, 120);
    await page.waitForFunction(() => Math.abs(Number(document.querySelector('[data-testid="sizes-stage"]')?.dataset.orbit)) > 5, null, { timeout: 120_000 }).catch(async () => errors.push(`sizes: a right-drag didn't turn the view (data-orbit ${await attr("orbit")})`));
    await page.screenshot({ path: `${OUT}/sizes-zoomed-out.png` });
    // Reset: back to the automatic framing, square on.
    await press(page, "sizes-reset-view");
    await zoomed(0.98, 1.02).catch(async () => errors.push(`sizes: reset didn't restore the framing (data-zoom ${await attr("zoom")})`));
    await page.waitForFunction(() => Math.abs(Number(document.querySelector('[data-testid="sizes-stage"]')?.dataset.orbit)) < 0.5, null, { timeout: 120_000 }).catch(async () => errors.push(`sizes: reset didn't turn the view back (data-orbit ${await attr("orbit")})`));
    // + and − keys too.
    await key(page, "+");
    await zoomed(1.2, 99).catch(async () => errors.push(`sizes: the + key didn't zoom in (data-zoom ${await attr("zoom")})`));
    await key(page, "0");
    await zoomed(0.98, 1.02).catch(async () => errors.push(`sizes: the 0 key didn't reset the view (data-zoom ${await attr("zoom")})`));
  });
  await part(errors, "compare", async () => {
    // Compare Wailord with Eternatus: the line becomes the two (and the human) and the address its share link.
    await press(page, "sizes-compare");
    await page.getByTestId("sizes-compare-tray").waitFor();
    await typeInto(page, "sizes-search", "eternatus");
    await page.locator('[data-testid="sizes-search-result"][data-key="eternatus"]').dispatchEvent("click");
    await stageIs("count", "3").catch(async () => errors.push(`sizes: comparing two left ${await attr("count")} figures on the line`));
    if ((await page.getByTestId("sizes-compare-chip").count()) !== 2) errors.push("sizes: the comparison tray doesn't hold two Pokémon");
    const u = new URL(page.url());
    if (u.pathname !== "/pokedex/sizes/compare" || u.searchParams.get("vs") !== "wailord,eternatus") errors.push(`sizes: the comparison's address is ${page.url()}`);
    await page.screenshot({ path: `${OUT}/sizes-compare-1440.png` });
    // The site's sound was off throughout: no AudioContext at all.
    const made = await page.evaluate(() => window.__audioContexts);
    if (made !== 0) errors.push(`sizes: ${made} AudioContext(s) started with the site's sound off`);
    // List view.
    await press(page, "sizes-list-view");
    await stage.waitFor({ state: "detached" });
    await page.getByTestId("sizes-3d-view").waitFor();
  });
  await part(errors, "links", async () => {
    // A shared comparison: its own title, the comparison on screen, its own preview card.
    await page.goto(`${BASE}/pokedex/sizes/compare?vs=pikachu,snorlax&q=draft`, { waitUntil: "load" });
    if (!/Pikachu vs Snorlax/.test(await page.title())) errors.push(`sizes: the comparison link's title is "${await page.title()}"`);
    if (await ready()) {
      await stageIs("count", "3", 60_000).catch(() => errors.push("sizes: the comparison link didn't open the comparison"));
      if ((await attr("kind")) === "play") errors.push("sizes: a shared link auto-played");
    }
    const ogUrl = await page.locator('meta[property="og:image"]').getAttribute("content");
    if (!ogUrl || !/\/pokedex\/sizes\/compare\/og\?vs=pikachu,snorlax/.test(ogUrl)) errors.push(`sizes: the comparison's preview image is ${ogUrl}`);
    for (const path of ["/pokedex/sizes/compare/og?vs=pikachu,snorlax", "/pokedex/sizes/opengraph-image", "/pokedex/sizes/legendaries/opengraph-image", "/pokedex/sizes/wailord/opengraph-image"]) {
      const og = await page.request.get(`${BASE}${path}`);
      if (og.status() !== 200 || !/image\/png/.test(og.headers()["content-type"] ?? "")) errors.push(`sizes: preview card ${path} failed (${og.status()})`);
    }
    // A Pokémon's own size page, and a preset's.
    await page.goto(`${BASE}/pokedex/sizes/snorlax?q=draft`, { waitUntil: "load" });
    if (!/How big is Snorlax\?/.test(await page.title())) errors.push(`sizes: Snorlax's size page title is "${await page.title()}"`);
    if (await ready()) await stageIs("focus", "snorlax", 60_000).catch(() => errors.push("sizes: Snorlax's page didn't open on Snorlax"));
    const legend = await page.request.get(`${BASE}/pokedex/sizes/legendaries`);
    if (legend.status() !== 200) errors.push(`sizes: the Legendaries page returned ${legend.status()}`);
    if ((await page.request.get(`${BASE}/pokedex/sizes/not-a-pokemon`)).status() !== 404) errors.push("sizes: an unknown name isn't a 404");
    // The list fallback opens on a Pokémon's link too.
    await page.goto(`${BASE}/pokedex/sizes/snorlax?view=list`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="sizes-list"] #size-snorlax.sz-list-hit').waitFor({ timeout: 15_000 }).catch(() => errors.push("sizes: the list view didn't bring Snorlax into view"));
    // The Pokédex entry links to its size.
    await page.goto(`${BASE}/pokemon/pikachu`, { waitUntil: "domcontentloaded" });
    if ((await page.getByTestId("dex-see-size").getAttribute("href")) !== "/pokedex/sizes/pikachu") errors.push("sizes: Pikachu's Pokédex entry has no 'See its size' link");
  });

  step("pokédex Sizes: make a 5 s video (a valid 1080 × 1920 MP4 with music), cancel a recording, phone layout");
  await part(errors, "video", async () => {
    await page.goto(`${BASE}/pokedex/sizes/compare?vs=pikachu,snorlax&q=draft&len=5&vq=draft&vfps=10`, { waitUntil: "load" });
    if (!(await ready())) throw new Error("the 3D scene never became ready for the video");
    await press(page, "sizes-video");
    await page.getByTestId("sizes-video-dialog").waitFor();
    // Cancel works mid-recording.
    await press(page, "sizes-video-length-5");
    await press(page, "sizes-video-record");
    await page.getByTestId("sizes-video-progress").waitFor({ timeout: 60_000 });
    await press(page, "sizes-video-cancel");
    await page.getByTestId("sizes-video-record").waitFor({ timeout: 120_000 }).catch(() => errors.push("sizes: Cancel didn't stop the recording"));
    // A full 5 s video.
    await press(page, "sizes-video-record");
    const done = await page.getByTestId("sizes-video-download").waitFor({ timeout: 20 * 60_000 }).then(() => true, () => false);
    if (!done) {
      errors.push("sizes: the 5 s video never finished");
    } else {
      await page.screenshot({ path: `${OUT}/sizes-video-done.png` });
      const [download] = await Promise.all([page.waitForEvent("download"), press(page, "sizes-video-download")]);
      const file = `${OUT}/sizes-test-video.mp4`;
      await download.saveAs(file);
      if (!/\.mp4$/.test(download.suggestedFilename())) errors.push(`sizes: the video is named ${download.suggestedFilename()}`);
      const mp4 = inspectMp4(fs.readFileSync(file));
      if (mp4.order.join(",") !== "ftyp,moov,mdat" || !mp4.ends) errors.push(`sizes: the MP4's layout is ${mp4.order.join(",")}`);
      if (Math.abs(mp4.seconds - 5) > 0.3) errors.push(`sizes: the video lasts ${mp4.seconds} s, not 5`);
      const video = mp4.tracks.find((t) => t.kind === "vide");
      if (!video || video.width !== 1080 || video.height !== 1920) errors.push(`sizes: the video track is ${video ? `${video.width}×${video.height}` : "missing"}`);
      else if (video.samples !== 50) errors.push(`sizes: the video has ${video.samples} frames, expected 50 at 10 fps`);
      if (!mp4.tracks.some((t) => t.kind === "soun")) errors.push("sizes: the video has no music track");
    }
    await press(page, "sizes-video-close");
  });
  await part(errors, "phone", async () => {
    // Phone: the stage, its controls and the comparison fit a 390 px screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/pokedex/sizes/compare?vs=pikachu,snorlax&q=draft`, { waitUntil: "load" });
    if (!(await ready())) throw new Error("the 3D scene never became ready on a phone");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) errors.push("sizes: the phone layout scrolls sideways");
    for (const id of ["sizes-play", "sizes-compare", "sizes-video", "sizes-share", "sizes-lineup", "sizes-zoom-in", "sizes-zoom-out", "sizes-reset-view"]) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box || box.x < 0 || box.x + box.width > 391) errors.push(`sizes: ${id} is off a 390 px screen`);
    }
    await page.screenshot({ path: `${OUT}/sizes-390.png` });
  });
  await context.close();
}
