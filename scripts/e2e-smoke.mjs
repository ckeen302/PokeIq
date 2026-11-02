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
import { runIqTest } from "./e2e-iq-test.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
// Each game opens its how-to pop-up (with a live demo) on a first visit. "Don't show again" dismisses it for good on this device.
const HOWTO = '[data-testid="howto-sheet"], [data-testid="pdk-howto"]';
/** Click a "Create duel"-style button until the page navigates: a click that lands before hydration does nothing. */
async function clickUntilUrl(p, button, urlRe, refill) {
  for (let i = 0; i < 4; i++) {
    if (refill) await refill();
    // Hydration can clear a name typed too early.
    const name = p.getByLabel("Your trainer name").first();
    if ((await name.count()) && !(await name.inputValue())) await name.fill("Red");
    await button.click({ timeout: 10_000 }).catch(() => {});
    try {
      await p.waitForURL(urlRe, { timeout: 10_000 });
      return;
    } catch {
      // Not hydrated yet: try again.
    }
  }
  await p.waitForURL(urlRe);
}
/** Loads a page and waits for its network to settle, but not forever: slow third-party image fetches on CI runners can keep a page from ever going fully idle. */
async function gotoSettled(p, url) {
  await p.goto(url, { waitUntil: "load" });
  await p.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
}
async function closeHowTo(p) {
  const sheet = p.locator(HOWTO).first();
  if (await sheet.waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false)) {
    await p.getByTestId("howto-never").click();
    await sheet.waitFor({ state: "hidden" });
  }
}
/** First visit: the pop-up opens by itself with its demo; "Let's play!" closes it, and it opens again on the next first-visit load until "Don't show again". */
async function checkFirstVisitHowTo(p, game) {
  const sheet = p.locator(HOWTO).first();
  if (!(await sheet.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false))) return errors.push(`${game} didn't auto-open its how-to on a first visit`);
  if (!(await p.getByTestId("howto-demo").isVisible())) errors.push(`${game}'s how-to has no demo`);
  await p.getByTestId("howto-play").click();
  await sheet.waitFor({ state: "hidden" });
  await p.reload({ waitUntil: "load" });
  if (!(await sheet.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false))) errors.push(`${game}'s how-to didn't open again after "Let's play!"`);
  await p.getByTestId("howto-never").click();
  await sheet.waitFor({ state: "hidden" });
  await p.reload({ waitUntil: "load" });
  await p.waitForTimeout(1500);
  if (await sheet.isVisible()) errors.push(`${game}'s how-to opened again after "Don't show again"`);
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

// E2E_ONLY=which-pokemon runs just that step (no Supabase, no second browser), then exits.
if (process.env.E2E_ONLY === "which-pokemon") {
  await whichPokemonStep();
  await finish();
}

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
  await gotoSettled(p, `${BASE}/quiz/${slug}`);
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
await gotoSettled(page, BASE);
await page.screenshot({ path: `${OUT}/home.png`, fullPage: true });

step("pokédex entry: Where to find it");
await gotoSettled(page, `${BASE}/pokemon/starly`);
{
  const sec = page.locator("#encounters");
  await sec.waitFor();
  const open = await sec.locator("table tbody tr").count();
  if (open === 0) errors.push("dex entry: Where to find it has no rows in the newest generation");
  const collapsed = sec.locator("button[aria-expanded=false]").first();
  if ((await collapsed.count()) === 0) errors.push("dex entry: older generations are not collapsible");
  else {
    await collapsed.click();
    if ((await sec.locator("table tbody tr").count()) <= open) errors.push("dex entry: expanding a generation added no rows");
  }
  await sec.screenshot({ path: `${OUT}/dex-encounters.png` });
}

// A full Classic run, capturing the server's share token for the challenge flow.
step("who's that pokémon: full classic run");
let shareToken = null;
page.on("response", async (res) => {
  if (res.url().endsWith("/api/session/answer") && res.ok()) {
    const body = await res.json().catch(() => null);
    if (body?.shareToken) shareToken = body.shareToken;
  }
});
await gotoSettled(page, `${BASE}/quiz/whos-that-pokemon`);
await page.screenshot({ path: `${OUT}/setup.png` });
// One fixed tuning: no difficulty picker, on the setup or the duel card.
if (await page.getByTestId("quiz-difficulty").count()) errors.push("who's that: the setup still offers a difficulty");
if (await page.getByRole("group", { name: "Duel difficulty" }).count()) errors.push("who's that: the duel card still offers a difficulty");
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
// Quiz modes have no leaderboard: the run is set against the personal best instead.
await page.getByTestId("quiz-personal-best").waitFor({ timeout: 5_000 }).catch(() => errors.push("who's that: no personal best line on the results"));
if (await page.getByText("Save to leaderboard").count()) errors.push("who's that: the results still offer the leaderboard");

step("an old link with a difficulty still starts");
await gotoSettled(page, `${BASE}/quiz/pokemon-type-quiz?difficulty=hard&format=blitz`);
if (await page.getByTestId("quiz-difficulty").count()) errors.push("type master: an old ?difficulty= link brought the picker back");
await page.getByRole("button", { name: /^Start/ }).click();
await page.waitForSelector("h2");

step("challenge link");
if (shareToken) {
  await gotoSettled(page, `${BASE}/c/${shareToken}`);
  await page.getByRole("button", { name: /Accept challenge/ }).waitFor();
  await page.screenshot({ path: `${OUT}/challenge.png` });
  const og = await page.request.get(`${BASE}/c/${shareToken}/opengraph-image`);
  if (og.status() !== 200) errors.push(`OG image returned ${og.status()}`);
  else fs.writeFileSync(`${OUT}/challenge-og.png`, await og.body());
}

