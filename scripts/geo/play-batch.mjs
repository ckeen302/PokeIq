/**
 * Plays a batch of new PokéGuessr screenshots before they go live: every new
 * shot is dealt in a real round on a local build, its picture is loaded
 * through the game's own picture route, and the reveal is checked against the
 * place and game the batch gave it.
 *
 * Run it in a scratch checkout (a git worktree), never the one you commit from:
 * `prepare` rewrites src/data/geo.json there so rounds deal only the new shots.
 *
 *   # 1. the batch's files in a local fake media store (nothing goes near the real bucket)
 *   npx tsx scripts/geo/upload-additions.ts --to-dir /tmp/fake-media
 *   # 2. rounds deal only the shots that are new since <base> (default origin/main)
 *   node scripts/geo/play-batch.mjs prepare [base]
 *   # 3. a local server reading pictures from the fake store
 *   node scripts/geo/play-batch.mjs serve /tmp/fake-media 3999 &
 *   NEXT_PUBLIC_MEDIA_BASE=http://localhost:3999 POKEIQ_SECRET=… POKEIQ_LOCAL_ACCOUNTS=1 npx next dev -p 3100 &
 *   # 4. play until every new shot has been dealt; with --ui, also a few rounds in Chromium with screenshots
 *   node scripts/geo/play-batch.mjs play http://localhost:3100 [--ui outDir]
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "src/data/geo.json");
const LIST = path.join(ROOT, ".data/play-batch.json");
const [cmd, ...args] = process.argv.slice(2);

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const label = (p) => `${p.region} | ${p.parent ? `${p.name} (${p.parent})` : p.name}`;

if (cmd === "prepare") {
  const base = args[0] ?? "origin/main";
  const before = JSON.parse(execFileSync("git", ["show", `${base}:src/data/geo.json`], { maxBuffer: 1 << 30 }).toString());
  const old = new Set(before.world.locations.flatMap((l) => l.shots.map((s) => s.id)));
  const geo = readJson(DATA);
  const expected = {};
  for (const l of geo.world.locations) for (const s of l.shots) if (!old.has(s.id)) expected[s.id] = { region: l.region, name: l.name, parent: l.parent, game: s.game };
  // Places with a new shot deal only their new shots. Every other place is emptied, except one
  // shot in each of three places per region, so every map still has what it needs to start a game.
  // Those few old shots go in the "seen" list when playing, so the new shots' places come first.
  const keptOld = [];
  const perRegion = new Map();
  for (const l of geo.world.locations) {
    if (l.shots.some((s) => expected[s.id])) {
      l.shots = l.shots.filter((s) => expected[s.id]);
      continue;
    }
    const n = perRegion.get(l.region) ?? 0;
    if (n < 3 && l.shots.length && !l.parent) {
      l.shots = l.shots.slice(0, 1);
      keptOld.push(l.shots[0].id);
      perRegion.set(l.region, n + 1);
    } else l.shots = [];
  }
  writeFileSync(DATA, JSON.stringify(geo));
  mkdirSync(path.dirname(LIST), { recursive: true });
  writeFileSync(LIST, JSON.stringify({ expected, keptOld }, null, 1));
  console.log(`${Object.keys(expected).length} new shots since ${base}; geo.json here now deals only them (don't commit it)`);
} else if (cmd === "serve") {
  // The fake media store: <dir>/geo/<id>.webp at http://localhost:<port>/geo/<id>.webp, like the real one's layout.
  // Any other id (the few old shots kept so every map can start) gets a plain grey stand-in.
  const [dir, port = "3999"] = args;
  const { default: sharp } = await import("sharp");
  const standIn = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#555" } }).webp().toBuffer();
  createServer((req, res) => {
    const m = /^\/geo\/([A-Za-z0-9_-]+)\.webp$/.exec(req.url ?? "");
    if (!m) {
      res.writeHead(404).end();
      return;
    }
    const file = path.join(dir, "geo", `${m[1]}.webp`);
    if (!existsSync(file)) {
      res.writeHead(200, { "Content-Type": "image/webp", "X-Stand-In": "1" }).end(standIn);
      return;
    }
    res.writeHead(200, { "Content-Type": "image/webp" }).end(readFileSync(file));
  }).listen(Number(port), () => console.log(`fake media store: ${dir} on http://localhost:${port}`));
} else if (cmd === "play") {
  await play(args[0] ?? "http://localhost:3100", args.includes("--ui") ? args[args.indexOf("--ui") + 1] : null);
} else {
  console.log("usage: play-batch.mjs prepare [base] | serve <dir> [port] | play [baseUrl] [--ui outDir]");
  process.exit(1);
}

async function play(base, uiOut) {
  const { expected, keptOld } = readJson(LIST);
  const want = new Set(Object.keys(expected));
  const results = new Map();
  const problems = [];
  let games = 0;
  let cookie = "";
  const post = async (url, body) => {
    const r = await fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = [...new Set([...cookie.split("; ").filter(Boolean), ...set.map((c) => c.split(";")[0])])].join("; ");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${url} ${r.status}: ${j.error ?? ""}`);
    return j;
  };
  const idOf = (shot) => /\/api\/geo\/shot\/([A-Za-z0-9_-]+)$/.exec(shot)?.[1] ?? null;
  // Five-round World games, with the shots already checked passed as "seen" so new ones come first.
  for (let stale = 0; results.size < want.size && stale < 40; games++) {
    const seen = [...keptOld, ...results.keys()].slice(-600);
    const start = await post("/api/geo", { region: "world", kind: "game", seen });
    let token = start.token;
    let round = start.round;
    let fresh = false;
    while (round) {
      const id = idOf(round.shot);
      const pic = await fetch(base + round.shot);
      const bytes = Buffer.from(await pic.arrayBuffer());
      const loads = pic.ok && pic.headers.get("content-type") === "image/webp" && bytes.toString("latin1", 8, 12) === "WEBP";
      const g = await post("/api/geo/guess", { token, x: 0.5, y: 0.5 });
      if (id && want.has(id) && !results.has(id)) {
        fresh = true;
        const e = expected[id];
        const a = g.answer;
        const ok = a.name === e.name && (a.parent ?? undefined) === (e.parent ?? undefined) && a.game === e.game && (!a.region || a.region === e.region);
        results.set(id, { loads, bytes: bytes.length, reveal: label({ region: a.region ?? "?", name: a.name, parent: a.parent }), game: a.game, ok });
        if (!loads) problems.push(`${id}: the picture didn't load (${pic.status}, ${bytes.length} bytes)`);
        if (!ok) problems.push(`${id}: revealed ${label({ region: a.region ?? "?", name: a.name, parent: a.parent })} (${a.game}), expected ${label(e)} (${e.game})`);
      }
      token = g.token;
      round = g.next;
    }
    stale = fresh ? 0 : stale + 1;
  }
  const missing = [...want].filter((id) => !results.has(id));
  for (const id of missing) problems.push(`${id}: never dealt in ${games} games (${label(expected[id])})`);
  console.log(`${games} games played; ${results.size}/${want.size} new shots dealt, ${[...results.values()].filter((r) => r.loads && r.ok).length} loaded and revealed right`);
  if (uiOut) await playUi(base, uiOut, problems);
  for (const p of problems) console.log(`  ! ${p}`);
  writeFileSync(path.join(ROOT, ".data/play-batch-results.json"), JSON.stringify({ games, results: Object.fromEntries(results), problems }, null, 1));
  if (problems.length) process.exitCode = 1;
}

/** A few rounds in Chromium, as a player sees them: the picture shows, and the reveal names the place. */
async function playUi(base, out, problems) {
  const { chromium } = await import("playwright");
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const { expected, keptOld } = readJson(LIST);
  const uiChecked = new Set();
  const areas = new Set(Object.values(expected).map((e) => `${e.region}|${e.parent ?? e.name}`)).size;
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const phone = viewport.width < 768;
    const context = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone });
    // The kept old shots count as seen, so the new shots' places are dealt first.
    await context.addInitScript((seen) => {
      sessionStorage.setItem("pokeiq-splash", "1");
      localStorage.setItem("pokeiq:geo-seen", JSON.stringify(seen));
    }, keptOld);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const dealt = [];
    page.on("response", (r) => {
      const m = /\/api\/geo\/shot\/([A-Za-z0-9_-]+)$/.exec(r.url());
      if (m && r.request().resourceType() === "image") dealt.push({ id: m[1], status: r.status() });
    });
    await page.goto(`${base}/pokeguessr`, { waitUntil: "networkidle", timeout: 180_000 });
    const sheet = page.locator('[data-testid="howto-sheet"]').first();
    if (await sheet.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false)) await page.getByTestId("howto-never").click();
    // "Set up a game" → "5-round game" (as e2e-guessr.mjs's solo flow).
    for (let i = 0; i < 5 && !(await page.getByTestId("geo-solo").isVisible().catch(() => false)); i++) {
      await page.getByTestId("geo-solo-setup").click();
      await page.getByTestId("geo-solo").waitFor({ timeout: 3_000 }).catch(() => {});
    }
    await page.getByRole("button", { name: /5-round game/ }).click();
    const { tapGuessMap } = await import(path.join(ROOT, "scripts/e2e-geo-map.mjs"));
    const rounds = Math.min(3, areas);
    for (let r = 1; r <= rounds; r++) {
      await page.waitForFunction(() => {
        const img = document.querySelector("img[alt='Where is this?']");
        return img?.complete && img.naturalWidth > 0;
      }, null, { timeout: 60_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/round${r}-${viewport.width}.png` });
      if (phone) {
        await page.getByTestId("geo-map-pill").click();
        await page.locator("[data-testid=geo-dock][data-open=true]").waitFor();
      } else {
        const box = await page.getByTestId("geo-dock").boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
        await page.waitForFunction(() => document.querySelector("[data-testid=geo-dock]")?.getAttribute("data-open") === "true", null, { timeout: 5_000 });
      }
      await page.waitForTimeout(350);
      await tapGuessMap(page, 0.5, 0.5);
      await page.locator("[data-testid=geo-guess]:not([disabled])").click();
      await page.getByTestId("geo-reveal").waitFor({ timeout: 30_000 });
      await page.waitForTimeout(2700);
      await page.screenshot({ path: `${out}/reveal${r}-${viewport.width}.png` });
      const place = (await page.getByTestId("geo-answer-place").innerText().catch(() => "")).trim();
      const src = await page.locator("img[alt='Where is this?']").first().getAttribute("src");
      const id = /\/api\/geo\/shot\/([A-Za-z0-9_-]+)/.exec(src ?? "")?.[1];
      const status = dealt.find((d) => d.id === id)?.status;
      const norm = (t) => t.toLowerCase().replace(/\s+/g, " ").trim();
      if (!id || !expected[id]) console.log(`  ui ${viewport.width} round ${r}: an old shot (kept so the map can start), not checked`);
      else if (status !== undefined && status !== 200) problems.push(`ui ${viewport.width}: ${id} answered ${status}`);
      else if (!norm(place).includes(norm(expected[id].name))) problems.push(`ui ${viewport.width}: ${id}'s reveal says "${place}", expected ${label(expected[id])}`);
      else {
        uiChecked.add(id);
        console.log(`  ui ${viewport.width} round ${r}: picture loaded, reveal "${norm(place)}"`);
      }
      if (r < rounds) await page.getByTestId("geo-next").click();
    }
    for (const e of errors) problems.push(`ui ${viewport.width}: page error ${e}`);
    await context.close();
  }
  await browser.close();
  console.log(`ui: ${uiChecked.size} new shots played in Chromium, screenshots in ${out}`);
}
