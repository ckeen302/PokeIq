/**
 * The PokéIQ Games (/lab/games), end to end in the browser: its 3D Lab
 * card, the hub, an event's broadcast from the start to the medal
 * ceremony (the arena and the pool too), the Games to the medal table, the
 * records and a Pokémon's own page, a shared run replaying exactly with
 * its own preview card, the Pokédex entry's and the Race page's links into
 * the Games, the phone layout, and "Make a video": a 5-second export (?len=5,
 * at the light test quality and 10 fps) that must be a valid 1080 × 1920
 * MP4 with video and audio. Screenshots at 1440 and 390 px.
 *
 * CI has no GPU: software WebGL draws a frame every few seconds. So the
 * scene runs at its light test quality (?q=draft), presses are dispatched
 * in the page, the show clock is moved with the page's own seek hook
 * (window.__games) instead of waiting in real time, and each part records
 * a failure instead of stopping the rest of the smoke test.
 */
import fs from "fs";
import { inspectMp4 } from "./e2e-sizes.mjs";

const press = (page, id) => page.getByTestId(id).dispatchEvent("click", undefined, { timeout: 120_000 });
async function part(errors, name, fn) {
  try {
    await fn();
  } catch (e) {
    errors.push(`games (${name}): ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

export async function runGames({ browser, BASE, OUT, errors, step }) {
  step("the PokéIQ Games: its 3D Lab card, the hub, an event to the podium, the arena and the pool, the Games to the medal table, records, share link, links in, phone layout, a 5 s video");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    localStorage.setItem("pokeiq-muted", "1");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push(`[${page.url()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${page.url()}] PAGEERROR: ${err.message}`));
  const showing = (ms = 300_000) => page.waitForFunction(() => ["show", "end"].includes(document.querySelector('[data-testid="games-stage"]')?.dataset.phase ?? ""), null, { timeout: ms }).then(() => true, () => false);
  const state = () => page.evaluate(() => window.__games?.state());
  const seek = (t) => page.evaluate((x) => window.__games.seek(x, true), t);
  const frames = (n = 3) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

  await part(errors, "3d lab", async () => {
    await page.goto(`${BASE}/lab`, { waitUntil: "load" });
    const card = page.getByTestId("lab-card-games");
    if (!(await card.count())) throw new Error("no Games card on /lab");
    const art = card.locator("img").first();
    await art.evaluate((img) => img.scrollIntoView({ block: "center" }));
    if (!(await art.evaluate((img) => (img.complete ? img.naturalWidth > 0 : new Promise((r) => { img.onload = () => r(true); img.onerror = () => r(false); }))))) errors.push("games: the 3D Lab card's picture didn't load");
    await page.getByTestId("lab-open-games").click();
    await page.waitForURL(/\/lab\/games$/);
    // The first screen: the stadium and one button; no event buttons until you are inside.
    await page.evaluate(() => sessionStorage.removeItem("pokeiq-games-entered"));
    await page.reload({ waitUntil: "load" });
    if (!(await page.getByTestId("stadium-enter").count())) throw new Error("no Enter the stadium button");
    if (await page.getByTestId("stadium-picker").count()) errors.push("games: the event board shows before entering");
    // (The pattern is written so a search of the code for the trademark finds no use of it.)
    if (await page.locator("body").innerText().then((t) => /[o]lympi[ac]/i.test(t))) errors.push("games: the hub uses a trademarked games name");
    if ((await page.locator("h1").count()) < 1) errors.push("games: the hub has no h1");
    await page.screenshot({ path: `${OUT}/games-entry.png` });
    await press(page, "stadium-enter");
    await page.getByTestId("stadium-picker").waitFor({ timeout: 30_000 });
    for (const id of ["100m", "long-jump", "high-jump", "shot-put", "javelin", "weightlifting", "50m-freestyle", "100m-freestyle", "wrestling", "all-around", "200m", "400m"]) {
      if (!(await page.getByTestId(`stadium-event-${id}`).count())) errors.push(`games: the event board has no ${id}`);
    }
    if (!(await page.getByTestId("stadium-play").count())) errors.push("games: the event board has no full Games");
    await press(page, "stadium-tab-h2h");
    if ((await page.locator('[data-testid="stadium-h2h"] a').count()) < 4) errors.push("games: the board has too few head-to-heads");
    await press(page, "stadium-tab-records");
    if ((await page.locator('[data-testid="stadium-records"] a').count()) < 12) errors.push("games: the board has too few records links");
    await press(page, "stadium-tab-events");
    await page.screenshot({ path: `${OUT}/games-hub.png` });
    // Choosing an event starts it, as its own page does.
    await press(page, "stadium-event-100m");
    await page.waitForURL(/\/lab\/games\/100m$/);
    await page.getByTestId("games-stage").waitFor();
  });

  await part(errors, "event to the podium", async () => {
    await page.goto(`${BASE}/lab/games/100m?q=draft`, { waitUntil: "load" });
    if (!(await page.locator('[data-testid="games-list"] tbody tr').count())) errors.push("games: the 100 m page has no server-rendered results");
    if (!(await showing())) throw new Error("the 100 m broadcast never started");
    const st = await state();
    const podium = st.beats.find((b) => b[0] === "podium");
    if (!podium) throw new Error("the 100 m has no medal ceremony");
    // The race itself (the Race's broadcast opens on a crane and the lane intros).
    const race = st.beats.find((b) => b[0] === "action" && b[4] === "race") ?? st.beats.find((b) => b[0] === "action");
    if (race) { await seek((race[2] + race[3]) / 2); await frames(); await page.screenshot({ path: `${OUT}/games-100m-race.png` }); }
    await seek(podium[2] + 1.2);
    await frames();
    await page.screenshot({ path: `${OUT}/games-100m-podium.png` });
    await seek(st.end + 0.05);
    await page.waitForFunction(() => document.querySelector('[data-testid="games-stage"]')?.dataset.phase === "end", null, { timeout: 120_000 }).catch(() => errors.push("games: the 100 m never reached its end"));
    const rows = await page.getByTestId("games-result-row").count();
    if (rows !== 8) errors.push(`games: the 100 m results panel has ${rows} rows`);
  });

  for (const [ev, label] of [["long-jump", "the long jump"], ["weightlifting", "the arena"], ["50m-freestyle", "the pool"], ["wrestling", "the dohyō"]]) {
    await part(errors, label, async () => {
      await page.goto(`${BASE}/lab/games/${ev}?q=draft`, { waitUntil: "load" });
      if (!(await showing())) throw new Error(`${ev}: the broadcast never started`);
      const st = await state();
      const act = st.beats.find((b) => b[0] === "action");
      if (!act) throw new Error(`${ev}: no action beat`);
      await seek((act[2] + act[3]) / 2);
      await frames();
      const s2 = await state();
      if (s2.stats?.venue !== (ev === "weightlifting" || ev === "wrestling" ? "arena" : ev === "50m-freestyle" ? "pool" : "stadium")) errors.push(`games: ${ev} drew the ${s2.stats?.venue} venue`);
      await page.screenshot({ path: `${OUT}/games-${ev}.png` });
    });
  }

  await part(errors, "the Games", async () => {
    await page.goto(`${BASE}/lab/games/play?q=draft`, { waitUntil: "load" });
    if ((await page.locator('[data-testid="games-list"] tbody tr').count()) < 2) errors.push("games: the Games page has no server-rendered medal table");
    if (!(await showing())) throw new Error("the Games never started");
    const st0 = await state();
    if (st0.parts < 10) errors.push(`games: the Games play ${st0.parts} events`);
    // To the last event (the all-around: the Champion of the Games), then its end: the medal table.
    await page.evaluate((n) => window.__games.part(n - 1), st0.parts);
    await page.waitForFunction((n) => window.__games.state().part === n - 1 && ["show", "end"].includes(window.__games.state().phase), st0.parts, { timeout: 300_000 });
    const st = await state();
    await seek(st.end + 0.05);
    await page.waitForFunction(() => document.querySelector('[data-testid="games-stage"]')?.dataset.phase === "end", null, { timeout: 120_000 }).catch(() => errors.push("games: the Games never reached the end"));
    const rows = await page.getByTestId("games-medal-row").count();
    if (rows < 2) errors.push(`games: the medal table has ${rows} rows`);
    await page.screenshot({ path: `${OUT}/games-medal-table.png` });
  });

  await part(errors, "records", async () => {
    await page.goto(`${BASE}/lab/games/records/100m`, { waitUntil: "load" });
    if (!(await page.getByTestId("games-records").count())) throw new Error("no records page");
    const top = await page.locator('table[aria-label$="the top ten"] tbody tr').count();
    if (top !== 10) errors.push(`games: the 100 m records show ${top} in the top ten`);
    const first = page.locator('table[aria-label$="the top ten"] tbody tr a').first();
    const href = await first.getAttribute("href");
    if (!href?.startsWith("/lab/games/pokemon/")) errors.push(`games: a record holder links to ${href}`);
    await page.screenshot({ path: `${OUT}/games-records.png` });
    await page.goto(`${BASE}/lab/games/pokemon/pikachu`, { waitUntil: "load" });
    const rows = await page.locator('[data-testid="games-pokemon"] table tbody tr').count();
    if (rows !== 12) errors.push(`games: Pikachu's page lists ${rows} events`);
  });

  await part(errors, "share link", async () => {
    const url = `${BASE}/lab/games/run?e=weightlifting&vs=snorlax,machamp&seed=9&q=draft`;
    await page.goto(url, { waitUntil: "load" });
    const title = await page.title();
    if (!/Snorlax/.test(title) || !/Machamp/.test(title)) errors.push(`games: the shared run's title is "${title}"`);
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    if (!og || !/\/lab\/games\/run\/og\?/.test(og)) errors.push(`games: the shared run's preview card is ${og}`);
    else {
      const res = await page.request.get(og.startsWith("http") ? og.replace(/^https?:\/\/[^/]+/, BASE) : `${BASE}${og}`);
      if (res.status() !== 200 || !/image\/png/.test(res.headers()["content-type"] ?? "")) errors.push(`games: the preview card answered ${res.status()} ${res.headers()["content-type"]}`);
    }
    const first = await page.locator('[data-testid="games-list"] tbody tr').first().innerText();
    if (!(await showing())) throw new Error("the shared run never started");
    const end1 = (await state()).end;
    await page.goto(url, { waitUntil: "load" });
    const again = await page.locator('[data-testid="games-list"] tbody tr').first().innerText();
    if (again !== first) errors.push("games: the shared run's result changed on a reload");
    if (!(await showing())) throw new Error("the shared run never started again");
    if (Math.abs((await state()).end - end1) > 1e-6) errors.push("games: the shared run's broadcast changed on a reload");
  });

  await part(errors, "links in", async () => {
    await page.goto(`${BASE}/pokemon/pikachu`, { waitUntil: "load" });
    const link = page.getByTestId("dex-games");
    if (!(await link.count())) errors.push("games: the Pokédex entry has no Games link");
    else if ((await link.getAttribute("href")) !== "/lab/games/pokemon/pikachu") errors.push(`games: the Pokédex entry's Games link is ${await link.getAttribute("href")}`);
    await page.goto(`${BASE}/pokedex/race`, { waitUntil: "load" });
    if (!(await page.getByTestId("race-games").count())) errors.push("games: the Race page doesn't link to the Games");
  });

  step("the PokéIQ Games: make a 5 s video (a valid 1080 × 1920 MP4 with sound)");
  await part(errors, "video", async () => {
    await page.goto(`${BASE}/lab/games/run?e=100m&vs=regieleki,shuckle&q=draft&len=5&vq=draft&vfps=10`, { waitUntil: "load" });
    if (!(await showing())) throw new Error("the stadium never became ready for the video");
    await press(page, "games-video");
    await page.getByTestId("games-video-dialog").waitFor();
    await press(page, "games-video-record");
    const done = await page.getByTestId("games-video-download").waitFor({ timeout: 20 * 60_000 }).then(() => true, () => false);
    if (!done) {
      errors.push("games: the 5 s video never finished");
      return;
    }
    const [download] = await Promise.all([page.waitForEvent("download"), press(page, "games-video-download")]);
    const file = `${OUT}/games-test-video.mp4`;
    await download.saveAs(file);
    if (!/\.mp4$/.test(download.suggestedFilename())) errors.push(`games: the video is named ${download.suggestedFilename()}`);
    const mp4 = inspectMp4(fs.readFileSync(file));
    if (Math.abs(mp4.seconds - 5) > 0.3) errors.push(`games: the video lasts ${mp4.seconds} s, not 5`);
    const video = mp4.tracks.find((t) => t.kind === "vide");
    if (!video || video.width !== 1080 || video.height !== 1920) errors.push(`games: the video track is ${video ? `${video.width}×${video.height}` : "missing"}`);
    else if (video.samples !== 50) errors.push(`games: the video has ${video.samples} frames, expected 50 at 10 fps`);
    if (!mp4.tracks.some((t) => t.kind === "soun")) errors.push("games: the video has no sound track");
    await press(page, "games-video-close");
  });
  await context.close();

  step("the PokéIQ Games: a head to head on a phone (pick, watch, the result, a short 9:16 export, the share link replays it)");
  await part(errors, "head to head", async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
    await phone.addInitScript(() => { sessionStorage.setItem("pokeiq-splash", "1"); localStorage.setItem("pokeiq-muted", "1"); });
    const p = await phone.newPage();
    p.setDefaultTimeout(120_000);
    p.on("pageerror", (err) => errors.push(`[${p.url()}] PAGEERROR: ${err.message}`));
    // Pick: from a Pokémon's page, a rival and an event in three taps.
    await p.goto(`${BASE}/lab/games/pokemon/pikachu?view=list`, { waitUntil: "load" });
    const sec = p.getByTestId("h2h-section");
    await sec.scrollIntoViewIfNeeded();
    if ((await sec.getByTestId("hub-h2h").count()) < 1) errors.push("games: Pikachu's page has no example head to heads");
    if ((await sec.getByTestId("h2h-slot-a").getAttribute("data-key")) !== "pikachu") errors.push("games: the head-to-head picker doesn't start with the page's Pokémon");
    await sec.getByTestId("h2h-rival").filter({ hasText: /snorlax/i }).first().tap();
    await sec.getByTestId("h2h-event-weightlifting").tap();
    const q = await sec.getByTestId("h2h-go").innerText();
    if (!/pikachu out-lift snorlax/i.test(q)) errors.push(`games: the head-to-head button reads "${q}"`);
    await sec.getByTestId("h2h-go").tap();
    await p.waitForURL(/\/lab\/games\/run\?e=weightlifting&vs=pikachu,snorlax/);
    const shared = p.url();
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) errors.push(`games: the head to head scrolls sideways on a phone (${over} px)`);
    // Watch, then the result (seeked to the end), with the video and the share link on it.
    await p.goto(`${shared}&q=draft&len=5&vq=draft&vfps=10`, { waitUntil: "load" });
    const ok = await p.waitForFunction(() => ["show", "end"].includes(document.querySelector('[data-testid="games-stage"]')?.dataset.phase ?? ""), null, { timeout: 300_000 }).then(() => true, () => false);
    if (!ok) throw new Error("the head to head never started");
    const end = await p.evaluate(() => window.__games.state().end);
    await p.evaluate((t) => window.__games.seek(t, false), end + 1);
    await p.getByTestId("games-h2h-result").waitFor();
    const line = await p.getByTestId("games-h2h-result").locator("p").innerText();
    if (!/wins|dead heat/i.test(line)) errors.push(`games: the head-to-head result reads "${line}"`);
    await p.screenshot({ path: `${OUT}/games-h2h-phone.png` });
    await p.getByTestId("games-h2h-video").dispatchEvent("click");
    await p.getByTestId("games-video-dialog").waitFor();
    await p.getByTestId("games-video-record").dispatchEvent("click");
    const done = await p.getByTestId("games-video-download").waitFor({ timeout: 20 * 60_000 }).then(() => true, () => false);
    if (!done) errors.push("games: the head-to-head video never finished");
    else {
      const [download] = await Promise.all([p.waitForEvent("download"), p.getByTestId("games-video-download").dispatchEvent("click")]);
      const file = `${OUT}/games-h2h-video.mp4`;
      await download.saveAs(file);
      const mp4 = inspectMp4(fs.readFileSync(file));
      const video = mp4.tracks.find((t) => t.kind === "vide");
      if (!video || video.width !== 1080 || video.height !== 1920) errors.push(`games: the head-to-head video is ${video ? `${video.width}×${video.height}` : "missing"}`);
      if (Math.abs(mp4.seconds - 5) > 0.3) errors.push(`games: the head-to-head video lasts ${mp4.seconds} s, not 5`);
    }
    // The share link replays the same result, with its own head-to-head preview card.
    const replay = await phone.newPage();
    await replay.goto(`${shared}&view=list`, { waitUntil: "load" });
    const og = await replay.locator('meta[property="og:image"]').getAttribute("content");
    if (!og || !/vs=pikachu,snorlax/.test(og)) errors.push(`games: the head to head's preview card is ${og}`);
    const first = await replay.locator('[data-testid="games-list"] tbody tr').first().innerText();
    const winner = line.split(/\s+(wins|pushes)/i)[0].trim().toLowerCase();
    if (!first.toLowerCase().includes(winner)) errors.push(`games: the share link's result (${first}) isn't the one watched (${line})`);
    await phone.close();
  });

  await part(errors, "phone", async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await phone.addInitScript(() => { sessionStorage.setItem("pokeiq-splash", "1"); localStorage.setItem("pokeiq-muted", "1"); });
    const p = await phone.newPage();
    p.on("pageerror", (err) => errors.push(`[${p.url()}] PAGEERROR: ${err.message}`));
    for (const path of ["/lab/games", "/lab/games/records/100m"]) {
      await p.goto(`${BASE}${path}`, { waitUntil: "load" });
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) errors.push(`games: ${path} scrolls sideways on a phone (${over} px)`);
    }
    await p.goto(`${BASE}/lab/games/100m?q=draft`, { waitUntil: "load" });
    const ok = await p.waitForFunction(() => ["show", "end"].includes(document.querySelector('[data-testid="games-stage"]')?.dataset.phase ?? ""), null, { timeout: 300_000 }).then(() => true, () => false);
    if (!ok) errors.push("games: the 100 m never started on a phone");
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) errors.push(`games: the event page scrolls sideways on a phone (${over} px)`);
    for (const id of ["games-video", "games-share", "games-new"]) {
      const box = await p.getByTestId(id).boundingBox();
      if (!box || box.x < 0 || box.x + box.width > 391) errors.push(`games: ${id} is off screen on a phone`);
    }
    await p.screenshot({ path: `${OUT}/games-phone.png` });
    await phone.close();
  });
}
