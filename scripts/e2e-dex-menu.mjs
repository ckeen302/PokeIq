/**
 * The Pokédex's sections sit in one menu under the big section button (it
 * names the section you're on). Opens it and picks a section. A click that
 * lands before hydration does nothing, so it tries again.
 */
export async function openDexSection(page, id) {
  const link = page.getByTestId(`dex-tab-${id}`);
  for (let i = 0; i < 5 && !(await link.isVisible()); i++) {
    await page.getByTestId("dex-section-button").click();
    await link.waitFor({ state: "visible", timeout: 3_000 }).catch(() => {});
  }
  await link.click();
}
