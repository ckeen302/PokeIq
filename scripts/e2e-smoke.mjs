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
import { execFileSync } from "child_process";

const BASE = process.argv[2] ?? "http://localhost:3000";
// Pokédle opens its how-to sheet on a player's first visit.
async function closeHowTo(p) {
  const close = p.getByRole("button", { name: "Close" });
  if (await close.isVisible().catch(() => false)) await close.click();
}
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
    .waitForFunction((want) => document.querySelector("input[aria-label^='Guess a Pokémon']")?.value === want, name, { timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
}

/** Chat: `from` sends `text` (Enter sends) and `to` sees `shown` (the text as the server let it through). */
async function chatTo(from, to, text, shown = text) {
  const input = from.getByTestId("chat").last().getByLabel("Chat message");
  await input.fill(text);
  await input.press("Enter");
  await to.getByTestId("chat").last().getByTestId("chat-text").filter({ hasText: shown }).first().waitFor({ timeout: 15_000 });
  // One message a second per trainer.
  await from.waitForTimeout(1_100);
}

const page = await newPage({ width: 1280, height: 900 });
// Battle music this tab fetched (a later battle plays the cached track without a new request).
const musicRequests = [];
page.on("request", (r) => /\/audio\/battle\/.+\.(ogg|mp3)$/.test(r.url()) && musicRequests.push(r.url()));

/** One Classic run of a trivia quiz: ten answers, a source link on every reveal, no early answers. */
async function playTriviaRun(p, slug) {
  const leaks = [];
  let sources = 0;
  const watch = async (res) => {
    const path = new URL(res.url()).pathname;
    if (!/^\/api\/session(\/answer|\/next)?$/.test(path) || !res.ok()) return;
    const body = await res.json().catch(() => null);
    for (const q of [body?.question, body?.next]) {
      if (q && /"answer"|"explanation"|bulbapedia/i.test(JSON.stringify(q))) leaks.push(JSON.stringify(q).slice(0, 200));
    }
    if (path.endsWith("/answer") && /^https:\/\/bulbapedia\.bulbagarden\.net\/wiki\//.test(body?.sourceUrl ?? "")) sources++;
  };
  p.on("response", watch);
  await p.goto(`${BASE}/quiz/${slug}`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: /^Start/ }).click();
  await p.waitForSelector("h2");
  for (let i = 0; i < 10; i++) {
    await p.locator("main button:not([disabled])").filter({ hasNotText: /settings/i }).first().click();
    const next = p.getByRole("button", { name: /Next question|See results/ });
    await next.waitFor({ timeout: 10_000 });
    await p.getByRole("link", { name: /Source: Bulbapedia/ }).waitFor({ timeout: 5_000 });
    if (i === 0) {
      await p.waitForTimeout(700);
      await p.screenshot({ path: `${OUT}/quiz-${slug}-revealed.png` });
    }
    await next.click();
  }
  await p.locator("main").getByText("PokéIQ").first().waitFor();
  await p.screenshot({ path: `${OUT}/quiz-${slug}-results.png`, fullPage: true });
  p.off("response", watch);
  if (leaks.length) errors.push(`${slug}: a question arrived with its answer: ${leaks[0]}`);
  if (sources !== 10) errors.push(`${slug}: ${sources}/10 answers carried a Bulbapedia source`);
}

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

// The trivia quizzes: a full Classic run each. Questions never carry the answer
// or its source; each reveal links the Bulbapedia page it was checked against.
for (const slug of ["pokemon-games-quiz", "pokemon-anime-quiz"]) {
  step(`${slug}: full classic run`);
  await playTriviaRun(page, slug);
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
await closeHowTo(page);
// The Pokédex beside the board gets only what its assist level shows: names, generations and types for the Notebook (the default).
const dexRows = await (await page.request.get(`${BASE}/api/pokedle/dex`)).json();
if (dexRows.length !== 1025 || dexRows.some((r) => r.length !== 5)) errors.push(`the Pokédex API sent more than names, generations and types: ${JSON.stringify(dexRows[0])}`);
for (const [assist, width] of [["notebook", 5], ["field", 7], ["full", 9]]) {
  const rows = await (await page.request.get(`${BASE}/api/pokedle/dex?assist=${assist}`)).json();
  if (rows.length !== 1025 || rows.some((r) => r.length !== width)) errors.push(`the ${assist} Pokédex sent the wrong columns: ${JSON.stringify(rows[0])}`);
}
if ((await page.request.get(`${BASE}/api/pokedle/dex?assist=off`)).status() !== 404) errors.push("assist off still got a Pokédex");
// The assist setting (in the settings popover) starts at the Notebook, before the first guess.
await page.getByRole("button", { name: "Settings", exact: true }).click();
await page.getByRole("radiogroup", { name: "Pokédex assist", exact: true }).getByRole("radio", { name: /^Notebook/, checked: true }).waitFor();
await page.screenshot({ path: `${OUT}/pokedle-settings.png` });
await page.keyboard.press("Escape");
// Filter it by hand, cross a Pokémon off and put it back, then fill one into the guess box, Enter to guess.
await page.getByText(/^1,025 left in play$/).waitFor();
await page.getByLabel("Has type").selectOption("electric");
await page.getByLabel("Search the Pokédex").fill("pika");
await page.getByRole("button", { name: "Cross off Pikachu", exact: true }).click();
await page.getByText(/^1,024 left in play$/).waitFor();
await page.getByRole("button", { name: /^Put Pikachu back/ }).click();
await page.getByRole("radio", { name: /Fill in/ }).click();
await page.getByRole("button", { name: "Fill in Pikachu", exact: true }).click();
if (!(await filledIn(page, "Pikachu"))) errors.push("the Pokédex didn't fill in the guess box");
await page.keyboard.press("Enter");
await page.waitForFunction(
  () => document.querySelector("input[aria-label^='Guess a Pokémon']")?.placeholder.startsWith("Guess 2") || document.body.innerText.includes("Got it in")
);
await page.getByRole("button", { name: /Show all/ }).click();
// The gen and type clues grey out what they rule out, by themselves.
if (!(await page.getByText(/Got it in/).count())) {
  await page.waitForFunction(() => Number((document.body.innerText.match(/([\d,]+) left in play/)?.[1] ?? "1025").replace(/,/g, "")) < 1024);
}
await page.screenshot({ path: `${OUT}/pokedle-dex.png` });
for (const name of ["Charizard", "Gengar"]) {
  if (await page.getByText(/Got it in/).count()) break;
  await page.getByLabel("Guess a Pokémon").fill(name);
  await page.getByRole("option").first().click();
  await page.waitForTimeout(1200);
  if (await page.getByText(/Got it in/).count()) break;
}
await page.screenshot({ path: `${OUT}/pokedle.png`, fullPage: true });

step("pokédle: the Stats daily, and a practice game with advanced settings");
const headerTexts = async () => (await page.getByRole("columnheader").allTextContents()).map((s) => s.trim()).join(",");
/** The board re-renders as the format switches: give its header row a moment to settle on the expected columns. */
const headersSettle = async (want) => {
  for (let i = 0; i < 40 && (await headerTexts()) !== want; i++) await page.waitForTimeout(250);
  return headerTexts();
};
const SQUIRDLE_HEADERS = "Pokémon,Gen,Type 1,Type 2,Height,Weight";
await page.getByRole("radio", { name: "Stats daily" }).click();
await page.getByText(/Pokédle #\d+ · Stats/).waitFor();
await page.getByRole("button", { name: "Settings", exact: true }).click();
if (!/Stats · 9 guesses/.test(await page.getByTestId("rules-chip").innerText())) errors.push("the Stats daily's chip doesn't say Stats, 9 guesses");
await page.keyboard.press("Escape");
await page.getByLabel("Guess a Pokémon").fill("Pikachu");
await page.locator("[role=option]").first().click();
await page.waitForFunction(() => document.querySelector("input[aria-label^='Guess a Pokémon']")?.placeholder.startsWith("Guess 2 of 9") || document.body.innerText.includes("Got it in"));
{ const got = await headersSettle(SQUIRDLE_HEADERS); if (got !== SQUIRDLE_HEADERS) errors.push(`the Stats daily shows the wrong columns: ${got}`); }
await page.screenshot({ path: `${OUT}/pokedle-squirdle.png`, fullPage: true });
await page.getByRole("radio", { name: "Classic daily" }).click();
// The practice button opens a practice puzzle with its settings popover.
await page.getByRole("button", { name: /Practice puzzles/ }).click();
const settingsPanel = page.getByRole("region", { name: "Game settings" });
await settingsPanel.getByRole("radiogroup", { name: "Format" }).getByRole("radio", { name: "Custom" }).click();
await settingsPanel.getByRole("button", { name: "Color", exact: true }).click();
await settingsPanel.getByRole("button", { name: "Stage", exact: true }).click();
await settingsPanel.getByRole("radio", { name: "Gen 1 only" }).click();
await settingsPanel.getByRole("radiogroup", { name: "Guesses" }).getByRole("radio", { name: "6", exact: true }).click();
await settingsPanel.getByRole("radio", { name: "60 s blitz" }).click();
await page.getByRole("radiogroup", { name: "Pokédex assist", exact: true }).getByRole("radio", { name: /^Off/ }).click();
const practiceChip = await page.getByTestId("rules-chip").innerText();
if (!/Custom · 5 clues · Gen 1 · 6 guesses · 60 s blitz · No dex/.test(practiceChip)) errors.push(`practice settings chip: ${practiceChip}`);
await page.keyboard.press("Escape");
await page.getByLabel("Guess a Pokémon").fill("Bulbasaur");
await page.locator("[role=option]").first().click();
await page.waitForFunction(() => document.querySelector("input[aria-label^='Guess a Pokémon']")?.placeholder.startsWith("Guess 2 of 6") || document.body.innerText.includes("Got it in"));
// The board's header row draws after the first answer comes back.
await page.getByRole("columnheader", { name: "Weight" }).first().waitFor({ timeout: 15_000 });
{ const got = await headersSettle(SQUIRDLE_HEADERS); if (got !== SQUIRDLE_HEADERS) errors.push(`the custom practice game shows the wrong columns: ${got}`); }
if (!(await page.getByText(/Got it in/).count())) await page.getByRole("timer").waitFor();
await page.screenshot({ path: `${OUT}/pokedle-practice-settings.png`, fullPage: true });
// Back to the defaults for whoever plays next in this browser.
await page.evaluate(() => localStorage.removeItem("pokeiq:pokedle-prefs:v1"));

step("pokéconnections: a full daily, one wrong guess then a solve");
{
  // The answers come from the committed dailies file (the browser never gets them before the end).
  const dailies = JSON.parse(fs.readFileSync("src/data/connections-dailies.json", "utf8"));
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const day = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dailies.start}T00:00:00Z`)) / 86_400_000);
  const groups = dailies.puzzles[day].g.map(([, ...members]) => members);
  const tilesRes = await (await page.request.get(`${BASE}/api/connections?date=${today}`)).text();
  if (/label|members|category|reveal/.test(tilesRes)) errors.push("PokéConnections' tiles came with the groups");
  await page.goto(`${BASE}/connections`, { waitUntil: "networkidle" });
  await closeHowTo(page);
  await page.getByTestId("conn-tile").first().waitFor();
  if ((await page.getByTestId("conn-tile").count()) !== 16) errors.push("PokéConnections didn't show 16 tiles");
  const pick = async (ids) => {
    for (const id of ids) await page.locator(`[data-testid=conn-tile][data-id="${id}"]`).click();
    await page.getByTestId("conn-submit").click();
  };
  // Two from one group and two from another: wrong, a mistake.
  await pick([groups[0][0], groups[0][1], groups[1][0], groups[1][1]]);
  await page.getByLabel("3 of 4 mistakes left").waitFor();
  // The same four again: free.
  await page.getByTestId("conn-submit").click();
  await page.getByTestId("conn-toast").filter({ hasText: "Already guessed" }).waitFor();
  await page.getByRole("button", { name: "Deselect all" }).click();
  for (const [i, g] of groups.entries()) {
    await pick(g);
    await page.locator("[data-testid=conn-group]").nth(i).waitFor();
  }
  await page.getByTestId("conn-result").waitFor();
  await page.getByTestId("conn-why").waitFor();
  if (!(await page.getByText("1/4").count())) errors.push("PokéConnections' result doesn't show one mistake");
  await page.getByTestId("conn-community").waitFor({ timeout: 10_000 }).catch(() => errors.push("PokéConnections' daily stats didn't show"));
  await page.screenshot({ path: `${OUT}/connections.png`, fullPage: true });
  // A reload restores the finished game.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("conn-result").waitFor();

  // Unlimited, straight from the daily's result: a Hard puzzle, solved from the Pokédex data alone, then the next one.
  await page.getByRole("radiogroup", { name: "PokéConnections mode" }).getByRole("radio", { name: "Daily", checked: true }).waitFor();
  await page.getByTestId("conn-duel-link").waitFor();
  await page.getByTestId("conn-play-unlimited").click();
  await page.getByTestId("conn-unlimited").waitFor();
  await page.getByRole("radio", { name: "Unlimited", checked: true }).waitFor();
  const hardTiles = page.waitForResponse((r) => /\/api\/connections\?practice=hard-/.test(r.url()));
  await page.getByRole("radio", { name: "Hard" }).click();
  const hard = await (await hardTiles).json();
  await page.locator(`[data-testid=conn-tile][data-id="${hard.tiles[0].id}"]`).waitFor();
  const [unlimitedGroups] = JSON.parse(
    execFileSync("npx", ["tsx", "scripts/connections-solve.ts", ...hard.tiles.map((t) => String(t.id))], { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname })
  );
  for (const [i, g] of unlimitedGroups.entries()) {
    await pick(g);
    await page.locator("[data-testid=conn-group]").nth(i).waitFor();
  }
  await page.getByTestId("conn-result").waitFor();
  await page.screenshot({ path: `${OUT}/conn-unlimited-result.png`, fullPage: true });
  const nextTiles = page.waitForResponse((r) => /\/api\/connections\?practice=hard-/.test(r.url()));
  await page.getByTestId("conn-next").click();
  const next = await (await nextTiles).json();
  if (next.key === hard.key) errors.push("Next puzzle gave the same puzzle");
  await page.getByTestId("conn-tile").nth(15).waitFor();
  await page.screenshot({ path: `${OUT}/conn-unlimited.png` });
}

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

step("pokéguessr: Classic 2D, guess the game too, report a screenshot");
await page.goto(`${BASE}/guessr?region=kalos`, { waitUntil: "networkidle" });
// Kalos has no sprite games: Classic 2D is off there, and says why.
if (!(await page.getByTestId("geo-era-2d").isDisabled())) throw new Error("Classic 2D should be off on the Kalos map");
await page.goto(`${BASE}/guessr?region=kanto`, { waitUntil: "networkidle" });
await page.getByTestId("geo-era-2d").click();
await page.getByTestId("geo-guess-game").check();
await page.getByRole("button", { name: /5-round game/ }).click();
for (let i = 0; i < 5; i++) {
  await page.waitForFunction(() => {
    const img = document.querySelector("img[alt='Where is this?']");
    return img?.complete && img.naturalWidth > 0;
  });
  const map = page.locator("[role=application]");
  await map.hover();
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width * 0.4, y: box.height * 0.6 } });
  await page.getByTestId("geo-game-pick").selectOption({ index: 1 + (i % 3) });
  await page.getByRole("button", { name: /^Guess$/ }).click();
  await page.getByTestId("geo-game-bonus").waitFor();
  if (i === 0) {
    await page.getByTestId("geo-report").click();
    await page.getByRole("radio", { name: "Too generic to place" }).click();
    await page.getByTestId("geo-report-send").click();
    await page.getByTestId("geo-report-sent").waitFor();
    await page.screenshot({ path: `${OUT}/guessr-report.png` });
  }
  await page.getByRole("button", { name: /Next round|View summary/ }).click();
}
await page.getByText("Survey complete").waitFor();
await page.getByTestId("geo-bonus-total").waitFor();
await page.screenshot({ path: `${OUT}/guessr-2d-summary.png`, fullPage: true });
await page.getByRole("button", { name: /Play again/ }).click();
await page.getByTestId("geo-guess-game").uncheck();
await page.getByTestId("geo-era-all").click();

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
    // A column the duel doesn't show (Squirdle-style has five) rules nothing out.
    (!c.gen || numberFits(cand.gen, g.gen, c.gen.status)) &&
    (!c.type1 || typeFits(cand, g, 0, c.type1.status)) &&
    (!c.type2 || typeFits(cand, g, 1, c.type2.status)) &&
    (!c.height || numberFits(cand.height, g.height, c.height.status)) &&
    (!c.weight || numberFits(cand.weight, g.weight, c.weight.status)) &&
    (!c.color || (c.color.status === "match") === (cand.color === g.color)) &&
    (!c.stage || numberFits(cand.stage, g.stage, c.stage.status))
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
await closeHowTo(dleRed.p);
await dleRed.p.getByLabel("Your trainer name").fill("Red");
await dleRed.p.getByRole("button", { name: /Create duel/ }).click();
await dleRed.p.waitForURL(/\/pokedle\/duel\/[a-z2-9]{8}$/);
const dleUrl = dleRed.p.url();
await dleRed.p.getByText("Waiting for a challenger").waitFor();
// The creator picks the generations in the lobby.
await dleRed.p.getByRole("button", { name: "Gen 1", exact: true }).click();
await dleRed.p.getByRole("button", { name: "Gen 1", pressed: true }).waitFor();
// The host plays it Squirdle-style: five columns, ▲ / ▼ only, Squirdle's 5 guesses for one generation.
await dleRed.p.getByRole("radiogroup", { name: "Format" }).getByRole("radio", { name: "Stats" }).click();
await dleRed.p.getByTestId("rules-chip").filter({ hasText: /Stats · Gen 1 · 5 guesses/ }).waitFor();
// …and the Pokédex assist both trainers get.
await dleRed.p.getByRole("radio", { name: /^Full Pokédex/ }).click();
await dleRed.p.getByRole("radio", { name: /^Full Pokédex/, checked: true }).waitFor();
await dleRed.p.screenshot({ path: `${OUT}/pokedle-duel-lobby.png` });
const dleOg = await dleRed.p.request.get(`${dleUrl}/opengraph-image`);
if (dleOg.status() !== 200) errors.push(`pokédle duel OG image returned ${dleOg.status()}`);
else fs.writeFileSync(`${OUT}/pokedle-duel-og.png`, await dleOg.body());

await dleBlue.p.goto(dleUrl, { waitUntil: "networkidle" });
await dleBlue.p.getByText("Red challenges you!").waitFor();
await dleBlue.p.getByText("Gen 1", { exact: true }).waitFor();
// The guest sees the host's format and settings, and can't change them.
await dleBlue.p.getByTestId("rules-chip").filter({ hasText: /Stats · Gen 1 · 5 guesses/ }).waitFor();
if (await dleBlue.p.getByRole("radiogroup", { name: "Format" }).count()) errors.push("the guest can change the duel's format");
await dleBlue.p.getByRole("radio", { name: /^Full Pokédex/, checked: true }).waitFor();
await dleBlue.p.getByLabel("Your trainer name").fill("Blue");
await dleBlue.p.getByRole("button", { name: /Join duel/ }).click();
await dleRed.p.getByText("Blue").first().waitFor();
// Chat in the lobby: both ways, a swear masked.
await chatTo(dleRed.p, dleBlue.p, "good luck!");
await chatTo(dleBlue.p, dleRed.p, "you too, this will be shit hard", "you too, this will be ••• hard");
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
    // The button can go between the two checks (the round moved on), so a slow check counts as no.
    if ((await next.isVisible()) && (await next.isEnabled({ timeout: 1_000 }).catch(() => false))) {
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
      const open = DEX.filter((c) => c.gen === 1 && !tried.has(c.id));
      // Narrow by the clues when the rough check here agrees with them; any untried Pokémon otherwise.
      const fitting = open.filter((c) => round.rows.every((r) => fits(c, r)));
      const pool = fitting.length ? fitting : open;
      const pick = name === "Red" ? pool[0] : pool[pool.length - 1];
      const before = round.rows.length;
      if (name === "Red" && round.index === 0 && before === 0) {
        // Red's first guess comes from the Pokédex beside the board (only the duel's Gen 1 in it).
        await p.getByText(/^151 left in play$/).waitFor();
        if (shoot) await p.screenshot({ path: `${OUT}/pokedle-duel-round.png`, fullPage: true });
        await p.getByLabel("Search the Pokédex").fill(pick.name);
        await p.getByRole("radio", { name: /Fill in/ }).click();
        await p.getByRole("button", { name: `Fill in ${pick.name}`, exact: true }).click();
        if (!(await filledIn(p, pick.name))) errors.push(`the duel's Pokédex didn't fill in ${pick.name}: "${await input.inputValue()}"`);
        await input.press("Enter");
        // At the Full Pokédex a clue clicked on the board becomes a filter.
        // (Any clue: which ones can filter depends on the round's answer.)
        const clue = p.getByRole("button", { name: /Filter the Pokédex by this clue$/ }).first();
        if (await clue.waitFor({ timeout: 5_000 }).then(() => true, () => false)) {
          await clue.click();
          await p.getByRole("list", { name: "Clue filters" }).waitFor();
        } else console.log("  (no filterable clue on the first guess)");
        await p.getByRole("button", { name: /Show all/ }).click();
      } else {
        await input.fill(pick.name);
        const option = p.locator("[role=option]").filter({ has: p.locator("span", { hasText: new RegExp(`^${escapeRe(pick.name)}$`) }) });
        if (!(await option.waitFor({ timeout: 5_000 }).then(() => true, () => false))) {
          const listed = await p.locator("[role=option]").allInnerTexts();
          await p.screenshot({ path: `${OUT}/pokedle-duel-no-option.png`, fullPage: true });
          throw new Error(`${name}: no suggestion for ${pick.name} (box "${await input.inputValue()}", listed ${JSON.stringify(listed)}, tried ${[...tried]})`);
        }
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
// Chat opens again on the results screen.
await chatTo(dleBlue.p, dleRed.p, "gg wp");
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

// A PokéConnections race. The browser never learns the groups before the
// end, so the test works them out like a player with the Pokédex data could
// (scripts/connections-solve.ts). Blue makes a "one away" and a wrong guess;
// Red solves it cleanly and wins. Then a rematch, which Red forfeits.
step("pokéconnections duel: create, join, race to the end");
{
  const race = [];
  for (const name of ["Red", "Blue"]) {
    const p = await newPage({ width: 1280, height: 900 });
    p.on("response", async (res) => {
      if (!/\/api\/duel(\/|$)/.test(res.url()) || !res.ok()) return;
      const body = await res.json().catch(() => null);
      const view = body?.view ?? body;
      if (view?.kind !== "connections" || view.status === "finished") return;
      // Before the end: no group's name, rule or Pokémon, except the ones this trainer found.
      const rest = JSON.stringify({ ...view, mine: view.mine && { ...view.mine, found: undefined } });
      if (/"(reveal|rows|label|rule|why|herrings|members)"/.test(rest)) errors.push(`${name}'s PokéConnections duel leaked before the end: ${rest.slice(0, 300)}`);
    });
    race.push(p);
  }
  const [red, blue] = race;
  await red.goto(`${BASE}/connections`, { waitUntil: "networkidle" });
  await closeHowTo(red);
  await red.getByText("Head to head · PokéConnections").waitFor();
  await red.getByLabel("Your trainer name").fill("Red");
  await red.getByRole("button", { name: /Create duel/ }).click();
  await red.waitForURL(/\/connections\/duel\/[a-z2-9]{8}$/);
  const raceUrl = red.url();
  await red.getByText("Waiting for a challenger").waitFor();
  await red.screenshot({ path: `${OUT}/conn-duel-lobby.png` });
  const og = await red.request.get(`${raceUrl}/opengraph-image`);
  if (og.status() !== 200) errors.push(`PokéConnections duel OG image returned ${og.status()}`);
  else fs.writeFileSync(`${OUT}/conn-duel-og.png`, await og.body());

  await blue.goto(raceUrl, { waitUntil: "networkidle" });
  await blue.getByText("Red challenges you!").waitFor();
  await blue.getByLabel("Your trainer name").fill("Blue");
  await blue.getByRole("button", { name: /Join duel/ }).click();
  await red.getByText("Blue").first().waitFor();
  await Promise.all(race.map((p) => p.getByRole("button", { name: /^Ready$/ }).click()));
  await Promise.all(race.map((p) => p.getByTestId("conn-tile").nth(15).waitFor({ timeout: 15_000 })));

  // Both see the same sixteen, and the groups come from the data alone.
  const tileIds = async (p) => (await p.getByTestId("conn-tile").evaluateAll((els) => els.map((e) => Number(e.dataset.id)))).sort((a, b) => a - b);
  const ids = await tileIds(red);
  if (JSON.stringify(ids) !== JSON.stringify(await tileIds(blue))) errors.push("the two racers got different Pokémon");
  const [groups] = JSON.parse(execFileSync("npx", ["tsx", "scripts/connections-solve.ts", ...ids.map(String)], { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname }));
  if (!groups) throw new Error(`no solution for the duel's grid ${ids}`);
  const pick = async (p, four) => {
    for (const id of four) await p.locator(`[data-testid=conn-tile][data-id="${id}"]`).click();
    await p.getByTestId("conn-submit").click();
  };

  // Blue: one away, then a plain miss.
  await pick(blue, [...groups[0].slice(0, 3), groups[1][0]]);
  await blue.getByTestId("conn-toast").filter({ hasText: "One away…" }).waitFor();
  await blue.screenshot({ path: `${OUT}/conn-duel-oneaway.png` });
  await blue.getByLabel("3 of 4 mistakes left").waitFor();
  await blue.getByRole("button", { name: "Deselect all" }).click();
  await pick(blue, [groups[0][0], groups[0][1], groups[1][0], groups[1][1]]);
  await blue.getByLabel("2 of 4 mistakes left").waitFor();
  await blue.getByRole("button", { name: "Deselect all" }).click();

  // Red finds a group: Blue sees its colour and count, never the Pokémon.
  await pick(red, groups[2]);
  await red.locator("[data-testid=conn-group]").first().waitFor();
  await blue.getByTestId("conn-racer-0").and(blue.locator('[aria-label*="1 of 4 groups found"]')).waitFor({ timeout: 10_000 });
  await red.getByTestId("conn-racer-1").and(red.locator('[aria-label*="2 of 4 mistakes"]')).waitFor({ timeout: 10_000 });
  await blue.screenshot({ path: `${OUT}/conn-duel-race.png` });
  await red.screenshot({ path: `${OUT}/conn-duel-race-red.png` });
  if ((await blue.locator("[data-testid=conn-group]").count()) !== 0) errors.push("Blue sees a group Red found");

  // Red finishes cleanly: Blue could only tie, so it ends there.
  for (const g of [groups[0], groups[1], groups[3]]) {
    await pick(red, g);
    await red.waitForTimeout(400);
  }
  await Promise.all(race.map((p) => p.getByTestId("conn-duel-result").waitFor({ timeout: 15_000 })));
  await red.getByText("Victory!").waitFor();
  await blue.getByText("Defeat").waitFor();
  await blue.getByText("Red found all four groups first.").waitFor();
  await Promise.all(race.map((p) => p.getByTestId("conn-why").waitFor()));
  await red.screenshot({ path: `${OUT}/conn-duel-result.png`, fullPage: true });
  await blue.screenshot({ path: `${OUT}/conn-duel-result-blue.png` });

  step("pokéconnections duel: rematch, then a forfeit");
  await red.getByRole("button", { name: /^Rematch$/ }).click();
  await red.waitForURL((url) => url.href !== raceUrl && url.pathname.startsWith("/connections/duel/"));
  await blue.getByRole("button", { name: /Accept rematch/ }).click();
  await blue.waitForURL(red.url());
  await Promise.all(race.map((p) => p.getByTestId("conn-tile").first().waitFor({ timeout: 15_000 })));
  if (JSON.stringify(await tileIds(red)) === JSON.stringify(ids)) errors.push("the rematch kept the same Pokémon");
  await red.getByRole("button", { name: /Leave duel/ }).click();
  await red.getByRole("button", { name: /^Forfeit$/ }).click();
  await red.waitForURL(/\/connections$/);
  await blue.getByText("Red left the duel.").waitFor();
  await blue.getByText("Victory!").waitFor();
  for (const p of race) await p.context().close();
}

