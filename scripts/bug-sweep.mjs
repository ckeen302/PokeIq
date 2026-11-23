/**
 * Bug sweep: loads a sample of every route type of a running PokéIQ (a local
 * production build) on phone and desktop, in dark and light, and reports what
 * looks broken: console errors and hydration warnings, failed requests,
 * broken images, images without alt text, broken internal links, sideways
 * scrolling on phones, elements running off screen, clipped, overlapping or
 * invisible text, and buttons with nothing behind them.
 *
 *   npm run build && npm start             # in another terminal
 *   node scripts/bug-sweep.mjs [baseUrl]
 *
 * It's a report, not a test: it always exits 0. The findings land in
 * e2e-screenshots/bug-sweep/ (report.json, report.md, and a screenshot of
 * every page with a finding).
 *
 * Env:
 *   SWEEP_ONLY=<regex>       only routes whose path matches
 *   SWEEP_CONFIGS=<list>     e.g. "390:dark,1440:light" (default: 390 and 1440
 *                            in both schemes for every route, 1024 and 1710
 *                            in dark for the top-level pages)
 *   SWEEP_PER_GROUP=<n>      examples per route type beyond the edge cases (default 3)
 *   SWEEP_WORKERS=<n>        pages loaded at once (default 3)
 *   SWEEP_NO_STATES=1        skip the interactive states (games, results, signed in)
 *   SWEEP_NO_LINKS=1         skip checking internal links
 *   SWEEP_SHOTS=all          screenshot every page, not just the ones with findings
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = process.env.SWEEP_OUT ?? "e2e-screenshots/bug-sweep";
const ONLY = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;
const PER_GROUP = Number(process.env.SWEEP_PER_GROUP ?? 3);
const WORKERS = Number(process.env.SWEEP_WORKERS ?? 3);
const SHOTS_ALL = process.env.SWEEP_SHOTS === "all";
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Edge cases the sitemap's sample might miss: forms, long names, first and last entries, odd characters. */
const EDGE_ROUTES = [
  "/",
  "/pokemon/bulbasaur", // first
  "/pokemon/pecharunt", // last
  "/pokemon/crabominable", // longest name
  "/pokemon/vulpix", // Alolan form
  "/pokemon/meowth", // Alolan, Galarian, Gigantamax
  "/pokemon/tauros", // Paldean breeds
  "/pokemon/pikachu", // many forms
  "/pokemon/charizard", // Megas, Gigantamax
  "/pokemon/rotom", // appliance forms
  "/pokemon/urshifu",
  "/pokemon/zygarde",
  "/pokemon/nidoran-f", // symbol in the name
  "/pokemon/type-null", // colon in the name
  "/pokemon/farfetchd", // apostrophe
  "/pokemon/mr-mime", // dot and space
  "/pokemon/flabebe", // accent
  "/pokemon/oricorio",
  "/pokemon/alcremie",
  "/login",
  "/trainer",
  "/trainer/avatar",
  "/battle/insights",
  "/battle/replay/import",
  "/quiz/which-pokemon/compare",
  "/pokedex/sizes/compare?vs=wailord,eternatus,joltik",
  "/pokedex/race/run",
  "/lab/games/run",
  "/pokeguessr/history",
  "/email/confirm",
  "/email/unsubscribe",
  // Empty and missing states.
  "/this-page-does-not-exist",
  "/pokemon/not-a-pokemon",
  "/u/nobody-has-this-name",
  "/battle/player/nobody-has-this-name",
  "/battle/replay/not-a-replay",
  "/battle/tournaments/not-a-tournament",
  "/rooms/not-a-room",
  "/pokeconnections/c/not-a-puzzle",
  "/pokeconnections/creator/nobody-has-this-name",
  "/pokedex/tcg/not-a-set",
  "/pokedex/tcg/card/not-a-card",
  "/c/not-a-token",
  "/s/not-a-payload",
  "/pokeguessr/r/not-a-token",
  "/pokeguessr/c/not-a-token",
  "/pokedle/duel/ZZZZZZ",
  "/quiz/duel/ZZZZZZ",
];

/** Pages that are their own top-level destination: also checked at 1024 and 1710 wide. */
function isTopLevel(p) {
  const segs = p.split("?")[0].split("/").filter(Boolean);
  return segs.length <= 1 || /^\/(pokedex|battle|tools|quiz|lab)\/[^/]+$/.test(p.split("?")[0]);
}

