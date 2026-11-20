/**
 * The 3D Lab films' words, end to end: whatever way you jump (the arrow
 * keys, rapid skips, the chapter list, a click on the timeline, a skip in
 * the middle of a hall walk), the caption and title card on screen must be
 * the ones for the moment the picture shows, by the next frame, and the
 * words of the part you left must be gone. Shared by World History
 * (prefix "wh", window.__wh) and The Story of Pokémon ("ps", window.__ps).
 */

/** The words the film shows for a beat (its excerpt when there is one). */
const filmLine = (b) => b.cut ?? b.quote ?? b.text ?? "";
const norm = (s) => (s ?? "").replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();

/** Waits for the next two frames: a jump is drawn, and its words written, in the first. */
export const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => { const go = (i) => (i ? requestAnimationFrame(() => go(i - 1)) : r()); go(k); }), n);

/**
 * What the page shows against what the playhead says: the chapter and caption the
 * playhead is on (from the film's own clock), and the words on screen.
 */
export async function wordsNow(page, prefix, api, chapters) {
  const got = await page.evaluate(([p, a]) => {
    const f = window[a];
    const st = f?.state();
    if (!st) return null;
    const stage = document.querySelector(`[data-testid="${p}-stage"]`);
    const caps = [...document.querySelectorAll(`[data-testid="${p}-caption"] blockquote`)].map((e) => e.textContent ?? "");
    const titles = [...document.querySelectorAll(`[data-testid="${p}-title-card"] h2`)].map((e) => e.getAttribute("aria-label") ?? e.textContent ?? "");
    const stale = document.querySelectorAll(`[data-testid="${p}-caption-out"], [data-testid="${p}-title-card-out"]`).length;
    const visibleStale = [...document.querySelectorAll(`[data-testid="${p}-caption-out"], [data-testid="${p}-title-card-out"]`)].filter((e) => Number(getComputedStyle(e).opacity) > 0.05).length;
    // The caption the playhead has reached (a hair of tolerance, as the clock has).
    let beat = -1;
    if (st.kind === "chapter") for (let b = 0; b < 64; b++) { const t = f.beatTime(st.chapter, b); if (b > 0 && t <= f.chapterStart(st.chapter)) break; if (t <= st.t + 1e-6) beat = b; }
    return { st, beat, caps, titles, stale, visibleStale, loading: stage?.dataset.loading === "1", loadingText: document.querySelector(`[data-testid="${p}-loading"]`)?.textContent ?? "", dsChapter: stage?.dataset.chapter ?? "" };
  }, [prefix, api]);
  if (!got) return { ok: false, why: "the film has no state" };
  const c = chapters[got.st.chapter];
  const beats = c.beats.filter((b) => b.film !== false);
  const beat = got.beat < beats.length ? got.beat : beats.length - 1;
  const where = `t=${got.st.t.toFixed(2)} ${c.id}${got.st.kind === "chapter" ? ` caption ${beat}` : " (hall)"}`;
  if (got.dsChapter !== c.id) return { ok: false, why: `${where}: the stage says chapter "${got.dsChapter}"` };
  if (got.visibleStale) return { ok: false, why: `${where}: words from before the jump are still showing` };
  if (got.loading) {
    // Still building: no words over the picture yet, and the loading line names the chapter.
    if (got.caps.length || got.titles.length) return { ok: false, why: `${where}: words are up while the chapter is still loading` };
    return { ok: true, why: `${where}: loading` };
  }
  if (got.st.kind !== "chapter" || beat < 0) {
    if (got.caps.length) return { ok: false, why: `${where}: a caption ("${got.caps[0].slice(0, 40)}") is up where there is none` };
    if (got.st.kind === "chapter" && got.titles.length && !got.titles.every((t) => norm(t) === norm(c.title))) return { ok: false, why: `${where}: the title card reads "${got.titles.join(" / ")}"` };
    // A chapter's opening seconds carry its title card (a jump to a chapter lands exactly there, not a pixel's rounding before it).
    if (got.st.kind === "chapter" && got.st.anim < 2.8 && !got.titles.length) return { ok: false, why: `${where}: no title card over the chapter's opening` };
    return { ok: true, why: where };
  }
  const want = norm(filmLine(beats[beat]));
  if (got.caps.length !== 1 || norm(got.caps[0]) !== want) return { ok: false, why: `${where}: the caption reads "${got.caps.map((x) => x.slice(0, 50)).join(" / ")}", not "${want.slice(0, 50)}"` };
  if (got.titles.length) return { ok: false, why: `${where}: a title card ("${got.titles[0]}") is still up over a caption` };
  return { ok: true, why: where };
}