// A quiz duel: Mainline Games on easy, ten questions. Red answers first;
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
await quizRed.p.goto(`${BASE}/quiz/pokemon-games-quiz`, { waitUntil: "networkidle" });
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

// Matchmaking: two trainers press "Find an opponent" for the same game, with no link, and land in one duel
// that starts on its own. Red searches first (and waits), Blue's search pairs them.
async function findOpponent(path, ready) {
  const [mRed, mBlue] = [await newPage({ width: 1280, height: 900 }), await newPage({ width: 1280, height: 900 })];
  for (const [p, name] of [
    [mRed, "Red"],
    [mBlue, "Blue"],
  ]) {
    await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await closeHowTo(p);
    await p.getByLabel("Your trainer name").fill(name);
  }
  await mRed.getByRole("button", { name: /Find an opponent/ }).click();
  await mRed.getByText("Searching for an opponent…").waitFor();
  await mRed.waitForTimeout(1500);
  await mRed.screenshot({ path: `${OUT}/matchmaking-searching.png` });
  await mBlue.getByRole("button", { name: /Find an opponent/ }).click();
  const duelPath = new RegExp(`${path}/duel/[a-z2-9]{8}\\?matched=1$`);
  await Promise.all([mRed.waitForURL(duelPath), mBlue.waitForURL(duelPath)]);
  if (mRed.url() !== mBlue.url()) errors.push(`matched into different duels: ${mRed.url()} vs ${mBlue.url()}`);
  await mRed.getByText("Matched! You vs Blue").waitFor();
  await mBlue.getByText("Matched! You vs Red").waitFor();
  // No lobby: round 1 starts after the countdown.
  await Promise.all([ready(mRed), ready(mBlue)]);
  await mRed.getByRole("button", { name: /Leave duel/ }).click();
  await mRed.getByRole("button", { name: /^Forfeit$/ }).click();
  await mBlue.getByText("Red left the duel.").waitFor();
  await mRed.context().close();
  await mBlue.context().close();
}
step("matchmaking: pokédle");
await findOpponent("/pokedle", (p) => p.getByLabel("Guess a Pokémon").waitFor());
step("matchmaking: pokéconnections");
await findOpponent("/connections", (p) => p.getByTestId("conn-tile").first().waitFor({ timeout: 15_000 }));
step("matchmaking: pokéguessr world");
await findOpponent("/guessr", shotLoaded);

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