for (const slug of ["pokemon-higher-or-lower", "pokemon-type-quiz", "pokedex-entry-quiz", "pokemon-cry-quiz"]) {
  step(slug);
  await gotoSettled(page, `${BASE}/quiz/${slug}`);
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

// Real Shiny: four picture options whose URLs and API payloads never say which is real.
step("real shiny quiz: three questions");
{
  const leaks = [];
  const seenImages = [];
  const watch = async (res) => {
    const path = new URL(res.url()).pathname;
    if (!/^\/api\/session(\/answer|\/next)?$/.test(path) || !res.ok()) return;
    const body = await res.json().catch(() => null);
    for (const q of [body?.question, body?.next]) {
      if (!q) continue;
      if (/"answer"|"explanation"|real|fake|decoy/i.test(JSON.stringify(q).replace(/Which one is the real shiny/g, ""))) leaks.push(JSON.stringify(q).slice(0, 200));
      if (q.images?.length === 4 && q.images.every((u) => /\/shiny\/[0-9a-f]{32}\.webp$/.test(u))) seenImages.push(q.images);
    }
  };
  page.on("response", watch);
  await gotoSettled(page, `${BASE}/quiz/real-shiny-quiz`);
  // Real Shiny keeps its Easy / Hard choice.
  const shinyLevels = (await page.getByTestId("quiz-difficulty").locator("button").allInnerTexts()).map((t) => t.split("\n")[0].trim().toLowerCase());
  if (shinyLevels.join(",") !== "easy,hard") errors.push(`real shiny: difficulty choices are ${shinyLevels.join(",") || "missing"}, expected easy,hard`);
  await page.getByRole("button", { name: /^Start/ }).click();
  await page.waitForSelector("h2");
  for (let i = 0; i < 3; i++) {
    await page.locator("[data-answer-tile]").first().waitFor();
    if (i === 0) {
      await page.waitForFunction(() => [...document.querySelectorAll("[data-answer-tile] img")].every((im) => im.complete), null, { timeout: 15_000 }).catch(() => {});
      const loaded = await page.$$eval("[data-answer-tile] img", (ims) => ims.filter((im) => im.naturalWidth > 0).length);
      if (loaded < 4) errors.push(`real shiny: only ${loaded}/4 images loaded`);
      await page.screenshot({ path: `${OUT}/quiz-real-shiny.png` });
    }
    await page.locator("[data-answer-tile]:not([disabled])").nth(i).click();
    const next = page.getByRole("button", { name: /Next question|See results/ });
    await next.waitFor({ timeout: 10_000 });
    await next.click();
  }
  page.off("response", watch);
  if (leaks.length) errors.push(`real shiny: a question leaked: ${leaks[0]}`);
  if (seenImages.length < 3) errors.push(`real shiny: only ${seenImages.length}/3 questions had four image options`);
}

// Zoom Reveal: a close-up that zooms out one step per miss. No payload before the
// answer names the Pokémon, each step's crop loads, and the round ends on a share line.
step("zoom reveal: a round, the daily");
{
  const leaks = [];
  const steps = [];
  const watch = async (res) => {
    const path = new URL(res.url()).pathname;
    if (!/^\/api\/session(\/answer|\/next)?$/.test(path) || !res.ok()) return;
    const body = await res.json().catch(() => null);
    for (const q of [body?.question, body?.next]) {
      if (q && /"answer"|"explanation"|official-artwork|githubusercontent|pokemonId/.test(JSON.stringify(q))) leaks.push(JSON.stringify(q).slice(0, 200));
    }
    if (body?.zoom) {
      steps.push(body.zoom.step);
      if (body.answer || body.revealUrl || body.explanation) leaks.push(`a zoom step carried the answer: ${JSON.stringify(body).slice(0, 200)}`);
    }
  };
  const stageLoaded = (p) =>
    p.waitForFunction(() => [...document.querySelectorAll('[data-testid="zoom-stage"] img')].some((im) => im.complete && im.naturalWidth > 0), null, { timeout: 15_000 }).then(() => true, () => false);
  /** Skips until the round is over (a name first, from the suggestions). */
  async function playZoomRound(p, shoot) {
    await p.getByTestId("zoom-stage").waitFor();
    if (!(await stageLoaded(p))) errors.push("zoom reveal: the first crop didn't load");
    if (shoot) await p.screenshot({ path: `${OUT}/quiz-zoom-start.png` });
    const box = p.getByRole("combobox", { name: /Guess a Pokémon/ });
    await box.fill("Magikarp");
    await p.getByRole("option").first().waitFor();
    await box.press("Enter");
    for (let i = 0; i < 12 && !(await p.getByTestId("zoom-share-line").isVisible()); i++) {
      const skip = p.getByTestId("zoom-skip");
      if ((await skip.isVisible()) && (await skip.isEnabled())) await skip.click();
      await p.waitForTimeout(450);
    }
    const line = (await p.getByTestId("zoom-share-line").innerText()).trim();
    if (!/^(🔍){0,5}(✅ [1-6]\/6|❌ X\/6)$/u.test(line)) errors.push(`zoom reveal: odd share line "${line}"`);
    if (shoot) {
      await p.waitForTimeout(900);
      await p.screenshot({ path: `${OUT}/quiz-zoom-solved.png` });
    }
  }
  page.on("response", watch);
  await gotoSettled(page, `${BASE}/quiz/pokemon-zoom-quiz`);
  await page.getByTestId("zoom-daily").waitFor();
  await page.getByRole("button", { name: /^Start/ }).click();
  await playZoomRound(page, true);
  if (!steps.length && !(await page.getByText(/on step 1 of 6/).count())) errors.push("zoom reveal: no step ever zoomed out");
  if (steps.some((s, i) => s !== (steps[i - 1] ?? 1) + 1 && s !== 2)) errors.push(`zoom reveal: steps out of order: ${steps.join(",")}`);
  // The daily: one Pokémon, then its line stays on the card.
  await gotoSettled(page, `${BASE}/quiz/pokemon-zoom-quiz`);
  await page.getByTestId("zoom-daily-start").click();
  await playZoomRound(page, false);
  await page.getByRole("button", { name: /See results/ }).click();
  await page.getByTestId("zoom-daily-line").waitFor();
  await page.screenshot({ path: `${OUT}/quiz-zoom-daily.png` });
  page.off("response", watch);
  if (leaks.length) errors.push(`zoom reveal: ${leaks[0]}`);
}

// Whose Team Is This?: the team on show, a typed guess from the autocomplete. The question never carries the
// trainer, the appearance or the source; on Hard only the Pokémon revealed so far reach the browser.
async function playWhoseTeam(p, hard, shotTag) {
  const leaks = [];
  let reveals = 0;
  let fullTeams = 0;
  const watch = async (res) => {
    const path = new URL(res.url()).pathname;
    if (!/^\/api\/session(\/answer|\/next|\/reveal)?$/.test(path) || !res.ok()) return;
    const body = await res.json().catch(() => null);
    for (const q of [body?.question, body?.next]) {
      if (!q) continue;
      if (/"answer"|"explanation"|bulbapedia|fandom|appearance/i.test(JSON.stringify({ ...q, options: undefined }))) leaks.push(JSON.stringify(q).slice(0, 200));
      if (q.input !== "type") leaks.push(`not a typed question: ${JSON.stringify(q).slice(0, 120)}`);
      if (hard && (q.cards?.length !== 1 || q.reveal?.shown !== 1)) leaks.push(`hard question sent ${q.cards?.length} cards`);
      if (!hard && (q.reveal || (q.cards?.length ?? 0) < 2)) leaks.push(`normal question sent ${q.cards?.length} cards`);
    }
    if (path.endsWith("/reveal")) {
      reveals++;
      if (!body?.card || body.reveal?.shown < 2 || /"answer"|bulbapedia/i.test(JSON.stringify(body))) leaks.push(`reveal: ${JSON.stringify(body).slice(0, 200)}`);
    }
    if (path.endsWith("/answer") && body?.revealCards?.length >= 2) fullTeams++;
  };
  p.on("response", watch);
  await gotoSettled(p, `${BASE}/quiz/whose-team-is-this${hard ? "?difficulty=hard" : ""}`);
  await p.getByRole("button", { name: /^Start/ }).click();
  for (let i = 0; i < 3; i++) {
    const guess = p.getByTestId("team-guess");
    await guess.waitFor({ timeout: 15_000 });
    await p.locator("main ol img").first().waitFor();
    if (hard) {
      await p.getByTestId("team-reveal").click();
      await p.locator("main ol img").nth(1).waitFor({ timeout: 10_000 });
    }
    await guess.fill("cyn");
    await p.getByRole("option", { name: /Cynthia/ }).waitFor();
    if (i === 0) await p.screenshot({ path: `${OUT}/quiz-whose-team-${shotTag}.png` });
    await guess.press("Enter");
    await p.getByTestId("team-answer").waitFor({ timeout: 10_000 });
    await p.getByRole("link", { name: /Source: Bulbapedia/ }).waitFor({ timeout: 5_000 });
    if (i === 0) {
      await p.waitForTimeout(700);
      await p.screenshot({ path: `${OUT}/quiz-whose-team-${shotTag}-revealed.png` });
    }
    await p.getByRole("button", { name: /Next question|See results/ }).click();
  }
  p.off("response", watch);
  if (leaks.length) errors.push(`whose team (${shotTag}): ${leaks[0]}`);
  if (hard && reveals !== 3) errors.push(`whose team (hard): ${reveals}/3 reveals answered`);
  if (hard && fullTeams !== 3) errors.push(`whose team (hard): ${fullTeams}/3 answers showed the whole team`);
}
step("whose team is this?: three Normal rounds");
await playWhoseTeam(page, false, "normal");
step("whose team is this?: three Hard rounds, one reveal each");
await playWhoseTeam(page, true, "hard");

step("blitz format");
await gotoSettled(page, `${BASE}/quiz/pokemon-trivia-quiz?format=blitz`);
await page.getByRole("button", { name: /^Start/ }).click();
await page.waitForSelector("h2");
for (let i = 0; i < 3; i++) {
  await page.locator("main button:not([disabled])").first().click();
  await page.waitForTimeout(900);
}
await page.screenshot({ path: `${OUT}/blitz.png` });

step("pokédle");
await gotoSettled(page, `${BASE}/pokedle`);
await checkFirstVisitHowTo(page, "Pokédle");
await closeHowTo(page);
// The Pokédex beside the board gets only what its assist level shows: names, generations and types for the Notebook (the default).
const dexRows = await (await page.request.get(`${BASE}/api/pokedle/dex`)).json();
if (dexRows.length !== 1025 || dexRows.some((r) => r.length !== 5)) errors.push(`the Pokédex API sent more than names, generations and types: ${JSON.stringify(dexRows[0])}`);
for (const [assist, width] of [["notebook", 5], ["field", 7], ["full", 9]]) {
  const rows = await (await page.request.get(`${BASE}/api/pokedle/dex?assist=${assist}`)).json();
  if (rows.length !== 1025 || rows.some((r) => r.length !== width)) errors.push(`the ${assist} Pokédex sent the wrong columns: ${JSON.stringify(rows[0])}`);
}
if ((await page.request.get(`${BASE}/api/pokedle/dex?assist=off`)).status() !== 404) errors.push("assist off still got a Pokédex");
// The Pokédex is off by default, like Wordle: no notebook beside the board until the player turns it on.
if (await page.getByLabel("Search the Pokédex").count()) errors.push("Pokédle shows the Pokédex before it is turned on");
await page.getByRole("button", { name: "Settings", exact: true }).click();
await page.getByRole("radiogroup", { name: "Pokédex assist", exact: true }).getByRole("radio", { name: /^Off/, checked: true }).waitFor();
await page.getByRole("radiogroup", { name: "Pokédex assist", exact: true }).getByRole("radio", { name: /^Notebook/ }).click();
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
  await gotoSettled(page, `${BASE}/connections`);
  // PokéConnections' how-to opens by itself once: closing it any way ("Let's play!" too) keeps it closed on the next visit.
  {
    const sheet = page.locator(HOWTO).first();
    if (!(await sheet.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false))) errors.push("PokéConnections didn't auto-open its how-to on a first visit");
    else {
      if (!(await page.getByTestId("howto-demo").isVisible())) errors.push("PokéConnections' how-to has no demo");
      await page.getByTestId("howto-play").click();
      await sheet.waitFor({ state: "hidden" });
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("conn-tile").first().waitFor();
      await page.waitForTimeout(1500);
      if (await sheet.isVisible()) errors.push("PokéConnections' how-to opened again after \"Let's play!\"");
    }
    await closeHowTo(page);
  }
  await page.getByTestId("conn-tile").first().waitFor();
  if ((await page.getByTestId("conn-tile").count()) !== 16) errors.push("PokéConnections didn't show 16 tiles");
  // The whole board, its mistakes and its Submit fit a laptop screen without scrolling.
  {
    const submitBox = await page.getByTestId("conn-submit").boundingBox();
    if (!submitBox || submitBox.y + submitBox.height > 900) errors.push(`PokéConnections' Submit is below the fold at 1280×900 (y=${submitBox?.y})`);
  }
  // The keyboard hints, and S to shuffle.
  await page.getByTestId("conn-keys").waitFor();
  const order = async () => (await page.getByTestId("conn-tile").evaluateAll((els) => els.map((e) => e.dataset.id))).join();
  const before = await order();
  for (let i = 0; i < 3 && (await order()) === before; i++) {
    await page.keyboard.press("s");
    await page.waitForTimeout(300);
  }
  if ((await order()) === before) errors.push("S didn't shuffle the grid");
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
  await page.getByTestId("conn-deselect").click();
  for (const [i, g] of groups.entries()) {
    await pick(g);
    await page.locator("[data-testid=conn-group]").nth(i).waitFor();
  }
  await page.getByTestId("conn-result").waitFor();
  await page.getByTestId("conn-why").waitFor();
  if (!(await page.getByText("1/4").count())) errors.push("PokéConnections' result doesn't show one mistake");
  // Share: copied with a "Copied!" toast (or, where the clipboard is refused, the text to copy by hand), coloured rows and a link, never a name.
  {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    await page.getByTestId("conn-result").getByTestId("share-result").first().click();
    await page.getByTestId("share-toast").waitFor({ timeout: 5000 }).catch(() => errors.push("PokéConnections' Share showed no Copied! toast"));
    const text = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    const lines = text.split("\n");
    if (!/^PokéIQ PokéConnections #\d+ /.test(lines[0] ?? "")) errors.push(`PokéConnections' share text starts "${lines[0]}"`);
    if (lines.filter((l) => /^[🟨🟩🟦🟪]{4}$/u.test(l)).length !== 5) errors.push(`PokéConnections' share text hasn't five rows of squares: ${JSON.stringify(text)}`);
    if (!/\/s\/con\./.test(lines.at(-1) ?? "")) errors.push("PokéConnections' share text has no link");  }
  await page.getByTestId("conn-community").waitFor({ timeout: 10_000 }).catch(() => errors.push("PokéConnections' daily stats didn't show"));
  // The streak flame, tomorrow's countdown, and the first-solve badge.
  await page.getByTestId("conn-streak").filter({ hasText: "1 day" }).waitFor();
  await page.getByTestId("conn-tomorrow").filter({ hasText: /Come back tomorrow for #\d+/ }).waitFor();
  await page.getByTestId("conn-badges").filter({ hasText: "Connected" }).waitFor();
  // Today's leaderboard: a trainer without a name (or with one already taken today) is asked for one, then ranked.
  const board = page.getByTestId("conn-board");
  await board.waitFor({ timeout: 10_000 });
  const placed = board.getByTestId("conn-board-place");
  const boardName = `Linker ${Date.now() % 100_000}`;
  if (!(await placed.waitFor({ timeout: 3_000 }).then(() => true, () => false))) {
    await board.getByLabel(/trainer name|Pick another/).fill(boardName);
    await board.getByRole("button", { name: "Rank me" }).click();
    await placed.waitFor({ timeout: 10_000 });
  }
  if (!/You're #\d+ of \d+ today/.test(await placed.innerText())) errors.push(`the PokéConnections board place reads "${await placed.innerText()}"`);
  const rankedAs = await board.locator("li.font-semibold span.truncate").first().innerText().catch(() => null);
  if (!rankedAs) errors.push("your row isn't highlighted on today's PokéConnections board");
  // The board takes no time from the client: the entry's time is the server's.
  const forged = await page.request.post(`${BASE}/api/connections/result`, { data: { date: today, player: "e2e-forged-player-0001", guesses: groups, start: "eyJkIjoiMjAyNi0wMS0wMSIsInQiOjB9.bad", name: "Forger" } });
  if ((await forged.json()).board?.unranked !== "untimed") errors.push("a forged start token got onto the board");
  await page.screenshot({ path: `${OUT}/connections.png`, fullPage: true });
  await board.screenshot({ path: `${OUT}/conn-board.png` });
  // A reload restores the finished game.
  await page.reload({ waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
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
  // A clean solve: the celebration, and the Hard-mode badge.
  await page.getByTestId("conn-perfect").waitFor();
  await page.getByTestId("conn-badges").filter({ hasText: "Hard Wired" }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/conn-perfect.png` });
  await page.screenshot({ path: `${OUT}/conn-unlimited-result.png`, fullPage: true });
  const nextTiles = page.waitForResponse((r) => /\/api\/connections\?practice=hard-/.test(r.url()));
  await page.getByTestId("conn-next").click();
  const next = await (await nextTiles).json();
  if (next.key === hard.key) errors.push("Next puzzle gave the same puzzle");
  await page.getByTestId("conn-tile").nth(15).waitFor();
  await page.screenshot({ path: `${OUT}/conn-unlimited.png` });

  // Unlimited 5×5: the size toggle, twenty-five tiles, five groups of five and five mistakes, solved from the data alone.
  step("pokéconnections: an Unlimited 5×5 game, solved to the end");
  const size5 = page.waitForResponse((r) => /\/api\/connections\?practice=s5-/.test(r.url()));
  await page.getByTestId("conn-size-5").click();
  const big = await (await size5).json();
  if (big.size !== 5 || big.tiles.length !== 25) errors.push(`the 5×5 puzzle came as size ${big.size} with ${big.tiles.length} tiles`);
  if (/label|members|category|reveal/.test(JSON.stringify(big))) errors.push("the 5×5 puzzle's tiles came with the groups");
  await page.getByTestId("conn-tile").nth(24).waitFor();
  if ((await page.getByTestId("conn-tile").count()) !== 25) errors.push("PokéConnections 5×5 didn't show 25 tiles");
  if ((await page.getByTestId("conn-grid").getAttribute("data-size")) !== "5") errors.push("the 5×5 grid isn't marked size 5");
  await page.getByLabel("5 of 5 mistakes left").waitFor();
  // The server rejects a four-tile guess on a 5×5 board, and a five-tile guess on a 4×4 one.
  const bad5 = await page.request.post(`${BASE}/api/connections`, { data: { practice: big.key.replace("practice:", ""), guesses: [big.tiles.slice(0, 4).map((t) => t.id)] } });
  if (bad5.status() !== 400) errors.push(`a four-tile guess on a 5×5 board returned ${bad5.status()}`);
  const bad4 = await page.request.post(`${BASE}/api/connections`, { data: { practice: next.key.replace("practice:", ""), guesses: [big.tiles.slice(0, 5).map((t) => t.id)] } });
  if (bad4.status() !== 400) errors.push(`a five-tile guess on a 4×4 board returned ${bad4.status()}`);
  const bigIds = big.tiles.map((t) => String(t.id));
  const [big5] = JSON.parse(execFileSync("npx", ["tsx", "scripts/connections-solve.ts", ...bigIds], { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname }));
  if (big5?.length !== 5 || big5.some((g) => g.length !== 5)) throw new Error(`no 5×5 solution for ${bigIds}`);
  // One away (four of one group and one of another), then two groups, and the board mid-game.
  await pick([...big5[0].slice(0, 4), big5[1][0]]);
  await page.getByTestId("conn-toast").filter({ hasText: "One away…" }).waitFor();
  await page.getByLabel("4 of 5 mistakes left").waitFor();
  await page.getByTestId("conn-deselect").click();
  for (const [i, g] of big5.slice(0, 2).entries()) {
    await pick(g);
    await page.locator("[data-testid=conn-group]").nth(i).waitFor();
  }
  await page.waitForTimeout(500);
  // The whole board in one frame: tall viewport, top of the page.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/conn-5x5.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [i, g] of big5.slice(2).entries()) {
    await pick(g);
    await page.locator("[data-testid=conn-group]").nth(i + 2).waitFor();
  }
  await page.getByTestId("conn-result").waitFor();
  if (!(await page.getByTestId("conn-result").getByText("1/5", { exact: true }).count())) errors.push("the 5×5 result doesn't show one of five mistakes");
  if (!(await page.getByTestId("conn-result").getByText("You found all five groups.").count())) errors.push("the 5×5 result doesn't say all five groups");
  if ((await page.locator("[data-testid=conn-group]").count()) !== 5) errors.push("the 5×5 result doesn't show five groups");
  await page.screenshot({ path: `${OUT}/conn-5x5-result.png`, fullPage: true });
  // The size is remembered: Unlimited opens 5×5 after a reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  const again5 = page.waitForResponse((r) => /\/api\/connections\?practice=s5-/.test(r.url()));
  await page.getByRole("radio", { name: "Unlimited" }).click();
  await again5;
  await page.getByRole("radio", { name: "5×5", checked: true }).waitFor();
  // Back to 4×4 for the rest of the run.
  const back4 = page.waitForResponse((r) => /\/api\/connections\?practice=(hard|easy|normal)-/.test(r.url()));
  await page.getByTestId("conn-size-4").click();
  await back4;

  // The board on /leaderboard, and PokéConnections on the trainer card.
  await gotoSettled(page, `${BASE}/leaderboard?board=connections&date=${today}`);
  await page.getByTestId("leaderboard-connections").getByText(rankedAs ?? boardName, { exact: true }).waitFor();
  await page.screenshot({ path: `${OUT}/conn-leaderboard.png` });
  await gotoSettled(page, `${BASE}/trainer`);
  const card = page.getByTestId("trainer-connections");
  await card.waitFor();
  if (!/Games won/.test(await card.innerText())) errors.push("the trainer card has no PokéConnections games won");
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/conn-trainer.png` });
}

step("pikadoku: a full daily (9 PP, one wrong guess), the score and the answers reveal");
{
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  // The solver is built from the data; the browser never gets the answers before the end.
  const solved = JSON.parse(execFileSync("npx", ["tsx", "scripts/pikadoku-solve.ts", today, "normal"], { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname }));
  const gridRes = await (await page.request.get(`${BASE}/api/pikadoku?date=${today}&difficulty=normal`)).text();
  if (/answers|members|"ids"/.test(gridRes)) errors.push("Pikadoku's grid came with answers");
  await gotoSettled(page, `${BASE}/pikadoku`);
  await checkFirstVisitHowTo(page, "Pikadoku");
  await closeHowTo(page);
  await page.getByTestId("pdk-row-0").waitFor();
  await page.getByTestId("pdk-cell-0").waitFor();
  const label = async (id) => (await page.getByTestId(id).innerText()).trim();
  if (!(await label("pdk-row-0")) || (await label("pdk-row-0")) === "…") errors.push("Pikadoku's row category didn't load");
  const play = async (cell, name, id) => {
    await page.getByTestId(`pdk-cell-${cell}`).click();
    await page.getByTestId("pdk-search").fill(name);
    await page.getByTestId(`pdk-option-${id}`).click();
  };
  // The search forgives case and punctuation: the wrong guess is typed loosely.
  await play(solved.wrong.cell, solved.wrong.name.toLowerCase().replace(/[^a-z0-9]/g, ""), solved.wrong.id);
  await page.getByTestId("pdk-toast").filter({ hasText: "doesn't fit" }).waitFor();
  if (!/8/.test(await page.getByTestId("pdk-pp").innerText())) errors.push("a wrong Pikadoku guess didn't use a PP");
  // 9 PP and one is spent: eight right answers end the game at 8 of 9.
  for (const { cell, id, name } of solved.solution.slice(0, 8)) await play(cell, name, id);
  await page.getByTestId("pdk-result").waitFor({ timeout: 15_000 });
  if (!/8 of 9 cells/i.test(await page.getByTestId("pdk-result").innerText())) errors.push("Pikadoku's result doesn't show 8 of 9 cells");
  await page.getByTestId("pdk-score").waitFor();
  await page.getByTestId("pdk-reveal").waitFor();
  if ((await page.getByTestId("pdk-misses").count()) !== 1) errors.push("Pikadoku's reveal doesn't explain the miss");
  if (!(await page.getByTestId("pdk-reveal-0").innerText()).includes("valid")) errors.push("Pikadoku's reveal doesn't list the cell's answers");
  if (!(await page.getByTestId("pdk-countdown").isVisible())) errors.push("Pikadoku's result has no next-puzzle countdown");
  if ((await page.getByTestId("pdk-rarity-preview").count()) !== 1) errors.push("Pikadoku's result doesn't preview the share colours");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("pdk-result").getByTestId("share-result").click();
  await page.getByTestId("share-toast").waitFor();
  const pdkShare = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  if (!/^PokéIQ Pikadoku #\d+ 8\/9\n/.test(pdkShare) || !/\/s\/pdk\./.test(pdkShare)) errors.push(`Pikadoku's share text is off: ${JSON.stringify(pdkShare)}`);
  await page.screenshot({ path: `${OUT}/pikadoku-result.png`, fullPage: true });
  // The server plays the guesses again: a forged, unfinished game gets no reveal.
  const early = await page.request.post(`${BASE}/api/pikadoku/result`, { data: { date: today, difficulty: "normal", player: "e2e-pdk-forged-player-1", guesses: [] } });
  if (early.status() !== 409) errors.push(`Pikadoku revealed answers for an unfinished game (${early.status()})`);
}

step("the PokéIQ Test: five sections end to end, desktop and phone");
await runIqTest({ newPage, BASE, OUT, errors });

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
    if (i === 0) {
      // The real spot: its name, its game, and a link to it on the World Atlas.
      if (!(await page.getByTestId("geo-answer-place").innerText()).trim()) throw new Error("the reveal names no place");
      if (!/Pokémon /.test(await page.getByTestId("geo-answer-game").innerText())) throw new Error("the reveal names no game");
      if (!/^\/atlas\?q=/.test((await page.getByTestId("geo-atlas-link").getAttribute("href")) ?? "")) throw new Error("no World Atlas link on the reveal");
      await page.screenshot({ path: `${OUT}/guessr-reveal.png` });
    }
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
await gotoSettled(page, `${BASE}/guessr`);
await checkFirstVisitHowTo(page, "PokéGuessr");
await closeHowTo(page);
await page.screenshot({ path: `${OUT}/guessr-setup.png`, fullPage: true });
await page.getByRole("button", { name: /5-round game/ }).click();
await playGeoRounds(5);
await page.getByText("Survey complete").waitFor();
await page.getByRole("button", { name: /Challenge a friend/ }).waitFor();
await page.screenshot({ path: `${OUT}/guessr-summary.png`, fullPage: true });
if (!geoChallenge) throw new Error("no PokéGuessr challenge token");

step("pokéguessr: one screenshot per round (no flipping between views)");
await gotoSettled(page, `${BASE}/guessr`);
await page.getByRole("button", { name: /5-round game/ }).click();
for (let i = 0; i < 5; i++) {
  await page.waitForFunction(() => {
    const img = document.querySelector("img[data-testid='geo-shot']");
    return img?.complete && img.naturalWidth > 0;
  });
  if (i === 0) {
    const fit = await page.evaluate(() => {
      const img = document.querySelector("img[data-testid='geo-shot']");
      const a = img.getBoundingClientRect();
      const f = img.parentElement.getBoundingClientRect();
      return { objectFit: img.dataset.fit === "tall" ? "cover" : getComputedStyle(img).objectFit, d: [a.x - f.x, a.y - f.y, a.width - f.width, a.height - f.height] };
    });
    if (fit.objectFit !== "cover") throw new Error(`round image object-fit is ${fit.objectFit}, not cover`);
    if (fit.d.some((n) => Math.abs(n) > 2)) throw new Error(`round image doesn't fill its frame: ${fit.d}`);
    await page.getByTestId("geo-fullscreen").click();
    await page.locator("[data-testid=geo-shell][data-fullscreen=true]").waitFor();
    const vp = await page.evaluate(() => {
      const r = document.querySelector("img[data-testid='geo-shot']").getBoundingClientRect();
      const sh = document.querySelector("[data-testid=geo-shell]").getBoundingClientRect();
      return [r.width - sh.width, r.height - sh.height];
    });
    if (vp.some((n) => Math.abs(n) > 2)) throw new Error(`full-screen image doesn't fill the screen: ${vp}`);
    await page.screenshot({ path: `${OUT}/geo-fullscreen-mode.png` });
    await page.getByTestId("geo-fullscreen").click();
    await page.locator("[data-testid=geo-shell]:not([data-fullscreen])").waitFor();
  }
  if (await page.getByTestId("geo-view-count").count()) throw new Error("a round offers more than one screenshot");
  if (await page.getByRole("button", { name: "Next view" }).count()) throw new Error("a round has a next-view button");
  const map = page.locator("[role=application]");
  await map.hover();
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await page.getByRole("button", { name: /^Guess$/ }).click();
  const next = page.getByRole("button", { name: /Next round|View summary|See results/ });
  await next.waitFor();
  await next.click();
}

step("pokéguessr: zoomed, 30s timer (time runs out with no pin)");
await gotoSettled(page, `${BASE}/guessr`);
await page.getByTestId("geo-settings").click();
await page.getByTestId("geo-zoomed").click();
await page.getByTestId("geo-timer-30").click();
await page.getByTestId("geo-settings-badge").filter({ hasText: "Zoomed · 30s" }).waitFor();
await page.keyboard.press("Escape");
await page.getByRole("button", { name: /5-round game/ }).click();
await page.waitForFunction(() => {
  const img = document.querySelector("img[data-testid='geo-shot']");
  return img?.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity === "1";
});
if ((await page.getByTestId("geo-shot").getAttribute("data-zoomed")) !== "true") throw new Error("the screenshot isn't zoomed");
{
  // The countdown pill reads m:ss.
  const [, m, s] = (await page.getByTestId("geo-time-left").innerText()).match(/(\d+):(\d\d)/) ?? [];
  const left = Number(m) * 60 + Number(s);
  if (!(left > 20 && left <= 30)) throw new Error(`timer shows ${left}`);
}
await page.screenshot({ path: `${OUT}/geo-mode-zoom-timer.png` });
await page.getByTestId("geo-distance").filter({ hasText: "Time's up" }).waitFor({ timeout: 40_000 });
await page.screenshot({ path: `${OUT}/geo-mode-timer-up.png` });
// Back to the defaults, so the steps after this play the usual way.
await gotoSettled(page, `${BASE}/guessr`);
await page.getByTestId("geo-settings").click();
await page.getByTestId("geo-zoomed").click();
await page.getByTestId("geo-timer-0").click();
if (await page.getByTestId("geo-settings-badge").count()) throw new Error("settings didn't switch off");
await page.keyboard.press("Escape");

step("pokéguessr: friend accepts the challenge");
await gotoSettled(page, `${BASE}/guessr/c/${encodeURIComponent(geoChallenge)}`);
await page.getByRole("button", { name: /Accept challenge/ }).click();
await playGeoRounds(5);
await page.getByText(/You beat|wins this one|Dead heat/).waitFor();
await page.screenshot({ path: `${OUT}/guessr-challenge-result.png`, fullPage: true });

step("pokéguessr: 3-round game (picked rounds)");
await gotoSettled(page, `${BASE}/guessr`);
if ((await page.getByTestId("geo-rounds-5").getAttribute("aria-checked")) !== "true") throw new Error("5 rounds should be the default");
await page.getByTestId("geo-rounds-3").click();
await page.getByRole("button", { name: /3-round game/ }).click();
let geoPlayed = 0;
const countGuess = (res) => {
  if (res.url().endsWith("/api/geo/guess") && res.ok()) geoPlayed++;
};
page.on("response", countGuess);
await playGeoRounds(3);
await page.getByText("Survey complete").waitFor();
page.off("response", countGuess);
if (geoPlayed !== 3) throw new Error(`a 3-round game took ${geoPlayed} guesses`);
await page.getByText(/out of 15,000/).waitFor();
await page.screenshot({ path: `${OUT}/guessr-3-round-summary.png`, fullPage: true });

step("pokéguessr: Hard game is practice, with a Wordle-style result card to copy");
await gotoSettled(page, `${BASE}/guessr`);
if ((await page.getByTestId("geo-difficulty-normal").getAttribute("aria-checked")) !== "true") throw new Error("Normal should be the default difficulty");
await page.getByTestId("geo-difficulty-hard").click();
await page.getByTestId("geo-difficulty-blurb").filter({ hasText: "Practice" }).waitFor();
let hardStart = null;
const readStart = async (res) => {
  if (res.url().endsWith("/api/geo") && res.request().method() === "POST" && res.ok()) hardStart = await res.json().catch(() => null);
};
page.on("response", readStart);
await page.getByRole("button", { name: /5-round game/ }).click();
await page.getByText(/· Hard/).first().waitFor();
await playGeoRounds(5);
page.off("response", readStart);
if (hardStart?.practice !== "difficulty") throw new Error(`a Hard game should be practice, got ${hardStart?.practice}`);
await page.getByText("Survey complete").waitFor();
await page.getByText(/Easy and Hard games are practice/).waitFor();
const geoCard = await page.getByTestId("geo-share-preview").innerText();
if (!/PokéGuessr .*· Hard/.test(geoCard) || !/[🟩🟨🟧🟥]{5}/u.test(geoCard)) throw new Error(`result card looks wrong: ${geoCard}`);
await page.getByTestId("geo-copy-result").click();
await page.getByTestId("geo-share-card").filter({ hasText: /Copied!|Couldn.t copy/ }).waitFor();
await page.screenshot({ path: `${OUT}/guessr-hard-summary.png`, fullPage: true });

step("pokéguessr: world globe card opens the 3D globe (canvas, or the no-WebGL fallback)");
await gotoSettled(page, `${BASE}/guessr`);
await page.getByTestId("globe-card").getByRole("link", { name: "Open the globe" }).click();
await page.waitForURL(/\/guessr\/globe$/);
await page.getByTestId("world-globe").waitFor();
await page.locator('[data-testid="world-globe"] canvas, [data-testid="globe-fallback"]').first().waitFor({ state: "attached", timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/guessr-globe.png` });

step("world globe: skip the intro, the era filter, a region's card, a town's screenshot on hover, sound stays off when muted");
{
  // A first visit with the site's sound off; count every AudioContext the page creates.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    localStorage.setItem("pokeiq-muted", "1");
    window.__audioContexts = 0;
    const Real = window.AudioContext;
    if (Real) window.AudioContext = class extends Real { constructor(...a) { super(...a); window.__audioContexts++; } };
  });
  const gp = await context.newPage();
  gp.on("pageerror", (err) => errors.push(`[${gp.url()}] PAGEERROR: ${err.message}`));
  await gp.goto(`${BASE}/guessr/globe`, { waitUntil: "domcontentloaded" });
  await gp.locator('[data-testid="world-globe"][data-state="ready"], [data-testid="globe-fallback"]').first().waitFor({ timeout: 60_000 });
  if (!(await gp.getByTestId("globe-fallback").count())) {
    const ok = (p) => p.then(() => true, () => false);
    // The fly-in from space plays on a first visit; a click skips it.
    const intro = gp.getByTestId("globe-intro");
    if (!(await ok(intro.waitFor({ timeout: 10_000 })))) errors.push("globe: the intro didn't play on a first visit");
    else {
      await intro.click();
      if (!(await ok(intro.waitFor({ state: "detached", timeout: 10_000 })))) errors.push("globe: clicking didn't skip the intro");
    }
    // Era filter: Generation I is Kanto alone; IX brings the whole world back.
    await gp.getByTestId("globe-era-1").click();
    if (!/kanto/i.test(await gp.getByTestId("globe-era-caption").innerText())) errors.push("globe: the Gen I caption doesn't name Kanto");
    const othersGone = () => gp.waitForFunction(() => [...document.querySelectorAll(".gl-lb.region")].every((e) => e.textContent === "Kanto" || Number(e.style.opacity || 0) < 0.05), null, { timeout: 20_000 });
    if (!(await ok(othersGone()))) errors.push("globe: regions from later generations still show at Gen I");
    await gp.screenshot({ path: `${OUT}/globe-gen1.png` });
    await gp.getByTestId("globe-era-9").click();
    if ((await gp.getByTestId("world-globe").getAttribute("data-era")) !== "9") errors.push("globe: Gen IX didn't select");
    // A region's card: Next region flies there and opens it, with its links.
    await gp.getByRole("button", { name: "Next region" }).click();
    const card = gp.getByTestId("globe-region-card");
    if (!(await ok(card.waitFor({ timeout: 15_000 })))) errors.push("globe: flying to a region didn't open its card");
    else {
      if (!/^\/guessr\?region=[a-z]+$/.test((await gp.getByTestId("globe-region-play").getAttribute("href")) ?? "")) errors.push("globe: the card's Play link isn't a region's PokéGuessr map");
      if (!/^\/pokedex\/places\?region=/.test((await gp.getByTestId("globe-region-dex").getAttribute("href")) ?? "")) errors.push("globe: the card's Pokédex link isn't the region's places");
      if (!(await gp.getByTestId("globe-region-starters").locator("li").count())) errors.push("globe: the card has no starters");
    }
    // Hover a town: its screenshot pops up, served under a preview name (never a round's /api/geo/shot/ id).
    await gp.mouse.move(200, 300);
    const target = await gp
      .waitForFunction(() => {
        const W = window.innerWidth;
        const el = [...document.querySelectorAll('.gl-lb[data-shot="1"]')].find((e) => {
          const r = e.getBoundingClientRect();
          return Number(e.style.opacity || 0) > 0.6 && r.right < W - 420 && r.left > 20 && r.top > 160 && r.bottom < 700;
        });
        if (!el) return null;
        // Only once the flight has settled: the label stays put between two polls.
        const r = el.getBoundingClientRect();
        const was = window.__globeLabel;
        window.__globeLabel = { k: el.dataset.key, x: r.left, y: r.top };
        if (!was || was.k !== el.dataset.key || Math.abs(was.x - r.left) > 0.5 || Math.abs(was.y - r.top) > 0.5) return null;
        return { x: r.left + Math.min(r.width / 2, 30), y: r.top + r.height / 2 };
      }, null, { timeout: 30_000, polling: 400 })
      .then((h) => h.jsonValue(), () => null);
    if (!target) errors.push("globe: no town label with a screenshot to hover");
    else {
      await gp.mouse.move(target.x, target.y, { steps: 4 });
      if (!(await ok(gp.getByTestId("globe-shot-card").waitFor({ timeout: 10_000 })))) errors.push("globe: hovering a town didn't show its screenshot");
      else {
        const src = (await gp.getByTestId("globe-shot-img").getAttribute("src")) ?? "";
        if (!/^\/api\/geo\/preview\/[A-Za-z0-9_-]+$/.test(src)) errors.push(`globe: the hover picture isn't a preview (${src})`);
        await gp.waitForFunction(() => document.querySelector('[data-testid="globe-shot-img"]')?.naturalWidth > 0, null, { timeout: 15_000 }).catch(() => {});
        await gp.screenshot({ path: `${OUT}/globe-hover.png` });
      }
    }
    // All that with the site's sound off: not one AudioContext.
    const made = await gp.evaluate(() => window.__audioContexts);
    if (made !== 0) errors.push(`globe: ${made} AudioContext(s) started with the site's sound off`);
    // The globe's own switch turns the site's sound on; the next press starts the globe's audio.
    await gp.getByTestId("globe-sound").click();
    if ((await gp.evaluate(() => localStorage.getItem("pokeiq-muted"))) !== "0") errors.push("globe: its sound switch didn't turn the site's sound on");
    await gp.mouse.click(300, 450);
    if (!(await ok(gp.waitForFunction(() => window.__audioContexts > 0, null, { timeout: 10_000 })))) errors.push("globe: no audio started with the sound on");
    await gp.getByTestId("globe-sound").click();
  }
  await context.close();
}

step("pokéguessr: streak");
await gotoSettled(page, `${BASE}/guessr`);
await page.getByRole("button", { name: /Streak/ }).click();
await playGeoRounds(60);
await page.getByText("Streak over").first().waitFor();

step("pokéguessr: a region's own map");
await gotoSettled(page, `${BASE}/guessr?region=johto`);
await page.getByRole("radio", { name: "Johto", checked: true }).waitFor();
await page.getByRole("button", { name: /5-round game/ }).click();
await playGeoRounds(5);
await page.getByText("Survey complete").waitFor();

step("pokéguessr: a themed map (Towns and Cities), its own leaderboard");
await gotoSettled(page, `${BASE}/guessr`);
await page.getByRole("radiogroup", { name: "Themed map" }).getByRole("radio", { name: "Towns and Cities" }).click();
await page.getByTestId("geo-theme-blurb").filter({ hasText: "Every town and city" }).waitFor();
if (!page.url().includes("region=theme-towns")) throw new Error(`themed map not in the URL: ${page.url()}`);
await page.screenshot({ path: `${OUT}/geo-mode-themed-maps.png`, fullPage: true });
await page.getByRole("button", { name: /5-round game/ }).click();
await page.getByText("Towns and Cities").first().waitFor();
await playGeoRounds(5);
await page.getByText("Survey complete").waitFor();
await gotoSettled(page, `${BASE}/leaderboard?board=geo&format=theme-towns`);
await page.getByText("Towns and Cities 5 rounds").waitFor();
await page.getByText("Towns and Cities Streak").waitFor();

step("pokéguessr: Classic 2D, report a screenshot");
await gotoSettled(page, `${BASE}/guessr?region=kalos`);
// Kalos has no sprite games: Classic 2D is off there, and says why.
if (!(await page.getByTestId("geo-era-2d").isDisabled())) throw new Error("Classic 2D should be off on the Kalos map");
await gotoSettled(page, `${BASE}/guessr?region=kanto`);
await page.getByTestId("geo-era-2d").click();
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
  await page.getByRole("button", { name: /^Guess$/ }).click();
  await page.getByRole("button", { name: /Next round|View summary/ }).waitFor();
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
await page.screenshot({ path: `${OUT}/guessr-2d-summary.png`, fullPage: true });
await page.getByRole("button", { name: /Play again/ }).click();
if (await page.getByTestId("geo-guess-game").count()) errors.push("PokéGuessr still offers Guess the game too");
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
await gotoSettled(red, `${BASE}/guessr?region=kanto`);
await closeHowTo(red);
await red.getByLabel("Your trainer name").fill("Red");
await clickUntilUrl(red, red.getByRole("button", { name: /Create duel/ }), /\/guessr\/duel\/[a-z2-9]{8}$/);
const duelUrl = red.url();
await red.getByText("Waiting for a challenger").waitFor();
await red.screenshot({ path: `${OUT}/duel-lobby.png` });
const duelOg = await red.request.get(`${duelUrl}/opengraph-image`);
if (duelOg.status() !== 200) errors.push(`duel OG image returned ${duelOg.status()}`);
else fs.writeFileSync(`${OUT}/duel-og.png`, await duelOg.body());

await gotoSettled(blue, duelUrl);
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

step("pokéguessr duel: 3-round points race to the end, rematch keeps the settings");
await gotoSettled(red, `${BASE}/guessr?region=kanto`);
await closeHowTo(red);
await red.getByTestId("geo-duel-mode-race").click();
await red.getByTestId("geo-duel-rounds-3").click();
await red.getByLabel("Your trainer name").fill("Red");
await clickUntilUrl(red, red.getByRole("button", { name: /Create duel/ }), /\/guessr\/duel\/[a-z2-9]{8}$/);
const raceUrl = red.url();
await red.getByText("Waiting for a challenger").waitFor();
await gotoSettled(blue, raceUrl);
// The joiner sees the mode and rounds before accepting.
await blue.getByText(/Red challenges you to a 3-round points race/).waitFor();
await blue.getByLabel("Your trainer name").fill("Blue");
await blue.getByRole("button", { name: /Join duel/ }).click();
await red.getByText("Blue").first().waitFor();
await Promise.all([red, blue].map((p) => p.getByRole("button", { name: /^Ready$/ }).click()));
const [raceRounds] = await Promise.all([playDuel(red, 0.5, false), playDuel(blue, 0.22, false)]);
if (raceRounds !== 3) throw new Error(`the 3-round race lasted ${raceRounds} rounds`);
await red.getByText(/Victory!|Defeat|Draw/).first().waitFor();
await blue.getByText(/Victory!|Defeat|Draw/).first().waitFor();
await red.getByText(/points/).first().waitFor();
await red.screenshot({ path: `${OUT}/duel-race-summary.png`, fullPage: true });
await red.getByRole("button", { name: /^Rematch$/ }).click();
await red.waitForURL((url) => url.href !== raceUrl && url.pathname.startsWith("/guessr/duel/"));
await blue.getByRole("button", { name: /Accept rematch/ }).click();
await blue.waitForURL(red.url());
await Promise.all([shotLoaded(red), shotLoaded(blue)]);
await red.getByText(/Round 1\/3/).first().waitFor();
await red.getByRole("button", { name: /Leave duel/ }).click();
await red.getByRole("button", { name: /^Forfeit$/ }).click();
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
await gotoSettled(dleRed.p, `${BASE}/pokedle`);
await closeHowTo(dleRed.p);
await dleRed.p.getByLabel("Your trainer name").fill("Red");
await clickUntilUrl(dleRed.p, dleRed.p.getByRole("button", { name: /Create duel/ }), /\/pokedle\/duel\/[a-z2-9]{8}$/);
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

await gotoSettled(dleBlue.p, dleUrl);
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
  await gotoSettled(red, `${BASE}/connections`);
  await closeHowTo(red);
  await red.getByText("Head to head · PokéConnections").waitFor();
  await red.locator("#duel").getByLabel("Your trainer name").fill("Red");
  await clickUntilUrl(red, red.getByRole("button", { name: /Create duel/ }), /\/connections\/duel\/[a-z2-9]{8}$/);
  const raceUrl = red.url();
  await red.getByText("Waiting for a challenger").waitFor();
  await red.screenshot({ path: `${OUT}/conn-duel-lobby.png` });
  const og = await red.request.get(`${raceUrl}/opengraph-image`);
  if (og.status() !== 200) errors.push(`PokéConnections duel OG image returned ${og.status()}`);
  else fs.writeFileSync(`${OUT}/conn-duel-og.png`, await og.body());

  await gotoSettled(blue, raceUrl);
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
    // The race may still be arming: wait until Submit takes the four picks.
    const submit = p.getByTestId("conn-submit");
    await submit.waitFor();
    for (let i = 0; i < 20 && (await submit.isDisabled()); i++) await p.waitForTimeout(250);
    await submit.click();
  };

  // Blue: one away, then a plain miss. The toast is brief, so the lasting proof is the mistake count.
  const oneAway = blue.getByTestId("conn-toast").filter({ hasText: "One away…" }).waitFor({ timeout: 8_000 }).then(() => true, () => false);
  await pick(blue, [...groups[0].slice(0, 3), groups[1][0]]);
  await blue.getByLabel("3 of 4 mistakes left").waitFor();
  if (!(await oneAway)) errors.push("the duel didn't say One away… for three of a group");
  await blue.screenshot({ path: `${OUT}/conn-duel-oneaway.png` });
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

// A 5×5 PokéConnections race: the creator picks the size, the joiner sees it, the rematch keeps it.
step("pokéconnections 5×5 duel: create, join, race, rematch");
{
  const race = [];
  for (const name of ["Red", "Blue"]) race.push(await newPage({ width: 1280, height: 900 }));
  const [red, blue] = race;
  await gotoSettled(red, `${BASE}/connections`);
  await closeHowTo(red);
  await red.getByText("Head to head · PokéConnections").waitFor();
  await red.getByTestId("conn-duel-size-5").click();
  await red.locator("#duel").getByLabel("Your trainer name").fill("Red");
  const created = red.waitForResponse((r) => r.url().endsWith("/api/duel") && r.request().method() === "POST");
  await red.getByRole("button", { name: /Create duel/ }).click();
  const made = await (await created).json();
  if (made.view?.size !== 5) errors.push(`the 5×5 duel was created as size ${made.view?.size}`);
  await red.waitForURL(/\/connections\/duel\/[a-z2-9]{8}$/);
  const raceUrl = red.url();
  await red.getByText("Waiting for a challenger").waitFor();
  await gotoSettled(blue, raceUrl);
  await blue.getByText("Red challenges you to a 5×5 board!").waitFor();
  await blue.getByLabel("Your trainer name").fill("Blue");
  await blue.getByRole("button", { name: /Join duel/ }).click();
  await red.getByText("Blue").first().waitFor();
  await Promise.all(race.map((p) => p.getByRole("button", { name: /^Ready$/ }).click()));
  await Promise.all(race.map((p) => p.getByTestId("conn-tile").nth(24).waitFor({ timeout: 20_000 })));
  for (const p of race) if ((await p.getByTestId("conn-tile").count()) !== 25) errors.push("a 5×5 duel board didn't show 25 tiles");
  const ids25 = (await red.getByTestId("conn-tile").evaluateAll((els) => els.map((e) => Number(e.dataset.id)))).sort((a, b) => a - b);
  const [groups5] = JSON.parse(execFileSync("npx", ["tsx", "scripts/connections-solve.ts", ...ids25.map(String)], { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname }));
  if (!groups5 || groups5.length !== 5) throw new Error(`no solution for the 5×5 duel's grid ${ids25}`);
  const pick5 = async (p, five) => {
    for (const id of five) await p.locator(`[data-testid=conn-tile][data-id="${id}"]`).click();
    await p.getByTestId("conn-submit").click();
  };
  // Blue misses once (five mistakes allowed), Red solves it cleanly.
  await pick5(blue, [...groups5[0].slice(0, 3), groups5[1][0], groups5[1][1]]);
  await blue.getByLabel("4 of 5 mistakes left").waitFor();
  for (const g of groups5) {
    await pick5(red, g);
    await red.waitForTimeout(400);
  }
  await Promise.all(race.map((p) => p.getByTestId("conn-duel-result").waitFor({ timeout: 15_000 })));
  await red.getByText("Victory!").waitFor();
  await blue.getByText("Red found all five groups first.").waitFor();
  await red.getByRole("button", { name: /^Rematch$/ }).click();
  await red.waitForURL((url) => url.href !== raceUrl && url.pathname.startsWith("/connections/duel/"));
  await blue.getByRole("button", { name: /Accept rematch/ }).click();
  await blue.waitForURL(red.url());
  await Promise.all(race.map((p) => p.getByTestId("conn-tile").nth(24).waitFor({ timeout: 20_000 })));
  if ((await red.getByTestId("conn-tile").count()) !== 25) errors.push("the 5×5 duel's rematch isn't 5×5");
  await red.screenshot({ path: `${OUT}/conn-duel-5x5.png` });
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
await gotoSettled(quizRed.p, `${BASE}/quiz/pokemon-games-quiz`);
if (await quizRed.p.getByRole("group", { name: "Duel difficulty" }).count()) errors.push("quiz duel: Mainline Games still offers a difficulty");
await quizRed.p.getByLabel("Your trainer name").fill("Red");
await clickUntilUrl(quizRed.p, quizRed.p.getByRole("button", { name: /Create duel/ }), /\/quiz\/duel\/[a-z2-9]{8}$/);
const quizUrl = quizRed.p.url();
await quizRed.p.getByText("Waiting for a challenger").waitFor();
await quizRed.p.screenshot({ path: `${OUT}/quiz-duel-lobby.png` });
const quizOg = await quizRed.p.request.get(`${quizUrl}/opengraph-image`);
if (quizOg.status() !== 200) errors.push(`quiz duel OG image returned ${quizOg.status()}`);
else fs.writeFileSync(`${OUT}/quiz-duel-og.png`, await quizOg.body());
// A quiz duel's link on the Pokédle duel route goes to the right page.
await gotoSettled(quizBlue.p, quizUrl.replace("/quiz/duel/", "/pokedle/duel/"));
await quizBlue.p.waitForURL(quizUrl);
await quizBlue.p.getByText("Red challenges you!").waitFor();
await quizBlue.p.getByText("Mainline Games", { exact: true }).first().waitFor();
if (await quizBlue.p.getByText(/Difficulty:/).count()) errors.push("quiz duel: the lobby names a difficulty for a fixed mode");
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

// A Zoom Reveal duel: each trainer zooms out on their own misses; the live view
// shows their own step and the other's step number, never the answer.
step("zoom reveal duel: ten Pokémon to the end");
{
  const zoom = [];
  for (const name of ["Red", "Blue"]) {
    const p = await newPage({ width: 1280, height: 900 });
    const seen = { rev: -1, view: null };
    p.on("response", async (res) => {
      if (!/\/api\/duel(\/|$)/.test(res.url()) || !res.ok()) return;
      const body = await res.json().catch(() => null);
      const view = body?.view ?? body;
      if (!view || typeof view.rev !== "number") return;
      if (view.question && /"(answer|explanation|revealUrl|picks|choice|pokemonId)"|official-artwork/.test(JSON.stringify(view.question))) {
        errors.push(`zoom duel question leaked before the reveal: ${JSON.stringify(view.question).slice(0, 300)}`);
      }
      if (view.rev >= seen.rev) Object.assign(seen, { rev: view.rev, view });
    });
    zoom.push({ p, name, seen });
  }
  const [zRed, zBlue] = zoom;
  await gotoSettled(zRed.p, `${BASE}/quiz/pokemon-zoom-quiz`);
  await zRed.p.getByLabel("Your trainer name").fill("Red");
  await clickUntilUrl(zRed.p, zRed.p.getByRole("button", { name: /Create duel/ }), /\/quiz\/duel\/[a-z2-9]{8}$/);
  const zUrl = zRed.p.url();
  await gotoSettled(zBlue.p, zUrl);
  await zBlue.p.getByLabel("Your trainer name").fill("Blue");
  await zBlue.p.getByRole("button", { name: /Join duel/ }).click();
  await zRed.p.getByText("Blue").first().waitFor();
  await Promise.all(zoom.map(({ p }) => p.getByRole("button", { name: /^Ready$/ }).click()));
  async function playZoomDuel({ p, name, seen }, shoot) {
    const next = p.getByRole("button", { name: /Next question|See results/ });
    for (let i = 0; i < 1500; i++) {
      if ((await next.isVisible()) && (await next.isEnabled())) {
        if (shoot) await p.screenshot({ path: `${OUT}/quiz-zoom-duel-reveal.png`, fullPage: true });
        shoot = false;
        const label = await next.innerText();
        await next.click({ timeout: 5_000 }).catch(() => {});
        if (/results/i.test(label)) return;
        await p.waitForTimeout(300);
        continue;
      }
      const live = seen.view?.question;
      const skip = p.getByTestId("zoom-skip");
      if (live?.question?.zoom && !live.yours && (await skip.isVisible()) && (await skip.isEnabled())) {
        if (shoot && name === "Red" && live.index === 0 && live.question.zoom.step === 2) await p.screenshot({ path: `${OUT}/quiz-zoom-duel-question.png` });
        await skip.click({ timeout: 5_000 }).catch(() => {});
        for (let w = 0; w < 30 && seen.view?.question?.question?.zoom?.step === live.question.zoom.step && !seen.view.question.yours; w++) await p.waitForTimeout(100);
        continue;
      }
      await p.waitForTimeout(150);
    }
    throw new Error(`${name}'s zoom duel didn't end`);
  }
  await Promise.all([playZoomDuel(zRed, true), playZoomDuel(zBlue, false)]);
  await zRed.p.getByText(/Victory!|Defeat|Draw/).first().waitFor();
  await zRed.p.screenshot({ path: `${OUT}/quiz-zoom-duel-summary.png`, fullPage: true });
  if (zRed.seen.view?.revealed?.length !== 10) errors.push(`zoom duel ended after ${zRed.seen.view?.revealed?.length} questions`);
  const steps = zRed.seen.view?.revealed?.[0]?.picks?.[0]?.step;
  if (steps !== 6) errors.push(`zoom duel: Red's first pick should end on step 6, got ${steps}`);
  for (const { p } of zoom) await p.context().close();
}

// A Whose Team duel on Hard: each trainer sees only their own reveals. Two questions, then Red forfeits.
step("whose team duel: hard, two questions, then a forfeit");
{
  const team = [];
  for (const name of ["Red", "Blue"]) {
    const p = await newPage({ width: 1280, height: 900 });
    const seen = { rev: -1, view: null };
    p.on("response", async (res) => {
      if (!/\/api\/duel(\/|$)/.test(res.url()) || !res.ok()) return;
      const body = await res.json().catch(() => null);
      const view = body?.view ?? body;
      if (!view || typeof view.rev !== "number") return;
      const q = view.question?.question;
      if (q && /"(answer|explanation|picks|choice)"|bulbapedia/i.test(JSON.stringify({ ...q, options: undefined }))) errors.push(`whose team duel leaked: ${JSON.stringify(q).slice(0, 200)}`);
      if (q && q.cards?.length !== q.reveal?.shown) errors.push(`whose team duel sent ${q.cards?.length} cards with ${q.reveal?.shown} revealed`);
      if (view.rev >= seen.rev) Object.assign(seen, { rev: view.rev, view });
    });
    team.push({ p, name, seen });
  }
  const [tRed, tBlue] = team;
  await gotoSettled(tRed.p, `${BASE}/quiz/whose-team-is-this`);
  await tRed.p.getByRole("button", { name: "Hard", exact: true }).last().click();
  await tRed.p.getByLabel("Your trainer name").fill("Red");
  await clickUntilUrl(tRed.p, tRed.p.getByRole("button", { name: /Create duel/ }), /\/quiz\/duel\/[a-z2-9]{8}$/);
  const teamUrl = tRed.p.url();
  await gotoSettled(tBlue.p, teamUrl);
  await tBlue.p.getByText("Red challenges you!").waitFor();
  await tBlue.p.getByLabel("Your trainer name").fill("Blue");
  await tBlue.p.getByRole("button", { name: /Join duel/ }).click();
  await tRed.p.getByText("Blue").first().waitFor();
  await Promise.all(team.map(({ p }) => p.getByRole("button", { name: /^Ready$/ }).click()));
  for (let i = 0; i < 2; i++) {
    await Promise.all(team.map(({ p }) => p.getByTestId("team-guess").waitFor({ timeout: 30_000 })));
    await tRed.p.getByTestId("team-reveal").click();
    await tRed.p.locator("main ol img").nth(1).waitFor({ timeout: 10_000 });
    if ((await tBlue.p.locator("main ol img").count()) !== 1) errors.push("whose team duel: Blue saw Red's reveal");
    if (i === 0) await tRed.p.screenshot({ path: `${OUT}/quiz-whose-team-duel.png` });
    for (const { p } of team) {
      await p.getByTestId("team-guess").fill("Cynthia");
      await p.getByTestId("team-guess").press("Enter");
    }
    const next = tRed.p.getByRole("button", { name: /Next question/ });
    await next.waitFor({ timeout: 20_000 });
    await tRed.p.getByTestId("team-answer").waitFor();
    if (i === 0) await tRed.p.screenshot({ path: `${OUT}/quiz-whose-team-duel-reveal.png`, fullPage: true });
    await Promise.all(team.map(({ p }) => p.getByRole("button", { name: /Next question/ }).click()));
  }
  await tRed.p.getByTestId("team-guess").waitFor({ timeout: 30_000 });
  await tRed.p.getByRole("button", { name: /Leave duel/ }).click();
  await tRed.p.getByRole("button", { name: /^Forfeit$/ }).click();
  await tBlue.p.getByText("Red left the duel.").waitFor();
  for (const { p } of team) await p.context().close();
}

// Matchmaking: two trainers press "Find an opponent" for the same game, with no link, and land in one duel
// that starts on its own. Red searches first (and waits), Blue's search pairs them.
async function findOpponent(path, ready) {
  const [mRed, mBlue] = [await newPage({ width: 1280, height: 900 }), await newPage({ width: 1280, height: 900 })];
  for (const [p, name] of [
    [mRed, "Red"],
    [mBlue, "Blue"],
  ]) {
    await gotoSettled(p, `${BASE}${path}`);
    await closeHowTo(p);
    await p.getByLabel("Your trainer name").first().fill(name);
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

// Ranked PokéGuessr: two new trainers (1,000 Elo each) queue ranked and are paired at once into one rated duel on the
// world map, with division badges in the HUD. Blue forfeits: the duel is counted and Red's result shows the division
// (Poké Ball hides the number). The ladder tab lists both.
step("ranked pokéguessr: two trainers matched by Elo, counted after a forfeit");
/** Opens /guessr on the ranked queue as `name`, ready to queue. */
async function rankedPanel(p, name) {
  await gotoSettled(p, `${BASE}/guessr`);
  await closeHowTo(p);
  await p.getByTestId("geo-duel-queue-ranked").click();
  await p.getByTestId("geo-ranked-card").waitFor();
  await p.getByTestId("geo-ranked-queue").waitFor({ timeout: 15_000 });
  await p.getByTestId("geo-ranked-name").fill(name);
}
const rankedDuelPath = /\/guessr\/duel\/[a-z2-9]{8}\?matched=1$/;
/** Division badges never show a number in Poké or Great Ball. */
async function checkHiddenElo(p, where) {
  for (const text of await p.getByTestId("geo-division-badge").allInnerTexts()) {
    if (/\d/.test(text) && /Poké Ball|Great Ball/i.test(text)) errors.push(`${where}: a low division shows its Elo: "${text}"`);
  }
}
{
  const rRed = await newPage({ width: 1280, height: 900 });
  const rBlue = await newPage({ width: 1280, height: 900 });
  await rankedPanel(rRed, "Red");
  await rankedPanel(rBlue, "Blue");
  if (!(await rRed.getByTestId("geo-division-badge").first().isVisible())) errors.push("ranked panel shows no division badge");
  await checkHiddenElo(rRed, "ranked panel");
  await rRed.screenshot({ path: `${OUT}/guessr-ranked-panel.png` });
  await rRed.getByTestId("geo-ranked-queue").click();
  await rRed.getByTestId("geo-ranked-searching").waitFor();
  await rRed.waitForTimeout(1500);
  await rRed.screenshot({ path: `${OUT}/guessr-ranked-searching.png` });
  await rBlue.getByTestId("geo-ranked-queue").click();
  await Promise.all([rRed.waitForURL(rankedDuelPath), rBlue.waitForURL(rankedDuelPath)]);
  if (rRed.url() !== rBlue.url()) errors.push(`ranked: matched into different duels: ${rRed.url()} vs ${rBlue.url()}`);
  await rRed.getByText("Matched! You vs Blue").waitFor();
  await Promise.all([shotLoaded(rRed), shotLoaded(rBlue)]);
  if ((await rRed.getByTestId("geo-division-badge").count()) < 2) errors.push("ranked duel: no division badges in the HUD");
  await checkHiddenElo(rRed, "ranked duel");
  if (await rRed.getByTestId("geo-gym-leader-badge").count()) errors.push("ranked duel between trainers shows a Gym Leader badge");
  await rRed.screenshot({ path: `${OUT}/guessr-ranked-duel.png` });
  await rBlue.getByRole("button", { name: /Leave duel/ }).click();
  await rBlue.getByRole("button", { name: /^Forfeit$/ }).click();
  await rRed.getByText("Blue left the duel.").waitFor();
  await rRed.getByTestId("geo-ranked-outcome").waitFor({ timeout: 45_000 });
  if (!(await rRed.getByText("Victory!").isVisible())) errors.push("ranked: Red didn't win the forfeited duel");
  if (!(await rRed.getByTestId("geo-ranked-trend").isVisible())) errors.push("ranked: a Poké Ball result shows no trend (and should hide the number)");
  await checkHiddenElo(rRed, "ranked result");
  if (!(await rRed.getByTestId("geo-ranked-again").isVisible())) errors.push("ranked result has no Queue ranked button");
  if (!(await rRed.getByRole("button", { name: /Casual rematch/ }).isVisible())) errors.push("ranked result has no casual rematch");
  await rRed.waitForTimeout(1600);
  await rRed.screenshot({ path: `${OUT}/guessr-ranked-result.png`, fullPage: true });

  await gotoSettled(rRed, `${BASE}/leaderboard?board=geo-ranked`);
  await rRed.getByTestId("leaderboard-geo-ranked").waitFor();
  const ladderNames = await rRed.locator("table tbody td:nth-child(2)").allInnerTexts();
  for (const who of ["Red", "Blue"]) if (!ladderNames.some((n) => n.trim() === who)) errors.push(`ranked ladder doesn't list ${who}: ${JSON.stringify(ladderNames)}`);
  if (ladderNames.some((n) => /Gym Leader/.test(n))) errors.push("ranked ladder lists a Gym Leader");
  await checkHiddenElo(rRed, "ranked ladder");
  await rRed.screenshot({ path: `${OUT}/guessr-ranked-ladder.png`, fullPage: true });
  await rRed.context().close();
  await rBlue.context().close();
}

// The Gym Leader: with the server set to offer the bot quickly (POKEIQ_GEO_RANKED_BOT_AFTER_S), a lone ranked seeker is
// offered a clearly labelled computer opponent, which plays every round server-side to the end, and the duel is rated.
step("ranked pokéguessr: the Gym Leader offer");
{
  const info = await fetch(`${BASE}/api/geo/ranked`).then((r) => r.json()).catch(() => null);
  if (info?.available && info.botAfterS > 0 && info.botAfterS <= 15) {
    const gp = await newPage({ width: 1280, height: 900 });
    await rankedPanel(gp, "Red");
    await gp.getByTestId("geo-ranked-queue").click();
    await gp.getByTestId("geo-ranked-bot-offer").waitFor({ timeout: (info.botAfterS + 15) * 1000 });
    await gp.getByText("No trainer found yet. Battle a Gym Leader?").waitFor();
    await gp.screenshot({ path: `${OUT}/guessr-ranked-gym-offer.png` });
    await gp.getByTestId("geo-ranked-bot").click();
    await gp.waitForURL(rankedDuelPath);
    await gp.getByText(/Matched! You vs Gym Leader/).waitFor();
    await shotLoaded(gp);
    await gp.getByTestId("geo-gym-leader-badge").first().waitFor();
    if (!(await gp.getByTestId("geo-gym-leader-avatar").first().isVisible())) errors.push("gym leader duel: no trainer-class avatar");
    await gp.screenshot({ path: `${OUT}/guessr-ranked-gym-duel.png` });
    const gymRounds = await playDuel(gp, 0.5, false);
    console.log(`  the Gym Leader duel ended after ${gymRounds} round${gymRounds === 1 ? "" : "s"}`);
    await gp.getByText(/Victory!|Defeat|Draw/).first().waitFor();
    await gp.getByTestId("geo-ranked-outcome").waitFor({ timeout: 45_000 });
    if (!(await gp.getByText("A Gym Leader duel: rated at half the usual swing.").isVisible())) errors.push("gym leader result doesn't say it was rated at half K");
    await gp.waitForTimeout(1600);
    await gp.screenshot({ path: `${OUT}/guessr-ranked-gym-result.png`, fullPage: true });
    await gp.context().close();
  } else {
    console.log(`  skipped: the server offers the Gym Leader after ${info?.botAfterS ?? "?"} s (set POKEIQ_GEO_RANKED_BOT_AFTER_S to 15 or less to test it)`);
  }
}

step("world atlas: search, place card, link into PokéGuessr");
await gotoSettled(page, `${BASE}/atlas`);
await page.getByLabel("Search the map").fill("Saffron City");
await page.getByRole("button", { name: "Go" }).click();
await page.getByRole("heading", { name: "Saffron City" }).waitFor();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/atlas.png` });
await page.getByRole("link", { name: /Play PokéGuessr Kanto/ }).click();
await page.waitForURL(/\/guessr\?region=kanto/);
await page.getByText("Field survey · Kanto").waitFor();

step("pokédex explorer");
await gotoSettled(page, `${BASE}/pokedex`);
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
await gotoSettled(page, `${BASE}/pokedex/study?gen=1`);
await page.getByRole("button", { name: "Start studying" }).click();
for (let i = 0; i < 3; i++) {
  await page.keyboard.press(" ");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Knew it/ }).click();
  await page.waitForTimeout(400);
}
await page.screenshot({ path: `${OUT}/study.png` });

step("pokédex tabs: moves, abilities, items, places");
{
  const SHOTS = process.env.DEX_SHOTS ?? OUT;
  fs.mkdirSync(SHOTS, { recursive: true });
  await gotoSettled(page, `${BASE}/pokedex`);
  for (const tab of ["moves", "abilities", "items", "places", "pokemon"]) {
    await page.getByTestId(`dex-tab-${tab}`).click();
    await page.waitForURL(tab === "pokemon" ? /\/pokedex$/ : new RegExp(`/pokedex/${tab}$`));
    await page.getByLabel(`Search ${tab === "pokemon" ? "Pokémon" : tab}`).waitFor();
  }
  // Moves: search, then open the move page.
  await page.getByTestId("dex-tab-moves").click();
  await page.waitForURL(/\/pokedex\/moves$/);
  await page.getByLabel("Search moves").fill("flamethrower");
  await page.getByRole("link", { name: "Flamethrower" }).first().click();
  await page.waitForURL(/\/pokedex\/moves\/flamethrower$/);
  await page.getByRole("link", { name: /Charizard/ }).first().waitFor();
  // Abilities: search, open Blaze and see Charizard.
  await gotoSettled(page, `${BASE}/pokedex/abilities`);
  await page.getByLabel("Search abilities").fill("blaze");
  await page.getByRole("link", { name: /^Blaze/ }).first().click();
  await page.waitForURL(/\/pokedex\/abilities\/blaze$/);
  await page.getByRole("link", { name: /Charizard/ }).first().waitFor();
  // Items: category filter + search, screenshot the list.
  await gotoSettled(page, `${BASE}/pokedex/items`);
  await page.getByLabel("Search items").fill("left");
  await page.getByRole("link", { name: /Leftovers/ }).first().waitFor();
  await page.screenshot({ path: `${SHOTS}/dex-items.png` });
  await page.getByRole("link", { name: /Leftovers/ }).first().click();
  await page.waitForURL(/\/pokedex\/items\/leftovers$/);
  const holders = await page.getByTestId("item-holder").count();
  if (holders < 1) throw new Error("Leftovers page lists no wild holder");
  await page.getByTestId("item-sprite").waitFor();
  const spriteOk = await page
    .getByTestId("item-sprite")
    .evaluate((img) => img.complete && img.naturalWidth > 0 || new Promise((r) => { img.onload = () => r(true); img.onerror = () => r(false); setTimeout(() => r(false), 8000); }));
  if (!spriteOk) throw new Error("Leftovers sprite did not load");
  await page.screenshot({ path: `${SHOTS}/dex-leftovers.png`, fullPage: true });
  // A TM shows the move it teaches.
  await gotoSettled(page, `${BASE}/pokedex/items/tm01`);
  await page.getByRole("link", { name: "Focus Punch" }).first().waitFor();
  // Move page links back from the Pokémon entry's Moves section.
  await gotoSettled(page, `${BASE}/pokemon/charizard`);
  await page.locator('a[href^="/pokedex/moves/"]').first().waitFor({ state: "attached" });
  await page.locator('a[href="/pokedex/abilities/blaze"]').first().waitFor();
  // Places: search + region filter, open Route 1 (Kanto), then a Gym.
  const revealAll = async () => {
    for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += 500) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(80);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
  };
  await gotoSettled(page, `${BASE}/pokedex/places`);
  await page.getByLabel("Search places").fill("route 1");
  await page.getByLabel("Region").selectOption("Kanto");
  await page.locator('a[href="/pokedex/places/route-1-kanto"]').waitFor();
  await page.screenshot({ path: `${SHOTS}/dex-places.png` });
  await page.locator('a[href="/pokedex/places/route-1-kanto"]').click();
  await page.waitForURL(/\/pokedex\/places\/route-1-kanto$/);
  for (const mon of ["Pidgey", "Rattata"]) await page.getByTestId("place-wild-row").filter({ hasText: mon }).first().waitFor({ state: "attached" });
  await page.getByTestId("place-shot").scrollIntoViewIfNeeded();
  const shotOk = await page
    .getByTestId("place-shot")
    .evaluate((img) => img.complete && img.naturalWidth > 0 || new Promise((r) => { img.onload = () => r(true); img.onerror = () => r(false); setTimeout(() => r(false), 15000); }));
  if (!shotOk) throw new Error("Route 1 screenshot did not load");
  await revealAll();
  await page.screenshot({ path: `${SHOTS}/dex-route1.png`, fullPage: true });
  await gotoSettled(page, `${BASE}/pokedex/places/pewter-gym-kanto`);
  await page.getByTestId("place-gyms").filter({ hasText: "Brock" }).waitFor({ state: "attached" });
  // Places beyond the atlas: Hisui (Legends: Arceus) and Hoenn's Route 134.
  for (const [q, slug, mon] of [["Jubilife Village", "jubilife-village-hisui", null], ["Route 134", "route-134-hoenn", "Tentacool"]]) {
    await gotoSettled(page, `${BASE}/pokedex/places`);
    await page.getByLabel("Search places").fill(q);
    await page.locator(`a[href="/pokedex/places/${slug}"]`).click();
    await page.waitForURL(new RegExp(`/pokedex/places/${slug}$`));
    await page.getByRole("heading", { name: q }).first().waitFor();
    if (mon) await page.getByTestId("place-wild-row").filter({ hasText: mon }).first().waitFor({ state: "attached" });
  }
  // Pokémon entry links its places to the Places tab.
  await gotoSettled(page, `${BASE}/pokemon/wooper`);
  await page.locator('a[href="/pokedex/places/glaseado-mountain-paldea"]').first().waitFor({ state: "attached" });
  // ...including places beyond the atlas.
  await gotoSettled(page, `${BASE}/pokemon/magikarp`);
  await page.locator('a[href="/pokedex/places/south-paldean-sea-paldea"]').first().waitFor({ state: "attached" });
}

step("pokédex: types, natures, names, form switcher");
{
  const SHOTS = process.env.DEX_SHOTS ?? OUT;
  fs.mkdirSync(SHOTS, { recursive: true });
  await gotoSettled(page, `${BASE}/pokedex`);
  await page.getByTestId("dex-tab-types").click();
  await page.waitForURL(/\/pokedex\/types$/);
  await page.getByTestId("type-chart").waitFor();
  if ((await page.locator('[data-testid^="tc-"]').count()) !== 324) errors.push("type chart isn't 18x18");
  if (!(await page.getByTestId("tc-fairy-dragon").innerText()).includes("2")) errors.push("type chart: Fairy should be super effective on Dragon");
  if (!(await page.getByTestId("tc-ground-flying").innerText()).includes("0")) errors.push("type chart: Ground should have no effect on Flying");
  await page.screenshot({ path: `${SHOTS}/dex-types.png` });
  await page.getByTestId("dex-tab-natures").click();
  await page.waitForURL(/\/pokedex\/natures$/);
  if ((await page.locator('[data-testid^="nature-"]:not([data-testid="nature-table"])').count()) !== 25) errors.push("natures page doesn't list 25 natures");
  const adamant = await page.getByTestId("nature-adamant").innerText();
  if (!/Attack/.test(adamant) || !/Sp\. Atk/.test(adamant)) errors.push(`Adamant row wrong: ${adamant}`);
  await page.screenshot({ path: `${SHOTS}/dex-natures.png` });
  await gotoSettled(page, `${BASE}/pokemon/charizard`);
  const names = await page.getByTestId("dex-names").innerText();
  if (!names.includes("リザードン") || !names.includes("Dracaufeu")) errors.push("charizard names section missing Japanese/French names");
  await page.getByTestId("dex-names").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/dex-names.png` });
  await page.getByRole("button", { name: "Mega Charizard X" }).click();
  if (!(await page.locator("#stats").innerText()).includes("130")) errors.push("Mega Charizard X stats didn't switch (Attack 130)");
}

step("pokédex TCG tab: sets, a set gallery (sort + filter), a card page, search, a Pokémon's cards");
{
  // CI serves a captured slice of real API data (POKEIQ_TCG_FIXTURE=1); against the live API, an outage shows a notice instead.
  await gotoSettled(page, `${BASE}/pokedex`);
  await page.getByTestId("dex-tab-tcg").click();
  await page.waitForURL(/\/pokedex\/tcg$/);
  const firstSet = page.getByTestId("tcg-set").first();
  if (!(await firstSet.waitFor({ timeout: 30_000 }).then(() => true, () => false))) {
    if (!(await page.getByTestId("tcg-unavailable").count())) errors.push("tcg: no sets and no unavailable notice");
    console.log("  TCG API unavailable: rest of the TCG step skipped");
  } else {
    await page.screenshot({ path: `${OUT}/tcg-sets.png` });
    // Base Set is in every snapshot (fixture and live).
    await gotoSettled(page, `${BASE}/pokedex/tcg/base1`);
    await page.getByTestId("tcg-card").first().waitFor();
    const total = await page.getByTestId("tcg-card").count();
    await page.getByTestId("tcg-sort").selectOption("price-desc");
    await page.getByTestId("tcg-type").selectOption("Fire");
    const fire = await page.getByTestId("tcg-card").count();
    if (!(fire > 0 && fire < total)) errors.push(`tcg: the Fire filter showed ${fire} of ${total} cards`);
    const setNote = await page.getByTestId("tcg-price-note").innerText();
    if (process.env.POKEIQ_TCG_FIXTURE === "1" && !/^Prices: TCGplayer market \(USD\).* as of /.test(setNote)) errors.push(`tcg: the set's price note has no source/date: "${setNote}"`);
    await page.screenshot({ path: `${OUT}/tcg-set.png` });
    // The gallery re-renders after the filter: click again if the first click landed on a card that was replaced.
    await clickUntilUrl(page, page.getByTestId("tcg-card").first(), /\/pokedex\/tcg\/card\//);
    await page.getByTestId("tcg-card-image").waitFor();
    await page.getByTestId("tcg-prices").waitFor();
    // Fire Pokémon cards link to their Pokédex entry.
    await page.getByTestId("tcg-dex-link").first().waitFor();
    // Every price block names its source and date.
    for (const s of await page.getByTestId("tcg-price-source").allInnerTexts()) if (!/ as of /i.test(s)) errors.push(`tcg: a price block without a date: "${s}"`);
    await page.screenshot({ path: `${OUT}/tcg-card.png`, fullPage: true });
    // A card the Pokémon TCG API has no prices for: TCGplayer via TCGCSV (fixture: captured TCGCSV data).
    await gotoSettled(page, `${BASE}/pokedex/tcg/card/me55-150`);
    await page.getByTestId("tcg-prices").waitFor();
    const sources = await page.getByTestId("tcg-price-source").allInnerTexts();
    if (process.env.POKEIQ_TCG_FIXTURE === "1" && !sources.some((s) => /^TCGplayer via TCGCSV · as of \w{3} \d{1,2}, \d{4}/i.test(s))) errors.push(`tcg: me55-150 has no TCGCSV price (${sources.join(" | ") || "none"})`);
    if (!sources.length && !(await page.getByTestId("tcg-price-note").count())) errors.push("tcg: me55-150 shows neither prices nor an 'unavailable' note");
    await gotoSettled(page, `${BASE}/pokedex/tcg`);
    await page.getByTestId("tcg-search").getByRole("searchbox").fill("Pikachu");
    await page.getByTestId("tcg-search").getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/[?&]q=Pikachu/);
    await page.getByTestId("tcg-results").getByTestId("tcg-card").first().waitFor();
    await gotoSettled(page, `${BASE}/pokemon/pikachu`);
    await page.evaluate(() => document.getElementById("cards")?.scrollIntoView());
    await page.getByTestId("pokemon-cards").getByTestId("tcg-card").first().waitFor({ timeout: 30_000 });
    await page.getByTestId("pokemon-cards-all").click();
    await page.waitForURL(/\/pokedex\/tcg\?dex=25$/);
    await page.getByTestId("tcg-results").getByTestId("tcg-card").first().waitFor();
  }
}

step("pokédex Trainers tab: search, notable filter, a game by route, an area's teams, a notable trainer");
{
  await gotoSettled(page, `${BASE}/pokedex`);
  await page.getByTestId("dex-tab-trainers").click();
  await page.waitForURL(/\/pokedex\/trainers$/);
  await page.getByTestId("trainers-game-card").first().waitFor();
  if ((await page.getByTestId("trainers-game-card").count()) !== 20) errors.push("trainers: expected 20 game cards (Gen I–IX)");
  // Search loads the full index on demand; Joey is on Route 30 in the Johto games.
  await page.getByTestId("trainers-search").fill("joey");
  await page.getByTestId("trainers-result").first().waitFor({ timeout: 30_000 });
  if (!(await page.getByTestId("trainers-results").getByText("Route 30").count())) errors.push("trainers: searching Joey didn't find Route 30");
  await page.screenshot({ path: `${OUT}/trainers-search.png` });
  await page.getByTestId("trainers-search").fill("");
  await page.getByTestId("trainers-notable-toggle").click();
  await page.getByTestId("trainers-notable-hit").first().waitFor();
  await gotoSettled(page, `${BASE}/pokedex/trainers/crystal`);
  await page.getByTestId("trainers-area-link").filter({ hasText: "Route 30" }).click();
  await page.waitForURL(/\/pokedex\/trainers\/crystal\/route-30$/);
  const joey = page.getByTestId("trainer-card").filter({ hasText: "Joey" });
  await joey.waitFor();
  // Joey's rematches are tabs on one card.
  const tabs = joey.getByTestId("trainer-team-tab");
  if ((await tabs.count()) !== 5) errors.push(`trainers: Joey has ${await tabs.count()} battle tabs, expected 5`);
  await tabs.nth(4).click();
  await joey.getByRole("tabpanel").filter({ hasText: "Raticate" }).waitFor();
  await page.screenshot({ path: `${OUT}/trainers-area.png`, fullPage: true });
  await gotoSettled(page, `${BASE}/pokedex/trainers/notable/brock`);
  await page.getByTestId("notable-blurb").waitFor();
  if ((await page.getByTestId("notable-game").count()) < 6) errors.push("trainers: Brock should have teams in 6 games");
  await page.getByTestId("trainer-mon").filter({ hasText: "Onix" }).first().getByRole("link", { name: "Bide" }).click();
  await page.waitForURL(/\/pokedex\/moves\/bide$/);
  // Gen IX (Bulbapedia import): a Gym with Tera Types, then Katy's notable page.
  await gotoSettled(page, `${BASE}/pokedex/trainers/scarlet-violet`);
  await page.getByTestId("trainers-area-link").filter({ hasText: "Cortondo Gym" }).click();
  await page.waitForURL(/\/pokedex\/trainers\/scarlet-violet\/cortondo-gym$/);
  const katy = page.getByTestId("trainer-card").filter({ hasText: "Katy" }).first();
  await katy.waitFor();
  if (!(await katy.getByTestId("trainer-mon-tera").count())) errors.push("trainers: Katy's Teddiursa should show its Tera Type");
  await gotoSettled(page, `${BASE}/pokedex/trainers/notable/katy`);
  await page.getByTestId("notable-blurb").waitFor();
}

step("pokédex Timeline tab: intro (once, skippable), 3D scene, scroll + drag, open an entry, track filters, scrubber, list view");
{
  await gotoSettled(page, `${BASE}/pokedex`);
  await page.getByTestId("dex-tab-timeline").click();
  await page.waitForURL(/\/pokedex\/timeline$/);
  // First visit: the intro plays; a click skips it straight away.
  const intro = page.getByTestId("timeline-intro");
  if (!(await intro.waitFor({ timeout: 30_000 }).then(() => true, () => false))) errors.push("timeline: the intro didn't play on the first visit");
  else {
    await page.waitForTimeout(400);
    await page.mouse.click(700, 500);
    if (!(await intro.waitFor({ state: "detached", timeout: 3_000 }).then(() => true, () => false))) errors.push("timeline: clicking didn't skip the intro");
    // Once per browser: back again, no intro.
    await gotoSettled(page, `${BASE}/pokedex/timeline`);
    await page.locator('[data-testid="timeline-stage"][data-ready="1"]').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(800);
    if (await intro.count()) errors.push("timeline: the intro played a second time");
  }
  // The server-rendered list is always in the page (search engines, no WebGL, reduced motion).
  if (!(await page.locator('[data-testid="timeline-list"] #red-green').count())) errors.push("timeline: the server-rendered list is missing Red and Green");
  const stage = page.getByTestId("timeline-stage");
  if (!(await page.locator('[data-testid="timeline-stage"][data-ready="1"]').waitFor({ timeout: 60_000 }).then(() => true, () => false))) {
    errors.push("timeline: the 3D scene never became ready");
  } else {
    const year = async () => Number(await page.getByTestId("timeline-year").innerText());
    const scene = await page.getByTestId("timeline-scene").boundingBox();
    const cx = scene.x + scene.width / 2, cy = scene.y + scene.height / 2;
    await page.waitForTimeout(1500);
    const y0 = await year();
    // Scroll forward in time.
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(40); }
    await page.waitForFunction((y) => Number(document.querySelector('[data-testid="timeline-year"]').textContent) >= y + 3, y0, { timeout: 15_000 }).catch(() => errors.push(`timeline: scrolling didn't move forward from ${y0}`));
    // Drag back towards the start.
    const y1 = await year();
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx + i * 30, cy + i * 20);
    await page.mouse.up();
    await page.waitForFunction((y) => Number(document.querySelector('[data-testid="timeline-year"]').textContent) < y, y1, { timeout: 15_000 }).catch(() => errors.push(`timeline: dragging didn't move back from ${y1}`));
    // Jump to the start and open Red and Green by clicking its card.
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.querySelector('[data-testid="timeline-year"]').textContent === "1996", null, { timeout: 15_000 });
    await page.waitForTimeout(1200);
    // The card drifts with the mouse parallax, so click where it is rather than waiting for it to be still.
    const rg = await page.locator('.tl-card[data-entry="red-green"]').boundingBox();
    if (rg) await page.mouse.click(rg.x + rg.width / 2, rg.y + rg.height / 2);
    if (!(await page.getByTestId("timeline-detail").waitFor({ timeout: 5000 }).then(() => true, () => false))) {
      errors.push("timeline: clicking the Red and Green card didn't open it");
      await page.keyboard.press("Enter");
    }
    const detail = page.getByTestId("timeline-detail");
    await detail.waitFor();
    if (!/Red and Green/i.test(await page.getByTestId("timeline-detail-title").innerText())) errors.push("timeline: the opened entry isn't Red and Green");
    // Japanese and Western dates are listed separately.
    for (const id of ["timeline-date-japan", "timeline-date-north-america", "timeline-date-europe"]) if (!(await detail.getByTestId(id).count())) errors.push(`timeline: Red and Green has no ${id}`);
    if (!(await detail.locator('a[href="/pokemon/bulbasaur"]').count())) errors.push("timeline: the starters don't link to the Pokédex");
    if (!(await detail.locator('[data-testid="timeline-region-link"][href="/pokedex/places?region=Kanto"]').count())) errors.push("timeline: no Kanto link to Places");
    await detail.locator('[data-testid="timeline-gen-strip"] a[href="/pokemon/mew"]').waitFor({ timeout: 15_000 }).catch(() => errors.push("timeline: the Generation I sprite strip didn't load"));
    await page.screenshot({ path: `${OUT}/timeline-detail.png` });
    await page.getByTestId("timeline-detail-next").click();
    await page.waitForFunction(() => !/Red and Green/i.test(document.querySelector('[data-testid="timeline-detail-title"]')?.textContent ?? "Red and Green"), null, { timeout: 5000 }).catch(() => errors.push("timeline: Next didn't move to another entry"));
    await page.keyboard.press("Escape");
    await detail.waitFor({ state: "hidden" });
    // Track filters fade a track out and back in.
    const anime = page.getByTestId("timeline-lane-anime");
    if (!(await anime.isVisible())) await page.getByTestId("timeline-filters-toggle").click();
    await anime.click();
    if ((await anime.getAttribute("aria-pressed")) !== "false") errors.push("timeline: the Anime filter didn't switch off");
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.tl-card[data-entry="anime-s01"]')).display === "none", null, { timeout: 5000 }).catch(() => errors.push("timeline: the Anime track didn't fade out"));
    await anime.click();
    // The scrubber jumps straight to an era.
    const bar = await page.getByTestId("timeline-scrubber").boundingBox();
    await page.mouse.click(bar.x + bar.width * 0.85, bar.y + bar.height / 2);
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="timeline-year"]').textContent) >= 2019, null, { timeout: 15_000 }).catch(() => errors.push("timeline: the scrubber didn't jump to the Switch era"));
    await page.screenshot({ path: `${OUT}/timeline-3d.png` });
    // List view.
    await page.getByTestId("timeline-list-view").click();
    await stage.waitFor({ state: "detached" });
    await page.locator('[data-testid="timeline-list"] #scarlet-violet').waitFor();
    await page.getByTestId("timeline-3d-view").waitFor();
  }
}

