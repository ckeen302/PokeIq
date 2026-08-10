/**
 * Browser + API smoke test (Playwright).
 *
 * 1. API contract: status codes, Zod rejections, and a check that sealed
 *    questions never leak correctAnswer/explanation to the client.
 * 2. Page sweep on desktop (1280×900) and mobile (393×852): home,
 *    leaderboard, all four quiz modules (answering one question each).
 * 3. Full run: complete a 10-question classic quiz, submit a leaderboard
 *    score, and verify it appears on /leaderboard.
 * 4. Survival smoke: start a survival run, answer one question, check lives.
 *
 * Fails on any console error, page error, or assertion.
 *
 *   BASE_URL=http://localhost:3000 npm run verify:e2e
 * (starts `next start` automatically when BASE_URL is not set — run
 *  `npm run build` first in that case)
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const CATEGORIES = [
  "whos-that",
  "type-detective",
  "move-master",
  "stat-showdown",
];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 393, height: 852 },
];

const externalBase = process.env.BASE_URL;
let server = null;
const baseUrl = externalBase ?? "http://localhost:3100";
const failures = [];

function fail(section, message) {
  failures.push({ section, message });
  console.log(`  ❌ ${message}`);
}

function pass(message) {
  console.log(`  ✅ ${message}`);
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become ready`);
}

async function startServer() {
  if (externalBase) return;
  server = spawn("npx", ["next", "start", "-p", "3100"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", (d) => process.stderr.write(d));
  await waitForServer(baseUrl);
}

/* ------------------------------------------------------------------ */
/* 1. API contract                                                     */
/* ------------------------------------------------------------------ */

async function expectStatus(section, method, path, expected, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === expected) {
    pass(`${method} ${path} → ${expected}`);
  } else {
    fail(section, `${method} ${path} → ${res.status}, expected ${expected}`);
  }
  return res;
}

