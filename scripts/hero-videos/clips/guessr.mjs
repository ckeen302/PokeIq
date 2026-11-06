/**
 * PokéGuessr: a round on the Paldea map (Scarlet / Violet, a mainline game).
 * The player looks around the place, opens the map, drops a pin near the
 * answer and guesses; the line draws and the score counts up. The answer is
 * worked out from the game's own token by the server's code (geo-oracle.ts);
 * a round from any game but the mainline ones is skipped (a new game).
 */
import { spawn } from "node:child_process";
import readline from "node:readline";

export const setup = (phone) => ({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 810 } });

/** Mainline games only (never Legends: Arceus / Z-A). */
const OK_GAME = (game) => /Scarlet|Violet/.test(game) && !/Legends/.test(game);
/** Paldea's towns and cities: busier, better-looking pictures than open country. */
const TOWN = /Cabo Poco|Mesagoza|Artazon|Levincia|Cortondo|Cascarrafa|Porto Marinada|Medali|Montenevera|Alfornada|Zapapico|Los Platos|Academy|Pokémon League/;

function oracle() {
  const child = spawn("npx", ["tsx", "--conditions=react-server", "scripts/hero-videos/geo-oracle.ts"], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = readline.createInterface({ input: child.stdout });
  const waiting = [];
  lines.on("line", (l) => waiting.shift()?.(JSON.parse(l)));
  return {
    ask: (token) =>
      new Promise((r) => {
        waiting.push(r);
        child.stdin.write(`${token}\n`);
      }),
    close: () => child.kill(),
  };
}

/** The map engine's view (screen = world · s + t), read from the GeoMap component's state. */
function mapView() {
  const canvas = document.querySelector("[role=application] canvas") ?? document.querySelector("[data-testid=geo-dock] canvas");
  if (!canvas) return null;
  const key = Object.keys(canvas).find((k) => k.startsWith("__reactFiber"));
  for (let f = canvas[key]; f; f = f.return) {
    for (let h = f.memoizedState; h && typeof h === "object" && "next" in h; h = h.next) {
      const v = h.memoizedState;
      if (v && typeof v === "object" && "s" in v && "tx" in v && "ty" in v) {
        const r = canvas.getBoundingClientRect();
        return { s: v.s, tx: v.tx, ty: v.ty, left: r.left, top: r.top, width: r.width, height: r.height };
      }
    }
  }
  return null;
}

export async function run(rec, { base, phone }) {
  const page = rec.page;
  const o = oracle();
  let token = null;
  page.on("response", async (res) => {
    if (!/^\/api\/geo(\/guess)?$/.test(new URL(res.url()).pathname) || res.request().method() !== "POST") return;
    const body = await res.json().catch(() => null);
    if (body?.token) token = body.token;
  });
  try {
    await rec.goto(`${base}/guessr`);
    const never = page.getByTestId("howto-never");
    if (await never.isVisible().catch(() => false)) await never.click();
    let answer = null;
    for (let tries = 0; tries < 30 && !answer; tries++) {
      if (tries) await rec.goto(`${base}/guessr`);
      await page.getByRole("radiogroup", { name: "Map" }).getByRole("radio", { name: "Paldea" }).click();
      token = null;
      await page.getByRole("button", { name: /round game/ }).first().click();
      await page.getByTestId("geo-shell").waitFor();
      for (let i = 0; i < 100 && !token; i++) await rec.settle(100);
      const a = await o.ask(token);
      console.log(`\n  round: ${a.name} (${a.game})`);
      if (a.game && OK_GAME(a.game) && TOWN.test(a.name)) answer = a;
    }
    if (!answer) throw new Error("no mainline round");
    // The picture in, its blur gone.
    await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=geo-shot] img, img[data-testid=geo-shot]")].every((im) => im.complete));
    await page.waitForTimeout(2500);
    await page.mouse.move(5, 5);
    await rec.hideChrome();
    await page.waitForTimeout(600);
    await rec.freeze();
    const { width: vw, height: vh } = rec.o.viewport;
    rec.setClip(phone ? { x: 0, y: Math.round((vh - 487.5) / 2), width: 390, height: 487.5 } : { x: 0, y: 0, width: vw, height: vh });
    const c = rec.clip;
    rec.cursor.x = c.x + c.width * 0.62;
    rec.cursor.y = c.y + c.height * 0.72;
    rec.start();
    await rec.wait(400);
    if (!phone) {
      // Looking the place over.
      await rec.moveTo(c.x + c.width * 0.36, c.y + c.height * 0.42, 800);
      await rec.wait(150);
      await rec.moveTo(c.x + c.width * 0.55, c.y + c.height * 0.3, 600);
      // The map grows under the pointer.
      await rec.moveToEl(page.getByTestId("geo-dock"), { jitter: 0.2, ms: 800 });
      await rec.until(() => document.querySelector("[data-testid=geo-dock]")?.getAttribute("data-open") === "true");
      await rec.wait(500);
    } else {
      await rec.wait(1700);
      await rec.clickEl(page.getByTestId("geo-map-pill"), { jitter: 0.2 });
      await rec.until(() => !!document.querySelector("[data-testid=geo-dock][data-open=true]"));
      await rec.wait(500);
    }
    // A good guess: a little way from the place.
    const v = await page.evaluate(mapView);
    if (!v) throw new Error("no map view");
    const [wx, wy] = answer.world;
    const near = { x: v.left + wx * v.s + v.tx + 16, y: v.top + wy * v.s + v.ty - 11 };
    console.log("  pin at", JSON.stringify(near), JSON.stringify(v));
    await rec.moveTo(near.x - 60, near.y - 40, 700);
    await rec.wait(250);
    await rec.moveTo(near.x, near.y, 450);
    await rec.wait(150);
    await rec.press();
    await rec.wait(350);
    await rec.clickEl(page.locator("[data-testid=geo-guess]:not([disabled])"), { jitter: 0.3 });
    await rec.until(() => !!document.querySelector("[data-testid=geo-reveal]"));
    rec.mark("guessed");
    await rec.moveTo(c.x + c.width * 0.9, c.y + c.height * 0.2, 900);
    await rec.wait(3600);
    rec.mark("out");
    await rec.stop();
  } finally {
    o.close();
  }
}
