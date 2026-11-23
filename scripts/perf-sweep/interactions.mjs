/**
 * The main interaction of a route, for the sweep's interaction latency (Event Timing). Each takes (page, profile) and
 * returns a short note (or nothing). Routes without an entry get the default: typing into the page's first visible
 * search or text box, if there is one. Nothing here signs in, submits a result or writes anything.
 */
const tap = async (page, prof, locator) => {
  const el = locator.first();
  await el.waitFor({ state: "visible", timeout: 8000 });
  if (prof.hasTouch) await el.tap();
  else await el.click();
};

async function typeInto(page, prof, selector, text) {
  const box = page.locator(selector).filter({ visible: true }).first();
  if (!(await box.count())) return "no text box";
  await tap(page, prof, box);
  await page.keyboard.type(text, { delay: 120 });
  await page.waitForTimeout(800);
  for (let i = 0; i < text.length; i++) await page.keyboard.press("Backspace");
  return `typed "${text}"`;
}

const SEARCH = 'input[type="search"], input[type="text"]:not([readonly]), input:not([type])';

export const INTERACTIONS = {
  default: (page, prof) => typeInto(page, prof, SEARCH, "char"),
  pokedex: (page, prof) => typeInto(page, prof, SEARCH, "pika"),
  pokedle: (page, prof) => typeInto(page, prof, SEARCH, "bulb"),
  moves: (page, prof) => typeInto(page, prof, SEARCH, "thun"),
  abilities: (page, prof) => typeInto(page, prof, SEARCH, "leve"),
  items: (page, prof) => typeInto(page, prof, SEARCH, "left"),
  "damage calc": async (page, prof) => {
    const sel = page.locator("select").filter({ visible: true });
    if (await sel.count()) {
      const opts = await sel.first().locator("option").evaluateAll((os) => os.map((o) => o.value));
      if (opts[1] != null) await sel.first().selectOption(opts[1]);
    }
    return typeInto(page, prof, SEARCH, "garch");
  },
  "battle hub": async (page, prof) => {
    const tabs = page.getByRole("tab").filter({ visible: true });
    if ((await tabs.count()) > 1) {
      await tap(page, prof, tabs.nth(1));
      return "second tab";
    }
    return "no tabs";
  },
  "quiz hub": async (page, prof) => {
    const tabs = page.getByRole("tab").filter({ visible: true });
    if ((await tabs.count()) > 1) {
      await tap(page, prof, tabs.nth(1));
      return "second tab";
    }
    return "no tabs";
  },
};

for (const k of ["home", "daily", "pikadoku", "pokeconnections", "lab", "tools", "atlas", "login", "story", "history"]) INTERACTIONS[k] = null;

export const interactionFor = (label) => (label in INTERACTIONS ? INTERACTIONS[label] : INTERACTIONS.default);