step("battle: hub, team builder (paste an OU team, validate), damage calc");
const OU_TEAM = `Garchomp @ Rocky Helmet
Ability: Rough Skin
Tera Type: Steel
EVs: 252 HP / 4 Def / 252 Spe
Jolly Nature
- Stealth Rock
- Earthquake
- Dragon Tail
- Spikes

Great Tusk @ Booster Energy
Ability: Protosynthesis
Tera Type: Ground
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off

Gholdengo @ Choice Scarf
Ability: Good as Gold
Tera Type: Steel
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
IVs: 0 Atk
- Make It Rain
- Shadow Ball
- Trick
- Focus Blast

Kingambit @ Leftovers
Ability: Supreme Overlord
Tera Type: Dark
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Swords Dance
- Kowtow Cleave
- Sucker Punch
- Iron Head

Dragapult @ Choice Specs
Ability: Infiltrator
Tera Type: Ghost
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Draco Meteor
- Shadow Ball
- Flamethrower
- U-turn

Toxapex @ Black Sludge
Ability: Regenerator
Tera Type: Fairy
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
IVs: 0 Atk
- Toxic Spikes
- Recover
- Haze
- Surf
`;
await page.goto(`${BASE}/battle`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/battle-hub.png`, fullPage: true });
await page.getByRole("link", { name: /Team Builder/ }).first().click();
await page.waitForURL(/\/battle\/teams/);
await page.getByRole("button", { name: "Import", exact: true }).first().click();
await page.getByLabel("Showdown team").fill(OU_TEAM);
await page.getByRole("button", { name: "Import team" }).click();
// Pokémon Showdown's validator, through /api/battle/validate.
await page.getByText("Legal in [Gen 9] OU").waitFor({ timeout: 30_000 });
await page.getByRole("tab", { name: /Dragapult/ }).click();
await page.getByRole("combobox", { name: "Move 1" }).waitFor();
await page.screenshot({ path: `${OUT}/battle-teams.png`, fullPage: true });

step("team builder: type coverage chart, threats, popular sets, EV goals");
const coverage = page.getByTestId("coverage-chart");
await coverage.waitFor({ timeout: 30_000 });
// Columns: type, six members, then Weak / Resist / Immune / Hit SE.
const coverageCell = (type, col) => coverage.locator(`tr[data-type="${type}"] td`).nth(col).innerText();
// Ground: Gholdengo, Kingambit and Toxapex are weak; Ice: Garchomp (4×) and Dragapult.
if ((await coverageCell("Ground", 7)).trim() !== "3") errors.push(`coverage: Ground weaknesses read ${await coverageCell("Ground", 7)}, expected 3`);
if ((await coverageCell("Ice", 1)).trim() !== "4×") errors.push(`coverage: Garchomp vs Ice reads ${await coverageCell("Ice", 1)}, expected 4×`);
if ((await coverageCell("Electric", 1)).trim() !== "0") errors.push("coverage: Garchomp should be immune to Electric");
if (Number(await coverage.getByTestId("coverage-se-Fairy").innerText()) < 1) errors.push("coverage: nothing hits Fairy super-effectively?");
await page.getByTestId("threat-list").getByText(/struggles against|answers each of/).first().waitFor({ timeout: 30_000 });
await page.getByTestId("popular-sets").waitFor({ timeout: 15_000 });
await coverage.screenshot({ path: `${OUT}/battle-teams-coverage.png` });
await page.getByTestId("ev-goals").getByRole("button", { name: /EV goals/ }).click();
await page.getByRole("button", { name: "Outspeed" }).click();
await page.getByTestId("ev-solve").click();
await page.getByTestId("ev-result").waitFor({ timeout: 30_000 });
console.log(`  EV goal: ${(await page.getByTestId("ev-result").innerText()).split("\n")[0]}`);
// Pokepaste links: anything but a pokepast.es paste is refused before a request is made.
const badPaste = await page.request.get(`${BASE}/api/battle/pokepaste?url=${encodeURIComponent("https://example.com/0123456789abcdef")}`);
if (badPaste.status() !== 400) errors.push(`pokepaste route accepted another host (${badPaste.status()})`);
await page.goto(`${BASE}/battle/calc`, { waitUntil: "networkidle" });
await page.getByText(/Garchomp Earthquake vs\. .*Heatran: \d+-\d+ \(/).waitFor({ timeout: 30_000 });
// The saved team feeds the calc.
await page.getByRole("button", { name: /Load from my team/ }).first().click();
await page.getByRole("menuitem", { name: /Dragapult/ }).first().click();
await page.getByText(/Dragapult Draco Meteor vs\. .*Heatran: \d+-\d+ \(/).waitFor();
await page.screenshot({ path: `${OUT}/battle-calc.png`, fullPage: true });

/** Battle responses must never carry the simulator's state, input log, seed or the other side's request. */
function watchBattle(p, side, label) {
  p.on("response", async (res) => {
    if (!/\/api\/battle(\/[a-z2-9]{8})?(\?|$)/.test(res.url())) return;
    const text = await res.text().catch(() => "");
    if (/"(state|inputLog|seed|input_log)"|\|request\||\|split\|/.test(text)) errors.push(`${label}: hidden battle data leaked: ${text.slice(0, 200)}`);
    const other = side === "p1" ? "p2" : "p1";
    if (text.includes(`"side":{"name"`) && text.includes(`"id":"${other}","pokemon"`)) errors.push(`${label}: the other side's request leaked`);
  });
}

