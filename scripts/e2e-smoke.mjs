/**
 * Browser smoke test: drives every major flow of a running PokéIQ, captures
 * screenshots, and fails on any console/page error.
 *
 *   npm run build && npm start      # in another terminal
 *   npm run verify:e2e [baseUrl]
 *
 * Set CHROMIUM_PATH to use a preinstalled Chromium. Screenshots land in
 * ./e2e-screenshots/.
 */
import { chromium } from "playwright";
import fs from "fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = "e2e-screenshots";
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);

async function newPage(viewport) {
  const context = await browser.newContext({ viewport });
  // Skip the first-visit splash so screenshots show the page itself.
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  const page = await context.newPage();
  page.on("console", (msg) => {
    // Remote sprite hiccups aren't app bugs.
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) {
      errors.push(`[${page.url()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => errors.push(`[${page.url()}] PAGEERROR: ${err.message}`));
  return page;
}

function step(name) {
  console.log(`• ${name}`);
}

/** Whether the guess box reads `name` (within a couple of seconds). */
async function filledIn(p, name) {
  return p
    .waitForFunction((want) => document.querySelector("input[aria-label='Guess a Pokémon']")?.value === want, name, { timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
}

const page = await newPage({ width: 1280, height: 900 });

step("home");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/home.png`, fullPage: true });

// A full Classic run, capturing the server's share token for the challenge flow.
step("who's that pokémon: full classic run");
let shareToken = null;
page.on("response", async (res) => {
  if (res.url().endsWith("/api/session/answer") && res.ok()) {
    const body = await res.json().catch(() => null);
    if (body?.shareToken) shareToken = body.shareToken;
  }
});
await page.goto(`${BASE}/quiz/whos-that-pokemon`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/setup.png` });
await page.getByRole("button", { name: /^Start/ }).click();
await page.waitForSelector("h2");
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/quiz-silhouette.png` });
for (let i = 0; i < 10; i++) {
  await page.locator("main button:not([disabled])").filter({ hasNotText: /settings/i }).first().click();
  const next = page.getByRole("button", { name: /Next question|See results/ });
  await next.waitFor({ timeout: 10_000 });
  if (i === 0) {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/quiz-revealed.png` });
  }
  await next.click();
}
await page.locator("main").getByText("PokéIQ").first().waitFor();
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/results.png`, fullPage: true });
if (!shareToken) errors.push("No shareToken returned at the end of a run");

step("challenge link");
if (shareToken) {
  await page.goto(`${BASE}/c/${shareToken}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Accept challenge/ }).waitFor();
  await page.screenshot({ path: `${OUT}/challenge.png` });
  const og = await page.request.get(`${BASE}/c/${shareToken}/opengraph-image`);
  if (og.status() !== 200) errors.push(`OG image returned ${og.status()}`);
  else fs.writeFileSync(`${OUT}/challenge-og.png`, await og.body());
}

for (const slug of ["pokemon-higher-or-lower", "pokemon-type-quiz", "pokedex-entry-quiz", "pokemon-cry-quiz"]) {
  step(slug);
  await page.goto(`${BASE}/quiz/${slug}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Start/ }).click();
  await page.waitForSelector("h2");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/quiz-${slug}.png` });
}

step("blitz format");
await page.goto(`${BASE}/quiz/pokemon-trivia-quiz?format=blitz`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^Start/ }).click();
await page.waitForSelector("h2");
for (let i = 0; i < 3; i++) {
  await page.locator("main button:not([disabled])").first().click();
  await page.waitForTimeout(900);
}
await page.screenshot({ path: `${OUT}/blitz.png` });

step("pokédle");
await page.goto(`${BASE}/pokedle`, { waitUntil: "networkidle" });
// The Pokédex beside the board: filter it by hand, click a row to fill in the guess, Enter to guess.
await page.getByText(/^1,025 Pokémon match$/).waitFor();
await page.getByLabel("Has type").selectOption("electric");
await page.getByLabel("Search the Pokédex").fill("pika");
await page.getByText(/^1 Pokémon match$/).waitFor();
await page.getByRole("button", { name: "Fill in Pikachu" }).click();
if (!(await filledIn(page, "Pikachu"))) errors.push("the Pokédex didn't fill in the guess box");
await page.keyboard.press("Enter");
await page.waitForFunction(
  () => document.querySelector("input[aria-label='Guess a Pokémon']")?.placeholder.startsWith("Guess 2") || document.body.innerText.includes("Got it in")
);
await page.screenshot({ path: `${OUT}/pokedle-dex.png` });
await page.getByRole("button", { name: /Reset filters/ }).click();
await page.getByText(/^1,025 Pokémon match$/).waitFor();
for (const name of ["Charizard", "Gengar"]) {
  if (await page.getByText(/Got it in/).count()) break;
  await page.getByLabel("Guess a Pokémon").fill(name);
  await page.getByRole("option").first().click();
  await page.waitForTimeout(1200);
  if (await page.getByText(/Got it in/).count()) break;
}
await page.screenshot({ path: `${OUT}/pokedle.png`, fullPage: true });

step("adaptive PokéIQ test (20 questions)");
await page.goto(`${BASE}/iq-test`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start the test/ }).click();
for (let i = 0; i < 20; i++) {
  await page.waitForSelector("h2");
  await page.locator("main button:not([disabled])").first().click();
  const next = page.getByRole("button", { name: /Next question|See results/ });
  await next.waitFor({ timeout: 10_000 });
  await next.click();
}
await page.getByText("How your PokéIQ was measured").waitFor();
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/iq-test-results.png`, fullPage: true });

