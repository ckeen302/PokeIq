/**
 * The History of the Pokémon World (/lab/world-history), end to end in the
 * browser: the server-rendered history with its sources (what search and
 * browsers without WebGL get), the text version (?view=list) with the
 * separate Anime & Movies lane, the film (the stage opening, Play running
 * the playhead and Pause stopping it, the arrow keys stepping through the
 * captions, the chapter rail, free look with the zoom buttons and the
 * wheel), every chapter's deep link with its own title and preview card
 * (and a 404 for an unknown one), the sound staying off when the site is
 * muted, and "Make a video": a 5-second chapter export (?len=5, at the
 * light test quality and 10 fps so it runs in CI without a GPU) that must
 * be a valid 1080 × 1920 MP4 with video and audio tracks, plus cancelling
 * a recording. Screenshots at 1440 and 390 px.
 *
 * CI has no GPU: software WebGL draws a frame every few seconds, and real
 * input events then wait behind those frames. So the film runs at its
 * light test quality (?q=draft), presses on the stage are dispatched in
 * the page, and each part records a failure instead of stopping the rest.
 */
import fs from "fs";
import { inspectMp4 } from "./e2e-sizes.mjs";

const CHAPTERS = JSON.parse(fs.readFileSync(new URL("../src/data/world-history.json", import.meta.url), "utf8")).chapters;

/** A click handled in the page (React sees it like any click), immune to input queued behind slow frames. */
const press = (page, id) => page.getByTestId(id).dispatchEvent("click", undefined, { timeout: 120_000 });
/** A key press on the page (the film listens on the window). */
const key = (page, k) => page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk, bubbles: true })), k);
/** A wheel turn over the 3D scene, dispatched in the page. */
const wheel = (page, init) =>
  page.getByTestId("wh-scene").evaluate((el, i) => {
    const r = el.getBoundingClientRect();
    return !el.dispatchEvent(new WheelEvent("wheel", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, ...i }));
  }, init, { timeout: 120_000 });