/** Clicks moves (or a switch when forced) until the battle ends or passes `maxTurn`. Returns the turns played. */
async function playBattle(p, maxTurn, shoot) {
  // A battle played to the end needs more steps than one stopped early.
  for (let i = 0; i < (maxTurn >= 200 ? 600 : 80); i++) {
    const ready = p.locator("[data-testid=move-button]:not([disabled]), [data-testid=switch-button]:not([disabled]), [data-testid=lead-button]:not([disabled]), [data-testid=battle-result]");
    await ready.first().waitFor({ timeout: 90_000 });
    const turn = Number((await p.getByText(/^Turn \d+$/).first().innerText()).replace(/\D/g, ""));
    if ((await p.locator("[data-testid=battle-result]").count()) || turn > maxTurn) return turn;
    if (shoot && i === 2) await p.screenshot({ path: `${OUT}/${shoot}.png` });
    const leads = p.locator("[data-testid=lead-button]:not([disabled])");
    const moves = p.locator("[data-testid=move-button]:not([disabled])");
    // Team preview: tap the lead (or, bring 6 pick 3, the three that battle) until it's sent.
    if (await leads.count()) {
      const pick = /Choose (\d) to battle/.exec(await p.locator("body").innerText());
      const need = pick ? Number(pick[1]) : 1;
      for (let k = 0; k < need; k++) await leads.nth(k).click();
    } else if (await moves.count()) {
      // The move that looks strongest from its button: power times its effectiveness hint.
      const texts = (await moves.allInnerTexts()).map((t) => t.toLowerCase());
      const score = (t) => (Number(/pow (\d+)/.exec(t)?.[1] ?? 0) || 1) * (t.includes("super effective") ? 2 : t.includes("not very") ? 0.5 : t.includes("no effect") ? 0 : 1);
      const best = texts.reduce((b, t, i) => (score(t) > score(texts[b]) ? i : b), 0);
      await moves.nth(best).click();
      // Doubles: aim at the first foe.
      if (await p.locator("[data-testid=target-button]").count()) await p.locator("[data-testid=target-button]").first().click();
    } else await p.locator("[data-testid=switch-button]:not([disabled])").first().click();
  }
  throw new Error("the battle didn't progress");
}

