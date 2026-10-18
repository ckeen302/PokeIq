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
for (const name of ["Pikachu", "Charizard", "Gengar"]) {
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
