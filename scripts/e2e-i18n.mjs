/**
 * Languages: the SEO and routing guarantees of English-at-the-root plus /<lang>/ copies (src/i18n).
 *
 * English only (LIVE_LOCALES unset, what CI builds and production serves today): no hreflang anywhere, <html lang="en">,
 * every other language's address a 404 that names nothing, /en/* a 308 to the English page, no sitemap index, no
 * language row, footer links or suggestion banner.
 *
 * With languages live (the build and this check both get LIVE_LOCALES=es,ja…; I18N_PREVIEW=1 builds serve every page):
 * per sampled page per language, a self-referencing canonical, the reciprocal hreflang set with itself, English and
 * x-default (the English URL), valid codes only, <html lang>, og:locale and Content-Language, alternates only to
 * 200 / indexable / self-canonical pages, head and sitemap sets equal; a language not live is a 404; the picker,
 * footer links and suggestion banner use real links to the same page; and no English text is left in a page's main
 * content (src/i18n/leftover-allow.json lists what may stay: names, brands).
 *
 *   node scripts/e2e-i18n.mjs http://localhost:3000            (LIVE_LOCALES=es,ja to check languages)
 *
 * Read-only: GET requests only.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SITE = "https://playpokeiq.com";
const ALL = ["ja", "es", "fr", "de", "it"];
const CODES = new Set(["en", ...ALL, "x-default"]);
const OG = { en: "en_US", ja: "ja_JP", es: "es_ES", fr: "fr_FR", de: "de_DE", it: "it_IT" };
/** English pages every check samples (hubs, the daily games, the Pokédex's kinds of page). */
export const SAMPLE = ["/", "/daily", "/pokedle", "/pokeconnections", "/pikadoku", "/pokeguessr", "/quiz", "/pokedex", "/pokemon/pikachu", "/pokedex/moves/thunderbolt", "/battle", "/privacy", "/credits", "/trainer", "/leaderboard"];

const live = (process.env.LIVE_LOCALES ?? "").split(",").map((s) => s.trim()).filter((l) => ALL.includes(l));

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) out[m[1].toLowerCase()] = m[2].replace(/&amp;/g, "&");
  return out;
}

/** What a page's HTML says about its language and its alternates. */
export function headOf(html) {
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => attrs(m[0]));
  const metas = [...html.matchAll(/<meta\b[^>]*>/g)].map((m) => attrs(m[0]));
  const alternates = {};
  for (const l of links) if (l.rel === "alternate" && l.hreflang) alternates[l.hreflang] = l.href;
  return {
    lang: /<html\b[^>]*\blang="([^"]*)"/.exec(html)?.[1] ?? null,
    canonical: links.find((l) => l.rel === "canonical")?.href ?? null,
    alternates,
    ogLocale: metas.find((m) => m.property === "og:locale")?.content ?? null,
    contentLanguage: metas.find((m) => m["http-equiv"]?.toLowerCase() === "content-language")?.content ?? null,
    noindex: metas.some((m) => m.name === "robots" && /noindex/.test(m.content ?? "")),
  };
}

async function get(BASE, path) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), body: res.status === 200 ? await res.text() : "" };
}

const local = (BASE, url) => (url.startsWith(SITE) ? url.slice(SITE.length) || "/" : url.startsWith(BASE) ? url.slice(BASE.length) || "/" : url);
const prefixed = (l, path) => (l === "en" ? path : path === "/" ? `/${l}` : `/${l}${path}`);