async function playGeoRounds(rounds) {
  for (let i = 0; i < rounds; i++) {
    await page.waitForFunction(() => {
      const img = document.querySelector("img[alt='Where is this?']");
      return img?.complete && img.naturalWidth > 0;
    });
    const map = page.locator("[role=application]");
    await map.hover();
    // Zoom in on the first round, like a player hunting for a spot.
    if (i === 0) await page.mouse.wheel(0, -240);
    const box = await map.boundingBox();
    await map.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
    await page.getByRole("button", { name: /^Guess$/ }).click();
    const next = page.getByRole("button", { name: /Next round|View summary|See results/ });
    await next.waitFor();
    if (i === 0) await page.screenshot({ path: `${OUT}/guessr-reveal.png` });
    const label = await next.innerText();
    await next.click();
    if (/summary|results/i.test(label)) return;
  }
}

step("pokéguessr: 5-round game + challenge link");
let geoChallenge = null;
page.on("response", async (res) => {
  if (res.url().endsWith("/api/geo/guess") && res.ok()) {
    const body = await res.json().catch(() => null);
    if (body?.challengeToken) geoChallenge = body.challengeToken;
  }
});
await page.goto(`${BASE}/guessr`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/guessr-setup.png`, fullPage: true });
await page.getByRole("button", { name: /5-round game/ }).click();
await playGeoRounds(5);
await page.getByText("Survey complete").waitFor();
await page.getByRole("button", { name: /Challenge a friend/ }).waitFor();
await page.screenshot({ path: `${OUT}/guessr-summary.png`, fullPage: true });
if (!geoChallenge) throw new Error("no PokéGuessr challenge token");

step("pokéguessr: friend accepts the challenge");
await page.goto(`${BASE}/guessr/c/${encodeURIComponent(geoChallenge)}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Accept challenge/ }).click();
await playGeoRounds(5);
await page.getByText(/You beat|wins this one|Dead heat/).waitFor();
await page.screenshot({ path: `${OUT}/guessr-challenge-result.png`, fullPage: true });

step("pokéguessr: streak");
await page.goto(`${BASE}/guessr`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Streak/ }).click();
await playGeoRounds(60);
await page.getByText("Streak over").first().waitFor();

