/**
 * A stand-in for Supabase's REST API on this machine, for measuring how many
 * database calls the site makes (and for trying it with the database down).
 * Never a real database: every read answers an empty list, every write
 * "succeeds" and is thrown away.
 *
 *   node scripts/fake-supabase.mjs 54321
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=local npm start -- -p 3100
 *
 *   curl 127.0.0.1:54321/__counts          calls so far, by method and table: { total, egressBytes, calls }
 *   curl -X POST 127.0.0.1:54321/__reset    start counting again
 *   curl -X POST '127.0.0.1:54321/__mode?m=down'   answer 503 (m=quota: 402, m=hang: never answer, m=ok: normal)
 *
 * With --rows N, reads of `runs`, `geo_runs` and `geo_round_scores` answer N
 * rows each (as a busy day's tables would), so the bytes the site would pull
 * out of the database (Supabase's egress) can be measured too.
 */
import http from "node:http";

const port = Number(process.argv[2] ?? 54321);
const rowsArg = process.argv.indexOf("--rows");
const ROWS = rowsArg >= 0 ? Number(process.argv[rowsArg + 1]) : 0;
let mode = "ok";
let calls = new Map();
let egress = 0;

const fakeRow = (table, i) =>
  table === "runs"
    ? { id: `r${i}`, player_name: `Trainer${i}`, module: "daily", format: "classic", difficulty: "medium", daily_date: "2026-11-23", score: 5000 - i, correct: 9, total: 10, best_streak: 5, pokeiq: 120, duration_ms: 60000 + i, created_at: "2026-11-23T10:00:00Z" }
    : table === "geo_runs"
      ? { score: (i * 7919) % 25000 }
      : table === "geo_round_scores"
        ? { shot_id: "s", pin_x: 0.5, pin_y: 0.5, player_key: `p${i}` }
        : null;

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/__counts") {
      const total = [...calls.values()].reduce((n, v) => n + v, 0);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ total, egressBytes: egress, calls: Object.fromEntries([...calls].sort((a, b) => b[1] - a[1])) }));
    }
    if (url.pathname === "/__reset") {
      calls = new Map();
      egress = 0;
      return res.end("ok");
    }
    if (url.pathname === "/__mode") {
      mode = url.searchParams.get("m") ?? "ok";
      return res.end(mode);
    }
    const table = url.pathname.replace(/^\/(rest|storage|auth)\/v1\//, "").split("/")[0] || url.pathname;
    const key = `${req.method} ${url.pathname.startsWith("/rest/v1/rpc/") ? `rpc/${url.pathname.split("/").pop()}` : table}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
    if (mode === "hang") return;
    if (mode === "down") return res.writeHead(503).end("{}");
    if (mode === "quota") return res.writeHead(402).end('{"message":"quota exceeded"}');
    req.resume();
    req.on("end", () => {
      const headers = { "content-type": "application/json", "content-range": "0-0/0" };
      if (req.method === "HEAD") return res.writeHead(200, headers).end();
      if (req.method !== "GET") return res.writeHead(201, headers).end("[]");
      const n = fakeRow(table, 0) ? ROWS : 0;
      const limit = Number(url.searchParams.get("limit") ?? n);
      const rows = Array.from({ length: Math.min(n, limit || n) }, (_, i) => fakeRow(table, i));
      const body = (req.headers.accept ?? "").includes("vnd.pgrst.object") ? JSON.stringify(rows[0] ?? null) : JSON.stringify(rows);
      egress += body.length;
      res.writeHead(rows.length || !(req.headers.accept ?? "").includes("vnd.pgrst.object") ? 200 : 406, headers).end(body);
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`fake Supabase on http://127.0.0.1:${port}${ROWS ? `, ${ROWS} rows a busy table` : ""}`));