async function apiContract() {
  console.log("\nAPI contract");
  const section = "api";

  await expectStatus(section, "GET", "/api/questions/not-a-category", 404);
  await expectStatus(section, "GET", "/api/questions/whos-that?difficulty=bogus", 400);
  await expectStatus(section, "POST", "/api/questions/whos-that", 400, {
    nonsense: true,
  });
  await expectStatus(section, "POST", "/api/questions/whos-that", 410, {
    token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    answer: "Pikachu",
  });
  await expectStatus(section, "GET", "/api/leaderboard?category=bogus", 400);
  await expectStatus(section, "GET", "/api/leaderboard?category=whos-that", 200);
  await expectStatus(section, "POST", "/api/leaderboard", 400, {
    name: "",
    category: "whos-that",
    score: -5,
  });
  await expectStatus(section, "POST", "/api/leaderboard", 201, {
    name: "Contract Bot",
    category: "stat-showdown",
    score: 42,
    streak: 3,
    difficulty: "survival",
  });

  // Auth backend: register → me → wrong login → logout lifecycle.
  const authUser = `e2e_${Date.now().toString(36)}`;
  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: authUser, password: "pikachu123" }),
  });
  const cookie = registerRes.headers.get("set-cookie")?.split(";")[0] ?? "";
  const registerData = await registerRes.json().catch(() => ({}));
  const recoveryCode = registerData.recoveryCode ?? "";
  if (
    registerRes.status !== 201 ||
    !cookie.includes("pokeiq_session") ||
    !/^[A-Z2-9-]{16,22}$/.test(recoveryCode)
  ) {
    fail(section, `register → ${registerRes.status} (cookie: ${!!cookie}, code: ${recoveryCode})`);
  } else {
    pass(`POST /api/auth/register → 201 + session cookie + recovery code`);
  }
  await expectStatus(section, "POST", "/api/auth/register", 409, {
    username: authUser,
    password: "pikachu123",
  });
  await expectStatus(section, "POST", "/api/auth/register", 400, {
    username: "x",
    password: "short",
  });
  await expectStatus(section, "POST", "/api/auth/login", 401, {
    username: authUser,
    password: "wrong-password",
  });
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie },
  });
  const meData = await meRes.json();
  if (meData.user?.username !== authUser) {
    fail(section, `/api/auth/me did not return the registered user`);
  } else {
    pass("GET /api/auth/me → session resolves to the registered user");
  }
  // Stats: guests rejected; authed run recorded and aggregated.
  await expectStatus(section, "POST", "/api/stats", 401, {
    category: "whos-that",
    mode: "classic",
    score: 100,
    correctCount: 8,
    totalQuestions: 10,
    bestStreak: 5,
  });
  const statsRes = await fetch(`${baseUrl}/api/stats`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      category: "whos-that",
      mode: "classic",
      score: 120,
      correctCount: 8,
      totalQuestions: 10,
      bestStreak: 5,
    }),
  });
  const statsData = await statsRes.json();
  if (
    statsRes.status !== 200 ||
    statsData.stats?.gamesPlayed !== 1 ||
    statsData.stats?.totalScore !== 120 ||
    typeof statsData.rank?.rank !== "number"
  ) {
    fail(section, `authed /api/stats did not aggregate+rank (${statsRes.status})`);
  } else {
    pass("POST /api/stats → guest 401, authed run aggregated + global rank");
  }

  // Recovery-code regeneration: guests rejected, signed-in users get a code.
  await expectStatus(section, "POST", "/api/auth/recovery-code", 401);
  const regenRes = await fetch(`${baseUrl}/api/auth/recovery-code`, {
    method: "POST",
    headers: { cookie },
  });
  const regenData = await regenRes.json().catch(() => ({}));
  if (regenRes.status !== 200 || !/^[A-Z2-9-]{16,22}$/.test(regenData.recoveryCode ?? "")) {
    fail(section, `recovery-code regen → ${regenRes.status}`);
  } else {
    pass("POST /api/auth/recovery-code → fresh code for signed-in user");
  }
  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { cookie },
  });
  const meAfter = await (
    await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } })
  ).json();
  if (logoutRes.status !== 200 || meAfter.user !== null) {
    fail(section, "logout did not destroy the server session");
  } else {
    pass("POST /api/auth/logout → server session destroyed");
  }

  // Account recovery: bad code rejected; real code recovers the username,
  // resets the password, rotates the code, and revokes old sessions.
  await expectStatus(section, "POST", "/api/auth/recover", 401, {
    recoveryCode: "AAAA-AAAA-AAAA-AAAA",
    newPassword: "newpassword123",
  });
  const loginBefore = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: authUser, password: "pikachu123" }),
  });
  const preCookie = loginBefore.headers.get("set-cookie")?.split(";")[0] ?? "";
  // Use the freshest code — the regen above invalidated the original.
  const liveCode = regenData.recoveryCode ?? recoveryCode;
  const recoverRes = await fetch(`${baseUrl}/api/auth/recover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recoveryCode: liveCode, newPassword: "raichu456789" }),
  });
  const recoverData = await recoverRes.json().catch(() => ({}));
  const oldPasswordRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: authUser, password: "pikachu123" }),
  });
  const newPasswordRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: authUser, password: "raichu456789" }),
  });
  const preSessionAfter = await (
    await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: preCookie } })
  ).json();
  if (
    recoverRes.status !== 200 ||
    recoverData.user?.username !== authUser ||
    recoverData.recoveryCode === liveCode ||
    !recoverData.recoveryCode
  ) {
    fail(section, `recover → ${recoverRes.status} (rotated: ${recoverData.recoveryCode !== recoveryCode})`);
  } else if (oldPasswordRes.status !== 401 || newPasswordRes.status !== 200) {
    fail(
      section,
      `recovered password state wrong (old: ${oldPasswordRes.status}, new: ${newPasswordRes.status})`,
    );
  } else if (preSessionAfter.user !== null) {
    fail(section, "recovery did not revoke pre-existing sessions");
  } else {
    pass(
      "POST /api/auth/recover → username returned, password reset, code rotated, sessions revoked",
    );
  }

  // Daily Gauntlet: sealed, stable within the day, verify endpoint guarded.
  const daily1 = await fetch(`${baseUrl}/api/daily`);
  if (!daily1.ok) {
    fail(section, `GET /api/daily → ${daily1.status}`);
  } else {
    const a = await daily1.json();
    const b = await (await fetch(`${baseUrl}/api/daily`)).json();
    const sameQuestions =
      JSON.stringify(a.questions.map((q) => q.question)) ===
      JSON.stringify(b.questions.map((q) => q.question));
    if (!sameQuestions) {
      fail(section, "daily questions differ between requests on the same day");
    } else if (!a.dayNumber || !a.endsAt || a.questions.length < 6) {
      fail(section, "daily response missing dayNumber/endsAt or too few questions");
    } else if (a.questions.some((q) => "correctAnswer" in q || "explanation" in q)) {
      fail(section, "ANSWER LEAK in daily payload");
    } else {
      pass(
        `GET /api/daily → stable ${a.questions.length}-question gauntlet #${a.dayNumber}, no leaks`,
      );
    }
  }
  await expectStatus(section, "POST", "/api/daily", 410, {
    token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    answer: "Pikachu",
  });

  // Sealed questions must never leak answers.
  const res = await fetch(
    `${baseUrl}/api/questions/stat-showdown?count=3&difficulty=easy`,
  );
  if (!res.ok) {
    fail(section, `question generation failed: ${res.status}`);
    return;
  }
  const data = await res.json();
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    fail(section, "no questions in generation response");
    return;
  }
  let leaky = false;
  for (const q of data.questions) {
    if ("correctAnswer" in q || "explanation" in q) leaky = true;
    if (typeof q.token !== "string" || q.token.length < 20) {
      fail(section, "question missing sealed answer token");
    }
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
      fail(section, "question has invalid option count");
    }
  }
  if (leaky) {
    fail(section, "ANSWER LEAK: correctAnswer/explanation present in client payload");
  } else {
    pass(`sealed questions leak nothing (${data.questions.length} checked)`);
  }
}

