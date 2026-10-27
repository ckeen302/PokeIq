/**
 * Load test: simulated players hitting the pages and read APIs with plain
 * Node fetch (no dependencies).
 *
 *   npm run build && npm start -- -p 3100      # in another terminal
 *   node scripts/load-test.mjs http://localhost:3100                     # ramp 50 → 400 players
 *   node scripts/load-test.mjs http://localhost:3100 --players 300 --duration 30
 *   node scripts/load-test.mjs https://pokeiq.vercel.app --live          # gentle: ≤5 rps, 30 s, cached GET pages only
 *
 * Every simulated player loops: pick a request from the mix, send it, think
 * for --think ms (default 250–1250 ms, randomised), repeat. Each player sends
 * its own X-Forwarded-For so per-address rate limits treat it as a separate
 * trainer, as they would in production. --live never does: on a real
 * deployment the edge sets that header, and live runs stay on CDN-cached
 * pages so they don't spend database or function quota.
 *
 * Prints p50/p95/p99 latency, throughput and the error rate (non-2xx/3xx/4xx
 * that isn't an expected 4xx, plus timeouts) per endpoint and overall, per
 * step. A step "breaks" when its error rate passes 1% or its p95 passes 2 s.
 */

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const LIVE = args.includes("--live");
const DURATION_S = Number(flag("duration", LIVE ? 30 : 20));
const MAX_RPS = Number(flag("rps", LIVE ? 5 : 0));
const STEPS = (flag("players", LIVE ? "5" : "50,100,200,400") + "").split(",").map(Number);
const THINK_MIN = Number(flag("think-min", 250));
const THINK_MAX = Number(flag("think-max", 1250));
const TIMEOUT_MS = Number(flag("timeout", 10_000));
const JSON_OUT = flag("json", "");

if (LIVE && (MAX_RPS > 5 || MAX_RPS <= 0)) throw new Error("--live is capped at 5 requests a second.");
if (LIVE && DURATION_S > 60) throw new Error("--live runs at most 60 seconds.");

const today = new Date().toISOString().slice(0, 10);
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** [name, weight, path, init?, okStatuses?] */
const PAGES = [
  ["page /", 6, "/"],
  ["page /pokedle", 5, "/pokedle"],
  ["page /connections", 4, "/connections"],
  ["page /pikadoku", 3, "/pikadoku"],
  ["page /guessr", 3, "/guessr"],
  ["page /battle", 2, "/battle"],
  ["page /pokedex", 2, "/pokedex"],
  ["page /quiz/name-em-all", 2, "/quiz/name-em-all"],
];
const DYNAMIC_PAGES = [["page /leaderboard", 3, "/leaderboard"]];
const APIS = [
  ["api leaderboard (daily)", 4, `/api/leaderboard?daily=${today}`],
  ["api geo daily-stats", 2, () => `/api/geo/daily-stats?date=${today}&score=${Math.floor(Math.random() * 25_000)}`],
  ["api pikadoku daily", 3, `/api/pikadoku?date=${today}`],
  ["api pikadoku board", 2, `/api/pikadoku/leaderboard?date=${today}`],
  ["api connections daily", 3, `/api/connections?date=${today}`],
  ["api connections board", 2, `/api/connections/leaderboard?date=${today}`],
  ["api connections potd", 1, "/api/connections/potd"],
  ["api name-em-all board", 1, `/api/name-em-all/leaderboard?scope=daily:${today}&board=count`],
  ["api pokedle guess", 6, "/api/pokedle", () => json({ date: today, guesses: Array.from({ length: 1 + Math.floor(Math.random() * 5) }, () => 1 + Math.floor(Math.random() * 1000)) })],
  ["api pokedle dex", 1, "/api/pokedle/dex"],
  ["api battle ladder", 1, "/api/battle/ladder?top=1"],
  ["api battle replays", 1, "/api/battle/replays"],
];
const MIX = LIVE ? PAGES : [...PAGES, ...DYNAMIC_PAGES, ...APIS];
const TOTAL_WEIGHT = MIX.reduce((n, m) => n + m[1], 0);
function pick() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const m of MIX) if ((r -= m[1]) < 0) return m;
  return MIX[0];
}

