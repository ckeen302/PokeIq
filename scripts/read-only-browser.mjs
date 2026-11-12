/**
 * Shared by the read-only checks against a live site (launch-check.mjs,
 * live-load-check.mjs): the main routes, the dailies' first inputs (never
 * submitted), and the request blocking that keeps a browser read-only.
 */

/**
 * The main routes and what must show on each: `key` is a selector that must be
 * visible; `input` (the dailies) gives the board a first input and checks it
 * took, without submitting. `share` routes are checked for a share image.
 */
export const ROUTES = [
  { path: "/", key: '[data-testid="home-hero"]' },
  { path: "/daily", key: "main h1" },
  { path: "/play", key: "main h1" },
  { path: "/pokedle", key: 'input[aria-label^="Guess a Pokémon"]', input: pokedleInput },
  { path: "/pikadoku", key: '[data-testid="pdk-cell-0"]', input: pikadokuInput },
  { path: "/connections", key: '[data-testid="conn-grid"]', input: connectionsInput },
  { path: "/guessr", key: '[data-testid="geo-daily-card"]', input: guessrInput },
  { path: "/battle", key: "main h1" },
  { path: "/pokedex", key: "main h1" },
  { path: "/pokemon/pikachu", key: "main h1" },
  { path: "/lab", key: '[data-testid="lab-page"]' },
  { path: "/iq-test", key: "main h1" },
  { path: "/quiz/which-pokemon", key: "main h1" },
  { path: "/quiz/name-em-all", key: "main h1" },
  { path: "/leaderboard", key: "main h1" },
  { path: "/atlas", key: "main" },
  { path: "/rooms", key: "main h1" },
  { path: "/privacy", key: "main h1" },
];

export const PROFILES = [
  { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: "desktop", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

/** Closes a first-visit how-to with "Let's play!" (page state only; nothing is sent). */
export async function closeHowTo(page) {
  const play = page.getByTestId("howto-play").first();
  if (await play.isVisible().catch(() => false)) {
    await play.click();
    await page.getByTestId("howto-sheet").first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

/** Types a few letters: the Pokédex suggestions must open. Nothing is picked. */
async function pokedleInput(page) {
  const input = page.getByLabel("Guess a Pokémon").first();
  await input.fill("pika");
  await page.locator("[role=option]").first().waitFor({ timeout: 10_000 });
  await input.fill("");
}

/** Opens the first square's search and types: suggestions must show. Nothing is picked. */
async function pikadokuInput(page) {
  await page.getByTestId("pdk-cell-0").click();
  const search = page.getByTestId("pdk-search");
  await search.fill("pika");
  await page.locator('[data-testid^="pdk-option-"]').first().waitFor({ timeout: 10_000 });
  await page.keyboard.press("Escape");
}

/** Selects a tile (it must show as pressed), then deselects it. Submit is never pressed. */
async function connectionsInput(page) {
  const tile = page.getByTestId("conn-tile").first();
  await tile.click();
  if ((await tile.getAttribute("aria-pressed")) !== "true") throw new Error("a tapped tile didn't select");
  await tile.click();
}

/** The Daily's Play button is ready; "Set up a game" opens the solo setup (a view change only, no game is started). */
async function guessrInput(page) {
  const play = page.getByTestId("geo-daily-card").getByRole("button").first();
  await play.waitFor();
  if (!(await play.isEnabled())) throw new Error("the Daily's Play button is disabled");
  await page.getByTestId("geo-solo-setup").click();
  await page.getByRole("button", { name: /-round game/ }).first().waitFor({ timeout: 10_000 });
}

/**
 * Read-only: GET, HEAD and CORS preflights go out; anything else (a score, a
 * sign-up, an analytics beacon, a presence ping) is stopped before it is
 * sent. `blocked` collects the stopped URLs, `stopped` counts them by
 * "METHOD /path".
 */
export async function readOnly(context, blocked, stopped) {
  await context.route("**/*", (r) => {
    const method = r.request().method();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return r.continue();
    blocked.add(r.request().url());
    const key = `${method} ${new URL(r.request().url()).pathname}`;
    stopped.set(key, (stopped.get(key) ?? 0) + 1);
    return r.abort("blockedbyclient");
  });
}