step("pokédex Timeline: an entry's own link opens its panel, share copies it, tour starts and stops, sound stays off when muted");
{
  // Site sound off; count every AudioContext the page creates.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await context.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    localStorage.setItem("pokeiq-muted", "1");
    window.__audioContexts = 0;
    const Real = window.AudioContext;
    if (Real) window.AudioContext = class extends Real { constructor(...a) { super(...a); window.__audioContexts++; } };
  });
  const tp = await context.newPage();
  tp.on("pageerror", (err) => errors.push(`[${tp.url()}] PAGEERROR: ${err.message}`));
  await tp.goto(`${BASE}/pokedex/timeline/pokemon-go`, { waitUntil: "domcontentloaded" });
  if (!/Pokémon GO/.test(await tp.title())) errors.push(`timeline: an entry's page has a generic title (${await tp.title()})`);
  if (!(await tp.locator('[data-testid="timeline-stage"][data-ready="1"]').waitFor({ timeout: 60_000 }).then(() => true, () => false))) {
    errors.push("timeline: the 3D scene never became ready on an entry's link");
  } else {
    // A shared link goes straight to the entry: no intro, its panel open.
    if (await tp.getByTestId("timeline-intro").count()) errors.push("timeline: the intro played on an entry's link");
    const detail = tp.getByTestId("timeline-detail");
    if (!(await detail.waitFor({ timeout: 10_000 }).then(() => true, () => false))) errors.push("timeline: an entry's link didn't open its panel");
    else if (!/Pokémon GO/i.test(await tp.getByTestId("timeline-detail-title").innerText())) errors.push("timeline: the entry's link opened the wrong entry");
    // The card shows the earliest release (6 Jul 2016 in North America, before Japan's 22 Jul); the panel keeps both.
    const goDate = await tp.locator('.tl-card[data-entry="pokemon-go"] .tl-card-date').innerText().catch(() => "");
    if (!/6 Jul 2016/i.test(goDate) || /22 Jul/i.test(goDate)) errors.push(`timeline: the Pokémon GO card shows "${goDate}", not its earliest release`);
    for (const id of ["timeline-date-japan", "timeline-date-north-america"]) if (!(await detail.getByTestId(id).count())) errors.push(`timeline: the Pokémon GO panel lost ${id}`);
    // At most one era title in the distance at any time, and none behind the era title card.
    for (const y of [2003, 2008, 2012]) {
      const bar = await tp.getByTestId("timeline-scrubber").boundingBox();
      await tp.mouse.click(bar.x + ((y - 1996) / 30.7) * bar.width, bar.y + bar.height / 2);
      await tp.waitForTimeout(1200);
      for (let k = 0; k < 4; k++) {
        // Both read in the same instant: a title fading out just before an era change and the card that follows aren't an overlap.
        const { shown, flashOn } = await tp.evaluate(() => ({
          shown: [...document.querySelectorAll(".tl-era")].filter((e) => e.style.display !== "none" && Number(e.style.opacity || 0) > 0.01).length,
          flashOn: document.querySelectorAll('[data-testid="timeline-era-flash"]').length,
        }));
        if (shown > 1 || (flashOn && shown > 0)) { errors.push(`timeline: ${shown} era titles shown at once near ${y}${flashOn ? " (with the title card)" : ""}`); break; }
        await tp.waitForTimeout(500);
      }
    }
    await tp.getByTestId("timeline-detail").waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
    await tp.goto(`${BASE}/pokedex/timeline/pokemon-go`, { waitUntil: "domcontentloaded" });
    await tp.locator('[data-testid="timeline-stage"][data-ready="1"]').waitFor({ timeout: 60_000 });
    await detail.waitFor({ timeout: 10_000 });
    // Share: the panel shows the entry's own link and copies it.
    await tp.getByTestId("timeline-share").click();
    await tp.getByTestId("timeline-share-panel").waitFor();
    if (!/\/pokedex\/timeline\/pokemon-go$/.test(await tp.getByTestId("timeline-share-url").innerText())) errors.push("timeline: the share panel doesn't show the entry's link");
    await tp.getByTestId("timeline-share-copy").click();
    await tp.getByTestId("timeline-share-copy").filter({ hasText: "Copied" }).waitFor({ timeout: 5_000 }).catch(() => errors.push("timeline: Copy didn't confirm"));
    const copied = await tp.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    if (!copied.endsWith("/pokedex/timeline/pokemon-go")) errors.push(`timeline: Copy put "${copied}" on the clipboard`);
    await tp.screenshot({ path: `${OUT}/timeline-share.png` });
    // Its preview card is the entry's own.
    const og = await tp.request.get(`${BASE}/pokedex/timeline/pokemon-go/opengraph-image`);
    if (og.status() !== 200 || !/image\/png/.test(og.headers()["content-type"] ?? "")) errors.push(`timeline: the entry's preview card failed (${og.status()})`);
    // Closing the panel puts the address bar back on the timeline.
    await tp.getByTestId("timeline-detail-close").click();
    await detail.waitFor({ state: "hidden" });
    if (new URL(tp.url()).pathname !== "/pokedex/timeline") errors.push(`timeline: closing the panel left the address at ${tp.url()}`);
    // Tour: glides forward on its own and pauses on key moments; any key stops it.
    const tour = tp.getByTestId("timeline-tour");
    await tp.keyboard.press("Home");
    await tp.waitForTimeout(1500);
    await tour.click();
    if ((await tour.getAttribute("aria-pressed")) !== "true") errors.push("timeline: the tour didn't start");
    await tp.getByTestId("timeline-tour-caption").waitFor({ timeout: 20_000 }).catch(() => errors.push("timeline: the tour never paused on a moment"));
    const y0 = Number(await tp.getByTestId("timeline-year").innerText());
    await tp.waitForFunction((y) => Number(document.querySelector('[data-testid="timeline-year"]').textContent) > y, y0, { timeout: 30_000 }).catch(() => errors.push("timeline: the tour didn't move forward through time"));
    await tp.keyboard.press("x");
    await tp.waitForFunction(() => document.querySelector('[data-testid="timeline-tour"]').getAttribute("aria-pressed") === "false", null, { timeout: 5_000 }).catch(() => errors.push("timeline: a key press didn't stop the tour"));
    // All that clicking with the site's sound off: not one AudioContext.
    const made = await tp.evaluate(() => window.__audioContexts);
    if (made !== 0) errors.push(`timeline: ${made} AudioContext(s) started with the site's sound off`);
    // Sound on: the next press starts the timeline's audio.
    await tp.evaluate(() => localStorage.setItem("pokeiq-muted", "0"));
    await tp.mouse.click(640, 450);
    await tp.waitForFunction(() => window.__audioContexts > 0, null, { timeout: 10_000 }).catch(() => errors.push("timeline: no audio started with the sound on"));
  }
  // The list fallback (?view=list) opens on an entry's link too.
  await tp.goto(`${BASE}/pokedex/timeline/gold-silver?view=list`, { waitUntil: "domcontentloaded" });
  await tp.locator('[data-testid="timeline-list"] #gold-silver.tl-list-hit').waitFor({ timeout: 15_000 }).catch(() => errors.push("timeline: the list view didn't bring the linked entry into view"));
  await context.close();
}