step("pokéguessr: a region's own map");
await page.goto(`${BASE}/guessr?region=johto`, { waitUntil: "networkidle" });
await page.getByRole("radio", { name: "Johto", checked: true }).waitFor();
await page.getByRole("button", { name: /5-round game/ }).click();
await playGeoRounds(5);
await page.getByText("Survey complete").waitFor();

// Two trainers in two browsers: Red opens a duel on Kanto, Blue joins from the link.
step("pokéguessr duel: create, join, ready");
const red = await newPage({ width: 1280, height: 900 });
const blue = await newPage({ width: 1280, height: 900 });
// No poll or action ever carries the answer or the other trainer's pin before the reveal.
for (const p of [red, blue]) {
  p.on("response", async (res) => {
    if (!res.url().includes("/api/geo/duel/") || !res.ok()) return;
    const body = await res.json().catch(() => null);
    const live = body?.view?.round ?? body?.round;
    if (live && /"(pin|mask|answer|name|x|y)"/.test(JSON.stringify({ ...live, yours: undefined }))) {
      errors.push(`duel round leaked before the reveal: ${JSON.stringify(live)}`);
    }
  });
}
const shotLoaded = (p) =>
  p.waitForFunction(
    () => {
      const img = document.querySelector("img[alt='Where is this?']");
      return img?.complete && img.naturalWidth > 0;
    },
    null,
    { timeout: 30_000 }
  );
await red.goto(`${BASE}/guessr?region=kanto`, { waitUntil: "networkidle" });
await red.getByLabel("Your trainer name").fill("Red");
await red.getByRole("button", { name: /Create duel/ }).click();
await red.waitForURL(/\/guessr\/duel\/[a-z2-9]{8}$/);
const duelUrl = red.url();
await red.getByText("Waiting for a challenger").waitFor();
await red.screenshot({ path: `${OUT}/duel-lobby.png` });
const duelOg = await red.request.get(`${duelUrl}/opengraph-image`);
if (duelOg.status() !== 200) errors.push(`duel OG image returned ${duelOg.status()}`);
else fs.writeFileSync(`${OUT}/duel-og.png`, await duelOg.body());

await blue.goto(duelUrl, { waitUntil: "networkidle" });
await blue.getByText("Red challenges you!").waitFor();
await blue.getByLabel("Your trainer name").fill("Blue");
await blue.getByRole("button", { name: /Join duel/ }).click();
await red.getByText("Blue").first().waitFor();
await Promise.all([red, blue].map((p) => p.getByRole("button", { name: /^Ready$/ }).click()));

step("pokéguessr duel: play to the end");
/** Plays rounds until the duel is over, pinning at (at, at) across the map. Returns the rounds played. */
async function playDuel(p, at, shoot) {
  for (let i = 0; i < 12; i++) {
    await shotLoaded(p);
    if (shoot && i === 0) await p.screenshot({ path: `${OUT}/duel-round.png` });
    const map = p.locator("[role=application]");
    await map.hover();
    const box = await map.boundingBox();
    await map.click({ position: { x: box.width * at, y: box.height * at } });
    await p.getByRole("button", { name: /^Guess$/ }).click();
    const next = p.getByRole("button", { name: /Next round|See results/ });
    await next.waitFor({ timeout: 30_000 });
    if (shoot && i === 0) {
      await p.waitForTimeout(1200);
      await p.screenshot({ path: `${OUT}/duel-reveal.png` });
    }
    const label = await next.innerText();
    await next.click();
    if (/results/i.test(label)) return i + 1;
  }
  throw new Error("the duel didn't end");
}
const [duelRounds] = await Promise.all([playDuel(red, 0.5, true), playDuel(blue, 0.22, false)]);
console.log(`  over after ${duelRounds} round${duelRounds === 1 ? "" : "s"}`);
await red.getByText(/Victory!|Defeat|Draw/).first().waitFor();
await blue.getByText(/Victory!|Defeat|Draw/).first().waitFor();
await red.waitForTimeout(800);
await red.screenshot({ path: `${OUT}/duel-summary.png`, fullPage: true });