async function englishOnly({ BASE, errors, step }) {
  step("languages: English only — no hreflang, <html lang=en>, other languages 404, /en/* 308");
  for (const path of SAMPLE) {
    const r = await get(BASE, path);
    if (r.status !== 200) {
      errors.push(`i18n: ${path} answered ${r.status}`);
      continue;
    }
    const h = headOf(r.body);
    if (h.lang !== "en") errors.push(`i18n: ${path} has <html lang="${h.lang}">`);
    if (Object.keys(h.alternates).length) errors.push(`i18n: ${path} lists hreflang alternates while English is the only language: ${JSON.stringify(h.alternates)}`);
    if (h.contentLanguage) errors.push(`i18n: ${path} has a Content-Language meta`);
    if (h.ogLocale && h.ogLocale !== "en_US") errors.push(`i18n: ${path} has og:locale ${h.ogLocale}`);
    if (/hreflang=|\/(es|fr|de|it|ja)\/sitemap\.xml/.test(r.body)) errors.push(`i18n: ${path} mentions another language`);
  }
  for (const path of ["/es", "/es/pokedle", "/ja/pokemon/pikachu", "/fr", "/de/quiz", "/it/pokedex"]) {
    const r = await get(BASE, path);
    if (r.status !== 404) errors.push(`i18n: ${path} answered ${r.status} (a language that isn't live must be a 404)`);
    else {
      const body = await (await fetch(`${BASE}${path}`)).text();
      if (/hreflang=|rel="canonical"/.test(body)) errors.push(`i18n: ${path}'s 404 carries a canonical or hreflang`);
      if (headOf(body).lang !== "en") errors.push(`i18n: ${path}'s 404 isn't lang="en"`);
    }
  }
  for (const [from, to] of [["/en", "/"], ["/en/pokedle", "/pokedle"], ["/en/pokemon/pikachu?x=1", "/pokemon/pikachu?x=1"]]) {
    const r = await get(BASE, from);
    if (r.status !== 308 || local(BASE, r.location ?? "") !== to) errors.push(`i18n: ${from} answered ${r.status} → ${r.location} (expected 308 → ${to})`);
  }
  if ((await get(BASE, "/sitemap-index.xml")).status !== 404) errors.push("i18n: /sitemap-index.xml exists while English is the only language");
  const sitemap = await get(BASE, "/sitemap.xml");
  if (/xhtml:link|playpokeiq\.com\/(es|fr|de|it|ja)(\/|<)/.test(sitemap.body)) errors.push("i18n: sitemap.xml lists another language");
  const robots = await get(BASE, "/robots.txt");
  if (/\/(es|fr|de|it|ja)\//.test(robots.body)) errors.push("i18n: robots.txt names another language");
}

async function languages({ BASE, errors, step }) {
  step(`languages: ${live.join(", ")} — canonical, reciprocal hreflang, lang, sitemaps`);
  const index = await get(BASE, "/sitemap-index.xml");
  for (const l of ["en", ...live]) {
    const want = `${SITE}/${l === "en" ? "" : `${l}/`}sitemap.xml`;
    if (!index.body.includes(want)) errors.push(`i18n: the sitemap index doesn't list ${want}`);
  }
  for (const l of ALL.filter((x) => !live.includes(x))) {
    if ((await get(BASE, `/${l}/pokedle`)).status !== 404) errors.push(`i18n: /${l}/pokedle isn't a 404 (${l} isn't live)`);
    if (index.body.includes(`/${l}/`)) errors.push(`i18n: the sitemap index names ${l}, which isn't live`);
  }
  // Each language's sitemap: the pages it serves, with the same alternates as the pages' heads.
  const heads = new Map();
  const head = async (path) => {
    if (!heads.has(path)) {
      const r = await get(BASE, path);
      heads.set(path, { status: r.status, location: r.location, ...headOf(r.body) });
    }
    return heads.get(path);
  };
  for (const l of live) {
    const sm = await get(BASE, `/${l}/sitemap.xml`);
    if (sm.status !== 200) {
      errors.push(`i18n: /${l}/sitemap.xml answered ${sm.status}`);
      continue;
    }
    const entries = [...sm.body.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
      loc: /<loc>([^<]+)<\/loc>/.exec(m[1])[1].replace(/&amp;/g, "&"),
      alternates: Object.fromEntries([...m[1].matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((a) => [a[1], a[2].replace(/&amp;/g, "&")])),
    }));
    if (entries.length > 50_000) errors.push(`i18n: /${l}/sitemap.xml has ${entries.length} URLs (over 50,000)`);
    // The sampled pages that exist in this language, plus a spread of the sitemap.
    const step = Math.max(1, Math.floor(entries.length / 40));
    const picked = new Map(entries.filter((_, i) => i % step === 0).map((e) => [local(BASE, e.loc), e]));
    for (const p of SAMPLE) {
      const e = entries.find((x) => local(BASE, x.loc) === prefixed(l, p));
      if (e) picked.set(prefixed(l, p), e);
    }
    for (const [path, entry] of picked) {
      const h = await head(path);
      if (h.status !== 200) {
        errors.push(`i18n: ${path} (in /${l}/sitemap.xml) answered ${h.status}${h.location ? ` → ${h.location}` : ""}`);
        continue;
      }
      if (h.lang !== l) errors.push(`i18n: ${path} has <html lang="${h.lang}">`);
      if (h.canonical !== entry.loc) errors.push(`i18n: ${path}'s canonical is ${h.canonical}, not itself (${entry.loc})`);
      if (h.ogLocale !== OG[l]) errors.push(`i18n: ${path} has og:locale ${h.ogLocale} (expected ${OG[l]})`);
      if (h.contentLanguage !== l) errors.push(`i18n: ${path} has Content-Language ${h.contentLanguage}`);
      if (h.noindex) errors.push(`i18n: ${path} is noindex but in the sitemap`);
      if (JSON.stringify(sortKeys(h.alternates)) !== JSON.stringify(sortKeys(entry.alternates))) errors.push(`i18n: ${path}: head hreflang ${JSON.stringify(h.alternates)} ≠ sitemap ${JSON.stringify(entry.alternates)}`);
      checkSet(path, h.alternates, l, entry.loc, errors);
      // Reciprocal: every alternate is a 200, indexable, canonical to itself, and lists the same set.
      for (const [code, url] of Object.entries(h.alternates)) {
        if (code === "x-default") continue;
        const other = await head(local(BASE, url));
        if (other.status !== 200) errors.push(`i18n: ${path}'s ${code} alternate ${url} answered ${other.status}`);
        else if (other.noindex) errors.push(`i18n: ${path}'s ${code} alternate ${url} is noindex`);
        else if (other.canonical !== url) errors.push(`i18n: ${path}'s ${code} alternate ${url} has canonical ${other.canonical}`);
        else if (JSON.stringify(sortKeys(other.alternates)) !== JSON.stringify(sortKeys(h.alternates))) errors.push(`i18n: ${url} lists a different hreflang set than ${path}`);
      }
    }
  }
}