step("battle vs computer: a random battle, played until it ends or turn 10");
watchBattle(page, "p1", "cpu battle");
await page.goto(`${BASE}/battle/play`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/battle-setup.png`, fullPage: true });
await page.locator("label").filter({ hasText: "[Gen 9] Random Battle" }).first().click();
await page.getByLabel("Your trainer name").fill("Red");
await page.getByRole("button", { name: /Start battle/ }).click();
await page.waitForURL(/\/battle\/play\/[a-z2-9]{8}$/);
await page.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 });
await page.screenshot({ path: `${OUT}/battle-cpu.png` });
await page.getByRole("button", { name: "4x" }).click();
const cpuTurns = await playBattle(page, 10, "battle-cpu-turn");
console.log(`  stopped at turn ${cpuTurns}`);
if (cpuTurns < 3) errors.push(`the battle against the computer only reached turn ${cpuTurns}`);
await page.screenshot({ path: `${OUT}/battle-cpu-later.png`, fullPage: true });
if ((await page.getByTestId("battle-log").innerText()).length < 200) errors.push("the battle log stayed empty");

step("battle vs computer: Gen 9 OU with the team saved in the team builder");
await page.goto(`${BASE}/battle/play`, { waitUntil: "networkidle" });
await page.locator("label").filter({ hasText: "[Gen 9] OU" }).first().click();
await page.getByRole("radiogroup", { name: "Saved team" }).getByRole("radio", { checked: true }).waitFor();
await page.getByLabel("Your trainer name").fill("Red");
await page.getByRole("button", { name: /Start battle/ }).click();
await page.waitForURL(/\/battle\/play\/[a-z2-9]{8}$/);
await page.locator("[data-testid=lead-button]").first().waitFor({ timeout: 60_000 });
await page.screenshot({ path: `${OUT}/battle-preview.png` });
await page.locator("[data-testid=lead-button]").filter({ hasText: "Garchomp" }).click();
await page.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 });
await page.getByText("What will Garchomp do?").waitFor();

step("battle vs computer: custom rules, Gen 4 at level 50 with Sleep Clause");
await page.goto(`${BASE}/battle/play`, { waitUntil: "networkidle" });
await page.getByTestId("format-custom").click();
await page.getByTestId("gen-4").click();
await page.locator("#custom-level").fill("50");
if ((await page.getByTestId("clause-sleep").getAttribute("aria-pressed")) !== "true") await page.getByTestId("clause-sleep").click();
await page.getByTestId("rules-ok").waitFor({ timeout: 30_000 });
await page.screenshot({ path: `${OUT}/battle-custom-setup.png`, fullPage: true });
await page.getByLabel("Your trainer name").fill("Red");
await page.getByRole("button", { name: /Start battle/ }).click();
await page.waitForURL(/\/battle\/play\/[a-z2-9]{8}$/);
await page.getByText(/\[Gen 4\] Custom · Lv 50/).first().waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "4x" }).click();
const customTurns = await playBattle(page, 4, "battle-custom-turn");
if (customTurns < 3) errors.push(`the Gen 4 custom battle only reached turn ${customTurns}`);
if (!/L50/.test(await page.getByTestId("battle-log").innerText().catch(() => ""))) console.log("  (level shown in sprites only)");

step("battle music: plays after a click, toggles off and stays off");
await page.getByTestId("music-control").waitFor();
await page.mouse.click(5, 5);
await page.waitForTimeout(1500);
const tracks = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\/audio\/battle\/.+\.(ogg|mp3)$/.test(n)));
if (!tracks.length && !musicRequests.length) errors.push("battle music never loaded");
else console.log(`  loaded ${(tracks.length ? tracks : musicRequests).map((t) => t.split("/").pop()).join(", ")}`);
await page.getByTestId("music-toggle").click();
if ((await page.getByTestId("music-toggle").getAttribute("aria-pressed")) !== "false") errors.push("the music toggle didn't turn off");
await page.reload({ waitUntil: "networkidle" });
await page.getByTestId("music-toggle").waitFor();
if ((await page.getByTestId("music-toggle").getAttribute("aria-pressed")) !== "false") errors.push("music off wasn't remembered");
await page.getByTestId("music-toggle").click();

step("Battle Factory: rent a team, battle, and trade after a win");
await page.goto(`${BASE}/battle/factory`, { waitUntil: "networkidle" });
let factoryWon = false;
for (let attempt = 0; attempt < 4 && !factoryWon; attempt++) {
  await page.goto(`${BASE}/battle/factory`, { waitUntil: "networkidle" });
  if (await page.getByRole("button", { name: /Give up this run/ }).count()) await page.getByRole("button", { name: /Give up this run/ }).click();
  await page.locator("#frontier-name").fill("Red");
  await page.getByTestId("frontier-start").click();
  await page.getByTestId("frontier-mon").first().waitFor({ timeout: 30_000 });
  if (attempt === 0) await page.screenshot({ path: `${OUT}/battle-factory.png`, fullPage: true });
  await page.getByTestId("frontier-next").click();
  await page.waitForURL(/\/battle\/play\/[a-z2-9]{8}$/);
  await page.getByTestId("battle-streak").waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "4x" }).click();
  await playBattle(page, 200, attempt === 0 ? "battle-factory-turn" : undefined);
  await page.getByTestId("frontier-after").waitFor({ timeout: 30_000 });
  factoryWon = (await page.getByTestId("frontier-continue").count()) > 0;
}
if (factoryWon) {
  await page.getByTestId("frontier-continue").click();
  await page.getByTestId("factory-swap").waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/battle-factory-swap.png`, fullPage: true });
  const before = await page.getByTestId("swap-give").first().innerText();
  // Take a Pokémon that isn't already on the team (Species Clause).
  const mine = (await page.getByTestId("swap-give").allInnerTexts()).map((t) => t.split("\n")[0]);
  const theirs = (await page.getByTestId("swap-take").allInnerTexts()).map((t) => t.split("\n")[0]);
  const take = theirs.findIndex((t) => !mine.includes(t));
  await page.getByTestId("swap-give").first().click();
  await page.getByTestId("swap-take").nth(Math.max(0, take)).click();
  await page.getByTestId("swap-confirm").click();
  // Either the new team shows, or the server said why the trade was refused.
  const traded = await Promise.race([
    page.getByTestId("frontier-mon").first().waitFor({ timeout: 30_000 }).then(() => true),
    page.locator("main [role=alert]").first().waitFor({ timeout: 30_000 }).then(() => false),
  ]);
  if (!traded) throw new Error(`the Factory trade was refused: ${await page.locator("main [role=alert]").first().innerText()} (gave ${before.split("\n")[0]}, took ${theirs[Math.max(0, take)]})`);
  if ((await page.getByTestId("frontier-mon").first().innerText()) === before) errors.push("the Factory trade didn't change the team");
  if (!/streak\s*1\b/i.test(await page.getByTestId("frontier-streak").innerText())) errors.push("the Factory streak didn't show 1");
} else console.log("  no win in 4 tries: the trade wasn't exercised");

step("Battle Tower: enter with a quick team, pick three at team preview");
await page.goto(`${BASE}/battle/tower`, { waitUntil: "networkidle" });
if (await page.getByRole("button", { name: /Give up this run/ }).count()) await page.getByRole("button", { name: /Give up this run/ }).click();
await page.locator("#frontier-name").fill("Red");
await page.getByRole("button", { name: /Quick team/ }).click();
await page.getByTestId("quick-team").locator("img").first().waitFor({ timeout: 30_000 });
await page.getByTestId("tower-enter").click();
await page.getByTestId("frontier-next").click();
await page.waitForURL(/\/battle\/play\/[a-z2-9]{8}$/);
await page.getByText(/Choose 3 to battle/).waitFor({ timeout: 60_000 });
await page.screenshot({ path: `${OUT}/battle-tower-preview.png` });
for (let k = 0; k < 3; k++) await page.locator("[data-testid=lead-button]").nth(k).click();
await page.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 });
await page.screenshot({ path: `${OUT}/battle-tower.png` });

// A live battle in two browsers: Red opens it, Blue joins from the link.
step("live battle: create, join, ready");
const liveRed = await newPage({ width: 1280, height: 900 });
const liveBlue = await newPage({ width: 1280, height: 900 });
watchBattle(liveRed, "p1", "live battle (Red)");
watchBattle(liveBlue, "p2", "live battle (Blue)");
await liveRed.goto(`${BASE}/battle/play?vs=friend`, { waitUntil: "networkidle" });
await liveRed.locator("label").filter({ hasText: "[Gen 9] Random Battle" }).first().click();
await liveRed.getByLabel("Your trainer name").fill("Red");
await liveRed.getByRole("button", { name: /Create battle/ }).click();
await liveRed.waitForURL(/\/battle\/live\/[a-z2-9]{8}$/);
const liveUrl = liveRed.url();
await liveRed.getByLabel("Battle link").waitFor();
await liveRed.screenshot({ path: `${OUT}/battle-live-lobby.png` });
const liveOg = await liveRed.request.get(`${liveUrl}/opengraph-image`);
if (liveOg.status() !== 200) errors.push(`live battle OG image returned ${liveOg.status()}`);
else fs.writeFileSync(`${OUT}/battle-live-og.png`, await liveOg.body());
await liveBlue.goto(liveUrl, { waitUntil: "networkidle" });
await liveBlue.getByLabel("Your trainer name").fill("Blue");
await liveBlue.getByRole("button", { name: /Join battle/ }).click();
await liveRed.getByRole("button", { name: "Ready", exact: true }).click();
await liveBlue.getByRole("button", { name: "Ready", exact: true }).click();

step("live battle: both choose moves for a couple of turns");
await Promise.all([liveRed, liveBlue].map((p) => p.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 })));
for (const p of [liveRed, liveBlue]) await p.getByRole("button", { name: "4x" }).click();
if (!(await liveRed.getByTestId("battle-clocks").count())) errors.push("the live battle shows no turn timer");
// Chat beside the battle log: both ways; a link is refused.
await chatTo(liveRed, liveBlue, "good luck!");
await chatTo(liveBlue, liveRed, "have fun");
await liveBlue.getByTestId("chat").getByLabel("Chat message").fill("www.example.com");
await liveBlue.getByTestId("chat").getByLabel("Chat message").press("Enter");
await liveBlue.getByTestId("chat-error").filter({ hasText: "Links can't be sent in chat." }).waitFor();
const [redTurn] = await Promise.all([playBattle(liveRed, 2, "battle-live"), playBattle(liveBlue, 2, null)]);
console.log(`  reached turn ${redTurn}`);

step("live battle: Blue forfeits, then a rematch");
if (!(await liveBlue.getByTestId("battle-result").count())) {
  await liveBlue.getByRole("button", { name: "Forfeit", exact: true }).click();
  await liveBlue.getByRole("button", { name: "Forfeit", exact: true }).click();
  await liveRed.getByText("Blue forfeited.").waitFor({ timeout: 30_000 });
  await liveBlue.getByText("You forfeited.").waitFor({ timeout: 30_000 });
}
await liveRed.screenshot({ path: `${OUT}/battle-live-result.png` });
// A private friend battle saves its replay only when a trainer asks.
await liveRed.getByTestId("save-replay").click({ timeout: 30_000 });
await liveRed.getByTestId("watch-replay").waitFor({ timeout: 15_000 });
await liveRed.getByRole("button", { name: /^Rematch$/ }).click();
await liveRed.waitForURL((url) => url.href !== liveUrl && url.pathname.startsWith("/battle/live/"));
await liveBlue.getByRole("button", { name: /Accept rematch/ }).click({ timeout: 30_000 });
await liveBlue.waitForURL(liveRed.url());
await Promise.all([liveRed, liveBlue].map((p) => p.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 })));
await liveBlue.screenshot({ path: `${OUT}/battle-live-rematch.png` });
for (const p of [liveRed, liveBlue]) await p.context().close();