step("pokéguessr duel: rematch, then a forfeit");
await red.getByRole("button", { name: /^Rematch$/ }).click();
await red.waitForURL((url) => url.href !== duelUrl && url.pathname.startsWith("/guessr/duel/"));
await blue.getByRole("button", { name: /Accept rematch/ }).click();
await blue.waitForURL(red.url());
// Pressing Rematch is being ready: the new duel starts straight away.
await Promise.all([shotLoaded(red), shotLoaded(blue)]);
await red.getByRole("button", { name: /Leave duel/ }).click();
await red.getByRole("button", { name: /^Forfeit$/ }).click();
await red.waitForURL(/\/guessr$/);
await blue.getByText("Red left the duel.").waitFor();
await blue.getByText("Victory!").waitFor();
await blue.screenshot({ path: `${OUT}/duel-forfeit.png` });
await red.context().close();
await blue.context().close();

// A Pokédle duel: Red and Blue each solve with a small solver that keeps
// only the Pokémon consistent with every clue so far.
step("pokédle duel: create, join, ready");
const DEX = JSON.parse(fs.readFileSync(new URL("../src/data/pokedex.json", import.meta.url), "utf8"));
const DEX_BY_ID = new Map(DEX.map((p) => [p.id, p]));
const numberFits = (cand, guess, status) => (status === "match" ? cand === guess : status === "higher" ? cand > guess : cand < guess);
function typeFits(cand, guess, slot, status) {
  const g = guess.types[slot];
  if (!g) return status === "match" ? !cand.types[slot] : !!cand.types[slot];
  if (status === "match") return cand.types[slot] === g;
  if (status === "partial") return cand.types[slot] !== g && cand.types.includes(g);
  return !cand.types.includes(g);
}
function fits(cand, row) {
  const g = DEX_BY_ID.get(row.id);
  const c = row.cells;
  return (
    numberFits(cand.gen, g.gen, c.gen.status) &&
    typeFits(cand, g, 0, c.type1.status) &&
    typeFits(cand, g, 1, c.type2.status) &&
    numberFits(cand.height, g.height, c.height.status) &&
    numberFits(cand.weight, g.weight, c.weight.status) &&
    (c.color.status === "match") === (cand.color === g.color) &&
    numberFits(cand.stage, g.stage, c.stage.status)
  );
}
const dle = [];
for (const name of ["Red", "Blue"]) {
  const p = await newPage({ width: 1280, height: 900 });
  const seen = { rev: -1, view: null };
  p.on("response", async (res) => {
    if (!/\/api\/duel(\/|$)/.test(res.url()) || !res.ok()) return;
    const body = await res.json().catch(() => null);
    const view = body?.view ?? body;
    if (!view || typeof view.rev !== "number") return;
    // Only colours of the opponent's guesses before a round is over.
    const round = view.round;
    if (round && /"(id|name|value|imageUrl)"/.test(JSON.stringify(round.boards))) {
      errors.push(`pokédle duel round leaked before the reveal: ${JSON.stringify(round).slice(0, 300)}`);
    }
    if (view.rev >= seen.rev) Object.assign(seen, { rev: view.rev, view });
  });
  dle.push({ p, name, seen });
}
const [dleRed, dleBlue] = dle;
await dleRed.p.goto(`${BASE}/pokedle`, { waitUntil: "networkidle" });
await dleRed.p.getByLabel("Your trainer name").fill("Red");
await dleRed.p.getByRole("button", { name: /Create duel/ }).click();
await dleRed.p.waitForURL(/\/pokedle\/duel\/[a-z2-9]{8}$/);
const dleUrl = dleRed.p.url();
await dleRed.p.getByText("Waiting for a challenger").waitFor();
// The creator picks the generations in the lobby.
await dleRed.p.getByRole("button", { name: "Gen 1", exact: true }).click();
await dleRed.p.getByRole("button", { name: "Gen 1", pressed: true }).waitFor();
await dleRed.p.screenshot({ path: `${OUT}/pokedle-duel-lobby.png` });
const dleOg = await dleRed.p.request.get(`${dleUrl}/opengraph-image`);
if (dleOg.status() !== 200) errors.push(`pokédle duel OG image returned ${dleOg.status()}`);
else fs.writeFileSync(`${OUT}/pokedle-duel-og.png`, await dleOg.body());