function sortKeys(o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

function checkSet(path, set, l, self, errors) {
  for (const code of Object.keys(set)) if (!CODES.has(code)) errors.push(`i18n: ${path} lists hreflang "${code}"`);
  if (set[l] !== self) errors.push(`i18n: ${path}'s hreflang set doesn't list itself as ${l}`);
  if (!set.en || set["x-default"] !== set.en) errors.push(`i18n: ${path}'s x-default (${set["x-default"]}) isn't its English URL (${set.en})`);
}

/** The picker, footer links and suggestion banner: real links to the same page, never a redirect. */
async function controls({ browser, BASE, errors, step }) {
  step("languages: Settings language row, footer links, suggestion banner");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: `${live[0]}-XX` });
  await ctx.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/pokedle`, { waitUntil: "load" });
    if (new URL(page.url()).pathname !== "/pokedle") errors.push(`i18n: /pokedle went to ${page.url()} (never redirect by language)`);
    const offer = page.getByTestId("language-suggestion");
    if (!(await offer.waitFor({ timeout: 5000 }).then(() => true, () => false))) errors.push(`i18n: no ${live[0]} suggestion for a ${live[0]} browser on /pokedle`);
    else {
      const href = await offer.locator("a").getAttribute("href");
      if (href !== `/${live[0]}/pokedle`) errors.push(`i18n: the suggestion links to ${href}`);
      await offer.getByRole("button").click();
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(800);
      if (await offer.isVisible()) errors.push("i18n: the suggestion came back after it was dismissed");
    }
    const footer = page.getByTestId("footer-languages");
    const hrefs = await footer.locator("a").evaluateAll((as) => as.map((a) => [a.getAttribute("hreflang"), a.getAttribute("href")]));
    const want = ["en", ...live].map((l) => [l, prefixed(l, "/pokedle")]);
    if (JSON.stringify(hrefs.sort()) !== JSON.stringify(want.sort())) errors.push(`i18n: footer language links ${JSON.stringify(hrefs)} (expected ${JSON.stringify(want)})`);
    await page.getByTestId("account-menu-trigger").click().catch(() => {});
    const select = page.locator('[data-testid$="-language"]').first();
    if (!(await select.waitFor({ timeout: 5000 }).then(() => true, () => false))) errors.push("i18n: no Language row in the header menu");
    else {
      const options = await select.locator("option").evaluateAll((os) => os.map((o) => o.value));
      if (JSON.stringify(options) !== JSON.stringify(["en", ...live])) errors.push(`i18n: the language picker offers ${options}`);
      await Promise.all([page.waitForURL(`**/${live[0]}/pokedle`), select.selectOption(live[0])]);
    }
  } finally {
    await ctx.close();
  }
}

/** Text in a page's <main> that reads exactly as on the English page: English left behind (names and brands allowed). */
async function leftovers({ browser, BASE, errors, step }) {
  step("languages: no English left in translated pages");
  // What may read the same in every language: brand names (src/i18n/leftover-allow.json) and the language's own
  // Pokémon names (many are the English ones in Spanish and Italian). Text made only of those, numbers and
  // punctuation is not English left behind.
  const brands = JSON.parse(readFileSync(new URL("../src/i18n/leftover-allow.json", import.meta.url), "utf8"));
  const species = Object.values(JSON.parse(readFileSync(new URL("../src/data/species-names.json", import.meta.url), "utf8")));
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namesOf = (l) => new RegExp(`(?:${[...brands, ...species.map((n) => n[l]).filter(Boolean)].sort((a, b) => b.length - a.length).map(escape).join("|")})`, "gu");
  const english = (t, names) => /\p{L}{3}/u.test(t.replace(names, " "));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    localStorage.setItem("pokeiq-locale-suggest", "1");
  });
  const page = await ctx.newPage();
  const texts = async (path) => {
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const out = [];
      const walk = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest("script,style,[data-user-content],[translate=no]")) continue;
        const t = n.textContent.replace(/\s+/g, " ").trim();
        if (/\p{L}{2}/u.test(t)) out.push(t);
      }
      for (const el of document.querySelectorAll("main [aria-label], main [title], main [placeholder], main img[alt]")) {
        for (const a of ["aria-label", "title", "placeholder", "alt"]) {
          const v = el.getAttribute(a)?.trim();
          if (v && /\p{L}{2}/u.test(v)) out.push(v);
        }
      }
      return out;
    });
  };
  try {
    for (const l of live) {
      const names = namesOf(l);
      for (const path of SAMPLE) {
        const r = await get(BASE, prefixed(l, path));
        if (r.status !== 200) continue;
        const en = new Set(await texts(path));
        const left = [...new Set(await texts(prefixed(l, path)))].filter((t) => en.has(t) && english(t, names));
        if (left.length) errors.push(`i18n: ${prefixed(l, path)} still shows English: ${left.slice(0, 8).map((t) => JSON.stringify(t.slice(0, 60))).join(", ")}${left.length > 8 ? ` (+${left.length - 8})` : ""}`);
      }
    }
  } finally {
    await ctx.close();
  }
}

export async function runI18n({ browser, BASE, errors, step }) {
  if (!live.length) return englishOnly({ BASE, errors, step });
  await languages({ BASE, errors, step });
  await controls({ browser, BASE, errors, step });
  await leftovers({ browser, BASE, errors, step });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  await runI18n({ browser, BASE, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  for (const e of errors) console.error(`  ${e}`);
  console.log(errors.length ? `✗ ${errors.length} language problem(s)` : "✓ languages ok");
  process.exit(errors.length ? 1 : 0);
}
