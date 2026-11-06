/**
 * Quizzes: a Who's That Pokémon? run. Each answer is worked out from the
 * run's own session token by the server's code (quiz-oracle.ts), so the
 * player picks right every time: silhouette, pick, reveal, next, the streak
 * growing.
 */
import { spawn } from "node:child_process";
import readline from "node:readline";

export const setup = (phone) => ({ viewport: phone ? { width: 390, height: 1500 } : { width: 1440, height: 1300 } });

function oracle() {
  const child = spawn("npx", ["tsx", "--conditions=react-server", "scripts/hero-videos/quiz-oracle.ts"], { stdio: ["pipe", "pipe", "inherit"] });
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

export async function run(rec, { base, phone }) {
  const page = rec.page;
  const o = oracle();
  let token = null;
  page.on("response", async (res) => {
    if (!/^\/api\/session(\/(answer|next|reveal))?$/.test(new URL(res.url()).pathname) || res.request().method() !== "POST") return;
    const body = await res.json().catch(() => null);
    if (body?.token) token = body.token;
  });
  try {
    await rec.goto(`${base}/quiz/whos-that-pokemon`);
    await page.getByRole("button", { name: /^Start/ }).click();
    await page.waitForSelector("main h2");
    const answerNow = async () => {
      for (let i = 0; i < 100 && !token; i++) await rec.settle(100);
      const r = await o.ask(token);
      if (!r.answer) throw new Error(`oracle: ${JSON.stringify(r)}`);
      return r.answer;
    };
    const option = (name) => page.locator("[data-answer-tile]:not([disabled])").filter({ has: page.getByText(name, { exact: true }) }).first();
    const next = page.getByRole("button", { name: /Next question|See results/ });
    // Two right answers before the take, so the streak is going.
    for (let i = 0; i < 2; i++) {
      const a = await answerNow();
      token = null;
      await option(a).click();
      await next.waitFor();
      await page.waitForTimeout(600);
      await next.click();
      await page.waitForSelector("main h2");
      await page.waitForTimeout(900);
    }
    await page.mouse.move(5, 5);
    await rec.hideChrome();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1200);
    await rec.freeze();
    const stage = page.locator("main h2").first();
    const score = page.getByText(/^Score$/i).first();
    const opts = page.locator("[data-answer-tile]");
    // A phone's card is taller than the hero: frame the picture and the answers.
    if (phone) await rec.frameAround([page.locator("main img").last(), opts.last()], { aspect: 4 / 5, pad: 8 });
    else await rec.frameAround([stage, opts.last()], { aspect: 16 / 9, pad: 20 });
    rec.cursor.x = rec.clip.x + rec.clip.width * 0.75;
    rec.cursor.y = rec.clip.y + rec.clip.height * 0.9;
    rec.start();
    for (let q = 0; q < 2; q++) {
      const a = await answerNow();
      token = null;
      await rec.wait(q ? 700 : 900);
      await rec.clickEl(option(a), { jitter: 0.4 });
      await rec.until(() => [...document.querySelectorAll("main button")].some((b) => /Next question|See results/.test(b.textContent ?? "")));
      if (q === 1) {
        await rec.moveTo(rec.cursor.x + 90, rec.cursor.y + 50, 700);
        await rec.wait(1800);
        break;
      }
      await rec.wait(1300);
      await rec.clickEl(next, { jitter: 0.3 });
      // The next question's picture loads over the network: hold the page's clock till it's in
      // (a viewer on a warm connection sees no gap), then play on.
      for (let i = 0; i < 80; i++) {
        if (await page.evaluate(() => document.querySelectorAll("[data-answer-tile]:not([disabled])").length > 1)) break;
        await rec.settle(100);
      }
      // The next question: its tiles come up once its picture is in.
      await rec.until(() => document.querySelectorAll("[data-answer-tile]:not([disabled])").length > 1);
    }
    rec.mark("out");
    await rec.stop();
  } finally {
    o.close();
  }
}