await dleBlue.p.goto(dleUrl, { waitUntil: "networkidle" });
await dleBlue.p.getByText("Red challenges you!").waitFor();
await dleBlue.p.getByText("Gen 1", { exact: true }).waitFor();
await dleBlue.p.getByLabel("Your trainer name").fill("Blue");
await dleBlue.p.getByRole("button", { name: /Join duel/ }).click();
await dleRed.p.getByText("Blue").first().waitFor();
await Promise.all(dle.map(({ p }) => p.getByRole("button", { name: /^Ready$/ }).click()));

step("pokédle duel: three rounds to the end");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Plays until the results; Blue works through the candidates from the other end of the Pokédex. */
async function playPokedleDuel({ p, name, seen }, shoot) {
  const input = p.getByLabel("Guess a Pokémon");
  const next = p.getByRole("button", { name: /Next round|See results/ });
  let boughtHint = false;
  for (let i = 0; i < 600; i++) {
    // A pressed Next turns into "Waiting for…" once the server has it.
    if ((await next.isVisible()) && (await next.isEnabled())) {
      if (shoot) await p.screenshot({ path: `${OUT}/pokedle-duel-reveal.png`, fullPage: true });
      shoot = false;
      const label = await next.innerText();
      await next.click({ timeout: 5_000 }).catch(() => {});
      if (/results/i.test(label)) return;
      await p.waitForTimeout(300);
      continue;
    }
    const round = seen.view?.round;
    if (round && (await input.isVisible()) && (await input.isEnabled())) {
      // Red buys the category once, to see a hint come through.
      if (name === "Red" && !boughtHint && round.rows.length === 1) {
        boughtHint = true;
        await p.getByRole("button", { name: /Category/ }).click();
        await p.getByText(/^The .+ Pokémon$/).waitFor();
      }
      const tried = new Set(round.rows.map((r) => r.id));
      const pool = DEX.filter((c) => c.gen === 1 && !tried.has(c.id) && round.rows.every((r) => fits(c, r)));
      const pick = name === "Red" ? pool[0] : pool[pool.length - 1];
      const before = round.rows.length;
      if (name === "Red" && round.index === 0 && before === 0) {
        // Red's first guess comes from the Pokédex beside the board (only the duel's Gen 1 in it).
        await p.getByText(/^151 Pokémon match$/).waitFor();
        if (shoot) await p.screenshot({ path: `${OUT}/pokedle-duel-round.png`, fullPage: true });
        await p.getByLabel("Search the Pokédex").fill(pick.name);
        await p.getByRole("button", { name: `Fill in ${pick.name}`, exact: true }).click();
        if (!(await filledIn(p, pick.name))) errors.push(`the duel's Pokédex didn't fill in ${pick.name}: "${await input.inputValue()}"`);
        await input.press("Enter");
        await p.getByRole("button", { name: /Reset filters/ }).click();
      } else {
        await input.fill(pick.name);
        const option = p.locator("[role=option]").filter({ has: p.locator("span", { hasText: new RegExp(`^${escapeRe(pick.name)}$`) }) });
        await option.click();
      }
      for (let w = 0; w < 50 && (seen.view?.round?.rows.length ?? before + 1) === before && seen.view?.round?.index === round.index; w++) await p.waitForTimeout(100);
      continue;
    }
    await p.waitForTimeout(250);
  }
  throw new Error(`${name}'s Pokédle duel didn't end`);
}
await Promise.all([playPokedleDuel(dleRed, true), playPokedleDuel(dleBlue, false)]);
await dleRed.p.getByText(/Victory!|Defeat|Draw/).first().waitFor();
await dleBlue.p.getByText(/Victory!|Defeat|Draw/).first().waitFor();
await dleRed.p.screenshot({ path: `${OUT}/pokedle-duel-summary.png`, fullPage: true });
if (dleRed.seen.view?.revealed?.length !== 3) errors.push(`pokédle duel ended after ${dleRed.seen.view?.revealed?.length} rounds`);