/** A route's type: its first two segments, then one * per deeper segment. */
function groupOf(p) {
  const segs = p.split("?")[0].split("/").filter(Boolean);
  if (segs.length <= 1) return p.split("?")[0] || "/";
  if (segs.length === 2) return `/${segs[0]}/*`;
  return `/${segs[0]}/${segs[1]}/${segs.slice(2).map(() => "*").join("/")}`;
}

/** A small deterministic shuffle so a run's sample is repeatable. */
function pick(list, n, seed = 7) {
  const out = [];
  let s = seed;
  const pool = [...list];
  while (out.length < n && pool.length) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out.push(pool.splice(s % pool.length, 1)[0]);
  }
  return out;
}

async function sitemapPaths() {
  const locs = [];
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) locs.push(m[1]);
  return locs.map((u) => new URL(u.replace(/&amp;/g, "&")).pathname + new URL(u.replace(/&amp;/g, "&")).search);
}

/** Groups the paths by route type and keeps every one of a small type, the edge cases of a big one (first, last, longest, shortest) and a few more. */
function sample(paths) {
  const groups = new Map();
  for (const p of paths) {
    const g = groupOf(p);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  const out = new Set();
  for (const list of groups.values()) {
    if (list.length <= PER_GROUP + 3) {
      list.forEach((p) => out.add(p));
      continue;
    }
    const byLen = [...list].sort((a, b) => a.length - b.length);
    [list[0], list.at(-1), byLen[0], byLen.at(-1), ...pick(list, PER_GROUP)].forEach((p) => out.add(p));
  }
  return { paths: [...out], groups };
}

/** Internal links on the sampled pages' HTML whose route type the sitemap doesn't have (TCG cards, boards, players…): a couple of each. */
async function discover(paths, known) {
  const found = new Map();
  await pool(paths, 8, async (p) => {
    const html = await fetch(BASE + p).then((r) => r.text(), () => "");
    for (const m of html.matchAll(/href="(\/[^"#]*)"/g)) {
      const href = m[1].replace(/&amp;/g, "&");
      if (/^\/(api|_next)\//.test(href) || /\.(png|jpe?g|svg|webp|xml|txt|json|ico|zip|gif|mp3|ogg)(\?|$)/.test(href)) continue;
      const g = groupOf(href);
      if (known.has(g)) continue;
      if (!found.has(g)) found.set(g, new Set());
      found.get(g).add(href);
    }
  });
  return [...found.values()].flatMap((s) => pick([...s], 2));
}

// ---------------------------------------------------------------------------
// In-page inspection
// ---------------------------------------------------------------------------

/** Runs in the page: everything that looks broken in the current layout. */
function inspect() {
  const vw = document.documentElement.clientWidth;
  const out = { overflow: 0, offscreen: [], clipped: [], overlaps: [], invisible: [], noAlt: [], brokenImgs: [], deadButtons: [], hashLinks: [], links: [] };
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (sw > vw + 1) out.overflow = sw;

  const desc = (el) => {
    const tid = el.closest("[data-testid]")?.getAttribute("data-testid");
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 4).join(".") : "";
    const text = (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}${tid ? ` [${tid}]` : ""}${text ? ` "${text}"` : ""}`;
  };
  const shown = (el) =>
    el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? getComputedStyle(el).visibility !== "hidden";
  const clipsX = (el) => {
    const cs = getComputedStyle(el);
    return cs.overflowX !== "visible" || cs.contain.includes("paint");
  };
  const inFixed = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const pos = getComputedStyle(a).position;
      if (pos === "fixed" || pos === "sticky") return true;
    }
    return false;
  };
  const srOnly = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width <= 1 || r.height <= 1 || cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.clipPath === "inset(50%)";
  };
  const all = [...document.body.querySelectorAll("*")].filter((el) => !(el instanceof SVGElement && !(el instanceof SVGSVGElement)));

  // Off screen: the outermost element sticking out past either edge, outside any scroller or clipper that owns it.
  const offenders = new Set();
  for (const el of all) {
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    if (!shown(el) || srOnly(el)) continue;
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (clipsX(a)) { clipped = true; break; }
    }
    if (clipped) continue;
    if (el.parentElement && offenders.has(el.parentElement)) { offenders.add(el); continue; }
    offenders.add(el);
    if (out.offscreen.length < 12) out.offscreen.push(`${desc(el)} (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`);
  }

  // Clipped text: a box that hides text it can't fit, with no ellipsis or line clamp to say so.
  const textEls = [];
  for (const el of all) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) continue;
    if (!shown(el) || srOnly(el)) continue;
    textEls.push([el, own]);
    const cs = getComputedStyle(el);
    if (el.tagName === "TEXTAREA" || el.tagName === "OPTION") continue;
    const hidesX = cs.overflowX === "hidden" || cs.overflowX === "clip";
    const hidesY = cs.overflowY === "hidden" || cs.overflowY === "clip";
    const marked = cs.textOverflow === "ellipsis" || (cs.webkitLineClamp && cs.webkitLineClamp !== "none");
    if (marked) continue;
    const overX = hidesX && el.scrollWidth > el.clientWidth + 2;
    const overY = hidesY && el.scrollHeight > el.clientHeight + 3 && el.clientHeight > 0;
    if ((overX || overY) && out.clipped.length < 15) out.clipped.push(`${desc(el)} (${overX ? `w ${el.scrollWidth}>${el.clientWidth}` : ""}${overY ? ` h ${el.scrollHeight}>${el.clientHeight}` : ""})`);
  }

  // Overlapping and invisible text: each text run's box, cut down by the boxes that clip it.
  const clipCache = new Map();
  const clipRect = (el) => {
    if (!el || el === document.body || el === document.documentElement) return { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
    if (clipCache.has(el)) return clipCache.get(el);
    const parent = clipRect(el.parentElement);
    const cs = getComputedStyle(el);
    let c = parent;
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
      const r = el.getBoundingClientRect();
      c = { l: Math.max(parent.l, r.left), t: Math.max(parent.t, r.top), r: Math.min(parent.r, r.right), b: Math.min(parent.b, r.bottom) };
    }
    clipCache.set(el, c);
    return c;
  };
  const runs = [];
  for (const [el, nodes] of textEls) {
    if (inFixed(el) || el.closest("[aria-hidden='true'],[inert],svg,canvas")) continue;
    for (const n of nodes) {
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        const c = clipRect(el);
        const box = { l: Math.max(r.left, c.l), t: Math.max(r.top, c.t), r: Math.min(r.right, c.r), b: Math.min(r.bottom, c.b) };
        if (box.r - box.l < 2 || box.b - box.t < 2) continue;
        runs.push({ el, box, text: n.textContent.trim().slice(0, 30) });
      }
    }
    if (runs.length > 2500) break;
  }
  const seenPairs = new Set();
  for (let i = 0; i < runs.length && out.overlaps.length < 12; i++) {
    const a = runs[i];
    for (let j = i + 1; j < runs.length; j++) {
      const b = runs[j];
      if (a.el === b.el) continue;
      const w = Math.min(a.box.r, b.box.r) - Math.max(a.box.l, b.box.l);
      const h = Math.min(a.box.b, b.box.b) - Math.max(a.box.t, b.box.t);
      if (w <= 2 || h <= 2) continue;
      const smaller = Math.min((a.box.r - a.box.l) * (a.box.b - a.box.t), (b.box.r - b.box.l) * (b.box.b - b.box.t));
      if ((w * h) / smaller < 0.3) continue;
      const key = `${a.text}|${b.text}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      out.overlaps.push(`"${a.text}" overlaps "${b.text}" at ${Math.round(a.box.l)},${Math.round(a.box.t)} (${desc(a.el).slice(0, 60)} / ${desc(b.el).slice(0, 60)})`);
      if (out.overlaps.length >= 12) break;
    }
  }

  // Invisible text: a text colour too close to the solid background behind it (light mode on a dark-only colour, say).
  const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.backgroundImage !== "none" || cs.backdropFilter !== "none" || cs.filter !== "none" || cs.mixBlendMode !== "normal") return null;
      const c = rgb(cs.backgroundColor);
      if (c.length >= 3 && (c[3] ?? 1) === 1) return c;
      if (c.length >= 4 && c[3] > 0) return null; // translucent: can't tell
    }
    return null;
  };
  const checked = new Set();
  for (const { el } of runs) {
    if (checked.has(el) || out.invisible.length >= 10) continue;
    checked.add(el);
    const cs = getComputedStyle(el);
    if (cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color && /0\)$/.test(cs.webkitTextFillColor)) continue; // gradient text
    const fg = rgb(cs.color);
    if ((fg[3] ?? 1) < 0.5) continue;
    const bg = bgOf(el);
    if (!bg) continue;
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (ratio < 1.6) out.invisible.push(`${desc(el)} (contrast ${ratio.toFixed(2)}: ${cs.color} on rgb(${bg.slice(0, 3).join(", ")}))`);
  }

  // Images.
  for (const img of document.images) {
    const hidden = img.closest("[aria-hidden='true']") || img.getAttribute("role") === "presentation" || img.getAttribute("role") === "none";
    if (!img.hasAttribute("alt") && !hidden && out.noAlt.length < 15) out.noAlt.push(img.currentSrc || img.src || desc(img));
    if ((img.currentSrc || img.getAttribute("src")) && img.complete && img.naturalWidth === 0 && out.brokenImgs.length < 15) out.brokenImgs.push(img.currentSrc || img.src);
  }

  // Buttons with nothing behind them: no handler on the button or the few elements around it, not a form's submit, not a popover's.
  const reactProps = (el) => {
    const k = Object.keys(el).find((x) => x.startsWith("__reactProps$"));
    return k ? el[k] : null;
  };
  const HANDLERS = ["onClick", "onClickCapture", "onPointerDown", "onPointerUp", "onMouseDown", "onMouseUp", "onTouchStart", "onTouchEnd", "onKeyDown", "onPointerDownCapture"];
  const hasHandler = (el) => {
    const p = reactProps(el);
    return !!p && HANDLERS.some((h) => typeof p[h] === "function");
  };
  const reactRoot = Object.keys(document.body).some((k) => k.startsWith("__reactContainer$")) || !!document.querySelector("[data-reactroot]") || [...document.body.querySelectorAll("*")].some((el) => reactProps(el));
  if (reactRoot) {
    for (const b of document.querySelectorAll("button, [role='button'], a:not([href]), a[href='#'], a[href^='javascript:']")) {
      if (b.disabled || b.getAttribute("aria-disabled") === "true" || !shown(b) || srOnly(b)) continue;
      if (b.tagName === "A" && b.getAttribute("role") !== "button" && !b.hasAttribute("href")) continue; // a placeholder <a>, not a control
      if (b.hasAttribute("popovertarget") || b.hasAttribute("commandfor")) continue;
      if (b.tagName === "BUTTON" && b.type !== "button" && b.form) continue;
      if (b.closest("summary,label")) continue;
      let ok = false;
      for (let a = b, i = 0; a && i < 6; a = a.parentElement, i++) if (hasHandler(a)) { ok = true; break; }
      if (!ok && out.deadButtons.length < 12) out.deadButtons.push(desc(b));
    }
  }

  // Links: same-site paths to check later, and hash links to an id that isn't on the page.
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (/^#[^/]/.test(href) && !document.getElementById(decodeURIComponent(href.slice(1)))) {
      if (out.hashLinks.length < 10) out.hashLinks.push(`${href} (${desc(a)})`);
      continue;
    }
    let u;
    try { u = new URL(a.href); } catch { continue; }
    if (u.origin !== location.origin) continue;
    out.links.push(u.pathname + u.search);
  }
  out.links = [...new Set(out.links)];
  return out;
}