/** Runs every way of jumping and checks the words one frame later each time. */
export async function checkFilmWords({ page, prefix, api, chapters, errors, name, phone = false }) {
  const key = (k) => page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk, bubbles: true })), k);
  const press = (id) => page.getByTestId(id).dispatchEvent("click", undefined, { timeout: 120_000 });
  const expect = async (what) => {
    await frames(page);
    const r = await wordsNow(page, prefix, api, chapters);
    if (!r.ok) errors.push(`${name}: after ${what}, ${r.why}`);
    return r;
  };
  const loaded = () => page.waitForFunction((p) => document.querySelector(`[data-testid="${p}-stage"]`)?.dataset.loading === "0", prefix, { timeout: 300_000 }).catch(() => errors.push(`${name}: a chapter never finished loading`));

  // Where the page opened (a chapter's own address): its title card is up.
  await expect("opening");
  // → steps: the next caption's words are up by the next frame (not the one before it, not a fade later).
  for (let i = 0; i < 4; i++) {
    await key("ArrowRight");
    await expect(`→ (${i + 1})`);
  }
  await key("ArrowLeft");
  await expect("←");
  // Rapid skips end on the last one's words, with nothing left over from the ones on the way.
  const t0 = (await page.evaluate((a) => window[a].state().t, api));
  for (let i = 0; i < 8; i++) await key("ArrowRight");
  await expect("eight quick → in a row");
  const t1 = (await page.evaluate((a) => window[a].state().t, api));
  if (!(t1 > t0)) errors.push(`${name}: eight quick → didn't move the film`);
  await loaded();
  await expect("eight quick →, once loaded");
  // The chapter list (the rail on a desktop, the sheet on a phone).
  const target = chapters[Math.min(chapters.length - 1, 5)].id;
  if (phone) {
    await press(`${prefix}-chapters-open`);
    await page.getByTestId(`${prefix}-sheet-${target}`).waitFor({ timeout: 30_000 });
    await press(`${prefix}-sheet-${target}`);
  } else await press(`${prefix}-rail-${target}`);
  const r = await expect(`the chapter list to ${target}`);
  if (!r.why.includes(target)) errors.push(`${name}: the chapter list didn't jump to ${target} (${r.why})`);
  await loaded();
  await expect(`the chapter list to ${target}, once loaded`);
  // A click on the timeline.
  const box = await page.getByTestId(`${prefix}-scrub`).boundingBox();
  if (box) {
    await page.getByTestId(`${prefix}-scrub`).dispatchEvent("pointerdown", { clientX: box.x + box.width * 0.42, clientY: box.y + box.height / 2, pointerId: 1 });
    await expect("a click on the timeline");
    await loaded();
    await expect("a click on the timeline, once loaded");
  }
  // A skip in the middle of a hall walk, while playing.
  const st = await page.evaluate((a) => window[a].state(), api);
  const hall = await page.evaluate(([a, i]) => window[a].chapterStart(i + 1) - 1.7, [api, Math.min(chapters.length - 2, st.chapter)]);
  await page.evaluate(([a, t]) => window[a].seek(t), [api, hall]);
  await press(`${prefix}-play`);
  await page.waitForTimeout(400);
  await key("ArrowRight");
  await expect("→ in the middle of a hall walk");
  if ((await page.getByTestId(`${prefix}-stage`).getAttribute("data-playing")) === "1") await press(`${prefix}-play`);
  await loaded();
  await expect("→ in the middle of a hall walk, once loaded");
}