step("pokédle duel: rematch, then a forfeit");
await dleRed.p.getByRole("button", { name: /^Rematch$/ }).click();
await dleRed.p.waitForURL((url) => url.href !== dleUrl && url.pathname.startsWith("/pokedle/duel/"));
await dleBlue.p.getByRole("button", { name: /Accept rematch/ }).click();
await dleBlue.p.waitForURL(dleRed.p.url());
await Promise.all(dle.map(({ p }) => p.getByLabel("Guess a Pokémon").waitFor()));
await dleRed.p.getByRole("button", { name: /Leave duel/ }).click();
await dleRed.p.getByRole("button", { name: /^Forfeit$/ }).click();
await dleRed.p.waitForURL(/\/pokedle$/);
await dleBlue.p.getByText("Red left the duel.").waitFor();
await dleBlue.p.getByText("Victory!").waitFor();
for (const { p } of dle) await p.context().close();

// A quiz duel: Who's That Pokémon on easy, ten questions. Red answers first;
// Blue sees Red lock in (never the pick), then answers.
step("quiz duel: create, join, ready");
const quiz = [];
for (const name of ["Red", "Blue"]) {
  const p = await newPage({ width: 1280, height: 900 });
  const seen = { rev: -1, view: null };
  p.on("response", async (res) => {
    if (!/\/api\/duel(\/|$)/.test(res.url()) || !res.ok()) return;
    const body = await res.json().catch(() => null);
    const view = body?.view ?? body;
    if (!view || typeof view.rev !== "number") return;
    // The live question never carries the answer, the explanation or anyone's pick.
    if (view.question && /"(answer|explanation|revealUrl|picks|choice)"/.test(JSON.stringify(view.question))) {
      errors.push(`quiz duel question leaked before the reveal: ${JSON.stringify(view.question).slice(0, 300)}`);
    }
    if (view.rev >= seen.rev) Object.assign(seen, { rev: view.rev, view });
  });
  quiz.push({ p, name, seen });
}
const [quizRed, quizBlue] = quiz;
await quizRed.p.goto(`${BASE}/quiz/whos-that-pokemon`, { waitUntil: "networkidle" });
await quizRed.p.getByRole("button", { name: "easy", exact: true }).last().click();
await quizRed.p.getByLabel("Your trainer name").fill("Red");
await quizRed.p.getByRole("button", { name: /Create duel/ }).click();
await quizRed.p.waitForURL(/\/quiz\/duel\/[a-z2-9]{8}$/);
const quizUrl = quizRed.p.url();
await quizRed.p.getByText("Waiting for a challenger").waitFor();
await quizRed.p.screenshot({ path: `${OUT}/quiz-duel-lobby.png` });
const quizOg = await quizRed.p.request.get(`${quizUrl}/opengraph-image`);
if (quizOg.status() !== 200) errors.push(`quiz duel OG image returned ${quizOg.status()}`);
else fs.writeFileSync(`${OUT}/quiz-duel-og.png`, await quizOg.body());
// A quiz duel's link on the Pokédle duel route goes to the right page.
await quizBlue.p.goto(quizUrl.replace("/quiz/duel/", "/pokedle/duel/"), { waitUntil: "networkidle" });
await quizBlue.p.waitForURL(quizUrl);
await quizBlue.p.getByText("Red challenges you!").waitFor();
await quizBlue.p.getByText("Easy", { exact: true }).waitFor();
await quizBlue.p.getByLabel("Your trainer name").fill("Blue");
await quizBlue.p.getByRole("button", { name: /Join duel/ }).click();
await quizRed.p.getByText("Blue").first().waitFor();
await Promise.all(quiz.map(({ p }) => p.getByRole("button", { name: /^Ready$/ }).click()));