// ---------------------------------------------------------------------------
// Driving the browser
// ---------------------------------------------------------------------------

const HOWTO = '[data-testid="howto-sheet"], [data-testid="pdk-howto"]';
async function closeHowTo(p) {
  const sheet = p.locator(HOWTO).first();
  if (await sheet.isVisible().catch(() => false)) {
    await p.getByTestId("howto-never").first().click({ timeout: 2_000 }).catch(() => {});
    await sheet.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => {});
  }
}

/** Scrolls to the bottom a screen at a time so lazy images and sections load, then back to the top. */
async function scrollThrough(p) {
  await p.evaluate(async () => {
    const step = innerHeight * 0.9;
    for (let i = 0; i < 25 && scrollY + innerHeight < document.documentElement.scrollHeight - 2; i++) {
      scrollBy(0, step);
      await new Promise((r) => setTimeout(r, 120));
    }
  }).catch(() => {});
  await p.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  await p.evaluate(() => scrollTo(0, 0)).catch(() => {});
  await p.waitForTimeout(400);
}

function configLabel(c) {
  return `${c.width}-${c.scheme}${c.signedIn ? "-signedin" : ""}`;
}

async function newContext(browser, c) {
  const phone = c.width < 600;
  const ctx = await browser.newContext({
    viewport: { width: c.width, height: phone ? 844 : c.width >= 1700 ? 1107 : 900 },
    isMobile: phone,
    hasTouch: phone,
    deviceScaleFactor: 1,
    colorScheme: c.scheme,
    userAgent: phone ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 PokeIQ-bug-sweep" : undefined,
  });
  // Dark is the site's default; light is a saved choice, applied before paint.
  await ctx.addInitScript((scheme) => {
    try { if (scheme === "light") localStorage.setItem("pokeiq-theme", "light"); } catch {}
  }, c.scheme);
  if (c.signedIn) {
    const name = `sweep${Date.now().toString(36)}${c.width}${c.scheme[0]}`;
    const res = await ctx.request.post(`${BASE}/api/auth/register`, { data: { username: name, password: "correct horse battery" }, headers: { Origin: BASE } });
    if (!res.ok()) console.warn(`couldn't register a local account (${res.status()}): signed-in pages will be signed out`);
    c.username = name;
  }
  return ctx;
}

