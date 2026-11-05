/**
 * The Story of Pokémon (/lab/pokemon-story), end to end in the browser,
 * built like the World History check: the server-rendered story with its
 * sources and music credits, the text version (?view=list) with its links
 * to every release and to the world's own history, the film (the stage
 * opening, Play and Pause, the arrow keys, the chapter rail, free look and
 * zoom), every chapter's deep link with its own title and preview card (a
 * 404 for an unknown one), no AudioContext while the site is muted, a
 * 5-second chapter video that must be a valid 1080 × 1920 MP4 with music,
 * cancelling a recording, and the phone layout. Pages are out of search
 * until POKEMON_STORY_LIVE, which this doesn't depend on.
 */
import fs from "fs";
import { inspectMp4 } from "./e2e-sizes.mjs";

const CHAPTERS = JSON.parse(fs.readFileSync(new URL("../src/data/pokemon-story.json", import.meta.url), "utf8")).chapters;

/** A click handled in the page (React sees it like any click), immune to input queued behind slow frames. */
const press = (page, id) => page.getByTestId(id).dispatchEvent("click", undefined, { timeout: 120_000 });
/** A key press on the page (the film listens on the window). */
const key = (page, k) => page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk, bubbles: true })), k);
/** A wheel turn over the 3D scene, dispatched in the page. */
const wheel = (page, init) =>
  page.getByTestId("ps-scene").evaluate((el, i) => {
    const r = el.getBoundingClientRect();
    return !el.dispatchEvent(new WheelEvent("wheel", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, ...i }));
  }, init, { timeout: 120_000 });