/* ------------------------------------------------------------------ */
/* 2. Page sweep                                                       */
/* ------------------------------------------------------------------ */

async function checkPage(context, viewportName, path, interact) {
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  try {
    const res = await page.goto(`${baseUrl}${path}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (!res || !res.ok()) {
      throw new Error(`HTTP ${res ? res.status() : "no response"}`);
    }
    if (interact) await interact(page);
  } catch (error) {
    errors.push(`navigation/interaction: ${error.message}`);
  }

  if (errors.length > 0) {
    fail(viewportName, `${path}: ${errors.join(" | ")}`);
  } else {
    pass(path);
  }
  await page.close();
  return errors.length === 0;
}

async function answerOneQuestion(page) {
  await page.getByRole("button", { name: /mixed/i }).click({ timeout: 15_000 });
  const option = page.locator('[role="listbox"] button').first();
  await option.waitFor({ state: "visible", timeout: 90_000 });
  await option.click();
  await page.getByRole("status").waitFor({ state: "visible", timeout: 20_000 });
}

/* ------------------------------------------------------------------ */
/* 3. Full classic run + leaderboard round-trip                        */
/* ------------------------------------------------------------------ */

async function fullRun(context) {
  console.log("\nFull classic run (10 questions + leaderboard)");
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  try {
    await page.goto(`${baseUrl}/quiz/type-detective`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: /easy/i }).click({ timeout: 15_000 });

    for (let i = 0; i < 10; i++) {
      const option = page.locator('[role="listbox"] button').first();
      await option.waitFor({ state: "visible", timeout: 90_000 });
      await option.click();
      const nextButton = page.getByRole("button", {
        name: /next question|see results/i,
      });
      await nextButton.waitFor({ state: "visible", timeout: 20_000 });
      const label = await nextButton.textContent();
      await nextButton.click();
      if (/see results/i.test(label ?? "")) break;
    }

    await page.getByText("Run review").waitFor({ timeout: 20_000 });
    pass("completed a full quiz and reached results");

    // First finished run in a fresh browser context → Boulder Badge toast.
    await page.getByText(/Boulder Badge/i).waitFor({ timeout: 10_000 });
    pass("gym badge unlock toast appeared");

    await page.getByLabel("Trainer name for leaderboard").fill("E2E Bot");
    await page.getByRole("button", { name: /save score/i }).click();
    await page.getByText(/score saved/i).waitFor({ timeout: 15_000 });
    pass("score submitted");

    await page.goto(`${baseUrl}/leaderboard`, { waitUntil: "domcontentloaded" });
    await page.getByText("E2E Bot").first().waitFor({ timeout: 15_000 });
    pass("score visible on leaderboard");
  } catch (error) {
    fail("full-run", error.message);
  }
  if (errors.length) fail("full-run", errors.join(" | "));
  await page.close();
}

/* ------------------------------------------------------------------ */
/* 4. Survival smoke                                                   */
/* ------------------------------------------------------------------ */

/** Daily Gauntlet: start it and answer one question. */
async function dailySmoke(context) {
  console.log("\nDaily Gauntlet smoke");
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/daily`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: /start today/i })
      .click({ timeout: 15_000 });
    const option = page.locator('[role="listbox"] button').first();
    await option.waitFor({ state: "visible", timeout: 90_000 });
    await option.click();
    await page.getByRole("status").waitFor({ state: "visible", timeout: 20_000 });
    pass("daily gauntlet plays and verifies answers");
  } catch (error) {
    fail("daily", error.message);
  }
  await page.close();
}