step("trainer, leaderboard, pokémon page");
// Quiz modes are off the leaderboard: an old quiz board link lands on the Daily, with no quiz tabs.
await gotoSettled(page, `${BASE}/leaderboard?board=whos-that&format=classic&difficulty=medium`);
await page.getByTestId("leaderboard-tabs").waitFor();
if (await page.getByTestId("leaderboard-tabs").locator('a[href="/leaderboard?board=whos-that"], a[href="/leaderboard?board=shiny"]').count()) errors.push("leaderboard: quiz-mode tabs are still there");
await page.getByText(/Daily Challenge #\d+/).first().waitFor();
for (const path of ["/trainer", "/leaderboard?board=iq", "/pokemon/eevee", "/pokedex?type=ghost&sort=spe"]) {
  await gotoSettled(page, `${BASE}${path}`);
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
await gotoSettled(page, `${BASE}/battle`);
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
await gotoSettled(page, `${BASE}/battle/calc`);
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
await gotoSettled(page, `${BASE}/battle/play`);
await page.screenshot({ path: `${OUT}/battle-setup.png`, fullPage: true });
// Phase 1 formats: Showdown's own tiers below UU, Little Cup, Monotype and National Dex.
for (const name of ["[Gen 9] RU", "[Gen 9] NU", "[Gen 9] PU", "[Gen 9] LC", "[Gen 9] Monotype", "[Gen 9] National Dex", "[Gen 9] Doubles OU"]) {
  if (!(await page.locator("label").filter({ hasText: name }).count())) errors.push(`battle setup: format ${name} is missing`);
}
await page.screenshot({ path: `${OUT}/battle-p1-formats.png`, fullPage: true });
await page.locator("label").filter({ hasText: "[Gen 9] Random Battle" }).first().click();
await page.getByLabel("Your trainer name").fill("Red");
await page.getByRole("button", { name: /Start battle/ }).click();
await page.waitForURL(/\/battle\/play\/[a-z2-9]{8}$/);
await page.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 });
await page.screenshot({ path: `${OUT}/battle-cpu.png` });