// Matchmaking: two trainers press "Find an opponent" for Random Battle, with no link, and land in one
// battle that's already under way. Red searches first (and waits), Blue's search pairs them.
step("battle matchmaking: find an opponent for Random Battle, then play a turn");
const mmRed = await newPage({ width: 1280, height: 900 });
const mmBlue = await newPage({ width: 1280, height: 900 });
watchBattle(mmRed, "p1", "matched battle (Red)");
watchBattle(mmBlue, "p2", "matched battle (Blue)");
for (const [p, name] of [
  [mmRed, "Red"],
  [mmBlue, "Blue"],
]) {
  await p.goto(`${BASE}/battle/play?vs=anyone`, { waitUntil: "networkidle" });
  await p.locator("label").filter({ hasText: "[Gen 9] Random Battle" }).first().click();
  await p.getByLabel("Your trainer name").fill(name);
}
await mmRed.getByRole("button", { name: /Find an opponent/ }).click();
await mmRed.getByText("Searching for an opponent…").waitFor();
await mmRed.waitForTimeout(1500);
await mmRed.screenshot({ path: `${OUT}/battle-searching.png` });
await mmBlue.getByRole("button", { name: /Find an opponent/ }).click();
const matchedPath = /\/battle\/live\/[a-z2-9]{8}\?matched=1$/;
await Promise.all([mmRed.waitForURL(matchedPath, { timeout: 30_000 }), mmBlue.waitForURL(matchedPath, { timeout: 30_000 })]);
if (mmRed.url() !== mmBlue.url()) errors.push(`matched into different battles: ${mmRed.url()} vs ${mmBlue.url()}`);
await mmRed.getByText("Matched! You vs Blue").waitFor();
await mmBlue.getByText("Matched! You vs Red").waitFor();
// No lobby: both have a move to make at once.
await Promise.all([mmRed, mmBlue].map((p) => p.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 })));
await mmBlue.screenshot({ path: `${OUT}/battle-matched.png` });
for (const p of [mmRed, mmBlue]) await p.getByRole("button", { name: "4x" }).click();
const [mmTurn] = await Promise.all([playBattle(mmRed, 1, null), playBattle(mmBlue, 1, null)]);
if (mmTurn < 2) errors.push(`the matched battle didn't get past turn ${mmTurn}`);