async function part(errors, name, fn) {
  try {
    await fn();
  } catch (e) {
    errors.push(`world-history (${name}): ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

export async function runWorldHistory({ browser, BASE, OUT, errors, step }) {
  step("3D Lab: The History of the Pokémon World — sourced text, text version, film controls, deep links and preview cards");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    // Site sound off: count every AudioContext the page creates.
    if (localStorage.getItem("pokeiq-muted") === null) localStorage.setItem("pokeiq-muted", "1");
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
  const stage = page.locator('[data-testid="wh-stage"]');
  const ready = () => page.locator('[data-testid="wh-stage"][data-ready="1"]').waitFor({ timeout: 240_000 }).then(() => true, () => false);
  const stageIs = (name, value, ms = 300_000) => page.waitForFunction(([n, v]) => document.querySelector('[data-testid="wh-stage"]')?.dataset[n] === v, [name, value], { timeout: ms });
  const film = () => page.evaluate(() => window.__wh?.state() ?? null);

  await part(errors, "server text", async () => {
    // Without JavaScript the page is the whole history with its sources.
    const res = await page.request.get(`${BASE}/lab/world-history`);
    if (res.status() !== 200) throw new Error(`the page returned ${res.status()}`);
    const html = await res.text();
    for (const c of CHAPTERS) if (!html.includes(c.title.replace(/'/g, "&#x27;")) && !html.includes(c.title)) errors.push(`world-history: the server-rendered page is missing "${c.title}"`);
    if (!/Canalave Library/.test(html)) errors.push("world-history: the server-rendered page has no sources");
    if (!/Anime &amp; Movies|Anime & Movies/.test(html)) errors.push("world-history: the Anime & Movies lane is missing");
  });

  await part(errors, "text version", async () => {
    await page.goto(`${BASE}/lab/world-history?view=list`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("wh-text").waitFor({ timeout: 30_000 });
    if ((await page.locator('[data-testid^="wh-chapter-"]').count()) !== CHAPTERS.length) errors.push("world-history: the text version doesn't list every chapter");
    if (!(await page.getByTestId("wh-sources-creation").count())) errors.push("world-history: the text version has no sources for Creation");
    if (!(await page.getByTestId("wh-screen-lane").count())) errors.push("world-history: the text version has no separate Anime & Movies lane");
    const toTimeline = await page.getByTestId("wh-to-timeline").getAttribute("href").catch(() => null);
    if (toTimeline !== "/pokedex/timeline") errors.push(`world-history: the link to the Timeline goes to ${toTimeline}`);
    await page.screenshot({ path: `${OUT}/world-history-text.png` });
  });

  await part(errors, "film", async () => {
    await page.goto(`${BASE}/lab/world-history/creation?q=draft`, { waitUntil: "load" });
    if (!/The Original One/.test(await page.title())) errors.push(`world-history: Creation's title is "${await page.title()}"`);
    if (!(await ready())) throw new Error("the film never became ready");
    await stageIs("loading", "0").catch(() => errors.push("world-history: the first chapter never finished loading"));
    if ((await stage.getAttribute("data-chapter")) !== "creation") errors.push("world-history: the Creation link didn't open on Creation");
    await page.screenshot({ path: `${OUT}/world-history-1440.png` });
    // Play runs the film; Pause stops it.
    const t0 = (await film())?.t ?? 0;
    await press(page, "wh-play");
    await stageIs("playing", "1", 30_000).catch(() => errors.push("world-history: Play didn't start the film"));
    await page.waitForFunction((t) => (window.__wh?.state().t ?? 0) > t + 1, t0, { timeout: 120_000 }).catch(() => errors.push("world-history: the playhead didn't move while playing"));
    await press(page, "wh-play");
    await stageIs("playing", "0", 30_000).catch(() => errors.push("world-history: Pause didn't stop the film"));
    // The arrow keys step from caption to caption.
    const b0 = await stage.getAttribute("data-beat");
    await key(page, "ArrowRight");
    await page.waitForFunction((b) => document.querySelector('[data-testid="wh-stage"]').dataset.beat !== b, b0, { timeout: 60_000 }).catch(() => errors.push("world-history: → didn't move to the next caption"));
    // Free look: in, zoom with the button and the wheel (ctrl + wheel is a pinch), out.
    await press(page, "wh-look");
    await stageIs("free", "1", 30_000).catch(() => errors.push("world-history: Look around didn't start free look"));
    const d0 = (await film())?.dist ?? 0;
    await press(page, "wh-zoom-in");
    await page.waitForFunction((d) => (window.__wh?.state().dist ?? d) < d, d0, { timeout: 30_000 }).catch(() => errors.push("world-history: + didn't zoom in"));
    const d1 = (await film())?.dist ?? 0;
    const kept = await wheel(page, { deltaY: 240, ctrlKey: true });
    if (!kept) errors.push("world-history: a pinch (ctrl + wheel) reached the browser instead of the film");
    await page.waitForFunction((d) => (window.__wh?.state().dist ?? d) > d, d1, { timeout: 30_000 }).catch(() => errors.push("world-history: a pinch didn't zoom out"));
    await press(page, "wh-look");
    await stageIs("free", "0", 30_000).catch(() => errors.push("world-history: free look didn't end"));
    // The chapter rail jumps to a chapter, and the address follows.
    await press(page, "wh-rail-kalos");
    await stageIs("chapter", "kalos", 120_000).catch(() => errors.push("world-history: the chapter rail didn't jump to Kalos"));
    await page.waitForURL(/\/lab\/world-history\/kalos/, { timeout: 30_000 }).catch(() => errors.push("world-history: the address didn't follow the chapter"));
    // All that pressing with the site's sound off: not one AudioContext.
    const made = await page.evaluate(() => window.__audioContexts);
    if (made !== 0) errors.push(`world-history: ${made} AudioContext(s) started with the site's sound off`);
    // Sound on: the next press starts the film's audio.
    await page.evaluate(() => localStorage.setItem("pokeiq-muted", "0"));
    await page.getByTestId("wh-scene").dispatchEvent("pointerdown");
    await page.waitForFunction(() => window.__audioContexts > 0, null, { timeout: 20_000 }).catch(() => errors.push("world-history: no audio started with the sound on"));
    await page.evaluate(() => localStorage.setItem("pokeiq-muted", "1"));
  });

  await part(errors, "links", async () => {
    // Every chapter: its own page, title and preview card.
    for (const c of CHAPTERS) {
      const res = await page.request.get(`${BASE}/lab/world-history/${c.id}`);
      if (res.status() !== 200) { errors.push(`world-history: /lab/world-history/${c.id} returned ${res.status()}`); continue; }
      const html = await res.text();
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      if (!title.includes(c.title.replace(/'/g, "&#x27;")) && !title.includes(c.title)) errors.push(`world-history: ${c.id}'s title is "${title}"`);
      const og = html.match(/property="og:image" content="([^"]*)"/)?.[1] ?? "";
      if (!og.includes(`/lab/world-history/${c.id}/opengraph-image`)) errors.push(`world-history: ${c.id}'s preview image is ${og}`);
    }
    for (const path of ["/lab/world-history/opengraph-image", "/lab/world-history/creation/opengraph-image", "/lab/world-history/paldea/opengraph-image"]) {
      const og = await page.request.get(`${BASE}${path}`);
      if (og.status() !== 200 || !/image\/png/.test(og.headers()["content-type"] ?? "")) errors.push(`world-history: preview card ${path} failed (${og.status()})`);
    }
    if ((await page.request.get(`${BASE}/lab/world-history/not-a-chapter`)).status() !== 404) errors.push("world-history: an unknown chapter isn't a 404");
  });

  step("3D Lab: The History of the Pokémon World — make a 5 s video (a valid 1080 × 1920 MP4 with music), cancel a recording, phone layout");
  await part(errors, "video", async () => {
    await page.goto(`${BASE}/lab/world-history/kanto?q=draft&len=5&vq=draft&vfps=10`, { waitUntil: "load" });
    if (!(await ready())) throw new Error("the film never became ready for the video");
    await press(page, "wh-video");
    await page.getByTestId("wh-video-dialog").waitFor();
    // Cancel works mid-recording.
    await press(page, "wh-video-make");
    await page.getByTestId("wh-video-progress").waitFor({ timeout: 60_000 });
    await press(page, "wh-video-cancel");
    await page.getByTestId("wh-video-make").waitFor({ timeout: 300_000 }).catch(() => errors.push("world-history: Cancel didn't stop the recording"));
    // A full 5 s video.
    await press(page, "wh-video-make");
    const done = await page.getByTestId("wh-video-download").waitFor({ timeout: 25 * 60_000 }).then(() => true, () => false);
    if (!done) {
      const err = await page.getByTestId("wh-video-error").innerText().catch(() => "");
      errors.push(`world-history: the 5 s video never finished${err ? ` (${err})` : ""}`);
    } else {
      await page.screenshot({ path: `${OUT}/world-history-video-done.png` });
      const [download] = await Promise.all([page.waitForEvent("download"), press(page, "wh-video-download")]);
      const file = `${OUT}/world-history-test-video.mp4`;
      await download.saveAs(file);
      if (!/^pokeiq-history-kanto-5s\.mp4$/.test(download.suggestedFilename())) errors.push(`world-history: the video is named ${download.suggestedFilename()}`);
      const mp4 = inspectMp4(fs.readFileSync(file));
      if (mp4.order.join(",") !== "ftyp,moov,mdat" || !mp4.ends) errors.push(`world-history: the MP4's layout is ${mp4.order.join(",")}`);
      if (Math.abs(mp4.seconds - 5) > 0.3) errors.push(`world-history: the video lasts ${mp4.seconds} s, not 5`);
      const video = mp4.tracks.find((t) => t.kind === "vide");
      if (!video || video.width !== 1080 || video.height !== 1920) errors.push(`world-history: the video track is ${video ? `${video.width}×${video.height}` : "missing"}`);
      else if (video.samples !== 50) errors.push(`world-history: the video has ${video.samples} frames, expected 50 at 10 fps`);
      if (!mp4.tracks.some((t) => t.kind === "soun")) errors.push("world-history: the video has no music track");
    }
    await press(page, "wh-video-close");
  });

  await part(errors, "phone", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/lab/world-history?q=draft`, { waitUntil: "load" });
    if (!(await ready())) throw new Error("the film never became ready on a phone");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) errors.push("world-history: the phone layout scrolls sideways");
    for (const id of ["wh-play", "wh-video", "wh-chapters-open", "wh-mute", "wh-to-text"]) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box || box.x < 0 || box.x + box.width > 391) errors.push(`world-history: ${id} is off a 390 px screen`);
    }
    await page.screenshot({ path: `${OUT}/world-history-390.png` });
  });
  await context.close();
}