step("battle hotkeys: ? shows the list, 1 uses the first move");
await page.keyboard.press("Shift+Slash");
await page.getByTestId("hotkeys-help").waitFor({ timeout: 5_000 });
if (!/Shift \+ 1 – 6/.test(await page.getByTestId("hotkeys-help").innerText())) errors.push("hotkey help is missing the switch keys");
await page.screenshot({ path: `${OUT}/battle-p1-hotkeys.png` });
await page.keyboard.press("Shift+Slash");
await page.getByTestId("hotkeys-help").waitFor({ state: "detached", timeout: 5_000 });
{
  const firstMove = page.locator("[data-testid=move-button]").first();
  if (await firstMove.isEnabled()) {
    await page.keyboard.press("Digit1");
    // Turn 1 is played once turn 2 starts, or a KO asks for a switch first, or the battle ends.
    await Promise.any([
      page.getByTestId("battle-log").getByText(/^Turn 2$/).first().waitFor({ timeout: 30_000 }),
      page.locator("[data-testid=switch-button]:not([disabled])").first().waitFor({ timeout: 30_000 }),
      page.getByTestId("battle-result").waitFor({ timeout: 30_000 }),
    ]);
    console.log("  hotkey 1 played turn 1");
  }
}
await page.getByRole("button", { name: "4x", exact: true }).click();
const cpuTurns = await playBattle(page, 10, "battle-cpu-turn");
console.log(`  stopped at turn ${cpuTurns}`);
if (cpuTurns < 3) errors.push(`the battle against the computer only reached turn ${cpuTurns}`);
await page.screenshot({ path: `${OUT}/battle-cpu-later.png`, fullPage: true });
if ((await page.getByTestId("battle-log").innerText()).length < 200) errors.push("the battle log stayed empty");