// Spectating: a third trainer finds the battle in the Watch lobby and sees what Showdown's spectators see.
step("watch live: a third trainer watches the matched battle from /battle/watch");
const mmCode = /\/battle\/live\/([a-z2-9]{8})/.exec(mmRed.url())[1];
const watcher = await newPage({ width: 1280, height: 900 });
watcher.on("response", async (res) => {
  if (!/\/api\/battle\//.test(res.url())) return;
  const text = await res.text().catch(() => "");
  if (/"(state|inputLog|seed|input_log|requests|watchers|player)"|\|request\||\|split\||"side":\{"name"/.test(text)) errors.push(`spectator: hidden battle data leaked: ${text.slice(0, 200)}`);
});
await watcher.goto(`${BASE}/battle/watch`, { waitUntil: "networkidle" });
const card = watcher.locator(`a[href="/battle/live/${mmCode}"]`);
await card.waitFor({ timeout: 20_000 });
if (!/Turn \d+/i.test(await card.innerText()) || !/Red/i.test(await card.innerText()) || !/watching/i.test(await card.innerText())) errors.push(`watch lobby card is missing facts: ${await card.innerText()}`);
await watcher.screenshot({ path: `${OUT}/battle-watch.png`, fullPage: true });
await card.click();
await watcher.waitForURL(`${BASE}/battle/live/${mmCode}`);
await watcher.getByTestId("spectating").waitFor();
await watcher.getByTestId("battle-log").getByText(/sent out/).first().waitFor({ timeout: 30_000 });
await mmRed.getByTestId("spectator-count").filter({ hasText: /[1-9] watching/ }).waitFor({ timeout: 30_000 });
if (await watcher.locator("[data-testid=move-button]").count()) errors.push("a spectator was offered moves");
await watcher.screenshot({ path: `${OUT}/battle-spectator.png` });

step("battle tooltips: a move's damage range from the calculator, a Pokémon's details");
await mmRed.locator("[data-testid=move-button]:not([disabled]), [data-testid=switch-button]:not([disabled])").first().waitFor({ timeout: 60_000 });
if (await mmRed.locator("[data-testid=move-button]:not([disabled])").count()) {
  await mmRed.locator("[data-testid=move-button]:not([disabled])").first().hover();
  const tip = mmRed.getByTestId("move-tooltip");
  await tip.waitFor();
  const tipText = await tip.innerText();
  if (!/Power|Accuracy/i.test(tipText) || !/PP \d+\/\d+/i.test(tipText)) errors.push(`move tooltip is missing details: ${tipText}`);
  const damaging = await mmRed.getByTestId("move-damage").count();
  if (damaging) {
    await mmRed.getByTestId("damage-range").first().waitFor({ timeout: 15_000 });
    const range = await mmRed.getByTestId("damage-range").first().innerText();
    if (!/^\d+(\.\d)?–\d+(\.\d)?%$/.test(range.trim())) errors.push(`damage range looks wrong: "${range}"`);
    console.log(`  damage range: ${range}`);
  }
  await mmRed.screenshot({ path: `${OUT}/battle-move-tooltip.png` });
}
await mmRed.getByTestId("hud-foe").first().hover();
await mmRed.getByTestId("mon-tooltip").waitFor();
if (!/Ability/i.test(await mmRed.getByTestId("mon-tooltip").innerText())) errors.push("Pokémon tooltip has no ability line");
await mmRed.screenshot({ path: `${OUT}/battle-mon-tooltip.png` });
await mmRed.mouse.move(5, 5);

step("matched battle: play to the end; the spectator sees the result; the replay saves itself");
const [mmEnd] = await Promise.all([playBattle(mmRed, 1000, null), playBattle(mmBlue, 1000, null)]);
console.log(`  the battle ended on turn ${mmEnd}`);
// The spectator follows the live feed; if it misses the final update, a reload must still show the result.
for (const [who, p] of [["Red", mmRed], ["Blue", mmBlue], ["spectator", watcher]]) {
  try {
    await p.getByTestId("battle-result").waitFor({ timeout: 60_000 });
  } catch {
    console.log(`  warning: ${who} missed the end live; reloading`);
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.getByTestId("battle-result").waitFor({ timeout: 60_000 });
  }
}
await watcher.screenshot({ path: `${OUT}/battle-spectator-result.png` });
await mmRed.getByTestId("watch-replay").waitFor({ timeout: 45_000 });
await mmRed.screenshot({ path: `${OUT}/battle-matched-result.png` });

step("replay: open it, step through it, jump, play");
await mmRed.getByTestId("watch-replay").click();
await mmRed.waitForURL(`${BASE}/battle/replay/${mmCode}`);
const turnLabel = () => mmRed.getByTestId("replay-turn").innerText();
await mmRed.getByTestId("replay-forward").click();
await mmRed.getByTestId("replay-turn").filter({ hasText: /^Leads \// }).waitFor();
await mmRed.getByTestId("replay-forward").click();
await mmRed.getByTestId("replay-turn").filter({ hasText: /^Turn 1 \// }).waitFor();
await mmRed.getByTestId("replay-back").click();
await mmRed.getByTestId("replay-turn").filter({ hasText: /^Leads \// }).waitFor();
await mmRed.getByTestId("battle-log").getByText(/sent out/).first().waitFor();
await mmRed.getByRole("button", { name: "0.5x" }).click();
await mmRed.getByRole("button", { name: "4x" }).click();
await mmRed.getByTestId("replay-play").click();
await mmRed.getByTestId("replay-turn").filter({ hasText: /^Turn [3-9]/ }).waitFor({ timeout: 60_000 });
await mmRed.getByTestId("replay-pause").click();
await mmRed.screenshot({ path: `${OUT}/battle-replay.png` });
await mmRed.getByTestId("replay-end").click();
await mmRed.getByTestId("battle-result").waitFor({ timeout: 30_000 });
console.log(`  replay at: ${await turnLabel()}`);

step("replay analysis: the after-battle link, win chance by turn, key moments");
await mmRed.goto(`${BASE}/battle/live/${mmCode}`, { waitUntil: "networkidle" });
await mmRed.getByTestId("analyse-battle").click();
await mmRed.waitForURL(new RegExp(`/battle/replay/${mmCode}\\?analysis=1&side=[01]`));
const analysis = mmRed.getByTestId("replay-analysis");
const analysisStart = Date.now();
await analysis.getByTestId("analysis-progress").waitFor({ timeout: 30_000 }).catch(() => {});
await analysis.getByTestId("key-moments").waitFor({ timeout: 180_000 });
const analysisSecs = ((Date.now() - analysisStart) / 1000).toFixed(1);
if ((await analysis.getByTestId("analysis-chart").locator("path").count()) < 2) errors.push("analysis: no win-chance line");
const assumptions = await analysis.getByTestId("analysis-assumptions").innerText();
if (!/95% confidence interval/.test(assumptions) || !/assumed/.test(assumptions)) errors.push(`analysis: the assumptions aren't spelled out: ${assumptions}`);
for (const line of (await analysis.getByTestId("key-moments").locator("li").allInnerTexts())) {
  if (!/^Turn \d+: .+ \(win chance \d+% → (\d+%|won|lost|draw)\)\.$/.test(line)) errors.push(`analysis: odd key moment "${line}"`);
  else console.log(`  ${line}`);
}
console.log(`  analysis took ${analysisSecs} s`);
await analysis.screenshot({ path: `${OUT}/battle-replay-analysis.png` });
// Cached in this browser: a reload shows it at once.
await mmRed.reload({ waitUntil: "networkidle" });
await mmRed.getByTestId("replay-analysis").getByTestId("key-moments").waitFor({ timeout: 10_000 });
const replayOg = await mmRed.request.get(`${BASE}/battle/replay/${mmCode}/opengraph-image`);
if (replayOg.status() !== 200) errors.push(`replay OG image returned ${replayOg.status()}`);
else fs.writeFileSync(`${OUT}/battle-replay-og.png`, await replayOg.body());
await mmRed.goto(`${BASE}/battle/replays`, { waitUntil: "networkidle" });
await mmRed.getByTestId("recent-replays").locator(`a[href="/battle/replay/${mmCode}"]`).waitFor({ timeout: 15_000 });
await mmRed.getByTestId("my-replays").locator(`a[href="/battle/replay/${mmCode}"]`).waitFor({ timeout: 15_000 });
await mmRed.screenshot({ path: `${OUT}/battle-replays.png`, fullPage: true });
await mmRed.goto(`${BASE}/battle/ladder`, { waitUntil: "networkidle" });
await mmRed.screenshot({ path: `${OUT}/battle-ladder.png`, fullPage: true });
for (const p of [mmRed, mmBlue, watcher]) await p.context().close();

// The Battle Lab runs Showdown's simulator in Web Workers, in this browser.
step("battle lab: a quick 1v1, 200 battles, a win % with its confidence interval, a sample replay");
await page.goto(`${BASE}/battle/lab`, { waitUntil: "networkidle" });
for (const [side, text] of [
  ["Side A", "Pikachu @ Light Ball\nLevel: 50\n- Thunderbolt\n- Quick Attack"],
  ["Side B", "Bulbasaur\nLevel: 50\n- Vine Whip\n- Tackle"],
]) {
  const card = page.getByRole("region", { name: side, exact: true });
  await card.getByRole("button", { name: "Paste", exact: true }).click();
  await card.getByLabel("Showdown team").fill(text);
  await card.getByRole("button", { name: `Use for ${side}` }).click();
}
await page.getByRole("button", { name: "Custom", exact: true }).click();
await page.getByLabel("Custom number of battles").fill("200");
await page.getByRole("button", { name: /^Run 200 battles/ }).click();
await page.getByTestId("lab-progress").waitFor({ timeout: 30_000 }).catch(() => {});
await page.getByRole("button", { name: /Run again with seed/ }).waitFor({ timeout: 120_000 });
const labSummary = await page.getByTestId("lab-summary").innerText();
console.log(`  ${labSummary}`);
if (!/wins \d+\.\d% \(± \d+\.\d%\) over 200 battles/.test(labSummary)) errors.push(`battle lab: unexpected summary "${labSummary}"`);
const labTile = await page.getByTestId("lab-win-a").innerText();
if (!/\d+\.\d%[\s\S]*95% CI \d+\.\d%–\d+\.\d%/.test(labTile)) errors.push(`battle lab: no win % with a confidence interval in "${labTile}"`);
if (!/[?&]setup=[zj][\w-]+.*&seed=/.test(page.url())) errors.push(`battle lab: the setup isn't in the URL (${page.url()})`);
await page.screenshot({ path: `${OUT}/battle-lab.png`, fullPage: true });
await page.getByRole("button", { name: /^A .+ win$/, disabled: false }).first().click();
await page.getByTestId("lab-replay-log").getByText(/used/).first().waitFor({ timeout: 30_000 });
await page.getByTestId("lab-replay").screenshot({ path: `${OUT}/battle-lab-replay.png` });

// Accounts are only on when the server has a store (Supabase, or
// POKEIQ_LOCAL_ACCOUNTS=1 for a local production build).
const me = await (await page.request.get(`${BASE}/api/auth/me`)).json();
if (me.enabled) {
  step("accounts: register, sync, sign out, sign in, recover");
  const username = `e2e_${Date.now().toString(36)}`;
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Trainer name").waitFor();
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

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Trainer name").waitFor();
  await page.getByLabel("Trainer name").fill(username);
  await page.getByLabel("Password").fill("wrong password!!");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.getByRole("alert").waitFor();
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.waitForURL(/\/trainer/);
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem("pokeiq:progress:v1") ?? "{}").xp ?? 0) > 0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Trainer name").waitFor();
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

// The battle home: the format menu, then "Battle!" pairs two trainers searching for Random Battle.
step("battle home: format menu, live counters, Battle! matchmaking");
const homeRed = await newPage({ width: 1280, height: 900 });
const homeBlue = await newPage({ width: 1280, height: 900 });
for (const [p, name] of [
  [homeRed, "Red"],
  [homeBlue, "Blue"],
]) {
  await p.goto(`${BASE}/battle`, { waitUntil: "networkidle" });
  await p.getByTestId("live-counts").waitFor();
  const trainer = p.getByLabel("Your trainer name");
  if (!(await trainer.isVisible().catch(() => false))) await p.getByRole("button", { name: /change/ }).click();
  await p.getByLabel("Your trainer name").fill(name);
}
await homeRed.getByTestId("format-picker").click();
await homeRed.getByRole("option", { name: "[Gen 4] OU" }).waitFor();
await homeRed.getByTestId("format-menu").screenshot({ path: `${OUT}/battle-home-formats.png` });
await homeRed.getByRole("option", { name: "Random Battle" }).first().click();
await homeRed.getByTestId("battle-button").click();
await homeRed.getByTestId("battle-searching").waitFor();
await homeBlue.getByTestId("battle-button").click();
await Promise.all([homeRed.waitForURL(matchedPath, { timeout: 30_000 }), homeBlue.waitForURL(matchedPath, { timeout: 30_000 })]);
if (homeRed.url() !== homeBlue.url()) errors.push(`battle home matched into different battles: ${homeRed.url()} vs ${homeBlue.url()}`);
await Promise.all([homeRed, homeBlue].map((p) => p.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 })));
const counts = await (await homeRed.request.get(`${BASE}/api/live`)).json();
if (typeof counts.online !== "number" || typeof counts.battles !== "number") errors.push(`live counters: ${JSON.stringify(counts)}`);
for (const p of [homeRed, homeBlue]) await p.context().close();

// Friends: two accounts, a request, online status, a challenge to a Random Battle, user search and the profile.
if (me.enabled) {
  step("friends: request, accept, online status");
  const stamp = Date.now().toString(36).slice(-6);
  const [nameA, nameB] = [`fr${stamp}a`, `fr${stamp}b`];
  const fa = await newPage({ width: 1280, height: 900 });
  const fb = await newPage({ width: 1280, height: 900 });
  for (const [p, name] of [
    [fa, nameA],
    [fb, nameB],
  ]) {
    await p.goto(BASE, { waitUntil: "networkidle" });
    const res = await p.request.post(`${BASE}/api/auth/register`, { data: { username: name, password: "correct horse battery" }, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`register ${name}: ${res.status()}`);
    await p.reload({ waitUntil: "networkidle" });
  }
  // A refocused tab sends its heartbeat at once (at most every 20 s) instead of waiting out the minute.
  const nudge = (p) => p.evaluate(() => window.dispatchEvent(new Event("focus")));
  const friendsOn = (await (await fa.request.get(`${BASE}/api/friends`)).json()).available;
  if (!friendsOn) console.log("  friends are off on this server (migration 0019): skipped");
  else {
    await fa.getByTestId("friends-button").click();
    await fa.getByRole("tab", { name: /Add/ }).click();
    await fa.getByLabel("Trainer name").fill(nameB);
    await fa.getByRole("button", { name: /Send/ }).click();
    await fa.getByText(`Request sent to ${nameB}.`).waitFor();
    await fa.keyboard.press("Escape");
    await fb.reload({ waitUntil: "networkidle" });
    await fb.getByTestId("friends-badge").waitFor({ timeout: 15_000 });
    await fb.getByTestId("friends-button").click();
    await fb.getByTestId("incoming-request").filter({ hasText: nameA }).getByRole("button", { name: /Accept/ }).click();
    await fb.getByRole("tab", { name: /Friends/ }).click();
    await fb.getByTestId("friend-row").filter({ hasText: nameA }).waitFor();
    await fb.keyboard.press("Escape");
    await fa.reload({ waitUntil: "networkidle" });
    await fa.getByTestId("friends-button").click();
    const row = fa.getByTestId("friend-row").filter({ hasText: nameB });
    await row.waitFor();
    if ((await row.getAttribute("data-online")) !== "true") errors.push("a friend with a tab open shows offline");
    await fa.screenshot({ path: `${OUT}/friends-panel.png` });

    step("friends: challenge to a Random Battle, accepted from the toast");
    await row.getByRole("button", { name: /Challenge/ }).click();
    await fa.getByTestId("challenge-options").getByRole("button", { name: /Random Battle/ }).click();
    await fa.waitForURL(/\/battle\/live\/[a-z2-9]{8}$/, { timeout: 20_000 });
    const challengeUrl = fa.url();
    await fb.waitForTimeout(21_000);
    await nudge(fb);
    const toast = fb.getByTestId("challenge-toast");
    await toast.waitFor({ timeout: 70_000 });
    await fb.screenshot({ path: `${OUT}/friends-challenge-toast.png` });
    await toast.getByRole("button", { name: /Accept/ }).click();
    await fb.waitForURL(challengeUrl, { timeout: 20_000 });
    await fb.getByLabel("Your trainer name").fill(nameB);
    await fb.getByRole("button", { name: /Join battle/ }).click();
    await fa.getByRole("button", { name: "Ready", exact: true }).click();
    await fb.getByRole("button", { name: "Ready", exact: true }).click();
    await Promise.all([fa, fb].map((p) => p.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 })));

    step("find a user: search, then the profile");
    await fa.goto(`${BASE}/users`, { waitUntil: "networkidle" });
    await fa.getByTestId("user-search").fill(nameB.slice(0, 7));
    await fa.getByTestId("user-results").getByRole("link", { name: nameB }).click();
    await fa.waitForURL(new RegExp(`/u/${nameB}$`));
    await fa.getByTestId("friend-status-badge").waitFor({ timeout: 15_000 });
    await fa.screenshot({ path: `${OUT}/profile.png`, fullPage: true });
    const old = await fa.request.get(`${BASE}/battle/player/${nameB}`, { maxRedirects: 0 });
    if (![307, 308].includes(old.status())) errors.push(`/battle/player/<name> didn't redirect (${old.status()})`);
  }
  for (const p of [fa, fb]) await p.context().close();
}

// Tournaments, chat rooms, moderation and feedback: four signed-in trainers.
// Set E2E_ADMIN to a fresh trainer name that's also in the server's
// POKEIQ_ADMINS to run the moderation steps (it's registered here).
if (me.enabled) {
  step("tournaments: four trainers sign up for a Random Battle bracket");
  const stamp = Date.now().toString(36).slice(-5);
  const admin = process.env.E2E_ADMIN ?? null;
  const names = [admin ?? `tp${stamp}a`, `tp${stamp}b`, `tp${stamp}c`, `tp${stamp}d`];
  const tp = [];
  for (const name of names) {
    const p = await newPage({ width: 1280, height: 900 });
    await p.goto(BASE, { waitUntil: "networkidle" });
    const res = await p.request.post(`${BASE}/api/auth/register`, { data: { username: name, password: "correct horse battery" }, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`register ${name}: ${res.status()}`);
    tp.push(p);
  }
  const tourOn = (await (await tp[0].request.get(`${BASE}/api/tournaments`)).json()).available;
  if (!tourOn) console.log("  tournaments are off on this server (migration 0020): skipped");
  else {
    const host = tp[0];
    await host.goto(`${BASE}/battle/tournaments`, { waitUntil: "networkidle" });
    await host.getByTestId("tournament-create").waitFor();
    await host.getByLabel("Max players").selectOption("4");
    await host.screenshot({ path: `${OUT}/tournaments-lobby.png` });
    await host.getByRole("button", { name: /Open tournament/ }).click();
    await host.waitForURL(/\/battle\/tournaments\/[a-z2-9]{10}$/);
    const tourUrl = host.url();
    const tourApi = tourUrl.replace("/battle/tournaments/", "/api/tournaments/");
    for (const p of tp) {
      if (p !== host) await p.goto(tourUrl, { waitUntil: "networkidle" });
      await p.getByTestId("join-tournament").click();
      await p.getByTestId("leave-tournament").or(p.locator("[data-testid=tournament][data-status=running]")).first().waitFor({ timeout: 15_000 });
    }
    // Four of four: sign-ups close at once and round one starts.
    await host.locator("[data-testid=tournament][data-status=running]").waitFor({ timeout: 30_000 });
    await host.getByTestId("bracket").waitFor();
    await host.screenshot({ path: `${OUT}/tournament-bracket.png`, fullPage: true });

    /** The trainers whose match in round `round` is ready, by asking the server as each of them. */
    async function ready(round, want) {
      for (let i = 0; i < 40; i++) {
        const out = [];
        for (const [n, p] of tp.entries()) {
          const view = await (await p.request.get(tourApi)).json();
          const mine = view.you?.match && view.matches.find((m) => m.code === view.you.match.code);
          if (mine?.round === round && mine.state === "playing") out.push({ p, name: names[n], against: view.you.match.against });
        }
        if (out.length >= want) return out;
        await host.waitForTimeout(1_500);
      }
      throw new Error(`tournament: expected ${want} trainers with a match ready`);
    }

    for (const [round, want] of [
      [1, 4],
      [2, 2],
    ]) {
      step(`tournaments: round ${round}, each match decided by a forfeit`);
      const players = await ready(round, want);
      for (const [i, { p }] of players.entries()) {
        if (round === 2 && i === 0) {
          // The friend-challenge toast: "Your match is ready" on any page.
          await p.goto(`${BASE}/battle`, { waitUntil: "networkidle" });
          await p.getByTestId("match-toast").waitFor({ timeout: 30_000 });
          await p.screenshot({ path: `${OUT}/tournament-toast.png` });
          await p.getByTestId("match-toast").getByRole("button", { name: /Play now/ }).click();
        } else {
          await p.goto(tourUrl, { waitUntil: "networkidle" });
          await p.getByTestId("play-match").click({ timeout: 20_000 });
        }
        await p.waitForURL(/\/battle\/live\/[a-z2-9]{8}/);
        await p.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 });
      }
      // The later name of each pair forfeits.
      for (const { p, name, against } of players) {
        if (name < against) continue;
        await p.getByRole("button", { name: "Forfeit", exact: true }).click();
        await p.getByRole("button", { name: "Forfeit", exact: true }).click();
        await p.getByText("You forfeited.").waitFor({ timeout: 30_000 });
        await p.getByTestId("back-to-tournament").click();
        await p.waitForURL(tourUrl);
      }
    }
    await host.goto(tourUrl, { waitUntil: "networkidle" });
    await host.getByTestId("tournament-winner").waitFor({ timeout: 30_000 });
    await host.screenshot({ path: `${OUT}/tournament-winner.png`, fullPage: true });
    await host.goto(`${BASE}/battle/tournaments`, { waitUntil: "networkidle" });
    await host.getByTestId("tournament-history").filter({ hasText: names[0] }).waitFor({ timeout: 15_000 });
  }

  step("chat rooms: two trainers talk in the Lobby; a swear is masked; a report");
  const [ra, rb] = [tp[1], tp[2]];
  for (const p of [ra, rb]) await p.goto(`${BASE}/rooms/lobby`, { waitUntil: "networkidle" });
  const roomsOn = await ra.getByTestId("room-chat").isVisible().catch(() => false);
  if (!roomsOn) console.log("  chat rooms are off on this server (migration 0020): skipped");
  else {
    const say = async (p, text) => {
      await p.getByLabel("Room message").fill(text);
      await p.getByLabel("Room message").press("Enter");
      await p.getByTestId("room-text").filter({ hasText: text.replace("shit", "•••") }).first().waitFor({ timeout: 10_000 });
    };
    await say(ra, `hello from ${names[1]}`);
    // Without Realtime, rooms refresh every 5 s through a CDN-cached read, so a message can take ~10–15 s.
    await rb.getByTestId("room-text").filter({ hasText: `hello from ${names[1]}` }).waitFor({ timeout: 30_000 });
    await say(rb, "what the shit");
    const masked = ra.getByTestId("room-line").filter({ hasText: "what the •••" });
    await masked.waitFor({ timeout: 30_000 });
    if (await ra.getByText("what the shit").count()) errors.push("a swear in a room wasn't masked");
    // Who's here comes from presence, and the list is cached at the CDN to keep requests down,
    // so another trainer can take up to about a minute to show.
    await rb.getByTestId("room-users").getByText(names[1]).waitFor({ timeout: 90_000 });
    await masked.hover();
    await masked.getByTestId("room-report").click();
    await masked.getByText("Reported").waitFor();
    await ra.screenshot({ path: `${OUT}/room-lobby.png` });

    step("feedback: an idea about tournaments, from /feedback; the footer opens the same form");
    const fp = tp[3];
    await fp.goto(`${BASE}/feedback`, { waitUntil: "networkidle" });
    await fp.getByRole("button", { name: "Idea" }).click();
    await fp.getByLabel("Which part of PokéIQ").selectOption("tournaments");
    const idea = `E2E idea ${stamp}: a Little Cup tournament every evening`;
    await fp.getByLabel("Message").fill(idea);
    await fp.getByRole("button", { name: "Send", exact: true }).click();
    await fp.getByTestId("feedback-sent").waitFor();
    await fp.getByRole("button", { name: "Report a problem" }).click();
    await fp.getByRole("dialog").getByTestId("feedback-form").waitFor();
    await fp.screenshot({ path: `${OUT}/feedback-dialog.png` });
    await fp.keyboard.press("Escape");

    // Not an admin: the page is a 404 and so is its API.
    await ra.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    if (!(await ra.getByText("A wild 404 appeared!").isVisible()) || (await ra.getByText("Moderation desk").count())) errors.push("/admin isn't hidden from a trainer who isn't an admin");
    if ((await ra.request.get(`${BASE}/api/admin?tab=audit`)).status() !== 404) errors.push("/api/admin answered a trainer who isn't an admin");
    if (!admin) console.log("  E2E_ADMIN not set: moderation steps skipped");
    else {
      step("moderation: an admin mutes a trainer, who then can't post");
      const desk = tp[0];
      await desk.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
      await desk.getByTestId("admin-reports").waitFor();
      await desk.getByTestId("admin-report").filter({ hasText: "what the •••" }).first().waitFor({ timeout: 15_000 });
      await desk.getByTestId("admin-tab-users").click();
      await desk.getByTestId("admin-user-query").fill(names[2]);
      await desk.getByTestId("admin-user-query").press("Enter");
      await desk.getByTestId("admin-mute-1h").click();
      await desk.getByTestId("admin-sanction").filter({ hasText: /Muted until/ }).waitFor();
      await desk.screenshot({ path: `${OUT}/admin-mute.png` });
      await rb.waitForTimeout(1_100);
      await rb.getByLabel("Room message").fill("am I muted?");
      await rb.getByLabel("Room message").press("Enter");
      await rb.getByTestId("room-error").filter({ hasText: /muted/ }).waitFor({ timeout: 10_000 });

      step("moderation: the feedback shows on the admin page");
      await desk.getByTestId("admin-tab-reports").click();
      await desk.getByLabel("Category").selectOption("idea");
      await desk.locator("[data-testid=admin-reports][aria-busy=false]").getByTestId("admin-report").filter({ hasText: idea }).waitFor({ timeout: 15_000 });
      if (await desk.getByTestId("admin-report").filter({ hasText: "Chat report" }).count()) errors.push("the admin's category filter let a chat report through");
      await desk.screenshot({ path: `${OUT}/admin-feedback.png`, fullPage: true });
      await desk.getByTestId("admin-tab-audit").click();
      await desk.getByTestId("admin-audit").getByText("mute").first().waitFor();

      step("moderation: the reported PokéGuessr screenshot is in the review queue; keep it");
      await desk.getByTestId("admin-tab-shots").click();
      await desk.getByTestId("admin-shot").first().waitFor({ timeout: 15_000 });
      await desk.screenshot({ path: `${OUT}/admin-shots.png`, fullPage: true });
      await desk.getByTestId("admin-shot-keep").first().click();
      await desk.getByText("Nothing here.").waitFor();
    }
  }
  for (const p of tp) await p.context().close();
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
await closeHowTo(mobile);
await mobile.screenshot({ path: `${OUT}/mobile-pokedle.png` });

await browser.close();

if (errors.length > 0) {
  console.error(`✗ ${errors.length} error(s):`);
  errors.forEach((e) => console.error("  ", e));
  process.exit(1);
}
console.log(`✓ smoke test passed — screenshots in ${OUT}/`);