/** Things that are fine: the browser's own noise, and requests this sandbox can't make. */
const IGNORE_CONSOLE = [/Download the React DevTools/, /\[Fast Refresh\]/, /WebGL|GPU stall|GroupMarkerNotSet|swiftshader/i];

async function visit(ctx, c, route, action) {
  const p = await ctx.newPage();
  const f = { route: route + (action ? ` [${action.name}]` : ""), config: configLabel(c), console: [], failed: [], external: [] };
  p.on("console", (m) => {
    const t = m.text();
    if (IGNORE_CONSOLE.some((re) => re.test(t))) return;
    if (m.type() === "error" || (m.type() === "warning" && /hydrat|did not match|key prop|unique "key"/i.test(t))) f.console.push(`${m.type()}: ${t.slice(0, 300)}`);
  });
  p.on("pageerror", (e) => f.console.push(`pageerror: ${String(e.message ?? e).slice(0, 300)}`));
  p.on("response", (r) => {
    if (r.status() < 400) return;
    const u = r.url();
    (u.startsWith(BASE) ? f.failed : f.external).push(`${r.status()} ${r.request().resourceType()} ${u.replace(BASE, "")}`);
  });
  p.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "";
    if (/ERR_ABORTED/.test(why)) return;
    const u = r.url();
    (u.startsWith(BASE) ? f.failed : f.external).push(`${why} ${r.resourceType()} ${u.replace(BASE, "").slice(0, 200)}`);
  });
  try {
    const res = await p.goto(BASE + route, { waitUntil: "load", timeout: 45_000 });
    f.status = res?.status();
    await p.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
    await closeHowTo(p);
    if (action) await action.run(p, c);
    await scrollThrough(p);
    Object.assign(f, await p.evaluate(inspect));
    if (c.width >= 600) f.overflow = 0; // sideways scrolling is a phone check; wide screens report off-screen elements instead
    const findings = f.console.length + f.failed.length + (f.overflow ? 1 : 0) + f.offscreen.length + f.clipped.length + f.overlaps.length + f.invisible.length + f.noAlt.length + f.brokenImgs.length + f.deadButtons.length + f.hashLinks.length;
    if (findings || SHOTS_ALL || action) {
      f.shot = `${OUT}/${configLabel(c)}${(route + (action ? `-${action.name}` : "")).replace(/[^a-z0-9]+/gi, "_").slice(0, 120)}.jpg`;
      await p.screenshot({ path: f.shot, type: "jpeg", quality: 60 }).catch(() => {});
    }
  } catch (e) {
    f.console.push(`sweep: ${String(e.message ?? e).split("\n")[0]}`);
  }
  await p.close();
  return f;
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// ---------------------------------------------------------------------------
// Interactive states: a game in progress, a results screen
// ---------------------------------------------------------------------------