step("battle vs computer: Gen 9 OU with the team saved in the team builder");
await gotoSettled(page, `${BASE}/battle/play`);
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
await gotoSettled(page, `${BASE}/battle/play`);
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
await page.getByRole("button", { name: "4x", exact: true }).click();
const customTurns = await playBattle(page, 4, "battle-custom-turn");
if (customTurns < 3) errors.push(`the Gen 4 custom battle only reached turn ${customTurns}`);
if (!/L50/.test(await page.getByTestId("battle-log").innerText().catch(() => ""))) console.log("  (level shown in sprites only)");

step("battle vs computer: Random Doubles, its replay saved and analysed (both positions, targets named)");
await gotoSettled(page, `${BASE}/battle/play`);
await page.locator("label").filter({ hasText: "[Gen 9] Random Doubles Battle" }).first().click();
await page.getByLabel("Your trainer name").fill("Red");
await page.getByRole("button", { name: /Start battle/ }).click();
await page.waitForURL(/\/battle\/play\/[a-z2-9]{8}$/);
await page.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "4x", exact: true }).click();
// A few turns, then a forfeit: an analysed battle only needs to have started (and the replacement prompt can't pass
// a second position that has nothing left to send in, so a battle played to the end can stall there).
const doublesTurns = await playBattle(page, 3, null);
if (!(await page.getByTestId("battle-result").count())) {
  await page.getByRole("button", { name: "Forfeit", exact: true }).click();
  await page.getByRole("button", { name: "Forfeit", exact: true }).click();
}
await page.getByTestId("battle-result").waitFor({ timeout: 60_000 });
console.log(`  the doubles battle ended on turn ${doublesTurns}`);
await page.getByTestId("save-replay").click({ timeout: 30_000 });
await page.getByTestId("analyse-battle").click({ timeout: 30_000 });
await page.waitForURL(/\/battle\/replay\/[a-z2-9]{8}\?analysis=1&side=0/);
{
  const dbl = page.getByTestId("replay-analysis");
  if (await dbl.getByTestId("analysis-unsupported").count()) errors.push(`doubles analysis: refused: ${await dbl.getByTestId("analysis-unsupported").innerText()}`);
  const started = Date.now();
  await dbl.getByTestId("key-moments").waitFor({ timeout: 180_000 });
  console.log(`  doubles analysis took ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if ((await dbl.getByTestId("analysis-chart").locator("path").count()) < 2) errors.push("doubles analysis: no win-chance line");
  if (!/Double battles play both Pokémon/.test(await dbl.getByTestId("analysis-assumptions").innerText())) errors.push("doubles analysis: the assumptions don't mention double battles");
  const lines = await dbl.getByTestId("key-moments").getByTestId("key-moment-text").allInnerTexts();
  for (const line of lines) {
    if (!/^Turn \d+: .+ \(win chance \d+% → (\d+%|won|lost|draw)\)\.$/.test(line)) errors.push(`doubles analysis: odd key moment "${line}"`);
    else console.log(`  ${line}`);
  }
  // Each key moment shows who was in battle: one or two Pokémon a side.
  const boards = dbl.getByTestId("key-moment-board");
  if ((await boards.count()) !== lines.length) errors.push(`doubles analysis: ${await boards.count()} boards for ${lines.length} key moments`);
  for (const text of await boards.allInnerTexts()) {
    const sides = text.split(/\bvs\b/);
    if (sides.length !== 2 || sides.some((side) => !/\d+%/.test(side) || (side.match(/\d+%/g) ?? []).length > 2)) errors.push(`doubles analysis: odd board "${text.replace(/\s+/g, " ")}"`);
  }
  if (lines.length && !lines.some((l) => / on (your )?[A-Z]|hit both|knocked out|by targeting/.test(l))) errors.push("doubles analysis: no key moment names a target");
  await dbl.screenshot({ path: `${OUT}/battle-doubles-analysis.png` });
}

step("battle music: plays after a click, toggles off and stays off");
await page.getByTestId("music-control").waitFor();
await page.waitForTimeout(1500);
const tracks = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\/audio\/battle\/.+\.(ogg|mp3)$/.test(n)));
if (!tracks.length && !musicRequests.length) errors.push("battle music never loaded");
else console.log(`  loaded ${(tracks.length ? tracks : musicRequests).map((t) => t.split("/").pop()).join(", ")}`);
await page.getByTestId("music-toggle").click();
if ((await page.getByTestId("music-toggle").getAttribute("aria-pressed")) !== "false") errors.push("the music toggle didn't turn off");
await page.reload({ waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
await page.getByTestId("music-toggle").waitFor();
if ((await page.getByTestId("music-toggle").getAttribute("aria-pressed")) !== "false") errors.push("music off wasn't remembered");
await page.getByTestId("music-toggle").click();

step("Battle Factory: rent a team, battle, and trade after a win");
await gotoSettled(page, `${BASE}/battle/factory`);
let factoryWon = false;
for (let attempt = 0; attempt < 4 && !factoryWon; attempt++) {
  await gotoSettled(page, `${BASE}/battle/factory`);
  if (await page.getByRole("button", { name: /Give up this run/ }).count()) await page.getByRole("button", { name: /Give up this run/ }).click();
  await page.locator("#frontier-name").fill("Red");
  await page.getByTestId("frontier-start").click();
  await page.getByTestId("frontier-mon").first().waitFor({ timeout: 30_000 });
  if (attempt === 0) await page.screenshot({ path: `${OUT}/battle-factory.png`, fullPage: true });
  await page.getByTestId("frontier-next").click();
  await page.waitForURL(/\/battle\/play\/[a-z2-9]{8}$/);
  await page.getByTestId("battle-streak").waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "4x", exact: true }).click();
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
  // Species Clause: Arceus-Water is still Arceus, so compare species, not forms.
  const species = (n) => n.trim().toUpperCase().replace(/-(WATER|FIRE|GRASS|ELECTRIC|ICE|FIGHTING|POISON|GROUND|FLYING|PSYCHIC|BUG|ROCK|GHOST|DRAGON|DARK|STEEL|FAIRY|ALOLA|GALAR|HISUI|PALDEA|MEGA.*|GMAX|THERIAN|ORIGIN|.*)$/, "");
  const take = theirs.findIndex((t) => !mine.some((m) => species(m) === species(t)));
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
await gotoSettled(page, `${BASE}/battle/tower`);
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
await gotoSettled(liveRed, `${BASE}/battle/play?vs=friend`);
await liveRed.locator("label").filter({ hasText: "[Gen 9] Random Battle" }).first().click();
await liveRed.getByLabel("Your trainer name").fill("Red");
await liveRed.getByTestId("timeout-loses").check({ force: true });
await liveRed.screenshot({ path: `${OUT}/battle-p1-timer-setup.png`, fullPage: true });
await clickUntilUrl(liveRed, liveRed.getByRole("button", { name: /Create battle/ }), /\/battle\/live\/[a-z2-9]{8}$/, () => liveRed.getByTestId("timeout-loses").check({ force: true }).catch(() => {}));
const liveUrl = liveRed.url();
await liveRed.getByLabel("Battle link").waitFor();
await liveRed.screenshot({ path: `${OUT}/battle-live-lobby.png` });
const liveOg = await liveRed.request.get(`${liveUrl}/opengraph-image`);
if (liveOg.status() !== 200) errors.push(`live battle OG image returned ${liveOg.status()}`);
else fs.writeFileSync(`${OUT}/battle-live-og.png`, await liveOg.body());
await gotoSettled(liveBlue, liveUrl);
await liveBlue.getByLabel("Your trainer name").fill("Blue");
await liveBlue.getByRole("button", { name: /Join battle/ }).click();
await liveRed.getByRole("button", { name: "Ready", exact: true }).click();
await liveBlue.getByRole("button", { name: "Ready", exact: true }).click();

step("live battle: both choose moves for a couple of turns");
await Promise.all([liveRed, liveBlue].map((p) => p.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 })));
for (const p of [liveRed, liveBlue]) await p.getByRole("button", { name: "4x", exact: true }).click();
if (!(await liveRed.getByTestId("battle-clocks").count())) errors.push("the live battle shows no turn timer");
// The timer warns as the turn's time runs low (30 s left of Showdown's 150 s first turn), and says running out loses.
step("live battle: the turn timer warns at 30 seconds left, with loss on timeout");
await liveRed.getByTestId("timer-warning").waitFor({ timeout: 150_000 });
if (!/lose the battle/.test(await liveRed.getByTestId("timer-warning").innerText())) errors.push("the timer warning doesn't say running out loses");
await liveRed.screenshot({ path: `${OUT}/battle-p1-timer-warning.png` });
// Cancel (Showdown's undo): Red picks a move, takes it back while Blue is still choosing, and gets the menu again.
step("live battle: cancel a choice before the opponent chooses");
await liveRed.locator("[data-testid=move-button]").first().click();
await liveRed.getByTestId("cancel-choice").click({ timeout: 15_000 });
await liveRed.locator("[data-testid=move-button]").first().waitFor({ timeout: 15_000 });
await liveRed.screenshot({ path: `${OUT}/battle-p1-cancelled.png` });
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
  await liveRed.getByTestId("battle-result").getByText("Blue forfeited.").waitFor({ timeout: 30_000 });
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
  await gotoSettled(p, `${BASE}/battle/play?vs=anyone`);
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
for (const p of [mmRed, mmBlue]) await p.getByRole("button", { name: "4x", exact: true }).click();
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
await gotoSettled(watcher, `${BASE}/battle/watch`);
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
  if (!/Power|Accuracy/i.test(tipText) || !/PP (\d+|–)\/(\d+|–)/i.test(tipText)) errors.push(`move tooltip is missing details: ${tipText}`);
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
await mmRed.getByRole("button", { name: "4x", exact: true }).click();
await mmRed.getByTestId("replay-play").click();
await mmRed.getByTestId("replay-turn").filter({ hasText: /^Turn [3-9]/ }).waitFor({ timeout: 60_000 });
await mmRed.getByTestId("replay-pause").click();
await mmRed.screenshot({ path: `${OUT}/battle-replay.png` });
await mmRed.getByTestId("replay-end").click();
await mmRed.getByTestId("battle-result").waitFor({ timeout: 30_000 });
console.log(`  replay at: ${await turnLabel()}`);

step("replay analysis: the after-battle link, win chance by turn, key moments, turning points, luck, damage, share card");
await gotoSettled(mmRed, `${BASE}/battle/live/${mmCode}`);
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
for (const line of (await analysis.getByTestId("key-moments").getByTestId("key-moment-text").allInnerTexts())) {
  if (!/^Turn \d+: .+ \(win chance \d+% → (\d+%|won|lost|draw)\)\.$/.test(line)) errors.push(`analysis: odd key moment "${line}"`);
  else console.log(`  ${line}`);
}
console.log(`  analysis took ${analysisSecs} s`);
await analysis.screenshot({ path: `${OUT}/battle-replay-analysis.png` });
// The battle's stats, from its log on the server: asked for only now, after the battle.
const statsPanel = mmRed.getByTestId("battle-stats");
await statsPanel.getByTestId("luck-meter").waitFor({ timeout: 30_000 });
const luckScore = (await statsPanel.getByTestId("luck-score").innerText()).trim();
if (!/^([+−]\d+\.\d|0\.0)$/.test(luckScore)) errors.push(`stats: odd luck score "${luckScore}"`);
if ((await statsPanel.getByTestId("luck-table").locator("tbody tr").count()) !== 7) errors.push("stats: the luck table should have seven rows");
if (!/estimates/.test(await statsPanel.getByTestId("luck-explained").textContent())) errors.push("stats: the luck explanation doesn't say it's an estimate");
for (const side of [0, 1]) if (!(await statsPanel.getByTestId(`damage-side-${side}`).locator("li").count())) errors.push(`stats: no Pokémon in the damage summary for side ${side}`);
if (!(await statsPanel.getByTestId("mvp").count())) errors.push("stats: no MVP");
const turningText = await analysis.getByTestId("turning-points").innerText();
for (const line of await analysis.getByTestId("turning-points").locator("li").allInnerTexts()) {
  if (!/turn \d+ .*((dropped|raised|took) your odds|your odds went) from \d+% to (\d+%|the win|the loss|a draw)\.$/i.test(line.replace(/\s+/g, " "))) errors.push(`stats: odd turning point "${line}"`);
  else console.log(`  turning point: ${line.replace(/^[+−]\d+\s*/, "").replace(/\s+/g, " ")}`);
}
if (!turningText.trim()) errors.push("stats: no turning points section");
const statsCard = await statsPanel.getByTestId("stats-share-preview").innerText();
if (!/Luck [+−]?\d+\.\d/.test(statsCard) || !/turns?/.test(statsCard)) errors.push(`stats: odd share card "${statsCard}"`);
console.log(`  share card: ${statsCard.split("\n")[0]}`);
await mmRed.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
await statsPanel.getByTestId("stats-copy").click();
await statsPanel.getByTestId("stats-copy").filter({ hasText: "Copied!" }).waitFor({ timeout: 5_000 }).catch(() => errors.push("stats: Copy didn't say Copied!"));
const copied = await mmRed.evaluate(() => navigator.clipboard.readText()).catch(() => "");
if (copied && !copied.includes(`/battle/replay/${mmCode}?analysis=1`)) errors.push("stats: the copied card has no link to the analysis");
await statsPanel.screenshot({ path: `${OUT}/battle-replay-stats.png` });
const statsRes = await mmRed.request.get(`${BASE}/api/battle/analysis/stats/${mmCode}?v=2`);
if (statsRes.status() !== 200 || !/max-age/.test(statsRes.headers()["cache-control"] ?? "")) errors.push(`stats API: ${statsRes.status()} ${statsRes.headers()["cache-control"]}`);
// Cached in this browser: a reload shows it at once.
await mmRed.reload({ waitUntil: "load" });
  await mmRed.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
await mmRed.getByTestId("replay-analysis").getByTestId("key-moments").waitFor({ timeout: 10_000 });
const replayOg = await mmRed.request.get(`${BASE}/battle/replay/${mmCode}/opengraph-image`);
if (replayOg.status() !== 200) errors.push(`replay OG image returned ${replayOg.status()}`);
else fs.writeFileSync(`${OUT}/battle-replay-og.png`, await replayOg.body());
await gotoSettled(mmRed, `${BASE}/battle/replays`);
await mmRed.getByTestId("recent-replays").locator(`a[href="/battle/replay/${mmCode}"]`).waitFor({ timeout: 15_000 });
await mmRed.getByTestId("my-replays").locator(`a[href="/battle/replay/${mmCode}"]`).waitFor({ timeout: 15_000 });
await mmRed.screenshot({ path: `${OUT}/battle-replays.png`, fullPage: true });
await gotoSettled(mmRed, `${BASE}/battle/ladder`);
await mmRed.screenshot({ path: `${OUT}/battle-ladder.png`, fullPage: true });
for (const p of [mmRed, mmBlue, watcher]) await p.context().close();

step("ranked Random Battle: matched by rating, a forfeit moves Elo and both Glicko-2 ratings, the ladder shows Elo and GXE");
const rkRed = await newPage({ width: 1280, height: 900 });
const rkBlue = await newPage({ width: 1280, height: 900 });
for (const [p, name] of [
  [rkRed, "Rory"],
  [rkBlue, "Bea"],
]) {
  await gotoSettled(p, `${BASE}/battle/play?vs=anyone`);
  await p.locator("label").filter({ hasText: "[Gen 9] Random Battle" }).first().click();
  await p.getByLabel("Your trainer name").fill(name);
  await p.getByTestId("ranked-toggle").check({ force: true });
  await p.getByText(/Unrated: you start at 1000 Elo|GXE/).first().waitFor({ timeout: 15_000 });
}
await rkRed.screenshot({ path: `${OUT}/battle-p1-ranked-setup.png`, fullPage: true });
await rkRed.getByRole("button", { name: /Find an opponent/ }).click();
await rkRed.getByText("Searching for a ranked rival…").waitFor();
await rkBlue.getByRole("button", { name: /Find an opponent/ }).click();
await Promise.all([rkRed.waitForURL(matchedPath, { timeout: 30_000 }), rkBlue.waitForURL(matchedPath, { timeout: 30_000 })]);
await Promise.all([rkRed, rkBlue].map((p) => p.locator("[data-testid=move-button]").first().waitFor({ timeout: 60_000 })));
await rkBlue.getByRole("button", { name: "Forfeit", exact: true }).click();
await rkBlue.getByRole("button", { name: "Forfeit", exact: true }).click();
await rkRed.getByTestId("rating-change").waitFor({ timeout: 45_000 });
const rkChange = await rkRed.getByTestId("rating-change").innerText();
console.log(`  ${rkChange.replace(/\s+/g, " ")}`);
// Elo leads: a first win from 1000 pays 45 (K 90 against an equal). Glicko-2 moves on beneath it.
if (!/Elo\s+1000 → 1045[\s\S]*\+45/i.test(rkChange)) errors.push(`ranked: unexpected Elo change for the winner: ${rkChange}`);
if (!/Glicko-2 1500 → 1[6-9]\d\d \(\+\d+\)/.test(rkChange)) errors.push(`ranked: unexpected Glicko-2 change for the winner: ${rkChange}`);
await rkRed.screenshot({ path: `${OUT}/battle-p1-ranked-result.png` });
await gotoSettled(rkRed, `${BASE}/battle/ladder?format=gen9randombattle`);
await rkRed.getByTestId("ladder-table").getByText("Rory").waitFor({ timeout: 15_000 });
if (!(await rkRed.getByTestId("ladder-table").getByTestId("glicko-badge").count())) errors.push("ladder: no Glicko-2 badge");
// The ladder is ordered by Elo: the winner (1045) sits above the loser (1000, the floor).
const rkElos = await rkRed.getByTestId("ladder-table").getByTestId("ladder-elo").allInnerTexts();
if (rkElos[0] !== "1045" || !rkElos.includes("1000")) errors.push(`ladder: unexpected Elo column: ${rkElos.join(", ")}`);
const rkStanding = await rkRed.getByTestId("your-standing").innerText();
if (!/GXE \d+\.\d%/.test(rkStanding)) errors.push("ladder: your standing shows no GXE");
if (!/1045/.test(rkStanding) || !/1[6-9]\d\d ± \d+/.test(rkStanding)) errors.push(`ladder: your standing shows no Elo or Glicko-2: ${rkStanding}`);
await rkRed.screenshot({ path: `${OUT}/battle-p1-ladder.png`, fullPage: true });
// Team insights follow an account: from the ladder, a guest is asked to sign in.
if (await rkRed.getByTestId("ladder-insights").count()) {
  await rkRed.getByTestId("ladder-insights").click();
  await rkRed.waitForURL(/\/battle\/insights/);
  await rkRed.getByRole("link", { name: "Sign in" }).last().waitFor({ timeout: 15_000 });
} else errors.push("ladder: no link to your insights");
for (const p of [rkRed, rkBlue]) await p.context().close();

// The Battle Lab runs Showdown's simulator in Web Workers, in this browser.
step("battle lab: a quick 1v1, 200 battles, a win % with its confidence interval, a sample replay");
await gotoSettled(page, `${BASE}/battle/lab`);
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

  step("profile: quiz personal bests from the runs played earlier");
  await gotoSettled(page, `${BASE}/u/${username}`);
  await page.getByTestId("profile-quiz-bests").waitFor();
  const bestRows = await page.getByTestId("profile-quiz-best").count();
  if (bestRows < 1) errors.push(`profile: no quiz personal bests after this run's quizzes (${bestRows} rows)`);
  await page.getByTestId("profile-quiz-bests").screenshot({ path: `${OUT}/profile-quiz-bests.png` });
  await gotoSettled(page, `${BASE}/trainer`);
  await page.getByText(`Signed in as`).waitFor();

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
  await gotoSettled(p, `${BASE}/battle`);
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
    await gotoSettled(p, BASE);
    const res = await p.request.post(`${BASE}/api/auth/register`, { data: { username: name, password: "correct horse battery" }, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`register ${name}: ${res.status()}`);
    await p.reload({ waitUntil: "load" });
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
    await fb.reload({ waitUntil: "load" });
  await fb.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await fb.getByTestId("friends-badge").waitFor({ timeout: 15_000 });
    await fb.getByTestId("friends-button").click();
    await fb.getByTestId("incoming-request").filter({ hasText: nameA }).getByRole("button", { name: /Accept/ }).click();
    await fb.getByRole("tab", { name: /Friends/ }).click();
    await fb.getByTestId("friend-row").filter({ hasText: nameA }).waitFor();
    await fb.keyboard.press("Escape");
    await fa.reload({ waitUntil: "load" });
  await fa.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
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
    await gotoSettled(fa, `${BASE}/users`);
    await fa.getByTestId("user-search").fill(nameB.slice(0, 7));
    await fa.getByTestId("user-results").getByRole("link", { name: nameB }).click();
    await fa.waitForURL(new RegExp(`/u/${nameB}$`));
    await fa.getByTestId("friend-status-badge").waitFor({ timeout: 15_000 });
    await fa.screenshot({ path: `${OUT}/profile.png`, fullPage: true });
    const insightsPage = await fa.request.get(`${BASE}/battle/insights/${nameB}`);
    if (insightsPage.status() !== 200 || !/insights/i.test(await insightsPage.text())) errors.push(`team insights page returned ${insightsPage.status()}`);
    const old = await fa.request.get(`${BASE}/battle/player/${nameB}`, { maxRedirects: 0 });
    if (![307, 308].includes(old.status())) errors.push(`/battle/player/<name> didn't redirect (${old.status()})`);
  }
  for (const p of [fa, fb]) await p.context().close();
}

// Profile "About me": fill 3 Pokémon + 2 game slots, see them on the public profile, fetch the share image.
if (me.enabled) {
  step("about me: edit, save, public profile, share image");
  const SCRATCH = "/tmp/claude-0/-home-user-PokeIq/ae145c40-09f4-5dce-9dff-1efa4a6ff4bb/scratchpad";
  const aboutName = `ab${Date.now().toString(36).slice(-7)}`;
  const ap = await newPage({ width: 1280, height: 1100 });
  await gotoSettled(ap, BASE);
  const reg = await ap.request.post(`${BASE}/api/auth/register`, { data: { username: aboutName, password: "correct horse battery" }, headers: { Origin: BASE } });
  if (!reg.ok()) throw new Error(`register ${aboutName}: ${reg.status()}`);
  await gotoSettled(ap, `${BASE}/u/${aboutName}`);
  const aboutAvail = (await (await ap.request.get(`${BASE}/api/profile/about`)).json()).available;
  if (!aboutAvail) console.log("  about me is off on this server: skipped");
  else {
    await ap.getByTestId("about-edit").click();
    const pickMon = async (slot, id) => {
      await ap.getByTestId(`about-slot-${slot}`).click();
      await ap.getByTestId("about-search").fill(String(id));
      await ap.getByTestId(`about-mon-${id}`).click();
    };
    await pickMon("favorite", 25);
    await pickMon("best-mega", 10034);
    await pickMon("best-eeveelution", 134);
    await ap.getByTestId("about-game-favorite-game").selectOption("emerald");
    await ap.getByTestId("about-game-best-region").selectOption("kanto");
    // Favorite Card: search the TCG (fixture in CI) and pick the first hit. Tolerated when the TCG API is unreachable.
    await ap.getByTestId("about-slot-favorite-card").click();
    await ap.getByTestId("about-card-search").fill("Charizard");
    const cardOption = ap.getByTestId("about-card-option").first();
    const pickedCard = await cardOption.waitFor({ timeout: 30_000 }).then(() => true, () => false);
    if (pickedCard) await cardOption.click();
    else console.log("  TCG search unavailable: favorite card skipped");
    await ap.getByTestId("about-save").click();
    await ap.getByTestId("about-pokemon-best-mega").waitFor({ timeout: 30_000 });
    if (pickedCard && !(await ap.getByTestId("about-card-favorite-card").count())) errors.push("about me: the favorite card didn't show after saving");
    // A bad pick is refused by the server.
    const bad = await ap.request.put(`${BASE}/api/profile/about`, { data: { pokemon: { "best-mega": { id: 25, shiny: false } } }, headers: { Origin: BASE } });
    if (bad.status() !== 400) errors.push(`about me: an invalid Mega pick got ${bad.status()}, not 400`);

    // A visitor (signed out) sees the same, with no edit button.
    const visitor = await newPage({ width: 1280, height: 1100 });
    await visitor.goto(`${BASE}/u/${aboutName}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    for (const t of ["about-pokemon-favorite", "about-pokemon-best-mega", "about-pokemon-best-eeveelution", "about-game-view-favorite-game", "about-game-view-best-region", ...(pickedCard ? ["about-card-favorite-card"] : [])]) await visitor.getByTestId(t).waitFor();
    if (pickedCard && !/\/pokedex\/tcg\/card\//.test((await visitor.getByTestId("about-card-favorite-card").locator("a").getAttribute("href")) ?? "")) errors.push("about me: the favorite card doesn't link to its card page");
    if (await visitor.getByTestId("about-pokemon-pet").count()) errors.push("about me: an empty slot shows to viewers");
    if (await visitor.getByTestId("about-edit").count()) errors.push("about me: a visitor sees the edit button");
    await visitor.getByTestId("profile-about").screenshot({ path: `${SCRATCH}/about-me.png` });
    const img = await visitor.request.get(`${BASE}/u/${aboutName}/about-grid`);
    if (img.status() !== 200 || !(img.headers()["content-type"] ?? "").includes("image/png")) errors.push(`about me: share image ${img.status()} ${img.headers()["content-type"]}`);
    else await (await import("node:fs/promises")).writeFile(`${SCRATCH}/about-me-share.png`, await img.body());
    // Every slot filled: the tall share grid.
    const full = {
      pokemon: { favorite: { id: 25 }, "second-favorite": { id: 6 }, "least-favorite": { id: 129 }, underrated: { id: 213 }, overrated: { id: 150 }, "best-starter": { id: 390 }, "best-dynamax": { id: 10196 }, "best-mega": { id: 10034 }, "best-regional": { id: 10103 }, "best-eeveelution": { id: 196 }, pet: { id: 143 }, "best-shiny": { id: 6 }, "idk-why": { id: 39, shiny: true }, "personal-story": { id: 94 }, nostalgic: { id: 150, shiny: true } },
      games: { "favorite-game": "emerald", "least-favorite-game": "sword", "first-game": "red", "nostalgic-game": "heartgold", "best-region": "kanto", "best-soundtrack": "black-2", "underrated-game": "platinum", "gym-leader": "cynthia", rival: "silver", professor: "professor-oak", "villain-team": "team-galactic" },
      cards: { "favorite-card": { id: "base1-4", name: "x" }, "dream-card": { id: "base1-2", name: "x" }, "best-owned-card": { id: "sv1-15", name: "x" }, "overrated-card": { id: "base1-1", name: "x" }, "underrated-card": { id: "base1-3", name: "x" } },
    };
    const fullRes = await ap.request.put(`${BASE}/api/profile/about`, { data: full, headers: { Origin: BASE } });
    if (!fullRes.ok()) errors.push(`about me: full save ${fullRes.status()}`);
    const grid = await ap.request.get(`${BASE}/u/${aboutName}/about-grid`);
    if (grid.status() !== 200 || !(grid.headers()["content-type"] ?? "").includes("image/png")) errors.push(`about me: full grid ${grid.status()}`);
    else await (await import("node:fs/promises")).writeFile(`${SCRATCH}/about-me-share-full.png`, await grid.body());
    await visitor.context().close();
  }
  await ap.context().close();
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
    await gotoSettled(p, BASE);
    const res = await p.request.post(`${BASE}/api/auth/register`, { data: { username: name, password: "correct horse battery" }, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`register ${name}: ${res.status()}`);
    tp.push(p);
  }
  const tourOn = (await (await tp[0].request.get(`${BASE}/api/tournaments`)).json()).available;
  if (!tourOn) console.log("  tournaments are off on this server (migration 0020): skipped");
  else {
    const host = tp[0];
    await gotoSettled(host, `${BASE}/battle/tournaments`);
    await host.getByTestId("tournament-create").waitFor();
    await host.getByLabel("Max players").selectOption("4");
    await host.screenshot({ path: `${OUT}/tournaments-lobby.png` });
    await host.getByRole("button", { name: /Open tournament/ }).click();
    await host.waitForURL(/\/battle\/tournaments\/[a-z2-9]{10}$/);
    const tourUrl = host.url();
    const tourApi = tourUrl.replace("/battle/tournaments/", "/api/tournaments/");
    for (const p of tp) {
      if (p !== host) await gotoSettled(p, tourUrl);
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
          await gotoSettled(p, `${BASE}/battle`);
          await p.getByTestId("match-toast").waitFor({ timeout: 30_000 });
          await p.screenshot({ path: `${OUT}/tournament-toast.png` });
          await p.getByTestId("match-toast").getByRole("button", { name: /Play now/ }).click();
        } else {
          await gotoSettled(p, tourUrl);
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
    await gotoSettled(host, tourUrl);
    await host.getByTestId("tournament-winner").waitFor({ timeout: 30_000 });
    await host.screenshot({ path: `${OUT}/tournament-winner.png`, fullPage: true });
    await gotoSettled(host, `${BASE}/battle/tournaments`);
    await host.getByTestId("tournament-history").filter({ hasText: names[0] }).waitFor({ timeout: 15_000 });
  }

  step("chat rooms: two trainers talk in the Lobby; a swear is masked; a report");
  const [ra, rb] = [tp[1], tp[2]];
  for (const p of [ra, rb]) await gotoSettled(p, `${BASE}/rooms/lobby`);
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
    await gotoSettled(fp, `${BASE}/feedback`);
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
    await gotoSettled(ra, `${BASE}/admin`);
    if (!(await ra.getByText("A wild 404 appeared!").isVisible()) || (await ra.getByText("Moderation desk").count())) errors.push("/admin isn't hidden from a trainer who isn't an admin");
    if ((await ra.request.get(`${BASE}/api/admin?tab=audit`)).status() !== 404) errors.push("/api/admin answered a trainer who isn't an admin");
    if (!admin) console.log("  E2E_ADMIN not set: moderation steps skipped");
    else {
      step("moderation: an admin mutes a trainer, who then can't post");
      const desk = tp[0];
      await gotoSettled(desk, `${BASE}/admin`);
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

step("mobile: Pikadoku's whole grid fits a 390px phone without sideways scrolling");
{
  const phone = await newPage({ width: 390, height: 844 });
  await gotoSettled(phone, `${BASE}/pikadoku`);
  await closeHowTo(phone);
  await phone.getByTestId("pdk-row-0").filter({ hasNotText: "…" }).waitFor();
  const fit = await phone.evaluate(() => {
    const last = document.querySelector("[data-testid=pdk-cell-8]").getBoundingClientRect();
    const nav = [...document.querySelectorAll("nav")].map((n) => n.getBoundingClientRect()).filter((r) => r.top > window.innerHeight / 2)[0];
    return { bottom: last.bottom, limit: nav ? nav.top : window.innerHeight, wide: document.documentElement.scrollWidth - window.innerWidth };
  });
  if (fit.bottom > fit.limit) errors.push(`Pikadoku's grid runs under the fold on a phone (${Math.round(fit.bottom)} > ${Math.round(fit.limit)})`);
  if (fit.wide > 0) errors.push(`Pikadoku scrolls sideways on a phone by ${fit.wide}px`);
  await phone.screenshot({ path: `${OUT}/pikadoku-mobile.png` });
  await phone.context().close();
}

step("name 'em all: hub, a Gen 1 run (aliases, wrong category, pause, give up), share, a ranked clear, the daily, a race");
{
  const np = await newPage({ width: 1280, height: 900 });
  await gotoSettled(np, `${BASE}/play`);
  await np.getByTestId("play-name-em-all").click();
  await np.waitForURL(/\/quiz\/name-em-all$/);
  await np.getByTestId("nea-categories").waitFor();
  await np.getByTestId("nea-cat-gen-1").click();
  await np.waitForURL(/\/quiz\/name-em-all\/gen-1$/);
  await np.getByTestId("nea-start").click();
  const box = np.getByTestId("nea-input");
  await box.waitFor();
  // Names count the moment they're spelled right, however they're written; Mew keeps its text so Mewtwo can follow.
  for (const n of ["bulbasaur", "MR. MIME", "nidoran f", "farfetchd", "mew"]) await box.pressSequentially(n, { delay: 10 });
  if ((await box.inputValue()) !== "mew") errors.push(`name 'em all: "mew" should stay in the box for Mewtwo, got "${await box.inputValue()}"`);
  await box.pressSequentially("two", { delay: 10 });
  if (await box.inputValue()) errors.push("name 'em all: the box didn't clear after Mewtwo");
  const counted = await np.getByTestId("nea-count").filter({ hasText: /^6\s*\/\s*151$/ }).waitFor({ timeout: 5_000 }).then(() => true, () => false);
  if (!counted) errors.push(`name 'em all: expected 6 / 151, saw ${await np.getByTestId("nea-count").textContent()}`);
  await box.pressSequentially("chikorita", { delay: 10 });
  await np.getByText("Chikorita isn't in Gen 1.").waitFor({ timeout: 3_000 }).catch(() => errors.push("name 'em all: no 'not in this category' note"));
  await box.fill("");
  await np.getByTestId("nea-pause").click();
  await np.getByTestId("nea-paused").waitFor();
  if (!(await box.isDisabled())) errors.push("name 'em all: the box stays usable while paused");
  await np.getByTestId("nea-resume").click();
  await np.screenshot({ path: `${OUT}/name-em-all-playing.png` });
  await np.getByTestId("nea-giveup").click();
  await np.getByTestId("nea-giveup-confirm").click();
  await np.getByTestId("nea-results").waitFor();
  if ((await np.getByTestId("nea-final").textContent())?.trim() !== "6/151") errors.push("name 'em all: the result isn't 6/151");
  const missed = await np.getByTestId("nea-missed").count();
  if (missed !== 145) errors.push(`name 'em all: expected 145 missed slots linked, got ${missed}`);
  if ((await np.getByTestId("nea-missed").first().getAttribute("href")) !== "/pokemon/ivysaur") errors.push("name 'em all: a missed slot doesn't link to its Pokédex page");
  await np.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await np.getByTestId("nea-share").click();
  await np.getByText(/Copied!|Couldn.t copy/).first().waitFor({ timeout: 5_000 });
  await np.screenshot({ path: `${OUT}/name-em-all-results.png` });

  // No leaderboard: a clean Ultra Beasts clear (Regular, no hints) by a signed-in trainer is kept as their personal best,
  // and shows on their profile. Without accounts on this server the result just says to sign in.
  const neaName = `nea${Date.now().toString(36).slice(-7)}`;
  const neaSignedIn = me.enabled && (await np.request.post(`${BASE}/api/auth/register`, { data: { username: neaName, password: "correct horse battery" }, headers: { Origin: BASE } })).ok();
  const ub = ["nihilego", "buzzwole", "pheromosa", "xurkitree", "celesteela", "kartana", "guzzlord", "poipole", "naganadel", "stakataka", "blacephalon"];
  await gotoSettled(np, `${BASE}/quiz/name-em-all/ultra-beasts`);
  if (await np.getByTestId("nea-board").count()) errors.push("name 'em all: the setup still shows a leaderboard");
  await np.getByTestId("nea-start").click();
  for (const n of ub) {
    await np.getByTestId("nea-input").pressSequentially(n, { delay: 40 });
    await np.waitForTimeout(150);
  }
  await np.getByTestId("nea-results").waitFor();
  if (neaSignedIn) {
    await np.getByTestId("nea-saved").waitFor({ timeout: 8_000 }).catch(() => errors.push("name 'em all: a clean clear wasn't kept as a personal best"));
    await gotoSettled(np, `${BASE}/u/${neaName}`);
    await np.getByTestId("profile-nea-best").filter({ hasText: "11/11" }).waitFor({ timeout: 8_000 }).catch(() => errors.push("name 'em all: the profile doesn't show the best"));
    await np.getByTestId("profile-quiz-bests").screenshot({ path: `${OUT}/profile-nea-bests.png` });
  } else {
    await np.getByTestId("nea-sign-in").waitFor({ timeout: 8_000 }).catch(() => errors.push("name 'em all: no sign-in note for a personal best"));
  }
  if (await np.getByTestId("nea-board").count()) errors.push("name 'em all: a leaderboard is still shown");

  await gotoSettled(np, `${BASE}/quiz/name-em-all/daily`);
  await np.getByTestId("nea-setup").waitFor({ timeout: 10_000 });

  // Race: two trainers; the host names all eleven Ultra Beasts and wins.
  const guestRace = await newPage({ width: 390, height: 844 });
  await gotoSettled(np, `${BASE}/quiz/name-em-all`);
  await np.getByLabel("Race category").selectOption("ultra-beasts");
  await np.getByLabel("Race length").selectOption("3");
  // The ranked clear used to name the host; with no leaderboard it's typed here.
  await np.getByLabel("Your trainer name").first().fill("Red");
  await clickUntilUrl(np, np.getByTestId("nea-race-start"), /\/quiz\/name-em-all\/race\//);
  await np.getByTestId("nea-race-lobby").waitFor();
  await gotoSettled(guestRace, np.url());
  await guestRace.getByLabel("Your trainer name").fill("Blue");
  await guestRace.getByTestId("nea-race-join").click();
  await guestRace.getByTestId("nea-race-ready").click();
  await np.locator("[data-testid=nea-race-begin]:enabled").waitFor({ timeout: 15_000 });
  await np.getByTestId("nea-race-begin").click();
  await np.getByTestId("nea-race").waitFor({ timeout: 15_000 });
  await guestRace.getByTestId("nea-race").waitFor({ timeout: 15_000 });
  await guestRace.getByTestId("nea-input").pressSequentially("kartana", { delay: 30 });
  await guestRace.waitForTimeout(1_500);
  for (const n of ub) {
    await np.getByTestId("nea-input").pressSequentially(n, { delay: 40 });
    await np.waitForTimeout(200);
  }
  await np.getByTestId("nea-race-result").waitFor({ timeout: 15_000 });
  await guestRace.getByTestId("nea-race-result").waitFor({ timeout: 15_000 });
  if (!(await guestRace.getByText("Red wins!").isVisible())) errors.push("name 'em all race: the guest doesn't see Red win");
  const guestBar = guestRace.getByTestId("nea-race-bar").filter({ hasText: "Blue" });
  if (!/1\/11/.test((await guestBar.textContent()) ?? "")) errors.push("name 'em all race: the guest's name didn't reach the race");
  await guestRace.screenshot({ path: `${OUT}/name-em-all-race-result.png` });
  await guestRace.context().close();
  await np.context().close();
}

/** Which Pokémon Are You?: the quiz end to end at 1440 and 390, the result page, the story share card and a compare link. */
async function whichPokemonStep() {
  step("which pokémon are you: quiz, result, share card, compare (1440 and 390)");
  const payloads = [];
  for (const [width, height, tag] of [
    [1440, 900, "1440"],
    [390, 844, "390"],
  ]) {
    const p = await newPage({ width, height });
    await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoSettled(p, `${BASE}/quiz/which-pokemon`);
    if (await p.locator("main").getByText(/how it works|FAQ|how to play/i).count()) errors.push("which pokémon: the quiz page shows how-to text");
    await p.getByTestId("wp-start").click();
    await p.getByTestId("wp-question").waitFor();
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/which-pokemon-question-${tag}.png` });
    for (let i = 0; i < 20; i++) {
      const answers = p.getByTestId("wp-answer");
      if (!(await answers.count())) break;
      const box = await answers.first().boundingBox();
      if (box && box.height < 44) errors.push(`which pokémon: answer buttons are ${box.height}px tall at ${tag}`);
      await answers.nth(tag === "390" ? (i * 3) % 5 : (i * 2 + 1) % 5).click();
      if (/\/quiz\/which-pokemon\/[a-z0-9-]+#r=/.test(p.url())) break;
      await p.waitForTimeout(60);
    }
    await p.waitForURL(/\/quiz\/which-pokemon\/[a-z0-9-]+#r=/, { timeout: 15_000 });
    await p.getByTestId("wp-result").waitFor({ timeout: 15_000 });
    payloads.push(p.url().split("#r=")[1]);
    if ((await p.getByTestId("wp-runner-up").count()) !== 2) errors.push("which pokémon: expected two runners-up");
    for (const id of ["wp-deep-cut", "wp-partner", "wp-rival", "wp-traits", "wp-blurb"]) {
      if (!(await p.getByTestId(id).count())) errors.push(`which pokémon: the result has no ${id}`);
    }
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${OUT}/which-pokemon-result-${tag}.png`, fullPage: true });
    await p.getByTestId("share-result").click();
    await p.getByText(/Copied!|Shared!|Couldn.t copy/).first().waitFor({ timeout: 5_000 }).catch(() => errors.push("which pokémon: the share button didn't copy"));
    await p.getByTestId("wp-compare").click();
    await p.getByText("Link copied!").waitFor({ timeout: 5_000 }).catch(() => errors.push("which pokémon: the compare link didn't copy"));
    const cardUrl = await p.getByTestId("wp-card").getAttribute("href");
    const card = await p.goto(`${BASE}${cardUrl}`);
    if (!card || card.status() !== 200 || !/image\/png/.test(card.headers()["content-type"] ?? "")) errors.push(`which pokémon: the share card returned ${card?.status()}`);
    await p.screenshot({ path: `${OUT}/which-pokemon-card-${tag}.png` });
    await p.context().close();
  }
  // The compare link: one result invites a friend; two show side by side with a compatibility score.
  const p = await newPage({ width: 1440, height: 900 });
  await gotoSettled(p, `${BASE}/quiz/which-pokemon/compare#a=${payloads[0]}`);
  await p.getByTestId("wp-compare-invite").waitFor({ timeout: 10_000 }).catch(() => errors.push("which pokémon: a one-sided compare link doesn't invite"));
  await gotoSettled(p, `${BASE}/quiz/which-pokemon/compare#a=${payloads[0]}&b=${payloads[1]}`);
  await p.getByTestId("wp-compare-result").waitFor({ timeout: 10_000 });
  const pct = ((await p.getByTestId("wp-compat").textContent()) ?? "").trim();
  if (!/^\d{1,3}%$/.test(pct)) errors.push(`which pokémon: compatibility reads "${pct}"`);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/which-pokemon-compare-1440.png`, fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/which-pokemon-compare-390.png`, fullPage: true });
  await p.context().close();
}
await whichPokemonStep();

