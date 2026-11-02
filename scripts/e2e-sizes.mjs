/**
 * Pokémon Sizes (/pokedex/sizes), end to end in the browser: the Sizes tab,
 * the 3D scene and its first-visit Play glide, stopping it, search and
 * fly-to, the arrow keys, a two-Pokémon comparison and its share link and
 * preview card, a Pokémon's own size page, the list fallback, the sound
 * staying off when the site is muted, and "Make a video": a 5-second
 * export (?len=5, at the light test quality and 10 fps so it runs in CI
 * without a GPU) that must be a valid 1080 × 1920 MP4 with video and audio
 * tracks, plus cancelling a recording. Screenshots at 1440 and 390 px.
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
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push(`[${page.url()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${page.url()}] PAGEERROR: ${err.message}`));
  const stage = page.locator('[data-testid="sizes-stage"]');
  const ready = () => page.locator('[data-testid="sizes-stage"][data-ready="1"]').waitFor({ timeout: 120_000 }).then(() => true, () => false);
  const attr = (name) => stage.getAttribute(`data-${name}`);

  await page.goto(`${BASE}/pokedex`, { waitUntil: "load" });
  await page.getByTestId("dex-tab-sizes").click();
  await page.waitForURL(/\/pokedex\/sizes$/);
  if (!(await page.locator('[data-testid="sizes-list"] #size-pikachu').count())) errors.push("sizes: the server-rendered table is missing Pikachu");
  if (!(await ready())) {
    errors.push("sizes: the 3D scene never became ready");
  } else {
    // First visit: the glide plays by itself, under the lineup's title card.
    await page.waitForFunction(() => document.querySelector('[data-testid="sizes-stage"]')?.dataset.kind === "play", null, { timeout: 20_000 }).catch(() => errors.push("sizes: the first visit didn't play the glide"));
    await page.getByTestId("sizes-hook").waitFor({ timeout: 10_000 }).catch(() => errors.push("sizes: no title card as the glide began"));
    if (Number(await attr("count")) < 1026) errors.push(`sizes: the full line has ${await attr("count")} figures`);
    await page.screenshot({ path: `${OUT}/sizes-play.png` });
    // Stop.
    await page.getByTestId("sizes-play").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="sizes-stage"]')?.dataset.kind === "explore", null, { timeout: 10_000 }).catch(() => errors.push("sizes: Stop didn't stop the glide"));
    // Search and fly to Wailord.
    await page.getByTestId("sizes-search-toggle").click();
    await page.getByTestId("sizes-search").fill("wailord");
    await page.locator('[data-testid="sizes-search-result"][data-key="wailord"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="sizes-stage"]')?.dataset.focus === "wailord", null, { timeout: 30_000 }).catch(async () => errors.push(`sizes: searching didn't fly to Wailord (focus ${await attr("focus")})`));
    await page.screenshot({ path: `${OUT}/sizes-wailord.png` });
    // The arrow keys step along the line.
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector('[data-testid="sizes-stage"]')?.dataset.focus !== "wailord", null, { timeout: 30_000 }).catch(() => errors.push("sizes: → didn't step to the next Pokémon"));
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => document.querySelector('[data-testid="sizes-stage"]')?.dataset.focus === "wailord", null, { timeout: 30_000 }).catch(() => errors.push("sizes: ← didn't step back to Wailord"));
    // Compare Wailord with Eternatus: the line becomes the two (and the human) and the address its share link.
    await page.getByTestId("sizes-compare").click();
    await page.getByTestId("sizes-compare-tray").waitFor();
    await page.getByTestId("sizes-search").fill("eternatus");
    await page.locator('[data-testid="sizes-search-result"][data-key="eternatus"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="sizes-stage"]')?.dataset.count === "3", null, { timeout: 30_000 }).catch(async () => errors.push(`sizes: comparing two left ${await attr("count")} figures on the line`));
    if ((await page.getByTestId("sizes-compare-chip").count()) !== 2) errors.push("sizes: the comparison tray doesn't hold two Pokémon");
    const u = new URL(page.url());
    if (u.pathname !== "/pokedex/sizes/compare" || u.searchParams.get("vs") !== "wailord,eternatus") errors.push(`sizes: the comparison's address is ${page.url()}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/sizes-compare-1440.png` });
    // The site's sound was off throughout: no AudioContext at all.
    const made = await page.evaluate(() => window.__audioContexts);
    if (made !== 0) errors.push(`sizes: ${made} AudioContext(s) started with the site's sound off`);
    // List view.
    await page.getByTestId("sizes-list-view").click();
    await stage.waitFor({ state: "detached" });
    await page.getByTestId("sizes-3d-view").waitFor();
  }

  // A shared comparison: its own title, the comparison on screen, its own preview card.
  await page.goto(`${BASE}/pokedex/sizes/compare?vs=pikachu,snorlax`, { waitUntil: "load" });
  if (!/Pikachu vs Snorlax/.test(await page.title())) errors.push(`sizes: the comparison link's title is "${await page.title()}"`);
  if (await ready()) {
    await page.waitForFunction(() => document.querySelector('[data-testid="sizes-stage"]')?.dataset.count === "3", null, { timeout: 30_000 }).catch(() => errors.push("sizes: the comparison link didn't open the comparison"));
    if ((await attr("kind")) === "play") errors.push("sizes: a shared link auto-played");
  }
  const ogUrl = await page.locator('meta[property="og:image"]').getAttribute("content");
  if (!ogUrl || !/\/pokedex\/sizes\/compare\/og\?vs=pikachu,snorlax/.test(ogUrl)) errors.push(`sizes: the comparison's preview image is ${ogUrl}`);
  for (const path of ["/pokedex/sizes/compare/og?vs=pikachu,snorlax", "/pokedex/sizes/opengraph-image", "/pokedex/sizes/legendaries/opengraph-image", "/pokedex/sizes/wailord/opengraph-image"]) {
    const og = await page.request.get(`${BASE}${path}`);
    if (og.status() !== 200 || !/image\/png/.test(og.headers()["content-type"] ?? "")) errors.push(`sizes: preview card ${path} failed (${og.status()})`);
  }
  // A Pokémon's own size page, and a preset's.
  await page.goto(`${BASE}/pokedex/sizes/snorlax`, { waitUntil: "load" });
  if (!/How big is Snorlax\?/.test(await page.title())) errors.push(`sizes: Snorlax's size page title is "${await page.title()}"`);
  if (await ready()) await page.waitForFunction(() => document.querySelector('[data-testid="sizes-stage"]')?.dataset.focus === "snorlax", null, { timeout: 30_000 }).catch(() => errors.push("sizes: Snorlax's page didn't open on Snorlax"));
  const legend = await page.request.get(`${BASE}/pokedex/sizes/legendaries`);
  if (legend.status() !== 200) errors.push(`sizes: the Legendaries page returned ${legend.status()}`);
  if ((await page.request.get(`${BASE}/pokedex/sizes/not-a-pokemon`)).status() !== 404) errors.push("sizes: an unknown name isn't a 404");
  // The list fallback opens on a Pokémon's link too.
  await page.goto(`${BASE}/pokedex/sizes/snorlax?view=list`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="sizes-list"] #size-snorlax.sz-list-hit').waitFor({ timeout: 15_000 }).catch(() => errors.push("sizes: the list view didn't bring Snorlax into view"));
  // The Pokédex entry links to its size.
  await page.goto(`${BASE}/pokemon/pikachu`, { waitUntil: "domcontentloaded" });
  if ((await page.getByTestId("dex-see-size").getAttribute("href")) !== "/pokedex/sizes/pikachu") errors.push("sizes: Pikachu's Pokédex entry has no 'See its size' link");

  step("pokédex Sizes: make a 5 s video (a valid 1080 × 1920 MP4 with music), cancel a recording, phone layout");
  await page.goto(`${BASE}/pokedex/sizes/compare?vs=pikachu,snorlax&len=5&vq=draft&vfps=10`, { waitUntil: "load" });
  if (await ready()) {
    await page.getByTestId("sizes-video").click();
    await page.getByTestId("sizes-video-dialog").waitFor();
    // Cancel works mid-recording.
    await page.getByTestId("sizes-video-length-5").click();
    await page.getByTestId("sizes-video-record").click();
    await page.getByTestId("sizes-video-progress").waitFor({ timeout: 30_000 });
    await page.getByTestId("sizes-video-cancel").click();
    await page.getByTestId("sizes-video-record").waitFor({ timeout: 60_000 }).catch(() => errors.push("sizes: Cancel didn't stop the recording"));
    // A full 5 s video.
    await page.getByTestId("sizes-video-record").click();
    const done = await page.getByTestId("sizes-video-download").waitFor({ timeout: 15 * 60_000 }).then(() => true, () => false);
    if (!done) {
      errors.push("sizes: the 5 s video never finished");
    } else {
      await page.screenshot({ path: `${OUT}/sizes-video-done.png` });
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("sizes-video-download").click()]);
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
    await page.getByTestId("sizes-video-close").click();
  }
  // Phone: the stage, its controls and the comparison fit a 390 px screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/pokedex/sizes/compare?vs=pikachu,snorlax`, { waitUntil: "load" });
  if (await ready()) {
    await page.waitForTimeout(2000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) errors.push("sizes: the phone layout scrolls sideways");
    for (const id of ["sizes-play", "sizes-compare", "sizes-video", "sizes-share", "sizes-lineup"]) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box || box.x < 0 || box.x + box.width > 391) errors.push(`sizes: ${id} is off a 390 px screen`);
    }
    await page.screenshot({ path: `${OUT}/sizes-390.png` });
  }
  await context.close();
}
