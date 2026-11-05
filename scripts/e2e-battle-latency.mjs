/**
 * How long an opponent's move takes to reach a waiting trainer in a live
 * battle: two browsers seated in one battle, Blue choosing first each turn
 * (so Blue's page waits on Red), then Red choosing. Measured from Red's
 * choice coming back to Blue's page receiving the new turn (its poll or
 * long-poll response with the `|turn|` line). Prints p50 and p95.
 *
 *   npm run build && npm start -- -p 3000      # in another terminal
 *   node scripts/e2e-battle-latency.mjs http://localhost:3000 [turns]
 *
 * Fails if the 95th percentile is over LATENCY_P95_MS (default 1000; the
 * polling it replaced took up to about 1 s plus the round trip).
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const TURNS = Number(process.argv[3] ?? 10);
const LIMIT = Number(process.env.LATENCY_P95_MS ?? 1000);

async function api(path, body, token) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(token ? { ...body, token } : body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${body.action ?? body.mode}: ${res.status} ${data.error ?? ""}`);
  return data;
}

const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

const made = await api("/api/battle", { mode: "pvp", name: "Red", format: "gen9randombattle", timer: false, timeoutLoses: false });
const code = made.code;
const red = made.token;
const joined = await api(`/api/battle/${code}`, { action: "join", name: "Blue" });
const blue = joined.token;
await api(`/api/battle/${code}`, { action: "ready", ready: true, since: 0 }, red);
await api(`/api/battle/${code}`, { action: "ready", ready: true, since: 0 }, blue);

const browser = await chromium.launch();
/** A page seated as `token` (the seat the battle page reads from localStorage). */
async function seated(token) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(([c, t]) => window.localStorage.setItem(`pokeiq:battle:${c}`, t), [code, token]);
  const page = await context.newPage();
  await page.goto(`${BASE}/battle/live/${code}`, { waitUntil: "load" });
  return page;
}
const redPage = await seated(red);
const bluePage = await seated(blue);

/** When Blue's page got each turn number (Node's clock), from its own poll responses. */
const blueGot = new Map();
let blueLongPolls = 0;
let bluePolls = 0;
bluePage.on("response", async (res) => {
  const url = res.url();
  if (res.request().method() !== "GET" || !url.includes(`/api/battle/${code}?`)) return;
  const at = Date.now();
  bluePolls++;
  if (url.includes("wait=1")) blueLongPolls++;
  const view = await res.json().catch(() => null);
  for (const line of view?.log?.lines ?? []) {
    const m = /^\|turn\|(\d+)/.exec(line);
    if (m && !blueGot.has(Number(m[1]))) blueGot.set(Number(m[1]), at);
  }
});

async function viewOf(token) {
  const res = await fetch(`${BASE}/api/battle/${code}?since=0`, { headers: { "x-battle-token": token } });
  return res.json();
}

const samples = [];
const started = Date.now();
for (let i = 0; i < TURNS; i++) {
  let b = await viewOf(blue);
  if (b.status !== "playing") break;
  if (b.request && !b.waiting) await api(`/api/battle/${code}`, { action: "choose", rqid: b.request.rqid, choice: "default", since: 0 }, blue);
  const r = await viewOf(red);
  if (!r.request || r.waiting) continue;
  const next = r.turn + 1;
  // Blue's page settles into waiting on Red.
  await new Promise((resolve) => setTimeout(resolve, 700 + Math.random() * 600));
  const out = await api(`/api/battle/${code}`, { action: "choose", rqid: r.request.rqid, choice: "default", since: 0 }, red);
  const sent = Date.now();
  if (!out.log.lines.some((l) => l === `|turn|${next}`)) continue; // a forced switch: no new turn yet
  const deadline = sent + 25_000;
  while (!blueGot.has(next) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  if (!blueGot.has(next)) throw new Error(`Blue's page never got turn ${next}`);
  samples.push(Math.max(0, blueGot.get(next) - sent));
}
const minutes = (Date.now() - started) / 60_000;
await redPage.close();
await browser.close();

if (samples.length < 3) throw new Error(`Only ${samples.length} turns measured`);
const p50 = quantile(samples, 0.5);
const p95 = quantile(samples, 0.95);
console.log(`battle latency over ${samples.length} turns: p50 ${p50} ms, p95 ${p95} ms (samples: ${samples.join(", ")})`);
console.log(`Blue's page: ${bluePolls} GETs (${blueLongPolls} long polls) in ${minutes.toFixed(1)} min, ${(bluePolls / minutes).toFixed(0)} a minute`);
if (p95 > LIMIT) {
  console.error(`p95 ${p95} ms is over ${LIMIT} ms`);
  process.exit(1);
}
