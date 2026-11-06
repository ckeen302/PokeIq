/**
 * Frame-exact screen recording of the real site for the home page's hero clips.
 *
 * The page runs on a virtual clock (Playwright's clock for timers, rAF and
 * performance.now, plus every CSS / Web Animation seeked by hand), so each
 * frame is drawn at exactly 1/fps of game time however slow the machine is:
 * no dropped or doubled frames, no judder. Input goes through the real
 * browser (CDP mouse, touch and keyboard events) and a tidy pointer (desktop)
 * or tap ripple (phone) is drawn on top. Frames are JPEG screenshots at
 * device scale 2, encoded later by encode.mjs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

export const OUT_ROOT = process.env.HERO_OUT ?? path.join(os.tmpdir(), "pokeiq-hero-frames");

/** A small seeded RNG, so every take of a script is the same take. */
export function rng(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** In the page: seek every animation by dt, and draw the pointer. */
function stepPage({ dt, cursor }) {
  const hv = (window.__hv ??= { anims: new WeakMap() });
  for (const a of document.getAnimations()) {
    if (a.playState === "finished" || a.playState === "idle") continue;
    let st = hv.anims.get(a);
    if (!st) {
      st = { t: a.currentTime ?? 0, rate: a.playbackRate || 1 };
      hv.anims.set(a, st);
      a.pause();
      // Newly made this frame: it starts now (no time has passed for it yet).
    } else {
      st.t += dt * st.rate;
    }
    const end = a.effect?.getComputedTiming().endTime ?? Infinity;
    if (Number.isFinite(end) && st.t >= end) {
      try {
        a.finish();
      } catch {
        a.currentTime = end;
      }
    } else {
      a.currentTime = st.t;
    }
  }
  if (cursor) {
    let el = document.getElementById("__hv-cursor");
    if (!el) {
      el = document.createElement("div");
      el.id = "__hv-cursor";
      el.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;will-change:transform;";
      el.innerHTML =
        cursor.kind === "tap"
          ? '<div class="r" style="position:absolute;left:-26px;top:-26px;width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.85);box-shadow:0 0 18px rgba(0,0,0,.35)"></div>'
          : '<svg class="p" width="26" height="30" viewBox="0 0 26 30" style="position:absolute;left:-3px;top:-2px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.45));transform-origin:3px 2px"><path d="M3 2 L3 24 L9 18.5 L13.2 27.5 L17 25.8 L12.9 17 L21 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg><div class="c" style="position:absolute;left:-18px;top:-18px;width:36px;height:36px;border-radius:50%;border:2px solid rgba(255,255,255,.9);opacity:0"></div>';
      document.documentElement.append(el);
    }
    el.style.transform = `translate(${cursor.x}px, ${cursor.y}px)`;
    el.style.opacity = String(cursor.opacity);
    if (cursor.kind === "tap") {
      const r = el.querySelector(".r");
      r.style.transform = `scale(${cursor.scale})`;
      r.style.opacity = String(cursor.ring);
    } else {
      el.querySelector(".p").style.transform = `scale(${cursor.scale})`;
      const c = el.querySelector(".c");
      c.style.opacity = String(cursor.ring);
      c.style.transform = `scale(${0.5 + (1 - cursor.ring) * 0.9})`;
    }
  }
  return [window.scrollX, window.scrollY];
}

export class Recorder {
  /**
   * @param {object} o
   * @param {string} o.base  the site's URL
   * @param {{width:number,height:number}} o.viewport  CSS pixels
   * @param {boolean} [o.phone]  touch, a tap ripple, phone layout
   * @param {number} [o.fps]
   * @param {string|number|Date} [o.time]  the page's wall clock (a daily's date)
   * @param {string} o.name  frames go to OUT_ROOT/name
   */
  constructor(o) {
    this.o = { fps: 60, phone: false, dpr: 2, ...o };
    this.dt = 1000 / this.o.fps;
    this.frame = 0;
    this.recording = false;
    this.cursor = { x: o.viewport.width * 0.6, y: o.viewport.height * 0.7, scale: 1, ring: 0, opacity: this.o.phone ? 0 : 1, kind: this.o.phone ? "tap" : "pointer" };
    this.dir = path.join(OUT_ROOT, o.name);
    this.rand = rng(o.seed ?? 11);
  }

  async open(url) {
    const { viewport, phone, dpr } = this.o;
    this.browser = await chromium.launch({ args: ["--hide-scrollbars", "--force-color-profile=srgb", "--disable-lcd-text", "--autoplay-policy=no-user-gesture-required"] });
    this.context = await this.browser.newContext({
      viewport,
      deviceScaleFactor: dpr,
      isMobile: phone,
      hasTouch: phone,
      colorScheme: "dark",
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    await this.context.addInitScript(() => {
      try {
        sessionStorage.setItem("pokeiq-splash", "1");
        localStorage.setItem("pokeiq-muted", "1");
      } catch {}
    });
    if (this.o.init) await this.context.addInitScript(this.o.init);
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(60_000);
    this.errors = [];
    this.page.on("pageerror", (e) => this.errors.push(e.message));
    this.page.on("console", (m) => m.type() === "error" && this.errors.push(m.text()));
    await this.page.clock.install({ time: this.o.time ?? Date.now() });
    this.cdp = await this.context.newCDPSession(this.page);
    if (url) await this.goto(url);
    return this.page;
  }

  /** Loads a page in real time and lets it settle. */
  async goto(url) {
    await this.page.goto(url, { waitUntil: "load" });
    await this.page.evaluate(() => document.fonts.ready);
    await this.page.waitForTimeout(800);
  }

  /** Loads images into the cache before the take (real time). */
  async preload(urls) {
    await this.page.evaluate(
      (urls) => Promise.all(urls.map((u) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = u; }))),
      urls
    );
  }

  /** Hides the site's chrome (nav, footer, tab bar) and anything else matching. */
  async css(text) {
    await this.page.addStyleTag({ content: text });
  }

  async hideChrome(extra = "") {
    await this.css(`body > header, header[data-site-nav], footer, [data-testid=tabbar], nav[aria-label="Primary"], nextjs-portal { display: none !important; }
      * { caret-color: transparent !important; scrollbar-width: none !important; }
      ${extra}`);
  }

  /** From here the page's clock only moves when we step it. */
  async freeze() {
    const now = await this.page.evaluate(() => Date.now());
    await this.page.clock.pauseAt(now + 50);
    this.frozen = true;
  }

  /**
   * Frames the take around some elements: their union, padded, grown to
   * `aspect` (width / height) about its centre (or `anchor`), kept on screen.
   */
  async frameAround(locators, { aspect = 16 / 9, pad = 24, minWidth = 0, shiftY = 0, shiftX = 0, top = false } = {}) {
    const boxes = (await Promise.all(locators.map((l) => l.boundingBox()))).filter(Boolean);
    if (!boxes.length) throw new Error("frameAround: nothing to frame");
    let x0 = Math.min(...boxes.map((b) => b.x)) - pad;
    let y0 = Math.min(...boxes.map((b) => b.y)) - pad;
    let x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
    let y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
    let w = Math.max(x1 - x0, minWidth);
    let h = y1 - y0;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    const { width: vw, height: vh } = this.o.viewport;
    if (w > vw) (w = vw), (h = w / aspect);
    if (h > vh) (h = vh), (w = h * aspect);
    const cx = (x0 + x1) / 2 + shiftX;
    const cy = (top ? y0 + h / 2 : (y0 + y1) / 2) + shiftY;
    const x = Math.min(Math.max(0, cx - w / 2), vw - w);
    const y = Math.min(Math.max(0, cy - h / 2), vh - h);
    // Whole device pixels, even sizes.
    const r = (v) => Math.round(v * 2) / 2;
    this.clip = { x: r(x), y: r(y), width: r(w), height: r(h) };
    return this.clip;
  }

  /** Sets the recorded region (CSS pixels, relative to the viewport). */
  setClip(clip) {
    this.clip = clip;
  }

  start() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.frame = 0;
    this.recording = true;
    this.marks = {};
  }

  /** Names the current frame (for cutting later). */
  mark(name) {
    this.marks[name] = this.frame;
  }

  async stop() {
    this.recording = false;
    fs.writeFileSync(path.join(this.dir, "meta.json"), JSON.stringify({ fps: this.o.fps, frames: this.frame, marks: this.marks, clip: this.clip, dpr: this.o.dpr, phone: this.o.phone }, null, 1));
    return { frames: this.frame, marks: this.marks };
  }

  async close() {
    await this.browser?.close();
  }

  /** One frame of game time: timers and rAF, then CSS animations, then the pointer, then (recording) a picture. */
  async tick() {
    if (!this.frozen) throw new Error("freeze() first");
    await this.page.clock.runFor(this.dt);
    const c = this.cursor;
    const [sx, sy] = await this.page.evaluate(stepPage, { dt: this.dt, cursor: { ...c } });
    if (this.onTick) await this.onTick();
    if (this.recording) {
      const { x, y, width, height } = this.clip;
      const { data } = await this.cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 94,
        // CDP's clip is in document coordinates (and must be on screen).
        clip: { x: x + sx, y: y + sy, width, height, scale: 1 },
        captureBeyondViewport: false,
        optimizeForSpeed: true,
      });
      fs.writeFileSync(path.join(this.dir, `f${String(this.frame).padStart(5, "0")}.jpg`), Buffer.from(data, "base64"));
      this.frame++;
      if (this.frame % 60 === 0) process.stdout.write(`  ${this.o.name}: ${this.frame} frames\r`);
    }
  }

  async wait(ms) {
    const n = Math.max(1, Math.round(ms / this.dt));
    for (let i = 0; i < n; i++) await this.tick();
  }

  /** Steps until fn() (in the page) is true. */
  async until(fn, arg, { max = 20_000, poll = 1 } = {}) {
    const n = Math.round(max / this.dt);
    for (let i = 0; i < n; i++) {
      if (i % poll === 0 && (await this.page.evaluate(fn, arg))) return true;
      await this.tick();
    }
    throw new Error(`until: timed out: ${fn}`);
  }

  /** Waits in real time (the page's clock still), for network. */
  async settle(ms = 300) {
    await new Promise((r) => setTimeout(r, ms));
  }

  /** The centre of an element (viewport CSS pixels), with a little human offset. */
  async point(locator, { jitter = 0.18, dx = 0, dy = 0 } = {}) {
    const b = await locator.boundingBox();
    if (!b) throw new Error(`no box for ${locator}`);
    const jx = (this.rand() - 0.5) * jitter * Math.min(b.width, 60);
    const jy = (this.rand() - 0.5) * jitter * Math.min(b.height, 40);
    return { x: b.x + b.width / 2 + jx + dx, y: b.y + b.height / 2 + jy + dy };
  }

  /** Glides the pointer to (x, y) on a soft curve, the real mouse following. */
  async moveTo(x, y, ms) {
    const c = this.cursor;
    const x0 = c.x;
    const y0 = c.y;
    const dist = Math.hypot(x - x0, y - y0);
    ms ??= Math.min(900, 280 + dist * 0.75) * (this.pace ?? 1);
    const n = Math.max(2, Math.round(ms / this.dt));
    // A slight bow, like a wrist.
    const bow = (this.rand() - 0.5) * 0.25 * dist;
    const nx = dist ? -(y - y0) / dist : 0;
    const ny = dist ? (x - x0) / dist : 0;
    for (let i = 1; i <= n; i++) {
      const t = ease(i / n);
      const arc = Math.sin(Math.PI * t) * bow;
      c.x = x0 + (x - x0) * t + nx * arc;
      c.y = y0 + (y - y0) * t + ny * arc;
      if (!this.o.phone) await this.page.mouse.move(c.x, c.y);
      await this.tick();
    }
  }

  async moveToEl(locator, opts = {}) {
    const p = await this.point(locator, opts);
    await this.moveTo(p.x, p.y, opts.ms);
    return p;
  }

  /** A click (desktop) or tap (phone) where the pointer is, with its press and ring. */
  async press({ hold = 70 } = {}) {
    const c = this.cursor;
    if (this.o.phone) {
      c.opacity = 1;
      const steps = Math.round(380 / this.dt);
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        c.scale = 0.55 + easeOut(t) * 0.75;
        c.ring = 1 - t;
        c.opacity = 1 - t * t;
        if (i === 1) await this.page.touchscreen.tap(c.x, c.y);
        await this.tick();
      }
      c.opacity = 0;
      c.ring = 0;
      return;
    }
    await this.page.mouse.down();
    const n = Math.max(2, Math.round(hold / this.dt));
    for (let i = 0; i < n; i++) {
      c.scale = 0.86;
      c.ring = 1;
      await this.tick();
    }
    await this.page.mouse.up();
    const m = Math.round(260 / this.dt);
    for (let i = 0; i < m; i++) {
      const t = (i + 1) / m;
      c.scale = 0.86 + 0.14 * easeOut(t);
      c.ring = 1 - t;
      await this.tick();
    }
    c.scale = 1;
    c.ring = 0;
  }

  async clickEl(locator, opts = {}) {
    if (this.o.phone) {
      const p = await this.point(locator, opts);
      this.cursor.x = p.x;
      this.cursor.y = p.y;
      await this.wait(opts.before ?? 60);
    } else {
      await this.moveToEl(locator, opts);
      await this.wait(opts.before ?? 90);
    }
    await this.press(opts);
  }

  /** Types like a person: a little uneven, a touch faster mid-word. */
  async type(text, { cps = 11 } = {}) {
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      const base = 1000 / cps;
      await this.wait(base * (0.65 + this.rand() * 0.7));
    }
  }

  async key(k) {
    await this.page.keyboard.press(k);
    await this.tick();
  }

  /** Scrolls the window by dy over ms, eased (instant scrolls each frame, so it's frame-exact). */
  async scrollBy(dy, ms = 900, el = null) {
    const n = Math.max(2, Math.round(ms / this.dt));
    let done = 0;
    for (let i = 1; i <= n; i++) {
      const want = dy * ease(i / n);
      const step = want - done;
      done = want;
      await this.page.evaluate(
        ({ step, sel }) => {
          const t = sel ? document.querySelector(sel) : null;
          (t ?? window).scrollBy({ top: step, behavior: "instant" });
        },
        { step, sel: el }
      );
      await this.tick();
    }
  }
}