const STATES = [
  {
    route: "/quiz/whos-that-pokemon",
    name: "in-progress",
    async run(p) {
      await p.getByRole("button", { name: /^Start/ }).first().click({ timeout: 10_000 });
      await p.waitForSelector("h2", { timeout: 10_000 });
      await p.waitForTimeout(800);
    },
  },
  {
    route: "/quiz/whos-that-pokemon",
    name: "results",
    async run(p) {
      await p.getByRole("button", { name: /^Start/ }).first().click({ timeout: 10_000 });
      await p.waitForSelector("h2", { timeout: 10_000 });
      for (let i = 0; i < 10; i++) {
        await p.locator("main button:not([disabled])").filter({ hasNotText: /settings/i }).first().click({ timeout: 10_000 });
        const next = p.getByRole("button", { name: /Next question|See results/ });
        await next.waitFor({ timeout: 10_000 });
        await next.click();
      }
      await p.waitForTimeout(1800);
    },
  },
  {
    route: "/pokedle",
    name: "in-progress",
    async run(p) {
      for (const name of ["Charizard", "Gengar"]) {
        await p.waitForFunction(() => document.body.innerText.includes("Got it in") || document.querySelector("input[aria-label^='Guess a Pokémon']")?.disabled === false, null, { timeout: 15_000 }).catch(() => {});
        if (await p.getByText(/Got it in/).count()) break;
        await p.getByLabel("Guess a Pokémon").fill(name);
        await p.getByRole("option").first().click({ timeout: 5_000 });
        await p.waitForTimeout(2500);
      }
    },
  },
  {
    route: "/iq-test",
    name: "in-progress",
    async run(p) {
      await p.getByRole("button", { name: /^(Start|Begin|Take the test)/i }).first().click({ timeout: 10_000 });
      await p.waitForTimeout(1500);
    },
  },
  {
    route: "/pikadoku",
    name: "in-progress",
    async run(p) {
      await p.locator("[data-testid^='pdk-cell'], [aria-label*='row' i][role='button'], main button").first().click({ timeout: 10_000 }).catch(() => {});
      await p.waitForTimeout(1000);
    },
  },
  {
    route: "/pokeconnections",
    name: "in-progress",
    async run(p) {
      const tiles = p.locator("main [role='button'][aria-pressed], main button[aria-pressed]");
      for (let i = 0; i < 2; i++) await tiles.nth(i).click({ timeout: 5_000 }).catch(() => {});
      await p.waitForTimeout(600);
    },
  },
  {
    route: "/battle/play",
    name: "vs-computer",
    async run(p) {
      await p.getByRole("button", { name: /Battle the computer|vs computer|Play the computer/i }).first().click({ timeout: 8_000 }).catch(() => {});
      await p.waitForTimeout(6000);
    },
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const started = Date.now();
const fromSitemap = await sitemapPaths();
const { paths: sampled, groups } = sample(fromSitemap);
const extra = await discover([...new Set([...sampled, ...EDGE_ROUTES])], new Set([...groups.keys(), ...EDGE_ROUTES.map(groupOf)]));
let routes = [...new Set([...EDGE_ROUTES, ...sampled, ...extra])];
if (ONLY) routes = routes.filter((r) => ONLY.test(r));
console.log(`${fromSitemap.length} sitemap pages in ${groups.size} route types → ${routes.length} routes (${extra.length} found by following links)`);

const configs = process.env.SWEEP_CONFIGS
  ? process.env.SWEEP_CONFIGS.split(",").map((s) => {
      const [w, scheme, signed] = s.split(":");
      return { width: Number(w), scheme: scheme ?? "dark", signedIn: signed === "signedin", routes };
    })
  : [
      { width: 390, scheme: "dark", routes },
      { width: 1440, scheme: "dark", routes },
      { width: 390, scheme: "light", routes },
      { width: 1440, scheme: "light", routes },
      { width: 1024, scheme: "dark", routes: routes.filter(isTopLevel) },
      { width: 1710, scheme: "dark", routes: routes.filter(isTopLevel) },
      { width: 390, scheme: "dark", signedIn: true, routes: ["/", "/trainer", "/trainer/avatar", "/leaderboard", "/battle", "/pokedle", "/daily", "/users", "/rooms"] },
      { width: 1440, scheme: "light", signedIn: true, routes: ["/", "/trainer", "/trainer/avatar", "/leaderboard", "/battle", "/pokedle", "/daily", "/users", "/rooms"] },
    ];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];
const allLinks = new Map(); // path -> first page linking it
for (const c of configs) {
  const ctx = await newContext(browser, c);
  if (c.signedIn) c.routes = [...c.routes, `/u/${c.username}`];
  let done = 0;
  await pool(c.routes, WORKERS, async (r) => {
    const f = await visit(ctx, c, r);
    for (const l of f.links ?? []) if (!allLinks.has(l)) allLinks.set(l, r);
    delete f.links;
    results.push(f);
    if (++done % 25 === 0) console.log(`  ${configLabel(c)}: ${done}/${c.routes.length}`);
  });
  if (!process.env.SWEEP_NO_STATES && !c.signedIn && [390, 1440].includes(c.width)) {
    for (const s of STATES.filter((s) => !ONLY || ONLY.test(s.route))) {
      // Each state starts fresh, on a device that has never seen the game.
      const sctx = await newContext(browser, c);
      const f = await visit(sctx, c, s.route, s);
      delete f.links;
      results.push(f);
      await sctx.close();
    }
  }
  await ctx.close();
  console.log(`${configLabel(c)} done (${Math.round((Date.now() - started) / 1000)}s)`);
}
await browser.close();

// Broken internal links: every same-site link the sweep saw, fetched once.
const brokenLinks = [];
if (!process.env.SWEEP_NO_LINKS) {
  const links = [...allLinks.keys()].filter((l) => !/^\/(api|_next)\//.test(l));
  console.log(`checking ${links.length} internal links`);
  await pool(links, 8, async (l) => {
    try {
      const r = await fetch(BASE + l, { redirect: "follow" });
      if (r.status >= 400) brokenLinks.push(`${r.status} ${l} (linked from ${allLinks.get(l)})`);
      await r.body?.cancel();
    } catch (e) {
      brokenLinks.push(`${e.message} ${l} (linked from ${allLinks.get(l)})`);
    }
  });
}

// Report: findings grouped by kind, each message with the pages and configs it showed up on.
const KINDS = [
  ["console", "Console errors and hydration warnings"],
  ["failed", "Failed requests (this site)"],
  ["brokenImgs", "Broken images"],
  ["overflow", "Sideways scrolling on phones"],
  ["offscreen", "Elements running off screen"],
  ["clipped", "Clipped text"],
  ["overlaps", "Overlapping text"],
  ["invisible", "Text the same colour as its background"],
  ["noAlt", "Images without alt text"],
  ["deadButtons", "Buttons with no handler"],
  ["hashLinks", "Links to an anchor that isn't on the page"],
  ["external", "Failed requests (other sites; often just this sandbox's network)"],
];
const byKind = {};
for (const [k] of KINDS) {
  const m = new Map();
  for (const f of results) {
    const items = k === "overflow" ? (f.overflow ? [`page is ${f.overflow}px wide`] : []) : (f[k] ?? []);
    for (const it of items) {
      // Group the same message across routes: strip numbers that vary page to page.
      const key = it.replace(/\d+(\.\d+)?/g, "#");
      if (!m.has(key)) m.set(key, { sample: it, where: [] });
      m.get(key).where.push(`${f.route} @${f.config}`);
    }
  }
  byKind[k] = [...m.values()].sort((a, b) => b.where.length - a.where.length);
}
const report = { base: BASE, ranAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), routes, configs: configs.map(configLabel), brokenLinks, byKind, pages: results };
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
const md = [`# Bug sweep of ${BASE}`, "", `${results.length} page loads, ${routes.length} routes, ${report.seconds}s.`, ""];
for (const [k, title] of KINDS) {
  const list = byKind[k];
  md.push(`## ${title} (${list.length})`, "");
  for (const { sample, where } of list.slice(0, 60)) md.push(`- ${sample}`, `  - ${where.length}×: ${[...new Set(where)].slice(0, 6).join(", ")}${where.length > 6 ? ", …" : ""}`);
  md.push("");
}
md.push(`## Broken internal links (${brokenLinks.length})`, "", ...brokenLinks.map((l) => `- ${l}`), "");
fs.writeFileSync(`${OUT}/report.md`, md.join("\n"));
console.log(`\n${KINDS.map(([k, t]) => `${t}: ${byKind[k].length}`).join("\n")}\nBroken internal links: ${brokenLinks.length}\n\nReport: ${path.resolve(OUT, "report.md")}`);