step("mobile: home + daily");
const mobile = await newPage({ width: 393, height: 852 });
await gotoSettled(mobile, BASE);
await mobile.screenshot({ path: `${OUT}/mobile-home.png` });
await gotoSettled(mobile, `${BASE}/daily`);
await mobile.getByRole("button", { name: /Start Daily/ }).click();
await mobile.waitForSelector("h2");
await mobile.waitForTimeout(900);
await mobile.screenshot({ path: `${OUT}/mobile-daily.png` });
await gotoSettled(mobile, `${BASE}/pokedle`);
await closeHowTo(mobile);
await mobile.screenshot({ path: `${OUT}/mobile-pokedle.png` });

step("discord: unsigned interaction is rejected");
const unsigned = await fetch(`${BASE}/api/discord`, { method: "POST", body: JSON.stringify({ type: 1 }) });
if (unsigned.status !== 401) errors.push(`POST /api/discord without signature returned ${unsigned.status}, expected 401`);

await finish();

async function finish() {
  await browser.close();
  if (errors.length > 0) {
    console.error(`✗ ${errors.length} error(s):`);
    errors.forEach((e) => console.error("  ", e));
    process.exit(1);
  }
  console.log(`✓ smoke test passed — screenshots in ${OUT}/`);
  process.exit(0);
}