async function part(errors, name, fn) {
  try {
    await fn();
  } catch (e) {
    errors.push(`pokemon-story (${name}): ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

export async function runPokemonStory({ browser, BASE, OUT, errors, step }) {
  step("3D Lab: The Story of Pokémon — sourced text, text version, film controls, deep links and preview cards");
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
  const stage = page.locator('[data-testid="ps-stage"]');
  const ready = () => page.locator('[data-testid="ps-stage"][data-ready="1"]').waitFor({ timeout: 240_000 }).then(() => true, () => false);
  const stageIs = (name, value, ms = 300_000) => page.waitForFunction(([n, v]) => document.querySelector('[data-testid="ps-stage"]')?.dataset[n] === v, [name, value], { timeout: ms });
  const film = () => page.evaluate(() => window.__ps?.state() ?? null);

  await part(errors, "server text", async () => {
    // Without JavaScript the page is the whole history with its sources.
    const res = await page.request.get(`${BASE}/lab/pokemon-story`, { timeout: 180_000 });
    if (res.status() !== 200) throw new Error(`the page returned ${res.status()}`);
    const html = await res.text();
    for (const c of CHAPTERS) if (!html.includes(c.title.replace(/'/g, "&#x27;")) && !html.includes(c.title)) errors.push(`pokemon-story: the server-rendered page is missing "${c.title}"`);
    if (!/time\.com/.test(html)) errors.push("pokemon-story: the server-rendered page has no sources");
    if (!/CREDITS|CC0|Creative Commons/i.test(html)) errors.push("pokemon-story: the music credits are missing");
  });

  await part(errors, "text version", async () => {
    await page.goto(`${BASE}/lab/pokemon-story?view=list`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("ps-text").waitFor({ timeout: 30_000 });
    if ((await page.locator('[data-testid^="ps-chapter-"]').count()) !== CHAPTERS.length) errors.push("pokemon-story: the text version doesn't list every chapter");
    if (!(await page.getByTestId("ps-sources-collector").count())) errors.push("pokemon-story: the text version has no sources for The Collector");
    if ((await page.getByTestId("ps-every-release").getAttribute("href").catch(() => null)) !== "/pokedex/timeline") errors.push("pokemon-story: Explore every release doesn't lead to /pokedex/timeline");
    if ((await page.getByTestId("ps-world-history").getAttribute("href").catch(() => null)) !== "/lab/world-history") errors.push("pokemon-story: the world's own history link is wrong");
    if (!(await page.getByTestId("ps-music-credits").count())) errors.push("pokemon-story: the text version has no music credits");
    await page.screenshot({ path: `${OUT}/pokemon-story-text.png` });
  });

  await part(errors, "film", async () => {
    await page.goto(`${BASE}/lab/pokemon-story/collector?q=draft`, { waitUntil: "load" });
    if (!/The Collector/.test(await page.title())) errors.push(`pokemon-story: The Collector's title is "${await page.title()}"`);
    if (!(await ready())) throw new Error("the film never became ready");
    await stageIs("loading", "0").catch(() => errors.push("pokemon-story: the first chapter never finished loading"));
    if ((await stage.getAttribute("data-chapter")) !== "collector") errors.push("pokemon-story: the Collector link didn't open on it");
    await page.screenshot({ path: `${OUT}/pokemon-story-1440.png` });
    // Play runs the film; Pause stops it.
    const t0 = (await film())?.t ?? 0;
    await press(page, "ps-play");
    await stageIs("playing", "1", 30_000).catch(() => errors.push("pokemon-story: Play didn't start the film"));
    await page.waitForFunction((t) => (window.__ps?.state().t ?? 0) > t + 1, t0, { timeout: 120_000 }).catch(() => errors.push("pokemon-story: the playhead didn't move while playing"));
    await press(page, "ps-play");
    await stageIs("playing", "0", 30_000).catch(() => errors.push("pokemon-story: Pause didn't stop the film"));
    // The arrow keys step from caption to caption.
    const b0 = await stage.getAttribute("data-beat");
    await key(page, "ArrowRight");
    await page.waitForFunction((b) => document.querySelector('[data-testid="ps-stage"]').dataset.beat !== b, b0, { timeout: 60_000 }).catch(() => errors.push("pokemon-story: → didn't move to the next caption"));
    // Free look: in, zoom with the button and the wheel (ctrl + wheel is a pinch), out.
    await press(page, "ps-look");
    await stageIs("free", "1", 30_000).catch(() => errors.push("pokemon-story: Look around didn't start free look"));
    const d0 = (await film())?.dist ?? 0;
    await press(page, "ps-zoom-in");
    await page.waitForFunction((d) => (window.__ps?.state().dist ?? d) < d, d0, { timeout: 30_000 }).catch(() => errors.push("pokemon-story: + didn't zoom in"));
    const d1 = (await film())?.dist ?? 0;
    const kept = await wheel(page, { deltaY: 240, ctrlKey: true });
    if (!kept) errors.push("pokemon-story: a pinch (ctrl + wheel) reached the browser instead of the film");
    await page.waitForFunction((d) => (window.__ps?.state().dist ?? d) > d, d1, { timeout: 30_000 }).catch(() => errors.push("pokemon-story: a pinch didn't zoom out"));
    await press(page, "ps-look");
    await stageIs("free", "0", 30_000).catch(() => errors.push("pokemon-story: free look didn't end"));
    // The chapter rail jumps to a chapter, and the address follows.
    await press(page, "ps-rail-outside");
    await stageIs("chapter", "outside", 120_000).catch(() => errors.push("pokemon-story: the chapter rail didn't jump to Outside"));
    await page.waitForURL(/\/lab\/pokemon-story\/outside/, { timeout: 30_000 }).catch(() => errors.push("pokemon-story: the address didn't follow the chapter"));
    // All that pressing with the site's sound off: not one AudioContext.
    const made = await page.evaluate(() => window.__audioContexts);
    if (made !== 0) errors.push(`pokemon-story: ${made} AudioContext(s) started with the site's sound off`);
    // Sound on: the next press starts the film's audio.
    await page.evaluate(() => localStorage.setItem("pokeiq-muted", "0"));
    await page.getByTestId("ps-scene").dispatchEvent("pointerdown");
    await page.waitForFunction(() => window.__audioContexts > 0, null, { timeout: 20_000 }).catch(() => errors.push("pokemon-story: no audio started with the sound on"));
    await page.evaluate(() => localStorage.setItem("pokeiq-muted", "1"));
  });

  await part(errors, "links", async () => {
    // Every chapter: its own page, title and preview card.
    for (const c of CHAPTERS) {
      const res = await page.request.get(`${BASE}/lab/pokemon-story/${c.id}`, { timeout: 180_000 });
      if (res.status() !== 200) { errors.push(`pokemon-story: /lab/pokemon-story/${c.id} returned ${res.status()}`); continue; }
      const html = await res.text();
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      if (!title.includes(c.title.replace(/'/g, "&#x27;")) && !title.includes(c.title)) errors.push(`pokemon-story: ${c.id}'s title is "${title}"`);
      const og = html.match(/property="og:image" content="([^"]*)"/)?.[1] ?? "";
      if (!og.includes(`/lab/pokemon-story/${c.id}/opengraph-image`)) errors.push(`pokemon-story: ${c.id}'s preview image is ${og}`);
    }
    for (const path of ["/lab/pokemon-story/opengraph-image", "/lab/pokemon-story/collector/opengraph-image", "/lab/pokemon-story/thirty/opengraph-image"]) {
      const og = await page.request.get(`${BASE}${path}`, { timeout: 180_000 });
      if (og.status() !== 200 || !/image\/png/.test(og.headers()["content-type"] ?? "")) errors.push(`pokemon-story: preview card ${path} failed (${og.status()})`);
    }
    if ((await page.request.get(`${BASE}/lab/pokemon-story/not-a-chapter`, { timeout: 180_000 })).status() !== 404) errors.push("pokemon-story: an unknown chapter isn't a 404");
  });

  step("3D Lab: The Story of Pokémon — make a 5 s video (a valid 1080 × 1920 MP4 with music), cancel a recording, phone layout");
  await part(errors, "video", async () => {
    await page.goto(`${BASE}/lab/pokemon-story/cable?q=draft&len=5&vq=draft&vfps=10`, { waitUntil: "load" });
    if (!(await ready())) throw new Error("the film never became ready for the video");
    await press(page, "ps-video");
    await page.getByTestId("ps-video-dialog").waitFor();
    // Cancel works mid-recording.
    await press(page, "ps-video-make");
    await page.getByTestId("ps-video-progress").waitFor({ timeout: 60_000 });
    await press(page, "ps-video-cancel");
    await page.getByTestId("ps-video-make").waitFor({ timeout: 300_000 }).catch(() => errors.push("pokemon-story: Cancel didn't stop the recording"));
    // A full 5 s video.
    await press(page, "ps-video-make");
    const done = await page.getByTestId("ps-video-download").waitFor({ timeout: 25 * 60_000 }).then(() => true, () => false);
    if (!done) {
      const err = await page.getByTestId("ps-video-error").innerText().catch(() => "");
      errors.push(`pokemon-story: the 5 s video never finished${err ? ` (${err})` : ""}`);
    } else {
      await page.screenshot({ path: `${OUT}/pokemon-story-video-done.png` });
      const [download] = await Promise.all([page.waitForEvent("download"), press(page, "ps-video-download")]);
      const file = `${OUT}/pokemon-story-test-video.mp4`;
      await download.saveAs(file);
      if (!/^pokeiq-story-cable-5s\.mp4$/.test(download.suggestedFilename())) errors.push(`pokemon-story: the video is named ${download.suggestedFilename()}`);
      const mp4 = inspectMp4(fs.readFileSync(file));
      if (mp4.order.join(",") !== "ftyp,moov,mdat" || !mp4.ends) errors.push(`pokemon-story: the MP4's layout is ${mp4.order.join(",")}`);
      if (Math.abs(mp4.seconds - 5) > 0.3) errors.push(`pokemon-story: the video lasts ${mp4.seconds} s, not 5`);
      const video = mp4.tracks.find((t) => t.kind === "vide");
      if (!video || video.width !== 1080 || video.height !== 1920) errors.push(`pokemon-story: the video track is ${video ? `${video.width}×${video.height}` : "missing"}`);
      else if (video.samples !== 50) errors.push(`pokemon-story: the video has ${video.samples} frames, expected 50 at 10 fps`);
      if (!mp4.tracks.some((t) => t.kind === "soun")) errors.push("pokemon-story: the video has no music track");
    }
    await press(page, "ps-video-close");
  });

  await part(errors, "phone", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/lab/pokemon-story?q=draft`, { waitUntil: "load" });
    if (!(await ready())) throw new Error("the film never became ready on a phone");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) errors.push("pokemon-story: the phone layout scrolls sideways");
    for (const id of ["ps-play", "ps-video", "ps-chapters-open", "ps-mute", "ps-to-text"]) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box || box.x < 0 || box.x + box.width > 391) errors.push(`pokemon-story: ${id} is off a 390 px screen`);
    }
    await page.screenshot({ path: `${OUT}/pokemon-story-390.png` });
  });
  await context.close();
}
