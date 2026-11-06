/**
 * 3D Lab: The Story of Pokémon, the real-time film, playing through one of
 * its best moments. Rendered frame by frame on the page's own clock, so the
 * 3D plays smoothly however slow the machine; the film's captions and
 * controls are hidden (the slide's title sits on top of the clip).
 */
const T = Number(process.env.HERO_LAB_T ?? 186);
const SECONDS = Number(process.env.HERO_LAB_SECONDS ?? 10.4);

export const setup = (phone) => ({ fps: 30, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 810 } });
export const encode = () => ({ fade: 0.8 });

export async function run(rec, { base, phone }) {
  const page = rec.page;
  await rec.goto(`${base}/lab/pokemon-story?q=high&t=${T}`);
  await page.locator('[data-testid="ps-stage"][data-ready="1"]').waitFor({ timeout: 300_000 });
  await rec.hideChrome(`
    [data-testid=ps-caption-area], [data-testid=ps-source], [data-testid=ps-title-card] p,
    div:has(> [data-testid=ps-play]), div:has(> [data-testid=ps-back]), div:has(> [data-testid=ps-mute]),
    [data-testid=ps-back], [data-testid=ps-mute], [data-testid=ps-chapters-open], [data-testid=ps-to-text], [data-testid=ps-scrub],
    div:has(> [data-testid=ps-look]), div:has(> [data-testid=ps-video]), [data-testid=ps-look], [data-testid=ps-zoom-in], [data-testid=ps-zoom-out], [data-testid=ps-share], [data-testid=ps-video], [data-testid=ps-chapters], [data-testid=ps-now] { visibility: hidden !important; }
  `);
  await page.waitForTimeout(1500);
  await page.getByTestId("ps-play").dispatchEvent("click");
  await page.waitForTimeout(300);
  await rec.freeze();
  // Let the chapter's pieces settle in on the page's own clock, then film.
  await rec.wait(1200);
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => document.querySelector('[data-testid="ps-stage"]')?.dataset.loading !== "1")) break;
    await rec.settle(500);
  }
  const stage = await page.getByTestId("ps-stage").boundingBox();
  const { width: vw, height: vh } = rec.o.viewport;
  // The stage fills the screen: desktop takes it whole; a phone, a 4:5 window from its middle.
  if (phone) rec.setClip({ x: 0, y: Math.max(0, Math.round(stage.y + (Math.min(stage.height, vh) - 487.5) / 2)), width: 390, height: 487.5 });
  else {
    // Under the film's header strip.
    const top = 56;
    const h = vh - top;
    const w = Math.min(vw, Math.round((h * 16) / 9));
    rec.setClip({ x: Math.round((vw - w) / 2), y: top, width: w, height: Math.round((w * 9) / 16) });
  }
  rec.cursor.opacity = 0;
  rec.start();
  await rec.wait(SECONDS * 1000);
  rec.mark("out");
  await rec.stop();
}
