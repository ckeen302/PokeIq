import { chromium } from "playwright";
const [BASE, OUT] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const stamp = Date.now().toString(36).slice(-6);
const mk = async (name, theme) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => { sessionStorage.setItem("pokeiq-splash", "1"); localStorage.setItem("pokeiq-theme", t); }, theme);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(`${BASE}/pokedex`, { waitUntil: "load" });
  const r = await p.request.post(`${BASE}/api/auth/register`, { data: { username: name, password: "correct horse battery" }, headers: { Origin: BASE } });
  if (!r.ok()) throw new Error("register " + r.status());
  await p.reload({ waitUntil: "load" });
  return p;
};
const a = await mk(`ba${stamp}`, "dark");
console.log("friends available:", (await (await a.request.get(`${BASE}/api/friends`)).json()).available);
// Same flow as the e2e step: A sends the request from the menu's Friends.
await a.getByTestId("account-menu-button").click();
await a.getByTestId("account-menu-friends").click();
await a.getByTestId("friends-panel").waitFor();
await a.getByRole("tab", { name: /Add/ }).click();
await a.getByLabel("Trainer name").fill(`bb${stamp}`);
for (const theme of ["dark", "light"]) {
  const b = await mk(theme === "dark" ? `bb${stamp}` : `bc${stamp}`, theme);
  if (theme === "dark") {
    await a.getByRole("button", { name: /Send/ }).click();
    await a.getByText(`Request sent to bb${stamp}.`).waitFor();
  } else {
    await a.getByLabel("Trainer name").fill(`bc${stamp}`);
    await a.getByRole("button", { name: /Send/ }).click();
    await a.getByText(`Request sent to bc${stamp}.`).waitFor();
  }
  await b.reload({ waitUntil: "load" });
  await b.getByTestId("account-menu-badge").waitFor({ timeout: 30_000 });
  await b.waitForTimeout(500);
  await b.screenshot({ path: `${OUT}/after-badge-header-${theme}.png`, clip: { x: 1100, y: 0, width: 340, height: 64 } });
  console.log("button label:", await b.getByTestId("account-menu-button").getAttribute("aria-label"));
  await b.getByTestId("account-menu-button").click();
  await b.getByTestId("account-menu-friends-badge").waitFor();
  await b.waitForTimeout(400);
  await b.screenshot({ path: `${OUT}/after-badge-menu-${theme}.png`, clip: { x: 840, y: 0, width: 600, height: 520 } });
  await b.getByTestId("account-menu-friends").click();
  await b.getByTestId("incoming-request").first().waitFor();
  console.log("panel opened on requests");
  await b.context().close();
}
await browser.close();