/** Token bucket shared by all players (only with --rps). */
let tokens = MAX_RPS;
let lastRefill = Date.now();
async function takeToken() {
  if (!MAX_RPS) return;
  for (;;) {
    const now = Date.now();
    tokens = Math.min(MAX_RPS, tokens + ((now - lastRefill) / 1000) * MAX_RPS);
    lastRefill = now;
    if (tokens >= 1) return void (tokens -= 1);
    await sleep(((1 - tokens) / MAX_RPS) * 1000);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function runStep(players) {
  const stats = new Map();
  const record = (name, ms, ok, status) => {
    const s = stats.get(name) ?? { lat: [], errors: 0, statuses: {} };
    s.lat.push(ms);
    if (!ok) s.errors++;
    s.statuses[status] = (s.statuses[status] ?? 0) + 1;
    stats.set(name, s);
  };
  const stopAt = Date.now() + DURATION_S * 1000;
  async function player(id) {
    const ip = `10.${(id >> 16) & 255}.${(id >> 8) & 255}.${id & 255}`;
    // Spread the starts over the first second.
    await sleep(Math.random() * 1000);
    while (Date.now() < stopAt) {
      const [name, , path, init] = pick();
      await takeToken();
      if (Date.now() >= stopAt) break;
      const url = BASE + (typeof path === "function" ? path() : path);
      const req = typeof init === "function" ? init() : (init ?? {});
      const headers = { ...(req.headers ?? {}), ...(LIVE ? {} : { "x-forwarded-for": ip }), "user-agent": "pokeiq-load-test" };
      const t0 = performance.now();
      let status = 0;
      try {
        const res = await fetch(url, { ...req, headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
        await res.arrayBuffer();
        status = res.status;
      } catch (err) {
        status = err?.name === "TimeoutError" ? "timeout" : "neterr";
      }
      const ms = performance.now() - t0;
      // 429 is the server protecting itself under load: counted as an error. Other 4xx are the game saying no (an invalid guess): fine.
      const ok = typeof status === "number" && status < 500 && status !== 429;
      record(name, ms, ok, status);
      await sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: players }, (_, i) => player(i + 1)));
  const secs = (Date.now() - t0) / 1000;

  const rows = [];
  const all = { lat: [], errors: 0, statuses: {} };
  for (const [name, s] of [...stats].sort((a, b) => a[0].localeCompare(b[0]))) {
    s.lat.sort((a, b) => a - b);
    all.lat.push(...s.lat);
    all.errors += s.errors;
    for (const [k, v] of Object.entries(s.statuses)) all.statuses[k] = (all.statuses[k] ?? 0) + v;
    rows.push({ name, n: s.lat.length, p50: pct(s.lat, 50), p95: pct(s.lat, 95), p99: pct(s.lat, 99), errPct: (100 * s.errors) / s.lat.length, statuses: s.statuses });
  }
  all.lat.sort((a, b) => a - b);
  const total = { name: "ALL", n: all.lat.length, p50: pct(all.lat, 50), p95: pct(all.lat, 95), p99: pct(all.lat, 99), errPct: (100 * all.errors) / Math.max(1, all.lat.length), statuses: all.statuses, rps: all.lat.length / secs };
  return { players, secs, rows, total };
}

const fmt = (ms) => (Number.isFinite(ms) ? `${Math.round(ms)}`.padStart(6) : "     -");
function print(step) {
  console.log(`\n=== ${step.players} players, ${step.secs.toFixed(0)} s, ${step.total.rps.toFixed(1)} req/s${MAX_RPS ? ` (capped at ${MAX_RPS})` : ""}`);
  console.log(`${"endpoint".padEnd(28)} ${"n".padStart(6)}  p50 ms  p95 ms  p99 ms   err%  statuses`);
  for (const r of [...step.rows, step.total]) {
    console.log(`${r.name.padEnd(28)} ${String(r.n).padStart(6)}  ${fmt(r.p50)}  ${fmt(r.p95)}  ${fmt(r.p99)}  ${r.errPct.toFixed(1).padStart(5)}  ${Object.entries(r.statuses).map(([k, v]) => `${k}:${v}`).join(" ")}`);
  }
}

console.log(`Load test against ${BASE}${LIVE ? " (live, gentle)" : ""}: ${STEPS.join(" → ")} players, ${DURATION_S} s each, think ${THINK_MIN}–${THINK_MAX} ms.`);
const results = [];
let broke = null;
for (const players of STEPS) {
  const step = await runStep(players);
  results.push(step);
  print(step);
  if (!broke && (step.total.errPct > 1 || step.total.p95 > 2000)) broke = players;
}
console.log(broke ? `\nBreaks at ${broke} players (error rate > 1% or p95 > 2 s).` : `\nHeld up through ${STEPS.at(-1)} players.`);
if (JSON_OUT) (await import("node:fs")).writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, live: LIVE, results, broke }, null, 2));
