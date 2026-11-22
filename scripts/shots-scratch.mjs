import { chromium } from "playwright";
const [BASE, OUT, tag] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
for (const theme of ["dark", "light"]) {
  for (const who of ["signedout", "signedin"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((t) => {
      sessionStorage.setItem("pokeiq-splash", "1");
      localStorage.setItem("pokeiq-theme", t);
    }, theme);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/pokedex`, { waitUntil: "load" });
    if (who === "signedin") {
      const name = `hm${Date.now().toString(36).slice(-6)}`;
      const res = await p.request.post(`${BASE}/api/auth/register`, { data: { username: name, password: "correct horse battery" }, headers: { Origin: BASE } });
      if (!res.ok()) { console.log("register failed", res.status()); await ctx.close(); continue; }
      await p.reload({ waitUntil: "load" });
    }
    await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(800);
    if (who === "signedout") await p.screenshot({ path: `${OUT}/${tag}-header-${theme}.png`, clip: { x: 0, y: 0, width: 1440, height: 64 } });
    await p.getByTestId("account-menu-button").click();
    await p.getByTestId("account-menu").waitFor();
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${tag}-menu-${who}-${theme}.png`, clip: { x: 840, y: 0, width: 600, height: 520 } });
    if (tag === "after") {
      await p.getByTestId("account-menu-friends").hover();
      await p.waitForTimeout(200);
      await p.screenshot({ path: `${OUT}/${tag}-menu-${who}-${theme}-hover.png`, clip: { x: 840, y: 0, width: 600, height: 520 } });
      await p.getByTestId("account-menu-friends").click();
      await p.getByTestId("friends-panel").waitFor();
      await p.waitForTimeout(400);
      await p.screenshot({ path: `${OUT}/${tag}-friends-panel-${who}-${theme}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