step("quiz duel: ten questions to the end");
/** Answers every question with `key` (Blue waits for Red to lock in first), until the results. */
async function playQuizDuel({ p, name, seen }, key, shoot) {
  const next = p.getByRole("button", { name: /Next question|See results/ });
  let sawLock = false;
  for (let i = 0; i < 800; i++) {
    if ((await next.isVisible()) && (await next.isEnabled())) {
      if (shoot) await p.screenshot({ path: `${OUT}/quiz-duel-reveal.png`, fullPage: true });
      shoot = false;
      const label = await next.innerText();
      await next.click({ timeout: 5_000 }).catch(() => {});
      if (/results/i.test(label)) return;
      await p.waitForTimeout(300);
      continue;
    }
    const live = seen.view?.question;
    if (live?.question && !live.yours && (await p.getByText("TIME", { exact: true }).isVisible())) {
      if (name === "Blue") {
        if (!live.answered[0]) {
          await p.waitForTimeout(100);
          continue;
        }
        if (!sawLock) {
          await p.getByText("Red has locked in!").waitFor({ timeout: 5_000 });
          sawLock = true;
        }
      }
      if (shoot && name === "Red" && live.index === 0) await p.screenshot({ path: `${OUT}/quiz-duel-question.png` });
      await p.keyboard.press(key);
      for (let w = 0; w < 50 && seen.view?.question?.index === live.index && !seen.view.question.yours; w++) await p.waitForTimeout(100);
      continue;
    }
    await p.waitForTimeout(150);
  }
  throw new Error(`${name}'s quiz duel didn't end`);
}
await Promise.all([playQuizDuel(quizRed, "1", true), playQuizDuel(quizBlue, "2", false)]);
await quizRed.p.getByText(/Victory!|Defeat|Draw/).first().waitFor();
await quizBlue.p.getByText(/Victory!|Defeat|Draw/).first().waitFor();
await quizRed.p.screenshot({ path: `${OUT}/quiz-duel-summary.png`, fullPage: true });
if (quizRed.seen.view?.revealed?.length !== 10) errors.push(`quiz duel ended after ${quizRed.seen.view?.revealed?.length} questions`);
for (const { p } of quiz) await p.context().close();

step("world atlas: search, place card, link into PokéGuessr");
await page.goto(`${BASE}/atlas`, { waitUntil: "networkidle" });
await page.getByLabel("Search the map").fill("Saffron City");
await page.getByRole("button", { name: "Go" }).click();
await page.getByRole("heading", { name: "Saffron City" }).waitFor();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/atlas.png` });
await page.getByRole("link", { name: /Play PokéGuessr Kanto/ }).click();
await page.waitForURL(/\/guessr\?region=kanto/);
await page.getByText("Field survey · Kanto").waitFor();

step("pokédex explorer");
await page.goto(`${BASE}/pokedex`, { waitUntil: "networkidle" });
await page.getByLabel("Search Pokémon").fill("char");
await page.getByRole("link", { name: /Charizard/ }).first().click();
await page.waitForURL(/\/pokemon\/charizard/);

step("pokédex entry: forms, shiny, sections");
await page.getByRole("button", { name: "Mega Charizard X" }).click();
await page.getByRole("button", { name: "Shiny" }).click();
await page.getByRole("link", { name: "Moves" }).click();
await page.getByText("Flamethrower").first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/pokedex-entry.png` });