/** Auth in the browser: create account → header shows name → sign out. */
async function authFlow(context) {
  console.log("\nAccount flow (browser)");
  const page = await context.newPage();
  const username = `trainer_${Date.now().toString(36)}`;
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /create account/i }).click();
    await page.getByLabel(/trainer name/i).fill(username);
    await page.getByLabel(/password/i).fill("thunderbolt99");
    await page.getByRole("button", { name: /start your journey/i }).click();
    // Signup shows the one-time recovery code; acknowledge and continue.
    await page
      .getByText(/recovery code/i)
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    pass("signup reveals a one-time recovery code");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /let's go/i }).click();
    // Lands home; the header user menu should show the account name.
    await page
      .getByTitle(`Signed in as ${username}`)
      .waitFor({ state: "visible", timeout: 15_000 });
    pass("account created — header shows the signed-in trainer");
    // Profile page: identity, rank section and recovery-code regeneration.
    await page.goto(`${baseUrl}/trainer`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: username })
      .waitFor({ state: "visible", timeout: 15_000 });
    await page
      .getByRole("button", { name: /generate new recovery code/i })
      .click();
    await page
      .getByTitle(/copy recovery code/i)
      .waitFor({ state: "visible", timeout: 10_000 });
    pass("trainer profile shows identity and mints a new recovery code");
    await page.getByRole("button", { name: /sign out/i }).click();
    await page
      .getByRole("link", { name: /sign in/i })
      .waitFor({ state: "visible", timeout: 10_000 });
    pass("sign out returns the header to guest state");
  } catch (error) {
    fail("auth-flow", error.message);
  }
  await page.close();
}

async function survivalSmoke(context) {
  console.log("\nSurvival mode smoke");
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/quiz/move-master`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: /survival/i }).click({ timeout: 15_000 });
    const option = page.locator('[role="listbox"] button').first();
    await option.waitFor({ state: "visible", timeout: 90_000 });
    const lives = page.getByLabel(/lives remaining/);
    await lives.waitFor({ state: "visible", timeout: 5_000 });
    await option.click();
    await page.getByRole("status").waitFor({ state: "visible", timeout: 20_000 });
    pass("survival run starts with lives and verifies answers");
  } catch (error) {
    fail("survival", error.message);
  }
  await page.close();
}

/* ------------------------------------------------------------------ */

async function main() {
  await startServer();
  await apiContract();

  const browser = await chromium.launch();

  for (const viewport of VIEWPORTS) {
    console.log(`\n${viewport.name} (${viewport.width}×${viewport.height})`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    await checkPage(context, viewport.name, "/");
    await checkPage(context, viewport.name, "/leaderboard");
    await checkPage(context, viewport.name, "/daily");
    await checkPage(context, viewport.name, "/login");
    await checkPage(context, viewport.name, "/trainer");
    for (const category of CATEGORIES) {
      await checkPage(
        context,
        viewport.name,
        `/quiz/${category}`,
        answerOneQuestion,
      );
    }
    await context.close();
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await fullRun(context);
  await survivalSmoke(context);
  await dailySmoke(context);
  await authFlow(context);
  await context.close();

  await browser.close();
  if (server) server.kill();

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll smoke checks passed.");
}

main().catch((error) => {
  console.error("e2e-smoke crashed:", error);
  if (server) server.kill();
  process.exit(1);
});
