/**
 * Triples, Free-For-All and Multi Battles in the browser: a Triples battle
 * against the computer played to the end (team preview, three leads, aimed
 * moves, out-of-reach spots greyed), a Free-For-All against three computer
 * trainers to its final standings, a Multi Battle with a computer partner to
 * its team result, and a live four-player Free-For-All room: four browsers
 * join by link, a fifth watches from /battle/watch, and the battle ends with
 * every trainer and the spectator seeing the standings.
 * Screenshots at 1440 and 390 px. Each part records a failure instead of
 * stopping the rest of the smoke test.
 *
 *   node scripts/e2e-battle-group.mjs http://localhost:3000 [screenshot dir]
 */
import fs from "fs";

async function part(errors, name, fn) {
  // E2E_GROUP_ONLY=live (or triples, ffa, multi): run just the parts whose name starts with it.
  const only = process.env.E2E_GROUP_ONLY;
  if (only && !name.startsWith(only)) return;
  try {
    await fn();
  } catch (e) {
    errors.push(`battle group (${name}): ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

const WAIT = 120_000;

/** A page that records console errors and never leaks a hidden channel. */
async function open(browser, viewport, errors, label, { css = false } = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((css) => {
    // Five pages at once: all but one keep the arena's CSS backdrop, so the WebGL scenes don't starve the machine.
    if (css) sessionStorage.setItem("pokeiq:battle:arena-slow", "1");
    sessionStorage.setItem("pokeiq-splash", "1");
    localStorage.setItem("pokeiq-muted", "1");
    // The battle log's animations off: each step lands at once (a whole battle in seconds).
    localStorage.setItem("pokeiq:battle:animations", "off");
  }, css);
  const page = await context.newPage();
  page.setDefaultTimeout(WAIT);
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource|WebGL|GPU stall/i.test(msg.text())) errors.push(`[${label} ${page.url()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${label} ${page.url()}] PAGEERROR: ${err.message}`));
  page.on("response", async (res) => {
    if (!/\/api\/battle(\/[a-z2-9]{8})?(\?|$)/.test(res.url())) return;
    const text = await res.text().catch(() => "");
    if (/"(state|inputLog|seed|input_log)"|\|request\||\|split\|/.test(text)) errors.push(`${label}: hidden battle data leaked: ${text.slice(0, 160)}`);
  });
  return page;
}

async function noSideways(page, errors, where) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (over) errors.push(`battle group: ${where} scrolls sideways at ${page.viewportSize().width} px`);
}

/**
 * What a battle page with nothing to press is showing, on one line, with a
 * full-page picture of it at `shot`: the turn, the line under the controls
 * (sending, the computer thinking, the turn playing), the latest message,
 * any alert, a target grid's title and the buttons on the page (greyed ones
 * marked). A page too busy to answer says so.
 */
async function stuckState(p, shot) {
  if (shot) await p.screenshot({ path: shot, fullPage: true, timeout: 15_000 }).catch(() => undefined);
  const seen = p.evaluate(() => {
    const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const buttons = [...document.querySelectorAll("main button")].filter((b) => b.getClientRects().length).map((b) => `${b.dataset.testid ?? text(b).slice(0, 24)}${b.disabled ? " (greyed)" : ""}`);
    return [
      [...document.querySelectorAll(".hud-label")].map(text).find((t) => /^Turn \d+$/i.test(t)) ?? "no turn shown",
      `waiting: ${text(document.querySelector("[data-testid=battle-waiting]")) || "-"}`,
      `message: ${text(document.querySelector("[data-testid=battle-message]")).slice(0, 90) || "-"}`,
      `alert: ${[...document.querySelectorAll("[role=alert]")].map(text).join(" / ") || "-"}`,
      `grid: ${text(document.querySelector("[data-testid=target-grid] p")) || "-"}`,
      `buttons: ${buttons.join(", ").slice(0, 400) || "none"}`,
    ].join("; ");
  });
  const late = new Promise((resolve) => setTimeout(() => resolve("the page didn't answer within 10 s"), 10_000));
  return Promise.race([seen, late]).catch((e) => `the page couldn't be read: ${String(e?.message ?? e).split("\n")[0]}`);
}

/**
 * Plays the battle on `p` until it ends (or `maxSteps` choices): leads at team
 * preview, the strongest-looking move aimed at the first spot in reach, a
 * switch when one is due. `shots` takes screenshots on the way. When nothing
 * comes up to press, the error says what the page shows, and `stuck` (a file
 * path) gets its picture.
 */
async function play(p, { maxSteps = 400, shots = {}, errors, label, stuck }) {
  let aimed = false;
  for (let i = 0; i < maxSteps; i++) {
    const ready = p.locator(
      "[data-testid=move-button]:not([disabled]), [data-testid=switch-button]:not([disabled]), [data-testid=lead-button]:not([disabled]), [data-testid=battle-result], [data-testid=target-button]:not([disabled])"
    );
    await ready
      .first()
      .waitFor({ timeout: WAIT })
      .catch(async (err) => {
        throw new Error(`${String(err?.message ?? err).split("\n")[0]} at choice ${i} (${await stuckState(p, stuck)})`);
      });
    if (await p.locator("[data-testid=battle-result]").count()) return i;
    if (shots.each) await shots.each();
    if (i === 2 && shots.mid) await shots.mid();
    const leads = p.locator("[data-testid=lead-button]:not([disabled])");
    const moves = p.locator("[data-testid=move-button]:not([disabled])");
    const targets = p.locator("[data-testid=target-button]:not([disabled])");
    if (await targets.count()) {
      await targets.first().click();
    } else if (await leads.count()) {
      const text = await p.locator("body").innerText();
      const pick = /Choose (\d) to battle/i.exec(text);
      const need = pick ? Number(pick[1]) : /three leads/i.test(text) ? 3 : /two leads/i.test(text) ? 2 : 1;
      for (let k = 0; k < need; k++) await leads.nth(k).click();
    } else if (await moves.count()) {
      const texts = (await moves.allInnerTexts()).map((t) => t.toLowerCase());
      const score = (t) => (Number(/pow (\d+)/.exec(t)?.[1] ?? 0) || 1) * (t.includes("super effective") ? 2 : t.includes("not very") ? 0.5 : t.includes("no effect") ? 0 : 1);
      const best = texts.reduce((b, t, k) => (score(t) > score(texts[b]) ? k : b), 0);
      await moves.nth(best).click();
      if (!aimed && (await p.getByTestId("target-grid").count())) {
        aimed = true;
        if (shots.aim) await shots.aim();
      }
    } else {
      await p.locator("[data-testid=switch-button]:not([disabled])").first().click();
    }
  }
  if (!(await p.locator("[data-testid=battle-result]").count())) errors.push(`battle group: ${label} didn't end in ${maxSteps} choices`);
  return maxSteps;
}

/** Picks a format in the setup's "Triples and four trainers" group and starts against the computer. */
async function startCpu(p, BASE, format, name) {
  await p.goto(`${BASE}/battle/play`, { waitUntil: "load" });
  await p.getByTestId(`format-${format}`).click();
  await p.getByLabel("Your trainer name").fill(name);
  const start = p.getByRole("button", { name: /Start battle/ });
  // A team format deals a quick team first.
  await start.and(p.locator(":not([disabled])")).waitFor({ timeout: WAIT });
  await start.click();
  await p.waitForURL(/\/battle\/play\/[a-z2-9]{8}$/, { timeout: WAIT });
}

export async function runGroupBattles({ browser, BASE, OUT, errors, step, shotsDir }) {
  const SHOTS = shotsDir ?? OUT;
  const shot = (p, name, full = false) => p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }).catch(() => undefined);

  step("battle: Triples against the computer, played to the end (three leads, targets in reach, shift)");
  for (const width of [1440, 390]) {
    await part(errors, `triples ${width}`, async () => {
      const p = await open(browser, { width, height: width > 500 ? 900 : 844 }, errors, `triples ${width}`);
      await startCpu(p, BASE, "gen9triples", "Red");
      await p.locator("[data-testid=lead-button]").first().waitFor();
      if (!/Choose your three leads/i.test(await p.locator("body").innerText())) errors.push("triples: team preview should ask for three leads");
      await shot(p, `triples-preview-${width}`, width < 500);
      let sawShift = false;
      let sawOutOfReach = false;
      await play(p, {
        errors,
        label: `triples ${width}`,
        stuck: `${SHOTS}/triples-stuck-${width}.png`,
        shots: {
          // An edge Pokémon's moves offer Shift; the centre one's don't.
          each: async () => {
            if (!sawShift) sawShift = (await p.getByTestId("shift-button").count()) > 0;
          },
          mid: async () => {
            await noSideways(p, errors, "a triples battle");
            const huds = await p.locator("[data-testid=hud-foe]:visible").count();
            if (huds < 2 || huds > 3) errors.push(`triples: ${huds} foe HUDs on the stage`);
            await shot(p, `triples-mid-${width}`, width < 500);
          },
          aim: async () => {
            const grid = p.getByTestId("target-grid");
            const spots = await grid.getByTestId("target-button").count();
            if (spots !== 6) errors.push(`triples: the target grid shows ${spots} spots, not 6`);
            sawOutOfReach = (await grid.locator("[data-legal=false]").count()) > 0 || sawOutOfReach;
            await shot(p, `triples-target-${width}`, width < 500);
          },
        },
      });
      await p.getByTestId("battle-result").scrollIntoViewIfNeeded();
      await shot(p, `triples-result-${width}`, width < 500);
      if (!sawShift) errors.push("triples: no Shift button on an edge Pokémon");
      if (width > 500 && !sawOutOfReach) console.log("  (triples: no out-of-reach spot came up this battle)");
      await p.context().close();
    });
  }

  step("battle: a Free-For-All against three computer trainers, to its final standings");
  for (const width of [1440, 390]) {
    await part(errors, `ffa ${width}`, async () => {
      const p = await open(browser, { width, height: width > 500 ? 900 : 844 }, errors, `ffa ${width}`);
      await startCpu(p, BASE, "gen9freeforallrandombattle", "Red");
      await p.locator("[data-testid=move-button]").first().waitFor();
      const trainers = await p.getByTestId("battle-trainer").count();
      if (trainers !== 4) errors.push(`ffa: the header shows ${trainers} trainers`);
      await play(p, {
        errors,
        label: `ffa ${width}`,
        stuck: `${SHOTS}/ffa-stuck-${width}.png`,
        shots: {
          mid: async () => {
            await noSideways(p, errors, "a Free-For-All");
            await shot(p, `ffa-mid-${width}`, width < 500);
          },
          aim: async () => {
            const foes = await p.getByTestId("target-grid").locator("[data-testid=target-button][data-legal=true]").count();
            if (foes < 2) errors.push(`ffa: only ${foes} foes to aim at`);
            await shot(p, `ffa-target-${width}`, width < 500);
          },
        },
      });
      const standings = await p.getByTestId("ffa-standing").count();
      if (standings !== 4) errors.push(`ffa: the result lists ${standings} places, not 4`);
      await p.getByTestId("battle-result").scrollIntoViewIfNeeded();
      await shot(p, `ffa-result-${width}`, width < 500);
      await p.context().close();
    });
  }

  step("battle: a Multi Battle with a computer partner, to its team result");
  for (const width of [1440, 390]) {
    await part(errors, `multi ${width}`, async () => {
      const p = await open(browser, { width, height: width > 500 ? 900 : 844 }, errors, `multi ${width}`);
      await startCpu(p, BASE, "gen9multirandombattle", "Red");
      await p.locator("[data-testid=move-button]").first().waitFor();
      const partner = await p.locator("[data-testid=hud-owner]").filter({ hasText: /partner/i }).count();
      if (!partner) errors.push("multi: your partner's Pokémon isn't marked as your partner's");
      await play(p, {
        errors,
        label: `multi ${width}`,
        stuck: `${SHOTS}/multi-stuck-${width}.png`,
        shots: {
          mid: async () => {
            await noSideways(p, errors, "a Multi Battle");
            await shot(p, `multi-mid-${width}`, width < 500);
          },
          aim: async () => shot(p, `multi-target-${width}`, width < 500),
        },
      });
      if (!(await p.getByTestId("multi-result").count())) errors.push("multi: no team result");
      await p.getByTestId("battle-result").scrollIntoViewIfNeeded();
      await shot(p, `multi-result-${width}`, width < 500);
      await p.context().close();
    });
  }

  step("battle: a live four-player Free-For-All: four trainers join by link, a fifth watches, forfeits end it");
  await part(errors, "live ffa", async () => {
    const names = ["Red", "Blue", "Gold", "Silver"];
    const pages = [];
    for (let i = 0; i < 4; i++) pages.push(await open(browser, { width: i === 3 ? 390 : 1440, height: i === 3 ? 844 : 900 }, errors, `live ${names[i]}`, { css: i > 0 }));
    const [host] = pages;
    await host.goto(`${BASE}/battle/play?vs=friend`, { waitUntil: "load" });
    await host.getByTestId("format-gen9freeforallrandombattle").click();
    await host.getByLabel("Your trainer name").fill("Red");
    await host.getByTestId("let-anyone-watch").check({ force: true });
    await host.getByTestId("timer-on").uncheck({ force: true });
    await host.getByRole("button", { name: /Create battle/ }).click();
    await host.waitForURL(/\/battle\/live\/[a-z2-9]{8}$/, { timeout: WAIT });
    const url = host.url();
    await host.getByTestId("group-lobby").waitFor();
    for (let i = 1; i < 4; i++) {
      const p = pages[i];
      await p.goto(url, { waitUntil: "load" });
      await p.getByLabel("Your trainer name").fill(names[i]);
      await p.getByRole("button", { name: /Join battle/ }).click();
      await p.getByTestId("lobby-ready").waitFor();
    }
    await host.locator("[data-testid=lobby-seat][data-filled=true]").nth(3).waitFor();
    await shot(host, "live-ffa-lobby-1440", true);
    await shot(pages[3], "live-ffa-lobby-390", true);
    for (const p of pages) await p.getByTestId("lobby-ready").click();
    await Promise.all(pages.map((p) => p.locator("[data-testid=move-button]").first().waitFor()));

    // A spectator finds it in Watch live.
    const spectator = await open(browser, { width: 1440, height: 900 }, errors, "spectator", { css: true });
    await spectator.goto(`${BASE}/battle/watch`, { waitUntil: "load" });
    const card = spectator.getByTestId("watch-battle").filter({ has: spectator.getByTestId("watch-four") }).first();
    await card.waitFor({ timeout: 60_000 });
    await shot(spectator, "live-ffa-watch-lobby-1440");
    await card.click();
    await spectator.getByTestId("spectating").waitFor();

    // A turn from every trainer (and a replacement from anyone knocked out on it), until the spectator sees turn 2.
    const turn2 = spectator.getByTestId("battle-log").getByText(/^Turn 2$/).first();
    const deadline = Date.now() + 90_000;
    while (!(await turn2.count()) && Date.now() < deadline) {
      for (const p of pages) {
        const t = p.locator("[data-testid=target-button]:not([disabled])");
        const moves = p.locator("[data-testid=move-button]:not([disabled])");
        const switches = p.locator("[data-testid=switch-button]:not([disabled])");
        if (await t.count()) await t.first().click();
        else if (await moves.count()) {
          await moves.first().click();
          if (await t.count()) await t.first().click();
        } else if (await switches.count()) await switches.first().click();
      }
      await spectator.waitForTimeout(1000);
    }
    await turn2.waitFor({ timeout: 5_000 }).catch(() => errors.push("live ffa: the spectator never saw turn 2"));
    await shot(spectator, "live-ffa-spectator-1440");
    await shot(pages[1], "live-ffa-mid-1440");
    await shot(pages[3], "live-ffa-mid-390", true);

    // Silver, Gold and Blue forfeit in turn: each is out, the others battle on; Red is last standing.
    for (const i of [3, 2, 1]) {
      const p = pages[i];
      await p.getByRole("button", { name: /^Forfeit$/ }).click();
      await p.getByRole("button", { name: /^Forfeit$/ }).last().click();
      await p.waitForTimeout(800);
    }
    await host.getByTestId("battle-result").waitFor({ timeout: WAIT });
    const first = (await host.getByTestId("ffa-standing").first().innerText()).toLowerCase();
    if (!first.includes("red")) errors.push(`live ffa: Red should be first in the standings, not "${first.slice(0, 40)}"`);
    await spectator.getByTestId("battle-result").waitFor({ timeout: WAIT });
    const seen = await spectator.getByTestId("ffa-standing").count();
    if (seen !== 4) errors.push(`live ffa: the spectator sees ${seen} places`);
    await shot(host, "live-ffa-result-1440");
    await shot(spectator, "live-ffa-spectator-result-1440");
    await pages[3].getByTestId("battle-result").waitFor({ timeout: WAIT });
    await shot(pages[3], "live-ffa-result-390", true);
    for (const p of [...pages, spectator]) await p.context().close();
  });
}

// Standalone: node scripts/e2e-battle-group.mjs <base> [shots dir]
if (process.argv[1]?.endsWith("e2e-battle-group.mjs")) {
  const { chromium } = await import("playwright");
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const OUT = process.argv[3] ?? "e2e-screenshots";
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const t0 = Date.now();
  await runGroupBattles({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s`);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
}