step("study mode");
await page.goto(`${BASE}/pokedex/study?gen=1`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Start studying" }).click();
for (let i = 0; i < 3; i++) {
  await page.keyboard.press(" ");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Knew it/ }).click();
  await page.waitForTimeout(400);
}
await page.screenshot({ path: `${OUT}/study.png` });

step("trainer, leaderboard, pokémon page");
for (const path of ["/trainer", "/leaderboard?board=iq", "/pokemon/eevee", "/pokedex?type=ghost&sort=spe"]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/${path.slice(1).replace(/[^a-z0-9]+/gi, "_")}.png` });
}

// Accounts are only on when the server has a store (Supabase, or
// POKEIQ_LOCAL_ACCOUNTS=1 for a local production build).
const me = await (await page.request.get(`${BASE}/api/auth/me`)).json();
if (me.enabled) {
  step("accounts: register, sync, sign out, sign in, recover");
  const username = `e2e_${Date.now().toString(36)}`;
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Trainer name").fill(username);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  const recoveryCode = (await page.getByRole("status", { name: "Recovery code" }).innerText()).trim();
  if (!/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(recoveryCode)) throw new Error(`bad recovery code: ${recoveryCode}`);
  await page.screenshot({ path: `${OUT}/account-recovery-code.png` });
  await page.getByLabel("I saved my recovery code somewhere safe").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/trainer/);
  await page.getByText(`Signed in as`).waitFor();
  // The XP earned earlier in this run was merged into the account.
  const synced = await (await page.request.get(`${BASE}/api/auth/me`)).json();
  if (!synced.user || synced.user.username !== username) throw new Error("not signed in after register");
  if (!synced.progress || synced.progress.xp <= 0) throw new Error("progress didn't sync to the account");
  await page.screenshot({ path: `${OUT}/account-trainer.png` });

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("link", { name: "Sign in" }).first().waitFor();
  const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem("pokeiq:progress:v1") ?? "{}").xp ?? 0);
  if (cleared !== 0) throw new Error("sign-out left progress on the device");

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Trainer name").fill(username);
  await page.getByLabel("Password").fill("wrong password!!");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.getByRole("alert").waitFor();
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.waitForURL(/\/trainer/);
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem("pokeiq:progress:v1") ?? "{}").xp ?? 0) > 0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Forgot password" }).click();
  await page.getByLabel("Trainer name").fill(username);
  await page.getByLabel("Recovery code").fill(recoveryCode.toLowerCase());
  await page.getByLabel("New password").fill("a brand new password");
  await page.getByRole("button", { name: "Reset password" }).click();
  const rotated = (await page.getByRole("status", { name: "Recovery code" }).innerText()).trim();
  if (rotated === recoveryCode) throw new Error("recovery code wasn't rotated");
  await page.getByLabel("I saved my recovery code somewhere safe").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText(`Signed in as`).waitFor();
}

step("mobile: home + daily");
const mobile = await newPage({ width: 393, height: 852 });
await mobile.goto(BASE, { waitUntil: "networkidle" });
await mobile.screenshot({ path: `${OUT}/mobile-home.png` });
await mobile.goto(`${BASE}/daily`, { waitUntil: "networkidle" });
await mobile.getByRole("button", { name: /Start Daily/ }).click();
await mobile.waitForSelector("h2");
await mobile.waitForTimeout(900);
await mobile.screenshot({ path: `${OUT}/mobile-daily.png` });
await mobile.goto(`${BASE}/pokedle`, { waitUntil: "networkidle" });
await mobile.screenshot({ path: `${OUT}/mobile-pokedle.png` });

await browser.close();

if (errors.length > 0) {
  console.error(`✗ ${errors.length} error(s):`);
  errors.forEach((e) => console.error("  ", e));
  process.exit(1);
}
console.log(`✓ smoke test passed — screenshots in ${OUT}/`);
